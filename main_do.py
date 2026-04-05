from fastapi import FastAPI, Query, HTTPException, Request, Depends, Body
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import requests, pandas as pd, numpy as np, json, os, threading, sqlite3, time, uuid, secrets
import xml.etree.ElementTree as ET
from typing import Optional
from datetime import datetime, date, timedelta

import db, geo
from auth import verify_password, create_token, get_current_admin, ADMIN_USER, ADMIN_HASH


# ── Pydantic models para comunidad ──────────────────────────────────────────

class ReporteEstacionIn(BaseModel):
    empresa: str
    bandera: Optional[str] = None
    direccion: str
    localidad: str
    provincia: str
    tipo: str = Field(..., pattern="^(cerrada|no_existe|error_ubicacion|otro)$")
    comentario: Optional[str] = None

class PrecioComunidadIn(BaseModel):
    empresa: str
    bandera: Optional[str] = None
    direccion: str
    localidad: str
    provincia: str
    producto: str
    precio: float = Field(..., gt=100, lt=50000)


# ── Pydantic models para Mi Garage ───────────────────────────────────────────

class GarageVehiculoIn(BaseModel):
    marca: str
    modelo: str
    version: Optional[str] = None
    anio: Optional[int] = Field(None, ge=1980, le=2030)
    combustible: Optional[str] = None
    litros_tanque: Optional[float] = Field(None, gt=0, le=200)
    consumo_ciudad: Optional[float] = Field(None, gt=0, le=50)
    consumo_mixto:  Optional[float] = Field(None, gt=0, le=50)
    consumo_ruta:   Optional[float] = Field(None, gt=0, le=50)
    es_principal: bool = False
    # Nuevos campos km y seguro
    km_actual: Optional[int] = Field(None, ge=0, le=9999999)
    km_ultimo_aceite: Optional[int] = Field(None, ge=0, le=9999999)
    fecha_ultimo_aceite: Optional[str] = None
    intervalo_aceite_km: Optional[int] = Field(None, ge=1000, le=50000)
    vencimiento_vtv: Optional[str] = None
    vencimiento_seguro: Optional[str] = None
    costo_seguro: Optional[float] = Field(None, ge=0)
    aseguradora: Optional[str] = Field(None, max_length=100)
    cobertura_seguro: Optional[str] = Field(None, max_length=50)

class BitacoraViajeIn(BaseModel):
    origen: str = Field(..., min_length=2, max_length=200)
    destino: str = Field(..., min_length=2, max_length=200)
    fecha_inicio: str = Field(..., min_length=10, max_length=10)  # YYYY-MM-DD
    fecha_fin: Optional[str] = None
    vehiculo_id: Optional[int] = None
    km_recorridos: Optional[float] = Field(None, ge=0, le=99999)
    litros_cargados: Optional[float] = Field(None, ge=0, le=9999)
    precio_litro: Optional[float] = Field(None, ge=0)
    costo_total: Optional[float] = Field(None, ge=0)
    tiempo_min: Optional[int] = Field(None, ge=0, le=99999)
    clima_origen: Optional[str] = Field(None, max_length=500)
    notas: Optional[str] = Field(None, max_length=2000)

class MantenimientoIn(BaseModel):
    vehiculo_id: int
    tipo: str = Field(..., pattern="^(aceite|vtv|frenos|cubiertas|filtro|patente|otro)$")
    fecha: str = Field(..., min_length=10, max_length=10)  # YYYY-MM-DD
    km_vehiculo: Optional[int] = Field(None, ge=0)
    km_proximo: Optional[int] = Field(None, ge=0)
    fecha_proxima: Optional[str] = None
    costo: Optional[float] = Field(None, ge=0)
    taller_nombre: Optional[str] = Field(None, max_length=200)
    taller_localidad: Optional[str] = Field(None, max_length=100)
    taller_provincia: Optional[str] = Field(None, max_length=100)
    taller_telefono: Optional[str] = Field(None, max_length=30)
    notas: Optional[str] = Field(None, max_length=2000)

class ContribucionConsumoIn(BaseModel):
    marca: str
    modelo: str
    version: Optional[str] = None
    anio: Optional[int] = Field(None, ge=1980, le=2030)
    combustible: Optional[str] = None
    consumo_ciudad: Optional[float] = Field(None, gt=0, le=50)
    consumo_mixto:  Optional[float] = Field(None, gt=0, le=50)
    consumo_ruta:   Optional[float] = Field(None, gt=0, le=50)
    litros_tanque:  Optional[float] = Field(None, gt=0, le=200)
    km_propios:     Optional[int]   = Field(None, ge=0)
    notas:          Optional[str]   = None

class ContactoPublicidadIn(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=100)
    empresa: Optional[str] = Field(None, max_length=100)
    email: str = Field(..., min_length=5, max_length=200)
    telefono: Optional[str] = Field(None, max_length=30)
    tipo: str = Field(..., pattern="^(banner|sponsor|nota_patrocinada|otro)$")
    mensaje: str = Field(..., min_length=10, max_length=2000)

class FeedbackIn(BaseModel):
    tipo: str = Field(..., pattern="^(sugerencia|bug|otro)$")
    voto: str = Field(..., pattern="^(positivo|negativo)$")
    mensaje: Optional[str] = Field(None, max_length=500)
    pagina: Optional[str] = Field(None, max_length=200)

RESEND_API_KEY  = os.environ.get("RESEND_API_KEY", "")
WA_SERVICE_URL  = os.environ.get("WA_SERVICE_URL", "http://127.0.0.1:3001")
FROM_EMAIL      = os.environ.get("FROM_EMAIL", "avisos@tankear.com.ar")
NEWSAPI_KEY     = os.environ.get("NEWSAPI_KEY", "")

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
_DEFAULT = {"api": {"resource_id": "80ac25de-a44a-4445-9215-090cf55cfda5",
    "base_url": "http://datos.energia.gob.ar/api/3/action/datastore_search",
    "usar_datos_locales": False, "limit": 1000, "timeout": 60, "filtros": {}},
    "datos_locales": {"estaciones": []}}
try:
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)
except FileNotFoundError:
    config = _DEFAULT

API_CONFIG  = config["api"]
RESOURCE_ID = API_CONFIG["resource_id"]
API_URL     = API_CONFIG["base_url"]
CKAN_MAP    = {"CABA": "CAPITAL FEDERAL"}
DB_PATH     = os.environ.get("DB_PATH", "/var/www/tankear/data/tankear.db")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Tankear API", version="3.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware,
    allow_origins=[
        "https://tankear.com.ar", "https://www.tankear.com.ar",
        "http://tankear.com.ar", "http://www.tankear.com.ar",
        "http://localhost:5173", "http://68.183.106.80",
    ],
    allow_methods=["GET","POST","PUT","DELETE","OPTIONS"], allow_headers=["*"])


def leads_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mail TEXT, celular TEXT, pagina_origen TEXT DEFAULT 'combustible',
        zona TEXT, preferencias TEXT, ip TEXT,
        fecha_registro TEXT DEFAULT (datetime('now')))""")
    conn.commit()
    return conn


def _seed_localidades():
    try:
        r = requests.get(API_URL, params={"resource_id": RESOURCE_ID, "limit": 2000},
                         headers={"User-Agent": "Tankear/3.0"}, timeout=30)
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            return
        seen, to_insert = set(), []
        for rec in data.get("result", {}).get("records", []):
            loc  = (rec.get("localidad") or "").strip().upper()
            prov = (rec.get("provincia") or "").strip().upper()
            if not loc or not prov:
                continue
            if (loc, prov) in seen:
                continue
            seen.add((loc, prov))
            try:
                lat = float(rec.get("latitud") or 0) or None
            except Exception:
                lat = None
            try:
                lon = float(rec.get("longitud") or 0) or None
            except Exception:
                lon = None
            to_insert.append({"localidad": loc, "provincia": prov, "lat": lat, "lon": lon,
                               "codigo_postal": (rec.get("codigo_postal") or "").strip()})
        if to_insert:
            db.seed_localidades(to_insert)
            print(f"[DB] {len(to_insert)} localidades sembradas")
    except Exception as e:
        print(f"[DB] Error seed: {e}")


@app.on_event("startup")
async def startup():
    db.init_db()
    if not db.localidades_seeded():
        threading.Thread(target=_seed_localidades, daemon=True).start()
    else:
        print(f"[DB] Localidades OK ({db.localidades_count()})")


def haversine(lat1, lon1, lat2, lon2):
    if any(v is None or (isinstance(v, float) and np.isnan(v)) for v in [lat1, lon1, lat2, lon2]):
        return np.nan
    R = 6371
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi, dlam = np.radians(lat2 - lat1), np.radians(lon2 - lon1)
    a = np.sin(dphi/2)**2 + np.cos(phi1)*np.cos(phi2)*np.sin(dlam/2)**2
    return R * 2 * np.arcsin(np.sqrt(a))


# ── Notificaciones ────────────────────────────────────────────────────────────

def send_welcome_email(mail: str, zona: str = ""):
    if not RESEND_API_KEY or not mail:
        return
    zona_text = f" en {zona}" if zona else ""
    try:
        requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": f"Tankear <{FROM_EMAIL}>",
                "to": [mail],
                "subject": "🔔 Ya estás suscripto a las alertas de Tankear",
                "html": f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:36px;border-radius:12px;">
  <h2 style="color:#f59e0b;margin:0 0 4px;">⛽ Tankear</h2>
  <p style="color:#64748b;font-size:13px;margin:0 0 28px;">alertas de precio de combustible</p>
  <p style="margin:0 0 12px;">¡Hola! Ya estás suscripto a las alertas de precios{zona_text}.</p>
  <p style="margin:0 0 24px;color:#94a3b8;">Te avisamos cada vez que haya cambios de precio cerca tuyo.</p>
  <hr style="border:none;border-top:1px solid #1e293b;margin:0 0 24px;">
  <p style="color:#475569;font-size:12px;margin:0;">Para darte de baja, respondé este email con el texto <strong>BAJA</strong>.</p>
</div>
                """,
            },
            timeout=10,
        )
        print(f"[RESEND] Email enviado → {mail}")
    except Exception as e:
        print(f"[RESEND] Error: {e}")


def send_internal_email(subject: str, html: str):
    """Send notification email to internal team."""
    if not RESEND_API_KEY:
        return
    try:
        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": f"Tankear <noreply@tankear.com.ar>",
                "to": ["contacto@tankear.com.ar"],
                "subject": subject,
                "html": html,
            },
            timeout=10,
        )
    except Exception as e:
        print(f"[RESEND] Internal email error: {e}")


