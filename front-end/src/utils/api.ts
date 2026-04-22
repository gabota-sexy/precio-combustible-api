import {
  Station,
  FilterState,
  RenderAPIResponse,
  RenderStation,
  SmartAPIResponse,
  UbicacionResuelta,
  DatasetInfo } from
'../types';

export type { DatasetInfo, UbicacionResuelta };

// ─── API Configuration ───────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE || 'https://tvcpev0ryc.execute-api.sa-east-1.amazonaws.com';
const DEFAULT_TIMEOUT = 15000; // 15s — AWS Lambda can cold-start on first request

// ─── Types ───────────────────────────────────────────────────────────
export interface FetchOptions {
  limit?: number;
  signal?: AbortSignal;
  fecha_desde?: string;
}

export interface FetchResult {
  data: Station[];
  total: number;
  isFallback: boolean;
  source: 'api' | 'local-fallback';
  error?: string;
}

export interface NearbyOptions {
  lat: number;
  lon: number;
  radioKm?: number;
  provincia?: string;
  localidad?: string;
  producto?: string;
  fecha_desde?: string;
  signal?: AbortSignal;
}

// ─── In-Memory Cache ─────────────────────────────────────────────────
interface CacheEntry {
  data: Station[];
  total: number;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(endpoint: string, params: Record<string, string>): string {
  return `${endpoint}:${JSON.stringify(params)}`;
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function clearCache() {
  cache.clear();
}

// ─── Local Fallback Data ─────────────────────────────────────────────
export const LOCAL_FALLBACK_DATA: Station[] = [
{
  empresa: 'YPF',
  direccion: 'Ruta 5 km 35',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1215.5,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Shell',
  direccion: 'Avenida General Paz 1500',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1248.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Axion Energy',
  direccion: 'Ruta 3 km 25',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1198.75,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'ACA',
  direccion: 'Moreno 450',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1260.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'YPF',
  direccion: 'Avenida San Martín 800',
  producto: 'Gas Oil Grado 2',
  precio: 1335.25,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Shell',
  direccion: 'Ruta 2 km 40',
  producto: 'Gas Oil Grado 2',
  precio: 1358.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Axion Energy',
  direccion: 'Camino a La Reja 200',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1205.3,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'YPF',
  direccion: 'Ruta 7 km 50',
  producto: 'Nafta de más de 95 Ron',
  precio: 1425.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Shell',
  direccion: 'Av. Libertador 2200',
  producto: 'Nafta de más de 95 Ron',
  precio: 1460.5,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Puma Energy',
  direccion: 'Ruta 5 km 42',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1190.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Puma Energy',
  direccion: 'Ruta 5 km 42',
  producto: 'GNC',
  precio: 769.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
},
{
  empresa: 'Gulf',
  direccion: 'Av. Presidente Perón 3500',
  producto: 'Nafta (súper) entre 92 y 95 Ron',
  precio: 1175.0,
  provincia: 'BUENOS AIRES',
  localidad: 'MORENO',
  fecha_vigencia: '2026-03-23'
}];


// ─── Helpers ─────────────────────────────────────────────────────────
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS'
  }).format(amount);
};

// Known brand colors
const BRAND_COLORS: [string, string][] = [
['YPF', '#3b82f6'],
['SHELL', '#eab308'],
['AXION', '#ef4444'],
['ACA', '#22c55e'],
['PUMA', '#f97316'],
['GULF', '#60a5fa'],
['PETROBRAS', '#16a34a'],
['OIL COMBUSTIBLES', '#a855f7'],
['REFINOR', '#ec4899'],
['DAPSA', '#14b8a6'],
['SOL', '#fbbf24'],
['PAN AMERICAN', '#6366f1'],
['BLANCA', '#f472b6'],
['COPETRO', '#06b6d4'],
['RAIZEN', '#f59e0b'],
['VOY CON ENERGIA', '#10b981'],
['SERVISOL', '#8b5cf6'],
['CMF', '#0ea5e9'],
['DEHEZA', '#84cc16'],
['PLACOMGAS', '#f43f5e'],
['SAN MIGUEL', '#d946ef'],
['EMIDAM', '#fb923c'],
['LAS AVENIDAS', '#2dd4bf']];


// Generate a consistent color from a string (for unknown companies)
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate vibrant HSL color (avoid grays)
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

export const getCompanyColor = (empresa: string): string => {
  const n = empresa.toUpperCase();
  for (const [brand, color] of BRAND_COLORS) {
    if (n.includes(brand)) return color;
  }
  return hashColor(n);
};

