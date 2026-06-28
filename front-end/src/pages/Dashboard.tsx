import { useScrollTracking } from '../hooks/useScrollTracking';
import { trackProvinciaLinkClick, trackTelegramClick } from '../utils/analytics';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Station, UbicacionResuelta } from '../types';
import { Header } from '../components/Header';
import { FilterBar } from '../components/FilterBar';
import { PriceStats } from '../components/PriceStats';
import { StationList } from '../components/StationList';
import { FuelMap, GpsState } from '../components/FuelMap';
import { PriceCalculator } from '../components/PriceCalculator';
import { SeguroCalculator } from '../components/SeguroCalculator';
import { LeadCaptureForm } from '../components/LeadCaptureForm';
import { NewsColumns } from '../components/NewsColumns';
import PromosSection from '../components/PromosSection';
import { AdSidebar } from '../components/AdSidebar';
import { AlertModal } from '../components/AlertModal';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { GarageSection } from '../components/garage/GarageSection';
import { FeedbackWidget } from '../components/FeedbackWidget';
import { useBitacora, BitacoraEntry } from '../hooks/useBitacora';
import { QuickNav } from '../components/QuickNav';
import { useFuelData } from '../hooks/useFuelData';
import { useUser } from '../hooks/useUser';
import { filterFresh, staleDaysAgo } from '../utils/stale';
import { formatCurrency, getCompanyColorClass } from '../utils/api';
import { getProductInfo } from '../types';
import { useSEO } from '../hooks/useSEO';
import { Footer } from '../components/Footer';
import { useDolar, getSuperUSD } from '../hooks/useDolar';
import {
  AlertTriangleIcon, InfoIcon,
  MapPinIcon, LocateIcon, GlobeIcon, CompassIcon,
  BarChart2Icon, CalculatorIcon, ShieldIcon, RouteIcon,
  BookOpenIcon, ClockIcon, BanknoteIcon, XIcon,
  NavigationIcon, CalendarIcon,
} from 'lucide-react';

