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
  window.posChangeQty = posChangeQty;
  window.changeOrderStatus = changeOrderStatus;
  window.openProductModal = openProductModal;
  window.deleteProduct = deleteProduct;
  window.toggleProductTypeFields = toggleProductTypeFields;
  window.addVariantRow = addVariantRow;
  window.removeProductImage = removeProductImage;
  window.deleteCustomerPhoto = deleteCustomerPhoto;
  window.confirmDeleteProduct = confirmDeleteProduct;
  window.openClientModal = openClientModal;
  window.confirmDeleteOrder = confirmDeleteOrder;
  window.toggleOrderPaymentStatus = toggleOrderPaymentStatus;

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

  // Productos: búsqueda, filtros, orden, paginación y selección múltiple
  const resetToPage1AndRender = () => { productsCurrentPage = 1; renderProductsTable(); };
  on('admin-search-input', 'oninput', resetToPage1AndRender);
  on('products-category-filter', 'onchange', resetToPage1AndRender);
  document.querySelectorAll('.stock-filter-chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('.stock-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      resetToPage1AndRender();
    };
  });
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (productsSortState.key === key) productsSortState.dir *= -1;
      else { productsSortState.key = key; productsSortState.dir = 1; }
      renderProductsTable();
    };
  });
  on('products-select-all', 'onchange', (e) => {
    document.querySelectorAll('.product-select-checkbox').forEach(cb => { cb.checked = e.target.checked; });
    updateBulkDeleteProductsButton();
  });
  on('btn-delete-selected-products', 'onclick', deleteSelectedProducts);

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

  // Clientes: crear / editar / eliminar / buscar
  on('btn-add-client', 'onclick', () => openClientModal(null));
  on('btn-close-client-modal', 'onclick', () => appUtils.safeStyle('modal-client', 'display', 'none'));
  on('btn-save-client', 'onclick', saveClient);
  on('btn-delete-client', 'onclick', () => {
    if (window.currentEditClientId) deleteClient(window.currentEditClientId);
  });
  on('clients-search-input', 'oninput', renderClientsTable);
  on('orders-search-input', 'oninput', renderOrdersTable);
  on('btn-delete-selected-orders', 'onclick', deleteSelectedOrders);
  on('orders-select-all', 'onchange', (e) => {
    document.querySelectorAll('.order-select-checkbox').forEach(cb => { cb.checked = e.target.checked; });
    updateBulkDeleteOrdersButton();
  });

  // Historial de movimientos de producto
  on('btn-close-history-modal', 'onclick', () => appUtils.safeStyle('modal-product-history', 'display', 'none'));
  on('btn-close-order-details-modal', 'onclick', () => appUtils.safeStyle('modal-order-details', 'display', 'none'));

  // Venta Externa
  on('btn-add-external-sale', 'onclick', openExternalSaleModal);
  on('btn-close-external-modal', 'onclick', closeExternalSaleModal);
  on('btn-save-external-sale', 'onclick', saveExternalSale);
  on('btn-add-ext-item', 'onclick', addExtItem);

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
      if (btn.dataset.tab === 'reports') renderReports();
      if (btn.dataset.tab === 'finance') renderFinance();
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
      if (document.getElementById('tab-reports')?.classList.contains('active')) renderReports();
      if (document.getElementById('tab-finance')?.classList.contains('active')) renderFinance();
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

// Devuelve el timestamp de inicio para un periodo dado ('day','week','month','semester','all')
function getTimeframeSince(timeframe) {
  const now = new Date();
  const start = new Date(now);
  switch (timeframe) {
    case 'day': start.setHours(0, 0, 0, 0); break;
    case 'week': start.setDate(now.getDate() - 7); break;
    case 'month': start.setMonth(now.getMonth() - 1); break;
    case 'semester': start.setMonth(now.getMonth() - 6); break;
    case 'all': default: return 0;
  }
  return start.getTime();
}

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
    if (p.active !== false) {
      const stock = parseInt(p.stock) || 0;
      const cost = parseFloat(p.cost) || 0;
      const price = parseFloat(p.price) || 0;
      inventoryValue += (stock * cost);
      potentialProfit += (stock * (price - cost));
    }
  });
  
  appUtils.safeText('dash-total-sales', appUtils.formatMoney(totalSales));
  appUtils.safeText('dash-net-profit', appUtils.formatMoney(totalSales - totalCost));
  appUtils.safeText('dash-pending-orders', pendingCount);
  appUtils.safeText('dash-inventory-value', appUtils.formatMoney(inventoryValue));

  renderDashboardTrendChart();
}

// Gráfica simple de ventas de los últimos 14 días, sin depender de ninguna
// librería externa — barras generadas con divs, dimensionadas por CSS.
function renderDashboardTrendChart() {
  const container = document.getElementById('dashboard-charts-row');
  if (!container) return;
  const orders = appState.orders || [];

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const salesByDay = days.map(d => {
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 1);
    const total = orders
      .filter(o => o.status !== 'cancelado' && o.timestamp >= d.getTime() && o.timestamp < nextDay.getTime())
      .reduce((s, o) => s + (o.total || 0), 0);
    return { date: d, total };
  });

  const maxVal = Math.max(...salesByDay.map(d => d.total), 1);

  container.innerHTML = `
    <div class="dashboard-chart-card">
      <h4 class="report-title">📈 Ventas — últimos 14 días</h4>
      <div class="trend-chart">
        ${salesByDay.map(d => `
          <div class="trend-bar-wrap" title="${d.date.toLocaleDateString('es-CO')}: ${appUtils.formatMoney(d.total)}">
            <div class="trend-bar" style="height:${Math.max(4, (d.total / maxVal) * 100)}%"></div>
            <span class="trend-bar-label">${d.date.getDate()}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Filtra pedidos según el periodo elegido en "report-timeframe"
function getFilteredOrdersForReports() {
  const timeframe = document.getElementById('report-timeframe')?.value || 'month';
  const since = getTimeframeSince(timeframe);
  return (appState.orders || []).filter(o => (o.timestamp || 0) >= since);
}

