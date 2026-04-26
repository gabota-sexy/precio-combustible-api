import React, { useEffect, useState } from 'react';
import { Percent, Clock, AlertCircle, RefreshCw } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface Promo {
  banco: string;
  marca: string;
  pct: string;
  tope: string;
  dia: string;
  vigencia: string;
}

interface PromosData {
  promos: Promo[];
  total: number;
  scraped_at: string | null;
  fuente: string;
}

const BANCO_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  'Mercado Pago':  { bg: 'bg-sky-50',    border: 'border-sky-300',    badge: 'bg-sky-500 text-white' },
  'Shell Box':     { bg: 'bg-red-50',    border: 'border-red-300',    badge: 'bg-red-600 text-white' },
  'Axion ON':      { bg: 'bg-orange-50', border: 'border-orange-300', badge: 'bg-orange-500 text-white' },
  'MODO':          { bg: 'bg-violet-50', border: 'border-violet-300', badge: 'bg-violet-600 text-white' },
  'Banco Nación':  { bg: 'bg-blue-50',   border: 'border-blue-300',   badge: 'bg-blue-700 text-white' },
  'YPF ServiClub': { bg: 'bg-yellow-50', border: 'border-yellow-300', badge: 'bg-yellow-500 text-black' },
  'Credicoop':     { bg: 'bg-teal-50',   border: 'border-teal-300',   badge: 'bg-teal-600 text-white' },
  'Comafi':        { bg: 'bg-green-50',  border: 'border-green-300',  badge: 'bg-green-600 text-white' },
  'Galicia':       { bg: 'bg-red-50',    border: 'border-red-300',    badge: 'bg-red-700 text-white' },
  'BBVA':          { bg: 'bg-blue-50',   border: 'border-blue-300',   badge: 'bg-blue-600 text-white' },
};
const DEFAULT_COLOR = { bg: 'bg-gray-50', border: 'border-gray-300', badge: 'bg-gray-600 text-white' };

const MARCA_EMOJI: Record<string, string> = {
  'YPF':'🔵','Shell':'🔴','Axion':'🟠','Puma':'🟣','Gulf':'🟡','Todas':'⛽',
};

function formatScrapedAt(dt: string | null): string {
  if (!dt) return '';
  try {
    const d = new Date(dt + 'Z');
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dt.split('T')[0]; }
}

function PromoCard({ promo }: { promo: Promo }) {
  const color = BANCO_COLORS[promo.banco] || DEFAULT_COLOR;
  const emoji = MARCA_EMOJI[promo.marca] || '⛽';
  return (
    <div className={`relative rounded-2xl border-2 ${color.border} ${color.bg} p-4 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-3xl font-extrabold text-gray-800 leading-none">{promo.pct}</span>
          <span className="ml-1 text-sm text-gray-500 font-medium">reintegro</span>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${color.badge}`}>{promo.banco}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm text-gray-600">
        {promo.dia && (
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="shrink-0 text-gray-400" />
            <span>{promo.dia}</span>
          </div>
        )}
        {promo.tope && (
          <div className="flex items-center gap-1.5">
            <Percent size={13} className="shrink-0 text-gray-400" />
            <span>Tope: <strong className="text-gray-700">{promo.tope}</strong></span>
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-base leading-none">{emoji}</span>
          <span className="font-medium text-gray-700">{promo.marca === 'Todas' ? 'Todas las estaciones' : promo.marca}</span>
        </div>
      </div>
    </div>
  );
}

export default function PromosSection() {
  const [data, setData]       = useState<PromosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const cargar = async () => {
    setLoading(true); setError(false);
    try {
      const r = await fetch(`${API_BASE}/promos`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      console.error('[PromosSection]', e);
      setError(true);
    } finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  if (loading) {
    return (
      <section className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-2xl">⛽</span>
            <h2 className="text-xl font-bold text-gray-800">Promos de combustible</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(8)].map((_,i) => <div key={i} className="rounded-2xl bg-gray-100 animate-pulse h-28" />)}
          </div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <AlertCircle size={18} />
            <span className="text-sm">No se pudieron cargar las promos. Intentá más tarde.</span>
            <button onClick={cargar} className="ml-auto flex items-center gap-1 text-xs underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛽</span>
            <div>
              <h2 className="text-xl font-bold text-gray-800 leading-tight">Promos de combustible</h2>
              {data.scraped_at && (
                <p className="text-xs text-gray-400 mt-0.5">Actualizado: {formatScrapedAt(data.scraped_at)}</p>
              )}
            </div>
          </div>
          <button onClick={cargar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          💡 Los reintegros se acreditan en tu cuenta o billetera. Verificá condiciones en cada app o banco. Promos sujetas a cambios.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.promos.map((p,i) => <PromoCard key={i} promo={p} />)}
        </div>
        <p className="text-xs text-gray-400 mt-4 text-center">
          Promos actualizadas automáticamente cada 15 días
        </p>
      </div>
    </section>
  );
}
