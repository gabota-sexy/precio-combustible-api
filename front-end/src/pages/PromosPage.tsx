import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { QuickNav } from '../components/QuickNav';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { useUser } from '../hooks/useUser';
import { Percent, Clock, RefreshCw, AlertCircle, ChevronRight, Fuel, Calendar, BadgePercent, Info } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface Promo { banco: string; marca: string; pct: string; tope: string; dia: string; vigencia: string; }
interface PromosData { promos: Promo[]; total: number; scraped_at: string | null; fuente: string; }

const BANCO_COLORS: Record<string, { bg: string; border: string; badge: string; text: string }> = {
  'Mercado Pago':  { bg: 'bg-sky-950/60',    border: 'border-sky-500/50',    badge: 'bg-sky-500',    text: 'text-sky-300' },
  'Shell Box':     { bg: 'bg-red-950/60',    border: 'border-red-500/50',    badge: 'bg-red-600',    text: 'text-red-300' },
  'Axion ON':      { bg: 'bg-orange-950/60', border: 'border-orange-500/50', badge: 'bg-orange-500', text: 'text-orange-300' },
  'MODO':          { bg: 'bg-violet-950/60', border: 'border-violet-500/50', badge: 'bg-violet-600', text: 'text-violet-300' },
  'Banco Nación':  { bg: 'bg-blue-950/60',   border: 'border-blue-500/50',   badge: 'bg-blue-700',   text: 'text-blue-300' },
  'YPF ServiClub': { bg: 'bg-yellow-950/60', border: 'border-yellow-500/50', badge: 'bg-yellow-500', text: 'text-yellow-300' },
  'Credicoop':     { bg: 'bg-teal-950/60',   border: 'border-teal-500/50',   badge: 'bg-teal-600',   text: 'text-teal-300' },
  'Comafi':        { bg: 'bg-green-950/60',  border: 'border-green-500/50',  badge: 'bg-green-600',  text: 'text-green-300' },
};
const DC = { bg: 'bg-slate-800/60', border: 'border-slate-600/50', badge: 'bg-slate-600', text: 'text-slate-300' };
const ML: Record<string,string> = { 'YPF':'🔵','Shell':'🔴','Axion':'🟠','Puma':'🟣','Gulf':'🟡','Todas':'⛽' };

