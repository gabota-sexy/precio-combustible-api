# Frontend Integration Guide — API Precios Combustible

**Base URL:** `https://tvcpev0ryc.execute-api.sa-east-1.amazonaws.com`
**Docs interactivos (Swagger):** `{base_url}/docs`

---

## El endpoint que vas a usar el 90% del tiempo

```
GET /precios/smart
```

Es el endpoint inteligente: detecta ubicación automáticamente por GPS o IP, busca las estaciones más cercanas y devuelve precios ordenados.

---

## Parámetros de `/precios/smart`

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `lat` | float | — | Latitud GPS del usuario |
| `lon` | float | — | Longitud GPS del usuario |
| `provincia` | string | — | Ej: `BUENOS AIRES`, `CABA`, `CORDOBA` |
| `localidad` | string | — | Ej: `MORON`, `PALERMO` |
| `barrio` | string | — | Especialmente útil en CABA. Ej: `Palermo`, `Belgrano` |
| `producto` | string | — | Ver lista abajo |
| `fecha_desde` | date | — | `YYYY-MM-DD`. Filtra estaciones que actualizaron precio desde esa fecha |
| `radio_km` | float | `10.0` | Radio de búsqueda cuando hay coordenadas GPS |
| `limit` | int | `500` | Máximo de resultados |

### Productos disponibles (valores exactos)
```
Nafta (súper) entre 92 y 95 Ron
Nafta de más de 95 Ron
Gasoil grado 2
Gasoil grado 3
GNC
Infinia
Infinia Diesel
```

---

## Cómo manejar la ubicación (IMPORTANTE)

### Flujo recomendado

```
1. Pedir GPS al usuario (navigator.geolocation)
   ├─ Si acepta → pasar lat + lon a la API
   └─ Si rechaza → llamar sin lat/lon (la API usa IP como fallback)
```

**Siempre mandá GPS si lo tenés.** La geolocalización por IP puede estar equivocada hasta 50km (el nodo del ISP puede estar en otro partido).

### El campo `ubicacion_resuelta` en la respuesta

Cada respuesta incluye `ubicacion_resuelta` que te dice cómo se resolvió la ubicación:

```json
"ubicacion_resuelta": {
  "method": "gps",           // "gps" | "ip_geo" | "ip_cache" | "localidad" | "default"
  "precision": "exacta",     // "exacta" | "aproximada" | "localidad" | "provincia"
  "lat": -34.4893,
  "lon": -58.7032,
  "provincia": "BUENOS AIRES",
  "localidad": "MARTINEZ",
  "localidad_dataset": "SAN ISIDRO",   // lo que se usó para buscar estaciones
  "distancia_dataset_km": 2.3,
  "ubicacion_aproximada": false,       // ← FLAG CLAVE
  "sugerencia": null                   // texto para mostrar al usuario si es aproximada
}
```

### Qué hacer con `ubicacion_aproximada`

```javascript
if (response.ubicacion_resuelta.ubicacion_aproximada) {
  // Mostrar banner: "Ubicación aproximada (por IP) — puede no ser precisa"
  // + botón: "Usar GPS"
  // El campo response.ubicacion_resuelta.sugerencia tiene el texto
}
```

Cuando `ubicacion_aproximada: true`:
- La API resolvió la ubicación por IP del ISP
- Puede estar equivocada por 30-50km
- La búsqueda por radio está **desactivada** (se usa zona administrativa)
- Mostrar aviso al usuario y ofrecer activar GPS

---

## Estructura de la respuesta

```json
{
  "ubicacion_resuelta": { ... },   // ver arriba
  "total": 42,
  "estaciones": [
    {
      "empresa": "YPF S.A.",
      "bandera": "YPF",
      "cuit": "30-54668997-9",
      "direccion": "AV. MAIPÚ 2650",
      "localidad": "MARTINEZ",
      "provincia": "BUENOS AIRES",
      "region": "PAMPEANA",
      "latitud": -34.4891,
      "longitud": -58.7028,
      "producto": "Nafta (súper) entre 92 y 95 Ron",
      "precio": 1234.56,
      "tipohorario": "Diurno",
      "fecha_vigencia": "2026-03-15T00:00:00",
      "precio_vigente": true,        // ← true si precio actualizado desde fecha_desde
      "distancia_km": 0.4            // solo cuando hay GPS
    }
  ]
}
```

