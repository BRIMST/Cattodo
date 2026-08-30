import { ref, set, update, remove, push, onValue, get } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

let appState = {};
let appUtils = {};

// Current POS State
let posCart = [];
let posMode = 'physical'; // physical or shipping

export function initAdmin(state, utils) {
  appState = state;
  appUtils = utils;
  
  // Expose to window for inline calls
  window.closeAdmin = closeAdmin;
  window.posAddToCart = posAddToCart;
  window.posRemoveFromCart = posRemoveFromCart;
  window.changeOrderStatus = changeOrderStatus;
  window.openProductModal = openProductModal;
  window.deleteProduct = deleteProduct;
  window.toggleProductTypeFields = toggleProductTypeFields;
  window.addVariantRow = addVariantRow;
  window.removeProductImage = removeProductImage;
  window.deleteCustomerPhoto = deleteCustomerPhoto;
  window.confirmDeleteProduct = confirmDeleteProduct;

  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
  };

  // Modal de producto: abrir / cerrar / guardar / eliminar
  on('btn-add-product', 'onclick', () => openProductModal(null));
  on('btn-close-product-modal', 'onclick', () => appUtils.safeStyle('modal-product', 'display', 'none'));
  on('btn-save-product', 'onclick', saveProduct);
  on('btn-delete-product', 'onclick', () => {
    if (!window.currentEditId) return;
    if (confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) {
      deleteProduct(window.currentEditId);
      window.currentEditId = null;
      appState.currentProductImages = [];
      appUtils.safeStyle('modal-product', 'display', 'none');
      appUtils.showToast('Producto eliminado');
    }
  });

  // Subir imágenes del producto
  on('btn-trigger-upload', 'onclick', () => document.getElementById('product-file-input')?.click());
  on('product-file-input', 'onchange', async (e) => {
    const files = Array.from(e.target.files).slice(0, 5 - appState.currentProductImages.length);
    const newImages = await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async (ev) => resolve(await appUtils.compressImage(ev.target.result));
      reader.readAsDataURL(file);
    })));
    newImages.forEach(img => { if (appState.currentProductImages.length < 5) appState.currentProductImages.push(img); });
    renderProductImagePreview();
    e.target.value = '';
  });

  // Carga masiva: Excel y fotos de producto
  on('btn-bulk-excel', 'onclick', () => document.getElementById('bulk-upload-excel')?.click());
  on('bulk-upload-excel', 'onchange', handleBulkExcelUpload);
  on('btn-bulk-photos', 'onclick', () => document.getElementById('bulk-upload-photos')?.click());
  on('bulk-upload-photos', 'onchange', handleBulkPhotoUpload);

  // Configuración: guardar + logo + QR + fotos de clientes
  on('btn-save-settings', 'onclick', saveSettings);
  on('logo-upload-area', 'onclick', () => document.getElementById('logo-file-input')?.click());
  on('logo-file-input', 'onchange', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await appUtils.compressImage(ev.target.result, 400, 0.7);
      appState.settings.logo = compressed;
      appUtils.safeSet('settings-logo-preview', 'src', compressed);
      appUtils.safeStyle('settings-logo-preview', 'display', 'block');
      appUtils.safeStyle('logo-upload-placeholder', 'display', 'none');
    };
    reader.readAsDataURL(file);
  });
  on('qr-upload-area', 'onclick', () => document.getElementById('qr-file-input')?.click());
  on('qr-file-input', 'onchange', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await appUtils.compressImage(ev.target.result, 400, 0.8);
      appState.settings.paymentQR = compressed;
      appUtils.safeSet('settings-qr-preview', 'src', compressed);
      appUtils.safeStyle('settings-qr-preview', 'display', 'block');
      appUtils.safeStyle('qr-upload-placeholder', 'display', 'none');
    };
    reader.readAsDataURL(file);
  });
  on('btn-upload-customer-photos', 'onclick', () => document.getElementById('customer-photos-input')?.click());
  on('customer-photos-input', 'onchange', handleCustomerPhotosUpload);

  initNavigation();
  initPOS();
  
  // Only open admin if explicitly called or state requires
  openAdminActual();
}

function initNavigation() {
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = 'tab-' + btn.dataset.tab;
      document.getElementById(tabId)?.classList.add('active');
      
      // Load specific tab data
      if (btn.dataset.tab === 'dashboard') renderDashboard();
      if (btn.dataset.tab === 'create-order') renderPOSProducts();
      if (btn.dataset.tab === 'orders') renderOrdersTable();
      if (btn.dataset.tab === 'products') renderProductsTable();
      if (btn.dataset.tab === 'clients') renderClientsTable();
      if (btn.dataset.tab === 'reports' || btn.dataset.tab === 'finance') renderDashboard();
      if (btn.dataset.tab === 'settings') loadSettingsForm();
    };
  });
  
  const closeBtn = document.getElementById('btn-close-admin');
  if (closeBtn) closeBtn.onclick = closeAdmin;
}

function openAdminActual() {
  // La clase 'active' de .view tiene display:block !important en el CSS,
  // lo que anula el inline display:none que ponemos abajo.
  // Quitamos 'active' de todas las vistas primero para evitar ese conflicto.
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  appUtils.safeStyle('view-catalog', 'display', 'none');
  appUtils.safeStyle('view-product', 'display', 'none');
  appUtils.safeStyle('view-order', 'display', 'none');
  appUtils.safeStyle('view-ticket', 'display', 'none');
  
  appUtils.safeStyle('view-admin', 'display', 'flex'); // The new layout
  
  if (!window.adminDataListenersAttached) {
    window.adminDataListenersAttached = true;
    
    // Listen to Orders
    onValue(ref(appState.db, 'orders'), snap => {
      const val = snap.val();
      appState.orders = val ? Object.entries(val).map(([k, v]) => ({ id: k, ...v })) : [];
      renderOrdersTable();
      renderDashboard();
    });
    
    // Listen to Clients
    onValue(ref(appState.db, 'clients'), snap => {
      const val = snap.val();
      appState.clients = val ? Object.entries(val).map(([k, v]) => ({ id: k, ...v })) : [];
      renderClientsTable();
    });
  }
  
  // Products are already in appState.products from app.js
  renderDashboard();
}