const BRAND_CLASSES: [string, string][] = [
['YPF', 'bg-blue-500'],
['SHELL', 'bg-yellow-500'],
['AXION', 'bg-red-500'],
['ACA', 'bg-green-500'],
['PUMA', 'bg-orange-500'],
['GULF', 'bg-blue-400'],
['PETROBRAS', 'bg-green-600'],
['OIL', 'bg-purple-500'],
['REFINOR', 'bg-pink-500'],
['DAPSA', 'bg-teal-500']];


export const getCompanyColorClass = (empresa: string): string => {
  const n = empresa.toUpperCase();
  for (const [brand, cls] of BRAND_CLASSES) {
    if (n.includes(brand)) return cls;
  }
  return 'bg-amber-600';
};

// ─── Convert API response to Station ─────────────────────────────────
function parsePrice(raw: any): number {
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (isNaN(num) || num < 0) return 0;
  // Filter out values that look like coordinates (-34.xxx, -58.xxx)
  if (num < 0) return 0;
  return num;
}

function toStation(raw: RenderStation): Station {
  return {
    empresa: (raw.empresa || '').trim(),
    razon_social: raw.razon_social?.trim() || undefined,
    bandera: raw.bandera?.trim() || undefined,
    tipo_bandera: raw.tipo_bandera?.trim() || undefined,
    numero_establecimiento: raw.numero_establecimiento?.trim() || undefined,
    calle: raw.calle?.trim() || undefined,
    numero: raw.numero?.trim() || undefined,
    direccion: (raw.direccion || '').trim(),
    localidad: (raw.localidad || '').trim().toUpperCase(),
    provincia: (raw.provincia || '').trim().toUpperCase(),
    codigo_postal: raw.codigo_postal?.trim() || undefined,
    latitud: raw.latitud ?? undefined,
    longitud: raw.longitud ?? undefined,
    producto: (raw.producto || '').trim(),
    precio: parsePrice(raw.precio),
    fecha_vigencia: (raw.fecha_vigencia || '').trim(),
    precio_vigente: raw.precio_vigente,
    distancia: raw.distancia_km ?? undefined
  };
}

