import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
// @ts-ignore
import 'leaflet.markercluster/dist/MarkerCluster.css';
// @ts-ignore  
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Header } from '../components/Header';
import { QuickNav } from '../components/QuickNav';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { useUser } from '../hooks/useUser';
import { useSEO } from '../hooks/useSEO';
import {
  SearchIcon, FilterIcon, MapPinIcon, PhoneIcon, GlobeIcon,
  ZapIcon, ShoppingBagIcon, CarIcon, WindIcon, FuelIcon,
  XIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon, MapIcon,
} from 'lucide-react';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Station {
  _id: string;
  _nombre: string;
  _provincia: string;
  _localidad: string;
  marca: string;
  direccion?: string;
  lat: number;
  lon: number;
  estado?: string;
  telefono?: string;
  horario?: string;
  web?: string;
  tipo?: string;
  servicios?: string;
  combustibles?: string;
  chargebox?: number | string;
  fuel_type?: string;
  shop_type?: string;
  gnc: boolean;
  electrica: boolean;
  lavadero: boolean;
  tienda: boolean;
  servicio_completo: boolean;
  self_service: boolean;
  // precios estimados por tipo
  precios?: Record<string, number>;
  // YPF specific
  cargador_ev?: string;       // "SI"/"NO"
  cant_conectores?: number;
  serviclub?: string;         // "SI"/"NO"
  yer?: string;               // "SI"/"NO" — YPF en Ruta
  tipo_ubicacion?: string;    // "URBANA"/"RUTA"/"RURAL"
  tipo_despacho?: string;     // "LIQUIDOS"/"GNC"/"DUAL"
  red_propia?: string;        // "SI"/"NO"
  // Gulf specific
  place_id?: string;
  // Puma specific
  franquicia?: string;
  // All brands
  apies?: number;             // YPF ID
  codigo?: string;            // Axion ID
  cuit?: string;
  region?: string;
  codigo_postal?: string;
}

// ─── Brand logos (igual que FuelMap) ─────────────────────────────────────────
const BRAND_LOGOS: Record<string, string> = {
  'YPF':       'https://www.ypf.com/favicon.ico',
  'SHELL':     'https://www.shell.com.ar/favicon.ico',
  'AXION':     'https://www.axionenergy.com/favicon.ico',
  'PUMA':      'https://www.pumafuel.com.ar/favicon.ico',
  'GULF':      'https://www.gulf.com.ar/favicon.ico',
  'PETROBRAS': 'https://www.petrobras.com.ar/favicon.ico',
  'REFINOR':   'https://www.refinor.com.ar/favicon.ico',
  'OIL':       'https://www.oilcombustibles.com/favicon.ico',
};

const BRAND_COLORS_MAP: Record<string, string> = {
  'YPF':       '#003DA5',
  'SHELL':     '#DD1D21',
  'AXION':     '#5B21B6',
  'PUMA':      '#15803D',
  'GULF':      '#F47920',
  'PETROBRAS': '#1B9E3E',
  'REFINOR':   '#E31837',
  'OIL':       '#0EA5E9',
  'BLANCA':    '#64748b',
  'OTHER':     '#64748b',
};

function normalizeBrandKey(raw: string): string {
  const s = (raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('YPF'))       return 'YPF';
  if (s.includes('SHELL'))     return 'SHELL';
  if (s.includes('AXION') || s.includes('ESSO')) return 'AXION';
  if (s.includes('PUMA'))      return 'PUMA';
  if (s.includes('GULF'))      return 'GULF';
  if (s.includes('PETROBRAS')) return 'PETROBRAS';
  if (s.includes('REFINOR'))   return 'REFINOR';
  if (s.includes('OIL'))       return 'OIL';
  return 'OTHER';
}

