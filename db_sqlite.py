import sqlite3
import math
import os
from typing import Optional
from datetime import datetime, timedelta

DB_PATH = os.environ.get('DB_PATH', '/tmp/combustible.db')


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            ip          TEXT PRIMARY KEY,
            lat         REAL,
            lon         REAL,
            localidad   TEXT,
            provincia   TEXT,
            source      TEXT,
            updated_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS localidades (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            localidad     TEXT NOT NULL,
            provincia     TEXT NOT NULL,
            lat           REAL,
            lon           REAL,
            codigo_postal TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_loc_unique ON localidades(localidad, provincia);
        CREATE INDEX IF NOT EXISTS idx_loc_prov ON localidades(provincia);

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS estaciones (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa             TEXT,
            marca               TEXT,
            producto            TEXT,
            precio              REAL,
            provincia           TEXT,
            localidad           TEXT,
            direccion           TEXT,
            latitud             REAL,
            longitud            REAL,
            fecha_vigencia      TEXT,
            fecha_actualizacion TEXT,
            fecha_scraping      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_est_prov ON estaciones(provincia);
        CREATE INDEX IF NOT EXISTS idx_est_loc  ON estaciones(localidad);
        CREATE INDEX IF NOT EXISTS idx_est_prod ON estaciones(producto);

        CREATE TABLE IF NOT EXISTS telegram_subscribers (
            chat_id     INTEGER PRIMARY KEY,
            username    TEXT,
            first_name  TEXT,
            zona        TEXT,
            provincia   TEXT,
            contacto    TEXT,
            activo      INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS telegram_messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id     INTEGER,
            username    TEXT,
            first_name  TEXT,
            text        TEXT,
            intencion   TEXT,
            score_lead  INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tgmsg_chat ON telegram_messages(chat_id);
        CREATE INDEX IF NOT EXISTS idx_tgmsg_int  ON telegram_messages(intencion);
    """)
    conn.commit()
    conn.close()


# ─── Sessions ────────────────────────────────────────────────────────────────

def save_session(ip: str, lat: Optional[float], lon: Optional[float],
                 localidad: Optional[str], provincia: Optional[str], source: str):
    conn = _conn()
    conn.execute("""
        INSERT OR REPLACE INTO user_sessions (ip, lat, lon, localidad, provincia, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    """, (ip, lat, lon, localidad, provincia, source))
    conn.commit()
    conn.close()


def get_session(ip: str, max_age_hours: int = 1) -> Optional[dict]:
    conn = _conn()
    row = conn.execute("""
        SELECT * FROM user_sessions
        WHERE ip = ? AND updated_at >= datetime('now', ?)
    """, (ip, f'-{max_age_hours} hours')).fetchone()
    conn.close()
    return dict(row) if row else None


# ─── Localidades ─────────────────────────────────────────────────────────────

def seed_localidades(records: list):
    """Inserta localidades en bloque (INSERT OR IGNORE para no duplicar)."""
    conn = _conn()
    conn.executemany("""
        INSERT OR IGNORE INTO localidades (localidad, provincia, lat, lon, codigo_postal)
        VALUES (:localidad, :provincia, :lat, :lon, :codigo_postal)
    """, records)
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('loc_seeded_at', datetime('now'))")
    conn.commit()
    conn.close()


def localidades_seeded() -> bool:
    """Devuelve True si ya se sembró en las últimas 24 horas."""
    conn = _conn()
    row = conn.execute("SELECT value FROM meta WHERE key = 'loc_seeded_at'").fetchone()
    conn.close()
    if not row:
        return False
    try:
        seeded_at = datetime.fromisoformat(row[0])
        return (datetime.utcnow() - seeded_at) < timedelta(hours=24)
    except Exception:
        return False


def get_localidad_coords(localidad: str, provincia: str) -> Optional[dict]:
    conn = _conn()
    row = conn.execute("""
        SELECT lat, lon, codigo_postal FROM localidades
        WHERE localidad = ? AND provincia = ?
        LIMIT 1
    """, (localidad.upper().strip(), provincia.upper().strip())).fetchone()
    conn.close()
    return dict(row) if row else None


def query_localidades(provincia: Optional[str] = None) -> list:
    conn = _conn()
    if provincia:
        rows = conn.execute(
            "SELECT localidad, provincia, lat, lon, codigo_postal FROM localidades WHERE provincia = ? ORDER BY localidad",
            (provincia.upper().strip(),)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT localidad, provincia, lat, lon, codigo_postal FROM localidades ORDER BY provincia, localidad"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def query_provincias() -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT DISTINCT provincia FROM localidades ORDER BY provincia"
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def localidades_count() -> int:
    conn = _conn()
    row = conn.execute("SELECT COUNT(*) FROM localidades").fetchone()
    conn.close()
    return row[0] if row else 0


# ─── Estaciones (cache de precios de combustible) ────────────────────────────

def estaciones_count() -> int:
    """Devuelve la cantidad de estaciones cacheadas en SQLite."""
    conn = _conn()
    row = conn.execute("SELECT COUNT(*) FROM estaciones").fetchone()
    conn.close()
    return row[0] if row else 0


def estaciones_age_hours() -> Optional[float]:
    """Horas desde la última vez que se actualizó el cache de estaciones."""
    conn = _conn()
    row = conn.execute(
        "SELECT MAX(fecha_scraping) FROM estaciones"
    ).fetchone()
    conn.close()
    if not row or not row[0]:
        return None
    try:
        last = datetime.fromisoformat(row[0])
        return (datetime.utcnow() - last).total_seconds() / 3600
    except Exception:
        return None


def get_estaciones(provincia=None, localidad=None, producto=None, limit=500) -> list:
    """Lee estaciones del cache SQLite con filtros opcionales."""
    conn = _conn()
    q = "SELECT * FROM estaciones WHERE 1=1"
    params = []
    if provincia:
        q += " AND UPPER(provincia) = ?"
        params.append(provincia.upper().strip())
    if localidad:
        q += " AND UPPER(localidad) = ?"
        params.append(localidad.upper().strip())
    if producto:
        q += " AND UPPER(producto) LIKE ?"
        params.append(f"%{producto.upper().strip()}%")
    q += " ORDER BY fecha_vigencia DESC"
    if limit:
        q += f" LIMIT {int(limit)}"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Telegram subscribers ────────────────────────────────────────────────────

def save_telegram_subscriber(chat_id: int, username: str = "", first_name: str = "",
                              zona: str = "", provincia: str = "", contacto: str = ""):
    conn = _conn()
    conn.execute("""
        INSERT INTO telegram_subscribers (chat_id, username, first_name, zona, provincia, contacto, activo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(chat_id) DO UPDATE SET
            username=excluded.username, first_name=excluded.first_name,
            zona=CASE WHEN excluded.zona != '' THEN excluded.zona ELSE zona END,
            provincia=CASE WHEN excluded.provincia != '' THEN excluded.provincia ELSE provincia END,
            contacto=CASE WHEN excluded.contacto != '' THEN excluded.contacto ELSE contacto END,
            activo=1, updated_at=datetime('now')
    """, (chat_id, username or "", first_name or "", zona or "", provincia or "", contacto or ""))
    conn.commit()
    conn.close()


def get_telegram_subscribers(activo: bool = True) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM telegram_subscribers WHERE activo = ?",
        (1 if activo else 0,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_telegram_subscribers() -> int:
    conn = _conn()
    row = conn.execute("SELECT COUNT(*) FROM telegram_subscribers WHERE activo=1").fetchone()
    conn.close()
    return row[0] if row else 0


# ─── Telegram message log ─────────────────────────────────────────────────────

def log_telegram_message(chat_id: int, username: str, first_name: str,
                          text: str, intencion: str, score_lead: int = 0):
    conn = _conn()
    conn.execute("""
        INSERT INTO telegram_messages (chat_id, username, first_name, text, intencion, score_lead)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (chat_id, username or "", first_name or "", text or "", intencion or "", score_lead))
    conn.commit()
    conn.close()


def get_telegram_messages(limit: int = 200, intencion: str = None) -> list:
    conn = _conn()
    if intencion:
        rows = conn.execute(
            "SELECT * FROM telegram_messages WHERE intencion=? ORDER BY created_at DESC LIMIT ?",
            (intencion, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM telegram_messages ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_telegram_stats() -> dict:
    conn = _conn()
    total = conn.execute("SELECT COUNT(*) FROM telegram_messages").fetchone()[0]
    by_intent = conn.execute("""
        SELECT intencion, COUNT(*) as n FROM telegram_messages
        GROUP BY intencion ORDER BY n DESC
    """).fetchall()
    hot_leads = conn.execute("""
        SELECT COUNT(DISTINCT chat_id) FROM telegram_messages WHERE score_lead >= 2
    """).fetchone()[0]
    conn.close()
    return {
        "total_messages": total,
        "hot_leads": hot_leads,
        "by_intent": [dict(r) for r in by_intent],
    }


def save_estaciones(records: list):
    """Guarda (reemplaza) el cache completo de estaciones."""
    if not records:
        return
    conn = _conn()
    conn.execute("DELETE FROM estaciones")
    conn.executemany("""
        INSERT INTO estaciones
            (empresa, marca, producto, precio, provincia, localidad,
             direccion, latitud, longitud, fecha_vigencia, fecha_actualizacion)
        VALUES
            (:empresa, :marca, :producto, :precio, :provincia, :localidad,
             :direccion, :latitud, :longitud, :fecha_vigencia, :fecha_actualizacion)
    """, records)
    conn.commit()
    conn.close()


def _haversine_simple(lat1, lon1, lat2, lon2) -> float:
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def localidad_mas_cercana(lat: float, lon: float, provincia: str = None) -> Optional[dict]:
    """
    Devuelve la localidad del dataset (SQLite) más cercana a las coordenadas.
    Útil cuando Nominatim devuelve un barrio que no existe en el dataset.
    """
    conn = _conn()
    q = "SELECT localidad, provincia, lat, lon FROM localidades WHERE lat IS NOT NULL AND lon IS NOT NULL"
    params = []
    if provincia:
        q += " AND provincia = ?"
        params.append(provincia.upper().strip())
    rows = conn.execute(q, params).fetchall()
    conn.close()

    if not rows:
        return None

    best, best_dist = None, float('inf')
    for row in rows:
        try:
            d = _haversine_simple(lat, lon, row['lat'], row['lon'])
        except Exception:
            continue
        if d < best_dist:
            best_dist = d
            best = {"localidad": row['localidad'], "provincia": row['provincia'],
                    "lat": row['lat'], "lon": row['lon'], "distancia_km": round(d, 1)}
    return best