function renderReports() {
  const orders = getFilteredOrdersForReports();
  const products = appState.products || [];

  const confirmed = orders.filter(o => o.status === 'entregado' || o.status === 'terminado');
  const cancelled = orders.filter(o => o.status === 'cancelado');
  const totalSales = confirmed.reduce((s, o) => s + (o.total || 0), 0);
  const totalCost = confirmed.reduce((s, o) => s + (o.totalCost || 0), 0);

  appUtils.safeText('report-revenue-total', appUtils.formatMoney(totalSales));
  appUtils.safeText('report-profit-total', appUtils.formatMoney(totalSales - totalCost));

  // Alerta de stock bajo
  const lowStock = products.filter(p => p.active !== false && (parseInt(p.stock) || 0) <= (p.minStock || 3));
  const alertEl = document.getElementById('report-low-stock-alert');
  if (alertEl) {
    if (lowStock.length > 0) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = `
        <div class="report-alert-banner">
          ⚠️ <strong>${lowStock.length} producto(s)</strong> con stock bajo o agotado:
          ${lowStock.slice(0, 5).map(p => p.name).join(', ')}${lowStock.length > 5 ? '…' : ''}
        </div>`;
    } else {
      alertEl.style.display = 'none';
    }
  }

  // Ventas por canal
  const channelMap = {};
  confirmed.forEach(o => {
    const ch = o.channel === 'pos' ? 'Punto Físico' : (o.channel || 'Web');
    channelMap[ch] = (channelMap[ch] || 0) + (o.total || 0);
  });
  const channelEl = document.getElementById('report-channel-bars');
  if (channelEl) {
    const entries = Object.entries(channelMap);
    if (entries.length === 0) {
      channelEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0">Sin datos en este periodo</div>';
    } else {
      const maxCh = Math.max(...entries.map(e => e[1]), 1);
      channelEl.innerHTML = entries.map(([name, val]) => `
        <div class="channel-bar-row">
          <span class="channel-bar-label">${name}</span>
          <div class="channel-bar-track"><div class="channel-bar-fill" style="width:${(val / maxCh) * 100}%"></div></div>
          <span class="channel-bar-value">${appUtils.formatMoney(val)}</span>
        </div>
      `).join('');
    }
  }

  // Estado de pedidos
  const STATUS_LABELS = { borrador: 'Borrador', gestion: 'En Gestión', alistamiento: 'Alistamiento', terminado: 'Terminado', entregado: 'Entregado', cancelado: 'Cancelado' };
  const statusCounts = {};
  orders.forEach(o => { const s = o.status || 'gestion'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
  const statusEl = document.getElementById('report-status-summary');
  if (statusEl) {
    statusEl.innerHTML = Object.entries(statusCounts).map(([s, count]) => `
      <div class="status-summary-chip">${STATUS_LABELS[s] || s}: <strong>${count}</strong></div>
    `).join('') || '<div style="color:var(--text-muted);font-size:0.82rem;">Sin pedidos en este periodo</div>';
  }

  // Más vendidos
  const soldMap = {};
  confirmed.forEach(o => (o.items || []).forEach(i => { soldMap[i.id] = (soldMap[i.id] || 0) + (i.qty || 0); }));
  const mostSold = Object.entries(soldMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mostSoldEl = document.getElementById('report-most-sold');
  if (mostSoldEl) {
    mostSoldEl.innerHTML = mostSold.length > 0
      ? mostSold.map(([id, qty]) => {
          const p = products.find(x => x.id === id);
          return `<div class="report-list-row"><span>${p ? p.name : 'Producto eliminado'}</span><strong>${qty} uds.</strong></div>`;
        }).join('')
      : '<div style="color:var(--text-muted);font-size:0.82rem;">Sin ventas en este periodo</div>';
  }

  // Más cancelados
  const cancelMap = {};
  cancelled.forEach(o => (o.items || []).forEach(i => { cancelMap[i.id] = (cancelMap[i.id] || 0) + (i.qty || 0); }));
  const mostCancelled = Object.entries(cancelMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mostCancelledEl = document.getElementById('report-most-cancelled');
  if (mostCancelledEl) {
    mostCancelledEl.innerHTML = mostCancelled.length > 0
      ? mostCancelled.map(([id, qty]) => {
          const p = products.find(x => x.id === id);
          return `<div class="report-list-row"><span>${p ? p.name : 'Producto eliminado'}</span><strong>${qty} uds.</strong></div>`;
        }).join('')
      : '<div style="color:var(--text-muted);font-size:0.82rem;">Sin cancelaciones en este periodo 🎉</div>';
  }

  // Sin ventas (productos activos que no se han vendido en el periodo)
  const noSalesEl = document.getElementById('report-no-sales');
  if (noSalesEl) {
    const noSales = products.filter(p => p.active !== false && !soldMap[p.id]);
    noSalesEl.innerHTML = noSales.length > 0
      ? noSales.slice(0, 15).map(p => `<div class="report-list-row"><span>${p.name}</span><small style="color:var(--text-muted)">${p.stock || 0} en stock</small></div>`).join('')
        + (noSales.length > 15 ? `<div style="color:var(--text-muted); font-size:0.78rem; margin-top:0.4rem;">y ${noSales.length - 15} más…</div>` : '')
      : '<div style="color:var(--text-muted);font-size:0.82rem;">Todos tus productos activos tuvieron ventas en este periodo 🎉</div>';
  }
}

function renderFinance() {
  const orders = getFilteredOrdersForReports();
  const products = appState.products || [];

  const confirmed = orders.filter(o => o.status === 'entregado' || o.status === 'terminado');
  const totalSales = confirmed.reduce((s, o) => s + (o.total || 0), 0);
  const totalCost = confirmed.reduce((s, o) => s + (o.totalCost || 0), 0);

  let inventoryValue = 0, potentialProfit = 0;
  products.forEach(p => {
    if (p.active !== false) {
      const stock = parseInt(p.stock) || 0;
      const cost = parseFloat(p.cost) || 0;
      const price = parseFloat(p.price) || 0;
      inventoryValue += (stock * cost);
      potentialProfit += (stock * (price - cost));
    }
  });

  appUtils.safeText('report-revenue-total', appUtils.formatMoney(totalSales));
  appUtils.safeText('report-profit-total', appUtils.formatMoney(totalSales - totalCost));
  appUtils.safeText('finance-total-cost', appUtils.formatMoney(totalCost));
  appUtils.safeText('finance-potential-profit', appUtils.formatMoney(potentialProfit));

  // Margen de ganancia (%)
  const marginPct = totalSales > 0 ? (((totalSales - totalCost) / totalSales) * 100).toFixed(1) : '0.0';
  appUtils.safeText('finance-margin-pct', `${marginPct}%`);

  // Ingresos por método de pago
  const methodMap = {};
  confirmed.forEach(o => {
    const method = o.paymentMethod || 'No especificado';
    methodMap[method] = (methodMap[method] || 0) + (o.total || 0);
  });
  const methodEl = document.getElementById('finance-payment-methods');
  if (methodEl) {
    const entries = Object.entries(methodMap);
    methodEl.innerHTML = entries.length > 0
      ? entries.map(([m, v]) => `<div class="report-list-row"><span>${m}</span><strong>${appUtils.formatMoney(v)}</strong></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:0.82rem;">Sin datos en este periodo</div>';
  }

  // Pagos pendientes de cobro
  const unpaidTotal = orders.filter(o => o.status !== 'cancelado' && (o.paymentStatus || 'pagado') === 'pendiente')
    .reduce((s, o) => s + (o.total || 0), 0);
  appUtils.safeText('finance-unpaid-total', appUtils.formatMoney(unpaidTotal));
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

  // Poblar departamento/ciudad con la misma data que usa el checkout de clientes (colombia.js)
  const posDeptEl = document.getElementById('pos-customer-dept');
  const posCityEl = document.getElementById('pos-customer-city');
  if (posDeptEl && typeof COLOMBIA_LOCATIONS !== 'undefined') {
    posDeptEl.innerHTML = '<option value="">Departamento</option>' +
      Object.keys(COLOMBIA_LOCATIONS).sort().map(d => `<option value="${d}">${d}</option>`).join('');
    posDeptEl.onchange = () => {
      const cities = COLOMBIA_LOCATIONS[posDeptEl.value] || [];
      posCityEl.innerHTML = '<option value="">Ciudad</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');
      posCityEl.disabled = cities.length === 0;
      resetPOSShippingQuote();
    };
    posCityEl.onchange = resetPOSShippingQuote;
  }

  document.getElementById('btn-pos-quote-shipping')?.addEventListener('click', quotePOSShipping);
  document.getElementById('report-timeframe')?.addEventListener('change', () => {
    renderReports();
    renderFinance();
  });
  
  const searchInput = document.getElementById('pos-search-input');
  if (searchInput) searchInput.oninput = renderPOSProducts;
  
  const qrBtn = document.getElementById('pos-scan-qr-btn');
  if (qrBtn) qrBtn.onclick = startQRScanner;
  
  const createBtn = document.getElementById('btn-create-order-pos');
  if (createBtn) createBtn.onclick = createPOSOrder;
  
  document.getElementById('pos-shipping-cost-input')?.addEventListener('input', calcPOSTotals);

  const paymentSelect = document.getElementById('pos-payment-method');
  if (paymentSelect) paymentSelect.onchange = () => {
    const mixedFields = document.getElementById('pos-mixed-payment-fields');
    const hint = document.getElementById('pos-mixed-payment-hint');
    const isMixed = paymentSelect.value === 'mixto';
    if (mixedFields) mixedFields.style.display = isMixed ? 'flex' : 'none';
    if (hint) hint.style.display = isMixed ? 'block' : 'none';
    updateMixedPaymentHint();
  };
  ['pos-mixed-cash', 'pos-mixed-transfer'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateMixedPaymentHint);
  });
}

function updateMixedPaymentHint() {
  const hint = document.getElementById('pos-mixed-payment-hint');
  if (!hint) return;
  const cash = parseFloat(document.getElementById('pos-mixed-cash')?.value) || 0;
  const transfer = parseFloat(document.getElementById('pos-mixed-transfer')?.value) || 0;
  const totalText = document.getElementById('pos-total')?.textContent || '';
  const total = parseFloat(totalText.replace(/[^\d]/g, '')) || 0;
  const diff = total - (cash + transfer);
  if (diff === 0 && total > 0) {
    hint.style.color = 'var(--success, #059669)';
    hint.textContent = '✓ Los montos coinciden con el total';
  } else if (diff > 0) {
    hint.style.color = 'var(--danger, #DC2626)';
    hint.textContent = `Falta ${appUtils.formatMoney(diff)} para completar el total`;
  } else {
    hint.style.color = 'var(--danger, #DC2626)';
    hint.textContent = `Sobran ${appUtils.formatMoney(-diff)} — revisa los montos`;
  }
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
    posCart.push({
      id: p.id, name: p.name, price: p.price || 0, cost: p.cost || 0, qty: 1,
      stock: p.stock || 0,
      img: (p.images && p.images[0]) || p.image
    });
  }
  
  renderPOSCart();
}

function posChangeQty(idx, delta) {
  const item = posCart[idx];
  if (!item) return;
  const next = item.qty + delta;
  if (next <= 0) { posCart.splice(idx, 1); renderPOSCart(); return; }
  if (delta > 0 && next > item.stock) { appUtils.showToast('No hay suficiente stock'); return; }
  item.qty = next;
  renderPOSCart();
}

function posRemoveFromCart(idx) {
  posCart.splice(idx, 1);
  renderPOSCart();
}

function renderPOSCart() {
  const container = document.getElementById('pos-cart-items');
  if (!container) return;

  // Si el carrito cambia después de haber cotizado, el peso/total ya no es
  // el mismo que se cotizó — se resetea para evitar cobrar un envío desfasado.
  const statusEl = document.getElementById('pos-shipping-quote-status');
  if (posMode === 'shipping' && statusEl && statusEl.textContent) {
    resetPOSShippingQuote();
  }
  
  if (posCart.length === 0) {
    container.innerHTML = '<div class="empty-state-pos">No hay productos en el pedido</div>';
  } else {
    container.innerHTML = posCart.map((item, idx) => `
      <div class="pos-cart-item">
        ${item.img ? `<img src="${item.img}" class="pos-cart-item-img" loading="lazy" />` : '<div class="pos-cart-item-img pos-cart-item-noimg">📦</div>'}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</div>
          <div style="color:var(--primary); font-size:0.8rem;">${appUtils.formatMoney(item.price)} c/u</div>
          <div style="color:var(--text-muted); font-size:0.72rem;">Disponible: ${item.stock}</div>
        </div>
        <div class="pos-cart-qty-stepper">
          <button type="button" onclick="posChangeQty(${idx}, -1)">−</button>
          <span>${item.qty}</span>
          <button type="button" onclick="posChangeQty(${idx}, 1)">+</button>
        </div>
        <div style="font-weight:700; font-size:0.85rem; min-width:70px; text-align:right;">${appUtils.formatMoney(item.price * item.qty)}</div>
        <button class="action-btn" onclick="posRemoveFromCart(${idx})" style="color:var(--danger)">✕</button>
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
  updateMixedPaymentHint();
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

// Reutiliza el mismo endpoint /api/calcular-envio que ya cotiza en tiempo real
// con Interrapidísimo/Servientrega para el checkout de clientes.
function resetPOSShippingQuote() {
  const statusEl = document.getElementById('pos-shipping-quote-status');
  const costInput = document.getElementById('pos-shipping-cost-input');
  if (statusEl) statusEl.textContent = '';
  if (costInput) costInput.value = 0;
  calcPOSTotals();
}

async function quotePOSShipping() {
  const dept = document.getElementById('pos-customer-dept')?.value;
  const city = document.getElementById('pos-customer-city')?.value;
  const address = document.getElementById('pos-customer-address')?.value.trim();
  const zip = document.getElementById('pos-customer-zip')?.value.trim();
  const statusEl = document.getElementById('pos-shipping-quote-status');
  const costInput = document.getElementById('pos-shipping-cost-input');
  const quoteBtn = document.getElementById('btn-pos-quote-shipping');

  if (!dept || !city || !address) {
    return appUtils.showToast('Completa departamento, ciudad y dirección antes de cotizar');
  }
  if (!zip) {
    return appUtils.showToast('Ingresa el código postal para poder cotizar');
  }
  if (posCart.length === 0) {
    return appUtils.showToast('Agrega productos al pedido antes de cotizar');
  }

  if (quoteBtn) { quoteBtn.disabled = true; quoteBtn.textContent = 'Cotizando...'; }
  if (statusEl) statusEl.textContent = 'Consultando transportadoras...';

  const itemsArray = posCart.map(item => {
    const p = appState.products.find(x => x.id === item.id);
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      weight: (p && p.weight) || 0.3,
      origen: (p && p.origen) || 'propio'
    };
  });

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
      costInput.value = 0;
      if (statusEl) statusEl.textContent = '✅ Envío gratis (Bogotá)';
    } else if (data.opciones && data.opciones.length > 0) {
      // Autoselecciona la más económica; el vendedor puede editar el valor si quiere otra transportadora.
      const cheapest = [...data.opciones].sort((a, b) => a.price - b.price)[0];
      costInput.value = cheapest.price;
      if (statusEl) statusEl.textContent = `✅ ${cheapest.carrier_label || cheapest.carrier} — ${appUtils.formatMoney(cheapest.price)} (${data.opciones.length} opción(es) disponibles, se eligió la más económica)`;
    } else {
      costInput.value = data.costo_envio || 0;
      if (statusEl) statusEl.textContent = `⚠️ ${data.mensaje || 'Tarifa de respaldo aplicada'}`;
    }
  } catch (err) {
    console.error('Error cotizando envío en POS:', err);
    if (statusEl) statusEl.textContent = '❌ No se pudo cotizar. Ingresa el valor manualmente.';
    appUtils.showToast('Error al cotizar el envío');
  } finally {
    if (quoteBtn) { quoteBtn.disabled = false; quoteBtn.textContent = '📦 Cotizar Envío'; }
    calcPOSTotals();
  }
}

async function createPOSOrder() {
  if (posCart.length === 0) return appUtils.showToast('Agrega productos al pedido.');
  
  const method = document.getElementById('pos-payment-method')?.value || 'efectivo';
  const seller = document.getElementById('pos-seller-name')?.value || 'Admin';

  let mixedPayment = null;
  if (method === 'mixto') {
    const cash = parseFloat(document.getElementById('pos-mixed-cash')?.value) || 0;
    const transfer = parseFloat(document.getElementById('pos-mixed-transfer')?.value) || 0;
    mixedPayment = { cash, transfer };
  }
  
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
      dept: document.getElementById('pos-customer-dept')?.value || '',
      zip: document.getElementById('pos-customer-zip')?.value || ''
    };
    
    // Save to clients database optionally
    push(ref(appState.db, 'clients'), customerInfo);
  } else {
    customerInfo = { name: 'Cliente en Punto Físico' };
  }

  const total = subtotal + shipping;
  if (method === 'mixto' && (mixedPayment.cash + mixedPayment.transfer) !== total) {
    return appUtils.showToast('Los montos de pago mixto no coinciden con el total del pedido.');
  }
  
  const orderData = {
    timestamp: Date.now(),
    // Punto físico: la venta ya se completó en el momento (se entrega el
    // producto ahí mismo). Envío: sigue el flujo normal de gestión/despacho.
    status: posMode === 'physical' ? 'entregado' : 'gestion',
    channel: posMode === 'physical' ? 'pos' : 'whatsapp', // assuming pos or manual entry
    items: posCart,
    subtotal: subtotal,
    shippingValue: shipping,
    total: total,
    totalCost: totalCost,
    customer: customerInfo,
    paymentMethod: method,
    mixedPayment: mixedPayment,
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
    ['pos-mixed-cash', 'pos-mixed-transfer'].forEach(id => {
      if (document.getElementById(id)) document.getElementById(id).value = '';
    });
    document.getElementById('pos-mixed-payment-fields').style.display = 'none';
    document.getElementById('pos-mixed-payment-hint').style.display = 'none';
    document.getElementById('pos-payment-method').value = 'efectivo';
    if (posMode === 'shipping') {
      ['pos-customer-name','pos-customer-phone','pos-customer-address','pos-customer-zip','pos-shipping-cost-input'].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).value = '';
      });
      const statusEl = document.getElementById('pos-shipping-quote-status');
      if (statusEl) statusEl.textContent = '';
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
    let s = o.status || 'gestion';
    if (s === 'pending') s = 'gestion';
    if (s === 'completed') s = 'entregado';
    if (s === 'cancelled') s = 'cancelado';
    if (counts[s] !== undefined) counts[s]++;
  });
  
  Object.keys(counts).forEach(k => appUtils.safeText(`count-${k}`, counts[k]));
  
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  // Búsqueda
  const query = (document.getElementById('orders-search-input')?.value || '').toLowerCase();
  let filtered = orders;
  if (query) {
    filtered = orders.filter(o =>
      (o.customer?.name || '').toLowerCase().includes(query) ||
      (o.id || '').toLowerCase().includes(query)
    );
  }

  // Numeración tipo "YYYYMMDD-N": secuencial por día, en orden de creación
  const dateKey = (ts) => {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  const ascending = [...orders].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const dayCounters = {};
  const orderNumbers = {};
  ascending.forEach(o => {
    const key = dateKey(o.timestamp);
    dayCounters[key] = (dayCounters[key] || 0) + 1;
    orderNumbers[o.id] = `${key}-${dayCounters[key]}`;
  });

  const relativeDay = (ts) => {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return 'Hoy';
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return 'Ayer';
    return d.toLocaleDateString('es-CO');
  };

  const clientCode = (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    return `CLI-${digits.slice(-5).padStart(5, '0')}`;
  };

  const STATUS_BADGE = {
    borrador:     { label: 'Borrador',     bg: '#F3F4F6', color: '#6B7280' },
    gestion:      { label: 'En Gestión',   bg: '#FEF3C7', color: '#92400E' },
    alistamiento: { label: 'Alistamiento', bg: '#DBEAFE', color: '#1E40AF' },
    terminado:    { label: 'Terminado',    bg: '#E0E7FF', color: '#3730A3' },
    entregado:    { label: 'Entregado',    bg: '#DBEAFE', color: '#1D4ED8' },
    cancelado:    { label: 'Cancelado',    bg: '#FEE2E2', color: '#991B1B' }
  };

  const sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  tbody.innerHTML = sorted.map(o => {
    const items = o.items || [];
    const distinctCount = items.length;
    const unitsCount = items.reduce((s, i) => s + (i.qty || 0), 0);
    const status = STATUS_BADGE[o.status] || STATUS_BADGE.gestion;
    const paid = (o.paymentStatus || 'pagado') === 'pagado';

    return `
    <tr>
      <td><input type="checkbox" class="order-select-checkbox" data-order-id="${o.id}" /></td>
      <td>
        <strong style="color:var(--primary)">${orderNumbers[o.id] || (o.id || '').slice(-6)}</strong><br>
        <small style="color:var(--text-muted)">${distinctCount}/${unitsCount}</small><br>
        <a href="#" onclick="window.viewOrderDetails('${o.id}'); return false;" style="font-size:0.78rem;">Ver</a>
        <span style="color:var(--text-muted); font-size:0.78rem;"> | </span>
        <a href="#" onclick="window.confirmDeleteOrder('${o.id}'); return false;" style="font-size:0.78rem; color:var(--danger);">Eliminar</a>
      </td>
      <td>
        <strong>${(o.customer?.name || 'Desconocido').toUpperCase()}</strong><br>
        <small style="color:var(--text-muted)">${clientCode(o.customer?.phone)}</small><br>
        <small>📞 ${o.customer?.phone || 'Sin teléfono'}</small>
      </td>
      <td>
        ${o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-CO') : ''}<br>
        <small style="color:var(--success)">${relativeDay(o.timestamp)}</small>
      </td>
      <td>
        <span style="background:${status.bg}; color:${status.color}; padding:3px 10px; border-radius:12px; font-size:0.78rem; font-weight:700;">${status.label}</span>
      </td>
      <td>
        <strong>${appUtils.formatMoney(o.total || 0)}</strong>
        ${o.totalCost ? `<br><small style="color:var(--danger)">-${appUtils.formatMoney(o.totalCost)}</small>` : ''}
      </td>
      <td>${o.paymentMethod || 'No especificado'}</td>
      <td>
        <span onclick="window.toggleOrderPaymentStatus('${o.id}')" style="cursor:pointer; background:${paid ? '#D1FAE5' : '#FEF3C7'}; color:${paid ? '#065F46' : '#92400E'}; padding:3px 10px; border-radius:12px; font-size:0.78rem; font-weight:700;">
          ${paid ? '✓ Pagado' : '⏳ Pendiente'}
        </span>
      </td>
      <td>${o.seller || 'Web'}</td>
    </tr>
  `;
  }).join('');

  // Selección múltiple: mostrar/ocultar botón de eliminar en lote
  document.querySelectorAll('.order-select-checkbox').forEach(cb => {
    cb.onchange = updateBulkDeleteOrdersButton;
  });
}

