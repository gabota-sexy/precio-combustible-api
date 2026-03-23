from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import pandas as pd
import numpy as np
import json
import os
import uvicorn
from typing import Optional
from datetime import datetime, date

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
    description="Consulta precios de nafta y diesel en estaciones de servicio de Argentina usando datos de datos.gob.ar",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

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
        df['fecha_vigencia'] = pd.to_datetime(df['fecha_vigencia'], errors='coerce')

    return df


def filtrar_por_fecha(df: pd.DataFrame, fecha_desde: Optional[date]) -> pd.DataFrame:
    if fecha_desde is None or 'fecha_vigencia' not in df.columns:
        return df
    cutoff = pd.Timestamp(fecha_desde)
    return df[df['fecha_vigencia'] >= cutoff]


def obtener_last_modified() -> Optional[str]:
    try:
        r = requests.get(
            RESOURCE_SHOW_URL,
            params={"id": RESOURCE_ID},
            timeout=10
        )
        r.raise_for_status()
        data = r.json()
        return data.get('result', {}).get('last_modified')
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


COLS_BASE = ['empresa', 'direccion', 'localidad', 'provincia', 'producto', 'precio', 'latitud', 'longitud', 'fecha_vigencia']


# --- ENDPOINTS ---

@app.get("/", tags=["Info"])
def root():
    return {
        "nombre": "API Precios Combustible Argentina",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": ["/info", "/precios", "/precios/cercanos", "/precios/baratos", "/health"]
    }


@app.get("/health", tags=["Info"])
def health():
    return {"status": "ok"}


@app.get("/info", tags=["Info"])
def info():
    """Devuelve metadata del dataset: última actualización y fuente."""
    last_modified = obtener_last_modified()
    return {
        "dataset": "Precios en surtidor - Resolución 314/2016",
        "fuente": "datos.energia.gob.ar",
        "resource_id": RESOURCE_ID,
        "last_modified": last_modified,
    }


@app.get("/localidades", tags=["Catálogo"])
def localidades(
    provincia: Optional[str] = Query(default=None, description="Filtrar por provincia"),
    limit: int = Query(default=5000, ge=1, le=5000),
):
    """Devuelve todas las localidades disponibles, opcionalmente filtradas por provincia."""
    df = obtener_datos(provincia or "", None, limit)

    if df.empty or 'localidad' not in df.columns:
        return {"total": 0, "localidades": []}

    result = sorted(df['localidad'].dropna().str.strip().str.upper().unique().tolist())
    return {"total": len(result), "provincia": provincia.upper() if provincia else None, "localidades": result}


@app.get("/provincias", tags=["Catálogo"])
def provincias(
    limit: int = Query(default=5000, ge=1, le=5000),
):
    """Devuelve todas las provincias disponibles en el dataset."""
    df = obtener_datos("", None, limit)

    if df.empty or 'provincia' not in df.columns:
        return {"total": 0, "provincias": []}

    result = sorted(df['provincia'].dropna().str.strip().str.upper().unique().tolist())
    return {"total": len(result), "provincias": result}


@app.get("/precios", tags=["Precios"])
def precios(
    provincia: str = Query(default="BUENOS AIRES", description="Nombre de la provincia"),
    localidad: Optional[str] = Query(default=None, description="Nombre de la localidad"),
    producto: Optional[str] = Query(default=None, description="Tipo de combustible (ej: Nafta 95, Diesel, GNC)"),
    fecha_desde: Optional[date] = Query(default=None, description="Filtrar por fecha_vigencia >= esta fecha (YYYY-MM-DD)"),
    limit: int = Query(default=1000, ge=1, le=5000, description="Máximo de registros a traer de la API"),
):
    """Devuelve estaciones filtradas por provincia, localidad, producto y fecha. Ordenadas por precio."""
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
    lat: float = Query(..., description="Latitud del usuario"),
    lon: float = Query(..., description="Longitud del usuario"),
    radio_km: float = Query(default=5.0, description="Radio de búsqueda en km"),
    provincia: str = Query(default="BUENOS AIRES", description="Provincia para pre-filtrar"),
    localidad: Optional[str] = Query(default=None, description="Localidad para pre-filtrar"),
    producto: Optional[str] = Query(default=None, description="Tipo de combustible"),
    fecha_desde: Optional[date] = Query(default=None, description="Filtrar por fecha_vigencia >= esta fecha (YYYY-MM-DD)"),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    """Devuelve estaciones dentro del radio GPS indicado, ordenadas por distancia."""
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
    producto: Optional[str] = Query(default=None, description="Tipo de combustible (ej: Nafta 95)"),
    fecha_desde: Optional[date] = Query(default=None, description="Filtrar por fecha_vigencia >= esta fecha (YYYY-MM-DD)"),
    top: int = Query(default=10, ge=1, le=100, description="Cuántos resultados devolver"),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    """Devuelve las N estaciones más baratas para un producto y zona."""
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
