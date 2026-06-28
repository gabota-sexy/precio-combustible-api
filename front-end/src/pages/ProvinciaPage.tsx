import { useScrollTracking } from '../hooks/useScrollTracking';
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FuelIcon, MapPinIcon, ChevronLeftIcon,
  TrendingDownIcon, BarChart2Icon, HelpCircleIcon,
  ChevronDownIcon, ChevronRightIcon, NavigationIcon,
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

// Provincias vecinas para linking interno
const PROVINCIAS_VECINAS: Record<string, string[]> = {
  'buenos-aires':                    ['santa-fe', 'entre-rios', 'cordoba', 'la-pampa', 'rio-negro'],
  'ciudad-autonoma-de-buenos-aires': ['buenos-aires'],
  'cordoba':                         ['santa-fe', 'buenos-aires', 'san-luis', 'la-rioja', 'catamarca', 'santiago-del-estero'],
  'santa-fe':                        ['buenos-aires', 'cordoba', 'entre-rios', 'chaco'],
  'mendoza':                         ['san-juan', 'san-luis', 'neuquen', 'la-pampa'],
  'tucuman':                         ['salta', 'catamarca', 'santiago-del-estero'],
  'salta':                           ['jujuy', 'tucuman', 'chaco', 'formosa'],
  'entre-rios':                      ['santa-fe', 'buenos-aires', 'corrientes'],
  'corrientes':                      ['chaco', 'entre-rios', 'misiones'],
  'misiones':                        ['corrientes'],
  'chaco':                           ['salta', 'formosa', 'santiago-del-estero', 'santa-fe', 'corrientes'],
  'formosa':                         ['salta', 'chaco'],
  'santiago-del-estero':             ['salta', 'tucuman', 'catamarca', 'la-rioja', 'cordoba', 'chaco'],
  'san-juan':                        ['mendoza', 'la-rioja', 'san-luis'],
  'jujuy':                           ['salta'],
  'rio-negro':                       ['neuquen', 'chubut', 'buenos-aires', 'la-pampa'],
  'neuquen':                         ['mendoza', 'rio-negro', 'la-pampa'],
  'la-pampa':                        ['buenos-aires', 'mendoza', 'san-luis', 'cordoba', 'neuquen', 'rio-negro'],
  'chubut':                          ['rio-negro', 'santa-cruz'],
  'san-luis':                        ['mendoza', 'cordoba', 'la-pampa', 'san-juan'],
  'catamarca':                       ['la-rioja', 'san-juan', 'tucuman', 'santiago-del-estero', 'cordoba'],
  'la-rioja':                        ['san-juan', 'catamarca', 'cordoba', 'san-luis'],
  'santa-cruz':                      ['chubut', 'tierra-del-fuego'],
  'tierra-del-fuego':                ['santa-cruz'],
};

// Nombre display para cada slug
const NOMBRES: Record<string, string> = {
  'buenos-aires': 'Buenos Aires', 'ciudad-autonoma-de-buenos-aires': 'CABA',
  'cordoba': 'Córdoba', 'santa-fe': 'Santa Fe', 'mendoza': 'Mendoza',
  'tucuman': 'Tucumán', 'salta': 'Salta', 'entre-rios': 'Entre Ríos',
  'corrientes': 'Corrientes', 'misiones': 'Misiones', 'chaco': 'Chaco',
  'formosa': 'Formosa', 'santiago-del-estero': 'Santiago del Estero',
  'san-juan': 'San Juan', 'jujuy': 'Jujuy', 'rio-negro': 'Río Negro',
  'neuquen': 'Neuquén', 'la-pampa': 'La Pampa', 'chubut': 'Chubut',
  'san-luis': 'San Luis', 'catamarca': 'Catamarca', 'la-rioja': 'La Rioja',
  'santa-cruz': 'Santa Cruz', 'tierra-del-fuego': 'Tierra del Fuego',
};

