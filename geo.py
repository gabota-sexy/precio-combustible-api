import requests
from typing import Optional

# ─── Normalización de nombres de provincias ───────────────────────────────────
# ip-api.com devuelve nombres con tildes / variantes que normalizamos al
# nombre que usa el dataset de datos.gob.ar

PROVINCIA_MAP = {
    "CIUDAD AUTÓNOMA DE BUENOS AIRES": "CABA",
    "CIUDAD AUTONOMA DE BUENOS AIRES": "CABA",
    "BUENOS AIRES": "BUENOS AIRES",
    "BUENOS AIRES F.D.": "CABA",
    "BUENOS AIRES F. D.": "CABA",
    "CIUDAD DE BUENOS AIRES": "CABA",
    "DISTRITO FEDERAL": "CABA",
    "CAPITAL FEDERAL": "CABA",
    "CÓRDOBA": "CORDOBA",
    "CORDOBA": "CORDOBA",
    "NEUQUÉN": "NEUQUEN",
    "NEUQUEN": "NEUQUEN",
    "RÍO NEGRO": "RIO NEGRO",
    "RIO NEGRO": "RIO NEGRO",
    "ENTRE RÍOS": "ENTRE RIOS",
    "ENTRE RIOS": "ENTRE RIOS",
    "TUCUMÁN": "TUCUMAN",
    "TUCUMAN": "TUCUMAN",
    "TIERRA DEL FUEGO, ANTÁRTIDA E ISLAS DEL ATLÁNTICO SUR": "TIERRA DEL FUEGO",
    "TIERRA DEL FUEGO": "TIERRA DEL FUEGO",
    "SANTIAGO DEL ESTERO": "SANTIAGO DEL ESTERO",
    "MISIONES": "MISIONES",
    "CORRIENTES": "CORRIENTES",
    "CHACO": "CHACO",
    "FORMOSA": "FORMOSA",
    "JUJUY": "JUJUY",
    "SALTA": "SALTA",
    "CATAMARCA": "CATAMARCA",
    "LA RIOJA": "LA RIOJA",
    "SAN JUAN": "SAN JUAN",
    "MENDOZA": "MENDOZA",
    "SAN LUIS": "SAN LUIS",
    "LA PAMPA": "LA PAMPA",
    "CHUBUT": "CHUBUT",
    "SANTA CRUZ": "SANTA CRUZ",
    "SANTA FE": "SANTA FE",
}


def normalize_provincia(name: str) -> str:
    # Limpiar prefijos comunes que devuelve Nominatim
    cleaned = name.strip()
    for prefix in ("Provincia de ", "Province of ", "Departamento de ", "Partido de "):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    key = cleaned.upper().strip()
    return PROVINCIA_MAP.get(key, key)


# ─── Coordenadas de capitales de provincia (fallback) ────────────────────────

