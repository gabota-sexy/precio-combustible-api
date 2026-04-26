// Estadísticas y Timeline endpoints

const API_BASE = import.meta.env.VITE_API_BASE || 'https://tankear.com.ar/api';
const DEFAULT_TIMEOUT = 30000;

async function fetchWithTimeout(
url: string,
timeout: number,
signal?: AbortSignal)
: Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: signal || controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ─── Estadísticas Endpoint ───────────────────────────────────────────
export interface EstadisticasProducto {
  producto: string;
  precio_min: number;
  precio_max: number;
  precio_promedio: number;
  precio_mediana: number;
  cantidad_estaciones: number;
  por_bandera: Array<{
    bandera: string;
    precio_promedio: number;
    cantidad_estaciones: number;
  }>;
}

export interface EstadisticasResponse {
  productos: EstadisticasProducto[];
  ultima_actualizacion: string;
  nota_cobertura: string;
}

export async function fetchEstadisticas(options: {
  provincia?: string;
  localidad?: string;
  lat?: number;
  lon?: number;
  radio_km?: number;
  producto?: string;
  fecha_desde?: string;
}): Promise<EstadisticasResponse> {
  const { provincia, localidad, lat, lon, radio_km, producto, fecha_desde } = options;

  // Default: solo precios de los últimos 7 días — Argentina tiene inflación alta, datos viejos distorsionan
  const cutoff = fecha_desde || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  })();

  const params: Record<string, string> = {};
  if (provincia) params.provincia = provincia;
  if (localidad) params.localidad = localidad;
  if (typeof lat === 'number' && typeof lon === 'number') {
    params.lat = lat.toString();
    params.lon = lon.toString();
  }
  if (radio_km) params.radio_km = radio_km.toString();
  if (producto) params.producto = producto;
  params.fecha_desde = cutoff;

  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}/precios/estadisticas${queryString ? '?' + queryString : ''}`;

  console.log(`[API] Estadísticas fetch: ${url}`);
  const response = await fetchWithTimeout(url, DEFAULT_TIMEOUT);

  if (!response.ok) {
    throw new Error(`Estadísticas API error: ${response.status}`);
  }

  const raw = await response.json();

  // El backend devuelve "por_producto" — mapeamos al shape que espera el componente
  return {
    productos: (raw.por_producto || []).map((p: any) => ({
      producto:            p.producto,
      precio_min:          p.precio_min,
      precio_max:          p.precio_max,
      precio_promedio:     p.precio_promedio,
      precio_mediana:      p.precio_mediana,
      cantidad_estaciones: p.count_estaciones ?? p.cantidad_estaciones ?? 0,
      por_bandera: (p.por_bandera || []).map((b: any) => ({
        bandera:             b.bandera,
        precio_promedio:     b.precio_promedio,
        cantidad_estaciones: b.count ?? b.cantidad_estaciones ?? 0,
      })),
    })),
    ultima_actualizacion: raw.ultima_actualizacion || '',
    nota_cobertura:       raw.nota_cobertura || '',
  } as EstadisticasResponse;
}

// ─── Timeline Endpoint ───────────────────────────────────────────────
export interface TimelinePoint {
  fecha: string;
  precio_min: number;
  precio_promedio: number;
  cantidad_estaciones: number;
}

export interface TimelineResponse {
  total_puntos: number;
  precio_inicial: number;
  precio_actual: number;
  variacion_pct: number;
  timeline: TimelinePoint[];
}

export async function fetchTimeline(options: {
  provincia?: string;
  localidad?: string;
  producto: string;
  bandera?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}): Promise<TimelineResponse> {
  const { provincia, localidad, producto, bandera, fecha_desde, fecha_hasta } =
  options;

  const params: Record<string, string> = {};
  if (provincia) params.provincia = provincia;
  if (localidad) params.localidad = localidad;
  params.producto = producto;
  if (bandera) params.bandera = bandera;
  if (fecha_desde) params.fecha_desde = fecha_desde;
  if (fecha_hasta) params.fecha_hasta = fecha_hasta;

  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}/precios/timeline${queryString ? '?' + queryString : ''}`;

  console.log(`[API] Timeline fetch: ${url}`);
  const response = await fetchWithTimeout(url, DEFAULT_TIMEOUT);

  if (!response.ok) {
    throw new Error(`Timeline API error: ${response.status}`);
  }

  return response.json();
}