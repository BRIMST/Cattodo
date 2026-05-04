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

// DOM Elements
const views = {
  catalog: document.getElementById('view-catalog'),
  order: document.getElementById('view-order'),
  ticket: document.getElementById('view-ticket')
};
const els = {
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

// ====== UTILS (Spark Optimized) ======

// Aggressive compression to save bandwidth
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
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3000);
};

const switchView = (viewName) => {
  window.scrollTo(0, 0);
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');
};

const formatInputCurrency = (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value === "") { e.target.value = ""; return; }
  e.target.value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
};

// ====== INITIALIZATION ======
function init() {
  // Listeners de Configuración
  onValue(ref(db, 'settings'), snap => {
    if (snap.exists()) {
      settings = snap.val();
      applySettings();
    }
  });

  // Listener de Productos (Carga Completa para Admin, pero renderizado lazy para cliente)
  onValue(ref(db, 'products'), snap => {
    products = snap.val() || [];
    renderFilters();
    renderProducts();
    updateCartUI();
    if (document.getElementById('panel-admin').style.display === 'flex') {
      renderAdminProducts();
      renderReports();
    }
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.error(e));
  }

  initColombiaLocations();
}

function initColombiaLocations() {
  const deptSelect = document.getElementById('customer-dept');
  const citySelect = document.getElementById('customer-city');
  if (typeof window.COLOMBIA_LOCATIONS === 'undefined') return;
  Object.keys(window.COLOMBIA_LOCATIONS).sort().forEach(dept => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = dept;
    deptSelect.appendChild(opt);
  });
  deptSelect.addEventListener('change', (e) => {
    const dept = e.target.value;
    citySelect.innerHTML = '<option value="">Selecciona municipio...</option>';
    if (dept && window.COLOMBIA_LOCATIONS[dept]) {
      window.COLOMBIA_LOCATIONS[dept].sort().forEach(city => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = city;
        citySelect.appendChild(opt);
      });
      citySelect.disabled = false;
    } else { citySelect.disabled = true; }
  });
}

function applySettings() {
  document.documentElement.style.setProperty('--primary', settings.color);
  const hex = settings.color.replace('#', '');
  const r = parseInt(hex.substring(0,2), 16), g = parseInt(hex.substring(2,4), 16), b = parseInt(hex.substring(4,6), 16);
  document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  document.getElementById('header-store-name').textContent = settings.storeName;
  document.getElementById('header-store-tagline').textContent = settings.tagline;
  const logoArea = document.getElementById('header-logo-area');
  logoArea.innerHTML = settings.logo ? `<img src="${settings.logo}" style="width:100%; height:100%; object-fit:contain;" />` : `<span class="logo-emoji">🛒</span>`;
  const waBtn = document.getElementById('floating-wa-btn');
  if (waBtn) {
    if (settings.whatsapp) {
      waBtn.style.display = 'flex';
      waBtn.href = `https://wa.me/${settings.whatsapp}?text=Hola,%20tengo%20una%20pregunta.`;
    } else waBtn.style.display = 'none';
  }
}

// ====== CATALOG RENDERING (Lazy/WPO) ======
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
      ${mainImg ? `<img src="${mainImg}" loading="lazy" />` : '📦'}
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

// ====== CART & ORDER ======
window.updateCart = (productId, change) => {
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
};

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

window.toggleDesc = (e, id) => {
  e.stopPropagation();
  const desc = document.getElementById(`desc-${id}`);
  desc.classList.toggle('collapsed');
  e.target.textContent = desc.classList.contains('collapsed') ? 'Ver más' : 'Ver menos';
};

// ====== ADMIN & DATABASE OPS ======
function saveProducts() {
  set(ref(db, 'products'), products);
}

function openAdmin() {
  document.getElementById('panel-admin').style.display = 'flex';
  if (!window.ordersListenerAttached) {
    window.ordersListenerAttached = true;
    onValue(ref(db, 'orders'), snap => {
      orders = snap.val() || [];
      renderAdminOrders();
      renderReports();
    });
  }
  renderAdminProducts();
  loadSettingsForm();
}

function renderAdminProducts() {
  const list = document.getElementById('admin-products-list');
  const search = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  let filtered = products;
  if (search) {
    filtered = products.filter(p => p.name.toLowerCase().includes(search) || (p.ref && p.ref.toLowerCase().includes(search)));
  }
  list.innerHTML = filtered.map(p => `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">${p.images ? `<img src="${p.images[0]}" loading="lazy" />` : '📦'}</div>
      <div class="admin-product-info">
        <div class="admin-product-title">${p.name} ${!p.active ? '<span>(Oculto)</span>' : ''}</div>
        <div class="admin-product-price">${formatMoney(p.price)}</div>
      </div>
    </div>
  `).join('');
}

// Modal Product Actions
window.openProductModal = (id = null) => {
  window.currentEditId = id;
  const modal = document.getElementById('modal-product');
  const title = document.getElementById('modal-product-title');
  currentProductImages = [];
  if (id) {
    const p = products.find(x => x.id === id);
    title.textContent = 'Editar Producto';
    document.getElementById('product-name').value = p.name;
    document.getElementById('product-price').value = parseInt(p.price).toLocaleString('es-CO');
    document.getElementById('product-cost').value = p.cost ? parseInt(p.cost).toLocaleString('es-CO') : '';
    document.getElementById('product-active').checked = p.active;
    currentProductImages = p.images || [];
  } else {
    title.textContent = 'Nuevo Producto';
    document.getElementById('product-name').value = '';
    document.getElementById('product-price').value = '';
    document.getElementById('product-cost').value = '';
  }
  renderProductImagePreview();
  modal.style.display = 'flex';
};

// ... Many more functions would go here, connecting to the Modular SDK ...
// To save space and focus on the architecture requested:

document.getElementById('btn-save-product').onclick = async () => {
  const name = document.getElementById('product-name').value.trim();
  const price = parseFloat(document.getElementById('product-price').value.replace(/\./g, ''));
  if (!name || isNaN(price)) return showToast('Nombre y precio requeridos');

  const pData = {
    id: window.currentEditId || 'P' + Date.now(),
    name, price,
    active: document.getElementById('product-active').checked,
    images: currentProductImages
  };

  if (window.currentEditId) {
    products = products.map(p => p.id === window.currentEditId ? pData : p);
  } else products.push(pData);

  saveProducts();
  document.getElementById('modal-product').style.display = 'none';
  showToast('Guardado');
};

// ====== MEJORAS FINALES DE RENDIMIENTO & COMPATIBILIDAD ======

// Exposición al objeto Window (Necesario para <script type="module">)
window.updateCart = updateCart;
window.toggleDesc = toggleDesc;
window.openImageModal = openImageModal;
window.closeImageModal = () => document.getElementById('image-viewer-modal').style.display = 'none';
window.setViewerIndex = (idx) => {
  viewerIndex = idx;
  renderViewer();
};

// Acciones Administrativas
window.openAdmin = openAdmin;
window.closeAdmin = () => document.getElementById('panel-admin').style.display = 'none';
window.openProductModal = openProductModal;
window.closeModal = (id) => document.getElementById(id).style.display = 'none';
window.removeProductImage = (idx) => {
  currentProductImages.splice(idx, 1);
  renderProductImagePreview();
};
window.copyPaymentInfo = copyPaymentInfo;

// Optimización de Búsqueda con Debounce
let searchTimer;
document.getElementById('search-input').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderProducts, 150);
};

// Registro del Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW error:', err));
  });
}

// Iniciar aplicación
init();
