// ====== FIREBASE SETUP ======
const firebaseConfig = {
  apiKey: "AIzaSyBRmLWFyczGQzPNe8iv9dbkJa_v6sylmxw",
  authDomain: "todo-en-uno-cf51e.firebaseapp.com",
  databaseURL: "https://todo-en-uno-cf51e-default-rtdb.firebaseio.com",
  projectId: "todo-en-uno-cf51e",
  storageBucket: "todo-en-uno-cf51e.firebasestorage.app",
  messagingSenderId: "974474634176",
  appId: "1:974474634176:web:8651006d4cf7df1cff9e25"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// State Management
let products = [];
let settings = {
  storeName: 'Mi Tienda',
  tagline: 'Pedidos por WhatsApp',
  whatsapp: '',
  color: '#6c63ff',
  currency: 'COP',
  logo: '',
  adminPassword: '',
  paymentInfo: '',
  paymentQR: ''
};
let orders = [];
let cart = {}; // { productId: quantity }
let currentFilter = 'all';
let currentProductImages = []; // Para manejar múltiples fotos en edición
let viewerImages = [];        // Para el visor de pantalla completa
let viewerIndex = 0;          // Índice actual en el visor


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

// Utils
const formatMoney = (amount) => {
  return settings.currency + (settings.currency.length > 1 ? ' ' : '') + parseFloat(amount).toLocaleString('es-CO');
};

const showToast = (msg) => {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3000);
};

const formatInputCurrency = (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value === "") {
    e.target.value = "";
    return;
  }
  e.target.value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
};

const switchView = (viewName) => {
  window.scrollTo(0, 0);
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');
};

// Initialization
function init() {
  // Listeners de Firebase
  db.ref('settings').on('value', snap => {
    if (snap.exists()) {
      settings = snap.val();
      // Migración automática de $ a COP si es necesario
      if (settings.currency === '$') {
        settings.currency = 'COP';
        db.ref('settings/currency').set('COP');
      }
      applySettings();
    }
  });

  db.ref('products').on('value', snap => {
    products = snap.val() || [];
    renderFilters();
    renderProducts();
    updateCartUI();
    if (document.getElementById('panel-admin').style.display === 'flex') {
      renderAdminProducts();
      if (typeof renderReports === 'function') renderReports();
    }
  });

  db.ref('orders').on('value', snap => {
    orders = snap.val() || [];
    if (document.getElementById('panel-admin').style.display === 'flex') {
      renderAdminOrders();
      if (typeof renderReports === 'function') renderReports();
    }
  });

  // Migración a Firebase de datos locales viejos (si existen)
  db.ref('products').once('value', snap => {
    if (!snap.exists() && localStorage.getItem('catalog_products')) {
      db.ref('products').set(JSON.parse(localStorage.getItem('catalog_products')));
    }
  });
  db.ref('settings').once('value', snap => {
    if (!snap.exists() && localStorage.getItem('catalog_settings')) {
      db.ref('settings').set(JSON.parse(localStorage.getItem('catalog_settings')));
    }
  });
  db.ref('orders').once('value', snap => {
    if (!snap.exists() && localStorage.getItem('catalog_orders')) {
      db.ref('orders').set(JSON.parse(localStorage.getItem('catalog_orders')));
    }
  });

  initColombiaLocations();
}

function initColombiaLocations() {
  const deptSelect = document.getElementById('customer-dept');
  const citySelect = document.getElementById('customer-city');
  
  if (typeof COLOMBIA_LOCATIONS === 'undefined') return;

  // Llenar departamentos
  Object.keys(COLOMBIA_LOCATIONS).sort().forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    deptSelect.appendChild(opt);
  });

  // Evento de cambio de departamento
  deptSelect.addEventListener('change', (e) => {
    const dept = e.target.value;
    citySelect.innerHTML = '<option value="">Selecciona municipio...</option>';
    if (dept && COLOMBIA_LOCATIONS[dept]) {
      COLOMBIA_LOCATIONS[dept].sort().forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });
      citySelect.disabled = false;
    } else {
      citySelect.disabled = true;
    }
  });
}

// Settings
function applySettings() {
  document.documentElement.style.setProperty('--primary', settings.color);
  
  // Extraer RGB para efectos de transparencia (Glassmorphism)
  const hex = settings.color.replace('#', '');
  const r = parseInt(hex.substring(0,2), 16);
  const g = parseInt(hex.substring(2,4), 16);
  const b = parseInt(hex.substring(4,6), 16);
  document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);

  document.getElementById('header-store-name').textContent = settings.storeName;
  document.getElementById('header-store-tagline').textContent = settings.tagline;
  
  const logoArea = document.getElementById('header-logo-area');
  if (settings.logo) {
    logoArea.innerHTML = `<img src="${settings.logo}" style="width:100%; height:100%; object-fit:contain;" />`;
  } else {
    logoArea.innerHTML = `<span class="logo-emoji">🛒</span>`;
  }
  
  const waBtn = document.getElementById('floating-wa-btn');
  if (waBtn) {
    if (settings.whatsapp) {
      waBtn.style.display = 'flex';
      waBtn.href = `https://wa.me/${settings.whatsapp}?text=Hola,%20tengo%20una%20pregunta%20sobre%20los%20productos%20de%20tu%20cat%C3%A1logo.`;
    } else {
      waBtn.style.display = 'none';
    }
  }
}