function fmt(dt: string|null): string {
  if (!dt) return '';
  try { return new Date(dt+'Z').toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'}); } catch { return dt.split('T')[0]; }
}

function PromoCard({ promo }: { promo: Promo }) {
  const c = BANCO_COLORS[promo.banco] || DC;
  const emoji = ML[promo.marca] || '⛽';
  const estacion = promo.marca === 'Todas' ? 'Todas las estaciones' : `Estaciones ${promo.marca}`;
  return (
    <div className={`rounded-2xl border ${c.border} ${c.bg} p-5 flex flex-col gap-3 backdrop-blur-sm hover:scale-[1.01] transition-transform`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full text-white ${c.badge}`}>{promo.banco}</span>
        <span className="text-xs text-slate-400 font-medium">{emoji} {estacion}</span>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className={`text-5xl font-black leading-none ${c.text}`}>{promo.pct}</span>
          <span className="text-slate-400 text-sm font-medium ml-1">de reintegro<br/>en combustible</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-sm border-t border-slate-700/50 pt-3">
        {promo.dia && (
          <div className="flex items-center gap-2 text-slate-300">
            <Clock size={14} className="text-slate-500 shrink-0" />
            <span>Válido los <strong className="text-white">{promo.dia}</strong></span>
          </div>
        )}
        {promo.tope && (
          <div className="flex items-center gap-2 text-slate-300">
            <BadgePercent size={14} className="text-slate-500 shrink-0" />
            <span>Tope de reintegro: <strong className="text-white">{promo.tope}</strong></span>
          </div>
        )}
        {promo.vigencia && (
          <div className="flex items-center gap-2 text-slate-300">
            <Calendar size={14} className="text-slate-500 shrink-0" />
            <span>Hasta: {promo.vigencia}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function PromosPage() {
  useSEO({
    title: 'Descuentos en nafta y combustible — Promos del mes | Tankear',
    description: 'Encontrá los mejores descuentos y reintegros en combustible para este mes en Argentina. Mercado Pago, MODO, Banco Nación, Shell Box, Axion ON y más. Actualizados cada 15 días.',
    canonical: 'https://tankear.com.ar/promos',
  });
  const { user, logout } = useUser();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [data, setData] = useState<PromosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const cargar = async () => {
    setLoading(true); setError(false);
    try {
      const r = await fetch(`${API_BASE}/promos`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { cargar(); }, []);

  const mesAño = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <Header user={user} onCreateAccount={() => setOnboardingOpen(true)} onLogin={() => setLoginOpen(true)} onLogout={logout} />
      <QuickNav />

      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-amber-500/10 rounded-xl"><Fuel size={24} className="text-amber-400" /></div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">Descuentos en combustible</h1>
              <p className="text-slate-400 text-sm mt-0.5">Promos vigentes — {mesAño}</p>
            </div>
          </div>
          <p className="text-slate-300 mt-4 max-w-2xl text-sm leading-relaxed">
            Reintegros y descuentos para cargar nafta, gasoil o GNC en Argentina.
            Se actualizan el <strong className="text-white">1° y 15 de cada mes</strong>.
            Combiná banco y día para maximizar tu ahorro.
          </p>
          {data?.scraped_at && (
            <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
              <RefreshCw size={11} />Última actualización: {fmt(data.scraped_at)}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 mt-6">
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-xs text-amber-200">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>Los reintegros se acreditan en tu cuenta o billetera después de cada carga. Verificá topes y condiciones en la app de cada banco o estación antes de cargar. Las promos pueden cambiar sin previo aviso.</span>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(8)].map((_,i) => <div key={i} className="rounded-2xl bg-slate-800/50 animate-pulse h-44" />)}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 bg-red-950/50 border border-red-800 rounded-xl p-4 text-red-300">
            <AlertCircle size={18} />
            <span className="text-sm">No se pudieron cargar las promos.</span>
            <button onClick={cargar} className="ml-auto flex items-center gap-1 text-xs underline"><RefreshCw size={12} /> Reintentar</button>
          </div>
        )}
        {!loading && !error && data && (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="text-slate-400 text-sm"><strong className="text-white">{data.total}</strong> descuentos vigentes en combustible</p>
              <button onClick={cargar} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800 transition-colors">
                <RefreshCw size={12} /> Actualizar
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.promos.map((p,i) => <PromoCard key={i} promo={p} />)}
            </div>
          </>
        )}

        <div className="mt-12 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1">
            <p className="font-bold text-white text-lg">¿Dónde está la estación más barata cerca tuyo?</p>
            <p className="text-slate-400 text-sm mt-1">Combiná los descuentos del día con los precios más bajos del mapa.</p>
          </div>
          <Link to="/" className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm px-5 py-3 rounded-xl transition-colors whitespace-nowrap">
            Ver mapa de precios <ChevronRight size={16} />
          </Link>
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-bold text-white mb-4">¿Cómo aprovechar los descuentos?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-slate-300">
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="text-2xl mb-2">1️⃣</div>
              <p className="font-semibold text-white mb-1">Elegí el día correcto</p>
              <p>La mayoría de los reintegros son solo un día por semana. Planeá tu carga para ese día.</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="text-2xl mb-2">2️⃣</div>
              <p className="font-semibold text-white mb-1">Verificá el tope</p>
              <p>Cada promo tiene un monto máximo de reintegro. Calculá cuánto te conviene cargar.</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="text-2xl mb-2">3️⃣</div>
              <p className="font-semibold text-white mb-1">Combiná descuentos</p>
              <p>Algunos bancos y apps son acumulables. Usá el mapa de Tankear para la estación más barata.</p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
