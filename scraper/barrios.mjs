// barrios.mjs — Asigna un "barrio" (sector) a cada propiedad de data/datos.json.
// Estrategia (breadcrumb manda):
//   1) Si la propiedad ya trae barrio del BREADCRUMB de la ficha (lo pone fetch.mjs) → se conserva.
//      Es la fuente oficial de Portal Inmobiliario (ej: "… > Vitacura > Parque Bicentenario").
//   2) Si no (breadcrumb vacío/dudoso), respaldo ÚNICO: el barrio conocido cuyo CENTRO GPS
//      esté más cerca de la coordenada de la propiedad, dentro de RADIO_MAX_KM.
//   3) Si no hay GPS o cae fuera de todo radio → barrio = null ("Sin sector").
//
// Correr:  node barrios.mjs         (reescribe data/datos.json in-place, con respaldo .bak)
// Se corre DESPUÉS de fetch.mjs:  node fetch.mjs && node barrios.mjs
// Es idempotente: se puede volver a correr tras un nuevo scrape.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../data/datos.json");
const RADIO_MAX_KM = 1.6; // si el barrio más cercano está más lejos que esto, no se asigna

// Centros aproximados (lat, lng) de sectores conocidos por comuna. Calibrados con
// los rangos GPS reales del dataset. Los "alias" son variantes de nombre que
// pueden aparecer en el título de la publicación.
const BARRIOS = {
  "Vitacura": [
    { nombre: "Nueva Costanera",          lat: -33.3915, lng: -70.5960, alias: ["nueva costanera"] },
    { nombre: "Alonso de Córdova",        lat: -33.3985, lng: -70.5830, alias: ["alonso de cordova"] },
    { nombre: "Bicentenario",             lat: -33.3960, lng: -70.6000, alias: ["bicentenario", "parque bicentenario"] },
    { nombre: "Jardín del Este",          lat: -33.3830, lng: -70.5600, alias: ["jardin del este"] },
    { nombre: "Santa María de Manquehue", lat: -33.3760, lng: -70.5560, alias: ["santa maria de manquehue", "santa maria manquehue"] },
    { nombre: "San Damián",               lat: -33.3720, lng: -70.5300, alias: ["san damian"] },
    { nombre: "Lo Curro",                 lat: -33.3690, lng: -70.5470, alias: ["lo curro"] },
    { nombre: "Escrivá de Balaguer",      lat: -33.3880, lng: -70.5560, alias: ["escriva de balaguer", "escriba de balaguer"] },
    { nombre: "Padre Hurtado / Lo Matta", lat: -33.3900, lng: -70.5720, alias: ["padre hurtado", "lo matta"] },
    { nombre: "Vespucio",                 lat: -33.3960, lng: -70.5760, alias: ["vespucio", "americo vespucio"] },
  ],
  "Las Condes": [
    { nombre: "El Golf",                  lat: -33.4130, lng: -70.5820, alias: ["el golf"] },
    { nombre: "Nueva Las Condes",         lat: -33.4090, lng: -70.5710, alias: ["nueva las condes"] },
    { nombre: "Escuela Militar",          lat: -33.4170, lng: -70.5970, alias: ["escuela militar"] },
    { nombre: "Colón / Cristóbal Colón",  lat: -33.4090, lng: -70.5560, alias: ["colon", "cristobal colon"] },
    { nombre: "Manquehue",                lat: -33.4010, lng: -70.5720, alias: ["manquehue"] },
    { nombre: "Apoquindo",                lat: -33.4130, lng: -70.5550, alias: ["apoquindo"] },
    { nombre: "Cantagallo",               lat: -33.4050, lng: -70.5480, alias: ["cantagallo"] },
    { nombre: "Rotonda Atenas",           lat: -33.4110, lng: -70.5680, alias: ["rotonda atenas", "atenas"] },
    { nombre: "Tomás Moro",               lat: -33.4390, lng: -70.5560, alias: ["tomas moro"] },
    { nombre: "Estoril / La Portada",     lat: -33.4020, lng: -70.5350, alias: ["estoril", "la portada"] },
    { nombre: "San Carlos de Apoquindo",  lat: -33.4180, lng: -70.5150, alias: ["san carlos de apoquindo", "san carlos apoquindo"] },
    { nombre: "Los Dominicos",            lat: -33.4090, lng: -70.5310, alias: ["los dominicos"] },
    { nombre: "El Bosque / Kennedy",      lat: -33.4160, lng: -70.6000, alias: ["el bosque", "kennedy"] },
    { nombre: "Bilbao",                   lat: -33.4240, lng: -70.5900, alias: ["bilbao"] },
  ],
  "Lo Barnechea": [
    { nombre: "La Dehesa",         lat: -33.3520, lng: -70.5180, alias: ["la dehesa"] },
    { nombre: "El Arrayán",        lat: -33.3610, lng: -70.5320, alias: ["el arrayan", "arrayan"] },
    { nombre: "Los Trapenses",     lat: -33.3450, lng: -70.5350, alias: ["los trapenses", "trapenses"] },
    { nombre: "La Ermita",         lat: -33.3480, lng: -70.5000, alias: ["la ermita"] },
    { nombre: "San Enrique",       lat: -33.3400, lng: -70.4950, alias: ["san enrique"] },
    { nombre: "El Huinganal",      lat: -33.3560, lng: -70.5050, alias: ["el huinganal", "huinganal"] },
    { nombre: "Valle Escondido",   lat: -33.3380, lng: -70.5120, alias: ["valle escondido"] },
    { nombre: "Cerro 18",          lat: -33.3650, lng: -70.5200, alias: ["cerro 18"] },
    { nombre: "Farellones",        lat: -33.3520, lng: -70.3120, alias: ["farellones"] },
  ],
};

