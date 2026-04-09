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


# ─── Estaciones ───────────────────────────────────────────────────────────────

# ─── Estaciones cache ────────────────────────────────────────────────────────

def estaciones_count() -> int:
    """Cuántas estaciones hay en el cache local."""
    conn = _conn()
    row = conn.execute("SELECT COUNT(*) FROM estaciones").fetchone()
    conn.close()
    return row[0] if row else 0


def estaciones_age_hours() -> Optional[float]:
    """Horas desde el último scraping. None si no hay datos."""
    conn = _conn()
    row = conn.execute(
        "SELECT MAX(fecha_scraping) FROM estaciones"
    ).fetchone()
    conn.close()
    if not row or not row[0]:
        return None
    try:
        ts = datetime.fromisoformat(row[0])
        return (datetime.utcnow() - ts).total_seconds() / 3600
    except Exception:
        return None


def get_estaciones(provincia: Optional[str] = None,
                   localidad: Optional[str] = None,
                   producto: Optional[str] = None,
                   limit: int = 5000,
                   solo_recientes: bool = False) -> list:
    """
    Lee estaciones del cache con filtros opcionales.
    solo_recientes=True → solo registros con fecha_vigencia de las últimas 72h
                          (para mostrar precios confiables).
    solo_recientes=False → todos los registros, incluyendo los viejos
                           (para mostrar ubicaciones en el mapa).
    """
    conn = _conn()
    q = """
        SELECT empresa, bandera, cuit, direccion, localidad, provincia, region,
               latitud, longitud, producto, precio, tipohorario, fecha_vigencia
        FROM estaciones WHERE 1=1
    """
    params: list = []
    if solo_recientes:
        q += """ AND fecha_vigencia >= datetime(
                    (SELECT MAX(fecha_vigencia) FROM estaciones), '-72 hours')"""
    if provincia:
        q += " AND UPPER(provincia) = ?"
        params.append(provincia.upper())
    if localidad:
        q += " AND UPPER(localidad) = ?"
        params.append(localidad.upper())
    if producto:
        q += " AND LOWER(producto) LIKE ?"
        params.append(f"%{producto.lower()}%")
    q += " LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_estaciones(records: list) -> int:
    """
    Reemplaza por completo la tabla estaciones con los registros del scraper.
    Columnas esperadas en cada dict:
      empresa, bandera, cuit, direccion, localidad, provincia, region,
      latitud, longitud, producto, precio, tipohorario, fecha_vigencia
    Retorna la cantidad de filas insertadas.
    """
    conn = _conn()
    conn.execute("DELETE FROM estaciones")
    conn.executemany("""
        INSERT INTO estaciones
            (empresa, bandera, cuit, direccion, localidad, provincia, region,
             latitud, longitud, producto, precio, tipohorario, fecha_vigencia, fecha_scraping)
        VALUES
            (:empresa, :bandera, :cuit, :direccion, :localidad, :provincia, :region,
             :latitud, :longitud, :producto, :precio, :tipohorario, :fecha_vigencia,
             datetime('now'))
    """, records)
    n = conn.execute("SELECT changes()").fetchone()[0]
    conn.commit()
    conn.close()
    return n


# ─── Historial de precios ─────────────────────────────────────────────────────

def get_price_history(provincia: Optional[str] = None,
                      localidad: Optional[str] = None,
                      producto: Optional[str] = None,
                      days: int = 90) -> list:
    """Serie temporal de precio promedio por día desde precios_historico."""
    conn = _conn()
    q = """
        SELECT fecha_snapshot AS fecha, producto, AVG(precio) AS precio_avg, COUNT(*) AS n
        FROM precios_historico
        WHERE fecha_snapshot >= date('now', ?)
          AND precio >= 100
    """
    params: list = [f"-{days} days"]
    if provincia:
        q += " AND UPPER(provincia) = ?"
        params.append(provincia.upper())
    if localidad:
        q += " AND UPPER(localidad) = ?"
        params.append(localidad.upper())
    if producto:
        q += " AND LOWER(producto) LIKE ?"
        params.append(f"%{producto.lower()}%")
    q += " GROUP BY fecha_snapshot, producto ORDER BY fecha_snapshot ASC"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Comunidad — reportes de estaciones ──────────────────────────────────────

def has_recent_reporte(ip: str, empresa: str, direccion: str,
                       hours: int = 24) -> bool:
    conn = _conn()
    row = conn.execute("""
        SELECT COUNT(*) FROM comunidad_reportes
        WHERE ip_reporter = ? AND LOWER(empresa) = LOWER(?)
          AND LOWER(direccion) = LOWER(?)
          AND created_at >= datetime('now', ?)
    """, (ip, empresa, direccion, f"-{hours} hours")).fetchone()
    conn.close()
    return (row[0] if row else 0) > 0


