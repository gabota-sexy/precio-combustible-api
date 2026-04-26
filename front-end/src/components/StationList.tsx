import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Station, PRODUCT_MAP, getProductInfo } from '../types';
import { formatCurrency, getCompanyColorClass } from '../utils/api';
import { staleDaysAgo } from '../utils/stale';

// Un producto es "fresco" si tiene precio actual (>= $1000) y fue reportado en los últimos 30 días
const MIN_PRICE_SANE = 1000;
function isProductFresh(p: { precio: number | null; fecha_vigencia: string }): boolean {
  if (p.precio == null || p.precio < MIN_PRICE_SANE) return false;
  return staleDaysAgo(p.fecha_vigencia) <= 30;
}
import { stationSlug } from '../utils/slug';
import {
  MapPinIcon,
  NavigationIcon,
  FuelIcon,
  CalendarIcon,
  FlameIcon,
  SearchIcon,
  BellIcon,
  ExternalLinkIcon } from
'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MiniLeadForm, isAlreadySubscribed } from './MiniLeadForm';
import CommunityActions from './community/CommunityActions';
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
// Group stations by physical location (empresa + direccion)
interface GroupedStation {
  empresa: string;
  bandera?: string;
  direccion: string;
  localidad: string;
  provincia: string;
  codigo_postal?: string;
  tipo_bandera?: string;
  latitud?: number;
  longitud?: number;
  distancia?: number;
  products: {
    producto: string;
    precio: number | null;
    fecha_vigencia: string;
    fecha_ultimo_reporte?: string;
  }[];
  fecha_ultimo_reporte?: string;
}
function groupStations(data: Station[]): GroupedStation[] {
  const map = new Map<string, GroupedStation>();
  for (const s of data) {
    const key = `${s.empresa}|${s.direccion}`;
    const existing = map.get(key);
    if (existing) {
      // Avoid duplicate products
      if (!existing.products.some((p) => p.producto === s.producto)) {
        existing.products.push({
          producto: s.producto,
          precio: s.precio,
          fecha_vigencia: s.fecha_vigencia
        });
      }
      // Keep shortest distance
      if (
      s.distancia != null && (
      existing.distancia == null || s.distancia < existing.distancia))
      {
        existing.distancia = s.distancia;
      }
    } else {
      map.set(key, {
        empresa: s.empresa,
        bandera: s.bandera,
        direccion: s.direccion,
        localidad: s.localidad,
        provincia: s.provincia,
        codigo_postal: s.codigo_postal,
        tipo_bandera: s.tipo_bandera,
        latitud: s.latitud,
        longitud: s.longitud,
        distancia: s.distancia,
        products: [
        {
          producto: s.producto,
          precio: s.precio,
          fecha_vigencia: s.fecha_vigencia,
          fecha_ultimo_reporte: s.fecha_ultimo_reporte,
        }],
        fecha_ultimo_reporte: s.fecha_ultimo_reporte,
      });
    }
  }
  return Array.from(map.values());
}
const FILTER_TABS = [
{
  key: 'todos',
  label: 'Todos'
},
{
  key: 'nafta',
  label: 'Nafta',
  matches: ['entre 92 y 95', 'más de 95']
},
{
  key: 'gasoil',
  label: 'Gasoil',
  matches: ['Gas Oil']
},
{
  key: 'gnc',
  label: 'GNC',
  matches: ['GNC']
}];