function closeAdmin() {
  appUtils.safeStyle('view-admin', 'display', 'none');
  appUtils.switchView('catalog');
}

// ==========================================
// MODULE: DASHBOARD & FINANCE
// ==========================================
function renderDashboard() {
  const orders = appState.orders || [];
  const products = appState.products || [];
  
  let totalSales = 0;
  let totalCost = 0;
  let pendingCount = 0;
  
  orders.forEach(o => {
    if (o.status !== 'cancelado') {
      if (o.status === 'entregado' || o.status === 'terminado') {
        totalSales += (o.total || 0);
        totalCost += (o.totalCost || 0);
      }
      if (o.status === 'gestion' || o.status === 'borrador' || o.status === 'alistamiento') {
        pendingCount++;
      }
    }
  });
  
  let inventoryValue = 0;
  let potentialProfit = 0;
  
  products.forEach(p => {
    if (p.active) {
      const stock = parseInt(p.stock) || 0;
      const cost = parseFloat(p.cost) || 0;
      const price = parseFloat(p.price) || 0;
      inventoryValue += (stock * cost);
      potentialProfit += (stock * (price - cost));
    }
  });
  
  // Dashboard Metrics
  appUtils.safeText('dash-total-sales', appUtils.formatMoney(totalSales));
  appUtils.safeText('dash-net-profit', appUtils.formatMoney(totalSales - totalCost));
  appUtils.safeText('dash-pending-orders', pendingCount);
  appUtils.safeText('dash-inventory-value', appUtils.formatMoney(inventoryValue));
  
  // Finance Metrics
  appUtils.safeText('report-revenue-total', appUtils.formatMoney(totalSales));
  appUtils.safeText('report-profit-total', appUtils.formatMoney(totalSales - totalCost));
  appUtils.safeText('finance-total-cost', appUtils.formatMoney(totalCost));
  appUtils.safeText('finance-potential-profit', appUtils.formatMoney(potentialProfit));
}

// ==========================================
// MODULE: CREAR PEDIDO (POS)
// ==========================================
function initPOS() {
  const btnPhysical = document.getElementById('pos-mode-physical');
  const btnShipping = document.getElementById('pos-mode-shipping');
  const shipForm = document.getElementById('pos-shipping-form');
  
  if (btnPhysical) btnPhysical.onclick = () => {
    btnPhysical.classList.add('active');
    btnShipping.classList.remove('active');
    shipForm.style.display = 'none';
    posMode = 'physical';
    calcPOSTotals();
  };
  
  if (btnShipping) btnShipping.onclick = () => {
    btnShipping.classList.add('active');
    btnPhysical.classList.remove('active');
    shipForm.style.display = 'block';
    posMode = 'shipping';
    calcPOSTotals();
  };
  
  const searchInput = document.getElementById('pos-search-input');
  if (searchInput) searchInput.oninput = renderPOSProducts;
  
  const qrBtn = document.getElementById('pos-scan-qr-btn');
  if (qrBtn) qrBtn.onclick = startQRScanner;
  
  const createBtn = document.getElementById('btn-create-order-pos');
  if (createBtn) createBtn.onclick = createPOSOrder;
  
  document.getElementById('pos-shipping-cost-input')?.addEventListener('input', calcPOSTotals);
}

function renderPOSProducts() {
  const grid = document.getElementById('pos-products-grid');
  if (!grid) return;
  
  const query = (document.getElementById('pos-search-input')?.value || '').toLowerCase();
  const products = appState.products || [];
  
  const filtered = products.filter(p => p.active && 
    ((p.name && p.name.toLowerCase().includes(query)) || 
     (p.ref && p.ref.toLowerCase().includes(query)))
  ).slice(0, 50); // limit for perf
  
  grid.innerHTML = filtered.map(p => {
    const img = (p.images && p.images[0]) ? p.images[0] : (p.image || '');
    const stock = p.stock || 0;
    return `
      <div class="pos-product-card" onclick="posAddToCart('${p.id}')">
        ${img ? `<img src="${img}" loading="lazy" />` : '<div style="height:80px; display:flex; align-items:center; justify-content:center; font-size:2rem;">📦</div>'}
        <span class="title">${p.name}</span>
        <span class="price">${appUtils.formatMoney(p.price || 0)}</span>
        <span class="stock">Inv: ${stock}</span>
      </div>
    `;
  }).join('');
}

function posAddToCart(productId) {
  const p = appState.products.find(x => x.id === productId);
  if (!p) return;
  
  const existing = posCart.find(i => i.id === productId);
  if (existing) {
    if (existing.qty < (p.stock || 999)) existing.qty++;
    else appUtils.showToast('No hay suficiente stock');
  } else {
    posCart.push({ id: p.id, name: p.name, price: p.price || 0, cost: p.cost || 0, qty: 1, img: (p.images && p.images[0]) || p.image });
  }
  
  renderPOSCart();
}

function posRemoveFromCart(idx) {
  posCart.splice(idx, 1);
  renderPOSCart();
}

function renderPOSCart() {
  const container = document.getElementById('pos-cart-items');
  if (!container) return;
  
  if (posCart.length === 0) {
    container.innerHTML = '<div class="empty-state-pos">No hay productos en el pedido</div>';
  } else {
    container.innerHTML = posCart.map((item, idx) => `
      <div class="pos-cart-item">
        <div style="flex:1;">
          <div style="font-weight:600; font-size:0.85rem;">${item.name}</div>
          <div style="color:var(--primary); font-size:0.8rem;">${appUtils.formatMoney(item.price)} x ${item.qty}</div>
        </div>
        <button class="action-btn" onclick="posRemoveFromCart(${idx})" style="color:var(--danger)">X</button>
      </div>
    `).join('');
  }
  
  calcPOSTotals();
}

