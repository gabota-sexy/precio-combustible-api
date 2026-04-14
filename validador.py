#!/usr/bin/env python3
"""
validador.py — Tankear
Valida la calidad del scraper después de cada corrida.
Corre 15 minutos después del scraper (09:15 UTC) via cron.
Si detecta algún problema, alerta al admin por Telegram.

Checks:
  1. Cantidad de estaciones >= MIN_ESTACIONES
  2. fecha_vigencia reciente (máx MAX_EDAD_HORAS horas de antigüedad)
  3. Precios promedio en rango razonable ($MIN_PRECIO - $MAX_PRECIO)
  4. El scraper corrió hoy (fecha_scraping == hoy)
  5. Diferencia de precios vs ayer dentro de rango razonable
"""

import os
import sqlite3
import requests
from datetime import datetime, date, timedelta

DB_PATH   = os.environ.get("DB_PATH",            "/var/www/tankear/data/tankear.db")
TG_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID  = 1209008738

# Umbrales de calidad
MIN_ESTACIONES  = 5_000    # mínimo de registros esperados
MAX_EDAD_HORAS  = 96       # máximo de horas desde la fecha_vigencia más reciente
MIN_PRECIO      = 1_000.0  # precio mínimo razonable (nafta/gasoil, $/L)
MAX_PRECIO      = 10_000.0 # precio máximo razonable ($/L)
MAX_CAMBIO_DIA  = 35.0     # % máximo de cambio diario creíble (Argentina puede tener ajustes grandes)
# GNC se vende por m³ y tiene precios menores a los líquidos — no aplicar MIN_PRECIO
PRODUCTOS_SIN_MIN = {"GNC", "gnc"}
# Días de "gracia" tras cambio de método de snapshot (evita falsos positivos el primer día)
DIAS_GRACIA_SNAPSHOT = 2


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def tg_send(chat_id, text):
    if not TG_TOKEN:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text,
                  "parse_mode": "Markdown", "disable_web_page_preview": True},
            timeout=15
        )
    except Exception as e:
        log(f"TG error: {e}")


def check_cantidad(conn) -> tuple[bool, str]:
    n = conn.execute("SELECT COUNT(*) FROM estaciones").fetchone()[0]
    log(f"  Estaciones en DB: {n:,}")
    if n < MIN_ESTACIONES:
        return False, f"❌ Solo {n:,} estaciones guardadas (mínimo esperado: {MIN_ESTACIONES:,})"
    return True, f"✅ Estaciones: {n:,}"


def check_frescura(conn) -> tuple[bool, str]:
    row = conn.execute("SELECT MAX(fecha_vigencia) FROM estaciones").fetchone()
    max_fv = row[0] if row else None
    if not max_fv:
        return False, "❌ No hay fecha_vigencia en la tabla"
    try:
        ts = datetime.fromisoformat(max_fv.replace("T", " ").split("+")[0])
        edad_h = (datetime.utcnow() - ts).total_seconds() / 3600
        log(f"  Fecha_vigencia más reciente: {max_fv} ({edad_h:.1f}h atrás)")
        if edad_h > MAX_EDAD_HORAS:
            return False, (f"❌ Datos desactualizados: la fecha_vigencia más reciente "
                           f"tiene {edad_h:.0f}h (máximo permitido: {MAX_EDAD_HORAS}h)")
        return True, f"✅ Frescura: {edad_h:.1f}h"
    except Exception as e:
        return False, f"❌ No se pudo parsear fecha_vigencia: {e}"


def check_precios(conn) -> tuple[bool, str]:
    rows = conn.execute("""
        SELECT producto, AVG(precio) avg_p, MIN(precio) min_p, MAX(precio) max_p
        FROM estaciones
        WHERE fecha_vigencia >= datetime(
            (SELECT MAX(fecha_vigencia) FROM estaciones), '-72 hours')
          AND precio >= 500
        GROUP BY producto HAVING COUNT(*) >= 10
    """).fetchall()

    if not rows:
        return False, "❌ Sin datos de precios recientes para validar"

    problemas = []
    for r in rows:
        # GNC se mide en $/m³, no $/L — no aplicar umbral mínimo de líquidos
        if r["producto"] not in PRODUCTOS_SIN_MIN and r["avg_p"] < MIN_PRECIO:
            problemas.append(f"{r['producto']}: promedio ${r['avg_p']:.0f} (muy bajo)")
        if r["avg_p"] > MAX_PRECIO:
            problemas.append(f"{r['producto']}: promedio ${r['avg_p']:.0f} (muy alto)")

    if problemas:
        return False, "❌ Precios fuera de rango:\n" + "\n".join(f"  • {p}" for p in problemas)

    resumen = ", ".join(
        f"{r['producto'][:8]}: ${r['avg_p']:.0f}"
        for r in rows[:3]
    )
    return True, f"✅ Precios OK ({resumen}...)"


