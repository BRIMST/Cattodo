// ====== FIREBASE MODULAR SDK ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { 
  getDatabase, ref, onValue, get, set, push, update, remove,
  query, limitToFirst, orderByKey, startAt 
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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ====== GLOBAL MAPPINGS (Resilience) ======
// Map these first so they are available to the HTML even if later code fails
window.closeModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
  if (id === 'modal-product') {
    window.currentEditId = null;
    currentProductImages = [];
  }
};
window.closeImageModal = () => {
  const el = document.getElementById('image-viewer-modal');
  if (el) el.style.display = 'none';
};
window.closeAdmin = () => {
  const el = document.getElementById('panel-admin');
  if (el) el.style.display = 'none';
};

// State Management
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

// DOM Elements — se inicializan dentro de DOMContentLoaded
let views = {};
let els = {};

document.addEventListener('DOMContentLoaded', () => {
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
  Object.values(views).forEach(v => {
    if (v) v.classList.remove('active');
  });
  if (views[viewName]) views[viewName].classList.add('active');
};

const formatInputCurrency = (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value === "") { e.target.value = ""; return; }
  e.target.value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
};

const safeSet = (id, prop, val) => {
  const el = document.getElementById(id);
  if (el) el[prop] = val;
};
const safeText = (id, txt) => safeSet(id, 'textContent', txt);
const safeHTML = (id, html) => safeSet(id, 'innerHTML', html);
const safeValue = (id, val) => safeSet(id, 'value', val);
const safeStyle = (id, prop, val) => {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
};

// ====== INITIALIZATION ======
function init() {
  onValue(ref(db, 'settings'), snap => {
    if (snap.exists()) {
      settings = snap.val();
      applySettings();
    }
  });

  onValue(ref(db, 'products'), snap => {
    console.log('Firebase Products Data received');
    const val = snap.val();
    if (!val) {
      products = [];
    } else if (Array.isArray(val)) {
      products = val.filter(p => p !== null); 
    } else {
      products = Object.keys(val).map(key => ({...val[key], id: key}));
    }
    
    console.log('Processed Products:', products.length);
    renderFilters();
    renderProducts();
    updateCartUI();
    const panel = document.getElementById('panel-admin');
    if (panel && panel.style.display === 'flex') {
      renderAdminProducts();
    }
  });

  // Tab Switching
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const contentId = 'tab-' + tab.dataset.tab;
      const contentEl = document.getElementById(contentId);
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
  
  const logoHTML = settings.logo ? `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:contain;" />` : `<span class="logo-emoji">🛒</span>`;
  safeHTML('header-logo-area', logoHTML);

  const waBtn = document.getElementById('floating-wa-btn');
  if (waBtn) {
    if (settings.whatsapp) {
      waBtn.style.display = 'flex';
      waBtn.href = `https://wa.me/${settings.whatsapp}?text=Hola,%20tengo%20una%20pregunta.`;
    } else waBtn.style.display = 'none';
  }
}

// ====== CATALOG RENDERING ======
function renderFilters() {
  const categories = ['all', ...new Set(products.map(p => p.category).filter(c => c))];
  els.categoryFilters.innerHTML = categories.map(cat => `
    <button class="btn-category ${currentFilter === cat ? 'active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? 'Todos' : cat}
    </button>
  `).join('');
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
  
  const batchSize = 10;
  let currentIndex = 0;
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
      ${mainImg ? `<img src="${mainImg}" loading="lazy" onload="this.classList.add('loaded'); this.parentElement.classList.add('img-loaded')" />` : '<span style="font-size:2rem">📦</span>'}
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

// ====== CART & CHECKOUT ======
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
  if (views.order.classList.contains('active')) renderOrderList();
}

function updateCartUI() {
  const count = Object.values(cart).reduce((a,b)=>a+b, 0);
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
  img.src = viewerImages[viewerIndex];
  document.getElementById('btn-viewer-prev').style.display = viewerImages.length > 1 ? 'block' : 'none';
  document.getElementById('btn-viewer-next').style.display = viewerImages.length > 1 ? 'block' : 'none';
}