function calcPOSTotals() {
  const subtotal = posCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  appUtils.safeText('pos-subtotal', appUtils.formatMoney(subtotal));
  
  let shipping = 0;
  if (posMode === 'shipping') {
    document.getElementById('pos-shipping-cost-row').style.display = 'flex';
    shipping = parseFloat(document.getElementById('pos-shipping-cost-input')?.value || 0);
  } else {
    document.getElementById('pos-shipping-cost-row').style.display = 'none';
  }
  
  appUtils.safeText('pos-total', appUtils.formatMoney(subtotal + shipping));
}

let html5QrcodeScanner = null;
function startQRScanner() {
  if (typeof Html5QrcodeScanner === 'undefined') {
    appUtils.showToast('La librería de escáner no está cargada.');
    return;
  }
  
  const qrNode = document.getElementById('qr-reader');
  qrNode.style.display = 'block';
  
  if (!html5QrcodeScanner) {
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
  }
  
  html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function onScanSuccess(decodedText, decodedResult) {
  // Assuming QR contains product Reference or ID
  const p = appState.products.find(x => x.ref === decodedText || x.id === decodedText);
  if (p) {
    posAddToCart(p.id);
    appUtils.showToast('Producto agregado: ' + p.name);
  } else {
    appUtils.showToast('Producto no encontrado con QR: ' + decodedText);
  }
  
  // Optionally stop scanner after 1 scan
  // html5QrcodeScanner.clear();
  // document.getElementById('qr-reader').style.display = 'none';
}

function onScanFailure(error) {
  // handle scan failure, usually better to ignore and keep scanning
}

async function createPOSOrder() {
  if (posCart.length === 0) return appUtils.showToast('Agrega productos al pedido.');
  
  const method = document.getElementById('pos-payment-method')?.value || 'efectivo';
  const seller = document.getElementById('pos-seller-name')?.value || 'Admin';
  
  const subtotal = posCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalCost = posCart.reduce((sum, item) => sum + (item.cost * item.qty), 0);
  let shipping = 0;
  let customerInfo = {};
  
  if (posMode === 'shipping') {
    shipping = parseFloat(document.getElementById('pos-shipping-cost-input')?.value || 0);
    const name = document.getElementById('pos-customer-name')?.value;
    const phone = document.getElementById('pos-customer-phone')?.value;
    if (!name || !phone) return appUtils.showToast('Completa los datos del cliente para el envío.');
    
    customerInfo = {
      name, phone,
      address: document.getElementById('pos-customer-address')?.value || '',
      city: document.getElementById('pos-customer-city')?.value || '',
      dept: document.getElementById('pos-customer-dept')?.value || ''
    };
    
    // Save to clients database optionally
    push(ref(appState.db, 'clients'), customerInfo);
  } else {
    customerInfo = { name: 'Cliente en Punto Físico' };
  }
  
  const orderData = {
    timestamp: Date.now(),
    status: 'gestion', // using standard kanban statuses
    channel: posMode === 'physical' ? 'pos' : 'whatsapp', // assuming pos or manual entry
    items: posCart,
    subtotal: subtotal,
    shippingValue: shipping,
    total: subtotal + shipping,
    totalCost: totalCost,
    customer: customerInfo,
    paymentMethod: method,
    seller: seller
  };
  
  try {
    appUtils.showToast('Creando pedido...');
    await push(ref(appState.db, 'orders'), orderData);
    
    // Deduct stock
    for (const item of posCart) {
      const p = appState.products.find(x => x.id === item.id);
      if (p && p.stock !== undefined) {
        const newStock = Math.max(0, parseInt(p.stock) - item.qty);
        await update(ref(appState.db, `products/${p.id}`), { stock: newStock });
      }
    }
    
    appUtils.showToast('Pedido creado con éxito ✅');
    
    // Reset Cart
    posCart = [];
    renderPOSCart();
    if (posMode === 'shipping') {
      ['pos-customer-name','pos-customer-phone','pos-customer-address','pos-shipping-cost-input'].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).value = '';
      });
    }
    document.querySelector('.admin-nav-btn[data-tab="orders"]')?.click();
    
  } catch (e) {
    appUtils.showToast('Error: ' + e.message);
  }
}

// ==========================================
// MODULE: PEDIDOS
// ==========================================
function renderOrdersTable() {
  const orders = appState.orders || [];
  
  const counts = { borrador: 0, gestion: 0, alistamiento: 0, terminado: 0, entregado: 0, cancelado: 0 };
  
  orders.forEach(o => {
    // Map legacy statuses if any
    let s = o.status || 'gestion';
    if (s === 'pending') s = 'gestion';
    if (s === 'completed') s = 'entregado';
    if (s === 'cancelled') s = 'cancelado';
    
    if (counts[s] !== undefined) counts[s]++;
  });
  
  Object.keys(counts).forEach(k => appUtils.safeText(`count-${k}`, counts[k]));
  
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;
  
  const sorted = [...orders].sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  
  const statusesHTML = (current) => `
    <select onchange="changeOrderStatus('${current.id}', this.value)" style="padding:4px; border-radius:4px;">
      <option value="borrador" ${current.status==='borrador'?'selected':''}>Borrador</option>
      <option value="gestion" ${current.status==='gestion'||current.status==='pending'?'selected':''}>En Gestión</option>
      <option value="alistamiento" ${current.status==='alistamiento'?'selected':''}>Alistamiento</option>
      <option value="terminado" ${current.status==='terminado'?'selected':''}>Terminado</option>
      <option value="entregado" ${current.status==='entregado'||current.status==='completed'?'selected':''}>Entregado</option>
      <option value="cancelado" ${current.status==='cancelado'||current.status==='cancelled'?'selected':''}>Cancelado</option>
    </select>
  `;
  
  tbody.innerHTML = sorted.map(o => `
    <tr>
      <td><strong style="color:var(--primary)">#${(o.id || '').slice(-6).toUpperCase()}</strong></td>
      <td>${o.customer?.name || 'Desconocido'}<br><small>${o.customer?.phone||''}</small></td>
      <td>${o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-CO') : ''}</td>
      <td>${statusesHTML(o)}</td>
      <td style="font-weight:bold">${appUtils.formatMoney(o.total || 0)}</td>
      <td><span style="background:#f4f7fe; padding:2px 8px; border-radius:10px; font-size:0.8rem;">${o.paymentMethod || 'Web'}</span></td>
      <td>${o.seller || 'Web'}</td>
      <td>
         <button class="action-btn" title="Ver Ticket">📥</button>
      </td>
    </tr>
  `).join('');
}

