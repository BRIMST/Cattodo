// ====== ANALYTICS HELPER ======
// Envía eventos a GA4 de forma segura sin romper nada si gtag no está cargado
const trackEvent = (eventName, label, extraParams = {}) => {
  try {
    if (typeof gtag === 'function') {
      gtag('event', eventName, {
        event_category: 'engagement',
        event_label: label,
        value: 1,
        ...extraParams
      });
    }
  } catch(e) {}
};

// ====== FIREBASE MODULAR SDK ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getDatabase, ref, onValue, push, get, set
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js";
import { WHOLESALE_MIN_QTY, wholesaleVisibility, getAvailableStock } from "./wholesale-visibility.js";
import { isNewProduct, getCreatedAt, NEW_DAYS } from "./new-products.js";

// ====== SECURITY - Password hashing ======
const hashPassword = async (password) => {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ====== CONFIGURATION ======
const firebaseConfig = {
  apiKey: "AIzaSyBG0ygruEcBUnXKotCRRG2FEKejcLxKLQQ",
  authDomain: "pandaventa-cdc06.firebaseapp.com",
  databaseURL: "https://pandaventa-cdc06-default-rtdb.firebaseio.com",
  projectId: "pandaventa-cdc06",
  storageBucket: "pandaventa-cdc06.firebasestorage.app",
  messagingSenderId: "29437252231",
  appId: "1:29437252231:web:802a5ce85b495e961b9e22",
  measurementId: "G-WKD6VTSP03"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);

// ====== STATE ======
let products = [];
let settings = {
  storeName: 'Panda Venta', tagline: 'Pedidos por WhatsApp', whatsapp: '',
  color: '#6c63ff', currency: 'COP', logo: '', adminPassword: '',
  paymentInfo: '', paymentQR: '', shippingCost: 0,
  freeShipRetail: 100000, freeShipWholesale: 300000, bogotaShippingFee: 8000,
  locContent: {
    bgtTitle: '¡Envío GRATIS hoy en Bogotá! ⚡',
    bgtSub: 'Pide antes de las 12 PM y recibe hoy mismo.',
    natTitle: 'Lo que buscas, al mejor precio',
    natSub: 'Compra fácil y rápido — envíos a toda Colombia'
  }
};
let orders = [];
// Cada canal (detal / mayorista) tiene su propio carrito, porque los precios
// son distintos y no deben mezclarse en un mismo pedido.
const carts = { retail: {}, wholesale: {} };
let cart = carts.retail;
let currentFilter = 'all';
let currentQuickView = null; // null | 'discount' | 'new'
let isWholesaleMode = false;
// En pedidos mayoristas se compran mínimo 3 unidades de cada producto
// (se cuentan sumando todas sus variantes: colores, aromas, tamaños).

// ====== PORTAL MAYORISTA (acceso con cuenta) ======
// Cada mayorista tiene una cuenta de Firebase Authentication y un registro en
// "wholesalers/{uid}" que el administrador activa o desactiva. Los precios
// mayoristas ("wholesalePrices") y el descuento por defecto ("wholesaleConfig")
// están en nodos que las reglas de Firebase solo dejan leer a mayoristas
// activos y al personal, así que nadie más puede verlos.
let wholesaleSession = null;   // { uid, name, email, phone } cuando hay mayorista autorizado
let wholesalePrices = {};      // { productId: precio }
let wholesaleConfig = {};      // { discount }

// Se resuelve cuando Firebase termina de restaurar la sesión guardada (si existe).
const authReady = new Promise(resolve => {
  const unsub = onAuthStateChanged(auth, () => { unsub(); resolve(); });
});

// Comprueba que el usuario sea un mayorista activo y carga sus precios.
async function verifyWholesaler(user) {
  try {
    const snap = await get(ref(db, `wholesalers/${user.uid}`));
    const info = snap.val();
    if (!info || info.active !== true) return false;
    const [pricesSnap, configSnap] = await Promise.all([
      get(ref(db, 'wholesalePrices')),
      get(ref(db, 'wholesaleConfig'))
    ]);
    wholesalePrices = pricesSnap.val() || {};
    wholesaleConfig = configSnap.val() || {};
    wholesaleSession = {
      uid: user.uid,
      name: info.name || user.displayName || user.email,
      email: user.email,
      phone: info.phone || ''
    };
    return true;
  } catch (err) {
    console.error('No se pudo verificar la cuenta mayorista:', err.code || err);
    return false;
  }
}

function showWholesaleLoginState(state, message) {
  safeStyle('wholesale-login-checking', 'display', state === 'checking' ? 'block' : 'none');
  safeStyle('wholesale-login-form', 'display', state === 'form' ? 'block' : 'none');
  const err = document.getElementById('wholesale-login-error');
  if (err) {
    err.textContent = message || '';
    err.style.display = message ? 'block' : 'none';
  }
}

async function enterWholesalePortal() {
  switchView('wholesale-login');
  showWholesaleLoginState('checking');
  await authReady;
  if (!wholesaleSession && auth.currentUser) await verifyWholesaler(auth.currentUser);
  // Si el usuario ya navegó a otra página mientras verificábamos, no tocamos nada.
  if (window.location.pathname.replace(/\/$/, '') !== '/mayoristas') return;

  if (!wholesaleSession) {
    showWholesaleLoginState('form');
    return;
  }
  setWholesaleMode(true);
  safeText('wholesale-welcome', `Hola, ${wholesaleSession.name}`);
  // Adelantamos los datos del cliente en el checkout
  if (!document.getElementById('customer-name')?.value) safeValue('customer-name', wholesaleSession.name);
  if (!document.getElementById('customer-phone')?.value && wholesaleSession.phone) safeValue('customer-phone', wholesaleSession.phone);
  switchView('catalog');
  refreshWholesaleToolbar();
  if (isProductsLoaded) {
    renderProducts();
    updateCartUI();
  }
}

function refreshWholesaleToolbar() {
  const toggle = document.getElementById('btn-view-toggle');
  if (toggle) {
    toggle.textContent = wholesaleListView ? '▦ Vista cuadrícula' : '☰ Vista lista';
    toggle.setAttribute('aria-pressed', wholesaleListView ? 'true' : 'false');
  }
  let hasLast = false;
  try { hasLast = !!(wholesaleSession && localStorage.getItem('ws_last_order_' + wholesaleSession.uid)); } catch (e) { /* sin almacenamiento */ }
  safeStyle('btn-repeat-order', 'display', hasLast ? 'inline-block' : 'none');
}

// Vuelve a cargar en el carrito el último pedido del mayorista (respeta stock y mínimo).
function repeatLastWholesaleOrder() {
  if (!wholesaleSession) return;
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('ws_last_order_' + wholesaleSession.uid) || '[]'); } catch (e) { /* ignorar */ }
  let added = 0, skipped = 0;
  saved.forEach(({ cartId, qty }) => {
    const p = products.find(x => x.id === String(cartId).split(':')[0]);
    if (!p || !p.active || isOutOfStock(p)) { skipped++; return; }
    updateCart(cartId, qty);
    if (cart[cartId]) added++; else skipped++;
  });
  showToast(added
    ? `Pedido anterior cargado (${added} producto${added !== 1 ? 's' : ''})${skipped ? `. ${skipped} no disponible${skipped !== 1 ? 's' : ''}` : ''}`
    : 'Ningún producto del pedido anterior está disponible');
  if (added) navigateTo('/pedido');
}

async function wholesaleLogin(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  if (!(await verifyWholesaler(auth.currentUser))) {
    // La cuenta existe pero no es de un mayorista activo (o fue desactivada).
    await signOut(auth);
    throw Object.assign(new Error('no-wholesaler'), { code: 'app/no-wholesaler' });
  }
}

async function wholesaleLogout() {
  const wasWholesaler = !!wholesaleSession;
  wholesaleSession = null;
  wholesalePrices = {};
  wholesaleConfig = {};
  Object.keys(carts.wholesale).forEach(id => delete carts.wholesale[id]);
  setWholesaleMode(false);
  if (wasWholesaler) { try { await signOut(auth); } catch (e) { console.error(e); } }
}

// ¿Se muestra este producto en el portal mayorista? (ocultos a mano o sin stock para el mínimo)
function isVisibleInWholesale(p) {
  return wholesaleVisibility(p, { autoHide: wholesaleConfig.autoHideLowStock !== false, min: WHOLESALE_MIN_QTY }).visible;
}
// Productos activos que el canal actual puede mostrar
const getShownProducts = () => products.filter(p => p.active && (!isWholesaleMode || isVisibleInWholesale(p)));

// Total de unidades de un producto en el carrito actual, sumando variantes.
function getProductQtyInCart(productId) {
  return Object.entries(cart).reduce((sum, [cartId, q]) => (
    cartId.split(':')[0] === productId ? sum + q : sum
  ), 0);
}

// Productos del carrito mayorista que no llegan al mínimo (para validar al pedir).
function getWholesaleShortfalls() {
  if (!isWholesaleMode) return [];
  const totals = {};
  Object.entries(cart).forEach(([cartId, q]) => {
    const id = cartId.split(':')[0];
    totals[id] = (totals[id] || 0) + q;
  });
  return Object.entries(totals)
    .filter(([, q]) => q < WHOLESALE_MIN_QTY)
    .map(([id]) => products.find(x => x.id === id)?.name || id);
}

// Ruta del catálogo según el canal activo.
const getCatalogPath = () => (isWholesaleMode ? '/mayoristas' : '/');

function setWholesaleMode(enabled) {
  enabled = !!enabled;
  if (enabled === isWholesaleMode) return;
  isWholesaleMode = enabled;
  cart = enabled ? carts.wholesale : carts.retail;
  document.body.classList.toggle('wholesale-mode', enabled);
  safeText('header-store-tagline', enabled ? 'Catálogo mayorista' : (settings.tagline || 'Catálogo Digital'));
  safeText('catalog-section-title', enabled ? 'Catálogo mayorista' : 'Todos los productos');
  const toggleBtn = document.getElementById('btn-wholesale-toggle');
  if (toggleBtn) toggleBtn.textContent = enabled ? 'Salir del portal' : '🔐 Mayoristas';
  currentFilter = 'all'; // la categoría elegida puede no existir en el otro canal
  currentQuickView = null;
  updateCartUI();
  if (isProductsLoaded) { renderSearchSuggestions(); renderFilters(); renderProducts(); }
}

// ====== TEMA NAVIDEÑO ======
// Guirnalda de luces (se enciende una vez al cargar) y conteo de días para Navidad.
// El tema se puede apagar desde el panel (ajuste "Tema navideño").
function initNavidadTheme() {
  const luces = document.getElementById('luces');
  if (luces && !luces.childElementCount) {
    luces.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
  }
  // La guirnalda se esconde al bajar para no tapar el catálogo
  const header = document.querySelector('.catalog-header');
  if (header) window.addEventListener('scroll', () => header.classList.toggle('luces-off', window.scrollY > 80), { passive: true });
}
function updateNavidadCountdown() {
  const tag = document.getElementById('hero-tag');
  if (!tag) return;
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), 11, 25) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days > 1) tag.textContent = `🎄 Faltan ${days} días para Navidad`;
  else if (days === 1) tag.textContent = '🎄 Mañana es Navidad';
  else if (days === 0) tag.textContent = '🎄 ¡Feliz Navidad!';
  else tag.style.display = 'none'; // pasada la Navidad no se muestra
}
function applyNavidadTheme(enabled) {
  document.body.classList.toggle('theme-navidad', enabled);
  if (enabled) updateNavidadCountdown();
}
initNavidadTheme();

// ====== MEJORAS DE EXPERIENCIA ======
let currentSort = 'default';
let wholesaleListView = false;
try { wholesaleListView = localStorage.getItem('ws_list_view') === '1'; } catch (e) { /* sin almacenamiento */ }

// Un producto está agotado cuando tiene un stock definido y es 0 (o todas sus variantes lo son).
function isOutOfStock(p) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  if (p.variants && p.variants.length > 0) {
    return p.variants.every(v => has(v.stock) && Number(v.stock) <= 0);
  }
  return has(p.stock) && Number(p.stock) <= 0;
}

function sortProducts(list) {
  const arr = [...list];
  if (currentSort === 'price-asc') arr.sort((a, b) => getProductPrice(a) - getProductPrice(b));
  else if (currentSort === 'price-desc') arr.sort((a, b) => getProductPrice(b) - getProductPrice(a));
  else if (currentSort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  else if (currentSort === 'newest') arr.sort((x, y) => (getCreatedAt(y) || 0) - (getCreatedAt(x) || 0));
  else {
    // Recomendados: los productos nuevos (últimos 90 días) van primero, el más reciente arriba
    const fresh = arr.filter(p => isNewProduct(p)).sort((x, y) => (getCreatedAt(y) || 0) - (getCreatedAt(x) || 0));
    if (fresh.length) return [...fresh, ...arr.filter(p => !isNewProduct(p))];
  }
  return arr;
}

// Indicador de pasos del pedido: 1 pedido, 2 envío (ciudad elegida), 3 confirmar (envío cotizado).
function updateOrderSteps() {
  const steps = document.querySelectorAll('#order-steps .order-step');
  if (!steps.length) return;
  const cityChosen = !!(document.getElementById('customer-city')?.value);
  const shippingReady = !!selectedShippingOption;
  const current = shippingReady ? 3 : (cityChosen ? 2 : 1);
  steps.forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === current);
    li.classList.toggle('done', n < current);
  });
}

function getProductPrice(p) {
  if (!p) return 0;
  if (isWholesaleMode) {
    // Los precios mayoristas viven en una zona privada de la base de datos
    // (solo se cargan después de iniciar sesión como mayorista autorizado).
    const own = wholesalePrices[p.id];
    if (own !== undefined && own !== null && own !== '' && own !== 0) {
      return parseFloat(own);
    }
    const discount = wholesaleConfig.discount !== undefined ? parseFloat(wholesaleConfig.discount) : 20;
    const factor = (100 - discount) / 100;
    const price = parseFloat(p.price) || 0;
    return Math.round((price * factor) / 100) * 100;
  }
  return parseFloat(p.price) || 0;
}
let currentProductImages = [];
let viewerImages = [];
let viewerIndex = 0;
let views = {};
let els = {};
let selectedVariants = {}; // {productId: color}
let isProductsLoaded = false;
let currentDetailProduct = null;
let currentDetailQty = 1;
let currentDetailColor = null;

// Etiqueta a mostrar según el tipo de variante del producto (color/aroma/tamaño).
// 'color' es el valor por defecto para productos antiguos sin variantType guardado.
const VARIANT_TYPE_LABELS = { color: 'Color', aroma: 'Aroma', 'tamaño': 'Tamaño' };
function getVariantLabel(p) {
  return VARIANT_TYPE_LABELS[p?.variantType] || 'Color';
}

// ====== UTILS ======
const compressImage = (base64Str, maxWidth = 800, quality = 0.6) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Si el navegador no puede leer la imagen (p. ej. HEIC de iPhone) antes se
    // quedaba esperando para siempre; ahora falla con un error claro.
    img.onerror = () => reject(new Error('No se pudo leer la imagen (usa JPG, PNG o WEBP)'));
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // No re-escalar si es más pequeña que el máximo
      const scale = Math.min(maxWidth / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Forzar WebP para máxima compresión sin pérdida visual notable
      resolve(canvas.toDataURL('image/webp', quality));
    };
  });
};

