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

# Al menos UNA de estas debe aparecer (son específicas de combustible)
KW_COMBUSTIBLE_ESTRICTO = [
    "combustible", "nafta", "gasoil", "gas oil", "gnc", "surtidor",
    "estación de servicio", "estacion de servicio", "carga de nafta",
    "litro de nafta", "litros de nafta", "litro de gasoil",
    "ypf servi", "shell servi", "axion energy", "axión energy",
    "puma energy", "gulf station",
]

# Marcas de estaciones de servicio (remitente o cuerpo)
KW_MARCAS_ESTACION = [
    "ypf", "shell", "axion", "axión", "puma energy", "gulf",
    "petrobras", "tankear",
]

# Dominios de remitentes confiables de energía/combustible
REMITENTES_CONFIABLES = [
    "ypf.com", "shell.com.ar", "axionenergy.com", "pumafuel.com",
    "gulf.com.ar", "tankear.com.ar",
]

KW_PROMO = [
    "descuento", "reintegro", "cashback", "beneficio", "promo", "promoción",
    "promocion", "oferta", "ahorrá", "ahorra", "%", "cuotas sin interés",
    "2x1", "bonificación", "bonificacion", "acumulá puntos", "acumula puntos",
]
KW_TARJETA = [
    "visa", "mastercard", "maestro", "american express", "amex",
    "naranja x", "naranja", "cabal", "bbva", "galicia", "santander", "hsbc",
    "macro", "supervielle", "nación", "nacion", "provincia", "ciudad",
    "itaú", "itau", "patagonia", "icbc", "uala", "mercado pago", "modo",
]

# Remitentes de wallets/tarjetas — aplican filtro estricto de combustible
REMITENTES_WALLET = [
    "naranjax.com", "naranja.com.ar", "modo.com.ar",
    "mercadopago.com", "uala.com.ar",
]

# Palabras que indican que NO es una promo de combustible
KW_DESCARTE = [
    "hamburguesa", "burger", "pizza", "sushi", "restaurant", "comida",
    "delivery", "pedidos ya", "rappi", "glovo", "uber eats",
    "ropa", "moda", "indumentaria", "calzado", "zapatillas",
    "vuelos", "hotel", "turismo", "viaje en avión",
    "supermercado", "hipermercado", "carrefour", "coto", "dia ",
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


def _extraer_remitente_original(msg: email.message.Message, texto: str) -> str:
    """
    Cuando el mail es un reenvío (Fwd:/RV:), extrae el remitente original
    del cuerpo — porque el From: del sobre muestra al forwarder, no al origen.
    Soporta reenvíos de Gmail, Outlook/Hotmail y Apple Mail.
    """
    from_header = _decode_header_str(msg.get("From", ""))

    # Si el From: no es una cuenta personal de reenvío, usarlo directo
    FORWARDERS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com",
                  "live.com", "icloud.com", "me.com"]
    if not any(f in from_header.lower() for f in FORWARDERS):
        return from_header

    # Buscar en el cuerpo el remitente original
    # Patrones de Outlook: "De: X <email>" / Gmail: "From: X <email>"
    patrones = [
        r'(?:De|From)\s*:\s*(.+?<[^>]+>)',      # "De: Nombre <email>"
        r'(?:De|From)\s*:\s*([^\s]+@[^\s\n]+)',  # "De: email@domain.com"
    ]
    for pat in patrones:
        m = re.search(pat, texto[:3000], re.IGNORECASE)
        if m:
            candidato = m.group(1).strip()
            # Asegurarse de que no sea el mismo forwarder
            if not any(f in candidato.lower() for f in FORWARDERS):
                return candidato

    return from_header


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


