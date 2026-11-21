// Proxy de imágenes para el catálogo PDF del panel: el navegador no puede leer fotos de
// otros dominios para dibujarlas en un PDF si el servidor de origen no envía CORS, así que
// la descarga pasa por aquí. Solo permite los dominios de almacenamiento de Firebase/Google.
const ALLOWED = [/^firebasestorage\.googleapis\.com$/, /^storage\.googleapis\.com$/, /\.firebasestorage\.app$/, /\.appspot\.com$/];

module.exports = async function handler(req, res) {
  try {
    const u = new URL(String(req.query.u || ''));
    if (u.protocol !== 'https:' || !ALLOWED.some(r => r.test(u.hostname))) {
      res.statusCode = 400; return res.end('Dominio no permitido');
    }
    const r = await fetch(u.toString());
    if (!r.ok) { res.statusCode = 502; return res.end('Error al leer la imagen'); }
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) { res.statusCode = 415; return res.end('No es una imagen'); }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
    res.end(buf);
  } catch (e) {
    res.statusCode = 400; res.end('Solicitud inválida');
  }
};
