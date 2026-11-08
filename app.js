// ===== Al Hadaf — app.js =====
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const LANG_KEY = 'alhadaf_lang';
  const CART_KEY = 'alhadaf_cart_v2';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  let lang = store.get(LANG_KEY) === 'bn' ? 'bn' : 'en';
  let SHOP = { whatsapp: '', phone: '', email: '', bkash: '', facebook: '', instagram: '', address: { en: '', bn: '' }, deliveryInside: 0, deliveryOutside: 0, announce: { en: '', bn: '' } };
  let CATEGORIES = [{ id: 'all', name: { en: 'All', bn: 'সব' } }];
  let PRODUCTS = [];
  let loaded = false;
  let cart = [];
  let sortBy = 'default';
  const PLACEHOLDER = { fragrance: 'bottle', accessories: 'cap', 'father-son': 'combo' };

  async function loadStore() {
    const r = await fetch('/api/store');
    if (!r.ok) throw new Error('store');
    const d = await r.json();
    const s = d.shop;
    SHOP = {
      whatsapp: s.whatsapp, phone: s.phone, email: s.email, bkash: s.bkash, facebook: s.facebook, instagram: s.instagram,
      address: { en: s.address_en, bn: s.address_bn }, announce: { en: s.announce_en, bn: s.announce_bn },
      deliveryInside: Number(s.delivery_inside) || 0, deliveryOutside: Number(s.delivery_outside) || 0
    };
    CATEGORIES = [{ id: 'all', name: { en: 'All', bn: 'সব' } }, ...d.categories];
    PRODUCTS = d.products.map(p => ({ ...p, shape: PLACEHOLDER[p.cat] || 'thobe' }));
    loaded = true;
    cart = loadCart();
  }

  // ---------- helpers ----------
  const t = (k, ...a) => { const v = STR[lang][k] ?? STR.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
  const L = o => (o == null ? '' : typeof o === 'string' ? o : (o[lang] || o.en || ''));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => (lang === 'bn' ? '৳' : 'BDT ') + Number(n).toLocaleString('en-IN');
  const byId = id => PRODUCTS.find(p => p.id === id);
  const catOf = id => CATEGORIES.find(c => c.id === id);
  const waLink = text => `https://wa.me/${SHOP.whatsapp}` + (text ? `?text=${encodeURIComponent(text)}` : '');
  const sizeHtml = s => esc(s.label);

  // কার্টে থাকে { sizeId, qty }; পণ্য আর সাইজ খুঁজে নেওয়া হয় স্টোর থেকে
  const findSize = sizeId => { for (const p of PRODUCTS) { const s = p.sizes.find(x => x.id === sizeId); if (s) return { p, s }; } return null; };
  function loadCart() {
    try {
      const d = JSON.parse(store.get(CART_KEY) || '[]');
      return Array.isArray(d) ? d.filter(i => i && findSize(i.sizeId) && i.qty > 0) : [];
    } catch (e) { return []; }
  }
  const saveCart = () => store.set(CART_KEY, JSON.stringify(cart));

  // ---------- product pictures (আসল ছবি না থাকলে আঁকা ছবি) ----------
  function art(p, view = 'front') {
    const c = p.color.hex, st = 'rgba(0,0,0,.22)';
    const robe = (fill, tr = '', details = true) => `<g ${tr}>
      <path d="M80 20 Q100 36 120 20 L152 32 L192 92 L172 106 L152 76 L152 246 L48 246 L48 76 L28 106 L8 92 L48 32 Z" fill="${fill}" stroke="${st}" stroke-width="1.6" stroke-linejoin="round"/>
      ${details ? `<path d="M100 30 V102" stroke="${st}" stroke-width="1.6"/><circle cx="100" cy="46" r="2" fill="${st}"/><circle cx="100" cy="62" r="2" fill="${st}"/><circle cx="100" cy="78" r="2" fill="${st}"/><path d="M62 92 h18 v22 h-18 z" fill="none" stroke="${st}" stroke-width="1.4"/>` : `<path d="M84 22 Q100 30 116 22" fill="none" stroke="${st}" stroke-width="1.4"/>`}
    </g>`;
    let inner, vb = '0 0 200 260';
    if (p.shape === 'combo') {
      inner = robe(c, 'transform="translate(0 6) scale(.8)"') + robe(c, 'transform="translate(104 128) scale(.5)"');
    } else if (p.shape === 'cap') {
      inner = `<path d="M40 168 Q100 62 160 168 Z" fill="${c}" stroke="${st}" stroke-width="1.6"/><rect x="34" y="164" width="132" height="22" rx="4" fill="${c}" stroke="${st}" stroke-width="1.6"/>`;
    } else if (p.shape === 'bottle') {
      inner = `<rect x="84" y="56" width="32" height="28" rx="4" fill="#3A3A3A"/><path d="M66 86 H134 V214 Q134 228 120 228 H80 Q66 228 66 214 Z" fill="${c}" stroke="${st}" stroke-width="1.6"/><rect x="80" y="130" width="40" height="40" rx="3" fill="rgba(255,255,255,.55)"/>`;
    } else {
      inner = robe(c, '', view !== 'back');
      if (view === 'detail') vb = '52 10 96 110';
    }
    return `<svg viewBox="${vb}" aria-hidden="true">${inner}</svg>`;
  }
  const views = p => (p.images && p.images.length) ? p.images.map((_, i) => i) : (p.shape === 'thobe' ? ['front', 'back', 'detail'] : ['front']);
  function media(p, v = 0) {
    const src = p.images && typeof v === 'number' ? p.images[v] : null;
    if (src) return `<img src="${esc(src)}" alt="${esc(L(p.name))}" loading="lazy">`;
    return `<div class="ph">${art(p, typeof v === 'string' ? v : 'front')}</div>`;
  }
  const priceHtml = p => p.compare
    ? `<span class="price-now">${money(p.price)}</span> <s>${money(p.compare)}</s>`
    : money(p.price);

  function card(p) {
    const alt = p.images && p.images[1] ? `<div class="card-alt">${media(p, 1)}</div>` : '';
    return `<a class="card" href="#/p/${p.id}">
      <div class="card-media">${media(p, 0)}${alt}${p.badge ? `<span class="badge">${esc(L(p.badge))}</span>` : ''}</div>
      <h3>${esc(L(p.name))}</h3>
      <p class="card-sub">${esc(L(p.color))}</p>
      <p class="card-price">${priceHtml(p)}</p>
    </a>`;
  }

  // ---------- pages ----------
  function pageHome() {
    const tiles = CATEGORIES.filter(c => c.tile).map(c => {
      const p = PRODUCTS.find(x => x.cat === c.id);
      return `<a class="tile" href="#/c/${c.id}"><div class="tile-media">${p ? media(p, 0) : ''}</div><span>${esc(L(c.name))}</span></a>`;
    }).join('');
    const newOnes = PRODUCTS.filter(p => p.isNew);
    const fresh = (newOnes.length ? newOnes : PRODUCTS).slice(0, 4);
    const combo = PRODUCTS.find(p => p.cat === 'father-son');
    return `
    <section class="hero">
      <div class="wrap hero-row">
        <div class="hero-copy">
          <h1>${t('heroTitle')}</h1>
          <p>${t('heroText')}</p>
          <a class="btn btn-dark" href="#/c/thobe">${t('shopThobe')}</a>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <picture><source srcset="mark-dark.png" media="(prefers-color-scheme: dark)"><img src="mark-light.png" alt="" width="661" height="276"></picture>
        </div>
      </div>
    </section>
    <section class="wrap block">
      <h2 class="block-title">${t('shopBy')}</h2>
      <div class="tiles">${tiles}</div>
    </section>
    <section class="wrap block">
      <div class="block-head"><h2 class="block-title">${t('newArrivals')}</h2><a class="link" href="#/c/all">${t('viewAll')}</a></div>
      ${fresh.length ? `<div class="grid">${fresh.map(card).join('')}</div>` : `<p class="muted">${t('emptyList')}</p>`}
    </section>
    ${combo ? `<section class="wrap block"><div class="promo">
      <div class="promo-media">${media(combo, 0)}</div>
      <div class="promo-copy"><h2>${t('promoTitle')}</h2><p>${t('promoText')}</p><p class="promo-price">${priceHtml(combo)}</p><a class="btn btn-dark" href="#/p/${combo.id}">${t('promoBtn')}</a></div>
    </div></section>` : ''}
    <section class="wrap trust">${STR[lang].trust.map(([h, s]) => `<div><h3>${h}</h3><p>${s}</p></div>`).join('')}</section>`;
  }

  function pageCategory(id) {
    const c = catOf(id) || catOf('all');
    let list = PRODUCTS.filter(p => c.id === 'all' || p.cat === c.id);
    if (sortBy === 'low') list = [...list].sort((a, b) => a.price - b.price);
    if (sortBy === 'high') list = [...list].sort((a, b) => b.price - a.price);
    return `<div class="wrap page">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${esc(L(c.name))}</span></nav>
      <div class="cat-head">
        <h1>${esc(L(c.name))}</h1>
        <div class="cat-tools">
          <span class="muted">${list.length} ${t('items')}</span>
          <select id="sortSel" aria-label="Sort">
            <option value="default">${t('sortDefault')}</option>
            <option value="low">${t('sortLow')}</option>
            <option value="high">${t('sortHigh')}</option>
          </select>
        </div>
      </div>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<p class="muted">${t('emptyList')}</p>`}
    </div>`;
  }

  function pageProduct(id) {
    const p = byId(id);
    if (!p) return pageNotFound();
    const c = catOf(p.cat) || CATEGORIES[0];
    const vs = views(p);
    const siblings = PRODUCTS.filter(x => x.group === p.group);
    const related = PRODUCTS.filter(x => x.cat === p.cat && x.group !== p.group).slice(0, 4);
    const fill = related.length < 4 ? PRODUCTS.filter(x => x.cat !== p.cat && x.group !== p.group).slice(0, 4 - related.length) : [];
    const rel = related.concat(fill);
    return `<div class="wrap page pdp" data-id="${p.id}">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><a href="#/c/${c.id}">${esc(L(c.name))}</a><span>/</span><span>${esc(L(p.name))}</span></nav>
      <div class="pdp-grid">
        <div class="gallery">
          <div class="thumbs">${vs.length > 1 ? vs.map((v, i) => `<button class="thumb" data-view="${i}" aria-pressed="${i === 0}" aria-label="${i + 1}">${media(p, v)}</button>`).join('') : ''}</div>
          <div class="gallery-main" id="galleryMain">${media(p, vs[0])}</div>
        </div>
        <div class="pdp-info">
          <h1>${esc(L(p.name))}</h1>
          <p class="muted sku">${t('code')}: ${p.id}</p>
          <p class="pdp-price">${priceHtml(p)}</p>

          <p class="opt-label">${t('color')}: <strong>${esc(L(p.color))}</strong></p>
          ${siblings.length > 1 ? `<div class="swatches">${siblings.map(s => `<a class="swatch" href="#/p/${s.id}" style="--sw:${s.color.hex}" aria-label="${esc(L(s.color))}" ${s.id === p.id ? 'aria-current="true"' : ''}></a>`).join('')}</div>` : ''}

          <div class="opt-row"><p class="opt-label">${t('size')}</p>${(p.shape === 'thobe' || p.shape === 'combo') && p.sizes.length > 1 ? `<a class="link" href="#/page/size-guide">${t('sizeGuide')}</a>` : ''}</div>
          <div class="sizes">${p.sizes.map(s => `<button class="size" data-size="${s.id}" aria-pressed="${p.sizes.length === 1 && s.stock > 0}" ${s.stock > 0 ? '' : `disabled title="${t('soldOut')}"`}>${sizeHtml(s)}</button>`).join('')}</div>
          <p class="muted small stock-note" id="stockNote"></p>
          <p class="error" id="sizeErr" hidden>${t('pickSize')}</p>

          <div class="buy-row">
            <div class="qty"><button data-q="-1" aria-label="−">−</button><span id="qtyVal">1</span><button data-q="1" aria-label="+">+</button></div>
            <button class="btn btn-outline" id="addBtn">${t('addToCart')}</button>
          </div>
          <button class="btn btn-dark btn-block" id="buyBtn">${t('buyNow')}</button>
          <a class="link wa-ask" target="_blank" rel="noopener" href="${waLink(`${L(p.name)} (${p.id}), ${L(p.color)}`)}">${t('orderWa')}</a>

          <div class="pdp-desc">
            <p>${esc(L(p.desc))}</p>
            <ul>${(L(p.features) || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>
          ${L(p.fabric) || p.gsm ? `<details class="acc" open><summary>${t('materials')}</summary><ul>${L(p.fabric) ? `<li>${esc(L(p.fabric))}</li>` : ''}${p.gsm ? `<li>GSM ${p.gsm}</li>` : ''}</ul></details>` : ''}
          ${p.shape === 'thobe' || p.shape === 'combo' ? `<details class="acc"><summary>${t('care')}</summary><ul>${STR[lang].careList.map(x => `<li>${x}</li>`).join('')}</ul></details>` : ''}
          <details class="acc"><summary>${t('deliveryExchange')}</summary><p>${t('deliveryText', money(SHOP.deliveryInside), money(SHOP.deliveryOutside))}</p></details>
        </div>
      </div>
      ${rel.length ? `<section class="block"><h2 class="block-title">${t('related')}</h2><div class="grid">${rel.map(card).join('')}</div></section>` : ''}
    </div>`;
  }

  function pageInfo(slug) {
    const title = STR[lang].pages[slug];
    if (!title) return pageNotFound();
    let body;
    if (slug === 'size-guide') {
      const cols = STR[lang].sizeCols;
      body = `<p>${t('sizeIntro')}</p><div class="table-scroll"><table><thead><tr>${cols.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${SIZE_CHART.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (slug === 'contact') {
      body = STR[lang].pageText.contact + `<ul class="contact-list">
        <li><a href="tel:${esc(SHOP.phone)}">${esc(SHOP.phone)}</a></li>
        <li><a href="${waLink()}" target="_blank" rel="noopener">WhatsApp</a></li>
        ${SHOP.email ? `<li><a href="mailto:${esc(SHOP.email)}">${esc(SHOP.email)}</a></li>` : ''}
        <li>${esc(L(SHOP.address))}</li></ul>`;
    } else {
      body = STR[lang].pageText[slug];
    }
    return `<div class="wrap page info">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${title}</span></nav>
      <h1>${title}</h1><div class="prose">${body}</div></div>`;
  }

  const pageNotFound = () => `<div class="wrap page info"><h1>${t('notFound')}</h1><p><a class="btn btn-dark" href="#/">${t('backHome')}</a></p></div>`;

  // ---------- router ----------
  function route() {
    if (!loaded) { $('#view').innerHTML = `<div class="wrap page"><p class="muted">${t('loading')}</p></div>`; return; }
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    const view = $('#view');
    let active = '';
    if (!parts[0]) view.innerHTML = pageHome();
    else if (parts[0] === 'c') { active = parts[1]; view.innerHTML = pageCategory(parts[1]); bindCategory(); }
    else if (parts[0] === 'p') { const p = byId(parts[1]); active = p ? p.cat : ''; view.innerHTML = pageProduct(parts[1]); bindProduct(p); }
    else if (parts[0] === 'page') view.innerHTML = pageInfo(parts[1]);
    else view.innerHTML = pageNotFound();
    renderNav(active);
    const titleEl = view.querySelector('h1');
    document.title = (parts[0] && titleEl ? titleEl.textContent + ' | ' : '') + 'Al Hadaf';
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

  function bindCategory() {
    const sel = $('#sortSel');
    if (!sel) return;
    sel.value = sortBy;
    sel.addEventListener('change', () => { sortBy = sel.value; route(); });
  }

  function bindProduct(p) {
    if (!p) return;
    const root = $('.pdp');
    let size = p.sizes.length === 1 && p.sizes[0].stock > 0 ? p.sizes[0].id : null;
    const note = () => { const s = p.sizes.find(x => x.id === size); $('#stockNote').textContent = s && s.stock <= 3 ? t('onlyLeft', s.stock) : ''; };
    note();
    let qty = 1;
    const vs = views(p);
    root.addEventListener('click', e => {
      const th = e.target.closest('.thumb');
      if (th) {
        $('#galleryMain').innerHTML = media(p, vs[Number(th.dataset.view)]);
        root.querySelectorAll('.thumb').forEach(b => b.setAttribute('aria-pressed', b === th));
        return;
      }
      const sb = e.target.closest('.size');
      if (sb && !sb.disabled) {
        size = Number(sb.dataset.size);
        root.querySelectorAll('.size').forEach(b => b.setAttribute('aria-pressed', b === sb));
        $('#sizeErr').hidden = true;
        note();
        return;
      }
      const q = e.target.closest('[data-q]');
      if (q) { qty = Math.min(10, Math.max(1, qty + Number(q.dataset.q))); $('#qtyVal').textContent = qty; return; }
      const add = e.target.closest('#addBtn'), buy = e.target.closest('#buyBtn');
      if (add || buy) {
        if (!size) { $('#sizeErr').hidden = false; return; }
        addToCart(size, qty);
        if (buy) openCheckout(); else toast(t('added', L(p.name)));
      }
    });
  }

  // ---------- chrome: nav, menu, footer ----------
  function renderNav(active) {
    $('#catNav').innerHTML = `<div class="wrap cat-nav-row">${CATEGORIES.map(c =>
      `<a href="#/c/${c.id}" ${c.id === active ? 'aria-current="page"' : ''}>${esc(L(c.name))}</a>`).join('')}</div>`;
  }
  function renderMenu() {
    $('#menuBody').innerHTML = `
      <div class="side-head"><span>${t('menu')}</span><button class="icon-btn" data-close aria-label="${t('close')}">×</button></div>
      <nav class="menu-list">${CATEGORIES.map(c => `<a href="#/c/${c.id}" data-close>${esc(L(c.name))}</a>`).join('')}</nav>
      <nav class="menu-list small">${['size-guide', 'exchange', 'contact'].map(s => `<a href="#/page/${s}" data-close>${STR[lang].pages[s]}</a>`).join('')}</nav>
      <button class="lang-btn menu-lang" data-lang>${t('langSwitch')}</button>`;
  }
  function renderFooter() {
    const P = STR[lang].pages, link = s => `<li><a href="#/page/${s}">${P[s]}</a></li>`;
    $('#footer').innerHTML = `<div class="wrap foot-grid">
      <div class="foot-brand">
        <img src="logo-dark.png" alt="Al Hadaf" width="661" height="357">
        <p>${esc(L(SHOP.address))}</p>
      </div>
      <div><h3>${t('legal')}</h3><ul>${link('shipping')}${link('exchange')}${link('privacy')}</ul></div>
      <div><h3>${t('information')}</h3><ul>${link('size-guide')}${link('about')}${link('contact')}</ul></div>
      <div><h3>${t('service')}</h3><ul>
        <li><a href="tel:${esc(SHOP.phone)}">${esc(SHOP.phone)}</a></li>
        ${SHOP.email ? `<li><a href="mailto:${esc(SHOP.email)}">${esc(SHOP.email)}</a></li>` : ''}
        ${SHOP.facebook ? `<li><a href="${esc(SHOP.facebook)}" target="_blank" rel="noopener">Facebook</a></li>` : ''}
        ${SHOP.instagram ? `<li><a href="${esc(SHOP.instagram)}" target="_blank" rel="noopener">Instagram</a></li>` : ''}</ul></div>
    </div>
    <div class="wrap foot-bottom">
      <div class="pay"><span>${t('payBy')}</span><span class="pay-chip">bKash</span><span class="pay-chip">Nagad</span><span class="pay-chip">${t('cod')}</span></div>
      <p>© ${new Date().getFullYear()} Al Hadaf. ${t('rights')}</p>
    </div>`;
  }

  // ---------- cart ----------
  function addToCart(sizeId, qty) {
    const max = findSize(sizeId).s.stock;
    const f = cart.find(i => i.sizeId === sizeId);
    if (f) f.qty = Math.min(max, 10, f.qty + qty); else cart.push({ sizeId, qty: Math.min(max, qty) });
    saveCart(); renderCartCount();
  }
  const totals = area => {
    const sub = cart.reduce((s, i) => s + findSize(i.sizeId).p.price * i.qty, 0);
    const del = cart.length ? (area === 'outside' ? SHOP.deliveryOutside : SHOP.deliveryInside) : 0;
    return { sub, del, total: sub + del };
  };
  function renderCartCount() {
    const n = cart.reduce((s, i) => s + i.qty, 0);
    $('#cartCount').textContent = n;
    $('#cartCount').hidden = n === 0;
  }
  function renderCart() {
    renderCartCount();
    const head = `<div class="side-head"><span>${t('cartTitle')}</span><button class="icon-btn" data-close aria-label="${t('close')}">×</button></div>`;
    if (!cart.length) {
      $('#cartBody').innerHTML = head + `<div class="empty"><p>${t('cartEmpty')}</p><a class="btn btn-outline" href="#/c/all" data-close>${t('continueShopping')}</a></div>`;
      return;
    }
    $('#cartBody').innerHTML = head + `<div class="cart-items">${cart.map((i, idx) => {
      const { p, s } = findSize(i.sizeId);
      return `<div class="ci">
        <a class="ci-media" href="#/p/${p.id}" data-close>${media(p, 0)}</a>
        <div class="ci-info">
          <h4>${esc(L(p.name))}</h4>
          <p>${esc(L(p.color))}</p>
          <p>${t('sizeIs', esc(s.label))}</p>
          <div class="ci-row">
            <div class="qty sm"><button data-ci="${idx}" data-d="-1" aria-label="−">−</button><span>${i.qty}</span><button data-ci="${idx}" data-d="1" aria-label="+">+</button></div>
            <strong>${money(p.price * i.qty)}</strong>
          </div>
          <button class="text-btn" data-remove="${idx}">${t('remove')}</button>
        </div></div>`;
    }).join('')}</div>
    <div class="cart-foot">
      <p class="row"><span>${t('subtotal')}</span><strong>${money(totals().sub)}</strong></p>
      <p class="muted small">${t('deliveryLater')}</p>
      <button class="btn btn-dark btn-block" id="toCheckout">${t('checkout')}</button>
    </div>`;
  }
  $('#cartBody').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { cart.splice(Number(rm.dataset.remove), 1); saveCart(); renderCart(); return; }
    const b = e.target.closest('[data-ci]');
    if (b) {
      const i = cart[Number(b.dataset.ci)];
      i.qty += Number(b.dataset.d);
      if (i.qty < 1) cart.splice(Number(b.dataset.ci), 1); else i.qty = Math.min(10, findSize(i.sizeId).s.stock, i.qty);
      saveCart(); renderCart(); return;
    }
    if (e.target.closest('#toCheckout')) openCheckout();
  });

  // ---------- checkout ----------
  function openCheckout() {
    if (!cart.length) return;
    if ($('#cartDialog').open) $('#cartDialog').close();
    $('#checkoutBody').innerHTML = `
      <button class="icon-btn dlg-x" data-close aria-label="${t('close')}">×</button>
      <form id="coForm" novalidate>
        <h2>${t('checkoutTitle')}</h2>
        <label class="field"><span>${t('name')}</span><input name="custName" autocomplete="name"></label>
        <label class="field"><span>${t('phone')}</span><input name="custPhone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
        <label class="field"><span>${t('address')}</span><textarea name="custAddress" autocomplete="street-address" placeholder="${t('addressPh')}"></textarea></label>
        <fieldset class="options"><legend>${t('area')}</legend>
          <label class="opt"><input type="radio" name="area" value="inside" checked><span>${t('inside')}<small>${t('chargeIs', money(SHOP.deliveryInside))}</small></span></label>
          <label class="opt"><input type="radio" name="area" value="outside"><span>${t('outside')}<small>${t('chargeIs', money(SHOP.deliveryOutside))}</small></span></label>
        </fieldset>
        <fieldset class="options"><legend>${t('payment')}</legend>
          <label class="opt"><input type="radio" name="payment" value="cod" checked><span>${t('cod')}<small>${t('codNote')}</small></span></label>
          <label class="opt"><input type="radio" name="payment" value="bkash"><span>${t('bkash')}<small>${t('bkashNote')}</small></span></label>
        </fieldset>
        <div class="bkash-box" id="bkashBox" hidden><p id="bkashText"></p>
          <label class="field"><span>${t('trx')}</span><input name="trx" autocomplete="off"></label></div>
        <label class="field"><span>${t('note')}</span><textarea name="note" placeholder="${t('notePh')}"></textarea></label>
        <div class="summary" id="coSummary"></div>
        <p class="error" id="coErr" hidden></p>
        <button class="btn btn-dark btn-block" type="submit">${t('confirm')}</button>
      </form>`;
    const form = $('#coForm');
    const update = () => {
      const tt = totals(form.elements.area.value);
      $('#coSummary').innerHTML = `<p class="row"><span>${t('subtotal')}</span><span>${money(tt.sub)}</span></p>
        <p class="row"><span>${t('deliveryCharge')}</span><span>${money(tt.del)}</span></p>
        <p class="row total"><span>${t('total')}</span><span>${money(tt.total)}</span></p>`;
      const bk = form.elements.payment.value === 'bkash';
      $('#bkashBox').hidden = !bk;
      $('#bkashText').innerHTML = t('sendTo', money(tt.total), SHOP.bkash);
    };
    form.addEventListener('change', update);
    form.addEventListener('submit', e => { e.preventDefault(); submitOrder(form); });
    update();
    $('#checkoutDialog').showModal();
  }

  async function submitOrder(form) {
    const f = n => form.elements.namedItem(n).value.trim();
    const name = f('custName'), phone = f('custPhone').replace(/[\s-]/g, ''), address = f('custAddress');
    const area = form.elements.area.value, pay = form.elements.payment.value, trx = f('trx'), note = f('note');
    const errs = [];
    if (name.length < 2) errs.push(t('errName'));
    if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(phone)) errs.push(t('errPhone'));
    if (address.length < 8) errs.push(t('errAddress'));
    if (pay === 'bkash' && trx.length < 6) errs.push(t('errTrx'));
    const showErr = m => { $('#coErr').innerHTML = m; $('#coErr').hidden = false; };
    if (errs.length) return showErr(errs.join('<br>'));

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = t('placing');
    let res, data;
    try {
      res = await fetch('/api/orders', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, address, area, payment: pay, trx, note, lang, items: cart.map(i => ({ sizeId: i.sizeId, qty: i.qty })) })
      });
      data = await res.json();
    } catch (e) { data = null; }
    if (!res || !res.ok || !data || !data.ok) {
      btn.disabled = false; btn.textContent = t('confirm');
      if (data && data.error === 'stock') { await refresh(); return showErr(t('errStock')); }
      return showErr(data && data.message && res.status === 400 ? esc(data.message) : t('errServer'));
    }

    const W = STR[lang].wa;
    const msg = [
      `${W.order}: ${data.orderNo}`, `${W.name}: ${name}`, `${W.phone}: ${phone}`, '', `${W.items}:`,
      ...data.items.map(l => `- ${l.name}, ${l.color} (${l.code}), ${l.size} x${l.qty}`),
      `${t('total')}: ${money(data.total)}`
    ].join('\n');
    $('#checkoutBody').innerHTML = `<button class="icon-btn dlg-x" data-close aria-label="${t('close')}">×</button>
      <div class="success"><h2>${t('thanks')}</h2><p>${t('orderNo')} <strong>${data.orderNo}</strong></p>
      <p class="row total"><span>${t('total')}</span><span>${money(data.total)}</span></p>
      <p class="muted">${t('thanksText')}</p>
      ${SHOP.whatsapp ? `<a class="btn btn-outline btn-block" href="${waLink(msg)}" target="_blank" rel="noopener">${t('alsoWa')}</a>` : ''}</div>`;
    cart = []; saveCart(); renderCartCount();
    refresh();
  }

  async function refresh() {
    try { await loadStore(); applyChrome(); route(); } catch (e) { /* keep current view */ }
  }

  // ---------- dialogs, toast, language ----------
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  }));
  $('#menuOpen').addEventListener('click', () => { renderMenu(); $('#menuDialog').showModal(); });
  $('#cartOpen').addEventListener('click', () => { renderCart(); $('#cartDialog').showModal(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-lang]')) switchLang(); });
  $('#langBtn').setAttribute('data-lang', '');

  let tt;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function switchLang() {
    lang = lang === 'en' ? 'bn' : 'en';
    store.set(LANG_KEY, lang);
    if ($('#menuDialog').open) $('#menuDialog').close();
    applyChrome(); route();
  }
  function applyChrome() {
    document.documentElement.lang = lang;
    document.body.classList.toggle('bn', lang === 'bn');
    $('#announce').textContent = L(SHOP.announce) || t('announce');
    $('#langBtn').textContent = t('langSwitch');
    $('#menuOpen').setAttribute('aria-label', t('menu'));
    $('#cartOpen').setAttribute('aria-label', t('cartTitle'));
    $('#waFloat').href = waLink();
    renderFooter(); renderCartCount();
  }

  applyChrome();
  route();
  loadStore().then(() => { applyChrome(); route(); }).catch(() => {
    $('#view').innerHTML = `<div class="wrap page"><p class="muted">${t('errServer')}</p></div>`;
  });
})();
