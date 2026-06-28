import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Station, getProductInfo } from '../types';
import { formatCurrency } from '../utils/api';
import { isStale } from '../utils/stale';
import { MapPinIcon, PlusCircleIcon } from 'lucide-react';
import { ActualizarPrecioModal, ReportarEstacionModal, NuevaEstacionModal } from './community/CommunityActions';

// ── Brand logos — pines circulares con logo real de cada marca ───────────────
const BRAND_LOGOS: Record<string, string> = {
  'YPF':       'https://www.ypf.com/favicon.ico',
  'SHELL':     'https://www.shell.com.ar/favicon.ico',
  'AXION':     'https://www.axionenergy.com/favicon.ico',
  'PUMA':      'https://www.pumafuel.com.ar/favicon.ico',
  'GULF':      'https://www.gulf.com.ar/favicon.ico',
  'PETROBRAS': 'https://www.petrobras.com.ar/favicon.ico',
  'REFINOR':   'https://www.refinor.com.ar/favicon.ico',
  'OIL':       'https://www.oilcombustibles.com/favicon.ico',
  'DAPSA':     'https://www.ypf.com/favicon.ico',
};

const BRAND_COLORS: Record<string, string> = {
  'YPF':       '#003DA5',
  'SHELL':     '#DD1D21',
  'AXION':     '#5B21B6',
  'PUMA':      '#15803D',
  'GULF':      '#F47920',
  'PETROBRAS': '#1B9E3E',
  'REFINOR':   '#E31837',
  'OIL':       '#0EA5E9',
  'DAPSA':     '#003DA5',
  'BLANCA':    '#64748b',
  'VOY':       '#64748b',
  'OTHER':     '#64748b',
};

function normalizeBrand(raw: string): string {
  const s = (raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('YPF'))       return 'YPF';
  if (s.includes('SHELL'))     return 'SHELL';
  if (s.includes('AXION') || s.includes('ESSO')) return 'AXION';
  if (s.includes('PUMA'))      return 'PUMA';
  if (s.includes('GULF'))      return 'GULF';
  if (s.includes('PETROBRAS')) return 'PETROBRAS';
  if (s.includes('REFINOR'))   return 'REFINOR';
  if (s.includes('OIL'))       return 'OIL';
  if (s.includes('DAPSA'))     return 'DAPSA';
  if (s.includes('BLANCA'))    return 'BLANCA';
  if (s.includes('VOY'))       return 'VOY';
  return 'OTHER';
}

