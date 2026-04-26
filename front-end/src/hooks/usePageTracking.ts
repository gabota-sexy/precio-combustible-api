import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../utils/analytics';

// Mapeo de rutas a títulos legibles para GA4
const ROUTE_TITLES: Record<string, string> = {
  '/':           'Inicio — Buscador',
  '/comparativa':'Comparativa de Precios',
  '/viaje':      'Armá tu Viaje',
  '/cotizador':  'Cotizador de Seguros',
  '/noticias':   'Noticias de Combustible',
  '/dolar':      'Calculadora Dólar Nafta',
  '/vuelos':     'Vuelos',
  '/verificar':  'Verificar Precio',
};

function resolveTitle(pathname: string): string {
  // Exacta
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];

  // /precios/:provincia
  const provMatch = pathname.match(/^\/precios\/(.+)$/);
  if (provMatch) {
    const slug = provMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `Precios en ${slug}`;
  }

  // /estacion/:slug
  const estMatch = pathname.match(/^\/estacion\/(.+)$/);
  if (estMatch) return 'Detalle Estación';

  return 'Tankear';
}

/**
 * Dispara un evento page_view en cada cambio de ruta.
 * Usar una sola vez en App.tsx dentro de <BrowserRouter>.
 */
export function usePageTracking() {
  const location = useLocation();
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    const { pathname, search } = location;
    const fullPath = pathname + search;

    // Evitar duplicados si React StrictMode doble-monta
    if (fullPath === prevPath.current) return;
    prevPath.current = fullPath;

    const title = resolveTitle(pathname);
    trackPageView(fullPath, title);
  }, [location]);
}
