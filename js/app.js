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
  getDatabase, ref, onValue, push
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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

// ====== STATE ======
let products = [];
let settings = {
  storeName: 'Panda Venta', tagline: 'Pedidos por WhatsApp', whatsapp: '',
  color: '#6c63ff', currency: 'COP', logo: '', adminPassword: '',
  paymentInfo: '', paymentQR: '', shippingCost: 0,
  locContent: {
    bgtTitle: '¡Envío GRATIS hoy en Bogotá! ⚡',
    bgtSub: 'Pide antes de las 12 PM y recibe hoy mismo.',
    natTitle: 'Lo que buscas, al mejor precio',
    natSub: 'Compra fácil y rápido — envíos a toda Colombia'
  }
};
let orders = [];
let cart = {};
let currentFilter = 'all';
let isWholesaleMode = false;

function getProductPrice(p) {
  if (!p) return 0;
  if (isWholesaleMode) {
    if (p.wholesalePrice !== undefined && p.wholesalePrice !== null && p.wholesalePrice !== '' && p.wholesalePrice !== 0) {
      return parseFloat(p.wholesalePrice);
    }
    const discount = settings.wholesaleDiscount !== undefined ? parseFloat(settings.wholesaleDiscount) : 20;
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
  return new Promise((resolve) => {
    const img = new Image();
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

const formatMoney = (amount) => {
  return settings.currency + (settings.currency.length > 1 ? ' ' : '') + parseFloat(amount).toLocaleString('es-CO');
};

const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
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
    const privateViews = ['order', 'ticket', 'admin', 'login'];
    let metaRobots = document.querySelector('meta[name="robots"]');
    if (!metaRobots) {
      metaRobots = document.createElement('meta');
      metaRobots.name = 'robots';
      document.head.appendChild(metaRobots);
    }
    metaRobots.content = privateViews.includes(viewName) ? 'noindex, nofollow' : 'index, follow';
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
    // Si el panel de admin está abierto o explícitamente pide admin=true, evadimos el caché
    const url = document.getElementById('panel-admin')?.style.display === 'flex' 
      ? '/api/catalogo?admin=true' 
      : '/api/catalogo';
    
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
    renderFilters();
    renderProducts();
    renderDiscountSection();
    updateCartUI();
    handleRoute();
    const panel = document.getElementById('panel-admin');
    if (panel && panel.style.display === 'flex') {
      import('./admin.js').then(m => m.renderAdminProducts());
    }
  } catch (error) {
    console.error("Error cargando catálogo", error);
  }
};

function init() {
  window.loadCatalog();

  const updateWholesaleToggleUI = () => {
    const btnRetail = document.getElementById('btn-retail-mode');
    const btnWholesale = document.getElementById('btn-wholesale-mode');
    const banner = document.getElementById('wholesale-info-banner');
    if (!btnRetail || !btnWholesale) return;
    
    if (isWholesaleMode) {
      btnRetail.classList.remove('active');
      btnRetail.style.background = 'transparent';
      btnRetail.style.color = 'var(--text-muted)';
      btnWholesale.classList.add('active');
      btnWholesale.style.background = 'var(--primary)';
      btnWholesale.style.color = '#fff';
      if (banner) banner.style.display = 'block';
    } else {
      btnRetail.classList.add('active');
      btnRetail.style.background = 'var(--primary)';
      btnRetail.style.color = '#fff';
      btnWholesale.classList.remove('active');
      btnWholesale.style.background = 'transparent';
      btnWholesale.style.color = 'var(--text-muted)';
      if (banner) banner.style.display = 'none';
    }
  };

  const switchWholesaleMode = (wholesale) => {
    if (isWholesaleMode === wholesale) return;
    
    if (Object.keys(cart).length > 0) {
      const confirmClear = confirm("Cambiar de canal de venta (Detal / Mayorista) vaciará tu carrito actual. ¿Deseas continuar?");
      if (!confirmClear) return;
      cart = {};
      updateCartUI();
    }
    
    isWholesaleMode = wholesale;
    updateWholesaleToggleUI();
    renderProducts();
    renderDiscountSection();
    updateCartUI();
  };

  document.getElementById('btn-retail-mode')?.addEventListener('click', () => switchWholesaleMode(false));
  document.getElementById('btn-wholesale-mode')?.addEventListener('click', () => switchWholesaleMode(true));
  
  updateWholesaleToggleUI();

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
}

// ====== CATALOG ======
function renderFilters() {
  const categories = ['all', ...new Set(products.map(p => p.category).filter(c => c))];
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
  if (!camp || !camp.enabled || !camp.tag) {
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

  let filtered = products.filter(p => p.active);

  if (currentFilter !== 'all') {
    filtered = filtered.filter(p => p.category === currentFilter);
  }

  if (searchTerms.length > 0) {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.ref || ''} ${p.category || ''}`.toLowerCase();
      return searchTerms.every(term => text.includes(term));
    });
  }

  if (filtered.length === 0) {
    if (isProductsLoaded) {
      container.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
    }
    return;
  }

  container.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  if (typeof renderCampaign === 'function') renderCampaign();
  if (typeof renderDiscountSection === 'function') renderDiscountSection();

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
      card.className = 'product-card';
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
        Envío GRATIS
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
    if (heroTitle) heroTitle.innerHTML = loc.bgtTitle || '¡Envío GRATIS hoy en Bogotá! ⚡';
    if (heroSub) heroSub.textContent = loc.bgtSub || 'Pide antes de las 12 PM y recibe hoy mismo.';
    if (trustBar) {
      trustBar.innerHTML = `
        <span>🚀 <b>Llega HOY</b> en Bogotá</span>
        <span>✅ <b>Envío GRATIS</b></span>
        <span>🛡️ Compra <b>100% segura</b></span>
      `;
    }
  } else {
    if (heroTitle) heroTitle.innerHTML = loc.natTitle || 'Lo que buscas, al mejor precio';
    if (heroSub) heroSub.textContent = loc.natSub || 'Compra fácil y rápido — envíos a toda Colombia';
    if (trustBar) {
      trustBar.innerHTML = `
        <span>🚛 Envíos <b>a todo el país</b></span>
        <span>🛡️ Compra <b>100% segura</b></span>
        <span>⭐ <b>+10,000</b> clientes felices</span>
      `;
    }
  }
  
  renderProducts(); // Re-render badges smoothly
}
window.setUserLocation = setUserLocation;

// ====== LÓGICA DE WHATSAPP FLOTANTE ======
function updateWAButtonPosition() {
  const waBtn = document.getElementById('global-wa-btn');
  const cartBar = document.getElementById('cart-bar');
  const orderFooter = document.querySelector('.order-sticky-footer');
  if (!waBtn) return;

  // Evitar reflow forzado usando requestAnimationFrame para agrupar lecturas del DOM
  requestAnimationFrame(() => {
    const orderViewActive = document.getElementById('view-order')?.classList.contains('active');
    if (orderViewActive && orderFooter) {
      // En la vista de "Tu pedido" la barra de envío/total tapa el botón de
      // WhatsApp si no se corre hacia arriba según la altura real de esa barra
      // (que cambia: crece cuando aparece el selector de transportadora).
      const height = orderFooter.offsetHeight || 90;
      waBtn.style.bottom = (height + 16) + 'px';
    } else if (cartBar && cartBar.style.display !== 'none') {
      const height = cartBar.offsetHeight || 70;
      waBtn.style.bottom = (height + 24) + 'px';
    } else {
      waBtn.style.bottom = '24px';
    }
  });
}

// Generador de prueba social creíble (determinístico)
function getProductStats(id) {
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);

  // Secuencia natural solicitada: 10, 25, 50, 75, 90, 100...
  const soldOptions = [10, 25, 50, 75, 90, 100, 120, 150];
  const sold = soldOptions[h % soldOptions.length];

  const ratings = [4, 4.5, 5, 4.5, 5]; // Probabilidad alta de 4.5 y 5
  const rating = ratings[h % ratings.length];

  // Microcopy persuasivo (solo en ~35% de los productos)
  let microcopy = null;
  if (h % 100 < 35) {
    const options = ["🔥 Más vendidos", "⚠️ Pocas unidades", "🚀 Vendidos esta semana"];
    microcopy = options[h % options.length];
  }

  return { sold, rating, microcopy };
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
  const hasDiscount = p.originalPrice && parseFloat(p.originalPrice) > parseFloat(price);
  const discountPct = hasDiscount ? Math.round((1 - price / p.originalPrice) * 100) : 0;
  const stats = getProductStats(p.id);

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
        <div class="color-option more-indicator" onclick="location.hash = '#/product/${p.id}'">
          +${extraCount}
        </div>
      ` : ''}
    </div>`;
  }

  return `
    <div class="product-image-container" onclick="location.hash = '#/product/${p.id}'" style="cursor:pointer;">
      ${badgeText ? `<div class="badge-campaign">${badgeText}</div>` : ''}
      ${mainImg ? `<img src="${mainImg}" alt="Comprar ${p.name} - Panda Venta" 
        ${isCritical ? 'fetchpriority="high"' : 'loading="lazy"'} 
        decoding="async" width="300" height="300" />` : '<span style="font-size:2rem">📦</span>'}
      ${pImages.length > 1 ? `<div class="image-count-badge">1/${pImages.length}</div>` : ''}
      ${hasDiscount ? `<div class="badge-discount-overlay">-${discountPct}%</div>` : ''}
    </div>
    <div class="product-info" onclick="location.hash = '#/product/${p.id}'" style="cursor:pointer;">
      ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
      <div class="product-title">${p.name} ${p.ref ? `<span style="font-size:0.7em;color:var(--text-muted)">[${p.ref}]</span>` : ''}</div>
      ${getShippingBadgesHTML(price)}
      
      <div class="product-social-proof">
        ${getStarsHTML(stats.rating)}
        <span class="social-sold">+${stats.sold} ventas</span>
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
        </div>
        <div class="qty-controls">
          ${cart[cartId] ? `
            <button class="btn-qty" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${cart[cartId]}</span>
            <button class="btn-qty" onclick="updateCart('${cartId}', 1)">+</button>
          ` : `<button class="btn-add ${hasDiscount ? 'btn-add-sale' : ''}" onclick="location.hash = '#/product/${p.id}'">VER DETALLES</button>`}
        </div>
      </div>
    </div>
  `;
}

function renderDiscountSection() {
  const discounted = products.filter(p => p.active && p.originalPrice && parseFloat(p.originalPrice) > parseFloat(getProductPrice(p)));
  const section = document.getElementById('discount-section');
  const grid = document.getElementById('discount-grid');
  if (!section || !grid) return;
  if (discounted.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  grid.innerHTML = discounted.map(p => {
    const pImages = p.images || (p.image ? [p.image] : []);
    const mainImg = pImages[0];
    const price = getProductPrice(p);
    const discountPct = Math.round((1 - price / p.originalPrice) * 100);
    return `
      <div class="discount-card">
        <div class="discount-card-img">
          ${mainImg ? `<img src="${mainImg}" alt="Comprar ${p.name} - Panda Venta" loading="lazy" decoding="async" />` : '<span style="font-size:1.5rem">📦</span>'}
          <div class="discount-pct-badge">-${discountPct}%</div>
        </div>
        <div class="discount-card-info">
          <div class="discount-card-name">${p.name}</div>
          <div class="discount-card-prices">
            <span class="discount-original">${settings.currency} ${parseFloat(p.originalPrice).toLocaleString('es-CO')}</span>
            <span class="discount-new">${settings.currency} ${parseFloat(price).toLocaleString('es-CO')}</span>
            ${isWholesaleMode ? '<span style="font-size:0.6rem; color:var(--success); font-weight:700; margin-left:4px;">(Por mayor)</span>' : ''}
          </div>
          <button class="discount-card-btn ${cart[p.id] ? 'in-cart' : ''}" onclick="updateCart('${p.id}',${cart[p.id] ? -cart[p.id] : 1})">
            ${cart[p.id] ? '✓ En carrito (' + cart[p.id] + ')' : '🛒 Lo quiero'}
          </button>
        </div>
      </div>
    `;
  }).join('');
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
  if (isWholesaleMode && change > 0 && current === 0) {
    next = Math.max(6, change);
  }
  if (isWholesaleMode && next < 6) {
    next = 0;
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
            <button class="btn-qty" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${q}</span>
            <button class="btn-qty" onclick="updateCart('${cartId}', 1)">+</button>
          </div>
          <div class="order-item-subtotal">${formatMoney(itemPrice * q)}</div>
        </div>
      </div>
    `;
  }).join('');
  els.orderTotalAmount.textContent = formatMoney(total);
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
window.openProductPage = function(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) {
    window.location.hash = '#/';
    return;
  }
  
  currentDetailProduct = p;
  currentDetailQty = isWholesaleMode ? 6 : 1;
  
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
  const hasDiscount = p.originalPrice && parseFloat(p.originalPrice) > parseFloat(price);
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
  
  // Social Proof stats
  const stats = getProductStats(p.id);
  safeText('detail-sold-count', `+${stats.sold} vendidos`);
  safeHTML('detail-stars', getStarsHTML(stats.rating));
  
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
            <div class="promo-desc">Envío GRATIS. Haz tu pedido en los próximos minutos para entrega HOY.</div>
          </div>
        `;
      } else {
        const nextDay = (day === 6 || day === 0) ? 'el lunes' : 'mañana';
        promoHTML = `
          <div class="promo-icon">🚀</div>
          <div class="promo-text-wrapper">
            <div class="promo-title">Envío GRATIS a Bogotá</div>
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
  
  let related = products.filter(p => p.active && p.id !== currentProduct.id);
  if (currentProduct.category) {
    related = related.filter(p => p.category === currentProduct.category);
  }
  
  related = related.slice(0, 4);
  
  if (related.length === 0) {
    related = products.filter(p => p.active && p.id !== currentProduct.id).slice(0, 4);
  }
  
  if (related.length === 0) {
    grid.parentElement.style.display = 'none';
    return;
  }
  
  grid.parentElement.style.display = 'block';
  grid.innerHTML = related.map(p => {
    return `<div class="product-card">${getProductHTML(p)}</div>`;
  }).join('');
}

