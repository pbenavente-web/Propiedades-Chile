# 🏢 Buscador de Departamentos — Vitacura · Las Condes · Lo Barnechea

Búsqueda masiva de departamentos en **Portal Inmobiliario** (portalinmobiliario.com) para
dos operaciones — **Compra** (venta/usados, precios en UF) y **Arriendo** (mensual, precios
en pesos CLP) — con un **dashboard interactivo**: toggle Compra/Arriendo, filtros en vivo,
mapa con la ubicación GPS de cada propiedad y tabla ordenable.

> **Nota sobre el método:** la API pública de MercadoLibre dejó de permitir búsquedas anónimas
> del catálogo (responde `403`). Por eso el recolector usa **Playwright** (un navegador Chromium
> real que navega el sitio como un usuario). Es para **uso personal y de bajo volumen**.

## Estructura

```
PropiedadCompra/
├── scraper/
│   ├── config.mjs         # ← EDITA AQUÍ: comunas, mínimos, valor UF, precio (bloques VENTA / ARRIENDO)
│   ├── fetch.mjs          # Recolector (corre en TU terminal). Sirve compra Y arriendo.
│   └── package.json
├── data/
│   ├── datos.sample.json           # Muestra de compra (para ver el dashboard sin correr nada)
│   ├── datos.json                  # ← Compra: se genera con  node fetch.mjs
│   ├── datos-arriendo.sample.json  # Muestra de arriendo
│   └── datos-arriendo.json         # ← Arriendo: se genera con  OP=arriendo node fetch.mjs
├── dashboard/
│   └── index.html         # Dashboard interactivo (toggle Compra/Arriendo)
└── README.md
```

## Compra vs. Arriendo

El **mismo motor** recolecta ambas operaciones; se elige con la variable de entorno `OP`:

| Operación | Comando                      | Precio    | Archivo generado           | Mínimos por defecto        |
|-----------|------------------------------|-----------|----------------------------|----------------------------|
| Compra    | `node fetch.mjs`             | UF        | `data/datos.json`          | 3 dorm · 2 baños · 1 estac |
| Arriendo  | `OP=arriendo node fetch.mjs` | CLP/mes   | `data/datos-arriendo.json` | 2 dorm · 1 baño · 0 estac  |

Cada propiedad lleva un campo `operacion` (`"Compra"` o `"Arriendo"`). El dashboard carga
los **dos** archivos y los separa con el toggle **Operación** arriba de los filtros. Los
rangos y etiquetas (Precio UF ↔ Precio $/mes, UF/m² ↔ $/m²) se adaptan solos al modo activo.

Los parámetros de cada operación (precio, mínimos, superficie) viven en bloques separados
`VENTA` y `ARRIENDO` dentro de `scraper/config.mjs`.

> **Protección anti-borrado:** si una corrida devuelve 0 resultados (típico de un captcha o
> bloqueo), el scraper **no** sobrescribe el archivo — conserva los datos buenos previos.

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

**Compra** (venta/usados, precios en UF):

```bash
cd /Users/pbenavente/claude-projects/PropiedadCompra/scraper
node fetch.mjs
```

**Arriendo** (mensual, precios en pesos CLP):

```bash
cd /Users/pbenavente/claude-projects/PropiedadCompra/scraper
OP=arriendo node fetch.mjs
```

> Prueba rápida (sin recolectar todo): `OP=arriendo MAX_PAGINAS=2 MAX_FICHAS=30 node fetch.mjs`.

Compra crea `../data/datos.json` y arriendo `../data/datos-arriendo.json`. Verás el avance por comuna, por ejemplo:

```
  Vitacura: 210 propiedades (pág 5)
  Las Condes: 415 propiedades (pág 9)
  Lo Barnechea: 120 propiedades (pág 3)
Visitando 400 fichas para GPS y atributos…
✓ Listo: 728 propiedades escritas en .../data/datos.json
  690 con coordenadas GPS (aparecerán en el mapa).
```

### Antes de correr, revisa `scraper/config.mjs`

Los parámetros están en dos bloques: `VENTA` (compra) y `ARRIENDO`. Edita el que corresponda.

- **`UF_VALOR`** (común) → pon el valor UF del día (convierte entre UF y pesos).
- **`MIN_DORMITORIOS / MIN_BANOS / MIN_ESTACIONAMIENTOS`** → pisos de la búsqueda (van en la URL).
- **`COMUNAS`** (común) → el `slug` de URL de cada comuna en Portal Inmobiliario.
- **`PRECIO_MIN / MAX`** → rango de precio. En `VENTA` son **UF**; en `ARRIENDO` son **pesos/mes**.
- **`HEADLESS: false`** (común) → si algo falla, ponlo en `false` para **ver el navegador** trabajando y
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
- **Valor UF editable:** campo **"Valor UF (CLP)"** en los filtros (por defecto el UF del día). Al
  cambiarlo, el dashboard recalcula la conversión que muestra bajo cada precio (Compra: UF → pesos;
  Arriendo: pesos → UF). Se guarda en el navegador; el botón **"UF hoy"** lo restablece.
- **Favoritos por operación:** los ⭐ se cuentan y muestran separados por **Compra** y **Arriendo** (el
  contador refleja la operación activa). En la tabla, los favoritos se **fijan arriba**, resaltados con
  borde dorado y separados del resto por una fila divisoria.
- **Mapa:** cada punto es una propiedad, coloreada por comuna. Click → popup con datos + link.
- **Tabla:** click en una fila centra el mapa en esa propiedad. Click en los encabezados ordena.
- **Resumen:** cantidad de resultados, precio promedio/mediana y precio/m² promedio (UF o $/mes según modo).

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
