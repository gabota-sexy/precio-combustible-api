#!/usr/bin/env python3
"""
promo_detector.py — Tankear
Lee el inbox de promos, detecta ofertas de combustible y las publica en @tankear_ar.

Variables de entorno requeridas:
  PROMO_GMAIL_USER     abuelaeliabarbieri@gmail.com
  PROMO_GMAIL_PASS     app-password de 16 caracteres
  TELEGRAM_BOT_TOKEN   token del bot
  PROMO_CHANNEL        @tankear_ar (default)
  DB_PATH              ruta a tankear.db (para no repetir promos ya publicadas)
"""

import imaplib
import email
import os
import re
import json
import logging
import sqlite3
import asyncio
from datetime import datetime, date
from email.header import decode_header
from typing import Optional

import httpx

# ── Config ────────────────────────────────────────────────────────────────────
GMAIL_USER    = os.getenv("PROMO_GMAIL_USER", "abuelaeliabarbieri@gmail.com")
GMAIL_PASS    = os.getenv("PROMO_GMAIL_PASS", "")
BOT_TOKEN     = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHANNEL       = os.getenv("PROMO_CHANNEL", "@tankear_ar")
DB_PATH       = os.getenv("DB_PATH", "/var/www/tankear/data/tankear.db")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("promo_detector")

