import React, { useState } from 'react';
import { useSEO } from '../hooks/useSEO';
import { Header } from '../components/Header';
import { QuickNav } from '../components/QuickNav';
import { AdSidebar } from '../components/AdSidebar';
import { MiniLeadForm, isAlreadySubscribed } from '../components/MiniLeadForm';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { useNewsData, timeAgo } from '../hooks/useNewsData';
import { useUser } from '../hooks/useUser';
import { NewspaperIcon, FlagIcon, GlobeIcon, BellIcon, RefreshCwIcon } from 'lucide-react';
import { trackNoticiaClick } from '../utils/analytics';
import { Footer } from '../components/Footer';

export function NoticiasPage() {
  useSEO({
    title:       'Noticias de combustible y energía en Argentina',
    description: 'Últimas noticias sobre precios de nafta, gasoil y GNC en Argentina. Seguí las novedades del mercado energético con Tankear.',
    canonical:   'https://tankear.com.ar/noticias',
  });
  const { user, logout } = useUser();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loginOpen,      setLoginOpen]      = useState(false);
  const [tab, setTab] = useState<'ar' | 'mundo'>('ar');

  const { articles: arArticles, loading: arLoading, error: arError, lastUpdate: arLastUpdate, refetch: arRefetch }     = useNewsData('ar');
  const { articles: mundoArticles, loading: mundoLoading, error: mundoError, lastUpdate: mundoLastUpdate, refetch: mundoRefetch } = useNewsData('mundo');

  const articles  = tab === 'ar' ? arArticles  : mundoArticles;
  const loading   = tab === 'ar' ? arLoading   : mundoLoading;
  const error     = tab === 'ar' ? arError     : mundoError;
  const lastUpdate = tab === 'ar' ? arLastUpdate : mundoLastUpdate;
  const refetch   = tab === 'ar' ? arRefetch   : mundoRefetch;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-amber-500/30">
      <Header
        user={user}
        onCreateAccount={() => setOnboardingOpen(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={logout}
      />
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onCreateAccount={() => { setLoginOpen(false); setOnboardingOpen(true); }}
      />
      <QuickNav />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
        <div className="flex-1 min-w-0">

        {/* ── Heading ── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <NewspaperIcon className="w-5 h-5 text-amber-500" />
            <h1 className="text-xl font-bold text-slate-100">Noticias de Combustible</h1>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-slate-600">
                Actualizado {timeAgo(lastUpdate.toISOString())}
              </span>
            )}
            <button
              onClick={refetch}
              className="text-slate-500 hover:text-amber-400 transition-colors"
              title="Actualizar noticias"
            >
              <RefreshCwIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-lg w-fit border border-slate-800">
          <button
            onClick={() => setTab('ar')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'ar'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FlagIcon className="w-3.5 h-3.5" />
            Argentina
          </button>
          <button
            onClick={() => setTab('mundo')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'mundo'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GlobeIcon className="w-3.5 h-3.5" />
            Internacional
          </button>
        </div>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-slate-900 rounded-xl p-4 space-y-2">
                <div className="h-2.5 bg-slate-800 rounded w-1/3" />
                <div className="h-4 bg-slate-800 rounded w-full" />
                <div className="h-4 bg-slate-800 rounded w-4/5" />
                <div className="h-3 bg-slate-800 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <p className="text-center py-12 text-slate-500">{error}</p>
        )}

        {/* ── Empty ── */}
        {!loading && !error && articles.length === 0 && (
          <p className="text-center py-12 text-slate-500">Sin noticias disponibles.</p>
        )}

        {/* ── Articles grid ── */}
        {!loading && articles.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {articles.map((art, i) => (
              <a
                key={i}
                href={art.url}
                onClick={() => trackNoticiaClick(art.fuente || art.source || 'desconocida', art.titulo || art.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-slate-900/60 border border-slate-800/60 hover:border-amber-500/30
                           rounded-xl p-4 flex flex-col gap-2 transition-all hover:bg-slate-900"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-amber-500/80 truncate">
                    {art.fuente}
                  </span>
                  {art.fecha && (
                    <>
                      <span className="text-[10px] text-slate-700">·</span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">
                        {timeAgo(art.fecha)}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-300 group-hover:text-slate-100
                              leading-snug line-clamp-3 transition-colors">
                  {art.titulo}
                </p>
                {art.descripcion && (
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                    {art.descripcion}
                  </p>
                )}
              </a>
            ))}
          </div>
        )}

        {/* ── Lead capture ── */}
        {!isAlreadySubscribed() && (
          <div className="mt-12 bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 text-center">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20
                            flex items-center justify-center mx-auto mb-3">
              <BellIcon className="w-5 h-5 text-amber-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">
              ¿Querés saber cuándo bajan los precios?
            </h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Alertas de precio en tu zona, gratis. Sin spam.
            </p>
            <div className="max-w-xs mx-auto">
              <MiniLeadForm placeholder="Email o WhatsApp" compact pagina_origen="noticias" />
            </div>
          </div>
        )}
        {isAlreadySubscribed() && (
          <p className="mt-10 text-center text-xs text-emerald-500">✓ Ya estás suscripto a las alertas</p>
        )}

        </div>{/* end flex-1 */}

        {/* ── Sidebar derecho ── */}
        <div className="hidden xl:block w-72 flex-shrink-0">
          <div className="sticky top-20">
            <AdSidebar />
          </div>
        </div>

        </div>{/* end flex gap-8 */}
        <Footer />
      </main>
    </div>
  );
}