// Sube una imagen ya comprimida (dataURL) a Firebase Storage y devuelve el
// link público — en vez de guardar el texto base64 directo dentro de la
// base de datos (lo que hacíamos antes, y que hace la base de datos cada vez
// más pesada de leer a medida que crece el catálogo). Los datos existentes
// (fotos ya guardadas como base64) se quedan igual y siguen funcionando —
// esto solo cambia cómo se guardan las fotos NUEVAS de aquí en adelante.
// ====== SUBIDA DE IMÁGENES (rápida) ======
// Antes: archivo → base64 → imagen → canvas → base64 → blob → subir (4 conversiones y mucha memoria).
// Ahora: archivo → canvas → blob WebP → subir. Además la subida espera por INACTIVIDAD
// (10 s sin avance) en vez de un tiempo total, y si Storage falla no se reintenta en cada
// foto del mismo lote (antes cada foto esperaba su propio tiempo de espera completo).
const STORAGE_STALL_MS = 10000;
const STORAGE_COOLDOWN_MS = 90000;
let storageFailedAt = 0;
const isStorageCoolingDown = () => Date.now() - storageFailedAt < STORAGE_COOLDOWN_MS;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Archivo de imagen -> Blob WebP reducido (JPEG si el navegador no sabe codificar WebP)
const fileToImageBlob = async (file, maxWidth = 800, quality = 0.6) => {
  let source = null, w = 0, h = 0, cleanup = () => {};
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file);
      w = source.width; h = source.height;
      cleanup = () => { try { source.close(); } catch (e) { /* ya cerrada */ } };
    } catch (e) { source = null; }
  }
  if (!source) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error('No se pudo leer la imagen (usa JPG, PNG o WEBP)');
    }
    source = img; w = img.naturalWidth; h = img.naturalHeight;
    cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    const scale = Math.min(maxWidth / w, 1); // no ampliar imágenes pequeñas
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const toBlob = (type) => new Promise(res => canvas.toBlob(res, type, quality));
    let blob = await toBlob('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
    if (!blob) throw new Error('No se pudo comprimir la imagen');
    return blob;
  } finally {
    cleanup();
  }
};

// Sube un Blob a Storage y devuelve su URL; lanza error si falla (sin respaldo).
const uploadBlobToStorage = async (blob, folder = 'products') => {
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fileRef = storageRef(storage, filename);
  const task = uploadBytesResumable(fileRef, blob, { contentType: blob.type || 'image/webp' });
  await new Promise((resolve, reject) => {
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { task.cancel(); reject(new Error('Firebase Storage no responde')); }, STORAGE_STALL_MS);
    };
    arm();
    task.on('state_changed', arm,
      (err) => { clearTimeout(timer); reject(err); },
      () => { clearTimeout(timer); resolve(); });
  });
  return await getDownloadURL(fileRef);
};

// Igual, pero si Storage falla devuelve la foto como base64 para no perderla.
const uploadWithFallback = async (blob, folder) => {
  if (!isStorageCoolingDown()) {
    try {
      return await uploadBlobToStorage(blob, folder);
    } catch (err) {
      storageFailedAt = Date.now();
      console.error('Error subiendo a Firebase Storage, se usa base64 como respaldo:', err);
      showToast('⚠️ Firebase Storage no responde: las fotos se guardan dentro del producto (más lento). Revisa Storage en Firebase.');
    }
  }
  return await blobToDataUrl(blob);
};

// Camino rápido: archivo de imagen -> URL (para fotos de productos)
const uploadImageFile = async (file, folder = 'products', maxWidth = 800, quality = 0.6) => {
  const blob = await fileToImageBlob(file, maxWidth, quality);
  return uploadWithFallback(blob, folder);
};

// Compatibilidad: quien ya tiene la imagen como dataURL
const uploadToStorage = async (dataUrl, folder = 'products') => {
  const blob = await (await fetch(dataUrl)).blob();
  return uploadWithFallback(blob, folder);
};

const formatMoney = (amount) => {
  return settings.currency + (settings.currency.length > 1 ? ' ' : '') + parseFloat(amount).toLocaleString('es-CO');
};

const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), Math.min(7000, Math.max(3000, String(msg).length * 55)));
  }
};

const switchView = (viewName) => {
  window.scrollTo(0, 0);
  Object.values(views).forEach(v => { if (v) v.classList.remove('active'); });
  if (views[viewName]) views[viewName].classList.add('active');
  // El botón flotante de WhatsApp debe evitar tapar la barra fija de "Tu
  // pedido" (o el carrito), cuya presencia depende de la vista activa.
  if (typeof updateWAButtonPosition === 'function') updateWAButtonPosition();
  // SEO: noindex en vistas privadas — envuelto en try/catch para no romper nada
  try {
    const privateViews = ['order', 'ticket', 'admin', 'login', 'wholesale-login', 'track'];
    let metaRobots = document.querySelector('meta[name="robots"]');
    if (!metaRobots) {
      metaRobots = document.createElement('meta');
      metaRobots.name = 'robots';
      document.head.appendChild(metaRobots);
    }
    metaRobots.content = (privateViews.includes(viewName) || isWholesaleMode) ? 'noindex, nofollow' : 'index, follow';
  } catch(e) {}
};

const formatInputCurrency = (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value === "") { e.target.value = ""; return; }
  e.target.value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
};

const safeSet = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
const safeText = (id, txt) => safeSet(id, 'textContent', txt);
const safeHTML = (id, html) => safeSet(id, 'innerHTML', html);
const safeValue = (id, val) => safeSet(id, 'value', val);
const safeStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

// ====== INIT ======
window.loadCatalog = async function() {
  try {
    // Antes buscaba un elemento "panel-admin" que ya no existe (el panel se
    // rediseñó y ahora es "view-admin") — por eso nunca detectaba que el
    // admin estaba abierto, y de paso siempre ejecutaba handleRoute() más
    // abajo, que fuerza la vista de vuelta al catálogo en cada acción del
    // panel (guardar producto, quitar foto, etc.) — eso era lo que te
    // "sacaba" del sistema con cada clic.
    const adminOpen = document.getElementById('view-admin')?.style.display === 'flex';
    const url = adminOpen ? '/api/catalogo?admin=true' : '/api/catalogo';
    
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.settings) {
      Object.keys(settings).forEach(key => delete settings[key]);
      Object.assign(settings, data.settings);
      applySettings();
    }
    
    if (data.products) {
      const val = data.products;
      let newProductsList = [];
      if (Array.isArray(val)) {
        newProductsList = val.map((p, idx) => p ? { ...p, id: String(idx) } : null).filter(p => p !== null);
      } else {
        newProductsList = Object.keys(val).map(key => ({ ...val[key], id: key }));
      }
      products.length = 0;
      products.push(...newProductsList);
    } else {
      products.length = 0;
    }
    
    isProductsLoaded = true;
    renderSearchSuggestions();
    renderFilters();
    renderProducts();
    renderQuickViews();
    updateCartUI();

    if (adminOpen) {
      // El panel de admin sigue abierto: solo refrescamos sus datos, sin
      // tocar la vista de cliente que hay detrás (evita el "kick out").
      import('./admin.js').then(m => m.renderAdminProducts());
    } else {
      handleRoute();
    }
  } catch (error) {
    console.error("Error cargando catálogo", error);
  }
};

function init() {
  window.loadCatalog();

  // Nota: se quitó el selector de canal (Detal/Mayorista) — isWholesaleMode
  // se queda permanentemente en "false" (su valor por defecto), así que toda
  // la lógica de precios/mínimos mayoristas queda inactiva sin necesidad de
  // tocarla en cada punto donde se usa.

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const contentEl = document.getElementById('tab-' + tab.dataset.tab);
      if (contentEl) contentEl.classList.add('active');
      // Refrescar datos al cambiar de tab (admin.js manejará esto si está cargado)
      if (window.renderAdminProducts) {
        if (tab.dataset.tab === 'reports') window.renderReports?.();
        if (tab.dataset.tab === 'orders') window.renderAdminOrders?.();
        if (tab.dataset.tab === 'products') window.renderAdminProducts?.();
      }
    };
  });

}

function applySettings() {
  document.documentElement.style.setProperty('--primary', settings.color);

  const hex = (settings.color || '#6c63ff').replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16),
        g = parseInt(hex.substring(2, 4), 16),
        b = parseInt(hex.substring(4, 6), 16);

  document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);

  safeText('header-store-name', settings.storeName);
  safeText('header-store-tagline', settings.tagline);

  const logoHTML = settings.logo
    ? `<img src="${settings.logo}" alt="Logo ${settings.storeName || 'Panda Venta'}" style="width:100%;height:100%;object-fit:contain;" fetchpriority="high" />`
    : `<span class="logo-emoji">🛒</span>`;

  safeHTML('header-logo-area', logoHTML);

  // Pie de página: nombre, año y redes sociales
  safeText('footer-store-name', settings.storeName || 'Panda Venta');
  safeText('footer-store-name-2', settings.storeName || 'Panda Venta');
  safeText('footer-year', new Date().getFullYear());
  applyNavidadTheme(settings.themeNavidad !== false);
  const footerWa = document.getElementById('footer-wa-link');
  const waDigits = String(settings.whatsapp || '').replace(/\D/g, '');
  if (footerWa) {
    footerWa.style.display = waDigits.length >= 10 ? 'inline' : 'none';
    footerWa.href = `https://wa.me/${waDigits}`;
  }

  const social = settings.social || {};
  const SOCIAL_ICONS = {
    instagram: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
    facebook: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`,
    tiktok: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`
  };
  const footerSocial = document.getElementById('footer-social');
  if (footerSocial) {
    const links = ['instagram', 'facebook', 'tiktok']
      .filter(key => social[key])
      .map(key => `<a href="${social[key]}" target="_blank" rel="noopener" class="footer-social-link" aria-label="${key}">${SOCIAL_ICONS[key]}</a>`)
      .join('');
    footerSocial.innerHTML = links;
    footerSocial.style.display = links ? 'flex' : 'none';
  }

  renderCustomerPhotos();
  renderPolicyPages();

  // ✅ FIX WHATSAPP BUTTON
  const waBtn = document.getElementById('global-wa-btn');

  if (waBtn) {
    const phone = String(settings.whatsapp || '').replace(/\D/g, '');

    if (phone.length >= 10) {
      const message = encodeURIComponent('Hola, tengo una pregunta');

      waBtn.style.display = 'flex';
      waBtn.href = `https://wa.me/${phone}?text=${message}`;
    } else {
      waBtn.style.display = 'none';
      console.warn('Número de WhatsApp inválido:', settings.whatsapp);
    }
  } else {
    console.warn('⚠️ No se encontró el botón de WhatsApp');
  }
  if (userLocation) setUserLocation(userLocation); // refresca textos de envío gratis con las metas
  renderFreeShip();
}