def check_scraping_hoy(conn) -> tuple[bool, str]:
    hoy = date.today().isoformat()
    row = conn.execute(
        "SELECT MAX(fecha_scraping) FROM estaciones WHERE fecha_scraping >= ?",
        (hoy,)
    ).fetchone()
    if not row or not row[0]:
        return False, f"❌ El scraper NO corrió hoy ({hoy})"
    return True, f"✅ Scraper corrió hoy: {row[0]}"


def check_variacion_diaria(conn) -> tuple[bool, str]:
    """Compara el promedio de hoy vs ayer en precios_historico."""
    hoy  = date.today().isoformat()
    ayer = (date.today() - timedelta(days=1)).isoformat()

    rows_hoy = conn.execute("""
        SELECT producto, AVG(precio) avg_p FROM precios_historico
        WHERE fecha_snapshot=? AND precio >= 500
        GROUP BY producto HAVING COUNT(*) >= 5
    """, (hoy,)).fetchall()

    rows_ant = conn.execute("""
        SELECT producto, AVG(precio) avg_p FROM precios_historico
        WHERE fecha_snapshot=? AND precio >= 500
        GROUP BY producto HAVING COUNT(*) >= 5
    """, (ayer,)).fetchall()

    if not rows_hoy or not rows_ant:
        log("  Sin snapshots comparables aún — skip check variación")
        return True, "⏭️ Sin historial previo para comparar variación"

    precios_ant = {r["producto"]: r["avg_p"] for r in rows_ant}
    sospechosos = []
    for r in rows_hoy:
        pa = precios_ant.get(r["producto"])
        if not pa:
            continue
        dp = abs((r["avg_p"] - pa) / pa * 100)
        if dp > MAX_CAMBIO_DIA:
            sospechosos.append(
                f"{r['producto'][:12]}: ${pa:.0f}→${r['avg_p']:.0f} ({dp:+.1f}%)"
            )

    if sospechosos:
        # Verificar cuántos días de historial hay — si es muy poco, puede ser
        # artefacto del cambio de método de snapshot (primer día con filtro 72h)
        total_dias = conn.execute(
            "SELECT COUNT(DISTINCT fecha_snapshot) FROM precios_historico"
        ).fetchone()[0]
        if total_dias <= DIAS_GRACIA_SNAPSHOT:
            return True, ("⏭️ Variación alta detectada pero dentro del período de "
                          f"gracia ({total_dias} días de historial — puede ser artefacto del método nuevo)")
        return False, ("⚠️ Variación sospechosa vs ayer (posible error de datos):\n"
                       + "\n".join(f"  • {s}" for s in sospechosos))
    return True, "✅ Variación diaria dentro de rango normal"


def main():
    log("=" * 55)
    log("validador.py — inicio")

    conn = _conn()
    checks = [
        ("cantidad",      check_cantidad(conn)),
        ("frescura",      check_frescura(conn)),
        ("precios",       check_precios(conn)),
        ("scraping_hoy",  check_scraping_hoy(conn)),
        ("variacion",     check_variacion_diaria(conn)),
    ]
    conn.close()

    ok_total = all(ok for _, (ok, _) in checks)
    lineas_ok    = [msg for _, (ok, msg) in checks if ok]
    lineas_error = [msg for _, (ok, msg) in checks if not ok]

    log(f"Resultado: {'OK ✅' if ok_total else 'ERRORES ❌'}")
    for _, (ok, msg) in checks:
        log(f"  {'✅' if ok else '❌'} {msg[:80]}")

    # Siempre mandar reporte al admin
    hoy = datetime.now().strftime("%d/%m/%Y %H:%M UTC")
    if ok_total:
        msg = f"✅ *Validador Tankear — {hoy}*\n\nTodo OK:\n" + "\n".join(lineas_ok)
    else:
        msg = (
            f"🚨 *Validador Tankear — {hoy}*\n\n"
            f"*Problemas detectados:*\n" + "\n".join(lineas_error)
        )
        if lineas_ok:
            msg += "\n\n*OK:*\n" + "\n".join(lineas_ok)

    tg_send(ADMIN_ID, msg)
    log("validador.py — OK")


if __name__ == "__main__":
    main()