async function changeOrderStatus(orderId, newStatus) {
  try {
    await update(ref(appState.db, `orders/${orderId}`), { status: newStatus });
    appUtils.showToast('Estado actualizado');
  } catch (e) {
    appUtils.showToast('Error: ' + e.message);
  }
}

// ==========================================
// MODULE: PRODUCTOS
// ==========================================
function renderProductsTable() {
  const tbody = document.getElementById('products-table-body');
  if (!tbody) return;
  
  const query = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  let products = appState.products || [];
  if (query) {
    products = products.filter(p => (p.name||'').toLowerCase().includes(query) || (p.ref||'').toLowerCase().includes(query));
  }
  
  // Calc metrics
  // We need to know sales per product
  const salesMap = {};
  (appState.orders || []).forEach(o => {
    if (o.status !== 'cancelado') {
      (o.items || []).forEach(i => {
        salesMap[i.id] = (salesMap[i.id] || 0) + (i.qty || 1);
      });
    }
  });

  tbody.innerHTML = products.map(p => {
    const img = (p.images && p.images[0]) ? p.images[0] : (p.image || '');
    const cost = parseFloat(p.cost) || 0;
    const price = parseFloat(p.price) || 0;
    const stock = parseInt(p.stock) || 0;
    const netProfit = price - cost;
    const rotation = salesMap[p.id] || 0;
    
    return `
      <tr>
        <td>${img ? `<img src="${img}" class="table-img" loading="lazy" />` : '📦'}</td>
        <td><strong>${p.name}</strong><br><small>${p.ref || 'Sin ref'}</small></td>
        <td>
           <span style="font-weight:bold; font-size:1.1rem; color:${stock <= (p.minStock||3) ? 'var(--danger)' : 'var(--text-main)'}">${stock}</span>
        </td>
        <td>${appUtils.formatMoney(cost)}</td>
        <td>${appUtils.formatMoney(price)}</td>
        <td style="color:var(--success); font-weight:bold;">${appUtils.formatMoney(netProfit)}</td>
        <td>${rotation} uds.</td>
        <td>
           <button class="action-btn" onclick="openProductModal('${p.id}')">✏️ Editar</button>
           <button class="action-btn" style="color:var(--danger); margin-left:8px;" onclick="promptCastigo('${p.id}')">⬇️ Castigar</button>
           <button class="action-btn" style="color:var(--danger); margin-left:8px;" onclick="window.confirmDeleteProduct('${p.id}')">🗑️ Eliminar</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.promptCastigo = async function(id) {
  const p = appState.products.find(x => x.id === id);
  if (!p) return;
  const qtyStr = prompt(`¿Cuántas unidades de "${p.name}" deseas descontar (castigar)?`);
  if (!qtyStr) return;
  const qty = parseInt(qtyStr);
  if (isNaN(qty) || qty <= 0) return alert('Cantidad inválida');
  
  if (qty > (p.stock || 0)) return alert('No hay suficiente stock para descontar esa cantidad');
  
  const reason = prompt('Motivo del castigo (ej. Pérdida, Daño, Muestra):');
  
  try {
    const newStock = parseInt(p.stock) - qty;
    await update(ref(appState.db, `products/${p.id}`), { stock: newStock });
    // Log movement
    await push(ref(appState.db, `products/${p.id}/movements`), {
      date: Date.now(),
      type: 'out_castigo',
      qty: qty,
      reason: reason || 'Sin motivo'
    });
    appUtils.showToast('Inventario castigado correctamente');
  } catch(e) {
    appUtils.showToast('Error al castigar: ' + e.message);
  }
}

// ==========================================
// MODULE: CLIENTES
// ==========================================
function renderClientsTable() {
  const tbody = document.getElementById('clients-table-body');
  if (!tbody) return;
  
  const clients = appState.clients || [];
  
  // group clients by phone to show unique clients if there are duplicates from orders
  const map = {};
  clients.forEach(c => {
    if (c.phone) {
      if (!map[c.phone]) map[c.phone] = {...c, count: 1};
      else map[c.phone].count++;
    }
  });
  
  const unique = Object.values(map);
  
  tbody.innerHTML = unique.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone}</td>
      <td>${c.city || ''} <small>${c.dept ? `(${c.dept})` : ''}</small></td>
      <td>${c.address || ''}</td>
      <td>${c.count || 1} pedido(s)</td>
      <td>
        <button class="action-btn">✏️ Editar</button>
      </td>
    </tr>
  `).join('');
}

export function renderAdminProducts() { renderProductsTable(); }

// ==========================================
// MODULE: MODAL DE PRODUCTO (Crear/Editar/Eliminar)
// ==========================================
function openProductModal(id = null) {
  if (id === 'undefined') id = null;
  window.currentEditId = id;
  window.currentProductOrigen = null;
  appState.currentProductImages = [];
  const p = id ? appState.products.find(x => x.id === id) : null;
  if (p) window.currentProductOrigen = p.origen;
  if (p) appState.currentProductImages = p.images ? [...p.images] : (p.image ? [p.image] : []);

  appUtils.safeStyle('modal-product', 'display', 'flex');
  appUtils.safeText('modal-product-title', p ? 'Editar Producto' : 'Nuevo Producto');
  appUtils.safeValue('product-name', p ? p.name : '');
  appUtils.safeValue('product-ref', p ? (p.ref || '') : '');
  appUtils.safeValue('product-category', p ? (p.category || '') : '');
  appUtils.safeValue('product-tags', p ? (p.tags || '') : '');
  appUtils.safeValue('product-price', p ? parseInt(p.price).toLocaleString('es-CO') : '');
  appUtils.safeValue('product-original-price', p && p.originalPrice ? parseInt(p.originalPrice).toLocaleString('es-CO') : '');
  appUtils.safeValue('product-cost', p && p.cost ? parseInt(p.cost).toLocaleString('es-CO') : '');
  appUtils.safeValue('product-wholesale-price', p && p.wholesalePrice ? parseInt(p.wholesalePrice).toLocaleString('es-CO') : '');
  appUtils.safeValue('product-weight', p && p.weight ? p.weight : '');
  appUtils.safeValue('product-stock', p ? (p.stock || '') : '');
  appUtils.safeValue('product-unit', p ? (p.unit || 'und') : 'und');
  appUtils.safeValue('product-description', p ? (p.description || '') : '');
  appUtils.safeValue('product-clip-url', p ? (p.clipUrl || p.videoUrl || p.video || p.clip || '') : '');
  appUtils.safeValue('product-video-thumbnail', p ? (p.videoThumbnail || '') : '');
  appUtils.safeSet('product-active', 'checked', p ? (p.active ?? true) : true);
  appUtils.safeStyle('btn-delete-product', 'display', p ? 'block' : 'none');

  const hasVariants = p && p.variants && p.variants.length > 0;
  const typeRadios = document.getElementsByName('product-type');
  if (typeRadios.length > 1) {
    typeRadios[0].checked = !hasVariants;
    typeRadios[1].checked = hasVariants;
  }

  appUtils.safeValue('product-variant-type', (p && p.variantType) ? p.variantType : 'color');
  window.updateVariantTypeUI();

  const list = document.getElementById('variants-list');
  if (list) {
    list.innerHTML = '';
    if (hasVariants) p.variants.forEach(v => addVariantRow(v.color, v.stock));
  }
  toggleProductTypeFields();
  renderProductImagePreview();
}

function toggleProductTypeFields() {
  const type = document.querySelector('input[name="product-type"]:checked')?.value;
  appUtils.safeStyle('group-stock-simple', 'display', type === 'variants' ? 'none' : 'block');
  appUtils.safeStyle('group-variant-type', 'display', type === 'variants' ? 'block' : 'none');
  appUtils.safeStyle('group-product-variants', 'display', type === 'variants' ? 'block' : 'none');
}

const VARIANT_TYPE_META = {
  color:  { label: 'Variantes de Color',  addBtn: '+ Agregar color',  placeholder: 'Ej: Rojo' },
  aroma:  { label: 'Variantes de Aroma',  addBtn: '+ Agregar aroma',  placeholder: 'Ej: Vainilla' },
  'tamaño': { label: 'Variantes de Tamaño', addBtn: '+ Agregar tamaño', placeholder: 'Ej: M' }
};

// Se expone en window porque el <select> del tipo de variante la llama por
// onchange inline en el HTML.
window.updateVariantTypeUI = function() {
  const type = document.getElementById('product-variant-type')?.value || 'color';
  const meta = VARIANT_TYPE_META[type] || VARIANT_TYPE_META.color;
  appUtils.safeText('variants-list-label', meta.label);
  appUtils.safeText('btn-add-variant', meta.addBtn);
  document.querySelectorAll('#variants-list .var-name').forEach(input => {
    input.placeholder = meta.placeholder;
  });
};

function addVariantRow(name = '', stock = '') {
  const list = document.getElementById('variants-list');
  if (!list) return;
  const type = document.getElementById('product-variant-type')?.value || 'color';
  const meta = VARIANT_TYPE_META[type] || VARIANT_TYPE_META.color;
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.innerHTML = `
    <input type="text" class="field-input var-name" placeholder="${meta.placeholder}" value="${name}" style="flex:2">
    <input type="number" class="field-input var-stock" placeholder="Stock" value="${stock}" style="flex:1">
    <button type="button" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(row);
}

function renderProductImagePreview() {
  const container = document.getElementById('product-images-list');
  const trigger = document.getElementById('btn-trigger-upload');
  if (!container || !trigger) return;
  container.innerHTML = '';
  appState.currentProductImages.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'multi-image-item';
    div.innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover;" />
                     <button onclick="window.removeProductImage(${idx})">×</button>`;
    container.appendChild(div);
  });
  if (appState.currentProductImages.length < 5) container.appendChild(trigger);
}

