// ====== FIREBASE MODULAR SDK ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set, push, update, remove
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
  apiKey: "AIzaSyBRmLWFyczGQzPNe8iv9dbkJa_v6sylmxw",
  authDomain: "todo-en-uno-cf51e.firebaseapp.com",
  databaseURL: "https://todo-en-uno-cf51e-default-rtdb.firebaseio.com",
  projectId: "todo-en-uno-cf51e",
  storageBucket: "todo-en-uno-cf51e.firebasestorage.app",
  messagingSenderId: "974474634176",
  appId: "1:974474634176:web:8651006d4cf7df1cff9e25"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ====== STATE ======
let products = [];
let settings = {
  storeName: 'Mi Tienda', tagline: 'Pedidos por WhatsApp', whatsapp: '',
  color: '#6c63ff', currency: 'COP', logo: '', adminPassword: '',
  paymentInfo: '', paymentQR: '', shippingCost: 0
};
let orders = [];
let cart = {};
let currentFilter = 'all';
let currentProductImages = [];
let viewerImages = [];
let viewerIndex = 0;
let views = {};
let els = {};
let selectedVariants = {}; // {productId: color}

// ====== UTILS ======
const compressImage = (base64Str, maxWidth = 600, quality = 0.5) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(maxWidth / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
  // SEO: noindex en vistas privadas — inyección segura sin afectar la lógica
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
function init() {
  onValue(ref(db, 'settings'), snap => {
    if (snap.exists()) { settings = snap.val(); applySettings(); }
  });

  onValue(ref(db, 'products'), snap => {
    const val = snap.val();
    if (!val) {
      products = [];
    } else if (Array.isArray(val)) {
      products = val.filter(p => p !== null);
    } else {
      products = Object.keys(val).map(key => ({ ...val[key], id: key }));
    }
    renderFilters();
    renderProducts();
    renderDiscountSection();
    updateCartUI();
    const panel = document.getElementById('panel-admin');
    if (panel && panel.style.display === 'flex') renderAdminProducts();
  });

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const contentEl = document.getElementById('tab-' + tab.dataset.tab);
      if (contentEl) contentEl.classList.add('active');
      // Refrescar datos al cambiar de tab
      if (tab.dataset.tab === 'reports') renderReports();
      if (tab.dataset.tab === 'orders') renderAdminOrders();
      if (tab.dataset.tab === 'products') renderAdminProducts();
    };
  });

}

function applySettings() {
  document.documentElement.style.setProperty('--primary', settings.color);
  const hex = (settings.color || '#6c63ff').replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
  document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  safeText('header-store-name', settings.storeName);
  safeText('header-store-tagline', settings.tagline);
  const logoHTML = settings.logo
    ? `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:contain;" />`
    : `<span class="logo-emoji">🛒</span>`;
  safeHTML('header-logo-area', logoHTML);
  const waBtn = document.getElementById('floating-wa-btn');
  if (waBtn) {
    if (settings.whatsapp) {
      waBtn.style.display = 'flex';
      waBtn.href = `https://wa.me/${settings.whatsapp}?text=Hola,%20tengo%20una%20pregunta.`;
    } else waBtn.style.display = 'none';
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
  let filtered = products.filter(p => p.active);
  const search = els.searchInput.value.toLowerCase().split(' ').filter(t => t);
  if (currentFilter !== 'all') filtered = filtered.filter(p => p.category === currentFilter);
  if (search.length > 0) {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.ref || ''} ${p.category || ''}`.toLowerCase();
      return search.every(term => text.includes(term));
    });
  }
  if (filtered.length === 0) {
    container.style.display = 'none'; emptyState.style.display = 'flex'; return;
  }
  container.style.display = 'grid'; emptyState.style.display = 'none';
  if (typeof renderCampaign === 'function') renderCampaign();
  if (typeof renderDiscountSection === 'function') renderDiscountSection();
  const countEl = document.getElementById('products-count');
  if (countEl) countEl.textContent = filtered.length + ' artículo' + (filtered.length !== 1 ? 's' : '');
  container.innerHTML = '';
  let currentIndex = 0;
  const batchSize = 10;
  const renderNextBatch = () => {
    const batch = filtered.slice(currentIndex, currentIndex + batchSize);
    batch.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = getProductHTML(p);
      container.appendChild(card);
    });
    currentIndex += batchSize;
    if (currentIndex < filtered.length) productObserver.observe(container.lastElementChild);
  };
  const productObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) { productObserver.unobserve(entries[0].target); renderNextBatch(); }
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

function setUserLocation(loc) {
  userLocation = loc;
  localStorage.setItem('user_location', loc);
  renderProducts(); // Re-render badges smoothly
}
window.setUserLocation = setUserLocation;

// ====== LÓGICA DE WHATSAPP FLOTANTE ======
function updateWAButtonPosition() {
  const waBtn = document.getElementById('global-wa-btn');
  const cartBar = document.getElementById('cart-bar');
  if (!waBtn) return;

  if (cartBar && cartBar.style.display !== 'none') {
    const height = cartBar.offsetHeight || 70;
    waBtn.style.bottom = (height + 24) + 'px';
  } else {
    waBtn.style.bottom = '24px';
  }
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

function getProductHTML(p, badgeText = null) {
  const pImages = p.images || (p.image ? [p.image] : []);
  const mainImg = pImages[0];
  const hasDiscount = p.originalPrice && parseFloat(p.originalPrice) > parseFloat(p.price);
  const discountPct = hasDiscount ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const stats = getProductStats(p.id);

  const hasVariants = p.variants && p.variants.length > 0;
  const selectedColor = selectedVariants[p.id] || (hasVariants ? p.variants[0].color : null);
  
  // Si tiene variantes, el cartId es "prodId:color", sino es solo "prodId"
  const cartId = hasVariants ? `${p.id}:${selectedColor}` : p.id;

  let colorSelectorHTML = '';
  if (hasVariants) {
    colorSelectorHTML = `<div class="color-selector">
      ${p.variants.map(v => `
        <div class="color-option ${selectedColor === v.color ? 'active' : ''} ${v.stock <= 0 ? 'out-of-stock' : ''}" 
             onclick="window.selectColor('${p.id}', '${v.color}')">
          ${v.color}
        </div>
      `).join('')}
    </div>`;
  }

  return `
    <div class="product-image-container" ${mainImg ? `onclick="openImageModal('${p.id}')"` : ''} style="cursor:pointer;">
      ${badgeText ? `<div class="badge-campaign">${badgeText}</div>` : ''}
      ${mainImg ? `<img src="${mainImg}" alt="Comprar ${p.name} - Todo en Uno Bogotá" loading="lazy" />` : '<span style="font-size:2rem">📦</span>'}
      ${pImages.length > 1 ? `<div class="image-count-badge">1/${pImages.length}</div>` : ''}
      ${hasDiscount ? `<div class="badge-discount-overlay">-${discountPct}%</div>` : ''}
    </div>
    <div class="product-info">
      ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
      <div class="product-title">${p.name} ${p.ref ? `<span style="font-size:0.7em;color:var(--text-muted)">[${p.ref}]</span>` : ''}</div>
      ${getShippingBadgesHTML(p.price)}
      
      <div class="product-social-proof">
        ${getStarsHTML(stats.rating)}
        <span class="social-sold">+${stats.sold} ventas</span>
        <span class="social-verified">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
          Satisfechos
        </span>
      </div>
      ${stats.microcopy ? `<div class="microcopy-badge">${stats.microcopy}</div>` : ''}

      ${colorSelectorHTML}

      <div class="product-bottom-section">
        <div class="product-price">
          ${hasDiscount ? `<span class="price-original">${settings.currency} ${parseFloat(p.originalPrice).toLocaleString('es-CO')}</span>` : ''}
          <div style="display:flex; align-items: baseline; gap: 2px;">
            <span class="price-currency">${settings.currency}</span>
            <span class="price-amount ${hasDiscount ? 'price-sale' : ''}">${parseFloat(p.price).toLocaleString('es-CO')}</span>
          </div>
        </div>
        <div class="qty-controls">
          ${cart[cartId] ? `
            <button class="btn-qty" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${cart[cartId]}</span>
            <button class="btn-qty" onclick="updateCart('${cartId}', 1)">+</button>
          ` : `<button class="btn-add ${hasDiscount ? 'btn-add-sale' : ''}" onclick="updateCart('${cartId}', 1); setWAProductContext('${p.name.replace(/'/g, "\\'")}', '${p.price}', ${selectedColor ? `'${selectedColor}'` : 'null'})">LO QUIERO</button>`}
        </div>
      </div>
    </div>
  `;
}

function renderDiscountSection() {
  const discounted = products.filter(p => p.active && p.originalPrice && parseFloat(p.originalPrice) > parseFloat(p.price));
  const section = document.getElementById('discount-section');
  const grid = document.getElementById('discount-grid');
  if (!section || !grid) return;
  if (discounted.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  grid.innerHTML = discounted.map(p => {
    const pImages = p.images || (p.image ? [p.image] : []);
    const mainImg = pImages[0];
    const discountPct = Math.round((1 - p.price / p.originalPrice) * 100);
    return `
      <div class="discount-card">
        <div class="discount-card-img">
          ${mainImg ? `<img src="${mainImg}" alt="Comprar ${p.name} - Todo en Uno Bogotá" loading="lazy" />` : '<span style="font-size:1.5rem">📦</span>'}
          <div class="discount-pct-badge">-${discountPct}%</div>
        </div>
        <div class="discount-card-info">
          <div class="discount-card-name">${p.name}</div>
          <div class="discount-card-prices">
            <span class="discount-original">${settings.currency} ${parseFloat(p.originalPrice).toLocaleString('es-CO')}</span>
            <span class="discount-new">${settings.currency} ${parseFloat(p.price).toLocaleString('es-CO')}</span>
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
  const variantColor = parts[1];
  
  const p = products.find(prod => prod.id === productId);
  const current = cart[cartId] || 0;
  const next = current + change;
  
  // Validar stock
  if (change > 0) {
    if (variantColor) {
      const v = p.variants.find(v => v.color === variantColor);
      if (v && v.stock !== undefined && v.stock !== '' && next > v.stock) {
        showToast(`Solo quedan ${v.stock} de color ${variantColor}`); return;
      }
    } else {
      if (p.stock !== undefined && p.stock !== '' && next > p.stock) {
        showToast(`Solo quedan ${p.stock} unidades`); return;
      }
    }
  }
  
  if (next <= 0) delete cart[cartId]; else cart[cartId] = next;
  updateCartUI();
  renderProducts();
  if (views.order && views.order.classList.contains('active')) renderOrderList();
}

function updateCartUI() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = Object.entries(cart).reduce((t, [cartId, q]) => {
    const productId = cartId.split(':')[0];
    const p = products.find(x => x.id === productId);
    return t + (p ? p.price * q : 0);
  }, 0);
  if (count > 0) {
    els.cartBar.style.display = 'block';
    els.cartCount.textContent = count;
    els.cartTotal.textContent = formatMoney(total);
  } else {
    els.cartBar.style.display = 'none';
  }
  updateWAButtonPosition();
}

