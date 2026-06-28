// ─────────────────────────────────────────────────────────────────────────────
// Tankear — Analytics Central
// Todos los eventos pasan por dataLayer → GTM → GA4
// Para activar: reemplazar GTM-XXXXXXX en index.html con tu Container ID real
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

function push(event: string, params: Record<string, unknown> = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────

/** Llamar en cada cambio de ruta (desde usePageTracking) */
export function trackPageView(path: string, title: string) {
  push('page_view', { page_path: path, page_title: title });
}

/** Cambio de tab/módulo dentro del Dashboard */
export function trackModuloActivado(modulo: string) {
  push('modulo_activado', { modulo });
}

// ─── BÚSQUEDA DE PRECIO ──────────────────────────────────────────────────────

export function trackBusquedaPrecio(params: {
  provincia?: string;
  localidad?: string;
  producto?: string;
  vigencia?: string;
  resultados: number;
}) {
  push('busqueda_precio', {
    provincia:  params.provincia  || 'todas',
    localidad:  params.localidad  || 'todas',
    producto:   params.producto   || 'todos',
    vigencia:   params.vigencia   || '30d',
    resultados: params.resultados,
  });
}

export function trackEstacionVista(params: {
  bandera: string;
  provincia?: string;
  precio?: number;
  fuente: 'lista' | 'mapa';
}) {
  push('estacion_vista', params);
}

export function trackZonaMasConsultada(provincia: string, localidad?: string) {
  push('zona_consultada', { provincia, localidad: localidad || 'todas' });
}

// ─── MAPA ─────────────────────────────────────────────────────────────────────

export function trackMapaGPSUsado() {
  push('mapa_gps_usado');
}

export function trackMapaMarcadorClick(bandera: string, precio?: number) {
  push('mapa_marcador_click', { bandera, precio });
}

// ─── REGISTRO / LOGIN ────────────────────────────────────────────────────────

export function trackRegistroModalAbierto(desde: string) {
  push('registro_modal_abierto', { desde });
}

export function trackRegistroInicio() {
  push('registro_inicio');
}

export function trackRegistroCompletado() {
  push('registro_completado');
}

export function trackLogin(method: 'email' | 'google' | string) {
  push('login', { method });
}

export function trackGarageAutoAgregado(marca?: string) {
  push('garage_auto_agregado', { marca: marca || 'desconocida' });
}

// ─── CONVERSIONES (monetización) ─────────────────────────────────────────────

/** Clic en el widget de seguros → lead para afiliados */
export function trackCotizacionSeguroClick(fuente: 'dashboard' | 'viaje' | 'banner' | string) {
  push('cotizacion_seguro_click', { fuente });
  // Evento de conversión GA4 — configurar como "conversion" en GA4
  push('generate_lead', { lead_source: 'seguros', fuente });
}

/** Clic en "suscribirse a Telegram" */
export function trackTelegramClick(fuente: string) {
  push('telegram_subscribe_click', { fuente });
}

/** Usuario llega a pantalla de suscripción premium */
export function trackSuscripcionVista(plan?: string) {
  push('suscripcion_vista', { plan: plan || 'premium' });
}

export function trackSuscripcionIniciada(plan: string) {
  push('suscripcion_iniciada', { plan });
  // Evento de conversión GA4
  push('begin_checkout', { items: [{ item_name: plan }] });
}

// ─── CALCULADORA ─────────────────────────────────────────────────────────────

export function trackCalculadoraUsada(params: {
  combustible: string;
  litros?: number;
  km?: number;
  precio_por_litro?: number;
}) {
  push('calculadora_usada', params);
}

// ─── COMPARATIVA ─────────────────────────────────────────────────────────────

export function trackComparativaVista(params: {
  provincias?: string[];
  producto?: string;
  banderas?: string[];
}) {
  push('comparativa_vista', {
    provincias_count: params.provincias?.length || 0,
    producto: params.producto || 'super',
    provincias: params.provincias?.join(',') || '',
  });
}

// ─── ARMÁ TU VIAJE ───────────────────────────────────────────────────────────

export function trackViajeOrigenIngresado() {
  push('viaje_origen_ingresado');
}

export function trackViajeDestinoIngresado() {
  push('viaje_destino_ingresado');
}

export function trackViajeCalculado(params: {
  distancia_km?: number;
  paradas_nafta?: number;
  costo_estimado?: number;
}) {
  push('viaje_calculado', params);
}

export function trackViajeParadaVista(bandera: string) {
  push('viaje_parada_vista', { bandera });
}

export function trackViajeCompartido() {
  push('viaje_compartido');
}

// ─── NOTICIAS ────────────────────────────────────────────────────────────────

export function trackNoticiaClick(fuente: string, titulo?: string) {
  push('noticia_click', { fuente_media: fuente, titulo: titulo?.slice(0, 80) });
}

// ─── DÓLAR ───────────────────────────────────────────────────────────────────

export function trackDolarCalculadora(tipo: 'blue' | 'oficial' | string, modo: string) {
  push('dolar_calculadora_usada', { tipo_cambio: tipo, modo });
}

// ─── RENDIMIENTO Y ERRORES ───────────────────────────────────────────────────

/** Disparar si la búsqueda tarda más de 3 segundos */
export function trackCargaLenta(pagina: string, tiempo_ms: number) {
  if (tiempo_ms > 3000) {
    push('carga_lenta', { pagina, tiempo_ms: Math.round(tiempo_ms) });
  }
}

export function trackErrorApp(mensaje: string, componente?: string) {
  push('error_app', { mensaje: mensaje.slice(0, 100), componente });
}

// ─── SCROLL DEPTH ────────────────────────────────────────────────────────────
// GTM tiene scroll tracking nativo — este helper es para casos especiales

export function trackScrollDepth(porcentaje: 25 | 50 | 75 | 90) {
  push('scroll_depth', { porcentaje });
}

// ─── COTIZADOR DE SEGUROS ────────────────────────────────────────────────────

/** Página del cotizador cargada */
export function trackCotizadorPaginaVista() {
  push('cotizador_pagina_vista');
}

/** Usuario seleccionó una marca de vehículo */
export function trackCotizadorMarcaSeleccionada(marca: string) {
  push('cotizador_marca_seleccionada', { marca });
}

/** Usuario eligió tipo de cobertura */
export function trackCotizadorCoberturaSeleccionada(cobertura: string) {
  push('cotizador_cobertura_seleccionada', { cobertura });
}

/** Usuario hizo click en "Ver mis cotizaciones" — entra al funnel de conversión */
export function trackCotizadorCotizarClick(params: {
  marca?: string;
  modelo?: string;
  anio?: string;
  provincia?: string;
  cobertura?: string;
  gnc?: boolean;
}) {
  push('cotizador_cotizar_click', {
    marca:     params.marca     || 'sin_marca',
    modelo:    params.modelo    || 'sin_modelo',
    anio:      params.anio      || 'sin_anio',
    provincia: params.provincia || 'sin_provincia',
    cobertura: params.cobertura || 'terceros',
    gnc:       params.gnc ? 'si' : 'no',
  });
}

/** Lead capturado en el gate antes de redirigir al afiliado */
export function trackCotizadorLeadEnviado(pagina_origen: string) {
  push('cotizador_lead_enviado', { pagina_origen });
  // Evento de conversión GA4
  push('generate_lead', { lead_source: 'cotizador_seguros', pagina_origen });
}

/** Usuario abrió el link de 123seguro (afiliado) — máxima conversión */
export function trackCotizadorAfiliadoAbierto(params: {
  marca?: string;
  anio?: string;
  cobertura?: string;
  via: 'directo' | 'post_lead' | 'skip_lead';
}) {
  push('cotizador_afiliado_abierto', {
    marca:     params.marca     || 'sin_marca',
    anio:      params.anio      || 'sin_anio',
    cobertura: params.cobertura || 'terceros',
    via:       params.via,
  });
}

// ─── PROMOS ──────────────────────────────────────────────────────────────────

/** Sección de promos se mostró (cuántas promos cargaron) */
export function trackPromoVista(cantidad: number) {
  push('promo_seccion_vista', { cantidad_promos: cantidad });
}

/** Clic en una card de promo */
export function trackPromoClick(params: {
  banco: string;
  marca: string;
  pct: string;
  fuente: 'dashboard' | 'pagina_promos';
}) {
  push('promo_click', params);
}

/** Usuario navega a la página de promos */
export function trackPromosPaginaVista() {
  push('promos_pagina_vista');
}

// ─── NAVEGACIÓN / QUICKNAV ────────────────────────────────────────────────────

/** Clic en item del menú rápido */
export function trackNavClick(destino: string, tipo: 'anchor' | 'link') {
  push('nav_click', { destino, tipo });
}

// ─── ESTACIONES ───────────────────────────────────────────────────────────────

/** Clic en una card de estación en la lista */
export function trackEstacionClick(params: {
  bandera: string;
  precio?: number;
  producto?: string;
  provincia?: string;
  fuente: 'lista' | 'mapa';
}) {
  push('estacion_click', params);
}

/** Clic en "Cómo llegar" de una estación */
export function trackComoLlegarClick(bandera: string) {
  push('como_llegar_click', { bandera });
}

// ─── FILTROS ──────────────────────────────────────────────────────────────────

/** Se aplicó un filtro de búsqueda */
export function trackFiltroAplicado(campo: string, valor: string) {
  push('filtro_aplicado', { campo, valor: valor || 'todos' });
}

/** Se ejecutó una búsqueda */
export function trackBusquedaEjecutada(params: {
  provincia?: string;
  localidad?: string;
  producto?: string;
  empresa?: string;
  resultados: number;
}) {
  push('busqueda_ejecutada', {
    provincia:  params.provincia  || 'todas',
    localidad:  params.localidad  || 'todas',
    producto:   params.producto   || 'todos',
    empresa:    params.empresa    || 'todas',
    resultados: params.resultados,
  });
}

// ─── PROVINCIA PAGE ───────────────────────────────────────────────────────────

/** Vista de página de provincia */
export function trackProvinciaVista(provincia: string) {
  push('provincia_vista', { provincia });
}

/** Clic en link de provincia desde el dashboard */
export function trackProvinciaLinkClick(provincia: string) {
  push('provincia_link_click', { provincia });
}

// ─── FOOTER / LINKS EXTERNOS ─────────────────────────────────────────────────

/** Clic en links del footer o redes sociales */
export function trackFooterLink(destino: string) {
  push('footer_link_click', { destino });
}

// ─── GARAGE ───────────────────────────────────────────────────────────────────

/** Cambio de pestaña dentro del Garage */
export function trackGaragePestana(tab: string) {
  push('garage_pestana_click', { tab });
}

/** Entrada en Bitácora registrada */
export function trackBitacoraEntrada() {
  push('bitacora_entrada_registrada');
}

/** Mantenimiento registrado */
export function trackMantenimientoRegistrado(tipo: string) {
  push('mantenimiento_registrado', { tipo });
}

// ─── MAPA ─────────────────────────────────────────────────────────────────────

/** Usuario activó el modo mapa */
export function trackMapaActivado() {
  push('mapa_activado');
}

/** Usuario hizo zoom en el mapa */
export function trackMapaZoom(nivel: number) {
  push('mapa_zoom', { nivel });
}

// ─── SCROLL MILESTONES ────────────────────────────────────────────────────────

/** Scroll milestone en una página (25%, 50%, 75%, 90%) */
export function trackScrollMilestone(porcentaje: number, pagina: string) {
  push('scroll_milestone', { porcentaje, pagina });
}

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────

/** Usuario envió feedback */
export function trackFeedbackEnviado(tipo: string) {
  push('feedback_enviado', { tipo });
}

// ─── DOLAR PAGE ───────────────────────────────────────────────────────────────

/** Vista de la página del dólar */
export function trackDolarPaginaVista() {
  push('dolar_pagina_vista');
}