def send_welcome_whatsapp(celular: str, zona: str = ""):
    if not celular:
        return
    zona_text = f" en {zona}" if zona else ""
    msg = (
        f"⛽ *Tankear*\n"
        f"¡Hola! Ya estás suscripto a las alertas de precios{zona_text}. 🎉\n\n"
        f"Te vamos a avisar cada vez que cambien los precios cerca tuyo.\n\n"
        f"_Para darte de baja respondé BAJA._"
    )
    try:
        r = requests.post(
            f"{WA_SERVICE_URL}/send",
            json={"number": celular, "message": msg},
            timeout=5,
        )
        if r.ok:
            print(f"[WA] Mensaje enviado → {celular}")
        else:
            print(f"[WA] Servicio respondió {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"[WA] Error: {e}")


def get_client_ip(request: Request) -> Optional[str]:
    # Cloudflare envía la IP real del usuario en CF-Connecting-IP (más confiable que X-Forwarded-For)
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def get_cf_headers(request: Request) -> Optional[dict]:
    """Extrae los headers de geolocalización que inyecta Cloudflare."""
    cf_city = request.headers.get("CF-IPCity")
    if not cf_city and not request.headers.get("CF-IPCountry"):
        return None  # No estamos detrás de Cloudflare
    return {
        "CF-IPCity":      request.headers.get("CF-IPCity", ""),
        "CF-IPCountry":   request.headers.get("CF-IPCountry", ""),
        "CF-IPRegion":    request.headers.get("CF-IPRegion", ""),
        "CF-IPLatitude":  request.headers.get("CF-IPLatitude", ""),
        "CF-IPLongitude": request.headers.get("CF-IPLongitude", ""),
    }


def _df_from_sqlite(provincia, localidad, producto, limit):
    """Lee estaciones desde el cache SQLite (fallback cuando CKAN no responde)."""
    records = db.get_estaciones(provincia=provincia, localidad=localidad,
                                producto=producto, limit=limit)
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    # Limpiar columnas internas de SQLite
    for col in ["id", "fecha_scraping"]:
        if col in df.columns:
            df = df.drop(columns=[col])
    if "precio" in df.columns:
        df["precio"] = pd.to_numeric(df["precio"], errors="coerce")
    for col in ["latitud", "longitud"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "fecha_vigencia" in df.columns:
        df["fecha_vigencia"] = pd.to_datetime(df["fecha_vigencia"], errors="coerce")
    return df


def obtener_datos(provincia, localidad, limit):
    # ── SQLite-first: si hay cache local (>0 estaciones), usarlo directamente ─
    # CKAN se actualiza 1x/día via cron — no tiene sentido hacer el usuario esperar 8s
    has_cache = db.estaciones_count() > 0
    if has_cache:
        df = _df_from_sqlite(provincia, localidad, None, limit)
        if not df.empty:
            return df
        # Sin datos para localidad específica → intentar solo provincia
        if localidad:
            df = _df_from_sqlite(provincia, None, None, limit)
            if not df.empty:
                return df
        # Sin datos para la provincia → devolver vacío (no bloquear con CKAN)
        return pd.DataFrame()

    # ── Sin cache local → intentar CKAN (primer arranque del servidor) ───────
    filtros = {}
    if provincia:
        pv = provincia.upper()
        filtros["provincia"] = CKAN_MAP.get(pv, pv)
    if localidad:
        filtros["localidad"] = localidad.upper()
    params = {"resource_id": RESOURCE_ID, "limit": limit, "filters": json.dumps(filtros)}
    try:
        r = requests.get(API_URL, params=params,
                         headers={"User-Agent": "Tankear/3.0"}, timeout=API_CONFIG["timeout"])
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise ValueError("CKAN error")
        records = data["result"].get("records", [])
        if not records:
            return pd.DataFrame()
        df = pd.DataFrame(records)
        if "precio" in df.columns:
            df["precio"] = pd.to_numeric(df["precio"].astype(str).str.replace(",", "."), errors="coerce")
        for col in ["latitud", "longitud"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        if "fecha_vigencia" in df.columns:
            df["fecha_vigencia"] = pd.to_datetime(df["fecha_vigencia"], errors="coerce", utc=True).dt.tz_localize(None)
        dedup = [c for c in ["empresa", "direccion", "producto"] if c in df.columns]
        if dedup and "fecha_vigencia" in df.columns:
            df = df.sort_values("fecha_vigencia", ascending=False).drop_duplicates(subset=dedup)
        elif dedup:
            df = df.drop_duplicates(subset=dedup)
        if "provincia" in df.columns:
            df["provincia"] = df["provincia"].replace("CAPITAL FEDERAL", "CABA")
        if "empresabandera" in df.columns:
            df = df.rename(columns={"empresabandera": "bandera"})
        return df
    except Exception as ckan_err:
        raise HTTPException(status_code=502, detail=f"Sin cache local y CKAN no responde: {ckan_err}")


def filtrar_por_fecha(df, fecha_desde):
    if fecha_desde is None or "fecha_vigencia" not in df.columns:
        return df
    return df[df["fecha_vigencia"] >= pd.Timestamp(fecha_desde)]


def df_a_lista(df):
    result = []
    for row in df.to_dict(orient="records"):
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


COLS = ["empresa","bandera","cuit","direccion","localidad","provincia","region",
        "latitud","longitud","producto","precio","tipohorario","fecha_vigencia"]
ADY  = {"CABA": ["BUENOS AIRES"], "BUENOS AIRES": ["CABA"]}


# ── INFO ──────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"service": "Tankear API", "version": "3.0.0", "docs": "/docs"}

@app.get("/health")
def health():
    age = db.estaciones_age_hours()
    return {
        "status": "ok",
        "localidades": db.localidades_count(),
        "estaciones_cache": db.estaciones_count(),
        "cache_age_hours": round(age, 1) if age is not None else None,
    }


# ── CATÁLOGO ──────────────────────────────────────────────────────────────────
@app.get("/provincias")
def provincias():
    prov = db.query_provincias()
    if prov:
        return prov
    try:
        r = requests.get(API_URL,
                         params={"resource_id": RESOURCE_ID, "limit": 5000, "fields": "provincia"},
                         headers={"User-Agent": "Tankear/3.0"}, timeout=30)
        data = r.json()
        return sorted(set(
            rec["provincia"].strip().upper()
            for rec in data.get("result", {}).get("records", [])
            if rec.get("provincia")
        ))
    except Exception:
        return []


@app.get("/localidades")
def localidades(provincia: Optional[str] = Query(default=None)):
    rows = db.query_localidades(provincia)
    if rows:
        return [r["localidad"] for r in rows]
    df = obtener_datos(provincia or "", None, 5000)
    if df.empty or "localidad" not in df.columns:
        return []
    return sorted(df["localidad"].dropna().str.strip().str.upper().unique().tolist())


# ── PRECIOS ───────────────────────────────────────────────────────────────────
@app.get("/precios")
def precios(provincia: str = Query(default="BUENOS AIRES"),
            localidad: Optional[str] = None, producto: Optional[str] = None,
            fecha_desde: Optional[date] = None, limit: int = Query(default=1000, le=5000)):
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df["producto"].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    if "precio" in df.columns:
        df = df.sort_values("precio")
    cols = [c for c in COLS if c in df.columns]
    return {"total": len(df), "estaciones": df_a_lista(df[cols])}


@app.get("/precios/cercanos")
def precios_cercanos(lat: float, lon: float, radio_km: float = 5.0,
                     provincia: str = "BUENOS AIRES", localidad: Optional[str] = None,
                     producto: Optional[str] = None, fecha_desde: Optional[date] = None,
                     limit: int = Query(default=1000, le=5000)):
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df["producto"].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    df["distancia_km"] = df.apply(
        lambda x: haversine(lat, lon, x.get("latitud"), x.get("longitud")), axis=1)
    df = df[df["distancia_km"] <= radio_km].sort_values("distancia_km")
    df["distancia_km"] = df["distancia_km"].round(2)
    cols = [c for c in COLS + ["distancia_km"] if c in df.columns]
    return {"total": len(df), "radio_km": radio_km, "estaciones": df_a_lista(df[cols])}


@app.get("/precios/baratos")
def precios_baratos(provincia: str = "BUENOS AIRES", localidad: Optional[str] = None,
                    producto: Optional[str] = None, fecha_desde: Optional[date] = None,
                    top: int = 10, limit: int = Query(default=1000, le=5000)):
    df = obtener_datos(provincia, localidad, limit)
    if df.empty:
        return {"total": 0, "estaciones": []}
    if producto:
        df = df[df["producto"].str.upper() == producto.upper()]
    df = filtrar_por_fecha(df, fecha_desde)
    if "precio" in df.columns:
        df = df.dropna(subset=["precio"]).sort_values("precio").head(top)
    cols = [c for c in COLS if c in df.columns]
    return {"total": len(df), "estaciones": df_a_lista(df[cols])}


@app.get("/precios/smart")
def precios_smart(request: Request,
                  lat: Optional[float] = None, lon: Optional[float] = None,
                  provincia: Optional[str] = None, localidad: Optional[str] = None,
                  barrio: Optional[str] = None, producto: Optional[str] = None,
                  fecha_desde: Optional[date] = None,
                  radio_km: float = 10.0, limit: int = Query(default=500, le=5000)):
    client_ip = get_client_ip(request)
    cf_hdrs   = get_cf_headers(request)
    if barrio and lat is None and lon is None:
        try:
            r_nom = requests.get("https://nominatim.openstreetmap.org/search",
                params={"q": f"{barrio}, {provincia or 'Argentina'}, Argentina",
                        "format": "json", "limit": 1},
                headers={"User-Agent": "Tankear/3.0"}, timeout=5)
            nom = r_nom.json()
            if nom:
                lat = float(nom[0]["lat"])
                lon = float(nom[0]["lon"])
        except Exception:
            pass
    prov_up = (provincia or "").upper()
    # CABA sin GPS ni barrio: usar coordenadas del centro de CABA como fallback
    # para que el endpoint no tire 400 y muestre algo útil
    if prov_up in ("CABA", "CAPITAL FEDERAL", "CIUDAD AUTÓNOMA DE BUENOS AIRES", "CIUDAD AUTONOMA DE BUENOS AIRES") \
            and lat is None and lon is None and not barrio:
        lat, lon = -34.6037, -58.3816   # Plaza de Mayo, centro CABA
    location = geo.resolve_location(
        gps_lat=lat, gps_lon=lon, ip=client_ip,
        localidad=localidad, provincia=provincia,
        db_get_session=db.get_session, db_save_session=db.save_session,
        db_get_localidad_coords=db.get_localidad_coords,
        cf_headers=cf_hdrs)
    rlat = location["lat"]
    rlon = location["lon"]
    rloc  = location.get("localidad") or localidad
    rprov = location.get("provincia") or provincia
    if location["method"] == "gps" and not rprov:
        rev = geo.reverse_geocode(rlat, rlon)
        if rev:
            rprov = rev["provincia"]
            rloc  = rloc or rev["localidad"]
            location.update({"provincia": rprov, "localidad": rloc})
            if client_ip:
                db.save_session(client_ip, rlat, rlon, rloc, rprov, "gps_reverse")
    rprov = rprov or "BUENOS AIRES"
    loc_dataset = rloc
    dist_dataset = None
    if rlat and rlon:
        closest = db.localidad_mas_cercana(rlat, rlon, rprov)
        if closest:
            dist_dataset = closest["distancia_km"]
            loc_dataset   = closest["localidad"]
            if not rloc:
                rloc = loc_dataset
    location["localidad_detectada"]  = rloc
    location["localidad_dataset"]    = loc_dataset
    if dist_dataset is not None:
        location["distancia_dataset_km"] = dist_dataset

    def _radio(df_in, flat, flon, r):
        if df_in.empty:
            return df_in
        df_in = df_in.copy()
        df_in["distancia_km"] = df_in.apply(
            lambda x: haversine(flat, flon, x.get("latitud"), x.get("longitud")), axis=1)
        return (df_in[df_in["distancia_km"] <= r]
                .sort_values("distancia_km")
                .assign(distancia_km=lambda d: d["distancia_km"].round(2)))

    usar_radio = (location["method"] in ("gps", "localidad") or
                  (location["method"] == "ip_cache" and location.get("precision") == "exacta")) \
                 and rlat is not None

    if usar_radio:
        df = pd.DataFrame()
        if loc_dataset:
            df_loc = obtener_datos(rprov, loc_dataset, limit)
            if not df_loc.empty:
                if producto:
                    df_loc = df_loc[df_loc["producto"].str.upper() == producto.upper()]
                df = _radio(df_loc, rlat, rlon, radio_km)
        if len(df) < 5:
            df_p = obtener_datos(rprov, None, limit)
            if not df_p.empty:
                if producto:
                    df_p = df_p[df_p["producto"].str.upper() == producto.upper()]
                df_r = _radio(df_p, rlat, rlon, radio_km)
                if not df_r.empty:
                    dedup = [c for c in ["empresa","direccion","producto"] if c in df_r.columns]
                    df = pd.concat([df, df_r]).drop_duplicates(subset=dedup).sort_values("distancia_km")
        if df.empty:
            for pa in ADY.get(rprov, []):
                df_a = obtener_datos(pa, None, limit)
                if not df_a.empty:
                    if producto:
                        df_a = df_a[df_a["producto"].str.upper() == producto.upper()]
                    df_ar = _radio(df_a, rlat, rlon, radio_km)
                    if not df_ar.empty:
                        df = df_ar
                        break
        if df.empty:
            df_p = obtener_datos(rprov, None, limit)
            if not df_p.empty:
                if producto:
                    df_p = df_p[df_p["producto"].str.upper() == producto.upper()]
                df = _radio(df_p, rlat, rlon, radio_km * 2)
        if fecha_desde and not df.empty and "fecha_vigencia" in df.columns:
            cutoff = pd.Timestamp(fecha_desde)
            df = df.copy()
            df["precio_vigente"] = df["fecha_vigencia"] >= cutoff
    else:
        df = obtener_datos(rprov, rloc, limit)
        if not df.empty:
            if producto:
                df = df[df["producto"].str.upper() == producto.upper()]
            if fecha_desde and "fecha_vigencia" in df.columns:
                cutoff = pd.Timestamp(fecha_desde)
                df = df.copy()
                df["precio_vigente"] = df["fecha_vigencia"] >= cutoff
                df_v = df[df["precio_vigente"]]
                if not df_v.empty:
                    df = df_v
            if "precio" in df.columns:
                df = df.sort_values("precio")

    if df.empty:
        return {"ubicacion_resuelta": location, "total": 0, "estaciones": []}
    cols = [c for c in COLS + ["distancia_km", "precio_vigente"] if c in df.columns]
    return {"ubicacion_resuelta": location, "total": len(df),
            "estaciones": df_a_lista(df[cols])}


@app.get("/precios/estadisticas")
def precios_estadisticas(provincia: Optional[str] = None, localidad: Optional[str] = None,
                          lat: Optional[float] = None, lon: Optional[float] = None,
                          radio_km: float = 20.0, producto: Optional[str] = None,
                          fecha_desde: Optional[str] = None):
    prov = provincia or "BUENOS AIRES"
    df = obtener_datos(prov, localidad, 2000)
    if df.empty:
        return {"por_producto": [], "ultima_actualizacion": None}

    # ── Filtro de fecha: solo precios de los últimos 90 días (o fecha_desde si se pasa) ──
    cutoff = fecha_desde or (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    if "fecha_vigencia" in df.columns:
        df["fecha_vigencia"] = pd.to_datetime(df["fecha_vigencia"], errors="coerce")
        df = df[df["fecha_vigencia"] >= pd.Timestamp(cutoff)]

    # ── Sanity check: precios < $500/L son claramente datos históricos corruptos ──
    if "precio" in df.columns:
        df = df[df["precio"] >= 500]

    if lat and lon:
        df["distancia_km"] = df.apply(
            lambda x: haversine(lat, lon, x.get("latitud"), x.get("longitud")), axis=1)
        df = df[df["distancia_km"] <= radio_km]
    if producto:
        df = df[df["producto"].str.contains(producto, case=False, na=False)]
    if df.empty:
        return {"por_producto": [], "ultima_actualizacion": None}
    result = []
    for prod, grp in df.groupby("producto"):
        precios = grp["precio"].dropna()
        if precios.empty:
            continue
        por_bandera = []
        if "bandera" in grp.columns:
            for banda, bg in grp.groupby("bandera"):
                bp = bg["precio"].dropna()
                if not bp.empty:
                    por_bandera.append({"bandera": banda,
                                        "precio_promedio": round(float(bp.mean()), 2),
                                        "count": len(bp)})
            por_bandera.sort(key=lambda x: x["precio_promedio"])
        result.append({
            "producto": prod,
            "precio_min":      round(float(precios.min()), 2),
            "precio_max":      round(float(precios.max()), 2),
            "precio_promedio": round(float(precios.mean()), 2),
            "precio_mediana":  round(float(precios.median()), 2),
            "count_estaciones": len(precios),
            "por_bandera": por_bandera,
        })
    ultima = None
    if "fecha_vigencia" in df.columns:
        ts = df["fecha_vigencia"].dropna().max()
        if pd.notna(ts):
            ultima = ts.isoformat()
    return {"por_producto": result, "ultima_actualizacion": ultima,
            "nota_cobertura": f"{prov}{(' - ' + localidad) if localidad else ''}"}


@app.get("/precios/timeline")
def precios_timeline(provincia: Optional[str] = None, localidad: Optional[str] = None,
                     producto: str = "Nafta (súper) entre 92 y 95 Ron",
                     fecha_desde: Optional[date] = None, fecha_hasta: Optional[date] = None):
    return {"total_puntos": 0, "timeline": [],
            "nota": "Historial se acumula con el tiempo"}


# ── LEADS ─────────────────────────────────────────────────────────────────────
@app.post("/leads")
@limiter.limit("5/minute")
async def crear_lead(request: Request):
    body    = await request.json()
    mail        = (body.get("mail") or "").strip()
    celular     = (body.get("celular") or "").strip()
    zona        = (body.get("zona") or "").strip()
    pagina      = body.get("pagina_origen", "combustible")
    preferencias = json.dumps(body.get("preferencias") or [], ensure_ascii=False)
    if not mail and not celular:
        raise HTTPException(status_code=400, detail="Necesitas mail o celular")

    # Enriquecer zona con CF headers si el usuario no la proporcionó
    if not zona:
        cf_hdrs = get_cf_headers(request)
        if cf_hdrs:
            city    = cf_hdrs.get("CF-IPCity", "").strip()
            region  = cf_hdrs.get("CF-IPRegion", "").strip()
            if city and region:
                zona = f"{city.upper()}, {region.upper()}"
            elif region:
                zona = region.upper()

    # Guardar IP del lead (IP real, no la de Cloudflare)
    ip_lead = get_client_ip(request)

    conn = leads_db()
    try:
        conn.execute("ALTER TABLE leads ADD COLUMN ip TEXT")
        conn.commit()
    except Exception:
        pass
    # Ensure preferencias column exists (migration for older DBs)
    try:
        conn.execute("ALTER TABLE leads ADD COLUMN preferencias TEXT")
        conn.commit()
    except Exception:
        pass
    conn.execute(
        "INSERT INTO leads (mail, celular, pagina_origen, zona, preferencias, ip) VALUES (?,?,?,?,?,?)",
        (mail or None, celular or None, pagina, zona or None, preferencias, ip_lead or None))
    conn.commit()
    conn.close()

    # Notificaciones de bienvenida (en background, no bloquean la respuesta)
    threading.Thread(target=send_welcome_email,     args=(mail,    zona), daemon=True).start()
    threading.Thread(target=send_welcome_whatsapp,  args=(celular, zona), daemon=True).start()

    return {"ok": True, "mensaje": "Listo! Te avisamos cuando cambien los precios."}


# ── USUARIOS ─────────────────────────────────────────────────────────────────

import bcrypt as _bcrypt

TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET_KEY", "")
_AUTH_ERROR = HTTPException(status_code=401, detail="Email o contraseña incorrectos")

def usuarios_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        mail TEXT UNIQUE,
        celular TEXT,
        provincia TEXT,
        localidad TEXT,
        auto_marca TEXT,
        auto_modelo TEXT,
        auto_anio INTEGER,
        combustible_preferido TEXT,
        preferencias TEXT,
        token TEXT UNIQUE,
        created_at TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        password_hash TEXT,
        verified_mail INTEGER DEFAULT 0,
        verify_token TEXT,
        verify_token_expires TEXT,
        token_expires_at TEXT,
        failed_logins INTEGER DEFAULT 0,
        locked_until TEXT
    )""")
    # ── Mi Garage ──────────────────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS mi_garage (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      TEXT NOT NULL,
        marca           TEXT NOT NULL,
        modelo          TEXT NOT NULL,
        version         TEXT,
        anio            INTEGER,
        combustible     TEXT,
        litros_tanque   REAL,
        consumo_ciudad  REAL,
        consumo_mixto   REAL,
        consumo_ruta    REAL,
        es_principal    INTEGER DEFAULT 0,
        origen          TEXT DEFAULT 'usuario',
        estado          TEXT DEFAULT 'activo',
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
    )""")

    # ── Viajes guardados ───────────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS viajes_guardados (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      TEXT NOT NULL,
        from_ciudad     TEXT NOT NULL,
        to_ciudad       TEXT NOT NULL,
        distancia_km    INTEGER,
        duracion_min    INTEGER,
        consumo_kml     REAL,
        tanque_l        REAL,
        producto        TEXT,
        litros_inicio   REAL DEFAULT 0,
        datos_json      TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
    )""")

    # ── Contribuciones de consumo (crowdsourcing) ───────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS contribuciones_consumo (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      TEXT,
        ip_reporter     TEXT,
        marca           TEXT NOT NULL,
        modelo          TEXT NOT NULL,
        version         TEXT,
        anio            INTEGER,
        combustible     TEXT,
        consumo_ciudad  REAL,
        consumo_mixto   REAL,
        consumo_ruta    REAL,
        litros_tanque   REAL,
        km_propios      INTEGER,
        notas           TEXT,
        estado          TEXT DEFAULT 'pendiente',
        confianza       REAL,
        created_at      TEXT DEFAULT (datetime('now'))
    )""")

    # ── Contacto publicidad ────────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS contacto_publicidad (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        empresa TEXT,
        email TEXT NOT NULL,
        telefono TEXT,
        tipo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        respondido INTEGER DEFAULT 0
    )""")

    # ── Feedback de usuarios ───────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS feedback_usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        voto TEXT NOT NULL,
        mensaje TEXT,
        pagina TEXT,
        usuario_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""")

    # ── Bitácora de viajes ─────────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS bitacoras_viaje (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      TEXT NOT NULL,
        vehiculo_id     INTEGER,
        origen          TEXT NOT NULL,
        destino         TEXT NOT NULL,
        fecha_inicio    TEXT NOT NULL,
        fecha_fin       TEXT,
        km_recorridos   REAL,
        litros_cargados REAL,
        precio_litro    REAL,
        costo_total     REAL,
        tiempo_min      INTEGER,
        clima_origen    TEXT,
        notas           TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bit_user ON bitacoras_viaje(usuario_id)")

    # ── Mantenimiento vehicular ────────────────────────────────────────────
    conn.execute("""CREATE TABLE IF NOT EXISTS mantenimiento_vehiculo (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id       TEXT NOT NULL,
        vehiculo_id      INTEGER NOT NULL,
        tipo             TEXT NOT NULL,
        fecha            TEXT NOT NULL,
        km_vehiculo      INTEGER,
        km_proximo       INTEGER,
        fecha_proxima    TEXT,
        costo            REAL,
        taller_nombre    TEXT,
        taller_localidad TEXT,
        taller_provincia TEXT,
        taller_telefono  TEXT,
        notas            TEXT,
        created_at       TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mant_user ON mantenimiento_vehiculo(usuario_id, vehiculo_id)")

    # Migrate existing DB — add new columns if they don't exist yet
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(usuarios)")}
    new_cols = {
        "password_hash": "TEXT",
        "verified_mail": "INTEGER DEFAULT 0",
        "verify_token": "TEXT",
        "verify_token_expires": "TEXT",
        "token_expires_at": "TEXT",
        "failed_logins": "INTEGER DEFAULT 0",
        "locked_until": "TEXT",
    }
    for col, definition in new_cols.items():
        if col not in existing_cols:
            conn.execute(f"ALTER TABLE usuarios ADD COLUMN {col} {definition}")

    # Migrate mi_garage — add km, seguro, maintenance columns
    garage_new_cols = [
        "ALTER TABLE mi_garage ADD COLUMN km_actual INTEGER",
        "ALTER TABLE mi_garage ADD COLUMN km_ultimo_aceite INTEGER",
        "ALTER TABLE mi_garage ADD COLUMN fecha_ultimo_aceite TEXT",
        "ALTER TABLE mi_garage ADD COLUMN intervalo_aceite_km INTEGER DEFAULT 10000",
        "ALTER TABLE mi_garage ADD COLUMN vencimiento_vtv TEXT",
        "ALTER TABLE mi_garage ADD COLUMN vencimiento_seguro TEXT",
        "ALTER TABLE mi_garage ADD COLUMN costo_seguro REAL",
        "ALTER TABLE mi_garage ADD COLUMN aseguradora TEXT",
        "ALTER TABLE mi_garage ADD COLUMN cobertura_seguro TEXT",
    ]
    for sql in garage_new_cols:
        try:
            conn.execute(sql)
        except Exception:
            pass

    conn.commit()
    return conn


def _usuario_dict(row) -> dict:
    d = dict(row)
    try:
        d["preferencias"] = json.loads(d.get("preferencias") or "[]")
    except Exception:
        d["preferencias"] = []
    # Never expose sensitive fields
    for k in ("password_hash", "verify_token", "verify_token_expires", "locked_until"):
        d.pop(k, None)
    return d


def _verify_turnstile(token: str, remote_ip: str = "") -> bool:
    """Validate Cloudflare Turnstile CAPTCHA token. Returns True if valid."""
    if not TURNSTILE_SECRET:
        return True  # dev mode: skip verification if no secret configured
    try:
        r = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": TURNSTILE_SECRET, "response": token, "remoteip": remote_ip},
            timeout=5,
        )
        return r.json().get("success", False)
    except Exception:
        return False


def _check_lockout(row):
    locked = row["locked_until"] if isinstance(row, dict) else (row["locked_until"] if "locked_until" in row.keys() else None)
    if locked and locked > datetime.utcnow().isoformat():
        raise HTTPException(status_code=429, detail="Cuenta bloqueada temporalmente. Intentá en 1 hora.")


def _register_failed_login(conn, user_id: str):
    conn.execute("UPDATE usuarios SET failed_logins = failed_logins + 1 WHERE id = ?", (user_id,))
    row = conn.execute("SELECT failed_logins FROM usuarios WHERE id = ?", (user_id,)).fetchone()
    if row and row["failed_logins"] >= 10:
        locked = (datetime.utcnow() + timedelta(hours=1)).isoformat()
        conn.execute("UPDATE usuarios SET locked_until = ? WHERE id = ?", (locked, user_id))
    conn.commit()


def _clear_failed_logins(conn, user_id: str):
    conn.execute("UPDATE usuarios SET failed_logins = 0, locked_until = NULL WHERE id = ?", (user_id,))
    conn.commit()


def _send_verification_email(mail: str, token: str):
    """Send email verification link via Resend API."""
    if not RESEND_API_KEY or not mail:
        return
    verify_url = f"https://tankear.com.ar/verificar?token={token}"
    try:
        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("FROM_EMAIL", "noreply@tankear.com.ar"),
                "to": [mail],
                "subject": "Verificá tu cuenta en Tankear 🚗⛽",
                "html": f"""
                <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;">
                  <h2 style="color:#f59e0b;">¡Bienvenido a Tankear!</h2>
                  <p>Para activar tu cuenta hacé click en el botón:</p>
                  <a href="{verify_url}"
                     style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:700;
                            padding:12px 24px;border-radius:8px;text-decoration:none;margin:16px 0;">
                    Verificar mi cuenta
                  </a>
                  <p style="color:#64748b;font-size:12px;">Este link expira en 24 horas.</p>
                </div>""",
            },
            timeout=8,
        )
    except Exception:
        pass  # Email failure doesn't block registration


def _get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")
    token = auth[7:].strip()
    conn = usuarios_db()
    row = conn.execute("SELECT * FROM usuarios WHERE token = ?", (token,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    # Check token expiry
    expires = row["token_expires_at"] if "token_expires_at" in row.keys() else None
    if expires and expires < datetime.utcnow().isoformat():
        raise HTTPException(status_code=401, detail="Sesión expirada, volvé a ingresar")
    return _usuario_dict(row)


@app.post("/usuarios/registro")
@limiter.limit("5/minute")
async def registro_usuario(request: Request):
    body = await request.json()
    mail     = (body.get("mail") or "").strip().lower() or None
    password = (body.get("password") or "").strip()
    captcha  = (body.get("captcha_token") or "").strip()

    if not mail:
        raise HTTPException(status_code=400, detail="El email es requerido")
    if not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    # Validate CAPTCHA (skipped in dev mode if no secret configured)
    client_ip = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For") or ""
    if not _verify_turnstile(captcha, client_ip):
        raise HTTPException(status_code=400, detail="Verificación de seguridad fallida. Recargá la página.")

    # Hash password with bcrypt (cost 12)
    password_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(rounds=12)).decode()

    # Generate session token + verification token
    usuario_id    = str(uuid.uuid4())
    token         = secrets.token_hex(32)
    verify_token  = secrets.token_urlsafe(32)
    verify_expiry = (datetime.utcnow() + timedelta(hours=24)).isoformat()
    token_expiry  = (datetime.utcnow() + timedelta(days=30)).isoformat()
    preferencias  = json.dumps(body.get("preferencias") or ["precios"], ensure_ascii=False)

    # Si hay Resend configurado, el usuario debe verificar su email antes de poder ingresar.
    # Si no hay Resend (dev local), auto-verificar.
    verified = 0 if RESEND_API_KEY else 1

    conn = usuarios_db()
    try:
        conn.execute(
            """INSERT INTO usuarios
               (id, mail, celular, provincia, localidad,
                auto_marca, auto_modelo, auto_anio, combustible_preferido, preferencias,
                token, token_expires_at, password_hash, verified_mail, verify_token, verify_token_expires)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (usuario_id, mail, body.get("celular") or None,
             body.get("provincia") or None, body.get("localidad") or None,
             body.get("auto_marca") or None, body.get("auto_modelo") or None,
             body.get("auto_anio") or None, body.get("combustible_preferido") or None,
             preferencias, token, token_expiry,
             password_hash, verified, verify_token, verify_expiry))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        # Anti-enumeration: same error regardless of whether email exists
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email")

    # Si el usuario registró su auto, agregarlo al garage automáticamente
    if body.get("auto_marca") and body.get("auto_modelo"):
        conn.execute("""
            INSERT INTO mi_garage
                (usuario_id, marca, modelo, anio, combustible, es_principal, origen)
            VALUES (?, ?, ?, ?, ?, 1, 'registro')
        """, (usuario_id, body.get("auto_marca"), body.get("auto_modelo"),
              body.get("auto_anio") or None, body.get("combustible_preferido") or None))
        conn.commit()

    row = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()

    # Enviar email de verificación (no el de newsletter — ese es para suscriptores)
    if mail and RESEND_API_KEY:
        threading.Thread(target=_send_verification_email, args=(mail, verify_token), daemon=True).start()

    if verified:
        # Dev local sin Resend: devolver token inmediatamente
        return {"token": token, "usuario": _usuario_dict(row), "nuevo": True}
    else:
        # Producción: el usuario debe verificar su email antes de poder ingresar
        return {"nuevo": True, "pendiente_verificacion": True, "mail": mail,
                "mensaje": "Te enviamos un email a " + mail + ". Verificá tu cuenta para poder ingresar."}