// Galería de "Clientes Felices": fotos reales subidas desde el panel de admin,
// guardadas en settings.customerPhotos para que lleguen con la misma petición
// que ya trae el resto de la configuración (sin tocar el backend).
function renderCustomerPhotos() {
  const section = document.getElementById('customer-photos-section');
  const wall = document.getElementById('customer-photos-wall');
  if (!section || !wall) return;

  const photos = settings.customerPhotos || [];
  if (!Array.isArray(photos) || photos.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  wall.innerHTML = photos.map((p, idx) => `
    <div class="customer-photo-frame" onclick="window.openCustomerPhotoViewer(${idx})">
      <img src="${p.url}" alt="Cliente feliz de ${settings.storeName || 'la tienda'}" loading="lazy">
    </div>
  `).join('');
}

// Páginas de políticas (Envíos / Devoluciones / Contacto) — requeridas por
// Google Merchant Center. Usa el texto que el admin escribió en Configuración,
// o un texto por defecto razonable si todavía no lo ha personalizado.
function renderPolicyPages() {
  const storeName = settings.storeName || 'nuestra tienda';
  const whatsapp = String(settings.whatsapp || '').replace(/\D/g, '');

  const defaultShipping = `Realizamos envíos a toda Colombia. Bogotá D.C.: entrega el mismo día en la mayoría de los casos. Resto del país: normalmente entre 2 y 5 días hábiles, según la transportadora asignada al cotizar tu pedido. El costo de envío se calcula automáticamente al finalizar tu compra, según tu ciudad y el peso de tu pedido.`;
  const defaultReturns = `Aceptamos cambios y devoluciones dentro de los 5 días hábiles siguientes a la entrega, siempre que el producto esté sin usar, en perfecto estado y en su empaque original. Para iniciar un cambio o devolución, contáctanos por WhatsApp con tu número de pedido y el motivo. Si el producto llega defectuoso o incorrecto, el cambio no tiene ningún costo para ti.`;
  const defaultContact = `¿Tienes preguntas sobre tu pedido o nuestros productos? Escríbenos por WhatsApp y te responderemos lo antes posible.`;

  const shippingEl = document.getElementById('shipping-policy-content');
  if (shippingEl) {
    shippingEl.innerHTML = `<p>${(settings.shippingPolicy || defaultShipping).replace(/\n/g, '</p><p>')}</p>`;
  }

  const returnsEl = document.getElementById('returns-policy-content');
  if (returnsEl) {
    returnsEl.innerHTML = `<p>${(settings.returnsPolicy || defaultReturns).replace(/\n/g, '</p><p>')}</p>`;
  }

  const contactEl = document.getElementById('contact-content');
  if (contactEl) {
    const waLink = whatsapp.length >= 10 ? `<p><a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="policy-contact-link">💬 Escríbenos por WhatsApp</a></p>` : '';
    contactEl.innerHTML = `<p>${(settings.contactInfo || defaultContact).replace(/\n/g, '</p><p>')}</p>${waLink}`;
  }
}

window.openCustomerPhotoViewer = function(idx) {
  const photos = settings.customerPhotos || [];
  if (photos.length === 0) return;
  viewerImages = photos.map(p => p.url);
  viewerIndex = idx;
  renderViewer();
  document.getElementById('image-viewer-modal').style.display = 'flex';
};

// ====== CATALOG ======
// Sugerencias de búsqueda: nombres de productos activos (el navegador las muestra al escribir).
function renderSearchSuggestions() {
  const dl = document.getElementById('search-suggestions');
  if (!dl) return;
  const names = [...new Set(getShownProducts().map(p => p.name).filter(Boolean))].slice(0, 80);
  dl.innerHTML = names.map(n => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
}

function renderFilters() {
  const categories = ['all', ...new Set(getShownProducts().map(p => p.category).filter(c => c))];
  els.categoryFilters.innerHTML = categories.map(cat =>
    `<button class="btn-category ${currentFilter === cat ? 'active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? 'Todos' : cat}
    </button>`
  ).join('');
  document.querySelectorAll('.btn-category').forEach(btn => {
    btn.onclick = (e) => {
      currentFilter = e.target.dataset.cat;
      // GA: filtro de categoría usado
      trackEvent('filtrar_categoria', `Categoría: ${currentFilter}`);
      renderFilters();
      renderProducts();
    };
  });
}

function renderCampaign() {
  const section = document.getElementById('campaign-section');
  const carousel = document.getElementById('campaign-carousel');
  const title = document.getElementById('campaign-title');
  if (!section || !carousel || !title) return;

  const camp = settings.activeCampaign;
  if (isWholesaleMode || !camp || !camp.enabled || !camp.tag) {
    section.style.display = 'none'; return;
  }

  const tag = camp.tag.toLowerCase();
  const campProducts = products.filter(p => p.active && p.tags && p.tags.toLowerCase().includes(tag));

  if (campProducts.length === 0) {
    section.style.display = 'none'; return;
  }

  title.textContent = camp.title || 'Destacados';
  section.style.display = 'block';

  carousel.innerHTML = campProducts.map(p => {
    return `<div class="product-card" style="margin:0; width:100%; height:100%; border:none;">${getProductHTML(p, camp.badgeText)}</div>`;
  }).join('');
}

function renderProducts() {
  const container = els.productsGrid;
  const emptyState = document.getElementById('empty-state');
  
  // Pre-calcular términos de búsqueda para evitar trabajo repetitivo en el filtro
  const searchQuery = (els.searchInput.value || '').toLowerCase().trim();
  const searchTerms = searchQuery ? searchQuery.split(' ').filter(t => t) : [];

  let filtered = getShownProducts();

  if (currentFilter !== 'all') {
    filtered = filtered.filter(p => p.category === currentFilter);
  }

  if (currentQuickView === 'discount') filtered = filtered.filter(hasActiveDiscount);
  else if (currentQuickView === 'new') filtered = filtered.filter(p => isNewProduct(p));

  if (searchTerms.length > 0) {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.ref || ''} ${p.category || ''}`.toLowerCase();
      return searchTerms.every(term => text.includes(term));
    });
  }

  filtered = sortProducts(filtered);
  container.classList.toggle('list-view', isWholesaleMode && wholesaleListView);

  if (filtered.length === 0) {
    if (isProductsLoaded) {
      container.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
      const hasFilters = !!searchQuery || currentFilter !== 'all' || !!currentQuickView;
      safeText('empty-state-text', hasFilters
        ? (searchQuery ? `No encontramos resultados para "${searchQuery}". Revisa la ortografía o prueba con otra palabra.` : 'No hay productos en esta categoría por ahora.')
        : 'No hay productos disponibles');
      safeStyle('btn-clear-filters', 'display', hasFilters ? 'inline-block' : 'none');
    }
    return;
  }

  container.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  if (typeof renderCampaign === 'function') renderCampaign();
  renderQuickViews();

  const countEl = document.getElementById('products-count');
  if (countEl) countEl.textContent = `${filtered.length} artículo${filtered.length !== 1 ? 's' : ''}`;

  // Limpiar contenedor de forma eficiente
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  let currentIndex = 0;
  const batchSize = 10;

  const renderNextBatch = () => {
    const batch = filtered.slice(currentIndex, currentIndex + batchSize);
    if (batch.length === 0) return;

    // Usar DocumentFragment para reducir los saltos de layout (Reflow)
    const fragment = document.createDocumentFragment();
    
    batch.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'product-card' + (isOutOfStock(p) ? ' is-soldout' : '');
      // Prioridad alta para las primeras 4 imágenes (above the fold)
      const isCritical = currentIndex === 0 && idx < 4;
      card.innerHTML = getProductHTML(p, null, isCritical);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    currentIndex += batchSize;

    if (currentIndex < filtered.length) {
      productObserver.observe(container.lastElementChild);
    }
  };

  const productObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      productObserver.unobserve(entries[0].target);
      renderNextBatch();
    }
  }, { rootMargin: '400px' });

  renderNextBatch();
}

// ====== LÓGICA DE UBICACIÓN Y ENVÍOS (CONVERSIÓN) ======
// Lógica de ubicación automática (Sin selector manual)
let userLocation = localStorage.getItem('user_location') || null;
let isLocationDetected = false;

function getShippingBadgesHTML(price) {
  const now = new Date();
  const hours = now.getHours();
  const day = now.getDay();
  let html = '<div class="product-shipping-badges" style="transition: opacity 0.3s ease;">';

  // Si aún no se detecta la ubicación o es nacional
  if (!userLocation || userLocation === 'nacional') {
    html += `
      <div class="badge-shipping info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
        Envíos a todo el país
      </div>
      <div class="badge-shipping info" style="color:var(--text-main); font-weight:700;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
        Llega en 2-3 días hábiles
      </div>`;
  } else if (userLocation === 'bogota') {
    // Caso: Bogotá (Express)
    html += `
      <div class="badge-shipping free">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
        Envío GRATIS${freeShipLabel()}
      </div>`;

    if (day !== 0 && hours < 12) {
      html += `
        <div class="badge-shipping urgent">
          ⚡Llega HOY
        </div>
        <div class="urgency-time-limit">Pide antes de las 12 PM</div>`;
    } else {
      const nextDay = (day === 6 || day === 0) ? 'el lunes' : 'mañana';
      html += `
        <div class="badge-shipping info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Llega ${nextDay}
        </div>`;
    }
  }

  html += '</div>';
  return html;
}

function setUserLocation(locKey) {
  userLocation = locKey;
  localStorage.setItem('user_location', locKey);
  
  // Contenido dinámico según ubicación
  const heroTitle = document.querySelector('.hero-title');
  const heroSub = document.querySelector('.hero-sub');
  const trustBar = document.querySelector('.trust-bar-inner');
  const loc = settings.locContent || {};

  if (locKey === 'bogota') {
    const oldBgt = '¡Envío GRATIS hoy en Bogotá! ⚡';
    if (heroTitle) heroTitle.innerHTML = (loc.bgtTitle && loc.bgtTitle !== oldBgt) ? loc.bgtTitle : `¡Envío GRATIS en Bogotá${freeShipLabel()}! ⚡`;
    if (heroSub) heroSub.textContent = loc.bgtSub || 'Pide antes de las 12 PM y recibe hoy mismo.';
    if (trustBar) {
      trustBar.innerHTML = `
        <span><i class="tb-ico">🚀</i><em><b>Llega HOY</b> en Bogotá</em></span>
        <span><i class="tb-ico">✅</i><em><b>Envío GRATIS</b>${freeShipLabel()}</em></span>
        <span><i class="tb-ico">🛡️</i><em>Compra <b>100% segura</b></em></span>
      `;
    }
  } else {
    if (heroTitle) heroTitle.innerHTML = loc.natTitle || 'Lo que buscas, al mejor precio';
    if (heroSub) heroSub.textContent = loc.natSub || 'Compra fácil y rápido — envíos a toda Colombia';
    if (trustBar) {
      trustBar.innerHTML = `
        <span><i class="tb-ico">🚛</i><em>Envíos <b>a todo el país</b></em></span>
        <span><i class="tb-ico">🛡️</i><em>Compra <b>100% segura</b></em></span>
        <span><i class="tb-ico">⭐</i><em><b>+10,000</b> clientes felices</em></span>
      `;
    }
  }
  
  renderProducts(); // Re-render badges smoothly
  renderFreeShip();
}
window.setUserLocation = setUserLocation;

// ====== LÓGICA DE WHATSAPP FLOTANTE ======
let floatingCb = null; // el asistente se registra aquí para seguir al botón de WhatsApp
function updateWAButtonPosition() {
  const waBtn = document.getElementById('global-wa-btn');
  const cartBar = document.getElementById('cart-bar');
  const orderFooter = document.querySelector('.order-sticky-footer');
  if (!waBtn) return;

  // Evitar reflow forzado usando requestAnimationFrame para agrupar lecturas del DOM
  requestAnimationFrame(() => {
    const orderViewActive = document.getElementById('view-order')?.classList.contains('active');
    let bottom = 24;
    if (orderViewActive && orderFooter) {
      // En la vista de "Tu pedido" la barra de envío/total tapa el botón de
      // WhatsApp si no se corre hacia arriba según la altura real de esa barra
      // (que cambia: crece cuando aparece el selector de transportadora).
      bottom = (orderFooter.offsetHeight || 90) + 16;
    } else if (cartBar && cartBar.style.display !== 'none') {
      bottom = (cartBar.offsetHeight || 70) + 24;
    }
    waBtn.style.bottom = bottom + 'px';
    if (floatingCb) floatingCb(bottom);
  });
}

// Generador de prueba social creíble (determinístico)
// Calificaciones REALES: promedio y cantidad de opiniones aprobadas (reviewStats/{id}).
let reviewStats = {};
function getProductStats(id, p) {
  const st = reviewStats[id];
  const count = st && st.count > 0 ? st.count : 0;
  const rating = count ? Math.round((st.sum / count) * 2) / 2 : null;
  // Solo se avisa de "pocas unidades" cuando de verdad quedan pocas
  const avail = p ? getAvailableStock(p) : null;
  const microcopy = avail !== null && avail > 0 && avail <= 5 ? '⚠️ Pocas unidades' : null;
  return { count, rating, microcopy };
}

async function loadReviewStats() {
  try {
    const snap = await get(ref(db, 'reviewStats'));
    reviewStats = snap.exists() ? snap.val() : {};
    if (isProductsLoaded) renderProducts();
  } catch (e) { /* sin reseñas todavía o sin permiso */ }
}

function getStarsHTML(rating) {
  let html = '<span class="social-stars">';
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      html += '★';
    } else if (i === Math.ceil(rating) && rating % 1 !== 0) {
      html += '<span class="half-star">★</span>';
    } else {
      html += '☆';
    }
  }
  html += '</span>';
  return html;
}

function setWAProductContext(name, price, variant = null) {
  const waBtn = document.getElementById('global-wa-btn');
  if (!waBtn) return;
  const phone = settings.whatsapp || '';
  const itemText = variant ? `${name} (${variant})` : name;
  const text = encodeURIComponent(`Hola, quiero este producto 👀: ${itemText} - ${settings.currency} ${parseFloat(price).toLocaleString('es-CO')}`);
  waBtn.href = `https://wa.me/${phone}?text=${text}`;
}
window.setWAProductContext = setWAProductContext;

window.selectColor = (productId, color) => {
  selectedVariants[productId] = color;
  renderProducts();
};

function getProductHTML(p, badgeText = null, isCritical = false) {
  const pImages = p.images || (p.image ? [p.image] : []);
  const mainImg = pImages[0];
  const price = getProductPrice(p);
  const hasDiscount = !isWholesaleMode && p.originalPrice && parseFloat(p.originalPrice) > parseFloat(price);
  const discountPct = hasDiscount ? Math.round((1 - price / p.originalPrice) * 100) : 0;
  const stats = getProductStats(p.id, p);

  const hasVariants = p.variants && p.variants.length > 0;
  const selectedColor = selectedVariants[p.id] || (hasVariants ? p.variants[0].color : null);
  
  // Si tiene variantes, el cartId es "prodId:color", sino es solo "prodId"
  const cartId = hasVariants ? `${p.id}:${selectedColor}` : p.id;

  let colorSelectorHTML = '';
  if (hasVariants) {
    // En la tarjeta del catálogo mostramos máximo 4 variantes para no romper
    // el diseño de la grilla cuando el producto tiene muchas opciones (ej. aromas).
    // El resto se ve completo al entrar al detalle del producto.
    const MAX_CHIPS_CARD = 4;
    const visibleVariants = p.variants.slice(0, MAX_CHIPS_CARD);
    const extraCount = p.variants.length - visibleVariants.length;

    colorSelectorHTML = `<div class="color-selector" onclick="event.stopPropagation()">
      ${visibleVariants.map(v => `
        <div class="color-option ${selectedColor === v.color ? 'active' : ''} ${v.stock <= 0 ? 'out-of-stock' : ''}" 
             onclick="window.selectColor('${p.id}', '${v.color}')">
          ${v.color}
        </div>
      `).join('')}
      ${extraCount > 0 ? `
        <div class="color-option more-indicator" onclick="navigateTo('/producto/${p.id}')">
          +${extraCount}
        </div>
      ` : ''}
    </div>`;
  }

  const soldOut = isOutOfStock(p);
  return `
    <div class="product-image-container ${soldOut ? 'is-soldout-img' : ''}" onclick="navigateTo('/producto/${p.id}')" style="cursor:pointer;">
      ${soldOut ? '<div class="badge-soldout">AGOTADO</div>' : ''}
      ${badgeText && !soldOut ? `<div class="badge-campaign">${badgeText}</div>` : (!soldOut && isNewProduct(p) ? '<div class="badge-campaign badge-new">✨ Nuevo</div>' : '')}
      ${mainImg ? `<img src="${mainImg}" alt="Comprar ${p.name} - Panda Venta" 
        ${isCritical ? 'fetchpriority="high"' : 'loading="lazy"'} 
        decoding="async" width="300" height="300" />` : '<span style="font-size:2rem">📦</span>'}
      ${pImages.length > 1 ? `<div class="image-count-badge">1/${pImages.length}</div>` : ''}
      ${hasDiscount ? `<div class="badge-discount-overlay">-${discountPct}%</div>` : ''}
    </div>
    <div class="product-info" onclick="navigateTo('/producto/${p.id}')" style="cursor:pointer;">
      ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
      <div class="product-title">${p.name} ${p.ref ? `<span style="font-size:0.7em;color:var(--text-muted)">[${p.ref}]</span>` : ''}</div>
      ${getShippingBadgesHTML(price)}
      
      <div class="product-social-proof">
        ${stats.count ? `${getStarsHTML(stats.rating)}<span class="social-sold">(${stats.count})</span>` : ''}
      </div>
      ${stats.microcopy ? `<div class="microcopy-badge">${stats.microcopy}</div>` : ''}

      ${colorSelectorHTML}

      <div class="product-bottom-section" onclick="event.stopPropagation()">
        <div class="product-price">
          ${hasDiscount ? `<span class="price-original">${settings.currency} ${parseFloat(p.originalPrice).toLocaleString('es-CO')}</span>` : ''}
          <div style="display:flex; align-items: baseline; gap: 2px;">
            <span class="price-currency">${settings.currency}</span>
            <span class="price-amount ${hasDiscount ? 'price-sale' : ''}">${parseFloat(price).toLocaleString('es-CO')}</span>
            ${isWholesaleMode ? '<span style="font-size:0.6rem; color:var(--success); font-weight:700; margin-left:4px;">(Por mayor)</span>' : ''}
          </div>
          ${isWholesaleMode ? `<div class="wholesale-min-note">Mín. ${WHOLESALE_MIN_QTY} unidades</div>` : ''}
        </div>
        <div class="qty-controls">
          ${cart[cartId] ? `
            <button class="btn-qty" aria-label="Quitar una unidad" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${cart[cartId]}</span>
            <button class="btn-qty" aria-label="Agregar una unidad" onclick="updateCart('${cartId}', 1)">+</button>
          ` : (soldOut
              ? `<button class="btn-add is-soldout" onclick="openStockAlert('${p.id}')">🔔 AVÍSAME</button>`
              : `<button class="btn-add ${hasDiscount ? 'btn-add-sale' : ''}" onclick="navigateTo('/producto/${p.id}')">VER DETALLES</button>`)}
        </div>
      </div>
    </div>
  `;
}

// ====== ACCESOS RÁPIDOS: DESCUENTOS Y PRODUCTOS NUEVOS ======
function hasActiveDiscount(p) {
  return !isWholesaleMode && p.originalPrice && parseFloat(p.originalPrice) > parseFloat(getProductPrice(p));
}

const QUICK_VIEW_TITLES = { discount: '🔥 Productos en descuento', new: '✨ Productos nuevos' };

function setQuickView(view) {
  currentQuickView = currentQuickView === view ? null : view; // volver a pulsar lo quita
  safeText('catalog-section-title', currentQuickView
    ? QUICK_VIEW_TITLES[currentQuickView]
    : (isWholesaleMode ? 'Catálogo mayorista' : 'Todos los productos'));
  trackEvent('vista_rapida', currentQuickView || 'todos');
  renderProducts();
  if (currentQuickView) document.getElementById('catalog-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQuickViews() {
  const wrap = document.getElementById('quick-views');
  if (!wrap) return;
  const visible = getShownProducts();
  const nDiscount = visible.filter(hasActiveDiscount).length;
  const nNew = visible.filter(p => isNewProduct(p)).length;

  // Si la vista elegida ya no tiene productos (p. ej. se acabó una oferta), se vuelve a todos
  if ((currentQuickView === 'discount' && nDiscount === 0) || (currentQuickView === 'new' && nNew === 0)) {
    currentQuickView = null;
    safeText('catalog-section-title', isWholesaleMode ? 'Catálogo mayorista' : 'Todos los productos');
  }

  const setBtn = (id, countId, n, view) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.display = n > 0 ? '' : 'none';
    btn.classList.toggle('active', currentQuickView === view);
    btn.setAttribute('aria-pressed', String(currentQuickView === view));
    safeText(countId, n > 0 ? String(n) : '');
  };
  setBtn('btn-quick-discount', 'quick-discount-count', nDiscount, 'discount');
  setBtn('btn-quick-new', 'quick-new-count', nNew, 'new');
  wrap.style.display = (nDiscount > 0 || nNew > 0) ? '' : 'none';
}

// ====== CART ======
function updateCart(cartId, change) {
  const parts = cartId.split(':');
  const productId = parts[0];
  // Fix: producto simple no tiene variante
  const variantColor = parts.length > 1 ? (parts[1] || null) : null;
  
  const p = products.find(prod => prod.id === productId);
  if (!p) {
    console.error('updateCart: no se encontró el producto', productId);
    showToast('No se pudo agregar el producto. Intenta de nuevo.');
    return;
  }
  const current = cart[cartId] || 0;
  let next = current + change;
  if (isWholesaleMode) {
    // Mínimo mayorista: 3 unidades por producto (sumando sus variantes).
    const productTotal = getProductQtyInCart(productId);
    if (change > 0 && productTotal === 0) {
      next = Math.max(WHOLESALE_MIN_QTY, change);
    } else if (change < 0 && productTotal + change < WHOLESALE_MIN_QTY) {
      // Bajar del mínimo quita el producto completo del pedido mayorista.
      Object.keys(cart).forEach(id => { if (id.split(':')[0] === productId) delete cart[id]; });
      updateCartUI();
      renderProducts();
      if (views.order && views.order.classList.contains('active')) renderOrderList();
      return;
    }
  }

  // Validar stock (tratamos '', null y undefined como "sin límite definido")
  const hasStockLimit = (val) => val !== undefined && val !== null && val !== '';
  if (change > 0) {
    if (variantColor) {
      const v = p.variants && p.variants.find(v => v.color === variantColor);
      if (v && hasStockLimit(v.stock) && next > v.stock) {
        showToast(`Solo quedan ${v.stock} unidades (${getVariantLabel(p)}: ${variantColor})`); return;
      }
    } else {
      if (hasStockLimit(p.stock) && next > p.stock) {
        showToast(`Solo quedan ${p.stock} unidades`); return;
      }
    }
    // GA: producto agregado al carrito
    trackEvent('agregar_carrito', p.name, { item_id: productId });
  }
  
  if (next <= 0) delete cart[cartId]; else cart[cartId] = next;
  updateCartUI(change > 0);
  renderProducts();
  if (views.order && views.order.classList.contains('active')) renderOrderList();
}

function updateCartUI(animate = false) {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = Object.entries(cart).reduce((t, [cartId, q]) => {
    const productId = cartId.split(':')[0];
    const p = products.find(x => x.id === productId);
    return t + (p ? getProductPrice(p) * q : 0);
  }, 0);
  if (count > 0) {
    els.cartBar.style.display = 'block';
    els.cartCount.textContent = count;
    els.cartTotal.textContent = formatMoney(total);
    if (animate && els.cartCount) {
      els.cartCount.classList.remove('pop');
      // Forzar reflow para poder reiniciar la animación en clics seguidos
      void els.cartCount.offsetWidth;
      els.cartCount.classList.add('pop');
    }
  } else {
    els.cartBar.style.display = 'none';
  }
  renderFreeShip();
  updateWAButtonPosition();
}

function renderOrderList() {
  const total = Object.entries(cart).reduce((t, [cartId, q]) => {
    const productId = cartId.split(':')[0];
    const p = products.find(x => x.id === productId);
    return t + (p ? getProductPrice(p) * q : 0);
  }, 0);
  const totalItems = Object.values(cart).reduce((sum, q) => sum + q, 0);
  safeText('order-items-count', totalItems);
  els.orderList.innerHTML = Object.entries(cart).map(([cartId, q]) => {
    const parts = cartId.split(':');
    const productId = parts[0];
    // Fix: producto simple no tiene variante
    const color = parts.length > 1 ? parts[1] : null;
    const p = products.find(x => x.id === productId);
    if (!p) return '';
    const itemName = color ? `${p.name} (${color})` : p.name;
    const itemPrice = getProductPrice(p);
    const thumb = (p.images && p.images[0]) || p.image || '';
    return `
      <div class="order-item-row">
        ${thumb ? `<img class="order-item-thumb" src="${thumb}" alt="${p.name}" loading="lazy">` : ''}
        <div class="order-item-info">
          <div class="order-item-name">${itemName}</div>
          <div class="order-item-price-unit">${formatMoney(itemPrice)} x ${q}</div>
        </div>
        <div class="order-item-actions">
          <div class="qty-controls small">
            <button class="btn-qty" aria-label="Quitar una unidad" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${q}</span>
            <button class="btn-qty" aria-label="Agregar una unidad" onclick="updateCart('${cartId}', 1)">+</button>
          </div>
          <div class="order-item-subtotal">${formatMoney(itemPrice * q)}</div>
        </div>
      </div>
    `;
  }).join('');
  els.orderTotalAmount.textContent = formatMoney(total);
  renderFreeShip();
  updateOrderSteps();
  if (Object.keys(cart).length === 0) switchView('catalog');
  
  // Si el pedido cambió DESPUÉS de haber cotizado un envío pagado (no Bogotá),
  // el peso pudo cambiar y la cotización ya no es válida: se lo advertimos al
  // cliente en vez de borrar su selección en silencio.
  if (selectedShippingOption && selectedShippingOption.carrier !== 'local') {
    selectedShippingOption = null;
    const display = document.getElementById('shipping-cost-display');
    const quoteBtn = document.getElementById('btn-quote-shipping');
    const ticketBtn = document.getElementById('btn-generate-ticket');
    const optionsPanel = document.getElementById('shipping-options-panel');
    if (display) { display.textContent = 'Tu pedido cambió, vuelve a cotizar'; display.style.color = '#f59e0b'; }
    if (quoteBtn) { quoteBtn.style.display = 'block'; quoteBtn.textContent = 'Cotizar envío'; quoteBtn.disabled = false; }
    if (ticketBtn) ticketBtn.style.display = 'none';
    if (optionsPanel) { optionsPanel.style.display = 'none'; optionsPanel.innerHTML = ''; }
  }
}

// ====== IMAGE VIEWER ======
function openImageModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  viewerImages = p.images || (p.image ? [p.image] : []);
  viewerIndex = 0;
  if (viewerImages.length === 0) return;
  renderViewer();
  document.getElementById('image-viewer-modal').style.display = 'flex';
}

function renderViewer() {
  const img = document.getElementById('image-viewer-img');
  if (img) img.src = viewerImages[viewerIndex];
  safeStyle('btn-viewer-prev', 'display', viewerImages.length > 1 ? 'block' : 'none');
  safeStyle('btn-viewer-next', 'display', viewerImages.length > 1 ? 'block' : 'none');
}

// ====== PRODUCT DETAIL PAGE & ROUTING ======
// Marca cada página de producto con datos estructurados schema.org/Product —
// es lo que le permite a Google (Merchant Center y Búsqueda normal) reconocer
// cada producto individualmente, sin depender solo del feed.
// Título, descripción y canonical al día mientras se navega (Google ejecuta JavaScript;
// para WhatsApp/Facebook, que no lo hacen, api/producto.js ya entrega estos datos en el HTML).
const DEFAULT_META = {};
function setPageMeta(meta) {
  const q = (sel) => document.querySelector(sel);
  if (!DEFAULT_META.title) {
    // Valores de la portada (no se leen del DOM: en /producto/... el servidor ya los cambió)
    DEFAULT_META.title = 'Panda Venta | Tienda Online con Envío a toda Colombia';
    DEFAULT_META.desc = 'Compra online en Panda Venta. Productos con envío a toda Colombia y envío gratis en Bogotá. Haz tu pedido fácil por WhatsApp.';
    DEFAULT_META.canonical = 'https://pandaventa.com/';
  }
  const m = meta || {};
  document.title = m.title || DEFAULT_META.title;
  const d = q('meta[name="description"]'); if (d) d.content = m.description || DEFAULT_META.desc;
  const c = q('link[rel="canonical"]'); if (c) c.href = m.url || DEFAULT_META.canonical;
  const set = (prop, val) => { const el = q(`meta[property="${prop}"]`); if (el && val) el.content = val; };
  set('og:title', m.title || DEFAULT_META.title);
  set('og:description', m.description || DEFAULT_META.desc);
  set('og:url', m.url || DEFAULT_META.canonical);
  if (m.image) set('og:image', m.image);
}

function injectProductStructuredData(p, price) {
  let script = document.getElementById('product-structured-data');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-structured-data';
    document.head.appendChild(script);
  }

  const images = p.images && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
  const stock = p.variants && p.variants.length > 0
    ? p.variants.reduce((s, v) => s + (v.stock || 0), 0)
    : (p.stock || 0);

  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": p.name,
    "description": (p.description || p.name).replace(/<[^>]*>/g, '').slice(0, 5000),
    "sku": p.ref || p.id,
    "image": images,
    "offers": {
      "@type": "Offer",
      "url": `https://pandaventa.com/producto/${p.id}`,
      "priceCurrency": settings.currency || "COP",
      "price": price,
      "availability": stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "itemCondition": "https://schema.org/NewCondition"
    }
  };
  const st = getProductStats(p.id, p);
  if (st.count > 0) {
    // Solo calificaciones reales aprobadas; nunca se inventan
    data.aggregateRating = { "@type": "AggregateRating", "ratingValue": (reviewStats[p.id].sum / st.count).toFixed(1), "reviewCount": st.count };
  }

  script.textContent = JSON.stringify(data);
}

