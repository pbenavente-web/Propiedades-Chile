// diag_lista.mjs — Prueba SOLO el barrido de listados con la nueva lógica anti-cuelgue.
// Carga N páginas de listado de una comuna y reporta tiempo por página.
// Corre:  node diag_lista.mjs "Lo Barnechea" lo-barnechea-metropolitana 20
// Objetivo: confirmar que ya no se queda pegado (antes se clavaba ~pág 14 de Lo Barnechea).
import { chromium } from "playwright";
import { CONFIG } from "./config.mjs";

const LAUNCH_ARGS = [
  "--disable-features=DownloadableFontsPruning",
  "--font-render-hinting=none",
  "--disable-remote-fonts",
];

const NOMBRE = process.argv[2] || "Lo Barnechea";
const SLUG = process.argv[3] || "lo-barnechea-metropolitana";
const DESDE_PAG = Number(process.argv[4] || 10); // arranca cerca de donde se colgaba
const HASTA_PAG = Number(process.argv[5] || 20);

const BASE = "https://www.portalinmobiliario.com";
function buildUrl(desde) {
  let url = `${BASE}/venta/departamento/${SLUG}`;
  const tokens = [];
  if (CONFIG.MIN_DORMITORIOS) tokens.push(`_BEDROOMS_${CONFIG.MIN_DORMITORIOS}-*`);
  if (CONFIG.SOLO_USADAS) tokens.push("_ITEM*CONDITION_2230581");
  if (desde > 1) tokens.push(`_Desde_${desde}`);
  if (tokens.length) url += "/" + tokens.join("");
  return url;
}

const LISTA_TIMEOUT = 15000;
const HARD_CAP = LISTA_TIMEOUT + 8000;

const browser = await chromium.launch({ headless: CONFIG.HEADLESS, args: LAUNCH_ARGS });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "es-CL",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

console.log(`Probando ${NOMBRE} páginas ${DESDE_PAG}–${HASTA_PAG} (donde se colgaba)…\n`);
for (let p = DESDE_PAG; p <= HASTA_PAG; p++) {
  const desde = (p - 1) * 48 + 1;
  const url = buildUrl(desde);
  const t0 = Date.now();
  let cards = 0, estado = "ok";
  try {
    await Promise.race([
      (async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: LISTA_TIMEOUT });
        await page.waitForSelector(".poly-card, .ui-search-layout__item", { timeout: LISTA_TIMEOUT }).catch(() => {});
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hard-timeout")), HARD_CAP)),
    ]);
    await page.waitForTimeout(800);
    cards = await page.evaluate(() => document.querySelectorAll(".poly-card").length);
  } catch (e) {
    estado = "FALLÓ: " + e.message.split("\n")[0];
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  pág ${p.toString().padStart(2)}  ${dt.padStart(5)}s  ${cards} cards  ${estado}`);
}

await browser.close();
console.log("\nSi ninguna pasó de ~23s y todas traen cards → el anti-cuelgue funciona.");
