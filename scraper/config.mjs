// config.mjs — Parámetros editables de la búsqueda (scraper Playwright sobre Portal Inmobiliario).
//
// El scraper sirve DOS operaciones con el mismo motor:
//   • venta    (compra)  → precios en UF   → genera  ../data/datos.json
//   • arriendo (arriendo) → precios en CLP/mes → genera ../data/datos-arriendo.json
//
// Elige la operación con la variable de entorno OP al correr:
//   node fetch.mjs                 → venta  (compra, por defecto)
//   OP=arriendo node fetch.mjs     → arriendo
//
// Ajusta los valores de cada bloque y vuelve a correr.

// Operación activa: "venta" (compra) o "arriendo". Por defecto, venta.
export const OPERACION = process.env.OP === "arriendo" ? "arriendo" : "venta";

// ── Parámetros comunes a ambas operaciones ─────────────────────────────────
const COMUN = {
  // Comunas a buscar. El "slug" es el segmento de URL de Portal Inmobiliario.
  // La URL base se arma como:
  //   https://www.portalinmobiliario.com/<venta|arriendo>/departamento/<slug>/<FILTROS>
  COMUNAS: [
    { nombre: "Vitacura",     slug: "vitacura-metropolitana" },
    { nombre: "Las Condes",   slug: "las-condes-metropolitana" },
    { nombre: "Lo Barnechea", slug: "lo-barnechea-metropolitana" },
  ],

  // Comunas válidas: se descarta cualquier propiedad cuya comuna no esté aquí (filtra basura
  // tipo "Punta Cana" mal categorizada). Debe coincidir con los nombres de COMUNAS.
  COMUNAS_VALIDAS: ["Vitacura", "Las Condes", "Lo Barnechea"],

  // Valor UF. En venta convierte publicaciones en pesos → UF; en arriendo convierte
  // publicaciones en UF → pesos (algunos arriendos se publican en UF).
  // Editable: cambia el número aquí, o pásalo desde la terminal:  UF_VALOR=41065 node fetch.mjs
  UF_VALOR: process.env.UF_VALOR ? Number(process.env.UF_VALOR) : 41065,

  // Paginación: cuántas páginas máximo por comuna (cada página ~48 resultados).
  // Portal Inmobiliario limita a ~42 páginas (2000 resultados). Sube/baja según necesites.
  // Se puede acotar desde la terminal para pruebas rápidas:  MAX_PAGINAS=2 node fetch.mjs
  MAX_PAGINAS: process.env.MAX_PAGINAS ? Number(process.env.MAX_PAGINAS) : 42,

  // Navegador
  // HEADLESS true = sin ventana; false = ves el navegador (útil para depurar).
  // Puedes forzarlo desde la terminal con:  HEADLESS=false node fetch.mjs
  HEADLESS: process.env.HEADLESS ? process.env.HEADLESS !== "false" : true,
  DELAY_MS: 1200,        // pausa entre páginas (cortesía anti-bloqueo)
  TIMEOUT_MS: 45000,     // timeout de carga por página
  NAV_RETRIES: 3,        // reintentos por página ante fallo/timeout

  // Detalle: si true, entra a cada ficha para sacar GPS, estacionamientos y antigüedad
  // (más lento pero trae coordenadas para el mapa). Si false, solo usa el listado.
  VISITAR_FICHAS: true,
  MAX_FICHAS_DETALLE: 4000, // tope de fichas a visitar (GPS + campos de ficha).
};

// ── Parámetros SOLO de venta (compra) ──────────────────────────────────────
const VENTA = {
  OPERACION: "venta",
  // Filtros mínimos "duros" que van en la URL (piso). El refinamiento fino se hace en el dashboard.
  MIN_DORMITORIOS: 3,
  MIN_BANOS: 2,
  MIN_ESTACIONAMIENTOS: 1,
  // Condición: usado. (Portal Inmobiliario usa ITEM_CONDITION; "usada" = solo usados.)
  SOLO_USADAS: true,
  // Precio en UF. Acota el universo (y así podemos sacar GPS a TODOS).
  PRECIO_MIN: 5000,
  PRECIO_MAX: 15000,
  // Filtro de superficie útil (m²). Solo se guardan propiedades dentro de este rango.
  SUP_UTIL_MIN: 100,
  SUP_UTIL_MAX: 200,
  OUTPUT: "../data/datos.json",
};

// ── Parámetros SOLO de arriendo ────────────────────────────────────────────
const ARRIENDO = {
  OPERACION: "arriendo",
  // Mínimos más flexibles: captura más arriendos (2+ dorm, 1+ baño, sin exigir estacionamiento).
  MIN_DORMITORIOS: 2,
  MIN_BANOS: 1,
  MIN_ESTACIONAMIENTOS: 0,
  // En arriendo no aplica el filtro usado/nuevo de la misma forma: lo dejamos abierto.
  SOLO_USADAS: false,
  // Precio MENSUAL en pesos (CLP). Rango objetivo del arriendo.
  PRECIO_MIN: 800000,
  PRECIO_MAX: 2000000,
  // Sin tope de superficie para arriendo (null = no filtra).
  SUP_UTIL_MIN: null,
  SUP_UTIL_MAX: null,
  OUTPUT: "../data/datos-arriendo.json",
};

// CONFIG final = comunes + los de la operación activa.
export const CONFIG = {
  ...COMUN,
  ...(OPERACION === "arriendo" ? ARRIENDO : VENTA),
  // La moneda del precio depende de la operación: UF en venta, CLP/mes en arriendo.
  MONEDA: OPERACION === "arriendo" ? "CLP" : "UF",
};