function updateBulkDeleteOrdersButton() {
  const checked = document.querySelectorAll('.order-select-checkbox:checked');
  const btn = document.getElementById('btn-delete-selected-orders');
  if (btn) btn.style.display = checked.length > 0 ? 'inline-block' : 'none';
}

function confirmDeleteOrder(id) {
  if (!confirm('¿Eliminar este pedido? Esta acción no se puede deshacer.')) return;
  remove(ref(appState.db, `orders/${id}`));
  appUtils.showToast('Pedido eliminado');
}

async function deleteSelectedOrders() {
  const ids = Array.from(document.querySelectorAll('.order-select-checkbox:checked')).map(cb => cb.dataset.orderId);
  if (ids.length === 0) return;
  if (!confirm(`¿Eliminar ${ids.length} pedido(s) seleccionado(s)? Esta acción no se puede deshacer.`)) return;
  await Promise.all(ids.map(id => remove(ref(appState.db, `orders/${id}`))));
  appUtils.showToast(`${ids.length} pedido(s) eliminado(s)`);
}

async function toggleOrderPaymentStatus(id) {
  const o = (appState.orders || []).find(x => x.id === id);
  if (!o) return;
  const next = (o.paymentStatus || 'pagado') === 'pagado' ? 'pendiente' : 'pagado';
  await update(ref(appState.db, `orders/${id}`), { paymentStatus: next });
}

