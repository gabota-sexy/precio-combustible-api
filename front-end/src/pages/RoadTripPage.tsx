import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../components/Header';
import { QuickNav } from '../components/QuickNav';
import { Footer } from '../components/Footer';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { GarageSection } from '../components/garage/GarageSection';
import { useUser } from '../hooks/useUser';
import { useSEO } from '../hooks/useSEO';
import { useOSRM } from '../hooks/useOSRM';
import { useRoadTripFuel } from '../hooks/useRoadTripFuel';
import { useSITHoteles } from '../hooks/useSITHoteles';
import { useRouteWeather } from '../hooks/useRouteWeather';
import { useRoutePOIs } from '../hooks/useRoutePOIs';
import { TripForm } from '../components/viaje/TripForm';
import { RouteMap } from '../components/viaje/RouteMap';
import { FuelStopsPanel } from '../components/viaje/FuelStopsPanel';
import { ServiciosPanel } from '../components/viaje/ServiciosPanel';
import { WeatherAlerts } from '../components/viaje/WeatherAlerts';
import {
  RouteIcon, ClockIcon, RulerIcon, AlertCircleIcon,
  MapIcon, ShieldIcon, MapPinIcon, NavigationIcon,
  MinusIcon, PlusIcon, BookmarkIcon, CheckIcon, BookOpenIcon,
} from 'lucide-react';
import { haversine } from '../utils/haversine';
import type { TripQuery } from '../components/viaje/TripForm';
import type { FuelStop } from '../hooks/useRoadTripFuel';
import type { RoutePOI } from '../hooks/useRoutePOIs';
import type { Coords } from '../hooks/useOSRM';
import type { WaypointWeather } from '../hooks/useRouteWeather';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedWaypoint {
  key:           string;  // unique: "fuel-0", "poi-abc123"
  lat:           number;
  lon:           number;
  km_from_start: number;
  label:         string;
  sublabel:      string;
  type:          'fuel' | 'poi';
  icon:          string;
  desvio_km:     number;  // round-trip deviation from route
  desvio_min:    number;  // estimated minutes for the detour
  parada_min:    number;  // stop duration (configurable)
  category?:     string;  // POI category for default duration
}