window.openProductPage = function(productId) {
  const p = products.find(x => x.id === productId);
  if (!p || (isWholesaleMode && !isVisibleInWholesale(p))) {
    // En el portal mayorista un producto oculto tampoco se abre por enlace directo
    if (p) showToast('Ese producto no está disponible en el portal mayorista');
    navigateTo(getCatalogPath());
    return;
  }
  
  currentDetailProduct = p;
  currentDetailQty = isWholesaleMode ? WHOLESALE_MIN_QTY : 1;
  
  // Set view product active
  switchView('product');
  
  // Populate basic text info
  safeText('product-store-name-header', settings.storeName || 'Panda Venta');
  safeText('detail-title', p.name);
  safeText('detail-category', p.category || 'PRODUCTO');
  safeText('detail-ref', p.ref ? `REF: ${p.ref}` : 'REF: General');
  
  // Populate description
  const descEl = document.getElementById('detail-description');
  if (descEl) {
    descEl.innerHTML = (p.description || 'Sin descripción disponible.').replace(/\n/g, '<br>');
  }
  
  // Pricing
  const price = getProductPrice(p);
  const hasDiscount = !isWholesaleMode && p.originalPrice && parseFloat(p.originalPrice) > parseFloat(price);

  injectProductStructuredData(p, parseFloat(p.price) || 0); // SEO: siempre el precio al detal
  setPageMeta({
    title: `${p.name} | ${settings.storeName || 'Panda Venta'}`,
    description: String(p.description || `${p.name} con envío a toda Colombia.`).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    url: `https://pandaventa.com/producto/${p.id}`,
    image: (p.images && p.images[0]) || p.image || ''
  });
  const discountPct = hasDiscount ? Math.round((1 - price / p.originalPrice) * 100) : 0;
  
  const originalPriceEl = document.getElementById('detail-price-original');
  if (originalPriceEl) {
    if (hasDiscount) {
      originalPriceEl.style.display = 'inline-block';
      originalPriceEl.textContent = formatMoney(p.originalPrice);
    } else {
      originalPriceEl.style.display = 'none';
    }
  }
  
  const discountBadgeEl = document.getElementById('detail-discount-badge');
  if (discountBadgeEl) {
    if (hasDiscount) {
      discountBadgeEl.style.display = 'block';
      discountBadgeEl.textContent = `-${discountPct}%`;
    } else {
      discountBadgeEl.style.display = 'none';
    }
  }
  
  safeText('detail-price-amount', parseFloat(price).toLocaleString('es-CO'));
  safeText('detail-price-currency', settings.currency + ' ');
  const soldOutDetail = isOutOfStock(p);
  const stockBadge = document.getElementById('detail-stock-badge');
  if (stockBadge) stockBadge.textContent = soldOutDetail ? '✖ AGOTADO' : '✔ EN STOCK';
  ['btn-detail-add-cart', 'btn-detail-wa-buy'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = soldOutDetail; b.style.opacity = soldOutDetail ? '0.5' : ''; }
  });
  safeStyle('detail-wholesale-tag', 'display', isWholesaleMode ? 'inline-block' : 'none');
  safeText('detail-wholesale-min', isWholesaleMode ? `Pedido mayorista: mínimo ${WHOLESALE_MIN_QTY} unidades` : '');
  safeStyle('detail-wholesale-min', 'display', isWholesaleMode ? 'block' : 'none');
  
  // Social Proof stats
  const stats = getProductStats(p.id, p);
  safeText('detail-sold-count', stats.count ? `${stats.count} ${stats.count === 1 ? 'opinión' : 'opiniones'}` : '');
  safeHTML('detail-stars', stats.count ? getStarsHTML(stats.rating) : '');
  safeStyle('detail-sold-count', 'display', stats.count ? '' : 'none');
  const verifiedEl = document.querySelector('#view-product .social-verified');
  if (verifiedEl) verifiedEl.style.display = stats.count ? '' : 'none';
  renderStockAlertButton(p, soldOutDetail);
  
  // Image gallery
  const clipUrl = p.videoUrl || p.clipUrl || p.video || p.clip;
  const pImages = p.images || (p.image ? [p.image] : []);
  const galleryItems = pImages.map(src => ({ type: 'image', src }));
  if (clipUrl) {
    galleryItems.push({
      type: 'video',
      src: p.videoThumbnail || p.image || pImages[0] || '',
      clipUrl
    });
  }

  const mainImgEl = document.getElementById('detail-main-img');
  const firstImageItem = galleryItems.find(item => item.type === 'image');
  if (mainImgEl && firstImageItem) {
    mainImgEl.src = firstImageItem.src;
    mainImgEl.alt = p.name;
    
    // Zoom-on-hover effect
    mainImgEl.parentElement.onmousemove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      mainImgEl.style.transformOrigin = `${x}% ${y}%`;
      mainImgEl.style.transform = 'scale(1.5)';
    };
    mainImgEl.parentElement.onmouseleave = () => {
      mainImgEl.style.transform = 'scale(1)';
      mainImgEl.style.transformOrigin = 'center center';
    };
  }
  
  const thumbsContainer = document.getElementById('detail-thumbnails');
  const clipButton = document.getElementById('btn-detail-watch-clip');
  const setClipButtonActive = (isActive) => {
    if (!clipButton) return;
    clipButton.classList.toggle('active', isActive);
  };

  if (thumbsContainer) {
    thumbsContainer.innerHTML = '';
    if (galleryItems.length > 1) {
      galleryItems.forEach((item, idx) => {
        const thumb = document.createElement('div');
        thumb.className = `thumbnail-img ${item.type === 'video' ? 'thumb-video' : ''} ${idx === 0 ? 'active' : ''}`.trim();
        if (item.type === 'image') {
          thumb.innerHTML = `<img src="${item.src}" alt="Miniatura ${idx + 1}" />`;
          thumb.onclick = () => {
            document.querySelectorAll('.thumbnail-img').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
            if (mainImgEl) mainImgEl.src = item.src;
            setClipButtonActive(false);
          };
        } else {
          thumb.innerHTML = `
            <div class="video-thumb-frame">
              <img src="${item.src}" alt="Clip del producto" />
              <span class="video-thumb-icon" aria-hidden="true">▶</span>
              <span class="video-thumb-label">CLIP</span>
            </div>
          `;
          thumb.onclick = () => {
            document.querySelectorAll('.thumbnail-img').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
            setClipButtonActive(true);
            openDetailVideo(item.clipUrl);
          };
        }
        thumbsContainer.appendChild(thumb);
      });
      thumbsContainer.style.display = 'flex';
    } else {
      thumbsContainer.style.display = 'none';
    }
  }
  
  // Shipping Promotion Card
  const promoEl = document.getElementById('detail-shipping-promo');
  if (promoEl) {
    const now = new Date();
    const hours = now.getHours();
    const day = now.getDay();
    let promoHTML = '';
    
    if (!userLocation || userLocation === 'nacional') {
      promoHTML = `
        <div class="promo-icon">🚛</div>
        <div class="promo-text-wrapper">
          <div class="promo-title">Envíos a todo el país</div>
          <div class="promo-desc">Recibe de forma segura en tu domicilio en 2-3 días hábiles.</div>
        </div>
      `;
    } else if (userLocation === 'bogota') {
      if (day !== 0 && hours < 12) {
        promoHTML = `
          <div class="promo-icon">⚡</div>
          <div class="promo-text-wrapper">
            <div class="promo-title">¡Llega HOY en Bogotá!</div>
            <div class="promo-desc">Envío GRATIS${freeShipLabel()}. Haz tu pedido en los próximos minutos para entrega HOY.</div>
          </div>
        `;
      } else {
        const nextDay = (day === 6 || day === 0) ? 'el lunes' : 'mañana';
        promoHTML = `
          <div class="promo-icon">🚀</div>
          <div class="promo-text-wrapper">
            <div class="promo-title">Envío GRATIS a Bogotá${freeShipLabel()}</div>
            <div class="promo-desc">Tu pedido se despachará con prioridad para entrega ${nextDay}.</div>
          </div>
        `;
      }
    }
    promoEl.innerHTML = promoHTML;
  }

  const infoStockEl = document.getElementById('info-stock');
  const infoShippingEl = document.getElementById('info-shipping-label');
  const infoCategoryEl = document.getElementById('info-category');
  const infoTagsEl = document.getElementById('info-tags');
  const infoShortDescEl = document.getElementById('info-short-description');

  if (infoStockEl) {
    infoStockEl.textContent = (p.stock !== undefined && p.stock !== null)
      ? (p.stock > 0 ? `${p.stock} disponibles` : 'Agotado')
      : 'Disponible';
  }
  if (infoShippingEl) {
    infoShippingEl.textContent = userLocation === 'bogota' ? 'Envío exprés Bogotá' : 'Envío nacional 2-3 días';
  }
  if (infoCategoryEl) {
    infoCategoryEl.textContent = p.category || 'General';
  }
  if (infoTagsEl) {
    infoTagsEl.textContent = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean).join(', ') : 'Sin etiquetas';
  }
  if (infoShortDescEl) {
    infoShortDescEl.textContent = p.description
      ? p.description.split('. ').slice(0, 2).join('. ') + (p.description.includes('.') ? '.' : '')
      : 'Esta sección resume lo más importante del producto para que los usuarios conozcan sus beneficios sin bajar demasiado.';
  }
  
  // Variants (Color / Aroma / Tamaño)
  const hasVariants = p.variants && p.variants.length > 0;
  const variantsWrapper = document.getElementById('detail-variants-wrapper');
  const selectorContainer = document.getElementById('detail-color-selector');
  
  if (hasVariants && variantsWrapper && selectorContainer) {
    currentDetailColor = p.variants[0].color;
    variantsWrapper.style.display = 'block';
    safeText('detail-variant-label', `${getVariantLabel(p)}:`);
    selectorContainer.innerHTML = p.variants.map(v => `
      <div class="color-option ${currentDetailColor === v.color ? 'active' : ''} ${v.stock <= 0 ? 'out-of-stock' : ''}"
           onclick="window.selectDetailColor('${v.color}')">
        ${v.color}
      </div>
    `).join('');
  } else if (variantsWrapper) {
    currentDetailColor = null;
    variantsWrapper.style.display = 'none';
  }

  if (clipButton) {
    if (clipUrl) {
      clipButton.style.display = 'flex';
      clipButton.onclick = () => {
        clipButton.classList.add('active');
        openDetailVideo(clipUrl);
      };
    } else {
      clipButton.style.display = 'none';
      clipButton.onclick = null;
      setClipButtonActive(false);
    }
  }

  // Quantity Reset
  updateDetailQtyUI();
  
  // Related Products
  renderRelatedProducts(p);
  
  // Customer Reviews
  renderProductReviews(p);
  
  // Track Event
  trackEvent('ver_producto', p.name, { item_id: p.id });
};

