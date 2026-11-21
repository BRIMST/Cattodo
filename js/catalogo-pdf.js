// Catálogo mayorista en PDF (foto + referencia + precio), listo para enviar a clientes.
// Se genera en el navegador con jsPDF; las fotos se reducen y comprimen para que el archivo pese poco.
import { wholesaleVisibility, WHOLESALE_MIN_QTY } from "./wholesale-visibility.js";

const PINO = [20, 57, 44], ORO = [226, 176, 74], GRIS = [107, 114, 128], LINEA = [229, 231, 235], TXT = [31, 41, 55];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar ' + src)); document.head.appendChild(s);
  });
}
async function getJsPDF() {
  if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  return window.jspdf.jsPDF;
}

// El PDF estándar solo admite caracteres latinos: se quitan emojis y símbolos raros.
const clean = (t) => String(t ?? '').replace(/[^\x20-\x7E¡-ÿ]/g, '').replace(/\s{2,}/g, ' ').trim();

function wholesalePriceOf(p, prices, config) {
  const own = prices?.[p.id];
  if (own !== undefined && own !== null && own !== '' && Number(own) !== 0) return parseFloat(own);
  const discount = config?.discount !== undefined ? parseFloat(config.discount) : 20;
  return Math.round(((parseFloat(p.price) || 0) * (100 - discount) / 100) / 100) * 100;
}

function imgToJpeg(img, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  const s = Math.min(img.naturalWidth, img.naturalHeight) || size;           // recorte centrado (cover)
  const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
  g.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}
function loadImgElement(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
}
async function fetchPhoto(url, size = 420) {
  if (!url) return null;
  const tries = url.startsWith('data:') ? [url] : [url, '/api/imagen?u=' + encodeURIComponent(url)];
  for (const src of tries) {
    try { return imgToJpeg(await loadImgElement(src), size); } catch (e) { /* se prueba el siguiente camino */ }
  }
  return null;
}

async function mapPool(items, n, fn, onStep) {
  const out = new Array(items.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); onStep && onStep(++done, items.length); }
  }));
  return out;
}

export function catalogProducts(state) {
  const config = state.wholesaleConfig || {};
  return (state.products || [])
    .filter(p => p.active !== false && wholesaleVisibility(p, { autoHide: config.autoHideLowStock !== false, min: WHOLESALE_MIN_QTY }).visible)
    .sort((a, b) => String(a.category || 'zzz').localeCompare(String(b.category || 'zzz'), 'es') || String(a.name).localeCompare(String(b.name), 'es'));
}