// Catalog Rendering
function renderFilters() {
  const categories = ['all', ...new Set(products.map(p => p.category).filter(c => c))];
  els.categoryFilters.innerHTML = categories.map(cat => `
    <button class="btn-category ${currentFilter === cat ? 'active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? 'Todos' : cat}
    </button>
  `).join('');

  document.querySelectorAll('.btn-category').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentFilter = e.target.dataset.cat;
      renderFilters();
      renderProducts();
    });
  });
}

function renderProducts() {
  let filtered = products.filter(p => p.active);
  const search = els.searchInput.value.toLowerCase();
  
  if (currentFilter !== 'all') {
    filtered = filtered.filter(p => p.category === currentFilter);
  }
  if (search) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
  }

  if (filtered.length === 0) {
    els.productsGrid.style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
  } else {
    els.productsGrid.style.display = 'grid';
    document.getElementById('empty-state').style.display = 'none';
    els.productsGrid.innerHTML = filtered.map(p => {
      const pImages = p.images || (p.image ? [p.image] : []);
      const mainImg = pImages[0];
      
      return `
      <div class="product-card">
        <div class="product-image-container" ${mainImg ? `onclick="openImageModal('${p.id}')" style="cursor:pointer;"` : ''}>
          ${mainImg ? `<img src="${mainImg}" style="width:100%;height:100%;object-fit:cover;" />` : '📦'}
          ${pImages.length > 1 ? `<div class="image-count-badge">1/${pImages.length}</div>` : ''}
        </div>
        <div class="product-info">
          ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
          <div class="product-title">${p.name} ${p.ref ? `<span style="color:var(--text-muted);font-size:0.75em;font-weight:normal;">[${p.ref}]</span>` : ''}</div>
          ${p.description ? `
            <div class="product-desc-wrapper">
              <div class="product-desc collapsed" id="desc-${p.id}">${p.description}</div>
              <button class="btn-more" onclick="toggleDesc(event, '${p.id}')" id="btn-more-${p.id}">Ver más</button>
            </div>
          ` : ''}
          ${p.stock !== undefined && p.stock !== '' && p.stock <= 2 && p.stock > 0 ? `<div class="product-badges"><span class="badge-warning">¡Últimas ${p.stock} unidades!</span></div>` : ''}
          ${p.stock !== undefined && p.stock !== '' && p.stock <= 0 ? `<div class="product-badges"><span class="badge-danger">Agotado</span></div>` : ''}
          <div class="product-bottom-section">
            <div class="product-price">
              <span class="price-currency">${settings.currency}</span>
              <span class="price-amount">${parseFloat(p.price).toLocaleString('es-CO')}</span>
              <span class="product-unit">/ ${p.unit}</span>
            </div>
            <div class="qty-controls" id="ctrl-${p.id}">
              ${cart[p.id] ? `
                <button class="btn-qty" onclick="updateCart('${p.id}', -1)">-</button>
                <span class="qty-display">${cart[p.id]}</span>
                <button class="btn-qty" onclick="updateCart('${p.id}', 1)" ${(p.stock !== undefined && p.stock !== '' && cart[p.id] >= p.stock) ? 'disabled' : ''}>+</button>
              ` : `
                <button class="btn-add" onclick="updateCart('${p.id}', 1)" ${(p.stock !== undefined && p.stock !== '' && p.stock <= 0) ? 'disabled' : ''}>
                  ${(p.stock !== undefined && p.stock !== '' && p.stock <= 0) ? 'Agotado' : 'Agregar'}
                </button>
              `}
            </div>
          </div>
        </div>
      </div>
      `;
    }).join('');
  }
}

els.searchInput.addEventListener('input', renderProducts);

window.toggleDesc = (e, id) => {
  e.stopPropagation();
  const desc = document.getElementById(`desc-${id}`);
  const btn = document.getElementById(`btn-more-${id}`);
  if (desc.classList.contains('collapsed')) {
    desc.classList.remove('collapsed');
    btn.textContent = 'Ver menos';
  } else {
    desc.classList.add('collapsed');
    btn.textContent = 'Ver más';
  }
};

// Cart Logic
window.updateCart = (productId, change) => {
  const p = products.find(prod => prod.id === productId);
  const current = cart[productId] || 0;
  const next = current + change;
  
  if (change > 0 && p.stock !== undefined && p.stock !== '' && next > p.stock) {
    showToast(`Solo quedan ${p.stock} unidades disponibles`);
    return;
  }

  if (next <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = next;
  }
  updateCartUI();
  renderProducts();
  
  // Si estamos en la vista de pedido, refrescar también esa lista
  if (views.order.classList.contains('active')) {
    renderOrderList();
    if (Object.keys(cart).length === 0) {
      switchView('catalog'); // Volver al catálogo si el carrito queda vacío
    }
  }
};

