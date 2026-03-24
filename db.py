import sqlite3
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
