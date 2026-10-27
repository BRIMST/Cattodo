// ====== ASISTENTE DE COMPRAS ======
// Chat que ayuda al cliente a encontrar regalos, ver descuentos y armar
// pedidos de varios productos dentro de un presupuesto. Corre 100% en el
// navegador sobre el catálogo ya cargado (sin costo de API ni backend).
//
// Se inicializa desde app.js con initAsistente(api).

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ocasiones y destinatarios: palabra que dice el cliente -> términos con los
// que se busca en nombre / etiquetas / categoría / descripción.
const OCCASIONS = [
  { key: 'halloween', label: 'Halloween', emoji: '🎃', triggers: ['halloween', 'jalowin', 'noche de brujas', 'brujas'], terms: ['halloween', 'calabaza', 'terror', 'bruja', 'fantasma', 'murcielago', 'vampiro', 'zombie', 'miedo', 'disfraz', 'esqueleto', 'telarana'] },
  { key: 'navidad', label: 'Navidad', emoji: '🎄', triggers: ['navidad', 'navideno', 'navidena', 'diciembre', 'santa', 'amigo secreto', 'aguinaldo'], terms: ['navidad', 'navideno', 'arbol', 'santa', 'reno', 'luces', 'pesebre', 'adorno', 'regalo'] },
  { key: 'amor', label: 'Amor y amistad', emoji: '💝', triggers: ['amor y amistad', 'san valentin', 'aniversario', 'enamorad', 'romantic', 'sorpresa'], terms: ['amor', 'romantico', 'corazon', 'rosa', 'peluche', 'pareja', 'detalle'] },
  { key: 'madre', label: 'Día de la madre', emoji: '💐', triggers: ['dia de la madre', 'dia de las madres'], terms: ['madre', 'mama', 'flores', 'bolso', 'joya', 'aroma', 'detalle'] },
  { key: 'padre', label: 'Día del padre', emoji: '👔', triggers: ['dia del padre', 'dia de los padres'], terms: ['padre', 'papa', 'hombre', 'billetera', 'reloj', 'detalle'] },
  { key: 'cumple', label: 'Cumpleaños', emoji: '🎂', triggers: ['cumpleanos', 'cumple', 'feliz dia', 'felicitar'], terms: ['cumpleanos', 'fiesta', 'sorpresa', 'detalle', 'regalo'] },
  { key: 'ninos', label: 'Niños', emoji: '🧸', triggers: ['nino', 'nina', 'hijo', 'hija', 'sobrino', 'sobrina', 'bebe', 'infantil'], terms: ['nino', 'nina', 'infantil', 'juguete', 'peluche', 'juego', 'bebe'] }
];
const RECIPIENTS = [
  { triggers: ['pareja', 'novia', 'novio', 'esposa', 'esposo', 'mi amor'], terms: ['pareja', 'amor', 'romantico', 'corazon'], label: 'tu pareja' },
  { triggers: ['mama', 'madre', 'mami'], terms: ['mama', 'madre'], label: 'tu mamá' },
  { triggers: ['papa', 'padre', 'papi'], terms: ['papa', 'padre'], label: 'tu papá' },
  { triggers: ['amiga', 'amigo', 'mejor amig'], terms: ['amiga', 'amigo'], label: 'tu amigo/a' },
  { triggers: ['jefe', 'jefa', 'companero', 'compañero', 'colega'], terms: ['oficina', 'escritorio'], label: 'tu compañero/a' }
];
const STOP = new Set(('quiero quisiera necesito busco buscando dame darle dar regalar regalo regalos regalito detalle detalles para por con sin una uno unos unas los las del que mis mas muy hay tiene tienen algo cosas cosa ayuda ayudame ayudar claro favor hola buenas buenos dias tardes noches mostrar muestrame mostrarme ver veo ' +
  'presupuesto pesos peso cop mil lucas luca millon millones hasta maximo maxima menos tengo cuento gastar gasto como puedo quiere quieres comprar compra pedido varios varias combo armar arma alcance alcanza entre esto eso este esta estos son sus mis tus mio mia mi tu su ese esa unos descuento descuentos oferta ofertas promo promocion promociones rebaja rebajas barato baratos economico economicos ' +
  'productos producto articulo articulos opciones opcion ideas idea sugerencia sugerencias recomienda recomiendame recomendar sirve algun alguna algunos algunas otro otra otros otras cual cuales cuanto cuantos ademas tambien pero porque cuando donde').split(' '));

const WORD_NUMS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

