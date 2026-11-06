// Generador del feed de productos para Meta Commerce Manager (CSV).
// Independiente del catálogo: solo LEE información pública y nunca escribe en el sitio.
//   - Productos y categorías: data/*.json del repositorio del catálogo (GitHub, solo lectura)
//   - Nombre y foto principal: lo que publica cada ficha (/producto/<código>) para vistas previas
// Uso: node generate-feed.mjs [carpeta-salida]   (sin dependencias; Node 18+)
// Si algo falla, el feed anterior queda intacto (se escribe en un archivo temporal y se renombra al final).
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.SITE_URL || "https://catalogo-abacsa.nescobar1993.workers.dev").replace(/\/$/, "");
const DATA = (process.env.DATA_URL || "https://raw.githubusercontent.com/NoeGT93/Cat-logo-1---Perfumes-ABACSA/cloudflare/data").replace(/\/$/, "");
const OUT = process.argv[2] || "dist";
const MIN_VALID = Number(process.env.MIN_VALID || 30); // menos productos válidos = algo anda mal: no se publica
const TYPES = { kits: "Kit", duos: "Dúo", perfumes: "Perfume", colonias: "Colonia" };
const COLUMNS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "product_type", "custom_label_0", "custom_label_1", "custom_label_2"];
// Precios por volumen del Excel en etiquetas personalizadas de Meta (vacías si el producto no los tiene)
const TIERS = [["dozen", "Docena"], ["bundle", "Fardo"], ["distributor", "Distribuidor"]];
const tierLabel = (p, i) => (p.prices[TIERS[i][0]] != null ? `${TIERS[i][1]}: Q${p.prices[TIERS[i][0]]}` : "");

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
const csv = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hasta 3 intentos con espera creciente: tolera fallas momentáneas del sitio sin insistir de más.
export async function get(url, init, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "abacsa-meta-feed/1.0" }, ...init });
      if (res.ok) return res;
      if (i >= tries || res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i >= tries) throw e;
    }
    await sleep(2000 * i);
  }
}

// Una ficha → { name, image } validando que corresponde al producto y muestra el precio del Excel.
async function readProductPage(p) {
  const link = `${SITE}/producto/${encodeURIComponent(p.code)}`;
  const html = await (await get(link)).text();
  const ogTitle = decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "");
  const image = decode(html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? "");
  const suffix = ` (${p.code}) — ABACSA`;
  if (!ogTitle.endsWith(suffix)) throw new Error("la ficha no corresponde al código");
  if (!html.includes(`Q${p.prices.unit}`)) throw new Error(`la ficha no muestra el precio Q${p.prices.unit}`);
  if (!image) throw new Error("sin foto principal");
  const img = await get(image, { method: "HEAD" });
  if (!img.headers.get("content-type")?.startsWith("image/")) throw new Error("la foto no es una imagen");
  return { link, name: ogTitle.slice(0, -suffix.length), image };
}

function buildRow(p, category, page) {
  const type = TYPES[category];
  const brand = titleCase(p.brand);
  const wholesale = Object.entries(p.prices).some(([k, v]) => k !== "unit" && v != null && v < p.prices.unit);
  return {
    id: p.code,
    title: page.name,
    description: `${type} ${page.name} de ${brand}. Código ${p.code}.${wholesale ? " Precio por mayor disponible en el catálogo." : ""}`,
    availability: "in stock", // autorizado por ABACSA: todos en existencia
    condition: "new", // autorizado por ABACSA: todos nuevos
    price: `${p.prices.unit.toFixed(2)} GTQ`, // precio por unidad; docena/fardo/distribuidor van en custom_label_0..2
    link: page.link,
    image_link: page.image,
    brand,
    product_type: type,
    custom_label_0: tierLabel(p, 0),
    custom_label_1: tierLabel(p, 1),
    custom_label_2: tierLabel(p, 2),
  };
}

export async function generate() {
  const started = new Date().toISOString();
  const [products, categories] = await Promise.all([
    get(`${DATA}/products.json`).then((r) => r.json()),
    get(`${DATA}/product-categories.json`).then((r) => r.json()),
  ]);
  const rows = [];
  const errors = [];
  for (const p of products) {
    const missing = [!p.code && "código", !p.description && "descripción", !(p.prices?.unit > 0) && "precio por unidad", !p.brand && "marca", !TYPES[categories[p.code]] && "categoría"].filter(Boolean);
    if (missing.length) {
      errors.push({ code: p.code ?? null, error: "falta " + missing.join(", ") });
      continue;
    }
    await sleep(400); // consultas espaciadas: carga mínima sobre el catálogo
    try {
      rows.push(buildRow(p, categories[p.code], await readProductPage(p)));
    } catch (e) {
      errors.push({ code: p.code, error: e.message });
    }
  }
  const report = { started, finished: new Date().toISOString(), site: SITE, source: DATA, products: products.length, published: rows.length, excluded: errors };
  if (rows.length < MIN_VALID) throw Object.assign(new Error(`Solo ${rows.length} productos válidos (mínimo ${MIN_VALID}). No se publica.`), { report });
  return { rows, report };
}

const toCsv = (rows) => [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csv(r[c])).join(","))].join("\n") + "\n";

// Solo al ejecutarlo directamente (validate-feed.mjs importa get() sin generar nada)
if (process.argv[1]?.endsWith("generate-feed.mjs")) {
  fs.mkdirSync(OUT, { recursive: true });
  const log = (entry) => fs.appendFileSync(path.join(OUT, "feed-log.jsonl"), JSON.stringify(entry) + "\n");
  try {
    const { rows, report } = await generate();
    const tmp = path.join(OUT, "feed.csv.tmp");
    fs.writeFileSync(tmp, toCsv(rows));
    fs.renameSync(tmp, path.join(OUT, "feed.csv"));
    fs.writeFileSync(path.join(OUT, "feed-report.json"), JSON.stringify(report, null, 2) + "\n");
    log({ date: report.finished, result: "ok", published: report.published, excluded: report.excluded.length });
    console.log(`Feed: ${report.published}/${report.products} productos · excluidos: ${report.excluded.length}`);
    report.excluded.forEach((e) => console.log(`  ✗ ${e.code}: ${e.error}`));
  } catch (e) {
    log({ date: new Date().toISOString(), result: "error", error: e.message, excluded: e.report?.excluded });
    console.error("Error: " + e.message + " — el feed anterior se conserva.");
    process.exit(1);
  }
}
