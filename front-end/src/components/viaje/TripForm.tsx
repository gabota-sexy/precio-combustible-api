import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MapPinIcon, NavigationIcon, CarIcon, DropletsIcon, ArrowRightIcon, SearchIcon } from 'lucide-react';
import autosData from '../../data/autos.json';
import localidades from '../../data/ar_localidades.json';

// ── Types ────────────────────────────────────────────────────────────────────

type AutoEntry = {
  marca: string; modelo: string; version: string;
  consumo_ruta_kml: number; consumo_mixto_kml?: number; consumo_ciudad_kml?: number;
  litros_tanque: number; combustible: string; categoria?: string;
};

const autos = autosData as AutoEntry[];

type Localidad = { n: string; p?: string; lat: number; lon: number };
const locs = localidades as Localidad[];

export interface TripQuery {
  from:          string;
  to:            string;
  consumo_kml:   number;
  tanque_l:      number;
  producto:      string;
  litros_inicio?: number;  // litros con que arranca el viaje
}

interface TripFormProps {
  onSubmit: (q: TripQuery) => void;
  loading:  boolean;
}

const COMBUSTIBLE_LABEL: Record<string, string> = {
  nafta_super:   'Nafta Súper',
  nafta_premium: 'Nafta Premium',
  gasoil:        'Gasoil',
};

// ── Normalize for search ────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── City Autocomplete ───────────────────────────────────────────────────────

