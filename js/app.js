// ====== FIREBASE MODULAR SDK ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { 
  getDatabase, ref, onValue, set, push, update, remove
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
  paymentInfo: '', paymentQR: ''
};
let orders = [];
let cart = {};
let currentFilter = 'all';
let currentProductImages = [];
let viewerImages = [];
let viewerIndex = 0;
let views = {};
let els = {};

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
    };
  });
}

function applySettings() {
  document.documentElement.style.setProperty('--primary', settings.color);
  const hex = (settings.color || '#6c63ff').replace('#', '');
  const r = parseInt(hex.substring(0,2), 16), g = parseInt(hex.substring(2,4), 16), b = parseInt(hex.substring(4,6), 16);
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

function getProductHTML(p) {
  const pImages = p.images || (p.image ? [p.image] : []);
  const mainImg = pImages[0];
  return `
    <div class="product-image-container" ${mainImg ? `onclick="openImageModal('${p.id}')"` : ''} style="cursor:pointer;">
      ${mainImg ? `<img src="${mainImg}" loading="lazy" />` : '<span style="font-size:2rem">📦</span>'}
      ${pImages.length > 1 ? `<div class="image-count-badge">1/${pImages.length}</div>` : ''}
    </div>
    <div class="product-info">
      ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
      <div class="product-title">${p.name} ${p.ref ? `<span>[${p.ref}]</span>` : ''}</div>
      ${p.description ? `<div class="product-desc-wrapper">
          <div class="product-desc collapsed" id="desc-${p.id}">${p.description}</div>
          <button class="btn-more" onclick="toggleDesc(event, '${p.id}')">Ver más</button>
        </div>` : ''}
      <div class="product-bottom-section">
        <div class="product-price"><span>${settings.currency}</span> <span>${parseFloat(p.price).toLocaleString('es-CO')}</span></div>
        <div class="qty-controls">
          ${cart[p.id] ? `
            <button class="btn-qty" onclick="updateCart('${p.id}', -1)">-</button>
            <span class="qty-display">${cart[p.id]}</span>
            <button class="btn-qty" onclick="updateCart('${p.id}', 1)">+</button>
          ` : `<button class="btn-add" onclick="updateCart('${p.id}', 1)">Agregar</button>`}
        </div>
      </div>
    </div>
  `;
}

// ====== CART ======
function updateCart(productId, change) {
  const p = products.find(prod => prod.id === productId);
  const current = cart[productId] || 0;
  const next = current + change;
  if (change > 0 && p.stock !== undefined && p.stock !== '' && next > p.stock) {
    showToast(`Solo quedan ${p.stock} unidades`); return;
  }
  if (next <= 0) delete cart[productId]; else cart[productId] = next;
  updateCartUI();
  renderProducts();
  if (views.order && views.order.classList.contains('active')) renderOrderList();
}

function updateCartUI() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = Object.entries(cart).reduce((t, [id, q]) => {
    const p = products.find(x => x.id === id);
    return t + (p ? p.price * q : 0);
  }, 0);
  if (count > 0) {
    els.cartBar.style.display = 'block';
    els.cartCount.textContent = count;
    els.cartTotal.textContent = formatMoney(total);
  } else els.cartBar.style.display = 'none';
}