def _es_promo_combustible(asunto: str, texto: str, remitente: str = "") -> bool:
    """
    Regla principal de detección:

    - Si el remitente es una estación de servicio conocida (YPF, Shell, Axion...):
      publicamos TODO lo que tenga alguna palabra de promo. No importa si es
      nafta, lavadero, tienda o café — el usuario tiene el club y le sirve.

    - Si el remitente es desconocido (mail reenviado manualmente, banco, etc.):
      exigimos una palabra estricta de combustible + promo, y descartamos
      categorías claramente ajenas.
    """
    contenido = (asunto + " " + texto[:2000]).lower()
    rem = remitente.lower()

    # Bancos/wallets/clubes → siempre filtro estricto (mandan promos de todo)
    SOLO_FILTRO_ESTRICTO = [
        "galicia", "bbva", "macro", "santander", "novedades.santander", "hsbc", "icbc",
        "bancociudad", "bancoprovincia", "bna.com", "banconacion",
        "clubln", "lanacionline", "modo.com", "mercadopago", "uala",
    ]
    if any(d in rem for d in SOLO_FILTRO_ESTRICTO):
        rem = ""  # forzar path de filtro estricto

    # ¿Viene de una estación/marca conocida?
    es_estacion = any(d in rem for d in REMITENTES_CONFIABLES) or \
                  any(kw in rem for kw in KW_MARCAS_ESTACION)

    tiene_promo = any(kw in contenido for kw in KW_PROMO)

    if es_estacion:
        # De YPF/Shell/Axion: publicamos si tiene cualquier promo
        if not tiene_promo:
            log.info("  → Remitente estación pero sin palabras de promo, skip")
            return False
        log.info(f"  → Remitente estación ({rem[:40]}): publicando")
        return True

    # Remitente desconocido: filtro más estricto
    if any(kw in contenido for kw in KW_DESCARTE):
        log.info("  → Descartado: categoría ajena (comida/ropa/etc)")
        return False

    tiene_combustible = any(kw in contenido for kw in KW_COMBUSTIBLE_ESTRICTO) or \
                        any(kw in asunto.lower() for kw in KW_MARCAS_ESTACION)

    if not tiene_combustible:
        log.info("  → Sin señal de combustible")
        return False

    if not tiene_promo:
        log.info("  → Sin palabras de promo")
        return False

    return True


def _detectar_categoria(asunto: str, texto: str) -> tuple[str, str]:
    """
    Determina qué tipo de promo es y el emoji correspondiente.
    Retorna (categoria_label, emoji)
    """
    contenido = (asunto + " " + texto[:1500]).lower()

    if any(k in contenido for k in ["nafta", "gasoil", "gas oil", "gnc", "combustible", "litro"]):
        return "combustible", "⛽"
    if any(k in contenido for k in ["lavadero", "car wash", "lavado"]):
        return "lavadero", "🚿"
    if any(k in contenido for k in ["shop", "tienda", "minimercado", "snack", "golosina",
                                     "chocola", "bebida", "agua", "gaseosa"]):
        return "tienda", "🛒"
    if any(k in contenido for k in ["café", "cafe", "capuchino", "latte", "expreso",
                                     "sanguchería", "sangucheria", "sanguche", "burger",
                                     "hamburguesa", "combo", "yerba", "mate", "parada"]):
        return "gastronomía", "🍔"
    if any(k in contenido for k in ["puntos", "acumul", "club", "beneficio", "membership"]):
        return "programa de puntos", "⭐"
    return "estación de servicio", "🏪"


def _extraer_tope(texto: str) -> str:
    """
    Busca el tope/límite de reintegro en TODO el texto incluyendo letra chica.
    Patrones comunes en mails argentinos de bancos/wallets.
    """
    t = texto.lower()
    patrones = [
        r'tope\s+de\s+reintegro[:\s]+\$?\s*([\d\.,]+)',
        r'tope\s+de\s+beneficio[:\s]+\$?\s*([\d\.,]+)',
        r'tope[:\s]+\$?\s*([\d\.,]+)',
        r'máximo\s+de\s+reintegro[:\s]+\$?\s*([\d\.,]+)',
        r'maximo\s+de\s+reintegro[:\s]+\$?\s*([\d\.,]+)',
        r'reintegro\s+máximo[:\s]+\$?\s*([\d\.,]+)',
        r'reintegro\s+maximo[:\s]+\$?\s*([\d\.,]+)',
        r'hasta\s+\$\s*([\d\.,]+)\s+de\s+reintegro',
        r'hasta\s+\$\s*([\d\.,]+)\s+por\s+(mes|semana|día|dia)',
        r'beneficio\s+máximo[:\s]+\$?\s*([\d\.,]+)',
        r'beneficio\s+maximo[:\s]+\$?\s*([\d\.,]+)',
        r'límite[:\s]+\$?\s*([\d\.,]+)',
        r'limite[:\s]+\$?\s*([\d\.,]+)',
    ]
    for pat in patrones:
        m = re.search(pat, t)
        if m:
            monto = m.group(1).replace(".", "").replace(",", "")
            return f"${monto}"
    return ""


