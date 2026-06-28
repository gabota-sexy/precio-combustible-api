import { trackFiltroAplicado, trackBusquedaEjecutada } from '../utils/analytics';
import React, { useEffect, useState } from 'react';
import { FilterState, Station } from '../types';
import { fetchProvincias, fetchLocalidades } from '../utils/api';
import { SearchIcon, XIcon, LoaderIcon, SlidersHorizontalIcon } from 'lucide-react';

const PRODUCTOS = [
  'Nafta (súper) entre 92 y 95 Ron',
  'Nafta de más de 95 Ron',
  'Gasoil grado 2',
  'Gasoil grado 3',
  'GNC',
  'Infinia',
  'Infinia Diesel',
];
const PRODUCTOS_SHORT: Record<string, string> = {
  'Nafta (súper) entre 92 y 95 Ron': 'Súper',
  'Nafta de más de 95 Ron':           'Premium',
  'Gasoil grado 2':                   'Gasoil G2',
  'Gasoil grado 3':                   'Gasoil G3',
  'Infinia':                          'Infinia',
  'Infinia Diesel':                   'Infinia Diesel',
  'GNC':                              'GNC',
};
const FALLBACK_PROVINCIAS = [
  'BUENOS AIRES','CAPITAL FEDERAL','CATAMARCA','CHACO','CHUBUT',
  'CORDOBA','CORRIENTES','ENTRE RIOS','FORMOSA','JUJUY','LA PAMPA','LA RIOJA',
  'MENDOZA','MISIONES','NEUQUEN','RIO NEGRO','SALTA','SAN JUAN','SAN LUIS',
  'SANTA CRUZ','SANTA FE','SANTIAGO DEL ESTERO','TIERRA DEL FUEGO','TUCUMAN',
];
const BARRIOS_CABA = [
  'Agronomía','Almagro','Balvanera','Barracas','Belgrano','Boedo','Caballito',
  'Chacarita','Coghlan','Colegiales','Constitución','Flores','Floresta',
  'La Boca','La Paternal','Liniers','Mataderos','Monte Castro','Montserrat',
  'Nueva Pompeya','Núñez','Palermo','Parque Avellaneda','Parque Chacabuco',
  'Parque Chas','Parque Patricios','Puerto Madero','Recoleta','Retiro',
  'Saavedra','San Cristóbal','San Nicolás','San Telmo','Vélez Sársfield',
  'Versalles','Villa Crespo','Villa del Parque','Villa Devoto','Villa General Mitre',
  'Villa Lugano','Villa Luro','Villa Ortúzar','Villa Pueyrredón','Villa Real',
  'Villa Riachuelo','Villa Santa Rita','Villa Soldati','Villa Urquiza',
];
const DATE_PRESETS = [
  { label: '7d',    days: 7   },
  { label: '30d',   days: 30  },
  { label: '3m',    days: 90  },
  { label: '1 año', days: 365 },
  { label: 'Todo',  days: 0   },
];
function daysAgoISO(days: number): string {
  if (days === 0) return '';
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

interface FilterBarProps {
  filters:       FilterState;
  onSearch:      (f: FilterState) => void;
  availableData: Station[];
  loading:       boolean;
}

const sel =
  'h-9 bg-slate-900 border border-slate-700/70 rounded-lg px-3 text-sm text-slate-200 ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/60 ' +
  'transition-colors cursor-pointer appearance-none pr-7';

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">▾</span>
    </div>
  );
}