function CityAutocomplete({
  value, onChange, placeholder, iconColor,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  iconColor: string;
}) {
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (value.length < 2) return [];
    const key = norm(value);
    const exact: Localidad[] = [];
    const starts: Localidad[] = [];
    const includes: Localidad[] = [];

    for (const l of locs) {
      const n = norm(l.n);
      if (n === key)           { exact.push(l); }
      else if (n.startsWith(key)) { starts.push(l); }
      else if (n.includes(key))   { includes.push(l); }
      if (exact.length + starts.length + includes.length >= 10) break;
    }
    return [...exact, ...starts, ...includes].slice(0, 8);
  }, [value]);

  const showDropdown = focused && filtered.length > 0;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      onChange(filtered[highlighted].n);
      setFocused(false);
    }
    if (e.key === 'Escape') setFocused(false);
  }

  const inputCls = "w-full bg-slate-950 border border-slate-700 focus:border-amber-500/60 rounded-lg pl-8 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors";

  return (
    <div ref={wrapRef} className="relative">
      <MapPinIcon className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${iconColor} pointer-events-none`} />
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setHighlighted(-1); }}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputCls}
        autoComplete="off"
      />
      {/* Match indicator */}
      {value.length >= 2 && !focused && (
        <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
          filtered.length > 0 || value.length === 0 ? 'bg-emerald-500' : 'bg-amber-500'
        }`} />
      )}

      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl shadow-black/50 max-h-52 overflow-auto">
          {filtered.map((l, i) => (
            <button
              key={`${l.n}|${l.p ?? ''}`}
              type="button"
              onMouseDown={() => { onChange(l.n); setFocused(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === highlighted
                  ? 'bg-amber-500/15 text-slate-100'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="font-medium">{l.n}</span>
              {l.p && <span className="text-slate-500 ml-1.5 text-xs">· {l.p}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function TripForm({ onSubmit, loading }: TripFormProps) {
  const [from,            setFrom]           = useState('');
  const [to,              setTo]             = useState('');
  const [selectedMarca,   setSelectedMarca]  = useState('');
  const [selectedModelo,  setSelectedModelo] = useState('');
  const [selectedVersion, setSelectedVersion]= useState('');
  const [consumoInput,    setConsumoInput]   = useState('');
  const [tanqueInput,     setTanqueInput]    = useState('');
  const [productoManual,  setProductoManual] = useState('');
  const [litrosInicio,    setLitrosInicio]   = useState('');

  // ── Cascading filters ──────────────────────────────────────────────────
  const marcas = useMemo(() => [...new Set(autos.map(a => a.marca))].sort(), []);

  const modelos = useMemo(
    () => selectedMarca
      ? [...new Set(autos.filter(a => a.marca === selectedMarca).map(a => a.modelo))].sort()
      : [],
    [selectedMarca],
  );

  const versiones = useMemo(
    () => selectedMarca && selectedModelo
      ? autos.filter(a => a.marca === selectedMarca && a.modelo === selectedModelo)
      : [],
    [selectedMarca, selectedModelo],
  );

  // Auto-select version if there's only one
  useEffect(() => {
    if (versiones.length === 1) {
      setSelectedVersion(versiones[0].version);
    } else if (versiones.length === 0) {
      setSelectedVersion('');
    }
  }, [versiones]);

  // Find the exact auto entry
  const autoEntry = useMemo<AutoEntry | null>(() => {
    if (!selectedMarca || !selectedModelo) return null;
    if (selectedVersion) {
      return autos.find(a =>
        a.marca === selectedMarca && a.modelo === selectedModelo && a.version === selectedVersion
      ) ?? null;
    }
    // Fallback: first match for marca+modelo
    return autos.find(a => a.marca === selectedMarca && a.modelo === selectedModelo) ?? null;
  }, [selectedMarca, selectedModelo, selectedVersion]);

  // ── Derived values ─────────────────────────────────────────────────────
  const consumo_kml = consumoInput ? parseFloat(consumoInput) : (autoEntry?.consumo_ruta_kml ?? 13);
  const tanque_l    = tanqueInput  ? parseFloat(tanqueInput)  : (autoEntry?.litros_tanque   ?? 50);
  const producto    = productoManual || autoEntry?.combustible || 'nafta_super';

  const canSubmit = from.trim() && to.trim() && consumo_kml > 0 && tanque_l > 0 && !loading;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const litros_inicio = litrosInicio ? parseFloat(litrosInicio) : undefined;
    onSubmit({ from: from.trim(), to: to.trim(), consumo_kml, tanque_l, producto, litros_inicio });
  }

  function handleMarcaChange(marca: string) {
    setSelectedMarca(marca);
    setSelectedModelo('');
    setSelectedVersion('');
    setConsumoInput('');
    setTanqueInput('');
    setProductoManual('');
  }

  function handleModeloChange(modelo: string) {
    setSelectedModelo(modelo);
    setSelectedVersion('');
    setConsumoInput('');
    setTanqueInput('');
  }

  const selectCls = "bg-slate-950 border border-slate-700 focus:border-amber-500/60 rounded-lg px-2.5 py-2.5 text-sm text-slate-200 focus:outline-none transition-colors disabled:opacity-40";
  const inputCls  = "w-full bg-slate-950 border border-slate-700 focus:border-amber-500/60 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors";
  const labelCls  = "text-xs font-medium text-slate-400 mb-1.5 block";

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-800">
        <NavigationIcon className="w-5 h-5 text-amber-500" />
        <h2 className="text-base font-semibold text-slate-100">Planificá tu viaje</h2>
      </div>

      <div className="space-y-4">
        {/* Origin / Destination with autocomplete */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                Desde
              </span>
            </label>
            <CityAutocomplete
              value={from}
              onChange={setFrom}
              placeholder="Ej: Córdoba"
              iconColor="text-emerald-400"
            />
          </div>
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                Hasta
              </span>
            </label>
            <CityAutocomplete
              value={to}
              onChange={setTo}
              placeholder="Ej: Bariloche"
              iconColor="text-red-400"
            />
          </div>
        </div>

        {/* Car selectors — cascading: Marca → Modelo → Versión */}
        <div>
          <label className={labelCls}>
            <CarIcon className="w-3 h-3 inline mr-1 text-amber-400" />
            Auto (opcional — o ingresá consumo manualmente abajo)
          </label>
          <div className={`grid gap-2 ${versiones.length > 1 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <select
              value={selectedMarca}
              onChange={e => handleMarcaChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Marca...</option>
              {marcas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              value={selectedModelo}
              onChange={e => handleModeloChange(e.target.value)}
              disabled={!selectedMarca}
              className={selectCls}
            >
              <option value="">Modelo...</option>
              {modelos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {versiones.length > 1 && (
              <select
                value={selectedVersion}
                onChange={e => setSelectedVersion(e.target.value)}
                className={selectCls}
              >
                <option value="">Versión...</option>
                {versiones.map(v => (
                  <option key={v.version} value={v.version}>{v.version}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Auto info pill */}
        {autoEntry && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
            <CarIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-300">
              <strong>{autoEntry.marca} {autoEntry.modelo}</strong> {autoEntry.version}
              {' '}— ruta: <strong>{autoEntry.consumo_ruta_kml} km/L</strong>
              {autoEntry.consumo_ciudad_kml && (
                <span className="text-slate-500"> · ciudad: {autoEntry.consumo_ciudad_kml} km/L</span>
              )}
              {' '}· tanque: <strong>{autoEntry.litros_tanque} L</strong>
              {' '}· {COMBUSTIBLE_LABEL[autoEntry.combustible] || autoEntry.combustible}
            </span>
          </div>
        )}

        {/* Manual consumo + tanque override */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Consumo ruta</label>
            <div className="relative">
              <input
                type="number"
                min="1" step="0.1"
                value={consumoInput || (autoEntry?.consumo_ruta_kml ?? '')}
                onChange={e => setConsumoInput(e.target.value)}
                placeholder={autoEntry ? String(autoEntry.consumo_ruta_kml) : '13'}
                className={`${inputCls} pr-10`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">km/L</span>
            </div>
          </div>
          <div>
            <label className={labelCls}>Tanque</label>
            <div className="relative">
              <input
                type="number"
                min="1"
                value={tanqueInput || (autoEntry?.litros_tanque ?? '')}
                onChange={e => setTanqueInput(e.target.value)}
                placeholder={autoEntry ? String(autoEntry.litros_tanque) : '50'}
                className={`${inputCls} pr-6`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">L</span>
            </div>
          </div>
          <div>
            <label className={labelCls}>
              <DropletsIcon className="w-3 h-3 inline mr-1" />
              Combustible
            </label>
            <select
              value={productoManual || autoEntry?.combustible || 'nafta_super'}
              onChange={e => setProductoManual(e.target.value)}
              className={`w-full ${selectCls}`}
            >
              {Object.entries(COMBUSTIBLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Litros de inicio */}
        <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-xl">
          <DropletsIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-300">¿Con cuántos litros arrancás?</p>
            <p className="text-[10px] text-slate-500">Reduce lo que cargás en la primera parada</p>
          </div>
          <div className="relative w-24">
            <input
              type="number"
              min="0"
              max={tanque_l || 200}
              step="1"
              value={litrosInicio}
              onChange={e => setLitrosInicio(e.target.value)}
              placeholder="0"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500/60 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 text-right placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors pr-8"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">L</span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold text-sm py-3 rounded-xl transition-colors disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-slate-600 border-t-slate-200 rounded-full animate-spin" />
              Calculando ruta…
            </span>
          ) : (
            <>
              Calcular ruta
              <ArrowRightIcon className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