window.viewOrderDetails = function(orderId) {
  const o = (appState.orders || []).find(x => x.id === orderId);
  if (!o) return;

  appUtils.safeText('modal-order-details-title', `Pedido #${(o.id || '').slice(-6).toUpperCase()}`);

  const itemsHTML = (o.items || []).map(i => `
    <div style="display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px dashed #e0e5f2; font-size:0.85rem;">
      <span>${i.name} x${i.qty}</span>
      <span>${appUtils.formatMoney((i.price || 0) * (i.qty || 0))}</span>
    </div>
  `).join('') || '<p style="color:var(--text-muted);">Sin productos registrados.</p>';

  const mixedHTML = o.mixedPayment
    ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">Efectivo: ${appUtils.formatMoney(o.mixedPayment.cash || 0)} · Transferencia: ${appUtils.formatMoney(o.mixedPayment.transfer || 0)}</div>`
    : '';

  const addressHTML = (o.customer && o.customer.address)
    ? `<div style="margin-top:0.75rem;"><strong>📍 Envío a:</strong><br>${o.customer.address}, ${o.customer.city || ''} (${o.customer.dept || ''})</div>`
    : '';

  document.getElementById('order-details-content').innerHTML = `
    <div><strong>Cliente:</strong> ${o.customer?.name || 'Desconocido'} — ${o.customer?.phone || 'Sin teléfono'}</div>
    <div><strong>Vendedor:</strong> ${o.seller || 'Web'} · <strong>Canal:</strong> ${o.channel === 'pos' ? 'Punto físico' : (o.channel || 'Web')}</div>
    ${addressHTML}
    <div style="margin-top:0.9rem; margin-bottom:0.4rem; font-weight:800;">🛒 Productos</div>
    ${itemsHTML}
    <div style="display:flex; justify-content:space-between; padding-top:0.6rem; font-size:0.85rem;">
      <span>Subtotal</span><span>${appUtils.formatMoney(o.subtotal || 0)}</span>
    </div>
    ${o.shippingValue ? `<div style="display:flex; justify-content:space-between; font-size:0.85rem;"><span>Envío</span><span>${appUtils.formatMoney(o.shippingValue)}</span></div>` : ''}
    <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1rem; margin-top:0.4rem;">
      <span>Total</span><span style="color:var(--primary)">${appUtils.formatMoney(o.total || 0)}</span>
    </div>
    <div style="margin-top:0.5rem;"><strong>Método de pago:</strong> ${o.paymentMethod || 'No especificado'}</div>
    ${mixedHTML}
    <div style="margin-top:0.9rem;">
      <label class="field-label">Estado del pedido</label>
      <select class="field-input" onchange="changeOrderStatus('${o.id}', this.value)">
        <option value="borrador" ${o.status==='borrador'?'selected':''}>Borrador</option>
        <option value="gestion" ${(o.status==='gestion'||!o.status)?'selected':''}>En Gestión</option>
        <option value="alistamiento" ${o.status==='alistamiento'?'selected':''}>Alistamiento</option>
        <option value="terminado" ${o.status==='terminado'?'selected':''}>Terminado</option>
        <option value="entregado" ${o.status==='entregado'?'selected':''}>Entregado</option>
        <option value="cancelado" ${o.status==='cancelado'?'selected':''}>Cancelado</option>
      </select>
    </div>
  `;
  appUtils.safeStyle('modal-order-details', 'display', 'flex');
};

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
let productsSortState = { key: null, dir: 1 };
let productsCurrentPage = 1;
const PRODUCTS_PER_PAGE = 20;