def _extraer_info(asunto: str, texto: str, remitente: str) -> dict:
    """Extrae campos clave de la promo."""
    contenido = (asunto + " " + texto[:3000]).lower()
    full      = asunto + " " + texto[:3000]

    # Tipo de promo
    categoria, emoji_cat = _detectar_categoria(asunto, texto)

    # Descuento %
    pct = re.findall(r'(\d+)\s*%', full)
    descuento = f"{pct[0]}%" if pct else None

    # Tope — busca en TODO el texto (letra chica incluida)
    tope_str = _extraer_tope(texto)

    # Marca
    marca = None
    for m in ["ypf", "shell", "axion", "axión", "puma", "gulf", "petrobras"]:
        if m in contenido:
            marca = m.upper().replace("IÓN", "ION")
            break

    # Tarjeta / wallet — priorizar remitente sobre cuerpo del mail
    rem_lower = remitente.lower()
    REMITENTE_A_TARJETA = {
        # Wallets
        "naranjax.com":           "Naranja X",
        "naranja.com.ar":         "Naranja",
        "modo.com.ar":            "Modo",
        "mercadopago.com":        "Mercado Pago",
        "uala.com.ar":            "Ualá",
        # Bancos
        "mail.galicia.ar":        "Galicia",
        "galicia.com.ar":         "Galicia",
        "bbva.com":               "BBVA",
        "bbva.com.ar":            "BBVA",
        "macro.com.ar":           "Macro",
        "santander.com.ar":              "Santander",
        "novedades.santander.com.ar":    "Santander",
        "hsbc.com.ar":            "HSBC",
        "icbcmall.com.ar":        "ICBC",
        "icbc.com.ar":            "ICBC",
        "bancociudad.com.ar":     "Ciudad",
        "bancoprovincia.com.ar":  "Provincia",
        "bna.com.ar":             "Banco Nación",
        "banconacion.com.ar":     "Banco Nación",
        # Clubes / beneficios
        "clubln.com.ar":          "Club La Nación",
        "lanacionline.com.ar":    "La Nación",
        # Estaciones
        "onaxionenergy.com":      "Axion",
        "axionenergy.com":        "Axion",
        "ypf.com":                "YPF",
        "shell.com.ar":           "Shell",
        "pumafuel.com":           "Puma",
        "gulf.com.ar":            "Gulf",
    }
    tarjeta = None
    for dominio, nombre in REMITENTE_A_TARJETA.items():
        if dominio in rem_lower:
            tarjeta = nombre
            break
    # Si no se detectó por remitente, buscar en el cuerpo
    if not tarjeta:
        for t in KW_TARJETA:
            if t in contenido:
                tarjeta = t.title()
                break

    # Vigencia — solo fechas del año actual o siguiente (descartar históricas)
    año_actual = datetime.now().year
    fechas_raw = re.findall(r'(\d{1,2}[\/\-]\d{1,2}[\/\-](\d{2,4}))', full)
    fechas_validas = []
    for fecha_str, año_str in fechas_raw:
        año = int(año_str) if len(año_str) == 4 else 2000 + int(año_str)
        if año >= año_actual:
            fechas_validas.append(fecha_str)
    # También fechas sin año (dd/mm) las aceptamos
    if not fechas_validas:
        fechas_sin_año = re.findall(r'(\d{1,2}[\/\-]\d{1,2})(?![\/\-]\d)', full)
        fechas_validas = fechas_sin_año
    vigencia = " al ".join(fechas_validas[:2]) if len(fechas_validas) >= 2 else (fechas_validas[0] if fechas_validas else None)

    # Remitente limpio
    remitente_clean = re.sub(r'<.*?>', '', remitente).strip().strip('"')

    return {
        "categoria":       categoria,
        "emoji_cat":       emoji_cat,
        "descuento":       descuento,
        "tope":            tope_str,
        "marca":           marca,
        "tarjeta":         tarjeta,
        "vigencia":        vigencia,
        "remitente":       remitente_clean,
        "asunto":          asunto,
        "_texto_completo": texto,   # para detectar banco secundario en wallets
    }


