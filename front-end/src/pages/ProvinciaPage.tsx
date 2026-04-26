import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FuelIcon, MapPinIcon, ChevronLeftIcon,
  TrendingDownIcon, TrendingUpIcon, BarChart2Icon,
} from 'lucide-react';
import { formatCurrency } from '../utils/api';
import { slugToProvincia } from '../utils/slug';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface ProvinciaStats {
  provincia: string;
  productos: {
    producto: string;
    precio_min: number;
    precio_max: number;
    precio_promedio: number;
    cantidad_estaciones: number;
    por_bandera: { bandera: string; precio_promedio: number; cantidad_estaciones: number }[];
  }[];
  ultima_actualizacion?: string;
}

function MetaUpdater({ provincia, stats, slug }: { provincia: string; stats: ProvinciaStats | null; slug: string }) {
  useEffect(() => {
    const title     = `Precio de nafta en ${provincia} hoy | Tankear`;
    const desc      = `Precios actualizados de nafta Súper, Premium y Gasoil en ${provincia}. Encontrá la estación más barata cerca tuyo. YPF, Shell, Axion, Puma y más.`;
    const canonical = `https://tankear.com.ar/precios/${slug}`;

    document.title = title;

    // Meta description
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);

    // Canonical — apunta a esta página, no al home
    let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonical);

    // Open Graph
    setMeta('og:title',       title);
    setMeta('og:description', desc);
    setMeta('og:url',         canonical);

    return () => {
      document.title = 'Tankear — Precios de combustible en Argentina';
      const el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (el) el.setAttribute('href', 'https://tankear.com.ar/');
    };
  }, [provincia, slug]);
  return null;
}

function setMeta(property: string, content: string) {
  const attr = property.startsWith('og:') ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${property}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, property); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

const PRODUCT_COLORS: Record<string, string> = {
  super:   'text-blue-400',
  premium: 'text-purple-400',
  gasoil:  'text-amber-400',
  gnc:     'text-emerald-400',
};

function getProductColor(producto: string): string {
  const l = producto.toLowerCase();
  if (l.includes('gnc'))                         return PRODUCT_COLORS.gnc;
  if (l.includes('gas oil') || l.includes('diesel')) return PRODUCT_COLORS.gasoil;
  if (l.includes('más de 95') || l.includes('premium')) return PRODUCT_COLORS.premium;
  return PRODUCT_COLORS.super;
}

export function ProvinciaPage() {
  const { provincia: slug } = useParams<{ provincia: string }>();
  const provincia = slugToProvincia(slug || '');

  const [stats,   setStats]   = useState<ProvinciaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!provincia) return;
    setLoading(true);
    fetch(`${API_BASE}/precios/estadisticas?provincia=${encodeURIComponent(provincia)}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => setStats({
        provincia,
        productos: (data.por_producto || []).map((p: any) => ({
          producto:            p.producto,
          precio_min:          p.precio_min,
          precio_max:          p.precio_max,
          precio_promedio:     p.precio_promedio,
          cantidad_estaciones: p.count_estaciones ?? p.cantidad_estaciones ?? 0,
          por_bandera:         p.por_bandera || [],
        })),
        ultima_actualizacion: data.ultima_actualizacion,
      }))
      .catch(() => setError('No pudimos cargar las estadísticas.'))
      .finally(() => setLoading(false));
  }, [provincia]);

  const displayNombre = provincia === 'CIUDAD AUTONOMA DE BUENOS AIRES' ? 'CABA' : provincia;

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <MetaUpdater provincia={provincia} stats={stats} slug={slug || ''} />

      {/* Header */}
      <header className="w-full bg-slate-950 border-b border-slate-800 sticky top-0 z-50">
        <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
            <ChevronLeftIcon className="w-5 h-5" />
          </Link>
          <FuelIcon className="w-5 h-5 text-amber-500" />
          <span className="font-bold text-slate-100">Tankear</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Page title */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <MapPinIcon className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              Precios de combustible en {displayNombre}
            </h1>
            <p className="text-slate-500 text-sm">
              Estadísticas actualizadas de todas las estaciones de servicio
            </p>
          </div>
        </div>

        {error && <p className="text-slate-500 text-sm text-center py-10">{error}</p>}

        {stats && stats.productos.length > 0 && (
          <>
            {/* Product cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {stats.productos.map(prod => {
                const color = getProductColor(prod.producto);
                return (
                  <div key={prod.producto} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${color}`}>
                      {prod.producto}
                    </p>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div>
                        <p className="text-[10px] text-slate-600 mb-1">Mínimo</p>
                        <p className="text-lg font-bold text-emerald-400">{formatCurrency(prod.precio_min)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 mb-1">Promedio</p>
                        <p className="text-lg font-bold text-slate-300">{formatCurrency(prod.precio_promedio)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 mb-1">Máximo</p>
                        <p className="text-lg font-bold text-red-400">{formatCurrency(prod.precio_max)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600">
                      {prod.cantidad_estaciones} estaciones registradas
                    </p>

                    {/* Por bandera */}
                    {prod.por_bandera?.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
                        <p className="text-[10px] text-slate-600 uppercase tracking-wide flex items-center gap-1">
                          <BarChart2Icon className="w-3 h-3" /> Promedio por bandera
                        </p>
                        {[...prod.por_bandera]
                          .sort((a, b) => a.precio_promedio - b.precio_promedio)
                          .slice(0, 6)
                          .map(b => (
                            <div key={b.bandera} className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 flex-1 truncate">{b.bandera}</span>
                              <div className="flex-1 max-w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-500/50 rounded-full"
                                  style={{
                                    width: `${Math.min(100, ((b.precio_promedio - prod.precio_min) / (prod.precio_max - prod.precio_min + 1)) * 100)}%`
                                  }}
                                />
                              </div>
                              <span className="text-xs font-bold text-slate-300 text-right w-20">
                                {formatCurrency(b.precio_promedio)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Savings callout */}
            <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-5 mb-8">
              <div className="flex items-start gap-3">
                <TrendingDownIcon className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-200 mb-1">¿Cuánto podés ahorrar?</p>
                  <p className="text-slate-400 text-sm">
                    En {displayNombre} la diferencia entre la estación más cara y la más barata
                    puede ser de hasta{' '}
                    <strong className="text-emerald-400">
                      {formatCurrency(Math.max(...stats.productos.map(p => p.precio_max - p.precio_min)))}
                    </strong>{' '}
                    por litro. En un tanque lleno eso son varios miles de pesos.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* CTA */}
        <div className="text-center space-y-3">
          <Link
            to={`/?provincia=${encodeURIComponent(provincia)}`}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <MapPinIcon className="w-4 h-4" />
            Ver estaciones en {displayNombre}
          </Link>
          <p className="text-slate-600 text-xs">
            Comparé precios en tiempo real y encontrá la más barata cerca tuyo
          </p>
        </div>
      </main>
    </div>
  );
}