// ====== ADMIN ======
function openAdmin() {
  console.log('Opening Admin Panel...');
  const panel = document.getElementById('panel-admin');
  if (panel) panel.style.display = 'flex';
  
  if (!window.ordersListenerAttached) {
    window.ordersListenerAttached = true;
    console.log('Attaching Orders Listener...');
    onValue(ref(db, 'orders'), snap => {
      const val = snap.val();
      orders = val ? Object.keys(val).map(key => ({...val[key], id: key})).reverse() : [];
      renderAdminOrders();
      renderReports();
    });
  }
  renderAdminProducts();
  loadSettingsForm();
}

function renderAdminProducts() {
  console.log('Rendering Admin Products...');
  const list = document.getElementById('admin-products-list');
  if (!list) {
    console.error('Error: admin-products-list element not found');
    return;
  }
  
  const searchInput = document.getElementById('admin-search-input');
  const search = (searchInput?.value || '').toLowerCase();
  let filtered = products;
  
  if (search) {
    filtered = products.filter(p => 
      (p.name && p.name.toLowerCase().includes(search)) || 
      (p.ref && p.ref.toLowerCase().includes(search))
    );
  }
  
  console.log('Products to render in admin:', filtered.length);
  
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted);">No hay productos para mostrar.</div>';
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">
        ${(p.images && p.images[0]) || p.image ? `<img src="${(p.images && p.images[0]) || p.image}" loading="lazy" onerror="this.style.display='none'" />` : '📦'}
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
    list.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted);">No hay pedidos registrados.</div>';
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
        ` : `<span style="text-transform:uppercase; font-weight:bold;">${o.status === 'completed' ? 'Completado ✅' : 'Anulado ❌'}</span>`}
      </div>
    </div>
  `).join('');
}

function renderReports() {
  const timeframe = document.getElementById('report-timeframe').value;
  const now = Date.now();
  let filtered = orders;
  if (timeframe !== 'all') {
    const ms = { day: 86400000, week: 604800000, month: 2592000000, semester: 15552000000 }[timeframe];
    filtered = orders.filter(o => now - o.timestamp < ms);
  }
  const completed = filtered.filter(o => o.status === 'completed');
  const pending = filtered.filter(o => !o.status || o.status === 'pending');
  
  const sum = (arr) => arr.reduce((t, o) => t + o.total, 0);
  const profit = (arr) => arr.reduce((t, o) => t + (o.total - (o.totalCost || 0)), 0);

  document.getElementById('report-revenue-total').textContent = formatMoney(sum(completed));
  document.getElementById('report-profit-total').textContent = formatMoney(profit(completed));
  document.getElementById('report-revenue-pending').textContent = formatMoney(sum(pending));
  document.getElementById('report-profit-pending').textContent = formatMoney(profit(pending));
}

function loadSettingsForm() {
  document.getElementById('settings-store-name').value = settings.storeName || '';
  document.getElementById('settings-tagline').value = settings.tagline || '';
  document.getElementById('settings-whatsapp').value = settings.whatsapp || '';
  document.getElementById('settings-color').value = settings.color || '#6c63ff';
  document.getElementById('settings-currency').value = settings.currency || 'COP';
  document.getElementById('settings-payment-info').value = settings.paymentInfo || '';
  document.getElementById('settings-admin-password').value = settings.adminPassword || '';
  if (settings.logo) {
    document.getElementById('settings-logo-preview').src = settings.logo;
    document.getElementById('settings-logo-preview').style.display = 'block';
    document.getElementById('logo-upload-placeholder').style.display = 'none';
  }
}