function renderProductsTable() {
  const tbody = document.getElementById('products-table-body');
  if (!tbody) return;

  const allProducts = appState.products || [];
  const query = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  const categoryFilter = document.getElementById('products-category-filter')?.value || '';
  const stockFilter = document.querySelector('.stock-filter-chip.active')?.dataset.filter || 'all';

  // Categorías disponibles (se recalculan cada vez por si se agregó una nueva)
  const catSelect = document.getElementById('products-category-filter');
  if (catSelect) {
    const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();
    const currentVal = catSelect.value;
    catSelect.innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
    catSelect.value = currentVal;
  }

  // Ventas por producto (para la columna de Rotación)
  const salesMap = {};
  (appState.orders || []).forEach(o => {
    if (o.status !== 'cancelado') {
      (o.items || []).forEach(i => { salesMap[i.id] = (salesMap[i.id] || 0) + (i.qty || 1); });
    }
  });

  // Enriquecer cada producto con los valores calculados, una sola vez
  let products = allProducts.map(p => {
    const cost = parseFloat(p.cost) || 0;
    const price = parseFloat(p.price) || 0;
    const stock = parseInt(p.stock) || 0;
    const minStock = p.minStock || 3;
    return {
      ...p, cost, price, stock, minStock,
      netProfit: price - cost,
      totalProfit: (price - cost) * stock,
      rotation: salesMap[p.id] || 0
    };
  });

  // KPIs (calculados sobre el inventario completo, sin filtrar)
  appUtils.safeText('kpi-total-products', products.length);
  appUtils.safeText('kpi-inventory-value', appUtils.formatMoney(products.reduce((s, p) => s + p.cost * p.stock, 0)));
  appUtils.safeText('kpi-low-stock', products.filter(p => p.stock > 0 && p.stock <= p.minStock).length);
  appUtils.safeText('kpi-out-of-stock', products.filter(p => p.stock <= 0).length);

  // Filtros
  if (query) {
    products = products.filter(p => (p.name || '').toLowerCase().includes(query) || (p.ref || '').toLowerCase().includes(query));
  }
  if (categoryFilter) {
    products = products.filter(p => p.category === categoryFilter);
  }
  if (stockFilter === 'low') products = products.filter(p => p.stock > 0 && p.stock <= p.minStock);
  else if (stockFilter === 'out') products = products.filter(p => p.stock <= 0);
  else if (stockFilter === 'inactive') products = products.filter(p => p.active === false);

  // Orden
  if (productsSortState.key) {
    const k = productsSortState.key;
    products.sort((a, b) => {
      let va = k === 'name' ? (a.name || '').toLowerCase() : a[k];
      let vb = k === 'name' ? (b.name || '').toLowerCase() : b[k];
      if (va < vb) return -1 * productsSortState.dir;
      if (va > vb) return 1 * productsSortState.dir;
      return 0;
    });
  }

  document.querySelectorAll('.sortable-th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === productsSortState.key) {
      arrow.textContent = productsSortState.dir === 1 ? '▲' : '▼';
    } else {
      arrow.textContent = '';
    }
  });

  // Paginación
  const totalPages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));
  if (productsCurrentPage > totalPages) productsCurrentPage = totalPages;
  const startIdx = (productsCurrentPage - 1) * PRODUCTS_PER_PAGE;
  const pageProducts = products.slice(startIdx, startIdx + PRODUCTS_PER_PAGE);

  if (pageProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:2rem;">No se encontraron productos con estos filtros.</td></tr>`;
  } else {
    tbody.innerHTML = pageProducts.map(p => {
      const img = (p.images && p.images[0]) ? p.images[0] : (p.image || '');
      let stockBadge = '';
      if (p.stock <= 0) stockBadge = '<br><span class="stock-badge stock-badge-out">Agotado</span>';
      else if (p.stock <= p.minStock) stockBadge = '<br><span class="stock-badge stock-badge-low">Bajo stock</span>';

      return `
        <tr>
          <td><input type="checkbox" class="product-select-checkbox" data-product-id="${p.id}" /></td>
          <td>${img ? `<img src="${img}" class="table-img" loading="lazy" />` : '📦'}</td>
          <td><strong>${p.name}</strong><br><small>${p.ref || 'Sin ref'}${p.category ? ` · ${p.category}` : ''}</small></td>
          <td>
             <span style="font-weight:bold; font-size:1.1rem; color:${p.stock <= p.minStock ? 'var(--danger)' : 'var(--text-main)'}">${p.stock}</span>
             ${stockBadge}
          </td>
          <td>${appUtils.formatMoney(p.cost)}</td>
          <td>${appUtils.formatMoney(p.price)}</td>
          <td style="color:var(--success); font-weight:bold;">${appUtils.formatMoney(p.netProfit)}</td>
          <td style="color:var(--success);">${appUtils.formatMoney(p.totalProfit)}</td>
          <td>${p.rotation} uds.</td>
          <td>
            <span class="status-toggle-badge ${p.active === false ? 'status-inactive' : 'status-active'}" onclick="window.toggleProductActive('${p.id}')">
              ${p.active === false ? '⏸ Inactivo' : '✓ Activo'}
            </span>
          </td>
          <td>
             <button class="action-btn" onclick="openProductModal('${p.id}')">✏️</button>
             <button class="action-btn" style="color:var(--text-muted);" onclick="window.openProductHistory('${p.id}')">📜</button>
             <button class="action-btn" style="color:var(--danger);" onclick="promptCastigo('${p.id}')">⬇️</button>
             <button class="action-btn" style="color:var(--danger);" onclick="window.confirmDeleteProduct('${p.id}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Controles de paginación
  const pag = document.getElementById('products-pagination');
  if (pag) {
    if (totalPages <= 1) {
      pag.innerHTML = '';
    } else {
      let btns = '';
      for (let i = 1; i <= totalPages; i++) {
        btns += `<button type="button" class="page-btn ${i === productsCurrentPage ? 'active' : ''}" onclick="window.goToProductsPage(${i})">${i}</button>`;
      }
      pag.innerHTML = `
        <button type="button" class="page-btn" ${productsCurrentPage === 1 ? 'disabled' : ''} onclick="window.goToProductsPage(${productsCurrentPage - 1})">‹</button>
        ${btns}
        <button type="button" class="page-btn" ${productsCurrentPage === totalPages ? 'disabled' : ''} onclick="window.goToProductsPage(${productsCurrentPage + 1})">›</button>
        <span class="page-info">${products.length} producto(s)</span>
      `;
    }
  }

  document.querySelectorAll('.product-select-checkbox').forEach(cb => {
    cb.onchange = updateBulkDeleteProductsButton;
  });
}

window.goToProductsPage = function(page) {
  productsCurrentPage = page;
  renderProductsTable();
};

function updateBulkDeleteProductsButton() {
  const checked = document.querySelectorAll('.product-select-checkbox:checked');
  const btn = document.getElementById('btn-delete-selected-products');
  if (btn) btn.style.display = checked.length > 0 ? 'inline-block' : 'none';
}

async function deleteSelectedProducts() {
  const ids = Array.from(document.querySelectorAll('.product-select-checkbox:checked')).map(cb => cb.dataset.productId);
  if (ids.length === 0) return;
  if (!confirm(`¿Eliminar ${ids.length} producto(s) seleccionado(s)? Esta acción no se puede deshacer.`)) return;
  await Promise.all(ids.map(id => remove(ref(appState.db, `products/${id}`))));
  appUtils.showToast(`${ids.length} producto(s) eliminado(s)`);
  if (window.loadCatalog) window.loadCatalog();
}

window.toggleProductActive = async function(id) {
  const p = appState.products.find(x => x.id === id);
  if (!p) return;
  await update(ref(appState.db, `products/${id}`), { active: p.active === false ? true : false });
  if (window.loadCatalog) window.loadCatalog();
};

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
window.openProductHistory = function(id) {
  const p = appState.products.find(x => x.id === id);
  if (!p) return;
  appUtils.safeText('modal-history-title', `Historial — ${p.name}`);
  const list = document.getElementById('product-history-list');
  const movements = p.movements ? Object.values(p.movements).sort((a, b) => (b.date || 0) - (a.date || 0)) : [];

  if (movements.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1.5rem 0;">Sin movimientos registrados todavía.</p>';
  } else {
    const TYPE_LABELS = { out_castigo: '⬇️ Castigo', in_bulk: '📥 Carga masiva', in_manual: '📥 Ajuste manual', out_sale: '🛒 Venta' };
    list.innerHTML = movements.map(m => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--secondary, #E5E7EB);">
        <div>
          <div style="font-weight:700; font-size:0.85rem;">${TYPE_LABELS[m.type] || m.type}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${m.date ? new Date(m.date).toLocaleString('es-CO') : 'Sin fecha'}</div>
          ${m.reason ? `<div style="font-size:0.78rem; color:var(--text-secondary);">${m.reason}</div>` : ''}
        </div>
        <div style="font-weight:800; color:var(--danger);">-${m.qty}</div>
      </div>
    `).join('');
  }
  appUtils.safeStyle('modal-product-history', 'display', 'flex');
};