// ---------- Análisis del mensaje ----------
function parseBudget(t, awaiting) {
  // 50 mil | 50.000 | 50,000 | 50000 | 50k | $50 lucas | 1 millon | 1.5 millones
  const re = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(millones|millon|mil|k|lucas|luca)?/g;
  let m, best = null;
  while ((m = re.exec(t))) {
    const rawStr = m[1];
    const unit = m[2];
    // Evita confundir "3 regalos" / "2 productos" con dinero.
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (!unit && /^\s*(regalos?|productos?|articulos?|detalles?|cosas|personas|unidades|opciones)/.test(after)) continue;
    let n;
    if (/^\d{1,3}([.,]\d{3})+$/.test(rawStr)) n = parseFloat(rawStr.replace(/[.,]/g, ''));
    else n = parseFloat(rawStr.replace(',', '.'));
    if (unit) n *= /millon/.test(unit) ? 1000000 : 1000;
    else if (awaiting && n < 1000) n *= 1000;
    if (n >= 5000 && n <= 20000000 && (best === null || n > best)) best = Math.round(n);
  }
  return best;
}

function parseMessage(raw, awaitingBudget) {
  const t = norm(raw);
  const out = { t, budget: parseBudget(t, awaitingBudget), count: null, occasions: [], recipients: [], tokens: [] };
  const cm = t.match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco)\s+(regalos?|productos?|articulos?|detalles?|cosas)\b/);
  if (cm) out.count = WORD_NUMS[cm[1]] || parseInt(cm[1], 10) || null;
  if (out.count && out.count < 2) out.count = null;
  OCCASIONS.forEach(o => { if (o.triggers.some(k => t.includes(k))) out.occasions.push(o); });
  RECIPIENTS.forEach(r => { if (r.triggers.some(k => new RegExp('\\b' + norm(k)).test(t))) out.recipients.push(r); });
  out.tokens = t.split(/[^a-z0-9ñ]+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !/^(k|mil)$/.test(w));
  // Quita las palabras que ya se explican por una ocasión/destinatario (se buscan con sinónimos)
  const covered = new Set();
  [...out.occasions.flatMap(o => o.triggers), ...out.recipients.flatMap(r => r.triggers)].forEach(k => norm(k).split(' ').forEach(w => covered.add(w)));
  out.tokens = out.tokens.filter(w => ![...covered].some(c => w.startsWith(c) || c.startsWith(w)));
  out.flags = {
    greeting: /^(hola|buenas|buenos dias|buen dia|hey|ola|saludos|buenas tardes|buenas noches)\b/.test(t) && out.tokens.length === 0 && !out.budget,
    thanks: /\b(gracias|listo|perfecto|genial|ok)\b/.test(t) && t.length < 25 && !out.budget && out.tokens.length === 0,
    discount: /\b(descuento|descuentos|oferta|ofertas|promo|promos|promocion|promociones|rebaja|rebajas|liquidacion|barato|baratos|economico|economicos)\b/.test(t),
    cart: /\b(mi pedido|mi carrito|el carrito|carrito|pagar|finalizar|terminar mi compra|hacer el pedido)\b/.test(t),
    budgetWord: /\b(presupuesto|alcance|alcanza|gastar|cuento con|tengo)\b/.test(t),
    reset: /\b(reiniciar|empezar de nuevo|borrar|nueva busqueda|desde cero|cambiar de tema|otra cosa)\b/.test(t),
    single: /\b(un solo|solo un|solo uno|un unico|un|1)\s+(regalo|producto|articulo)\b/.test(t) || /\b(solo|nada mas) (uno|una)\b/.test(t) || /\bproductos individuales\b/.test(t),
    more: /\b(ver mas|mas opciones|muestrame mas|otros)\b/.test(t),
    other: /\b(otro combo|otra combinacion|otro pedido|cambiar combo|cambia el combo|otra opcion de combo)\b/.test(t),
    help: /\b(ayuda|que puedes hacer|como funciona|que haces)\b/.test(t)
  };
  return out;
}

// ---------- Utilidades de catálogo ----------
const hasLimit = (v) => v !== undefined && v !== null && v !== '';

