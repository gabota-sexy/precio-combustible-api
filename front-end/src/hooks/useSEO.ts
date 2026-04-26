import { useEffect } from 'react';

export interface SEOConfig {
  title:       string;   // sin "| Tankear" — se agrega automáticamente
  description: string;
  canonical?:  string;   // URL canónica completa, ej: "https://tankear.com.ar/viaje"
  ogImage?:    string;
  noIndex?:    boolean;
}

const DEFAULT_TITLE = 'Tankear — Nafta más barata cerca tuyo';
const OG_IMAGE_DEFAULT = 'https://tankear.com.ar/og-image.png';

function setMeta(nameOrProp: string, content: string) {
  // Busca por name= o property=
  const sel =
    document.querySelector(`meta[name="${nameOrProp}"]`) ||
    document.querySelector(`meta[property="${nameOrProp}"]`);
  if (sel) {
    sel.setAttribute('content', content);
  } else {
    const m = document.createElement('meta');
    if (nameOrProp.startsWith('og:') || nameOrProp.startsWith('twitter:')) {
      m.setAttribute('property', nameOrProp);
    } else {
      m.setAttribute('name', nameOrProp);
    }
    m.setAttribute('content', content);
    document.head.appendChild(m);
  }
}

function setCanonical(href: string) {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

export function useSEO({ title, description, canonical, ogImage, noIndex }: SEOConfig) {
  useEffect(() => {
    const fullTitle = `${title} | Tankear`;
    const image     = ogImage || OG_IMAGE_DEFAULT;
    const url       = canonical || window.location.href;

    document.title = fullTitle;

    setMeta('description',        description);
    setMeta('robots',             noIndex ? 'noindex, nofollow' : 'index, follow');

    // Open Graph
    setMeta('og:title',           fullTitle);
    setMeta('og:description',     description);
    setMeta('og:url',             url);
    setMeta('og:image',           image);
    setMeta('og:locale',          'es_AR');
    setMeta('og:type',            'website');
    setMeta('og:site_name',       'Tankear');

    // Twitter Card
    setMeta('twitter:card',        'summary_large_image');
    setMeta('twitter:title',       fullTitle);
    setMeta('twitter:description', description);
    setMeta('twitter:image',       image);

    // Siempre actualizar canonical: si no se pasa, usar la URL actual
    setCanonical(canonical || window.location.href);

    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title, description, canonical, ogImage, noIndex]);
}