PROVINCE_CAPITALS = {
    "BUENOS AIRES":       {"localidad": "LA PLATA",                          "lat": -34.9214, "lon": -57.9545},
    "CABA":               {"localidad": "CIUDAD DE BUENOS AIRES",            "lat": -34.6037, "lon": -58.3816},
    "CATAMARCA":          {"localidad": "SAN FERNANDO DEL VALLE DE CATAMARCA","lat": -28.4696, "lon": -65.7852},
    "CHACO":              {"localidad": "RESISTENCIA",                        "lat": -27.4515, "lon": -58.9867},
    "CHUBUT":             {"localidad": "RAWSON",                             "lat": -43.3002, "lon": -65.1023},
    "CORDOBA":            {"localidad": "CORDOBA",                            "lat": -31.4201, "lon": -64.1888},
    "CORRIENTES":         {"localidad": "CORRIENTES",                         "lat": -27.4692, "lon": -58.8306},
    "ENTRE RIOS":         {"localidad": "PARANA",                             "lat": -31.7320, "lon": -60.5330},
    "FORMOSA":            {"localidad": "FORMOSA",                            "lat": -26.1775, "lon": -58.1781},
    "JUJUY":              {"localidad": "SAN SALVADOR DE JUJUY",              "lat": -24.1858, "lon": -65.2995},
    "LA PAMPA":           {"localidad": "SANTA ROSA",                         "lat": -36.6167, "lon": -64.2833},
    "LA RIOJA":           {"localidad": "LA RIOJA",                           "lat": -29.4131, "lon": -66.8558},
    "MENDOZA":            {"localidad": "MENDOZA",                            "lat": -32.8908, "lon": -68.8272},
    "MISIONES":           {"localidad": "POSADAS",                            "lat": -27.3621, "lon": -55.9001},
    "NEUQUEN":            {"localidad": "NEUQUEN",                            "lat": -38.9516, "lon": -68.0591},
    "RIO NEGRO":          {"localidad": "VIEDMA",                             "lat": -40.8135, "lon": -62.9967},
    "SALTA":              {"localidad": "SALTA",                              "lat": -24.7821, "lon": -65.4232},
    "SAN JUAN":           {"localidad": "SAN JUAN",                           "lat": -31.5375, "lon": -68.5364},
    "SAN LUIS":           {"localidad": "SAN LUIS",                           "lat": -33.2950, "lon": -66.3356},
    "SANTA CRUZ":         {"localidad": "RIO GALLEGOS",                       "lat": -51.6230, "lon": -69.2168},
    "SANTA FE":           {"localidad": "SANTA FE",                           "lat": -31.6107, "lon": -60.7009},
    "SANTIAGO DEL ESTERO":{"localidad": "SANTIAGO DEL ESTERO",               "lat": -27.7951, "lon": -64.2615},
    "TIERRA DEL FUEGO":   {"localidad": "USHUAIA",                            "lat": -54.8019, "lon": -68.3030},
    "TUCUMAN":            {"localidad": "SAN MIGUEL DE TUCUMAN",              "lat": -26.8083, "lon": -65.2176},
}


def get_province_capital(provincia: str) -> Optional[dict]:
    return PROVINCE_CAPITALS.get(normalize_provincia(provincia.upper()))


def reverse_geocode(lat: float, lon: float) -> Optional[dict]:
    """
    Obtiene provincia y localidad a partir de coordenadas GPS usando Nominatim (OSM, gratis).
    Incluye User-Agent obligatorio según política de Nominatim.
    """
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "accept-language": "es"},
            headers={"User-Agent": "CombustibleArgentina/2.0 (precio-combustible-api)"},
            timeout=5,
        )
        data = r.json()
        address = data.get("address", {})
        # Nominatim devuelve 'state' para provincia en Argentina
        raw_prov = address.get("state", "")
        localidad = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or ""
        )
        provincia = normalize_provincia(raw_prov)
        if provincia:
            print(f"[GEO] Reverse geocode OK: {localidad} / {provincia} (raw state='{raw_prov}')")
            return {
                "lat": lat,
                "lon": lon,
                "localidad": localidad.upper().strip(),
                "provincia": provincia,
                "source": "gps_reverse",
            }
        else:
            print(f"[GEO] Reverse geocode: no provincia. address={address}")
    except Exception as e:
        print(f"[GEO] Reverse geocode error: {e}")
    return None


# ─── Geolocalización por IP ───────────────────────────────────────────────────

