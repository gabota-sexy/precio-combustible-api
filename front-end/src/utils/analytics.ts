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