def _extraer_banco_secundario(texto: str, tarjeta_principal: str) -> str:
    """
    Cuando la wallet principal es Modo/Uala/MercadoPago, busca si la promo
    es válida solo para ciertos bancos (mencionados en la letra chica).
    """
    BANCOS = ["nación", "nacion", "galicia", "bbva", "santander", "macro",
              "supervielle", "provincia", "ciudad", "patagonia", "itaú", "itau"]
    WALLETS = ["modo", "mercado pago", "uala", "ualá"]

    if tarjeta_principal.lower() not in WALLETS:
        return ""

    t = texto.lower()
    encontrados = [b.title() for b in BANCOS if b in t]
    if not encontrados:
        return ""
    # Si encontró varios bancos, es promo abierta (no mencionar)
    if len(encontrados) >= 4:
        return ""
    return ", ".join(encontrados[:2])


def _formatear_mensaje(info: dict, asunto: str) -> str:
    """
    Genera un mensaje legible, no una lista de campos.
    Ejemplo: "15% de reintegro en PUMA pagando con Modo (Banco Nación)"
    """
    def esc(s):
        if not s:
            return ""
        return re.sub(r'([_\*\[\]\(\)~`>#+\-=|{}\.!\\])', r'\\\1', str(s))

    emoji = info.get("emoji_cat", "🏪")
    marca    = info.get("marca", "")
    descuento = info.get("descuento", "")
    tope     = info.get("tope", "")
    tarjeta  = info.get("tarjeta", "")
    vigencia = info.get("vigencia", "")
    categoria = info.get("categoria", "")

    # Banco secundario (ej: Modo con Banco Nación)
    banco_sec = _extraer_banco_secundario(info.get("_texto_completo", ""), tarjeta)

    # ── Línea principal: "[descuento] en [marca] pagando con [tarjeta]" ──────
    partes_titulo = []
    if descuento:
        partes_titulo.append(f"*{esc(descuento)} de reintegro*")
    if marca:
        partes_titulo.append(f"en *{esc(marca)}*")
    # No agregar tarjeta si es la misma que la marca (evita "en YPF pagando con YPF")
    if tarjeta and tarjeta.upper() != (marca or "").upper():
        pago_txt = f"pagando con *{esc(tarjeta)}*"
        if banco_sec:
            pago_txt += f" \\({esc(banco_sec)}\\)"
        partes_titulo.append(pago_txt)

    # Si no hay descuento concreto, usar el asunto como descripción principal
    # (el asunto suele describir la promo mejor que los campos extraídos)
    if not descuento:
        asunto_corto = asunto[:60] + ("…" if len(asunto) > 60 else "")
        titulo = f"{emoji} *{esc(asunto_corto)}*"
        lineas = ["🔥 *Nueva promo*\n", titulo]
        # Agregar marca/tarjeta como línea secundaria si hay info útil
        if partes_titulo:
            lineas.append(" ".join(partes_titulo))
    elif partes_titulo:
        titulo = f"{emoji} " + " ".join(partes_titulo)
        lineas = ["🔥 *Nueva promo*\n", titulo]
    else:
        # Fallback al asunto del mail
        asunto_corto = asunto[:55] + ("…" if len(asunto) > 55 else "")
        titulo = f"{emoji} *{esc(asunto_corto)}*"
        lineas = ["🔥 *Nueva promo*\n", titulo]

    # Tope si existe
    if tope:
        lineas.append(f"_Tope de reintegro: {esc(tope)}_")

    # Vigencia
    if vigencia:
        lineas.append(f"📅 Válido hasta: {esc(vigencia)}")

    lineas.append(f"\n[Ver estaciones {esc(marca) if marca else 'en Tankear'}](https://tankear\\.com\\.ar)")

    return "\n".join(lineas)