export function initAsistente(api) {
  if (document.getElementById('asistente-root')) return;

  const S = {
    open: false,
    ctx: { terms: [], synonyms: [], label: '', budget: null, discountOnly: false, page: 0, mode: 'auto', count: null },
    awaitingBudget: false,
    shownCombos: [],
    lastCombo: null,
    busy: false
  };

  // ----- Productos disponibles -----
  const priceOf = (p) => api.getPrice(p) || 0;
  const imgOf = (p) => (p.images && p.images[0]) || p.image || '';
  const discountOf = (p) => {
    const o = parseFloat(p.originalPrice), pr = priceOf(p);
    return o > pr && pr > 0 ? Math.round((1 - pr / o) * 100) : 0;
  };
  const firstAvailableVariant = (p) => (p.variants || []).find(v => !hasLimit(v.stock) || parseFloat(v.stock) > 0) || null;
  const isAvailable = (p) => {
    if (!p || !p.active || priceOf(p) <= 0) return false;
    if (p.variants && p.variants.length) return !!firstAvailableVariant(p);
    return !hasLimit(p.stock) || parseFloat(p.stock) > 0;
  };
  const cartIdOf = (p) => {
    if (p.variants && p.variants.length) { const v = firstAvailableVariant(p); return `${p.id}:${v.color}`; }
    return String(p.id);
  };
  const variantNote = (p) => (p.variants && p.variants.length ? firstAvailableVariant(p)?.color : '');
  const available = () => api.getProducts().filter(isAvailable);

  // ----- Relevancia -----
  function relevance(p, terms, synonyms) {
    if (!terms.length && !synonyms.length) return 0;
    const name = norm(p.name), tags = norm(p.tags), cat = norm(p.category), desc = norm(p.description);
    const hit = (term, weight) => {
      // Coincide con el inicio de una palabra (así "peluche" encuentra "peluches"
      // pero "luces" no coincide con "peluche"). Quita solo la "s" del plural.
      const stem = term.length > 4 ? term.replace(/s$/, '') : term;
      const re = new RegExp('(^|[^a-z0-9])' + stem.replace(/[^a-z0-9]/g, ''));
      let s = 0;
      if (re.test(name)) s += 3;
      if (re.test(tags)) s += 3;
      if (re.test(cat)) s += 2;
      if (re.test(desc)) s += 1;
      return s * weight;
    };
    let total = 0;
    terms.forEach(t => { total += hit(t, 1.5); });
    synonyms.forEach(t => { total += hit(t, 1); });
    return total;
  }

  function rank(list, ctx) {
    const scored = list.map(p => ({ p, rel: relevance(p, ctx.terms, ctx.synonyms) }));
    return scored;
  }

  // ----- Armado de combos dentro de un presupuesto -----
  function buildCombo(pool, budget, wantCount) {
    // pool: [{p, rel}] ya filtrado a lo que cuesta <= presupuesto
    const maxItems = wantCount || 5;
    let best = null;
    const prices = pool.map(x => priceOf(x.p));
    const minPrice = Math.min(...prices);
    for (let attempt = 0; attempt < 120; attempt++) {
      // Orden aleatorio ponderado por relevancia
      const order = pool
        .map(x => ({ x, k: Math.random() * (1 + x.rel) }))
        .sort((a, b) => b.k - a.k)
        .map(o => o.x);
      const chosen = [];
      let spent = 0;
      for (const x of order) {
        const pr = priceOf(x.p);
        if (spent + pr <= budget && chosen.length < maxItems) { chosen.push(x); spent += pr; }
        if (chosen.length >= maxItems || budget - spent < minPrice) break;
      }
      if (chosen.length === 0) continue;
      const cats = new Set(chosen.map(c => c.p.category || '_')).size;
      const score = chosen.length * 100 + (spent / budget) * 60 + chosen.reduce((a, c) => a + c.rel, 0) * 4 + cats * 12 - (wantCount && chosen.length !== wantCount ? 80 : 0);
      const key = chosen.map(c => c.p.id).sort().join(',');
      const seen = S.shownCombos.includes(key);
      const finalScore = seen ? score - 500 : score;
      if (!best || finalScore > best.score) best = { chosen, spent, score: finalScore, key };
    }
    return best;
  }

  // ----- Render del chat -----
  const root = document.createElement('div');
  root.id = 'asistente-root';
  root.innerHTML = `
    <button type="button" id="asistente-fab" class="asistente-fab" aria-label="Abrir asistente de compras" aria-expanded="false">
      <span class="asistente-fab-ico" aria-hidden="true">🛍️</span>
      <span class="asistente-fab-txt">Te ayudo a elegir</span>
    </button>
    <section id="asistente-panel" class="asistente-panel" role="dialog" aria-label="Asistente de compras" hidden>
      <header class="asistente-head">
        <div class="asistente-avatar" aria-hidden="true">🛍️</div>
        <div class="asistente-head-txt"><strong>Asistente de compras</strong><span>Regalos, ofertas y presupuestos</span></div>
        <button type="button" id="asistente-reset" class="asistente-icon-btn" title="Empezar de nuevo" aria-label="Empezar de nuevo">↺</button>
        <button type="button" id="asistente-close" class="asistente-icon-btn" aria-label="Cerrar asistente">✕</button>
      </header>
      <div id="asistente-msgs" class="asistente-msgs" aria-live="polite"></div>
      <div id="asistente-chips" class="asistente-chips"></div>
      <form id="asistente-form" class="asistente-form" autocomplete="off">
        <input id="asistente-input" type="text" maxlength="200" placeholder="Ej: regalo de Halloween para mi pareja" aria-label="Escribe tu mensaje" />
        <button type="submit" class="asistente-send" aria-label="Enviar">➤</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const $ = (id) => document.getElementById(id);
  const panel = $('asistente-panel'), fab = $('asistente-fab'), msgs = $('asistente-msgs'), chipsEl = $('asistente-chips'), input = $('asistente-input');

  const scrollDown = () => { msgs.scrollTop = msgs.scrollHeight; };

  function addUser(text) {
    const d = document.createElement('div');
    d.className = 'asistente-msg user';
    d.textContent = text;
    msgs.appendChild(d); scrollDown();
  }
  function addBot(html) {
    const d = document.createElement('div');
    d.className = 'asistente-msg bot';
    d.innerHTML = html;
    msgs.appendChild(d); scrollDown();
    return d;
  }
  function setChips(list) {
    chipsEl.innerHTML = '';
    (list || []).forEach(c => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'asistente-chip'; b.textContent = c.label;
      b.onclick = () => { if (c.fn) c.fn(); else handleUser(c.say || c.label, c.label, true); };
      chipsEl.appendChild(b);
    });
  }
  const typing = () => {
    const d = document.createElement('div');
    d.className = 'asistente-msg bot asistente-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(d); scrollDown();
    return d;
  };

  const money = (n) => api.formatMoney(n);

  function productCard(p, opts = {}) {
    const d = discountOf(p), vn = variantNote(p);
    const inCart = (api.getCart()[cartIdOf(p)] || 0) > 0;
    return `
      <div class="asistente-card" data-id="${esc(p.id)}">
        <div class="asistente-card-img">${imgOf(p) ? `<img src="${esc(imgOf(p))}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : '<span>📦</span>'}${d ? `<em>-${d}%</em>` : ''}</div>
        <div class="asistente-card-info">
          <div class="asistente-card-name">${esc(p.name)}</div>
          ${vn ? `<div class="asistente-card-var">${esc(api.variantLabel(p))}: ${esc(vn)}</div>` : ''}
          <div class="asistente-card-price">${d ? `<s>${money(p.originalPrice)}</s> ` : ''}<b>${money(priceOf(p))}</b></div>
          ${opts.noButtons ? '' : `<div class="asistente-card-btns">
            <button type="button" class="asistente-btn primary" data-act="add" data-id="${esc(p.id)}">${inCart ? '✓ Agregado (+1)' : '🛒 Agregar'}</button>
            <button type="button" class="asistente-btn" data-act="view" data-id="${esc(p.id)}">Ver</button>
          </div>`}
        </div>
      </div>`;
  }

  // Delegación de clicks dentro del chat
  msgs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    const p = api.getProducts().find(x => String(x.id) === String(id));
    if (act === 'view' && p) { api.trackEvent('asistente_ver_producto', p.name); api.navigateTo('/producto/' + encodeURIComponent(p.id)); if (window.innerWidth < 640) toggle(false); }
    if (act === 'add' && p) {
      api.updateCart(cartIdOf(p), 1);
      api.trackEvent('asistente_agregar', p.name, { item_id: String(p.id) });
      btn.textContent = '✓ Agregado (+1)';
      showCartChips(`Listo, agregué <strong>${esc(p.name)}</strong> a tu pedido. ¿Seguimos?`);
    }
    if (act === 'addcombo' && S.lastCombo) {
      S.lastCombo.chosen.forEach(c => api.updateCart(cartIdOf(c.p), 1));
      api.trackEvent('asistente_agregar_combo', 'combo', { value: S.lastCombo.spent });
      btn.textContent = '✓ Agregado al pedido'; btn.disabled = true;
      showCartChips(`¡Hecho! Agregué los ${S.lastCombo.chosen.length} productos por <strong>${money(S.lastCombo.spent)}</strong>. Aún no pagas nada: puedes revisar y cambiar cantidades en tu pedido.`);
    }
    if (act === 'othercombo') handleUser('Otro combo', 'Armar otro combo', true);
    if (act === 'gocart') goCart();
  });

  function goCart() {
    api.navigateTo('/pedido');
    if (window.innerWidth < 640) toggle(false);
  }
  function showCartChips(text) {
    addBot(text);
    setChips([
      { label: '🧾 Ver mi pedido', fn: goCart },
      { label: '➕ Seguir buscando', fn: () => handleUser('Mostrar ideas', 'Seguir buscando', true) }
    ]);
  }

  // ----- Chips contextuales -----
  function seasonChips() {
    const chips = [];
    const camp = api.getSettings().activeCampaign;
    if (camp && camp.enabled && camp.tag) {
      chips.push({ label: `✨ ${camp.title || camp.tag}`, say: `Productos de ${camp.tag}` });
    }
    const m = new Date().getMonth(); // 0 = enero
    const byMonth = { 9: 'halloween', 10: 'navidad', 11: 'navidad', 1: 'amor', 4: 'madre', 5: 'padre' };
    const occ = OCCASIONS.find(o => o.key === byMonth[m]);
    if (occ && !(camp && norm(camp.tag + ' ' + camp.title).includes(occ.key))) chips.push({ label: `${occ.emoji} ${occ.label}`, say: `Regalo de ${occ.label}` });
    return chips;
  }
  const homeChips = () => [
    ...seasonChips(),
    { label: '🎁 Ideas de regalo', say: 'Quiero un regalo' },
    { label: '🏷️ Ver descuentos', say: 'Quiero ver descuentos' },
    { label: '💰 Tengo un presupuesto', say: 'Tengo un presupuesto' }
  ];
  const budgetChips = () => [30000, 50000, 80000, 100000, 150000].map(n => ({ label: `$${(n / 1000)} mil`, say: `Mi presupuesto es ${n / 1000} mil` }));

  // ----- Motor de respuesta -----
  function mergeContext(parsed) {
    const c = S.ctx;
    if (parsed.flags.reset) { S.ctx = { terms: [], synonyms: [], label: '', budget: null, discountOnly: false, page: 0, mode: 'auto', count: null }; S.shownCombos = []; return; }
    const newTerms = parsed.tokens;
    const newSyn = [
      ...parsed.occasions.flatMap(o => o.terms),
      ...parsed.recipients.flatMap(r => r.terms),
      ...(parsed.aiTerms || [])
    ];
    const hasNewSubject = newTerms.length || parsed.occasions.length || parsed.recipients.length || (parsed.aiTerms || []).length;
    // "Quiero ver descuentos" a secas = todas las ofertas de la tienda, no solo las del tema anterior.
    if (parsed.flags.discount && !hasNewSubject) { c.terms = []; c.synonyms = []; c.label = ''; c.page = 0; }
    if (hasNewSubject) {
      // Un tema nuevo reemplaza al anterior; el presupuesto se conserva.
      c.terms = newTerms;
      c.synonyms = [...new Set(newSyn)];
      const bits = [];
      if (parsed.occasions.length) bits.push(parsed.occasions.map(o => `${o.emoji} ${o.label}`).join(' / '));
      if (parsed.recipients.length) bits.push('para ' + parsed.recipients[0].label);
      if (!bits.length && parsed.aiLabel) bits.push(parsed.aiLabel);
      if (!bits.length && newTerms.length) bits.push(newTerms.join(' '));
      if (!bits.length && (parsed.aiTerms || []).length) bits.push(parsed.aiTerms.slice(0, 3).join(' '));
      c.label = parsed.aiLabel || bits.join(' ');
      c.page = 0; S.shownCombos = [];
    }
    if (parsed.budget) { c.budget = parsed.budget; S.shownCombos = []; c.page = 0; }
    if (parsed.count) c.count = parsed.count;
    if (parsed.flags.discount) { c.discountOnly = true; c.page = 0; }
    else if (hasNewSubject && !parsed.flags.discount) c.discountOnly = false;
    if (parsed.flags.single) c.mode = 'list';
    else if (parsed.budget || parsed.flags.other) c.mode = 'auto';
    if (parsed.flags.more) c.page += 1;
  }

  function respond(parsed) {
    const c = S.ctx;
    const f = parsed.flags;

    if (f.cart) { addBot('Te llevo a tu pedido para que lo revises y lo finalices. 🧾'); setTimeout(goCart, 500); setChips(homeChips()); return; }
    if (f.greeting) { addBot('¡Hola! 👋 Cuéntame qué buscas: un regalo para alguien, productos en descuento o armar un pedido con tu presupuesto.'); setChips(homeChips()); return; }
    if (f.thanks) { addBot('¡Con gusto! Si necesitas algo más, aquí estoy. 😊'); setChips([{ label: '🧾 Ver mi pedido', fn: goCart }, ...homeChips().slice(0, 2)]); return; }
    if (f.help) { addBot('Puedo <strong>sugerirte regalos</strong> por ocasión o persona, mostrarte lo que está en <strong>descuento</strong> y <strong>armar un pedido de varios productos</strong> que quepa en tu presupuesto. Escríbeme algo como: <em>"tengo 50 mil para regalos de Halloween"</em>.'); setChips(homeChips()); return; }

    // Pide presupuesto sin dar monto
    if (f.budgetWord && !c.budget && !parsed.budget) {
      S.awaitingBudget = true;
      addBot('¡Claro! ¿Cuánto quieres gastar en total? Elige una opción o escríbeme el monto (por ejemplo <em>"50 mil"</em>).');
      setChips(budgetChips());
      return;
    }
    S.awaitingBudget = false;

    const hasSubject = c.terms.length || c.synonyms.length;
    const pool0 = available();
    if (pool0.length === 0) { addBot('Ahora mismo estoy cargando el catálogo o no hay productos disponibles. Intenta de nuevo en un momento.'); setChips([]); return; }

    // Sin tema, sin presupuesto, sin descuento: pregunta qué busca
    if (!hasSubject && !c.budget && !c.discountOnly) {
      if (parsed.flags.single || f.more) { /* cae a sugerencias generales abajo */ }
      else if (f.other) { addBot('Primero dime tu presupuesto o la ocasión y armo un combo para ti. 😉'); setChips(homeChips()); return; }
      else { addBot('Te puedo ayudar mejor si me dices <strong>para qué ocasión</strong> o <strong>a quién</strong> es, o si prefieres, <strong>tu presupuesto</strong>.'); setChips(homeChips()); return; }
    }

    let scored = rank(pool0, c);
    let relevantOnly = scored.filter(x => x.rel > 0);
    let usedFallback = false;
    if (hasSubject) {
      if (relevantOnly.length === 0) usedFallback = true; else scored = relevantOnly;
    }
    if (c.discountOnly) {
      const disc = scored.filter(x => discountOf(x.p) > 0);
      if (disc.length) scored = disc;
      else { addBot('Por ahora no veo productos con descuento' + (hasSubject && !usedFallback ? ' en esa búsqueda' : '') + '. Te muestro otras opciones que podrían servirte.'); c.discountOnly = false; }
    }

    // ----- Modo combo (presupuesto) -----
    if (c.budget && c.mode !== 'list') {
      const budget = c.budget;
      let pool = scored.filter(x => priceOf(x.p) <= budget);
      let padded = false;
      // Si lo relevante no alcanza para un combo de 2+, completa con otros productos económicos
      if (pool.length < 3) {
        const extra = rank(pool0, { terms: [], synonyms: [] }).filter(x => priceOf(x.p) <= budget && !pool.some(y => y.p.id === x.p.id));
        if (extra.length) { pool = pool.concat(extra); padded = true; }
      }
      if (pool.length === 0) {
        const cheapest = pool0.reduce((a, b) => (priceOf(a) <= priceOf(b) ? a : b));
        addBot(`Con <strong>${money(budget)}</strong> no encuentro productos disponibles; el más económico cuesta <strong>${money(priceOf(cheapest))}</strong>. ¿Quieres subir un poco el presupuesto?`);
        setChips(budgetChips()); return;
      }
      const combo = buildCombo(pool, budget, c.count);
      S.lastCombo = combo; S.shownCombos.push(combo.key);
      const items = combo.chosen.map(x => x.p);
      const left = budget - combo.spent;
      const intro = [];
      if (c.label) intro.push(/^para\b/i.test(c.label) ? `<strong>${esc(c.label.charAt(0).toUpperCase() + c.label.slice(1))}</strong>` : `Para <strong>${esc(c.label)}</strong>`); else intro.push('Con tu presupuesto');
      let html = `${intro[0]} de <strong>${money(budget)}</strong> armé este pedido con <strong>${items.length} producto${items.length > 1 ? 's' : ''}</strong>:`;
      if (usedFallback) html = `No encontré productos específicos de <em>${esc(c.label)}</em> en el catálogo, pero con tus <strong>${money(budget)}</strong> te armé este pedido con lo que sí tenemos:`;
      else if (padded) html += `<br><small>Completé el combo con otros productos para aprovechar mejor tu presupuesto.</small>`;
      html += `<div class="asistente-cards">${items.map(p => productCard(p, { noButtons: true })).join('')}</div>`;
      html += `<div class="asistente-total"><span>Total</span><b>${money(combo.spent)}</b></div>`;
      html += `<div class="asistente-left">${left > 0 ? `Te sobran ${money(left)}` : 'Usa exactamente tu presupuesto 🎯'}</div>`;
      html += `<div class="asistente-combo-btns"><button type="button" class="asistente-btn primary" data-act="addcombo">🛒 Agregar todo al pedido</button><button type="button" class="asistente-btn" data-act="othercombo">🔄 Otro combo</button></div>`;
      if (c.count && items.length !== c.count) html += `<small>Con ese presupuesto solo me alcanzó para ${items.length}.</small>`;
      addBot(html);
      api.trackEvent('asistente_combo', c.label || 'sin tema', { value: budget });
      setChips([
        { label: '🔄 Otro combo', fn: () => handleUser('Otro combo', 'Armar otro combo', true) },
        { label: '📋 Ver productos sueltos', say: 'Quiero un producto individual' },
        { label: '💰 Cambiar presupuesto', say: 'Tengo un presupuesto' },
        { label: '🏷️ Solo descuentos', say: 'Con descuento' }
      ]);
      return;
    }

    // ----- Modo lista -----
    let list = scored.slice();
    if (c.budget) list = list.filter(x => priceOf(x.p) <= c.budget);
    if (c.discountOnly) list.sort((a, b) => discountOf(b.p) - discountOf(a.p));
    else list.sort((a, b) => b.rel - a.rel || discountOf(b.p) - discountOf(a.p));
    if (!hasSubject && !c.discountOnly) { list.sort(() => Math.random() - 0.5); } // sugerencias generales variadas

    if (list.length === 0) {
      addBot('No encontré productos con esas condiciones. Prueba con otro presupuesto o dime otra idea.');
      setChips(homeChips()); return;
    }
    const PAGE = 4;
    let padded2 = false;
    if (hasSubject && !usedFallback && !c.discountOnly && list.length < PAGE) {
      const have = new Set(list.map(x => x.p.id));
      const extra = pool0
        .filter(p => !have.has(p.id) && (!c.budget || priceOf(p) <= c.budget))
        .map(p => ({ p, rel: 0 }))
        .sort(() => Math.random() - 0.5);
      if (extra.length) { list = list.concat(extra.slice(0, PAGE - list.length)); padded2 = true; }
    }
    const start = (c.page * PAGE) % Math.max(list.length, 1);
    let show = list.slice(start, start + PAGE);
    if (show.length === 0) { c.page = 0; show = list.slice(0, PAGE); }
    let head;
    if (c.discountOnly) head = `🏷️ Estos son los productos en descuento${c.label && !usedFallback ? ` (${esc(c.label)})` : ''}${c.budget ? ` hasta ${money(c.budget)}` : ''}:`;
    else if (usedFallback) head = `No encontré productos específicos de <em>${esc(c.label)}</em>, pero estas opciones suelen gustar:`;
    else if (hasSubject) head = `Claro que sí, déjame ayudarte. ${/^para\b/i.test(c.label) ? '' : 'Para '}<strong>${esc(c.label)}</strong> te recomiendo:${padded2 ? '<br><small>Encontré pocas opciones exactas, así que agregué otras que podrían gustarte.</small>' : ''}`;
    else head = 'Aquí van algunas ideas para empezar:';
    addBot(`${head}<div class="asistente-cards">${show.map(x => productCard(x.p)).join('')}</div>`);
    const chips = [];
    if (list.length > PAGE) chips.push({ label: '➕ Ver más opciones', say: 'Ver más opciones' });
    if (!c.budget) chips.push({ label: '💰 Tengo un presupuesto', say: 'Tengo un presupuesto' });
    else chips.push({ label: '🎁 Armar pedido con mi presupuesto', say: `Arma un pedido con ${c.budget / 1000} mil` });
    if (!c.discountOnly) chips.push({ label: '🏷️ Solo descuentos', say: 'Con descuento' });
    chips.push({ label: '🧾 Ver mi pedido', fn: goCart });
    setChips(chips);
    api.trackEvent('asistente_busqueda', c.label || (c.discountOnly ? 'descuentos' : 'general'));
  }

  // Interpreta con Gemini vía /api/asistente. Cualquier fallo (sin clave, cuota,
  // red, tiempo) devuelve null y el asistente local sigue solo, sin avisar al cliente.
  let aiCalls = 0, aiDisabled = false;
  async function interpretAI(text) {
    if (aiDisabled || aiCalls >= 40) return null; // tope por visita para cuidar la cuota gratuita
    aiCalls++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const cats = [...new Set(api.getProducts().filter(p => p.active).map(p => p.category).filter(Boolean))].slice(0, 30);
      const r = await fetch('/api/asistente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ message: text, categories: cats })
      });
      clearTimeout(timer);
      const j = await r.json();
      if (!j.ok) {
        if (j.error === 'sin_clave') aiDisabled = true; // ningún proveedor configurado: no insistir
        return null;
      }
      return j.data;
    } catch (e) { return null; }
  }

  function applyAI(parsed, ai) {
    if (!ai) return parsed;
    const f = parsed.flags;
    if (ai.keywords.length) { parsed.aiTerms = ai.keywords; parsed.tokens = []; }
    if (ai.label) parsed.aiLabel = ai.label;
    if (ai.budget) parsed.budget = ai.budget;
    if (ai.count) parsed.count = ai.count;
    if (ai.wants_discount) f.discount = true;
    if (ai.intent === 'ver_pedido') f.cart = true;
    if (ai.intent === 'ayuda') f.help = true;
    if (ai.intent === 'presupuesto' && !parsed.budget) f.budgetWord = true;
    if (ai.intent === 'saludo' && !parsed.budget && !ai.keywords.length) f.greeting = true;
    return parsed;
  }

  function handleUser(text, shown, fromChip) {
    text = String(text || '').trim();
    if (!text || S.busy) return;
    addUser(shown || text);
    setChips([]);
    S.busy = true;
    const dots = typing();
    const minWait = new Promise(res => setTimeout(res, 380));
    // Los chips y la respuesta al "¿cuánto quieres gastar?" ya son claros: no gastan cuota de IA.
    const useAI = !fromChip && !S.awaitingBudget;
    Promise.all([useAI ? interpretAI(text) : null, minWait]).then(([ai]) => {
      dots.remove();
      try {
        const parsed = applyAI(parseMessage(text, S.awaitingBudget), ai);
        mergeContext(parsed);
        respond(parsed);
      } catch (err) {
        console.error('Asistente:', err);
        addBot('Uy, algo salió mal de mi lado. ¿Intentamos de nuevo?');
        setChips(homeChips());
      }
      S.busy = false;
      scrollDown();
    });
  }

  function greet() {
    msgs.innerHTML = '';
    S.ctx = { terms: [], synonyms: [], label: '', budget: null, discountOnly: false, page: 0, mode: 'auto', count: null };
    S.shownCombos = []; S.awaitingBudget = false; S.lastCombo = null;
    addBot(`¡Hola! 👋 Soy tu asistente de compras en <strong>${esc(api.getSettings().storeName || 'la tienda')}</strong>. Puedo ayudarte a:<br>• Encontrar el regalo ideal<br>• Ver productos en descuento<br>• Armar un pedido que quepa en tu presupuesto<br><br>¿Por dónde empezamos?`);
    setChips(homeChips());
  }

  function toggle(force) {
    S.open = typeof force === 'boolean' ? force : !S.open;
    panel.hidden = !S.open;
    root.classList.toggle('open', S.open);
    fab.setAttribute('aria-expanded', String(S.open));
    if (S.open) {
      if (!msgs.children.length) greet();
      api.trackEvent('asistente_abrir', 'abrir');
      setTimeout(() => input.focus(), 50);
    }
    api.syncFloating();
  }

  fab.onclick = () => toggle();
  $('asistente-close').onclick = () => toggle(false);
  $('asistente-reset').onclick = greet;
  $('asistente-form').onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; handleUser(v); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) toggle(false); });

  // El botón sigue a la barra del carrito igual que el de WhatsApp.
  api.registerFloating((bottomPx) => { root.style.setProperty('--asistente-bottom', bottomPx + 'px'); });

  // Si el catálogo se recarga (precios/stock), nada que hacer: siempre se lee en vivo.
  window.asistenteAbrir = (texto) => { toggle(true); if (texto) handleUser(texto); };
}
