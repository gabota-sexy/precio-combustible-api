import { trackGaragePestana } from '../../utils/analytics';
import React, { useEffect, useState } from 'react';
import { XIcon, CarIcon, BookOpenIcon, WrenchIcon, ShieldIcon, CheckIcon } from 'lucide-react';
import { useAlertas } from '../../hooks/useAlertas';
import { AutosTab }         from './tabs/AutosTab';
import { BitacoraTab }      from './tabs/BitacoraTab';
import { MantenimientoTab } from './tabs/MantenimientoTab';
import { SeguroTab }        from './tabs/SeguroTab';

type TabId = 'autos' | 'bitacora' | 'mantenimiento' | 'seguro';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'autos',         label: 'Mis Autos',      icon: <CarIcon       className="w-3.5 h-3.5" /> },
  { id: 'bitacora',      label: 'Bitácora',        icon: <BookOpenIcon  className="w-3.5 h-3.5" /> },
  { id: 'mantenimiento', label: 'Mantenimiento',   icon: <WrenchIcon    className="w-3.5 h-3.5" /> },
  { id: 'seguro',        label: 'Seguro',          icon: <ShieldIcon    className="w-3.5 h-3.5" /> },
];

interface GarageSectionProps {
  onClose:      () => void;
  initialTab?:  TabId;
}

export function GarageSection({ onClose, initialTab = 'autos' }: GarageSectionProps) {
  const [activeTab,  setActiveTab]  = useState<TabId>(initialTab);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const { totalAlertas } = useAlertas();

  // Check sessionStorage for bitacora prefill → auto-switch to that tab
  useEffect(() => {
    const prefill = sessionStorage.getItem('tankear_prefill_bitacora');
    if (prefill) setActiveTab('bitacora');
  }, []);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center sm:items-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <CarIcon className="w-4 h-4 text-amber-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Mi Garage</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar — grid equitativo, sin scrollbar */}
        <div className="grid flex-shrink-0 border-b border-slate-800" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
          {TABS.map(tab => {
            const isActive  = activeTab === tab.id;
            const showBadge = tab.id === 'mantenimiento' && totalAlertas > 0;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); trackGaragePestana(tab.id); }}
                className={`relative flex flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'text-amber-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <div className="relative">
                  {tab.icon}
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white rounded-full text-[8px] font-bold flex items-center justify-center px-0.5">
                      {totalAlertas > 9 ? '9+' : totalAlertas}
                    </span>
                  )}
                </div>
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-amber-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* Success message */}
          {successMsg && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 mb-4">
              <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
              {successMsg}
            </div>
          )}

          {activeTab === 'autos'         && <AutosTab         showSuccess={showSuccess} />}
          {activeTab === 'bitacora'      && <BitacoraTab      showSuccess={showSuccess} />}
          {activeTab === 'mantenimiento' && <MantenimientoTab showSuccess={showSuccess} />}
          {activeTab === 'seguro'        && <SeguroTab        showSuccess={showSuccess} />}
        </div>
      </div>
    </div>
  );
}