# ── Base de datos: evitar duplicados ─────────────────────────────────────────
def _init_promo_table():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS telegram_promos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            mail_id     TEXT UNIQUE,
            remitente   TEXT,
            asunto      TEXT,
            descuento   TEXT,
            marca       TEXT,
            tarjeta     TEXT,
            vigencia    TEXT,
            publicado   INTEGER DEFAULT 0,
            texto_msg   TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        )
    """)
    # Migración: agregar columnas si ya existía la tabla sin ellas
    for col in ["remitente TEXT", "descuento TEXT", "marca TEXT",
                "tarjeta TEXT", "vigencia TEXT", "texto_msg TEXT"]:
        try:
            con.execute(f"ALTER TABLE telegram_promos ADD COLUMN {col}")
        except Exception:
            pass
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


def _marcar_procesado(mail_id: str, asunto: str, publicado: bool,
                      info: dict = None, texto_msg: str = ""):
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute(
            """INSERT OR IGNORE INTO telegram_promos
               (mail_id, remitente, asunto, descuento, marca, tarjeta, vigencia, publicado, texto_msg)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                mail_id,
                info.get("remitente", "") if info else "",
                asunto,
                info.get("descuento", "") if info else "",
                info.get("marca", "") if info else "",
                info.get("tarjeta", "") if info else "",
                info.get("vigencia", "") if info else "",
                int(publicado),
                texto_msg,
            )
        )
        con.commit()
        con.close()
    except Exception as e:
        log.warning(f"No se pudo guardar promo en DB: {e}")


# ── Imagen del mail ───────────────────────────────────────────────────────────
def _extraer_imagen(msg: email.message.Message) -> bytes | None:
    """
    Extrae la primera imagen inline o adjunta del mail (banner de la promo).
    Preferencia: image/jpeg > image/png > image/gif
    """
    imagenes = []
    for part in msg.walk():
        ct = part.get_content_type()
        if ct.startswith("image/"):
            data = part.get_payload(decode=True)
            if data and len(data) > 5000:  # descartar íconos tiny (<5KB)
                imagenes.append((ct, data))
    if not imagenes:
        return None
    # Preferir jpeg/png sobre gif
    for ct, data in imagenes:
        if "jpeg" in ct or "png" in ct:
            return data
    return imagenes[0][1]


# ── Telegram ──────────────────────────────────────────────────────────────────
async def _send_telegram(texto: str, imagen: bytes = None) -> bool:
    async with httpx.AsyncClient(timeout=20) as client:
        if imagen:
            # Postear como foto con caption
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto"
            files = {"photo": ("promo.jpg", imagen, "image/jpeg")}
            data  = {"chat_id": CHANNEL, "caption": texto,
                     "parse_mode": "MarkdownV2"}
            r = await client.post(url, data=data, files=files)
        else:
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
            r = await client.post(url, json={
                "chat_id": CHANNEL, "text": texto,
                "parse_mode": "MarkdownV2",
                "disable_web_page_preview": False,
            })

        if r.status_code == 200:
            log.info(f"✅ Publicado en {CHANNEL} {'con imagen' if imagen else 'sin imagen'}")
            return True
        else:
            log.error(f"Telegram error {r.status_code}: {r.text[:300]}")
            # Fallback: intentar sin imagen
            if imagen:
                log.info("  Reintentando sin imagen...")
                return await _send_telegram(texto, imagen=None)
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

            mail_id   = msg.get("Message-ID", mid.decode())
            asunto    = _decode_header_str(msg.get("Subject", ""))
            texto     = _get_text(msg)
            # Usar remitente original si es reenvío de cuenta personal
            remitente = _extraer_remitente_original(msg, texto)

            log.info(f"Procesando: {asunto[:60]}")
            log.info(f"  Remitente: {remitente[:60]}")

            if _ya_procesado(mail_id):
                log.info("  → Ya procesado, skip")
                continue

            info = _extraer_info(asunto, texto, remitente)

            if not _es_promo_combustible(asunto, texto, remitente):
                log.info("  → No es promo de combustible, skip")
                # Guardamos igual con publicado=0 para tener historial
                _marcar_procesado(mail_id, asunto, False, info)
                imap.store(mid, "+FLAGS", "\\Seen")
                continue

            log.info("  → ¡Es promo! Publicando...")
            mensaje = _formatear_mensaje(info, asunto)
            imagen  = _extraer_imagen(msg)
            if imagen:
                log.info(f"  → Imagen encontrada ({len(imagen)//1024}KB)")

            ok = await _send_telegram(mensaje, imagen)
            _marcar_procesado(mail_id, asunto, ok, info, mensaje)
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