function getBrandInitials(raw: string): string {
  const brand = normalizeBrand(raw);
  if (brand !== 'OTHER') return brand.slice(0, 3);
  // Para marcas desconocidas: primeras letras de cada palabra
  return (raw || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();
}

function getBrandMarkerHtml(bandera: string, withLogo: boolean = true): string {
  const brand = normalizeBrand(bandera);
  const color = BRAND_COLORS[brand] || BRAND_COLORS['OTHER'];
  const logoUrl = BRAND_LOGOS[brand];
  const initials = getBrandInitials(bandera);

  const logoImg = (withLogo && logoUrl)
    ? `<img
        src="${logoUrl}"
        width="22" height="22"
        style="object-fit:contain;border-radius:3px;"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
      />`
    : '';

  const fallbackSpan = `<span style="
    display:${withLogo && logoUrl ? 'none' : 'flex'};
    align-items:center;justify-content:center;
    color:white;
    font-size:${initials.length > 2 ? '9' : '11'}px;
    font-weight:700;
    font-family:Arial Black,Arial,sans-serif;
    letter-spacing:-0.5px;
    line-height:1;
  ">${initials}</span>`;

  return `<div style="
    width:36px;height:36px;
    border-radius:50%;
    background:${color};
    border:2.5px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.55);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
    cursor:pointer;
  ">${logoImg}${fallbackSpan}</div>`;
}

// ── Haversine distance (metros) ───────────────────────────────────────────────
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Favoritos helpers (localStorage) ─────────────────────────────────────────
function getFavStations(): number[] {
  try {
    return JSON.parse(localStorage.getItem('fav_stations') || '[]');
  } catch {
    return [];
  }
}
function isFav(stationId: number): boolean {
  return getFavStations().includes(stationId);
}
function toggleFav(stationId: number): boolean {
  const favs = getFavStations();
  const idx = favs.indexOf(stationId);
  if (idx === -1) {
    favs.push(stationId);
    localStorage.setItem('fav_stations', JSON.stringify(favs));
    try { (window as any).dataLayer = (window as any).dataLayer || []; (window as any).dataLayer.push({ event: 'station_favorited', station_id: stationId }); } catch {}
    return true;
  } else {
    favs.splice(idx, 1);
    localStorage.setItem('fav_stations', JSON.stringify(favs));
    return false;
  }
}

interface FocusPoint {
  lat: number;
  lon: number;
  radiusMeters: number;
  label: string;
}
export type GpsState = 'loading' | 'searching' | 'found' | 'error' | 'done';

export interface FuelMapProps {
  data:              Station[];
  selectedStation?:  Station | null;
  focusPoint?:       FocusPoint | null;
  className?:        string;
  style?:            React.CSSProperties;
  gpsState?:         GpsState;
}
function MapPlaceholder() {
  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl h-[600px] flex flex-col items-center justify-center gap-4">
      <MapPinIcon className="w-12 h-12 text-slate-600" />
      <p className="text-slate-400 text-sm">Cargando mapa...</p>
    </div>);

}
function MapError({ message }: {message?: string;}) {
  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl h-[600px] flex flex-col items-center justify-center gap-4">
      <MapPinIcon className="w-12 h-12 text-slate-600" />
      <p className="text-slate-400 text-sm">No se pudo cargar el mapa</p>
      {message && <p className="text-slate-500 text-xs">{message}</p>}
    </div>);

}
function formatVigencia(fecha: string): string {
  if (!fecha) return '';
  try {
    return new Date(fecha).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return fecha;
  }
}
// ── Tipos y helpers para promos ───────────────────────────────────────────────
interface PromoItem {
  banco: string;
  marca: string;
  pct: string;
  tope: string;
  dia: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

function normalizarMarca(bandera: string): string {
  const u = (bandera || '').toUpperCase().trim();
  if (u.includes('YPF'))   return 'YPF';
  if (u.includes('SHELL')) return 'Shell';
  if (u.includes('AXION')) return 'Axion';
  if (u.includes('PUMA'))  return 'Puma';
  if (u.includes('GULF'))  return 'Gulf';
  return '';
}

function buildPromoHtml(promos: PromoItem[]): string {
  if (!promos.length) return '';
  const items = promos.map(p => {
    const dia  = p.dia  ? ` — <em>${p.dia}</em>`              : '';
    const tope = p.tope ? ` <span style="color:#94a3b8;">(tope ${p.tope})</span>` : '';
    return `<div style="margin:3px 0;font-size:11px;color:#0f172a;">
      <strong style="color:#16a34a;">${p.pct}</strong> con ${p.banco}${dia}${tope}
    </div>`;
  }).join('');
  return `
    <div style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:7px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#64748b;letter-spacing:0.05em;">🎫 PROMOS VIGENTES</p>
      ${items}
    </div>`;
}

function getMarkerKey(station: Station): string {
  return `${station.empresa}|${station.direccion}|${station.producto}`;
}

function buildPopupHtml(station: Station, promos: PromoItem[] = [], hasCharger: boolean = false): string {
  const product = getProductInfo(station.producto);
  const price = formatCurrency(station.precio);
  const vigencia = station.fecha_vigencia ?
  formatVigencia(station.fecha_vigencia) :
  '';
  const bandera =
  station.tipo_bandera && station.tipo_bandera !== 'PROPIA' ?
  `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:500;background:#e2e8f0;color:#64748b;">${station.tipo_bandera}</span>` :
  '';

  const chargerBadge = hasCharger
    ? `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:#d1fae5;color:#065f46;">⚡ Carga eléctrica</span>`
    : '';

  // Filtrar promos que aplican a esta marca
  const marcaNorm = normalizarMarca(station.bandera || station.empresa || '');
  const promosAplicables = promos.filter(p =>
    p.marca === 'Todas' || p.marca === marcaNorm
  );

  // Google Maps link
  const lat = station.latitud ?? 0;
  const lng = station.longitud ?? 0;
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  // Favorito state
  const stationId = (station as any).id ?? 0;
  const favored = stationId ? isFav(stationId) : false;
  const heartChar = favored ? '♥' : '♡';
  const favLabel = favored ? 'Guardado' : 'Guardar';
  const favBg = favored ? '#fce7f3' : '#f1f5f9';
  const favColor = favored ? '#be185d' : '#64748b';
  const favBorder = favored ? '#fbcfe8' : '#e2e8f0';

  return `
    <div style="padding:4px;font-family:system-ui,sans-serif;">
      <h3 style="font-weight:700;color:#0f172a;font-size:15px;margin:0 0 6px 0;">${station.bandera || station.empresa}</h3>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;">
        <span style="color:#059669;font-weight:700;font-size:17px;">${price}</span>
        <span style="color:#94a3b8;font-size:11px;">${product.unit}</span>
      </div>
      <div style="margin-bottom:8px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;color:white;background:${product.color};">${product.shortLabel}</span>
        ${bandera}
        ${chargerBadge}
      </div>
      <div style="font-size:12px;color:#475569;">
        <p style="margin:2px 0;"><strong>Dirección:</strong> ${station.direccion}</p>
        <p style="margin:2px 0;">${station.localidad}, ${station.provincia}${station.codigo_postal ? ` <span style="color:#94a3b8;">(${station.codigo_postal})</span>` : ''}</p>
        ${vigencia ? `<p style="margin:4px 0 0;padding-top:4px;border-top:1px solid #e2e8f0;color:#94a3b8;"><strong>Vigencia:</strong> ${vigencia}</p>` : ''}
      </div>
      ${buildPromoHtml(promosAplicables)}

      <!-- Google Maps + Favorito row -->
      <div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">
        <a
          href="${gmapsUrl}"
          target="_blank"
          rel="noopener noreferrer"
          data-action="gmaps"
          style="flex:1;padding:5px 8px;border-radius:6px;background:#2563eb;color:white;font-size:11px;font-weight:700;border:1px solid #1d4ed8;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;text-decoration:none;"
        >
          📍 Abrir en Google Maps
        </a>
        <button
          data-action="fav"
          data-station-id="${stationId}"
          data-favored="${favored ? '1' : '0'}"
          style="padding:5px 10px;border-radius:6px;background:${favBg};color:${favColor};font-size:11px;font-weight:700;border:1px solid ${favBorder};cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;"
        >
          <span data-fav-heart style="font-size:14px;">${heartChar}</span>
          <span data-fav-label>${favLabel}</span>
        </button>
      </div>
      <!-- GMaps hint (hidden by default, shown once via JS) -->
      <div
        data-gmaps-hint
        style="display:none;margin-top:6px;padding:5px 8px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:600;text-align:center;animation:fadeInOut 3s ease forwards;"
      >
        ¡Llegá directo activando Maps!
      </div>

      <!-- Action buttons -->
      <div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">
        <button data-action="price" style="flex:1;padding:5px 8px;border-radius:6px;background:#dcfce7;color:#16a34a;font-size:11px;font-weight:700;border:1px solid #bbf7d0;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
          💰 Actualizar precio
        </button>
        <button data-action="report" style="flex:1;padding:5px 8px;border-radius:6px;background:#fef3c7;color:#d97706;font-size:11px;font-weight:700;border:1px solid #fde68a;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
          🚩 Reportar
        </button>
      </div>
    </div>
  `;
}
export function FuelMap({ data, selectedStation, focusPoint, className, style, gpsState: externalGpsState }: FuelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const stationByKeyRef = useRef<Map<string, Station>>(new Map());
  const focusCircleRef = useRef<any>(null);
  const youAreHereRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const leafletRef = useRef<any>(null);

  // GPS overlay state
  const [gpsOverlayState, setGpsOverlayState] = useState<GpsState>('loading');
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayFading, setOverlayFading] = useState(false);
  const gpsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gpsTimer2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state for in-map reporting
  const [priceStation,   setPriceStation]   = useState<Station | null>(null);
  const [reportStation,  setReportStation]  = useState<Station | null>(null);
  const [newStationOpen, setNewStationOpen] = useState(false);

