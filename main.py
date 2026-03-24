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
with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
    config = json.load(f)

API_CONFIG = config['api']
DATOS_LOCALES_CONFIG = config['datos_locales']
RESOURCE_ID = API_CONFIG['resource_id']
API_URL = API_CONFIG['base_url']
RESOURCE_SHOW_URL = "http://datos.energia.gob.ar/api/3/action/resource_show"

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


def obtener_datos(provincia: str, localidad: Optional[str], limit: int) -> pd.DataFrame:
    if API_CONFIG.get('usar_datos_locales'):
        return pd.DataFrame(DATOS_LOCALES_CONFIG['estaciones'])

    filtros = {}
    if provincia:
        filtros["provincia"] = provincia.upper()
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
    'empresa', 'razon_social', 'bandera', 'tipo_bandera', 'numero_establecimiento',
    'calle', 'numero', 'direccion', 'localidad', 'provincia', 'codigo_postal',
    'latitud', 'longitud', 'producto', 'precio', 'fecha_vigencia'
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
    """Lista localidades con coordenadas y código postal (desde caché SQLite)."""
    rows = db.query_localidades(provincia)
    if rows:
        return {
            "total": len(rows),
            "fuente": "cache",
            "provincia": provincia.upper() if provincia else None,
            "localidades": rows
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
    """
    client_ip = get_client_ip(request)

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
            # Si la localidad detectada no está en SQLite O está a > 2km, usamos la más cercana
            en_dataset = db.get_localidad_coords(resolved_localidad or "", resolved_provincia) if resolved_localidad else None
            if not en_dataset:
                localidad_dataset = closest["localidad"]
                if not resolved_localidad:
                    resolved_localidad = localidad_dataset

    # Enriquecer la respuesta de ubicación con info de localidad
    location["localidad_detectada"]  = localidad_detectada
    location["localidad_dataset"]    = localidad_dataset
    if distancia_dataset_km is not None:
        location["distancia_dataset_km"] = distancia_dataset_km

    # Si tenemos coordenadas precisas (GPS o IP), buscamos por radio
    usar_radio = location["method"] in ("gps", "ip_cache", "ip_geo", "localidad")

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

    if usar_radio:
        # Paso 1: buscar con localidad del dataset (más preciso, evita traer todo BA)
        df = pd.DataFrame()
        if localidad_dataset:
            df_loc = obtener_datos(resolved_provincia, localidad_dataset, limit)
            if not df_loc.empty:
                if producto:
                    df_loc = df_loc[df_loc['producto'].str.upper() == producto.upper()]
                df_loc = filtrar_por_fecha(df_loc, fecha_desde)
                df = _aplicar_radio(df_loc, resolved_lat, resolved_lon, radio_km)

        # Paso 2: si hay pocos resultados, ampliar a toda la provincia
        if len(df) < 5:
            df_prov = obtener_datos(resolved_provincia, None, limit)
            if not df_prov.empty:
                if producto:
                    df_prov = df_prov[df_prov['producto'].str.upper() == producto.upper()]
                df_prov = filtrar_por_fecha(df_prov, fecha_desde)
                df_radio = _aplicar_radio(df_prov, resolved_lat, resolved_lon, radio_km)
                # Combinar con lo que ya teníamos, sin duplicados
                if not df_radio.empty:
                    dedup_cols = [c for c in ['empresa', 'direccion', 'producto'] if c in df_radio.columns]
                    df = pd.concat([df, df_radio]).drop_duplicates(subset=dedup_cols).sort_values('distancia_km')

        # Paso 3: si sigue sin haber nada, intentar provincias adyacentes
        # Muy común: ip-api devuelve "CABA" para IPs de GBA (Buenos Aires provincia)
        PROVINCIAS_ADYACENTES = {
            "CABA": ["BUENOS AIRES"],
            "BUENOS AIRES": ["CABA"],
        }
        if df.empty:
            for prov_adj in PROVINCIAS_ADYACENTES.get(resolved_provincia, []):
                df_adj = obtener_datos(prov_adj, None, limit)
                if not df_adj.empty:
                    if producto:
                        df_adj = df_adj[df_adj['producto'].str.upper() == producto.upper()]
                    df_adj = filtrar_por_fecha(df_adj, fecha_desde)
                    df_adj_radio = _aplicar_radio(df_adj, resolved_lat, resolved_lon, radio_km)
                    if not df_adj_radio.empty:
                        df = df_adj_radio
                        location["provincia_ajustada"] = prov_adj
                        location["nota"] = f"IP indicaba {resolved_provincia}, resultados encontrados en {prov_adj}"
                        break

        # Paso 4: si sigue sin haber nada, ampliar radio x2
        if df.empty:
            df_prov = obtener_datos(resolved_provincia, None, limit)
            if not df_prov.empty:
                if producto:
                    df_prov = df_prov[df_prov['producto'].str.upper() == producto.upper()]
                df_prov = filtrar_por_fecha(df_prov, fecha_desde)
                df = _aplicar_radio(df_prov, resolved_lat, resolved_lon, radio_km * 2)
                location["radio_ampliado"] = True
    else:
        # Fallback por zona administrativa
        df = obtener_datos(resolved_provincia, resolved_localidad, limit)
        if not df.empty:
            if producto:
                df = df[df['producto'].str.upper() == producto.upper()]
            df = filtrar_por_fecha(df, fecha_desde)
            if 'precio' in df.columns:
                df = df.sort_values('precio')

    if df.empty:
        return {
            "ubicacion_resuelta": location,
            "total": 0,
            "estaciones": []
        }

    cols = [c for c in COLS_BASE + ['distancia_km'] if c in df.columns]
    return {
        "ubicacion_resuelta": location,
        "total": len(df),
        "estaciones": df_a_lista(df[cols])
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