function getCartTotal() {
  return Object.entries(cart).reduce((total, [id, qty]) => {
    const p = products.find(p => p.id === id);
    return total + (p ? p.price * qty : 0);
  }, 0);
}

function updateCartUI() {
  const count = Object.values(cart).reduce((a,b)=>a+b, 0);
  if (count > 0) {
    els.cartBar.style.display = 'block';
    els.cartCount.textContent = count;
    els.cartTotal.textContent = formatMoney(getCartTotal());
  } else {
    els.cartBar.style.display = 'none';
  }
}

// Order View
document.getElementById('btn-view-order').addEventListener('click', () => {
  renderOrderList();
  switchView('order');
});

document.getElementById('btn-back-catalog').addEventListener('click', () => {
  switchView('catalog');
});

function renderOrderList() {
  const items = Object.entries(cart).map(([id, qty]) => {
    const p = products.find(p => p.id === id);
    if (!p) return '';
    return `
      <div class="order-item-row">
        <div class="order-item-info">
          <span class="order-item-name">${p.name}</span>
          <span class="order-item-price-unit">${formatMoney(p.price)} x unidad</span>
        </div>
        <div class="order-item-actions">
          <div class="qty-controls small">
            <button class="btn-qty" onclick="updateCart('${p.id}', -1)">-</button>
            <span class="qty-display">${qty}</span>
            <button class="btn-qty" onclick="updateCart('${p.id}', 1)" ${(p.stock !== undefined && p.stock !== '' && qty >= p.stock) ? 'disabled' : ''}>+</button>
          </div>
          <div class="order-item-subtotal">${formatMoney(p.price * qty)}</div>
          <button class="btn-remove-item" onclick="updateCart('${p.id}', -${qty})" title="Quitar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });
  els.orderList.innerHTML = items.join('');
  els.orderTotalAmount.textContent = formatMoney(getCartTotal());
}

// Ticket Generation
function generateTicketId() {
  return 'AG-' + Math.floor(100000 + Math.random() * 900000);
}

document.getElementById('btn-generate-ticket').addEventListener('click', () => {
  const nameInput = document.getElementById('customer-name').value.trim();
  const deptValue = document.getElementById('customer-dept').value;
  const cityValue = document.getElementById('customer-city').value;
  const barrioInput = document.getElementById('customer-barrio').value.trim();
  const addressInput = document.getElementById('customer-address').value.trim();
  const address2Input = document.getElementById('customer-address2').value.trim();
  const phoneInput = document.getElementById('customer-phone').value.trim();
  const zipInput = document.getElementById('customer-zip').value.trim();

  if (!nameInput || !deptValue || !cityValue || !barrioInput || !addressInput || !phoneInput) {
    showToast('Faltan campos obligatorios para el envío');
    if (!nameInput) document.getElementById('customer-name').focus();
    else if (!deptValue) document.getElementById('customer-dept').focus();
    else if (!cityValue) document.getElementById('customer-city').focus();
    else if (!barrioInput) document.getElementById('customer-barrio').focus();
    else if (!addressInput) document.getElementById('customer-address').focus();
    else document.getElementById('customer-phone').focus();
    return;
  }

  // Validación estricta para celular en Colombia (10 dígitos)
  if (phoneInput.length !== 10) {
    showToast('El celular debe tener exactamente 10 números');
    document.getElementById('customer-phone').focus();
    return;
  }

  const ticketId = generateTicketId();
  const date = new Date().toLocaleString('es-CO');
  const notes = document.getElementById('customer-notes').value.trim();

  // Populate ticket view
  document.getElementById('ticket-store-name').textContent = settings.storeName;
  document.getElementById('ticket-number').textContent = ticketId;
  document.getElementById('ticket-date').textContent = date;
  document.getElementById('ticket-customer-name').textContent = nameInput;
  document.getElementById('ticket-customer-phone').textContent = phoneInput;
  document.getElementById('ticket-customer-dept').textContent = deptValue;
  document.getElementById('ticket-customer-city').textContent = cityValue;
  document.getElementById('ticket-customer-barrio').textContent = barrioInput;
  document.getElementById('ticket-customer-address').textContent = addressInput;

  const addr2Wrapper = document.getElementById('ticket-address2-wrapper');
  if (address2Input) {
    document.getElementById('ticket-customer-address2').textContent = address2Input;
    addr2Wrapper.style.display = 'block';
  } else {
    addr2Wrapper.style.display = 'none';
  }

  const zipWrapper = document.getElementById('ticket-zip-wrapper');
  if (zipInput) {
    document.getElementById('ticket-customer-zip').textContent = zipInput;
    zipWrapper.style.display = 'block';
  } else {
    zipWrapper.style.display = 'none';
  }

  const logoArea = document.getElementById('ticket-logo');
  if (settings.logo) {
    logoArea.innerHTML = `<img src="${settings.logo}" style="width:48px;height:48px;border-radius:8px;object-fit:contain;" />`;
  }

  const ticketTotal = getCartTotal();
  const orderItemsInfo = [];

  const itemsHtml = Object.entries(cart).map(([id, qty]) => {
    const p = products.find(p => p.id === id);
    
    // Disminuir stock al generar el ticket (reservar)
    if (p.stock !== undefined && p.stock !== '') {
      p.stock -= qty;
    }
    orderItemsInfo.push(`${qty}x ${p.name}`);

    return `
      <div class="ticket-item">
        <div class="ticket-item-left">
          <span class="ticket-item-qty">${qty}</span>
          <span>${p.name} ${p.ref ? `[${p.ref}]` : ''}</span>
        </div>
        <span>${formatMoney(p.price * qty)}</span>
      </div>
    `;
  }).join('');
  document.getElementById('ticket-items').innerHTML = itemsHtml;
  
  // Shipping logic (Bogotá is free)
  const isBogota = cityValue.toLowerCase() === 'bogotá d.c.';
  document.getElementById('ticket-shipping-cost').textContent = isBogota ? 'Gratis' : 'Por calcular';
  document.getElementById('ticket-total').textContent = formatMoney(ticketTotal);

  if (notes) {
    document.getElementById('ticket-notes-wrapper').style.display = 'block';
    document.getElementById('ticket-note-text').textContent = 'Nota: ' + notes;
  } else {
    document.getElementById('ticket-notes-wrapper').style.display = 'none';
  }

  // Payment Info
  const paymentWrapper = document.getElementById('ticket-payment-wrapper');
  if (settings.paymentInfo || settings.paymentQR) {
    paymentWrapper.style.display = 'block';
    document.getElementById('ticket-payment-text').textContent = settings.paymentInfo || '';
    
    const qrWrapper = document.getElementById('ticket-qr-wrapper');
    if (settings.paymentQR) {
      qrWrapper.style.display = 'block';
      document.getElementById('ticket-qr-img').src = settings.paymentQR;
    } else {
      qrWrapper.style.display = 'none';
    }
  } else {
    paymentWrapper.style.display = 'none';
  }

  // Guardar pedido y actualizar stock
  const customerString = `${nameInput} | ${phoneInput} | ${cityValue}, ${deptValue} | ${barrioInput} | ${addressInput} ${address2Input}`;
  const newOrder = {
    id: ticketId,
    date,
    timestamp: Date.now(),
    customer: customerString,
    notes,
    total: ticketTotal,
    status: 'pending', // pending, completed, cancelled
    itemsInfo: orderItemsInfo.join(', '),
    cartCopy: { ...cart }
  };
  orders.unshift(newOrder);
  db.ref('orders').set(orders);
  saveProducts(); // Guarda el stock reducido
  
  // Set WhatsApp button data
  document.getElementById('btn-whatsapp').onclick = () => sendWhatsApp(ticketId, nameInput, notes);

  switchView('ticket');
});

document.getElementById('btn-back-order').addEventListener('click', () => switchView('order'));
document.getElementById('btn-new-order').addEventListener('click', () => {
  cart = {};
  document.getElementById('customer-name').value = '';
  document.getElementById('customer-dept').value = '';
  document.getElementById('customer-city').value = '';
  document.getElementById('customer-city').disabled = true;
  document.getElementById('customer-barrio').value = '';
  document.getElementById('customer-address').value = '';
  document.getElementById('customer-address2').value = '';
  document.getElementById('customer-phone').value = '';
  document.getElementById('customer-zip').value = '';
  document.getElementById('customer-notes').value = '';
  updateCartUI();
  renderProducts();
  switchView('catalog');
});

function sendWhatsApp(ticketId, customerName, notes) {
  if (!settings.whatsapp) {
    showToast('El comercio no ha configurado su WhatsApp');
    return;
  }

  const cartSummary = Object.entries(cart).map(([id, qty]) => {
    const p = products.find(x => x.id === id);
    return p ? `� ${qty}x ${p.name} - ${formatMoney(p.price * qty)}` : '';
  }).filter(Boolean).join('\n');

  const addr = document.getElementById('customer-address') ? document.getElementById('customer-address').value : '';
  const city = document.getElementById('customer-city') ? document.getElementById('customer-city').value : '';
  const dept = document.getElementById('customer-dept') ? document.getElementById('customer-dept').value : '';
  const phone = document.getElementById('customer-phone') ? document.getElementById('customer-phone').value : '';

  const total = getCartTotal();
  const waMsg = encodeURIComponent(
    '🛒 *NUEVO PEDIDO #' + ticketId + '*\n' +
    '👤 *Cliente:* ' + customerName + '\n' +
    '📞 *Cel:* ' + phone + '\n' +
    '📍 *Envío a:* ' + addr + ', ' + city + ', ' + dept + '\n\n' +
    '*Productos:*\n' + cartSummary + '\n\n' +
    '💰 *Total: ' + formatMoney(total) + '*' +
    (settings.paymentInfo ? '\n\n💳 *Método de Pago:* ' + settings.paymentInfo : '')
  );

  window.open(`https://wa.me/${settings.whatsapp}?text=${waMsg}`, '_blank');
}

/* ==============================================================
   ADMIN LOGIC
============================================================== */
const adminPanel = document.getElementById('panel-admin');
const modalLogin = document.getElementById('modal-login');
let currentEditId = null;

// Acceso secreto al panel (3 clics rápidos en el logo/nombre)
let adminClickCount = 0;
let adminClickTimer;
document.querySelector('.store-brand').addEventListener('click', () => {
  adminClickCount++;
  clearTimeout(adminClickTimer);
  if (adminClickCount >= 3) {
    adminClickCount = 0;
    if (settings.adminPassword) {
      modalLogin.style.display = 'flex';
    } else {
      openAdmin();
    }
  } else {
    adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 500);
  }
});

document.getElementById('btn-close-login-modal').addEventListener('click', () => modalLogin.style.display = 'none');
document.getElementById('btn-login-submit').addEventListener('click', () => {
  const pwd = document.getElementById('login-password').value;
  if (pwd === settings.adminPassword) {
    modalLogin.style.display = 'none';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
    openAdmin();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
});

document.getElementById('btn-close-admin').addEventListener('click', () => adminPanel.style.display = 'none');
document.getElementById('admin-overlay').addEventListener('click', () => adminPanel.style.display = 'none');

document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.admin-tab, .admin-tab-content').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    document.getElementById('tab-' + e.target.dataset.tab).classList.add('active');
  });
});

