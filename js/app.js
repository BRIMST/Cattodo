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
  currency: '$',
  logo: '',
  adminPassword: ''
};
let orders = [];
let cart = {}; // { productId: quantity }
let currentFilter = 'all';

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
  return settings.currency + parseFloat(amount).toLocaleString('es-CO');
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

// Initialization
function init() {
  // Listeners de Firebase
  db.ref('settings').on('value', snap => {
    if (snap.exists()) {
      settings = snap.val();
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
  
  // Extract hue to use in CSS
  const hex = settings.color.replace('#', '');
  const r = parseInt(hex.substring(0,2), 16) / 255;
  const g = parseInt(hex.substring(2,4), 16) / 255;
  const b = parseInt(hex.substring(4,6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch(max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  document.documentElement.style.setProperty('--hue', Math.round(h * 360));

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
    els.productsGrid.innerHTML = filtered.map(p => `
      <div class="product-card">
        <div class="product-image" ${p.image ? `onclick="openImageModal('${p.image}')" style="cursor:pointer;"` : ''}>
          ${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;" />` : '📦'}
        </div>
        <div class="product-info">
          ${p.category ? `<div class="product-category-label">${p.category}</div>` : ''}
          <div class="product-title">${p.name} ${p.ref ? `<span style="color:var(--text-muted);font-size:0.75em;font-weight:normal;">[${p.ref}]</span>` : ''}</div>
          <div class="product-desc">${p.description || ''}</div>
          ${p.stock !== undefined && p.stock !== '' && p.stock <= 2 && p.stock > 0 ? `<div class="product-badges"><span class="badge-warning">¡Últimas ${p.stock} unidades!</span></div>` : ''}
          ${p.stock !== undefined && p.stock !== '' && p.stock <= 0 ? `<div class="product-badges"><span class="badge-danger">Agotado</span></div>` : ''}
          <div class="product-price-row">
            <span class="product-price">${formatMoney(p.price)}</span>
            <span class="product-unit">/ ${p.unit}</span>
          </div>
          <div class="qty-controls" id="ctrl-${p.id}">
            ${cart[p.id] ? `
              <button class="btn-qty" onclick="updateCart('${p.id}', -1)">-</button>
              <span class="qty-display">${cart[p.id]}</span>
              <button class="btn-qty" onclick="updateCart('${p.id}', 1)" ${(p.stock !== undefined && p.stock !== '' && cart[p.id] >= p.stock) ? 'disabled' : ''}>+</button>
            ` : `
              <button class="btn-add" onclick="updateCart('${p.id}', 1)" ${(p.stock !== undefined && p.stock !== '' && p.stock <= 0) ? 'disabled style="background:var(--text-muted);cursor:not-allowed;"' : ''}>
                ${(p.stock !== undefined && p.stock !== '' && p.stock <= 0) ? 'Agotado' : 'Agregar'}
              </button>
            `}
          </div>
        </div>
      </div>
    `).join('');
  }
}

els.searchInput.addEventListener('input', renderProducts);

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
    return `
      <div class="order-item-row">
        <span class="order-item-qty">${qty}x</span>
        <span class="order-item-name">${p.name} ${p.ref ? `<small>(${p.ref})</small>` : ''}</span>
        <span class="order-item-price">${formatMoney(p.price * qty)}</span>
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

  const btn = document.getElementById('btn-whatsapp');
  btn.disabled = true;
  btn.innerHTML = 'Generando imagen...';

  // Generar imagen con html2canvas
  html2canvas(document.getElementById('ticket-card'), {
    backgroundColor: '#ffffff',
    scale: 2 // Mejor calidad
  }).then(canvas => {
    
    canvas.toBlob(async (blob) => {
      const file = new File([blob], `Ticket_${ticketId}.png`, { type: 'image/png' });
      let shared = false;

      // 1. Intentar compartir de forma nativa (Ideal para celulares)
      // Esto abrirá el menú del sistema donde el cliente elige WhatsApp y la imagen se adjunta sola.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Pedido ${ticketId}`
          });
          shared = true;
        } catch (e) {
          console.log('Share cancelado o fallido', e);
        }
      }

      // 2. Si es PC o falló el compartir nativo
      if (!shared) {
        let copied = false;
        try {
          // Intentar copiar la imagen al portapapeles
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          copied = true;
          showToast('¡Ticket copiado! Entra al chat y presiona Pegar (Ctrl+V)');
        } catch (e) {
          console.log('No se pudo copiar al portapapeles', e);
          // Fallback: Descargar la imagen
          const imgData = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `Ticket_${ticketId}.png`;
          link.href = imgData;
          link.click();
          showToast('Ticket descargado. Adjúntalo en el chat.');
        }

        // Abrir WhatsApp directamente (sin texto, solo para enviar la imagen)
        setTimeout(() => {
          window.open(`https://wa.me/${settings.whatsapp}`, '_blank');
        }, copied ? 2000 : 1500);
      }

      btn.disabled = false;
      btn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
        </svg>
        Enviar por WhatsApp
      `;
    }, 'image/png');

  }).catch(err => {
    console.error('Error generando imagen:', err);
    btn.disabled = false;
    btn.innerHTML = 'Enviar por WhatsApp';
    showToast('Error al generar la imagen');
  });
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
  list.innerHTML = products.map(p => `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">
        ${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />` : '📦'}
      </div>
      <div class="admin-product-info">
        <div class="admin-product-title">${p.name} ${p.ref ? `<span style="font-weight:normal;font-size:0.85em;color:var(--text-muted);">[${p.ref}]</span>` : ''} ${!p.active ? '<span class="badge-inactive">Oculto</span>' : ''}</div>
        <div class="admin-product-price">${formatMoney(p.price)} / ${p.unit} ${p.stock !== undefined && p.stock !== '' ? `| 📦 ${p.stock}` : ''}</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  `).join('');
}

// Product Modal
const productModal = document.getElementById('modal-product');
document.getElementById('btn-add-product').addEventListener('click', () => openProductModal());
document.getElementById('btn-close-product-modal').addEventListener('click', () => productModal.style.display = 'none');

function openProductModal(id = null) {
  currentEditId = id;
  const title = document.getElementById('modal-product-title');
  const btnDelete = document.getElementById('btn-delete-product');
  
  // Populate datalist for categories
  const categories = [...new Set(products.map(p => p.category).filter(c => c))];
  document.getElementById('categories-datalist').innerHTML = categories.map(c => `<option value="${c}">`).join('');

  if (id) {
    const p = products.find(x => x.id === id);
    title.textContent = 'Editar producto';
    btnDelete.style.display = 'block';
    
    document.getElementById('product-name').value = p.name;
    document.getElementById('product-ref').value = p.ref || '';
    document.getElementById('product-category').value = p.category || '';
    document.getElementById('product-price').value = p.price;
    document.getElementById('product-cost').value = p.cost !== undefined ? p.cost : '';
    document.getElementById('product-stock').value = p.stock !== undefined ? p.stock : '';
    document.getElementById('product-unit').value = p.unit;
    document.getElementById('product-description').value = p.description;
    document.getElementById('product-active').checked = p.active;
    
    setProductImagePreview(p.image);
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
    setProductImagePreview(null);
  }
  
  productModal.style.display = 'flex';
}

document.getElementById('btn-save-product').addEventListener('click', () => {
  const name = document.getElementById('product-name').value.trim();
  const price = parseFloat(document.getElementById('product-price').value);
  const costVal = document.getElementById('product-cost').value;
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
    image: document.getElementById('product-img-preview').src || ''
  };
  
  // Handle empty image src
  if(productData.image.endsWith(window.location.host + '/') || !document.getElementById('product-img-preview').style.display === 'block') {
      productData.image = '';
  }

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

// Image handling
document.getElementById('product-image-upload-area').addEventListener('click', () => {
  document.getElementById('product-file-input').click();
});

document.getElementById('product-file-input').addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      setProductImagePreview(evt.target.result);
    };
    reader.readAsDataURL(e.target.files[0]);
  }
});

function setProductImagePreview(src) {
  const img = document.getElementById('product-img-preview');
  const placeholder = document.getElementById('product-upload-placeholder');
  if (src && src.startsWith('data:image')) {
    img.src = src;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    placeholder.style.display = 'flex';
  }
}

// Settings Form
function loadSettingsForm() {
  document.getElementById('settings-store-name').value = settings.storeName;
  document.getElementById('settings-tagline').value = settings.tagline;
  document.getElementById('settings-whatsapp').value = settings.whatsapp;
  document.getElementById('settings-color').value = settings.color;
  document.getElementById('settings-color-preview').textContent = settings.color;
  document.getElementById('settings-currency').value = settings.currency;
  document.getElementById('settings-admin-password').value = settings.adminPassword;
  
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

// Image Modal Fullscreen
window.openImageModal = function(src) {
  document.getElementById('image-viewer-img').src = src;
  document.getElementById('image-viewer-modal').style.display = 'flex';
};
window.closeImageModal = function() {
  document.getElementById('image-viewer-modal').style.display = 'none';
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
    logo: document.getElementById('settings-logo-preview').src || ''
  };
  
  if(settings.logo.endsWith(window.location.host + '/') || !document.getElementById('settings-logo-preview').style.display === 'block'){
      settings.logo = '';
  }

  db.ref('settings').set(settings);
  applySettings();
  renderProducts(); // Re-render for currency change
  updateCartUI(); // Re-render cart total
  showToast('Configuración guardada');
});

// Boot
init();