// Default stop durations by type
const DEFAULT_PARADA_MIN: Record<string, number> = {
  fuel:        30,  // 30 min por defecto para cargar nafta
  restaurant:  45,
  fast_food:   30,
  cafe:        20,
  hotel:        0,  // pernocte — no cuenta como tiempo de conducción
  hostel:       0,
  camping:      0,
  rest_area:   15,
  supermarket: 20,
  pharmacy:    10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function buildGoogleMapsURL(
  from:      string,
  to:        string,
  waypoints: SelectedWaypoint[],
): string {
  // Sort by km, take first 8 (Google Maps limit)
  const sorted = [...waypoints]
    .sort((a, b) => a.km_from_start - b.km_from_start)
    .slice(0, 8);

  const wps = sorted.map(w => `${w.lat},${w.lon}`).join('|');

  const params = new URLSearchParams({
    api:         '1',
    origin:      from,
    destination: to,
    travelmode:  'driving',
  });
  if (wps) params.set('waypoints', wps);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// ── Hoja de ruta ──────────────────────────────────────────────────────────────

function HojaDeRuta({
  from, to, distance_km, duration_min, selected, onParadaChange,
}: {
  from: string; to: string;
  distance_km: number; duration_min: number;
  selected: SelectedWaypoint[];
  onParadaChange: (key: string, min: number) => void;
}) {
  const sorted = [...selected].sort((a, b) => a.km_from_start - b.km_from_start);

  // Totals
  const totalParadaMin = sorted.reduce((s, w) => s + w.parada_min, 0);
  const totalDesvioKm  = sorted.reduce((s, w) => s + w.desvio_km, 0);
  const totalDesvioMin = sorted.reduce((s, w) => s + w.desvio_min, 0);
  const totalMin       = duration_min + totalParadaMin + totalDesvioMin;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <MapIcon className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-slate-300">Hoja de ruta</h3>
      </div>

      {/* Trip summary */}
      <div className="flex items-center gap-3 flex-wrap mb-4 text-[10px] text-slate-500">
        <span>{distance_km.toLocaleString('es-AR')} km</span>
        <span>·</span>
        <span>🚗 {formatDuration(duration_min)} conducción</span>
        {totalParadaMin > 0 && (
          <>
            <span>·</span>
            <span>⏱️ {formatDuration(totalParadaMin)} paradas</span>
          </>
        )}
        {totalDesvioKm > 0 && (
          <>
            <span>·</span>
            <span>🔀 +{totalDesvioKm.toFixed(1)} km desvío</span>
          </>
        )}
        <span className="ml-auto text-xs font-bold text-amber-400">
          Total: {formatDuration(totalMin)}
        </span>
      </div>

      <div className="relative">
        <div className="absolute left-[9px] top-3 bottom-3 w-px bg-slate-700" />
        <div className="space-y-0">

          {/* Origin */}
          <div className="flex items-start gap-3 pb-4">
            <div className="w-[18px] h-[18px] rounded-full bg-emerald-500 border-2 border-slate-950 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-100 capitalize">{from}</p>
              <p className="text-[10px] text-slate-500">Inicio del viaje</p>
            </div>
          </div>

          {/* Selected waypoints */}
          {sorted.map((wp) => (
            <div key={wp.key} className="flex items-start gap-3 pb-4">
              <div className="w-[18px] h-[18px] rounded-full bg-slate-800 border-2 border-slate-600 flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px]">
                {wp.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-slate-300 truncate">{wp.label}</p>
                  <span className="text-[10px] text-amber-500/80 bg-amber-500/10 px-1.5 py-px rounded-full flex-shrink-0">
                    km {wp.km_from_start}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 truncate">{wp.sublabel}</p>

                {/* Duration + detour controls */}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {/* Editable stop duration */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-600">⏱️</span>
                    <button
                      type="button"
                      onClick={() => onParadaChange(wp.key, wp.parada_min - 5)}
                      className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 transition-colors"
                    >
                      <MinusIcon className="w-2.5 h-2.5" />
                    </button>
                    <span className="text-[10px] font-semibold text-slate-300 min-w-[32px] text-center">
                      {wp.parada_min} min
                    </span>
                    <button
                      type="button"
                      onClick={() => onParadaChange(wp.key, wp.parada_min + 5)}
                      className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 transition-colors"
                    >
                      <PlusIcon className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  {/* Detour indicator */}
                  {wp.desvio_km > 0.2 && (
                    <span className="text-[10px] text-blue-400/70">
                      🔀 +{wp.desvio_km.toFixed(1)} km · +{wp.desvio_min} min desvío
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Destination */}
          <div className="flex items-start gap-3">
            <div className="w-[18px] h-[18px] rounded-full bg-red-500 border-2 border-slate-950 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-100 capitalize">{to}</p>
              <p className="text-[10px] text-slate-500">Destino</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Floating Google Maps bar ───────────────────────────────────────────────────

function FloatingMapBar({
  from, to, selected, durationMin,
}: {
  from: string; to: string; selected: SelectedWaypoint[]; durationMin: number;
}) {
  const url    = buildGoogleMapsURL(from, to, selected);
  const count  = selected.length;
  const capped = Math.min(count, 8);

  const totalParadaMin = selected.reduce((s, w) => s + w.parada_min, 0);
  const totalDesvioKm  = selected.reduce((s, w) => s + w.desvio_km, 0);
  const totalMin       = durationMin + totalParadaMin + selected.reduce((s, w) => s + w.desvio_min, 0);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-4 flex justify-center lg:justify-start">
        <div className="pointer-events-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/60 px-4 py-3 flex items-center gap-4 min-w-0 w-full max-w-xl">

          {/* Icon */}
          <div className="w-9 h-9 rounded-xl bg-[#1a73e8]/20 border border-[#1a73e8]/30 flex items-center justify-center flex-shrink-0">
            <NavigationIcon className="w-4 h-4 text-[#4285F4]" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">
              {count === 0
                ? 'Elegí tus paradas'
                : `${capped} parada${capped !== 1 ? 's' : ''} · ${formatDuration(totalMin)}`}
            </p>
            <p className="text-[10px] text-slate-500 truncate">
              {count === 0
                ? 'Marcá ⛽ nafta, 🍴 restaurantes, 🏨 hoteles…'
                : `⏱️ ${formatDuration(totalParadaMin)} paradas` +
                  (totalDesvioKm > 0 ? ` · 🔀 +${totalDesvioKm.toFixed(1)} km` : '') +
                  (count > 8 ? ` · 8 de ${count} en Maps` : '')}
            </p>
          </div>

          {/* CTA */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all flex-shrink-0 ${
              count > 0
                ? 'bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-lg'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed pointer-events-none'
            }`}
            onClick={e => count === 0 && e.preventDefault()}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" opacity=".9"/>
              <circle cx="12" cy="9" r="2.5" fill="white"/>
            </svg>
            Abrir en Maps
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Seguros CTA ───────────────────────────────────────────────────────────────

function SegurosCTA({ from, to }: { from: string; to: string }) {
  return (
    <Link
      to="/cotizador"
      className="flex items-start gap-4 w-full bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/30 rounded-xl px-5 py-4 transition-all group"
    >
      <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 group-hover:bg-amber-500/20 flex items-center justify-center flex-shrink-0 transition-all">
        <ShieldIcon className="w-5 h-5 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-200 group-hover:text-white">¿Viajás asegurado?</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
          Antes de salir de <span className="text-slate-400">{from}</span> a <span className="text-slate-400">{to}</span>,
          cotizá tu seguro. Comparamos más de 20 aseguradoras en segundos.
        </p>
      </div>
      <span className="text-amber-500 text-xs font-medium flex-shrink-0 group-hover:translate-x-0.5 transition-transform mt-1">
        Cotizar →
      </span>
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

import {
  trackViajeOrigenIngresado,
  trackViajeDestinoIngresado,
  trackViajeCalculado,
  trackViajeParadaVista,
  trackViajeCompartido,
} from '../utils/analytics';

export function RoadTripPage() {
  useSEO({
    title:       'Calculadora de viaje en auto — nafta, paradas y clima en ruta | Tankear',
    description: 'Calculá el costo en nafta de tu viaje en auto por Argentina. Encontrá las estaciones más baratas en ruta, hoteles, clima y planificá tus paradas.',
    canonical:   'https://tankear.com.ar/viaje',
  });
  const { user, logout }               = useUser();
  const [onboardingOpen, setOnboard]   = useState(false);
  const [loginOpen,      setLoginOpen] = useState(false);
  const [query,          setQuery]     = useState<TripQuery | null>(null);

  const trackedSetQuery = (q: TripQuery) => {
    setQuery(q);
    trackViajeOrigenIngresado();
    trackViajeDestinoIngresado();
  };

  // ── Selection state ───────────────────────────────────────────────────────
  // Fuel stops: selected by index (auto-selected when station found)
  const [selectedFuelIdxs, setSelectedFuelIdxs] = useState<Set<number>>(new Set());
  // POIs: selected by OSM id string (opt-in)
  const [selectedPOIIds, setSelectedPOIIds]     = useState<Set<string>>(new Set());
  // Per-stop duration overrides: key → minutes
  const [paradaOverrides, setParadaOverrides]   = useState<Map<string, number>>(new Map());
  // Save trip state
  const [tripSaved,   setTripSaved]   = useState(false);
  const [savingTrip,  setSavingTrip]  = useState(false);
  const [garageOpen,  setGarageOpen]  = useState(false);

  // ── Data hooks ────────────────────────────────────────────────────────────
  const osrm    = useOSRM(query ? { from: query.from, to: query.to } : null);
  const fuel    = useRoadTripFuel(
    osrm.waypoints, query?.consumo_kml ?? 0,
    query?.tanque_l ?? 50, query?.producto ?? 'nafta_super',
    query?.litros_inicio,
  );
  const hotels  = useSITHoteles(osrm.geometry?.coordinates.length ? osrm.geometry : null, 15);
  const pois    = useRoutePOIs(osrm.geometry?.coordinates.length ? osrm.geometry : null, osrm.waypoints, 15);

  // Use actual fuel-stop waypoints for weather (falls back to route waypoints while fuel loads)
  const weatherWaypoints = useMemo(
    () => fuel.stops.length > 0 ? fuel.stops.map(s => s.waypoint) : osrm.waypoints,
    [fuel.stops, osrm.waypoints],
  );
  const weather = useRouteWeather(weatherWaypoints);

  // Build km → weather map for per-stop display in FuelStopsPanel
  const weatherByKm = useMemo<Map<number, WaypointWeather>>(() => {
    const m = new Map<number, WaypointWeather>();
    for (const w of weather.weather) m.set(w.km, w);
    return m;
  }, [weather.weather]);

  // Auto-select fuel stops with a station when they load
  useEffect(() => {
    if (!fuel.loading && fuel.stops.length > 0) {
      setSelectedFuelIdxs(new Set(
        fuel.stops.flatMap((s, i) => (s.station ? [i] : []))
      ));
    }
  }, [fuel.stops, fuel.loading]);

  // Reset selection when a new query is submitted
  useEffect(() => {
    setSelectedFuelIdxs(new Set());
    setSelectedPOIIds(new Set());
    setParadaOverrides(new Map());
  }, [query]);

  // ── Toggle handlers ───────────────────────────────────────────────────────
  function toggleFuel(idx: number) {
    setSelectedFuelIdxs(prev => {
      const next = new Set(prev);
      if (!prev.has(idx)) {
        // User is selecting a parada — track it
        const stop = fuel.stops[idx];
        if (stop?.station) trackViajeParadaVista(stop.station.empresa || 'desconocida');
      }
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function togglePOI(id: string) {
    setSelectedPOIIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Parada duration handler ─────────────────────────────────────────────
  function setParadaMin(key: string, min: number) {
    setParadaOverrides(prev => {
      const next = new Map(prev);
      next.set(key, Math.max(0, min));
      return next;
    });
  }

  // ── Save trip ─────────────────────────────────────────────────────────────
  async function saveTrip() {
    if (!user || !query || !osrm.distance_km) return;
    setSavingTrip(true);
    try {
      const token = localStorage.getItem('tankear_token');
      const payload = {
        from_ciudad:  query.from,
        to_ciudad:    query.to,
        distancia_km: osrm.distance_km,
        duracion_min: osrm.duration_min,
        consumo_kml:  query.consumo_kml,
        tanque_l:     query.tanque_l,
        producto:     query.producto,
        litros_inicio: query.litros_inicio ?? 0,
        datos_json:   JSON.stringify({
          fuelStops:   fuel.stops.map((s, i) => ({
            km: s.waypoint.km_from_start,
            empresa:   s.station?.empresa,
            localidad: s.station?.localidad,
            precio:    s.station?.precio,
            litros:    s.litros,
            selected:  selectedFuelIdxs.has(i),
          })),
          totalCosto:  fuel.total_costo,
          totalLitros: fuel.total_litros,
        }),
      };
      const res = await fetch('/api/viajes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(payload),
      });
      if (res.ok) { setTripSaved(true); trackViajeCompartido(); setTimeout(() => setTripSaved(false), 4000); }
    } catch { /* no-op */ }
    finally { setSavingTrip(false); }
  }

  // ── Build combined selected waypoints list ────────────────────────────────
  const selectedWaypoints = useMemo<SelectedWaypoint[]>(() => {
    const list: SelectedWaypoint[] = [];
    const POI_ICONS: Record<string, string> = {
      restaurant: '🍴', cafe: '☕', fast_food: '🍔',
      hotel: '🏨', hostel: '🏨', camping: '⛺',
      rest_area: '🅿️', supermarket: '🛒', pharmacy: '💊',
    };

    // Fuel stops
    fuel.stops.forEach((stop, i) => {
      if (!selectedFuelIdxs.has(i) || !stop.station) return;
      const s = stop.station;

      // Usar coords de la estación si están disponibles; si no, usar el waypoint de la ruta
      const stationLat = s.latitud  || stop.waypoint.lat;
      const stationLon = s.longitud || stop.waypoint.lon;

      // Desvío: distancia de la estación real al waypoint de la ruta (0 si sin coords exactas)
      const dKm = (s.latitud && s.longitud)
        ? haversine(stop.waypoint.lat, stop.waypoint.lon, s.latitud, s.longitud)
        : 0;
      const desvio_km  = Math.round(dKm * 2 * 10) / 10; // ida y vuelta
      const desvio_min = Math.round((desvio_km / 40) * 60); // a 40 km/h en zona urbana

      const key = `fuel-${i}`;
      const parada_min = paradaOverrides.get(key) ?? DEFAULT_PARADA_MIN.fuel;

      list.push({
        key,
        lat: stationLat, lon: stationLon,
        km_from_start: stop.waypoint.km_from_start,
        label:    s.empresa,
        sublabel: `${s.localidad}, ${s.provincia} · ${stop.litros.toFixed(0)}L`,
        type:  'fuel',
        icon:  '⛽',
        desvio_km, desvio_min, parada_min,
      });
    });

    // POIs
    pois.pois.forEach(poi => {
      if (!selectedPOIIds.has(poi.id)) return;

      const desvio_km = Math.round(poi.distancia_km * 2 * 10) / 10; // ida y vuelta
      const desvio_min = Math.round((desvio_km / 40) * 60);

      const key = `poi-${poi.id}`;
      const parada_min = paradaOverrides.get(key) ?? (DEFAULT_PARADA_MIN[poi.category] ?? 15);

      list.push({
        key,
        lat: poi.lat, lon: poi.lon,
        km_from_start: poi.km_from_start,
        label:    poi.name,
        sublabel: poi.category,
        type:  'poi',
        icon:  POI_ICONS[poi.category] ?? '📍',
        desvio_km, desvio_min, parada_min,
        category: poi.category,
      });
    });

    return list.sort((a, b) => a.km_from_start - b.km_from_start);
  }, [selectedFuelIdxs, selectedPOIIds, fuel.stops, pois.pois, paradaOverrides]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isLoading = osrm.loading || fuel.loading;
  const hasResult = osrm.distance_km > 0;

  // Analytics: track when trip calculation completes
  const prevHasResult = useRef(false);
  useEffect(() => {
    if (hasResult && !prevHasResult.current && !fuel.loading) {
      prevHasResult.current = true;
      trackViajeCalculado({
        distancia_km:  Math.round(osrm.distance_km),
        paradas_nafta: fuel.stops.length,
        costo_estimado: fuel.total_costo ?? undefined,
      });
    }
    if (!hasResult) prevHasResult.current = false;
  }, [hasResult, fuel.loading, osrm.distance_km, fuel.stops.length, fuel.total_costo]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-amber-500/30">
      <Header user={user}
        onCreateAccount={() => setOnboard(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={logout}
      />
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboard(false)} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)}
        onCreateAccount={() => { setLoginOpen(false); setOnboard(true); }}
      />
      {garageOpen && <GarageSection onClose={() => setGarageOpen(false)} initialTab="bitacora" />}
      <QuickNav />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">

        {/* Heading */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
            <RouteIcon className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100">Armá tu Viaje</h1>
              <span className="px-1.5 py-px text-[9px] font-bold uppercase tracking-wide bg-amber-500 text-slate-950 rounded-full">NEW</span>
            </div>
            <p className="text-xs text-slate-500">
              Elegí tus paradas · Armá tu ruta · Abrí en Google Maps
            </p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Left column ── */}
          <div className="flex-1 min-w-0 space-y-5">

            <TripForm onSubmit={trackedSetQuery} loading={isLoading} />

            {osrm.error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
                {osrm.error}
              </div>
            )}

            {osrm.isFallback && hasResult && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                <AlertCircleIcon className="w-4 h-4 flex-shrink-0 text-amber-500" />
                <span>Ruta aproximada — el servicio de mapas no está disponible ahora. Las distancias y el mapa son estimados.</span>
              </div>
            )}

            {hasResult && (
              <>
                {/* Route summary */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl px-5 py-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-1.5 text-sm">
                      <MapPinIcon className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-slate-100 capitalize">{query?.from}</span>
                      <span className="text-slate-600 mx-1">→</span>
                      <MapPinIcon className="w-4 h-4 text-red-400" />
                      <span className="font-semibold text-slate-100 capitalize">{query?.to}</span>
                    </div>
                    <div className="flex items-center gap-4 ml-auto">
                      <div className="flex items-center gap-1.5 text-sm">
                        <RulerIcon className="w-3.5 h-3.5 text-amber-500" />
                        <span className="font-semibold text-slate-100">{osrm.distance_km.toLocaleString('es-AR')} km</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm">
                        <ClockIcon className="w-3.5 h-3.5 text-amber-500" />
                        <span className="font-semibold text-slate-100">{formatDuration(osrm.duration_min)}</span>
                        <span className="text-slate-500">sin paradas</span>
                      </div>
                      {/* Save trip button — only for logged-in users */}
                      {user && (
                        <button
                          onClick={saveTrip}
                          disabled={savingTrip}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            tripSaved
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/30'
                          }`}
                        >
                          {tripSaved
                            ? <><CheckIcon className="w-3.5 h-3.5" /> Guardado</>
                            : <><BookmarkIcon className="w-3.5 h-3.5" /> Guardar</>}
                        </button>
                      )}
                      {/* Guardar en bitácora — only for logged-in users */}
                      {user && (
                        <button
                          onClick={() => {
                            sessionStorage.setItem('tankear_prefill_bitacora', JSON.stringify({
                              origen:          query?.from ?? '',
                              destino:         query?.to   ?? '',
                              km_recorridos:   osrm.distance_km > 0 ? osrm.distance_km : null,
                              litros_cargados: fuel.stops.reduce((s, st) => s + (st.litros ?? 0), 0) || null,
                              costo_total:     fuel.stops.reduce((s, st) => s + (st.costo_ars ?? 0), 0) || null,
                              tiempo_min:      osrm.duration_min > 0 ? osrm.duration_min : null,
                            }));
                            setGarageOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-500/30 transition-colors"
                        >
                          <BookOpenIcon className="w-3.5 h-3.5" /> Bitácora
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Weather */}
                <WeatherAlerts weather={weather.weather} loading={weather.loading} />

                {/* Hoja de ruta — refleja selección actual */}
                <HojaDeRuta
                  from={query!.from}
                  to={query!.to}
                  distance_km={osrm.distance_km}
                  duration_min={osrm.duration_min}
                  selected={selectedWaypoints}
                  onParadaChange={setParadaMin}
                />

                {/* Fuel stops — with checkboxes */}
                <FuelStopsPanel
                  stops={fuel.stops}
                  total_litros={fuel.total_litros}
                  total_costo={fuel.total_costo}
                  distance_km={osrm.distance_km}
                  loading={fuel.loading}
                  selectedIdxs={selectedFuelIdxs}
                  onToggle={toggleFuel}
                  weatherByKm={weatherByKm}
                  paradaOverrides={paradaOverrides}
                  onParadaChange={setParadaMin}
                />

                {/* Servicios — with checkboxes on POIs */}
                <ServiciosPanel
                  hotels={hotels.hotels}
                  pois={pois.pois}
                  hotelsLoading={hotels.loading}
                  poisLoading={pois.loading}
                  waypoints={osrm.waypoints}
                  selectedPOIIds={selectedPOIIds}
                  onTogglePOI={togglePOI}
                />

                {/* Insurance CTA */}
                <SegurosCTA from={query!.from} to={query!.to} />
              </>
            )}
          </div>

          {/* ── Right column: map ── */}
          <div className="lg:w-[420px] xl:w-[500px] flex-shrink-0">
            <div className="sticky top-[6.5rem]">
              <RouteMap
                geometry={osrm.geometry?.coordinates.length ? osrm.geometry : null}
                origin={osrm.origin?.lat ? osrm.origin : null}
                destination={osrm.destination?.lat ? osrm.destination : null}
                fuelStops={fuel.stops}
                hotels={hotels.hotels}
                weatherAlerts={weather.alerts}
                pois={pois.pois}
                selectedFuelIdxs={selectedFuelIdxs}
                selectedPOIIds={selectedPOIIds}
                className="h-[520px] lg:h-[600px]"
              />
              {hasResult && (
                <div className="mt-2">
                  <a
                    href={buildGoogleMapsURL(query!.from, query!.to, selectedWaypoints)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full text-xs text-slate-500 hover:text-[#4285F4] py-2 transition-colors"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    Ver ruta completa en Google Maps →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* Floating action bar */}
      {hasResult && (
        <FloatingMapBar
          from={query!.from}
          to={query!.to}
          selected={selectedWaypoints}
          durationMin={osrm.duration_min}
        />
      )}
    </div>
  );
}