function renderOrderList() {
  const total = Object.entries(cart).reduce((t, [cartId, q]) => {
    const productId = cartId.split(':')[0];
    const p = products.find(x => x.id === productId);
    return t + (p ? p.price * q : 0);
  }, 0);
  els.orderList.innerHTML = Object.entries(cart).map(([cartId, q]) => {
    const parts = cartId.split(':');
    const productId = parts[0];
    const color = parts[1];
    const p = products.find(x => x.id === productId);
    if (!p) return '';
    const itemName = color ? `${p.name} (${color})` : p.name;
    return `
      <div class="order-item-row">
        <div class="order-item-info">
          <div class="order-item-name">${itemName}</div>
          <div class="order-item-price-unit">${formatMoney(p.price)} x ${q}</div>
        </div>
        <div class="order-item-actions">
          <div class="qty-controls small">
            <button class="btn-qty" onclick="updateCart('${cartId}', -1)">-</button>
            <span class="qty-display">${q}</span>
            <button class="btn-qty" onclick="updateCart('${cartId}', 1)">+</button>
          </div>
          <div class="order-item-subtotal">${formatMoney(p.price * q)}</div>
        </div>
      </div>
    `;
  }).join('');
  els.orderTotalAmount.textContent = formatMoney(total);
  if (Object.keys(cart).length === 0) switchView('catalog');
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

// ====== ADMIN ======
function openAdmin() {
  const panel = document.getElementById('panel-admin');
  if (panel) panel.style.display = 'flex';
  if (!window.ordersListenerAttached) {
    window.ordersListenerAttached = true;
    onValue(ref(db, 'orders'), snap => {
      const val = snap.val();
      orders = val ? Object.keys(val).map(key => ({ ...val[key], id: key })).reverse() : [];
      renderAdminOrders();
      renderReports();
    });
  }
  renderAdminProducts();
  loadSettingsForm();
}

function renderAdminProducts() {
  const list = document.getElementById('admin-products-list');
  if (!list) return;
  const search = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  let filtered = search
    ? products.filter(p => (p.name && p.name.toLowerCase().includes(search)) || (p.ref && p.ref.toLowerCase().includes(search)))
    : products;
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay productos.</div>';
    return;
  }
  list.innerHTML = filtered.map(p => `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">
        ${(p.images && p.images[0]) || p.image
      ? `<img src="${(p.images && p.images[0]) || p.image}" loading="lazy" onerror="this.style.display='none'" />`
      : '📦'}
      </div>
      <div class="admin-product-info">
        <div class="admin-product-title">
          ${p.name || 'Sin nombre'}
          ${!p.active ? '<span class="badge-inactive">Oculto</span>' : ''}
        </div>
        <div class="admin-product-price">${formatMoney(p.price || 0)}</div>
      </div>
    </div>
  `).join('');
}

function renderAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (!list) return;
  if (!orders || orders.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay pedidos.</div>';
    return;
  }
  const channelLabel = { web: '🌐 Web', whatsapp: '💬 WhatsApp', mercado_libre: '🛒 ML' };
  list.innerHTML = orders.map(o => {
    const ch = o.channel || 'web';
    const profit = (o.total || 0) - (o.totalCost || 0);
    const hasShipping = o.shippingValue && o.shippingValue > 0;
    return `
    <div class="admin-order-card ${o.status || ''}">
      <div class="admin-order-header">
        <span class="admin-order-id">#${(o.id || '').slice(-6)}</span>
        <span class="channel-badge ${ch}">${channelLabel[ch] || ch}</span>
        <span class="admin-order-date">${o.timestamp ? new Date(o.timestamp).toLocaleString('es-CO') : '---'}</span>
      </div>
      <div class="admin-order-customer">${o.customer?.name || 'Cliente anónimo'}</div>
      <div class="admin-order-items" style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
        <span>${(o.items || []).length} producto${(o.items || []).length !== 1 ? 's' : ''}</span>
        ${o.customer?.city ? `<span style="color:var(--text-muted);">📍 ${o.customer.city}</span>` : ''}
        ${o.customer?.phone ? `<span style="color:var(--text-muted);">📱 ${o.customer.phone}</span>` : ''}
      </div>
      <div class="admin-order-total" style="display:flex;gap:0.75rem;align-items:baseline;flex-wrap:wrap;">
        <span>${formatMoney(o.total || 0)}</span>
        ${hasShipping ? `<span style="font-size:0.75rem;color:var(--text-muted);font-weight:500;">🚚 envío: ${formatMoney(o.shippingValue)}</span>` : ''}
        ${o.totalCost ? `<span style="font-size:0.75rem;color:var(--success);font-weight:700;">ganancia: ${formatMoney(profit)}</span>` : ''}
      </div>
      <div class="admin-order-actions">
        ${o.status !== 'completed' && o.status !== 'cancelled' ? `
          <button class="btn-order-confirm" onclick="confirmOrder('${o.id}')">✅ Completar</button>
          <button class="btn-order-cancel" onclick="cancelOrder('${o.id}')">❌ Anular</button>
        ` : `
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="text-transform:uppercase;font-weight:bold;font-size:0.82rem; ${o.status === 'completed' ? 'color:var(--success)' : 'color:var(--danger)'}">
              ${o.status === 'completed' ? '✅ Completado' : '❌ Anulado'}
            </span>
            ${o.status === 'completed' && o.source === 'manual_admin' ? `
              <button class="btn-order-cancel" style="padding:0.2rem 0.5rem; font-size:0.75rem;" onclick="cancelOrder('${o.id}')">❌ Anular</button>
            ` : ''}
          </div>
        `}
        <button class="btn-order-download" onclick="downloadOrderTicket('${o.id}')">📥 Ticket</button>
      </div>
    </div>
  `}).join('');
}


