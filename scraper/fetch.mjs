// fetch.mjs — Recolector de departamentos de Portal Inmobiliario (MercadoLibre Chile) vía Playwright.
//
// IMPORTANTE: correr en TU terminal (fuera de Claude Code).
//   cd PropiedadCompra/scraper
//   npm install            # una sola vez (instala playwright + chromium)
//   node fetch.mjs         # o:  HEADLESS=false node fetch.mjs  (para ver el navegador)
//
// Estrategia (verificada contra el HTML real del sitio):
//   - Los resultados están en el DOM como tarjetas ".poly-card".
//   - Precio en UF: aria-label del ".poly-price__amount" (ej. "6290 unidades de fomento").
//   - Dorm/baños/m²: textos de ".poly-attributes_list__item".
//   - Comuna/dirección: ".poly-component__location".  Título+link: ".poly-component__title".
//   - Publicante: ".poly-component__seller".  Pill "PROYECTO" marca proyecto nuevo (vs usado).
//   - Paginación: sufijo _Desde_49, _Desde_97, … (de a 48).
//   - GPS: no viene en el listado; se saca visitando la ficha (opcional, VISITAR_FICHAS).

import { CONFIG, OPERACION } from "./config.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://www.portalinmobiliario.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Etiqueta para los mensajes de progreso según la operación activa.
const ITEM_LABEL = OPERACION === "arriendo" ? "arriendos" : "usados";

// Carpeta de la sesión persistente del navegador (cookies + login). Se guarda aquí
// para reutilizar la sesión entre corridas: te logueas UNA vez y las próximas ya
// quedan autenticadas. NUNCA se commitea (ver .gitignore) — es tu sesión privada.
const USER_DATA_DIR = resolve(__dirname, ".session");

const LAUNCH_ARGS = [
  "--disable-features=DownloadableFontsPruning",
  "--font-render-hinting=none",
  "--disable-remote-fonts", // evita los popups "descargar tipo de letra Osaka/STHeiti"
  "--disable-blink-features=AutomationControlled", // reduce el flag trivial de "navegador automatizado"
];

// Pausa interactiva: espera a que presiones ENTER en la terminal.
function esperarEnter(mensaje) {
  return new Promise((resolve) => {
    process.stdout.write(mensaje);
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
  });
}

// Abre el sitio y espera a que TÚ te loguees / pases la verificación en la ventana.
// Solo tiene sentido en modo visible (headed). Tú ingresas tus credenciales; el
// script no las toca. Al presionar ENTER, continúa con la sesión ya autenticada.
async function pausaLoginManual(context) {
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS }).catch(() => {});
  } catch { /* da igual: lo importante es que la ventana quede abierta */ }
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("  INICIA SESIÓN EN LA VENTANA DEL NAVEGADOR");
  console.log("  • Si aparece verificación o pide credenciales, hazlo TÚ ahí.");
  console.log("  • Cuando veas el sitio normal (ya logueado), vuelve aquí.");
  console.log("  • La sesión queda guardada para las próximas corridas.");
  console.log("──────────────────────────────────────────────────────────────");
  await esperarEnter("\n  ⏎  Presiona ENTER cuando estés listo para empezar a recolectar… ");
  try { await page.close(); } catch {}
}

// ---------- construcción de URL con filtros ----------
function buildUrl(comuna, desde) {
  // La ruta cambia según la operación: /venta/… (compra) o /arriendo/… (arriendo).
  const opPath = OPERACION === "arriendo" ? "arriendo" : "venta";
  let url = `${BASE}/${opPath}/departamento/${comuna.slug}`;
  const tokens = [];
  if (CONFIG.MIN_DORMITORIOS > 0) tokens.push(`_BEDROOMS_${CONFIG.MIN_DORMITORIOS}-*`);
  if (CONFIG.MIN_BANOS > 0) tokens.push(`_FULL*BATHROOMS_${CONFIG.MIN_BANOS}-*`);
  if (CONFIG.MIN_ESTACIONAMIENTOS > 0) tokens.push(`_PARKING*LOTS_${CONFIG.MIN_ESTACIONAMIENTOS}-*`);
  if (CONFIG.SOLO_USADAS) tokens.push(`_ITEM*CONDITION_2230581`); // 2230581 = usado (solo venta)
  tokens.push(`_OrderId_PRICE`);
  if (desde && desde > 1) tokens.push(`_Desde_${desde}`);
  tokens.push(`_NoIndex_True`);
  if (tokens.length) url += "/" + tokens.join("");
  return url;
}

// ---------- parseo de textos ----------
function parseRango(txt) {
  // "2 a 3 dormitorios" → {min:2,max:3};  "43 - 86 m²" → {min:43,max:86};  "120 m²" → {min:120,max:120}
  if (!txt) return null;
  const nums = (txt.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(",", ".")));
  if (!nums.length) return null;
  return { min: nums[0], max: nums[nums.length - 1] };
}