// ─── Fetch with Timeout ──────────────────────────────────────────────
async function fetchWithTimeout(
url: string,
timeoutMs: number,
signal?: AbortSignal)
: Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Core API Call ───────────────────────────────────────────────────
async function callApi(
endpoint: string,
params: Record<string, string>,
signal?: AbortSignal)
: Promise<{data: Station[];total: number;}> {
  const cacheKey = getCacheKey(endpoint, params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[API] Cache hit: ${cached.data.length} registros`);
    return { data: cached.data, total: cached.total };
  }

  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;

  console.log(`[API] Fetching: ${url}`);
  const response = await fetchWithTimeout(url, DEFAULT_TIMEOUT, signal);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json: RenderAPIResponse = await response.json();
  const stations = (json.estaciones || []).
  map(toStation).
  filter((s) => s.precio > 0 || s.bandera != null);  // incluir catalog stations sin precio
  const total = json.total || stations.length;

  // Cache the result
  cache.set(cacheKey, { data: stations, total, timestamp: Date.now() });

  console.log(`[API] ✓ ${stations.length} estaciones (total: ${total})`);
  return { data: stations, total };
}

// ─── Public: Smart Fetch (primary endpoint) ──────────────────────────
export interface SmartResult {
  data: Station[];
  total: number;
  ubicacion: UbicacionResuelta | null;
  isFallback: boolean;
  source: 'api-smart' | 'api' | 'local-fallback';
  error?: string;
}

export async function fetchSmartData(options: {
  lat?: number | null;
  lon?: number | null;
  provincia?: string;
  localidad?: string;
  barrio?: string;
  producto?: string;
  radio_km?: number;
  fecha_desde?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SmartResult> {
  const {
    lat,
    lon,
    provincia,
    localidad,
    barrio,
    producto,
    radio_km = 15,
    fecha_desde,
    limit = 500,
    signal
  } = options;

  try {
    const params: Record<string, string> = {};
    // Only add lat/lon if they are valid numbers (not null)
    if (typeof lat === 'number' && typeof lon === 'number') {
      params.lat = lat.toString();
      params.lon = lon.toString();
    }
    if (provincia) params.provincia = provincia;
    if (localidad) params.localidad = localidad;
    if (barrio) params.barrio = barrio;
    if (producto) params.producto = producto;
    if (radio_km) params.radio_km = radio_km.toString();
    if (fecha_desde) params.fecha_desde = fecha_desde;
    if (limit) params.limit = limit.toString();

    const cacheKey = getCacheKey('/precios/smart', params);
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(`[API] Smart cache hit: ${cached.data.length} registros`);
      return {
        data: cached.data,
        total: cached.total,
        ubicacion: null,
        isFallback: false,
        source: 'api-smart'
      };
    }

    const queryString = new URLSearchParams(params).toString();
    const url = `${API_BASE}/precios/smart${queryString ? '?' + queryString : ''}`;

    console.log(`[API] Smart fetch: ${url}`);
    const response = await fetchWithTimeout(url, DEFAULT_TIMEOUT, signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json: SmartAPIResponse = await response.json();
    const stations = (json.estaciones || []).
    map(toStation).
    filter((s) => s.precio > 0 || s.bandera != null);  // incluir catalog stations sin precio (con logo de marca)
    const total = json.total || stations.length;

    cache.set(cacheKey, { data: stations, total, timestamp: Date.now() });

    console.log(
      `[API] Smart ✓ ${stations.length} estaciones (${json.ubicacion_resuelta?.method || 'unknown'})`
    );

    // Normalize ubicacion — API may return localidad/provincia as objects
    const rawUbic = json.ubicacion_resuelta;
    let ubicacion: UbicacionResuelta | null = null;
    if (rawUbic) {
      const normStr = (val: any): string | undefined => {
        if (typeof val === 'string') return val;
        if (val && typeof val === 'object') {
          // Extract the string field from nested objects like {localidad: "X", provincia: "Y", ...}
          if ('localidad' in val && typeof val.localidad === 'string')
          return val.localidad;
          if ('provincia' in val && typeof val.provincia === 'string')
          return val.provincia;
          if ('nombre' in val && typeof val.nombre === 'string')
          return val.nombre;
        }
        return undefined;
      };
      ubicacion = {
        method: rawUbic.method,
        precision: rawUbic.precision,
        lat: rawUbic.lat,
        lon: rawUbic.lon,
        localidad: normStr(rawUbic.localidad),
        provincia: normStr(rawUbic.provincia),
        localidad_detectada: normStr(rawUbic.localidad_detectada),
        localidad_dataset: normStr(rawUbic.localidad_dataset),
        distancia_dataset_km:
        typeof rawUbic.distancia_dataset_km === 'number' ?
        rawUbic.distancia_dataset_km :
        undefined
      };
    }

    return {
      data: stations,
      total,
      ubicacion,
      isFallback: false,
      source: 'api-smart'
    };
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    console.warn('[API] Smart falló, intentando /precios:', err.message);

    // Fallback to regular /precios
    try {
      const params: Record<string, string> = { limit: limit.toString() };
      if (producto) params.producto = producto;
      if (fecha_desde) params.fecha_desde = fecha_desde;

      const { data, total } = await callApi('/precios', params, signal);
      return {
        data,
        total,
        ubicacion: null,
        isFallback: false,
        source: 'api',
        error: 'Smart no disponible, usando /precios'
      };
    } catch (err2: any) {
      if (err2.name === 'AbortError') throw err2;
      console.warn('[API] Todo falló, usando datos locales');
      const fallback = applyLocalFallback(
        {
          provincia: '',
          localidad: '',
          barrio: '',
          empresa: '',
          producto: producto || '',
          fecha_desde: fecha_desde || ''
        },
        err.message
      );
      return { ...fallback, ubicacion: null, source: 'local-fallback' };
    }
  }
}

// ─── Public: Fetch Dataset Info ──────────────────────────────────────
export async function fetchDatasetInfo(): Promise<DatasetInfo | null> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/info`, 10000);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Helpers: extract string from possibly-object API values ─────────
function toStringArray(arr: any[]): string[] {
  return arr.
  map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      // API may return {localidad: "X", ...} or {provincia: "Y", ...} or {nombre: "Z"}
      return String(
        item.localidad ||
        item.provincia ||
        item.nombre ||
        item.name ||
        JSON.stringify(item)
      );
    }
    return String(item);
  }).
  filter(Boolean);
}

