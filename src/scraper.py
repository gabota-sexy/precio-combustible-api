"""
Scraper Lambda — se ejecuta diariamente via EventBridge cron(0 6 * * ? *)
(06:00 UTC = 03:00 ART, horario de menor tráfico).

Responsabilidades:
  1. Pagina TODOS los registros de datos.energia.gob.ar
  2. Guarda snapshot diario de precios en combustible-historico
  3. Siembra/actualiza combustible-localidades con coordenadas completas
"""

import json
import math
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import boto3
import requests

# ─── Config ──────────────────────────────────────────────────────────────────

RESOURCE_ID     = "80ac25de-a44a-4445-9215-090cf55cfda5"
API_URL         = "http://datos.energia.gob.ar/api/3/action/datastore_search"
PAGE_SIZE       = 2000
REQUEST_TIMEOUT = 60

TABLE_LOCALIDADES = os.environ.get("DYNAMODB_TABLE_LOCALIDADES", "combustible-localidades")
TABLE_HISTORICO   = os.environ.get("DYNAMODB_TABLE_HISTORICO",   "combustible-historico")
TABLE_ESTACIONES  = os.environ.get("DYNAMODB_TABLE_ESTACIONES",  "combustible-estaciones")
REGION            = os.environ.get("AWS_DEFAULT_REGION",         "sa-east-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)


# ─── Helpers ─────────────────────────────────────────────────────────────────

# El dataset usa "CAPITAL FEDERAL" para CABA — normalizamos a "CABA" para
# consistencia con los nombres que usa la API.
_PROV_NORM = {
    "CAPITAL FEDERAL": "CABA",
}

def _norm_prov(prov: str) -> str:
    return _PROV_NORM.get(prov, prov)


def _safe_decimal(value) -> Optional[Decimal]:
    try:
        f = float(str(value).replace(",", "."))
        if math.isfinite(f) and f != 0.0:
            return Decimal(str(round(f, 6)))
    except (ValueError, TypeError):
        pass
    return None


def _strip_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


# ─── Fetch ────────────────────────────────────────────────────────────────────

def _fetch_page(offset: int) -> dict:
    params = {"resource_id": RESOURCE_ID, "limit": PAGE_SIZE, "offset": offset}
    headers = {"User-Agent": "CombustibleArgentina/3.0-scraper"}
    r = requests.get(API_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"CKAN error offset={offset}: {data.get('error')}")
    return data["result"]


def _fetch_all() -> list:
    print("[SCRAPER] Iniciando paginación completa...")
    result = _fetch_page(0)
    total   = result.get("total", 0)
    records = result.get("records", [])
    print(f"[SCRAPER] Total según API: {total}")

    offset = len(records)
    while offset < total:
        page = _fetch_page(offset)
        batch = page.get("records", [])
        if not batch:
            break
        records.extend(batch)
        offset += len(batch)
        print(f"[SCRAPER] {offset}/{total}")

    print(f"[SCRAPER] Paginación completa: {len(records)} registros")
    return records


# ─── Build items ─────────────────────────────────────────────────────────────

def _build_historico(records: list, fecha: str) -> list:
    """
    Guarda el precio mínimo por localidad+provincia+producto+fecha.
    PK = LOCALIDAD#PROVINCIA#PRODUCTO, SK = fecha (YYYY-MM-DD)
    """
    best = {}
    for rec in records:
        loc  = (rec.get("localidad") or "").strip().upper()
        prov = _norm_prov((rec.get("provincia") or "").strip().upper())
        prod = (rec.get("producto")  or "").strip().upper()
        if not loc or not prov or not prod:
            continue
        precio = _safe_decimal(rec.get("precio"))
        if precio is None:
            continue
        pk = f"{loc}#{prov}#{prod}"
        if pk not in best or precio < best[pk]["precio"]:
            best[pk] = _strip_none({
                "pk":         pk,
                "fecha":      fecha,
                "localidad":  loc,
                "provincia":  prov,
                "producto":   prod,
                "precio":     precio,
                "empresa":    (rec.get("empresa")   or "").strip().upper() or None,
                "bandera":    (rec.get("bandera")   or "").strip().upper() or None,
                "direccion":  (rec.get("direccion") or "").strip() or None,
                "scraped_at": datetime.utcnow().isoformat(),
            })
    return list(best.values())


def _build_localidades(records: list) -> list:
    """Localidades únicas con coordenadas. Prioriza ítems con lat/lon."""
    seen = {}
    for rec in records:
        loc  = (rec.get("localidad") or "").strip().upper()
        prov = _norm_prov((rec.get("provincia") or "").strip().upper())
        if not loc or not prov:
            continue
        key = (prov, loc)
        lat = _safe_decimal(rec.get("latitud"))
        lon = _safe_decimal(rec.get("longitud"))
        cp  = (rec.get("codigo_postal") or "").strip()
        if key not in seen:
            seen[key] = {"provincia": prov, "localidad": loc,
                         "lat": lat, "lon": lon, "codigo_postal": cp or None}
        else:
            e = seen[key]
            if e["lat"] is None and lat is not None:
                e["lat"] = lat
                e["lon"] = lon
            if not e["codigo_postal"] and cp:
                e["codigo_postal"] = cp
    return [_strip_none(v) for v in seen.values()]


def _batch_write(table_name: str, items: list):
    table   = dynamodb.Table(table_name)
    written = 0
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)
            written += 1
            if written % 1000 == 0:
                print(f"[SCRAPER] {table_name}: {written}/{len(items)}")
    print(f"[SCRAPER] {table_name}: OK — {written} ítems")