// ==========================================
// MODULE: CLIENTES (Crear / Editar)
// ==========================================
function openClientModal(id = null) {
  window.currentEditClientId = id;
  const c = id ? (appState.clients || []).find(x => x.id === id) : null;

  appUtils.safeText('modal-client-title', c ? 'Editar Cliente' : 'Nuevo Cliente');
  appUtils.safeValue('client-name', c ? (c.name || '') : '');
  appUtils.safeValue('client-phone', c ? (c.phone || '') : '');
  appUtils.safeValue('client-dept', c ? (c.dept || '') : '');
  appUtils.safeValue('client-city', c ? (c.city || '') : '');
  appUtils.safeValue('client-barrio', c ? (c.barrio || '') : '');
  appUtils.safeValue('client-address', c ? (c.address || '') : '');
  appUtils.safeValue('client-notes', c ? (c.notes || '') : '');
  appUtils.safeStyle('btn-delete-client', 'display', c ? 'block' : 'none');
  appUtils.safeStyle('modal-client', 'display', 'flex');
}

async function saveClient() {
  const name = document.getElementById('client-name')?.value.trim();
  const phone = document.getElementById('client-phone')?.value.trim();
  if (!name || !phone) return appUtils.showToast('Nombre y celular son obligatorios');

  const cData = {
    name, phone,
    dept: document.getElementById('client-dept')?.value.trim() || '',
    city: document.getElementById('client-city')?.value.trim() || '',
    barrio: document.getElementById('client-barrio')?.value.trim() || '',
    address: document.getElementById('client-address')?.value.trim() || '',
    notes: document.getElementById('client-notes')?.value.trim() || ''
  };

  try {
    if (window.currentEditClientId) {
      await update(ref(appState.db, `clients/${window.currentEditClientId}`), cData);
    } else {
      await push(ref(appState.db, 'clients'), cData);
    }
    appUtils.safeStyle('modal-client', 'display', 'none');
    appUtils.showToast('Cliente guardado ✅');
  } catch (err) {
    console.error('Error guardando cliente:', err);
    appUtils.showToast('Error al guardar: ' + err.message);
  }
}