export async function generateWholesalePdf(state, { onProgress } = {}) {
  const JsPDF = await getJsPDF();
  const settings = state.settings || {};
  const prices = state.wholesalePrices || {}, config = state.wholesaleConfig || {};
  const list = catalogProducts(state);
  if (!list.length) throw new Error('No hay productos visibles en el portal mayorista para incluir.');

  onProgress && onProgress('Descargando fotos…');
  const photos = await mapPool(list, 6, p => fetchPhoto((p.images && p.images[0]) || p.image), (d, t) => onProgress && onProgress(`Preparando fotos ${d}/${t}`));

  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 12;
  const store = clean(settings.storeName) || 'Panda Venta';
  const wa = clean(settings.whatsapp);
  const now = new Date(); const fecha = `${MESES[now.getMonth()]} ${now.getFullYear()}`;
  const site = 'pandaventa.com';
  const fmt = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
  const setFill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const setText = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw = (c) => doc.setDrawColor(c[0], c[1], c[2]);

  // ---------- Portada ----------
  setFill(PINO); doc.rect(0, 0, W, H, 'F');
  setDraw(ORO); doc.setLineWidth(0.6); doc.rect(9, 9, W - 18, H - 18);
  doc.setLineWidth(0.2); doc.rect(11.5, 11.5, W - 23, H - 23);
  setText(ORO); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(store.toUpperCase(), W / 2, 42, { align: 'center', charSpace: 3 });
  doc.setLineWidth(0.5); doc.line(W / 2 - 14, 48, W / 2 + 14, 48);
  setText([255, 255, 255]); doc.setFont('times', 'bold'); doc.setFontSize(44);
  doc.text('Catálogo', W / 2, 78, { align: 'center' });
  doc.text('Mayorista', W / 2, 96, { align: 'center' });
  setText(ORO); doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  doc.text(`Precios al por mayor · ${fecha.charAt(0).toUpperCase() + fecha.slice(1)}`, W / 2, 110, { align: 'center' });
  // Fotos de portada
  const cover = photos.filter(Boolean).slice(0, 3);
  if (cover.length) {
    const sz = 46, gap = 8, total = cover.length * sz + (cover.length - 1) * gap;
    let x = (W - total) / 2;
    cover.forEach(ph => { setFill([255, 255, 255]); doc.rect(x - 1.2, 128 - 1.2, sz + 2.4, sz + 2.4, 'F'); doc.addImage(ph, 'JPEG', x, 128, sz, sz); x += sz + gap; });
  }
  // Condiciones
  const cond = [`Pedido mínimo: ${WHOLESALE_MIN_QTY} unidades por referencia`];
  const fs = Number(settings.freeShipWholesale);
  if (fs > 0) cond.push(`Envío gratis en Bogotá desde ${fmt(fs)}`);
  cond.push('Precios en pesos colombianos (COP), sujetos a disponibilidad');
  setText([255, 255, 255]); doc.setFontSize(11);
  cond.forEach((t, i) => doc.text(clean(t), W / 2, 196 + i * 7, { align: 'center' }));
  setFill(ORO); doc.roundedRect(W / 2 - 46, 232, 92, 24, 3, 3, 'F');
  setText(PINO); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('Haz tu pedido', W / 2, 240, { align: 'center' });
  doc.setFontSize(11); doc.text(site, W / 2, 246.5, { align: 'center' });
  if (wa) { doc.setFont('helvetica', 'normal'); doc.text('WhatsApp ' + wa, W / 2, 252, { align: 'center' }); }

  // ---------- Páginas de productos ----------
  const COLS = 3, GAP = 5, CW = (W - 2 * M - (COLS - 1) * GAP) / COLS, CH = 80, IMG = 50;
  const TOP = 22, BOTTOM = H - 14;
  let pageNo = 1, y = 0, col = 0, lastCat = null;
  const newPage = () => {
    doc.addPage(); pageNo++;
    setFill(PINO); doc.rect(0, 0, W, 13, 'F');
    setText([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(store.toUpperCase(), M, 8.4, { charSpace: 1 });
    setText(ORO); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Catálogo mayorista · ' + fecha, W - M, 8.4, { align: 'right' });
    setDraw(LINEA); doc.setLineWidth(0.2); doc.line(M, H - 11, W - M, H - 11);
    setText(GRIS); doc.setFontSize(8);
    doc.text(`${site}${wa ? '  ·  WhatsApp ' + wa : ''}  ·  Pedido mínimo ${WHOLESALE_MIN_QTY} unidades`, M, H - 6.5);
    doc.text(String(pageNo), W - M, H - 6.5, { align: 'right' });
    y = TOP; col = 0;
  };
  newPage();

  list.forEach((p, idx) => {
    const cat = clean(p.category) || 'Otros productos';
    if (cat !== lastCat) {
      if (col !== 0) { y += CH + GAP; col = 0; }
      if (y + 11 + CH > BOTTOM) newPage();
      setText(PINO); doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(cat, M, y + 5);
      setDraw(ORO); doc.setLineWidth(0.7); doc.line(M, y + 7.5, M + 22, y + 7.5);
      y += 11; lastCat = cat;
    }
    if (y + CH > BOTTOM) newPage();
    const x = M + col * (CW + GAP);
    // tarjeta
    setFill([255, 255, 255]); setDraw(LINEA); doc.setLineWidth(0.25); doc.roundedRect(x, y, CW, CH, 2, 2, 'FD');
    if (photos[idx]) doc.addImage(photos[idx], 'JPEG', x + 0.6, y + 0.6, CW - 1.2, IMG - 0.6);
    else { setFill([243, 244, 246]); doc.rect(x + 0.6, y + 0.6, CW - 1.2, IMG - 0.6, 'F'); setText(GRIS); doc.setFontSize(8); doc.text('Sin foto', x + CW / 2, y + IMG / 2, { align: 'center' }); }
    // nombre (máx. 2 líneas)
    setText(TXT); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.6);
    let lines = doc.splitTextToSize(clean(p.name) || 'Producto', CW - 6);
    if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = lines[1].replace(/.{0,2}$/, '…'); }
    doc.text(lines, x + 3, y + IMG + 5);
    // referencia
    setText(GRIS); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
    const ref = clean(p.ref || p.reference || p.sku || p.barcode);
    doc.text(ref ? 'Ref. ' + ref : '', x + 3, y + IMG + 14);
    // precio
    setText(PINO); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(fmt(wholesalePriceOf(p, prices, config)), x + 3, y + IMG + 21.5);
    // colores / variantes
    if (p.variants && p.variants.length) {
      setText(GRIS); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
      const colors = doc.splitTextToSize('Colores: ' + p.variants.map(v => clean(v.color)).filter(Boolean).join(', '), CW - 6)[0];
      doc.text(colors, x + 3, y + CH - 2.6);
    }
    col++; if (col === COLS) { col = 0; y += CH + GAP; }
  });

  const total = doc.getNumberOfPages();
  doc.setProperties({ title: `Catálogo mayorista ${store}`, subject: 'Catálogo de precios al por mayor', author: store });
  return { doc, count: list.length, pages: total, filename: `Catalogo_Mayorista_${store.replace(/\s+/g, '_')}_${now.toISOString().slice(0, 10)}.pdf` };
}
