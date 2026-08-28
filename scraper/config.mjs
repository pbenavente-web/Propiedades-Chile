// config.mjs — Parámetros editables de la búsqueda (scraper Playwright sobre Portal Inmobiliario).
// Ajusta estos valores y vuelve a correr:  node fetch.mjs

export const CONFIG = {
  // Comunas a buscar. El "slug" es el segmento de URL de Portal Inmobiliario.
  // La URL base se arma como:
  //   https://www.portalinmobiliario.com/venta/departamento/<slug>/<FILTROS>
  COMUNAS: [
    { nombre: "Vitacura",     slug: "vitacura-metropolitana" },
    { nombre: "Las Condes",   slug: "las-condes-metropolitana" },
    { nombre: "Lo Barnechea", slug: "lo-barnechea-metropolitana" },
  ],

  // Filtros mínimos "duros" que van en la URL (piso). El refinamiento fino se hace en el dashboard.
  // Se traducen a los tokens de URL de MercadoLibre (BEDROOMS, FULL*BATHROOMS, PARKING*LOTS).
  MIN_DORMITORIOS: 3,
  MIN_BANOS: 2,
  MIN_ESTACIONAMIENTOS: 1,

  // Condición: usado. (Portal Inmobiliario usa el filtro ITEM_CONDITION; "usada" = solo usados.)
  SOLO_USADAS: true,

  // Valor UF fijo para convertir publicaciones que vengan en pesos (CLP).
  // Actualízalo con el valor UF del día que corras el scraper.
  UF_VALOR: 39000,

  // Rango de precio en UF. Acota el universo (y así podemos sacar GPS a TODOS).
  // Ajústalo a tu presupuesto real. Descarta también precios absurdos (basura).
  PRECIO_UF_MIN: 5000,
  PRECIO_UF_MAX: 15000,

  // Filtro de superficie útil (m²). Solo se guardan propiedades dentro de este rango.
  SUP_UTIL_MIN: 100,
  SUP_UTIL_MAX: 200,

  // Paginación: cuántas páginas máximo por comuna (cada página ~48 resultados).
  // Portal Inmobiliario limita a ~42 páginas (2000 resultados). Sube/baja según necesites.
  MAX_PAGINAS: 42,

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
  MAX_FICHAS_DETALLE: 4000, // tope de fichas a visitar. Con precio 5k–15k UF el universo queda ~3.500,
                            // así que 4000 cubre TODAS: cada propiedad tendrá GPS y campos de ficha.

  // Comunas válidas: se descarta cualquier propiedad cuya comuna no esté aquí (filtra basura
  // tipo "Punta Cana" mal categorizada). Debe coincidir con los nombres de COMUNAS.
  COMUNAS_VALIDAS: ["Vitacura", "Las Condes", "Lo Barnechea"],

  // Salida
  OUTPUT: "../data/datos.json",
};