  // Refs to keep callbacks fresh inside Leaflet event listeners
  const setPriceRef  = useRef(setPriceStation);
  const setReportRef = useRef(setReportStation);
  setPriceRef.current  = setPriceStation;
  setReportRef.current = setReportStation;

  // Cargar promos una sola vez al montar
  const promosRef = useRef<PromoItem[]>([]);
  useEffect(() => {
    fetch(`${API_BASE}/promos`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.promos) promosRef.current = d.promos; })
      .catch(() => {});
  }, []);

  // GPS overlay lifecycle: respond to external gpsState prop
  useEffect(() => {
    if (externalGpsState === undefined) return;

    if (externalGpsState === 'loading') {
      setGpsOverlayState('loading');
      setOverlayVisible(true);
      setOverlayFading(false);
      // After 1s transition to 'searching'
      gpsTimerRef.current = setTimeout(() => {
        setGpsOverlayState('searching');
      }, 1000);
    } else if (externalGpsState === 'found') {
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
      setGpsOverlayState('found');
      // After 1.2s, fade out
      gpsTimer2Ref.current = setTimeout(() => {
        setOverlayFading(true);
        setTimeout(() => {
          setOverlayVisible(false);
          setGpsOverlayState('done');
        }, 300);
      }, 1200);
    } else if (externalGpsState === 'error') {
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
      setGpsOverlayState('error');
      setOverlayVisible(true);
      setOverlayFading(false);
    } else if (externalGpsState === 'done') {
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
      setOverlayFading(true);
      setTimeout(() => {
        setOverlayVisible(false);
        setGpsOverlayState('done');
      }, 300);
    }

    return () => {
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
      if (gpsTimer2Ref.current) clearTimeout(gpsTimer2Ref.current);
    };
  }, [externalGpsState]);

  // If no external gpsState provided, auto-manage based on map loading
  useEffect(() => {
    if (externalGpsState !== undefined) return;
    if (!loading) {
      // Map loaded, no GPS prop — just hide overlay after brief moment
      gpsTimerRef.current = setTimeout(() => {
        setOverlayFading(true);
        setTimeout(() => {
          setOverlayVisible(false);
          setGpsOverlayState('done');
        }, 300);
      }, 800);
    }
    return () => {
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
    };
  }, [loading, externalGpsState]);

  // Feature 1: charging stations POIs — fetch once on mount
  // Set of station keys that have an integrated charger nearby
  const chargerStationKeysRef = useRef<Set<string>>(new Set());
  // Independent chargers (lat/lon) visible at zoom >= 13
  const chargerMarkersRef = useRef<any[]>([]);

  useEffect(() => {
    async function fetchChargers() {
      try {
        const res = await fetch(`${API_BASE}/api/pois?type=charging_station`);
        if (!res.ok) return;
        const pois: Array<{ lat: number; lon: number; [k: string]: any }> = await res.json();
        if (!Array.isArray(pois)) return;

        const L = leafletRef.current;
        const map = mapRef.current;

        // Cross with fuel stations (Haversine < 50m)
        const integratedLatLons = new Set<string>();
        data.forEach(station => {
          if (!station.latitud || !station.longitud) return;
          for (const poi of pois) {
            if (haversineMeters(station.latitud, station.longitud, poi.lat, poi.lon) < 50) {
              const key = getMarkerKey(station);
              chargerStationKeysRef.current.add(key);
              integratedLatLons.add(`${poi.lat},${poi.lon}`);
            }
          }
        });

        // Independent chargers
        if (L && map) {
          const independentPois = pois.filter(p => !integratedLatLons.has(`${p.lat},${p.lon}`));
          independentPois.forEach(poi => {
            const icon = L.divIcon({
              className: 'custom-marker',
              html: `<div style="
                display:flex;align-items:center;justify-content:center;
                background-color:#16a34a;
                width:28px;height:28px;
                border-radius:50%;
                border:2px solid rgba(255,255,255,0.85);
                box-shadow:0 2px 8px rgba(0,0,0,0.6);
                font-size:15px;
                cursor:pointer;
              ">⚡</div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
              popupAnchor: [0, -16],
            });
            const marker = L.marker([poi.lat, poi.lon], { icon })
              .bindPopup('<div style="font-family:system-ui,sans-serif;padding:4px;"><strong>⚡ Cargador eléctrico</strong></div>', { maxWidth: 200 });

            // Visibility controlled by zoom
            const currentZoom = map.getZoom();
            if (currentZoom >= 13) marker.addTo(map);

            chargerMarkersRef.current.push(marker);
          });

          // Listen to zoom changes to show/hide independent charger markers
          map.on('zoomend', () => {
            const z = map.getZoom();
            chargerMarkersRef.current.forEach(m => {
              if (z >= 13) {
                if (!map.hasLayer(m)) m.addTo(map);
              } else {
                if (map.hasLayer(m)) map.removeLayer(m);
              }
            });
          });
        }
      } catch {
        // graceful degradation — map keeps working normally
      }
    }
    // Only run after map is initialized (loading = false)
    if (!loading) {
      fetchChargers();
    }
  }, [loading, data]);

  // Initialize map once
  useEffect(() => {
    let destroyed = false;
    async function init() {
      try {
        const L = await import('leaflet');
        const leaflet = L.default || L;
        await import('leaflet/dist/leaflet.css');
        leafletRef.current = leaflet;
        // Fix default icon paths
        try {
          delete (leaflet.Icon.Default.prototype as any)._getIconUrl;
          leaflet.Icon.Default.mergeOptions({
            iconRetinaUrl:
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
            iconUrl:
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
            shadowUrl:
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
          });
        } catch {}
        if (destroyed || !containerRef.current) return;
        const map = leaflet.map(containerRef.current, {
          center: [-34.6037, -58.3816],
          zoom: 10,
          zoomControl: true
        });
        leaflet.
        tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          {
            attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          }
        ).
        addTo(map);
        mapRef.current = map;

        // Wire popup action buttons to React modals
        map.on('popupopen', (e: any) => {
          const popupEl = e.popup?.getElement?.();
          if (!popupEl) return;
          const markerKey = e.popup._source?._stationKey;
          const station = markerKey ? stationByKeyRef.current.get(markerKey) : undefined;
          if (!station) return;

          const priceBtn  = popupEl.querySelector('[data-action="price"]');
          const reportBtn = popupEl.querySelector('[data-action="report"]');
          const favBtn    = popupEl.querySelector('[data-action="fav"]');
          const gmapsLink = popupEl.querySelector('[data-action="gmaps"]');
          const gmapsHint = popupEl.querySelector('[data-gmaps-hint]');

          if (priceBtn) {
            priceBtn.addEventListener('click', (ev: Event) => {
              ev.stopPropagation();
              setPriceRef.current(station);
            });
          }
          if (reportBtn) {
            reportBtn.addEventListener('click', (ev: Event) => {
              ev.stopPropagation();
              setReportRef.current(station);
            });
          }

          // Feature 2: Google Maps hint (shown once)
          if (gmapsLink && gmapsHint) {
            gmapsLink.addEventListener('click', () => {
              if (!localStorage.getItem('gmaps_hint_shown')) {
                (gmapsHint as HTMLElement).style.display = 'block';
                localStorage.setItem('gmaps_hint_shown', '1');
                setTimeout(() => {
                  (gmapsHint as HTMLElement).style.display = 'none';
                }, 3000);
              }
            });
          }

          // Feature 3: Favorito button
          if (favBtn) {
            favBtn.addEventListener('click', (ev: Event) => {
              ev.stopPropagation();
              const stationId = parseInt((favBtn as HTMLElement).dataset.stationId || '0', 10);
              if (!stationId) return;
              const nowFav = toggleFav(stationId);
              const heartEl = favBtn.querySelector('[data-fav-heart]') as HTMLElement | null;
              const labelEl = favBtn.querySelector('[data-fav-label]') as HTMLElement | null;
              if (heartEl) heartEl.textContent = nowFav ? '♥' : '♡';
              if (labelEl) labelEl.textContent = nowFav ? 'Guardado' : 'Guardar';
              (favBtn as HTMLElement).style.background = nowFav ? '#fce7f3' : '#f1f5f9';
              (favBtn as HTMLElement).style.color = nowFav ? '#be185d' : '#64748b';
              (favBtn as HTMLElement).style.borderColor = nowFav ? '#fbcfe8' : '#e2e8f0';
              (favBtn as HTMLElement).dataset.favored = nowFav ? '1' : '0';
            });
          }
        });

        setLoading(false);
      } catch (err: any) {
        if (!destroyed) {
          console.error('Failed to init Leaflet map:', err);
          setError(err.message || 'Error al cargar Leaflet');
        }
      }
    }
    init();
    return () => {
      destroyed = true;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
      markersRef.current.clear();
    };
  }, []);
  // Update markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    // Clear old markers
    markersRef.current.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch {}
    });
    markersRef.current.clear();
    stationByKeyRef.current.clear();
    const validData = data.filter(
      (d) =>
      d.latitud &&
      d.longitud &&
      !isNaN(d.latitud) &&
      !isNaN(d.longitud) &&
      d.latitud !== 0
    );
    if (validData.length === 0) return;
    // Add new markers
    validData.forEach((station) => {
      try {
        const productInfo = getProductInfo(station.producto || '');
        const noPrecio = station.precio == null || station.precio === 0;
        const stale = noPrecio || isStale(station);
        const color = productInfo.color;
        const price = formatCurrency(station.precio);
        // Siempre usar pin circular con logo de marca
        const rawBandera = (station.bandera as string) || station.empresa || '';
        const brandHtml = getBrandMarkerHtml(rawBandera);
        const key = getMarkerKey(station);
        const hasCharger = chargerStationKeysRef.current.has(key);

        // Feature 1: ⚡ overlay on marker if has integrated charger
        const chargerOverlay = hasCharger
          ? `<span style="position:absolute;top:-8px;right:-8px;font-size:12px;line-height:1;background:#16a34a;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:1.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);">⚡</span>`
          : '';

        // Precio badge (solo si hay precio fresco)
        const priceBadge = !stale && !noPrecio
          ? `<div style="
              position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);
              background:${color};
              padding:2px 6px;
              border-radius:10px;
              border:1.5px solid rgba(255,255,255,0.9);
              box-shadow:0 2px 6px rgba(0,0,0,0.6);
              white-space:nowrap;
              pointer-events:none;
            ">
              <span style="font-size:10px;font-weight:700;color:white;letter-spacing:-0.3px;">${price}</span>
            </div>`
          : '';

        const baseHtml = `<div style="position:relative;display:inline-block;width:36px;height:36px;">${brandHtml}${priceBadge}</div>`;

        const iconHtml = hasCharger
          ? `<div style="position:relative;display:inline-block;">${baseHtml}${chargerOverlay}</div>`
          : baseHtml;

        // Con price badge: el icono ocupa 36px ancho, 50px alto (36 circulo + 14 badge)
        const iconH = (!stale && !noPrecio) ? 50 : 36;
        const icon = L.divIcon({
          className: 'custom-marker',
          html: iconHtml,
          iconSize: [36, iconH],
          iconAnchor: [18, 18],
          popupAnchor: [0, -iconH + 4]
        });
        stationByKeyRef.current.set(key, station);
        const marker = L.marker([station.latitud!, station.longitud!], { icon })
          .addTo(map)
          .bindPopup(() => buildPopupHtml(station, promosRef.current, hasCharger), { maxWidth: 300, className: 'custom-popup' });
        // Store key on marker so popupopen can retrieve the station
        (marker as any)._stationKey = key;
        markersRef.current.set(key, marker);
      } catch (e) {
        console.warn('Error adding marker:', e);
      }
    });
    // Fit bounds
    try {
      const lats = validData.map((d) => d.latitud!);
      const lons = validData.map((d) => d.longitud!);
      const bounds = L.latLngBounds(
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)]
      );
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15
      });
    } catch (e) {
      console.warn('Error fitting bounds:', e);
    }
  }, [data, loading]);
  // Fly to selected station
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStation?.latitud || !selectedStation?.longitud) return;
    try {
      map.flyTo([selectedStation.latitud, selectedStation.longitud], 16, {
        duration: 1.2
      });
      const key = getMarkerKey(selectedStation);
      setTimeout(() => {
        const marker = markersRef.current.get(key);
        if (marker) {
          try {
            marker.openPopup();
          } catch {}
        }
      }, 1300);
    } catch (e) {
      console.warn('Error flying to station:', e);
    }
  }, [selectedStation]);

  // Focus zone: zoom + circle + "You are here" marker
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Remove previous circle and you-are-here marker
    if (focusCircleRef.current) {
      try { map.removeLayer(focusCircleRef.current); } catch {}
      focusCircleRef.current = null;
    }
    if (youAreHereRef.current) {
      try { map.removeLayer(youAreHereRef.current); } catch {}
      youAreHereRef.current = null;
    }

    if (!focusPoint) return;

    try {
      const { lat, lon, radiusMeters, label } = focusPoint;

      // Fly to zone
      map.flyTo([lat, lon], 14, { duration: 1.0 });

      // Draw dashed zone circle
      const circle = L.circle([lat, lon], {
        radius: radiusMeters,
        color: '#f59e0b',
        fillColor: '#f59e0b',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '6 4',
      }).addTo(map).bindTooltip(label, {
        permanent: true,
        direction: 'top',
        className: 'barrio-tooltip',
        offset: [0, -8],
      });
      focusCircleRef.current = circle;

      // "You are here" pulsing marker
      const yahIcon = L.divIcon({
        className: 'you-are-here-marker',
        html: `<div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:rgba(245,158,11,0.15);animation:yah-pulse 1.8s ease-out infinite;"></div>
          <div style="position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(245,158,11,0.25);animation:yah-pulse 1.8s ease-out infinite 0.5s;"></div>
          <div style="position:absolute;width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2.5px solid white;box-shadow:0 0 10px rgba(245,158,11,0.8);"></div>
        </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -22],
      });

      const yahMarker = L.marker([lat, lon], {
        icon: yahIcon,
        zIndexOffset: 1000,
      }).addTo(map).bindPopup(
        `<div style="font-family:system-ui,sans-serif;padding:4px;">
          <strong style="color:#0f172a;">📍 ${label}</strong>
          <p style="color:#64748b;font-size:11px;margin:4px 0 0;">Tu ubicación actual</p>
        </div>`,
        { maxWidth: 200 }
      );

      youAreHereRef.current = yahMarker;
    } catch (e) {
      console.warn('Error drawing focus circle/marker:', e);
    }
  }, [focusPoint]);
  if (error) return <MapError message={error} />;
  return (
    <div
      className={className ?? "bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl overflow-hidden h-[600px] relative z-0"}
      style={style}
    >
      {/* GPS Loading Overlay */}
      {overlayVisible && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(15, 23, 42, 0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '20px',
            transition: 'opacity 300ms ease',
            opacity: overlayFading ? 0 : 1,
            backdropFilter: 'blur(4px)',
            borderRadius: 'inherit',
          }}
        >
          {gpsOverlayState === 'error' ? (
            /* Estado 4: Error GPS — pin shake, naranja, botón continuar */
            <div style={{ textAlign: 'center', padding: '0 32px', maxWidth: '340px' }}>
              {/* Pin con shake */}
              <div className="tk-pin-error" style={{ display: 'inline-block', marginBottom: '20px' }}>
                <svg width="36" height="50" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 28 16 28S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#f59e0b"/>
                  <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
                  <circle cx="16" cy="16" r="3" fill="#f59e0b"/>
                </svg>
              </div>
              <p style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '17px', margin: '0 0 8px', fontFamily: 'system-ui,sans-serif' }}>
                No encontramos tu ubicación exacta
              </p>
              <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 24px', fontFamily: 'system-ui,sans-serif', lineHeight: 1.5 }}>
                Te mostramos las estaciones de tu zona
              </p>
              <button
                onClick={() => {
                  setOverlayFading(true);
                  setTimeout(() => { setOverlayVisible(false); setGpsOverlayState('done'); }, 600);
                }}
                style={{
                  background: 'transparent',
                  color: 'white',
                  border: '1.5px solid rgba(255,255,255,0.6)',
                  borderRadius: '8px',
                  padding: '9px 28px',
                  fontWeight: 500,
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontFamily: 'system-ui,sans-serif',
                  letterSpacing: '0.02em',
                }}
              >
                Continuar
              </button>
            </div>
          ) : (
            /* Estados 1, 2 y 3 — Radar scanner */
            <div style={{ textAlign: 'center', padding: '0 32px', maxWidth: '320px', width: '100%' }}>

              {/* Contenedor radar + pin */}
              <div style={{ position: 'relative', width: '140px', height: '140px', margin: '0 auto 28px' }}>

                {/* Anillo exterior punteado rotando */}
                <div className={gpsOverlayState === 'found' ? 'tk-ring-outer tk-ring-found' : 'tk-ring-outer'} />

                {/* Anillo medio pulsando */}
                <div className={gpsOverlayState === 'found' ? 'tk-ring-mid tk-ring-found' : 'tk-ring-mid'} />

                {/* Barrido de radar — solo en loading/searching */}
                {gpsOverlayState !== 'found' && (
                  <div className="tk-radar-sweep" />
                )}

                {/* Onda de éxito — solo en found */}
                {gpsOverlayState === 'found' && (
                  <>
                    <div className="tk-success-wave tk-wave-1" />
                    <div className="tk-success-wave tk-wave-2" />
                  </>
                )}

                {/* Pin SVG central */}
                <div
                  className={
                    gpsOverlayState === 'found'
                      ? 'tk-pin-center tk-pin-drop'
                      : 'tk-pin-center tk-pin-wobble'
                  }
                >
                  <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 28 16 28S32 26 32 16C32 7.163 24.837 0 16 0z"
                          fill={gpsOverlayState === 'found' ? '#10b981' : '#3b82f6'}
                          style={{ transition: 'fill 0.4s ease' }}/>
                    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
                    <circle cx="16" cy="16" r="3" fill={gpsOverlayState === 'found' ? '#10b981' : '#3b82f6'} style={{ transition: 'fill 0.4s ease' }}/>
                  </svg>
                </div>
              </div>

              {/* Texto principal */}
              <p style={{
                color: gpsOverlayState === 'found' ? '#10b981' : '#f1f5f9',
                fontWeight: 600,
                fontSize: '17px',
                margin: '0 0 6px',
                fontFamily: 'system-ui,sans-serif',
                transition: 'color 0.4s ease',
              }}>
                {gpsOverlayState === 'loading'   && 'Buscando tu ubicacion'}
                {gpsOverlayState === 'searching' && 'Buscando tu ubicacion'}
                {gpsOverlayState === 'found'     && 'Listo! Mostrando estaciones cerca tuyo'}
              </p>

              {/* Subtítulo */}
              {(gpsOverlayState === 'loading' || gpsOverlayState === 'searching') && (
                <p style={{ color: '#94a3b8', fontSize: '12px', margin: '0 0 20px', fontFamily: 'system-ui,sans-serif', lineHeight: 1.5 }}>
                  Estamos encontrando las estaciones mas cercanas
                </p>
              )}
              {gpsOverlayState === 'found' && <div style={{ marginBottom: '20px' }} />}

              {/* Barra shimmer indeterminada — loading/searching */}
              {gpsOverlayState !== 'found' && (
                <div style={{
                  width: '100%',
                  height: '3px',
                  background: 'rgba(255,255,255,0.07)',
                  borderRadius: '99px',
                  overflow: 'hidden',
                }}>
                  <div className="tk-shimmer-bar" />
                </div>
              )}

              {/* Barra llena en found */}
              {gpsOverlayState === 'found' && (
                <div style={{
                  width: '100%',
                  height: '3px',
                  background: 'rgba(255,255,255,0.07)',
                  borderRadius: '99px',
                  overflow: 'hidden',
                }}>
                  <div className="tk-full-bar" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
          background: '#0f172a'
        }} />
      
      {/* Agregar estación overlay button */}
      <button
        onClick={() => setNewStationOpen(true)}
        className="absolute bottom-4 right-4 z-[1000] flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-lg transition-colors"
        title="Reportar nueva estación"
      >
        <PlusCircleIcon className="w-4 h-4" />
        Agregar estación
      </button>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-popup .leaflet-popup-content-wrapper { border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .custom-popup .leaflet-popup-content { margin: 12px; }
        .custom-marker { background: none !important; border: none !important; }
        .you-are-here-marker { background: none !important; border: none !important; }
        .barrio-tooltip { background: #f59e0b; color: #0f172a; font-weight: 700; font-size: 12px; border: none; border-radius: 4px; padding: 2px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        .barrio-tooltip::before { border-top-color: #f59e0b !important; }
        @keyframes yah-pulse {
          0%   { transform: scale(0.8); opacity: 0.8; }
          70%  { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(0.8); opacity: 0; }
        }
        @keyframes fadeInOut {
          0%   { opacity: 0; transform: translateY(-4px); }
          15%  { opacity: 1; transform: translateY(0); }
          75%  { opacity: 1; }
          100% { opacity: 0; }
        }
        /* ── Tankear GPS Scanner Animations (tk- prefix) ── */

        /* Anillo exterior: borde punteado rotando */
        @keyframes tk-spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to   { transform: translate(-50%, -50%) rotate(360deg); }
        }

        /* Anillo medio: pulso de escala */
        @keyframes tk-pulse-ring {
          0%   { transform: translate(-50%, -50%) scale(1);    opacity: 0.5; }
          50%  { transform: translate(-50%, -50%) scale(1.12); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(1);    opacity: 0.5; }
        }

        /* Barrido de radar: sector que rota */
        @keyframes tk-radar {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to   { transform: translate(-50%, -50%) rotate(360deg); }
        }

        /* Pin wobble mientras busca */
        @keyframes tk-wobble {
          0%   { transform: translate(-50%, -50%) rotate(0deg); }
          20%  { transform: translate(-50%, -50%) rotate(-3deg); }
          40%  { transform: translate(-50%, -50%) rotate(3deg); }
          60%  { transform: translate(-50%, -50%) rotate(-2deg); }
          80%  { transform: translate(-50%, -50%) rotate(2deg); }
          100% { transform: translate(-50%, -50%) rotate(0deg); }
        }

        /* Pin drop con rebote al encontrar */
        @keyframes tk-drop {
          0%   { transform: translate(-50%, calc(-50% - 60px)); opacity: 0; }
          60%  { transform: translate(-50%, calc(-50% + 8px));  opacity: 1; }
          75%  { transform: translate(-50%, calc(-50% - 4px));  opacity: 1; }
          88%  { transform: translate(-50%, calc(-50% + 3px));  opacity: 1; }
          100% { transform: translate(-50%, -50%);              opacity: 1; }
        }

        /* Onda de exito expandiendose */
        @keyframes tk-wave-expand {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
        }

        /* Shake para error */
        @keyframes tk-shake {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(-6px) rotate(-2deg); }
          30%  { transform: translateX(6px)  rotate(2deg); }
          45%  { transform: translateX(-4px) rotate(-1deg); }
          60%  { transform: translateX(4px)  rotate(1deg); }
          75%  { transform: translateX(-2px); }
          100% { transform: translateX(0); }
        }

        /* Shimmer indeterminado */
        @keyframes tk-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }

        /* --- Clases --- */

        /* Anillo exterior punteado */
        .tk-ring-outer {
          position: absolute;
          top: 50%; left: 50%;
          width: 120px; height: 120px;
          border-radius: 50%;
          border: 2px dashed rgba(59,130,246,0.55);
          animation: tk-spin 2s linear infinite;
        }
        .tk-ring-outer.tk-ring-found {
          animation: none;
          transform: translate(-50%, -50%) scale(0);
          transition: transform 0.3s ease-in, opacity 0.3s ease-in;
          opacity: 0;
        }

        /* Anillo medio semi-transparente pulsando */
        .tk-ring-mid {
          position: absolute;
          top: 50%; left: 50%;
          width: 88px; height: 88px;
          border-radius: 50%;
          border: 1.5px solid rgba(59,130,246,0.3);
          background: rgba(59,130,246,0.06);
          animation: tk-pulse-ring 1.5s ease-in-out infinite;
        }
        .tk-ring-mid.tk-ring-found {
          animation: none;
          transform: translate(-50%, -50%) scale(0);
          opacity: 0;
          transition: transform 0.3s ease-in, opacity 0.3s ease-in;
        }

        /* Barrido de radar: cono de 90deg girando */
        .tk-radar-sweep {
          position: absolute;
          top: 50%; left: 50%;
          width: 120px; height: 120px;
          border-radius: 50%;
          animation: tk-radar 1.6s linear infinite;
          background: conic-gradient(
            from 0deg,
            rgba(59,130,246,0.0)   0deg,
            rgba(59,130,246,0.0)   270deg,
            rgba(59,130,246,0.15)  290deg,
            rgba(59,130,246,0.55)  360deg
          );
        }

        /* Ondas de exito */
        .tk-success-wave {
          position: absolute;
          top: 50%; left: 50%;
          width: 80px; height: 80px;
          border-radius: 50%;
          border: 2px solid rgba(16,185,129,0.7);
          animation: tk-wave-expand 1s cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
        }
        .tk-wave-1 { animation-delay: 0s; }
        .tk-wave-2 { animation-delay: 0.22s; }

        /* Pin central — posicionado absolutamente en el centro */
        .tk-pin-center {
          position: absolute;
          top: 50%; left: 50%;
          z-index: 4;
          line-height: 0;
          transform-origin: center bottom;
        }
        .tk-pin-wobble {
          animation: tk-wobble 0.8s ease-in-out infinite;
        }
        .tk-pin-drop {
          animation: tk-drop 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        /* Error shake */
        .tk-pin-error {
          animation: tk-shake 0.5s ease-in-out;
        }

        /* Shimmer bar indeterminada */
        .tk-shimmer-bar {
          height: 100%;
          width: 30%;
          border-radius: 99px;
          background: linear-gradient(90deg, transparent, rgba(59,130,246,0.8), rgba(16,185,129,0.6), transparent);
          animation: tk-shimmer 1.6s ease-in-out infinite;
        }

        /* Barra full (estado found) */
        .tk-full-bar {
          height: 100%;
          width: 100%;
          border-radius: 99px;
          background: linear-gradient(90deg, #3b82f6, #10b981);
          box-shadow: 0 0 8px rgba(16,185,129,0.5);
          transition: width 0.5s ease;
        }

        /* Compatibilidad: mantener clases viejas por si algo las referencia */
        .gps-progress-bar { display: none; }
      `
        }} />

      {/* In-map modals — rendered via portal to escape map stacking context */}
      {priceStation && (
        <ActualizarPrecioModal
          station={{ empresa: priceStation.empresa, bandera: priceStation.bandera, direccion: priceStation.direccion, localidad: priceStation.localidad, provincia: priceStation.provincia }}
          open={true}
          onClose={() => setPriceStation(null)}
          productoInicial={priceStation.producto}
        />
      )}
      {reportStation && (
        <ReportarEstacionModal
          station={{ empresa: reportStation.empresa, bandera: reportStation.bandera, direccion: reportStation.direccion, localidad: reportStation.localidad, provincia: reportStation.provincia }}
          open={true}
          onClose={() => setReportStation(null)}
        />
      )}
      <NuevaEstacionModal open={newStationOpen} onClose={() => setNewStationOpen(false)} />
    </div>);

}
