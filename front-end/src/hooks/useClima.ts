import { useEffect, useState } from 'react';

interface ClimaData {
  temp:        number | null;
  descripcion: string | null;
  ciudad:      string | null;
  clientIP:    string | null;
  humedad:     number | null;
  viento_vel:  number | null;
  viento_dir:  string | null;
  presion:     number | null;
  visibilidad: number | null;
  loading:     boolean;
}

interface SMNItem {
  name: string;
  weather?: {
    temp?:        number;
    description?: string;
    humidity?:    number;
    wind_speed?:  number;
    wing_deg?:    string;
    pressure?:    number;
    visibility?:  number;
  };
  lat?: number;
  lon?: number;
}

// Cache de módulo: 30 min para datos SMN + ciudad resuelta
let _smn:    { items: SMNItem[]; ts: number } | null = null;
let _result: { data: Omit<ClimaData, 'loading'>; ts: number } | null = null;
let _ip:     string | null = null;
const CACHE_SMN_MS    = 30 * 60 * 1000;
const CACHE_RESULT_MS = 30 * 60 * 1000;

// ── Distancia Haversine (km) ─────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Buscar estación SMN más cercana por coordenadas ──────────────────────────
function nearestStation(items: SMNItem[], lat: number, lon: number): SMNItem | undefined {
  let best: SMNItem | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    if (item.lat == null || item.lon == null) continue;
    const d = haversine(lat, lon, item.lat, item.lon);
    if (d < bestDist) { bestDist = d; best = item; }
  }
  return best;
}

// ── Buscar estación por nombre (fuzzy) ───────────────────────────────────────
function matchCity(items: SMNItem[], ciudad: string): SMNItem | undefined {
  const q = ciudad.toUpperCase();
  return (
    items.find(i => i.name.toUpperCase() === q)                  ??
    items.find(i => i.name.toUpperCase().includes(q))            ??
    items.find(i => i.name.toUpperCase().includes('BUENOS AIRES'))
  );
}

// ── Pedir GPS con timeout ────────────────────────────────────────────────────
function getGPS(timeoutMs = 3000): Promise<{ lat: number; lon: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      ()  => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

// ── Detectar ciudad por IP (ip-api.com, CORS-friendly, gratis) ──────────────
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function getCityFromIP(): Promise<{ city: string | null; ip: string | null }> {
  // Usamos el proxy del backend para evitar el 403 que da ip-api.com desde el browser
  const apiBase = import.meta.env.VITE_API_BASE || 'https://tankear.com.ar/api';
  try {
    const r = await fetchWithTimeout(`${apiBase}/geoip`, 4000);
    const j = await r.json();
    const ip = j.query ?? null;
    if (j.status === 'success' && j.country === 'Argentina' && j.city) {
      _ip = ip;
      return { city: (j.city as string).toUpperCase(), ip };
    }
    _ip = ip;
    return { city: null, ip };
  } catch { /* ignorar */ }
  return { city: null, ip: null };
}

// ── Fetch SMN con cache ───────────────────────────────────────────────────────
async function fetchSMN(): Promise<SMNItem[]> {
  if (_smn && Date.now() - _smn.ts < CACHE_SMN_MS) return _smn.items;
  const r = await fetchWithTimeout('https://ws.smn.gob.ar/map_items/weather', 5000);
  const items: SMNItem[] = await r.json();
  _smn = { items, ts: Date.now() };
  return items;
}

// ── Hook principal ────────────────────────────────────────────────────────────
const EMPTY: ClimaData = { temp: null, descripcion: null, ciudad: null, clientIP: null, humedad: null, viento_vel: null, viento_dir: null, presion: null, visibilidad: null, loading: true };

export function useClima(ciudadProp?: string): ClimaData {
  const [data, setData] = useState<ClimaData>(EMPTY);

  useEffect(() => {
    // Cache de resultado completo (30 min)
    if (_result && Date.now() - _result.ts < CACHE_RESULT_MS) {
      setData({ ..._result.data, clientIP: _ip, loading: false });
      return;
    }


    let cancelled = false;

    async function resolve() {
      try {
        // Arrancar SMN + IP en paralelo; GPS solo como último recurso geográfico
        const [items, ipResult] = await Promise.all([
          fetchSMN(),
          ciudadProp ? Promise.resolve({ city: null as string | null, ip: null as string | null }) : getCityFromIP(),
        ]);

        // Guardar IP siempre (para mostrar en UI)
        if (ipResult.ip) _ip = ipResult.ip;

        let station: SMNItem | undefined;

        // 1. Ciudad explícita (prop) — máxima prioridad
        if (!cancelled && ciudadProp) {
          station = matchCity(items, ciudadProp);
          console.log('[useClima] prop city:', ciudadProp, '→', station?.name);
        }

        // 2. Ciudad detectada por IP — más semántica que GPS para SMN
        if (!cancelled && !station && ipResult.city) {
          station = matchCity(items, ipResult.city);
          console.log('[useClima] IP city:', ipResult.city, '(', _ip, ') →', station?.name);
        }

        // 3. GPS como fallback geográfico (solo si IP no encontró match)
        if (!cancelled && !station) {
          const gps = await getGPS(3000);
          if (gps) {
            station = nearestStation(items, gps.lat, gps.lon);
            console.log('[useClima] GPS fallback →', station?.name);
          }
        }

        // 3. localStorage como último recurso
        if (!cancelled && !station) {
          const saved = localStorage.getItem('tankear_last_localidad');
          if (saved) {
            station = matchCity(items, saved);
            console.log('[useClima] localStorage:', saved, '→', station?.name);
          }
        }

        // 4. Fallback Buenos Aires
        if (!cancelled && !station) {
          station = items.find(i => i.name.toUpperCase().includes('BUENOS AIRES'));
          console.log('[useClima] fallback BA →', station?.name);
        }

        if (!cancelled) {
          const d: Omit<ClimaData, 'loading'> = {
            temp:        station?.weather?.temp        ?? null,
            descripcion: station?.weather?.description ?? null,
            ciudad:      station?.name                 ?? null,
            clientIP:    _ip,
            humedad:     station?.weather?.humidity    ?? null,
            viento_vel:  station?.weather?.wind_speed  ?? null,
            viento_dir:  station?.weather?.wing_deg    ?? null,
            presion:     station?.weather?.pressure    ?? null,
            visibilidad: station?.weather?.visibility  ?? null,
          };
          _result = { data: d, ts: Date.now() };
          setData({ ...d, loading: false });
        }
      } catch {
        if (!cancelled) setData({ ...EMPTY, clientIP: _ip, loading: false });
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [ciudadProp]);

  return data;
}