function openDetailVideo(url) {
  const modal = document.getElementById('detail-video-modal');
  const wrapper = document.getElementById('detail-video-wrapper');
  const card = modal ? modal.querySelector('.video-modal-card') : null;
  if (!modal || !wrapper) return;

  // TikTok (y en general videos verticales) necesitan una caja 9:16 en vez
  // de la caja horizontal 16:9 pensada para YouTube.
  const isVertical = /tiktok\.com/.test(url || '');
  wrapper.classList.toggle('video-vertical', isVertical);
  if (card) card.classList.toggle('video-vertical', isVertical);

  wrapper.innerHTML = getDetailVideoEmbed(url);
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}

function closeDetailVideo() {
  const modal = document.getElementById('detail-video-modal');
  const wrapper = document.getElementById('detail-video-wrapper');
  const card = modal ? modal.querySelector('.video-modal-card') : null;
  if (!modal || !wrapper) return;

  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = '';
  wrapper.classList.remove('video-vertical');
  if (card) card.classList.remove('video-vertical');
}

function getDetailVideoEmbed(url) {
  if (!url) return '';
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return `<iframe loading="lazy" src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }

  // TikTok: convertimos el link del video a su iframe de embed oficial (embed/v2/{id}).
  const ttMatch = url.match(/tiktok\.com\/(?:@[\w.-]+\/video|embed(?:\/v2)?)\/(\d+)/);
  if (ttMatch) {
    return `<iframe loading="lazy" src="https://www.tiktok.com/embed/v2/${ttMatch[1]}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;height:100%;"></iframe>`;
  }

  // Enlaces cortos de TikTok (vm.tiktok.com/... o tiktok.com/t/...) no traen el ID
  // del video en la URL — TikTok solo lo revela tras seguir la redirección, algo
  // que no podemos hacer desde el navegador. En ese caso, mostramos un enlace directo.
  if (url.includes('tiktok.com')) {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:2rem;text-align:center;color:#fff;">
      <p>Este video no se puede reproducir aquí porque el enlace es un link corto de TikTok.</p>
      <a href="${url}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;font-weight:600;">Ver en TikTok ↗</a>
    </div>`;
  }

  return `<video controls playsinline preload="metadata" src="${url}"></video>`;
}

window.selectDetailColor = function(color) {
  const p = currentDetailProduct;
  if (!p) return;
  const v = p.variants.find(x => x.color === color);
  if (v && v.stock <= 0) return;
  
  currentDetailColor = color;
  const selectorContainer = document.getElementById('detail-color-selector');
  if (selectorContainer) {
    selectorContainer.querySelectorAll('.color-option').forEach(opt => {
      if (opt.textContent.trim() === color) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });
  }
};

function updateDetailQtyUI() {
  safeText('detail-qty-display', currentDetailQty);
}

function renderRelatedProducts(currentProduct) {
  const grid = document.getElementById('related-products-grid');
  if (!grid) return;
  
  // Puntaje de parecido: misma categoría > palabras en común del nombre > precio parecido.
  // Los agotados quedan al final y los más nuevos desempatan.
  const words = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const baseWords = words(currentProduct.name);
  const basePrice = parseFloat(getProductPrice(currentProduct)) || 0;
  const score = (p) => {
    let sc = 0;
    if (currentProduct.category && p.category === currentProduct.category) sc += 4;
    let shared = 0; words(p.name).forEach(w => { if (baseWords.has(w)) shared++; });
    sc += Math.min(shared, 3);
    const pr = parseFloat(getProductPrice(p)) || 0;
    if (basePrice && pr && pr >= basePrice * 0.5 && pr <= basePrice * 1.5) sc += 1;
    if (isOutOfStock(p)) sc -= 10;
    return sc;
  };
  let related = getShownProducts()
    .filter(p => p.id !== currentProduct.id)
    .map(p => ({ p, sc: score(p), t: getCreatedAt(p) || 0 }))
    .sort((x, y) => y.sc - x.sc || y.t - x.t)
    .slice(0, 4)
    .map(x => x.p);

  if (related.length === 0) {
    grid.parentElement.style.display = 'none';
    return;
  }
  
  grid.parentElement.style.display = 'block';
  grid.innerHTML = related.map(p => {
    return `<div class="product-card">${getProductHTML(p)}</div>`;
  }).join('');
}

const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Opiniones REALES: las envía el cliente, el administrador las aprueba y se
// guardan en reviews/{productId}. No se inventan ni se completan con ejemplos.
async function renderProductReviews(product) {
  const container = document.getElementById('detail-reviews-list');
  const summary = document.getElementById('detail-reviews-summary');
  if (!container) return;
  const pid = product.id;
  container.innerHTML = '';
  if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }
  resetReviewForm();

  let list = [];
  try {
    const snap = await get(ref(db, `reviews/${pid}`));
    if (snap.exists()) list = Object.values(snap.val()).filter(r => r && r.rating).sort((x, y) => (y.ts || 0) - (x.ts || 0));
  } catch (e) { /* sin permiso o sin red: se muestra el estado vacío */ }
  if (currentDetailProduct && currentDetailProduct.id !== pid) return; // el cliente ya cambió de producto

  if (list.length === 0) {
    container.innerHTML = '<p class="reviews-empty">Aún no hay opiniones de este producto. ¡Sé la primera persona en opinar!</p>';
    return;
  }
  const total = list.length;
  const avg = list.reduce((s, r) => s + Number(r.rating), 0) / total;
  const dist = [5, 4, 3, 2, 1].map(n => ({ n, c: list.filter(r => Number(r.rating) === n).length }));
  if (summary) {
    summary.style.display = '';
    summary.innerHTML = `
      <div class="reviews-summary-score">
        <div class="score-num">${avg.toFixed(1).replace('.', ',')}</div>
        ${getStarsHTML(Math.round(avg * 2) / 2)}
        <div class="reviews-count-text">${total} ${total === 1 ? 'opinión' : 'opiniones'}</div>
      </div>
      <div class="reviews-rating-bars">
        ${dist.map(d => `<div class="rating-bar-row"><span>${d.n} ★</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(d.c / total * 100)}%;"></div></div><span>${Math.round(d.c / total * 100)}%</span></div>`).join('')}
      </div>`;
  }
  container.innerHTML = list.slice(0, 20).map(r => `
    <div class="review-item">
      <div class="review-header">
        <div class="review-user-info"><span class="review-username">${escHtml(r.name || 'Cliente')}</span></div>
        <span class="review-date">${r.ts ? new Date(r.ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
      </div>
      <div class="review-rating">
        <span class="social-stars">${'★'.repeat(Number(r.rating)) + '☆'.repeat(5 - Number(r.rating))}</span>
        ${r.city ? `<span class="review-user-city">📍 ${escHtml(r.city)}</span>` : ''}
      </div>
      ${r.comment ? `<p class="review-comment">${escHtml(r.comment)}</p>` : ''}
    </div>`).join('');
}

let reviewRating = 0;
function resetReviewForm() {
  reviewRating = 0;
  safeStyle('review-form', 'display', 'none');
  safeStyle('review-thanks', 'display', 'none');
  safeStyle('btn-review-open', 'display', '');
  document.querySelectorAll('#review-stars-input button').forEach(b => b.classList.remove('on'));
  ['review-name', 'review-city', 'review-comment'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function initReviewForm() {
  const open = document.getElementById('btn-review-open');
  if (!open) return;
  open.onclick = () => { safeStyle('review-form', 'display', 'flex'); open.style.display = 'none'; };
  document.getElementById('btn-review-cancel').onclick = resetReviewForm;
  document.querySelectorAll('#review-stars-input button').forEach(b => {
    b.onclick = () => {
      reviewRating = Number(b.dataset.v);
      document.querySelectorAll('#review-stars-input button').forEach(x => x.classList.toggle('on', Number(x.dataset.v) <= reviewRating));
    };
  });
  document.getElementById('review-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentDetailProduct) return;
    if (document.getElementById('review-website')?.value) return; // campo trampa para bots
    const name = document.getElementById('review-name').value.trim();
    const city = document.getElementById('review-city').value.trim();
    const comment = document.getElementById('review-comment').value.trim();
    if (!reviewRating) return showToast('Elige de 1 a 5 estrellas');
    if (name.length < 2) return showToast('Escribe tu nombre');
    if (comment.length < 5) return showToast('Cuéntanos un poco más de tu experiencia');
    const key = 'review_sent_' + currentDetailProduct.id;
    try { if (localStorage.getItem(key)) return showToast('Ya enviaste una opinión de este producto'); } catch (e2) {}
    const btn = document.getElementById('btn-review-send');
    btn.disabled = true;
    try {
      await push(ref(db, 'reviewsPending'), {
        productId: currentDetailProduct.id, productName: String(currentDetailProduct.name || '').slice(0, 120),
        name: name.slice(0, 40), city: city.slice(0, 40), rating: reviewRating, comment: comment.slice(0, 500), ts: Date.now()
      });
      try { localStorage.setItem(key, '1'); } catch (e2) {}
      safeStyle('review-form', 'display', 'none');
      safeStyle('review-thanks', 'display', 'block');
    } catch (err) {
      showToast('No pudimos enviar tu opinión. Intenta de nuevo.');
    } finally { btn.disabled = false; }
  };
}

// ====== AVÍSAME CUANDO LLEGUE ======
function renderStockAlertButton(p, soldOut) {
  let btn = document.getElementById('btn-detail-stock-alert');
  if (!btn) {
    const host = document.querySelector('#view-product .detail-cta-buttons');
    if (!host) return;
    btn = document.createElement('button');
    btn.id = 'btn-detail-stock-alert';
    btn.type = 'button';
    btn.className = 'btn-stock-alert';
    btn.textContent = '🔔 Avísame cuando llegue';
    host.prepend(btn);
  }
  btn.style.display = soldOut ? '' : 'none';
  btn.onclick = () => openStockAlert(p.id);
}

function openStockAlert(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('stock-alert-modal')?.remove();
  let savedPhone = '';
  try { savedPhone = localStorage.getItem('alert_phone') || ''; } catch (e) {}
  const m = document.createElement('div');
  m.id = 'stock-alert-modal';
  m.className = 'sa-overlay';
  m.innerHTML = `
    <div class="sa-card" role="dialog" aria-modal="true" aria-label="Avísame cuando llegue">
      <button type="button" class="sa-close" aria-label="Cerrar">×</button>
      <h3>🔔 Te avisamos</h3>
      <p><b>${escHtml(p.name)}</b> está agotado. Déjanos tu WhatsApp y te escribimos apenas vuelva.</p>
      <input type="tel" id="sa-phone" class="field-input" placeholder="Tu celular (WhatsApp)" inputmode="tel" autocomplete="tel" value="${escHtml(savedPhone)}" />
      <input type="text" id="sa-name" class="field-input" placeholder="Tu nombre (opcional)" maxlength="40" />
      <button type="button" class="btn-save-product" id="sa-send" style="width:100%">Avísame</button>
      <p class="sa-msg" id="sa-msg"></p>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('.sa-close').onclick = close;
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  document.getElementById('sa-send').onclick = async () => {
    const phone = document.getElementById('sa-phone').value.replace(/\D/g, '');
    const msg = document.getElementById('sa-msg');
    if (phone.length < 10 || phone.length > 13) { msg.textContent = 'Escribe un celular válido.'; return; }
    const key = `alert_${productId}_${phone}`;
    try { if (localStorage.getItem(key)) { msg.textContent = 'Ya estás en la lista de este producto. ¡Te avisamos!'; return; } } catch (e) {}
    const send = document.getElementById('sa-send'); send.disabled = true;
    try {
      await push(ref(db, `stockAlerts/${productId}`), {
        phone, name: document.getElementById('sa-name').value.trim().slice(0, 40),
        product: String(p.name || '').slice(0, 120), ts: Date.now()
      });
      try { localStorage.setItem(key, '1'); localStorage.setItem('alert_phone', phone); } catch (e) {}
      trackEvent('avisame_stock', p.name, { item_id: p.id });
      m.querySelector('.sa-card').innerHTML = '<div class="sa-done">✅<h3>¡Listo!</h3><p>Te escribiremos por WhatsApp cuando vuelva a estar disponible.</p><button type="button" class="btn-save-product" style="width:100%">Cerrar</button></div>';
      m.querySelector('.sa-done button').onclick = close;
    } catch (e) { msg.textContent = 'No pudimos guardar tu aviso. Intenta de nuevo.'; send.disabled = false; }
  };
  setTimeout(() => document.getElementById('sa-phone')?.focus(), 50);
}
window.openStockAlert = openStockAlert;

// Navegación con URLs reales (antes: location.hash = '#/product/x').
// Las URLs reales son necesarias para que los verificadores de Google
// Merchant Center (y el SEO en general) puedan visitar/rastrear cada
// producto como una página independiente, no solo un fragmento de cliente.
function navigateTo(path) {
  if (window.location.pathname !== path) {
    history.pushState({}, '', path);
  }
  handleRoute();
  window.scrollTo(0, 0);
}
window.navigateTo = navigateTo;

function handleRoute() {
  const path = window.location.pathname;
  if (!path.startsWith('/producto/')) setPageMeta(null);
  // El canal mayorista se activa al entrar a /mayoristas y se mantiene al ver
  // productos, el pedido y las políticas; al volver al catálogo normal se apaga.
  if (path === '/mayoristas' || path === '/mayoristas/') {
    // El portal exige iniciar sesión: enterWholesalePortal muestra el login o el catálogo.
    enterWholesalePortal();
    return;
  } else if (path === '/' || path === '') {
    setWholesaleMode(false);
  }
  if (path.startsWith('/producto/')) {
    const productId = decodeURIComponent(path.replace('/producto/', '').replace(/\/$/, ''));
    openProductPage(productId);
  } else if (path === '/pedido') {
    switchView('order');
    renderOrderList();
  } else if (path === '/ticket') {
    switchView('ticket');
  } else if (path === '/envios') {
    switchView('shipping-policy');
  } else if (path === '/devoluciones') {
    switchView('returns-policy');
  } else if (path === '/contacto') {
    switchView('contact');
  } else if (path === '/seguimiento' || path === '/seguimiento/') {
    switchView('track');
    prepareTrackView();
  } else {
    switchView('catalog');
  }
}

window.addEventListener('popstate', handleRoute);

// ====== GLOBAL WINDOW BINDINGS ======
window.updateCart = updateCart;
window.openImageModal = openImageModal;
window.closeImageModal = () => safeStyle('image-viewer-modal', 'display', 'none');
window.setViewerIndex = (idx) => { viewerIndex = idx; renderViewer(); };
window.toggleDesc = (e, id) => {
  e.stopPropagation();
  const desc = document.getElementById(`desc-${id}`);
  if (desc) {
    desc.classList.toggle('collapsed');
    e.target.textContent = desc.classList.contains('collapsed') ? 'Ver más' : 'Ver menos';
  }
};

window.copyPaymentInfo = () => {
  if (settings.paymentInfo) {
    navigator.clipboard.writeText(settings.paymentInfo);
    showToast('Copiado al portapapeles');
  }
};

// ====== META DE ENVÍO GRATIS EN BOGOTÁ ======
// Cada tipo de cliente (detal / mayorista) tiene su propia meta, configurable en
// Admin → Tienda. Meta 0 = el envío a Bogotá es siempre gratis. Debajo de la meta
// el envío a Bogotá cuesta "bogotaShippingFee".
const numSetting = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) ? d : Math.max(0, Number(v));