function getFaqItems(nombre: string, stats: ProvinciaStats | null) {
  const superProd = stats?.productos.find(p =>
    p.producto.toLowerCase().includes('super') || p.producto.toLowerCase().includes('súper'));
  const gasoilProd = stats?.productos.find(p =>
    p.producto.toLowerCase().includes('gas oil') || p.producto.toLowerCase().includes('diesel'));

  const precioSuper = superProd ? formatCurrency(superProd.precio_promedio) : 'actualizado diariamente';
  const precioMin   = superProd ? formatCurrency(superProd.precio_min) : 'varía según la estación';
  const topBandera  = superProd?.por_bandera?.[0]?.bandera || 'YPF';
  const cantEst     = stats?.productos.reduce((acc, p) => Math.max(acc, p.cantidad_estaciones), 0) || 0;

  return [
    {
      q: `¿Cuánto cuesta la nafta en ${nombre} hoy?`,
      a: `El precio promedio de nafta Súper en ${nombre} es de ${precioSuper} por litro. El precio más bajo disponible es ${precioMin}. Los precios se actualizan diariamente en Tankear con datos de todas las estaciones de servicio.`,
    },
    {
      q: `¿Dónde hay nafta más barata en ${nombre}?`,
      a: `Para encontrar la nafta más barata en ${nombre} podés usar Tankear, que compara precios en tiempo real en más de ${cantEst > 0 ? cantEst : 'cientos de'} estaciones de la provincia. La diferencia entre la estación más cara y la más barata puede ser significativa — vale la pena comparar antes de cargar.`,
    },
    {
      q: `¿Qué marcas de nafta hay en ${nombre}?`,
      a: `En ${nombre} encontrás estaciones de servicio de las principales marcas: YPF, Shell, Axion Energy, Puma Energy, Gulf y otras banderas locales. La marca con mayor presencia suele ser ${topBandera}. En Tankear podés filtrar por marca y ver cuál ofrece el mejor precio en tu zona.`,
    },
    ...(gasoilProd ? [{
      q: `¿Cuánto cuesta el gasoil en ${nombre}?`,
      a: `El precio promedio del gasoil en ${nombre} es de ${formatCurrency(gasoilProd.precio_promedio)} por litro, con un mínimo de ${formatCurrency(gasoilProd.precio_min)}. Tankear muestra precios actualizados para todos los tipos de combustible diesel disponibles en la provincia.`,
    }] : []),
    {
      q: `¿Cómo comparo precios de combustible en ${nombre}?`,
      a: `Entrá a Tankear, seleccioná ${nombre} como provincia o activá tu ubicación GPS, y el mapa te va a mostrar todas las estaciones cercanas ordenadas por precio. Podés filtrar por tipo de combustible (Súper, Premium, Gasoil) y por marca. Es gratis y sin registro.`,
    },
  ];
}

function MetaUpdater({ nombre, slug, stats }: { nombre: string; slug: string; stats: ProvinciaStats | null }) {
  useEffect(() => {
    const canonical = `https://tankear.com.ar/precios/${slug}`;
    const title     = `Precio de nafta en ${nombre} hoy | Tankear`;
    const desc      = `Precios actualizados de nafta Súper, Premium y Gasoil en ${nombre}. Compará YPF, Shell, Axion, Puma y más. Encontrá la estación más barata cerca tuyo.`;

    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);

    let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalEl) { canonicalEl = document.createElement('link'); canonicalEl.setAttribute('rel','canonical'); document.head.appendChild(canonicalEl); }
    canonicalEl.setAttribute('href', canonical);

    setMeta('og:title', title); setMeta('og:description', desc); setMeta('og:url', canonical);
    setMeta('twitter:title', title); setMeta('twitter:description', desc);

    // JSON-LD WebPage + BreadcrumbList
    const superProd = stats?.productos.find(p => p.producto.toLowerCase().includes('super') || p.producto.toLowerCase().includes('súper'));
    const faqItems  = getFaqItems(nombre, stats);

    const jsonLdList = [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: 'https://tankear.com.ar/' },
          { '@type': 'ListItem', position: 2, name: `Precios en ${nombre}`, item: canonical },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      ...(superProd ? [{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description: desc,
        url: canonical,
        mainEntity: {
          '@type': 'ItemList',
          name: `Precios de combustible en ${nombre}`,
          itemListElement: stats!.productos.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: p.producto,
            description: `Precio promedio: $${p.precio_promedio.toFixed(2)} – Mínimo: $${p.precio_min.toFixed(2)} – Máximo: $${p.precio_max.toFixed(2)}`,
          })),
        },
      }] : []),
    ];

    jsonLdList.forEach((ld, i) => {
      const id = `jsonld-provincia-${i}`;
      let el = document.getElementById(id) as HTMLScriptElement | null;
      if (!el) { el = document.createElement('script'); el.id = id; el.type = 'application/ld+json'; document.head.appendChild(el); }
      el.textContent = JSON.stringify(ld);
    });

    return () => {
      document.title = 'Tankear — Precios de combustible en Argentina';
      [0,1,2].forEach(i => document.getElementById(`jsonld-provincia-${i}`)?.remove());
    };
  }, [nombre, slug, stats]);
  return null;
}

function setMeta(prop: string, content: string) {
  const attr = prop.startsWith('og:') ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, prop); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

const PRODUCT_COLORS: Record<string, string> = {
  super: 'text-blue-400', premium: 'text-purple-400', gasoil: 'text-amber-400', gnc: 'text-emerald-400',
};
function getProductColor(producto: string): string {
  const l = producto.toLowerCase();
  if (l.includes('gnc')) return PRODUCT_COLORS.gnc;
  if (l.includes('gas oil') || l.includes('diesel')) return PRODUCT_COLORS.gasoil;
  if (l.includes('más de 95') || l.includes('premium')) return PRODUCT_COLORS.premium;
  return PRODUCT_COLORS.super;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className="text-sm font-medium text-slate-200">{q}</span>
        {open ? <ChevronDownIcon className="w-4 h-4 text-amber-500 flex-shrink-0" /> : <ChevronRightIcon className="w-4 h-4 text-slate-500 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-slate-400 leading-relaxed border-t border-slate-800">
          {a}
        </div>
      )}
    </div>
  );
}