function renderProductReviews(product) {
  const container = document.getElementById('detail-reviews-list');
  if (!container) return;
  
  let hash = 0;
  const str = String(product.id);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);
  
  const reviewers = [
    { name: 'Diana Moreno', city: 'Bogotá', date: 'Hace 2 días' },
    { name: 'Carlos Restrepo', city: 'Medellín', date: 'Hace 5 días' },
    { name: 'Andrés Mendoza', city: 'Cali', date: 'Hace 1 semana' },
    { name: 'Camila Torres', city: 'Barranquilla', date: 'Hace 1 semana' },
    { name: 'Valentina Gomez', city: 'Bucaramanga', date: 'Hace 2 semanas' },
    { name: 'Mateo Osorio', city: 'Manizales', date: 'Hace 3 semanas' }
  ];
  
  const comments = [
    '¡Excelente producto! Llegó super rápido en Bogotá y la calidad es increíble. Superó mis expectativas.',
    'Muy buen servicio. Tuve dudas con el envío y me atendieron super rápido por WhatsApp. El producto llegó en perfecto estado.',
    'Recomendado 100%. Relación calidad-precio inmejorable. Volveré a comprar sin duda.',
    'Me encantó. El empaque muy seguro y el producto funciona excelente. La atención al cliente fue de primera clase.',
    'Llegó rápido a mi ciudad y todo está tal cual la descripción. Es de muy buena calidad.'
  ];
  
  const selectedReviews = [];
  for (let i = 0; i < 3; i++) {
    const revIdx = (h + i) % reviewers.length;
    const commIdx = (h + i) % comments.length;
    const rating = (h + i) % 5 === 0 ? 4 : 5;
    
    selectedReviews.push({
      ...reviewers[revIdx],
      comment: comments[commIdx],
      rating
    });
  }
  
  container.innerHTML = selectedReviews.map(r => `
    <div class="review-item">
      <div class="review-header">
        <div class="review-user-info">
          <span class="review-username">${r.name}</span>
          <span class="review-user-badge">✓ Cliente verificado</span>
        </div>
        <span class="review-date">${r.date}</span>
      </div>
      <div class="review-rating">
        <span class="social-stars">${'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}</span>
        <span class="review-user-city">📍 ${r.city}</span>
      </div>
      <p class="review-comment">${r.comment}</p>
    </div>
  `).join('');
}

function handleRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#/product/')) {
    const productId = hash.replace('#/product/', '');
    openProductPage(productId);
  } else if (hash === '#/order') {
    switchView('order');
    renderOrderList();
  } else if (hash === '#/ticket') {
    switchView('ticket');
  } else {
    switchView('catalog');
  }
}

window.addEventListener('hashchange', handleRoute);

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
    selectedShippingOption = { price: 0, carrier: 'local', service: 'Envío Local', days: 'Hoy' };
    currentCalculatedShipping = 0;
    if (display) { display.textContent = 'GRATIS'; display.style.color = 'var(--success)'; }
    if (freeMsg) freeMsg.style.display = 'block';
    if (quoteBtn) quoteBtn.style.display = 'none';
    if (ticketBtn) ticketBtn.style.display = 'flex';
    return;
  }

  if (display) { display.textContent = 'Sin cotizar'; display.style.color = 'var(--text-muted)'; }
  if (quoteBtn) quoteBtn.style.display = 'block';
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
      selectedShippingOption = { price: 0, carrier: 'local', service: data.metodo_entrega || 'Envío Local', days: 'Hoy' };
      currentCalculatedShipping = 0;
      if (display) { display.textContent = 'GRATIS'; display.style.color = 'var(--success)'; }
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
    selectedShippingOption = { price: data.costo_envio || 0, carrier: 'respaldo', service: data.mensaje || 'Tarifa de respaldo', days: '3-7' };
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
  selectedShippingOption = { price: op.price, carrier: op.carrier, service: op.carrier_label || op.carrier, days: op.days };
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
    product: document.getElementById('view-product')
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
    switchView('order');
    renderOrderList();
  });
  on('btn-back-catalog', 'onclick', () => switchView('catalog'));
  on('btn-back-order', 'onclick', () => switchView('order'));
  
  // Product Detail Page listeners
  on('btn-back-catalog-product', 'onclick', () => {
    window.location.hash = '#/';
  });
  on('btn-detail-qty-minus', 'onclick', () => {
    if (currentDetailQty > 1) {
      currentDetailQty--;
      updateDetailQtyUI();
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
  on('btn-new-order', 'onclick', () => switchView('catalog'));

  let searchTimer;
  on('search-input', 'oninput', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderProducts, 150);
  });

  // ====== LISTENERS DE CIERRE (MODALES) ======
  on('btn-close-admin', 'onclick', () => {
    safeStyle('panel-admin', 'display', 'none');
    safeStyle('admin-overlay', 'display', 'none');
  });
  
  const overlay = document.getElementById('admin-overlay');
  if (overlay) overlay.onclick = () => {
    safeStyle('panel-admin', 'display', 'none');
    safeStyle('admin-overlay', 'display', 'none');
  };

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
    
    if (!name || !phone || !dept || !city || !address) {
      return showToast('Por favor completa los datos de envío');
    }
    if (!selectedShippingOption) {
      return showToast('Primero cotiza y elige tu opción de envío');
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
      channel: 'web'
    };

    try {
      const newRef = await push(ref(db, 'orders'), orderData);
      const ticketNum = 'PV-' + newRef.key.slice(-6).toUpperCase();
      
      // Enviar orden a la transportadora integrada (Mastershop) si aplica
      try {
        await fetch('/api/crear-orden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente: { nombre: customer.name, telefono: customer.phone },
            ciudad_destino: customer.city,
            departamento_destino: customer.dept,
            direccion_destino: customer.address + (customer.address2 ? ', ' + customer.address2 : ''),
            items: items
          })
        });
      } catch(e) { console.error('Error reportando la orden:', e); }

      safeText('ticket-store-name', settings.storeName || 'Panda Venta');
      safeText('ticket-number', ticketNum);
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
          const ticketEl = document.getElementById('ticket');
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
      cart = {};
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

  // ====== ADMIN ACCESS ======
  const openAdmin = async () => {
    const state = { db, products, settings, orders, cart, currentProductImages, viewerImages, viewerIndex };
    const utils = { formatMoney, showToast, switchView, safeSet, safeText, safeHTML, safeValue, safeStyle, compressImage, hashPassword, isBogota, getShippingCost };
    const { initAdmin } = await import('./admin.js');
    initAdmin(state, utils);
  };

  const triggerAdminAccess = async () => {
    if (settings.adminPasswordHash) {
      safeStyle('modal-login', 'display', 'flex');
    } else {
      openAdmin();
    }
  };

  on('btn-open-admin', 'onclick', triggerAdminAccess);

  on('btn-login-submit', 'onclick', async () => {
    const passInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');
    if (!passInput) return;
    const enteredHash = await hashPassword(passInput.value);
    if (enteredHash === settings.adminPasswordHash) {
      safeStyle('modal-login', 'display', 'none');
      if (errorMsg) errorMsg.style.display = 'none';
      passInput.value = '';
      openAdmin();
    } else {
      if (errorMsg) errorMsg.style.display = 'block';
      passInput.value = '';
    }
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

