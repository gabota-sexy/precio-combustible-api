<p align="center">
  <img src="https://tankear.com.ar/logo.png" alt="Tankear" width="120" />
</p>

<h1 align="center">Tankear</h1>
<p align="center"><strong>El comparador de combustible más completo de Argentina</strong></p>
<p align="center">
  <a href="https://tankear.com.ar">tankear.com.ar</a> ·
  Precios en tiempo real · Seguimiento de vuelos · Planificador de viajes · Gestión vehicular
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/deployed-live-22c55e" />
</p>

---

## Tabla de Contenidos

- [¿Qué es Tankear?](#qué-es-tankear)
- [Features](#features)
- [Arquitectura](#arquitectura)
- [Frontend](#frontend)
  - [Páginas](#páginas)
  - [Componentes](#componentes)
  - [Hooks](#hooks)
  - [Stack frontend](#stack-frontend)
- [Backend](#backend)
  - [Endpoints API](#endpoints-api)
  - [Base de datos](#base-de-datos)
  - [Autenticación](#autenticación)
  - [Rate limiting](#rate-limiting)
- [Scraper de precios](#scraper-de-precios)
- [APIs externas](#apis-externas)
- [Datos estáticos](#datos-estáticos)
- [Infraestructura](#infraestructura)
- [Desarrollo local](#desarrollo-local)
- [Estructura de directorios](#estructura-de-directorios)

---

## ¿Qué es Tankear?

**Tankear** es la plataforma de combustible más completa de Argentina. Nació como un comparador de precios de nafta y gasoil, y evolucionó en una herramienta integral para el automovilista argentino:

- Encontrá la estación más barata cerca tuyo, en tiempo real.
- Planificá un viaje de 1.600 km con paradas de combustible óptimas.
- Seguí vuelos en tiempo real sobre Argentina.
- Llevá un registro de mantenimiento, seguros y viajes de tu vehículo.
- Reportá precios y nuevas estaciones de forma colaborativa.

**100% gratuito, sin registro obligatorio, sin paywall.**

---

## Features

### Precios de Combustible
- **Búsqueda inteligente por GPS** — Detecta tu ubicación automáticamente (GPS del browser → IP geolocalización → fallback manual). Muestra las estaciones más cercanas primero.
- **Mapa interactivo** (Leaflet + CARTO dark tiles) — Markers con precio visible sobre el mapa, filtro por radio, popup con botones de reporte.
- **Filtros avanzados** — Por provincia, localidad, barrio (CABA), empresa/bandera, tipo de combustible (Nafta Super/Premium, Gasoil G2/G3, GNC).
- **Ordenamiento múltiple** — Por distancia, precio o fecha de actualización.
- **Freshness indicators** — Chips visuales que muestran si el precio tiene 1 año, 6 meses, etc.
- **Estadísticas en vivo** — Precio promedio, mínimo, máximo, empresa más barata de la zona.
- **Gráfico histórico** — Timeline de evolución de precios por producto y zona.
- **Calculadora integrada** — 3 modos: cargar tanque, cálculo por viaje y gasto mensual por auto modelo.
- **Precios estimados** — Cuando no hay dato fresco, muestra estimación con advertencia de antigüedad.

### Comunidad (Crowdsourcing)
- **Reportar precio actual** — Cualquier usuario puede actualizar el precio de una estación.
- **Reportar problema** — Estación cerrada, ubicación incorrecta, no existe más.
- **Nueva estación** — Formulario para reportar estaciones que no están en el mapa: empresa, dirección, localidad, provincia + precio opcional.
- Todas las acciones disponibles desde el **popup del mapa**, desde las **tarjetas de la lista** y desde la **calculadora** cuando los datos son viejos.

### Calculadora de Viaje
- Ingresás origen + destino → calcula ruta completa con OSRM.
- Identifica paradas de combustible óptimas cada ~150 km.
- Para cada parada: estación más barata en 20 km de radio + litros a cargar + costo parcial.
- Clima por parada via Open-Meteo (alertas de viento patagónico, tormentas).
- Hoteles próximos a la ruta via SIT.tur.ar (Ministerio de Turismo).
- Consumo por modelo de auto (base de datos de +300 vehículos argentinos con consumo ciudad/mixto/ruta).
- Geocoding offline con dataset completo de localidades argentinas (0ms de latencia).

### Seguimiento de Vuelos en Tiempo Real
- Mapa en vivo de todos los vuelos sobre Argentina vía OpenSky Network.
- Íconos de avión rotados según heading real (true track).
- Color coding: rojo = emergencia 7700, ámbar = pérdida radio 7600, violeta = secuestro 7500, gris = en tierra, colores por aerolínea.
- **Alertas de emergencia** — Banner prominente cuando hay squawk 7700/7600/7500 activo sobre Argentina.
- Popup por vuelo: callsign, aerolínea, altitud, velocidad, heading, tasa vertical (▲/▼), squawk.
- Panel lateral con stats (total en vuelo, países de origen, aerolíneas activas) y lista con filtros.
- Fallback 3 niveles: live OpenSky → stale localStorage (30 min) → aeropuertos hardcodeados siempre visibles.
- Polling pausado cuando la pestaña está en background (ahorra rate limit).
- **Integración exclusiva**: click en un vuelo → "¿Conviene manejar?" → link al planificador con datos prellenados.

### Mi Garage (Gestión Vehicular Completa)
Módulo completo de gestión de flota personal, requiere registro:

- **Mis Autos** — CRUD de vehículos con cascading dropdowns (marca → modelo → versión), consumo ciudad/mixto/ruta, capacidad de tanque, combustible preferido.
- **Bitácora de Viajes** — Historial de viajes realizados: origen, destino, km, litros, precio/litro, costo total, tiempo, clima al momento del viaje. Agrupado por mes, con stats de consumo. Ordena de más reciente a más viejo. Filtros por año, mes, vehículo y búsqueda libre. Integración con planificador: "Guardar en bitácora" prellena los datos del viaje calculado.
- **Mantenimiento** — Historial de cambio de aceite, VTV, frenos, cubiertas, patente y más. Alertas de urgencia con semáforo visual (🔴 urgente / 🟡 pronto / 🟢 OK). Registro de talleres favoritos en localStorage.
- **Seguro** — Registro de póliza: aseguradora, cobertura, costo mensual, vencimiento. Alerta de vencimiento próximo. Benchmark de rango de precios para el modelo del vehículo. Link al cotizador de seguros.
- **Badge de alertas** en el header cuando hay mantenimiento pendiente.

### Comparativa de Precios
- Evolución histórica de precios por empresa (YPF, Shell, Axion, Puma, etc.).
- Gráfico de líneas comparativo entre compañías.
- Diferencial de precio entre la más cara y más barata.

### Dólar y Combustible
- Precio del dólar blue y oficial (via Bluelytics API, actualizado cada 15 min).
- Calculadora de equivalencia: cuántos litros de nafta por dólar.
- Evolución del tipo de cambio y su impacto en el precio del combustible.

### Noticias
- Feed de noticias del sector energético argentino.
- Formato grid con imagen, título, bajada y fecha.

### Cotizador de Seguros
- Cotizador de seguro de auto con perfil vehicular del garage del usuario.
- Comparativa de coberturas (terceros / terceros completo / todo riesgo).

### SEO & Performance
- `lang="es-AR"` en el HTML root.
- Open Graph + Twitter Card meta tags por página.
- `useSEO()` hook reutilizable con title, description, canonical.
- Schema.org JSON-LD en Dashboard.
- `robots.txt` y `sitemap.xml` con las 24 provincias argentinas.
- Carga lazy de Leaflet (code splitting automático por Vite).

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENTE (Browser)                            │
│                                                                          │
│  React 18 + TypeScript + Vite                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │Dashboard │ │ /vuelos  │ │ /viaje   │ │ /garage  │ │/comparativa  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │            │            │              │           │
│  ┌────▼──────────────────────────────────────────────────────▼───────┐  │
│  │                        Hooks de datos                              │  │
│  │ useFuelData · useFlightData · useOSRM · useGarage · useDolar ...  │  │
│  └────────────────────────────────┬───────────────────────────────── ┘  │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │ HTTPS
┌───────────────────────────────────▼──────────────────────────────────────┐
│                       Nginx (reverse proxy)                               │
│              tankear.com.ar        → /var/www/tankear/frontend (static)   │
│              tankear.com.ar/api/*  → FastAPI :8000                        │
│              SSL via Let's Encrypt (Certbot)                              │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────────────┐
│                      FastAPI (Python 3.10+)                               │
│                      uvicorn main:app --host 0.0.0.0 --port 8000         │
│                                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Precios    │  │  Usuarios    │  │   Garage     │  │   Vuelos     │  │
│  │  /precios/* │  │  /usuarios/* │  │  /garage/*   │  │  (proxy)     │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                │                 │                 │           │
│  ┌──────▼────────────────▼─────────────────▼─────────────────▼───────┐  │
│  │                    SQLite DB (/data/tankear.db)                     │  │
│  │                                                                     │  │
│  │  estaciones · precios_historico · usuarios · mi_garage             │  │
│  │  bitacoras_viaje · mantenimiento_vehiculo · leads · viajes         │  │
│  └─────────────────────────────────────────────────────────────────── ┘  │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
            ┌───────────────────────┼──────────────────────┐
            │                       │                      │
┌───────────▼──────┐   ┌────────────▼──────┐  ┌───────────▼──────┐
│  datos.gob.ar    │   │  OpenSky Network  │  │   Nominatim OSM  │
│  CSV precios     │   │  Vuelos en vivo   │  │  Reverse geocode │
│  (cron 6h)       │   │  ADS-B Argentina  │  │                  │
└──────────────────┘   └───────────────────┘  └──────────────────┘
```

---

## Frontend

### Páginas

| Ruta | Componente | Descripción |
|------|-----------|-------------|
| `/` | `Dashboard.tsx` | Página principal: mapa + lista de estaciones + calculadora + estadísticas + noticias |
| `/estacion/:slug` | `StationPage.tsx` | Detalle de estación: todos los precios, mapa embebido, links a Maps/Waze |
| `/precios/:provincia` | `ProvinciaPage.tsx` | Vista de precios por provincia con filtros |
| `/comparativa` | `ComparativaPage.tsx` | Evolución histórica por empresa, gráficos comparativos |
| `/noticias` | `NoticiasPage.tsx` | Feed de noticias del sector energético |
| `/dolar` | `DolarPage.tsx` | Tipo de cambio + calculadora nafta/dólar |
| `/viaje` | `RoadTripPage.tsx` | Planificador de ruta con paradas de combustible, clima y hoteles |
| `/vuelos` | `VuelosPage.tsx` | Radar de vuelos en tiempo real sobre Argentina |
| `/cotizador` | `CotizadorPage.tsx` | Calculadora de consumo + cotizador de seguros |
| `/verificar` | `VerificarPage.tsx` | Verificación de email post-registro |

### Componentes

#### Navegación y Layout
| Componente | Descripción |
|-----------|-------------|
| `Header.tsx` | Navbar superior: logo, menú de usuario (login/logout/perfil/garage), badge de alertas de mantenimiento. Auto-contenido: maneja state de GarageSection y PerfilModal internamente, sin prop drilling. |
| `QuickNav.tsx` | Barra de navegación rápida sticky bajo el header. Scroll-spy via IntersectionObserver. Scroll con offset de 116px para compensar headers fijos. Scroll to top instantáneo al navegar entre páginas. |
| `Footer.tsx` | Footer con links, redes, info legal. |
| `AdSidebar.tsx` | Sidebar de publicidad (desktop). |

#### Combustible
| Componente | Descripción |
|-----------|-------------|
| `FuelMap.tsx` | Mapa Leaflet con markers de precios. Popup con botones "💰 Actualizar precio" y "🚩 Reportar". Botón flotante "Agregar estación". Modales React gestionados internamente via `popupopen` event. Círculo de zona + marker "Estás acá" pulsante. |
| `StationList.tsx` | Lista de estaciones agrupadas por ubicación física. Tabs por combustible, search, sort (distancia/precio/fecha). Todas visibles por defecto, filtro de recientes opcional. |
| `FilterBar.tsx` | Cascading filters: Provincia → Localidad → Barrio (CABA) → Empresa → Producto. |
| `PriceStats.tsx` | KPIs: precio promedio, mínimo, máximo, empresa más barata, cantidad de estaciones. |
| `PriceChart.tsx` | Gráfico de evolución histórica de precios con Recharts. |
| `PriceCalculator.tsx` | 3 tabs: llenar tanque / costo de viaje / gasto mensual por auto. Botones de reporte cuando hay precios viejos. |

#### Vuelos
| Componente | Descripción |
|-----------|-------------|
| `FlightMap.tsx` | Mapa Leaflet dark con íconos SVG rotados por heading real. Colores por estado de emergencia/aerolínea. Actualización incremental (setLatLng sin recrear markers). |
| `FlightPanel.tsx` | Tabs "Vuelos" (lista con filtros) y "Stats" (países, aerolíneas, contadores). |
| `EmergencyAlert.tsx` | Banner para squawk 7700 (rojo), 7600 (ámbar), 7500 (violeta). Dismissible por vuelo. |

#### Mi Garage
| Componente | Descripción |
|-----------|-------------|
| `GarageSection.tsx` | Modal con 4 tabs: Mis Autos / Bitácora / Mantenimiento / Seguro. Badge en tab si hay alertas. |
| `AutosTab.tsx` | CRUD de vehículos con cascading dropdowns marca → modelo. |
| `BitacoraTab.tsx` | Timeline de viajes realizados. Stats por mes. Formulario de registro. Integración con planificador via sessionStorage. |
| `MantenimientoTab.tsx` | Historial de servicios. Alertas urgente/pronto/OK. Registro de talleres favoritos en localStorage. |
| `SeguroTab.tsx` | Card de póliza con días restantes. Benchmark de precios para el modelo de auto. Link al cotizador. |

#### Planificador de Viaje
| Componente | Descripción |
|-----------|-------------|
| `TripForm.tsx` | Formulario: origen, destino, auto, combustible, consumo. |
| `RouteMap.tsx` | Mapa con polyline de ruta, markers de paradas, clima y hoteles. |
| `FuelStopsPanel.tsx` | Lista de paradas con estación más barata, km, litros y costo. Chip de clima por parada. |
| `HotelsPanel.tsx` | Hoteles SIT próximos a la ruta, agrupados por localidad. |
| `WeatherAlerts.tsx` | Chips de alerta climática por tramo (viento, tormenta, nieve). |

#### Comunidad
| Componente | Descripción |
|-----------|-------------|
| `CommunityActions.tsx` | Botones "Reportar" + "Precio" embebibles en cualquier card. Modales via `ReactDOM.createPortal` (escapa stacking context de framer-motion). |
| `NuevaEstacionModal` | Formulario para reportar estaciones no registradas: empresa, dirección, localidad, provincia, precio opcional. |

#### Autenticación y Usuario
| Componente | Descripción |
|-----------|-------------|
| `OnboardingModal.tsx` | Wizard de registro multi-paso: email, contraseña, provincia, vehículo, preferencias. Cloudflare Turnstile. |
| `LoginModal.tsx` | Login con email/contraseña. |
| `PerfilModal.tsx` | 3 tabs: Mis datos (celular, provincia, localidad) / Mi auto / Seguridad (cambio de contraseña). |

### Hooks

| Hook | Fuente de datos | Descripción |
|------|----------------|-------------|
| `useFuelData` | `GET /precios/smart` | Hook principal. Detecta ubicación (GPS → IP → manual). Devuelve `data`, `freshData`, `loading`, `filters`, `ubicacion`. |
| `useFlightData` | `GET /vuelos` (proxy OpenSky) | Polling cada 10s. Rate limiting con 429 detection. Fallback a localStorage 30min. |
| `useOSRM` | OSRM API | Routing + geocoding. Cascade: `ar_localidades.json` → Photon → Nominatim. Cache 30min. |
| `useRoadTripFuel` | `GET /precios/smart` | Paradas de combustible a lo largo de ruta. Búsqueda paralela con `Promise.all`. Timeout global 12s. |
| `useRouteWeather` | Open-Meteo | Clima por waypoint. Alertas si viento >60km/h o tormenta. |
| `useSITHoteles` | SIT.tur.ar CSV | Hoteles próximos a la ruta (<5km del trayecto). Cache localStorage 24h. |
| `useUser` | `/usuarios/login` `/usuarios/me` | Auth context global. Token en localStorage. `login`, `register`, `logout`, `updateProfile`. |
| `useGarage` | `GET/POST/PUT/DELETE /garage` | CRUD de vehículos del usuario. |
| `useBitacora` | `GET/POST/PUT/DELETE /bitacora` | CRUD de bitácora de viajes. |
| `useMantenimiento` | `GET/POST/PUT/DELETE /mantenimiento` | CRUD de mantenimiento + alertas. |
| `useAlertas` | `GET /garage/alertas` | Badge de alertas de mantenimiento para el header. |
| `useDolar` | Bluelytics API | USD blue/oficial. Cache localStorage 15min. |
| `useClima` | Open-Meteo / SMN | Temperatura y viento actual. |
| `useGeolocation` | Browser Geolocation API | GPS con timeout 8s y fallback. |
| `useNewsData` | `GET /noticias` | Feed de noticias. |
| `useSEO` | DOM API | Meta tags dinámicos + canonical + JSON-LD. Cleanup en unmount. |

### Stack Frontend

| Tecnología | Versión | Uso |
|-----------|---------|-----|
| React | 18.3 | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 5.x | Build tool + HMR + code splitting |
| React Router | 6.x | Client-side routing |
| Tailwind CSS | 3.x | Utilidad CSS |
| Leaflet | 1.9 | Mapas interactivos |
| Recharts | 2.x | Gráficos de precios |
| Framer Motion | 11.x | Animaciones |
| Lucide React | latest | Iconografía |

---

## Backend

### Endpoints API

Base URL: `https://tankear.com.ar/api` (prod) · `http://localhost:8000` (dev)

Documentación interactiva (Swagger UI): `http://localhost:8000/docs`

#### Precios y Estaciones

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET` | `/precios/smart` | **Endpoint principal.** Búsqueda cascada: GPS → IP → provincia → fallback. Params: `lat`, `lon`, `provincia`, `localidad`, `barrio`, `producto`, `radio_km`, `limit`. Retorna `data[]`, `ubicacion_resuelta`, `total`. |
| `GET` | `/precios/cercanos` | Estaciones en radio. Params: `lat`, `lon`, `radio_km` (def: 15). |
| `GET` | `/precios/baratos` | Más baratas. Params: `provincia`, `localidad`, `producto`. |
| `GET` | `/precios/estadisticas` | KPIs de precio por zona. Params: `provincia`, `localidad`. |
| `GET` | `/precios/timeline` | Historial de precios. Params: `provincia`, `localidad`, `producto`. |
| `GET` | `/estacion/:slug` | Detalle de estación individual. |
| `GET` | `/provincias` | Lista de provincias con localidades. |
| `GET` | `/localidades` | Localidades por provincia. |
| `GET` | `/sitemap.xml` | SEO sitemap generado dinámicamente. |

#### Usuarios y Autenticación

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `POST` | `/usuarios/registro` | Registro. Body: `mail`, `password`, `captcha_token` + opcionales. Envía email de verificación via Resend. |
| `GET` | `/verificar?token=` | Verifica email y activa la cuenta. |
| `POST` | `/usuarios/login` | Login. Retorna JWT token + perfil completo. |
| `GET` | `/usuarios/me` | Perfil del usuario autenticado. Requiere `Authorization: Bearer {token}`. |
| `PUT` | `/usuarios/perfil` | Actualizar perfil (celular, provincia, localidad, auto, preferencias). |

#### Mi Garage

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET` | `/garage` | Lista vehículos del usuario. |
| `POST` | `/garage` | Agregar vehículo. |
| `PUT` | `/garage/:id` | Editar vehículo (incluye km, seguro, VTV). |
| `DELETE` | `/garage/:id` | Eliminar vehículo. |
| `POST` | `/garage/:id/principal` | Establecer como vehículo principal. |
| `GET` | `/garage/alertas` | Alertas activas: aceite, VTV, seguro (urgente/pronto/ok). |

#### Bitácora y Mantenimiento

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET/POST` | `/bitacora` | Listar / registrar viajes. |
| `PUT/DELETE` | `/bitacora/:id` | Editar / eliminar viaje. |
| `GET/POST` | `/mantenimiento` | Listar / registrar servicios. |
| `PUT/DELETE` | `/mantenimiento/:id` | Editar / eliminar servicio. |

#### Comunidad y Viajes

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `POST` | `/comunidad/reporte` | Reportar problema en estación. |
| `POST` | `/comunidad/precio` | Reportar precio actualizado. |
| `POST` | `/comunidad/nueva_estacion` | Reportar estación nueva no registrada. |
| `GET/POST` | `/viajes` | Listar / guardar planificación de viaje. |
| `DELETE` | `/viajes/:id` | Eliminar viaje guardado. |

#### Proxies Externos

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET` | `/vuelos` | Proxy a OpenSky Network con cache 12s en memoria. Retorna `states[]` + `cached`. |
| `GET` | `/noticias` | Feed de noticias del sector. |

#### Captación y Feedback

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `POST` | `/leads` | Registrar lead (email/WhatsApp + zona + preferencias). |
| `POST` | `/contacto/publicidad` | Consulta de publicidad. |
| `POST` | `/feedback` | Feedback de usuario (sugerencia/bug/otro). |

### Base de Datos

SQLite en `/var/www/tankear/data/tankear.db`. Path configurable via `DB_PATH`.

```sql
-- Sesiones de geolocalización por IP
CREATE TABLE user_sessions (
  ip TEXT PRIMARY KEY,
  lat REAL, lon REAL,
  localidad TEXT, provincia TEXT,
  source TEXT, updated_at TEXT
);

-- Master de localidades argentinas (~5000 registros)
CREATE TABLE localidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  localidad TEXT, provincia TEXT,
  lat REAL, lon REAL, codigo_postal TEXT,
  UNIQUE(localidad, provincia)
);

-- Usuarios registrados
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,           -- UUID
  mail TEXT UNIQUE,
  celular TEXT,
  provincia TEXT, localidad TEXT,
  auto_marca TEXT, auto_modelo TEXT, auto_anio INTEGER,
  combustible_preferido TEXT,
  preferencias TEXT,             -- JSON array
  token TEXT UNIQUE,             -- JWT
  password_hash TEXT,            -- bcrypt
  verified_mail INTEGER DEFAULT 0,
  verify_token TEXT,
  verify_token_expires TEXT,
  token_expires_at TEXT,
  created_at TEXT, last_seen TEXT,
  failed_logins INTEGER DEFAULT 0,
  locked_until TEXT              -- lockout por intentos fallidos
);

-- Flota de vehículos por usuario
CREATE TABLE mi_garage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT,
  marca TEXT, modelo TEXT, version TEXT, anio INTEGER,
  combustible TEXT, litros_tanque REAL,
  consumo_ciudad REAL, consumo_mixto REAL, consumo_ruta REAL,
  es_principal INTEGER DEFAULT 0,
  km_actual INTEGER,
  km_ultimo_aceite INTEGER, fecha_ultimo_aceite TEXT,
  intervalo_aceite_km INTEGER DEFAULT 10000,
  vencimiento_vtv TEXT, vencimiento_seguro TEXT,
  costo_seguro REAL, aseguradora TEXT, cobertura_seguro TEXT,
  estado TEXT DEFAULT 'activo',
  created_at TEXT, updated_at TEXT
);

-- Historial de viajes realizados
CREATE TABLE bitacoras_viaje (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL,
  vehiculo_id INTEGER,
  origen TEXT NOT NULL, destino TEXT NOT NULL,
  fecha_inicio TEXT NOT NULL, fecha_fin TEXT,
  km_recorridos REAL, litros_cargados REAL,
  precio_litro REAL, costo_total REAL,
  tiempo_min INTEGER,
  clima_origen TEXT,             -- JSON {temp, desc, icon}
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Historial de mantenimiento vehicular
CREATE TABLE mantenimiento_vehiculo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL,
  vehiculo_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,            -- aceite|vtv|frenos|cubiertas|filtro|patente|otro
  fecha TEXT NOT NULL,
  km_vehiculo INTEGER, km_proximo INTEGER,
  fecha_proxima TEXT,
  costo REAL,
  taller_nombre TEXT, taller_localidad TEXT,
  taller_provincia TEXT, taller_telefono TEXT,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Viajes planificados guardados
CREATE TABLE viajes_guardados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT,
  from_ciudad TEXT, to_ciudad TEXT,
  distancia_km INTEGER, duracion_min INTEGER,
  consumo_kml REAL, tanque_l REAL,
  producto TEXT, litros_inicio REAL,
  datos_json TEXT,               -- JSON con todos los detalles del viaje
  created_at TEXT
);

-- Leads / suscriptores
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail TEXT, celular TEXT,
  pagina_origen TEXT DEFAULT 'combustible',
  zona TEXT, preferencias TEXT, ip TEXT,
  fecha_registro TEXT
);
```

### Autenticación

JWT con gestión de sesiones server-side.

```
Registro  →  bcrypt hash  →  email de verificación (Resend)  →  cuenta activa
Login     →  bcrypt check  →  JWT token  →  localStorage del cliente
Requests  →  Authorization: Bearer {token}  →  verificación en backend
```

**Seguridad:**
- Contraseñas hasheadas con `bcrypt`.
- Lockout automático tras N intentos fallidos (`locked_until`).
- CAPTCHA de Cloudflare Turnstile en el registro.
- Tokens de verificación de email con expiración.
- Separación admin/usuario con endpoints de admin dedicados.

### Rate Limiting

`slowapi` aplicado por endpoint:

```python
@limiter.limit("10/hour")    # endpoints de escritura
@limiter.limit("60/minute")  # endpoints de lectura
@limiter.limit("5/hour")     # registro de usuarios
```

El endpoint `/vuelos` tiene cache en memoria de 12 segundos + 30 min de stale en el cliente para proteger el rate limit de OpenSky.

---

## Scraper de Precios

`scraper_do.py` — Automatiza la actualización de precios de combustible.

### Fuentes de datos (cascada)
```
1. datos.gob.ar CSV directo
   └── Resource ID: 80ac25de-a44a-4445-9215-090cf55cfda5
       Descarga CSV completo, ~200k registros

2. CKAN API datastore_search (paginación de 2000 por request)
   └── Fallback si la descarga CSV falla

3. Wayback Machine (web.archive.org)
   └── Último snapshot disponible del CSV
```

### Normalización
- Provincias: `CAPITAL FEDERAL` → `CABA`, `BUENOS AIRES` → `Buenos Aires`, etc.
- Precios: `"1.440,90"` → `1440.90` (manejo de punto/coma local).
- Lat/Lon: coerce to float, skip si inválido.
- Empresa/bandera: trim + uppercase + normalización de nombres.
- Productos estandarizados: `Nafta (súper) entre 92 y 95 Ron`, `Gas Oil Grado 2`, `GNC`, etc.

### Scheduling
```cron
# Cron en servidor
0 */6 * * *   root  cd /var/www/tankear && DB_PATH=... python scraper_do.py >> /var/log/tankear-scraper.log 2>&1
```

Cada 6 horas. Los datos son append-only (no se borra el histórico).

---

## APIs Externas

| API | Uso | Auth | Límite | Cache |
|-----|-----|------|--------|-------|
| **datos.gob.ar** | Precios combustible CSV | Ninguna | — | Scraper c/6h |
| **OpenSky Network** | Vuelos en vivo ADS-B | Opcional | 400 req/día anónimo | 12s server + 30min client |
| **Open-Meteo** | Clima por coordenadas | Ninguna | Sin límite publicado | 30min |
| **Nominatim (OSM)** | Reverse geocoding lat/lon → localidad | Ninguna (User-Agent requerido) | 1 req/s | localStorage |
| **Bluelytics** | USD blue/oficial Argentina | Ninguna | Sin límite | localStorage 15min |
| **OSRM** | Routing (distancia + geometría + waypoints) | Ninguna | Fair use | localStorage 30min |
| **ip-api.com** | IP geolocalización fallback | Ninguna | 45 req/min | user_sessions SQLite |
| **SIT.tur.ar** | Hoteles y establecimientos turísticos CSV | Ninguna | — | localStorage 24h |
| **Resend** | Email transaccional (verificación, alertas) | API Key | 3k emails/mes (free) | — |
| **Cloudflare Turnstile** | CAPTCHA en registro | Site Key / Secret Key | — | — |

---

## Datos Estáticos

### `front-end/src/data/autos.json`
Base de datos de +300 modelos de autos argentinos con consumo real.
```json
{
  "marca": "Toyota", "modelo": "Corolla",
  "version": "1.8 XEI CVT",
  "anio_desde": 2019, "anio_hasta": 2023,
  "consumo_ciudad_kml": 10.5,
  "consumo_mixto_kml": 13.2,
  "consumo_ruta_kml": 16.0,
  "litros_tanque": 50,
  "combustible": "nafta_super"
}
```
Usado por: `PriceCalculator`, `TripForm`, `BitacoraTab`, `GarageSection`.

### `front-end/src/data/ar_localidades.json`
~4.500 localidades argentinas con coordenadas (fuente: Georef API, datos.gob.ar).
```json
{ "n": "Villa Mercedes", "lat": -33.6751, "lon": -65.4623 }
```
Permite geocoding offline (0ms latencia) para el planificador. ~40KB gzipped. Cargado como chunk separado por Vite.

### `front-end/src/data/airports.ts`
14 aeropuertos argentinos. Siempre visibles en el mapa de vuelos aunque OpenSky no esté disponible (fallback de dato duro).

| ICAO | IATA | Aeropuerto | Ciudad |
|------|------|-----------|--------|
| SAEZ | EZE | Ministro Pistarini | Buenos Aires |
| SABE | AEP | Aeroparque Jorge Newbery | Buenos Aires |
| SACO | COR | Ingeniero Aeronáutico Ambrosio Taravella | Córdoba |
| SAME | MDZ | El Plumerillo | Mendoza |
| SAZS | BRC | Internacional de Bariloche | Bariloche |
| SAWH | USH | Malvinas Argentinas | Ushuaia |
| SAOR | IGR | Cataratas del Iguazú | Puerto Iguazú |
| ... | ... | ... | ... |

### `front-end/src/data/airlines.ts`
Aerolíneas con prefijos de callsign y colores para el mapa de vuelos.

| Prefijo | Nombre | Color |
|---------|--------|-------|
| ARG | Aerolíneas Argentinas | `#00b0ff` |
| LAN | LATAM Argentina | `#e40046` |
| FBZ | Flybondi | `#ff6600` |
| JSM | JetSmart | `#ffcc00` |

---

## Infraestructura

### Servidor

```
Digital Ocean Droplet
├── OS: Ubuntu 22.04 LTS
├── Specs: 1 vCPU / 1GB RAM / 25GB SSD
└── IP: 68.183.106.80

/var/www/tankear/
├── api/
│   └── main.py            ← FastAPI app (uvicorn)
├── frontend/              ← Build Vite (dist/)
│   ├── index.html
│   ├── assets/
│   ├── robots.txt
│   └── sitemap.xml
├── data/
│   └── tankear.db         ← SQLite DB
├── scraper_do.py
├── main_do.py
└── logs/
```

**Stack de servidor:**
- **Nginx** — Reverse proxy: `/` → archivos estáticos, `/api/` → FastAPI :8000
- **uvicorn** — ASGI server para FastAPI
- **systemd / supervisord** — Keep-alive del proceso uvicorn
- **Certbot (Let's Encrypt)** — SSL/TLS automático

### Variables de Entorno

```bash
# Base de datos
DB_PATH=/var/www/tankear/data/tankear.db

# Email transaccional
RESEND_API_KEY=re_xxxxxxxxxx
FROM_EMAIL=noreply@tankear.com.ar

# Seguridad
TURNSTILE_SECRET=0xXXXXXXXXXXXXXXX
ADMIN_USER=admin
ADMIN_HASH=bcrypt_hash_here

# Noticias
NEWSAPI_KEY=xxxxxxxxxxxxxxxx

# Frontend (build time)
VITE_API_BASE=https://tankear.com.ar/api
```

### Despliegue

```bash
# 1. Build del frontend
cd front-end
npm run build

# 2. Subir al servidor
scp -i ~/.ssh/id_ed25519 -r dist/* root@68.183.106.80:/var/www/tankear/frontend/

# 3. Si hay cambios en backend
scp -i ~/.ssh/id_ed25519 main_do.py root@68.183.106.80:/var/www/tankear/api/main.py
ssh -i ~/.ssh/id_ed25519 root@68.183.106.80 "systemctl restart tankear-api"
```

---

## Desarrollo Local

### Requisitos
- Node.js >= 18
- Python >= 3.10
- Git

### Setup Frontend

```bash
git clone https://github.com/LuisRGomez/precio-combustible-api.git
cd precio-combustible-api/front-end

npm install

# Crear .env.local con:
# VITE_API_BASE=http://localhost:8000

npm run dev    # → http://localhost:5173
```

### Setup Backend

```bash
cd precio-combustible-api

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

export DB_PATH=./data/dev.db
export RESEND_API_KEY=fake_key

uvicorn main_do:app --reload --port 8000
# Swagger UI en http://localhost:8000/docs
```

### Ejecutar el scraper (para tener datos reales)

```bash
python scraper_do.py
# Descarga precios actuales de datos.gob.ar
# ~2-5 minutos, ~200k registros
```

---

## Estructura de Directorios

```
precio-combustible/
│
├── front-end/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx         # Página principal
│   │   │   ├── VuelosPage.tsx        # Radar de vuelos
│   │   │   ├── RoadTripPage.tsx      # Planificador de viaje
│   │   │   ├── ComparativaPage.tsx
│   │   │   ├── NoticiasPage.tsx
│   │   │   ├── DolarPage.tsx
│   │   │   ├── CotizadorPage.tsx
│   │   │   ├── StationPage.tsx
│   │   │   ├── ProvinciaPage.tsx
│   │   │   └── VerificarPage.tsx
│   │   │
│   │   ├── components/
│   │   │   ├── Header.tsx            # Nav + garage + perfil (auto-contenido)
│   │   │   ├── QuickNav.tsx          # Barra de navegación rápida sticky
│   │   │   ├── Footer.tsx
│   │   │   ├── FuelMap.tsx           # Mapa de combustible + reporte integrado
│   │   │   ├── FlightMap.tsx         # Radar de vuelos
│   │   │   ├── FlightPanel.tsx
│   │   │   ├── EmergencyAlert.tsx
│   │   │   ├── StationList.tsx
│   │   │   ├── PriceCalculator.tsx
│   │   │   ├── PriceStats.tsx
│   │   │   ├── PriceChart.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── PerfilModal.tsx
│   │   │   ├── LoginModal.tsx
│   │   │   ├── OnboardingModal.tsx
│   │   │   ├── community/
│   │   │   │   └── CommunityActions.tsx   # Reportes + ReactDOM.createPortal
│   │   │   ├── garage/
│   │   │   │   ├── GarageSection.tsx
│   │   │   │   └── tabs/
│   │   │   │       ├── AutosTab.tsx
│   │   │   │       ├── BitacoraTab.tsx
│   │   │   │       ├── MantenimientoTab.tsx
│   │   │   │       └── SeguroTab.tsx
│   │   │   └── viaje/
│   │   │       ├── TripForm.tsx
│   │   │       ├── RouteMap.tsx
│   │   │       ├── FuelStopsPanel.tsx
│   │   │       ├── HotelsPanel.tsx
│   │   │       └── WeatherAlerts.tsx
│   │   │
│   │   ├── hooks/
│   │   │   ├── useFuelData.ts        # Hook principal de datos
│   │   │   ├── useFlightData.ts      # Vuelos + rate limiting + fallback
│   │   │   ├── useOSRM.ts            # Routing + geocoding offline
│   │   │   ├── useRoadTripFuel.ts    # Paradas de combustible
│   │   │   ├── useRouteWeather.ts
│   │   │   ├── useSITHoteles.ts
│   │   │   ├── useUser.ts            # Auth context
│   │   │   ├── useGarage.ts
│   │   │   ├── useBitacora.ts
│   │   │   ├── useMantenimiento.ts
│   │   │   ├── useAlertas.ts
│   │   │   ├── useDolar.ts
│   │   │   ├── useGeolocation.ts
│   │   │   └── useSEO.ts
│   │   │
│   │   ├── context/
│   │   │   └── UserContext.tsx       # Auth state global
│   │   │
│   │   ├── data/
│   │   │   ├── autos.json            # 300+ modelos con consumo
│   │   │   ├── airports.ts           # 14 aeropuertos argentinos
│   │   │   ├── airlines.ts           # Aerolíneas con colores
│   │   │   └── ar_localidades.json   # 4500 localidades geocodificadas
│   │   │
│   │   ├── types/index.ts
│   │   └── utils/
│   │       ├── api.ts                # fetchSmartData, formatCurrency
│   │       ├── stale.ts              # staleDaysAgo
│   │       ├── haversine.ts          # Distancia entre coords
│   │       └── slug.ts               # URL slugs
│   │
│   ├── public/
│   │   ├── robots.txt
│   │   └── sitemap.xml
│   │
│   ├── index.html                    # lang=es-AR, OG, canonical
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── main_do.py                        # FastAPI — todos los endpoints
├── scraper_do.py                     # Scraper datos.gob.ar
├── db_sqlite.py                      # SQLite helpers + schema
├── geo.py                            # Geolocalización IP + reverse geocoding
├── precio_ciencia.py                 # Estimación IDW de precios
├── requirements.txt
├── Procfile
└── README.md
```

---

## Licencia

Código propietario. Todos los derechos reservados. © 2024–2026 Tankear.

---

<p align="center">
  Hecho con ❤️ en Argentina · <a href="https://tankear.com.ar">tankear.com.ar</a>
</p>