function renderReports() {
  const timeframe = document.getElementById('report-timeframe')?.value;
  const now = Date.now();
  let filtered = orders;
  if (timeframe && timeframe !== 'all') {
    const ms = { day: 86400000, week: 604800000, month: 2592000000, semester: 15552000000 }[timeframe];
    filtered = orders.filter(o => now - o.timestamp < ms);
  }
  const completed = filtered.filter(o => o.status === 'completed');
  const pending = filtered.filter(o => !o.status || o.status === 'pending');
  const cancelled = filtered.filter(o => o.status === 'cancelled');

  const sum = (arr) => arr.reduce((t, o) => t + (o.total || 0), 0);
  const profit = (arr) => arr.reduce((t, o) => t + ((o.total || 0) - (o.totalCost || 0)), 0);

  // ── KPIs principales ─────────────────────────────────────────────
  safeText('report-revenue-total', formatMoney(sum(completed)));
  safeText('report-profit-total', formatMoney(profit(completed)));
  safeText('report-revenue-pending', formatMoney(sum(pending)));

  // KPI: total órdenes del período + tasa de conversión
  const totalOrders = filtered.length;
  safeText('report-orders-count', totalOrders);
  const convEl = document.getElementById('report-conversion-rate');
  if (convEl) {
    if (totalOrders > 0) {
      const pct = Math.round((completed.length / totalOrders) * 100);
      convEl.textContent = `${pct}% conversión`;
      convEl.style.color = pct >= 60 ? 'var(--success)' : pct >= 30 ? 'var(--warn)' : 'var(--danger)';
    } else {
      convEl.textContent = '— conversión';
      convEl.style.color = '';
    }
  }

  // ── Alerta de stock bajo ──────────────────────────────────────────
  const alertEl = document.getElementById('report-low-stock-alert');
  if (alertEl) {
    const lowStock = products.filter(p =>
      p.active && p.stock !== undefined && p.stock !== '' && Number(p.stock) <= (p.minStock || 3)
    );
    if (lowStock.length > 0) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = `
        <details class="alert-low-stock">
          <summary style="font-weight:bold; cursor:pointer; outline:none; display:flex; align-items:center; gap:0.3rem;">
            ⚠️ ${lowStock.length} producto${lowStock.length > 1 ? 's' : ''} con stock bajo
          </summary>
          <div style="margin-top:0.75rem;">
            ${lowStock.map(p => `<span class="stock-badge">${p.name} (${p.stock} ${p.unit || 'uds'})</span>`).join('')}
          </div>
        </details>`;
    } else {
      alertEl.style.display = 'none';
    }
  }

  // ── Barras de canal ───────────────────────────────────────────────
  const channelTotals = { web: 0, whatsapp: 0, mercado_libre: 0 };
  completed.forEach(o => {
    const ch = o.channel || 'web';
    channelTotals[ch] = (channelTotals[ch] || 0) + (o.total || 0);
  });
  const channelMax = Math.max(...Object.values(channelTotals), 1);
  const channelMeta = {
    web: { label: '🌐 Web', color: 'var(--primary)' },
    whatsapp: { label: '💬 WhatsApp', color: '#25D366' },
    mercado_libre: { label: '🛒 Mercado Libre', color: '#f59e0b' }
  };
  const chBarsEl = document.getElementById('report-channel-bars');
  if (chBarsEl) {
    const anyData = Object.values(channelTotals).some(v => v > 0);
    if (!anyData) {
      chBarsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0">Sin ventas completadas aún</div>';
    } else {
      chBarsEl.innerHTML = Object.entries(channelTotals).map(([ch, val]) => {
        const m = channelMeta[ch];
        const pct = ((val / channelMax) * 100).toFixed(1);
        return `
          <div class="channel-bar-row">
            <span class="channel-bar-label">${m.label}</span>
            <div class="channel-bar-track">
              <div class="channel-bar-fill" style="width:${pct}%;background:${m.color}"></div>
            </div>
            <span class="channel-bar-val">${val > 0 ? formatMoney(val) : '—'}</span>
          </div>`;
      }).join('');
    }
  }

  // ── Resumen por estado ────────────────────────────────────────────
  const statusEl = document.getElementById('report-status-summary');
  if (statusEl) {
    const statuses = [
      { label: '✅ Completados', count: completed.length, bg: '#d1fae5', color: '#065f46' },
      { label: '⏳ Pendientes', count: pending.length, bg: '#fef3c7', color: '#713f12' },
      { label: '❌ Cancelados', count: cancelled.length, bg: '#fee2e2', color: '#991b1b' }
    ];
    statusEl.innerHTML = statuses.map(s => `
      <div style="background:${s.bg};color:${s.color};border-radius:var(--r-sm);
                  padding:0.4rem 0.75rem;font-size:0.78rem;font-weight:700;">
        ${s.label}: ${s.count}
      </div>`).join('');
  }

  // ── Listas de productos ───────────────────────────────────────────
  const _countItems = (arr) => {
    const counts = {};
    arr.forEach(o => (o.items || []).forEach(i => {
      if (!i || !i.name) return;
      counts[i.name] = (counts[i.name] || 0) + (i.qty || 1);
    }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  };

  const _renderProductList = (listId, entries, emptyMsg, badgeClass) => {
    const el = document.getElementById(listId);
    if (!el) return;
    if (!entries.length) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0">${emptyMsg}</div>`;
      return;
    }
    el.innerHTML = entries.map(([name, qty], i) =>
      `<div class="report-item">
        <span style="display:flex;align-items:center;gap:0.4rem;">
          <span style="font-size:0.65rem;font-weight:800;color:var(--text-muted);width:16px">${i + 1}.</span>
          ${name}
        </span>
        <span class="report-qty ${badgeClass}">${qty} uds</span>
      </div>`
    ).join('');
  };

  _renderProductList('report-most-sold', _countItems(completed), 'Sin ventas completadas aún', '');
  _renderProductList('report-most-cancelled', _countItems(cancelled), 'Sin cancelaciones 🎉', 'report-qty-danger');

  // Sin ventas
  const soldNames = new Set(completed.flatMap(o => (o.items || []).map(i => i.name).filter(Boolean)));
  const noSalesEl = document.getElementById('report-no-sales');
  if (noSalesEl) {
    const unsold = products.filter(p => p.active && !soldNames.has(p.name));
    noSalesEl.innerHTML = !unsold.length
      ? '<div style="color:var(--success);font-size:0.82rem;padding:0.5rem 0">¡Todos los productos han vendido! 🎉</div>'
      : unsold.map(p =>
        `<div class="report-item">
            <span>${p.name}${p.category ? ` <small style="color:var(--text-muted)">(${p.category})</small>` : ''}</span>
            <span class="report-qty report-qty-danger">0 uds</span>
          </div>`
      ).join('');
  }
}