function removeProductImage(idx) {
  appState.currentProductImages.splice(idx, 1);
  renderProductImagePreview();
}

async function saveProduct() {
  const name = document.getElementById('product-name')?.value.trim();
  const price = parseFloat(document.getElementById('product-price')?.value.replace(/\./g, ''));
  if (!name || isNaN(price)) return appUtils.showToast('Nombre y precio requeridos');

  const originalPriceInput = document.getElementById('product-original-price')?.value;
  const originalPrice = originalPriceInput ? parseFloat(originalPriceInput.replace(/\./g, '')) : null;

  const costInput = document.getElementById('product-cost')?.value;
  const cost = costInput ? parseFloat(costInput.replace(/\./g, '')) : null;

  const wholesalePriceInput = document.getElementById('product-wholesale-price')?.value;
  const wholesalePrice = wholesalePriceInput ? parseFloat(wholesalePriceInput.replace(/\./g, '')) : null;

  const weight = parseFloat(document.getElementById('product-weight')?.value) || 0.3;

  const pData = {
    name, price,
    ref: document.getElementById('product-ref')?.value || '',
    category: document.getElementById('product-category')?.value || '',
    tags: document.getElementById('product-tags')?.value || '',
    originalPrice: originalPrice,
    cost: cost,
    wholesalePrice: wholesalePrice,
    weight: weight,
    stock: parseInt(document.getElementById('product-stock')?.value) || 0,
    unit: document.getElementById('product-unit')?.value || 'und',
    description: document.getElementById('product-description')?.value || '',
    clipUrl: document.getElementById('product-clip-url')?.value.trim() || null,
    videoThumbnail: document.getElementById('product-video-thumbnail')?.value.trim() || null,
    active: document.getElementById('product-active')?.checked ?? true,
    images: [...appState.currentProductImages]
  };

  const type = document.querySelector('input[name="product-type"]:checked')?.value;
  if (type === 'variants') {
    const variantRows = document.querySelectorAll('.variant-row');
    const variants = [];
    variantRows.forEach(row => {
      const vname = row.querySelector('.var-name')?.value.trim();
      const vstock = parseInt(row.querySelector('.var-stock')?.value) || 0;
      if (vname) variants.push({ color: vname, stock: vstock });
    });
    pData.variants = variants;
    pData.variantType = document.getElementById('product-variant-type')?.value || 'color';
    pData.stock = variants.reduce((sum, v) => sum + v.stock, 0);
  } else {
    pData.variants = null;
  }

  pData.origen = (window.currentProductOrigen === 'mastershop') ? 'mastershop' : 'propio';

  try {
    if (window.currentEditId && window.currentEditId !== "undefined") {
      await update(ref(appState.db, `products/${window.currentEditId}`), pData);
    } else {
      await push(ref(appState.db, 'products'), pData);
    }
    appUtils.safeStyle('modal-product', 'display', 'none');
    appUtils.showToast('Guardado ✅');
    if (window.loadCatalog) window.loadCatalog();
    renderProductsTable();
  } catch (error) {
    console.error("Error saving product:", error);
    appUtils.showToast('Error al guardar: ' + error.message);
  }
}

