#!/usr/bin/env python3
"""
update_prices.py — cron diario (06:00 ART / 09:00 UTC)

1. Descarga todos los precios vigentes de datos.energia.gob.ar (CKAN)
2. Guarda/actualiza tabla `estaciones` en SQLite
3. Detecta cambios respecto a la snapshot anterior
4. Envía alertas Telegram a suscriptores activos
5. Registra resultado en meta tabla

Ejecutar manualmente:  python3 update_prices.py
Cron (como root):      0 9 * * * /var/www/tankear/venv/bin/python3 /var/www/tankear/api/update_prices.py >> /var/log/tankear-update.log 2>&1
"""

import json
import logging
import math
import os
import sys
import time
from datetime import datetime, date
from typing import Optional

import httpx

# ── Path setup ──────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db_sqlite as db

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s │ update_prices │ %(levelname)s │ %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("update_prices")

# ── Config ─────────────────────────────────────────────────────────────────────
CKAN_URL      = "https://datos.energia.gob.ar/api/3/action/datastore_search"
RESOURCE_ID   = "80ac25de-a44a-4445-9215-0cf3e4974c5e"
PAGE_SIZE     = 1000
BOT_TOKEN     = os.getenv("TELEGRAM_BOT_TOKEN", "8673787872:AAGuQs_0-geYNII9dcwWaEu5eZ7I0J6FNW8")
TG_API        = f"https://api.telegram.org/bot{BOT_TOKEN}"
CAMBIO_MIN_PCT = 2.0   # alertar solo si el cambio es >= 2%


# ── CKAN fetch ─────────────────────────────────────────────────────────────────

def _norm_prov(p: str) -> str:
    MAP = {
        "CIUDAD AUTÓNOMA DE BUENOS AIRES": "CABA",
        "CIUDAD AUTONOMA DE BUENOS AIRES": "CABA",
        "CIUDAD DE BUENOS AIRES": "CABA",
    }
    v = (p or "").strip().upper()
    return MAP.get(v, v)


def fetch_all_prices() -> list[dict]:
    """Descarga todas las estaciones de CKAN con paginación."""
    records = []
    offset  = 0
    total   = None

    with httpx.Client(timeout=30) as client:
        while True:
            params = {
                "resource_id": RESOURCE_ID,
                "limit":       PAGE_SIZE,
                "offset":      offset,
            }
            r = client.get(CKAN_URL, params=params)
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"CKAN error: {data.get('error')}")

            result = data["result"]
            if total is None:
                total = result.get("total", 0)
                log.info(f"Total registros CKAN: {total}")

            batch = result.get("records", [])
            if not batch:
                break

            for rec in batch:
                try:
                    precio_raw = rec.get("precio") or rec.get("precio_producto_empresa_provincia_agg")
                    records.append({
                        "empresa":             str(rec.get("empresa_bandera_nombre", "") or "").strip().upper(),
                        "marca":               str(rec.get("empresa_bandera_nombre", "") or "").strip().upper(),
                        "producto":            str(rec.get("producto_nombre", "") or "").strip(),
                        "precio":              float(precio_raw) if precio_raw else None,
                        "provincia":           _norm_prov(rec.get("provincia_nombre", "")),
                        "localidad":           str(rec.get("localidad_nombre", "") or "").strip().upper(),
                        "direccion":           str(rec.get("direccion", "") or "").strip(),
                        "latitud":             float(rec["latitud"])  if rec.get("latitud")  else None,
                        "longitud":            float(rec["longitud"]) if rec.get("longitud") else None,
                        "fecha_vigencia":      str(rec.get("fecha_vigencia", "") or ""),
                        "fecha_actualizacion": str(rec.get("fecha_actualizacion", "") or ""),
                    })
                except Exception as e:
                    log.debug(f"skip record: {e}")

            offset += PAGE_SIZE
            log.info(f"  {len(records)}/{total} descargados...")
            if len(batch) < PAGE_SIZE:
                break
            time.sleep(0.3)  # ser respetuosos con la API

    return records


# ── Detección de cambios ───────────────────────────────────────────────────────

def _snapshot_precios(records: list[dict]) -> dict:
    """
    Construye un dict {(provincia, producto): precio_promedio}
    para comparar entre runs.
    """
    from collections import defaultdict
    sums   = defaultdict(list)
    for r in records:
        if r.get("precio") and r.get("provincia") and r.get("producto"):
            sums[(r["provincia"], r["producto"])].append(r["precio"])
    return {k: sum(v) / len(v) for k, v in sums.items()}


def detect_changes(old_snap: dict, new_snap: dict) -> list[dict]:
    """
    Retorna lista de cambios con pct >= CAMBIO_MIN_PCT.
    """
    cambios = []
    for key, nuevo in new_snap.items():
        viejo = old_snap.get(key)
        if viejo and viejo > 0:
            pct = (nuevo - viejo) / viejo * 100
            if abs(pct) >= CAMBIO_MIN_PCT:
                prov, prod = key
                cambios.append({
                    "provincia": prov,
                    "producto":  prod,
                    "precio_antes": round(viejo, 2),
                    "precio_ahora": round(nuevo, 2),
                    "cambio_pct":   round(pct, 1),
                })
    cambios.sort(key=lambda x: abs(x["cambio_pct"]), reverse=True)
    return cambios


