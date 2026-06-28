import { useState, useEffect } from 'react';
import { haversine } from '../utils/haversine';

// ── Types ────────────────────────────────────────────────────────────────────

export type POICategory =
  | 'restaurant' | 'cafe' | 'fast_food'
  | 'hotel' | 'hostel' | 'camping'
  | 'rest_area' | 'supermarket' | 'pharmacy'
  | 'fuel' | 'atm' | 'police' | 'car_wash';

export interface RoutePOI {
  id:            string;
  name:          string;
  category:      POICategory;
  lat:           number;
  lon:           number;
  distancia_km:  number;
  km_from_start: number;
  tags:          Record<string, string>;
}

export interface RoutePOIsResult {
  pois:    RoutePOI[];
  loading: boolean;
  error:   string | null;
  source:  'local' | 'overpass' | null;
}

// ── Overpass fallback mirrors ─────────────────────────────────────────────────

const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// ── Category mappings (for Overpass fallback) ─────────────────────────────────

const AMENITY_MAP: Record<string, POICategory> = {
  restaurant: 'restaurant', food_court: 'restaurant',
  cafe: 'cafe', pub: 'cafe', bar: 'cafe', biergarten: 'cafe',
  fast_food: 'fast_food', ice_cream: 'fast_food',
  pharmacy: 'pharmacy', chemist: 'pharmacy',
  supermarket: 'supermarket', convenience: 'supermarket',
  fuel: 'fuel', atm: 'atm', police: 'police', car_wash: 'car_wash',
};
const TOURISM_MAP: Record<string, POICategory> = {
  hotel: 'hotel', motel: 'hotel', guest_house: 'hotel', chalet: 'hotel',
  hostel: 'hostel', backpacker: 'hostel',
  camp_site: 'camping', caravan_site: 'camping',
};
const HIGHWAY_MAP: Record<string, POICategory> = {
  rest_area: 'rest_area', services: 'rest_area',
};

function classify(tags: Record<string, string>): POICategory | null {
  if (tags.amenity  && AMENITY_MAP[tags.amenity])  return AMENITY_MAP[tags.amenity];
  if (tags.tourism  && TOURISM_MAP[tags.tourism])  return TOURISM_MAP[tags.tourism];
  if (tags.highway  && HIGHWAY_MAP[tags.highway])  return HIGHWAY_MAP[tags.highway];
  return null;
}

// ── Internal API — /api/pois/ruta ─────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function queryLocalAPI(
  coords: number[][],
  radiusM: number,
  categorias?: POICategory[],
): Promise<{ pois: RoutePOI[]; source: 'local' }> {
  // Downsample to 200 points max for the request
  const step = Math.max(1, Math.floor(coords.length / 200));
  const sample = coords.filter((_, i) => i % step === 0);

  const resp = await fetch(`${API_BASE}/pois/ruta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coords: sample.map(([lon, lat]) => [lat, lon]),  // API expects [lat,lon]
      radio_m: radiusM,
      categorias: categorias ?? null,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json();

  const maxKmStart = 0;  // will be computed from route
  const allPois: RoutePOI[] = [];

  for (const [category, items] of Object.entries(data.pois_por_categoria ?? {})) {
    for (const item of items as any[]) {
      allPois.push({
        id:            `${item.osm_id}`,
        name:          item.name || item.brand || item.operator || category,
        category:      category as POICategory,
        lat:           item.lat,
        lon:           item.lon,
        distancia_km:  item.dist_ruta_km,
        km_from_start: 0,  // computed below
        tags:          item.extra_tags ?? {},
      });
    }
  }

  return { pois: allPois, source: 'local' };
}

// ── Overpass fallback ─────────────────────────────────────────────────────────

function makeOverpassQuery(lat: number, lon: number, radiusM: number): string {
  return `[out:json][timeout:20];
(
  node["amenity"~"restaurant|cafe|fast_food|food_court|pub|bar|pharmacy|supermarket|convenience|fuel|atm|police|car_wash"](around:${radiusM},${lat},${lon});
  node["tourism"~"hotel|motel|hostel|guest_house|camp_site|caravan_site|chalet"](around:${radiusM},${lat},${lon});
  node["highway"~"rest_area|services"](around:${radiusM},${lat},${lon});
);
out body 80;`;
}

async function queryOverpassMirror(mirror: string, query: string): Promise<any[]> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22_000);
  try {
    const resp = await fetch(mirror, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(query)}`,
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const els  = json.elements ?? [];
    if (!Array.isArray(els)) throw new Error('bad response');
    return els;
  } catch {
    clearTimeout(timer);
    throw new Error('mirror failed');
  }
}

async function queryOverpass(lat: number, lon: number, radiusM: number): Promise<any[]> {
  const query = makeOverpassQuery(lat, lon, radiusM);
  try {
    return await Promise.any(OVERPASS_MIRRORS.map(m => queryOverpassMirror(m, query)));
  } catch {
    return [];
  }
}

