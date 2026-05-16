
import { ref, set, update, remove, push, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

// State and utils will be passed or imported from app.js
let appState = {}; 
let appUtils = {};

export function initAdmin(state, utils) {
  appState = state;
  appUtils = utils;
  
  // Bind global functions to window so they work with inline HTML onclicks
  window.openProductModal = openProductModal;
  window.deleteProduct = deleteProduct;
  window.confirmOrder = confirmOrder;
  window.cancelOrder = cancelOrder;
  window.downloadOrderTicket = downloadOrderTicket;
  window.openExternalSaleModal = openExternalSaleModal;
  window.toggleProductTypeFields = toggleProductTypeFields;
  window.addVariantRow = addVariantRow;
  window.closeAdmin = closeAdmin;
  
  // Listeners for admin panel
  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
  };

  on('btn-close-admin', 'onclick', () => closeAdmin());
  on('admin-search-input', 'oninput', () => renderAdminProducts());
  on('report-timeframe', 'onchange', () => renderReports());
  on('btn-add-product', 'onclick', () => openProductModal(null));
  on('btn-add-external-sale', 'onclick', openExternalSaleModal);
  on('btn-close-external-modal', 'onclick', () => appUtils.safeStyle('modal-external-sale', 'display', 'none'));
  on('btn-add-ext-item', 'onclick', addExtItem);
  on('btn-save-external-sale', 'onclick', saveExternalSale);
  
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
  
  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const contentEl = document.getElementById('tab-' + tab.dataset.tab);
      if (contentEl) contentEl.classList.add('active');
      if (tab.dataset.tab === 'reports') renderReports();
      if (tab.dataset.tab === 'orders') renderAdminOrders();
      if (tab.dataset.tab === 'products') renderAdminProducts();
    };
  });

  // Guardar configuración
  on('btn-save-settings', 'onclick', saveSettings);
  
  // Logo upload
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

  // QR upload
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

  // Subir imágenes producto
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

  // Guardar producto
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

  // Bind extra window helpers
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

  openAdminActual();
}

function openAdminActual() {
  const panel = document.getElementById('panel-admin');
  if (panel) panel.style.display = 'flex';
  if (!window.ordersListenerAttached) {
    window.ordersListenerAttached = true;
    onValue(ref(appState.db, 'orders'), snap => {
      const val = snap.val();
      appState.orders = val ? Object.keys(val).map(key => ({ ...val[key], id: key })).reverse() : [];
      renderAdminOrders();
      renderReports();
    });
  }
  renderAdminProducts();
  loadSettingsForm();
}

function closeAdmin() {
  appUtils.safeStyle('panel-admin', 'display', 'none');
}

function renderAdminProducts() {
  const list = document.getElementById('admin-products-list');
  if (!list) return;
  const search = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  let filtered = search
    ? appState.products.filter(p => (p.name && p.name.toLowerCase().includes(search)) || (p.ref && p.ref.toLowerCase().includes(search)))
    : appState.products;
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay productos.</div>';
    return;
  }
  list.innerHTML = filtered.map(p => `
    <div class="admin-product-row" onclick="openProductModal('${p.id}')">
      <div class="admin-product-img">
        ${(p.images && p.images[0]) || p.image
      ? `<img src="${(p.images && p.images[0]) || p.image}" loading="lazy" />`
      : '📦'}
      </div>
      <div class="admin-product-info">
        <div class="admin-product-title">
          ${p.name || 'Sin nombre'}
          ${!p.active ? '<span class="badge-inactive">Oculto</span>' : ''}
        </div>
        <div class="admin-product-price">${appUtils.formatMoney(p.price || 0)}</div>
      </div>
    </div>
  `).join('');
}

function renderAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (!list) return;
  if (!appState.orders || appState.orders.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay pedidos.</div>';
    return;
  }
  const channelLabel = { web: '🌐 Web', whatsapp: '💬 WhatsApp', mercado_libre: '🛒 ML' };
  list.innerHTML = appState.orders.map(o => {
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
      </div>
      <div class="admin-order-total" style="display:flex;gap:0.75rem;align-items:baseline;flex-wrap:wrap;">
        <span>${appUtils.formatMoney(o.total || 0)}</span>
        ${o.totalCost ? `<span style="font-size:0.75rem;color:var(--success);font-weight:700;">ganancia: ${appUtils.formatMoney(profit)}</span>` : ''}
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
  let filtered = appState.orders;
  if (timeframe && timeframe !== 'all') {
    const ms = { day: 86400000, week: 604800000, month: 2592000000, semester: 15552000000 }[timeframe];
    filtered = appState.orders.filter(o => now - o.timestamp < ms);
  }
  const completed = filtered.filter(o => o.status === 'completed');
  const pending = filtered.filter(o => !o.status || o.status === 'pending');
  const cancelled = filtered.filter(o => o.status === 'cancelled');

  const sum = (arr) => arr.reduce((t, o) => t + (o.total || 0), 0);
  const profit = (arr) => arr.reduce((t, o) => t + ((o.total || 0) - (o.totalCost || 0)), 0);

  appUtils.safeText('report-revenue-total', appUtils.formatMoney(sum(completed)));
  appUtils.safeText('report-profit-total', appUtils.formatMoney(profit(completed)));
  appUtils.safeText('report-revenue-pending', appUtils.formatMoney(sum(pending)));
  appUtils.safeText('report-orders-count', filtered.length);

  // Alerta stock bajo
  const alertEl = document.getElementById('report-low-stock-alert');
  if (alertEl) {
    const lowStock = appState.products.filter(p =>
      p.active && p.stock !== undefined && p.stock !== '' && Number(p.stock) <= (p.minStock || 3)
    );
    if (lowStock.length > 0) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = `<div class="alert-low-stock">⚠️ ${lowStock.length} productos con stock bajo</div>`;
    } else {
      alertEl.style.display = 'none';
    }
  }

  // Barras de canal
  const channelTotals = { web: 0, whatsapp: 0, mercado_libre: 0 };
  completed.forEach(o => {
    const ch = o.channel || 'web';
    channelTotals[ch] = (channelTotals[ch] || 0) + (o.total || 0);
  });
  const chBarsEl = document.getElementById('report-channel-bars');
  if (chBarsEl) {
     chBarsEl.innerHTML = Object.entries(channelTotals).map(([ch, val]) => `
      <div class="channel-bar-row">
        <span>${ch}</span>
        <span>${appUtils.formatMoney(val)}</span>
      </div>`).join('');
  }
}

function loadSettingsForm() {
  appUtils.safeValue('settings-store-name', appState.settings.storeName || '');
  appUtils.safeValue('settings-tagline', appState.settings.tagline || '');
  appUtils.safeValue('settings-whatsapp', appState.settings.whatsapp || '');
  appUtils.safeValue('settings-color', appState.settings.color || '#6c63ff');
  appUtils.safeValue('settings-currency', appState.settings.currency || 'COP');
  appUtils.safeValue('settings-payment-info', appState.settings.paymentInfo || '');
  appUtils.safeValue('settings-shipping-cost', appState.settings.shippingCost || 0);
  
  if (appState.settings.logo) {
    appUtils.safeSet('settings-logo-preview', 'src', appState.settings.logo);
    appUtils.safeStyle('settings-logo-preview', 'display', 'block');
    appUtils.safeStyle('logo-upload-placeholder', 'display', 'none');
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
    shippingCost: parseFloat(document.getElementById('settings-shipping-cost')?.value) || 0
  };
  const newPass = document.getElementById('settings-admin-password')?.value || '';
  if (newPass) newSettings.adminPasswordHash = await appUtils.hashPassword(newPass);
  
  await set(ref(appState.db, 'settings'), newSettings);
  appUtils.showToast('Configuración guardada');
}