function openProductModal(id = null) {
  // Corrección: resetear estado antes de abrir el modal
  window.currentEditId = id;
  currentProductImages = [];
  
  const p = id ? products.find(x => x.id === id) : null;
  
  // Corrección de Manejo de Imágenes: cargar imágenes existentes ANTES de renderizar
  if (p) {
    currentProductImages = p.images ? [...p.images] : (p.image ? [p.image] : []);
  } else {
    currentProductImages = [];
  }
  
  document.getElementById('modal-product').style.display = 'flex';
  document.getElementById('modal-product-title').textContent = p ? 'Editar Producto' : 'Nuevo Producto';
  document.getElementById('product-name').value = p ? p.name : '';
  document.getElementById('product-ref').value = p ? (p.ref || '') : '';
  document.getElementById('product-category').value = p ? (p.category || '') : '';
  document.getElementById('product-price').value = p ? parseInt(p.price).toLocaleString('es-CO') : '';
  document.getElementById('product-cost').value = (p && p.cost) ? parseInt(p.cost).toLocaleString('es-CO') : '';
  document.getElementById('product-stock').value = p ? (p.stock || '') : '';
  document.getElementById('product-unit').value = p ? (p.unit || 'und') : 'und';
  document.getElementById('product-description').value = p ? (p.description || '') : '';
  document.getElementById('product-active').checked = p ? p.active : true;
  renderProductImagePreview();
  document.getElementById('btn-delete-product').style.display = p ? 'block' : 'none';
}