// De un rango, para filtros de "mínimo" usamos el mínimo; para superficie mostramos el rango o el punto.
function valorRepresentativo(rango) {
  if (!rango) return null;
  return rango.min; // el piso; el dashboard filtra con "mínimo"
}

// Portal Inmobiliario muestra la orientación abreviada (N, S, O, P, NO, SP, NOSP…).
// La pasamos a palabras legibles para el dashboard. En Chile: O=Oriente, P=Poniente.
function normalizarOrientacion(raw) {
  if (!raw) return null;
  const code = raw.trim().toUpperCase().replace(/[^NSOP]/g, "");
  if (!code) return null;
  const mapa = {
    N: "Norte", S: "Sur", O: "Oriente", P: "Poniente",
    NO: "Nororiente", NP: "Norponiente", SO: "Suroriente", SP: "Surponiente",
    NOSP: "Nororiente-Surponiente", NOSO: "Nororiente-Suroriente",
    NPSP: "Norponiente-Surponiente", NPSO: "Norponiente-Suroriente",
  };
  return mapa[code] || raw.trim().replace(/\s+/g, " ").toUpperCase();
}

// ---------- extracción del listado (en el navegador) ----------
async function extraerTarjetas(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".poly-card")];
    return cards.map((card) => {
      const q = (sel) => card.querySelector(sel);
      const titleEl = q(".poly-component__title");
      const linkEl = titleEl?.closest("a") || q("a.poly-component__title") || q(".poly-component__title a") || q("a[href*='MLC']");
      const priceEl = q(".poly-price__amount");
      const attrs = [...card.querySelectorAll(".poly-attributes_list__item")].map((e) => e.textContent.trim());
      const pill = q(".poly-pill__pill")?.textContent.trim() || null;

      // foto principal: MercadoLibre hace lazy-load → la URL real suele venir en data-src, no en src (placeholder).
      const imgEl = q(".poly-card__portada img") || q("img.poly-component__picture") || q("img");
      let imagen = null;
      if (imgEl) {
        const cand = imgEl.getAttribute("data-src") || imgEl.getAttribute("src") || "";
        const srcset = imgEl.getAttribute("srcset") || "";
        imagen = cand && !/^data:/.test(cand) ? cand
               : (srcset ? srcset.split(",")[0].trim().split(" ")[0] : null);
      }

      // Precio en su unidad NATIVA: UF ("6290 unidades de fomento") o CLP ("1500000 pesos").
      // precioNum queda en esa unidad; monedaTxt indica cuál. En venta suele ser UF; en
      // arriendo suele ser CLP/mes. La conversión entre monedas se hace luego en Node.
      let precioNum = null, monedaTxt = null;
      if (priceEl) {
        const aria = priceEl.getAttribute("aria-label") || "";
        const mUF = aria.match(/([\d.]+)\s*unidades de fomento/i);
        const mPeso = aria.match(/([\d.]+)\s*pesos/i);
        if (mUF) { precioNum = Number(mUF[1].replace(/\./g, "")); monedaTxt = "UF"; }
        else if (mPeso) { precioNum = Number(mPeso[1].replace(/\./g, "")); monedaTxt = "CLP"; }
        if (precioNum == null) {
          const t = priceEl.textContent.replace(/[^\d]/g, "");
          if (t) precioNum = Number(t);
        }
      }
      // ¿el precio está en pesos? el prefijo lo indica
      const prefix = q(".poly-price__prefix")?.textContent.trim() || "";
      const esPeso = /\$/.test(prefix) && !/UF/i.test(prefix);

      return {
        title: titleEl?.textContent.trim() || null,
        url: linkEl?.getAttribute("href") || null,
        location: q(".poly-component__location")?.textContent.trim() || null,
        seller: q(".poly-component__seller")?.textContent.trim() || null,
        attrs,
        pill,
        imagen,
        precioNum,
        monedaTxt: monedaTxt || (esPeso ? "CLP" : null),
      };
    });
  });
}