function loadSettingsForm() {
  safeValue('settings-store-name', settings.storeName || '');
  safeValue('settings-tagline', settings.tagline || '');
  safeValue('settings-whatsapp', settings.whatsapp || '');
  const colorEl = document.getElementById('settings-color');
  if (colorEl) colorEl.value = settings.color || '#6c63ff';
  const currencyEl = document.getElementById('settings-currency');
  if (currencyEl) currencyEl.value = settings.currency || 'COP';
  safeValue('settings-payment-info', settings.paymentInfo || '');
  safeValue('settings-admin-password', ''); // Nunca mostrar la contraseña guardada
  safeValue('settings-shipping-cost', settings.shippingCost || 0);

  // ── Campaña ───────────────────────────────────────────────────────
  const campCheck = document.getElementById('settings-camp-enabled');
  if (campCheck) campCheck.checked = settings.activeCampaign?.enabled || false;
  safeValue('settings-camp-title', settings.activeCampaign?.title || '');
  safeValue('settings-camp-tag', settings.activeCampaign?.tag || '');
  safeValue('settings-camp-badge', settings.activeCampaign?.badgeText || '');

  // ── Logo ──────────────────────────────────────────────────────────
  if (settings.logo) {
    safeSet('settings-logo-preview', 'src', settings.logo);
    safeStyle('settings-logo-preview', 'display', 'block');
    safeStyle('logo-upload-placeholder', 'display', 'none');
  } else {
    safeStyle('settings-logo-preview', 'display', 'none');
    safeStyle('logo-upload-placeholder', 'display', 'flex');
  }
  // ── QR de pago (BUG FIX) ─────────────────────────────────────────
  if (settings.paymentQR) {
    safeSet('settings-qr-preview', 'src', settings.paymentQR);
    safeStyle('settings-qr-preview', 'display', 'block');
    safeStyle('qr-upload-placeholder', 'display', 'none');
  } else {
    safeStyle('settings-qr-preview', 'display', 'none');
    safeStyle('qr-upload-placeholder', 'display', 'flex');
  }
}

function openProductModal(id = null) {
  window.currentEditId = id;
  currentProductImages = [];
  const p = id ? products.find(x => x.id === id) : null;
  if (p) {
    currentProductImages = p.images ? [...p.images] : (p.image ? [p.image] : []);
  }
  safeStyle('modal-product', 'display', 'flex');
  safeText('modal-product-title', p ? 'Editar Producto' : 'Nuevo Producto');
  safeValue('product-name', p ? p.name : '');
  safeValue('product-ref', p ? (p.ref || '') : '');
  safeValue('product-category', p ? (p.category || '') : '');
  safeValue('product-tags', p ? (p.tags || '') : '');
  safeValue('product-price', p ? parseInt(p.price).toLocaleString('es-CO') : '');
  safeValue('product-original-price', (p && p.originalPrice) ? parseInt(p.originalPrice).toLocaleString('es-CO') : '');
  safeValue('product-cost', (p && p.cost) ? parseInt(p.cost).toLocaleString('es-CO') : '');
  safeValue('product-stock', p ? (p.stock || '') : '');
  
  // Lógica de variantes
  const hasVariants = p && p.variants && p.variants.length > 0;
  const typeRadios = document.getElementsByName('product-type');
  if (typeRadios.length > 0) {
    typeRadios[0].checked = !hasVariants;
    typeRadios[1].checked = hasVariants;
  }
  
  const variantsList = document.getElementById('variants-list');
  if (variantsList) {
    variantsList.innerHTML = '';
    if (hasVariants) {
      p.variants.forEach(v => addVariantRow(v.color, v.stock));
    }
  }
  toggleProductTypeFields();

  const unitEl = document.getElementById('product-unit');
  if (unitEl) unitEl.value = p ? (p.unit || 'und') : 'und';
  safeValue('product-description', p ? (p.description || '') : '');
  const activeEl = document.getElementById('product-active');
  if (activeEl) activeEl.checked = p ? p.active : true;
  renderProductImagePreview();
  safeStyle('btn-delete-product', 'display', p ? 'block' : 'none');
}

window.toggleProductTypeFields = () => {
  const type = document.querySelector('input[name="product-type"]:checked')?.value;
  const groupStock = document.getElementById('group-stock-simple');
  const groupVariants = document.getElementById('group-product-variants');
  if (type === 'variants') {
    if (groupStock) groupStock.style.display = 'none';
    if (groupVariants) groupVariants.style.display = 'block';
    const list = document.getElementById('variants-list');
    if (list && list.children.length === 0) addVariantRow();
  } else {
    if (groupStock) groupStock.style.display = 'block';
    if (groupVariants) groupVariants.style.display = 'none';
  }
};

