
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
  window.deleteCustomerPhoto = deleteCustomerPhoto;
  window.closeAdmin = closeAdmin;
  window.renderReports = renderReports;
  window.renderAdminOrders = renderAdminOrders;
  window.renderAdminProducts = renderAdminProducts;
  window.removeProductImage = removeProductImage;
  
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

  // Excel Bulk Upload
  on('btn-bulk-excel', 'onclick', () => document.getElementById('bulk-upload-excel')?.click());
  on('bulk-upload-excel', 'onchange', handleBulkExcelUpload);
  on('btn-bulk-photos', 'onclick', () => document.getElementById('bulk-upload-photos')?.click());
  on('bulk-upload-photos', 'onchange', handleBulkPhotoUpload);
  on('btn-upload-customer-photos', 'onclick', () => document.getElementById('customer-photos-input')?.click());
  on('customer-photos-input', 'onchange', handleCustomerPhotosUpload);

  // Auto-format currency on input fields in the product modal
  ['product-price', 'product-original-price', 'product-cost', 'product-wholesale-price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', window.formatInputCurrency);
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
  const overlay = document.getElementById('admin-overlay');
  if (panel) panel.style.display = 'flex';
  if (overlay) overlay.style.display = 'block';
  if (!window.ordersListenerAttached) {
    window.ordersListenerAttached = true;
    onValue(ref(appState.db, 'orders'), snap => {
      const val = snap.val();
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const rawOrders = val ? Object.entries(val).map(([key, order]) => ({ id: key, ...order })) : [];

      const validOrders = rawOrders.filter(order => {
        if (order.status !== 'cancelled') return true;
        const cancelledAt = order.cancelledAt || order.timestamp || 0;
        if (now - cancelledAt > THIRTY_DAYS) {
          remove(ref(appState.db, `orders/${order.id}`));
          return false;
        }
        return true;
      });

      appState.orders = validOrders.sort((a, b) => {
        const priority = status => {
          if (!status || status === 'pending') return 1;
          if (status === 'completed') return 2;
          if (status === 'cancelled') return 3;
          return 1;
        };
        const rankA = priority(a.status);
        const rankB = priority(b.status);
        if (rankA !== rankB) return rankA - rankB;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });

      renderAdminOrders();
      renderReports();
    });
  }
  renderAdminProducts();
  loadSettingsForm();
}

function closeAdmin() {
  appUtils.safeStyle('panel-admin', 'display', 'none');
  appUtils.safeStyle('admin-overlay', 'display', 'none');
}