@app.get("/verificar")
async def verificar_email(token: str = None):
    """Email verification endpoint. Called via link in verification email."""
    if not token:
        raise HTTPException(status_code=400, detail="Token requerido")
    conn = usuarios_db()
    row = conn.execute(
        "SELECT * FROM usuarios WHERE verify_token = ?", (token,)
    ).fetchone()
    if not row:
        conn.close()
        return RedirectResponse(url="https://tankear.com.ar/?verificado=error")
    # Check expiry
    expires = row["verify_token_expires"] if "verify_token_expires" in row.keys() else ""
    if expires and expires < datetime.utcnow().isoformat():
        conn.close()
        return RedirectResponse(url="https://tankear.com.ar/?verificado=expirado")
    # Mark as verified, clear token
    conn.execute(
        "UPDATE usuarios SET verified_mail = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?",
        (row["id"],)
    )
    conn.commit()
    conn.close()
    return RedirectResponse(url="https://tankear.com.ar/?verificado=1")


@app.post("/usuarios/login")
@limiter.limit("5/minute")
async def login_usuario(request: Request):
    body     = await request.json()
    mail     = (body.get("mail") or "").strip().lower()
    password = (body.get("password") or "")

    if not mail or not password:
        raise _AUTH_ERROR

    conn = usuarios_db()
    row = conn.execute("SELECT * FROM usuarios WHERE mail = ?", (mail,)).fetchone()

    if not row or not row["password_hash"]:
        # Timing-safe: always run bcrypt even on miss to prevent timing attacks
        _bcrypt.checkpw(b"dummy_password", b"$2b$12$aaaaaaaaaaaaaaaaaaaaauGQOfFqW5dR4aCCGH7d78")
        conn.close()
        raise _AUTH_ERROR  # Don't reveal if email exists

    _check_lockout(row)  # 429 if locked

    if not _bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        _register_failed_login(conn, row["id"])
        conn.close()
        raise _AUTH_ERROR

    if not row["verified_mail"]:
        conn.close()
        raise HTTPException(status_code=403, detail="Verificá tu email antes de ingresar")

    # Rotate token if expired
    token = row["token"]
    expires = row["token_expires_at"] if "token_expires_at" in row.keys() else None
    if not token or (expires and expires < datetime.utcnow().isoformat()):
        token = secrets.token_hex(32)
        new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        conn.execute(
            "UPDATE usuarios SET token = ?, token_expires_at = ? WHERE id = ?",
            (token, new_expiry, row["id"])
        )

    _clear_failed_logins(conn, row["id"])
    conn.execute("UPDATE usuarios SET last_seen = datetime('now') WHERE id = ?", (row["id"],))
    conn.commit()
    conn.close()
    return {"token": token, "usuario": _usuario_dict(row)}


