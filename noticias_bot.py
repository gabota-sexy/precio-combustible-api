#!/usr/bin/env python3
"""
noticias_bot.py — Monitorea noticias de combustible/energía en medios argentinos
y envía 1 nota por hora al canal @tankear_ar con análisis.

Corre via cron cada hora:
  0 * * * * DB_PATH=/var/www/tankear/data/tankear.db TELEGRAM_BOT_TOKEN=... /var/www/tankear/venv/bin/python3 /var/www/tankear/api/noticias_bot.py
"""

import os
import sqlite3
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from html import unescape
import re

# ── Config ────────────────────────────────────────────────────────────────────
DB_PATH   = os.environ.get("DB_PATH",            "/var/www/tankear/data/tankear.db")
TG_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CANAL     = "@tankear_ar"
API_BASE  = f"https://api.telegram.org/bot{TG_TOKEN}"

# Fuentes RSS argentinas
FUENTES = [
    {"nombre": "Infobae Economía",   "url": "https://www.infobae.com/feeds/rss/economia/"},
    {"nombre": "La Nación Economía", "url": "https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/"},
    {"nombre": "Ámbito Financiero",  "url": "https://www.ambito.com/rss/pages/economia.xml"},
    {"nombre": "iProfesional",       "url": "https://www.iprofesional.com/rss/home.xml"},
    {"nombre": "El Cronista",        "url": "https://www.cronista.com/files/rss/economia.xml"},
    {"nombre": "Clarín Economía",    "url": "https://www.clarin.com/rss/economia/"},
    {"nombre": "La Política Online", "url": "https://www.lapoliticaonline.com/rss/"},
]

# Keywords de alta relevancia (peso 3)
KW_ALTA = [
    "nafta", "combustible", "gasoil", "gasolina",
    "ypf", "shell", "axion", "puma energy",
    "precio nafta", "precio combustible", "suba de nafta",
    "baja de nafta", "tarifazo combustible",
    "vaca muerta", "hidrocarburo", "refinería",
]

# Keywords de media relevancia (peso 1)
KW_MEDIA = [
    "petróleo", "petroleo", "energia", "energía",
    "barril", "crudo", "shale", "gas natural",
    "enarsa", "ieasa", "secretaría de energía",
    "guerra aranceles", "trump petroleo", "opep", "opec",
    "importación combustible", "exportación combustible",
    "subsidio energía", "tarifa energía",
    "litro", "surtidor", "estación de servicio",
]

MAX_CHARS = 900  # límite Telegram con margen


# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def limpiar(texto: str) -> str:
    """Saca HTML tags y espacios extra."""
    if not texto:
        return ""
    texto = unescape(texto)
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_tabla():
    conn = _conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS noticias_enviadas (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            url        TEXT UNIQUE,
            titulo     TEXT,
            fuente     TEXT,
            puntaje    INTEGER,
            enviado_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()


def ya_enviada(url: str, titulo: str = "") -> bool:
    conn = _conn()
    # Chequear por URL exacta
    row = conn.execute(
        "SELECT id FROM noticias_enviadas WHERE url = ?", (url,)
    ).fetchone()
    if row:
        conn.close()
        return True
    # Chequear por título (misma nota en distintos feeds/URLs)
    if titulo:
        titulo_norm = titulo.strip().lower()[:120]
        row = conn.execute(
            "SELECT id FROM noticias_enviadas WHERE lower(titulo) = ?", (titulo_norm,)
        ).fetchone()
        if row:
            conn.close()
            return True
    conn.close()
    return False


def marcar_enviada(url: str, titulo: str, fuente: str, puntaje: int):
    conn = _conn()
    conn.execute(
        "INSERT OR IGNORE INTO noticias_enviadas (url, titulo, fuente, puntaje) VALUES (?, ?, ?, ?)",
        (url, titulo, fuente, puntaje)
    )
    conn.commit()
    conn.close()


# ── Scoring ───────────────────────────────────────────────────────────────────
def puntuar(titulo: str, descripcion: str) -> int:
    texto = (titulo + " " + descripcion).lower()
    score = 0
    for kw in KW_ALTA:
        if kw in texto:
            score += 3
    for kw in KW_MEDIA:
        if kw in texto:
            score += 1
    # Bonus si está en el título (más relevante)
    titulo_lower = titulo.lower()
    for kw in KW_ALTA:
        if kw in titulo_lower:
            score += 2
    return score


# ── Fetch RSS ─────────────────────────────────────────────────────────────────
def fetch_rss(fuente: dict) -> list:
    try:
        r = requests.get(fuente["url"], timeout=10,
                         headers={"User-Agent": "Tankear-NewsBot/1.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        items = root.findall(".//item")
        noticias = []
        for item in items:
            titulo = limpiar(item.findtext("title", ""))
            url    = (item.findtext("link", "") or "").strip()
            desc   = limpiar(item.findtext("description", ""))
            pub    = item.findtext("pubDate", "")
            if not titulo or not url:
                continue
            noticias.append({
                "titulo":  titulo,
                "url":     url,
                "desc":    desc[:400],
                "pub":     pub,
                "fuente":  fuente["nombre"],
                "puntaje": puntuar(titulo, desc),
            })
        return noticias
    except Exception as e:
        log(f"RSS error {fuente['nombre']}: {e}")
        return []


# ── Analizar artículo ─────────────────────────────────────────────────────────
def analizar(noticia: dict) -> str:
    """
    Genera un análisis simple basado en keywords detectados.
    Sin LLM — usa lógica de reglas para dar contexto al conductor argentino.
    """
    titulo = noticia["titulo"].lower()
    desc   = noticia["desc"].lower()
    texto  = titulo + " " + desc

    lineas = []

    # ¿Sube o baja?
    if any(w in texto for w in ["suba", "aumenta", "aumentó", "aumento", "sube", "incremento", "incrementa"]):
        lineas.append("📈 *Impacto:* Los precios en surtidor podrían aumentar en los próximos días.")
    elif any(w in texto for w in ["baja", "bajó", "reducción", "cae", "cayó", "rebaja"]):
        lineas.append("📉 *Impacto:* Posible alivio en el precio del litro para el conductor.")

    # ¿YPF específicamente?
    if "ypf" in texto:
        lineas.append("🏢 *YPF* es la empresa dominante en Argentina — sus movimientos afectan al 55% de las estaciones.")

    # ¿Guerra / geopolítica?
    if any(w in texto for w in ["guerra", "aranceles", "trump", "opep", "opec", "conflicto"]):
        lineas.append("🌍 *Contexto global:* Las tensiones internacionales impactan el precio del barril y pueden trasladarse al surtidor local.")

    # ¿Vaca Muerta?
    if "vaca muerta" in texto:
        lineas.append("⛏️ *Vaca Muerta:* La producción local puede reducir la dependencia de importaciones y moderar precios.")

    # ¿Subsidios / tarifas?
    if any(w in texto for w in ["subsidio", "tarifa", "regulación", "regulacion"]):
        lineas.append("⚖️ *Política energética:* Los cambios regulatorios pueden modificar el precio final en estaciones.")

    if not lineas:
        lineas.append("ℹ️ Seguí esta nota para estar al tanto de cómo puede afectar el precio del combustible.")

    return "\n".join(lineas)


# ── Telegram ──────────────────────────────────────────────────────────────────
def tg_send(text: str) -> bool:
    if not TG_TOKEN:
        log("Sin token TG")
        return False
    try:
        r = requests.post(f"{API_BASE}/sendMessage", json={
            "chat_id":                  CANAL,
            "text":                     text,
            "parse_mode":               "Markdown",
            "disable_web_page_preview": False,
        }, timeout=15)
        return r.ok
    except Exception as e:
        log(f"TG error: {e}")
        return False


def formatear_mensaje(noticia: dict, analisis: str) -> str:
    titulo  = noticia["titulo"][:120]
    fuente  = noticia["fuente"]
    url     = noticia["url"]
    desc    = noticia["desc"][:200] if noticia["desc"] else ""
    hora    = datetime.now().strftime("%d/%m %H:%M")

    msg = f"📰 *{titulo}*\n"
    msg += f"_{fuente} · {hora}_\n\n"
    if desc:
        msg += f"{desc}...\n\n"
    msg += f"{analisis}\n\n"
    msg += f"[Leer nota completa →]({url})"

    # Truncar si supera el límite
    if len(msg) > MAX_CHARS:
        msg = msg[:MAX_CHARS - 50] + f"...\n\n[Leer →]({url})"
    return msg


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log("=" * 55)
    log("noticias_bot.py — inicio")

    init_tabla()

    # Recolectar noticias de todas las fuentes
    todas = []
    for fuente in FUENTES:
        items = fetch_rss(fuente)
        log(f"  {fuente['nombre']}: {len(items)} items")
        todas.extend(items)

    log(f"Total items: {len(todas)}")

    # Filtrar por puntaje mínimo y no enviadas
    candidatas = [n for n in todas if n["puntaje"] >= 2 and not ya_enviada(n["url"], n["titulo"])]
    log(f"Candidatas (score>=2, no enviadas): {len(candidatas)}")

    if not candidatas:
        log("Sin noticias nuevas relevantes esta hora.")
        return

    # Ordenar por puntaje y tomar la mejor
    candidatas.sort(key=lambda x: x["puntaje"], reverse=True)
    elegida = candidatas[0]
    log(f"Elegida: [{elegida['puntaje']}pts] {elegida['fuente']} — {elegida['titulo'][:60]}")

    analisis = analizar(elegida)
    mensaje  = formatear_mensaje(elegida, analisis)

    ok = tg_send(mensaje)
    if ok:
        marcar_enviada(elegida["url"], elegida["titulo"], elegida["fuente"], elegida["puntaje"])
        log(f"✅ Enviada al canal: {elegida['titulo'][:60]}")
    else:
        log("❌ Error al enviar al canal")

    log("noticias_bot.py — OK")


if __name__ == "__main__":
    main()