// Distancia Haversine en km.
function distKm(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function barrioDesdeGps(comuna, lat, lng) {
  const lista = BARRIOS[comuna] || [];
  if (lat == null || lng == null || !lista.length) return null;
  let mejor = null, mejorD = Infinity;
  for (const b of lista) {
    const d = distKm(lat, lng, b.lat, b.lng);
    if (d < mejorD) { mejorD = d; mejor = b; }
  }
  return mejorD <= RADIO_MAX_KM ? mejor.nombre : null;
}

function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  copyFileSync(DATA_PATH, DATA_PATH + ".bak");

  const stats = { breadcrumb: 0, gps: 0, sin: 0 };
  for (const p of data.propiedades) {
    // 1) El breadcrumb manda: si fetch.mjs ya asignó p.barrio desde la ficha, se conserva.
    if (p.barrio) { stats.breadcrumb++; continue; }
    // 2) Respaldo único: GPS de la propiedad (en caso de duda / breadcrumb vacío).
    const barrio = barrioDesdeGps(p.comuna, p.lat, p.lng);
    p.barrio = barrio;
    if (barrio) stats.gps++;
    else stats.sin++;
  }

  // Metadata: lista de barrios efectivamente usados por comuna (para poblar el filtro).
  const porComuna = {};
  for (const p of data.propiedades) {
    if (!p.barrio) continue;
    (porComuna[p.comuna] = porComuna[p.comuna] || new Set()).add(p.barrio);
  }
  data.meta = data.meta || {};
  data.meta.barrios_por_comuna = Object.fromEntries(
    Object.entries(porComuna).map(([c, set]) => [c, [...set].sort()])
  );

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  const conBarrio = stats.breadcrumb + stats.gps;
  console.log(`Barrios asignados: ${stats.breadcrumb} por breadcrumb + ${stats.gps} por GPS = ${conBarrio} de ${data.propiedades.length}`);
  console.log(`Sin sector: ${stats.sin} (${Math.round(stats.sin / data.propiedades.length * 100)}%)`);
  console.log(`Respaldo: ${DATA_PATH}.bak`);
}

main();