### El campo `precio_vigente`
Aparece solo cuando pasás `fecha_desde`. Si `precio_vigente: false` la estación tiene el precio desactualizado respecto a la fecha pedida.

**Nota:** Cuando usás `fecha_desde` y ninguna estación tiene precio vigente, la API devuelve `total: 0` con `advertencia_fecha` en `ubicacion_resuelta`. Manejar ese caso mostrando mensaje al usuario.

---

## Casos especiales

### CABA
CABA no tiene barrios en el dataset — todas las estaciones están bajo "Capital Federal". **Siempre pasar GPS o barrio para CABA**, de lo contrario la API devuelve HTTP 400:

```
GET /precios/smart?provincia=CABA&barrio=Palermo&radio_km=3
GET /precios/smart?lat=-34.5765&lon=-58.4338&radio_km=2
```

Si mandás `provincia=CABA` sin GPS ni barrio:
```json
// HTTP 400
{
  "error": "Para buscar en CABA necesitás especificar barrio o coordenadas GPS.",
  "ejemplo": "/precios/smart?provincia=CABA&barrio=Palermo&radio_km=3",
  "barrios_ejemplo": ["Palermo", "Belgrano", "Recoleta", "Villa Crespo", "Caballito", "Flores"]
}
```

---

## Endpoints de soporte

### Provincias disponibles
```
GET /provincias
→ ["BUENOS AIRES", "CABA", "CORDOBA", ...]
```

### Localidades por provincia
```
GET /localidades?provincia=BUENOS AIRES
→ { "total": 333, "localidades": ["ADROGUE", "ALBERTI", ...] }
```

### Estadísticas de zona
```
GET /precios/estadisticas?provincia=BUENOS AIRES&localidad=MORON
→ Min / max / promedio / mediana por producto y bandera
```

### Timeline de precios (para graficar evolución)
```
GET /precios/timeline?provincia=BUENOS AIRES&localidad=MORON&producto=Nafta (súper) entre 92 y 95 Ron
→ {
    "puntos": [
      { "fecha": "2026-01-10", "min": 1100, "max": 1250, "promedio": 1180, "mediana": 1190, "cantidad": 12 },
      { "fecha": "2026-02-01", "min": 1200, "max": 1350, ... }
    ],
    "variacion_pct": 8.5    // variación % entre primer y último punto
  }
```

---

## Ejemplos de requests típicos

```
# Usuario en Martínez con GPS
GET /precios/smart?lat=-34.4893&lon=-58.7032&producto=Nafta (súper) entre 92 y 95 Ron&radio_km=5

# Usuario escribe su localidad
GET /precios/smart?provincia=BUENOS AIRES&localidad=MORON&producto=Gasoil grado 2

# Buscar en Palermo CABA
GET /precios/smart?provincia=CABA&barrio=Palermo&radio_km=3

# Precios actualizados en los últimos 30 días
GET /precios/smart?provincia=CORDOBA&localidad=CORDOBA&fecha_desde=2026-02-27

# Solo GPS, sin producto (devuelve todos los productos)
GET /precios/smart?lat=-34.4893&lon=-58.7032&radio_km=3
```

---

## Checklist de implementación

- [ ] Pedir GPS en el load inicial (`navigator.geolocation.getCurrentPosition`)
- [ ] Si GPS denegado → llamar sin lat/lon (fallback IP automático)
- [ ] Chequear `ubicacion_aproximada` en la respuesta → mostrar aviso si es `true`
- [ ] Manejar HTTP 400 en CABA (pedir barrio al usuario)
- [ ] Manejar `total: 0` con `advertencia_fecha` (mostrar mensaje, no pantalla vacía)
- [ ] Mostrar `fecha_vigencia` formateada en cada estación
- [ ] Usar `bandera` (no `empresa`) para mostrar la marca comercial (YPF, Shell, etc.)