function getBrandInitials(raw: string): string {
  const brand = normalizeBrandKey(raw);
  if (brand !== 'OTHER') return brand.slice(0, 3);
  return (raw || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();
}

function getBrandMarkerHtml(bandera: string): string {
  const brand = normalizeBrandKey(bandera);
  const color = BRAND_COLORS_MAP[brand] || BRAND_COLORS_MAP['OTHER'];
  const logoUrl = BRAND_LOGOS[brand];
  const initials = getBrandInitials(bandera);

  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="22" height="22" style="object-fit:contain;border-radius:3px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />`
    : '';

  const fallbackSpan = `<span style="display:${logoUrl ? 'none' : 'flex'};align-items:center;justify-content:center;color:white;font-size:${initials.length > 2 ? '9' : '11'}px;font-weight:700;font-family:Arial Black,Arial,sans-serif;letter-spacing:-0.5px;line-height:1;">${initials}</span>`;

  return `<div style="width:36px;height:36px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;">${logoImg}${fallbackSpan}</div>`;
}

// ─── Haversine ────────────────────────────────────────────────────────────────
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Favoritos (localStorage) ─────────────────────────────────────────────────
function getFavStations(): string[] {
  try { return JSON.parse(localStorage.getItem('fav_stations') || '[]'); } catch { return []; }
}
function isFavSurtidor(id: string): boolean { return getFavStations().includes(id); }

// ─── Promos ───────────────────────────────────────────────────────────────────
interface PromoItem {
  banco: string;
  marca: string;
  pct: string;
  tope: string;
  dia: string;
}

function normalizarMarcaPromo(marca: string): string {
  const u = (marca || '').toUpperCase().trim();
  if (u.includes('YPF'))   return 'YPF';
  if (u.includes('SHELL')) return 'SHELL';
  if (u.includes('AXION')) return 'AXION';
  if (u.includes('PUMA'))  return 'PUMA';
  if (u.includes('GULF'))  return 'GULF';
  return '';
}

// ─── Formatear precio ─────────────────────────────────────────────────────────
function fmtPrecio(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Popup HTML del surtidor ──────────────────────────────────────────────────
function buildSurtidorPopupHtml(station: Station, hasCharger: boolean, promos: PromoItem[]): string {
  const brand = normalizeBrandKey(station.marca);
  const logoUrl = BRAND_LOGOS[brand];
  const color = BRAND_COLORS_MAP[brand] || BRAND_COLORS_MAP['OTHER'];
  const initials = getBrandInitials(station.marca);

  // Logo HTML
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="32" height="32" style="object-fit:contain;border-radius:50%;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />`
    : '';
  const logoFallback = `<span style="display:${logoUrl ? 'none' : 'flex'};align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;font-family:Arial Black,Arial,sans-serif;">${initials}</span>`;

  const addr = [station.direccion, station._localidad, station._provincia].filter(Boolean).join(', ');

  // Precios pills
  const FUEL_PILLS: Array<{ key: string; label: string; color: string }> = [
    { key: 'super',   label: 'Súper',   color: '#2563eb' },
    { key: 'premium', label: 'Premium', color: '#7c3aed' },
    { key: 'infinia', label: 'Infinia', color: '#b45309' },
    { key: 'gasoil',  label: 'Gasoil',  color: '#ea580c' },
    { key: 'gnc',     label: 'GNC',     color: '#16a34a' },
  ];
  let precioHtml = '';
  if (station.precios && Object.keys(station.precios).length > 0) {
    const pills = FUEL_PILLS
      .filter(f => station.precios![f.key])
      .map(f => `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;background:${f.color}22;border:1px solid ${f.color}55;color:${f.color};font-size:11px;font-weight:600;">● ${f.label} $${fmtPrecio(station.precios![f.key])}</span>`)
      .join('');
    if (pills) {
      precioHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;">${pills}</div>`;
    }
  }

  // Charger badge
  const chargerBadge = hasCharger
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;margin-bottom:6px;">⚡ Carga eléctrica</span>`
    : '';

  // Promos badge
  const marcaNorm = normalizarMarcaPromo(station.marca);
  const tienePromos = promos.some(p => p.marca === 'Todas' || p.marca === marcaNorm);
  const promosBadge = tienePromos
    ? `<a href="/promos" target="_blank" rel="noopener" style="display:inline-block;padding:2px 8px;border-radius:99px;background:#fff7ed;border:1px solid #fed7aa;color:#c2410c;font-size:11px;font-weight:700;text-decoration:none;margin-bottom:6px;">🏷️ Tiene promos — Ver →</a>`
    : '';

  // Google Maps
  const lat = station.lat ?? 0;
  const lng = station.lon ?? 0;
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  // Favorito
  const stationId = station._id;
  const favored = isFavSurtidor(stationId);
  const heartChar = favored ? '♥' : '♡';
  const favLabel = favored ? 'Guardada' : 'Guardar favorita';
  const favBg = favored ? '#fce7f3' : 'transparent';
  const favColor = favored ? '#be185d' : '#94a3b8';
  const favBorder = favored ? '#fbcfe8' : '#334155';

  return `
    <div style="padding:4px;font-family:system-ui,sans-serif;min-width:220px;">
      <!-- Header: logo + nombre + dirección -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="width:36px;height:36px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
          ${logoImg}${logoFallback}
        </div>
        <div style="flex:1;min-width:0;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;line-height:1.2;">${station._nombre}</p>
          ${addr ? `<p style="margin:2px 0 0;font-size:11px;color:#64748b;line-height:1.3;">${addr}</p>` : ''}
        </div>
      </div>

      <!-- Precios -->
      ${precioHtml}

      <!-- Badges: cargador + promos -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
        ${chargerBadge}${promosBadge}
      </div>

      <!-- Cómo llegar -->
      <a href="${gmapsUrl}" target="_blank" rel="noopener"
        style="display:block;width:100%;padding:8px;background:#2563eb;color:white;text-align:center;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;box-sizing:border-box;">
        📍 Cómo llegar
      </a>

      <!-- Guardar favorita -->
      <button
        data-surtidor-fav="${stationId}"
        style="display:block;width:100%;padding:8px;border:1px solid ${favBorder};border-radius:6px;background:${favBg};cursor:pointer;font-size:13px;color:${favColor};margin-top:6px;box-sizing:border-box;">
        ${heartChar} ${favLabel}
      </button>
    </div>
  `;
}

// ─── Config por marca (UI sidebar) ───────────────────────────────────────────
const BRAND_CFG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  ypf:   { label: 'YPF',   color: '#60a5fa', bg: 'bg-blue-500/15',   border: 'border-blue-500/40',   dot: '#3b82f6' },
  gulf:  { label: 'Gulf',  color: '#fb923c', bg: 'bg-orange-500/15', border: 'border-orange-500/40', dot: '#f97316' },
  puma:  { label: 'Puma',  color: '#f87171', bg: 'bg-red-500/15',    border: 'border-red-500/40',    dot: '#ef4444' },
  axion: { label: 'Axion', color: '#a78bfa', bg: 'bg-violet-500/15', border: 'border-violet-500/40', dot: '#8b5cf6' },
};

const SERVICE_FILTERS = [
  { key: 'gnc',               label: 'GNC',             icon: WindIcon,        color: 'text-cyan-400'    },
  { key: 'electrica',         label: 'Eléctrica',       icon: ZapIcon,         color: 'text-yellow-400'  },
  { key: 'lavadero',          label: 'Lavadero',        icon: CarIcon,         color: 'text-blue-400'    },
  { key: 'tienda',            label: 'Tienda',          icon: ShoppingBagIcon, color: 'text-emerald-400' },
  { key: 'servicio_completo', label: 'Full Service',    icon: FuelIcon,        color: 'text-amber-400'   },
] as const;

// ─── Normalizar estación ──────────────────────────────────────────────────────
function normalizeStation(raw: any, idx: number): Station {
  const marca = (raw.marca || 'ypf').toLowerCase();

  let gnc = false, electrica = false, lavadero = false,
      tienda = false, servicio_completo = false, self_service = false;

  if (marca === 'ypf') {
    const despacho = (raw.tipo_despacho || '').toUpperCase();
    const tipoFull = (raw.tipo_full     || '').toUpperCase();
    gnc              = despacho === 'GNC' || despacho === 'DUAL';
    electrica        = (raw.cargador_ev  || '').toUpperCase() === 'SI';
    tienda           = tipoFull.includes('SERVICOMPRAS') || tipoFull.includes('TIENDA');
    servicio_completo= tipoFull.includes('FULL');
    self_service     = false;
  } else if (marca === 'puma') {
    const fuelType = (raw.fuel_type || '').toLowerCase();
    const shopType = (raw.shop_type || '').toString().trim();
    gnc              = fuelType.includes('gnc') || fuelType.includes('dual');
    electrica        = raw.chargebox === 1 || raw.chargebox === '1';
    tienda           = shopType !== '' && shopType !== '0' && shopType !== 'null' && shopType !== 'None';
    servicio_completo= false;
  } else if (marca === 'axion') {
    const svc = (raw.servicios || '').toLowerCase();
    gnc              = svc.includes('gnc');
    electrica        = svc.includes('electr') || svc.includes('carga ev') || svc.includes('cargador');
    lavadero         = svc.includes('lavadero') || svc.includes('lavado') || svc.includes('wash');
    tienda           = svc.includes('tienda') || svc.includes('minimercado');
    servicio_completo= svc.includes('full service') || svc.includes('servicio completo');
    self_service     = false;
  }

  return {
    ...raw,
    _id:        `${marca}-${idx}`,
    _nombre:    raw.razon_social || raw.nombre || marca.toUpperCase(),
    _provincia: (raw.provincia || '').trim(),
    _localidad: (raw.localidad || '').trim(),
    gnc, electrica, lavadero, tienda, servicio_completo, self_service,
    precios:    undefined,
  };
}

// ─── BrandCircle (logo circular en sidebar) ───────────────────────────────────
function BrandCircle({ marca, size = 'sm' }: { marca: string; size?: 'sm' | 'md' }) {
  const key = marca?.toLowerCase();
  const cfg = BRAND_CFG[key] || { label: marca?.toUpperCase() || '?', color: '#94a3b8', dot: '#475569' };
  const dim = size === 'md' ? 'w-9 h-9 text-[10px]' : 'w-7 h-7 text-[9px]';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-extrabold flex-shrink-0 select-none`}
      style={{ background: cfg.dot + '28', border: `1.5px solid ${cfg.dot}70`, color: cfg.color }}
    >
      {cfg.label}
    </div>
  );
}

// ─── BrandBadge ───────────────────────────────────────────────────────────────
function BrandBadge({ marca }: { marca: string }) {
  const cfg = BRAND_CFG[marca?.toLowerCase()] || { label: marca?.toUpperCase() || '?', color: '#94a3b8', bg: 'bg-slate-700/40', border: 'border-slate-600/40' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${cfg.bg} ${cfg.border} border`}
          style={{ color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// ─── StationRow (sidebar) ─────────────────────────────────────────────────────
function StationRow({ s, active, onClick, onHover, rowRef }: {
  s: Station; active: boolean; onClick: () => void;
  onHover?: (id: string | null) => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  const addr = [s.direccion, s._localidad].filter(Boolean).join(', ');
  const svcIcons: Array<{ icon: React.ElementType; color: string; title: string }> = [];
  if (s.gnc)               svcIcons.push({ icon: WindIcon,        color: 'text-cyan-400',    title: 'GNC' });
  if (s.electrica)         svcIcons.push({ icon: ZapIcon,         color: 'text-yellow-400',  title: 'Carga Eléctrica' });
  if (s.lavadero)          svcIcons.push({ icon: CarIcon,         color: 'text-blue-400',    title: 'Lavadero' });
  if (s.tienda)            svcIcons.push({ icon: ShoppingBagIcon, color: 'text-emerald-400', title: 'Tienda' });
  if (s.servicio_completo) svcIcons.push({ icon: FuelIcon,        color: 'text-amber-400',   title: 'Full Service' });

  return (
    <button
      ref={rowRef}
      onClick={onClick}
      onMouseEnter={() => onHover?.(s._id)}
      onMouseLeave={() => onHover?.(null)}
      data-station-id={s._id}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-800/70 transition-colors ${
        active ? 'bg-amber-500/10 border-l-2 border-l-amber-500' : 'hover:bg-slate-800/40'
      }`}
    >
      <div className="flex items-start gap-2">
        <BrandCircle marca={s.marca} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            {s.estado && (
              <span className={`text-[9px] font-medium ${
                s.estado.toLowerCase().includes('abiert') || s.estado === 'OPEN'
                  ? 'text-emerald-500' : 'text-slate-600'
              }`}>
                {s.estado}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-slate-200 leading-snug truncate">{s._nombre}</p>
          {addr && <p className="text-[10px] text-slate-500 truncate mt-0.5">{addr}</p>}
          {svcIcons.length > 0 && (
            <div className="flex gap-1 mt-1">
              {svcIcons.map(({ icon: Icon, color, title }) => (
                <span key={title} title={title} className={`${color} opacity-80`}>
                  <Icon className="w-2.5 h-2.5" />
                </span>
              ))}
            </div>
          )}
        </div>
        {active && (
          <MapPinIcon className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
}

// ─── Mapa con popups ──────────────────────────────────────────────────────────
function SurtidoresMap({ stations, activeStation, onStationClick, promos, onBoundsChange, hoveredStationId }: {
  stations: Station[];
  activeStation: Station | null;
  onStationClick: (s: Station) => void;
  promos: PromoItem[];
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  hoveredStationId?: string | null;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<any>(null);
  const leafletRef    = useRef<any>(null);
  const markersMapRef = useRef<Record<string, any>>({}); // stationId → L.Marker
  const clusterGroupRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Charger POIs: set of station _ids that have an integrated charger nearby
  const chargerIdsRef = useRef<Set<string>>(new Set());

  // Inject window._toggleFav global (once)
  useEffect(() => {
    const w = window as any;
    if (!w._toggleFav) {
      w._toggleFav = (id: string, btn: HTMLButtonElement) => {
        const favs: string[] = (() => {
          try { return JSON.parse(localStorage.getItem('fav_stations') || '[]'); } catch { return []; }
        })();
        const idx = favs.indexOf(id);
        let nowFav: boolean;
        if (idx === -1) { favs.push(id); nowFav = true; }
        else            { favs.splice(idx, 1); nowFav = false; }
        localStorage.setItem('fav_stations', JSON.stringify(favs));
        if (btn) {
          btn.style.background = nowFav ? '#fce7f3' : 'transparent';
          btn.style.color = nowFav ? '#be185d' : '#94a3b8';
          btn.style.borderColor = nowFav ? '#fbcfe8' : '#334155';
          btn.innerHTML = nowFav ? '♥ Guardada' : '♡ Guardar favorita';
        }
      };
    }
  }, []);

  // Initialize Leaflet map once
  useEffect(() => {
    let destroyed = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      leafletRef.current = L;
      if (destroyed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [-38.0, -63.5],
        zoom: 6,
        zoomControl: true,
        preferCanvas: true,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);

      // Use markercluster for performance with 2900+ markers
      const LMC = (await import('leaflet.markercluster')).default ?? (await import('leaflet.markercluster'));
      const clusterGroup = (L as any).markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        chunkedLoading: true,
        iconCreateFunction: (cluster: any) => {
          const count = cluster.getChildCount();
          const size = count < 10 ? 34 : count < 100 ? 40 : 46;
          return (L as any).divIcon({
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#f59e0b;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:${count < 100 ? 12 : 10}px;font-weight:800;color:#0f172a;font-family:Arial Black,Arial,sans-serif;">${count}</div>`,
            className: '',
            iconSize: [size, size],
            iconAnchor: [size/2, size/2],
          });
        },
      });
      clusterGroup.addTo(map);
      clusterGroupRef.current = clusterGroup;
      mapRef.current = map;

      // Emit bounds on every move/zoom so parent can sync list
      const emitBounds = () => {
        if (onBoundsChange) {
          const b = map.getBounds();
          onBoundsChange({
            north: b.getNorth(), south: b.getSouth(),
            east:  b.getEast(),  west:  b.getWest(),
          });
        }
      };
      map.on('moveend zoomend', emitBounds);
      // Emit initial bounds once ready (after a tick)
      setTimeout(emitBounds, 300);

      // Wire popup fav button
      map.on('popupopen', (e: any) => {
        const el = e.popup?.getElement?.();
        if (!el) return;
        const btn = el.querySelector('[data-surtidor-fav]') as HTMLButtonElement | null;
        if (btn) {
          btn.onclick = (ev) => {
            ev.stopPropagation();
            const id = btn.dataset.surtidorFav || '';
            (window as any)._toggleFav?.(id, btn);
          };
        }
      });

      setReady(true);
    })();
    return () => {
      destroyed = true;
      if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; }
    };
  }, []);

  // Fetch charger POIs once stations are ready
  useEffect(() => {
    if (!ready || stations.length === 0) return;
    const controller = new AbortController();
    (async () => {
      try {
        // Use a broad bbox center
        const res = await fetch(`${API_BASE}/pois?type=charging_station&lat=-34.6&lon=-58.4&radio=500`, { signal: controller.signal });
        if (!res.ok) return;
        const json = await res.json();
        const pois: Array<{ lat: number; lon: number }> = json.pois ?? json ?? [];
        if (!Array.isArray(pois) || pois.length === 0) return;
        // Cross-check with stations (50m threshold)
        for (const s of stations) {
          if (!s.lat || !s.lon) continue;
          for (const poi of pois) {
            if (haversineMeters(s.lat, s.lon, poi.lat, poi.lon) < 50) {
              chargerIdsRef.current.add(s._id);
              break;
            }
          }
        }
      } catch {}
    })();
    return () => controller.abort();
  }, [ready, stations]);

  // Re-render markers when stations list changes
  useEffect(() => {
    if (!ready || !mapRef.current || !clusterGroupRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    clusterGroupRef.current.clearLayers();
    markersMapRef.current = {};

    for (const s of stations) {
      if (!s.lat || !s.lon) continue;

      const brand = normalizeBrandKey(s.marca);
      const color = BRAND_COLORS_MAP[brand] || BRAND_COLORS_MAP['OTHER'];
      const isActive = activeStation?._id === s._id;
      const hasCharger = chargerIdsRef.current.has(s._id);

      // Pin circular con logo de marca (mismo patrón que FuelMap)
      const brandHtml = getBrandMarkerHtml(s.marca);
      const chargerOverlay = hasCharger
        ? `<span style="position:absolute;top:-8px;right:-8px;font-size:12px;line-height:1;background:#16a34a;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:1.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);">⚡</span>`
        : '';

      const activeBorder = isActive ? 'box-shadow:0 0 0 3px #f59e0b,0 0 10px #f59e0b99;' : '';
      const baseHtml = `<div style="position:relative;display:inline-block;width:36px;height:36px;border-radius:50%;${activeBorder}">${brandHtml}</div>`;
      const iconHtml = hasCharger
        ? `<div style="position:relative;display:inline-block;">${baseHtml}${chargerOverlay}</div>`
        : baseHtml;

      const icon = L.divIcon({
        className: 'custom-marker',
        html: iconHtml,
        iconSize:   [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -22],
      });

      const marker = L.marker([s.lat, s.lon], { icon });

      marker.on('click', () => onStationClick(s));
      markersMapRef.current[s._id] = marker;
      clusterGroupRef.current.addLayer(marker);
    }

    // Auto-fit map to show current page's stations (not when a station is active)
    if (!activeStation) {
      const validStations = stations.filter(s => s.lat && s.lon);
      if (validStations.length > 0 && validStations.length <= 25) {
        try {
          const bounds = L.latLngBounds(validStations.map(s => [s.lat, s.lon] as [number, number]));
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: false });
        } catch {}
      }
    }
  }, [ready, stations, activeStation, onStationClick, promos]);

  // Focus en estación activa
  useEffect(() => {
    if (!activeStation || !mapRef.current) return;
    if (activeStation.lat && activeStation.lon) {
      mapRef.current.setView([activeStation.lat, activeStation.lon], 15, { animate: true });
    }
  }, [activeStation]);

  // Highlight hovered marker from list
  useEffect(() => {
    const L = leafletRef.current;
    if (!L) return;
    // Reset all markers to normal size
    Object.entries(markersMapRef.current).forEach(([id, marker]: [string, any]) => {
      const isActive = activeStation?._id === id;
      const el = marker.getElement?.();
      if (el) {
        el.style.transform = el.style.transform?.replace(/ scale\([^)]+\)/, '') || '';
        el.style.zIndex = isActive ? '1001' : '';
        el.style.filter = '';
      }
    });
    // Highlight hovered marker
    if (hoveredStationId && markersMapRef.current[hoveredStationId]) {
      const marker = markersMapRef.current[hoveredStationId];
      const el = marker.getElement?.();
      if (el) {
        el.style.filter = 'drop-shadow(0 0 6px #f59e0b) drop-shadow(0 0 12px #f59e0b88)';
        el.style.zIndex = '1002';
      }
    }
  }, [hoveredStationId, activeStation]);

  return (
    <div className="relative w-full h-full">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-7 h-7 border-2 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-slate-400 text-xs">Iniciando mapa…</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" style={{ background: '#0f172a' }} />
      {ready && stations.length > 0 && (
        <div className="absolute bottom-3 right-3 z-[1000] bg-slate-950/80 backdrop-blur-sm border border-slate-700 rounded-lg px-2.5 py-1 text-[10px] text-slate-400 pointer-events-none">
          {stations.length.toLocaleString()} estaciones · click para detalles
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-popup .leaflet-popup-content-wrapper { border-radius:0.75rem; box-shadow:0 10px 25px rgba(0,0,0,0.2); }
        .custom-popup .leaflet-popup-content { margin:12px; }
        .custom-marker { background:none !important; border:none !important; }
      ` }} />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
const SIDEBAR_PAGE = 100;

export function SurtidoresPage() {
  useSEO({
    title:       'Surtidores — Directorio de estaciones de servicio en Argentina',
    description: 'Explorá todas las estaciones YPF, Gulf, Puma y Axion. Filtrá por GNC, carga eléctrica, lavadero, tienda y servicio completo.',
    canonical:   'https://tankear.com.ar/surtidores',
  });

  const { user, logout } = useUser();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loginOpen,      setLoginOpen]      = useState(false);

  const [allStations, setAllStations] = useState<Station[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // Promos: fetch UNA sola vez al montar
  const [promos, setPromos] = useState<PromoItem[]>([]);
  useEffect(() => {
    fetch(`${API_BASE}/promos`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.promos) setPromos(d.promos); })
      .catch(() => {});
  }, []);

  const [search,         setSearch]         = useState('');
  const [activeBrands,   setActiveBrands]   = useState<Set<string>>(new Set(['ypf', 'gulf', 'puma', 'axion']));
  const [activeServices, setActiveServices] = useState<Set<string>>(new Set());
  const [provinciaFilter,setProvinciaFilter]= useState('');
  const [sidebarPage,    setSidebarPage]    = useState(1);
  const [activeStation,  setActiveStation]  = useState<Station | null>(null);
  const [mobileView,     setMobileView]     = useState<'list' | 'map'>('map');
  const [mapBounds,      setMapBounds]      = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);
  const rowRefsMap = useRef<Record<string, HTMLButtonElement | null>>({});

  // Cargar estaciones
  useEffect(() => {
    fetch(`${API_BASE}/estaciones/todas?limit=5000`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => setAllStations((json.estaciones ?? []).map(normalizeStation)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Provincias únicas
  const provincias = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStations) if (s._provincia) set.add(s._provincia);
    return Array.from(set).sort();
  }, [allStations]);

  // Estaciones filtradas
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allStations.filter(s => {
      if (!activeBrands.has(s.marca?.toLowerCase())) return false;
      if (provinciaFilter && s._provincia.toLowerCase() !== provinciaFilter.toLowerCase()) return false;
      for (const svc of activeServices) if (!(s as any)[svc]) return false;
      if (q) {
        const hay = [s._nombre, s.direccion, s._localidad, s._provincia].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allStations, activeBrands, provinciaFilter, activeServices, search]);

  // Further filter by current map viewport (when bounds are known)
  const filteredInView = useMemo(() => {
    if (!mapBounds) return filtered;
    return filtered.filter(s =>
      s.lat >= mapBounds.south && s.lat <= mapBounds.north &&
      s.lon >= mapBounds.west  && s.lon <= mapBounds.east
    );
  }, [filtered, mapBounds]);

  // Reset paginación + estación activa cuando cambian FILTROS (no viewport)
  useEffect(() => { setSidebarPage(1); setActiveStation(null); }, [search, activeBrands, activeServices, provinciaFilter]);
  // Reset solo página cuando cambia el viewport del mapa
  useEffect(() => { setSidebarPage(1); }, [mapBounds]);

  // Stats por marca
  const brandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of filtered) { const m = s.marca?.toLowerCase(); c[m] = (c[m] || 0) + 1; }
    return c;
  }, [filtered]);

  // Service counts (de todas)
  const serviceCounts = useMemo(() => {
    const c: Record<string, number> = { gnc: 0, electrica: 0, lavadero: 0, tienda: 0, servicio_completo: 0 };
    for (const s of allStations) {
      if (s.gnc)               c.gnc++;
      if (s.electrica)         c.electrica++;
      if (s.lavadero)          c.lavadero++;
      if (s.tienda)            c.tienda++;
      if (s.servicio_completo) c.servicio_completo++;
    }
    return c;
  }, [allStations]);

  const totalSidebarPages = Math.ceil(filteredInView.length / SIDEBAR_PAGE);
  const sidebarItems = useMemo(() => {
    const s = (sidebarPage - 1) * SIDEBAR_PAGE;
    return filteredInView.slice(s, s + SIDEBAR_PAGE);
  }, [filteredInView, sidebarPage]);

  const toggleBrand = (b: string) => {
    setActiveBrands(prev => {
      const next = new Set(prev);
      if (next.has(b)) { if (next.size > 1) next.delete(b); } else next.add(b);
      return next;
    });
  };

  const toggleService = (k: string) => {
    setActiveServices(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const handleStationClick = useCallback((s: Station) => {
    setActiveStation(s);
    setMobileView('map');
    const idx = filteredInView.findIndex(f => f._id === s._id);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / SIDEBAR_PAGE) + 1;
      setSidebarPage(targetPage);
      // Scroll list to that row after page change (brief delay for render)
      setTimeout(() => {
        const el = rowRefsMap.current[s._id];
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    }
  }, [filteredInView]);

  const clearFilters = () => {
    setActiveServices(new Set());
    setProvinciaFilter('');
    setSearch('');
    setActiveBrands(new Set(['ypf', 'gulf', 'puma', 'axion']));
  };

  const hasFilters = activeServices.size > 0 || provinciaFilter || search || activeBrands.size < 4;

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-amber-500/30 flex flex-col">
      <Header
        user={user}
        onCreateAccount={() => setOnboardingOpen(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={logout}
      />
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onCreateAccount={() => { setLoginOpen(false); setOnboardingOpen(true); }}
      />
      <QuickNav />

      {/* ── Layout principal: sidebar + mapa ───────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 108px)' }}>

        {/* ── SIDEBAR IZQUIERDO ─────────────────────────────────────────── */}
        <div className={`
          flex flex-col border-r border-slate-800 bg-slate-950
          w-full lg:w-[340px] xl:w-[380px] flex-shrink-0
          ${mobileView === 'map' ? 'hidden lg:flex' : 'flex'}
        `}>

          {/* Título */}
          <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-amber-500/10 rounded-lg">
                <FuelIcon className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-100 leading-tight">Surtidores</h1>
                <p className="text-[10px] text-slate-500">
                  {loading ? 'Cargando…' : `${allStations.length.toLocaleString()} estaciones de 4 redes`}
                </p>
              </div>
            </div>
            {/* Dot stats por marca */}
            {!loading && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(BRAND_CFG).map(([brand, cfg]) => (
                  <div key={brand} className="flex items-center gap-1 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
                    <span style={{ color: cfg.color }}>{cfg.label}</span>
                    <span className="text-slate-600">{allStations.filter(s => s.marca?.toLowerCase() === brand).length}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Búsqueda */}
          <div className="px-3 py-2 border-b border-slate-800 flex-shrink-0">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Nombre, dirección, localidad…"
                className="w-full pl-8 pr-7 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <XIcon className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Filtros de marca */}
          <div className="px-3 py-2 border-b border-slate-800 flex-shrink-0">
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Red</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(BRAND_CFG).map(([brand, cfg]) => (
                <button
                  key={brand}
                  onClick={() => toggleBrand(brand)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all ${
                    activeBrands.has(brand) ? `${cfg.bg} ${cfg.border}` : 'bg-transparent border-slate-700 text-slate-600'
                  }`}
                  style={{ color: activeBrands.has(brand) ? cfg.color : undefined }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: activeBrands.has(brand) ? cfg.dot : '#475569' }} />
                  {cfg.label}
                  <span className="opacity-60 text-[9px]">({brandCounts[brand] ?? 0})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Filtros de servicios */}
          <div className="px-3 py-2 border-b border-slate-800 flex-shrink-0">
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Servicios</p>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_FILTERS.map(({ key, label, icon: Icon, color }) => (
                <button
                  key={key}
                  onClick={() => toggleService(key)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                    activeServices.has(key)
                      ? 'bg-slate-700/80 border-slate-500 text-slate-200'
                      : 'bg-transparent border-slate-700/60 text-slate-500 hover:border-slate-600'
                  }`}
                >
                  <Icon className={`w-2.5 h-2.5 ${activeServices.has(key) ? color : 'text-slate-600'}`} />
                  {label}
                  {serviceCounts[key] > 0 && <span className="opacity-40 text-[9px]">({serviceCounts[key].toLocaleString()})</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Provincia + limpiar */}
          <div className="px-3 py-2 border-b border-slate-800 flex-shrink-0 flex items-center gap-2">
            <select
              value={provinciaFilter}
              onChange={e => setProvinciaFilter(e.target.value)}
              className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-[10px] text-slate-300 focus:outline-none focus:border-amber-500/50 transition-colors"
            >
              <option value="">Todas las provincias</option>
              {provincias.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap"
              >
                <XIcon className="w-2.5 h-2.5" />
                Limpiar
              </button>
            )}
          </div>

          {/* Resultado count */}
          <div className="px-3 py-1.5 border-b border-slate-800 flex-shrink-0 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              <span className="text-slate-300 font-semibold">{filteredInView.length.toLocaleString()}</span> en este área
              {filtered.length !== filteredInView.length && (
                <span className="text-slate-700"> · {filtered.length.toLocaleString()} total</span>
              )}
            </span>
            {totalSidebarPages > 1 && (
              <span className="text-[10px] text-slate-600">{sidebarPage}/{totalSidebarPages}</span>
            )}
          </div>

          {/* Lista scrollable */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <div className="w-6 h-6 border-2 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
                <p className="text-slate-500 text-xs">Cargando…</p>
              </div>
            )}
            {error && !loading && (
              <div className="p-4 text-center">
                <p className="text-slate-500 text-xs">{error}</p>
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <FilterIcon className="w-6 h-6 text-slate-700" />
                <p className="text-slate-500 text-xs">Sin resultados</p>
                <button onClick={clearFilters} className="text-[10px] text-amber-400 hover:underline">Limpiar filtros</button>
              </div>
            )}
            {!loading && !error && sidebarItems.map(s => (
              <StationRow
                key={s._id}
                s={s}
                active={activeStation?._id === s._id}
                onClick={() => handleStationClick(s)}
                onHover={setHoveredStationId}
                rowRef={(el) => { rowRefsMap.current[s._id] = el; }}
              />
            ))}
          </div>

          {/* Paginación sidebar */}
          {totalSidebarPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-800 flex-shrink-0">
              <button
                onClick={() => setSidebarPage(p => Math.max(1, p - 1))}
                disabled={sidebarPage === 1}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeftIcon className="w-3 h-3" /> Ant.
              </button>
              <span className="text-[10px] text-slate-600">
                {((sidebarPage - 1) * SIDEBAR_PAGE) + 1}–{Math.min(sidebarPage * SIDEBAR_PAGE, filtered.length)} de {filtered.length.toLocaleString()}
              </span>
              <button
                onClick={() => setSidebarPage(p => Math.min(totalSidebarPages, p + 1))}
                disabled={sidebarPage === totalSidebarPages}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Sig. <ChevronRightIcon className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* ── MAPA DERECHO ──────────────────────────────────────────────── */}
        <div className={`flex-1 relative ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`}>
          <SurtidoresMap
            stations={filtered}
            activeStation={activeStation}
            onStationClick={handleStationClick}
            promos={promos}
            onBoundsChange={setMapBounds}
            hoveredStationId={hoveredStationId}
          />

        </div>

        {/* Mobile: toggle lista/mapa */}
        <div className="lg:hidden fixed bottom-4 right-4 z-[2001] flex gap-2">
          <button
            onClick={() => setMobileView(mobileView === 'map' ? 'list' : 'map')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-lg"
          >
            {mobileView === 'map' ? <><ListIcon className="w-3.5 h-3.5" /> Lista</> : <><MapIcon className="w-3.5 h-3.5" /> Mapa</>}
          </button>
        </div>
      </div>

      {/* ── BOTTOM SHEET: detalle de estación seleccionada (fixed, siempre visible) ── */}
      {activeStation && (
        <div className="fixed inset-x-0 bottom-0 z-[3000] flex flex-col" style={{ pointerEvents: 'auto' }}>
          {/* Backdrop tap-to-close */}
          <div className="flex-1" onClick={() => setActiveStation(null)} />
          {/* Sheet */}
          <div className="bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl overflow-y-auto" style={{ maxHeight: '85vh' }}>
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1 sticky top-0 bg-slate-900 z-10">
              <div className="w-10 h-1 rounded-full bg-slate-700" />
            </div>

            <div className="px-4 pb-8 pt-2">
              {/* ── Header ── */}
              <div className="flex items-start gap-3 mb-4">
                {(() => {
                  const key = activeStation.marca?.toLowerCase();
                  const cfg = BRAND_CFG[key] || { label: activeStation.marca?.toUpperCase()?.slice(0,4) || '?', color: '#94a3b8', dot: '#475569' };
                  const logoUrl = BRAND_LOGOS[normalizeBrandKey(activeStation.marca)];
                  return (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold flex-shrink-0 text-sm overflow-hidden"
                         style={{ background: (cfg as any).dot + '28', border: `2px solid ${(cfg as any).dot}70`, color: (cfg as any).color }}>
                      {logoUrl
                        ? <img src={logoUrl} className="w-8 h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                        : (cfg as any).label}
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <BrandBadge marca={activeStation.marca} />
                    {/* Estado */}
                    {activeStation.estado && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        activeStation.estado.toLowerCase().includes('abiert') || activeStation.estado === 'OPEN' || activeStation.estado === '1'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-700/40 text-slate-500 border-slate-600/30'
                      }`}>
                        {activeStation.estado === '1' ? 'Activa' : activeStation.estado === 'OPEN' ? 'Abierta' : activeStation.estado}
                      </span>
                    )}
                    {/* Tipo ubicación YPF */}
                    {activeStation.tipo_ubicacion && (
                      <span className="text-[10px] text-slate-500 border border-slate-700 rounded-full px-2 py-0.5">
                        {activeStation.tipo_ubicacion === 'RUTA' ? '🛣️ Ruta' : activeStation.tipo_ubicacion === 'RURAL' ? '🌾 Rural' : '🏙️ Urbana'}
                      </span>
                    )}
                    {/* YPF en Ruta */}
                    {activeStation.yer === 'SI' && (
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-full px-2 py-0.5 font-semibold">🛣️ YPF en Ruta</span>
                    )}
                    {/* Promos */}
                    {(() => {
                      const marcaNorm = normalizarMarcaPromo(activeStation.marca);
                      return promos.some(p => p.marca === 'Todas' || p.marca === marcaNorm) ? (
                        <a href="/promos" target="_blank" rel="noopener"
                           className="text-[10px] bg-orange-400/10 text-orange-400 border border-orange-400/30 rounded-full px-2 py-0.5 font-semibold hover:bg-orange-400/20">
                          🏷️ Tiene promos
                        </a>
                      ) : null;
                    })()}
                  </div>
                  <p className="text-base font-bold text-slate-100 leading-tight">{activeStation._nombre}</p>
                  {activeStation.empresa && activeStation.empresa !== activeStation._nombre && (
                    <p className="text-[11px] text-slate-600 mt-0.5">{activeStation.empresa}</p>
                  )}
                </div>
                <button
                  onClick={() => setActiveStation(null)}
                  className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* ── Dirección + Horario ── */}
              <div className="bg-slate-800/50 rounded-xl p-3 mb-3 space-y-1.5">
                {[activeStation.direccion, activeStation._localidad, activeStation._provincia].filter(Boolean).join(', ') && (
                  <div className="flex items-start gap-2">
                    <MapPinIcon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-slate-300 leading-snug">
                      {[activeStation.direccion, activeStation._localidad, activeStation._provincia].filter(Boolean).join(', ')}
                      {activeStation.codigo_postal && <span className="text-slate-600"> ({activeStation.codigo_postal})</span>}
                    </span>
                  </div>
                )}
                {activeStation.horario && activeStation.horario !== 'null' && activeStation.horario.length < 80 && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs flex-shrink-0">🕐</span>
                    <span className="text-xs text-slate-300">
                      {activeStation.horario.replace(/<[^>]*>/g, '').trim()}
                    </span>
                  </div>
                )}
                {activeStation.region && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs flex-shrink-0">📍</span>
                    <span className="text-[11px] text-slate-500">Región {activeStation.region}</span>
                  </div>
                )}
              </div>

              {/* ── Servicios (badges) ── */}
              {(() => {
                const badges: Array<{ label: string; cls: string }> = [];
                if (activeStation.gnc)               badges.push({ label: '⛽ GNC',            cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' });
                if (activeStation.electrica) {
                  const nConn = activeStation.cant_conectores;
                  badges.push({ label: `⚡ Carga eléctrica${nConn ? ` (${nConn} conn.)` : ''}`, cls: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30' });
                }
                if (activeStation.lavadero)          badges.push({ label: '🚿 Lavadero',         cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' });
                if (activeStation.tienda)             badges.push({ label: '🛒 Tienda',           cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' });
                if (activeStation.servicio_completo)  badges.push({ label: '🔧 Full Service',      cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' });
                if (activeStation.serviclub === 'SI') badges.push({ label: '⭐ ServiClub YPF',    cls: 'bg-blue-600/10 text-blue-400 border-blue-600/30' });
                if (activeStation.franquicia)         badges.push({ label: `🏪 ${activeStation.franquicia}`, cls: 'bg-slate-700/60 text-slate-400 border-slate-600/30' });
                // Parse Axion servicios string
                if (activeStation.servicios) {
                  const svc = activeStation.servicios.toLowerCase();
                  if (svc.includes('wifi'))       badges.push({ label: '📶 WiFi',     cls: 'bg-slate-700/60 text-slate-400 border-slate-600/30' });
                  if (svc.includes('card'))       badges.push({ label: '💳 Pago con tarjeta', cls: 'bg-slate-700/60 text-slate-400 border-slate-600/30' });
                  if (svc.includes('jumbo'))      badges.push({ label: '🛍️ Jumbo+',   cls: 'bg-slate-700/60 text-slate-400 border-slate-600/30' });
                  if (svc.includes('abierto24') || svc.includes('24hs')) badges.push({ label: '🕐 Abierto 24hs', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' });
                }
                if (!badges.length) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {badges.map((b, i) => (
                      <span key={i} className={`inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full border ${b.cls}`}>
                        {b.label}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* ── Combustibles disponibles ── */}
              {activeStation.combustibles && activeStation.combustibles !== 'null' && (() => {
                // Strip HTML tags (puma uses <br /> etc)
                const raw = activeStation.combustibles!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                const items = raw.split(/[,·\-]/).map(s => s.trim()).filter(s => s.length > 2);
                if (!items.length) return null;
                return (
                  <div className="mb-3">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold mb-1.5">Combustibles disponibles</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((item, i) => (
                        <span key={i} className="text-[11px] bg-slate-800 text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Precios ── */}
              {activeStation.precios && Object.keys(activeStation.precios).length > 0 && (() => {
                const PILLS = [
                  { key: 'super',   label: 'Súper',   cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30'      },
                  { key: 'premium', label: 'Premium', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
                  { key: 'infinia', label: 'Infinia', cls: 'bg-amber-600/15 text-amber-300 border-amber-600/30'   },
                  { key: 'gasoil',  label: 'Gasoil',  cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
                  { key: 'gnc',     label: 'GNC',     cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
                ] as const;
                const pills = PILLS.filter(p => activeStation.precios![p.key]);
                if (!pills.length) return null;
                return (
                  <div className="mb-4">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold mb-1.5">Precios estimados</p>
                    <div className="flex flex-wrap gap-2">
                      {pills.map(p => (
                        <span key={p.key} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${p.cls}`}>
                          <span className="opacity-50">●</span> {p.label} <span className="font-bold">${fmtPrecio(activeStation.precios![p.key])}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── CTAs ── */}
              <div className="space-y-2">
                {/* Cómo llegar — principal */}
                {activeStation.lat && activeStation.lon && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${activeStation.lat},${activeStation.lon}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors"
                  >
                    <MapPinIcon className="w-4 h-4" />
                    Cómo llegar
                  </a>
                )}
                {/* Teléfono */}
                {activeStation.telefono && (
                  <a
                    href={`tel:${activeStation.telefono}`}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm transition-colors"
                  >
                    <PhoneIcon className="w-4 h-4" />
                    {activeStation.telefono}
                  </a>
                )}
                {/* Web */}
                {activeStation.web && activeStation.web !== 'null' && (
                  <a
                    href={activeStation.web.startsWith('http') ? activeStation.web : `https://${activeStation.web}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm transition-colors"
                  >
                    <GlobeIcon className="w-4 h-4" />
                    Sitio web
                  </a>
                )}
              </div>

              {/* ── Info técnica (CUIT, ID) ── */}
              {(activeStation.cuit || activeStation.apies || activeStation.codigo) && (
                <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-3">
                  {activeStation.cuit && (
                    <span className="text-[10px] text-slate-700">CUIT: {activeStation.cuit}</span>
                  )}
                  {activeStation.apies && (
                    <span className="text-[10px] text-slate-700">APIES: {activeStation.apies}</span>
                  )}
                  {activeStation.codigo && (
                    <span className="text-[10px] text-slate-700">Cód: {activeStation.codigo}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