function getCartSubtotal() {
  return Object.entries(cart).reduce((t, [cartId, q]) => {
    const p = products.find(x => x.id === cartId.split(':')[0]);
    return t + (p ? getProductPrice(p) * q : 0);
  }, 0);
}
function getFreeShipGoal() {
  return isWholesaleMode ? numSetting(settings.freeShipWholesale, 300000) : numSetting(settings.freeShipRetail, 100000);
}
function getBogotaFee() { return numSetting(settings.bogotaShippingFee, 8000); }
function bogotaShippingPrice(subtotal = getCartSubtotal()) {
  const goal = getFreeShipGoal();
  return goal > 0 && subtotal < goal ? getBogotaFee() : 0;
}
function freeShipLabel() {
  const goal = getFreeShipGoal();
  return goal > 0 ? ` desde ${formatMoney(goal)}` : '';
}

// El envío a Bogotá depende del total del carrito: se recalcula cada vez que cambia
function applyBogotaShipping() {
  const price = bogotaShippingPrice();
  const goal = getFreeShipGoal();
  selectedShippingOption = { price, carrier: 'local', service: 'Envío Local', days: 'Hoy' };
  currentCalculatedShipping = price;
  const display = document.getElementById('shipping-cost-display');
  const freeMsg = document.getElementById('shipping-free-msg');
  if (display) { display.textContent = price === 0 ? 'GRATIS' : formatMoney(price); display.style.color = price === 0 ? 'var(--success)' : 'var(--text-main)'; }
  if (freeMsg) {
    freeMsg.style.display = 'block';
    freeMsg.textContent = price === 0
      ? '✅ ¡Envío gratis para Bogotá!'
      : `Agrega ${formatMoney(goal - getCartSubtotal())} más y el envío a Bogotá es GRATIS`;
  }
  updateOrderSteps();
}

// Barra que se llena con el valor del carrito (se dibuja una vez y luego solo se actualiza,
// para que el relleno se anime suavemente)
function buildFreeShipBar(el) {
  el.innerHTML = `
    <div class="fs-msg"></div>
    <div class="fs-track"><div class="fs-fill"></div><span class="fs-truck" aria-hidden="true">🚚</span></div>
    <div class="fs-scale"><span>${formatMoney(0)}</span><span class="fs-goal"></span></div>`;
  el.dataset.built = '1';
}

let fsWasReached = false;
function renderFreeShip() {
  const goal = getFreeShipGoal();
  const total = getCartSubtotal();
  const city = (document.getElementById('customer-city')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const otherCity = city && !city.startsWith('BOGOTA');
  const show = goal > 0 && total > 0 && userLocation !== 'nacional' && !otherCity;
  const reached = goal > 0 && total >= goal;
  const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;

  ['fs-cart', 'fs-order'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? '' : 'none';
    if (!show) return;
    if (!el.dataset.built) buildFreeShipBar(el);
    el.classList.toggle('fs-done', reached);
    el.querySelector('.fs-msg').innerHTML = reached
      ? '🎉 ¡Envío <b>GRATIS en Bogotá</b> desbloqueado!'
      : `Te faltan <b>${formatMoney(goal - total)}</b> para envío <b>GRATIS en Bogotá</b>`;
    el.querySelector('.fs-fill').style.width = pct + '%';
    el.querySelector('.fs-truck').style.left = pct + '%';
    el.querySelector('.fs-goal').textContent = formatMoney(goal);
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-valuenow', String(pct));
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
  });

  if (show && reached && !fsWasReached) {
    ['fs-cart', 'fs-order'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('fs-celebrate'); void el.offsetWidth; el.classList.add('fs-celebrate'); }
    });
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) {} }
  }
  fsWasReached = show && reached;

  // Si el envío elegido es el local de Bogotá, su precio sigue al carrito
  if (selectedShippingOption && selectedShippingOption.carrier === 'local') applyBogotaShipping();
}