function renderOrderList() {
  const total = Object.entries(cart).reduce((t, [id, q]) => {
    const p = products.find(x => x.id === id);
    return t + (p ? p.price * q : 0);
  }, 0);
  els.orderList.innerHTML = Object.entries(cart).map(([id, q]) => {
    const p = products.find(x => x.id === id);
    if (!p) return '';
    return `
      <div class="order-item-row">
        <div class="order-item-info">
          <div class="order-item-name">${p.name}</div>
          <div class="order-item-price-unit">${formatMoney(p.price)} x ${q}</div>
        </div>
        <div class="order-item-actions">
          <div class="qty-controls small">
            <button class="btn-qty" onclick="updateCart('${id}', -1)">-</button>
            <span class="qty-display">${q}</span>
            <button class="btn-qty" onclick="updateCart('${id}', 1)">+</button>
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
  list.innerHTML = orders.map(o => `
    <div class="admin-order-card ${o.status || ''}">
      <div class="admin-order-header">
        <span class="admin-order-id">#${(o.id || '').slice(-6)}</span>
        <span class="admin-order-date">${o.timestamp ? new Date(o.timestamp).toLocaleString() : '---'}</span>
      </div>
      <div class="admin-order-customer">${o.customer?.name || 'Cliente anónimo'}</div>
      <div class="admin-order-items">${(o.items || []).length} productos</div>
      <div class="admin-order-total">${formatMoney(o.total || 0)}</div>
      <div class="admin-order-actions">
        ${o.status !== 'completed' && o.status !== 'cancelled' ? `
          <button class="btn-order-confirm" onclick="confirmOrder('${o.id}')">Completar</button>
          <button class="btn-order-cancel" onclick="cancelOrder('${o.id}')">Anular</button>
        ` : `<span style="text-transform:uppercase;font-weight:bold;">${o.status === 'completed' ? 'Completado ✅' : 'Anulado ❌'}</span>`}
      </div>
    </div>
  `).join('');
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
  const sum = (arr) => arr.reduce((t, o) => t + o.total, 0);
  const profit = (arr) => arr.reduce((t, o) => t + (o.total - (o.totalCost || 0)), 0);
  safeText('report-revenue-total', formatMoney(sum(completed)));
  safeText('report-profit-total', formatMoney(profit(completed)));
  safeText('report-revenue-pending', formatMoney(sum(pending)));
  safeText('report-profit-pending', formatMoney(profit(pending)));
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
  safeValue('settings-admin-password', settings.adminPassword || '');
  if (settings.logo) {
    safeSet('settings-logo-preview', 'src', settings.logo);
    safeStyle('settings-logo-preview', 'display', 'block');
    safeStyle('logo-upload-placeholder', 'display', 'none');
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
  safeValue('product-price', p ? parseInt(p.price).toLocaleString('es-CO') : '');
  safeValue('product-cost', (p && p.cost) ? parseInt(p.cost).toLocaleString('es-CO') : '');
  safeValue('product-stock', p ? (p.stock || '') : '');
  const unitEl = document.getElementById('product-unit');
  if (unitEl) unitEl.value = p ? (p.unit || 'und') : 'und';
  safeValue('product-description', p ? (p.description || '') : '');
  const activeEl = document.getElementById('product-active');
  if (activeEl) activeEl.checked = p ? p.active : true;
  renderProductImagePreview();
  safeStyle('btn-delete-product', 'display', p ? 'block' : 'none');
}

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
window.confirmOrder = (id) => update(ref(db, `orders/${id}`), { status: 'completed' });
window.cancelOrder = (id) => update(ref(db, `orders/${id}`), { status: 'cancelled' });
window.copyPaymentInfo = () => {
  if (settings.paymentInfo) {
    navigator.clipboard.writeText(settings.paymentInfo);
    showToast('Copiado al portapapeles');
  }
};

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
    if (settings.adminPassword) {
      safeStyle('modal-login', 'display', 'flex');
    } else {
      openAdmin();
    }
  });

  // Logo: triple clic o pulsación larga
  let logoClicks = 0, logoTimer, logoPressTimer;
  const triggerAdminAccess = () => {
    if (settings.adminPassword) safeStyle('modal-login', 'display', 'flex');
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
  on('btn-login-submit', 'onclick', () => {
    const passInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');
    if (passInput && passInput.value === settings.adminPassword) {
      safeStyle('modal-login', 'display', 'none');
      if (errorMsg) errorMsg.style.display = 'none';
      openAdmin();
    } else if (errorMsg) {
      errorMsg.style.display = 'block';
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
      cost: parseFloat(document.getElementById('product-cost')?.value.replace(/\./g, '').replace(/,/g, '')) || 0,
      stock: parseInt(document.getElementById('product-stock')?.value) || 0,
      unit: document.getElementById('product-unit')?.value || 'und',
      description: document.getElementById('product-description')?.value.trim() || '',
      active: document.getElementById('product-active')?.checked ?? true,
      images: [...currentProductImages]
    };
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
      paymentInfo: document.getElementById('settings-payment-info')?.value || '',
      adminPassword: document.getElementById('settings-admin-password')?.value || ''
    };
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
    const items = Object.entries(cart).map(([id, q]) => {
      const p = products.find(x => x.id === id);
      return { ...p, qty: q };
    });
    const total = items.reduce((t, i) => t + (i.price * i.qty), 0);
    const totalCost = items.reduce((t, i) => t + ((i.cost || 0) * i.qty), 0);
    const orderData = { customer, items, total, totalCost, timestamp: Date.now(), status: 'pending' };
    
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
        itemsEl.innerHTML = items.map(i =>
          `<div class="ticket-item"><span>${i.name} x${i.qty}</span><span>${formatMoney(i.price * i.qty)}</span></div>`
        ).join('');
      }
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
      // Logo en ticket
      const ticketLogo = document.getElementById('ticket-logo');
      if (ticketLogo && settings.logo) {
        ticketLogo.innerHTML = `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:contain;" />`;
      }
      // WhatsApp
      const waBtn = document.getElementById('btn-whatsapp');
      if (waBtn && settings.whatsapp) {
        const waText = encodeURIComponent(
          `*Pedido ${ticketNum}*\nCliente: ${customer.name}\nTotal: ${formatMoney(total)}\n\nProductos:\n` +
          items.map(i => `- ${i.name} x${i.qty}: ${formatMoney(i.price * i.qty)}`).join('\n')
        );
        waBtn.href = `https://wa.me/${settings.whatsapp}?text=${waText}`;
        waBtn.style.display = 'flex';
      } else if (waBtn) {
        waBtn.style.display = 'none';
      }
      switchView('ticket');
      cart = {};
      updateCartUI();
    });
  });

  // Búsqueda
  on('price', 'oninput', formatInputCurrency);
  on('product-price', 'oninput', formatInputCurrency);
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
    });
    citySelect.disabled = true;
  }

  // ====== SERVICE WORKER ======
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(r => r.unregister());
    });
    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
  }

  // ====== START ======
  init();

}); // fin DOMContentLoaded