// ─── Station Bottom Sheet (mobile) ───────────────────────────────────────────
function StationBottomSheet({ station, onClose }: { station: import('../types').Station | null; onClose: () => void }) {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (station) {
      // Trigger animation after mount
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [station]);

  if (!station) return null;

  const mapsUrl = station.latitud && station.longitud
    ? `https://www.google.com/maps/dir/?api=1&destination=${station.latitud},${station.longitud}`
    : `https://www.google.com/maps/search/${encodeURIComponent(`${station.direccion}, ${station.localidad}, ${station.provincia}, Argentina`)}`;

  const precio = station.precio != null && station.precio >= 1000 ? formatCurrency(station.precio) : null;
  const dias = staleDaysAgo(station.fecha_vigencia);
  const stale = dias > 30 || (station.precio != null && station.precio < 1000);

  return (
    <div
      className="fixed inset-0 z-[600] pointer-events-none lg:hidden"
      aria-hidden={!station}
    >
      {/* Backdrop — only on mobile */}
      <div
        className="absolute inset-0 pointer-events-auto"
        style={{ background: 'transparent' }}
        onClick={onClose}
      />
      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-auto"
        style={{
          background: '#1e293b',
          borderRadius: '20px 20px 0 0',
          minHeight: '280px',
          maxHeight: '65vh',
          overflowY: 'auto',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
          zIndex: 600,
        }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#475569' }} />
        </div>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-slate-400 hover:text-slate-100 transition-colors p-1"
          aria-label="Cerrar"
        >
          <XIcon className="w-5 h-5" />
        </button>
        {/* Content */}
        <div className="px-5 pt-2 pb-6">
          {/* Company name + color */}
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-4 h-4 rounded-full flex-shrink-0 ${getCompanyColorClass(station.empresa || '')}`} />
            <h3 className="text-lg font-bold text-slate-100 truncate">
              {station.bandera || station.empresa}
            </h3>
            {station.tipo_bandera && station.tipo_bandera !== 'PROPIA' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                {station.tipo_bandera}
              </span>
            )}
          </div>
          {/* Address */}
          <div className="text-sm text-slate-400 mb-4">
            <p className="font-medium text-slate-300">{station.direccion}</p>
            <p className="text-slate-500">{station.localidad}, {station.provincia}</p>
          </div>
          {/* Price */}
          {precio ? (
            <div className="mb-4 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${stale ? 'text-slate-500 line-through' : 'text-emerald-400'}`}>
                {precio}
              </span>
              {stale ? (
                <span className="text-xs font-semibold text-slate-500 bg-slate-700 px-2 py-0.5 rounded">
                  Sin confirmar
                </span>
              ) : (
                <span className="text-sm text-slate-400">/ {getProductInfo(station.producto).unit}</span>
              )}
            </div>
          ) : (
            <div className="mb-4">
              <span className="text-sm text-slate-500 bg-slate-700/80 px-3 py-1 rounded-lg">Sin precio cargado</span>
            </div>
          )}
          {/* Product badge */}
          <div className="mb-4">
            {(() => {
              const info = getProductInfo(station.producto);
              return (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium border ${info.bgClass} ${info.textClass}`}
                  style={{ borderColor: `${info.color}40` }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: info.color }} />
                  {info.shortLabel}
                </span>
              );
            })()}
          </div>
          {/* Date */}
          {station.fecha_vigencia && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-4">
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>
                Actualizado: {new Date(station.fecha_vigencia).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                {dias > 0 && <span className="ml-1">({dias}d)</span>}
              </span>
            </div>
          )}
          {/* Action buttons */}
          <div className="flex gap-3">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/25 transition-colors"
            >
              <NavigationIcon className="w-4 h-4" />
              Cómo llegar
            </a>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-700/60 border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Location banner ─────────────────────────────────────────────────────────
function LocationBanner({ ubicacion }: { ubicacion: UbicacionResuelta | null }) {
  if (!ubicacion) return null;
  const configs: Record<string, { icon: React.ElementType; label: string; color: string; bg: string; border: string }> = {
    gps:       { icon: LocateIcon,  label: 'Ubicación exacta por GPS',   color: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' },
    ip_cache:  { icon: GlobeIcon,   label: 'Ubicación detectada por IP', color: 'text-amber-400',   bg: 'bg-amber-500/5',   border: 'border-amber-500/20'   },
    ip_geo:    { icon: GlobeIcon,   label: 'Ubicación detectada por IP', color: 'text-amber-400',   bg: 'bg-amber-500/5',   border: 'border-amber-500/20'   },
    localidad: { icon: MapPinIcon,  label: 'Por localidad',              color: 'text-blue-400',    bg: 'bg-blue-500/5',    border: 'border-blue-500/20'    },
    provincia: { icon: CompassIcon, label: 'Por provincia',              color: 'text-blue-400',    bg: 'bg-blue-500/5',    border: 'border-blue-500/20'    },
    default:   { icon: MapPinIcon,  label: 'Ubicación por defecto',      color: 'text-slate-400',   bg: 'bg-slate-500/5',   border: 'border-slate-500/20'   },
  };
  const cfg  = configs[ubicacion.method] || configs.default;
  const Icon = cfg.icon;
  const detected     = ubicacion.localidad_detectada;
  const dataset      = ubicacion.localidad_dataset || ubicacion.localidad;
  const localidadTxt = (detected && dataset && detected.toUpperCase() !== dataset.toUpperCase())
    ? `${detected} (zona ${dataset})` : (dataset || detected || '');
  const locationText = [localidadTxt, ubicacion.provincia].filter(Boolean).join(', ');
  return (
    <div className={`mb-4 flex items-center flex-wrap gap-x-2.5 gap-y-1 px-4 py-2.5 rounded-lg border text-sm ${cfg.bg} ${cfg.border}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
      {locationText && <><span className="text-slate-600">→</span><span className="text-slate-200 font-medium">{locationText}</span></>}
    </div>
  );
}

// ─── Dólar card con calculadora de cambio ────────────────────────────────────
function DolarCard({ blueSell, blueBuy, oficialSell, oficialBuy }: {
  blueSell: number; blueBuy: number | null;
  oficialSell: number | null; oficialBuy: number | null;
}) {
  const [monto,     setMonto]     = useState('');
  const [modo,      setModo]      = useState<'ars→usd' | 'usd→ars'>('ars→usd');
  const [tipoCambio, setTipoCambio] = useState<'blue' | 'oficial'>('blue');
  const inputRef = useRef<HTMLInputElement>(null);
  const trackFiredRef = useRef(false);

  const rate = tipoCambio === 'blue'
    ? (modo === 'ars→usd' ? blueSell : (blueBuy ?? blueSell))
    : (modo === 'ars→usd' ? (oficialSell ?? blueSell) : (oficialBuy ?? oficialSell ?? blueSell));

  const valor = parseFloat(monto.replace(',', '.'));
  const resultado = !isNaN(valor) && valor > 0 && rate
    ? (modo === 'ars→usd' ? valor / rate : valor * rate)
    : null;

  const brechaNum = oficialSell ? ((blueSell - oficialSell) / oficialSell * 100) : null;

  // Track first use of the calculator per session
  const handleMontoChange = (val: string) => {
    setMonto(val);
    if (val && !trackFiredRef.current) {
      trackFiredRef.current = true;
      trackDolarCalculadora(tipoCambio, modo);
    }
  };

  return (
    <div className="bg-slate-900/60 border border-amber-500/20 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold text-amber-500/70 uppercase tracking-wider">Tipo de cambio</span>
        <Link to="/dolar" className="text-[10px] text-slate-600 hover:text-amber-500/50 transition-colors">Ver más →</Link>
      </div>

      {/* Tabla compra/venta */}
      <div className="grid grid-cols-4 gap-1 mb-1.5">
        <div />
        <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider text-right">Compra</p>
        <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider text-right">Venta</p>
        <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider text-right">Brecha</p>
      </div>
      <div className="grid grid-cols-4 gap-1 items-center py-1.5 border-t border-slate-800/60">
        <span className="text-[10px] font-semibold text-amber-400">Blue</span>
        <p className="text-sm font-bold text-amber-400 text-right">${(blueBuy ?? blueSell).toLocaleString('es-AR')}</p>
        <p className="text-sm font-bold text-amber-400 text-right">${blueSell.toLocaleString('es-AR')}</p>
        <p className="text-[10px] text-slate-500 text-right">—</p>
      </div>
      {oficialSell && (
        <div className="grid grid-cols-4 gap-1 items-center py-1.5 border-t border-slate-800/60">
          <span className="text-[10px] font-semibold text-emerald-400">Oficial</span>
          <p className="text-sm font-bold text-emerald-400 text-right">${(oficialBuy ?? oficialSell).toLocaleString('es-AR')}</p>
          <p className="text-sm font-bold text-emerald-400 text-right">${oficialSell.toLocaleString('es-AR')}</p>
          <p className={`text-sm font-bold text-right ${brechaNum !== null && brechaNum > 0 ? 'text-red-400' : 'text-slate-400'}`}>
            {brechaNum !== null ? `${brechaNum.toFixed(0)}%` : '—'}
          </p>
        </div>
      )}

      {/* Calculadora */}
      <div className="mt-3 pt-3 border-t border-slate-800/60">
        {/* Controles */}
        <div className="flex items-center gap-2 mb-2">
          {/* Toggle ARS↔USD */}
          <button
            onClick={() => setModo(m => m === 'ars→usd' ? 'usd→ars' : 'ars→usd')}
            className="flex items-center gap-1 text-[10px] font-semibold bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
          >
            <span>{modo === 'ars→usd' ? 'ARS → USD' : 'USD → ARS'}</span>
            <span className="text-slate-600">⇄</span>
          </button>
          {/* Blue / Oficial */}
          <div className="flex rounded-md overflow-hidden border border-slate-700 text-[10px] font-semibold">
            <button
              onClick={() => setTipoCambio('blue')}
              className={`px-2 py-1 transition-colors ${tipoCambio === 'blue' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
            >Blue</button>
            {oficialSell && (
              <button
                onClick={() => setTipoCambio('oficial')}
                className={`px-2 py-1 border-l border-slate-700 transition-colors ${tipoCambio === 'oficial' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              >Oficial</button>
            )}
          </div>
        </div>

        {/* Input + resultado */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none font-mono">
              {modo === 'ars→usd' ? '$' : 'U$D'}
            </span>
            <input
              ref={inputRef}
              type="number"
              min="0"
              placeholder="0"
              value={monto}
              onChange={e => handleMontoChange(e.target.value)}
              className="w-full h-8 bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
            />
          </div>
          <span className="text-slate-600 text-xs">=</span>
          <div className="flex-1 h-8 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 flex items-center">
            {resultado !== null ? (
              <span className={`text-sm font-bold font-mono ${tipoCambio === 'blue' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {modo === 'ars→usd'
                  ? `U$D ${resultado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `$${resultado.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                }
              </span>
            ) : (
              <span className="text-xs text-slate-600">resultado</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export function Dashboard() {
  useSEO({
    title:       'Nafta más barata cerca tuyo — hoy',
    description: 'Compará precios de nafta y gasoil en tiempo real. YPF, Shell, Axion, Puma y más. Encontrá la estación más barata cerca tuyo en Argentina.',
    canonical:   'https://tankear.com.ar/',
  });

  // Schema.org JSON-LD para Google
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id   = 'ld-tankear';
    script.textContent = JSON.stringify({
      '@context':           'https://schema.org',
      '@type':              'WebApplication',
      name:                 'Tankear',
      description:          'Comparador de precios de nafta y gasoil en Argentina. YPF, Shell, Axion, Puma y más.',
      url:                  'https://tankear.com.ar',
      applicationCategory:  'UtilitiesApplication',
      operatingSystem:      'Web',
      offers:               { '@type': 'Offer', price: '0', priceCurrency: 'ARS' },
      areaServed:           { '@type': 'Country', name: 'Argentina' },
      inLanguage:           'es-AR',
    });
    document.head.appendChild(script);
    return () => { document.getElementById('ld-tankear')?.remove(); };
  }, []);

  const {
    data, loading, error, isUsingFallback,
    filters, search, refresh, ubicacion, needsLocation,
    userLocation,
  } = useFuelData({
    provincia: '', localidad: '', barrio: '', empresa: '', producto: '',
    fecha_desde: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    solo_con_precio: false, banderas: [], orden: 'precio',
  });

  useScrollTracking('dashboard');

  // Compute gpsState for FuelMap overlay from userLocation
  // 'loading' = first 0-1s (map init), 'searching' = GPS in progress, 'found'/'error'/'done' = resolved
  const gpsState: GpsState = (() => {
    if (userLocation.loading) return 'loading';
    if (userLocation.error)   return 'error';
    if (userLocation.lat !== null && userLocation.lon !== null) return 'found';
    return 'done';
  })();

  const { user, logout } = useUser();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loginOpen,      setLoginOpen]      = useState(false);
  const [garageOpen,     setGarageOpen]     = useState(false);

  // Badge "¡Nuevo!" para Arma tu Viaje
  const [viajeBadgeVisible, setViajeBadgeVisible] = useState<boolean>(() => {
    try {
      const count = parseInt(localStorage.getItem('viaje_badge_count') || '0', 10);
      return count < 3;
    } catch { return true; }
  });
  const handleViajeClick = () => {
    try {
      const count = parseInt(localStorage.getItem('viaje_badge_count') || '0', 10);
      const next = count + 1;
      localStorage.setItem('viaje_badge_count', String(next));
      if (next >= 3) setViajeBadgeVisible(false);
    } catch { /* ignore */ }
  };
  const bitacora = useBitacora();
  useEffect(() => { if (user) bitacora.loadEntries(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const freshData   = useMemo(() => filterFresh(data), [data]);
  const staleCount  = data.length - freshData.length;
  // Para la calculadora: usar frescos si hay, si no usar todos los datos disponibles
  const calcData    = freshData.length > 0 ? freshData : data.filter(d => d.precio >= 1000 && !d.producto?.toLowerCase().includes('gnc'));
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => { setMapMounted(true); }, []);

  const allStale = useMemo(
    () => data.length > 0 && data.every(s => s.precio_vigente === false), [data],
  );
  const focusPoint = useMemo(() => (
    ubicacion?.lat && ubicacion?.lon ? {
      lat: ubicacion.lat, lon: ubicacion.lon,
      radiusMeters: filters.barrio ? 2000 : 5000,
      label: filters.barrio || ubicacion.localidad_detectada || ubicacion.localidad || ubicacion.provincia || 'Tu zona',
    } : null
  ), [ubicacion, filters.barrio]);

  const { blueSell: dolarBlue, blueBuy: dolarBlueBuy, oficialSell: dolarOficial, oficialBuy: dolarOficialBuy } = useDolar();

  // Guardar localidad y precio Súper en localStorage para widgets de clima y dólar
  useEffect(() => {
    const loc = ubicacion?.localidad_detectada || ubicacion?.localidad;
    if (loc) localStorage.setItem('tankear_last_localidad', loc);
  }, [ubicacion]);
  useEffect(() => {
    const superStation = data.find(s =>
      s.producto?.includes('entre 92 y 95') || s.producto?.includes('súper')
    );
    if (superStation?.precio) localStorage.setItem('tankear_super_promedio', String(superStation.precio));
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-amber-500/30">
      <Header
        user={user}
        onCreateAccount={() => setOnboardingOpen(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={logout}
      />
      <AlertModal zona={ubicacion ? (ubicacion.localidad_detectada || ubicacion.localidad || ubicacion.provincia || undefined) : undefined} />
      <OnboardingModal
        open={onboardingOpen} onClose={() => setOnboardingOpen(false)}
        initialZona={{ provincia: ubicacion?.provincia || undefined, localidad: ubicacion?.localidad_detectada || ubicacion?.localidad || undefined }}
      />
      <LoginModal
        open={loginOpen} onClose={() => setLoginOpen(false)}
        onCreateAccount={() => { setLoginOpen(false); setOnboardingOpen(true); }}
      />
      {garageOpen && user && <GarageSection onClose={() => setGarageOpen(false)} />}
      <FeedbackWidget />

      <QuickNav />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-8">

          {/* ════════════════════════════════════════════════════════
              CONTENIDO PRINCIPAL (izquierda)
          ════════════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0">

            {/* ── Location prompt ── */}
            {needsLocation && !filters.provincia && !loading && (
              <div className="mb-5 bg-slate-900 border border-amber-500/40 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <MapPinIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-amber-400 font-semibold text-sm">¿Dónde estás?</h3>
                    <p className="text-slate-400 text-xs mt-0.5">Seleccioná tu provincia para ver precios cercanos.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['BUENOS AIRES','CIUDAD AUTÓNOMA DE BUENOS AIRES','CÓRDOBA','SANTA FE','MENDOZA','TUCUMÁN','NEUQUÉN','SALTA'].map(prov => (
                    <button key={prov} onClick={() => search({ ...filters, provincia: prov, localidad: '' })}
                      className="text-xs bg-slate-800 hover:bg-amber-500/20 border border-slate-700 hover:border-amber-500/40 text-slate-300 hover:text-amber-400 px-3 py-1.5 rounded-lg transition-all">
                      {prov === 'CIUDAD AUTÓNOMA DE BUENOS AIRES' ? 'CABA' : prov}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Banners ── */}
            {!loading && !needsLocation && <LocationBanner ubicacion={ubicacion} />}
            {!loading && ubicacion?.advertencia_fecha && (
              <div className="mb-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm">
                <AlertTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-amber-400">{ubicacion.advertencia_fecha}</span>
              </div>
            )}
            {!loading && ubicacion?.radio_ampliado && (
              <div className="mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm">
                <AlertTriangleIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="text-blue-400">Radio ampliado: mostrando estaciones más lejanas</span>
              </div>
            )}
            {error && isUsingFallback && (
              <div className="mb-5 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-red-400 font-medium">No se pudo conectar a la API</h3>
                  <p className="text-red-400/70 text-sm mt-1">Mostrando datos de ejemplo locales.</p>
                  <button onClick={refresh} className="mt-2 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 py-1 rounded-md transition-colors font-medium">
                    Reintentar
                  </button>
                </div>
              </div>
            )}
            {allStale && data.length > 0 && !loading && (
              <div className="mb-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                <AlertTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-amber-400/90 text-sm">Todos los precios están desactualizados.</p>
              </div>
            )}

            {/* ── KPIs ── */}
            <section id="inicio" className="scroll-mt-28">
              {loading && data.length === 0 ? (
                <div className="min-h-[140px] flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
                  <p className="text-slate-400 text-sm animate-pulse">
                    {!ubicacion ? 'Detectando tu ubicación...' : 'Buscando estaciones...'}
                  </p>
                </div>
              ) : needsLocation && data.length === 0 ? null : (
                <PriceStats data={freshData} filters={filters} ubicacion={ubicacion} />
              )}
            </section>

            {/* ── Filter bar horizontal ── */}
            <FilterBar filters={filters} onSearch={search} availableData={data} loading={loading} />

            {/* ── Lista izq + Mapa sticky der ── */}
            {needsLocation && data.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <MapPinIcon className="w-10 h-10 text-slate-700" />
                <p className="text-slate-400 text-sm">Seleccioná tu provincia para ver precios cercanos.</p>
              </div>
            ) : (
              <section id="mapa" className="scroll-mt-28">
                {staleCount > 0 && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg text-xs text-slate-500">
                    <InfoIcon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                    <span><span className="text-slate-400 font-medium">{staleCount} estación{staleCount > 1 ? 'es' : ''}</span> con precio sin confirmar (+30 días).</span>
                  </div>
                )}
                {ubicacion?.ubicacion_aproximada && (
                  <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <p className="text-amber-400 text-xs">{ubicacion.sugerencia || 'Ubicación aproximada por IP. Activá el GPS para mejores resultados.'}</p>
                  </div>
                )}

                <div className="flex flex-col lg:flex-row gap-5">
                  {/* StationList */}
                  <div className="w-full lg:w-[380px] flex-shrink-0">
                    <StationList data={data} selectedStation={selectedStation} onStationClick={setSelectedStation} filters={filters} />
                  </div>
                  {/* FuelMap sticky */}
                  <div className="flex-1 min-w-0">
                    <div className="lg:sticky lg:top-20">
                      {mapMounted ? (
                        <FuelMap
                          data={data}
                          selectedStation={selectedStation}
                          focusPoint={focusPoint}
                          gpsState={gpsState}
                          className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden relative z-0"
                          style={{ height: 'min(72vh, 680px)' }}
                        />
                      ) : (
                        <div className="bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800" style={{ height: 'min(72vh, 680px)' }}>
                          <div className="w-8 h-8 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ── Comparativa teaser ── */}
            <section className="mt-8">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <BarChart2Icon className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">Comparativa por empresa</p>
                  <p className="text-slate-500 text-xs mt-0.5">Precios promedio por bandera e histórico de variación</p>
                </div>
                <Link to="/comparativa"
                  className="flex-shrink-0 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap">
                  Ver comparativa →
                </Link>
              </div>
            </section>

            {/* ── Planificador de Viaje CTA ── */}
            <section className="mt-8">
              <style>{`
                @keyframes viaje-badge-pulse {
                  0%, 100% { opacity: 1; transform: scale(1); }
                  50% { opacity: 0.85; transform: scale(1.08); }
                }
                .viaje-badge-new {
                  background: linear-gradient(135deg, #f97316, #ef4444);
                  color: white;
                  font-size: 10px;
                  font-weight: 700;
                  padding: 2px 6px;
                  border-radius: 999px;
                  position: absolute;
                  top: -6px;
                  right: -6px;
                  animation: viaje-badge-pulse 2s infinite;
                  white-space: nowrap;
                  line-height: 1.2;
                  pointer-events: none;
                  z-index: 10;
                }
              `}</style>
              <Link
                to="/viaje"
                onClick={handleViajeClick}
                className="group flex items-center gap-4 w-full bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/30 rounded-xl px-5 py-4 transition-all"
              >
                <div className="relative w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 group-hover:bg-amber-500/20 group-hover:border-amber-500/40 flex items-center justify-center flex-shrink-0 transition-all">
                  <RouteIcon className="w-5 h-5 text-amber-500" />
                  {viajeBadgeVisible && (
                    <span className="viaje-badge-new">¡Nuevo!</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200 group-hover:text-white">Armá tu Viaje</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Nafta en ruta · Dónde comer · Hoteles · Elegí tus paradas · Google Maps
                  </p>
                </div>
                <span className="text-amber-500 text-xs font-medium flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
                  Ir →
                </span>
              </Link>
            </section>

            {/* ── Calculadora + Seguros en 2 columnas ── */}
            {!needsLocation && calcData.length > 0 && (
              <section id="cotizador" className="scroll-mt-28 mt-8">
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider px-2">Calculadoras</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <CalculatorIcon className="w-4 h-4 text-amber-500" />
                        <h3 className="text-sm font-semibold text-slate-300">Calculadora de Viaje</h3>
                      </div>
                      <PriceCalculator data={calcData} hasFresh={freshData.length > 0} />
                    </div>

                    {/* Dólar mini card */}
                    {dolarBlue && (
                      <DolarCard
                        blueSell={dolarBlue}
                        blueBuy={dolarBlueBuy}
                        oficialSell={dolarOficial}
                        oficialBuy={dolarOficialBuy}
                      />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldIcon className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-sm font-semibold text-slate-300">Seguros de Auto</h3>
                    </div>
                    <SeguroCalculator provincia={ubicacion?.provincia || undefined} />
                  </div>
                </div>
              </section>
            )}

            {/* ── Historial de viajes (solo logueados con entradas) ── */}
            {user && bitacora.entries.length > 0 && (
              <section className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider px-2">Mis últimos viajes</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bitacora.entries.slice(0, 6).map((e: BitacoraEntry) => {
                    const fecha = (() => {
                      try { return new Date(e.fecha_inicio + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }); }
                      catch { return e.fecha_inicio; }
                    })();
                    const costo = e.costo_total != null
                      ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(e.costo_total)
                      : null;
                    return (
                      <div key={e.id}
                        onClick={() => setGarageOpen(true)}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-amber-500/30 hover:bg-slate-900/80 cursor-pointer transition-all group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <MapPinIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            <p className="text-sm font-semibold text-slate-100 truncate group-hover:text-amber-300 transition-colors">
                              {e.origen} → {e.destino}
                            </p>
                          </div>
                          <span className="text-[11px] text-slate-500 flex-shrink-0">{fecha}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                          {e.km_recorridos != null && (
                            <span className="flex items-center gap-1">
                              <RouteIcon className="w-3 h-3" />{e.km_recorridos.toLocaleString('es-AR')} km
                            </span>
                          )}
                          {costo && (
                            <span className="flex items-center gap-1 text-emerald-400/80">
                              <BanknoteIcon className="w-3 h-3" />{costo}
                            </span>
                          )}
                          {e.tiempo_min != null && (
                            <span className="flex items-center gap-1">
                              <ClockIcon className="w-3 h-3" />
                              {Math.floor(e.tiempo_min / 60) > 0 ? `${Math.floor(e.tiempo_min / 60)}h ` : ''}{e.tiempo_min % 60 > 0 ? `${e.tiempo_min % 60}min` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {bitacora.entries.length > 6 && (
                  <p className="text-xs text-slate-600 text-center mt-2">
                    +{bitacora.entries.length - 6} viajes más en{' '}
                    <button onClick={() => setGarageOpen(true)} className="text-amber-500 hover:text-amber-400 underline">Mi Garage → Bitácora</button>
                  </p>
                )}
              </section>
            )}

            {/* ── Lead form ── */}
            <LeadCaptureForm
              zona={ubicacion ? [ubicacion.localidad_detectada || ubicacion.localidad, ubicacion.provincia].filter(Boolean).join(', ') : undefined}
            />

            {/* ── Promos de combustible ── */}
            <PromosSection />

            {/* ── Precios por provincia (SEO internal links) ── */}
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Precios de nafta por provincia
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {[
                  { nombre: 'Buenos Aires',                   slug: 'buenos-aires' },
                  { nombre: 'CABA',                           slug: 'ciudad-autonoma-de-buenos-aires' },
                  { nombre: 'Córdoba',                        slug: 'cordoba' },
                  { nombre: 'Santa Fe',                       slug: 'santa-fe' },
                  { nombre: 'Mendoza',                        slug: 'mendoza' },
                  { nombre: 'Tucumán',                        slug: 'tucuman' },
                  { nombre: 'Salta',                          slug: 'salta' },
                  { nombre: 'Entre Ríos',                     slug: 'entre-rios' },
                  { nombre: 'Misiones',                       slug: 'misiones' },
                  { nombre: 'Chaco',                          slug: 'chaco' },
                  { nombre: 'Corrientes',                     slug: 'corrientes' },
                  { nombre: 'Santiago del Estero',            slug: 'santiago-del-estero' },
                  { nombre: 'San Juan',                       slug: 'san-juan' },
                  { nombre: 'Jujuy',                          slug: 'jujuy' },
                  { nombre: 'Río Negro',                      slug: 'rio-negro' },
                  { nombre: 'Neuquén',                        slug: 'neuquen' },
                  { nombre: 'Formosa',                        slug: 'formosa' },
                  { nombre: 'Chubut',                         slug: 'chubut' },
                  { nombre: 'San Luis',                       slug: 'san-luis' },
                  { nombre: 'Catamarca',                      slug: 'catamarca' },
                  { nombre: 'La Rioja',                       slug: 'la-rioja' },
                  { nombre: 'La Pampa',                       slug: 'la-pampa' },
                  { nombre: 'Santa Cruz',                     slug: 'santa-cruz' },
                  { nombre: 'Tierra del Fuego',               slug: 'tierra-del-fuego' },
                ].map(({ nombre, slug }) => (
                  <Link
                    key={slug}
                    to={`/precios/${slug}`}
                    onClick={() => trackProvinciaLinkClick(nombre)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-amber-400 hover:border-amber-500/30 transition-colors truncate"
                  >
                    ⛽ {nombre}
                  </Link>
                ))}
              </div>
            </section>

            {/* ── Noticias 3 columnas ── */}
            <NewsColumns />

          </div>{/* end main column */}

          {/* ════════════════════════════════════════════════════════
              SIDEBAR DERECHO (publicidad + noticias)
              Solo visible en pantallas grandes
          ════════════════════════════════════════════════════════ */}
          <div className="hidden xl:block w-72 flex-shrink-0">
            <div className="sticky top-20">
              <AdSidebar />
            </div>
          </div>

        </div>
        <Footer />
      </main>
      {/* Mobile bottom sheet — shown when a station is selected */}
      <StationBottomSheet station={selectedStation} onClose={() => setSelectedStation(null)} />
    </div>
  );
}