def create_reporte_estacion(data: dict) -> int:
    conn = _conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comunidad_reportes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa      TEXT,
            bandera      TEXT,
            direccion    TEXT,
            localidad    TEXT,
            provincia    TEXT,
            tipo         TEXT,
            comentario   TEXT,
            ip_reporter  TEXT,
            activo       INTEGER DEFAULT 1,
            created_at   TEXT DEFAULT (datetime('now'))
        )
    """)
    cur = conn.execute("""
        INSERT INTO comunidad_reportes
            (empresa, bandera, direccion, localidad, provincia, tipo, comentario, ip_reporter)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.get("empresa"), data.get("bandera"), data.get("direccion"),
          data.get("localidad"), data.get("provincia"), data.get("tipo"),
          data.get("comentario"), data.get("ip_reporter")))
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def get_reportes_estacion(empresa: Optional[str] = None,
                          direccion: Optional[str] = None,
                          provincia: Optional[str] = None,
                          limit: int = 50) -> list:
    conn = _conn()
    try:
        q = "SELECT * FROM comunidad_reportes WHERE activo=1"
        params: list = []
        if empresa:
            q += " AND LOWER(empresa) = LOWER(?)"
            params.append(empresa)
        if direccion:
            q += " AND LOWER(direccion) = LOWER(?)"
            params.append(direccion)
        if provincia:
            q += " AND UPPER(provincia) = ?"
            params.append(provincia.upper())
        q += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(q, params).fetchall()
    except Exception:
        rows = []
    conn.close()
    return [dict(r) for r in rows]


def count_reportes_activos(empresa: str, direccion: str) -> int:
    conn = _conn()
    try:
        row = conn.execute("""
            SELECT COUNT(*) FROM comunidad_reportes
            WHERE activo=1 AND LOWER(empresa)=LOWER(?) AND LOWER(direccion)=LOWER(?)
        """, (empresa, direccion)).fetchone()
    except Exception:
        row = None
    conn.close()
    return row[0] if row else 0


# ─── Comunidad — precios reportados ──────────────────────────────────────────

def has_recent_precio(ip: str, empresa: str, direccion: str,
                      producto: str, hours: int = 24) -> bool:
    conn = _conn()
    try:
        row = conn.execute("""
            SELECT COUNT(*) FROM comunidad_precios
            WHERE ip_reporter = ? AND LOWER(empresa)=LOWER(?)
              AND LOWER(direccion)=LOWER(?) AND LOWER(producto)=LOWER(?)
              AND created_at >= datetime('now', ?)
        """, (ip, empresa, direccion, producto, f"-{hours} hours")).fetchone()
    except Exception:
        row = None
    conn.close()
    return (row[0] if row else 0) > 0


def create_precio_comunidad(data: dict) -> int:
    conn = _conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comunidad_precios (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa      TEXT,
            bandera      TEXT,
            direccion    TEXT,
            localidad    TEXT,
            provincia    TEXT,
            producto     TEXT,
            precio       REAL,
            ip_reporter  TEXT,
            created_at   TEXT DEFAULT (datetime('now'))
        )
    """)
    cur = conn.execute("""
        INSERT INTO comunidad_precios
            (empresa, bandera, direccion, localidad, provincia, producto, precio, ip_reporter)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.get("empresa"), data.get("bandera"), data.get("direccion"),
          data.get("localidad"), data.get("provincia"), data.get("producto"),
          data.get("precio"), data.get("ip_reporter")))
    conn.commit()
    cid = cur.lastrowid
    conn.close()
    return cid


def get_precios_comunidad(empresa: Optional[str] = None,
                          direccion: Optional[str] = None,
                          provincia: Optional[str] = None,
                          producto: Optional[str] = None,
                          days: int = 30,
                          limit: int = 50) -> list:
    conn = _conn()
    try:
        q = f"SELECT * FROM comunidad_precios WHERE created_at >= datetime('now', '-{days} days')"
        params: list = []
        if empresa:
            q += " AND LOWER(empresa)=LOWER(?)"
            params.append(empresa)
        if direccion:
            q += " AND LOWER(direccion)=LOWER(?)"
            params.append(direccion)
        if provincia:
            q += " AND UPPER(provincia)=?"
            params.append(provincia.upper())
        if producto:
            q += " AND LOWER(producto) LIKE ?"
            params.append(f"%{producto.lower()}%")
        q += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(q, params).fetchall()
    except Exception:
        rows = []
    conn.close()
    return [dict(r) for r in rows]


# ─── Precios estimados ────────────────────────────────────────────────────────

def get_precios_estimados(provincia: Optional[str] = None,
                          localidad: Optional[str] = None,
                          producto: Optional[str] = None,
                          confianza_min: float = 0.3,
                          limit: int = 100) -> list:
    """Precios calculados por precio_ciencia.py (IDW/tendencia/media regional)."""
    conn = _conn()
    try:
        q = "SELECT * FROM precios_estimados WHERE confianza >= ?"
        params: list = [confianza_min]
        if provincia:
            q += " AND UPPER(provincia)=?"
            params.append(provincia.upper())
        if localidad:
            q += " AND UPPER(localidad)=?"
            params.append(localidad.upper())
        if producto:
            q += " AND LOWER(producto) LIKE ?"
            params.append(f"%{producto.lower()}%")
        q += " ORDER BY confianza DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(q, params).fetchall()
    except Exception:
        rows = []
    conn.close()
    return [dict(r) for r in rows]


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