def geolocate_ip(ip: str) -> Optional[dict]:
    """
    Usa ip-api.com (gratis, 45 req/min sin key) para obtener ubicación aproximada.
    Solo devuelve resultado si la IP está en Argentina.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return None
    try:
        r = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,regionName,city,lat,lon,zip"},
            timeout=5,
        )
        data = r.json()
        if data.get("status") == "success" and data.get("country") == "Argentina":
            return {
                "lat":      data["lat"],
                "lon":      data["lon"],
                "localidad":  data.get("city", "").upper().strip(),
                "provincia":  normalize_provincia(data.get("regionName", "")),
                "codigo_postal": data.get("zip", ""),
                "source":   "ip",
            }
    except Exception:
        pass
    return None


# ─── Resolución escalonada de ubicación ──────────────────────────────────────

def resolve_location(
    gps_lat: Optional[float],
    gps_lon: Optional[float],
    ip: Optional[str],
    localidad: Optional[str],
    provincia: Optional[str],
    db_get_session,
    db_save_session,
    db_get_localidad_coords,
    cf_headers: Optional[dict] = None,
) -> dict:
    """
    Devuelve la mejor ubicación disponible con el nivel de precisión alcanzado.

    Cascada:
      1. GPS exacto (más preciso)
      2. Caché de sesión por IP
      3. Geolocalización por IP (ip-api.com)
      4. Coordenadas de localidad desde SQLite
      5. Capital de provincia (fallback administrativo)
      6. Buenos Aires por defecto
    """

    # 0. Si el usuario proporcionó provincia + localidad explícitamente, usarlas directo.
    # Esto evita que la sesión cacheada (de un request GPS anterior) sobreescriba
    # la intención explícita del usuario.
    if localidad and provincia and gps_lat is None and gps_lon is None:
        coords = db_get_localidad_coords(localidad, provincia)
        if coords and coords.get("lat"):
            return {
                "method": "localidad",
                "precision": "localidad",
                "lat": float(coords["lat"]),
                "lon": float(coords["lon"]),
                "localidad": localidad.upper(),
                "provincia": provincia.upper(),
            }
        # Si la localidad no está en la DB, la tenemos igual como fallback
        return {
            "method": "localidad",
            "precision": "provincia",
            "lat": None,
            "lon": None,
            "localidad": localidad.upper(),
            "provincia": provincia.upper(),
        }

    # 1. GPS del dispositivo
    if gps_lat is not None and gps_lon is not None:
        # Reusar provincia/localidad cacheada de una sesión GPS anterior
        # SOLO si las coordenadas no cambiaron significativamente (< 20km).
        # Si el usuario se movió a otra zona, descartamos la sesión y dejamos
        # que main.py haga reverse geocoding con las nuevas coords.
        cached_prov = provincia
        cached_loc  = localidad
        session = None
        if ip and (not cached_prov or not cached_loc):
            session = db_get_session(ip)
            if session and session.get("provincia") and session.get("source") in ("gps", "gps_reverse"):
                # Verificar que las coordenadas actuales están cerca de las cacheadas
                sess_lat = session.get("lat")
                sess_lon = session.get("lon")
                session_valida = False
                if sess_lat is not None and sess_lon is not None:
                    try:
                        import math
                        dlat = math.radians(float(gps_lat) - float(sess_lat))
                        dlon = math.radians(float(gps_lon) - float(sess_lon))
                        a = (math.sin(dlat/2)**2 +
                             math.cos(math.radians(float(sess_lat))) *
                             math.cos(math.radians(float(gps_lat))) *
                             math.sin(dlon/2)**2)
                        dist_km = 6371 * 2 * math.asin(math.sqrt(a))
                        session_valida = dist_km < 20
                        if not session_valida:
                            print(f"[GEO] GPS movido {dist_km:.1f}km desde sesión — ignorando caché de localidad")
                    except Exception:
                        session_valida = True  # ante error, reusar
                if session_valida:
                    cached_prov = cached_prov or session.get("provincia")
                    cached_loc  = cached_loc  or session.get("localidad")
        # Preservar gps_reverse si la localidad/provincia vino de ese source
        save_source = "gps_reverse" if (cached_prov and cached_loc and
            session and session.get("source") == "gps_reverse") else "gps"
        if ip:
            db_save_session(ip, gps_lat, gps_lon, cached_loc, cached_prov, save_source)
        return {
            "method": "gps",
            "precision": "exacta",
            "lat": gps_lat,
            "lon": gps_lon,
            "localidad": cached_loc,
            "provincia": cached_prov,
            "geocoded": cached_prov is not None and cached_loc is not None or None,
        }

    # 2. Sesión cacheada por IP (válida 1 hora)
    # Solo reutilizamos sesiones GPS — las sesiones IP tienen coordenadas de ciudad
    # que pueden estar a 40-50km del usuario real (ISPs de GBA apuntan a CABA)
    if ip:
        session = db_get_session(ip)
        if session and session.get("lat") and session.get("lon"):
            source = session.get("source", "")
            if source in ("gps", "gps_reverse"):
                loc  = session.get("localidad")
                prov = session.get("provincia")
                return {
                    "method": "ip_cache",
                    "precision": "exacta",
                    "lat": session["lat"],
                    "lon": session["lon"],
                    "localidad": loc,
                    "provincia": prov,
                    "geocoded": (prov is not None and loc is not None) or None,
                }
            # Sesión IP: solo usamos provincia (no coordenadas imprecisas)
            elif source == "ip" and session.get("provincia"):
                return {
                    "method": "ip_cache",
                    "precision": "provincia",
                    "lat": None,
                    "lon": None,
                    "localidad": session.get("localidad"),
                    "provincia": session.get("provincia"),
                }

    # 2.5. Headers de Cloudflare (CF-IPCity, CF-IPCountry, CF-IPLatitude, CF-IPLongitude)
    # Más rápido y confiable que ip-api en producción detrás de Cloudflare
    if cf_headers and cf_headers.get("CF-IPCountry") == "AR":
        cf_lat = cf_headers.get("CF-IPLatitude")
        cf_lon = cf_headers.get("CF-IPLongitude")
        cf_city = cf_headers.get("CF-IPCity", "")
        cf_region = cf_headers.get("CF-IPRegion", "")
        if cf_lat and cf_lon:
            try:
                cf_lat_f = float(cf_lat)
                cf_lon_f = float(cf_lon)
                cf_prov = normalize_provincia(cf_region.upper()) if cf_region else None
                if ip:
                    db_save_session(ip, cf_lat_f, cf_lon_f, cf_city.upper() or None, cf_prov, "ip")
                return {
                    "method": "cf_headers",
                    "precision": "aproximada",
                    "lat": cf_lat_f,
                    "lon": cf_lon_f,
                    "localidad": cf_city.upper() if cf_city else None,
                    "provincia": cf_prov,
                }
            except (ValueError, TypeError):
                pass

    # 3. Geolocalización en tiempo real por IP
    if ip:
        geo = geolocate_ip(ip)
        if geo:
            db_save_session(ip, geo["lat"], geo["lon"], geo["localidad"], geo["provincia"], "ip")
            return {
                "method": "ip_geo",
                "precision": "aproximada",
                "lat": geo["lat"],
                "lon": geo["lon"],
                "localidad": geo["localidad"],
                "provincia": geo["provincia"],
            }

    # 4. Coords de localidad desde SQLite
    if localidad and provincia:
        coords = db_get_localidad_coords(localidad, provincia)
        if coords and coords.get("lat"):
            return {
                "method": "localidad",
                "precision": "localidad",
                "lat": coords["lat"],
                "lon": coords["lon"],
                "localidad": localidad.upper(),
                "provincia": provincia.upper(),
            }

    # 5. Capital de provincia
    if provincia:
        cap = get_province_capital(provincia)
        if cap:
            return {
                "method": "provincia",
                "precision": "provincia",
                "lat": cap["lat"],
                "lon": cap["lon"],
                "localidad": cap["localidad"],
                "provincia": normalize_provincia(provincia.upper()),
            }

    # 6. Default: Buenos Aires
    return {
        "method": "default",
        "precision": "provincia",
        "lat": -34.6037,
        "lon": -58.3816,
        "localidad": "CIUDAD DE BUENOS AIRES",
        "provincia": "CABA",
    }
