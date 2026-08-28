# 🏢 Buscador de Departamentos — Vitacura · Las Condes · Lo Barnechea

Búsqueda masiva de departamentos **en venta / usados** en **Portal Inmobiliario**
(portalinmobiliario.com), con un **dashboard interactivo**: filtros en vivo, mapa con la
ubicación GPS de cada propiedad y tabla ordenable.

> **Nota sobre el método:** la API pública de MercadoLibre dejó de permitir búsquedas anónimas
> del catálogo (responde `403`). Por eso el recolector usa **Playwright** (un navegador Chromium
> real que navega el sitio como un usuario). Es para **uso personal y de bajo volumen**.

## Estructura

```
PropiedadCompra/
├── scraper/
│   ├── config.mjs         # ← EDITA AQUÍ: comunas, mínimos, valor UF, precio
│   ├── fetch.mjs          # Recolector (corre en TU terminal)
│   └── package.json
├── data/
│   ├── datos.sample.json  # Datos de prueba (para ver el dashboard sin correr nada)
│   └── datos.json         # ← Se genera al correr el scraper (datos reales)
├── dashboard/
│   └── index.html         # Dashboard interactivo
└── README.md
```

## Paso 1 — Instalar (una sola vez)

> El scraper corre en tu terminal normal, **no dentro de Claude Code**.

```bash
cd /Users/pbenavente/claude-projects/PropiedadCompra/scraper
npm install
```

`npm install` descarga Playwright y el navegador Chromium (~100 MB, solo la primera vez).
Si el navegador no se instaló, córrelo a mano:

```bash
npx playwright install chromium
```

## Paso 2 — Recolectar datos

```bash
cd /Users/pbenavente/claude-projects/PropiedadCompra/scraper
node fetch.mjs
```

Esto crea `../data/datos.json`. Verás el avance por comuna, por ejemplo:

```
  Vitacura: 210 propiedades (pág 5)
  Las Condes: 415 propiedades (pág 9)
  Lo Barnechea: 120 propiedades (pág 3)
Visitando 400 fichas para GPS y atributos…
✓ Listo: 728 propiedades escritas en .../data/datos.json
  690 con coordenadas GPS (aparecerán en el mapa).
```

### Antes de correr, revisa `scraper/config.mjs`

- **`UF_VALOR`** → pon el valor UF del día (para convertir publicaciones que estén en pesos).
- **`MIN_DORMITORIOS / MIN_BANOS / MIN_ESTACIONAMIENTOS`** → pisos de la búsqueda (van en la URL).
- **`COMUNAS`** → el `slug` de URL de cada comuna en Portal Inmobiliario.
- **`PRECIO_UF_MIN / MAX`** → acotar rango si quieres (opcional).
- **`HEADLESS: false`** → si algo falla, ponlo en `false` para **ver el navegador** trabajando y
  entender qué pasa (aparece una ventana de Chromium).
- **`VISITAR_FICHAS`** → `true` entra a cada publicación para sacar GPS (más lento pero llena el
  mapa); `false` es más rápido pero con menos coordenadas.

### Si sale 0 resultados o errores de navegación

1. Pon `HEADLESS: false` en `config.mjs` y vuelve a correr para ver la ventana del navegador.
2. Verifica que las URLs de comuna sigan válidas abriéndolas tú en el navegador:
   `https://www.portalinmobiliario.com/venta/departamento/vitacura-metropolitana/`
3. Si el sitio pide resolver un captcha, corre con `HEADLESS: false` y resuélvelo manualmente una
   vez; Playwright continúa después.

## Paso 3 — Ver el dashboard

El dashboard usa `fetch()` con rutas relativas, así que **necesita un servidor** (no abrir el
HTML con doble clic). Levanta uno simple desde la raíz del proyecto:

```bash
cd /Users/pbenavente/claude-projects/PropiedadCompra
python3 -m http.server 8777
```

Luego abre en el navegador:

```
http://localhost:8777/dashboard/
```

- Si existe `data/datos.json` (datos reales), lo usa.
- Si no, cae automáticamente a `data/datos.sample.json` y muestra el banner **"Datos de MUESTRA"**.

## Qué puedes hacer en el dashboard

- **Filtrar en vivo:** comuna, precio UF, dormitorios/baños/estacionamientos mínimos, antigüedad,
  superficie total y útil, y **UF/m² útil** (el indicador de conveniencia).
- **Mapa:** cada punto es una propiedad, coloreada por comuna. Click → popup con datos + link.
- **Tabla:** click en una fila centra el mapa en esa propiedad. Click en los encabezados ordena.
- **Resumen:** cantidad de resultados, precio UF promedio/mediana y UF/m² promedio.

## Campos que se extraen

Tipo, operación, comuna, dormitorios, baños, estacionamientos, antigüedad, superficie total y útil,
precio en UF, URL de la publicación, GPS (lat/lng), UF/m² útil, características destacadas y
**nombre del publicante**.

> ⚠️ **Contacto:** Portal Inmobiliario **no expone** email ni teléfono del vendedor (están detrás
> de un formulario). Solo se obtiene el nombre del publicante/inmobiliaria cuando está disponible.
> Para contactar, abre la URL de la publicación.

## Notas

- Portal Inmobiliario limita la búsqueda a ~2000 resultados por comuna (≈42 páginas). El scraper
  respeta ese tope (`MAX_PAGINAS` en config).
- Datos faltantes se muestran como "—" y **no descartan** la propiedad en los filtros.
- Uso personal y de bajo volumen. Las pausas entre páginas (`DELAY_MS`) evitan sobrecargar el sitio.
- Si el sitio cambia su estructura interna, el scraper puede necesitar ajustes; corre con
  `HEADLESS: false` para diagnosticar.