// ─── Public: Fetch Provinces ─────────────────────────────────────────
export async function fetchProvincias(): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/provincias`, 15000);
    if (!response.ok) return [];
    const data = await response.json();
    const raw = Array.isArray(data) ? data : data.provincias || [];
    return toStringArray(raw);
  } catch {
    return [];
  }
}

// ─── Public: Fetch Localidades for a Province ────────────────────────
export async function fetchLocalidades(provincia: string): Promise<string[]> {
  if (!provincia) return [];
  try {
    const params = new URLSearchParams({ provincia });
    const response = await fetchWithTimeout(
      `${API_BASE}/localidades?${params.toString()}`,
      15000
    );
    if (!response.ok) return [];
    const data = await response.json();
    const raw = Array.isArray(data) ? data : data.localidades || [];
    return toStringArray(raw);
  } catch {
    return [];
  }
}

// ─── Public: Fetch Filtered Stations ─────────────────────────────────
export async function fetchFuelData(
filters: FilterState,
options: FetchOptions = {})
: Promise<FetchResult> {
  const { limit = 500, signal, fecha_desde } = options;

  try {
    const params: Record<string, string> = {};
    if (filters.provincia) params.provincia = filters.provincia;
    if (filters.localidad) params.localidad = filters.localidad;
    if (filters.producto) params.producto = filters.producto;
    if (limit) params.limit = limit.toString();
    // Use filter's fecha_desde or the option's
    const dateFilter = filters.fecha_desde || fecha_desde;
    if (dateFilter) params.fecha_desde = dateFilter;

    const { data, total } = await callApi('/precios', params, signal);

    // Filter by empresa client-side (API doesn't have empresa filter)
    let filtered = data;
    if (filters.empresa) {
      filtered = data.filter((s) =>
      s.empresa.toUpperCase().includes(filters.empresa.toUpperCase())
      );
    }

    return {
      data: filtered,
      total,
      isFallback: false,
      source: 'api'
    };
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;

    console.warn('[API] Fetch falló, usando datos locales:', err.message);
    return applyLocalFallback(filters, err.message);
  }
}

// ─── Public: Fetch Nearby Stations ───────────────────────────────────
export async function fetchNearbyStations(
options: NearbyOptions)
: Promise<FetchResult> {
  const {
    lat,
    lon,
    radioKm = 10,
    provincia,
    localidad,
    producto,
    signal
  } = options;

  try {
    const params: Record<string, string> = {
      lat: lat.toString(),
      lon: lon.toString(),
      radio_km: radioKm.toString()
    };
    if (provincia) params.provincia = provincia;
    if (localidad) params.localidad = localidad;
    if (producto) params.producto = producto;
    if (options.fecha_desde) params.fecha_desde = options.fecha_desde;

    const { data, total } = await callApi('/precios/cercanos', params, signal);

    return {
      data,
      total,
      isFallback: false,
      source: 'api'
    };
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;

    console.warn('[API] Cercanos falló, usando datos locales:', err.message);
    return applyLocalFallback(
      {
        provincia: provincia || '',
        localidad: localidad || '',
        barrio: '',
        empresa: '',
        producto: producto || '',
        fecha_desde: ''
      },
      err.message
    );
  }
}

// ─── Public: Fetch Cheapest Stations ─────────────────────────────────
export async function fetchCheapestStations(
filters: FilterState,
top: number = 10,
signal?: AbortSignal)
: Promise<FetchResult> {
  try {
    const params: Record<string, string> = { top: top.toString() };
    if (filters.provincia) params.provincia = filters.provincia;
    if (filters.localidad) params.localidad = filters.localidad;
    if (filters.producto) params.producto = filters.producto;
    if (filters.fecha_desde) params.fecha_desde = filters.fecha_desde;

    const { data, total } = await callApi('/precios/baratos', params, signal);

    return {
      data,
      total,
      isFallback: false,
      source: 'api'
    };
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;

    console.warn('[API] Baratos falló, usando datos locales:', err.message);
    return applyLocalFallback(filters, err.message);
  }
}

// ─── Public: Health Check ────────────────────────────────────────────
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/health`, 10000);
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Local Fallback ──────────────────────────────────────────────────
function applyLocalFallback(
filters: FilterState,
errorMsg: string)
: FetchResult {
  let filtered = [...LOCAL_FALLBACK_DATA];

  if (filters.provincia) {
    filtered = filtered.filter((s) =>
    s.provincia.toUpperCase().includes(filters.provincia.toUpperCase())
    );
  }
  if (filters.localidad) {
    filtered = filtered.filter((s) =>
    s.localidad.toUpperCase().includes(filters.localidad.toUpperCase())
    );
  }
  if (filters.empresa) {
    filtered = filtered.filter((s) =>
    s.empresa.toUpperCase().includes(filters.empresa.toUpperCase())
    );
  }
  if (filters.producto) {
    filtered = filtered.filter((s) =>
    s.producto.toUpperCase().includes(filters.producto.toUpperCase())
    );
  }

  return {
    data: filtered,
    total: filtered.length,
    isFallback: true,
    source: 'local-fallback',
    error: errorMsg
  };
}

// ─── Available Products ──────────────────────────────────────────────
export const PRODUCTOS_DISPONIBLES = [
'GNC',
'Gas Oil Grado 2',
'Gas Oil Grado 3',
'Nafta (súper) entre 92 y 95 Ron',
'Nafta (premium) de más de 95 Ron'];