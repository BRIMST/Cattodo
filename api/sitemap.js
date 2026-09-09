// GET /api/sitemap (expuesto como /sitemap.xml vía vercel.json)
// Genera el sitemap en tiempo real: home, cada producto activo, y las
// páginas de políticas — para que Google rastree cada URL real.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');

  const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
  const SITE_URL = "https://pandaventa.com";

  try {
    const productsRes = await fetch(`${FIREBASE_URL}/products.json`);
    const productsObj = await productsRes.json() || {};

    const staticUrls = ['', 'envios', 'devoluciones', 'contacto'];

    const productUrls = Object.entries(productsObj)
      .filter(([id, p]) => p && p.active !== false && p.name)
      .map(([id]) => `producto/${id}`);

    const allUrls = [...staticUrls, ...productUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(path => `  <url>
    <loc>${SITE_URL}/${path}</loc>
    <changefreq>${path.startsWith('producto/') ? 'daily' : 'weekly'}</changefreq>
  </url>`).join('\n')}
</urlset>`;

    return res.status(200).send(xml);
  } catch (error) {
    console.error('Error generando sitemap:', error.message);
    return res.status(500).send('<?xml version="1.0"?><error>No se pudo generar el sitemap</error>');
  }
};