function renderProductImagePreview() {
  const container = document.getElementById('product-images-list');
  const trigger = document.getElementById('btn-trigger-upload');
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

// ====== MEJORAS FINALES DE RENDIMIENTO & COMPATIBILIDAD ======

// Helper para asignación segura de eventos
const safeListener = (id, event, fn) => {
  const el = document.getElementById(id);
  if (el) el[event] = fn;
};

// ====== VÍNCULO GLOBAL DE FUNCIONES (Necesario para <script type="module"> con eventos onclick en HTML) ======

// Función de eliminación explícita con actualización local y Firebase
function deleteProduct(id) {
  if (!id) return;
  // Eliminar del array local
  const idx = products.findIndex(p => p.id === id);
  if (idx !== -1) products.splice(idx, 1);
  // Eliminar de Firebase
  remove(ref(db, `products/${id}`));
  // Refrescar vista administrativa
  renderAdminProducts();
}

window.updateCart = updateCart;
window.openProductModal = openProductModal;
window.openImageModal = openImageModal;
window.deleteProduct = deleteProduct;

window.closeModal = (id) => {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
  // Solo resetear si es el modal de producto
  if (id === 'modal-product') {
    window.currentEditId = null;
    currentProductImages = [];
  }
};

window.closeImageModal = () => {
  const modal = document.getElementById('image-viewer-modal');
  if (modal) modal.style.display = 'none';
};

window.toggleDesc = (e, id) => {
  e.stopPropagation();
  const desc = document.getElementById(`desc-${id}`);
  if (desc) {
    desc.classList.toggle('collapsed');
    e.target.textContent = desc.classList.contains('collapsed') ? 'Ver más' : 'Ver menos';
  }
};

window.setViewerIndex = (idx) => {
  viewerIndex = idx;
  renderViewer();
};

// Acciones Administrativas
window.openAdmin = openAdmin;
window.closeAdmin = () => {
  const panel = document.getElementById('panel-admin');
  if (panel) panel.style.display = 'none';
};

window.removeProductImage = (idx) => {
  currentProductImages.splice(idx, 1);
  renderProductImagePreview();
};

window.confirmOrder = (id) => update(ref(db, `orders/${id}`), { status: 'completed' });
window.cancelOrder = (id) => update(ref(db, `orders/${id}`), { status: 'cancelled' });
window.copyPaymentInfo = () => {
  if (settings.paymentInfo) {
    navigator.clipboard.writeText(settings.paymentInfo);
    showToast('Copiado al portapapeles');
  }
};

// Listeners de Eventos con Protección contra nulos
safeListener('btn-close-admin', 'onclick', () => window.closeAdmin());
safeListener('admin-overlay', 'onclick', () => window.closeAdmin());
safeListener('btn-close-login-modal', 'onclick', () => {
  const modal = document.getElementById('modal-login');
  if (modal) modal.style.display = 'none';
  const passInput = document.getElementById('login-password');
  const errorMsg = document.getElementById('login-error');
  if (passInput) passInput.value = '';
  if (errorMsg) errorMsg.style.display = 'none';
});
safeListener('btn-close-product-modal', 'onclick', () => window.closeModal('modal-product'));
safeListener('btn-view-order', 'onclick', () => { switchView('order'); renderOrderList(); });
safeListener('btn-back-catalog', 'onclick', () => switchView('catalog'));
safeListener('btn-back-order', 'onclick', () => switchView('order'));
safeListener('btn-new-order', 'onclick', () => switchView('catalog'));

safeListener('btn-download-ticket', 'onclick', async () => {
  const ticket = document.getElementById('ticket-card');
  const btn = document.getElementById('btn-download-ticket');
  if (!ticket) return;

  // Ocultar botones temporalmente para que no aparezcan en la imagen
  const actions = document.querySelector('.ticket-actions');
  const header = document.querySelector('#view-ticket .page-header');
  if (actions) actions.style.visibility = 'hidden';
  if (header) header.style.visibility = 'hidden';
  btn.textContent = 'Generando...';
  btn.disabled = true;

  try {
    const canvas = await html2canvas(ticket, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    const link = document.createElement('a');
    const ticketNum = document.getElementById('ticket-number')?.textContent || 'ticket';
    link.download = `pedido-${ticketNum}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Ticket descargado ✅');
  } catch (err) {
    showToast('Error al generar imagen');
    console.error(err);
  } finally {
    if (actions) actions.style.visibility = '';
    if (header) header.style.visibility = '';
    btn.innerHTML = \`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar ticket\`;
    btn.disabled = false;
  }
});

safeListener('btn-open-admin', 'onclick', () => {
  if (settings.adminPassword) {
    const modal = document.getElementById('modal-login');
    if (modal) modal.style.display = 'flex';
  } else {
    openAdmin();
  }
});

// Acceso oculto por Triple Clic o Pulsación Larga en el Logo
let logoClicks = 0;
let logoTimer;
let logoPressTimer;

const triggerAdminAccess = () => {
  if (settings.adminPassword) {
    const modal = document.getElementById('modal-login');
    if (modal) modal.style.display = 'flex';
  } else {
    openAdmin();
  }
};

const logoEl = document.getElementById('header-logo-area');
if (logoEl) {
  // Método 1: Triple Clic
  logoEl.onclick = () => {
    logoClicks++;
    clearTimeout(logoTimer);
    if (logoClicks === 3) {
      logoClicks = 0;
      triggerAdminAccess();
    } else {
      logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
    }
  };

  // Método 2: Pulsación Larga (2 segundos)
  logoEl.onmousedown = logoEl.ontouchstart = () => {
    logoPressTimer = setTimeout(() => {
      triggerAdminAccess();
      showToast('Acceso administrativo detectado');
    }, 2000);
  };
  logoEl.onmouseup = logoEl.onmouseleave = logoEl.ontouchend = () => {
    clearTimeout(logoPressTimer);
  };
}

safeListener('btn-login-submit', 'onclick', () => {
  const passInput = document.getElementById('login-password');
  const errorMsg = document.getElementById('login-error');
  if (passInput && passInput.value === settings.adminPassword) {
    const modal = document.getElementById('modal-login');
    if (modal) modal.style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
    openAdmin();
  } else if (errorMsg) {
    errorMsg.style.display = 'block';
  }
});

safeListener('btn-trigger-upload', 'onclick', () => {
  const input = document.getElementById('product-file-input');
  if (input) input.click();
});

safeListener('product-file-input', 'onchange', async (e) => {
  const files = Array.from(e.target.files).slice(0, 5 - currentProductImages.length);
  const promises = files.map(file => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result);
      resolve(compressed);
    };
    reader.readAsDataURL(file);
  }));
  const newImages = await Promise.all(promises);
  newImages.forEach(img => {
    if (currentProductImages.length < 5) currentProductImages.push(img);
  });
  renderProductImagePreview();
  e.target.value = ''; // reset input para permitir subir la misma imagen otra vez
});

safeListener('btn-save-product', 'onclick', async () => {
  const nameEl = document.getElementById('product-name');
  const priceEl = document.getElementById('product-price');
  if (!nameEl || !priceEl) return;
  
  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value.replace(/\./g, '').replace(/,/g, ''));
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
  
  // Corrección 'Editar vs Crear': usar window.currentEditId estrictamente
  if (window.currentEditId) {
    // MODO EDICIÓN: actualizar el producto existente en el array local
    const existingIdx = products.findIndex(x => x.id === window.currentEditId);
    if (existingIdx !== -1) {
      pData.timestamp = products[existingIdx].timestamp || Date.now();
      // Actualizar en el array local usando map para inmutabilidad
      products = products.map(p =>
        p.id === window.currentEditId ? { ...p, ...pData, id: window.currentEditId } : p
      );
    } else {
      pData.timestamp = Date.now();
    }
    await update(ref(db, `products/${window.currentEditId}`), pData);
    showToast('Producto actualizado ✅');
  } else {
    // MODO CREACIÓN: solo si currentEditId es null/undefined
    pData.timestamp = Date.now();
    const newRef = await push(ref(db, 'products'), pData);
    // Agregar al array local con el ID generado por Firebase
    products.push({ ...pData, id: newRef.key });
    showToast('Producto creado ✅');
  }
  
  // Corrección Limpieza de Estado: resetear ID de edición al guardar
  window.currentEditId = null;
  currentProductImages = [];
  
  const modal = document.getElementById('modal-product');
  if (modal) modal.style.display = 'none';
  
  // Refrescar vista administrativa
  renderAdminProducts();
});

safeListener('btn-delete-product', 'onclick', () => {
  if (!window.currentEditId) return;
  if (confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) {
    const idToDelete = window.currentEditId;
    // Corrección: usar deleteProduct para mantener consistencia local + Firebase
    deleteProduct(idToDelete);
    // Corrección Limpieza de Estado
    window.currentEditId = null;
    currentProductImages = [];
    const modal = document.getElementById('modal-product');
    if (modal) modal.style.display = 'none';
    showToast('Producto eliminado');
  }
});

safeListener('btn-add-product', 'onclick', () => openProductModal(null));

safeListener('btn-save-settings', 'onclick', async () => {
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

safeListener('btn-generate-ticket', 'onclick', () => {
  const nameVal = document.getElementById('customer-name')?.value;
  const phoneVal = document.getElementById('customer-phone')?.value;
  if (!nameVal || !phoneVal) return showToast('Nombre y teléfono requeridos');
  
  const customer = {
    name: nameVal,
    phone: phoneVal,
    address: document.getElementById('customer-address')?.value || '',
    city: document.getElementById('customer-city')?.value || ''
  };
  
  const items = Object.entries(cart).map(([id, q]) => {
    const p = products.find(x => x.id === id);
    return { ...p, qty: q };
  });
  const total = items.reduce((t, i) => t + (i.price * i.qty), 0);
  const totalCost = items.reduce((t, i) => t + ((i.cost || 0) * i.qty), 0);

  const orderData = { customer, items, total, totalCost, timestamp: Date.now(), status: 'pending' };
  push(ref(db, 'orders'), orderData).then(() => {
    const ticketCustomerEl = document.getElementById('ticket-customer-name');
    if (ticketCustomerEl) ticketCustomerEl.textContent = customer.name;
    // ... más renders de ticket aquí si es necesario
    switchView('ticket');
    cart = {};
    updateCartUI();
  });
});

safeListener('product-price', 'oninput', formatInputCurrency);
safeListener('product-cost', 'oninput', formatInputCurrency);

let searchTimer;
safeListener('search-input', 'oninput', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderProducts, 150);
});

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

  // Registro del Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW error:', err));
    });
  }

  // Iniciar aplicación
  init();
}); // fin DOMContentLoaded
