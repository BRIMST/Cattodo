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
  window.openProductModal = window.openProductModal || function(){}; // fallback

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
    };
  });
  
  const closeBtn = document.getElementById('btn-close-admin');
  if (closeBtn) closeBtn.onclick = closeAdmin;
}

function openAdminActual() {
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
  appUtils.safeStyle('view-catalog', 'display', 'block');
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
