// Fotos incrustadas en un Excel: devuelve las imágenes de la PRIMERA hoja
// indexadas por número de fila (1 = primera fila de la hoja).
//
// Soporta las dos formas en que Excel guarda una foto:
//   1. "Imagen flotante" (Insertar > Imágenes > Este dispositivo): vive en un dibujo
//      anclado a una celda (xl/drawings/drawingN.xml).
//   2. "Imagen en la celda" (Excel 365, Colocar en la celda): la celda apunta a un
//      valor enriquecido (xl/metadata.xml + xl/richData/*).
// Un .xlsx es un ZIP; JSZip se pasa como parámetro para poder probarlo y cargarlo
// solo cuando hace falta.

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const parseXml = (txt) => new DOMParser().parseFromString(txt, 'application/xml');
const byLocal = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const attrAny = (el, name) => el.getAttribute(name) ?? el.getAttribute('r:' + name);

// Ruta relativa de un Target ("../media/a.png") frente a la carpeta del archivo que la declara
function resolvePath(baseFile, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseFile.split('/'); parts.pop();
  target.split('/').forEach(seg => { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); });
  return parts.join('/');
}

async function readText(zip, path) {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

async function readRels(zip, ownerPath) {
  const dir = ownerPath.split('/').slice(0, -1).join('/');
  const file = ownerPath.split('/').pop();
  const txt = await readText(zip, `${dir ? dir + '/' : ''}_rels/${file}.rels`);
  const map = {};
  if (txt) byLocal(parseXml(txt), 'Relationship').forEach(r => { map[r.getAttribute('Id')] = resolvePath(ownerPath, r.getAttribute('Target')); });
  return map;
}

async function firstSheetPath(zip) {
  const wb = await readText(zip, 'xl/workbook.xml');
  if (!wb) return 'xl/worksheets/sheet1.xml';
  const sheet = byLocal(parseXml(wb), 'sheet')[0];
  const rid = sheet && attrAny(sheet, 'id');
  const rels = await readRels(zip, 'xl/workbook.xml');
  return (rid && rels[rid]) || 'xl/worksheets/sheet1.xml';
}

async function imageEntry(zip, mediaPath) {
  const f = zip.file(mediaPath);
  if (!f) return null;
  const ext = mediaPath.split('.').pop().toLowerCase();
  return { bytes: await f.async('uint8array'), mime: MIME[ext] || 'image/png', ext };
}

// 1) Imágenes flotantes ancladas a una celda
async function floatingImages(zip, sheetPath, out) {
  const rels = await readRels(zip, sheetPath);
  for (const target of Object.values(rels)) {
    if (!/drawings\/[^/]+\.xml$/i.test(target)) continue;
    const xml = await readText(zip, target);
    if (!xml) continue;
    const drels = await readRels(zip, target);
    const doc = parseXml(xml);
    const anchors = [...byLocal(doc, 'twoCellAnchor'), ...byLocal(doc, 'oneCellAnchor')];
    for (const a of anchors) {
      const blip = byLocal(a, 'blip')[0];
      const from = byLocal(a, 'from')[0];
      if (!blip || !from) continue;
      const rowEl = byLocal(from, 'row')[0];
      const mediaPath = drels[attrAny(blip, 'embed')];
      if (!rowEl || !mediaPath) continue;
      const row = parseInt(rowEl.textContent, 10) + 1;
      if (!out.has(row)) { const img = await imageEntry(zip, mediaPath); if (img) out.set(row, img); }
    }
  }
}

// 2) Imágenes dentro de la celda (valores enriquecidos de Excel 365)
async function inCellImages(zip, sheetPath, out) {
  const sheetXml = await readText(zip, sheetPath);
  const metaXml = await readText(zip, 'xl/metadata.xml');
  const rvXml = await readText(zip, 'xl/richData/rdrichvalue.xml');
  const relXml = await readText(zip, 'xl/richData/richValueRel.xml');
  if (!sheetXml || !metaXml || !rvXml || !relXml) return;

  // celdas con vm="N" -> fila
  const cells = [];
  const tagRe = /<c\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(sheetXml))) {
    const tag = m[0];
    const vm = /\bvm="(\d+)"/.exec(tag);
    const r = /\br="[A-Z]+(\d+)"/.exec(tag);
    if (vm && r) cells.push({ vm: parseInt(vm[1], 10), row: parseInt(r[1], 10) });
  }
  if (!cells.length) return;

  const meta = parseXml(metaXml);
  const valueBks = byLocal(byLocal(meta, 'valueMetadata')[0] || meta, 'bk');
  const futureBks = byLocal(byLocal(meta, 'futureMetadata')[0] || meta, 'bk');
  const rvs = byLocal(parseXml(rvXml), 'rv');
  const relIds = byLocal(parseXml(relXml), 'rel').map(r => attrAny(r, 'id'));
  const relMap = await readRels(zip, 'xl/richData/richValueRel.xml');

  // posición de _rvRel:LocalImageIdentifier dentro de cada valor (normalmente la primera)
  let relPos = 0;
  const structXml = await readText(zip, 'xl/richData/rdrichvaluestructure.xml');
  if (structXml) {
    const ks = byLocal(parseXml(structXml), 'k');
    const i = ks.findIndex(k => /LocalImageIdentifier/i.test(k.getAttribute('n') || ''));
    if (i >= 0) relPos = i;
  }

  for (const c of cells) {
    let rvIndex = c.vm - 1;                              // por defecto: vm 1 -> valor 0
    const rc = valueBks[c.vm - 1] && byLocal(valueBks[c.vm - 1], 'rc')[0];
    if (rc) {
      const fb = futureBks[parseInt(rc.getAttribute('v'), 10)];
      const rvb = fb && byLocal(fb, 'rvb')[0];
      if (rvb) rvIndex = parseInt(rvb.getAttribute('i'), 10);
    }
    const rv = rvs[rvIndex];
    if (!rv) continue;
    const relIndex = parseInt(byLocal(rv, 'v')[relPos]?.textContent, 10);
    const mediaPath = relMap[relIds[relIndex]];
    if (mediaPath && !out.has(c.row)) { const img = await imageEntry(zip, mediaPath); if (img) out.set(c.row, img); }
  }
}

export async function extractSheetImages(arrayBuffer, JSZip) {
  const out = new Map();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sheetPath = await firstSheetPath(zip);
  await inCellImages(zip, sheetPath, out).catch(e => console.warn('Imágenes en celda:', e));
  await floatingImages(zip, sheetPath, out).catch(e => console.warn('Imágenes flotantes:', e));
  return out;
}

let jszipPromise = null;
export function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipPromise = null; reject(new Error('No cargó JSZip')); };
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}