async function deleteProduct(id) {
  await remove(ref(appState.db, `products/${id}`));
  if (window.loadCatalog) window.loadCatalog();
  renderProductsTable();
}

function confirmDeleteProduct(id) {
  const product = appState.products.find(p => p.id === id);
  const name = product ? product.name : 'este producto';
  if (confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) {
    deleteProduct(id);
    appUtils.showToast('Producto eliminado');
  }
}

// ==========================================
// MODULE: CONFIGURACIÓN (Tienda)
// ==========================================
function loadSettingsForm() {
  appUtils.safeValue('settings-store-name', appState.settings.storeName || '');
  appUtils.safeValue('settings-tagline', appState.settings.tagline || '');
  appUtils.safeValue('settings-whatsapp', appState.settings.whatsapp || '');
  appUtils.safeValue('settings-color', appState.settings.color || '#6c63ff');
  appUtils.safeValue('settings-currency', appState.settings.currency || 'COP');
  appUtils.safeValue('settings-payment-info', appState.settings.paymentInfo || '');
  appUtils.safeValue('settings-shipping-cost', appState.settings.shippingCost || 0);
  appUtils.safeValue('settings-wholesale-discount', appState.settings.wholesaleDiscount !== undefined ? appState.settings.wholesaleDiscount : 20);

  const social = appState.settings.social || {};
  appUtils.safeValue('settings-social-instagram', social.instagram || '');
  appUtils.safeValue('settings-social-facebook', social.facebook || '');
  appUtils.safeValue('settings-social-tiktok', social.tiktok || '');

  renderCustomerPhotosAdmin();

  const origin = appState.settings.originAddress || {};
  appUtils.safeValue('settings-origin-name', origin.name || '');
  appUtils.safeValue('settings-origin-phone', origin.phone || '');
  appUtils.safeValue('settings-origin-street', origin.street || '');
  appUtils.safeValue('settings-origin-city', origin.city || '');
  appUtils.safeValue('settings-origin-state', origin.state || '');
  appUtils.safeValue('settings-origin-zip', origin.zip || '');

  const loc = appState.settings.locContent || {};
  appUtils.safeValue('settings-loc-bgt-title', loc.bgtTitle || '');
  appUtils.safeValue('settings-loc-bgt-sub', loc.bgtSub || '');
  appUtils.safeValue('settings-loc-nat-title', loc.natTitle || '');
  appUtils.safeValue('settings-loc-nat-sub', loc.natSub || '');

  const camp = appState.settings.activeCampaign || {};
  appUtils.safeSet('settings-camp-enabled', 'checked', !!camp.enabled);
  appUtils.safeValue('settings-camp-title', camp.title || '');
  appUtils.safeValue('settings-camp-tag', camp.tag || '');
  appUtils.safeValue('settings-camp-badge', camp.badgeText || '');

  if (appState.settings.logo) {
    appUtils.safeSet('settings-logo-preview', 'src', appState.settings.logo);
    appUtils.safeStyle('settings-logo-preview', 'display', 'block');
    appUtils.safeStyle('logo-upload-placeholder', 'display', 'none');
  }
  if (appState.settings.paymentQR) {
    appUtils.safeSet('settings-qr-preview', 'src', appState.settings.paymentQR);
    appUtils.safeStyle('settings-qr-preview', 'display', 'block');
    appUtils.safeStyle('qr-upload-placeholder', 'display', 'none');
  }
}