// ---------- normalización al esquema del dashboard ----------
function normalize(raw, comunaNombre, detalle = {}) {
  // atributos: buscar por palabra clave en los textos de la tarjeta
  let dorm = null, banos = null, sutil = null, stot = null, estac = null;
  for (const a of raw.attrs || []) {
    const low = a.toLowerCase();
    const r = parseRango(a);
    if (/dormitor/.test(low)) dorm = valorRepresentativo(r);
    else if (/baño|bano/.test(low)) banos = valorRepresentativo(r);
    else if (/útil|util/.test(low)) sutil = r ? r.max : null;      // superficie útil
    else if (/total/.test(low)) stot = r ? r.max : null;           // superficie total
    else if (/m²|m2|metros/.test(low)) {                           // "X m²" genérico → total
      if (stot == null) stot = r ? r.max : null;
    } else if (/estacion/.test(low)) estac = valorRepresentativo(r);
  }
  // Coherencia: la útil nunca puede ser mayor que la total. Si el listado las cruzó, corregir.
  if (sutil != null && stot != null && sutil > stot) { const t = sutil; sutil = stot; stot = t; }
  // Si solo hay una superficie, tratarla como útil (es la que más aparece en los listados).
  if (sutil == null && stot != null) { sutil = stot; stot = null; }

  // precio — depende de la operación:
  //   venta    → precio_uf  (si viene en pesos, se convierte a UF con UF_VALOR)
  //   arriendo → precio_clp (pesos/mes; si viene en UF, se convierte a pesos con UF_VALOR)
  const esArriendo = OPERACION === "arriendo";
  let precio_uf = null, precio_clp = null, moneda = raw.monedaTxt;
  if (esArriendo) {
    if (raw.monedaTxt === "CLP") precio_clp = raw.precioNum;
    else if (raw.monedaTxt === "UF" && raw.precioNum && CONFIG.UF_VALOR > 0)
      precio_clp = Math.round(raw.precioNum * CONFIG.UF_VALOR);
    else if (raw.precioNum) precio_clp = raw.precioNum; // asumir CLP si no hay pista
  } else {
    if (raw.monedaTxt === "UF") precio_uf = raw.precioNum;
    else if (raw.monedaTxt === "CLP" && raw.precioNum && CONFIG.UF_VALOR > 0)
      precio_uf = Math.round(raw.precioNum / CONFIG.UF_VALOR);
    else if (raw.precioNum) precio_uf = raw.precioNum; // asumir UF si no hay pista de peso
  }

  // superficie desde detalle si el listado no la tenía
  sutil = sutil ?? detalle.superficie_util ?? null;
  stot = stot ?? detalle.superficie_total ?? null;

  const uf_m2_util = precio_uf && sutil ? Math.round((precio_uf / sutil) * 10) / 10 : null;
  // $/m² útil: equivalente al UF/m² pero en pesos (indicador de conveniencia del arriendo).
  const clp_m2_util = precio_clp && sutil ? Math.round(precio_clp / sutil) : null;

  // comuna: última parte de la ubicación suele ser la comuna
  let comuna = comunaNombre;
  if (raw.location) {
    const parts = raw.location.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) comuna = parts[parts.length - 1];
  }

  // URL limpia (quitar #polycard y tracking)
  let url = raw.url;
  if (url) url = url.split("#")[0].split("?")[0];

  const esProyecto = /proyecto/i.test(raw.pill || "");

  // Jardín y dúplex: detectables ya desde el título (cobertura 100%, sin visitar ficha).
  // Jardín = palabra exacta "jardín/jardin" o "antejardín/antejardin". Se EXCLUYE el plural
  // "jardines" (áreas comunes del condominio, no jardín propio). No cuenta "patio".
  const tituloLow = (raw.title || "").toLowerCase();
  let jardin = /\b(?:ante)?jard[ií]n(?!es)\b/.test(tituloLow) ? true : null;
  let duplex = /d[uú]plex|dos niveles|2 niveles/.test(tituloLow) ? true : null;
  // Si el detalle (ficha) ya los resolvió, tiene prioridad.
  if (detalle.jardin != null) jardin = detalle.jardin;
  if (detalle.duplex != null) duplex = detalle.duplex;

  const destacadas = [];
  if (esProyecto) destacadas.push("Proyecto nuevo");
  if (jardin) destacadas.push("Jardín");
  if (duplex) destacadas.push("Dúplex");
  if (detalle.destacadas) destacadas.push(...detalle.destacadas);

  return {
    tipo: "Departamento",
    operacion: esArriendo ? "Arriendo" : "Compra",
    modalidad: esArriendo ? "Arriendo" : (esProyecto ? "Proyecto" : "Usado"),
    comuna,
    dormitorios: dorm ?? detalle.dormitorios ?? null,
    banos: banos ?? detalle.banos ?? null,
    estacionamientos: estac ?? detalle.estacionamientos ?? null,
    antiguedad: detalle.antiguedad ?? null,
    superficie_total: stot,
    superficie_util: sutil,
    precio_uf: precio_uf != null ? Math.round(precio_uf) : null,
    precio_clp: precio_clp != null ? Math.round(precio_clp) : null,
    clp_m2_util,
    moneda_original: moneda,
    url,
    lat: detalle.lat ?? null,
    lng: detalle.lng ?? null,
    uf_m2_util,
    imagen: raw.imagen ?? detalle.imagen ?? null,
    bodega: detalle.bodega ?? null,
    orientacion: detalle.orientacion ?? null,
    piso: detalle.piso ?? null,
    gastos_comunes: detalle.gastos_comunes ?? null,
    jardin,
    duplex,
    titulo: raw.title,
    caracteristicas: destacadas,
    publicante: raw.seller ? raw.seller.replace(/&amp;/g, "&") : (detalle.publicante ?? null),
    email: null,
    telefono: null,
    descripcion: null,
    barrio: null,
    id: url || raw.title,
  };
}