// ====== SEGUIMIENTO DE PEDIDO ======
// El cliente consulta con su número de pedido + celular. Los pedidos son privados;
// por eso se guarda un registro mínimo en tracking/{PV-XXXXXX} (estado, ciudad,
// guía) que se lee solo por su clave exacta. El celular nunca se guarda: solo una
// huella (SHA-256) para comprobar que quien consulta es quien hizo el pedido.
async function trackHash(ticket, phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  const data = new TextEncoder().encode(`${String(ticket).toUpperCase()}:${digits}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function registerTracking(ticket, customer, itemCount, total, days) {
  try {
    await set(ref(db, `tracking/${ticket}`), {
      estado: 'gestion',
      h: await trackHash(ticket, customer.phone),
      ciudad: customer.city || '',
      n: itemCount,
      total: Number(total) || 0,
      dias: days === undefined || days === null ? '' : String(days),
      ts: Date.now(),
      upd: Date.now()
    });
    try { localStorage.setItem('last_ticket', ticket); } catch (e) {}
  } catch (e) { console.warn('No se pudo registrar el seguimiento', e); }
}

const TRACK_STEPS = [
  { key: 'gestion', icon: '📝', title: 'Pedido recibido', text: 'Ya tenemos tu pedido y lo estamos confirmando.' },
  { key: 'alistamiento', icon: '📦', title: 'Preparando tu pedido', text: 'Estamos alistando y empacando tus productos.' },
  { key: 'terminado', icon: '🚚', title: 'En camino', text: 'Tu pedido ya salió o está listo para entregarse.' },
  { key: 'entregado', icon: '🎉', title: 'Entregado', text: '¡Tu pedido llegó! Gracias por comprar.' }
];

function prepareTrackView() {
  const params = new URLSearchParams(window.location.search);
  let t = params.get('c') || '';
  if (!t) { try { t = localStorage.getItem('last_ticket') || ''; } catch (e) {} }
  const input = document.getElementById('track-ticket');
  if (input && !input.value && t) input.value = t;
  const result = document.getElementById('track-result');
  if (result) result.innerHTML = '';
}

async function searchTracking() {
  const result = document.getElementById('track-result');
  const ticket = (document.getElementById('track-ticket')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const phone = document.getElementById('track-phone')?.value || '';
  const btn = document.getElementById('btn-track-search');
  const fail = (msg) => { result.innerHTML = `<div class="track-error">${msg}</div>`; };
  if (!/^PV-[A-Z0-9_-]{6}$/.test(ticket)) return fail('Revisa el número de pedido: tiene la forma PV-XXXXXX.');
  if (phone.replace(/\D/g, '').length < 7) return fail('Escribe el celular con el que hiciste el pedido.');
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…'; }
  try {
    const snap = await get(ref(db, `tracking/${ticket}`));
    const t = snap.exists() ? snap.val() : null;
    if (!t || t.h !== await trackHash(ticket, phone)) {
      return fail('No encontramos un pedido con esos datos. Verifica el número y el celular, o escríbenos por WhatsApp.');
    }
    renderTrackingResult(ticket, t);
  } catch (e) {
    fail('No pudimos consultar ahora. Intenta de nuevo en un momento.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Consultar'; }
  }
}

function renderTrackingResult(ticket, t) {
  const result = document.getElementById('track-result');
  const estado = t.estado === 'pending' || t.estado === 'borrador' ? 'gestion' : t.estado;
  const cancelled = estado === 'cancelado';
  const idx = TRACK_STEPS.findIndex(s => s.key === estado);
  const current = idx < 0 ? 0 : idx;
  const when = t.upd ? new Date(t.upd).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const safeGuide = t.guia ? String(t.guia).replace(/[<>&"]/g, '') : '';
  const guideLink = /^https?:\/\//i.test(safeGuide) ? `<a href="${safeGuide}" target="_blank" rel="noopener">Abrir seguimiento de la transportadora</a>` : safeGuide;
  result.innerHTML = cancelled
    ? `<div class="track-cancelled"><b>${ticket}</b><p>Este pedido fue cancelado. Si crees que es un error, escríbenos por WhatsApp.</p></div>`
    : `<div class="track-head"><b>${ticket}</b><span>${t.ciudad ? '📍 ' + String(t.ciudad).replace(/[<>&"]/g, '') : ''}</span></div>
       <ol class="track-steps">${TRACK_STEPS.map((s, i) => `
         <li class="${i < current ? 'done' : (i === current ? 'current' : '')}">
           <span class="track-dot">${i <= current ? s.icon : ''}</span>
           <div><b>${s.title}</b>${i === current ? `<p>${s.text}</p>` : ''}</div>
         </li>`).join('')}</ol>
       ${safeGuide ? `<div class="track-guide">🔎 Guía / seguimiento: <b>${guideLink}</b></div>` : ''}
       ${t.dias && current < 3 ? `<div class="track-eta">🚚 Entrega estimada: ${String(t.dias).toLowerCase() === 'hoy' ? 'hoy mismo' : t.dias + ' días hábiles'}.</div>` : ''}
       ${when ? `<div class="track-updated">Última actualización: ${when}</div>` : ''}`;
}

// ====== SHIPPING ======
let currentCalculatedShipping = 0;
let selectedShippingOption = null; // { carrier, service, price, days } | { price:0, carrier:'local' } para Bogotá
let lastShippingOptions = [];

function isBogota(dept) {
  return dept === 'Bogotá D.C.';
}

function getShippingCost(dept) {
  return currentCalculatedShipping;
}

// Se llama cuando el cliente cambia de ciudad/departamento: solo resetea el
// estado de cotización anterior (ya no se cotiza automáticamente en cada
// cambio, porque cada cotización real cuesta una llamada a la API de Envia).
// Excepción: Bogotá siempre es envío gratis y no necesita cotización real.
function resetShippingState(dept, city) {
  selectedShippingOption = null;
  lastShippingOptions = [];
  currentCalculatedShipping = 0;

  const display = document.getElementById('shipping-cost-display');
  const freeMsg = document.getElementById('shipping-free-msg');
  const quoteBtn = document.getElementById('btn-quote-shipping');
  const ticketBtn = document.getElementById('btn-generate-ticket');
  const optionsPanel = document.getElementById('shipping-options-panel');
  if (optionsPanel) { optionsPanel.style.display = 'none'; optionsPanel.innerHTML = ''; }
  if (freeMsg) freeMsg.style.display = 'none';
  if (ticketBtn) ticketBtn.style.display = 'none';

  const normalizada = (city || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const esBogota = normalizada === 'BOGOTA' || normalizada === 'BOGOTA D.C.' || normalizada === 'BOGOTA DC';

  if (!dept || !city) {
    if (display) { display.textContent = 'Sin cotizar'; display.style.color = 'var(--text-muted)'; }
    if (quoteBtn) { quoteBtn.style.display = 'none'; }
    return;
  }

  if (esBogota) {
    applyBogotaShipping();
    if (quoteBtn) quoteBtn.style.display = 'none';
    if (ticketBtn) ticketBtn.style.display = 'flex';
    renderFreeShip();
    return;
  }

  if (display) { display.textContent = 'Sin cotizar'; display.style.color = 'var(--text-muted)'; }
  if (quoteBtn) quoteBtn.style.display = 'block';
  renderFreeShip();
}

// Dispara la cotización real con las transportadoras (Interrapidísimo,
// Servientrega, etc. vía Envia.com) y muestra las opciones para que el
// cliente elija. Se llama al hacer clic en "Cotizar envío".
window.quoteShipping = async function quoteShipping() {
  const dept = document.getElementById('customer-dept')?.value;
  const city = document.getElementById('customer-city')?.value;
  const address = document.getElementById('customer-address')?.value.trim();
  const zip = document.getElementById('customer-zip')?.value.trim();
  const quoteBtn = document.getElementById('btn-quote-shipping');
  const display = document.getElementById('shipping-cost-display');
  const optionsPanel = document.getElementById('shipping-options-panel');
  const optionsList = document.getElementById('shipping-options-list');

  if (!dept || !city || !address) {
    return showToast('Completa ciudad, departamento y dirección antes de cotizar');
  }
  if (!zip) {
    return showToast('Ingresa tu código postal para poder cotizar el envío');
  }
  if (Object.keys(cart).length === 0) return;

  if (quoteBtn) { quoteBtn.disabled = true; quoteBtn.textContent = 'Cotizando...'; }
  if (display) { display.textContent = 'Cotizando...'; display.style.color = '#f59e0b'; }

  const itemsArray = Object.entries(cart).map(([cartId, q]) => {
    const parts = cartId.split(':');
    const p = products.find(x => x.id === parts[0]);
    if (!p) return null;
    return {
      id: parts[0],
      name: p.name,
      price: getProductPrice(p),
      qty: q,
      weight: p.weight || 0.3, // kg por defecto si el producto no tiene peso definido
      variantColor: parts[1] || null,
      origen: p.origen || 'propio'
    };
  }).filter(i => i !== null);

  try {
    const response = await fetch('/api/calcular-envio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciudad_destino: city,
        departamento_destino: dept,
        direccion_destino: address,
        codigo_postal_destino: zip,
        items: itemsArray
      })
    });
    const data = await response.json();

    if (data.es_gratis) {
      applyBogotaShipping(); // Bogotá: gratis solo si el carrito llega a la meta
      if (selectedShippingOption) selectedShippingOption.service = data.metodo_entrega || 'Envío Local';
      if (quoteBtn) quoteBtn.style.display = 'none';
      document.getElementById('btn-generate-ticket').style.display = 'flex';
      return;
    }

    if (data.opciones && data.opciones.length > 0) {
      lastShippingOptions = data.opciones;
      if (optionsPanel && optionsList) {
        optionsList.innerHTML = data.opciones.map((op, idx) => `
          <div class="shipping-option-card" onclick="window.selectShippingOption(${idx})">
            <div class="shipping-option-info">
              <div class="shipping-option-carrier">${op.carrier_label || op.carrier}</div>
              <div class="shipping-option-days">📦 Entrega estimada: ${op.days || '2-5'} días hábiles</div>
            </div>
            <div class="shipping-option-price">${formatMoney(op.price)}</div>
          </div>
        `).join('');
        optionsPanel.style.display = 'block';
      }
      if (display) { display.textContent = 'Elige una opción ↓'; display.style.color = 'var(--text-main)'; }
      if (quoteBtn) { quoteBtn.style.display = 'block'; quoteBtn.textContent = 'Volver a cotizar'; quoteBtn.disabled = false; }
      // Auto-selecciona la más barata para no bloquear al cliente que no quiera comparar
      window.selectShippingOption(0);
      return;
    }

    // Ni gratis ni opciones: usamos el respaldo que vino del backend
    selectedShippingOption = { price: data.costo_envio || 0, carrier: 'respaldo', service: data.mensaje || 'Tarifa de respaldo', days: '3-7' }; updateOrderSteps();
    currentCalculatedShipping = selectedShippingOption.price;
    if (display) { display.textContent = formatMoney(selectedShippingOption.price) + ' (estimado)'; display.style.color = 'var(--text-main)'; }
    if (quoteBtn) quoteBtn.style.display = 'none';
    document.getElementById('btn-generate-ticket').style.display = 'flex';

  } catch (err) {
    console.error('Error cotizando envío:', err);
    showToast('No se pudo cotizar el envío. Intenta de nuevo.');
    if (display) { display.textContent = 'Error al cotizar'; display.style.color = '#e74c3c'; }
    if (quoteBtn) { quoteBtn.disabled = false; quoteBtn.textContent = 'Reintentar cotización'; }
  }
}

window.selectShippingOption = function(idx) {
  const op = lastShippingOptions[idx];
  if (!op) return;
  selectedShippingOption = { price: op.price, carrier: op.carrier, service: op.carrier_label || op.carrier, days: op.days }; updateOrderSteps();
  currentCalculatedShipping = op.price;

  document.querySelectorAll('.shipping-option-card').forEach((card, i) => {
    card.classList.toggle('selected', i === idx);
  });

  const display = document.getElementById('shipping-cost-display');
  if (display) { display.textContent = formatMoney(op.price); display.style.color = 'var(--primary)'; }
  document.getElementById('btn-generate-ticket').style.display = 'flex';
};

// ====== DOM READY ======
document.addEventListener('DOMContentLoaded', () => {
  initCriticalApp();
  // Retrasar carga de lógica no esencial (Admin, Modals pesados) para liberar el hilo principal
  setTimeout(initSecondaryApp, 1500);
});

function initCriticalApp() {
  views = {
    catalog: document.getElementById('view-catalog'),
    order: document.getElementById('view-order'),
    ticket: document.getElementById('view-ticket'),
    product: document.getElementById('view-product'),
    'shipping-policy': document.getElementById('view-shipping-policy'),
    'returns-policy': document.getElementById('view-returns-policy'),
    contact: document.getElementById('view-contact'),
    'wholesale-login': document.getElementById('view-wholesale-login'),
    track: document.getElementById('view-track')
  };
  els = {
    productsGrid: document.getElementById('products-grid'),
    categoryFilters: document.getElementById('category-filters'),
    cartBar: document.getElementById('cart-bar'),
    cartCount: document.getElementById('cart-count'),
    cartTotal: document.getElementById('cart-total-bar'),
    orderList: document.getElementById('order-items-list'),
    orderTotalAmount: document.getElementById('order-total-amount'),
    searchInput: document.getElementById('search-input'),
    toast: document.getElementById('toast')
  };

  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
  };

  on('btn-view-order', 'onclick', () => {
    trackEvent('ver_pedido', 'Abrir vista pedido');
    navigateTo('/pedido');
    renderOrderList();
  });
  on('btn-back-catalog', 'onclick', () => navigateTo(getCatalogPath()));
  on('btn-wholesale-toggle', 'onclick', async () => {
    if (isWholesaleMode) { await wholesaleLogout(); navigateTo('/'); }
    else navigateTo('/mayoristas');
  });
  on('btn-wholesale-back-store', 'onclick', () => navigateTo('/'));

  on('sort-select', 'onchange', (e) => { currentSort = e.target.value; renderProducts(); });
  initReviewForm();
  setTimeout(loadReviewStats, 800);
  on('track-form', 'onsubmit', (e) => { e.preventDefault(); searchTracking(); return false; });
  on('btn-quick-discount', 'onclick', () => setQuickView('discount'));
  on('btn-quick-new', 'onclick', () => setQuickView('new'));
  on('btn-clear-filters', 'onclick', () => {
    currentFilter = 'all';
    currentQuickView = null;
    safeText('catalog-section-title', isWholesaleMode ? 'Catálogo mayorista' : 'Todos los productos');
    safeValue('search-input', '');
    renderFilters();
    renderProducts();
  });
  on('btn-view-toggle', 'onclick', () => {
    wholesaleListView = !wholesaleListView;
    try { localStorage.setItem('ws_list_view', wholesaleListView ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    refreshWholesaleToolbar();
    renderProducts();
  });
  on('btn-repeat-order', 'onclick', () => repeatLastWholesaleOrder());
  // Cualquier cambio en el formulario de envío actualiza los pasos del pedido
  ['input', 'change'].forEach(evt => document.getElementById('view-order')?.addEventListener(evt, updateOrderSteps));
  on('btn-wholesale-login-submit', 'onclick', async () => {
    const email = document.getElementById('wholesale-email')?.value.trim();
    const pass = document.getElementById('wholesale-password')?.value;
    if (!email || !pass) return showWholesaleLoginState('form', 'Escribe tu correo y contraseña');
    const btn = document.getElementById('btn-wholesale-login-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
    try {
      await wholesaleLogin(email, pass);
      safeValue('wholesale-password', '');
      showWholesaleLoginState('checking');
      handleRoute();
    } catch (err) {
      console.error('Login mayorista:', err.code);
      const bad = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(err.code);
      showWholesaleLoginState('form', err.code === 'app/no-wholesaler'
        ? 'Tu cuenta no tiene acceso mayorista activo. Escríbenos por WhatsApp para solicitarlo.'
        : bad ? 'Correo o contraseña incorrectos' : 'No pudimos iniciar sesión. Intenta de nuevo.');
      safeValue('wholesale-password', '');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Entrar al portal'; }
    }
  });
  on('btn-back-order', 'onclick', () => navigateTo('/pedido'));
  
  // Product Detail Page listeners
  on('btn-back-catalog-product', 'onclick', () => {
    navigateTo(getCatalogPath());
  });
  on('btn-detail-qty-minus', 'onclick', () => {
    const minQty = isWholesaleMode ? WHOLESALE_MIN_QTY : 1;
    if (currentDetailQty > minQty) {
      currentDetailQty--;
      updateDetailQtyUI();
    } else if (isWholesaleMode) {
      showToast(`El pedido mayorista es de mínimo ${WHOLESALE_MIN_QTY} unidades`);
    }
  });
  on('btn-detail-qty-plus', 'onclick', () => {
    const p = currentDetailProduct;
    if (!p) return;
    const hasStockLimit = (val) => val !== undefined && val !== null && val !== '';
    if (currentDetailColor) {
      const v = p.variants && p.variants.find(x => x.color === currentDetailColor);
      if (v && hasStockLimit(v.stock) && currentDetailQty >= v.stock) {
        showToast(`Solo quedan ${v.stock} unidades (${getVariantLabel(p)}: ${currentDetailColor})`);
        return;
      }
    } else {
      if (hasStockLimit(p.stock) && currentDetailQty >= p.stock) {
        showToast(`Solo quedan ${p.stock} unidades`);
        return;
      }
    }
    currentDetailQty++;
    updateDetailQtyUI();
  });
  on('btn-detail-add-cart', 'onclick', () => {
    const p = currentDetailProduct;
    if (!p) return;
    const cartId = currentDetailColor ? `${p.id}:${currentDetailColor}` : p.id;
    updateCart(cartId, currentDetailQty);
    showToast('Agregado al carrito');
  });
  on('btn-detail-wa-buy', 'onclick', () => {
    const p = currentDetailProduct;
    if (!p) return;
    const phone = String(settings.whatsapp || '').replace(/\D/g, '');
    if (phone.length < 10) {
      showToast('WhatsApp no configurado');
      return;
    }
    const itemText = currentDetailColor ? `${p.name} (${getVariantLabel(p)}: ${currentDetailColor})` : p.name;
    const qtyText = currentDetailQty > 1 ? `x${currentDetailQty}` : '';
    const price = getProductPrice(p);
    const totalVal = price * currentDetailQty;
    
    let waMessage = isWholesaleMode ? `Hola, quiero hacer este pedido AL POR MAYOR 📦:\n` : `Hola, quiero comprar este producto 👀:\n`;
    waMessage += `• *${itemText}* ${qtyText}\n`;
    waMessage += `💰 *Precio:* ${formatMoney(price)}\n`;
    if (currentDetailQty > 1) {
      waMessage += `💵 *Total:* ${formatMoney(totalVal)}\n`;
    }
    waMessage += `\n¿Tienen disponibilidad?`;
    
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`;
    window.open(waUrl, '_blank');
  });
  on('btn-new-order', 'onclick', () => navigateTo(getCatalogPath()));

  let searchTimer;
  on('search-input', 'oninput', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderProducts, 150);
  });

  // ====== LISTENERS DE CIERRE (MODALES) ======
  on('btn-close-login-modal', 'onclick', () => {
    safeStyle('modal-login', 'display', 'none');
    safeValue('login-password', '');
  });

  on('btn-close-product-modal', 'onclick', () => {
    safeStyle('modal-product', 'display', 'none');
  });

  on('btn-close-image-modal', 'onclick', () => {
    safeStyle('image-viewer-modal', 'display', 'none');
  });

  updateWAButtonPosition();
  init();

  // Aplicar ubicación guardada inmediatamente
  if (userLocation) setUserLocation(userLocation);
}

