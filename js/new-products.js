// Productos nuevos: los creados en los últimos NEW_DAYS días.
//
// La fecha sale de product.createdAt (se guarda al crear). Los productos
// antiguos no la tienen, pero su clave de Firebase (push id) empieza con la
// hora de creación codificada, así que se puede recuperar de ahí.
// Lógica pura (sin Firebase ni DOM).

export const NEW_DAYS = 90;
const DAY_MS = 86400000;
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

export function decodePushIdTime(id) {
  if (typeof id !== 'string' || id.length < 20) return null;
  let t = 0;
  for (let i = 0; i < 8; i++) {
    const n = PUSH_CHARS.indexOf(id[i]);
    if (n < 0) return null;
    t = t * 64 + n;
  }
  // descarta ids que no son push ids (antes de 2015 o en el futuro lejano)
  return t > 1420070400000 && t < Date.now() + DAY_MS ? t : null;
}

// -> milisegundos o null si no se puede saber
export function getCreatedAt(p) {
  const c = Number(p && p.createdAt);
  if (Number.isFinite(c) && c > 0) return c;
  return decodePushIdTime(p && p.id);
}

export function isNewProduct(p, now = Date.now(), days = NEW_DAYS) {
  const t = getCreatedAt(p);
  return t !== null && now - t >= -DAY_MS && now - t <= days * DAY_MS;
}