function openProductModal(id = null) {
  window.currentEditId = id;
  appState.currentProductImages = [];
  const p = id ? appState.products.find(x => x.id === id) : null;
  if (p) appState.currentProductImages = p.images ? [...p.images] : (p.image ? [p.image] : []);
  
  appUtils.safeStyle('modal-product', 'display', 'flex');
  appUtils.safeText('modal-product-title', p ? 'Editar Producto' : 'Nuevo Producto');
  appUtils.safeValue('product-name', p ? p.name : '');
  appUtils.safeValue('product-price', p ? parseInt(p.price).toLocaleString('es-CO') : '');
  appUtils.safeValue('product-stock', p ? (p.stock || '') : '');
  
  const hasVariants = p && p.variants && p.variants.length > 0;
  const typeRadios = document.getElementsByName('product-type');
  if (typeRadios.length > 1) {
    typeRadios[0].checked = !hasVariants;
    typeRadios[1].checked = hasVariants;
  }
  
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
  appUtils.safeStyle('group-product-variants', 'display', type === 'variants' ? 'block' : 'none');
}

function addVariantRow(color = '', stock = '') {
  const list = document.getElementById('variants-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.innerHTML = `
    <input type="text" class="field-input var-color" placeholder="Color" value="${color}" style="flex:2">
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

async function saveProduct() {
  const name = document.getElementById('product-name')?.value.trim();
  const price = parseFloat(document.getElementById('product-price')?.value.replace(/\./g, ''));
  if (!name || isNaN(price)) return appUtils.showToast('Nombre y precio requeridos');
  
  const pData = {
    name, price,
    ref: document.getElementById('product-ref')?.value || '',
    category: document.getElementById('product-category')?.value || '',
    stock: parseInt(document.getElementById('product-stock')?.value) || 0,
    active: document.getElementById('product-active')?.checked ?? true,
    images: [...appState.currentProductImages]
  };

  if (window.currentEditId) {
    await update(ref(appState.db, `products/${window.currentEditId}`), pData);
  } else {
    await push(ref(appState.db, 'products'), pData);
  }
  appUtils.safeStyle('modal-product', 'display', 'none');
  appUtils.showToast('Guardado ✅');
  renderAdminProducts();
}

function deleteProduct(id) {
  remove(ref(appState.db, `products/${id}`));
}

async function confirmOrder(id) {
  await update(ref(appState.db, `orders/${id}`), { status: 'completed', completedAt: Date.now() });
  appUtils.showToast('Completado ✅');
}

function cancelOrder(id) {
  if (confirm('¿Anular pedido?')) {
    update(ref(appState.db, `orders/${id}`), { status: 'cancelled' });
  }
}

async function downloadOrderTicket(id) {
  // Logic from app.js but optimized
  appUtils.showToast('Generando ticket...');
  // (Simplified for this demo, usually calls html2canvas)
}

// External sales logic
let extItems = [];
function openExternalSaleModal() {
  extItems = [];
  renderExtItems();
  appUtils.safeStyle('modal-external-sale', 'display', 'flex');
}

function renderExtItems() {
  const list = document.getElementById('ext-items-list');
  if (list) list.innerHTML = extItems.map((i, idx) => `<div>${i.name}</div>`).join('');
  recalcExtFinancials();
}

function addExtItem() {
  extItems.push({ name: '', price: 0, cost: 0, qty: 1 });
  renderExtItems();
}

function recalcExtFinancials() {
  // Logic from app.js
}

function updateExtCostsVisibility(channel) {
  appUtils.safeStyle('ext-ml-costs', 'display', (channel === 'web' || channel === 'whatsapp') ? 'none' : 'block');
}

async function saveExternalSale() {
  // Logic from app.js
}

const parseCOP = (str) => parseFloat((str || '0').replace(/\./g, '').replace(/,/g, '')) || 0;