async function deleteClient(id) {
  if (!confirm('¿Eliminar este cliente?')) return;
  await remove(ref(appState.db, `clients/${id}`));
  appUtils.safeStyle('modal-client', 'display', 'none');
  appUtils.showToast('Cliente eliminado');
}

function renderClientsTable() {
  const tbody = document.getElementById('clients-table-body');
  if (!tbody) return;
  
  const query = (document.getElementById('clients-search-input')?.value || '').toLowerCase();
  let clients = appState.clients || [];
  const orders = appState.orders || [];

  const clientCode = (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    return `CLI-${digits.slice(-5).padStart(5, '0')}`;
  };

  // Gasto real por cliente: se suman los pedidos confirmados (no cancelados) que
  // coinciden por teléfono, ya sean del checkout web o del POS.
  const spentByPhone = {};
  const ordersByPhone = {};
  orders.forEach(o => {
    const phone = o.customer?.phone;
    if (!phone || o.status === 'cancelado') return;
    spentByPhone[phone] = (spentByPhone[phone] || 0) + (o.total || 0);
    ordersByPhone[phone] = (ordersByPhone[phone] || 0) + 1;
  });

  // Agrupar clientes únicos por teléfono (pueden llegar duplicados desde varios pedidos)
  const map = {};
  clients.forEach(c => {
    if (c.phone && !map[c.phone]) map[c.phone] = c;
  });

  let unique = Object.values(map).map(c => ({
    ...c,
    totalSpent: spentByPhone[c.phone] || 0,
    orderCount: ordersByPhone[c.phone] || 0
  }));

  // KPIs (sobre todos los clientes, sin filtrar por búsqueda)
  appUtils.safeText('kpi-total-clients', unique.length);
  appUtils.safeText('kpi-clients-total-value', appUtils.formatMoney(unique.reduce((s, c) => s + c.totalSpent, 0)));
  const topClient = [...unique].sort((a, b) => b.totalSpent - a.totalSpent)[0];
  appUtils.safeText('kpi-top-client', topClient && topClient.totalSpent > 0 ? topClient.name : '—');

  if (query) {
    unique = unique.filter(c => (c.name || '').toLowerCase().includes(query) || (c.phone || '').includes(query));
  }

  // Mejores clientes primero — más útil para un CRM que el orden de llegada
  unique.sort((a, b) => b.totalSpent - a.totalSpent);
  
  if (unique.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Sin clientes todavía. Se agregan automáticamente al crear un pedido con envío, o puedes crear uno manualmente.</td></tr>`;
    return;
  }

  tbody.innerHTML = unique.map(c => `
    <tr>
      <td><strong>${c.name}</strong><br><small style="color:var(--text-muted)">${clientCode(c.phone)}</small></td>
      <td>📞 ${c.phone}</td>
      <td>${c.city || ''} <small>${c.dept ? `(${c.dept})` : ''}</small></td>
      <td>${c.address || ''}</td>
      <td>${c.orderCount}</td>
      <td><strong style="color:var(--success)">${appUtils.formatMoney(c.totalSpent)}</strong></td>
      <td>
        <button class="action-btn" onclick="window.openClientModal('${c.id || ''}')">✏️ Editar</button>
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

// ==========================================
// MODULE: VENTA EXTERNA (ML / Otro canal)
// ==========================================
let extItems = []; // [{productId, name, price, cost, qty}]

function openExternalSaleModal() {
  extItems = [];
  appUtils.safeStyle('modal-external-sale', 'display', 'flex');
  // Reset form
  const fields = ['ext-customer-name','ext-customer-phone','ext-order-id','ext-notes',
                   'ext-ml-commission-pct','ext-shipping-cost','ext-ad-cost'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = el.defaultValue || ''; });
  document.getElementById('ext-ml-commission-pct').value = '13';
  document.getElementById('ext-shipping-cost').value = '';
  document.getElementById('ext-ad-cost').value = '';
  // Reset channel
  document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
  const firstBtn = document.querySelector('.channel-btn[data-channel="mercado_libre"]');
  if (firstBtn) firstBtn.classList.add('active');
  const hiddenChannel = document.getElementById('ext-channel');
  if (hiddenChannel) hiddenChannel.value = 'mercado_libre';
  // Channel selector
  document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hiddenCh = document.getElementById('ext-channel');
      if (hiddenCh) hiddenCh.value = btn.dataset.channel;
      const costsSection = document.getElementById('ext-ml-costs');
      if (costsSection) costsSection.style.display = btn.dataset.channel === 'mercado_libre' ? 'block' : 'none';
      calcExtTotals();
    };
  });
  // Show ML costs by default
  const costsSection = document.getElementById('ext-ml-costs');
  if (costsSection) costsSection.style.display = 'block';
  // Live recalc on cost inputs
  ['ext-ml-commission-pct','ext-shipping-cost','ext-ad-cost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = calcExtTotals;
  });
  renderExtItems();
  calcExtTotals();
}

