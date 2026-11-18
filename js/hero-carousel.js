// Carrusel de banners de la portada (estilo tiendas grandes): las diapositivas cambian solas,
// se pueden pasar con flechas, puntos o deslizando el dedo, y se administran desde
// Admin → Tienda → Banners. La diapositiva de texto de siempre (cuenta regresiva, envío
// gratis, "Ver productos") queda como primera diapositiva y se puede apagar.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW_L = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

let timer = null, state = null, abort = null;

export function activeBanners(settings) {
  const list = Array.isArray(settings?.heroBanners) ? settings.heroBanners : Object.values(settings?.heroBanners || {});
  return list.filter(b => b && b.active !== false && (b.image || b.imageMobile || b.title));
}

function linkAttrs(link) {
  const l = String(link || '').trim();
  if (!l) return { tag: 'div', attrs: '' };
  if (l.startsWith('#')) return { tag: 'a', attrs: `href="${esc(l)}" data-scroll="${esc(l)}"` };
  if (/^https?:\/\//i.test(l)) {
    let same = false; try { same = new URL(l).origin === location.origin; } catch (e) {}
    return { tag: 'a', attrs: `href="${esc(l)}"${same ? '' : ' target="_blank" rel="noopener noreferrer"'}` };
  }
  return { tag: 'a', attrs: `href="${esc(l.startsWith('/') ? l : '/' + l)}"` };
}

function slideHtml(b, i) {
  const { tag, attrs } = linkAttrs(b.link);
  const img = b.image || b.imageMobile;
  const pic = img ? `<picture>${b.imageMobile ? `<source media="(max-width:640px)" srcset="${esc(b.imageMobile)}">` : ''}<img src="${esc(b.image || b.imageMobile)}" alt="${esc(b.title || 'Banner')}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} draggable="false"></picture>` : '';
  const hasText = b.title || b.sub || b.btn;
  const text = hasText ? `<div class="hb-text">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${b.sub ? `<p>${esc(b.sub)}</p>` : ''}${b.btn ? `<span class="hb-btn">${esc(b.btn)}</span>` : ''}</div>` : '';
  return `<${tag} class="hb-slide${img ? '' : ' hb-noimg'}${hasText ? ' hb-withtext' : ''}" ${attrs} aria-label="${esc(b.title || 'Banner')}">${pic}${text}</${tag}>`;
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

export function renderHeroCarousel(settings) {
  const hero = document.getElementById('hero-banner');
  if (!hero) return;
  stop(); if (abort) abort.abort(); abort = new AbortController();
  hero.querySelectorAll('.hb-stage,.hb-dots,.hb-nav').forEach(n => n.remove());
  const textSlide = hero.querySelector('.hero-inner');
  const banners = activeBanners(settings);
  hero.classList.toggle('hb-on', banners.length > 0);
  if (textSlide) textSlide.classList.remove('hb-cur');
  if (!banners.length) { state = null; return; }

  const showText = settings.heroShowText !== false && !!textSlide;
  const items = [];                                   // { el }
  const stage = document.createElement('div'); stage.className = 'hb-stage';
  stage.innerHTML = banners.map(slideHtml).join('');
  hero.insertBefore(stage, hero.firstChild);
  if (showText) items.push(textSlide);
  items.push(...stage.querySelectorAll('.hb-slide'));
  if (!showText && textSlide) textSlide.style.display = 'none'; else if (textSlide) textSlide.style.display = '';

  let cur = 0;
  const total = items.length;
  const dots = document.createElement('div'); dots.className = 'hb-dots';
  const secs = Math.max(3, Math.min(30, Number(settings.heroInterval) || 5));
  dots.style.setProperty('--hb-time', secs + 's');
  dots.innerHTML = items.map((_, i) => `<button type="button" aria-label="Ir al banner ${i + 1}"><i></i></button>`).join('');
  const nav = document.createElement('div'); nav.className = 'hb-nav';
  nav.innerHTML = `<button type="button" class="hb-prev" aria-label="Anterior">${ARROW_L}</button><button type="button" class="hb-next" aria-label="Siguiente">${ARROW_R}</button>`;
  if (total > 1) { hero.appendChild(dots); hero.appendChild(nav); }

  const show = (i) => {
    cur = (i + total) % total;
    items.forEach((el, k) => { el.classList.toggle('hb-cur', k === cur); el.setAttribute('aria-hidden', k === cur ? 'false' : 'true'); if (el.tagName === 'A') el.tabIndex = k === cur ? 0 : -1; });
    [...dots.children].forEach((d, k) => { d.classList.toggle('on', k === cur); });
    // reinicia la animación del relleno del punto activo
    const on = dots.children[cur]; if (on) { const bar = on.firstElementChild; bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
  };
  const play = () => { stop(); if (total > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show(cur + 1), secs * 1000); hero.classList.remove('hb-paused'); };
  const pause = () => { stop(); hero.classList.add('hb-paused'); };
  const go = (i) => { show(i); play(); };

  show(0); play();
  state = { show, go };
  const sig = { signal: abort.signal };
  dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go([...dots.children].indexOf(b)); }, sig);
  nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(cur + (b.classList.contains('hb-next') ? 1 : -1)); }, sig);
  hero.addEventListener('mouseenter', pause, sig);
  hero.addEventListener('mouseleave', play, sig);
  document.addEventListener('visibilitychange', () => { document.hidden ? pause() : play(); }, sig);
  // Deslizar con el dedo / arrastrar
  let x0 = null, y0 = null, moved = false;
  hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; moved = false; pause(); }, { passive: true, signal: abort.signal });
  hero.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { moved = true; go(cur + (dx < 0 ? 1 : -1)); } else play();
    x0 = null;
  }, { passive: true, signal: abort.signal });
  hero.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; } }, { capture: true, signal: abort.signal });
  // Enlaces internos con "#": desplazamiento suave
  stage.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-scroll]'); if (!a) return;
    const t = document.querySelector(a.dataset.scroll); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  }, sig);
}