export function ProvinciaPage() {
  useScrollTracking('provincia');
  const { provincia: slug } = useParams<{ provincia: string }>();
  const nombre   = NOMBRES[slug || ''] || slugToProvincia(slug || '');
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
          producto: p.producto, precio_min: p.precio_min, precio_max: p.precio_max,
          precio_promedio: p.precio_promedio,
          cantidad_estaciones: p.count_estaciones ?? p.cantidad_estaciones ?? 0,
          por_bandera: p.por_bandera || [],
        })),
        ultima_actualizacion: data.ultima_actualizacion,
      }))
      .catch(() => setError('No pudimos cargar las estadísticas.'))
      .finally(() => setLoading(false));
  }, [provincia]);

  const vecinas = (PROVINCIAS_VECINAS[slug || ''] || []).slice(0, 4);
  const faqItems = getFaqItems(nombre, stats);
  const maxDiff = stats ? Math.max(...stats.productos.map(p => p.precio_max - p.precio_min)) : 0;

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <MetaUpdater nombre={nombre} slug={slug || ''} stats={stats} />

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

        {/* Breadcrumb visible */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-5">
          <Link to="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
          <ChevronRightIcon className="w-3 h-3" />
          <span className="text-slate-300">Precios en {nombre}</span>
        </nav>

        {/* Page title */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <MapPinIcon className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              Precios de combustible en {nombre}
            </h1>
            <p className="text-slate-500 text-sm">
              Estadísticas actualizadas de todas las estaciones de servicio
            </p>
          </div>
        </div>

        {/* Última actualización */}
        {stats?.ultima_actualizacion && (
          <p className="text-xs text-slate-600 mb-6 pl-13">
            Actualizado: {new Date(stats.ultima_actualizacion).toLocaleDateString('es-AR', { day:'numeric', month:'long', year:'numeric' })}
          </p>
        )}

        {error && <p className="text-slate-500 text-sm text-center py-10">{error}</p>}

        {stats && stats.productos.length > 0 && (
          <>
            {/* Product cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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
                                <div className="h-full bg-amber-500/50 rounded-full"
                                  style={{ width: `${Math.min(100, ((b.precio_promedio - prod.precio_min) / (prod.precio_max - prod.precio_min + 1)) * 100)}%` }} />
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
            {maxDiff > 0 && (
              <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-5 mb-8">
                <div className="flex items-start gap-3">
                  <TrendingDownIcon className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-200 mb-1">¿Cuánto podés ahorrar?</p>
                    <p className="text-slate-400 text-sm">
                      En {nombre} la diferencia entre la estación más cara y la más barata puede ser de hasta{' '}
                      <strong className="text-emerald-400">{formatCurrency(maxDiff)}</strong>{' '}
                      por litro. En un tanque de 50 litros eso son{' '}
                      <strong className="text-emerald-400">{formatCurrency(maxDiff * 50)}</strong> de ahorro.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* CTA principal */}
        <div className="text-center mb-10">
          <Link
            to={`/?provincia=${encodeURIComponent(provincia)}`}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <NavigationIcon className="w-4 h-4" />
            Ver estaciones cerca tuyo en {nombre}
          </Link>
          <p className="text-slate-600 text-xs mt-2">
            Mapa en tiempo real · Gratis y sin registro
          </p>
        </div>

        {/* FAQ */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <HelpCircleIcon className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-semibold text-slate-200">
              Preguntas frecuentes sobre combustible en {nombre}
            </h2>
          </div>
          <div className="space-y-2">
            {faqItems.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* Provincias vecinas */}
        {vecinas.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Precios en provincias cercanas
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {vecinas.map(v => (
                <Link
                  key={v}
                  to={`/precios/${v}`}
                  className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-amber-500/40 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:text-amber-400 transition-all"
                >
                  <MapPinIcon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                  {NOMBRES[v] || v}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Footer interno con links a todas las provincias */}
        <section className="border-t border-slate-800 pt-6">
          <p className="text-xs text-slate-600 mb-3 uppercase tracking-wide">Precios en todas las provincias</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(NOMBRES).map(([s, n]) => (
              s !== slug ? (
                <Link
                  key={s}
                  to={`/precios/${s}`}
                  className="text-xs text-slate-500 hover:text-amber-400 transition-colors"
                >
                  {n}
                </Link>
              ) : (
                <span key={s} className="text-xs text-amber-500 font-medium">{n}</span>
              )
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
