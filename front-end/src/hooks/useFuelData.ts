import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Station,
  FilterState,
  FuelDataState,
  UbicacionResuelta } from
'../types';
import {
  fetchSmartData,
  fetchFuelData,
  SmartResult,
  FetchResult,
  clearCache } from
'../utils/api';
import { useGeolocation } from './useGeolocation';

interface UseFuelDataReturn extends FuelDataState {
  filters: FilterState;
  updateFilters: (newFilters: Partial<FilterState>) => void;
  search: (newFilters: FilterState) => void;
  refresh: () => void;
  userLocation: ReturnType<typeof useGeolocation>;
  totalRecords: number;
  source: string;
  ubicacion: UbicacionResuelta | null;
  needsLocation: boolean;
}

export function useFuelData(initialFilters: FilterState): UseFuelDataReturn {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [totalRecords, setTotalRecords] = useState(0);
  const [source, setSource] = useState<string>('');
  const [ubicacion, setUbicacion] = useState<UbicacionResuelta | null>(null);
  const [state, setState] = useState<FuelDataState>({
    data: [],
    loading: true,
    error: null,
    isUsingFallback: false
  });
  const [needsLocation, setNeedsLocation] = useState(false);

  const location = useGeolocation();
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  // Prevents re-auto-filling provincia/localidad after user has explicitly searched
  const userHasSearchedRef = useRef(false);

  const loadData = useCallback(
    async (
    currentFilters: FilterState,
    gpsLat?: number | null,
    gpsLon?: number | null) =>
    {
      // "Latest wins" — each call gets an ID, only the latest updates state
      const thisRequestId = ++requestIdRef.current;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        // Primary: use /precios/smart — it handles GPS, IP, and fallback cascading
        // IMPORTANT: Only send lat/lon if explicitly provided (not when using provincia/localidad)
        const hasManualLocation =
        currentFilters.provincia && currentFilters.localidad;
        const smartResult: SmartResult = await fetchSmartData({
          lat: hasManualLocation ? undefined : gpsLat ?? location.lat,
          lon: hasManualLocation ? undefined : gpsLon ?? location.lon,
          provincia: currentFilters.provincia || undefined,
          localidad: currentFilters.localidad || undefined,
          barrio: currentFilters.barrio || undefined,
          producto: currentFilters.producto || undefined,
          fecha_desde: currentFilters.fecha_desde || undefined,
          radio_km: 15,
          limit: 500
        });

        // Discard if a newer request was fired while this one was in flight
        if (!mountedRef.current || thisRequestId !== requestIdRef.current)
        return;

        let data = smartResult.data;

        // Client-side filters
        if (currentFilters.empresa) {
          data = data.filter((s) =>
            s.empresa.toUpperCase().includes(currentFilters.empresa.toUpperCase())
          );
        }
        // Banderas filter (chip-based)
        if (currentFilters.banderas?.length) {
          data = data.filter((s) =>
            currentFilters.banderas.some(b =>
              (s.empresa || '').toUpperCase().includes(b) ||
              (s.bandera  || '').toUpperCase().includes(b)
            )
          );
        }
        // Solo con precio filter
        if (currentFilters.solo_con_precio) {
          data = data.filter((s) => s.precio != null);
        }

        // Sort
        const orden = currentFilters.orden ?? 'precio';
        const sorted = [...data].sort((a, b) => {
          if (orden === 'distancia') {
            const ad = (a as any).distancia_km ?? a.distancia ?? Infinity;
            const bd = (b as any).distancia_km ?? b.distancia ?? Infinity;
            return ad - bd;
          }
          if (orden === 'reciente') {
            const af = a.fecha_vigencia ? new Date(a.fecha_vigencia).getTime() : 0;
            const bf = b.fecha_vigencia ? new Date(b.fecha_vigencia).getTime() : 0;
            return bf - af;
          }
          // precio (default) — sin precio va al fondo
          const ap = (a.precio ?? Infinity) as number;
          const bp = (b.precio ?? Infinity) as number;
          if (ap !== bp) return ap - bp;
          // desempate: distancia
          const ad = (a as any).distancia_km ?? a.distancia ?? Infinity;
          const bd = (b as any).distancia_km ?? b.distancia ?? Infinity;
          return ad - bd;
        });

        setState({
          data: sorted,
          loading: false,
          error: smartResult.error || null,
          isUsingFallback: smartResult.isFallback
        });
        setTotalRecords(smartResult.total);
        setSource(smartResult.source);
        setUbicacion(smartResult.ubicacion);

        // Auto-fill provincia/localidad/barrio desde ubicacion detectada
        // Solo en la primera carga (no cuando el usuario ya buscó explícitamente)
        if (smartResult.ubicacion && !currentFilters.provincia && !userHasSearchedRef.current) {
          const ub = smartResult.ubicacion;

          console.log('[useFuelData] ubicacion raw:', JSON.stringify(ub));

          const rawProv = (typeof ub.provincia === 'string' ? ub.provincia : '') || '';

          // localidad: preferir detectada > dataset > localidad genérica
          // Nominatim devuelve la localidad real del usuario (ej: MARTINEZ),
          // mientras que dataset puede ser el vecino más cercano en la BD (ej: SAN ISIDRO).
          const rawLoc =
            (typeof ub.localidad_detectada === 'string' && ub.localidad_detectada ? ub.localidad_detectada : '') ||
            (typeof ub.localidad_dataset === 'string' && ub.localidad_dataset ? ub.localidad_dataset : '') ||
            (typeof ub.localidad === 'string' && ub.localidad ? ub.localidad : '');

          console.log('[useFuelData] auto-fill → prov:', rawProv, 'loc:', rawLoc);

          // CABA puede venir como 'CAPITAL FEDERAL' o 'CIUDAD AUTÓNOMA DE BUENOS AIRES'
          const isCaba =
            rawProv.toUpperCase().includes('CAPITAL FEDERAL') ||
            rawProv.toUpperCase().includes('CIUDAD AUTÓNOMA') ||
            rawProv.toUpperCase() === 'CABA';

          const provFinal = isCaba ? 'CAPITAL FEDERAL' : rawProv.toUpperCase();
          const locFinal  = isCaba ? 'CAPITAL FEDERAL' : rawLoc.toUpperCase();

          if (provFinal) {
            setFilters((prev) => ({
              ...prev,
              provincia: provFinal,
              localidad: locFinal  || prev.localidad,
              barrio:    prev.barrio,
            }));
          }
        }
      } catch (err: any) {
        if (!mountedRef.current || thisRequestId !== requestIdRef.current)
        return;
        if (err.name === 'AbortError') return;

        setState((prev) => ({
          ...prev,
          loading: false,
          error: err.message || 'Error desconocido al cargar datos'
        }));
      }
    },
    [location.lat, location.lon]
  );

  // Initial load — wait for GPS, then load
  const initialLoadDone = useRef(false);
  const gpsLoadedRef = useRef(false);

  useEffect(() => {
    // GPS arrived
    if (location.lat !== null && location.lon !== null) {
      setNeedsLocation(false);
      if (!initialLoadDone.current) {
        // First load with GPS
        initialLoadDone.current = true;
        gpsLoadedRef.current = true;
        console.log(
          '[useFuelData] Initial load WITH GPS:',
          location.lat,
          location.lon
        );
        loadData(filters, location.lat, location.lon);
      } else if (!gpsLoadedRef.current) {
        // GPS arrived after showing location prompt — load now with GPS
        gpsLoadedRef.current = true;
        const hasManualLocation =
        filters.provincia && filters.provincia.trim() !== '';
        if (!hasManualLocation) {
          console.log(
            '[useFuelData] GPS arrived late — loading with coordinates'
          );
          loadData(filters, location.lat, location.lon);
        }
      }
    }
  }, [location.lat, location.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for GPS permission denied / error → let backend detect via IP (no CABA hardcode)
  useEffect(() => {
    if (location.error && !location.loading && !initialLoadDone.current) {
      initialLoadDone.current = true;
      console.log('[useFuelData] GPS error:', location.error, '— letting backend detect via IP');
      // Don't send provincia/localidad — backend will use ip-api.com to detect location
      loadData(filters, null, null);
    }
  }, [location.error, location.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: if GPS doesn't arrive in 5s, let backend detect via IP
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        console.log('[useFuelData] GPS timeout (5s) — letting backend detect via IP');
        loadData(filters, null, null);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateFilters = (newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const search = (newFilters: FilterState) => {
    console.log('[useFuelData] SEARCH called with filters:', newFilters);
    // Mark that the user has explicitly searched — prevents ubicacion auto-fill from overriding
    userHasSearchedRef.current = true;
    // Clear cache to force fresh API call
    clearCache();
    setNeedsLocation(false);
    setFilters(newFilters);

    // If user selected provincia/localidad, DON'T send GPS (let backend use location filters)
    // Check for both empty string and null/undefined
    const hasProvincia =
    newFilters.provincia && newFilters.provincia.trim() !== '';
    const hasLocalidad =
    newFilters.localidad && newFilters.localidad.trim() !== '';
    const useGPS = !hasProvincia && !hasLocalidad;
    const lat = useGPS ? location.lat : null;
    const lon = useGPS ? location.lon : null;

    console.log(
      '[useFuelData] Has provincia:',
      hasProvincia,
      'Has localidad:',
      hasLocalidad
    );
    console.log('[useFuelData] Using GPS:', useGPS, 'lat:', lat, 'lon:', lon);
    loadData(newFilters, lat, lon);
  };

  const refresh = () => {
    console.log('[useFuelData] REFRESH called');
    loadData(filters, location.lat, location.lon);
  };

  return {
    ...state,
    filters,
    updateFilters,
    search,
    refresh,
    userLocation: location,
    totalRecords,
    source,
    ubicacion,
    needsLocation
  };
}