// diag_multi.mjs — Reproduce el fallo del scrape masivo: reutiliza UNA página para varias
// fichas (como main()), corriendo el MISMO cuerpo de scrapeFicha. Muestra el error real.
// Corre:  node diag_multi.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { CONFIG } from "./config.mjs";

const LAUNCH_ARGS = [
  "--disable-features=DownloadableFontsPruning",
  "--font-render-hinting=none",
  "--disable-remote-fonts",
];

// Copia EXACTA del cuerpo actual de scrapeFicha (con el logging de error).
async function scrapeFicha(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
    try {
      await page.waitForSelector(".andes-breadcrumb__item, .andes-table__row, img[src*='staticmap']", { timeout: 12000 });
    } catch (e) { console.log("   (waitForSelector no encontró nada:", e.message.split("\n")[0], ")"); }
    await page.waitForTimeout(400);
    return await page.evaluate(() => {
      const res = { lat: null, lng: null, barrio_breadcrumb: null, descripcion: null, specs: 0 };
      const mapImg = document.querySelector('img[src*="staticmap"], img[src*="maps.google"]');
      if (mapImg) {
        const m = mapImg.src.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
        if (m) { res.lat = parseFloat(m[1]); res.lng = parseFloat(m[2]); }
      }
      res.specs = document.querySelectorAll(".ui-pdp-specs__table tr, .andes-table__row, .ui-vpp-highlighted-specs__key-value").length;
      const descEl = document.querySelector(".ui-pdp-description__content, .ui-pdp-description, [data-testid='content']");
      const descRaw = (descEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (descRaw) res.descripcion = descRaw.slice(0, 60);
      const bcSel = ".andes-breadcrumb__item, .andes-breadcrumb li, .andes-breadcrumb a, .ui-pdp-breadcrumb__item, .ui-pdp-breadcrumb a";
      const bcItems = [...document.querySelectorAll(bcSel)].map(e => e.textContent.replace(/\s+/g," ").trim()).filter(Boolean);
      const bcGen = /^(inicio|propiedades|propiedades usadas|usadas|nuevas|departamentos?|casas?|venta|arriendo|rm|r\.?m\.?|regi[oó]n metropolitana|metropolitana|rm \(metropolitana\)|chile|volver|\.\.\.|›|>|home)$/i;
      for (let i = bcItems.length - 1; i >= 0; i--) { if (bcItems[i] && !bcGen.test(bcItems[i])) { res.barrio_breadcrumb = bcItems[i]; break; } }
      return res;
    });
  } catch (e) {
    console.log("   ❌ scrapeFicha ERROR:", (e && e.message ? e.message : e).split("\n")[0]);
    return {};
  }
}

const data = JSON.parse(readFileSync("../data/datos.json", "utf8"));
const N = Number(process.argv[2] || 6);
const urls = data.propiedades.slice(0, N).map(p => p.url);

const browser = await chromium.launch({ headless: CONFIG.HEADLESS, args: LAUNCH_ARGS });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "es-CL",
  viewport: { width: 1440, height: 900 },
});
// Igual que fetch.mjs: bloquear imágenes/media/fuentes (evita el crash por memoria).
await context.route("**/*", (route) => {
  const t = route.request().resourceType();
  if (t === "image" || t === "media" || t === "font") return route.abort();
  return route.continue();
});
// Igual que fetch.mjs: pestaña reciclada cada 40 fichas.
const RECICLA_CADA = 40;
let detalPage = await context.newPage();

let ok = 0, fail = 0;
for (let i = 0; i < urls.length; i++) {
  if (i > 0 && i % RECICLA_CADA === 0) {
    try { await detalPage.close(); } catch {}
    detalPage = await context.newPage();
  }
  const r = await scrapeFicha(detalPage, urls[i]);
  const bien = r && r.lat != null;
  if (bien) ok++; else fail++;
  process.stdout.write(bien ? "." : "X");
  await new Promise(res => setTimeout(res, CONFIG.DELAY_MS / 2));
}

await browser.close();
console.log(`\n\nResultado: ${ok} con GPS, ${fail} sin datos, de ${urls.length}.`);
console.log("Si las primeras andan y luego empiezan las X → el sitio throttlea a volumen.");