function openAdmin() {
  adminPanel.style.display = 'flex';
  renderAdminProducts();
  renderAdminOrders();
  renderReports();
  loadSettingsForm();
}

// Reports
function getOrderTimestampFallback(dateStr) {
  try {
    const parts = dateStr.split(',')[0].split('/');
    if (parts.length === 3) {
      return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    }
  } catch(e){}
  return 0;
}

function renderReports() {
  const timeframe = document.getElementById('report-timeframe').value;
  
  const now = new Date();
  let startTime = 0;
  
  if (timeframe === 'day') {
    startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  } else if (timeframe === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    startTime = new Date(now.getFullYear(), now.getMonth(), diff).getTime();
  } else if (timeframe === 'month') {
    startTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else if (timeframe === 'semester') {
    const semMonth = now.getMonth() < 6 ? 0 : 6;
    startTime = new Date(now.getFullYear(), semMonth, 1).getTime();
  }

  const soldMap = {};
  const cancelMap = {};
  let totalRevenue = 0;
  let pendingRevenue = 0;
  let totalProfit = 0;
  let pendingProfit = 0;
  
  products.forEach(p => {
    soldMap[p.id] = 0;
    cancelMap[p.id] = 0;
  });

  orders.forEach(o => {
    const t = o.timestamp || getOrderTimestampFallback(o.date);
    if (t >= startTime) {
      if (o.status === 'completed') {
        totalRevenue += o.total || 0;
      } else if (o.status === 'pending') {
        pendingRevenue += o.total || 0;
      }

      if (o.cartCopy) {
        Object.entries(o.cartCopy).forEach(([prodId, qty]) => {
          const p = products.find(p => p && p.id === prodId);
          const cost = (p && p.cost) ? p.cost : 0;
          const price = (p && p.price) ? p.price : 0;
          const profit = (price - cost) * qty;

          if (o.status === 'completed') {
             soldMap[prodId] = (soldMap[prodId] || 0) + qty;
             totalProfit += profit;
          } else if (o.status === 'pending') {
             soldMap[prodId] = (soldMap[prodId] || 0) + qty;
             pendingProfit += profit;
          } else if (o.status === 'cancelled') {
             cancelMap[prodId] = (cancelMap[prodId] || 0) + qty;
          }
        });
      }
    }
  });

  const getProdName = (id) => {
    const p = products.find(x => x.id === id);
    return p ? `${p.name} ${p.ref ? `[${p.ref}]` : ''}` : 'Producto eliminado';
  };

  const mostSold = Object.entries(soldMap).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]);
  const mostCancelled = Object.entries(cancelMap).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]);
  const noSales = products.filter(p => soldMap[p.id] === 0);

  const renderList = (arr, isQty = true) => arr.length ? arr.map(x => `
    <div class="report-item">
      <span>${isQty ? getProdName(x[0]) : `${x.name} ${x.ref ? `[${x.ref}]` : ''}`}</span>
      ${isQty ? `<span class="report-qty">${x[1]} und</span>` : `<span class="report-qty" style="color:var(--text-muted)">0 ventas</span>`}
    </div>
  `).join('') : '<div class="report-item" style="color:var(--text-muted)">Sin datos en este periodo</div>';

  document.getElementById('report-most-sold').innerHTML = renderList(mostSold);
  document.getElementById('report-most-cancelled').innerHTML = renderList(mostCancelled);
  document.getElementById('report-no-sales').innerHTML = renderList(noSales, false);
  document.getElementById('report-revenue-total').textContent = formatMoney(totalRevenue);
  document.getElementById('report-profit-total').textContent = formatMoney(totalProfit);
  document.getElementById('report-revenue-pending').textContent = formatMoney(pendingRevenue);
  document.getElementById('report-profit-pending').textContent = formatMoney(pendingProfit);
}