interface StationListProps {
  data: Station[];
  selectedStation?: Station | null;
  onStationClick?: (station: Station) => void;
  filters?: { provincia?: string; barrio?: string; [key: string]: unknown };
}
export function StationList({
  data,
  selectedStation,
  onStationClick,
  filters
}: StationListProps) {
  const [sortBy, setSortBy] = useState<'precio' | 'distancia' | 'fecha'>(
    'fecha'
  );
  const [productFilter, setProductFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [soloRecientes, setSoloRecientes] = useState(false);
  const hasDistances = data.some(
    (d) => d.distancia !== undefined && d.distancia !== Infinity
  );

  // Auto-sort by distance when GPS data is available
  useEffect(() => {
    if (hasDistances) setSortBy('distancia');
  }, [hasDistances]);
  // Group stations
  const grouped = useMemo(() => groupStations(data), [data]);
  // Tab counts (based on raw data)
  const tabCounts = useMemo(() => {
    return FILTER_TABS.map((tab) => ({
      ...tab,
      count:
      tab.key === 'todos' ?
      grouped.length :
      grouped.filter((g) =>
      g.products.some((p) =>
      tab.matches!.some((m) => p.producto.includes(m))
      )
      ).length
    }));
  }, [grouped]);
  // Count stations with at least one fresh price (<=90 days)
  const freshCount = useMemo(
    () => grouped.filter((g) => g.products.some((p) => staleDaysAgo(p.fecha_vigencia) <= 90)).length,
    [grouped]
  );

  // Filter + search + sort
  const filtered = useMemo(() => {
    let result = grouped;
    // Staleness filter
    if (soloRecientes && freshCount > 0) {
      result = result.filter((g) => g.products.some((p) => staleDaysAgo(p.fecha_vigencia) <= 90));
    }
    // Product filter
    const activeTab = FILTER_TABS.find((t) => t.key === productFilter);
    if (activeTab && activeTab.matches) {
      result = result.filter((g) =>
      g.products.some((p) =>
      activeTab.matches!.some((m) => p.producto.includes(m))
      )
      );
    }
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      result = result.filter(
        (g) =>
        g.empresa.toUpperCase().includes(q) ||
        g.direccion.toUpperCase().includes(q) ||
        g.localidad.toUpperCase().includes(q)
      );
    }
    // Sort
    return [...result].sort((a, b) => {
      if (sortBy === 'distancia' && hasDistances) {
        return (a.distancia || Infinity) - (b.distancia || Infinity);
      }
      if (sortBy === 'precio') {
        // Usar solo precios frescos (>= $1000, <= 30 días) — ignorar datos históricos
        const freshMin = (g: GroupedStation) => {
          const prices = g.products.filter(isProductFresh).map((p) => p.precio!);
          return prices.length > 0 ? Math.min(...prices) : Infinity;
        };
        return freshMin(a) - freshMin(b);
      }
      // Default: fecha más reciente de los productos frescos
      const freshDate = (g: GroupedStation) => {
        const dates = g.products
          .filter((p) => p.precio && p.precio >= MIN_PRICE_SANE && p.fecha_vigencia)
          .map((p) => new Date(p.fecha_vigencia).getTime());
        return dates.length > 0 ? Math.max(...dates) : 0;
      };
      return freshDate(b) - freshDate(a); // Más reciente primero
    });
  }, [grouped, productFilter, searchQuery, sortBy, hasDistances, soloRecientes, freshCount]);
  const isCabaNoBarrio =
    filters?.provincia &&
    (filters.provincia.toUpperCase().includes('CIUDAD AUTÓNOMA') ||
      filters.provincia.toUpperCase().includes('CAPITAL FEDERAL') ||
      filters.provincia.toUpperCase().includes('CABA')) &&
    !filters.barrio;

  if (data.length === 0) {
    return (
      <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-8 text-center">
        <FuelIcon className="w-12 h-12 text-slate-700 mx-auto mb-3" />
        {isCabaNoBarrio ? (
          <>
            <p className="text-amber-400 font-medium">CABA requiere seleccionar un barrio</p>
            <p className="text-slate-400 text-sm mt-1">
              Elegí un barrio en el filtro de arriba para ver estaciones
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-amber-500/70 text-xs">
              <span>↑</span>
              <span>Seleccioná el campo "Barrio"</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-400">No se encontraron estaciones</p>
            <p className="text-slate-500 text-sm mt-1">
              Probá cambiar los filtros de búsqueda
            </p>
          </>
        )}
      </div>);
  }
  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPinIcon className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-semibold text-slate-100">
            Estaciones ({filtered.length})
          </h2>
          {freshCount < grouped.length && (
            <button
              onClick={() => setSoloRecientes(!soloRecientes)}
              title={soloRecientes ? 'Mostrar todas (incluye precios viejos)' : 'Solo precios confirmados (últimos 90 días)'}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors ${
                soloRecientes
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
              }`}>
              {soloRecientes ? '✓ Recientes' : 'Todos'}
            </button>
          )}
        </div>
        <div className="flex bg-slate-800 p-0.5 rounded-md">
          <button
            onClick={() => setSortBy('fecha')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${sortBy === 'fecha' ? 'bg-amber-500/20 text-amber-500' : 'text-slate-400 hover:text-slate-200'}`}>
            
            Fecha
          </button>
          <button
            onClick={() => setSortBy('precio')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${sortBy === 'precio' ? 'bg-amber-500/20 text-amber-500' : 'text-slate-400 hover:text-slate-200'}`}>
            
            Precio
          </button>
          {hasDistances &&
          <button
            onClick={() => setSortBy('distancia')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${sortBy === 'distancia' ? 'bg-amber-500/20 text-amber-500' : 'text-slate-400 hover:text-slate-200'}`}>
            
              Distancia
            </button>
          }
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por nombre o dirección..."
          className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors" />
        
      </div>

      {/* Product filter tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
        {tabCounts.
        filter((t) => t.count > 0 || t.key === 'todos').
        map((tab) =>
        <button
          key={tab.key}
          onClick={() => setProductFilter(tab.key)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${productFilter === tab.key ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'text-slate-400 bg-slate-800/50 border border-slate-700/50 hover:text-slate-200'}`}>
          
              {tab.label}
              <span className="ml-1 opacity-60">({tab.count})</span>
            </button>
        )}
      </div>

      {/* Station cards */}
      <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' } as React.CSSProperties}>
        {filtered.map((station, idx) =>
        <StationCard
          key={`${station.empresa}-${station.direccion}-${idx}`}
          station={station}
          idx={idx}
          selectedStation={selectedStation}
          onStationClick={onStationClick}
          data={data} />

        )}
        {filtered.length === 0 &&
        <div className="py-8 text-center">
            <p className="text-slate-500 text-sm">
              No hay resultados para "{searchQuery}"
            </p>
          </div>
        }
      </div>
    </div>);

}
// Individual station card with multi-product support
function StationCard({
  station,
  idx,
  selectedStation,
  onStationClick,
  data






}: {station: GroupedStation;idx: number;selectedStation?: Station | null;onStationClick?: (station: Station) => void;data: Station[];}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  // Sort: frescos primero → GNC al final → precio ascendente
  const sortedProducts = useMemo(() => {
    return [...station.products].sort((a, b) => {
      const aGnc = (a.producto || '').includes('GNC') ? 1 : 0;
      const bGnc = (b.producto || '').includes('GNC') ? 1 : 0;
      if (aGnc !== bGnc) return aGnc - bGnc;
      // Frescos antes que stale
      const aFresh = isProductFresh(a) ? 0 : 1;
      const bFresh = isProductFresh(b) ? 0 : 1;
      if (aFresh !== bFresh) return aFresh - bFresh;
      return (a.precio ?? Infinity) - (b.precio ?? Infinity);
    });
  }, [station.products]);
  // Arrancar en el primer producto fresco — no en el más barato (que puede ser histórico)
  const firstFreshIdx = useMemo(
    () => sortedProducts.findIndex(isProductFresh),
    [sortedProducts]
  );
  const [activeProductIdx, setActiveProductIdx] = useState(() =>
    firstFreshIdx >= 0 ? firstFreshIdx : 0
  );
  const displayIdx = hoveredIdx !== null ? hoveredIdx : activeProductIdx;
  const displayProduct = sortedProducts[displayIdx] || sortedProducts[0];
  const productInfo = getProductInfo(displayProduct.producto);
  const displayDias = staleDaysAgo(displayProduct.fecha_vigencia);
  // Stale si tiene más de 30 días O si el precio es < $1000 (dato histórico pre-2025)
  const displayStale = displayDias > 30 || (displayProduct.precio != null && displayProduct.precio < MIN_PRICE_SANE);
  const isGncOnly =
  sortedProducts.length === 1 && sortedProducts[0].producto.includes('GNC');
  const isSelected = selectedStation ?
  station.empresa === selectedStation.empresa &&
  station.direccion === selectedStation.direccion :
  false;
  const handleClick = () => {
    // Find the matching raw Station record
    const raw = data.find(
      (s) =>
      s.empresa === station.empresa &&
      s.direccion === station.direccion &&
      s.producto === displayProduct.producto
    );
    if (raw && onStationClick) onStationClick(raw);
  };
  const handleProductClick = (e: React.MouseEvent, pIdx: number) => {
    e.stopPropagation();
    setActiveProductIdx(pIdx);
    // Also trigger map navigation with this product
    const prod = sortedProducts[pIdx];
    const raw = data.find(
      (s) =>
      s.empresa === station.empresa &&
      s.direccion === station.direccion &&
      s.producto === prod.producto
    );
    if (raw && onStationClick) onStationClick(raw);
  };
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 20
      }}
      animate={{
        opacity: 1,
        y: 0
      }}
      transition={{
        delay: Math.min(idx * 0.03, 0.4)
      }}
      onClick={handleClick}
      className={`bg-slate-950 border rounded-lg p-4 transition-all cursor-pointer ${isSelected ? 'border-amber-500/50 ring-1 ring-amber-500/20 bg-amber-500/5' : 'border-slate-800 hover:border-slate-600'}`}>
      
      {/* Top row: company + price */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${getCompanyColorClass(station.empresa || '')}`} />
          
          <h3 className="font-bold text-slate-200 truncate">
            {station.bandera || station.empresa}
          </h3>
          {isGncOnly &&
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <FlameIcon className="w-2.5 h-2.5" />
              Solo GNC
            </span>
          }
          {station.tipo_bandera && station.tipo_bandera !== 'PROPIA' &&
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-500">
              {station.tipo_bandera}
            </span>
          }
        </div>
        <div className="text-right flex-shrink-0 ml-2">
          {displayProduct.precio == null ? (
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-500 bg-slate-800/80 px-2 py-1 rounded border border-slate-700/60 block leading-none">
                Sin precio
              </span>
              {(displayProduct.fecha_ultimo_reporte || station.fecha_ultimo_reporte) && (
                <span className="text-[10px] text-slate-600 mt-1 block">
                  Últ. reporte: {new Date(displayProduct.fecha_ultimo_reporte || station.fecha_ultimo_reporte!).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait">
                <motion.span
                  key={displayProduct.producto}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className={`text-xl font-bold block leading-none ${displayStale ? 'text-slate-500 line-through' : 'text-emerald-400'}`}>
                  {formatCurrency(displayProduct.precio)}
                </motion.span>
              </AnimatePresence>
              {displayStale ? (
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                  Sin confirmar
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 font-medium">{productInfo.unit}</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Address */}
      <div className="text-sm text-slate-400 mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate">{station.direccion}</p>
          <p className="text-slate-500">
            {station.localidad}, {station.provincia}
            {station.codigo_postal &&
            <span className="ml-1 text-slate-600">
                ({station.codigo_postal})
              </span>
            }
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link
            to={`/estacion/${stationSlug({ empresa: station.empresa, bandera: station.bandera, direccion: station.direccion, localidad: station.localidad, provincia: station.provincia })}`}
            onClick={(e) => e.stopPropagation()}
            title="Ver página de esta estación"
            className="p-1.5 rounded-md text-slate-600 hover:text-amber-400 hover:bg-slate-800 transition-colors"
          >
            <ExternalLinkIcon className="w-3.5 h-3.5" />
          </Link>
          <a
            href={
              station.latitud && station.longitud
                ? `https://www.google.com/maps/dir/?api=1&destination=${station.latitud},${station.longitud}`
                : `https://www.google.com/maps/search/${encodeURIComponent(`${station.direccion}, ${station.localidad}, ${station.provincia}, Argentina`)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Cómo llegar"
            className="p-1.5 rounded-md text-slate-600 hover:text-emerald-400 hover:bg-slate-800 transition-colors">
            <NavigationIcon className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Product badges — clickable */}
      <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-800/50">
        {sortedProducts.map((prod, pIdx) => {
          const info = getProductInfo(prod.producto);
          const isActive = pIdx === activeProductIdx;
          const isHovered = pIdx === hoveredIdx;
          const prodFresh = isProductFresh(prod);
          return (
            <button
              key={prod.producto}
              onClick={(e) => handleProductClick(e, pIdx)}
              onMouseEnter={() => setHoveredIdx(pIdx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`group relative inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all border ${
                !prodFresh ? 'opacity-40' :
                isActive ? `${info.bgClass} ${info.textClass}` :
                isHovered ? `bg-slate-800 ${info.textClass}` :
                'bg-slate-800/50 text-slate-400 border-slate-700/50'
              }`}
              style={{ borderColor: isActive || isHovered ? `${info.color}40` : undefined }}>
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: info.color }} />
              {info.shortLabel}
              <span className={`font-bold transition-opacity ${isActive || isHovered ? 'opacity-100' : 'opacity-50'}`}>
                {prodFresh && prod.precio != null ? formatCurrency(prod.precio) : '—'}
              </span>
            </button>);

        })}

        {/* Bell alert CTA */}
        {!isAlreadySubscribed() && !showAlert && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowAlert(true); }}
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-amber-500 transition-colors"
            title="Alertas de precio">
            <BellIcon className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Metadata on the right */}
        <div className="flex items-center gap-3 ml-auto">
          {displayProduct.fecha_vigencia &&
          <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <CalendarIcon className="w-3 h-3" />
                {formatVigencia(displayProduct.fecha_vigencia)}
              </div>
              {(() => {
              const dias =
              (Date.now() -
              new Date(displayProduct.fecha_vigencia).getTime()) /
              86400000;
              if (dias > 365) {
                return (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                      {Math.floor(dias / 365)} año
                      {Math.floor(dias / 365) > 1 ? 's' : ''}
                    </span>);

              } else if (dias > 60) {
                return (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {Math.floor(dias / 30)} mes
                      {Math.floor(dias / 30) > 1 ? 'es' : ''}
                    </span>);

              }
              return null;
            })()}
            </div>
          }
          {station.distancia !== undefined &&
          station.distancia !== Infinity &&
          <div className="flex items-center gap-1 text-xs text-slate-400">
                <NavigationIcon className="w-3 h-3" />
                {station.distancia < 1 ?
            `${Math.round(station.distancia * 1000)} m` :
            `${station.distancia.toFixed(1)} km`}
              </div>
          }
        </div>
      </div>
      {/* Inline alert form */}
      {showAlert && (
        <div className="mt-3 pt-3 border-t border-slate-800/50" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-slate-400 mb-2">
            🔔 Avisame si cambia el precio en <span className="text-slate-200 font-medium">{station.bandera || station.empresa}</span>
          </p>
          <MiniLeadForm
            compact
            zona={`${station.localidad}, ${station.provincia}`}
            placeholder="Email o WhatsApp"
            onSuccess={() => setShowAlert(false)}
            onDismiss={() => setShowAlert(false)}
          />
        </div>
      )}

      {/* Community actions: reportar / actualizar precio */}
      <div className="mt-2 pt-2 border-t border-slate-800/30 flex justify-end">
        <CommunityActions
          station={{
            empresa: station.empresa,
            bandera: station.bandera,
            direccion: station.direccion,
            localidad: station.localidad,
            provincia: station.provincia,
          }}
          productoActual={displayProduct?.producto}
        />
      </div>
    </motion.div>);

}