# ── Telegram notifications ─────────────────────────────────────────────────────

def _esc(text: str) -> str:
    """Escapa MarkdownV2."""
    for ch in r"\_*[]()~`>#+-=|{}.!":
        text = text.replace(ch, f"\\{ch}")
    return text


def _fmt_alerta(cambios: list[dict], provincia: str) -> str:
    """Formatea el mensaje de alerta para una provincia."""
    relevantes = [c for c in cambios if c["provincia"] == provincia][:5]
    if not relevantes:
        return ""

    hoy = datetime.now().strftime("%d/%m/%Y")
    lineas = [f"⛽ *Cambio de precios en {_esc(provincia)}* \\— {_esc(hoy)}\n"]
    for c in relevantes:
        flecha = "📈" if c["cambio_pct"] > 0 else "📉"
        signo  = "+" if c["cambio_pct"] > 0 else ""
        lineas.append(
            f"{flecha} {_esc(c['producto'])}\n"
            f"   `${c['precio_antes']:.0f}` → `${c['precio_ahora']:.0f}` "
            f"\\({_esc(signo + str(c['cambio_pct']))}%\\)"
        )
    lineas.append("\n[Ver precios en Tankear](https://tankear\\.com\\.ar)")
    return "\n".join(lineas)


def send_telegram(chat_id: int, text: str) -> bool:
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(f"{TG_API}/sendMessage", json={
                "chat_id":    chat_id,
                "text":       text,
                "parse_mode": "MarkdownV2",
                "disable_web_page_preview": True,
            })
            return r.status_code == 200
    except Exception as e:
        log.warning(f"send_telegram error chat_id={chat_id}: {e}")
        return False


def notify_subscribers(cambios: list[dict]) -> int:
    """Envía alertas a suscriptores activos. Retorna cantidad notificados."""
    if not cambios:
        log.info("Sin cambios significativos — no se envían alertas")
        return 0

    subs = db.get_telegram_subscribers(activo=True)
    if not subs:
        log.info("Sin suscriptores activos")
        return 0

    notificados = 0
    provincias_cambiadas = {c["provincia"] for c in cambios}

    for sub in subs:
        chat_id  = sub["chat_id"]
        provincia = (sub.get("provincia") or sub.get("zona") or "").upper().strip()

        # Si el sub tiene provincia y hay cambios ahí → alerta específica
        if provincia and provincia in provincias_cambiadas:
            texto = _fmt_alerta(cambios, provincia)
        # Si no tiene zona → mandar resumen de las provincias con más cambios
        elif not provincia:
            top_prov = list(provincias_cambiadas)[:2]
            partes = []
            for p in top_prov:
                t = _fmt_alerta(cambios, p)
                if t:
                    partes.append(t)
            texto = "\n\n".join(partes) if partes else ""
        else:
            continue  # tiene provincia pero no cambió

        if texto and send_telegram(chat_id, texto):
            notificados += 1
            log.info(f"  ✓ notificado chat_id={chat_id} (@{sub.get('username', '?')})")
        time.sleep(0.05)  # rate limit Telegram

    return notificados


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info(f"update_prices.py — {datetime.now().isoformat()}")
    db.init_db()

    # Leer snapshot anterior (de meta)
    conn = db._conn()
    row  = conn.execute("SELECT value FROM meta WHERE key='price_snapshot'").fetchone()
    conn.close()
    old_snap = json.loads(row[0]) if row else {}

    # Descargar precios frescos
    log.info("Descargando precios de CKAN...")
    try:
        records = fetch_all_prices()
    except Exception as e:
        log.error(f"Error descargando CKAN: {e}")
        sys.exit(1)

    log.info(f"Descargados {len(records)} registros")

    # Guardar en SQLite (reemplaza todo)
    log.info("Guardando en SQLite...")
    db.save_estaciones(records)

    # Nueva snapshot
    new_snap = _snapshot_precios(records)

    # Detectar cambios
    cambios = detect_changes(old_snap, new_snap)
    log.info(f"Cambios detectados: {len(cambios)} combinaciones provincia/producto")
    for c in cambios[:10]:
        log.info(f"  {c['provincia']} | {c['producto']}: {c['precio_antes']} → {c['precio_ahora']} ({c['cambio_pct']:+.1f}%)")

    # Notificar suscriptores
    n = notify_subscribers(cambios)
    log.info(f"Suscriptores notificados: {n}")

    # Guardar nueva snapshot en meta
    snap_str = json.dumps({f"{k[0]}||{k[1]}": v for k, v in new_snap.items()})
    conn = db._conn()
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('price_snapshot', ?)", (snap_str,))
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_update', ?)", (datetime.now().isoformat(),))
    conn.commit()
    conn.close()

    log.info(f"✅ update_prices.py completado — {len(records)} estaciones, {len(cambios)} cambios, {n} notificados")


if __name__ == "__main__":
    main()
