// diag_ficha.mjs — Guarda el HTML de UNA ficha real para diagnosticar selectores.
// Corre:  node diag_ficha.mjs
// Escribe: diag/ficha.html (HTML completo) y diag/ficha.txt (resumen de lo que encontró).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { CONFIG } from "./config.mjs";

const URL = process.argv[2] || "https://portalinmobiliario.com/MLC-2059579747-departamento-en-venta-de-4-dorm-en-vitacura-_JM";

const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  locale: "es-CL",
});
const page = await ctx.newPage();
console.log("Abriendo:", URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
// misma espera que scrapeFicha (esperar hidratación, no tiempo fijo)
try {
  await page.waitForSelector(".andes-breadcrumb__item, .andes-table__row, img[src*='staticmap']", { timeout: 12000 });
} catch {}
await page.waitForTimeout(400);

const html = await page.content();
mkdirSync("diag", { recursive: true });
writeFileSync("diag/ficha.html", html);

// Resumen de diagnóstico: qué selectores encuentran algo.
const diag = await page.evaluate(() => {
  const q = (sel) => document.querySelectorAll(sel).length;
  const txt = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.replace(/\s+/g," ").trim()).filter(Boolean).slice(0, 15);
  return {
    title: document.title,
    url: location.href,
    // breadcrumb: probamos muchas variantes
    breadcrumb_andes_item: txt(".andes-breadcrumb__item"),
    breadcrumb_andes_li: txt(".andes-breadcrumb li"),
    breadcrumb_andes_a: txt(".andes-breadcrumb a"),
    breadcrumb_pdp_item: txt(".ui-pdp-breadcrumb__item"),
    breadcrumb_pdp_a: txt(".ui-pdp-breadcrumb a"),
    breadcrumb_nav_migas: txt("nav[aria-label*='migas'] a"),
    breadcrumb_nav_breadcrumb: txt("nav[aria-label*='readcrumb'] a"),
    // cualquier nav / ol con "breadcrumb" en la clase
    any_breadcrumb_classes: [...document.querySelectorAll("[class*='readcrumb'],[class*='readCrumb']")].map(e => e.className).slice(0, 10),
    // mapa GPS
    staticmap_imgs: [...document.querySelectorAll("img")].map(i=>i.src).filter(s=>/staticmap|maps\.google|mapbox|maps\.googleapis/.test(s)).slice(0,3),
    // specs
    specs_table: q(".ui-pdp-specs__table tr"),
    andes_table_row: q(".andes-table__row"),
    highlighted_specs: q(".ui-vpp-highlighted-specs__key-value"),
    // descripción
    desc_content: (document.querySelector(".ui-pdp-description__content")?.textContent||"").slice(0,120),
    desc_alt: (document.querySelector(".ui-pdp-description")?.textContent||"").slice(0,120),
    // ¿captcha / bloqueo?
    body_head: document.body.textContent.replace(/\s+/g," ").trim().slice(0, 300),
  };
});

writeFileSync("diag/ficha.txt", JSON.stringify(diag, null, 2));
console.log("\n===== DIAGNÓSTICO =====");
console.log(JSON.stringify(diag, null, 2));
console.log("\nHTML completo guardado en: diag/ficha.html");
console.log("Resumen guardado en:       diag/ficha.txt");

await browser.close();