// ---------- detalle de ficha (GPS + antigüedad) ----------
async function scrapeFicha(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
    // La ficha es una SPA de React: hay que esperar a que HIDRATE, no un tiempo fijo.
    // Esperamos a que aparezca el breadcrumb (o, en su defecto, la tabla de specs o el mapa).
    // Con 1500 ms fijos el DOM venía vacío y todo salía null (solo ~10 fichas con GPS).
    try {
      await page.waitForSelector(".andes-breadcrumb__item, .andes-table__row, img[src*='staticmap']", { timeout: 12000 });
    } catch { /* si no aparece, seguimos igual y leemos lo que haya */ }
    await page.waitForTimeout(400); // pequeño colchón para que terminen de pintar specs/desc
    const res = await page.evaluate(() => {
      const res = { lat: null, lng: null, antiguedad: null, superficie_util: null, superficie_total: null, estacionamientos: null, imagen: null, bodega: null, orientacion: null, orientacion_raw: null, piso: null, gastos_comunes: null, jardin: null, duplex: null, destacadas: [], descripcion: null, barrio_breadcrumb: null };
      // GPS desde mapa estático de Google
      const mapImg = document.querySelector('img[src*="staticmap"], img[src*="maps.google"]');
      if (mapImg) {
        const m = mapImg.src.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
        if (m) { res.lat = parseFloat(m[1]); res.lng = parseFloat(m[2]); }
      }
      // foto principal de la galería (respaldo si el listado no la trajo)
      const gal = document.querySelector(".ui-pdp-gallery__figure img, figure.ui-pdp-gallery__figure img, .ui-pdp-image");
      if (gal) {
        const cand = gal.getAttribute("data-zoom") || gal.getAttribute("data-src") || gal.getAttribute("src") || "";
        if (cand && !/^data:/.test(cand)) res.imagen = cand;
      }
      // Tabla de especificaciones (clave→valor)
      const rows = document.querySelectorAll(".ui-pdp-specs__table tr, .andes-table__row, .ui-vpp-highlighted-specs__key-value");
      rows.forEach((row) => {
        const txt = row.textContent.replace(/\s+/g, " ").trim().toLowerCase();
        const numM = txt.match(/(\d+(?:[.,]\d+)?)/);
        const val = numM ? Number(numM[1].replace(/\./g, "").replace(",", ".")) : null;
        if (/antigüedad|antiguedad/.test(txt) && val != null) res.antiguedad = val;
        else if (/superficie útil|superficie util/.test(txt) && val != null) res.superficie_util = val;
        else if (/superficie total/.test(txt) && val != null) res.superficie_total = val;
        else if (/estacionamiento|cocheras/.test(txt) && val != null) res.estacionamientos = val;
        else if (/bodega/.test(txt)) {
          // "Bodegas 1" → 1;  "Bodega Sí/No"
          if (val != null) res.bodega = val > 0;
          else if (/\bsí\b|\bsi\b/.test(txt)) res.bodega = true;
          else if (/\bno\b/.test(txt)) res.bodega = false;
        }
        else if (/orientaci[oó]n/.test(txt)) {
          // Se extrae CRUDO en el navegador y se normaliza en Node (la función
          // normalizarOrientacion vive en el módulo, no en el contexto del page).
          const m = txt.match(/orientaci[oó]n\s*:?\s*([a-zñ /\-]+)/);
          if (m) res.orientacion_raw = m[1];
        }
        else if (/piso de la unidad|n[uú]mero de piso|piso n/.test(txt) && val != null) res.piso = val;
        else if (/gastos? comunes/.test(txt) && val != null) res.gastos_comunes = val; // CLP
        else if (/superficie (de )?jard[ií]n/.test(txt)) res.jardin = (val != null ? val > 0 : true);
      });

      // Amenidades detectadas en la descripción libre (texto del anuncio).
      const descEl = document.querySelector(".ui-pdp-description__content, .ui-pdp-description, [data-testid='content']");
      const descRaw = (descEl?.textContent || "").replace(/\s+/g, " ").replace(/^\s*Descripci[oó]n\s*/i, "").trim();
      if (descRaw) res.descripcion = descRaw; // texto original legible (para el buscador del dashboard)
      const desc = descRaw.toLowerCase();     // copia en minúsculas solo para los regex de amenidades
      if (desc) {
        // Jardín como booleano: palabra exacta "jardín/jardin" o "antejardín/antejardin".
        // Se EXCLUYE el plural "jardines" (áreas comunes, no jardín propio). No cuenta "patio".
        if (res.jardin == null && /\b(?:ante)?jard[ií]n(?!es)\b/.test(desc)) res.jardin = true;
        if (res.duplex == null && /d[uú]plex|dos niveles|2 niveles|doble altura/.test(desc)) res.duplex = true;
        // Primer piso mencionado en el texto → refuerza jardín (típico de deptos con jardín).
        if (res.piso == null && /(primer piso|piso 1\b|1er piso)/.test(desc)) res.piso = 1;
        const amenidades = [
          [/piscina/, "Piscina"],
          [/terraza/, "Terraza"],
          [/quincho/, "Quincho"],
          [/gimnasio|gym/, "Gimnasio"],
          [/logia/, "Logia"],
          [/bodega/, "Bodega"],
          [/remodelad[oa]|renovad[oa]/, "Remodelado"],
          [/ideal invers|para invers|inversi[oó]n/, "Ideal inversión"],
          [/vista (al |despejada|panor|mar|cordillera|parque)/, "Vista"],
          [/conserjer[ií]a|24 ?horas|24\/7/, "Conserjería 24h"],
          [/estacionamiento(s)? (de |para )?visitas/, "Estac. visitas"],
          [/amoblad[oa]/, "Amoblado"],
          [/calefacci[oó]n central/, "Calefacción central"],
          [/sala (de )?(multiuso|eventos|juegos)/, "Sala multiuso"],
        ];
        for (const [re, etiqueta] of amenidades) if (re.test(desc)) res.destacadas.push(etiqueta);
      }

      // Barrio desde el breadcrumb de la ficha (fuente oficial de Portal Inmobiliario).
      // Ej: Inicio > Propiedades usadas > RM (Metropolitana) > Vitacura > Parque Bicentenario
      // Probamos varios selectores por robustez ante cambios de clase de MercadoLibre.
      const bcSel = ".andes-breadcrumb__item, .andes-breadcrumb li, .andes-breadcrumb a, nav[aria-label*='migas'] a, nav[aria-label*='readcrumb'] a, .ui-pdp-breadcrumb__item, .ui-pdp-breadcrumb a";
      const bcItems = [...document.querySelectorAll(bcSel)]
        .map((e) => e.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      // Genéricos a descartar (no son barrio). La comuna se descarta luego en Node.
      const bcGen = /^(inicio|propiedades|propiedades usadas|usadas|nuevas|departamentos?|casas?|venta|arriendo|rm|r\.?m\.?|regi[oó]n metropolitana|metropolitana|rm \(metropolitana\)|chile|volver|\.\.\.|›|>|home)$/i;
      // Nos quedamos con el ÚLTIMO item no genérico = barrio más específico.
      let bcBarrio = null;
      for (let i = bcItems.length - 1; i >= 0; i--) {
        const it = bcItems[i];
        if (it && !bcGen.test(it)) { bcBarrio = it; break; }
      }
      if (bcBarrio) res.barrio_breadcrumb = bcBarrio;

      return res;
    });
    // Normalización que corre en Node (fuera del navegador).
    if (res.orientacion_raw) res.orientacion = normalizarOrientacion(res.orientacion_raw);
    return res;
  } catch (e) {
    // Log de diagnóstico: las primeras N fallas muestran el motivo real.
    if (globalThis.__fichaFail === undefined) globalThis.__fichaFail = 0;
    globalThis.__fichaFail++;
    if (globalThis.__fichaFail <= 8) {
      console.log(`\n  ⚠️ ficha falló (#${globalThis.__fichaFail}): ${e && e.message ? e.message : e}\n     url: ${url}`);
    }
    // Si la pestaña se cayó (memoria tras muchas navegaciones), lo señalamos para
    // que el loop la recree; si no, el resto de fichas falla en cascada.
    const crashed = /Page crashed|Target closed|Target page.*closed|browser has been closed/i.test(e && e.message ? e.message : "");
    return { __crashed: crashed };
  }
}

