// Validación independiente del feed: node validate-feed.mjs [dist/feed.csv] [ruta/a/products.json]
// Compara cada fila contra el Excel convertido (products.json) y contra la web publicada.
import assert from "node:assert/strict";
import fs from "node:fs";
import { get } from "./generate-feed.mjs";

const feedFile = process.argv[2] || "dist/feed.csv";
const productsFile = process.argv[3];
const DATA = "https://raw.githubusercontent.com/NoeGT93/Cat-logo-1---Perfumes-ABACSA/cloudflare/data/products.json";

// CSV simple con comillas (el formato que escribe generate-feed.mjs)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else cell += ch;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const rows = parseCsv(fs.readFileSync(feedFile, "utf8"));
const products = productsFile ? JSON.parse(fs.readFileSync(productsFile, "utf8")) : await (await get(DATA)).json();
const byCode = new Map(products.map((p) => [p.code, p]));
const problems = [];
const check = (ok, msg) => ok || problems.push(msg);

check(rows.length === products.length, `filas ${rows.length} ≠ productos ${products.length}`);
check(new Set(rows.map((r) => r.id)).size === rows.length, "ids repetidos");

for (const r of rows) {
  const p = byCode.get(r.id);
  if (!check(p, `${r.id}: código que no existe en el Excel`)) continue;
  for (const f of ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "product_type"]) check(r[f], `${r.id}: falta ${f}`);
  check(r.price === `${p.prices.unit.toFixed(2)} GTQ`, `${r.id}: precio ${r.price} ≠ Excel Q${p.prices.unit}`);
  ["dozen", "bundle", "distributor"].forEach((k, i) => {
    const want = p.prices[k] != null ? `${["Docena", "Fardo", "Distribuidor"][i]}: Q${p.prices[k]}` : "";
    check((r["custom_label_" + i] ?? "") === want, `${r.id}: custom_label_${i} "${r["custom_label_" + i]}" ≠ Excel "${want}"`);
  });
  check(r.availability === "in stock" && r.condition === "new", `${r.id}: disponibilidad/estado`);
  check(r.link.endsWith("/producto/" + encodeURIComponent(r.id)), `${r.id}: enlace no corresponde al código`);
  check(r.description.length <= 9999 && r.title.length <= 200, `${r.id}: textos fuera de límite de Meta`);

  await new Promise((s) => setTimeout(s, 400));
  const page = await get(r.link).catch(() => null);
  const html = page ? await page.text() : "";
  check(page && html.includes(`(${r.id}) — ABACSA`), `${r.id}: la ficha no responde o no es del producto`);
  check(html.includes(`content="${r.image_link}"`), `${r.id}: la foto no es la principal publicada en la ficha`);
  const img = await get(r.image_link).catch(() => null);
  const buf = img ? new Uint8Array(await img.arrayBuffer()) : new Uint8Array();
  check(img && img.headers.get("content-type")?.startsWith("image/"), `${r.id}: foto no accesible`);
  // Tamaño mínimo recomendado por Meta: 500×500 (se lee de la cabecera JPEG)
  const size = jpegSize(buf);
  check(!size || (size.w >= 500 && size.h >= 500), `${r.id}: foto de ${size?.w}×${size?.h}, menor a 500×500`);
}

function jpegSize(b) {
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xc3) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}

if (problems.length) {
  console.error("VALIDACIÓN FALLIDA:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Validación OK: ${rows.length} productos · códigos, precios por unidad, enlaces y fotos coinciden con el Excel y la web.`);
