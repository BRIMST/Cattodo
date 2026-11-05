// Qué productos se muestran en el portal mayorista.
//
// Un producto activo se OCULTA del portal mayorista si:
//   1. El administrador lo marcó como oculto (product.wholesaleHidden), o
//   2. La regla automática está activa (por defecto sí) y no hay stock
//      suficiente para un pedido mínimo: menos de WHOLESALE_MIN_QTY unidades.
//
// Lógica pura (sin Firebase ni DOM) compartida por la tienda y el panel.

export const WHOLESALE_MIN_QTY = 3;

const has = (v) => v !== undefined && v !== null && v !== '';

// Unidades disponibles: número, o null si el producto no tiene límite de stock.
// Con variantes (colores/tallas) se suman las de todas; si alguna no tiene
// stock definido se considera sin límite.
export function getAvailableStock(p) {
  if (p.variants && p.variants.length > 0) {
    if (p.variants.some(v => !has(v.stock))) return null;
    return p.variants.reduce((sum, v) => sum + Math.max(0, Number(v.stock) || 0), 0);
  }
  if (!has(p.stock)) return null;
  return Math.max(0, Number(p.stock) || 0);
}

// -> { visible: boolean, reason: null | 'manual' | 'stock', available: number|null }
export function wholesaleVisibility(p, { autoHide = true, min = WHOLESALE_MIN_QTY } = {}) {
  const available = getAvailableStock(p);
  if (p.wholesaleHidden) return { visible: false, reason: 'manual', available };
  if (autoHide && available !== null && available < min) return { visible: false, reason: 'stock', available };
  return { visible: true, reason: null, available };
}