@app.get("/usuarios/me")
async def get_me(request: Request):
    user = _get_current_user(request)
    conn = usuarios_db()
    conn.execute("UPDATE usuarios SET last_seen = datetime('now') WHERE id = ?", (user["id"],))
    conn.commit()
    conn.close()
    return user


@app.put("/usuarios/perfil")
@limiter.limit("20/minute")
async def actualizar_perfil(request: Request):
    user = _get_current_user(request)
    body = await request.json()

    campos: dict = {}
    for field in ["provincia", "localidad", "auto_marca", "auto_modelo", "auto_anio", "combustible_preferido"]:
        if field in body:
            campos[field] = body[field] or None
    if "preferencias" in body:
        campos["preferencias"] = json.dumps(body["preferencias"] or [], ensure_ascii=False)

    if not campos:
        return user

    set_clause = ", ".join(f"{k} = ?" for k in campos)
    values     = list(campos.values()) + [user["id"]]

    conn = usuarios_db()
    conn.execute(f"UPDATE usuarios SET {set_clause}, last_seen = datetime('now') WHERE id = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM usuarios WHERE id = ?", (user["id"],)).fetchone()
    conn.close()
    return _usuario_dict(row)


# ── ADMIN (JWT) ───────────────────────────────────────────────────────────────
@app.post("/admin/login")
async def admin_login(form: OAuth2PasswordRequestForm = Depends()):
    if form.username != ADMIN_USER or not verify_password(form.password, ADMIN_HASH):
        raise HTTPException(status_code=401, detail="Usuario o contrasena incorrectos")
    return {"access_token": create_token({"sub": form.username}), "token_type": "bearer"}