// ── Pick N evenly-spaced intermediate waypoints ───────────────────────────────

function pickIntermediateWaypoints(
  waypoints: Array<{ lat: number; lon: number; km_from_start: number }>,
  n: number,
): Array<{ lat: number; lon: number; km_from_start: number }> {
  const mid = waypoints.slice(1, -1);
  if (!mid.length) return [];
  if (mid.length <= n) return mid;
  return Array.from({ length: n }, (_, i) => mid[Math.round(i * (mid.length - 1) / (n - 1))]);
}

// ── Compute km_from_start for each POI from route geometry ────────────────────

function assignKmFromStart(
  pois: RoutePOI[],
  coordsLonLat: number[][],
  totalKm: number,
): RoutePOI[] {
  if (!coordsLonLat.length || totalKm <= 0) return pois;
  const step = Math.max(1, Math.floor(coordsLonLat.length / 300));
  const sampled = coordsLonLat.filter((_, i) => i % step === 0);

  return pois.map(poi => {
    let minDist = Infinity;
    let bestFrac = 0;
    sampled.forEach(([lon, lat], i) => {
      const d = haversine(poi.lat, poi.lon, lat, lon);
      if (d < minDist) { minDist = d; bestFrac = i / Math.max(sampled.length - 1, 1); }
    });
    return { ...poi, km_from_start: Math.round(bestFrac * totalKm) };
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRoutePOIs(
  geometry:  GeoJSON.LineString | null,
  waypoints: Array<{ lat: number; lon: number; km_from_start: number }>,
  radius_km: number = 12,
): RoutePOIsResult {
  const [result, setResult] = useState<RoutePOIsResult>({
    pois: [], loading: false, error: null, source: null,
  });

  useEffect(() => {
    if (!geometry?.coordinates.length || waypoints.length < 2) {
      setResult({ pois: [], loading: false, error: null, source: null });
      return;
    }

    let cancelled = false;
    setResult(prev => ({ ...prev, loading: true, error: null }));

    async function run() {
      const coords = geometry!.coordinates as number[][];
      const totalKm = waypoints[waypoints.length - 1]?.km_from_start ?? 0;
      const radiusM = radius_km * 1000;

      // ── Strategy 1: Local API (fast, offline-first) ──────────────────────
      try {
        const { pois: rawPois, source } = await queryLocalAPI(coords, radiusM);

        if (!cancelled && rawPois.length > 0) {
          const pois = assignKmFromStart(rawPois, coords, totalKm)
            .sort((a, b) => a.km_from_start - b.km_from_start);
          setResult({ pois, loading: false, error: null, source });
          return;
        }
      } catch {
        // fall through to Overpass
      }

      if (cancelled) return;

      // ── Strategy 2: Overpass fallback (if local DB empty) ────────────────
      try {
        const stops = pickIntermediateWaypoints(waypoints, 4);
        if (!stops.length) {
          setResult({ pois: [], loading: false, error: null, source: null });
          return;
        }

        const step    = Math.max(1, Math.floor(coords.length / 100));
        const sampled = coords.filter((_, i) => i % step === 0);

        const allNodes = await Promise.all(
          stops.map(s => queryOverpass(s.lat, s.lon, radiusM))
        );

        if (cancelled) return;

        const seen = new Set<string>();
        const pois: RoutePOI[] = allNodes
          .flat()
          .map((node: any) => {
            const tags: Record<string, string> = node.tags ?? {};
            const category = classify(tags);
            if (!category) return null;
            const name = (tags.name ?? tags['name:es'] ?? tags.brand ?? tags.operator ?? '').trim();
            if (!name) return null;
            let minDist = Infinity;
            let bestFrac = 0;
            sampled.forEach(([lon, lat], i) => {
              const d = haversine(node.lat, node.lon, lat, lon);
              if (d < minDist) { minDist = d; bestFrac = i / Math.max(sampled.length - 1, 1); }
            });
            const key = `${category}|${name.toLowerCase().slice(0, 20)}`;
            if (seen.has(key) || minDist > radius_km) return null;
            seen.add(key);
            return {
              id: `${node.id}`,
              name, category,
              lat: node.lat, lon: node.lon,
              distancia_km: Math.round(minDist * 10) / 10,
              km_from_start: Math.round(bestFrac * totalKm),
              tags,
            } as RoutePOI;
          })
          .filter((p): p is RoutePOI => p !== null)
          .sort((a, b) => a.km_from_start - b.km_from_start);

        setResult({ pois, loading: false, error: null, source: 'overpass' });
      } catch {
        if (!cancelled) setResult({ pois: [], loading: false, error: null, source: null });
      }
    }

    run();
    return () => { cancelled = true; };
  }, [geometry, waypoints, radius_km]);

  return result;
}