function closeExternalSaleModal() {
  appUtils.safeStyle('modal-external-sale', 'display', 'none');
}

function addExtItem() {
  // Muestra un select rapido de productos
  const products = appState.products || [];
  const opts = products.filter(p => p.active).map(p =>
    `<option value="${p.id}">${p.name} — ${appUtils.formatMoney(p.price || 0)}</option>`
  ).join('');

  const wrapper = document.createElement('div');
  wrapper.className = 'ext-item-row';
  wrapper.style.cssText = 'display:flex;gap:0.4rem;align-items:center;margin-bottom:0.4rem;';
  wrapper.innerHTML = `
    <select class="field-input ext-item-product" style="flex:3;font-size:0.8rem;padding:0.3rem;">
      <option value="">-- Producto --</option>${opts}
    </select>
    <input type="number" class="field-input ext-item-qty" placeholder="Cant." value="1" min="1" style="flex:1;font-size:0.8rem;padding:0.3rem;">
    <input type="text" class="field-input ext-item-price" placeholder="Precio venta" inputmode="numeric" style="flex:2;font-size:0.8rem;padding:0.3rem;">
    <button type="button" onclick="this.parentElement.remove(); calcExtTotals();"
      style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;flex-shrink:0;">x</button>
  `;
  // Auto-fill price when product selected
  wrapper.querySelector('.ext-item-product').onchange = function() {
    const p = (appState.products || []).find(x => x.id === this.value);
    if (p) wrapper.querySelector('.ext-item-price').value = Math.round(p.price || 0);
    calcExtTotals();
  };
  wrapper.querySelector('.ext-item-qty').oninput = calcExtTotals;
  wrapper.querySelector('.ext-item-price').oninput = calcExtTotals;

  const list = document.getElementById('ext-items-list');
  if (list) list.appendChild(wrapper);
}

window.calcExtTotals = function() {
  const rows = document.querySelectorAll('.ext-item-row');
  let subtotal = 0;
  let totalCost = 0;
  rows.forEach(row => {
    const pid = row.querySelector('.ext-item-product')?.value;
    const qty = parseFloat(row.querySelector('.ext-item-qty')?.value) || 1;
    const price = parseFloat(row.querySelector('.ext-item-price')?.value?.replace(/\./g,'')) || 0;
    subtotal += price * qty;
    const p = (appState.products || []).find(x => x.id === pid);
    if (p) totalCost += (parseFloat(p.cost) || 0) * qty;
  });

  const channel = document.getElementById('ext-channel')?.value || 'otro';
  const commissionPct = channel === 'mercado_libre'
    ? (parseFloat(document.getElementById('ext-ml-commission-pct')?.value) || 0) : 0;
  const shippingCost = parseFloat(document.getElementById('ext-shipping-cost')?.value?.replace(/\./g,'')) || 0;
  const adCost = parseFloat(document.getElementById('ext-ad-cost')?.value?.replace(/\./g,'')) || 0;

  const commission = subtotal * (commissionPct / 100);
  const netProfit = subtotal - totalCost - commission - shippingCost - adCost;

  // Update summary
  appUtils.safeText('ext-fin-subtotal', appUtils.formatMoney(subtotal));

  const commRow = document.getElementById('ext-fin-commission-row');
  if (commRow) commRow.style.display = commission > 0 ? 'flex' : 'none';
  appUtils.safeText('ext-fin-commission', '-' + appUtils.formatMoney(commission));

  const shipRow = document.getElementById('ext-fin-shipping-row');
  if (shipRow) shipRow.style.display = shippingCost > 0 ? 'flex' : 'none';
  appUtils.safeText('ext-fin-shipping', '-' + appUtils.formatMoney(shippingCost));

  const adRow = document.getElementById('ext-fin-ad-row');
  if (adRow) adRow.style.display = adCost > 0 ? 'flex' : 'none';
  appUtils.safeText('ext-fin-ad', '-' + appUtils.formatMoney(adCost));

  const profitEl = document.getElementById('ext-fin-profit');
  if (profitEl) {
    profitEl.textContent = appUtils.formatMoney(netProfit);
    profitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
  }
};

async function saveExternalSale() {
  const rows = document.querySelectorAll('.ext-item-row');
  if (rows.length === 0) return appUtils.showToast('Agrega al menos un producto.');

  const items = [];
  let subtotal = 0;
  let totalCost = 0;
  let valid = true;

  rows.forEach(row => {
    const pid = row.querySelector('.ext-item-product')?.value;
    const qty = parseInt(row.querySelector('.ext-item-qty')?.value) || 1;
    const price = parseFloat(row.querySelector('.ext-item-price')?.value?.replace(/\./g,'')) || 0;
    if (!pid || price <= 0) { valid = false; return; }
    const p = (appState.products || []).find(x => x.id === pid);
    items.push({ id: pid, name: p?.name || '', price, cost: parseFloat(p?.cost) || 0, qty });
    subtotal += price * qty;
    totalCost += (parseFloat(p?.cost) || 0) * qty;
  });

  if (!valid) return appUtils.showToast('Completa todos los productos con precio.');

  const channel = document.getElementById('ext-channel')?.value || 'otro';
  const commissionPct = channel === 'mercado_libre'
    ? (parseFloat(document.getElementById('ext-ml-commission-pct')?.value) || 0) : 0;
  const shippingCost = parseFloat(document.getElementById('ext-shipping-cost')?.value?.replace(/\./g,'')) || 0;
  const adCost = parseFloat(document.getElementById('ext-ad-cost')?.value?.replace(/\./g,'')) || 0;
  const commission = subtotal * (commissionPct / 100);
  const netProfit = subtotal - totalCost - commission - shippingCost - adCost;

  const orderData = {
    timestamp: Date.now(),
    status: 'entregado',
    channel,
    items,
    subtotal,
    shippingValue: shippingCost,
    total: subtotal,
    totalCost,
    commissionPct,
    commissionValue: commission,
    adCost,
    netProfit,
    customer: {
      name: document.getElementById('ext-customer-name')?.value || 'Cliente Externo',
      phone: document.getElementById('ext-customer-phone')?.value || ''
    },
    externalOrderId: document.getElementById('ext-order-id')?.value || '',
    notes: document.getElementById('ext-notes')?.value || '',
    paymentMethod: channel,
    seller: 'Admin'
  };

  try {
    appUtils.showToast('Guardando venta...');
    await push(ref(appState.db, 'orders'), orderData);
    appUtils.showToast('Venta registrada con exito');
    closeExternalSaleModal();
    document.querySelector('.admin-nav-btn[data-tab="orders"]')?.click();
  } catch (e) {
    appUtils.showToast('Error: ' + e.message);
  }
}