document.getElementById('report-timeframe').addEventListener('change', renderReports);

// Admin Orders
function renderAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (orders.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);margin-top:2rem;">No hay pedidos todavía</p>';
    return;
  }

  list.innerHTML = orders.map(o => `
    <div class="admin-order-card ${o.status}">
      <div class="admin-order-header">
        <span class="admin-order-id">${o.id}</span>
        <span class="admin-order-date">${o.date}</span>
      </div>
      <div class="admin-order-customer">👤 ${o.customer}</div>
      <div class="admin-order-items">${o.itemsInfo}</div>
      ${o.notes ? `<div style="font-size:0.8rem;background:var(--bg);padding:0.5rem;border-radius:4px;margin-bottom:0.5rem"><i>Nota: ${o.notes}</i></div>` : ''}
      <div class="admin-order-total">${formatMoney(o.total)}</div>
      
      ${o.status === 'pending' ? `
        <div class="admin-order-actions">
          <button class="btn-order-action btn-order-cancel" id="btn-cancel-${o.id}" onclick="cancelOrder('${o.id}')">Cancelar (Devolver Stock)</button>
          <button class="btn-order-action btn-order-confirm" onclick="confirmOrder('${o.id}')">Confirmar Venta</button>
        </div>
      ` : `
        <div style="font-weight:600; text-align:center; color: ${o.status === 'completed' ? 'var(--success)' : 'var(--danger)'}">
          ${o.status === 'completed' ? '✅ Venta Completada' : '❌ Pedido Cancelado'}
        </div>
      `}
    </div>
  `).join('');
}