export function FilterBar({ filters, onSearch, availableData, loading }: FilterBarProps) {
  const [lf, setLf]               = useState<FilterState>(filters);
  const [datePreset, setDatePreset] = useState(1);
  const [provincias, setProvincias] = useState<string[]>(FALLBACK_PROVINCIAS);
  const [localidades, setLocalidades] = useState<string[]>([]);
  const [loadingLoc, setLoadingLoc]   = useState(false);
  const [showExtra, setShowExtra]     = useState(false);
  const [highlightBarrio, setHighlightBarrio] = useState(false);

  // Sync auto-filled provincia/localidad/barrio from ubicacion
  useEffect(() => {
    setLf(prev => ({
      ...prev,
      provincia: filters.provincia || prev.provincia,
      localidad: filters.localidad || prev.localidad,
      barrio:    filters.barrio    || prev.barrio,
    }));
  }, [filters.provincia, filters.localidad, filters.barrio]);

  useEffect(() => {
    fetchProvincias().then(list => { if (list.length) setProvincias(list.sort()); });
  }, []);

  useEffect(() => {
    if (!lf.provincia) { setLocalidades([]); return; }
    setLoadingLoc(true);
    fetchLocalidades(lf.provincia).then(list => {
      setLocalidades(list.sort());
      setLoadingLoc(false);
    });
  }, [lf.provincia]);

  const isCaba = ['CABA', 'CAPITAL'].some(k => (lf.provincia || '').toUpperCase().includes(k));
  const hasActive = !!(lf.provincia || lf.localidad || lf.barrio || lf.empresa || lf.producto);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isCaba && !lf.barrio) {
      setHighlightBarrio(true);
      setTimeout(() => setHighlightBarrio(false), 1500);
      return;
    }
    trackBusquedaEjecutada({ provincia: lf.provincia, localidad: lf.localidad, producto: lf.producto, empresa: lf.empresa, resultados: 0 });
    onSearch(lf);
  };
  const clear  = () => {
    const blank: FilterState = { provincia: '', localidad: '', barrio: '', empresa: '', producto: '', fecha_desde: daysAgoISO(30) };
    setLf(blank); setDatePreset(1); onSearch(blank);
  };
  const setProvince = (v: string) => setLf(p => ({ ...p, provincia: v, localidad: '', barrio: '' }));

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-3 mb-5">
      <form onSubmit={submit}>

        {/* ── Fila principal ── */}
        <div className="flex flex-wrap items-end gap-2">

          {/* Provincia */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Provincia</label>
            <SelectWrap>
              <select value={lf.provincia} onChange={e => { setProvince(e.target.value); trackFiltroAplicado('provincia', e.target.value); }} className={sel} style={{ minWidth: 140 }}>
                <option value="">Todas</option>
                {provincias.map(p => (
                  <option key={p} value={p}>{p === 'CAPITAL FEDERAL' ? 'CAPITAL FEDERAL (CABA)' : p}</option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {/* Localidad */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Localidad{loadingLoc && <LoaderIcon className="inline w-3 h-3 text-amber-500 animate-spin ml-1" />}
            </label>
            {localidades.length > 0 ? (
              <SelectWrap>
                <select
                  value={lf.localidad}
                  onChange={e => {
                    const nf = { ...lf, localidad: e.target.value, barrio: '' };
                    setLf(nf);
                    if (e.target.value && !loading) onSearch(nf);
                  }}
                  className={sel} style={{ minWidth: 140 }}
                >
                  <option value="">Todas</option>
                  {localidades.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </SelectWrap>
            ) : (
              <input
                type="text"
                value={lf.localidad}
                onChange={e => setLf({ ...lf, localidad: e.target.value.toUpperCase() })}
                placeholder={lf.provincia ? 'Cargando...' : 'Elegí provincia'}
                className="h-9 bg-slate-900 border border-slate-700/70 rounded-lg px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/60 transition-colors"
                style={{ minWidth: 140 }}
              />
            )}
          </div>

          {/* Producto */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Producto</label>
            <SelectWrap>
              <select value={lf.producto} onChange={e => { setLf({ ...lf, producto: e.target.value }); trackFiltroAplicado('producto', e.target.value); }} className={sel} style={{ minWidth: 120 }}>
                <option value="">Todos</option>
                {PRODUCTOS.map(p => <option key={p} value={p}>{PRODUCTOS_SHORT[p] ?? p}</option>)}
              </select>
            </SelectWrap>
          </div>

          {/* Vigencia */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Vigencia</label>
            <div className="flex gap-1">
              {DATE_PRESETS.map((p, i) => (
                <button
                  key={i} type="button"
                  onClick={() => { setDatePreset(i); setLf(f => ({ ...f, fecha_desde: daysAgoISO(p.days) })); }}
                  className={`h-9 px-2.5 text-xs font-medium rounded-lg transition-colors border whitespace-nowrap ${
                    datePreset === i
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Empresa (botón "Más") */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider opacity-0 select-none">·</label>
            <button
              type="button"
              onClick={() => setShowExtra(v => !v)}
              className={`h-9 flex items-center gap-1.5 px-3 text-xs font-medium rounded-lg border transition-colors ${
                showExtra ? 'bg-slate-700/60 text-slate-200 border-slate-600' : 'bg-slate-800/50 text-slate-500 border-slate-700/50 hover:text-slate-300'
              }`}
            >
              <SlidersHorizontalIcon className="w-3.5 h-3.5" />
              {lf.empresa ? `Empresa: ${lf.empresa.split(' ')[0]}` : 'Empresa'}
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-end gap-2 ml-auto">
            {hasActive && (
              <button
                type="button" onClick={clear}
                className="h-9 flex items-center gap-1 px-3 text-xs text-slate-400 hover:text-amber-400 transition-colors border border-slate-700/50 rounded-lg hover:border-amber-500/30"
              >
                <XIcon className="w-3.5 h-3.5" />
                Limpiar
              </button>
            )}
            <button
              type="submit" disabled={loading}
              className="h-9 flex items-center gap-1.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-lg transition-all disabled:opacity-50"
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                : <SearchIcon className="w-4 h-4" />}
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </div>

        {/* ── Barrio CABA — aparece SIEMPRE que se elige Capital ── */}
        {isCaba && (
          <div className="mt-3 pt-3 border-t border-amber-500/20">
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1 flex-1 max-w-xs">
                <label className={`text-[10px] font-semibold uppercase tracking-wider ${highlightBarrio ? 'text-red-400 animate-pulse' : 'text-amber-500'}`}>
                  Barrio <span className="text-amber-400/60 normal-case font-normal">(requerido en CABA)</span>
                </label>
                <SelectWrap>
                  <select
                    value={lf.barrio}
                    onChange={e => {
                      setHighlightBarrio(false);
                      const nf = { ...lf, barrio: e.target.value };
                      setLf(nf);
                      if (e.target.value && !loading) onSearch(nf);
                    }}
                    className={`${sel} ${highlightBarrio ? 'border-red-500 ring-2 ring-red-500/40' : 'border-amber-500/30 focus:border-amber-500'}`}
                    style={{ minWidth: 200 }}
                  >
                    <option value="">Todos los barrios</option>
                    {BARRIOS_CABA.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </SelectWrap>
              </div>
              {lf.barrio && (
                <span className="text-xs text-amber-400/70 pb-2">
                  Mostrando estaciones en {lf.barrio}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Empresa (extra) ── */}
        {showExtra && (
          <div className="mt-3 pt-3 border-t border-slate-800/60">
            <div className="flex flex-col gap-1 max-w-[200px]">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Empresa</label>
              <SelectWrap>
                <select value={lf.empresa} onChange={e => setLf({ ...lf, empresa: e.target.value })} className={sel} style={{ minWidth: 180 }}>
                  <option value="">Todas</option>
                  {Array.from(new Set(['YPF','Shell','Axion Energy','Puma Energy','Gulf','ACA','Petrobras',
                    ...availableData.map(d => d.empresa).filter(Boolean)])).sort().map(e => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          </div>
        )}

      </form>
    </div>
  );
}
