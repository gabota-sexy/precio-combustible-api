import { trackNavClick } from '../utils/analytics';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  MapIcon, BarChart2Icon, CalculatorIcon, ShieldIcon,
  NewspaperIcon, DollarSignIcon, RouteIcon, GaugeIcon, PlaneIcon,
  FuelIcon,
} from 'lucide-react';

interface NavItem {
  id:        string;
  label:     string;
  icon:      React.ElementType;
  href:      string;
  isLink?:   boolean;
  isNew?:    boolean;
  isAnchor?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'mapa',        label: 'Mapa',           icon: MapIcon,        href: '#mapa',        isAnchor: true },
  { id: 'cotizador',   label: 'Calculadora',    icon: CalculatorIcon, href: '#cotizador',   isAnchor: true },
  { id: 'promos',      label: 'Promos ⛽',      icon: FuelIcon,       href: '/promos',      isLink: true, isNew: true },
  { id: 'viaje',       label: 'Armá tu Viaje',  icon: RouteIcon,      href: '/viaje',       isLink: true, isNew: true },
  { id: 'comparativa', label: 'Comparativa',    icon: BarChart2Icon,  href: '/comparativa', isLink: true },
  { id: 'noticias',    label: 'Noticias',       icon: NewspaperIcon,  href: '/noticias',    isLink: true },
  { id: 'dolar',       label: 'Dólar',          icon: DollarSignIcon, href: '/dolar',       isLink: true },
  { id: 'seguros',     label: 'Seguros',        icon: ShieldIcon,     href: '/cotizador',   isLink: true },
  { id: 'vuelos',      label: 'Vuelos ✈',      icon: PlaneIcon,      href: '/vuelos',       isLink: true },
  { id: 'surtidores',  label: 'Surtidores',     icon: FuelIcon,       href: '/surtidores',  isLink: true },
];

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface QuickNavProps {}

const VIAJE_BADGE_KEY = 'viaje_badge_count';
const VIAJE_BADGE_MAX = 3;

function getViajeBadgeVisible(): boolean {
  try {
    const count = parseInt(localStorage.getItem(VIAJE_BADGE_KEY) || '0', 10);
    return count < VIAJE_BADGE_MAX;
  } catch {
    return true;
  }
}

function incrementViajeBadge() {
  try {
    const count = parseInt(localStorage.getItem(VIAJE_BADGE_KEY) || '0', 10);
    localStorage.setItem(VIAJE_BADGE_KEY, String(count + 1));
  } catch {
    // ignore
  }
}

export function QuickNav(_props: QuickNavProps) {
  const { pathname }            = useLocation();
  const [activeId, setActiveId] = useState<string>('mapa');
  const [viajeBadgeVisible, setViajeBadgeVisible] = useState<boolean>(() => getViajeBadgeVisible());
  const navRef                  = useRef<HTMLElement>(null);
  const activeRef               = useRef<HTMLButtonElement | null>(null);

  // Scroll-spy via IntersectionObserver (only for anchor items)
  useEffect(() => {
    const anchorItems = NAV_ITEMS.filter(n => n.isAnchor);
    const targets = anchorItems
      .map(n => document.getElementById(n.id))
      .filter(Boolean) as HTMLElement[];

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-28% 0px -60% 0px', threshold: 0 },
    );

    targets.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Keep active item in view on mobile
  useEffect(() => {
    const nav  = navRef.current;
    const pill = activeRef.current;
    if (!nav || !pill) return;
    const navLeft   = nav.scrollLeft;
    const navRight  = navLeft + nav.clientWidth;
    const pillLeft  = pill.offsetLeft;
    const pillRight = pillLeft + pill.offsetWidth;
    if (pillLeft < navLeft + 16)          nav.scrollTo({ left: pillLeft  - 16,               behavior: 'smooth' });
    else if (pillRight > navRight - 16)   nav.scrollTo({ left: pillRight - nav.clientWidth + 16, behavior: 'smooth' });
  }, [activeId, pathname]);

  function handleAnchorClick(e: React.MouseEvent, id: string) {
    e.preventDefault();
    trackNavClick(id, 'anchor');
    const el = document.getElementById(id);
    if (el) {
      // Offset for sticky Header (64px) + QuickNav (44px) + breathing room
      const OFFSET = 64 + 44 + 8;
      const top = el.getBoundingClientRect().top + window.scrollY - OFFSET;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    setActiveId(id);
  }

  return (
    <nav
      ref={navRef}
      className="sticky top-16 z-40 w-full bg-slate-900/95 backdrop-blur-sm border-b border-slate-800"
      aria-label="Navegación rápida"
    >
      <style>{`
        @keyframes quicknav-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.1); }
        }
      `}</style>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="flex items-center gap-0.5 h-11 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon, href, isLink, isNew, isAnchor }) => {
            // Page link
            if (isLink) {
              const isActive = pathname === href;
              return (
                <Link
                  key={id}
                  to={href}
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
                    trackNavClick(id, 'link');
                    if (id === 'viaje' && viajeBadgeVisible) {
                      incrementViajeBadge();
                      setViajeBadgeVisible(getViajeBadgeVisible());
                    }
                  }}
                  className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors select-none ${
                    isActive
                      ? 'text-amber-400 bg-amber-500/10'
                      : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {label}
                  {isNew && (id !== 'viaje' || viajeBadgeVisible) && (
                    <span
                      className="ml-0.5 px-1 py-px text-[8px] font-bold uppercase tracking-wide rounded-full leading-none"
                      style={id === 'viaje' ? {
                        background: 'linear-gradient(135deg, #f97316, #ef4444)',
                        color: 'white',
                        animation: 'quicknav-pulse 2s infinite',
                      } : {
                        background: '#f59e0b',
                        color: '#0f172a',
                      }}
                    >{id === 'viaje' ? '¡Nuevo!' : 'NEW'}</span>
                  )}
                  {isActive && <span className="absolute bottom-0 left-3 right-3 h-px bg-amber-500 rounded-full" />}
                </Link>
              );
            }

            // Anchor scroll — si no estamos en dashboard, navega a /#id
            const isActive = activeId === id;
            const onDashboard = pathname === '/' || pathname === '';
            if (!onDashboard) {
              return (
                <Link
                  key={id}
                  to={`/${href}`}
                  className="relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors select-none text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {label}
                </Link>
              );
            }
            return (
              <button
                key={id}
                ref={isActive ? (activeRef as React.RefObject<HTMLButtonElement>) : undefined}
                onClick={e => handleAnchorClick(e, id)}
                className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors select-none ${
                  isActive
                    ? 'text-amber-400 bg-amber-500/10'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {label}
                {isActive && <span className="absolute bottom-0 left-3 right-3 h-px bg-amber-500 rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
