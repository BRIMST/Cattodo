/**
 * generate-sitemap.js
 * Ejecutar con: node generate-sitemap.js
 * Agrega al package.json: "build": "node generate-sitemap.js && <tu_build_actual>"
 *
 * Consulta Firebase Realtime Database y genera public/sitemap.xml
 * con la URL raíz + una entrada por cada producto activo.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const BASE_URL = 'https://pandaventa.com'; // ← cambia por tu dominio final si usas uno propio
const FIREBASE_DB_URL = 'https://todo-en-uno-cf51e-default-rtdb.firebaseio.com/products.json';
const OUTPUT_PATH = path.join(__dirname, 'public', 'sitemap.xml'); // o './' si no hay carpeta public
// ──────────────────────────────────────────────────────────────────────────────

function fetchProducts() {
  return new Promise((resolve, reject) => {
    https.get(FIREBASE_DB_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed) return resolve([]);
          // Firebase puede devolver array u objeto con claves
          if (Array.isArray(parsed)) {
            resolve(parsed.filter(p => p && p.active));
          } else {
            resolve(
              Object.entries(parsed)
                .map(([id, p]) => ({ ...p, id }))
                .filter(p => p.active)
            );
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function buildSitemap(products) {
  const now = new Date().toISOString();

  const productUrls = products.map(p => {
    // Usa slug si existe, sino el id de Firebase
    const segment = p.slug || p.id;
    return `
  <url>
    <loc>${BASE_URL}/producto/${segment}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${productUrls}
</urlset>`;
}

(async () => {
  try {
    console.log('🔍 Consultando productos en Firebase...');
    const products = await fetchProducts();
    console.log(`✅ ${products.length} productos activos encontrados.`);

    const xml = buildSitemap(products);

    // Crear carpeta public si no existe
    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUTPUT_PATH, xml, 'utf8');
    console.log(`📄 sitemap.xml generado en: ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('❌ Error generando sitemap:', err.message);
    process.exit(1);
  }
})();