# ─── Estaciones cache ────────────────────────────────────────────────────────

def _save_estaciones_cache(records: list):
    """
    Guarda todos los registros CKAN en combustible-estaciones con TTL de 26h.
    PK = provincia#localidad, SK = cuit#producto#tipohorario
    """
    table    = dynamodb.Table(TABLE_ESTACIONES)
    now_ts   = int(__import__("time").time())
    ttl_ts   = now_ts + 26 * 3600

    # Deduplicar por (pk, sk): el dataset fuente puede tener registros repetidos.
    # Mantenemos el de fecha_vigencia más reciente por clave.
    deduped = {}
    for rec in records:
        provincia   = _norm_prov((rec.get("provincia") or "").strip().upper())
        localidad   = (rec.get("localidad")   or "").strip().upper()
        cuit        = (rec.get("cuit")        or "").strip()
        producto    = (rec.get("producto")    or "").strip().upper()
        tipohorario = (rec.get("tipohorario") or "DIURNO").strip().upper()

        if not provincia or not localidad or not cuit or not producto:
            continue

        pk  = f"{provincia}#{localidad}"
        sk  = f"{cuit}#{producto}#{tipohorario}"
        key = (pk, sk)

        existing = deduped.get(key)
        fv_new = rec.get("fecha_vigencia") or ""
        fv_old = (existing or {}).get("fecha_vigencia") or ""
        if existing is None or fv_new >= fv_old:
            deduped[key] = _strip_none({
                "pk":             pk,
                "sk":             sk,
                "empresa":        (rec.get("empresa") or "").strip().upper() or None,
                "bandera":        (rec.get("bandera") or rec.get("empresabandera") or "").strip().upper() or None,
                "cuit":           cuit,
                "direccion":      (rec.get("direccion") or "").strip() or None,
                "localidad":      localidad,
                "provincia":      provincia,
                "region":         (rec.get("region") or "").strip().upper() or None,
                "latitud":        _safe_decimal(rec.get("latitud")),
                "longitud":       _safe_decimal(rec.get("longitud")),
                "producto":       rec.get("producto"),
                "precio":         _safe_decimal(rec.get("precio")),
                "tipohorario":    rec.get("tipohorario"),
                "fecha_vigencia": rec.get("fecha_vigencia"),
                "ttl":            ttl_ts,
                "cached_at":      now_ts,
            })

    items   = list(deduped.values())
    written = 0
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)
            written += 1
            if written % 1000 == 0:
                print(f"[SCRAPER] estaciones cache: {written}")

    print(f"[SCRAPER] {TABLE_ESTACIONES}: OK — {written} ítems (de {len(records)} originales)")


# ─── Handler ─────────────────────────────────────────────────────────────────

def handler(event, context):
    """
    Invocado por EventBridge diariamente.
    Para backfill manual: pasar {"fecha": "2026-01-15"} como payload.
    """
    fecha = (event or {}).get("fecha") or date.today().isoformat()
    print(f"[SCRAPER] Corriendo para fecha={fecha}")

    records = _fetch_all()

    historico_items  = _build_historico(records, fecha)
    localidad_items  = _build_localidades(records)

    print(f"[SCRAPER] Escribiendo {len(historico_items)} registros históricos...")
    _batch_write(TABLE_HISTORICO, historico_items)

    print(f"[SCRAPER] Escribiendo {len(localidad_items)} localidades...")
    _batch_write(TABLE_LOCALIDADES, localidad_items)

    print(f"[SCRAPER] Cacheando {len(records)} estaciones en DynamoDB...")
    _save_estaciones_cache(records)

    summary = {
        "fecha": fecha,
        "records_fetched": len(records),
        "historico_written": len(historico_items),
        "localidades_written": len(localidad_items),
        "estaciones_cached": len(records),
    }
    print(f"[SCRAPER] Completo: {json.dumps(summary)}")
    return summary