window.addVariantRow = (color = '', stock = '') => {
  const list = document.getElementById('variants-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.innerHTML = `
    <input type="text" class="field-input var-color" placeholder="Color" value="${color}" style="flex:2">
    <input type="number" class="field-input var-stock" placeholder="Stock" value="${stock}" style="flex:1">
    <button type="button" class="btn-remove-variant" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(row);
};

function renderProductImagePreview() {
  const container = document.getElementById('product-images-list');
  const trigger = document.getElementById('btn-trigger-upload');
  if (!container || !trigger) return;
  container.innerHTML = '';
  currentProductImages.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'multi-image-item';
    div.innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover;" />
                     <button class="btn-remove-image" onclick="removeProductImage(${idx})">×</button>`;
    container.appendChild(div);
  });
  if (currentProductImages.length < 5) container.appendChild(trigger);
}

function deleteProduct(id) {
  if (!id) return;
  const idx = products.findIndex(p => p.id === id);
  if (idx !== -1) products.splice(idx, 1);
  remove(ref(db, `products/${id}`));
  renderAdminProducts();
}

// ====== GLOBAL WINDOW BINDINGS ======
window.updateCart = updateCart;
window.openProductModal = openProductModal;
window.openImageModal = openImageModal;
window.deleteProduct = deleteProduct;
window.openAdmin = openAdmin;

window.closeAdmin = () => {
  safeStyle('panel-admin', 'display', 'none');
};

window.closeModal = (id) => {
  safeStyle(id, 'display', 'none');
  if (id === 'modal-product') {
    window.currentEditId = null;
    currentProductImages = [];
  }
};

window.closeImageModal = () => safeStyle('image-viewer-modal', 'display', 'none');

window.toggleDesc = (e, id) => {
  e.stopPropagation();
  const desc = document.getElementById(`desc-${id}`);
  if (desc) {
    desc.classList.toggle('collapsed');
    e.target.textContent = desc.classList.contains('collapsed') ? 'Ver más' : 'Ver menos';
  }
};

window.setViewerIndex = (idx) => { viewerIndex = idx; renderViewer(); };
window.removeProductImage = (idx) => { currentProductImages.splice(idx, 1); renderProductImagePreview(); };
window.confirmOrder = async (id) => {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  // Marcar como completado con timestamp
  await update(ref(db, `orders/${id}`), { status: 'completed', completedAt: Date.now() });
  // Auto-descontar stock de cada producto vendido
  const stockUpdates = {};
  (o.items || []).forEach(item => {
    if (!item.id) return;
    const prod = products.find(p => p.id === item.id);
    if (!prod) return;

    if (item.variantColor) {
      // Es una variante
      const vIdx = (prod.variants || []).findIndex(v => v.color === item.variantColor);
      if (vIdx !== -1) {
        const newStock = Math.max(0, Number(prod.variants[vIdx].stock || 0) - Number(item.qty || 1));
        stockUpdates[`products/${item.id}/variants/${vIdx}/stock`] = newStock;
      }
    } else {
      // Es producto simple
      if (prod.stock !== undefined && prod.stock !== '') {
        const newStock = Math.max(0, Number(prod.stock) - Number(item.qty || 1));
        stockUpdates[`products/${item.id}/stock`] = newStock;
      }
    }
  });
  if (Object.keys(stockUpdates).length > 0) {
    await update(ref(db), stockUpdates);
    showToast('Pedido completado ✅ Stock actualizado');
  } else {
    showToast('Pedido completado ✅');
  }
};
window.cancelOrder = (id) => {
  const o = orders.find(x => x.id === id);
  const nombre = o?.customer?.name || 'este pedido';
  const total = o ? formatMoney(o.total) : '';
  if (confirm(`¿Anular el pedido de ${nombre} por ${total}?\n\nEsta acción no se puede deshacer.`)) {
    update(ref(db, `orders/${id}`), { status: 'cancelled' });
    showToast('Pedido anulado');
  }
};

window.downloadOrderTicket = async (id) => {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  // Crear ticket temporal en un div oculto
  const ticketNum = 'AG-' + id.slice(-6).toUpperCase();
  const isFreeDept = isBogota(o.customer?.dept);
  const envioTexto = isFreeDept ? 'GRATIS' : 'Por Calcular';
  const envioColor = isFreeDept ? '#25D366' : '#e67e22';

  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;width:360px;padding:24px;font-family:monospace;font-size:13px;color:#1a1a1a;';
  div.innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-size:1.3rem;font-weight:800;letter-spacing:1px;">${settings.storeName}</div>
      <div style="font-size:0.75rem;color:#888;margin-top:4px;">${ticketNum} &nbsp;|&nbsp; ${new Date(o.timestamp).toLocaleString('es-CO')}</div>
    </div>
    <hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">
    <div style="margin-bottom:8px;">
      <div><b>Cliente:</b> ${o.customer?.name || '—'}</div>
      <div><b>Celular:</b> ${o.customer?.phone || '—'}</div>
      <div><b>Ciudad:</b> ${o.customer?.city || '—'} (${o.customer?.dept || '—'})</div>
      <div><b>Barrio:</b> ${o.customer?.barrio || '—'}</div>
      <div><b>Dir:</b> ${o.customer?.address || '—'}</div>
      ${o.customer?.address2 ? `<div><b>Detalle:</b> ${o.customer.address2}</div>` : ''}
    </div>
    <hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">
    ${(o.items || []).map(i => `
      <div style="display:flex;justify-content:space-between;">
        <span>${i.name} x${i.qty}</span>
        <span>${formatMoney(i.price * i.qty)}</span>
      </div>`).join('')}
    <hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">
    <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#555;">
      <span>🚚 Costo de Envío</span>
      <span style="font-weight:600;color:${envioColor};">${envioTexto}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1rem;margin-top:8px;">
      <span>TOTAL</span>
      <span>${formatMoney(o.total || 0)}</span>
    </div>
    ${o.customer?.notes ? `
    <hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">
    <div style="font-size:0.85rem;color:#555;">${o.customer.notes}</div>` : ''}
    ${settings.paymentInfo ? `
    <hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">
    <div style="text-align:center;font-size:0.8rem;">
      <div style="font-weight:600;margin-bottom:4px;">PAGA AQUÍ:</div>
      <div>${settings.paymentInfo}</div>
    </div>` : ''}
  `;
  document.body.appendChild(div);

  try {
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const link = document.createElement('a');
    link.download = `pedido-${ticketNum}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Ticket descargado ✅');
  } catch (err) {
    showToast('Error al generar ticket');
    console.error(err);
  } finally {
    document.body.removeChild(div);
  }
};
window.copyPaymentInfo = () => {
  if (settings.paymentInfo) {
    navigator.clipboard.writeText(settings.paymentInfo);
    showToast('Copiado al portapapeles');
  }
};

// ====== SHIPPING ======
function isBogota(dept) {
  return dept === 'Bogotá D.C.';
}

function getShippingCost(dept) {
  if (!dept) return null;
  if (isBogota(dept)) return 0;
  return 'por_calcular';
}

function updateShippingDisplay(dept) {
  const display = document.getElementById('shipping-cost-display');
  const freeMsg = document.getElementById('shipping-free-msg');
  if (!display) return;
  if (!dept) {
    display.textContent = '—';
    display.style.color = 'var(--primary)';
    if (freeMsg) freeMsg.style.display = 'none';
    return;
  }
  if (isBogota(dept)) {
    display.textContent = 'GRATIS';
    display.style.color = '#25D366';
    if (freeMsg) freeMsg.style.display = 'block';
  } else {
    display.textContent = 'Por Calcular';
    display.style.color = '#f59e0b';
    if (freeMsg) freeMsg.style.display = 'none';
  }
}

// ====== DOM READY ======
document.addEventListener('DOMContentLoaded', () => {

  // Inicializar referencias DOM
  views = {
    catalog: document.getElementById('view-catalog'),
    order: document.getElementById('view-order'),
    ticket: document.getElementById('view-ticket')
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

  // ====== LISTENERS ======
  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
  };

  // Panel admin
  on('btn-close-admin', 'onclick', () => window.closeAdmin());
  const overlay = document.getElementById('admin-overlay');
  if (overlay) overlay.onclick = () => window.closeAdmin();

  // Modal login
  on('btn-close-login-modal', 'onclick', () => {
    safeStyle('modal-login', 'display', 'none');
    safeValue('login-password', '');
    safeStyle('login-error', 'display', 'none');
  });

  // Modal producto
  on('btn-close-product-modal', 'onclick', () => window.closeModal('modal-product'));

  // Navegación
  on('btn-view-order', 'onclick', () => { switchView('order'); renderOrderList(); });
  on('btn-back-catalog', 'onclick', () => switchView('catalog'));
  on('btn-back-order', 'onclick', () => switchView('order'));
  on('btn-new-order', 'onclick', () => switchView('catalog'));

  // Descargar ticket
  on('btn-download-ticket', 'onclick', async () => {
    const ticket = document.getElementById('ticket-card');
    const btn = document.getElementById('btn-download-ticket');
    if (!ticket || !btn) return;
    const actions = document.querySelector('.ticket-actions');
    const header = document.querySelector('#view-ticket .page-header');
    if (actions) actions.style.visibility = 'hidden';
    if (header) header.style.visibility = 'hidden';
    btn.textContent = 'Generando...';
    btn.disabled = true;
    try {
      const canvas = await html2canvas(ticket, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      const link = document.createElement('a');
      const ticketNum = document.getElementById('ticket-number')?.textContent || 'ticket';
      link.download = `pedido-${ticketNum}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Ticket descargado ✅');
    } catch (err) {
      showToast('Error al generar imagen');
    } finally {
      if (actions) actions.style.visibility = '';
      if (header) header.style.visibility = '';
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar ticket`;
      btn.disabled = false;
    }
  });

  // Abrir admin
  on('btn-open-admin', 'onclick', () => {
    if (settings.adminPasswordHash) {
      safeStyle('modal-login', 'display', 'flex');
    } else {
      openAdmin();
    }
  });

  // Logo: triple clic o pulsación larga
  let logoClicks = 0, logoTimer, logoPressTimer;
  const triggerAdminAccess = () => {
    if (settings.adminPasswordHash) safeStyle('modal-login', 'display', 'flex');
    else openAdmin();
  };
  const logoEl = document.getElementById('header-logo-area');
  if (logoEl) {
    logoEl.onclick = () => {
      logoClicks++;
      clearTimeout(logoTimer);
      if (logoClicks === 3) { logoClicks = 0; triggerAdminAccess(); }
      else logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
    };
    logoEl.onmousedown = logoEl.ontouchstart = () => {
      logoPressTimer = setTimeout(() => { triggerAdminAccess(); showToast('Acceso administrativo'); }, 2000);
    };
    logoEl.onmouseup = logoEl.onmouseleave = logoEl.ontouchend = () => clearTimeout(logoPressTimer);
  }

  // Login
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

  // Subir imágenes producto
  on('btn-trigger-upload', 'onclick', () => document.getElementById('product-file-input')?.click());
  on('product-file-input', 'onchange', async (e) => {
    const files = Array.from(e.target.files).slice(0, 5 - currentProductImages.length);
    const newImages = await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async (ev) => resolve(await compressImage(ev.target.result));
      reader.readAsDataURL(file);
    })));
    newImages.forEach(img => { if (currentProductImages.length < 5) currentProductImages.push(img); });
    renderProductImagePreview();
    e.target.value = '';
  });

  // Guardar producto
  on('btn-save-product', 'onclick', async () => {
    const name = document.getElementById('product-name')?.value.trim();
    const priceRaw = document.getElementById('product-price')?.value.replace(/\./g, '').replace(/,/g, '');
    const price = parseFloat(priceRaw);
    if (!name || isNaN(price) || price <= 0) return showToast('Nombre y precio requeridos');
    const pData = {
      name, price,
      ref: document.getElementById('product-ref')?.value.trim() || '',
      category: document.getElementById('product-category')?.value.trim() || '',
      tags: document.getElementById('product-tags')?.value.trim() || '',
      cost: parseFloat(document.getElementById('product-cost')?.value.replace(/\./g, '').replace(/,/g, '')) || 0,
      originalPrice: parseFloat(document.getElementById('product-original-price')?.value.replace(/\./g, '').replace(/,/g, '')) || 0,
      stock: parseInt(document.getElementById('product-stock')?.value) || 0,
      unit: document.getElementById('product-unit')?.value || 'und',
      description: document.getElementById('product-description')?.value.trim() || '',
      active: document.getElementById('product-active')?.checked ?? true,
      images: [...currentProductImages],
      variants: []
    };

    const type = document.querySelector('input[name="product-type"]:checked')?.value;
    if (type === 'variants') {
      const variantRows = document.querySelectorAll('.variant-row');
      variantRows.forEach(row => {
        const color = row.querySelector('.var-color')?.value.trim();
        const stock = parseInt(row.querySelector('.var-stock')?.value) || 0;
        if (color) pData.variants.push({ color, stock });
      });
      pData.stock = pData.variants.reduce((t, v) => t + v.stock, 0); // Opcional: stock total es la suma
    } else {
      pData.variants = null; // Limpiar si cambia a simple
    }

    if (window.currentEditId) {
      const existingIdx = products.findIndex(x => x.id === window.currentEditId);
      pData.timestamp = existingIdx !== -1 ? (products[existingIdx].timestamp || Date.now()) : Date.now();
      products = products.map(p => p.id === window.currentEditId ? { ...p, ...pData, id: window.currentEditId } : p);
      await update(ref(db, `products/${window.currentEditId}`), pData);
      showToast('Producto actualizado ✅');
    } else {
      pData.timestamp = Date.now();
      const newRef = await push(ref(db, 'products'), pData);
      products.push({ ...pData, id: newRef.key });
      showToast('Producto creado ✅');
    }
    window.currentEditId = null;
    currentProductImages = [];
    safeStyle('modal-product', 'display', 'none');
    renderAdminProducts();
  });

  // Eliminar producto
  on('btn-delete-product', 'onclick', () => {
    if (!window.currentEditId) return;
    if (confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) {
      deleteProduct(window.currentEditId);
      window.currentEditId = null;
      currentProductImages = [];
      safeStyle('modal-product', 'display', 'none');
      showToast('Producto eliminado');
    }
  });

  on('btn-add-product', 'onclick', () => openProductModal(null));

  // Guardar configuración
  on('btn-save-settings', 'onclick', async () => {
    const newSettings = {
      ...settings,
      storeName: document.getElementById('settings-store-name')?.value || '',
      tagline: document.getElementById('settings-tagline')?.value || '',
      whatsapp: document.getElementById('settings-whatsapp')?.value || '',
      color: document.getElementById('settings-color')?.value || '#6c63ff',
      currency: document.getElementById('settings-currency')?.value || 'COP',
      activeCampaign: {
        enabled: document.getElementById('settings-camp-enabled')?.checked || false,
        title: document.getElementById('settings-camp-title')?.value || '',
        tag: document.getElementById('settings-camp-tag')?.value || '',
        badgeText: document.getElementById('settings-camp-badge')?.value || ''
      },
      paymentInfo: document.getElementById('settings-payment-info')?.value || '',
      // contraseña: se procesa abajo de forma asíncrona
      shippingCost: parseFloat(document.getElementById('settings-shipping-cost')?.value) || 0
    };
    // Hash de la contraseña antes de guardar
    const newPass = document.getElementById('settings-admin-password')?.value || '';
    if (newPass) {
      newSettings.adminPasswordHash = await hashPassword(newPass);
    } else {
      newSettings.adminPasswordHash = settings.adminPasswordHash || '';
    }
    await set(ref(db, 'settings'), newSettings);
    showToast('Configuración guardada');
  });

  // Logo upload
  on('logo-upload-area', 'onclick', () => document.getElementById('logo-file-input')?.click());
  on('logo-file-input', 'onchange', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 400, 0.7);
      settings.logo = compressed;
      safeSet('settings-logo-preview', 'src', compressed);
      safeStyle('settings-logo-preview', 'display', 'block');
      safeStyle('logo-upload-placeholder', 'display', 'none');
    };
    reader.readAsDataURL(file);
  });

  // QR de pago upload (BUG FIX: faltaba el listener)
  on('qr-upload-area', 'onclick', () => document.getElementById('qr-file-input')?.click());
  on('qr-file-input', 'onchange', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 400, 0.8);
      settings.paymentQR = compressed;
      safeSet('settings-qr-preview', 'src', compressed);
      safeStyle('settings-qr-preview', 'display', 'block');
      safeStyle('qr-upload-placeholder', 'display', 'none');
    };
    reader.readAsDataURL(file);
  });

  // Generar ticket
  on('btn-generate-ticket', 'onclick', () => {
    const nameVal = document.getElementById('customer-name')?.value?.trim();
    const phoneVal = document.getElementById('customer-phone')?.value?.trim();
    if (!nameVal || !phoneVal) return showToast('Nombre y teléfono requeridos');
    const customer = {
      name: nameVal,
      phone: phoneVal,
      dept: document.getElementById('customer-dept')?.value || '',
      city: document.getElementById('customer-city')?.value || '',
      barrio: document.getElementById('customer-barrio')?.value || '',
      address: document.getElementById('customer-address')?.value || '',
      address2: document.getElementById('customer-address2')?.value || '',
      zip: document.getElementById('customer-zip')?.value || '',
      notes: document.getElementById('customer-notes')?.value || ''
    };
    const items = Object.entries(cart).map(([cartId, q]) => {
      const parts = cartId.split(':');
      const productId = parts[0];
      const variantColor = parts[1];
      const p = products.find(x => x.id === productId);
      return { ...p, qty: q, variantColor };
    });
    const subtotal = items.reduce((t, i) => t + (i.price * i.qty), 0);
    const shippingCost = getShippingCost(customer.dept);
    // BUG FIX: sumar el costo de envío real al total
    const shippingValue = (shippingCost === 0) ? 0 : (settings.shippingCost || 0);
    const total = subtotal + shippingValue;
    const totalCost = items.reduce((t, i) => t + ((i.cost || 0) * i.qty), 0);
    const orderData = { channel: 'web', customer, items, subtotal, shippingValue, shippingCost, total, totalCost, timestamp: Date.now(), status: 'pending' };

    push(ref(db, 'orders'), orderData).then((newRef) => {
      const orderId = newRef.key;
      const ticketNum = 'AG-' + orderId.slice(-6).toUpperCase();
      safeText('ticket-number', ticketNum);
      safeText('ticket-date', new Date().toLocaleString('es-CO'));
      safeText('ticket-store-name', settings.storeName);
      safeText('ticket-customer-name', customer.name);
      safeText('ticket-customer-phone', customer.phone);
      safeText('ticket-customer-city', customer.city);
      safeText('ticket-customer-dept', customer.dept);
      safeText('ticket-customer-barrio', customer.barrio);
      safeText('ticket-customer-address', customer.address);
      if (customer.address2) {
        safeText('ticket-customer-address2', customer.address2);
        safeStyle('ticket-address2-wrapper', 'display', 'block');
      }
      const itemsEl = document.getElementById('ticket-items');
      if (itemsEl) {
        itemsEl.innerHTML = items.map(i => {
          const name = i.variantColor ? `${i.name} (${i.variantColor})` : i.name;
          return `<div class="ticket-item"><span>${name} x${i.qty}</span><span>${formatMoney(i.price * i.qty)}</span></div>`;
        }).join('');
      }
      // Envío en ticket — siempre visible
      const isFreeDept = isBogota(customer.dept);
      // Etiqueta del envío
      safeText('ticket-shipping-label', isFreeDept ? '🚚 Costo de Envío' : '🚚 Costo de Envío');
      safeText('ticket-shipping-cost', isFreeDept ? 'GRATIS' : 'Por Calcular');
      const shippingCostEl = document.getElementById('ticket-shipping-cost');
      if (shippingCostEl) shippingCostEl.style.color = isFreeDept ? '#25D366' : '#e67e22';
      safeText('ticket-total', formatMoney(total));
      const notesEl = document.getElementById('ticket-notes-wrapper');
      if (notesEl && customer.notes) {
        notesEl.style.display = 'block';
        safeText('ticket-note-text', customer.notes);
      }
      if (settings.paymentInfo || settings.paymentQR) {
        safeStyle('ticket-payment-wrapper', 'display', 'block');
        safeText('ticket-payment-text', settings.paymentInfo || '');
        if (settings.paymentQR) {
          safeSet('ticket-qr-img', 'src', settings.paymentQR);
          safeStyle('ticket-qr-wrapper', 'display', 'block');
        }
      }
      // Logo removido del ticket por diseño
      // WhatsApp — mensaje completo con todos los datos
      const waBtn = document.getElementById('btn-whatsapp');
      if (waBtn && settings.whatsapp) {
        const envioTexto = isBogota(customer.dept) ? 'GRATIS' : 'Por Calcular (cotizar con transportadora)';
        const nl = '\n';
        const waMessage = [
          '🛒 *NUEVO PEDIDO - ' + settings.storeName + '*',
          '📋 *Pedido:* ' + ticketNum,
          '📅 *Fecha:* ' + new Date().toLocaleString('es-CO'),
          '',
          '👤 *DATOS DEL CLIENTE*',
          '• Nombre: ' + customer.name,
          '• Celular: ' + customer.phone,
          '• Ciudad: ' + customer.city + ' (' + customer.dept + ')',
          '• Barrio: ' + customer.barrio,
          '• Dirección: ' + customer.address,
          customer.address2 ? '• Detalle: ' + customer.address2 : null,
          customer.notes ? '• Nota: ' + customer.notes : null,
          '',
          '🛍️ *PRODUCTOS*',
          ...items.map(i => {
            const name = i.variantColor ? `${i.name} (${i.variantColor})` : i.name;
            return '• ' + name + ' x' + i.qty + ' = ' + formatMoney(i.price * i.qty);
          }),
          '',
          '🚚 *Envío:* ' + envioTexto,
          '💰 *TOTAL: ' + formatMoney(total) + '*',
          settings.paymentInfo ? ('\n💳 *Pagar a:* ' + settings.paymentInfo) : null
        ].filter(line => line !== null).join(nl);

        const waText = encodeURIComponent(waMessage);

        // Al hacer clic: descargar ticket como imagen Y abrir WhatsApp
        waBtn.onclick = async (e) => {
          e.preventDefault();
          const ticketCard = document.getElementById('ticket-card');
          if (ticketCard && typeof html2canvas !== 'undefined') {
            try {
              const actions = document.querySelector('.ticket-actions');
              if (actions) actions.style.visibility = 'hidden';
              const canvas = await html2canvas(ticketCard, {
                scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false
              });
              if (actions) actions.style.visibility = '';
              const link = document.createElement('a');
              link.download = `pedido-${ticketNum}.png`;
              link.href = canvas.toDataURL('image/png');
              link.click();
              showToast('Ticket guardado 📥 Abriendo WhatsApp...');
              setTimeout(() => {
                window.open(`https://wa.me/${settings.whatsapp}?text=${waText}`, '_blank');
              }, 800);
            } catch (err) {
              window.open(`https://wa.me/${settings.whatsapp}?text=${waText}`, '_blank');
            }
          } else {
            window.open(`https://wa.me/${settings.whatsapp}?text=${waText}`, '_blank');
          }
        };
        waBtn.style.display = 'flex';
      } else if (waBtn) {
        waBtn.style.display = 'none';
      }

      const shareBtn = document.getElementById('btn-share-ticket');
      if (shareBtn && navigator.share) {
        shareBtn.style.display = 'flex';
        shareBtn.onclick = async () => {
          try {
            await navigator.share({
              title: 'Pedido ' + ticketNum,
              text: 'Aquí está mi pedido de ' + settings.storeName + ':\n\n' + decodeURIComponent(waText),
              url: window.location.href
            });
            showToast('Compartido exitosamente');
          } catch (err) {
            console.log('Error compartiendo:', err);
          }
        };
      } else if (shareBtn) {
        shareBtn.style.display = 'none';
      }

      switchView('ticket');
      cart = {};
      updateCartUI();
    });
  });

  // Búsqueda
  on('price', 'oninput', formatInputCurrency);
  on('product-price', 'oninput', formatInputCurrency);
  on('product-original-price', 'oninput', formatInputCurrency);
  on('product-cost', 'oninput', formatInputCurrency);
  let searchTimer;
  on('search-input', 'oninput', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderProducts, 150);
  });

  // Admin search
  on('admin-search-input', 'oninput', () => renderAdminProducts());

  // Report timeframe
  on('report-timeframe', 'onchange', () => renderReports());

  // ====== DEPARTAMENTOS Y CIUDADES ======
  const deptSelect = document.getElementById('customer-dept');
  const citySelect = document.getElementById('customer-city');
  if (deptSelect && typeof COLOMBIA_LOCATIONS !== 'undefined') {
    deptSelect.innerHTML = '<option value="">Selecciona departamento...</option>';
    Object.keys(COLOMBIA_LOCATIONS).sort().forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      deptSelect.appendChild(opt);
    });
    deptSelect.addEventListener('change', () => {
      const cities = COLOMBIA_LOCATIONS[deptSelect.value] || [];
      citySelect.innerHTML = '<option value="">Selecciona ciudad...</option>';
      cities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });
      citySelect.disabled = cities.length === 0;
      updateShippingDisplay(deptSelect.value);
    });
    citySelect.disabled = true;
  }

  // ====== SERVICE WORKER ======
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        // Cada vez que hay un nuevo SW esperando → recargar automático
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Hay versión nueva lista → recargar sin avisar
              window.location.reload();
            }
          });
        });
      })
      .catch(err => console.log('SW error:', err));

    // Si el SW toma control (tras activarse) → recargar página
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }

  // ====== AUTO UPDATE CHECK ======
  // Verifica version.json cada vez que el usuario abre la app
  // Si la versión cambió → recarga silenciosa
  const APP_VERSION_KEY = 'app_version';
  const checkForUpdate = async () => {
    try {
      const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const savedVersion = localStorage.getItem(APP_VERSION_KEY);
      if (savedVersion && savedVersion !== data.version) {
        // Version changed — clear caches and reload
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        localStorage.setItem(APP_VERSION_KEY, data.version);
        window.location.reload(true);
        return;
      }
      localStorage.setItem(APP_VERSION_KEY, data.version);
    } catch (e) {
      // Sin conexión o sin version.json — no hacer nada
    }
  };
  checkForUpdate();

  // Detección de ubicación inteligente (Silent Mode)
  function detectLocation() {
    // Si ya lo detectamos en esta sesión, no repetimos
    if (isLocationDetected) return;

    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(data => {
        isLocationDetected = true;
        if (data && data.region) {
          const region = data.region.toLowerCase();
          const city = (data.city || '').toLowerCase();
          const isBgt = region.includes('bogot') || city.includes('bogot');

          const newLoc = isBgt ? 'bogota' : 'nacional';

          // Solo actualizamos si la ubicación detectada es diferente a la guardada o si no había guardada
          if (newLoc !== userLocation) {
            setUserLocation(newLoc);
          }
        }
      }).catch(() => {
        // Fallback silencioso: Envíos nacionales
        if (!userLocation) setUserLocation('nacional');
      });
  }

  // ====== START ======
  detectLocation();
  updateWAButtonPosition();
  init();

  // ====== MODAL VENTA EXTERNA ======================================
  let extItems = []; // [{name, price, cost, qty}]

  // Helpers para parsear moneda formateada
  const parseCOP = (str) => parseFloat((str || '0').replace(/\./g, '').replace(/,/g, '')) || 0;

  // Renderizar líneas de ítems en el modal
  function renderExtItems() {
    const list = document.getElementById('ext-items-list');
    if (!list) return;
    if (!extItems.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0">Aún no hay productos. Pulsa "+ Agregar ítem".</div>';
      recalcExtFinancials();
      return;
    }
    list.innerHTML = extItems.map((item, idx) => `
      <div class="ext-item-row" data-idx="${idx}">
        <div class="ext-item-fields">
          <input type="text" class="field-input ext-item-name" placeholder="Nombre producto *"
            value="${item.name || ''}" oninput="window._extItemChange(${idx},'name',this.value)" style="flex:2">
          <input type="text" class="field-input ext-item-price" placeholder="Precio venta"
            value="${item.price ? parseInt(item.price).toLocaleString('es-CO') : ''}"
            inputmode="numeric" oninput="window._extItemChange(${idx},'priceRaw',this.value)" style="flex:1.2">
          <input type="text" class="field-input ext-item-cost" placeholder="Costo (opc)"
            value="${item.cost ? parseInt(item.cost).toLocaleString('es-CO') : ''}"
            inputmode="numeric" oninput="window._extItemChange(${idx},'costRaw',this.value)" style="flex:1.2">
          <input type="number" class="field-input ext-item-qty" placeholder="Cant" min="1"
            value="${item.qty || 1}" oninput="window._extItemChange(${idx},'qty',this.value)" style="flex:0.7;min-width:52px">
        </div>
        <button type="button" class="btn-ext-remove" onclick="window._extRemoveItem(${idx})">×</button>
      </div>
    `).join('');
    recalcExtFinancials();
  }

  window._extItemChange = (idx, field, val) => {
    if (!extItems[idx]) return;
    if (field === 'priceRaw') extItems[idx].price = parseCOP(val);
    else if (field === 'costRaw') extItems[idx].cost = parseCOP(val);
    else if (field === 'qty') extItems[idx].qty = Math.max(1, parseInt(val) || 1);
    else extItems[idx][field] = val;
    recalcExtFinancials();
  };

  window._extRemoveItem = (idx) => {
    extItems.splice(idx, 1);
    renderExtItems();
  };

  function addExtItem() {
    extItems.push({ name: '', price: 0, cost: 0, qty: 1 });
    renderExtItems();
    // Focus en el último nombre
    setTimeout(() => {
      const inputs = document.querySelectorAll('.ext-item-name');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }, 50);
  }

  // Recalcular resumen financiero en tiempo real
  function recalcExtFinancials() {
    const channel = document.getElementById('ext-channel')?.value || 'web';
    const subtotal = extItems.reduce((t, i) => t + (i.price || 0) * (i.qty || 1), 0);
    const totalCost = extItems.reduce((t, i) => t + (i.cost || 0) * (i.qty || 1), 0);

    const commPct = parseFloat(document.getElementById('ext-ml-commission-pct')?.value || 0);
    const shipping = parseCOP(document.getElementById('ext-shipping-cost')?.value);
    const adCost = parseCOP(document.getElementById('ext-ad-cost')?.value);

    const commission = subtotal * (commPct / 100);
    const netProfit = subtotal - totalCost - commission - shipping - adCost;

    // Actualizar textos
    const safeT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const safeD = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? 'flex' : 'none'; };

    safeT('ext-fin-subtotal', subtotal ? formatMoney(subtotal) : '—');
    safeT('ext-fin-commission', commission ? formatMoney(commission) : '—');
    safeT('ext-fin-shipping', shipping ? formatMoney(shipping) : '—');
    safeT('ext-fin-ad', adCost ? formatMoney(adCost) : '—');

    const profitEl = document.getElementById('ext-fin-profit');
    if (profitEl) {
      profitEl.textContent = subtotal ? formatMoney(netProfit) : '—';
      profitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    safeD('ext-fin-commission-row', commission > 0);
    safeD('ext-fin-shipping-row', shipping > 0);
    safeD('ext-fin-ad-row', adCost > 0);
  }

  // Mostrar/ocultar costos ML según canal
  function updateExtCostsVisibility(channel) {
    const costsEl = document.getElementById('ext-ml-costs');
    if (costsEl) costsEl.style.display = (channel === 'web' || channel === 'whatsapp') ? 'none' : 'block';
    recalcExtFinancials();
  }

  // Abrir modal limpio
  function openExternalSaleModal() {
    extItems = [];
    // Reset campos
    ['ext-customer-name', 'ext-customer-phone', 'ext-order-id', 'ext-notes',
      'ext-shipping-cost', 'ext-ad-cost'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
    const commEl = document.getElementById('ext-ml-commission-pct');
    if (commEl) commEl.value = 13;
    // Canal por defecto: ML
    const hidden = document.getElementById('ext-channel');
    if (hidden) hidden.value = 'mercado_libre';
    document.querySelectorAll('.channel-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.channel === 'mercado_libre');
    });
    updateExtCostsVisibility('mercado_libre');
    renderExtItems();
    safeStyle('modal-external-sale', 'display', 'flex');
  }
  window.openExternalSaleModal = openExternalSaleModal;

  // Listeners del modal
  on('btn-add-external-sale', 'onclick', openExternalSaleModal);
  on('btn-close-external-modal', 'onclick', () => safeStyle('modal-external-sale', 'display', 'none'));
  on('btn-add-ext-item', 'onclick', addExtItem);

  // Selector de canal (botones tipo chip)
  document.getElementById('ext-channel-selector')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.channel-btn');
    if (!btn) return;
    document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const ch = btn.dataset.channel;
    const hidden = document.getElementById('ext-channel');
    if (hidden) hidden.value = ch;
    updateExtCostsVisibility(ch);
  });

  // Recalcular al cambiar costos
  ['ext-ml-commission-pct', 'ext-shipping-cost', 'ext-ad-cost'].forEach(id => {
    on(id, 'oninput', recalcExtFinancials);
  });
  on('ext-ml-commission-pct', 'onchange', recalcExtFinancials);

  // Guardar venta externa en Firebase
  on('btn-save-external-sale', 'onclick', async () => {
    const channel = document.getElementById('ext-channel')?.value || 'mercado_libre';
    const custName = document.getElementById('ext-customer-name')?.value.trim() || 'Externo';
    const custPhone = document.getElementById('ext-customer-phone')?.value.trim() || '';
    const extOrderId = document.getElementById('ext-order-id')?.value.trim() || '';
    const notes = document.getElementById('ext-notes')?.value.trim() || '';
    const commPct = parseFloat(document.getElementById('ext-ml-commission-pct')?.value || 0);
    const shipping = parseCOP(document.getElementById('ext-shipping-cost')?.value);
    const adCost = parseCOP(document.getElementById('ext-ad-cost')?.value);

    // Validar que haya al menos un ítem con nombre y precio
    const validItems = extItems.filter(i => i.name.trim() && i.price > 0);
    if (!validItems.length) return showToast('Agrega al menos un producto con nombre y precio');

    const subtotal = validItems.reduce((t, i) => t + i.price * i.qty, 0);
    const totalCost = validItems.reduce((t, i) => t + (i.cost || 0) * i.qty, 0);
    const commission = subtotal * (commPct / 100);
    const total = subtotal; // El total recibido es el subtotal (ML descuenta aparte)
    const netProfit = subtotal - totalCost - commission - shipping - adCost;

    const orderData = {
      channel,
      externalOrderId: extOrderId,
      customer: { name: custName, phone: custPhone, city: '', dept: '', address: '', barrio: '' },
      items: validItems.map(i => ({
        id: i.id || '',
        name: i.name.trim(),
        price: i.price,
        cost: i.cost || 0,
        qty: i.qty,
        subtotal: i.price * i.qty,
        profit: (i.price - (i.cost || 0)) * i.qty
      })),
      subtotal,
      total,
      totalCost,
      mlCommissionPct: commPct,
      mlCommission: commission,
      shippingValue: shipping,
      adCost,
      netProfit,
      notes,
      timestamp: Date.now(),
      status: 'completed', // Las ventas externas ya ocurrieron
      completedAt: Date.now(),
      source: 'manual_admin'
    };

    try {
      await push(ref(db, 'orders'), orderData);
      safeStyle('modal-external-sale', 'display', 'none');
      showToast(`Venta registrada ✅ Ganancia: ${formatMoney(netProfit)}`);
      renderAdminOrders();
      renderReports();
    } catch (err) {
      showToast('Error al guardar. Intenta de nuevo.');
      console.error(err);
    }
  });

}); // fin DOMContentLoaded