async function saveSettings() {
  const newSettings = {
    ...appState.settings,
    storeName: document.getElementById('settings-store-name')?.value || '',
    tagline: document.getElementById('settings-tagline')?.value || '',
    whatsapp: document.getElementById('settings-whatsapp')?.value || '',
    color: document.getElementById('settings-color')?.value || '#6c63ff',
    currency: document.getElementById('settings-currency')?.value || 'COP',
    paymentInfo: document.getElementById('settings-payment-info')?.value || '',
    shippingCost: parseFloat(document.getElementById('settings-shipping-cost')?.value) || 0,
    wholesaleDiscount: parseInt(document.getElementById('settings-wholesale-discount')?.value) >= 0 ? parseInt(document.getElementById('settings-wholesale-discount')?.value) : 20,
    originAddress: {
      name: document.getElementById('settings-origin-name')?.value || '',
      phone: document.getElementById('settings-origin-phone')?.value || '',
      street: document.getElementById('settings-origin-street')?.value || '',
      city: document.getElementById('settings-origin-city')?.value || '',
      state: document.getElementById('settings-origin-state')?.value || '',
      zip: document.getElementById('settings-origin-zip')?.value || ''
    },
    social: {
      instagram: document.getElementById('settings-social-instagram')?.value.trim() || '',
      facebook: document.getElementById('settings-social-facebook')?.value.trim() || '',
      tiktok: document.getElementById('settings-social-tiktok')?.value.trim() || ''
    },
    locContent: {
      bgtTitle: document.getElementById('settings-loc-bgt-title')?.value || '',
      bgtSub: document.getElementById('settings-loc-bgt-sub')?.value || '',
      natTitle: document.getElementById('settings-loc-nat-title')?.value || '',
      natSub: document.getElementById('settings-loc-nat-sub')?.value || ''
    },
    activeCampaign: {
      enabled: document.getElementById('settings-camp-enabled')?.checked || false,
      title: document.getElementById('settings-camp-title')?.value || '',
      tag: document.getElementById('settings-camp-tag')?.value || '',
      badgeText: document.getElementById('settings-camp-badge')?.value || ''
    }
  };
  const newPass = document.getElementById('settings-admin-password')?.value || '';
  if (newPass) newSettings.adminPasswordHash = await appUtils.hashPassword(newPass);

  try {
    await set(ref(appState.db, 'settings'), newSettings);
    appState.settings = newSettings;
    appUtils.showToast('Configuración guardada ✅');
    if (window.loadCatalog) window.loadCatalog();
  } catch (error) {
    console.error("Error saving settings:", error);
    appUtils.showToast('Error al guardar configuración: ' + error.message);
  }
}

// ==========================================
// MODULE: FOTOS DE CLIENTES SATISFECHOS
// ==========================================
async function handleCustomerPhotosUpload(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  appUtils.showToast(`Subiendo ${files.length} foto(s)...`);

  const current = Array.isArray(appState.settings.customerPhotos) ? [...appState.settings.customerPhotos] : [];

  for (const file of files) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await appUtils.compressImage(dataUrl);
      current.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url: compressed });
    } catch (err) {
      console.error(`Error subiendo foto de cliente ${file.name}:`, err);
    }
  }

  try {
    await update(ref(appState.db, 'settings'), { customerPhotos: current });
    appState.settings.customerPhotos = current;
    appUtils.showToast('Fotos de clientes actualizadas ✅');
    renderCustomerPhotosAdmin();
    if (window.loadCatalog) window.loadCatalog();
  } catch (err) {
    console.error('Error guardando fotos de clientes:', err);
    appUtils.showToast('Error al guardar las fotos: ' + err.message);
  }
  e.target.value = '';
}

async function deleteCustomerPhoto(photoId) {
  if (!confirm('¿Eliminar esta foto de la galería de clientes?')) return;
  const current = (appState.settings.customerPhotos || []).filter(p => p.id !== photoId);
  try {
    await update(ref(appState.db, 'settings'), { customerPhotos: current });
    appState.settings.customerPhotos = current;
    renderCustomerPhotosAdmin();
    if (window.loadCatalog) window.loadCatalog();
  } catch (err) {
    console.error('Error eliminando foto de cliente:', err);
    appUtils.showToast('Error al eliminar: ' + err.message);
  }
}

function renderCustomerPhotosAdmin() {
  const grid = document.getElementById('customer-photos-grid');
  if (!grid) return;
  const photos = appState.settings.customerPhotos || [];
  grid.innerHTML = photos.map(p => `
    <div class="customer-photo-admin-item">
      <img src="${p.url}" alt="Foto de cliente" />
      <button type="button" onclick="window.deleteCustomerPhoto('${p.id}')" title="Eliminar">×</button>
    </div>
  `).join('');
}

// ==========================================
// MODULE: CARGA MASIVA (Excel + Fotos de producto)
// ==========================================
async function handleBulkPhotoUpload(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  appUtils.showToast(`Procesando ${files.length} foto(s)...`);

  let matchedCount = 0;
  const unmatchedNames = [];

  for (const file of files) {
    const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
    const existing = appState.products.find(p => p.ref && String(p.ref).trim().toLowerCase() === baseName.toLowerCase());

    if (!existing) {
      unmatchedNames.push(file.name);
      continue;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await appUtils.compressImage(dataUrl);
      await update(ref(appState.db, `products/${existing.id}`), { images: [compressed] });
      matchedCount++;
    } catch (err) {
      console.error(`Error subiendo foto ${file.name}:`, err);
      unmatchedNames.push(file.name + ' (error al procesar)');
    }
  }

  let summary = `${matchedCount} foto(s) subida(s) y vinculada(s) ✅`;
  if (unmatchedNames.length > 0) {
    summary += ` — ⚠️ ${unmatchedNames.length} sin producto coincidente (revisa que el nombre del archivo sea igual a la Referencia)`;
    console.warn('Fotos sin producto coincidente:', unmatchedNames);
  }
  appUtils.showToast(summary);
  if (window.loadCatalog) window.loadCatalog();
  renderProductsTable();
  e.target.value = '';
}