# ── Palabras clave para detectar promos de combustible ───────────────────────
KW_COMBUSTIBLE = [
    "combustible", "nafta", "gasoil", "gas oil", "gnc", "surtidor",
    "estación de servicio", "estacion de servicio", "litro", "litros",
    "ypf", "shell", "axion", "axión", "puma", "gulf", "petrobras",
    "tankear",
]
KW_PROMO = [
    "descuento", "reintegro", "cashback", "beneficio", "promo", "promoción",
    "promocion", "oferta", "ahorrá", "ahorra", "gratis", "%", "cuotas",
    "2x1", "bonificación", "bonificacion", "acumulá", "acumula", "puntos",
]
KW_TARJETA = [
    "visa", "mastercard", "maestro", "american express", "amex",
    "naranja", "cabal", "bbva", "galicia", "santander", "hsbc",
    "macro", "supervielle", "nación", "nacion", "provincia", "ciudad",
    "itaú", "itau", "patagonia", "icbc", "uala", "mercado pago",
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def _decode_header_str(h: str) -> str:
    parts = decode_header(h or "")
    out = []
    for part, enc in parts:
        if isinstance(part, bytes):
            out.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            out.append(part)
    return " ".join(out)


def _get_text(msg: email.message.Message) -> str:
    """Extrae el texto plano o HTML del mensaje."""
    text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct in ("text/plain", "text/html"):
                payload = part.get_payload(decode=True)
                if payload:
                    text += payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            text = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    # Strip HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _es_promo_combustible(asunto: str, texto: str) -> bool:
    """Retorna True si el mail parece una promo de combustible."""
    contenido = (asunto + " " + texto[:2000]).lower()
    tiene_combustible = any(kw in contenido for kw in KW_COMBUSTIBLE)
    tiene_promo = any(kw in contenido for kw in KW_PROMO)
    return tiene_combustible and tiene_promo


def _extraer_info(asunto: str, texto: str, remitente: str) -> dict:
    """
    Extrae campos clave de la promo.
    Retorna dict con: descuento, marca, tarjeta, vigencia, resumen
    """
    contenido = (asunto + " " + texto[:3000]).lower()
    full = asunto + " " + texto[:3000]

    # Descuento %
    pct = re.findall(r'(\d+)\s*%', full)
    descuento = f"{pct[0]}%" if pct else None

    # Reintegro $ o tope
    tope = re.findall(r'tope[:\s]+\$?\s*([\d\.]+)', contenido)
    tope_str = f"(tope ${tope[0]})" if tope else ""

    # Marca de combustible
    marca = None
    for m in ["ypf", "shell", "axion", "axión", "puma", "gulf", "petrobras"]:
        if m in contenido:
            marca = m.upper().replace("IÓN", "ION")
            break

    # Tarjeta
    tarjeta = None
    for t in KW_TARJETA:
        if t in contenido:
            tarjeta = t.title()
            break

    # Vigencia
    fechas = re.findall(
        r'(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)',
        full
    )
    vigencia = " al ".join(fechas[:2]) if len(fechas) >= 2 else (fechas[0] if fechas else None)

    # Remitente limpio
    remitente_clean = re.sub(r'<.*?>', '', remitente).strip().strip('"')

    return {
        "descuento": descuento,
        "tope": tope_str,
        "marca": marca,
        "tarjeta": tarjeta,
        "vigencia": vigencia,
        "remitente": remitente_clean,
        "asunto": asunto,
    }


def _formatear_mensaje(info: dict, asunto: str) -> str:
    """Genera el texto del mensaje Telegram con MarkdownV2."""
    def esc(s):
        if not s:
            return ""
        return re.sub(r'([_\*\[\]\(\)~`>#+\-=|{}\.!\\])', r'\\\1', str(s))

    lineas = ["🔥 *Nueva promo de combustible*\n"]

    if info["marca"]:
        lineas.append(f"⛽ *{esc(info['marca'])}*")

    if info["descuento"]:
        desc_txt = f"💸 *{esc(info['descuento'])} de descuento*"
        if info["tope"]:
            desc_txt += f" {esc(info['tope'])}"
        lineas.append(desc_txt)

    if info["tarjeta"]:
        lineas.append(f"💳 Con tarjeta {esc(info['tarjeta'])}")

    if info["vigencia"]:
        lineas.append(f"📅 Vigencia: {esc(info['vigencia'])}")

    lineas.append(f"\n_{esc(info['remitente'])}_")
    lineas.append(f"\n[Ver estaciones en Tankear](https://tankear\\.com\\.ar)")

    return "\n".join(lineas)


# ── Base de datos: evitar duplicados ─────────────────────────────────────────
def _init_promo_table():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS telegram_promos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            mail_id     TEXT UNIQUE,
            asunto      TEXT,
            publicado   INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now'))
        )
    """)
    con.commit()
    con.close()


def _ya_procesado(mail_id: str) -> bool:
    try:
        con = sqlite3.connect(DB_PATH)
        row = con.execute("SELECT id FROM telegram_promos WHERE mail_id=?", (mail_id,)).fetchone()
        con.close()
        return row is not None
    except Exception:
        return False


def _marcar_procesado(mail_id: str, asunto: str, publicado: bool):
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute(
            "INSERT OR IGNORE INTO telegram_promos (mail_id, asunto, publicado) VALUES (?,?,?)",
            (mail_id, asunto, int(publicado))
        )
        con.commit()
        con.close()
    except Exception as e:
        log.warning(f"No se pudo guardar promo en DB: {e}")


# ── Telegram ──────────────────────────────────────────────────────────────────
async def _send_telegram(texto: str) -> bool:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHANNEL,
        "text": texto,
        "parse_mode": "MarkdownV2",
        "disable_web_page_preview": False,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload)
        if r.status_code == 200:
            log.info(f"✅ Publicado en {CHANNEL}")
            return True
        else:
            log.error(f"Telegram error {r.status_code}: {r.text[:200]}")
            return False


# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    _init_promo_table()

    if not GMAIL_PASS:
        log.error("PROMO_GMAIL_PASS no configurada")
        return
    if not BOT_TOKEN:
        log.error("TELEGRAM_BOT_TOKEN no configurado")
        return

    log.info(f"Conectando a Gmail ({GMAIL_USER})...")
    try:
        imap = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        imap.login(GMAIL_USER, GMAIL_PASS)
        imap.select("INBOX")
    except Exception as e:
        log.error(f"Error conectando a Gmail: {e}")
        return

    # Leer todos los no-leídos
    status, msgs = imap.search(None, "UNSEEN")
    ids = msgs[0].split() if msgs[0] else []
    log.info(f"Mails no leídos: {len(ids)}")

    publicados = 0
    for mid in ids:
        try:
            status, data = imap.fetch(mid, "(RFC822)")
            msg = email.message_from_bytes(data[0][1])

            mail_id  = msg.get("Message-ID", mid.decode())
            asunto   = _decode_header_str(msg.get("Subject", ""))
            remitente = _decode_header_str(msg.get("From", ""))
            texto    = _get_text(msg)

            log.info(f"Procesando: {asunto[:60]}")

            if _ya_procesado(mail_id):
                log.info("  → Ya procesado, skip")
                continue

            if not _es_promo_combustible(asunto, texto):
                log.info("  → No es promo de combustible, skip")
                _marcar_procesado(mail_id, asunto, False)
                # Marcar como leído igual para no reprocesar
                imap.store(mid, "+FLAGS", "\\Seen")
                continue

            log.info("  → ¡Es promo de combustible! Publicando...")
            info = _extraer_info(asunto, texto, remitente)
            mensaje = _formatear_mensaje(info, asunto)

            ok = await _send_telegram(mensaje)
            _marcar_procesado(mail_id, asunto, ok)
            imap.store(mid, "+FLAGS", "\\Seen")

            if ok:
                publicados += 1
                await asyncio.sleep(2)  # rate limit Telegram

        except Exception as e:
            log.error(f"Error procesando mail {mid}: {e}")

    imap.logout()
    log.info(f"Finalizado. Publicadas: {publicados} promos.")


if __name__ == "__main__":
    asyncio.run(main())