@app.get("/admin/leads")
def admin_leads(admin=Depends(get_current_admin), page: int = 1, limit: int = 50):
    conn    = leads_db()
    offset  = (page - 1) * limit
    total   = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    rows    = conn.execute(
        "SELECT * FROM leads ORDER BY fecha_registro DESC LIMIT ? OFFSET ?",
        (limit, offset)).fetchall()
    conn.close()
    return {"total": total, "page": page, "leads": [dict(r) for r in rows]}


@app.get("/admin/stats")
def admin_stats(admin=Depends(get_current_admin)):
    conn   = leads_db()
    total  = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    hoy    = conn.execute("SELECT COUNT(*) FROM leads WHERE date(fecha_registro)=date('now')").fetchone()[0]
    semana = conn.execute("SELECT COUNT(*) FROM leads WHERE fecha_registro >= datetime('now','-7 days')").fetchone()[0]
    pag    = [dict(r) for r in conn.execute(
        "SELECT pagina_origen, COUNT(*) as total FROM leads GROUP BY pagina_origen").fetchall()]
    conn.close()
    return {"total_leads": total, "hoy": hoy, "ultima_semana": semana, "por_pagina": pag}


# ── NOTICIAS ──────────────────────────────────────────────────────────────────
_news_cache: dict = {"ar": {"data": [], "ts": 0.0}, "mundo": {"data": [], "ts": 0.0}}
NEWS_TTL = 1800  # 30 minutos

NEWS_FEEDS_AR = [
    "https://news.google.com/rss/search?q=precio+nafta+argentina&hl=es-419&gl=AR&ceid=AR:es-419",
    "https://news.google.com/rss/search?q=combustible+YPF+Shell+Axion+argentina&hl=es-419&gl=AR&ceid=AR:es-419",
    "https://news.google.com/rss/search?q=suba+nafta+gasoil+argentina&hl=es-419&gl=AR&ceid=AR:es-419",
]

_QUERY_AR = {
    "q":        'YPF OR nafta OR gasoil OR "Vaca Muerta" OR "combustible Argentina" OR "precio nafta" OR "suba nafta" OR "Shell Argentina" OR "Axion"',
    "language": "es",
    "pageSize": 12,
}
_QUERY_MUNDO = {
    "q":        'OPEC "crude oil" OR "oil price" OR "petrol price" OR "Strait of Hormuz" OR "Russia oil" OR "Saudi Arabia oil" OR "oil production" OR "Brent" OR "WTI"',
    "language": "en",
    "pageSize": 12,
}

FUEL_KEYWORDS_ES = {
    "nafta", "gasoil", "combustible", "ypf", "shell", "axion", "petróleo", "petroleo",
    "vaca muerta", "gasolina", "litro", "surtidor", "estación de servicio", "diesel",
    "hidrocarburo", "refinería", "refineria", "gnc", "gas natural", "shale",
}
FUEL_KEYWORDS_EN = {
    "oil", "fuel", "gasoline", "petrol", "opec", "crude", "barrel", "brent", "wti",
    "refinery", "hydrocarbon", "shale", "pipeline", "energy price", "gas price",
}

# Dominios NO argentinos que pueden filtrarse en tab AR
_NON_AR_DOMAINS = {"elpais.com", "elmundo.es", "abc.es", "lavanguardia.com",
                   "elobservador.com.uy", "elpais.com.uy", "bbc.com", "reuters.com",
                   "apnews.com", "theguardian.com"}


def _is_relevant(titulo: str, descripcion: str, language: str) -> bool:
    text = (titulo + " " + descripcion).lower()
    kws  = FUEL_KEYWORDS_ES if language == "es" else FUEL_KEYWORDS_EN
    return any(kw in text for kw in kws)


def _fetch_newsapi_pais(pais: str) -> list:
    if not NEWSAPI_KEY:
        return []
    query    = _QUERY_AR if pais == "ar" else _QUERY_MUNDO
    language = "es" if pais == "ar" else "en"
    try:
        r = requests.get(
            "https://newsapi.org/v2/everything",
            params={**query, "sortBy": "publishedAt", "apiKey": NEWSAPI_KEY},
            timeout=10,
        )
        data = r.json()
        if data.get("status") != "ok":
            print(f"[NEWSAPI/{pais.upper()}] {data.get('message')}")
            return []
        # Dominios que son explícitamente de Uruguay o España — NO de Argentina
        _NON_AR_SOURCES = {
            "elpais.com.uy","elobservador.com.uy","montevideo.com.uy",
            "espectador.com","radiomontevideo.com.uy","180.com.uy",
            "elmundo.es","elpais.com","abc.es","lavanguardia.com","elconfidencial.com",
            "lavozdegalicia.es","elcorreo.com","cinco-dias.com",
            "elfinanciero.com.mx","expansion.mx","milenio.com","eluniversal.com.mx",
        }

        from urllib.parse import urlparse as _urlparse

        articles, seen = [], set()
        for art in data.get("articles", []):
            titulo = (art.get("title") or "").strip()
            desc   = (art.get("description") or "").strip()
            url_art = art.get("url", "")
            if not titulo or titulo == "[Removed]":
                continue
            if not _is_relevant(titulo, desc, language):
                continue
            # Para tab AR: excluir fuentes claramente no-argentinas
            if pais == "ar":
                try:
                    domain = _urlparse(url_art).netloc.replace("www.", "").lower()
                    if any(domain == d or domain.endswith("." + d) for d in _NON_AR_SOURCES):
                        continue
                except Exception:
                    pass
            key = titulo.lower()[:60]
            if key in seen:
                continue
            seen.add(key)
            articles.append({
                "titulo":      titulo,
                "fuente":      art.get("source", {}).get("name", ""),
                "url":         url_art,
                "fecha":       art.get("publishedAt", ""),
                "imagen":      art.get("urlToImage") or "",
                "descripcion": desc[:160],
                "pais":        pais,
            })
        articles.sort(key=lambda a: a.get("fecha", ""), reverse=True)
        print(f"[NEWSAPI/{pais.upper()}] {len(articles)} artículos")
        return articles
    except Exception as e:
        print(f"[NEWSAPI/{pais.upper()}] Error: {e}")
        return []


