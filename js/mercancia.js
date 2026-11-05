// Carga masiva de mercancía desde Excel (plantilla "Pedido").
//
// Columnas reconocidas (sin importar mayúsculas, tildes ni puntos):
//   Producto · Referencia · Cód. Barras · UM · Cantidad · Precio costo ·
//   Costo envio · precio detal · precio mayorista
//
// Regla: si la referencia (o, si no hay, el código de barras) ya existe, se
// SUMA la cantidad al stock y se actualiza el costo; si no existe, se crea el
// producto con los datos de la fila.
//
// Este archivo es lógica pura (sin Firebase ni DOM) para poder probarla sola.

const norm = (k) => String(k ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const COLUMN_ALIASES = {
  name: ['producto', 'nombre', 'name', 'descripcion'],
  ref: ['referencia', 'ref', 'reference', 'sku'],
  barcode: ['cod barras', 'codigo de barras', 'codigo barras', 'barcode', 'ean'],
  unit: ['um', 'unidad', 'unidad de medida', 'unit'],
  qty: ['cantidad', 'cant', 'unidades', 'qty', 'stock'],
  cost: ['precio costo', 'precio de costo', 'costo', 'precio de compra', 'cost'],
  shipping: ['costo envio', 'costo de envio', 'envio'],
  price: ['precio detal', 'precio al detal', 'precio de venta', 'precio venta', 'precio', 'price'],
  wholesale: ['precio mayorista', 'precio al por mayor', 'wholesale price']
};

// Convierte "$22.600", 22600 o "22600" en número entero (NaN si no hay dato).
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits === '' ? NaN : parseInt(digits, 10);
}

const clean = (v) => String(v ?? '').trim();
const keyOf = (v) => clean(v).toLowerCase();

// El nombre de la plantilla suele venir como "TT-14-TERMO 900ML ...": quitamos
// el prefijo con la referencia porque la tarjeta del producto ya la muestra aparte.
export function cleanProductName(name, ref) {
  let n = clean(name);
  if (ref) {
    const r = clean(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = n.replace(new RegExp(`^${r}\\s*[-–—:]\\s*`, 'i'), '').trim();
    if (stripped) n = stripped;
  }
  return n;
}

// Lee las filas de sheet_to_json y las convierte en ítems normalizados.
// Varias filas con la misma referencia se agrupan sumando cantidades.
export function parseMercanciaRows(rows) {
  const skipped = [];
  const grouped = new Map();
  let columnsOk = false;

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // fila 1 son los encabezados
    const cols = {};
    Object.keys(row).forEach(k => {
      const nk = norm(k);
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (!(field in cols) && aliases.includes(nk)) cols[field] = k;
      }
    });
    if (cols.ref || cols.barcode) columnsOk = true;

    const get = (f) => (cols[f] !== undefined ? row[cols[f]] : '');
    const ref = clean(get('ref'));
    const barcode = clean(get('barcode'));
    const rawName = clean(get('name'));

    // Fila vacía: la ignoramos sin ruido
    if (!ref && !barcode && !rawName) return;
    if (!ref && !barcode) {
      skipped.push({ row: rowNum, name: rawName, reason: 'sin referencia ni código de barras' });
      return;
    }

    const qty = toNumber(get('qty'));
    const item = {
      row: rowNum,
      ref,
      barcode,
      name: cleanProductName(rawName, ref),
      unit: clean(get('unit')),
      qty: Number.isNaN(qty) ? 0 : qty,
      cost: toNumber(get('cost')),
      price: toNumber(get('price')),
      wholesale: toNumber(get('wholesale'))
    };

    const key = ref ? 'r:' + keyOf(ref) : 'b:' + barcode;
    const prev = grouped.get(key);
    if (prev) {
      prev.qty += item.qty;                    // misma referencia repetida: se suman
      prev.rows.push(rowNum);
      ['cost', 'price', 'wholesale'].forEach(f => { if (!Number.isNaN(item[f])) prev[f] = item[f]; });
      if (!prev.barcode && item.barcode) prev.barcode = item.barcode;
    } else {
      grouped.set(key, { ...item, rows: [rowNum] });
    }
  });

  return { items: [...grouped.values()], skipped, columnsOk };
}

// Decide qué hacer con cada ítem frente a los productos que ya existen.
//  - create:  productos nuevos (con datos listos para guardar)
//  - restock: productos existentes (se suma stock, se actualiza costo)
//  - skipped: filas que no se pueden procesar, con el motivo
export function planMercancia(items, products) {
  const byRef = new Map();
  const byBarcode = new Map();
  products.forEach(p => {
    if (p.ref) byRef.set(keyOf(p.ref), p);
    if (p.barcode) byBarcode.set(clean(p.barcode), p);
  });

  const create = [], restock = [], skipped = [];

  items.forEach(it => {
    const label = it.name || it.ref || it.barcode;
    const existing = (it.ref && byRef.get(keyOf(it.ref))) || (it.barcode && byBarcode.get(it.barcode)) || null;

    if (existing) {
      if (existing.variants && existing.variants.length > 0) {
        skipped.push({ row: it.rows[0], name: label, reason: 'el producto tiene variantes (colores/tallas): reabastécelo desde su ficha' });
        return;
      }
      if (it.qty <= 0 && Number.isNaN(it.cost)) {
        skipped.push({ row: it.rows[0], name: label, reason: 'sin cantidad ni costo para actualizar' });
        return;
      }
      const currentStock = Number(existing.stock) > 0 ? Number(existing.stock) : 0;
      restock.push({
        id: existing.id,
        name: existing.name,
        ref: existing.ref || it.ref,
        add: it.qty,
        stockBefore: currentStock,
        stockAfter: currentStock + it.qty,
        cost: Number.isNaN(it.cost) ? null : it.cost,
        barcode: !existing.barcode && it.barcode ? it.barcode : null
      });
      return;
    }

    // Producto nuevo: necesita nombre y precio al detal
    if (!it.name) {
      skipped.push({ row: it.rows[0], name: label, reason: 'producto nuevo sin nombre' });
      return;
    }
    if (Number.isNaN(it.price) || it.price <= 0) {
      skipped.push({ row: it.rows[0], name: label, reason: 'producto nuevo sin "precio detal" (si es una fórmula, abre y guarda el Excel para que se calcule)' });
      return;
    }
    create.push({
      wholesale: Number.isNaN(it.wholesale) || it.wholesale <= 0 ? null : it.wholesale,
      data: {
        name: it.name,
        price: it.price,
        ref: it.ref,
        barcode: it.barcode,
        category: '',
        tags: '',
        stock: it.qty,
        cost: Number.isNaN(it.cost) ? null : it.cost,
        originalPrice: null,
        weight: 0.3,
        // "UM" numérica (p. ej. 50) es un código del proveedor, no una unidad legible
        unit: it.unit && !/^\d+$/.test(it.unit) ? it.unit : 'und',
        description: '',
        clipUrl: null,
        active: true,
        images: [],
        origen: 'propio'
      }
    });
  });

  return { create, restock, skipped };
}
