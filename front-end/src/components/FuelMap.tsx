import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Station, getProductInfo } from '../types';
import { formatCurrency } from '../utils/api';
import { isStale } from '../utils/stale';
import { MapPinIcon, PlusCircleIcon } from 'lucide-react';
import { ActualizarPrecioModal, ReportarEstacionModal, NuevaEstacionModal } from './community/CommunityActions';

// ── Brand marker SVGs para estaciones sin precio ─────────────────────────────
const BRAND_MARKERS: Record<string, string> = {
  YPF: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#003DA5"/>
    <rect x="22" y="0" width="22" height="22" rx="0" fill="#003DA5"/>
    <rect x="33" y="0" width="11" height="22" rx="11" fill="#003DA5"/>
    <text x="22" y="15" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="11" fill="white" letter-spacing="0.5">YPF</text>
    <rect x="0" y="18" width="44" height="4" rx="2" fill="#E8001C" opacity="0.9"/>
  </svg>`,

  GULF: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#F47920"/>
    <text x="22" y="15.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="white" font-style="italic">Gulf</text>
  </svg>`,

  AXION: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#5B21B6"/>
    <text x="22" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="10" fill="white" letter-spacing="0.3">axion</text>
  </svg>`,

  PUMA: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#15803D"/>
    <text x="22" y="15" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="10" fill="white" letter-spacing="1">PUMA</text>
  </svg>`,

  SHELL: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#DD1D21"/>
    <text x="22" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="10" fill="#FFC72C" letter-spacing="0.5">SHELL</text>
  </svg>`,

  BP: `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
    <rect width="44" height="22" rx="11" fill="#006600"/>
    <text x="22" y="15.5" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="12" fill="white">BP</text>
  </svg>`,
};

function getBrandMarkerHtml(bandera: string): string | null {
  const key = (bandera || '').toUpperCase().trim();
  const svg = BRAND_MARKERS[key];
  if (!svg) return null;
  const b64 = btoa(unescape(encodeURIComponent(svg)));
  return `<img src="data:image/svg+xml;base64,${b64}" width="44" height="22" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));cursor:pointer;" />`;
}
interface FocusPoint {
  lat: number;
  lon: number;
  radiusMeters: number;
  label: string;
}
export interface FuelMapProps {
  data:              Station[];
  selectedStation?:  Station | null;
  focusPoint?:       FocusPoint | null;
  className?:        string;
  style?:            React.CSSProperties;
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
function getMarkerKey(station: Station): string {
  return `${station.empresa}|${station.direccion}|${station.producto}`;
}
function buildPopupHtml(station: Station): string {
  const product = getProductInfo(station.producto);
  const price = formatCurrency(station.precio);
  const vigencia = station.fecha_vigencia ?
  formatVigencia(station.fecha_vigencia) :
  '';
  const bandera =
  station.tipo_bandera && station.tipo_bandera !== 'PROPIA' ?
  `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:500;background:#e2e8f0;color:#64748b;">${station.tipo_bandera}</span>` :
  '';
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
      </div>
      <div style="font-size:12px;color:#475569;">
        <p style="margin:2px 0;"><strong>Dirección:</strong> ${station.direccion}</p>
        <p style="margin:2px 0;">${station.localidad}, ${station.provincia}${station.codigo_postal ? ` <span style="color:#94a3b8;">(${station.codigo_postal})</span>` : ''}</p>
        ${vigencia ? `<p style="margin:4px 0 0;padding-top:4px;border-top:1px solid #e2e8f0;color:#94a3b8;"><strong>Vigencia:</strong> ${vigencia}</p>` : ''}
      </div>
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
export function FuelMap({ data, selectedStation, focusPoint, className, style }: FuelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const stationByKeyRef = useRef<Map<string, Station>>(new Map());
  const focusCircleRef = useRef<any>(null);
  const youAreHereRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const leafletRef = useRef<any>(null);

  // Modal state for in-map reporting
  const [priceStation,   setPriceStation]   = useState<Station | null>(null);
  const [reportStation,  setReportStation]  = useState<Station | null>(null);
  const [newStationOpen, setNewStationOpen] = useState(false);

  // Refs to keep callbacks fresh inside Leaflet event listeners
  const setPriceRef  = useRef(setPriceStation);
  const setReportRef = useRef(setReportStation);
  setPriceRef.current  = setPriceStation;
  setReportRef.current = setReportStation;
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
        const brandHtml = noPrecio ? getBrandMarkerHtml(station.bandera as string || '') : null;
        const icon = L.divIcon({
          className: 'custom-marker',
          html: brandHtml
            // Estación sin precio → logo de la marca
            ? brandHtml
            : stale
            // Precio viejo → dot pequeño con color de producto
            ? `<div style="
                display:flex;align-items:center;justify-content:center;
                background-color:${color};
                width:14px;height:14px;
                border-radius:50%;
                border:2px solid rgba(255,255,255,0.7);
                box-shadow:0 1px 5px rgba(0,0,0,0.5);
                cursor:pointer;opacity:0.7;
              "></div>`
            // Precio fresco → pill con precio
            : `<div style="
                display:flex;align-items:center;gap:4px;
                background-color:${color};
                padding:3px 7px 3px 5px;
                border-radius:20px;
                border:1.5px solid rgba(255,255,255,0.85);
                box-shadow:0 2px 8px rgba(0,0,0,0.7);
                white-space:nowrap;
                cursor:pointer;
              ">
                <span style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.9);flex-shrink:0;"></span>
                <span style="font-size:11px;font-weight:700;color:white;letter-spacing:-0.3px;">${price}</span>
              </div>`,
          iconSize: brandHtml ? [44, 22] : stale ? [14, 14] : [90, 22],
          iconAnchor: brandHtml ? [22, 11] : stale ? [7, 7] : [45, 11],
          popupAnchor: [0, -14]
        });
        const key = getMarkerKey(station);
        stationByKeyRef.current.set(key, station);
        const marker = L.marker([station.latitud!, station.longitud!], { icon })
          .addTo(map)
          .bindPopup(buildPopupHtml(station), { maxWidth: 280, className: 'custom-popup' });
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
      {loading &&
      <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-slate-700 border-t-amber-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 text-sm">Cargando mapa...</p>
          </div>
        </div>
      }
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