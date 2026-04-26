import React, { useEffect, useMemo, useState, useRef, Children } from 'react';
import { Station, PRODUCT_MAP, getProductInfo, FilterState } from '../types';
import { formatCurrency } from '../utils/api';
import {
  fetchEstadisticas,
  EstadisticasResponse } from
'../utils/api-estadisticas';
import {
  TrendingDownIcon,
  TrendingUpIcon,
  DollarSignIcon,
  MapPinIcon } from
'lucide-react';
import { motion } from 'framer-motion';
interface PriceStatsProps {
  data: Station[];
  filters: FilterState;
  ubicacion: any;
}
export function PriceStats({ data, filters, ubicacion }: PriceStatsProps) {
  const [estadisticas, setEstadisticas] = useState<EstadisticasResponse | null>(
    null
  );

  // Extraer strings estables de ubicacion para evitar disparar el effect
  // con cada nueva referencia de objeto (causa las llamadas duplicadas)
  const ubicacionProvincia = ubicacion?.provincia ?? null;
  const ubicacionLocalidad = ubicacion?.localidad_detectada ?? ubicacion?.localidad_dataset ?? null;
  const lastCallRef = useRef<string>('');

  useEffect(() => {
    const prov = filters.provincia || ubicacionProvincia || '';
    const loc  = filters.localidad || ubicacionLocalidad || '';
    if (!prov) return;

    // Deduplicar: no volver a llamar si los params son idénticos
    const callKey = `${prov}|${loc}|${filters.producto || ''}`;
    if (callKey === lastCallRef.current) return;
    lastCallRef.current = callKey;

    const loadEstadisticas = async () => {
      try {
        const result = await fetchEstadisticas({
          provincia: prov,
          localidad: loc || undefined,
          producto: filters.producto || undefined
        });
        setEstadisticas(result);
      } catch (error) {
        console.error('[PriceStats] Error loading estadísticas:', error);
        setEstadisticas(null);
      }
    };
    loadEstadisticas();
  }, [filters.provincia, filters.localidad, filters.producto, ubicacionProvincia, ubicacionLocalidad]);
  if (!data || data.length === 0) return null;
  // Find available products in data
  const productCounts = data.reduce(
    (acc, d) => {
      if (d.precio > 0) {
        acc[d.producto] = (acc[d.producto] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );
  const availableProducts = PRODUCT_MAP.filter((p) =>
  Object.keys(productCounts).some((k) => k.includes(p.match))
  );
  if (availableProducts.length === 0) return null;
  return (
    <PriceStatsInner
      data={data}
      availableProducts={availableProducts}
      productCounts={productCounts}
      estadisticas={estadisticas} />);


}
function PriceStatsInner({
  data,
  availableProducts,
  productCounts,
  estadisticas





}: {data: Station[];availableProducts: typeof PRODUCT_MAP;productCounts: Record<string, number>;estadisticas: EstadisticasResponse | null;}) {
  // Default to first non-GNC product, or first available
  const defaultIdx = availableProducts.findIndex((p) => p.key !== 'gnc');
  const [selectedIdx, setSelectedIdx] = useState(
    defaultIdx >= 0 ? defaultIdx : 0
  );
  const selectedProduct = availableProducts[selectedIdx] || availableProducts[0];
  const { minPrice, maxPrice, avgPrice, count } = useMemo(() => {
    // Try to use API estadísticas first
    if (
    estadisticas &&
    estadisticas.productos &&
    estadisticas.productos.length > 0)
    {
      const productoStats = estadisticas.productos.find((p) =>
      p.producto.includes(selectedProduct.match)
      );
      if (productoStats) {
        console.log(
          '[PriceStats] Using API stats for',
          selectedProduct.match,
          productoStats
        );
        return {
          minPrice: productoStats.precio_min,
          maxPrice: productoStats.precio_max,
          avgPrice: productoStats.precio_promedio,
          count: productoStats.cantidad_estaciones
        };
      }
    }
    // Fallback: calculate from local data
    console.log(
      '[PriceStats] Using local calculation for',
      selectedProduct.match
    );
    const prices = data.
    filter((d) => d.producto.includes(selectedProduct.match) && d.precio > 0).
    map((d) => d.precio);
    if (prices.length === 0)
    return {
      minPrice: 0,
      maxPrice: 0,
      avgPrice: 0,
      count: 0
    };
    return {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
      count: prices.length
    };
  }, [data, selectedProduct, estadisticas]);
  // Unique provinces and localidades in data
  const provinces = useMemo(
    () => [...new Set(data.map((d) => d.provincia))],
    [data]
  );
  const localities = useMemo(
    () => [...new Set(data.map((d) => d.localidad))],
    [data]
  );
  const locationLabel =
  localities.length === 1 ?
  `${localities[0]}, ${provinces[0]}` :
  provinces.length === 1 ?
  provinces[0] :
  `${provinces.length} provincias`;
  const stats = [
  {
    title: 'Más Bajo',
    subtitle: `${selectedProduct.shortLabel} · ${selectedProduct.unit}`,
    value: count > 0 ? formatCurrency(minPrice) : '—',
    icon: TrendingDownIcon,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20'
  },
  {
    title: 'Promedio',
    subtitle: `${selectedProduct.shortLabel} · ${selectedProduct.unit}`,
    value: count > 0 ? formatCurrency(avgPrice) : '—',
    icon: DollarSignIcon,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20'
  },
  {
    title: 'Más Alto',
    subtitle: `${selectedProduct.shortLabel} · ${selectedProduct.unit}`,
    value: count > 0 ? formatCurrency(maxPrice) : '—',
    icon: TrendingUpIcon,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20'
  },
  {
    title: 'Estaciones',
    subtitle: locationLabel,
    value: data.length.toString(),
    icon: MapPinIcon,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20'
  }];

  const container = {
    hidden: {
      opacity: 0
    },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };
  const item = {
    hidden: {
      opacity: 0,
      y: 20
    },
    show: {
      opacity: 1,
      y: 0
    }
  };
  return (
    <div className="mb-6">
      {/* Product selector */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {availableProducts.map((product, idx) => {
          const isActive = idx === selectedIdx;
          return (
            <button
              key={product.key}
              onClick={() => setSelectedIdx(idx)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${isActive ? `${product.bgClass} ${product.textClass} border` : 'text-slate-400 bg-slate-800/50 border border-slate-700/50 hover:text-slate-200'}`}
              style={
              isActive ?
              {
                borderColor: `${product.color}40`
              } :
              undefined
              }>
              
              {product.shortLabel}
              <span className="ml-1 opacity-60">{product.unit}</span>
            </button>);

        })}
      </div>

      {/* Stats cards */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        key={selectedProduct.key}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {stats.map((stat, i) =>
        <motion.div
          key={i}
          variants={item}
          className={`bg-slate-900/80 backdrop-blur-md border ${stat.border} rounded-xl p-5 flex items-center gap-4`}>
          
            <div className={`p-3 rounded-lg ${stat.bg}`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-400">{stat.title}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {stat.subtitle}
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>);

}