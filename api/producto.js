// GET /producto/:id  (vercel.json lo enruta aquí)
// Devuelve la misma página de la tienda (index.html) pero con el título, la
// descripción y la imagen del producto ya escritos en el HTML. Así Google,
// WhatsApp, Facebook, etc. —que no ejecutan JavaScript— muestran el producto
// correcto al compartir el enlace. Si algo falla, se sirve la página normal.
const FIREBASE_URL = 'https://pandaventa-cdc06-default-rtdb.firebaseio.com';
const SITE_URL = 'https://pandaventa.com';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeout = (ms) => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;

function setTag(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, () => replacement) : html;
}

module.exports = async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'pandaventa.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const id = String(req.query.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

  let html;
  try {
    const r = await fetch(`${proto}://${host}/index.html`, { signal: timeout(4000) });
    if (!r.ok) throw new Error('index ' + r.status);
    html = await r.text();
  } catch (e) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }

  try {
    if (id) {
      const pr = await fetch(`${FIREBASE_URL}/products/${id}.json`, { signal: timeout(3000) });
      const p = pr.ok ? await pr.json() : null;
      if (p && p.active !== false && p.name) {
        const price = parseFloat(p.price) || 0;
        const clean = String(p.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const desc = (clean || `${p.name} en Panda Venta. Envío a toda Colombia y pedido fácil por WhatsApp.`).slice(0, 200);
        const title = `${p.name} | Panda Venta`;
        const url = `${SITE_URL}/producto/${id}`;
        const img = (Array.isArray(p.images) && p.images[0]) || p.image || '';
        const imgUrl = /^https?:\/\//i.test(img) ? img : '';

        html = setTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
        html = setTag(html, /<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(desc)}" />`);
        html = setTag(html, /<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(url)}" />`);
        html = setTag(html, /<meta property="og:type"[^>]*>/i, `<meta property="og:type" content="product" />`);
        html = setTag(html, /<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(title)}" />`);
        html = setTag(html, /<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(desc)}" />`);
        html = setTag(html, /<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(url)}" />`);
        if (imgUrl) {
          html = setTag(html, /<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${esc(imgUrl)}" />`);
          html = setTag(html, /<meta property="og:image:alt"[^>]*>/i, `<meta property="og:image:alt" content="${esc(p.name)}" />`);
        }
        if (price > 0) {
          html = html.replace('</head>', () => `  <meta property="product:price:amount" content="${price}" />\n  <meta property="product:price:currency" content="COP" />\n</head>`);
        }
      }
    }
  } catch (e) { /* se sirve la página normal */ }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.end(html);
};
