// diagnostico.mjs — Abre UNA búsqueda y vuelca todo lo relevante a ./diag/ para depurar la extracción.
//   HEADLESS=false node diagnostico.mjs
//
// Genera en ./diag/:
//   - url.txt           : URL construida y URL final (tras redirecciones)
//   - page.html         : HTML completo renderizado
//   - next_data.json    : contenido de __NEXT_DATA__ (si existe)
//   - globals.txt       : qué variables globales tipo state existen en window
//   - shot.png          : captura de pantalla
//   - keys.txt          : "mapa" de claves del JSON embebido para ubicar los resultados

import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "diag");
const HEADLESS = process.env.HEADLESS ? process.env.HEADLESS !== "false" : false;

// Cambia esta URL si quieres probar otra. Empezamos SIN filtros para ver si el listado base carga.
const URL = "https://www.portalinmobiliario.com/venta/departamento/vitacura-metropolitana/";

// Resumen de la forma de un objeto (claves y tipos), recortado, para ubicar dónde están los items.
function shape(obj, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return "…";
  if (Array.isArray(obj)) {
    return obj.length ? [`Array(${obj.length})`, shape(obj[0], depth + 1, maxDepth)] : "Array(0)";
  }
  if (obj && typeof obj === "object") {
    const o = {};
    for (const k of Object.keys(obj).slice(0, 40)) o[k] = shape(obj[k], depth + 1, maxDepth);
    return o;
  }
  return typeof obj;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--disable-features=DownloadableFontsPruning", "--font-render-hinting=none", "--disable-remote-fonts"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "es-CL",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("Navegando a:", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Espera generosa a que aparezca ALGO de resultados.
  await page.waitForTimeout(6000);

  const finalUrl = page.url();
  const html = await page.content();
  await writeFile(resolve(OUT, "url.txt"), `construida: ${URL}\nfinal:      ${finalUrl}\n`);
  await writeFile(resolve(OUT, "page.html"), html);
  await page.screenshot({ path: resolve(OUT, "shot.png"), fullPage: false });

  // __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el ? el.textContent : null;
  });
  if (nextData) {
    await writeFile(resolve(OUT, "next_data.json"), nextData);
    try {
      const parsed = JSON.parse(nextData);
      await writeFile(resolve(OUT, "keys.txt"), JSON.stringify(shape(parsed), null, 2));
    } catch (e) {
      await writeFile(resolve(OUT, "keys.txt"), "No se pudo parsear __NEXT_DATA__: " + e.message);
    }
  } else {
    await writeFile(resolve(OUT, "next_data.json"), "(no existe __NEXT_DATA__ en la página)");
  }

  // Globals tipo state + conteo de tarjetas visibles en el DOM.
  const info = await page.evaluate(() => {
    const globals = [];
    for (const k of Object.keys(window)) {
      if (/state|preload|initial|__|search|results|data/i.test(k)) {
        let t = typeof window[k];
        globals.push(`${k}: ${t}`);
      }
    }
    const selectors = [
      ".ui-search-result", ".ui-search-layout__item", ".andes-card",
      "[class*='poly-card']", "[class*='search-result']", "li.ui-search-layout__item",
    ];
    const counts = {};
    for (const s of selectors) counts[s] = document.querySelectorAll(s).length;
    // Primeros títulos/precios visibles para confirmar que hay listado.
    const titles = [...document.querySelectorAll("h2, h3, .poly-component__title")]
      .slice(0, 5).map((e) => e.textContent.trim()).filter(Boolean);
    return { globals, counts, titles, bodyLen: document.body.innerText.length };
  });
  await writeFile(
    resolve(OUT, "globals.txt"),
    "GLOBALS:\n" + info.globals.join("\n") +
    "\n\nCONTEO DE TARJETAS POR SELECTOR:\n" + JSON.stringify(info.counts, null, 2) +
    "\n\nPRIMEROS TÍTULOS VISIBLES:\n" + info.titles.join("\n") +
    "\n\nLargo del texto del body: " + info.bodyLen
  );

  console.log("\n✓ Diagnóstico escrito en:", OUT);
  console.log("  URL final:", finalUrl);
  console.log("  Tarjetas por selector:", JSON.stringify(info.counts));
  console.log("  Títulos visibles:", info.titles.slice(0, 3));
  console.log("\nDeja el navegador abierto unos segundos y revisa la ventana.");
  await page.waitForTimeout(HEADLESS ? 500 : 4000);
  await browser.close();
}

main().catch((e) => { console.error("Falló:", e.message); process.exit(1); });