function initSecondaryApp() {
  // Asistente de compras (carga diferida: no afecta la velocidad inicial)
  import('./asistente.js').then(m => {
    m.initAsistente({
      getProducts: () => products,
      getSettings: () => settings,
      getPrice: getProductPrice,
      getCart: () => cart,
      updateCart,
      navigateTo,
      formatMoney,
      variantLabel: getVariantLabel,
      trackEvent,
      registerFloating: (fn) => { floatingCb = fn; },
      syncFloating: updateWAButtonPosition
    });
    updateWAButtonPosition();
  }).catch(err => console.error('No se pudo cargar el asistente', err));

  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
  };

  // El botón flotante de WhatsApp debe correrse hacia arriba cada vez que la
  // barra fija de "Tu pedido" cambia de altura (aparece el botón de cotizar,
  // luego el panel de opciones, luego el botón de generar ticket, etc.) sin
  // tener que llamar updateWAButtonPosition() manualmente en cada punto.
  const orderFooterEl = document.querySelector('.order-sticky-footer');
  if (orderFooterEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => updateWAButtonPosition()).observe(orderFooterEl);
  }

  // Finalizar pedido
  on('btn-generate-ticket', 'onclick', async () => {
    const name = document.getElementById('customer-name')?.value.trim();
    const phone = document.getElementById('customer-phone')?.value.trim();
    const dept = document.getElementById('customer-dept')?.value;
    const city = document.getElementById('customer-city')?.value;
    const address = document.getElementById('customer-address')?.value.trim();
    
    // Limpia errores anteriores y resalta lo que falta, en vez de solo avisar con un mensaje que desaparece.
    document.querySelectorAll('.field-input.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
    const markError = (id, msg) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('field-error');
      const note = document.createElement('div');
      note.className = 'field-error-msg';
      note.textContent = msg;
      el.insertAdjacentElement('afterend', note);
      const clear = () => { el.classList.remove('field-error'); note.remove(); el.removeEventListener('input', clear); el.removeEventListener('change', clear); };
      el.addEventListener('input', clear);
      el.addEventListener('change', clear);
    };
    const missing = [];
    if (!name) missing.push(['customer-name', 'Escribe tu nombre']);
    if (!phone) missing.push(['customer-phone', 'Escribe tu celular']);
    else if (!/^\d{10}$/.test(phone.replace(/\s/g, ''))) missing.push(['customer-phone', 'El celular debe tener 10 dígitos']);
    if (!dept) missing.push(['customer-dept', 'Elige tu departamento']);
    if (!city) missing.push(['customer-city', 'Elige tu ciudad']);
    if (!address) missing.push(['customer-address', 'Escribe tu dirección']);
    if (missing.length) {
      missing.forEach(([id, msg]) => markError(id, msg));
      const first = document.getElementById(missing[0][0]);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus({ preventScroll: true });
      return showToast('Revisa los campos marcados en rojo');
    }
    if (!selectedShippingOption) {
      return showToast('Primero cotiza y elige tu opción de envío');
    }
    if (isWholesaleMode && !wholesaleSession) {
      return showToast('Inicia sesión en el portal mayorista para hacer pedidos');
    }
    const shortfalls = getWholesaleShortfalls();
    if (shortfalls.length > 0) {
      return showToast(`Pedido mayorista: mínimo ${WHOLESALE_MIN_QTY} unidades de "${shortfalls[0]}"`);
    }

    const customer = {
      name, phone, dept, city, address,
      barrio: document.getElementById('customer-barrio')?.value.trim() || '',
      address2: document.getElementById('customer-address2')?.value.trim() || '',
      zip: document.getElementById('customer-zip')?.value.trim() || '',
      notes: document.getElementById('customer-notes')?.value.trim() || ''
    };

    const items = Object.entries(cart).map(([cartId, q]) => {
      const parts = cartId.split(':');
      const p = products.find(x => x.id === parts[0]);
      if (!p) return null;
      return {
        id: parts[0],
        name: p.name,
        price: getProductPrice(p),
        qty: q,
        variantColor: parts[1] || null,
        origen: p.origen || 'propio' // Clave para la integración con Mastershop
      };
    }).filter(i => i !== null);

    const subtotal = items.reduce((t, i) => t + i.price * i.qty, 0);
    const shippingCost = selectedShippingOption.price;
    const total = subtotal + shippingCost;

    const orderData = {
      customer, items, subtotal, total,
      shipping: {
        cost: shippingCost,
        carrier: selectedShippingOption.carrier,
        service: selectedShippingOption.service,
        days: selectedShippingOption.days
      },
      timestamp: Date.now(),
      status: 'pending',
      channel: isWholesaleMode ? 'mayorista' : 'web'
    };
    if (isWholesaleMode && wholesaleSession) {
      orderData.wholesaler = { uid: wholesaleSession.uid, name: wholesaleSession.name, email: wholesaleSession.email };
    }

    try {
      const newRef = await push(ref(db, 'orders'), orderData);
      const ticketNum = 'PV-' + newRef.key.slice(-6).toUpperCase();
      registerTracking(ticketNum, customer, items.length, total, selectedShippingOption?.days);
      
      // Enviar orden a la transportadora integrada (Mastershop) si aplica
      try {
        await fetch('/api/crear-orden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente: { nombre: customer.name, telefono: customer.phone },
            tipo_pedido: isWholesaleMode ? 'mayorista' : 'detal',
            ciudad_destino: customer.city,
            departamento_destino: customer.dept,
            direccion_destino: customer.address + (customer.address2 ? ', ' + customer.address2 : ''),
            items: items
          })
        });
      } catch(e) { console.error('Error reportando la orden:', e); }

      safeText('ticket-store-name', settings.storeName || 'Panda Venta');
      safeText('ticket-number', ticketNum);
      safeText('thanks-ticket-number', ticketNum);
      const days = selectedShippingOption?.days;
      safeText('thanks-delivery', days === undefined || days === null || days === ''
        ? ''
        : (String(days).toLowerCase() === 'hoy' ? '🚚 Entrega estimada: hoy mismo.' : `🚚 Entrega estimada: ${days} días hábiles.`));
      if (isWholesaleMode && wholesaleSession) {
        try {
          localStorage.setItem('ws_last_order_' + wholesaleSession.uid, JSON.stringify(
            items.map(i => ({ cartId: i.variantColor ? `${i.id}:${i.variantColor}` : i.id, qty: i.qty }))
          ));
        } catch (e) { /* sin almacenamiento */ }
      }
      safeText('ticket-date', new Date().toLocaleString('es-CO'));
      safeText('ticket-customer-name', customer.name);
      safeText('ticket-customer-phone', customer.phone);
      safeText('ticket-customer-city', customer.city);
      safeText('ticket-customer-dept', customer.dept);
      safeText('ticket-customer-barrio', customer.barrio || '—');
      safeText('ticket-customer-address', customer.address);
      
      if (customer.address2) {
        safeText('ticket-customer-address2', customer.address2);
        safeStyle('ticket-address2-wrapper', 'display', 'block');
      } else {
        safeStyle('ticket-address2-wrapper', 'display', 'none');
      }

      const shippingVal = document.getElementById('shipping-cost-display')?.textContent || '—';
      safeText('ticket-shipping-cost', shippingVal);
      
      const listEl = document.getElementById('ticket-items');
      if (listEl) {
        listEl.innerHTML = items.map(i => {
          const prod = products.find(x => x.id === i.id);
          const variantSuffix = i.variantColor ? ` (${getVariantLabel(prod)}: ${i.variantColor})` : '';
          return `
          <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px dashed #eee;font-size:0.85rem;">
            <span>${i.name}${variantSuffix} x${i.qty}</span>
            <span>${formatMoney(i.price * i.qty)}</span>
          </div>`;
        }).join('');
      }

      // Calcular total final con el envío calculado
      const shippingNum = currentCalculatedShipping;
      const grandTotal = subtotal + shippingNum;
      safeText('ticket-total', formatMoney(grandTotal));

      // Notas
      if (customer.notes) {
        safeText('ticket-note-text', customer.notes);
        safeStyle('ticket-notes-wrapper', 'display', 'block');
      } else {
        safeStyle('ticket-notes-wrapper', 'display', 'none');
      }

      // Información de Pago
      if (settings.paymentInfo || settings.paymentQR) {
        safeStyle('ticket-payment-wrapper', 'display', 'block');
        safeText('ticket-payment-text', settings.paymentInfo || '');
        if (settings.paymentQR) {
          safeSet('ticket-qr-img', 'src', settings.paymentQR);
          safeStyle('ticket-qr-wrapper', 'display', 'block');
        } else {
          safeStyle('ticket-qr-wrapper', 'display', 'none');
        }
      } else {
        safeStyle('ticket-payment-wrapper', 'display', 'none');
      }

      const waBtn = document.getElementById('btn-whatsapp');
      if (waBtn && settings.whatsapp) {
        // 1. Mensaje detallado para WhatsApp
        let waMessage = isWholesaleMode ? `*NUEVO PEDIDO AL POR MAYOR: ${ticketNum}* 📦\n` : `*NUEVO PEDIDO: ${ticketNum}*\n`;
        waMessage += `----------------------------\n`;
        waMessage += `👤 *Cliente:* ${customer.name}\n`;
        waMessage += `📞 *Celular:* ${customer.phone}\n`;
        waMessage += `📍 *Ciudad:* ${customer.city} (${customer.dept})\n`;
        if (customer.barrio) waMessage += `🏘️ *Barrio:* ${customer.barrio}\n`;
        waMessage += `🏠 *Dir:* ${customer.address}\n`;
        if (customer.address2) waMessage += `🏢 *Detalle:* ${customer.address2}\n`;
        if (customer.notes) waMessage += `📝 *Nota:* ${customer.notes}\n\n`;
        
        waMessage += `🛒 *PRODUCTOS:*\n`;
        items.forEach(i => {
          const prod = products.find(x => x.id === i.id);
          const variantSuffix = i.variantColor ? ` (${getVariantLabel(prod)}: ${i.variantColor})` : '';
          waMessage += `• ${i.name}${variantSuffix} x${i.qty} — ${formatMoney(i.price * i.qty)}\n`;
        });
        
        waMessage += `\n🚛 *Envío:* ${shippingVal}\n`;
        waMessage += `💰 *TOTAL A PAGAR: ${formatMoney(grandTotal)}*\n`;
        waMessage += `----------------------------\n`;
        waMessage += `_Gracias por tu compra en ${settings.storeName || 'Panda Venta'}_`;

        const waUrl = `https://wa.me/${settings.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(waMessage)}`;
        
        waBtn.onclick = async () => {
          // 2. Generar y descargar ticket como imagen automáticamente
          const ticketEl = document.getElementById('ticket-card');
          if (ticketEl && typeof html2canvas === 'function') {
            try {
              const canvas = await html2canvas(ticketEl, { 
                scale: 2, 
                logging: false, 
                useCORS: true,
                backgroundColor: "#ffffff"
              });
              const link = document.createElement('a');
              link.download = `Ticket-${ticketNum}.png`;
              link.href = canvas.toDataURL('image/png');
              link.click();
            } catch (e) { console.error("Error generating ticket image:", e); }
          }
          
          // 3. Abrir WhatsApp
          window.open(waUrl, '_blank');
        };
      }

      switchView('ticket');
      Object.keys(cart).forEach(id => delete cart[id]);
      updateCartUI();
      showToast('¡Pedido generado! Descargando ticket...');
    } catch (err) {
      showToast('Error al enviar pedido');
    }
  });

  // ====== TICKET DOWNLOAD ======
  on('btn-download-ticket', 'onclick', async () => {
    const ticket = document.getElementById('ticket-card');
    if (!ticket) return;
    try {
      const canvas = await html2canvas(ticket, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `pedido.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) { showToast('Error al generar imagen'); }
  });

  // ====== COMPARTIR TICKET (Web Share API) ======
  // Este botón estaba oculto y sin conectar — solo tiene sentido mostrarlo si
  // el navegador soporta compartir archivos de forma nativa (principalmente
  // navegadores móviles; en escritorio suele no estar disponible).
  const shareBtn = document.getElementById('btn-share-ticket');
  if (shareBtn && navigator.canShare && navigator.canShare({ files: [new File([], 'test.png', { type: 'image/png' })] })) {
    shareBtn.style.display = 'flex';
    shareBtn.onclick = async () => {
      const ticket = document.getElementById('ticket-card');
      if (!ticket) return;
      try {
        const canvas = await html2canvas(ticket, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        canvas.toBlob(async (blob) => {
          const file = new File([blob], 'pedido.png', { type: 'image/png' });
          try {
            await navigator.share({
              files: [file],
              title: settings.storeName || 'Mi pedido',
              text: '¡Aquí está mi pedido!'
            });
          } catch (shareErr) {
            // El usuario canceló el diálogo de compartir — no es un error real
            if (shareErr.name !== 'AbortError') console.error('Error compartiendo:', shareErr);
          }
        }, 'image/png');
      } catch (err) {
        showToast('Error al generar imagen para compartir');
      }
    };
  }

  // ====== ADMIN ACCESS — Autenticación real con Firebase Auth ======
  // Antes: se comparaba un hash guardado en /settings del lado del cliente,
  // lo cual no era autenticación real — cualquiera con la URL de la base de
  // datos podía escribir sin ninguna credencial. Ahora cada vendedor/admin
  // tiene su propia cuenta real en Firebase Authentication.
  const openAdmin = async () => {
    const state = { db, auth, products, settings, orders, cart, currentProductImages, viewerImages, viewerIndex };
    const utils = { formatMoney, showToast, switchView, safeSet, safeText, safeHTML, safeValue, safeStyle, compressImage, uploadToStorage, uploadImageFile, uploadBlobToStorage, hashPassword, isBogota, getShippingCost };
    const { initAdmin } = await import('./admin.js');
    initAdmin(state, utils);
  };

  const triggerAdminAccess = async () => {
    safeStyle('modal-login', 'display', 'flex');
  };

  on('btn-open-admin', 'onclick', triggerAdminAccess);

  on('btn-login-submit', 'onclick', async () => {
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');
    if (!passInput || !emailInput) return;

    const submitBtn = document.getElementById('btn-login-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Entrando...'; }

    try {
      const cred = await signInWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value);
      // Las cuentas de mayoristas son solo para el portal mayorista, nunca para el panel.
      let isWholesalerAccount = false;
      try { isWholesalerAccount = (await get(ref(db, `wholesalers/${cred.user.uid}`))).exists(); } catch (e) { /* sin acceso a ese nodo = personal */ }
      if (isWholesalerAccount) {
        await signOut(auth);
        throw Object.assign(new Error('wholesaler'), { code: 'app/wholesaler-account' });
      }
      safeStyle('modal-login', 'display', 'none');
      if (errorMsg) errorMsg.style.display = 'none';
      passInput.value = '';
      openAdmin();
    } catch (err) {
      console.error('Error de autenticación:', err.code);
      if (errorMsg) {
        errorMsg.textContent = (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found')
          ? 'Correo o contraseña incorrectos'
          : err.code === 'app/wholesaler-account'
            ? 'Esta cuenta es de mayorista: ingresa por el portal mayorista'
            : 'Error al iniciar sesión. Intenta de nuevo.';
        errorMsg.style.display = 'block';
      }
      passInput.value = '';
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar'; }
    }
  });

  onAuthStateChanged(auth, (user) => {
    window.currentAdminUser = user;
  });

  // Logo triple click
  let logoClicks = 0, logoTimer;
  const logoEl = document.getElementById('header-logo-area');
  if (logoEl) {
    logoEl.onclick = () => {
      logoClicks++;
      clearTimeout(logoTimer);
      if (logoClicks === 3) { logoClicks = 0; triggerAdminAccess(); }
      else logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
    };
  }


  // ====== LOCATION SELECTOR ======
  const locationDeptEl = document.getElementById('customer-dept');
  const locationCityEl = document.getElementById('customer-city');
  if (locationDeptEl && typeof COLOMBIA_LOCATIONS !== 'undefined') {
    locationDeptEl.innerHTML = '<option value="">Departamento...</option>' + Object.keys(COLOMBIA_LOCATIONS).sort().map(d => `<option value="${d}">${d}</option>`).join('');
    
    locationDeptEl.onchange = () => {
      const cities = COLOMBIA_LOCATIONS[locationDeptEl.value] || [];
      locationCityEl.innerHTML = '<option value="">Ciudad...</option>' + cities.sort().map(c => `<option value="${c}">${c}</option>`).join('');
      locationCityEl.disabled = !cities.length;
      resetShippingState(locationDeptEl.value, locationCityEl.value);
    };

    locationCityEl.onchange = () => {
      resetShippingState(locationDeptEl.value, locationCityEl.value);
    };
  }

  // ====== UTILS & BACKGROUND ======
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Geo Detection
  function detectLocation() {
    if (isLocationDetected) return;
    
    // Primero intentamos por IP (Frictionless / Sin permisos)
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        if (isLocationDetected) return;
        isLocationDetected = true;
        const city = (data.city || '').toLowerCase();
        const region = (data.region || '').toLowerCase();
        const isBgt = city.includes('bogot') || region.includes('bogot');
        setUserLocation(isBgt ? 'bogota' : 'nacional');
      })
      .catch(() => {
        // Fallback a Geolocation si falla el IP (necesita permiso)
        if (isLocationDetected || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude, longitude } = pos.coords;
          fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=es`)
            .then(r => r.json())
            .then(data => {
              isLocationDetected = true;
              const address = data.address || {};
              const city = (address.city || address.town || address.municipality || '').toLowerCase();
              const state = (address.state || '').toLowerCase();
              const isBgt = city.includes('bogot') || state.includes('bogotá');
              setUserLocation(isBgt ? 'bogota' : 'nacional');
            }).catch(() => {});
        }, () => {}, { timeout: 5000 });
      });
  }

  const requestLoc = () => { detectLocation(); ['click', 'scroll', 'touchstart'].forEach(ev => document.removeEventListener(ev, requestLoc)); };
  ['click', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, requestLoc, { once: true, passive: true }));
}