async function handleBulkExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  appUtils.showToast("Leyendo Excel...");

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        appUtils.showToast("El archivo de Excel está vacío.");
        return;
      }

      const findKey = (row, possibleNames) => {
        const rowKeys = Object.keys(row);
        for (const name of possibleNames) {
          const matched = rowKeys.find(k => k.trim().toLowerCase() === name.toLowerCase());
          if (matched !== undefined) return matched;
        }
        return null;
      };

      const resolvePhotoUrl = (rawValue) => {
        let url = String(rawValue || '').trim();
        if (!url) return { url: '', valid: false };
        const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
        if (driveMatch) {
          url = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
        }
        const looksLikeUrl = /^https?:\/\//i.test(url);
        return { url, valid: looksLikeUrl };
      };

      let importedCount = 0;
      let updatedCount = 0;
      let missingPhotoCount = 0;
      const missingPhotoNames = [];

      for (const row of jsonData) {
        const fotoKey = findKey(row, ["foto", "imagen", "image", "url"]);
        const nombreKey = findKey(row, ["nombre", "name"]);
        const refKey = findKey(row, ["referencia", "ref", "reference"]);
        const categoriaKey = findKey(row, ["categoria", "categoría", "category"]);
        const tagsKey = findKey(row, ["tags", "etiquetas"]);
        const stockKey = findKey(row, ["cantidad de stock", "stock", "cantidad", "existencias"]);
        const costoKey = findKey(row, ["precio de compra", "costo", "cost", "compra"]);
        const precioKey = findKey(row, ["precio de venta", "precio", "price", "venta"]);
        const precioOriginalKey = findKey(row, ["precio original", "precio antes de descuento", "original price"]);
        const precioMayoristaKey = findKey(row, ["precio mayorista", "wholesale price", "precio al por mayor"]);
        const pesoKey = findKey(row, ["peso", "peso (kg)", "weight"]);
        const unidadKey = findKey(row, ["unidad", "unit"]);
        const descripcionKey = findKey(row, ["descripcion", "descripción", "description"]);
        const videoKey = findKey(row, ["video", "clip", "clip url", "video url", "tiktok"]);
        const activoKey = findKey(row, ["activo", "active", "visible"]);

        const name = nombreKey ? String(row[nombreKey] || '').trim() : '';
        const price = precioKey ? parseFloat(String(row[precioKey]).replace(/[^\d]/g, '')) : NaN;

        if (!name || isNaN(price)) continue;

        const refValue = refKey ? String(row[refKey] || '').trim() : '';
        const stock = stockKey ? parseInt(String(row[stockKey]).replace(/[^\d]/g, '')) || 0 : 0;
        const cost = costoKey ? parseFloat(String(row[costoKey]).replace(/[^\d]/g, '')) || null : null;
        const originalPrice = precioOriginalKey ? (parseFloat(String(row[precioOriginalKey]).replace(/[^\d]/g, '')) || null) : null;
        const wholesalePrice = precioMayoristaKey ? (parseFloat(String(row[precioMayoristaKey]).replace(/[^\d]/g, '')) || null) : null;
        const weight = pesoKey ? (parseFloat(String(row[pesoKey]).replace(',', '.')) || 0.3) : 0.3;
        const unit = unidadKey ? (String(row[unidadKey] || '').trim() || 'und') : 'und';
        const category = categoriaKey ? String(row[categoriaKey] || '').trim() : '';
        const tags = tagsKey ? String(row[tagsKey] || '').trim() : '';
        const description = descripcionKey ? String(row[descripcionKey] || '').trim() : '';
        const clipUrl = videoKey ? (String(row[videoKey] || '').trim() || null) : null;
        const activoRaw = activoKey ? String(row[activoKey] || '').trim().toLowerCase() : '';
        const active = activoRaw ? !['no', 'false', '0', 'inactivo'].includes(activoRaw) : true;

        const rawFoto = fotoKey ? row[fotoKey] : '';
        const { url: foto, valid: fotoValid } = resolvePhotoUrl(rawFoto);
        if (!fotoValid) {
          missingPhotoCount++;
          missingPhotoNames.push(name);
        }

        const pData = {
          name, price, ref: refValue, category, tags, stock, cost,
          originalPrice, wholesalePrice, weight, unit, description, clipUrl, active,
          origen: 'propio'
        };

        let existingId = null;
        if (refValue) {
          const existing = appState.products.find(p => p.ref && String(p.ref).trim() === refValue);
          if (existing) existingId = existing.id;
        }

        if (existingId) {
          if (fotoValid) pData.images = [foto];
          await update(ref(appState.db, `products/${existingId}`), pData);
          updatedCount++;
        } else {
          pData.images = fotoValid ? [foto] : [];
          await push(ref(appState.db, 'products'), pData);
          importedCount++;
        }
      }

      let summary = `Excel procesado: ${importedCount} creados, ${updatedCount} actualizados ✅`;
      if (missingPhotoCount > 0) {
        summary += ` — ⚠️ ${missingPhotoCount} sin foto válida (revisa que la columna "foto" tenga un link http(s), no una imagen pegada)`;
        console.warn('Productos importados sin foto válida:', missingPhotoNames);
      }
      appUtils.showToast(summary);
      if (window.loadCatalog) window.loadCatalog();
      renderProductsTable();
    } catch (err) {
      console.error(err);
      appUtils.showToast("Error al procesar Excel: " + err.message);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
