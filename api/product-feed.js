// GET /api/product-feed
// Genera un feed de productos en formato Google Shopping (RSS 2.0 + espacio de
// nombres "g:") en tiempo real, leyendo directo de Firebase. Regístralo en
// Google Merchant Center como "Feed programado" apuntando a:
//   https://pandaventa.com/product-feed.xml
//
// Documentación de referencia: https://support.google.com/merchants/answer/7052112
module.exports = async function handler(req, res) {
  // Cache corto: el feed se actualiza solo, pero no hace falta pegarle a
  // Firebase en cada visita del bot de Google si entra varias veces seguidas.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');

  const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
  const SITE_URL = "https://pandaventa.com";

  // Escapa texto para que sea válido dentro de XML (fuera de los bloques CDATA)
  const escapeXML = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  try {
    const [settingsRes, productsRes] = await Promise.all([
      fetch(`${FIREBASE_URL}/settings.json`),
      fetch(`${FIREBASE_URL}/products.json`)
    ]);
    const settings = await settingsRes.json() || {};
    const productsObj = await productsRes.json() || {};
    const currency = settings.currency || 'COP';
    const storeName = settings.storeName || 'Tienda';

    const items = Object.entries(productsObj)
      .filter(([id, p]) => p && p.active !== false && p.name && p.price)
      .map(([id, p]) => {
        const images = (p.images && p.images.length > 0) ? p.images : (p.image ? [p.image] : []);
        if (images.length === 0) return null; // Google exige al menos una imagen

        const stock = (p.variants && p.variants.length > 0)
          ? p.variants.reduce((s, v) => s + (parseInt(v.stock) || 0), 0)
          : (parseInt(p.stock) || 0);

        const price = parseFloat(p.price) || 0;
        const link = `${SITE_URL}/producto/${id}`;
        const description = String(p.description || p.name).replace(/<[^>]*>/g, '').trim();

        return `
  <item>
    <g:id>${escapeXML(id)}</g:id>
    <title><![CDATA[${p.name}]]></title>
    <description><![CDATA[${description}]]></description>
    <link>${escapeXML(link)}</link>
    <g:image_link>${escapeXML(images[0])}</g:image_link>
    ${images.slice(1, 10).map(img => `<g:additional_image_link>${escapeXML(img)}</g:additional_image_link>`).join('\n    ')}
    <g:availability>${stock > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
    <g:price>${price.toFixed(2)} ${currency}</g:price>
    <g:condition>new</g:condition>
    <g:identifier_exists>no</g:identifier_exists>
    ${p.category ? `<g:product_type>${escapeXML(p.category)}</g:product_type>` : ''}
    <g:brand>${escapeXML(storeName)}</g:brand>
  </item>`;
      })
      .filter(Boolean)
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${escapeXML(storeName)} — Catálogo de productos</title>
  <link>${SITE_URL}</link>
  <description>Feed de productos para Google Merchant Center</description>
  ${items}
</channel>
</rss>`;

    return res.status(200).send(xml);
  } catch (error) {
    console.error('Error generando el feed de productos:', error.message);
    return res.status(500).send('<?xml version="1.0"?><error>No se pudo generar el feed</error>');
  }
};