// ---------- búsqueda por comuna ----------
async function scrapeComuna(context, comuna) {
  const page = await context.newPage();
  const out = [];
  const seen = new Set();

  const LISTA_TIMEOUT = 15000;       // timeout de carga de página de listado (más corto que fichas)
  const HARD_CAP = LISTA_TIMEOUT + 8000; // tope duro por intento: si Playwright ignora su timeout, cortamos igual
  let pagFalladas = 0;               // páginas seguidas que no cargaron nada

  for (let p = 0; p < CONFIG.MAX_PAGINAS; p++) {
    const desde = p * 48 + 1;
    const url = buildUrl(comuna, desde);
    let tarjetas = [];
    let finComuna = false; // redirect infinito = "no hay más páginas" → cortar comuna ya
    for (let attempt = 0; attempt < CONFIG.NAV_RETRIES; attempt++) {
      try {
        // Promise.race garantiza que un goto colgado (conexión que el sitio no cierra)
        // no clave el scraper para siempre, aunque Playwright ignore su propio timeout.
        await Promise.race([
          (async () => {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: LISTA_TIMEOUT });
            await page.waitForSelector(".poly-card, .ui-search-layout__item", { timeout: LISTA_TIMEOUT }).catch(() => {});
          })(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("hard-timeout")), HARD_CAP)),
        ]);
        await page.waitForTimeout(800);
        tarjetas = await extraerTarjetas(page);
        if (tarjetas.length) break;
        // Página de "fin de resultados": Portal muestra "no hay inmuebles que coincidan…"
        // al pasar el último resultado de la búsqueda filtrada. No es un bloqueo: significa
        // que esta comuna no tiene más. Cortamos YA, sin gastar reintentos ni esperar.
        const txt = (await page.evaluate(() => (document.body?.innerText || "")).catch(() => "")).toLowerCase();
        if (/no hay inmuebles que coincidan|no encontramos publicaciones|no hay publicaciones que coincidan/.test(txt)) {
          finComuna = true;
          break;
        }
      } catch (e) {
        const msg = e.message.split("\n")[0];
        // Pasado el nº real de resultados, Portal rebota la URL de paginación en loop
        // (ERR_TOO_MANY_REDIRECTS / "interrupted by another navigation"). No hay más
        // páginas: cortamos la comuna sin gastar reintentos.
        if (/TOO_MANY_REDIRECTS|interrupted by another navigation|chrome-error/.test(msg)) {
          finComuna = true;
          break;
        }
        if (attempt < CONFIG.NAV_RETRIES - 1) {
          process.stdout.write(`\r  ${comuna.nombre}: pág ${p + 1} reintentando (${msg})…     `);
          await sleep(CONFIG.DELAY_MS);
        }
      }
    }
    if (finComuna) { process.stdout.write(`\r  ${comuna.nombre}: ${out.length} ${ITEM_LABEL} (fin de resultados)     `); break; }
    if (!tarjetas.length) {
      // No cortamos a la primera: una página puntual puede fallar. Cortamos tras 2 seguidas.
      if (++pagFalladas >= 2) { process.stdout.write(`\r  ${comuna.nombre}: fin (2 páginas sin datos)     `); break; }
      continue;
    }
    pagFalladas = 0;

    let nuevos = 0;
    for (const t of tarjetas) {
      const norm = normalize(t, comuna.nombre);
      if (!norm.id || seen.has(norm.id)) continue;
      // filtrar solo usados si corresponde
      if (CONFIG.SOLO_USADAS && norm.modalidad === "Proyecto") continue;
      seen.add(norm.id);
      out.push({ norm, url: norm.url });
      nuevos++;
    }
    process.stdout.write(`\r  ${comuna.nombre}: ${out.length} ${ITEM_LABEL} (pág ${p + 1})     `);
    if (nuevos === 0) break;
    await sleep(CONFIG.DELAY_MS);
  }
  console.log("");
  await page.close();
  return out;
}

