from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import requests
import pandas as pd
import numpy as np
import json
import os
import threading
import uvicorn
from typing import Optional
from datetime import datetime, date

import db
import geo

# --- CONFIG ---
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
_DEFAULT_CONFIG = {
    "api": {
        "resource_id": "80ac25de-a44a-4445-9215-090cf55cfda5",
        "base_url": "http://datos.energia.gob.ar/api/3/action/datastore_search",
        "usar_datos_locales": False,
        "limit": 1000,
        "timeout": 60,
        "filtros": {}
    },
    "datos_locales": {"estaciones": []},
    "busqueda": {}
}
try:
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
except FileNotFoundError:
    config = _DEFAULT_CONFIG

API_CONFIG = config['api']
DATOS_LOCALES_CONFIG = config['datos_locales']
RESOURCE_ID = API_CONFIG['resource_id']
API_URL = API_CONFIG['base_url']
RESOURCE_SHOW_URL = "http://datos.energia.gob.ar/api/3/action/resource_show"

# El dataset de datos.energia.gob.ar usa "CAPITAL FEDERAL" para CABA.
# Este dict traduce nuestros nombres normalizados al nombre del dataset.
CKAN_PROV_MAP = {
    "CABA": "CAPITAL FEDERAL",
}

# --- APP ---
app = FastAPI(
    title="API Precios Combustible Argentina",
    description="Consulta precios de combustible en estaciones de Argentina. "
                "Incluye búsqueda por GPS, IP y zona administrativa.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# --- STARTUP ---

def _seed_localidades():
    """Descarga localidades únicas del dataset y las guarda en SQLite."""
    try:
        # Sin 'fields': datos.energia.gob.ar devuelve 409 con ese parámetro
        params = {
            "resource_id": RESOURCE_ID,
            "limit": 2000,
        }
        headers = {'User-Agent': 'Mozilla/5.0'}
        r = requests.get(API_URL, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        data = r.json()
        if not data.get('success'):
            return

        records = data.get('result', {}).get('records', [])
        seen = set()
        to_insert = []
        for rec in records:
            loc = (rec.get('localidad', '') or '').strip().upper()
            prov = (rec.get('provincia', '') or '').strip().upper()
            if not loc or not prov:
                continue
            key = (loc, prov)
            if key in seen:
                continue
            seen.add(key)
            try:
                lat = float(rec.get('latitud') or 0) or None
                lon = float(rec.get('longitud') or 0) or None
            except (ValueError, TypeError):
                lat = lon = None
            to_insert.append({
                "localidad": loc,
                "provincia": prov,
                "lat": lat,
                "lon": lon,
                "codigo_postal": (rec.get('codigo_postal', '') or '').strip(),
            })

        if to_insert:
            db.seed_localidades(to_insert)
            print(f"[DB] Localidades sembradas: {len(to_insert)}")
    except Exception as e:
        print(f"[DB] Error al sembrar localidades: {e}")


@app.on_event("startup")
async def startup():
    if os.environ.get("DB_BACKEND") == "dynamo":
        # DynamoDB: tablas creadas por CloudFormation, scraper Lambda siembra datos.
        count = db.localidades_count()
        print(f"[STARTUP] Backend DynamoDB. Localidades en tabla: ~{count}")
        return
    # SQLite (Render / local)
    db.init_db()
    if not db.localidades_seeded():
        threading.Thread(target=_seed_localidades, daemon=True).start()
    else:
        print(f"[DB] Localidades ya cacheadas ({db.localidades_count()} registros)")


# --- HELPERS ---

def haversine(lat1, lon1, lat2, lon2):
    if pd.isna(lat1) or pd.isna(lon1) or pd.isna(lat2) or pd.isna(lon2):
        return np.nan
    R = 6371
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi/2)**2 + np.cos(phi1)*np.cos(phi2)*np.sin(dlambda/2)**2
    return R * 2 * np.arcsin(np.sqrt(a))


def get_client_ip(request: Request) -> Optional[str]:
    """Extrae la IP real del cliente (respeta proxies de Render/Cloudflare)."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _records_to_df(records: list) -> pd.DataFrame:
    """Convierte lista de dicts (DynamoDB cache) al mismo DataFrame que devuelve CKAN."""
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    # Renombrar latitud/longitud si vienen como lat/lon (no aplica aquí, pero por robustez)
    if 'precio' in df.columns:
        df['precio'] = pd.to_numeric(df['precio'], errors='coerce')
    if 'latitud' in df.columns:
        df['latitud'] = pd.to_numeric(df['latitud'], errors='coerce')
    if 'longitud' in df.columns:
        df['longitud'] = pd.to_numeric(df['longitud'], errors='coerce')
    if 'fecha_vigencia' in df.columns:
        df['fecha_vigencia'] = pd.to_datetime(df['fecha_vigencia'], errors='coerce', utc=True).dt.tz_localize(None)
    if 'provincia' in df.columns:
        df['provincia'] = df['provincia'].replace("CAPITAL FEDERAL", "CABA")
    if 'empresabandera' in df.columns:
        df = df.rename(columns={'empresabandera': 'bandera'})
    return df


def obtener_datos(provincia: str, localidad: Optional[str], limit: int) -> pd.DataFrame:
    if API_CONFIG.get('usar_datos_locales'):
        return pd.DataFrame(DATOS_LOCALES_CONFIG['estaciones'])

    # ── DynamoDB cache (solo cuando hay provincia+localidad explícitos) ──────
    if os.environ.get("DB_BACKEND") == "dynamo" and provincia and localidad:
        cached = db.get_estaciones(provincia, localidad)
        if cached:
            print(f"[CACHE] HIT {provincia}#{localidad} — {len(cached)} registros")
            return _records_to_df(cached)
        print(f"[CACHE] MISS {provincia}#{localidad} — consultando CKAN")

    filtros = {}
    if provincia:
        prov_upper = provincia.upper()
        filtros["provincia"] = CKAN_PROV_MAP.get(prov_upper, prov_upper)
    if localidad:
        filtros["localidad"] = localidad.upper()

    params = {
        "resource_id": RESOURCE_ID,
        "limit": limit,
        "filters": json.dumps(filtros)
    }
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

    try:
        r = requests.get(API_URL, params=params, headers=headers, timeout=API_CONFIG['timeout'])
        r.raise_for_status()
        data = r.json()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timeout al consultar datos.gob.ar")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=502, detail="No se puede alcanzar datos.gob.ar")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not data.get('success'):
        raise HTTPException(status_code=502, detail=data.get('error', {}).get('__all__', 'Error de API externa'))

    records = data['result'].get('records', [])
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)

    if 'precio' in df.columns:
        df['precio'] = pd.to_numeric(df['precio'].astype(str).str.replace(',', '.'), errors='coerce')
    if 'latitud' in df.columns:
        df['latitud'] = pd.to_numeric(df['latitud'], errors='coerce')
    if 'longitud' in df.columns:
        df['longitud'] = pd.to_numeric(df['longitud'], errors='coerce')
    if 'fecha_vigencia' in df.columns:
        df['fecha_vigencia'] = pd.to_datetime(df['fecha_vigencia'], errors='coerce', utc=True).dt.tz_localize(None)

    # Deduplicar: el dataset fuente tiene registros repetidos.
    # Mantenemos el más reciente por empresa + dirección + producto.
    dedup_cols = [c for c in ['empresa', 'direccion', 'producto'] if c in df.columns]
    if dedup_cols and 'fecha_vigencia' in df.columns:
        df = df.sort_values('fecha_vigencia', ascending=False).drop_duplicates(subset=dedup_cols)
    elif dedup_cols:
        df = df.drop_duplicates(subset=dedup_cols)

    # Normalizar "CAPITAL FEDERAL" → "CABA" en los resultados
    if 'provincia' in df.columns:
        df['provincia'] = df['provincia'].replace("CAPITAL FEDERAL", "CABA")

    # Renombrar empresabandera → bandera (nombre legible para el frontend: YPF, Shell, Axion…)
    if 'empresabandera' in df.columns:
        df = df.rename(columns={'empresabandera': 'bandera'})

    return df


def filtrar_por_fecha(df: pd.DataFrame, fecha_desde: Optional[date]) -> pd.DataFrame:
    if fecha_desde is None or 'fecha_vigencia' not in df.columns:
        return df
    cutoff = pd.Timestamp(fecha_desde)
    return df[df['fecha_vigencia'] >= cutoff]


def obtener_last_modified() -> Optional[str]:
    try:
        r = requests.get(RESOURCE_SHOW_URL, params={"id": RESOURCE_ID}, timeout=10)
        r.raise_for_status()
        return r.json().get('result', {}).get('last_modified')
    except Exception:
        return None


def df_a_lista(df: pd.DataFrame) -> list:
    result = []
    for row in df.to_dict(orient='records'):
        clean = {}
        for k, v in row.items():
            if isinstance(v, pd.Timestamp):
                clean[k] = v.isoformat() if not pd.isna(v) else None
            elif isinstance(v, float) and pd.isna(v):
                clean[k] = None
            else:
                clean[k] = v
        result.append(clean)
    return result


COLS_BASE = [
    # Identidad del establecimiento
    'empresa',       # Razón social legal (ej: "ALISO SRL")
    'bandera',       # Marca comercial (ej: "YPF", "Shell", "Axion", "PUMA") — renombrado de empresabandera
    'cuit',          # CUIT de la empresa
    # Dirección
    'direccion',     # Dirección completa
    'localidad',
    'provincia',
    'region',        # Región geográfica (PAMPEANA, PATAGONICA, NOA, NEA, CUYO)
    # Coordenadas
    'latitud',
    'longitud',
    # Precio
    'producto',
    'precio',
    'tipohorario',   # "Diurno" / "Nocturno"
    'fecha_vigencia',
]


# --- ENDPOINTS ---

@app.get("/", tags=["Info"])
def root():
    return {
        "nombre": "API Precios Combustible Argentina",
        "version": "2.0.0",
        "docs": "/docs",
        "endpoints": [
            "/info", "/health",
            "/provincias", "/localidades",
            "/precios", "/precios/cercanos", "/precios/baratos", "/precios/smart"
        ]
    }


@app.get("/health", tags=["Info"])
def health():
    return {"status": "ok", "localidades_cacheadas": db.localidades_count()}


@app.get("/info", tags=["Info"])
def info():
    """Metadata del dataset: última actualización y fuente."""
    return {
        "dataset": "Precios en surtidor - Resolución 314/2016",
        "fuente": "datos.energia.gob.ar",
        "resource_id": RESOURCE_ID,
        "last_modified": obtener_last_modified(),
    }


# --- CATÁLOGO (desde SQLite) ---

@app.get("/provincias", tags=["Catálogo"])
def provincias():
    """Lista de provincias disponibles (desde caché SQLite)."""
    prov_list = db.query_provincias()
    if prov_list:
        return {"total": len(prov_list), "fuente": "cache", "provincias": prov_list}

    # Fallback: API externa con solo el campo provincia
    try:
        params = {"resource_id": RESOURCE_ID, "limit": 5000, "fields": "provincia"}
        r = requests.get(API_URL, params=params,
                         headers={'User-Agent': 'Mozilla/5.0'}, timeout=API_CONFIG['timeout'])
        r.raise_for_status()
        data = r.json()
        if not data.get('success'):
            raise HTTPException(status_code=502, detail="Error de API externa")
        records = data.get('result', {}).get('records', [])
        result = sorted(set(
            rec['provincia'].strip().upper() for rec in records if rec.get('provincia')
        ))
        return {"total": len(result), "fuente": "api", "provincias": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/localidades", tags=["Catálogo"])
def localidades(
    provincia: Optional[str] = Query(default=None, description="Filtrar por provincia"),
):
    """Lista localidades con coordenadas (desde caché DynamoDB/SQLite)."""
    rows = db.query_localidades(provincia)
    if rows:
        # codigo_postal no existe en el dataset CKAN — omitir del response
        clean = [{k: v for k, v in r.items() if k != 'codigo_postal'} for r in rows]
        return {
            "total": len(clean),
            "fuente": "cache",
            "provincia": provincia.upper() if provincia else None,
            "localidades": clean
        }

    # Fallback: API externa
    df = obtener_datos(provincia or "", None, 5000)
    if df.empty or 'localidad' not in df.columns:
        return {"total": 0, "localidades": []}
    result = sorted(df['localidad'].dropna().str.strip().str.upper().unique().tolist())
    return {
        "total": len(result),
        "fuente": "api",
        "provincia": provincia.upper() if provincia else None,
        "localidades": [{"localidad": l, "provincia": provincia.upper() if provincia else None} for l in result]
    }


# --- PRECIOS ---

@app.get("/precios", tags=["Precios"])
def precios(
    provincia: str = Query(default="BUENOS AIRES"),
    localidad: Optional[str] = Query(default=None),
    producto: Optional[str] = Query(default=None),
    fecha_desde: Optional[date] = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    """Estaciones filtradas por zona. Ordenadas por precio."""
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df['producto'].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    if 'precio' in df.columns:
        df = df.sort_values('precio')
    cols = [c for c in COLS_BASE if c in df.columns]
    return {"total": len(df), "estaciones": df_a_lista(df[cols])}


@app.get("/precios/cercanos", tags=["Precios"])
def precios_cercanos(
    lat: float = Query(...),
    lon: float = Query(...),
    radio_km: float = Query(default=5.0),
    provincia: str = Query(default="BUENOS AIRES"),
    localidad: Optional[str] = Query(default=None),
    producto: Optional[str] = Query(default=None),
    fecha_desde: Optional[date] = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    """Estaciones dentro del radio GPS, ordenadas por distancia."""
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df['producto'].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    df['distancia_km'] = df.apply(
        lambda x: haversine(lat, lon, x.get('latitud'), x.get('longitud')), axis=1
    )
    df = df[df['distancia_km'] <= radio_km].sort_values('distancia_km')
    df['distancia_km'] = df['distancia_km'].round(2)
    cols = [c for c in COLS_BASE + ['distancia_km'] if c in df.columns]
    return {"total": len(df), "radio_km": radio_km, "estaciones": df_a_lista(df[cols])}


@app.get("/precios/baratos", tags=["Precios"])
def precios_baratos(
    provincia: str = Query(default="BUENOS AIRES"),
    localidad: Optional[str] = Query(default=None),
    producto: Optional[str] = Query(default=None),
    fecha_desde: Optional[date] = Query(default=None),
    top: int = Query(default=10, ge=1, le=100),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    """Las N estaciones más baratas para un producto y zona."""
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df['producto'].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    if 'precio' in df.columns:
        df = df.dropna(subset=['precio']).sort_values('precio').head(top)
    cols = [c for c in COLS_BASE if c in df.columns]
    return {"total": len(df), "estaciones": df_a_lista(df[cols])}


@app.get("/precios/smart", tags=["Precios"])
def precios_smart(
    request: Request,
    # GPS (máxima precisión)
    lat: Optional[float] = Query(default=None, description="Latitud GPS del usuario"),
    lon: Optional[float] = Query(default=None, description="Longitud GPS del usuario"),
    # Zona administrativa (fallback manual)
    provincia: Optional[str] = Query(default=None),
    localidad: Optional[str] = Query(default=None),
    barrio: Optional[str] = Query(default=None, description="Barrio (especialmente útil en CABA). Se geocodifica a coordenadas automáticamente."),
    # Filtros de combustible
    producto: Optional[str] = Query(default=None),
    fecha_desde: Optional[date] = Query(default=None),
    radio_km: float = Query(default=10.0, description="Radio de búsqueda cuando se usan coordenadas"),
    limit: int = Query(default=500, ge=1, le=5000),
):
    """
    Endpoint inteligente con resolución automática de ubicación.

    Cascada de precisión:
    1. GPS exacto del dispositivo
    2. Caché de sesión por IP (última ubicación conocida, válida 1h)
    3. Geolocalización por IP en tiempo real
    4. Coordenadas de la localidad desde base de datos local
    5. Capital de la provincia como fallback
    6. Buenos Aires por defecto

    Para CABA: usar `barrio` (ej: Palermo, Belgrano) o `lat`/`lon`.
    Buscar solo por provincia=CABA sin GPS ni barrio no funciona —
    el dataset no distingue barrios, todas las estaciones están bajo
    localidad=CAPITAL FEDERAL.
    """
    client_ip = get_client_ip(request)

    # Si viene barrio, geocodificarlo a coordenadas via Nominatim
    # Esto es necesario especialmente para CABA donde localidad=CAPITAL FEDERAL
    if barrio and lat is None and lon is None:
        prov_query = provincia or "Argentina"
        nominatim_url = "https://nominatim.openstreetmap.org/search"
        try:
            r_nom = requests.get(
                nominatim_url,
                params={"q": f"{barrio}, {prov_query}, Argentina", "format": "json", "limit": 1},
                headers={"User-Agent": "CombustibleArgentina/1.0"},
                timeout=5,
            )
            results = r_nom.json()
            if results:
                lat = float(results[0]["lat"])
                lon = float(results[0]["lon"])
        except Exception:
            pass  # Si falla nominatim, seguir con la cascada normal

    # CABA sin GPS ni barrio → error claro en vez de timeout
    prov_upper = (provincia or "").upper()
    if prov_upper in ("CABA", "CAPITAL FEDERAL") and lat is None and lon is None and not barrio:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Para buscar en CABA necesitás especificar barrio o coordenadas GPS.",
                "ejemplo": "/precios/smart?provincia=CABA&barrio=Palermo&radio_km=3",
                "barrios_ejemplo": ["Palermo", "Belgrano", "Recoleta", "Villa Crespo", "Caballito", "Flores"]
            }
        )

    location = geo.resolve_location(
        gps_lat=lat,
        gps_lon=lon,
        ip=client_ip,
        localidad=localidad,
        provincia=provincia,
        db_get_session=db.get_session,
        db_save_session=db.save_session,
        db_get_localidad_coords=db.get_localidad_coords,
    )

    resolved_lat = location["lat"]
    resolved_lon = location["lon"]
    resolved_localidad = location.get("localidad") or localidad
    resolved_provincia = location.get("provincia") or provincia

    # Si tenemos GPS pero no provincia, hacemos reverse geocoding para saber
    # qué provincia consultar en CKAN (sin esto el pre-filtro no funciona bien)
    if location["method"] == "gps" and not resolved_provincia:
        rev = geo.reverse_geocode(resolved_lat, resolved_lon)
        if rev:
            resolved_provincia = rev["provincia"]
            resolved_localidad = resolved_localidad or rev["localidad"]
            location["provincia"] = resolved_provincia
            location["localidad"] = resolved_localidad
            location["geocoded"] = True
            # Guardar en sesión para futuros requests
            if client_ip:
                db.save_session(client_ip, resolved_lat, resolved_lon,
                                resolved_localidad, resolved_provincia, "gps_reverse")

    resolved_provincia = resolved_provincia or "BUENOS AIRES"

    # ── Localidad del dataset más cercana ────────────────────────────────────
    # Nominatim/IP puede devolver un barrio (ej: "LA REJA") que no está en el
    # dataset de energía. Buscamos la localidad registrada más cercana.
    localidad_detectada = resolved_localidad   # lo que dijo Nominatim/IP
    localidad_dataset   = resolved_localidad   # lo que realmente usamos para querying
    distancia_dataset_km = None

    if resolved_lat and resolved_lon:
        closest = db.localidad_mas_cercana(resolved_lat, resolved_lon, resolved_provincia)
        if closest:
            distancia_dataset_km = closest["distancia_km"]
            # Siempre usamos la localidad más cercana a las coordenadas ACTUALES para
            # la query CKAN. No usamos la localidad cacheada en sesión porque puede
            # ser de una posición anterior (misma IP, distinta ubicación GPS).
            localidad_dataset = closest["localidad"]
            if not resolved_localidad:
                resolved_localidad = localidad_dataset

    # Enriquecer la respuesta de ubicación con info de localidad
    location["localidad_detectada"]  = localidad_detectada
    location["localidad_dataset"]    = localidad_dataset
    if distancia_dataset_km is not None:
        location["distancia_dataset_km"] = distancia_dataset_km

    # Flag explícito para el frontend: ¿la ubicación es confiable?
    # IP geo apunta al nodo del ISP — en GBA puede estar 30-50km lejos del usuario.
    location["ubicacion_aproximada"] = location["method"] in ("ip_geo",) or (
        location["method"] == "ip_cache" and location.get("precision") != "exacta"
    )
    if location["ubicacion_aproximada"]:
        location["sugerencia"] = "Activá el GPS para ver estaciones cerca tuyo"

    # Radio solo cuando tenemos coordenadas reales (GPS exacto o sesión GPS previa)
    # IP geo apunta a ciudad del ISP — en GBA eso es CABA aunque el usuario esté en La Reja
    usar_radio = (
        location["method"] in ("gps", "localidad") or
        (location["method"] == "ip_cache" and location.get("precision") == "exacta")
    ) and resolved_lat is not None and resolved_lon is not None

    def _aplicar_radio(df_input, lat_u, lon_u, radio):
        if df_input.empty:
            return df_input
        df_input = df_input.copy()
        df_input['distancia_km'] = df_input.apply(
            lambda x: haversine(lat_u, lon_u, x.get('latitud'), x.get('longitud')), axis=1
        )
        return df_input[df_input['distancia_km'] <= radio].sort_values('distancia_km').assign(
            distancia_km=lambda d: d['distancia_km'].round(2)
        )

    PROVINCIAS_ADYACENTES = {
        "CABA": ["BUENOS AIRES"],
        "BUENOS AIRES": ["CABA"],
    }

    if usar_radio:
        # ── Pasos 1-4: buscar por radio SIN filtrar por fecha ────────────────
        # La fecha se aplica al FINAL para no vaciar el fallback chain cuando
        # las estaciones cercanas tienen precios sin actualizar recientemente.

        df = pd.DataFrame()

        # Paso 1: localidad del dataset (más preciso, evita traer todo BA)
        if localidad_dataset:
            df_loc = obtener_datos(resolved_provincia, localidad_dataset, limit)
            if not df_loc.empty:
                if producto:
                    df_loc = df_loc[df_loc['producto'].str.upper() == producto.upper()]
                df = _aplicar_radio(df_loc, resolved_lat, resolved_lon, radio_km)

        # Paso 2: si hay pocos resultados, ampliar a toda la provincia
        if len(df) < 5:
            df_prov = obtener_datos(resolved_provincia, None, limit)
            if not df_prov.empty:
                if producto:
                    df_prov = df_prov[df_prov['producto'].str.upper() == producto.upper()]
                df_radio = _aplicar_radio(df_prov, resolved_lat, resolved_lon, radio_km)
                if not df_radio.empty:
                    dedup_cols = [c for c in ['empresa', 'direccion', 'producto'] if c in df_radio.columns]
                    df = pd.concat([df, df_radio]).drop_duplicates(subset=dedup_cols).sort_values('distancia_km')

        # Paso 3: provincias adyacentes (ej: IP indica CABA pero el usuario está en GBA)
        if df.empty:
            for prov_adj in PROVINCIAS_ADYACENTES.get(resolved_provincia, []):
                df_adj = obtener_datos(prov_adj, None, limit)
                if not df_adj.empty:
                    if producto:
                        df_adj = df_adj[df_adj['producto'].str.upper() == producto.upper()]
                    df_adj_radio = _aplicar_radio(df_adj, resolved_lat, resolved_lon, radio_km)
                    if not df_adj_radio.empty:
                        df = df_adj_radio
                        location["provincia_ajustada"] = prov_adj
                        location["nota"] = f"IP indicaba {resolved_provincia}, resultados encontrados en {prov_adj}"
                        break

        # Paso 4: ampliar radio x2 como último recurso
        if df.empty:
            df_prov = obtener_datos(resolved_provincia, None, limit)
            if not df_prov.empty:
                if producto:
                    df_prov = df_prov[df_prov['producto'].str.upper() == producto.upper()]
                df = _aplicar_radio(df_prov, resolved_lat, resolved_lon, radio_km * 2)
                if not df.empty:
                    location["radio_ampliado"] = True

        # Aplicar filtro de fecha estricto: solo devolver estaciones con precio vigente.
        # Si no hay ninguna → devolver vacío con advertencia (sin graceful degradation).
        if fecha_desde and not df.empty and 'fecha_vigencia' in df.columns:
            cutoff = pd.Timestamp(fecha_desde)
            df = df.copy()
            df['precio_vigente'] = df['fecha_vigencia'] >= cutoff
            df = df[df['precio_vigente']]
            if df.empty:
                location["advertencia_fecha"] = (
                    f"No hay precios actualizados desde {fecha_desde} "
                    f"en el radio de {radio_km}km."
                )
    else:
        # Fallback por zona administrativa
        df = obtener_datos(resolved_provincia, resolved_localidad, limit)
        if not df.empty:
            if producto:
                df = df[df['producto'].str.upper() == producto.upper()]
            if fecha_desde and 'fecha_vigencia' in df.columns:
                cutoff = pd.Timestamp(fecha_desde)
                df = df.copy()
                df['precio_vigente'] = df['fecha_vigencia'] >= cutoff
                df = df[df['precio_vigente']]
                if df.empty:
                    location["advertencia_fecha"] = (
                        f"No hay precios actualizados desde {fecha_desde} en esta zona."
                    )
            if 'precio' in df.columns:
                df = df.sort_values('precio')

    if df.empty:
        return {
            "ubicacion_resuelta": location,
            "total": 0,
            "estaciones": []
        }

    cols = [c for c in COLS_BASE + ['distancia_km', 'precio_vigente'] if c in df.columns]
    return {
        "ubicacion_resuelta": location,
        "total": len(df),
        "estaciones": df_a_lista(df[cols])
    }


@app.get("/precios/estadisticas", tags=["Precios"])
def precios_estadisticas(
    provincia: str = Query(default="BUENOS AIRES"),
    localidad: Optional[str] = Query(default=None),
    producto: Optional[str] = Query(default=None, description="Filtrar por producto específico"),
    lat: Optional[float] = Query(default=None, description="Latitud para radio"),
    lon: Optional[float] = Query(default=None, description="Longitud para radio"),
    radio_km: float = Query(default=15.0),
    limit: int = Query(default=2000, ge=1, le=5000),
):
    """
    Estadísticas de precios para una zona: promedio, mínimo, máximo, mediana.
    Agrupa por producto y por bandera. Usa solo precios con fecha_vigencia reciente (últimos 12 meses).
    """
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total_registros": 0, "provincia": provincia, "localidad": localidad, "por_producto": []}

    # Filtrar por radio si hay coordenadas
    if lat is not None and lon is not None:
        df = df.copy()
        df['_dist'] = df.apply(lambda x: haversine(lat, lon, x.get('latitud'), x.get('longitud')), axis=1)
        df = df[df['_dist'] <= radio_km]

    if producto:
        df = df[df['producto'].str.upper() == producto.upper()]

    if df.empty:
        return {"total_registros": 0, "provincia": provincia, "localidad": localidad, "por_producto": []}

    # Solo precios con fecha_vigencia en los últimos 12 meses
    if 'fecha_vigencia' in df.columns:
        cutoff_12m = pd.Timestamp.now() - pd.DateOffset(months=12)
        df_reciente = df[df['fecha_vigencia'] >= cutoff_12m]
        # Si no hay nada reciente, usar todos (y avisar)
        usar_todos = df_reciente.empty
        df_stats = df if usar_todos else df_reciente
    else:
        usar_todos = True
        df_stats = df

    ultima_actualizacion = None
    if 'fecha_vigencia' in df_stats.columns:
        max_fecha = df_stats['fecha_vigencia'].max()
        if not pd.isna(max_fecha):
            ultima_actualizacion = max_fecha.date().isoformat()

    # Agrupar por producto
    por_producto = []
    productos_iter = df_stats['producto'].dropna().unique() if 'producto' in df_stats.columns else []

    for prod in sorted(productos_iter):
        df_prod = df_stats[df_stats['producto'] == prod]
        precios = df_prod['precio'].dropna() if 'precio' in df_prod.columns else pd.Series(dtype=float)
        if precios.empty:
            continue

        # Por bandera
        por_bandera = []
        if 'bandera' in df_prod.columns:
            for bandera, grp in df_prod.groupby('bandera'):
                p = grp['precio'].dropna()
                if p.empty:
                    continue
                por_bandera.append({
                    "bandera": bandera,
                    "count": len(grp),
                    "precio_min": round(float(p.min()), 2),
                    "precio_max": round(float(p.max()), 2),
                    "precio_promedio": round(float(p.mean()), 2),
                })
            por_bandera.sort(key=lambda x: x['precio_promedio'])

        por_producto.append({
            "producto": prod,
            "count_estaciones": int(df_prod['empresa'].nunique()) if 'empresa' in df_prod.columns else len(df_prod),
            "count_precios": len(precios),
            "precio_min": round(float(precios.min()), 2),
            "precio_max": round(float(precios.max()), 2),
            "precio_promedio": round(float(precios.mean()), 2),
            "precio_mediana": round(float(precios.median()), 2),
            "por_bandera": por_bandera,
        })

    return {
        "provincia": provincia.upper(),
        "localidad": localidad.upper() if localidad else None,
        "radio_km": radio_km if (lat is not None and lon is not None) else None,
        "total_registros": len(df_stats),
        "ultima_actualizacion": ultima_actualizacion,
        "nota_cobertura": "precios de todos los períodos" if usar_todos else "precios de los últimos 12 meses",
        "por_producto": por_producto,
    }


@app.get("/precios/timeline", tags=["Precios"])
def precios_timeline(
    provincia: str = Query(default="BUENOS AIRES"),
    localidad: Optional[str] = Query(default=None),
    producto: str = Query(..., description="Ej: Nafta (súper) entre 92 y 95 Ron"),
    bandera: Optional[str] = Query(default=None, description="Filtrar por bandera: YPF, SHELL C.A.P.S.A., AXION, etc."),
    fecha_desde: Optional[date] = Query(default=None, description="YYYY-MM-DD"),
    fecha_hasta: Optional[date] = Query(default=None, description="YYYY-MM-DD"),
    limit: int = Query(default=2000, ge=1, le=5000),
):
    """
    Timeline de precios: evolución histórica agrupada por fecha de vigencia.

    Cada punto representa una fecha en que las estaciones de la zona
    reportaron un nuevo precio. Útil para graficar tendencia de precios.

    Nota: los datos provienen de fecha_vigencia del dataset CKAN — no es
    un precio diario continuo sino eventos de actualización por estación.
    """
    # Traer datos SIN dedup para tener todos los registros históricos
    filtros = {}
    if provincia:
        prov_upper = provincia.upper()
        filtros["provincia"] = CKAN_PROV_MAP.get(prov_upper, prov_upper)
    if localidad:
        filtros["localidad"] = localidad.upper()
    filtros["producto"] = producto

    params = {
        "resource_id": RESOURCE_ID,
        "limit": limit,
        "filters": json.dumps(filtros)
    }
    try:
        r = requests.get(API_URL, params=params,
                         headers={'User-Agent': 'Mozilla/5.0'},
                         timeout=API_CONFIG['timeout'])
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    records = data.get('result', {}).get('records', [])
    if not records:
        return {"producto": producto, "provincia": provincia, "localidad": localidad, "total_puntos": 0, "timeline": []}

    df = pd.DataFrame(records)
    df['precio'] = pd.to_numeric(df['precio'].astype(str).str.replace(',', '.'), errors='coerce')
    df['fecha_vigencia'] = pd.to_datetime(df['fecha_vigencia'], errors='coerce', utc=True).dt.tz_localize(None)

    # Normalizar bandera
    if 'empresabandera' in df.columns:
        df = df.rename(columns={'empresabandera': 'bandera'})
    if 'provincia' in df.columns:
        df['provincia'] = df['provincia'].replace("CAPITAL FEDERAL", "CABA")

    # Filtrar por bandera si se especificó
    if bandera and 'bandera' in df.columns:
        df = df[df['bandera'].str.upper() == bandera.upper()]

    # Filtrar por rango de fechas
    if fecha_desde:
        df = df[df['fecha_vigencia'] >= pd.Timestamp(fecha_desde)]
    if fecha_hasta:
        df = df[df['fecha_vigencia'] <= pd.Timestamp(fecha_hasta)]

    df = df.dropna(subset=['fecha_vigencia', 'precio'])

    if df.empty:
        return {"producto": producto, "provincia": provincia, "localidad": localidad, "total_puntos": 0, "timeline": []}

    # Agrupar por fecha (día)
    df['fecha'] = df['fecha_vigencia'].dt.date
    grouped = df.groupby('fecha').agg(
        precio_min=('precio', 'min'),
        precio_max=('precio', 'max'),
        precio_promedio=('precio', 'mean'),
        precio_mediana=('precio', 'median'),
        cantidad_estaciones=('empresa', 'nunique' if 'empresa' in df.columns else 'count'),
    ).reset_index().sort_values('fecha')

    timeline = []
    for _, row in grouped.iterrows():
        timeline.append({
            "fecha": row['fecha'].isoformat(),
            "precio_min": round(float(row['precio_min']), 2),
            "precio_max": round(float(row['precio_max']), 2),
            "precio_promedio": round(float(row['precio_promedio']), 2),
            "precio_mediana": round(float(row['precio_mediana']), 2),
            "cantidad_estaciones": int(row['cantidad_estaciones']),
        })

    return {
        "producto": producto,
        "provincia": provincia.upper(),
        "localidad": localidad.upper() if localidad else None,
        "bandera": bandera.upper() if bandera else None,
        "total_puntos": len(timeline),
        "precio_actual": timeline[-1]['precio_promedio'] if timeline else None,
        "precio_inicial": timeline[0]['precio_promedio'] if timeline else None,
        "variacion_pct": round(
            ((timeline[-1]['precio_promedio'] - timeline[0]['precio_promedio']) / timeline[0]['precio_promedio']) * 100, 2
        ) if len(timeline) >= 2 and timeline[0]['precio_promedio'] else None,
        "timeline": timeline,
    }


@app.get("/precios/tendencia", tags=["Precios"])
def precios_tendencia(
    localidad: str = Query(..., description="Ej: MORON"),
    provincia: str = Query(..., description="Ej: BUENOS AIRES"),
    producto:  str = Query(..., description="Ej: Nafta (súper) entre 92 y 95 Ron"),
    fecha_desde: Optional[date] = Query(default=None, description="YYYY-MM-DD, default: hace 30 días"),
    fecha_hasta: Optional[date] = Query(default=None, description="YYYY-MM-DD, default: hoy"),
):
    """
    Evolución histórica del precio mínimo diario de un combustible en una localidad.

    Requiere despliegue en AWS (DB_BACKEND=dynamo) — el scraper Lambda acumula
    datos diariamente desde el primer deploy.

    Para backfill inicial ejecutar el scraper manualmente:
      aws lambda invoke --function-name combustible-scraper-prod --payload '{}' out.json
    """
    if os.environ.get("DB_BACKEND") != "dynamo":
        raise HTTPException(
            status_code=501,
            detail="El endpoint /precios/tendencia solo está disponible en el despliegue AWS (DB_BACKEND=dynamo)."
        )

    from db_dynamo import get_historico

    hoy       = date.today()
    desde_str = fecha_desde.isoformat() if fecha_desde else (hoy.replace(month=hoy.month - 1 if hoy.month > 1 else 1)).isoformat()
    hasta_str = fecha_hasta.isoformat() if fecha_hasta else hoy.isoformat()

    registros = get_historico(
        localidad=localidad, provincia=provincia, producto=producto,
        fecha_desde=desde_str, fecha_hasta=hasta_str,
    )

    if not registros:
        return {
            "localidad": localidad.upper().strip(),
            "provincia": provincia.upper().strip(),
            "producto":  producto.upper().strip(),
            "fecha_desde": desde_str, "fecha_hasta": hasta_str,
            "total_dias": 0, "precio_actual": None,
            "precio_minimo": None, "precio_maximo": None,
            "variacion_pct": None, "tendencia": [],
        }

    precios        = [r["precio"] for r in registros if r["precio"] is not None]
    precio_actual  = registros[-1]["precio"] if registros else None
    precio_inicial = registros[0]["precio"]  if registros else None
    variacion_pct  = None
    if precio_inicial and precio_actual and precio_inicial != 0:
        variacion_pct = round(((precio_actual - precio_inicial) / precio_inicial) * 100, 2)

    return {
        "localidad":     localidad.upper().strip(),
        "provincia":     provincia.upper().strip(),
        "producto":      producto.upper().strip(),
        "fecha_desde":   desde_str,
        "fecha_hasta":   hasta_str,
        "total_dias":    len(registros),
        "precio_actual": precio_actual,
        "precio_minimo": min(precios) if precios else None,
        "precio_maximo": max(precios) if precios else None,
        "variacion_pct": variacion_pct,
        "tendencia":     registros,
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
