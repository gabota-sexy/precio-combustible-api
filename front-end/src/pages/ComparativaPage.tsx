import React, { useEffect, useMemo, useState } from 'react';
import { useSEO } from '../hooks/useSEO';
import { Header } from '../components/Header';
import { QuickNav } from '../components/QuickNav';
import { PriceChart } from '../components/PriceChart';
import { StatsSection } from '../components/StatsSection';
import { FilterBar } from '../components/FilterBar';
import { AdSidebar } from '../components/AdSidebar';
import { OnboardingModal } from '../components/OnboardingModal';
import { LoginModal } from '../components/LoginModal';
import { useFuelData } from '../hooks/useFuelData';
import { useUser } from '../hooks/useUser';
import { filterFresh } from '../utils/stale';
import { Footer } from '../components/Footer';
import { BarChart2Icon } from 'lucide-react';
import { trackComparativaVista } from '../utils/analytics';

export function ComparativaPage() {
  useSEO({
    title:       'Comparativa de precios de nafta en Argentina — YPF, Shell, Axion y más',
    description: 'Compará precios de nafta Super 92, Infinia, Premium y gasoil entre YPF, Shell, Axion, Puma y más en Argentina. Histórico actualizado diariamente.',
    canonical:   'https://tankear.com.ar/comparativa',
  });
  const { user, logout } = useUser();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loginOpen,      setLoginOpen]      = useState(false);

  const { data, loading, ubicacion, filters, search } = useFuelData({
    provincia:   '',
    localidad:   '',
    barrio:      '',
    empresa:     '',
    producto:    '',
    fecha_desde: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const freshData = useMemo(() => filterFresh(data), [data]);

  // Analytics: fire once when data loads
  useEffect(() => {
    if (!loading && data.length > 0) {
      const provincias  = [...new Set(data.map(d => d.provincia).filter(Boolean))] as string[];
      const banderas    = [...new Set(data.map(d => d.empresa).filter(Boolean))]   as string[];
      trackComparativaVista({
        provincias,
        producto: filters.producto || 'todos',
        banderas,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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

          {/* ── Contenido principal ── */}
          <div className="flex-1 min-w-0">

            {/* Heading */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                <BarChart2Icon className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100">Comparativa de Precios</h1>
                <p className="text-xs text-slate-500 mt-0.5">Precios promedio por empresa y evolución histórica</p>
              </div>
            </div>

            {/* Filtros */}
            <FilterBar filters={filters} onSearch={search} availableData={data} loading={loading} />

            {/* Spinner */}
            {loading && freshData.length === 0 && (
              <div className="flex items-center justify-center py-20">
                <div className="w-10 h-10 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
              </div>
            )}

            {(!loading || freshData.length > 0) && (
              <>
                <section className="mb-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-xs text-slate-600 font-medium uppercase tracking-wider px-2">Comparativa por Empresa</span>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>
                  <PriceChart data={freshData} />
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-xs text-slate-600 font-medium uppercase tracking-wider px-2">Evolución Histórica</span>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>
                  <StatsSection filters={filters} ubicacion={ubicacion} />
                </section>
              </>
            )}
          </div>

          {/* ── Sidebar derecho ── */}
          <div className="hidden xl:block w-72 flex-shrink-0">
            <div className="sticky top-20">
              <AdSidebar />
            </div>
          </div>

        </div>
        <Footer />
      </main>
    </div>
  );
}