// ---------- main ----------
async function main() {
  console.log("Abriendo navegador…");
  // Contexto PERSISTENTE: guarda cookies/login en USER_DATA_DIR y los reutiliza
  // entre corridas. Así, logueándote una vez, las próximas ya quedan autenticadas.
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: CONFIG.HEADLESS,
    args: LAUNCH_ARGS,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "es-CL",
    viewport: { width: 1440, height: 900 },
  });

  // Pausa de login manual: en modo visible (o con LOGIN=1), espera a que te loguees /
  // pases la verificación antes de recolectar. Con la sesión ya guardada, puedes
  // saltarla la próxima vez corriendo headless. Esto ocurre ANTES de bloquear imágenes
  // para que puedas VER la página de login.
  if (!CONFIG.HEADLESS || process.env.LOGIN === "1") {
    await pausaLoginManual(context);
  }

  // Bloquear recursos pesados (imágenes, media, fuentes) reduce muchísimo la memoria por
  // navegación — la causa del "Page crashed" tras ~90 fichas. El GPS se saca del atributo
  // src del <img staticmap> (queda en el DOM aunque el pixel no se descargue), y la foto
  // principal se toma del listado, así que no perdemos datos.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") return route.abort();
    return route.continue();
  });

  const etiquetaOp = OPERACION === "arriendo" ? "en ARRIENDO" : "usados (COMPRA)";
  console.log(`Buscando departamentos ${etiquetaOp} en Vitacura, Las Condes y Lo Barnechea…\n`);
  const crudos = [];
  const totalesPorComuna = {};
  for (const comuna of CONFIG.COMUNAS) {
    try {
      const its = await scrapeComuna(context, comuna);
      totalesPorComuna[comuna.nombre] = its.length;
      crudos.push(...its);
    } catch (e) {
      console.error(`  ✗ Error en ${comuna.nombre}: ${e.message}`);
      totalesPorComuna[comuna.nombre] = 0;
    }
  }

  // ── 1) Dedup + filtro por comuna y precio (datos del listado) ─────────────
  // Filtramos ANTES de visitar fichas para no gastar navegaciones en basura o
  // en propiedades fuera de precio. La superficie útil se filtra DESPUÉS (su
  // dato a veces solo aparece en la ficha).
  const props = crudos.map((c) => c.norm);
  const dedup = [...new Map(props.map((p) => [p.id, p])).values()];
  const normComuna = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const comunasOk = new Set((CONFIG.COMUNAS_VALIDAS || []).map(normComuna));
  const descartes = { comuna: 0, precio: 0, sutil: 0 };

  // El precio a filtrar depende de la operación: UF en venta, CLP/mes en arriendo.
  const precioDe = (p) => (OPERACION === "arriendo" ? p.precio_clp : p.precio_uf);
  const preFiltrado = dedup.filter((p) => {
    if (comunasOk.size && !comunasOk.has(normComuna(p.comuna))) { descartes.comuna++; return false; }
    const precio = precioDe(p);
    if (precio != null) {
      if (CONFIG.PRECIO_MIN != null && precio < CONFIG.PRECIO_MIN) { descartes.precio++; return false; }
      if (CONFIG.PRECIO_MAX != null && precio > CONFIG.PRECIO_MAX) { descartes.precio++; return false; }
    }
    return true;
  });
  console.log(`\nUniverso tras comuna+precio: ${preFiltrado.length} (descartados → comuna: ${descartes.comuna}, precio: ${descartes.precio})`);

  // ── 2) Detalle (GPS + superficie + campos nuevos) visitando fichas ────────
  if (CONFIG.VISITAR_FICHAS && preFiltrado.length) {
    // La pestaña de fichas se recicla cada RECICLA_CADA navegaciones: Chromium crashea
    // la misma pestaña tras ~90 gotos (memoria acumulada) y a partir de ahí TODAS las
    // fichas fallan en cascada (Page crashed). Recrearla evita el crash de raíz.
    const RECICLA_CADA = 40;
    let detalPage = await context.newPage();
    // MAX_FICHAS por env permite corridas diagnósticas cortas (ej: MAX_FICHAS=25 node fetch.mjs).
    const topeCfg = process.env.MAX_FICHAS ? Number(process.env.MAX_FICHAS) : CONFIG.MAX_FICHAS_DETALLE;
    const tope = Math.min(preFiltrado.length, topeCfg);
    if (tope < preFiltrado.length) {
      console.log(`\n⚠️  Universo (${preFiltrado.length}) supera MAX_FICHAS_DETALLE (${CONFIG.MAX_FICHAS_DETALLE}).`);
      console.log(`   Solo las primeras ${tope} tendrán GPS y campos de ficha. Sube MAX_FICHAS_DETALLE para cubrir todas.`);
    }
    console.log(`\nVisitando ${tope} fichas para GPS y atributos…`);
    let okFichas = 0, sinUrl = 0;
    for (let i = 0; i < tope; i++) {
      const n = preFiltrado[i];
      if (!n.url) { sinUrl++; continue; }
      // Reciclado proactivo: nueva pestaña cada RECICLA_CADA fichas (antes del crash ~90).
      if (i > 0 && i % RECICLA_CADA === 0) {
        try { await detalPage.close(); } catch {}
        detalPage = await context.newPage();
      }
      let detalle = await scrapeFicha(detalPage, n.url);
      // Reciclado reactivo: si la pestaña crasheó, recrearla y reintentar UNA vez.
      if (detalle && detalle.__crashed) {
        try { await detalPage.close(); } catch {}
        detalPage = await context.newPage();
        detalle = await scrapeFicha(detalPage, n.url);
      }
      if (detalle && detalle.lat != null) okFichas++;
      // fusionar detalle en la propiedad normalizada
      if (detalle.lat != null) { n.lat = detalle.lat; n.lng = detalle.lng; }
      if (detalle.antiguedad != null) n.antiguedad = detalle.antiguedad;
      if (n.imagen == null && detalle.imagen != null) n.imagen = detalle.imagen;
      if (n.estacionamientos == null && detalle.estacionamientos != null) n.estacionamientos = detalle.estacionamientos;
      if (n.superficie_util == null && detalle.superficie_util != null) n.superficie_util = detalle.superficie_util;
      if (n.superficie_total == null && detalle.superficie_total != null) n.superficie_total = detalle.superficie_total;
      // coherencia útil ≤ total tras fusionar el detalle
      if (n.superficie_util != null && n.superficie_total != null && n.superficie_util > n.superficie_total) {
        const t = n.superficie_util; n.superficie_util = n.superficie_total; n.superficie_total = t;
      }
      if (n.precio_uf && n.superficie_util && n.uf_m2_util == null)
        n.uf_m2_util = Math.round((n.precio_uf / n.superficie_util) * 10) / 10;
      // características estructuradas de la ficha
      if (detalle.bodega != null) n.bodega = detalle.bodega;
      if (detalle.orientacion != null) n.orientacion = detalle.orientacion;
      if (detalle.piso != null) n.piso = detalle.piso;
      if (detalle.gastos_comunes != null) n.gastos_comunes = detalle.gastos_comunes;
      if (detalle.jardin != null) n.jardin = detalle.jardin;
      if (detalle.duplex != null) n.duplex = detalle.duplex;
      // etiquetas de jardín/dúplex (por si el título no las traía)
      if (n.jardin && !n.caracteristicas.includes("Jardín")) n.caracteristicas.push("Jardín");
      if (n.duplex && !n.caracteristicas.includes("Dúplex")) n.caracteristicas.push("Dúplex");
      // amenidades detectadas en la descripción (sin duplicar las que ya trae)
      if (detalle.destacadas && detalle.destacadas.length) {
        for (const d of detalle.destacadas) if (!n.caracteristicas.includes(d)) n.caracteristicas.push(d);
      }
      // texto completo de la descripción (para el buscador de keyword del dashboard)
      if (detalle.descripcion) n.descripcion = detalle.descripcion;
      // barrio desde el breadcrumb (fuente oficial). Descartamos si coincide con la comuna.
      if (detalle.barrio_breadcrumb) {
        const bc = detalle.barrio_breadcrumb;
        const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
        if (norm(bc) !== norm(n.comuna)) n.barrio = bc;
      }
      if ((i + 1) % 10 === 0) process.stdout.write(`\r  ${i + 1}/${tope} fichas     `);
      await sleep(CONFIG.DELAY_MS / 2);
    }
    console.log("");
    console.log(`Fichas con GPS: ${okFichas}/${tope}  ·  sin URL: ${sinUrl}  ·  fallidas (catch): ${globalThis.__fichaFail || 0}`);
    await detalPage.close();
  }

  await context.close();

  // Filtro final de superficie útil (dato que suele venir de la ficha, no del listado).
  // comuna y precio ya se filtraron en preFiltrado, antes de visitar fichas.
  const final = preFiltrado.filter((p) => {
    if (p.superficie_util != null) {
      if (CONFIG.SUP_UTIL_MIN != null && p.superficie_util < CONFIG.SUP_UTIL_MIN) { descartes.sutil++; return false; }
      if (CONFIG.SUP_UTIL_MAX != null && p.superficie_util > CONFIG.SUP_UTIL_MAX) { descartes.sutil++; return false; }
    }
    return true;
  });
  console.log(`Descartados → comuna: ${descartes.comuna}, precio: ${descartes.precio}, sup.útil: ${descartes.sutil} → final: ${final.length}`);

  const payload = {
    meta: {
      generado: new Date().toISOString(),
      fuente: "portalinmobiliario.com (Playwright)",
      operacion: OPERACION === "arriendo" ? "Arriendo" : "Compra",
      moneda: CONFIG.MONEDA, // "UF" (venta) | "CLP" (arriendo, $/mes)
      uf_valor: CONFIG.UF_VALOR,
      condicion: CONFIG.SOLO_USADAS ? "used" : "todas",
      precio_min: CONFIG.PRECIO_MIN,
      precio_max: CONFIG.PRECIO_MAX,
      minimos: {
        dormitorios: CONFIG.MIN_DORMITORIOS,
        banos: CONFIG.MIN_BANOS,
        estacionamientos: CONFIG.MIN_ESTACIONAMIENTOS,
      },
      total: final.length,
      por_comuna: totalesPorComuna,
    },
    propiedades: final,
  };

  const outPath = resolve(__dirname, CONFIG.OUTPUT);

  // Protección: NO sobrescribir el archivo con 0 resultados. Un 0 casi siempre
  // significa bloqueo/captcha o cambio de estructura del sitio, no "no hay propiedades".
  // Sin esta guarda, una corrida fallida borraría los datos buenos ya guardados.
  if (final.length === 0) {
    console.log(`\n⚠️  0 resultados: NO se sobrescribió ${outPath} (se conservan los datos previos si los había).`);
    console.log("   Corre con HEADLESS=false node fetch.mjs para ver el navegador y resolver captcha,");
    console.log("   o node diagnostico.mjs para volcar el HTML a ./diag/ y revisar la estructura.");
    return;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  const conGPS = final.filter((p) => p.lat != null).length;
  console.log(`\n✓ Listo: ${final.length} propiedades escritas en ${outPath}`);
  console.log(`  ${conGPS} con coordenadas GPS (aparecerán en el mapa).`);
  if (final.length === 0) {
    console.log("\n⚠️  0 resultados. Corre con HEADLESS=false node fetch.mjs para ver el navegador,");
    console.log("   o node diagnostico.mjs para volcar el HTML a ./diag/ y revisar.");
  }
}

main().catch((err) => {
  console.error("\n✗ Falló la ejecución:", err.message);
  process.exit(1);
});