window.cancelOrder = (id, confirmed = false) => {
  try {
    if (!confirmed) {
      const btn = document.getElementById(`btn-cancel-${id}`);
      if (btn) {
        btn.innerHTML = 'Confirmar Cancelación';
        btn.style.background = 'var(--danger)';
        btn.style.color = 'white';
        btn.onclick = () => cancelOrder(id, true);
        
        // Regresar a la normalidad en 3 segundos si no confirma
        setTimeout(() => {
          const checkBtn = document.getElementById(`btn-cancel-${id}`);
          if (checkBtn && orders.find(o => o.id === id)?.status === 'pending') {
            checkBtn.innerHTML = 'Cancelar (Devolver Stock)';
            checkBtn.style.background = 'var(--surface)';
            checkBtn.style.color = 'var(--danger)';
            checkBtn.onclick = () => cancelOrder(id, false);
          }
        }, 3000);
      }
      return;
    }

    const orderIndex = orders.findIndex(o => o.id === id);
    if (orderIndex > -1) {
      // Devolver stock
      if (orders[orderIndex] && orders[orderIndex].cartCopy) {
        Object.entries(orders[orderIndex].cartCopy).forEach(([prodId, qty]) => {
          const p = products.find(p => p && p.id === prodId);
          if (p && p.stock !== undefined && p.stock !== '') {
            p.stock += qty;
          }
        });
      }
      orders[orderIndex].status = 'cancelled';
      db.ref('orders').set(orders);
      saveProducts();
      renderAdminOrders();
      renderProducts();
      showToast('Pedido cancelado');
    }
  } catch (err) {
    alert('Error al cancelar: ' + err.message);
    console.error(err);
  }
};

window.confirmOrder = (id) => {
  const orderIndex = orders.findIndex(o => o.id === id);
  if (orderIndex > -1) {
    orders[orderIndex].status = 'completed';
    db.ref('orders').set(orders);
    renderAdminOrders();
    showToast('Venta confirmada');
  }
};

