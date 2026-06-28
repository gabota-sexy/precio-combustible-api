import os, re, json

BASE_HTML = open('/var/www/tankear/frontend/index.html').read()
FRONTEND_DIR = '/var/www/tankear/frontend'

PROVINCIAS = [
    ("buenos-aires",                    "Buenos Aires"),
    ("ciudad-autonoma-de-buenos-aires", "CABA"),
    ("cordoba",                         "Córdoba"),
    ("santa-fe",                        "Santa Fe"),
    ("mendoza",                         "Mendoza"),
    ("tucuman",                         "Tucumán"),
    ("salta",                           "Salta"),
    ("entre-rios",                      "Entre Ríos"),
    ("corrientes",                      "Corrientes"),
    ("misiones",                        "Misiones"),
    ("chaco",                           "Chaco"),
    ("formosa",                         "Formosa"),
    ("santiago-del-estero",             "Santiago del Estero"),
    ("san-juan",                        "San Juan"),
    ("jujuy",                           "Jujuy"),
    ("rio-negro",                       "Río Negro"),
    ("neuquen",                         "Neuquén"),
    ("la-pampa",                        "La Pampa"),
    ("chubut",                          "Chubut"),
    ("san-luis",                        "San Luis"),
    ("catamarca",                       "Catamarca"),
    ("la-rioja",                        "La Rioja"),
    ("santa-cruz",                      "Santa Cruz"),
    ("tierra-del-fuego",                "Tierra del Fuego"),
]

def get_faq(slug, nombre):
    return [
        {
            "@type": "Question",
            "name": f"¿Cuánto cuesta la nafta en {nombre} hoy?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"El precio de la nafta en {nombre} se actualiza diariamente en Tankear con datos de todas las estaciones de servicio YPF, Shell, Axion, Puma y otras banderas. Entrá a tankear.com.ar/precios/{slug} para ver el precio actual."
            }
        },
        {
            "@type": "Question",
            "name": f"¿Dónde hay nafta más barata en {nombre}?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"Para encontrar la nafta más barata en {nombre} usá Tankear, que compara precios en tiempo real en cientos de estaciones de la provincia. La diferencia entre la estación más cara y la más barata puede ser significativa."
            }
        },
        {
            "@type": "Question",
            "name": f"¿Qué marcas de nafta hay en {nombre}?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"En {nombre} encontrás estaciones de servicio de YPF, Shell, Axion Energy, Puma Energy, Gulf y otras banderas locales. En Tankear podés filtrar por marca y ver cuál tiene el mejor precio en tu zona."
            }
        },
        {
            "@type": "Question",
            "name": f"¿Cómo comparo precios de combustible en {nombre}?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"Entrá a Tankear, seleccioná {nombre} como provincia o activá tu GPS, y el mapa te muestra todas las estaciones ordenadas por precio. Podés filtrar por nafta Súper, Premium o Gasoil. Es gratis y sin registro."
            }
        },
    ]

def gen_html(slug, nombre):
    canonical = f"https://tankear.com.ar/precios/{slug}"
    title = f"Precio de nafta en {nombre} hoy | Tankear"
    desc  = (f"Precios actualizados de nafta Súper, Premium y Gasoil en {nombre}. "
             f"Compará YPF, Shell, Axion, Puma y más. "
             f"Encontrá la estación más barata cerca tuyo.")

    breadcrumb_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://tankear.com.ar/"},
            {"@type": "ListItem", "position": 2, "name": f"Precios en {nombre}", "item": canonical},
        ]
    }, ensure_ascii=False, indent=2)

    faq_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": get_faq(slug, nombre)
    }, ensure_ascii=False, indent=2)

    html = BASE_HTML
    html = re.sub(r'<title>[^<]*</title>', f'<title>{title}</title>', html)
    html = re.sub(r'<meta name="description" content="[^"]*"',
                  f'<meta name="description" content="{desc}"', html)
    if 'rel="canonical"' in html:
        html = re.sub(r'<link rel="canonical"[^>]*>', f'<link rel="canonical" href="{canonical}" />', html)
    else:
        html = html.replace('</head>', f'  <link rel="canonical" href="{canonical}" />\n</head>')
    html = re.sub(r'<meta property="og:title"\s+content="[^"]*"',
                  f'<meta property="og:title"         content="{title}"', html)
    html = re.sub(r'<meta property="og:description"\s+content="[^"]*"',
                  f'<meta property="og:description"  content="{desc}"', html)
    html = re.sub(r'<meta property="og:url"\s+content="[^"]*"',
                  f'<meta property="og:url"          content="{canonical}"', html)
    html = re.sub(r'<meta name="twitter:title"\s+content="[^"]*"',
                  f'<meta name="twitter:title"       content="{title}"', html)
    html = re.sub(r'<meta name="twitter:description"\s+content="[^"]*"',
                  f'<meta name="twitter:description" content="{desc}"', html)

    schemas = (
        f'\n    <script type="application/ld+json">\n{breadcrumb_ld}\n    </script>'
        f'\n    <script type="application/ld+json">\n{faq_ld}\n    </script>'
    )
    html = html.replace('</head>', schemas + '\n</head>')
    return html

for slug, nombre in PROVINCIAS:
    target_dir = os.path.join(FRONTEND_DIR, 'precios', slug)
    os.makedirs(target_dir, exist_ok=True)
    with open(os.path.join(target_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(gen_html(slug, nombre))
    print(f"✓ {slug}")

print(f"\n{len(PROVINCIAS)} archivos generados.")