def _parse_google_news_rss(url: str) -> list:
    try:
        r = requests.get(url, timeout=8, headers={"User-Agent": "Tankear/3.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        articles = []
        for item in root.findall(".//item"):
            title_raw = (item.findtext("title") or "").strip()
            link      = (item.findtext("link") or "").strip()
            pub_date  = (item.findtext("pubDate") or "").strip()
            source_el = item.find("{https://news.google.com/rss}source")
            source    = source_el.text if source_el is not None else ""

            if not source and " - " in title_raw:
                parts  = title_raw.rsplit(" - ", 1)
                titulo = parts[0].strip()
                source = parts[1].strip()
            else:
                titulo = title_raw

            if not titulo or not link:
                continue

            # Filtrar dominios no argentinos en RSS
            from urllib.parse import urlparse
            domain = urlparse(link).netloc.replace("www.", "")
            if any(domain.endswith(d) for d in _NON_AR_DOMAINS):
                continue

            articles.append({"titulo": titulo, "fuente": source, "url": link, "fecha": pub_date})
        return articles
    except Exception as e:
        print(f"[NEWS] Error feed {url}: {e}")
        return []


@app.get("/estacion/{slug}")
def get_estacion(slug: str):
    """
    Busca una estación por su slug URL.
    El slug tiene formato: {bandera/empresa}-{localidad}-{direccion}
    Hacemos un match fuzzy usando las partes del slug.
    """
    import unicodedata, re
    def slugify(s: str) -> str:
        s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
        return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

    # Extraemos términos del slug para buscar
    slug_clean = slug.lower()[:120]
    # Intentar primero con la API externa
    try:
        # Buscamos por partes del slug como palabras clave
        parts = [p for p in slug_clean.split('-') if len(p) > 2]
        # Usamos los primeros términos para buscar empresa/localidad
        localidad_hint = ''
        empresa_hint   = ''
        for part in parts:
            if len(part) >= 3:
                empresa_hint = part
                break
        for part in reversed(parts[1:5]):
            if len(part) >= 3:
                localidad_hint = part
                break

        r = requests.get(API_URL,
            params={"resource_id": RESOURCE_ID, "limit": 5000},
            headers={"User-Agent": "Tankear/3.0"}, timeout=30)
        r.raise_for_status()
        records = r.json().get("result", {}).get("records", [])

        best, best_score = None, 0
        for rec in records:
            rec_slug = slugify(
                f"{rec.get('empresabandera') or rec.get('empresa','')} "
                f"{rec.get('localidad','')} "
                f"{rec.get('direccion','')}"
            )
            # Count matching slug tokens
            score = sum(1 for tok in slug_clean.split('-') if tok and tok in rec_slug)
            if score > best_score:
                best_score = score
                best = rec

        if best and best_score >= 2:
            # Agrupa todos los productos de esa estación
            key_e = best.get('empresa','')
            key_d = best.get('direccion','')
            productos = []
            seen_prods = set()
            for rec in records:
                if rec.get('empresa') == key_e and rec.get('direccion') == key_d:
                    prod = rec.get('producto','')
                    if prod not in seen_prods:
                        seen_prods.add(prod)
                        try:
                            precio = float(str(rec.get('precio',0)).replace(',','.'))
                        except Exception:
                            precio = 0.0
                        productos.append({
                            "producto":       prod,
                            "precio":         precio,
                            "fecha_vigencia": rec.get('fecha_vigencia',''),
                        })
            try:
                lat = float(best.get('latitud') or 0) or None
                lon = float(best.get('longitud') or 0) or None
            except Exception:
                lat = lon = None
            return {
                "empresa":   best.get('empresa',''),
                "bandera":   best.get('empresabandera') or best.get('empresa',''),
                "direccion": best.get('direccion',''),
                "localidad": best.get('localidad',''),
                "provincia": best.get('provincia','').replace('CAPITAL FEDERAL','CABA'),
                "latitud":   lat,
                "longitud":  lon,
                "productos": productos,
            }
    except Exception as e:
        print(f"[estacion/{slug}] Error: {e}")

    raise HTTPException(status_code=404, detail="Estación no encontrada")


from fastapi.responses import Response as FastAPIResponse

_sitemap_cache: dict = {"xml": "", "ts": 0.0}
SITEMAP_TTL = 86400  # 24 horas

@app.get("/sitemap.xml", include_in_schema=False)
def sitemap():
    global _sitemap_cache
    if time.time() - _sitemap_cache["ts"] < SITEMAP_TTL and _sitemap_cache["xml"]:
        return FastAPIResponse(content=_sitemap_cache["xml"], media_type="application/xml")

    import unicodedata, re
    def slugify(s: str) -> str:
        s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
        return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

    base = "https://tankear.com.ar"
    urls = [
        f"<url><loc>{base}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>",
    ]

    PROVINCIAS = [
        "BUENOS AIRES","CIUDAD AUTÓNOMA DE BUENOS AIRES","CÓRDOBA","SANTA FE",
        "MENDOZA","TUCUMÁN","NEUQUÉN","SALTA","ENTRE RÍOS","CORRIENTES",
        "MISIONES","CHACO","FORMOSA","SANTIAGO DEL ESTERO","SAN JUAN",
        "SAN LUIS","LA PAMPA","LA RIOJA","CATAMARCA","JUJUY","RÍO NEGRO",
        "CHUBUT","SANTA CRUZ","TIERRA DEL FUEGO",
    ]
    for prov in PROVINCIAS:
        pslug = slugify(prov)
        urls.append(
            f"<url><loc>{base}/precios/{pslug}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>"
        )

    # Añadir estaciones (sample — top 500)
    try:
        r = requests.get(API_URL,
            params={"resource_id": RESOURCE_ID, "limit": 500},
            headers={"User-Agent": "Tankear/3.0"}, timeout=30)
        r.raise_for_status()
        records = r.json().get("result", {}).get("records", [])
        seen = set()
        for rec in records:
            key = f"{rec.get('empresa','')}|{rec.get('direccion','')}"
            if key in seen:
                continue
            seen.add(key)
            slug = slugify(
                f"{rec.get('empresabandera') or rec.get('empresa','')} "
                f"{rec.get('localidad','')} "
                f"{rec.get('direccion','')}"
            )
            if slug:
                urls.append(
                    f"<url><loc>{base}/estacion/{slug}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>"
                )
    except Exception as e:
        print(f"[sitemap] Error fetching stations: {e}")

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml += '\n'.join(urls)
    xml += '\n</urlset>'

    _sitemap_cache = {"xml": xml, "ts": time.time()}
    return FastAPIResponse(content=xml, media_type="application/xml")


@app.get("/noticias")
def get_noticias(pais: str = Query(default="ar")):
    global _news_cache
    pais = pais.lower() if pais in ("ar", "mundo") else "ar"

    bucket = _news_cache.get(pais, {"data": [], "ts": 0.0})
    if time.time() - bucket["ts"] < NEWS_TTL and bucket["data"]:
        return {"noticias": bucket["data"], "cached": True, "pais": pais}

    articles = _fetch_newsapi_pais(pais)

    # Para Argentina: siempre complementar con RSS (no solo como fallback)
    if pais == "ar":
        seen = {a["titulo"].lower()[:60] for a in articles}
        for url in NEWS_FEEDS_AR:
            for art in _parse_google_news_rss(url):
                key = art["titulo"].lower()[:60]
                if key not in seen:
                    seen.add(key)
                    articles.append(art)
            if len(articles) >= 20:
                break
        # Ordenar por fecha descendente
        def _sort_key(a):
            try:
                return a.get("fecha") or ""
            except Exception:
                return ""
        articles.sort(key=_sort_key, reverse=True)

    articles = articles[:15]
    _news_cache[pais] = {"data": articles, "ts": time.time()}
    return {"noticias": articles, "cached": False, "pais": pais, "source": "newsapi+rss" if (NEWSAPI_KEY and pais == "ar") else ("newsapi" if NEWSAPI_KEY else "rss")}


# ── HISTÓRICO DE PRECIOS ─────────────────────────────────────────────────────

@app.get("/precios/historial", tags=["Precios"])
def precios_historial(
    provincia: Optional[str] = None,
    localidad: Optional[str] = None,
    producto: Optional[str] = None,
    days: int = Query(default=90, le=365),
):
    """Serie temporal de precios promedio por día (para gráficos de evolución)."""
    data = db.get_price_history(provincia=provincia, localidad=localidad,
                                producto=producto, days=days)
    return {"dias": days, "total": len(data), "serie": data}


# ── COMUNIDAD ────────────────────────────────────────────────────────────────

@app.post("/comunidad/reporte", tags=["Comunidad"])
@limiter.limit("10/hour")
def crear_reporte(request: Request, body: ReporteEstacionIn):
    """Reportar que una estación cerró, no existe, o tiene error de ubicación."""
    ip = get_client_ip(request)

    # Anti-spam: 1 reporte por estación por IP cada 24h
    if db.has_recent_reporte(ip, body.empresa, body.direccion):
        raise HTTPException(status_code=429, detail="Ya reportaste esta estación en las últimas 24h")

    data = body.dict()
    data["ip_reporter"] = ip
    id_ = db.create_reporte_estacion(data)
    return {"id": id_, "status": "ok", "mensaje": "Gracias por tu reporte. Lo vamos a revisar."}


@app.get("/comunidad/reportes", tags=["Comunidad"])
def listar_reportes(
    empresa: Optional[str] = None,
    direccion: Optional[str] = None,
    provincia: Optional[str] = None,
    limit: int = Query(default=50, le=200),
):
    """Ver reportes de la comunidad sobre estaciones."""
    reportes = db.get_reportes_estacion(empresa=empresa, direccion=direccion,
                                        provincia=provincia, limit=limit)
    return {"total": len(reportes), "reportes": reportes}


@app.post("/comunidad/precio", tags=["Comunidad"])
@limiter.limit("20/hour")
def reportar_precio(request: Request, body: PrecioComunidadIn):
    """Reportar un precio actualizado para una estación (contribución de la comunidad)."""
    ip = get_client_ip(request)

    # Anti-spam: 1 reporte por estación+producto por IP cada 24h
    if db.has_recent_precio(ip, body.empresa, body.direccion, body.producto):
        raise HTTPException(status_code=429, detail="Ya reportaste el precio de este producto en las últimas 24h")

    data = body.dict()
    data["ip_reporter"] = ip
    id_ = db.create_precio_comunidad(data)
    return {"id": id_, "status": "ok", "mensaje": "Gracias por actualizar el precio."}


@app.get("/comunidad/precios", tags=["Comunidad"])
def listar_precios_comunidad(
    empresa: Optional[str] = None,
    direccion: Optional[str] = None,
    provincia: Optional[str] = None,
    producto: Optional[str] = None,
    days: int = Query(default=30, le=90),
    limit: int = Query(default=50, le=200),
):
    """Ver precios reportados por la comunidad."""
    precios = db.get_precios_comunidad(empresa=empresa, direccion=direccion,
                                       provincia=provincia, producto=producto,
                                       days=days, limit=limit)
    return {"total": len(precios), "precios": precios}


@app.get("/comunidad/estacion", tags=["Comunidad"])
def info_comunidad_estacion(empresa: str, direccion: str):
    """Toda la info de comunidad para una estación específica."""
    reportes = db.get_reportes_estacion(empresa=empresa, direccion=direccion, limit=10)
    precios = db.get_precios_comunidad(empresa=empresa, direccion=direccion, limit=20)
    n_reportes = db.count_reportes_activos(empresa, direccion)
    return {
        "reportes": reportes,
        "precios_comunidad": precios,
        "total_reportes_activos": n_reportes,
        "posible_cerrada": n_reportes >= 3,
    }


# ── MI GARAGE ────────────────────────────────────────────────────────────────

@app.get("/garage", tags=["Garage"])
async def listar_garage(request: Request):
    """Devuelve los vehículos del usuario autenticado."""
    user = _get_current_user(request)
    conn = usuarios_db()
    rows = conn.execute("""
        SELECT * FROM mi_garage
        WHERE usuario_id = ? AND estado = 'activo'
        ORDER BY es_principal DESC, created_at ASC
    """, (user["id"],)).fetchall()
    conn.close()
    return {"vehiculos": [dict(r) for r in rows]}


@app.post("/garage", tags=["Garage"])
@limiter.limit("10/hour")
async def agregar_al_garage(request: Request, vehiculo: GarageVehiculoIn):
    """Agrega un vehículo al garage del usuario. Máximo 5 por cuenta."""
    user = _get_current_user(request)
    conn = usuarios_db()

    conteo = conn.execute(
        "SELECT COUNT(*) FROM mi_garage WHERE usuario_id = ? AND estado = 'activo'",
        (user["id"],)
    ).fetchone()[0]
    if conteo >= 5:
        conn.close()
        raise HTTPException(status_code=400, detail="Máximo 5 vehículos por cuenta. Eliminá uno antes de agregar otro.")

    if vehiculo.es_principal:
        conn.execute("UPDATE mi_garage SET es_principal = 0 WHERE usuario_id = ?", (user["id"],))

    cur = conn.execute("""
        INSERT INTO mi_garage
            (usuario_id, marca, modelo, version, anio, combustible,
             litros_tanque, consumo_ciudad, consumo_mixto, consumo_ruta, es_principal, origen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usuario')
    """, (user["id"], vehiculo.marca, vehiculo.modelo, vehiculo.version,
          vehiculo.anio, vehiculo.combustible, vehiculo.litros_tanque,
          vehiculo.consumo_ciudad, vehiculo.consumo_mixto, vehiculo.consumo_ruta,
          int(vehiculo.es_principal)))

    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM mi_garage WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return dict(row)


@app.put("/garage/{vehiculo_id}", tags=["Garage"])
@limiter.limit("20/hour")
async def editar_vehiculo(request: Request, vehiculo_id: int, vehiculo: GarageVehiculoIn):
    """Edita un vehículo del garage. Solo el dueño puede hacerlo."""
    user = _get_current_user(request)
    conn = usuarios_db()

    row = conn.execute(
        "SELECT * FROM mi_garage WHERE id = ? AND usuario_id = ? AND estado = 'activo'",
        (vehiculo_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    if vehiculo.es_principal:
        conn.execute("UPDATE mi_garage SET es_principal = 0 WHERE usuario_id = ?", (user["id"],))

    conn.execute("""
        UPDATE mi_garage SET
            marca = ?, modelo = ?, version = ?, anio = ?, combustible = ?,
            litros_tanque = ?, consumo_ciudad = ?, consumo_mixto = ?, consumo_ruta = ?,
            es_principal = ?,
            km_actual = ?, km_ultimo_aceite = ?, fecha_ultimo_aceite = ?,
            intervalo_aceite_km = ?, vencimiento_vtv = ?,
            vencimiento_seguro = ?, costo_seguro = ?, aseguradora = ?, cobertura_seguro = ?,
            updated_at = datetime('now')
        WHERE id = ? AND usuario_id = ?
    """, (vehiculo.marca, vehiculo.modelo, vehiculo.version, vehiculo.anio, vehiculo.combustible,
          vehiculo.litros_tanque, vehiculo.consumo_ciudad, vehiculo.consumo_mixto,
          vehiculo.consumo_ruta, int(vehiculo.es_principal),
          vehiculo.km_actual, vehiculo.km_ultimo_aceite, vehiculo.fecha_ultimo_aceite,
          vehiculo.intervalo_aceite_km, vehiculo.vencimiento_vtv,
          vehiculo.vencimiento_seguro, vehiculo.costo_seguro, vehiculo.aseguradora,
          vehiculo.cobertura_seguro,
          vehiculo_id, user["id"]))

    conn.commit()
    row = conn.execute("SELECT * FROM mi_garage WHERE id = ?", (vehiculo_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/garage/{vehiculo_id}", tags=["Garage"])
async def eliminar_vehiculo(request: Request, vehiculo_id: int):
    """Elimina (soft delete) un vehículo del garage."""
    user = _get_current_user(request)
    conn = usuarios_db()

    row = conn.execute(
        "SELECT id FROM mi_garage WHERE id = ? AND usuario_id = ? AND estado = 'activo'",
        (vehiculo_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    conn.execute(
        "UPDATE mi_garage SET estado = 'eliminado', updated_at = datetime('now') WHERE id = ?",
        (vehiculo_id,)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "eliminado": vehiculo_id}


@app.post("/garage/{vehiculo_id}/principal", tags=["Garage"])
async def set_vehiculo_principal(request: Request, vehiculo_id: int):
    """Marca un vehículo como el principal del usuario."""
    user = _get_current_user(request)
    conn = usuarios_db()

    row = conn.execute(
        "SELECT id FROM mi_garage WHERE id = ? AND usuario_id = ? AND estado = 'activo'",
        (vehiculo_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    conn.execute("UPDATE mi_garage SET es_principal = 0 WHERE usuario_id = ?", (user["id"],))
    conn.execute("UPDATE mi_garage SET es_principal = 1 WHERE id = ?", (vehiculo_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "principal": vehiculo_id}


@app.get("/garage/alertas", tags=["Garage"])
async def get_garage_alertas(request: Request):
    """Devuelve alertas activas de mantenimiento y seguro del usuario."""
    user = _get_current_user(request)
    conn = usuarios_db()
    rows = conn.execute("""
        SELECT * FROM mi_garage WHERE usuario_id = ? AND estado = 'activo'
    """, (user["id"],)).fetchall()
    conn.close()

    from datetime import date as _date
    today = _date.today()
    alertas = []

    for r in rows:
        v = dict(r)
        nombre = f"{v.get('marca','')} {v.get('modelo','')}".strip()

        # Aceite
        km_act = v.get("km_actual")
        km_ult = v.get("km_ultimo_aceite")
        intervalo = v.get("intervalo_aceite_km") or 10000
        if km_act is not None and km_ult is not None:
            km_desde = km_act - km_ult
            pct = km_desde / intervalo
            km_faltantes = max(0, intervalo - km_desde)
            urgencia = "urgente" if pct >= 1.0 else ("pronto" if pct >= 0.8 else "ok")
            if urgencia != "ok":
                alertas.append({
                    "tipo": "aceite",
                    "vehiculo_id": v["id"],
                    "vehiculo": nombre,
                    "km_desde_ultimo": km_desde,
                    "km_faltantes": km_faltantes,
                    "intervalo": intervalo,
                    "urgencia": urgencia,
                })

        # VTV
        vtv = v.get("vencimiento_vtv")
        if vtv:
            try:
                dias = (_date.fromisoformat(vtv) - today).days
                urgencia = "urgente" if dias <= 15 else ("pronto" if dias <= 30 else "ok")
                if urgencia != "ok":
                    alertas.append({
                        "tipo": "vtv",
                        "vehiculo_id": v["id"],
                        "vehiculo": nombre,
                        "dias_restantes": dias,
                        "vencimiento": vtv,
                        "urgencia": urgencia,
                    })
            except Exception:
                pass

        # Seguro
        seg = v.get("vencimiento_seguro")
        if seg:
            try:
                dias = (_date.fromisoformat(seg) - today).days
                urgencia = "urgente" if dias <= 15 else ("pronto" if dias <= 30 else "ok")
                if urgencia != "ok":
                    alertas.append({
                        "tipo": "seguro",
                        "vehiculo_id": v["id"],
                        "vehiculo": nombre,
                        "aseguradora": v.get("aseguradora"),
                        "dias_restantes": dias,
                        "vencimiento": seg,
                        "urgencia": urgencia,
                    })
            except Exception:
                pass

    return {"alertas": alertas, "total": len(alertas)}


# ── Bitácora de viajes ──────────────────────────────────────────────────────

@app.post("/bitacora", tags=["Bitácora"])
@limiter.limit("10/hour")
async def crear_bitacora(request: Request, entrada: BitacoraViajeIn):
    """Registra un viaje en la bitácora del usuario."""
    user = _get_current_user(request)
    conn = usuarios_db()
    cur = conn.execute("""
        INSERT INTO bitacoras_viaje
            (usuario_id, vehiculo_id, origen, destino, fecha_inicio, fecha_fin,
             km_recorridos, litros_cargados, precio_litro, costo_total,
             tiempo_min, clima_origen, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user["id"], entrada.vehiculo_id, entrada.origen, entrada.destino,
          entrada.fecha_inicio, entrada.fecha_fin,
          entrada.km_recorridos, entrada.litros_cargados, entrada.precio_litro,
          entrada.costo_total, entrada.tiempo_min, entrada.clima_origen, entrada.notas))
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM bitacoras_viaje WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/bitacora", tags=["Bitácora"])
async def listar_bitacora(request: Request):
    """Lista los viajes del usuario (últimos 50, más reciente primero)."""
    user = _get_current_user(request)
    conn = usuarios_db()
    rows = conn.execute("""
        SELECT * FROM bitacoras_viaje
        WHERE usuario_id = ?
        ORDER BY fecha_inicio DESC, created_at DESC
        LIMIT 50
    """, (user["id"],)).fetchall()
    conn.close()
    return {"entradas": [dict(r) for r in rows], "total": len(rows)}


@app.put("/bitacora/{entrada_id}", tags=["Bitácora"])
@limiter.limit("20/hour")
async def editar_bitacora(request: Request, entrada_id: int, entrada: BitacoraViajeIn):
    """Edita una entrada de la bitácora."""
    user = _get_current_user(request)
    conn = usuarios_db()
    row = conn.execute(
        "SELECT id FROM bitacoras_viaje WHERE id = ? AND usuario_id = ?",
        (entrada_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Entrada no encontrada")
    conn.execute("""
        UPDATE bitacoras_viaje SET
            vehiculo_id = ?, origen = ?, destino = ?, fecha_inicio = ?, fecha_fin = ?,
            km_recorridos = ?, litros_cargados = ?, precio_litro = ?, costo_total = ?,
            tiempo_min = ?, clima_origen = ?, notas = ?
        WHERE id = ? AND usuario_id = ?
    """, (entrada.vehiculo_id, entrada.origen, entrada.destino,
          entrada.fecha_inicio, entrada.fecha_fin,
          entrada.km_recorridos, entrada.litros_cargados, entrada.precio_litro,
          entrada.costo_total, entrada.tiempo_min, entrada.clima_origen, entrada.notas,
          entrada_id, user["id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM bitacoras_viaje WHERE id = ?", (entrada_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/bitacora/{entrada_id}", tags=["Bitácora"])
async def eliminar_bitacora(request: Request, entrada_id: int):
    """Elimina una entrada de la bitácora."""
    user = _get_current_user(request)
    conn = usuarios_db()
    row = conn.execute(
        "SELECT id FROM bitacoras_viaje WHERE id = ? AND usuario_id = ?",
        (entrada_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Entrada no encontrada")
    conn.execute("DELETE FROM bitacoras_viaje WHERE id = ?", (entrada_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "eliminado": entrada_id}


# ── Mantenimiento vehicular ─────────────────────────────────────────────────

@app.post("/mantenimiento", tags=["Mantenimiento"])
@limiter.limit("10/hour")
async def crear_mantenimiento(request: Request, mant: MantenimientoIn):
    """Registra un servicio de mantenimiento."""
    user = _get_current_user(request)
    conn = usuarios_db()
    # Verificar que el vehículo pertenece al usuario
    veh = conn.execute(
        "SELECT id FROM mi_garage WHERE id = ? AND usuario_id = ? AND estado = 'activo'",
        (mant.vehiculo_id, user["id"])
    ).fetchone()
    if not veh:
        conn.close()
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    cur = conn.execute("""
        INSERT INTO mantenimiento_vehiculo
            (usuario_id, vehiculo_id, tipo, fecha, km_vehiculo, km_proximo,
             fecha_proxima, costo, taller_nombre, taller_localidad,
             taller_provincia, taller_telefono, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user["id"], mant.vehiculo_id, mant.tipo, mant.fecha,
          mant.km_vehiculo, mant.km_proximo, mant.fecha_proxima, mant.costo,
          mant.taller_nombre, mant.taller_localidad, mant.taller_provincia,
          mant.taller_telefono, mant.notas))
    # Si es cambio de aceite, actualizar km_ultimo_aceite en mi_garage
    if mant.tipo == "aceite" and mant.km_vehiculo:
        conn.execute("""
            UPDATE mi_garage SET
                km_ultimo_aceite = ?, fecha_ultimo_aceite = ?, updated_at = datetime('now')
            WHERE id = ?
        """, (mant.km_vehiculo, mant.fecha, mant.vehiculo_id))
    # Si tiene km_proximo, actualizar km_actual si es mayor
    if mant.km_vehiculo:
        conn.execute("""
            UPDATE mi_garage SET km_actual = MAX(COALESCE(km_actual, 0), ?), updated_at = datetime('now')
            WHERE id = ?
        """, (mant.km_vehiculo, mant.vehiculo_id))
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM mantenimiento_vehiculo WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/mantenimiento", tags=["Mantenimiento"])
async def listar_mantenimiento(request: Request, vehiculo_id: Optional[int] = Query(None)):
    """Lista el historial de mantenimiento del usuario."""
    user = _get_current_user(request)
    conn = usuarios_db()
    if vehiculo_id:
        rows = conn.execute("""
            SELECT * FROM mantenimiento_vehiculo
            WHERE usuario_id = ? AND vehiculo_id = ?
            ORDER BY fecha DESC, created_at DESC
        """, (user["id"], vehiculo_id)).fetchall()
    else:
        rows = conn.execute("""
            SELECT * FROM mantenimiento_vehiculo
            WHERE usuario_id = ?
            ORDER BY fecha DESC, created_at DESC
            LIMIT 100
        """, (user["id"],)).fetchall()
    conn.close()
    return {"registros": [dict(r) for r in rows], "total": len(rows)}


@app.put("/mantenimiento/{mant_id}", tags=["Mantenimiento"])
@limiter.limit("20/hour")
async def editar_mantenimiento(request: Request, mant_id: int, mant: MantenimientoIn):
    """Edita un registro de mantenimiento."""
    user = _get_current_user(request)
    conn = usuarios_db()
    row = conn.execute(
        "SELECT id FROM mantenimiento_vehiculo WHERE id = ? AND usuario_id = ?",
        (mant_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    conn.execute("""
        UPDATE mantenimiento_vehiculo SET
            tipo = ?, fecha = ?, km_vehiculo = ?, km_proximo = ?, fecha_proxima = ?,
            costo = ?, taller_nombre = ?, taller_localidad = ?, taller_provincia = ?,
            taller_telefono = ?, notas = ?
        WHERE id = ? AND usuario_id = ?
    """, (mant.tipo, mant.fecha, mant.km_vehiculo, mant.km_proximo, mant.fecha_proxima,
          mant.costo, mant.taller_nombre, mant.taller_localidad, mant.taller_provincia,
          mant.taller_telefono, mant.notas, mant_id, user["id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM mantenimiento_vehiculo WHERE id = ?", (mant_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/mantenimiento/{mant_id}", tags=["Mantenimiento"])
async def eliminar_mantenimiento(request: Request, mant_id: int):
    """Elimina un registro de mantenimiento."""
    user = _get_current_user(request)
    conn = usuarios_db()
    row = conn.execute(
        "SELECT id FROM mantenimiento_vehiculo WHERE id = ? AND usuario_id = ?",
        (mant_id, user["id"])
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    conn.execute("DELETE FROM mantenimiento_vehiculo WHERE id = ?", (mant_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "eliminado": mant_id}


@app.post("/autos/contribucion", tags=["Garage"])
@limiter.limit("5/hour")
async def contribuir_consumo(request: Request, contrib: ContribucionConsumoIn):
    """
    Contribución de datos de consumo real de un auto.
    Disponible para usuarios registrados y anónimos (menor credibilidad).
    """
    user = None
    try:
        user = _get_current_user(request)
    except HTTPException:
        pass  # Contribuciones anónimas permitidas

    ip = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or ""
    conn = usuarios_db()

    # Anti-spam: máx 3 contribuciones por IP por día
    spam = conn.execute("""
        SELECT COUNT(*) FROM contribuciones_consumo
        WHERE ip_reporter = ? AND created_at >= datetime('now', '-1 day')
    """, (ip,)).fetchone()[0]
    if spam >= 3:
        conn.close()
        raise HTTPException(status_code=429, detail="Límite de contribuciones diarias alcanzado. Gracias por tu entusiasmo — volvé mañana.")

    cur = conn.execute("""
        INSERT INTO contribuciones_consumo
            (usuario_id, ip_reporter, marca, modelo, version, anio, combustible,
             consumo_ciudad, consumo_mixto, consumo_ruta, litros_tanque, km_propios, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user["id"] if user else None, ip,
          contrib.marca, contrib.modelo, contrib.version, contrib.anio, contrib.combustible,
          contrib.consumo_ciudad, contrib.consumo_mixto, contrib.consumo_ruta,
          contrib.litros_tanque, contrib.km_propios, contrib.notas))

    contrib_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "id": contrib_id,
        "mensaje": "¡Gracias por contribuir! Revisamos los datos esta noche y los sumamos a la base.",
    }


@app.get("/autos/contribuciones", tags=["Garage"])
async def ver_contribuciones(
    marca:   Optional[str] = Query(None),
    modelo:  Optional[str] = Query(None),
    estado:  str           = Query("aprobado"),
    limit:   int           = Query(50, ge=1, le=200),
):
    """Contribuciones de consumo aprobadas por la comunidad."""
    conn = usuarios_db()
    q = "SELECT marca, modelo, version, anio, combustible, consumo_ciudad, consumo_mixto, consumo_ruta, litros_tanque, km_propios, notas, confianza, created_at FROM contribuciones_consumo WHERE estado = ?"
    params: list = [estado]
    if marca:
        q += " AND marca LIKE ?"
        params.append(f"%{marca}%")
    if modelo:
        q += " AND modelo LIKE ?"
        params.append(f"%{modelo}%")
    q += " ORDER BY confianza DESC, created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return {"total": len(rows), "contribuciones": [dict(r) for r in rows]}


@app.post("/viajes", tags=["Viajes"])
async def guardar_viaje(request: Request, datos: dict = Body(...)):
    """Guarda un viaje planificado para el usuario logueado."""
    user = _get_current_user(request)
    conn = usuarios_db()
    try:
        conn.execute("""
            INSERT INTO viajes_guardados
              (usuario_id, from_ciudad, to_ciudad, distancia_km, duracion_min,
               consumo_kml, tanque_l, producto, litros_inicio, datos_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user["id"],
            datos.get("from_ciudad", ""),
            datos.get("to_ciudad", ""),
            datos.get("distancia_km"),
            datos.get("duracion_min"),
            datos.get("consumo_kml"),
            datos.get("tanque_l"),
            datos.get("producto"),
            datos.get("litros_inicio", 0),
            datos.get("datos_json"),
        ))
        conn.commit()
        return {"ok": True, "message": "Viaje guardado"}
    finally:
        conn.close()


@app.get("/viajes", tags=["Viajes"])
async def listar_viajes(request: Request):
    """Lista los viajes guardados del usuario logueado."""
    user = _get_current_user(request)
    conn = usuarios_db()
    try:
        rows = conn.execute("""
            SELECT id, from_ciudad, to_ciudad, distancia_km, duracion_min,
                   consumo_kml, tanque_l, producto, litros_inicio, created_at
            FROM viajes_guardados
            WHERE usuario_id = ?
            ORDER BY created_at DESC
            LIMIT 20
        """, (user["id"],)).fetchall()
        return {"total": len(rows), "viajes": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.delete("/viajes/{viaje_id}", tags=["Viajes"])
async def eliminar_viaje(request: Request, viaje_id: int):
    """Elimina un viaje guardado del usuario."""
    user = _get_current_user(request)
    conn = usuarios_db()
    try:
        row = conn.execute(
            "SELECT id FROM viajes_guardados WHERE id = ? AND usuario_id = ?",
            (viaje_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")
        conn.execute("DELETE FROM viajes_guardados WHERE id = ?", (viaje_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/precios/estimados", tags=["Precios"])
def precios_estimados(
    provincia:     Optional[str] = Query(None),
    localidad:     Optional[str] = Query(None),
    producto:      Optional[str] = Query(None),
    confianza_min: float         = Query(0.3, ge=0.0, le=1.0),
    limit:         int           = Query(100, ge=1, le=500),
):
    """
    Precios estimados por IDW / tendencia / media regional para estaciones con datos viejos.
    Generados por precio_ciencia.py cada día después del scraper.
    """
    resultados = db.get_precios_estimados(
        provincia=provincia,
        localidad=localidad,
        producto=producto,
        confianza_min=confianza_min,
        limit=limit,
    )
    return {
        "total":      len(resultados),
        "estimados":  resultados,
        "nota":       "Precios calculados por algoritmos IDW/tendencia. No son precios oficiales.",
    }


@app.post("/contacto/publicidad")
@limiter.limit("5/hour")
async def contacto_publicidad(request: Request, body: ContactoPublicidadIn):
    conn = usuarios_db()
    conn.execute(
        "INSERT INTO contacto_publicidad (nombre, empresa, email, telefono, tipo, mensaje) VALUES (?,?,?,?,?,?)",
        (body.nombre, body.empresa, body.email, body.telefono, body.tipo, body.mensaje)
    )
    conn.commit()
    conn.close()
    tipo_label = {"banner": "Banner publicitario", "sponsor": "Sponsoreo", "nota_patrocinada": "Nota patrocinada", "otro": "Otro"}.get(body.tipo, body.tipo)
    html = f"""<div style="font-family:sans-serif;max-width:520px;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px;">
    <h2 style="color:#f59e0b;margin:0 0 20px;">📢 Nueva consulta de publicidad</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="color:#94a3b8;padding:6px 0;width:120px;">Nombre:</td><td style="color:#e2e8f0;">{body.nombre}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;">Empresa:</td><td style="color:#e2e8f0;">{body.empresa or '—'}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;">Email:</td><td style="color:#f59e0b;"><a href="mailto:{body.email}" style="color:#f59e0b;">{body.email}</a></td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;">Teléfono:</td><td style="color:#e2e8f0;">{body.telefono or '—'}</td></tr>
      <tr><td style="color:#94a3b8;padding:6px 0;">Tipo:</td><td style="color:#e2e8f0;">{tipo_label}</td></tr>
    </table>
    <div style="margin-top:16px;padding:16px;background:#1e293b;border-radius:8px;">
      <p style="color:#94a3b8;margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Mensaje</p>
      <p style="color:#e2e8f0;margin:0;">{body.mensaje}</p>
    </div>
    </div>"""
    threading.Thread(target=send_internal_email, args=(f"📢 Publicidad: {body.nombre} — {tipo_label}", html), daemon=True).start()
    return {"ok": True}


@app.post("/feedback")
@limiter.limit("20/hour")
async def recibir_feedback(request: Request, body: FeedbackIn):
    usuario_id = None
    try:
        user = await _get_current_user(request)
        usuario_id = user["id"]
    except:
        pass
    conn = usuarios_db()
    conn.execute(
        "INSERT INTO feedback_usuarios (tipo, voto, mensaje, pagina, usuario_id) VALUES (?,?,?,?,?)",
        (body.tipo, body.voto, body.mensaje, body.pagina, usuario_id)
    )
    conn.commit()
    conn.close()
    if body.mensaje:
        emoji = "👍" if body.voto == "positivo" else "👎"
        tipo_label = {"sugerencia": "Sugerencia", "bug": "Bug reportado", "otro": "Otro"}.get(body.tipo, body.tipo)
        html = f"""<div style="font-family:sans-serif;max-width:520px;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px;">
        <h2 style="color:#f59e0b;margin:0 0 20px;">{emoji} Feedback de usuario — {tipo_label}</h2>
        <p style="color:#94a3b8;margin:0 0 8px;">Página: <span style="color:#e2e8f0;">{body.pagina or '—'}</span></p>
        <p style="color:#94a3b8;margin:0 0 16px;">Usuario: <span style="color:#e2e8f0;">{usuario_id or 'Anónimo'}</span></p>
        <div style="padding:16px;background:#1e293b;border-radius:8px;">
          <p style="color:#e2e8f0;margin:0;">{body.mensaje}</p>
        </div></div>"""
        threading.Thread(target=send_internal_email, args=(f"{emoji} Feedback: {tipo_label} — {body.pagina or 'app'}", html), daemon=True).start()
    return {"ok": True}


# ── /info — info del dataset (fecha de última actualización) ──────────────────

@app.get("/info")
@limiter.limit("60/minute")
async def dataset_info(request: Request):
    """Retorna metadata del dataset: cuándo se actualizó por última vez."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT MAX(fecha_actualizacion) as last_mod FROM estaciones"
        ).fetchone()
        conn.close()
        last_mod = row["last_mod"] if row and row["last_mod"] else datetime.utcnow().isoformat()
        return {
            "dataset":       "Precios de combustible Argentina",
            "fuente":        "Secretaría de Energía — datos.gob.ar",
            "last_modified": last_mod,
        }
    except Exception as e:
        return {
            "dataset":       "Precios de combustible Argentina",
            "fuente":        "Secretaría de Energía — datos.gob.ar",
            "last_modified": datetime.utcnow().isoformat(),
        }


# ── /geoip — proxy de ip-api.com para evitar el 403 desde browser ─────────────

@app.get("/geoip")
@limiter.limit("30/minute")
async def geoip(request: Request):
    """Proxy a ip-api.com para geolocalización por IP del cliente."""
    client_ip = request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
    try:
        resp = requests.get(
            f"http://ip-api.com/json/{client_ip}?fields=status,city,regionName,country,query",
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "status":   data.get("status"),
                "city":     data.get("city"),
                "region":   data.get("regionName"),
                "country":  data.get("country"),
                "query":    data.get("query"),
            }
    except Exception:
        pass
    return {"status": "fail"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