export function renderAdminProducts() {
  const list = document.getElementById('admin-products-list');
  if (!list) return;
  const search = (document.getElementById('admin-search-input')?.value || '').toLowerCase();
  const filtered = search
    ? appState.products.filter(p => (p.name && p.name.toLowerCase().includes(search)) || (p.ref && p.ref.toLowerCase().includes(search)))
    : appState.products || [];

  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay productos.</div>';
    return;
  }

  const escapeHTML = text => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  list.innerHTML = filtered.map(p => {
    const imageUrl = (p.images && p.images[0]) || p.image;
    return `
      <div class="admin-product-row" data-product-id="${escapeHTML(p.id)}">
        <div class="admin-product-img">
          ${imageUrl ? `<img src="${escapeHTML(imageUrl)}" loading="lazy" />` : '📦'}
        </div>
        <div class="admin-product-info">
          <div class="admin-product-title">
            ${escapeHTML(p.name || 'Sin nombre')}
            ${!p.active ? '<span class="badge-inactive">Oculto</span>' : ''}
          </div>
          <div class="admin-product-price">${appUtils.formatMoney(p.price || 0)}</div>
        </div>
        <button type="button" class="btn-delete-product-row" data-product-id="${escapeHTML(p.id)}" title="Eliminar producto">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.admin-product-row').forEach(row => {
    row.onclick = () => {
      const id = row.dataset.productId;
      if (id) openProductModal(id);
    };
  });

  list.querySelectorAll('.btn-delete-product-row').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation(); // Evita que también se abra el modal de edición
      const id = btn.dataset.productId;
      const product = appState.products.find(p => p.id === id);
      const name = product ? product.name : 'este producto';
      if (confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) {
        deleteProduct(id);
      }
    };
  });
}

export function renderAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (!list) return;
  if (!appState.orders || appState.orders.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay pedidos.</div>';
    return;
  }
  const channelLabel = { web: '🌐 Web', whatsapp: '💬 WhatsApp', mercado_libre: '🛒 ML' };
  const sortedOrders = [...appState.orders].sort((a, b) => {
    const priority = status => {
      if (!status || status === 'pending') return 1;
      if (status === 'completed') return 2;
      if (status === 'cancelled') return 3;
      return 1;
    };
    const rankA = priority(a.status);
    const rankB = priority(b.status);
    if (rankA !== rankB) return rankA - rankB;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  list.innerHTML = sortedOrders.map(o => {
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

export function renderReports() {
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

  const revTotalEl = document.getElementById('report-revenue-total');
  if (revTotalEl) {
    revTotalEl.innerText = appUtils.formatMoney(sum(completed));
    revTotalEl.className = 'fin-value success';
  }
  const profitTotalEl = document.getElementById('report-profit-total');
  if (profitTotalEl) {
    profitTotalEl.innerText = appUtils.formatMoney(profit(completed));
    profitTotalEl.className = 'fin-value success';
  }
  const revPendingEl = document.getElementById('report-revenue-pending');
  if (revPendingEl) {
    revPendingEl.innerText = appUtils.formatMoney(sum(pending));
    revPendingEl.className = 'fin-value warning';
  }
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
    const max = Math.max(...Object.values(channelTotals), 1);
    chBarsEl.innerHTML = Object.entries(channelTotals).map(([ch, val]) => {
      const pct = (val / max) * 100;
      const colors = { web: 'var(--primary)', whatsapp: '#25D366', mercado_libre: '#FFE600' };
      const labels = { web: '🌐 Web', whatsapp: '💬 WhatsApp', mercado_libre: '🛒 ML' };
      return `
      <div class="channel-bar-row">
        <div class="channel-bar-label">${labels[ch] || ch}</div>
        <div class="channel-bar-track">
          <div class="channel-bar-fill" style="width:${pct}%; background:${colors[ch] || 'var(--primary)'}"></div>
        </div>
        <div class="channel-bar-val">${appUtils.formatMoney(val)}</div>
      </div>`;
    }).join('');
  }

  // Resumen por estado
  const statusCounts = { completed: completed.length, pending: pending.length, cancelled: cancelled.length };
  const statusLabels = { completed: '✅ Completados', pending: '⏳ Pendientes', cancelled: '❌ Anulados' };
  const statusClasses = { completed: 'success', pending: 'warning', cancelled: 'danger' };
  appUtils.safeHTML('report-status-summary', Object.entries(statusCounts).map(([k, v]) => `
    <div class="badge-status ${statusClasses[k]}" style="padding:0.4rem 0.8rem; border-radius:8px; font-weight:700; font-size:0.75rem; background:var(--bg); border:1px solid var(--border);">
      ${statusLabels[k]}: ${v}
    </div>
  `).join(''));

  // Estadísticas de productos
  const soldMap = {};
  const cancelledMap = {};
  
  completed.forEach(o => {
    (o.items || []).forEach(i => {
      soldMap[i.id] = (soldMap[i.id] || 0) + (i.qty || 1);
    });
  });
  
  cancelled.forEach(o => {
    (o.items || []).forEach(i => {
      cancelledMap[i.id] = (cancelledMap[i.id] || 0) + (i.qty || 1);
    });
  });

  const getListHTML = (map, limit = 5) => {
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (sorted.length === 0) return '<div style="color:var(--text-muted); font-size:0.8rem;">Sin datos</div>';
    return sorted.map(([id, qty]) => {
      const p = appState.products.find(x => x.id === id);
      return `
        <div class="report-item">
          <span>${p ? p.name : 'Producto eliminado'}</span>
          <span class="report-qty">${qty}</span>
        </div>`;
    }).join('');
  };

  appUtils.safeHTML('report-most-sold', getListHTML(soldMap));
  appUtils.safeHTML('report-most-cancelled', getListHTML(cancelledMap));

  // Sin ventas
  const noSales = appState.products.filter(p => p.active && !soldMap[p.id]).slice(0, 10);
  appUtils.safeHTML('report-no-sales', noSales.length > 0 
    ? noSales.map(p => `<div class="report-item"><span>${p.name}</span> <span class="report-qty" style="background:#eee; color:#666">0</span></div>`).join('')
    : '<div style="color:var(--success); font-size:0.8rem;">¡Todos los productos tienen ventas!</div>'
  );

  // Tasa de conversión (Simulada o basada en pedidos totales)
  if (filtered.length > 0) {
    const rate = ((completed.length / filtered.length) * 100).toFixed(1);
    appUtils.safeText('report-conversion-rate', `${rate}% conversión`);
  } else {
    appUtils.safeText('report-conversion-rate', '0% conversión');
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
  appUtils.safeValue('settings-wholesale-discount', appState.settings.wholesaleDiscount !== undefined ? appState.settings.wholesaleDiscount : 20);

  // Redes sociales
  const social = appState.settings.social || {};
  appUtils.safeValue('settings-social-instagram', social.instagram || '');
  appUtils.safeValue('settings-social-facebook', social.facebook || '');
  appUtils.safeValue('settings-social-tiktok', social.tiktok || '');

  renderCustomerPhotosAdmin();

  // Dirección de origen (para cotizar envíos reales con transportadoras)
  const origin = appState.settings.originAddress || {};
  appUtils.safeValue('settings-origin-name', origin.name || '');
  appUtils.safeValue('settings-origin-phone', origin.phone || '');
  appUtils.safeValue('settings-origin-street', origin.street || '');
  appUtils.safeValue('settings-origin-city', origin.city || '');
  appUtils.safeValue('settings-origin-state', origin.state || '');
  appUtils.safeValue('settings-origin-zip', origin.zip || '');
  
  // Ubicación Dinámica
  const loc = appState.settings.locContent || {};
  appUtils.safeValue('settings-loc-bgt-title', loc.bgtTitle || '');
  appUtils.safeValue('settings-loc-bgt-sub', loc.bgtSub || '');
  appUtils.safeValue('settings-loc-nat-title', loc.natTitle || '');
  appUtils.safeValue('settings-loc-nat-sub', loc.natSub || '');

  // Campaña
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
    appUtils.showToast('Configuración guardada ✅');
    if (window.loadCatalog) window.loadCatalog();
  } catch (error) {
    console.error("Error saving settings:", error);
    appUtils.showToast('Error al guardar configuración: ' + error.message);
  }
}

function openProductModal(id = null) {
  if (id === 'undefined') id = null;
  window.currentEditId = id;
  window.currentProductOrigen = null; // Reset flag de origen del producto
  appState.currentProductImages = [];
  const p = id ? appState.products.find(x => x.id === id) : null;
  if (p) window.currentProductOrigen = p.origen; // Conserva el origen (p.ej. 'mastershop') si ya existía
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

// Actualiza los textos (label, botón, placeholders de filas existentes) según el
// tipo de variante elegido. Se expone en window porque el <select> la llama por
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

  const weight = parseFloat(document.getElementById('product-weight')?.value) || 0.3; // kg, respaldo si no se especifica

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
      const name = row.querySelector('.var-name')?.value.trim();
      const stock = parseInt(row.querySelector('.var-stock')?.value) || 0;
      if (name) {
        // Se guarda como "color" internamente (compatibilidad con productos ya
        // existentes en Firebase); el campo "variantType" abajo indica si en
        // realidad es color, aroma o tamaño.
        variants.push({ color: name, stock });
      }
    });
    pData.variants = variants;
    pData.variantType = document.getElementById('product-variant-type')?.value || 'color';
    pData.stock = variants.reduce((sum, v) => sum + v.stock, 0);
  } else {
    pData.variants = null;
  }

  // Conserva el origen original del producto (p.ej. 'mastershop'); por defecto 'propio'.
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
  } catch (error) {
    console.error("Error saving product:", error);
    appUtils.showToast('Error al guardar: ' + error.message);
  }
}

function removeProductImage(idx) {
  appState.currentProductImages.splice(idx, 1);
  renderProductImagePreview();
}

async function deleteProduct(id) {
  // Nota: la confirmación ya se hizo en quien llama a esta función (el botón
  // "Eliminar" del modal, o el botón directo en cada fila de la lista).
  await remove(ref(appState.db, `products/${id}`));
  if (window.loadCatalog) window.loadCatalog();
}

async function confirmOrder(id) {
  await update(ref(appState.db, `orders/${id}`), { status: 'completed', completedAt: Date.now() });
  appUtils.showToast('Completado ✅');
}

function cancelOrder(id) {
  if (confirm('¿Anular pedido?')) {
    update(ref(appState.db, `orders/${id}`), { status: 'cancelled', cancelledAt: Date.now() });
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
  if (!list) return;
  list.innerHTML = extItems.map((i, idx) => `
    <div class="variant-row" style="margin-bottom:0.5rem; flex-wrap:wrap;">
      <input type="text" class="field-input" placeholder="Nombre producto" value="${i.name}" style="flex:2; min-width:150px;" oninput="window._extItemChange(${idx}, 'name', this.value)">
      <input type="text" class="field-input" placeholder="Precio" value="${i.price > 0 ? i.price.toLocaleString('es-CO') : ''}" style="flex:1; min-width:80px;" oninput="formatInputCurrency(event); window._extItemChange(${idx}, 'priceRaw', this.value)">
      <input type="text" class="field-input" placeholder="Costo" value="${i.cost > 0 ? i.cost.toLocaleString('es-CO') : ''}" style="flex:1; min-width:80px;" oninput="formatInputCurrency(event); window._extItemChange(${idx}, 'costRaw', this.value)">
      <input type="number" class="field-input" value="${i.qty}" style="width:50px; flex:none" oninput="window._extItemChange(${idx}, 'qty', this.value)">
      <button type="button" class="btn-remove-variant" onclick="window._extRemoveItem(${idx})">×</button>
    </div>
  `).join('');
  recalcExtFinancials();
}

function addExtItem() {
  extItems.push({ name: '', price: 0, cost: 0, qty: 1 });
  renderExtItems();
}

function recalcExtFinancials() {
  const channel = document.getElementById('ext-channel')?.value || 'mercado_libre';
  const subtotal = extItems.reduce((t, i) => t + (i.price * i.qty), 0);
  const totalCost = extItems.reduce((t, i) => t + (i.cost * i.qty), 0);
  
  let commission = 0;
  if (channel === 'mercado_libre') {
    const pct = parseFloat(document.getElementById('ext-ml-commission-pct')?.value) || 0;
    commission = subtotal * (pct / 100);
  }
  
  const shipping = parseCOP(document.getElementById('ext-shipping-cost')?.value || '0');
  const adCost = parseCOP(document.getElementById('ext-ad-cost')?.value || '0');
  
  const profit = subtotal - totalCost - commission - shipping - adCost;
  
  appUtils.safeText('ext-fin-subtotal', appUtils.formatMoney(subtotal));
  appUtils.safeText('ext-fin-commission', '-' + appUtils.formatMoney(commission));
  appUtils.safeText('ext-fin-shipping', '-' + appUtils.formatMoney(shipping));
  appUtils.safeText('ext-fin-ad', '-' + appUtils.formatMoney(adCost));
  appUtils.safeText('ext-fin-profit', appUtils.formatMoney(profit));
  
  appUtils.safeStyle('ext-fin-commission-row', 'display', commission > 0 ? 'flex' : 'none');
  appUtils.safeStyle('ext-fin-shipping-row', 'display', shipping > 0 ? 'flex' : 'none');
  appUtils.safeStyle('ext-fin-ad-row', 'display', adCost > 0 ? 'flex' : 'none');
  
  const profitEl = document.getElementById('ext-fin-profit');
  if (profitEl) profitEl.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
}

function updateExtCostsVisibility(channel) {
  appUtils.safeStyle('ext-ml-costs', 'display', (channel === 'web' || channel === 'whatsapp') ? 'none' : 'block');
  recalcExtFinancials();
}

async function saveExternalSale() {
  const name = document.getElementById('ext-customer-name')?.value.trim();
  const channel = document.getElementById('ext-channel')?.value;
  if (extItems.length === 0) return appUtils.showToast('Agrega al menos un producto');
  
  const items = extItems.filter(i => i.name && i.price > 0);
  if (items.length === 0) return appUtils.showToast('Completa los datos de los productos');

  const subtotal = items.reduce((t, i) => t + (i.price * i.qty), 0);
  const totalCost = items.reduce((t, i) => t + (i.cost * i.qty), 0);
  
  let commission = 0;
  if (channel === 'mercado_libre') {
    const pct = parseFloat(document.getElementById('ext-ml-commission-pct')?.value) || 0;
    commission = subtotal * (pct / 100);
  }
  
  const shipping = parseCOP(document.getElementById('ext-shipping-cost')?.value || '0');
  const adCost = parseCOP(document.getElementById('ext-ad-cost')?.value || '0');

  const saleData = {
    customer: { name: name || 'Venta Externa', phone: document.getElementById('ext-customer-phone')?.value || '' },
    items,
    subtotal,
    total: subtotal,
    totalCost: totalCost + commission + shipping + adCost,
    timestamp: Date.now(),
    status: 'completed',
    channel: channel,
    externalId: document.getElementById('ext-order-id')?.value || ''
  };

  await push(ref(appState.db, 'orders'), saleData);
  appUtils.safeStyle('modal-external-sale', 'display', 'none');
  appUtils.showToast('Venta registrada ✅');
}

window.formatInputCurrency = (e) => {
  let value = e.target.value.replace(/\D/g, "");
  if (value === "") { e.target.value = ""; return; }
  e.target.value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
};

window._extItemChange = (idx, field, val) => {
  if (field === 'priceRaw') extItems[idx].price = parseCOP(val);
  else if (field === 'costRaw') extItems[idx].cost = parseCOP(val);
  else if (field === 'qty') extItems[idx].qty = parseInt(val) || 1;
  else extItems[idx][field] = val;
  recalcExtFinancials();
};

window._extRemoveItem = (idx) => {
  extItems.splice(idx, 1);
  renderExtItems();
};

const parseCOP = (str) => parseFloat((str || '0').replace(/\./g, '').replace(/,/g, '')) || 0;

// Sube varias fotos a la vez sin necesidad de un link externo: el nombre de
// cada archivo (sin extensión) debe coincidir con la "Referencia" del producto,
// por ejemplo "CAM-AZ-M.jpg" para el producto con Referencia "CAM-AZ-M".
// Reutiliza la misma compresión/base64 que ya usa el editor de un solo producto.
// Sube una o varias fotos de "clientes felices" a la galería de confianza de
// la tienda. Se guardan dentro de settings.customerPhotos para que lleguen
// al frontend con la misma petición que ya trae el resto de la configuración.
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
      // Reemplaza la foto principal del producto encontrado por referencia.
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
      
      // Normaliza/valida la URL de la foto. Detecta celdas vacías (imagen pegada/insertada
      // en vez de un link, que Excel no expone como texto) y corrige links de Google Drive
      // que no sirven como <img src> directo.
      const resolvePhotoUrl = (rawValue) => {
        let url = String(rawValue || '').trim();
        if (!url) return { url: '', valid: false };

        // Convierte enlaces de "compartir" de Google Drive a un link de imagen directa
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
        
        if (!name || isNaN(price)) {
          continue;
        }
        
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
          name,
          price,
          ref: refValue,
          category,
          tags,
          stock,
          cost,
          originalPrice,
          wholesalePrice,
          weight,
          unit,
          description,
          clipUrl,
          active,
          origen: 'propio'
        };
        
        let existingId = null;
        if (refValue) {
          const existing = appState.products.find(p => p.ref && String(p.ref).trim() === refValue);
          if (existing) {
            existingId = existing.id;
          }
        }
        
        if (existingId) {
          // En una actualización, solo tocamos "images" si esta fila trae una foto
          // válida nueva — así no se borran fotos ya subidas (por ejemplo, con la
          // herramienta de "Subir Fotos en Lote") solo porque la fila del Excel
          // no traía una URL en esa pasada.
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
    } catch (err) {
      console.error(err);
      appUtils.showToast("Error al procesar Excel: " + err.message);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