// Admin Products
function renderAdminProducts() {
  const list = document.getElementById('admin-products-list');
  list.innerHTML = products.map(p => {
    const pImages = p.images || (p.image ? [p.image] : []);
    const mainImg = pImages[0];
    return `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">
        ${mainImg ? `<img src="${mainImg}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />` : '📦'}
      </div>
      <div class="admin-product-info">
        <div class="admin-product-title">${p.name} ${p.ref ? `<span style="font-weight:normal;font-size:0.85em;color:var(--text-muted);">[${p.ref}]</span>` : ''} ${!p.active ? '<span class="badge-inactive">Oculto</span>' : ''}</div>
        <div class="admin-product-price">${formatMoney(p.price)} / ${p.unit} ${p.stock !== undefined && p.stock !== '' ? `| 📦 ${p.stock}` : ''}</div>
      </div>
    </div>
    `;
  }).join('');
}

// Product Modal
const productModal = document.getElementById('modal-product');
document.getElementById('btn-add-product').addEventListener('click', () => openProductModal());
document.getElementById('btn-close-product-modal').addEventListener('click', () => productModal.style.display = 'none');

function openProductModal(id = null) {
  currentEditId = id;
  const title = document.getElementById('modal-product-title');
  const btnDelete = document.getElementById('btn-delete-product');
  
  currentProductImages = [];
  const categories = [...new Set(products.map(p => p.category).filter(c => c))];
  document.getElementById('categories-datalist').innerHTML = categories.map(c => `<option value="${c}">`).join('');

  if (id) {
    const p = products.find(x => x.id === id);
    title.textContent = 'Editar producto';
    btnDelete.style.display = 'block';
    
    document.getElementById('product-name').value = p.name;
    document.getElementById('product-ref').value = p.ref || '';
    document.getElementById('product-category').value = p.category || '';
    document.getElementById('product-price').value = (p.price !== undefined && p.price !== null && p.price !== '') ? parseInt(p.price).toLocaleString('es-CO') : '';
    document.getElementById('product-cost').value = (p.cost !== undefined && p.cost !== null && p.cost !== '') ? parseInt(p.cost).toLocaleString('es-CO') : '';
    document.getElementById('product-stock').value = p.stock !== undefined ? p.stock : '';
    document.getElementById('product-unit').value = p.unit;
    document.getElementById('product-description').value = p.description || '';
    document.getElementById('product-active').checked = p.active;
    
    currentProductImages = p.images || (p.image ? [p.image] : []);
  } else {
    title.textContent = 'Nuevo producto';
    btnDelete.style.display = 'none';
    
    document.getElementById('product-name').value = '';
    document.getElementById('product-ref').value = '';
    document.getElementById('product-category').value = '';
    document.getElementById('product-price').value = '';
    document.getElementById('product-cost').value = '';
    document.getElementById('product-stock').value = '';
    document.getElementById('product-unit').value = 'und';
    document.getElementById('product-description').value = '';
    document.getElementById('product-active').checked = true;
  }
  
  renderProductImagePreview();
  productModal.style.display = 'flex';
}

function renderProductImagePreview() {
  const list = document.getElementById('product-images-list');
  const trigger = document.getElementById('btn-trigger-upload');
  const existingItems = list.querySelectorAll('.multi-image-item');
  existingItems.forEach(item => item.remove());

  currentProductImages.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'multi-image-item';
    div.innerHTML = `
      <img src="${img}" style="width:100%;height:100%;object-fit:cover;" />
      <button class="btn-remove-image" onclick="removeProductImage(${idx})">&times;</button>
    `;
    list.insertBefore(div, trigger);
  });
  trigger.style.display = currentProductImages.length >= 5 ? 'none' : 'flex';
}

window.removeProductImage = (idx) => {
  currentProductImages.splice(idx, 1);
  renderProductImagePreview();
};

document.getElementById('btn-trigger-upload').onclick = () => document.getElementById('product-file-input').click();

document.getElementById('product-file-input').onchange = function(e) {
  const files = e.target.files;
  if (!files.length) return;
  Array.from(files).forEach(file => {
    if (currentProductImages.length >= 5) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      currentProductImages.push(ev.target.result);
      renderProductImagePreview();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
};

document.getElementById('btn-save-product').addEventListener('click', () => {
  const name = document.getElementById('product-name').value.trim();
  const priceRaw = document.getElementById('product-price').value.replace(/\./g, '');
  const price = parseFloat(priceRaw);
  const costVal = document.getElementById('product-cost').value.replace(/\./g, '');
  const cost = costVal !== '' ? parseFloat(costVal) : 0;
  
  if (!name || isNaN(price)) {
    showToast('Nombre y precio son obligatorios');
    return;
  }

  const productData = {
    id: currentEditId || 'P' + Date.now(),
    name,
    ref: document.getElementById('product-ref').value.trim(),
    category: document.getElementById('product-category').value.trim(),
    price,
    cost,
    stock: document.getElementById('product-stock').value !== '' ? parseInt(document.getElementById('product-stock').value) : '',
    unit: document.getElementById('product-unit').value,
    description: document.getElementById('product-description').value.trim(),
    active: document.getElementById('product-active').checked,
    images: currentProductImages
  };

  if (currentEditId) {
    products = products.map(p => p.id === currentEditId ? productData : p);
  } else {
    products.push(productData);
  }

  saveProducts();
  renderAdminProducts();
  renderFilters();
  renderProducts();
  productModal.style.display = 'none';
  showToast('Producto guardado');
});

document.getElementById('btn-delete-product').addEventListener('click', () => {
  if (confirm('¿Eliminar este producto?')) {
    products = products.filter(p => p.id !== currentEditId);
    delete cart[currentEditId];
    saveProducts();
    renderAdminProducts();
    renderFilters();
    renderProducts();
    updateCartUI();
    productModal.style.display = 'none';
    showToast('Producto eliminado');
  }
});

function saveProducts() {
  db.ref('products').set(products);
}



// Settings Form
function loadSettingsForm() {
  document.getElementById('settings-store-name').value = settings.storeName;
  document.getElementById('settings-tagline').value = settings.tagline;
  document.getElementById('settings-whatsapp').value = settings.whatsapp;
  document.getElementById('settings-color').value = settings.color;
  document.getElementById('settings-color-preview').textContent = settings.color;
  document.getElementById('settings-currency').value = settings.currency;
  document.getElementById('settings-admin-password').value = settings.adminPassword || '';
  document.getElementById('settings-payment-info').value = settings.paymentInfo || '';
  
  if (settings.paymentQR) {
    const img = document.getElementById('settings-qr-preview');
    img.src = settings.paymentQR;
    img.style.display = 'block';
    document.getElementById('qr-upload-placeholder').style.display = 'none';
  } else {
    document.getElementById('settings-qr-preview').style.display = 'none';
    document.getElementById('qr-upload-placeholder').style.display = 'flex';
  }

  if (settings.logo) {
    const img = document.getElementById('settings-logo-preview');
    img.src = settings.logo;
    img.style.display = 'block';
    document.getElementById('logo-upload-placeholder').style.display = 'none';
  }
}

document.getElementById('settings-color').addEventListener('input', (e) => {
  document.getElementById('settings-color-preview').textContent = e.target.value;
});

document.getElementById('logo-upload-area').addEventListener('click', () => {
  document.getElementById('logo-file-input').click();
});

document.getElementById('qr-upload-area').addEventListener('click', () => {
  document.getElementById('qr-file-input').click();
});

document.getElementById('qr-file-input').addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('settings-qr-preview').src = ev.target.result;
      document.getElementById('settings-qr-preview').style.display = 'block';
      document.getElementById('qr-upload-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(e.target.files[0]);
  }
});

// Image Modal Fullscreen with Multiple Images
window.openImageModal = function(productId) {
  const p = products.find(prod => prod.id === productId);
  if (!p) return;
  
  viewerImages = p.images || (p.image ? [p.image] : []);
  if (viewerImages.length === 0) return;
  
  viewerIndex = 0;
  renderViewer();
  document.getElementById('image-viewer-modal').style.display = 'flex';
};

function renderViewer() {
  const img = document.getElementById('image-viewer-img');
  const prevBtn = document.getElementById('btn-viewer-prev');
  const nextBtn = document.getElementById('btn-viewer-next');
  const thumbnails = document.getElementById('viewer-thumbnails');

  img.src = viewerImages[viewerIndex];
  
  prevBtn.style.display = viewerImages.length > 1 ? 'block' : 'none';
  nextBtn.style.display = viewerImages.length > 1 ? 'block' : 'none';

  thumbnails.innerHTML = viewerImages.map((src, idx) => `
    <div class="multi-image-item ${idx === viewerIndex ? 'active' : ''}" onclick="setViewerIndex(${idx})" style="width:50px; height:50px; cursor:pointer;">
      <img src="${src}" style="width:100%;height:100%;object-fit:cover;" />
    </div>
  `).join('');
}

window.setViewerIndex = (idx) => {
  viewerIndex = idx;
  renderViewer();
};

document.getElementById('btn-viewer-prev').onclick = (e) => {
  e.stopPropagation();
  viewerIndex = (viewerIndex - 1 + viewerImages.length) % viewerImages.length;
  renderViewer();
};

document.getElementById('btn-viewer-next').onclick = (e) => {
  e.stopPropagation();
  viewerIndex = (viewerIndex + 1) % viewerImages.length;
  renderViewer();
};

window.closeImageModal = function() {
  document.getElementById('image-viewer-modal').style.display = 'none';
};

window.copyPaymentInfo = function() {
  const text = settings.paymentInfo;
  if (!text) return;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('Datos de pago copiados');
  }).catch(err => {
    // Fallback para navegadores antiguos
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Datos de pago copiados');
    } catch (err) {
      console.error('Error al copiar', err);
    }
    document.body.removeChild(textArea);
  });
};

document.getElementById('logo-file-input').addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      const img = document.getElementById('settings-logo-preview');
      img.src = evt.target.result;
      img.style.display = 'block';
      document.getElementById('logo-upload-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(e.target.files[0]);
  }
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
  settings = {
    storeName: document.getElementById('settings-store-name').value.trim() || 'Mi Tienda',
    tagline: document.getElementById('settings-tagline').value.trim(),
    whatsapp: document.getElementById('settings-whatsapp').value.trim().replace(/\D/g, ''),
    color: document.getElementById('settings-color').value,
    currency: document.getElementById('settings-currency').value,
    adminPassword: document.getElementById('settings-admin-password').value,
    paymentInfo: document.getElementById('settings-payment-info').value.trim(),
    paymentQR: document.getElementById('settings-qr-preview').src || '',
    logo: document.getElementById('settings-logo-preview').src || ''
  };
  
  if(settings.paymentQR.endsWith(window.location.host + '/') || !document.getElementById('settings-qr-preview').style.display === 'block'){
      settings.paymentQR = '';
  }
  
  if(settings.logo.endsWith(window.location.host + '/') || !document.getElementById('settings-logo-preview').style.display === 'block'){
      settings.logo = '';
  }

  db.ref('settings').set(settings);
  applySettings();
  renderProducts(); // Re-render for currency change
  updateCartUI(); // Re-render cart total
  showToast('Configuración guardada');
});

// Listeners para formateo de miles en tiempo real
document.getElementById('product-price').addEventListener('input', formatInputCurrency);
document.getElementById('product-cost').addEventListener('input', formatInputCurrency);

// Boot
init();
