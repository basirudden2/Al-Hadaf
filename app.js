// ===== Al Hadaf — app.js =====
(function () {
  'use strict';
  // /p/AH-1001 বা /c/thobe লিংক (Google আর শেয়ারের জন্য) এলে অ্যাপের পেজে নিয়ে যাওয়া
  const pathRoute = location.pathname.match(/^\/(p|c)\/([^/]+)\/?$/);
  if (pathRoute && !location.hash) history.replaceState(null, '', '/#/' + pathRoute[1] + '/' + pathRoute[2]);

  const $ = (s, el = document) => el.querySelector(s);
  const LANG_KEY = 'alhadaf_lang';
  const CART_KEY = 'alhadaf_cart_v2';
  const MEAS_KEY = 'alhadaf_meas';
  const CHAT_KEY = 'alhadaf_chat';
  const WISH_KEY = 'alhadaf_wish';
  const RECENT_KEY = 'alhadaf_recent';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  let lang = store.get(LANG_KEY) === 'bn' ? 'bn' : 'en';
  let SHOP = { whatsapp: '', phone: '', email: '', bkash: '', facebook: '', instagram: '', messenger: '', youtube: '', tiktok: '', address: { en: '', bn: '' }, deliveryInside: 0, deliveryOutside: 0, announce: { en: '', bn: '' } };
  let CUSTOM = null;
  let GALLERY = [];
  let BANNERS = [];
  let FEATURES = { otp: false, bkashPay: false };
  const readList = k => { try { const v = JSON.parse(store.get(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  let wish = readList(WISH_KEY), recent = readList(RECENT_KEY);
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
      messenger: s.messenger || '', youtube: s.youtube || '', tiktok: s.tiktok || '', fbPixel: String(s.fb_pixel || '').replace(/\D/g, ''),
      address: { en: s.address_en, bn: s.address_bn }, announce: { en: s.announce_en, bn: s.announce_bn },
      deliveryInside: Number(s.delivery_inside) || 0, deliveryOutside: Number(s.delivery_outside) || 0,
      bundleMin: Number(s.bundle_min) || 0, bundlePct: Number(s.bundle_pct) || 0
    };
    CATEGORIES = [{ id: 'all', name: { en: 'All', bn: 'সব' } }, ...d.categories];
    PRODUCTS = d.products.map(p => ({ ...p, shape: PLACEHOLDER[p.cat] || 'thobe' }));
    CUSTOM = d.custom && d.custom.fabrics.length ? d.custom : null;
    GALLERY = d.gallery || [];
    BANNERS = d.banners || [];
    FEATURES = d.features || FEATURES;
    loaded = true;
    initPixel();
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
  const starsHtml = (n, cls = '') => `<span class="stars ${cls}" role="img" aria-label="${t('stars', n)}">${[1, 2, 3, 4, 5].map(i => `<i class="${n >= i - .25 ? 'on' : n >= i - .75 ? 'half' : ''}"></i>`).join('')}</span>`;

  // ---------- Facebook Pixel (Admin › Shop info-তে Pixel ID দিলে চালু হয়) ----------
  let pixelOn = false;
  function initPixel() {
    if (pixelOn || !SHOP.fbPixel) return;
    pixelOn = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', SHOP.fbPixel);
  }
  const px = (ev, data) => { try { if (pixelOn && window.fbq) window.fbq('track', ev, data); } catch (e) { /* ignore */ } };

  // কার্টে থাকে { sizeId, qty }; পণ্য আর সাইজ খুঁজে নেওয়া হয় স্টোর থেকে
  const findSize = sizeId => { for (const p of PRODUCTS) { const s = p.sizes.find(x => x.id === sizeId); if (s) return { p, s }; } return null; };
  function loadCart() {
    try {
      const d = JSON.parse(store.get(CART_KEY) || '[]');
      return Array.isArray(d) ? d.filter(i => i && i.qty > 0 && (i.custom ? customPrice(i.custom) : findSize(i.sizeId))) : [];
    } catch (e) { return []; }
  }

  // ---------- নিজের মাপের জুব্বা: দাম হিসাব (সার্ভারও একইভাবে হিসাব করে) ----------
  const fabricOf = id => CUSTOM && CUSTOM.fabrics.find(f => f.id === id);
  function customPrice(c) {
    const f = CUSTOM && c && fabricOf(c.fabric);
    if (!f) return null;
    const extras = CUSTOM.groups.reduce((s, g) => s + ((g.options[c.opts && c.opts[g.key]] || g.options[0] || {}).add || 0), 0);
    return { base: CUSTOM.basePrice, fabric: f.add, extras, unit: CUSTOM.basePrice + f.add + extras };
  }
  const optName = (g, c) => L((g.options[c.opts && c.opts[g.key]] || g.options[0] || {}).name);
  // কার্টের প্রতিটি লাইন একইভাবে দেখানোর জন্য
  function lineOf(i) {
    if (i.custom) {
      const c = i.custom, f = fabricOf(c.fabric);
      return {
        name: t('customItem'), price: customPrice(c).unit, max: 5, href: '#/custom',
        media: `<div class="ph">${art({ shape: 'thobe', color: { hex: f.hex } })}</div>`,
        sub: [L(f.name), CUSTOM.groups.map(g => optName(g, c)).join(', '), c.fit === 'standard' ? t('sizeIs', esc(c.size)) : t('madeToMeasure')]
      };
    }
    const { p, s } = findSize(i.sizeId);
    return { name: L(p.name), price: p.price, max: Math.min(10, s.stock), href: '#/p/' + p.id, media: media(p, 0), sub: [L(p.color), t('sizeIs', esc(s.label))] };
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

  const wishBtn = (p, cls = '') => `<button class="wish ${cls}" data-wish="${esc(p.id)}" aria-pressed="${wish.includes(p.id)}" aria-label="${wish.includes(p.id) ? t('wishRemove') : t('wishAdd')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/></svg></button>`;
  const card = p => `<div class="card-wrap">${cardLink(p)}${wishBtn(p)}</div>`;
  function cardLink(p) {
    const alt = p.images && p.images[1] ? `<div class="card-alt">${media(p, 1)}</div>` : '';
    return `<a class="card" href="#/p/${p.id}">
      <div class="card-media">${media(p, 0)}${alt}${p.badge ? `<span class="badge">${esc(L(p.badge))}</span>` : ''}</div>
      <h3>${esc(L(p.name))}</h3>
      <p class="card-sub">${esc(L(p.color))}</p>
      <p class="card-price">${priceHtml(p)}</p>
      ${p.rating ? `<p class="card-rating">${starsHtml(p.rating.avg, 'sm')}<span>(${p.rating.count})</span></p>` : ''}
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
    ${BANNERS.length ? bannerSlider() : `<section class="hero">
      <div class="wrap hero-row">
        <div class="hero-copy">
          <h1>${t('heroTitle')}</h1>
          <p>${t('heroText')}</p>
          <a class="btn btn-dark" href="#/c/thobe">${t('shopThobe')}</a>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <picture><source srcset="/mark-dark.png" media="(prefers-color-scheme: dark)"><img src="/mark-light.png" alt="" width="661" height="276"></picture>
        </div>
      </div>
    </section>`}
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
    ${CUSTOM ? `<section class="wrap block"><div class="custom-promo">
      <div class="cp-swatches" aria-hidden="true">${CUSTOM.fabrics.slice(0, 4).map(f => `<span style="--sw:${esc(f.hex)}">${f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : ''}</span>`).join('')}</div>
      <div class="cp-copy"><h2>${t('customPromoTitle')}</h2><p>${t('customPromoText')}</p>
        <p class="promo-price">${t('from')} ${money(CUSTOM.basePrice + Math.min(...CUSTOM.fabrics.map(f => f.add)))}</p>
        <a class="btn btn-dark" href="#/custom">${t('customPromoBtn')}</a></div>
    </div></section>` : ''}
    ${marquee()}
    ${recentBlock()}
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
          <div class="gallery-main ${p.images && p.images.length ? 'zoomable' : ''}" id="galleryMain" data-idx="0">${media(p, vs[0])}</div>
        </div>
        <div class="pdp-info">
          <h1>${esc(L(p.name))}</h1>
          <p class="muted sku">${t('code')}: ${p.id}</p>
          <div class="pdp-title-row"><p class="pdp-price">${priceHtml(p)}</p>${wishBtn(p, 'lg')}</div>
          ${SHOP.bundleMin >= 2 && SHOP.bundlePct ? `<p class="bundle-note">${t('bundleNote', SHOP.bundleMin, SHOP.bundlePct)}</p>` : ''}
          ${p.rating ? `<button class="pdp-rating" data-scroll="reviews">${starsHtml(p.rating.avg)}<span>${p.rating.avg} · ${t('reviewsCount', p.rating.count)}</span></button>` : ''}

          <p class="opt-label">${t('color')}: <strong>${esc(L(p.color))}</strong></p>
          ${siblings.length > 1 ? `<div class="swatches">${siblings.map(s => `<a class="swatch" href="#/p/${s.id}" style="--sw:${s.color.hex}" aria-label="${esc(L(s.color))}" ${s.id === p.id ? 'aria-current="true"' : ''}></a>`).join('')}</div>` : ''}

          <div class="opt-row"><p class="opt-label">${t('size')}</p>${(p.shape === 'thobe' || p.shape === 'combo') && p.sizes.length > 1 ? `<a class="link" href="#/page/size-guide">${t('sizeGuide')}</a>` : ''}</div>
          <div class="sizes">${p.sizes.map(s => `<button class="size ${s.stock > 0 ? '' : 'out'}" data-size="${s.id}" aria-pressed="${p.sizes.length === 1 && s.stock > 0}" ${s.stock > 0 ? '' : `title="${t('soldOut')}" aria-label="${esc(s.label)}, ${t('soldOut')}"`}>${sizeHtml(s)}</button>`).join('')}</div>
          <div id="notifyBox"></div>
          <p class="muted small stock-note" id="stockNote"></p>
          <p class="error" id="sizeErr" hidden>${t('pickSize')}</p>

          <div class="buy-row">
            <div class="qty"><button data-q="-1" aria-label="−">−</button><span id="qtyVal">1</span><button data-q="1" aria-label="+">+</button></div>
            <button class="btn btn-outline" id="addBtn">${t('addToCart')}</button>
          </div>
          <button class="btn btn-dark btn-block" id="buyBtn">${t('buyNow')}</button>
          <div class="pdp-links">
            <a class="link wa-ask" target="_blank" rel="noopener" href="${waLink(`${L(p.name)} (${p.id}), ${L(p.color)}`)}">${icon('whatsapp', 16)}${t('orderWa')}</a>
            <button class="link link-btn" data-chat>${icon('chat', 16)}${t('chatTitle')}</button>
          </div>
          ${CUSTOM && p.shape === 'thobe' ? `<a class="custom-cta" href="#/custom">${t('customFromProduct')}</a>` : ''}
          <div class="share-row"><span class="muted small">${t('share')}</span>
            <a class="share fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.origin + '/p/' + p.id)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook', 18)}</a>
            <a class="share wa" href="https://wa.me/?text=${encodeURIComponent(L(p.name) + ' ' + location.origin + '/p/' + p.id)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', 18)}</a>
            <button class="share" data-copy="${esc(location.origin + '/p/' + p.id)}" aria-label="${t('copyLink')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>
          </div>

          <div class="pdp-desc">
            <p>${esc(L(p.desc))}</p>
            <ul>${(L(p.features) || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>
          ${L(p.fabric) || p.gsm ? `<details class="acc" open><summary>${t('materials')}</summary><ul>${L(p.fabric) ? `<li>${esc(L(p.fabric))}</li>` : ''}${p.gsm ? `<li>GSM ${p.gsm}</li>` : ''}</ul></details>` : ''}
          ${p.shape === 'thobe' || p.shape === 'combo' ? `<details class="acc"><summary>${t('care')}</summary><ul>${STR[lang].careList.map(x => `<li>${x}</li>`).join('')}</ul></details>` : ''}
          <details class="acc"><summary>${t('deliveryExchange')}</summary><p>${t('deliveryText', money(SHOP.deliveryInside), money(SHOP.deliveryOutside))}</p></details>
        </div>
      </div>
      ${reviewsBlock(p)}
      ${recentBlock(p.id)}
      ${rel.length ? `<section class="block"><h2 class="block-title">${t('related')}</h2><div class="grid">${rel.map(card).join('')}</div></section>` : ''}
    </div>`;
  }

  function reviewsBlock(p) {
    const r = p.rating, list = p.reviews || [];
    const dist = [5, 4, 3, 2, 1].map(n => [n, list.filter(x => x.rating === n).length]);
    return `<section class="block reviews" id="reviews" data-reveal>
      <div class="rv-top">
        <div class="rv-sum">
          <h2 class="block-title">${t('reviews')}</h2>
          ${r ? `<p class="rv-avg"><strong>${r.avg}</strong>${starsHtml(r.avg)}<span class="muted">${t('reviewsCount', r.count)}</span></p>
            <ul class="rv-dist">${dist.map(([n, c]) => `<li><span>${n}</span><i style="--w:${list.length ? c / list.length * 100 : 0}%"></i><span class="muted">${c}</span></li>`).join('')}</ul>` : `<p class="muted">${t('noReviews')}</p>`}
          <button class="btn btn-outline" id="rvOpen">${t('writeReview')}</button>
        </div>
        <div class="rv-list">${list.map(x => `<article class="rv">
          <div class="rv-meta">${starsHtml(x.rating, 'sm')}<strong>${esc(x.name)}</strong>${x.verified ? `<span class="rv-ver">${t('verified')}</span>` : ''}<time class="muted">${esc(x.date)}</time></div>
          ${x.body ? `<p>${esc(x.body).replace(/\n/g, '<br>')}</p>` : ''}</article>`).join('')}</div>
      </div>
      <form class="rv-form" id="rvForm" hidden novalidate>
        <fieldset class="rv-stars"><legend>${t('yourRating')}</legend>
          ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" value="${n}" id="rv${n}"><label for="rv${n}" title="${t('stars', n)}" aria-label="${t('stars', n)}"></label>`).join('')}
        </fieldset>
        <div class="rv-fields">
          <label class="field"><span>${t('reviewName')}</span><input name="name" autocomplete="name"></label>
          <label class="field"><span>${t('reviewPhone')}</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX"><small class="muted">${t('reviewPhoneNote')}</small></label>
        </div>
        <label class="field"><span>${t('reviewBody')}</span><textarea name="body" placeholder="${t('reviewBodyPh')}"></textarea></label>
        <p class="error" id="rvErr" hidden></p>
        <button class="btn btn-dark" type="submit">${t('reviewSend')}</button>
      </form>
    </section>`;
  }

  function pageInfo(slug) {
    const title = STR[lang].pages[slug];
    if (!title) return pageNotFound();
    let body;
    if (slug === 'size-guide') {
      const cols = STR[lang].sizeCols;
      body = `<p>${t('sizeIntro')}</p><div class="table-scroll"><table><thead><tr>${cols.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${SIZE_CHART.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (slug === 'contact') {
      const row = (k, href, label) => `<li><a href="${esc(href)}" ${/^https?:/.test(href) ? 'target="_blank" rel="noopener"' : ''}><span class="ci-ic soc-${k}">${icon(k)}</span>${esc(label)}</a></li>`;
      body = STR[lang].pageText.contact + `<ul class="contact-list">
        ${row('phone', 'tel:' + SHOP.phone, SHOP.phone)}
        ${socials().map(([k, href, label]) => row(k, href, label)).join('')}
        <li><span class="ci-ic">${icon('map')}</span>${esc(L(SHOP.address))}</li></ul>
        <p><button class="btn btn-dark" data-chat>${t('chatTitle')}</button></p>`;
    } else {
      body = STR[lang].pageText[slug];
    }
    return `<div class="wrap page info">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${title}</span></nav>
      <h1>${title}</h1><div class="prose">${body}</div></div>`;
  }

  const pageNotFound = () => `<div class="wrap page info"><h1>${t('notFound')}</h1><p><a class="btn btn-dark" href="#/">${t('backHome')}</a></p></div>`;

  // ---------- নিজের মাপে জুব্বা ----------
  const MEAS_FIELDS = [['length', 1], ['chest', 1], ['shoulder', 1], ['sleeve', 1], ['neck', 1], ['cuff', 0], ['waist', 0], ['height', 0]];
  const savedMeas = () => { try { return JSON.parse(store.get(MEAS_KEY) || 'null'); } catch (e) { return null; } };
  let cu = null;
  function cuInit() {
    if (cu && fabricOf(cu.fabric)) return;
    const sm = savedMeas();
    cu = { fabric: CUSTOM.fabrics[0].id, opts: Object.fromEntries(CUSTOM.groups.map(g => [g.key, 0])), fit: sm ? 'measure' : 'standard', size: '',
      meas: (sm && sm.meas) || {}, fitPref: (sm && sm.fitPref) || 'regular', note: '', qty: 1, step: 1, remember: !!sm };
  }

  function pageCustom() {
    if (!CUSTOM) return `<div class="wrap page info"><h1>${t('customNav')}</h1><p class="muted">${t('customOff')}</p></div>`;
    cuInit();
    const step = (n, title, body) => `<section class="cu-step" data-step="${n}" ${cu.step === n ? 'data-open' : ''}>
      <button type="button" class="cu-step-head" data-goto="${n}" aria-expanded="${cu.step === n}"><span class="cu-num">${n}</span><span class="cu-title">${title}</span><span class="cu-val" id="cuVal${n}"></span></button>
      <div class="cu-body">${body}</div></section>`;
    const nav = (n, last) => `<div class="cu-nav">${n > 1 ? `<button type="button" class="btn btn-outline" data-goto="${n - 1}">${t('back')}</button>` : '<span></span>'}${last ? '' : `<button type="button" class="btn btn-dark" data-next="${n}">${t('next')}</button>`}</div>`;
    const fabrics = CUSTOM.fabrics.map(f => `<label class="fab">
      <input type="radio" name="fabric" value="${f.id}" ${cu.fabric === f.id ? 'checked' : ''}>
      <span class="fab-sw" style="--sw:${esc(f.hex)}">${f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : ''}</span>
      <span class="fab-txt"><strong>${esc(L(f.name))}</strong>${L(f.desc) ? `<small>${esc(L(f.desc))}</small>` : ''}${f.gsm ? `<small>GSM ${f.gsm}</small>` : ''}</span>
      <span class="fab-price">${f.add ? '+' + money(f.add) : ''}</span></label>`).join('');
    const groups = CUSTOM.groups.map(g => `<fieldset class="cu-group"><legend>${esc(L(g.name))}</legend><div class="chip-opts">${g.options.map((o, i) =>
      `<label class="chip-opt"><input type="radio" name="opt-${esc(g.key)}" value="${i}" ${cu.opts[g.key] === i ? 'checked' : ''}><span>${esc(L(o.name))}${o.add ? ` <small>+${money(o.add)}</small>` : ''}</span></label>`).join('')}</div></fieldset>`).join('');
    const M = STR[lang].meas, H = STR[lang].measHelp;
    const measInputs = MEAS_FIELDS.map(([k, req]) => `<label class="meas ${req ? 'req' : ''}"><span class="meas-l">${M[k]}${req ? '' : ` <small>(${t('optional')})</small>`}</span>
      <span class="meas-in"><input name="m-${k}" ${k === 'height' ? 'type="text"' : 'type="number" step="0.25" inputmode="decimal"'} value="${esc(cu.meas[k] || '')}">${k === 'height' ? '' : `<em>${t('inches')}</em>`}</span>
      <small class="meas-h">${H[k]}</small></label>`).join('');
    const sizeBody = `<div class="options fit-choice">
        <label class="opt"><input type="radio" name="fit" value="standard" ${cu.fit === 'standard' ? 'checked' : ''}><span>${t('fitStandard')}<small>${t('fitStandardNote')}</small></span></label>
        <label class="opt"><input type="radio" name="fit" value="measure" ${cu.fit === 'measure' ? 'checked' : ''}><span>${t('fitMeasure')}<small>${t('fitMeasureNote')}</small></span></label>
      </div>
      <div id="cuStd" ${cu.fit === 'standard' ? '' : 'hidden'}>
        <div class="opt-row"><p class="opt-label">${t('size')}</p><a class="link" href="#/page/size-guide">${t('sizeGuide')}</a></div>
        <div class="sizes">${CUSTOM.sizes.map(z => `<button type="button" class="size" data-csize="${esc(z)}" aria-pressed="${cu.size === z}">${esc(z)}</button>`).join('')}</div>
      </div>
      <div id="cuMeas" ${cu.fit === 'measure' ? '' : 'hidden'}>
        <div class="meas-grid">${measInputs}</div>
        <fieldset class="cu-group"><legend>${t('fitPref')}</legend><div class="chip-opts">${Object.entries(STR[lang].fits).map(([k, l]) =>
          `<label class="chip-opt"><input type="radio" name="fitPref" value="${k}" ${cu.fitPref === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
        <label class="check-line"><input type="checkbox" name="remember" ${cu.remember ? 'checked' : ''}> ${t('saveMeas')}</label>
      </div>
      <p class="error" id="cuErr3" hidden></p>`;
    const reviewBody = `<label class="field"><span>${t('customNote')}</span><textarea name="note" placeholder="${t('customNotePh')}">${esc(cu.note)}</textarea></label>
      <ul class="cu-notes muted small"><li>${t('customLead', CUSTOM.leadDays)}</li><li>${t('customNoReturn')}</li></ul>
      <div class="buy-row"><div class="qty"><button type="button" data-cq="-1" aria-label="−">−</button><span id="cuQty">${cu.qty}</span><button type="button" data-cq="1" aria-label="+">+</button></div>
        <button type="button" class="btn btn-dark" id="cuAdd">${t('customAdd')}</button></div>
      <p class="error" id="cuErr" hidden></p>`;
    return `<div class="wrap page custom-page">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${t('customNav')}</span></nav>
      <div class="cu-intro"><h1>${t('customTitle')}</h1><p class="muted">${t('customIntro')}</p></div>
      <form class="cu-grid" id="cuForm" novalidate>
        <aside class="cu-preview"><div class="cu-art" id="cuArt"></div><div class="cu-sum" id="cuSum"></div></aside>
        <div class="cu-steps">
          ${step(1, t('stepFabric'), `<div class="fabs">${fabrics}</div>${nav(1)}`)}
          ${step(2, t('stepStyle'), groups + nav(2))}
          ${step(3, t('stepFit'), sizeBody + nav(3))}
          ${step(4, t('stepReview'), reviewBody + nav(4, true))}
        </div>
      </form>
    </div>`;
  }

  function cuValid() {
    if (!fabricOf(cu.fabric)) return t('customErrFabric');
    if (cu.fit === 'standard') return CUSTOM.sizes.includes(cu.size) ? '' : t('customErrSize');
    const lim = { length: [36, 70], chest: [26, 70], shoulder: [12, 26], sleeve: [14, 32], neck: [11, 24], cuff: [5, 14], waist: [22, 64] };
    for (const [k, req] of MEAS_FIELDS) {
      if (k === 'height') continue;
      const v = parseFloat(cu.meas[k]);
      if (!Number.isFinite(v)) { if (req) return t('customErrMeas'); continue; }
      if (v < lim[k][0] || v > lim[k][1]) return `${STR[lang].meas[k]}: ${lim[k][0]}–${lim[k][1]} ${t('inches')}`;
    }
    return '';
  }

  function bindCustom() {
    const form = $('#cuForm');
    if (!form) return;
    const draw = () => {
      const f = fabricOf(cu.fabric), pr = customPrice(cu);
      $('#cuArt').innerHTML = `<div class="ph">${art({ shape: 'thobe', color: { hex: f.hex } })}</div>`;
      const sizeTxt = cu.fit === 'standard' ? (cu.size ? t('sizeIs', esc(cu.size)) : '—') : t('madeToMeasure');
      $('#cuSum').innerHTML = `<h3>${t('customItem')}</h3>
        <dl><dt>${t('fabricL')}</dt><dd>${esc(L(f.name))}</dd>
        ${CUSTOM.groups.map(g => `<dt>${esc(L(g.name))}</dt><dd>${esc(optName(g, cu))}</dd>`).join('')}
        <dt>${t('size')}</dt><dd>${sizeTxt}</dd></dl>
        <p class="row"><span>${t('tailoring')}</span><span>${money(pr.base)}</span></p>
        ${pr.fabric ? `<p class="row"><span>${t('fabricL')}</span><span>+${money(pr.fabric)}</span></p>` : ''}
        ${pr.extras ? `<p class="row"><span>${t('extras')}</span><span>+${money(pr.extras)}</span></p>` : ''}
        <p class="row total"><span>${t('perPiece')}</span><span>${money(pr.unit)}</span></p>`;
      $('#cuVal1').textContent = L(f.name);
      $('#cuVal2').textContent = CUSTOM.groups.map(g => optName(g, cu)).slice(0, 2).join(', ');
      $('#cuVal3').innerHTML = sizeTxt;
      $('#cuVal4').textContent = money(pr.unit * cu.qty);
    };
    const open = n => {
      cu.step = n;
      form.querySelectorAll('.cu-step').forEach(s => {
        const on = Number(s.dataset.step) === n;
        s.toggleAttribute('data-open', on);
        s.querySelector('.cu-step-head').setAttribute('aria-expanded', on);
      });
      const el = form.querySelector(`.cu-step[data-step="${n}"]`);
      if (el && el.getBoundingClientRect().top < 120) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    form.addEventListener('change', e => {
      const n = e.target.name;
      if (n === 'fabric') cu.fabric = Number(e.target.value);
      else if (n && n.startsWith('opt-')) cu.opts[n.slice(4)] = Number(e.target.value);
      else if (n === 'fit') { cu.fit = e.target.value; $('#cuStd').hidden = cu.fit !== 'standard'; $('#cuMeas').hidden = cu.fit !== 'measure'; }
      else if (n === 'fitPref') cu.fitPref = e.target.value;
      else if (n === 'remember') cu.remember = e.target.checked;
      draw();
    });
    form.addEventListener('input', e => {
      const n = e.target.name;
      if (n && n.startsWith('m-')) { cu.meas[n.slice(2)] = e.target.value.trim(); $('#cuErr3').hidden = true; }
      if (n === 'note') cu.note = e.target.value;
    });
    form.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g) { open(Number(g.dataset.goto)); return; }
      const nx = e.target.closest('[data-next]');
      if (nx) {
        const n = Number(nx.dataset.next);
        if (n === 3) { const err = cuValid(); if (err) { $('#cuErr3').textContent = err; $('#cuErr3').hidden = false; return; } }
        open(n + 1); return;
      }
      const sz = e.target.closest('[data-csize]');
      if (sz) { cu.size = sz.dataset.csize; form.querySelectorAll('[data-csize]').forEach(b => b.setAttribute('aria-pressed', b === sz)); $('#cuErr3').hidden = true; draw(); return; }
      const q = e.target.closest('[data-cq]');
      if (q) { cu.qty = Math.min(5, Math.max(1, cu.qty + Number(q.dataset.cq))); $('#cuQty').textContent = cu.qty; draw(); return; }
      if (e.target.closest('#cuAdd')) {
        const err = cuValid();
        if (err) { $('#cuErr').textContent = err; $('#cuErr').hidden = false; return; }
        const item = { fabric: cu.fabric, opts: { ...cu.opts }, fit: cu.fit, fitPref: cu.fitPref, note: cu.note.trim() };
        if (cu.fit === 'standard') item.size = cu.size; else item.meas = { ...cu.meas };
        if (cu.fit === 'measure') { if (cu.remember) store.set(MEAS_KEY, JSON.stringify({ meas: cu.meas, fitPref: cu.fitPref })); else store.set(MEAS_KEY, ''); }
        addCustom(item, cu.qty);
        cu.note = ''; cu.qty = 1;
        toast(t('customAdded'));
        renderCart(); $('#cartDialog').showModal();
      }
    });
    draw();
  }

  // ---------- গ্যালারি ----------
  // হোম পেজে দুই সারি ছবি উল্টো দিকে নিজে নিজে স্লাইড করে; মাউস রাখলে থেমে যায়
  function marquee() {
    galCat = 'all';
    const list = allGallery();
    if (!list.length) return '';
    const half = list.length > 7 ? Math.ceil(list.length / 2) : list.length;
    const rows = list.length > 7 ? [list.slice(0, half), list.slice(half)] : [list];
    const row = (items, offset, rev) => {
      let fill = items; while (fill.length < 8) fill = fill.concat(items);
      const html = fill.map((g, k) => `<button class="mq-item" data-gal="${(offset + (k % items.length))}" tabindex="${k < items.length ? 0 : -1}" aria-label="${esc(g.caption || t('photo'))}"><img src="${esc(g.src)}" alt="" loading="lazy"></button>`).join('');
      return `<div class="mq-row ${rev ? 'rev' : ''}" style="--dur:${Math.max(30, fill.length * 5)}s"><div class="mq-track">${html}</div><div class="mq-track" aria-hidden="true">${html.replace(/tabindex="0"/g, 'tabindex="-1"')}</div></div>`;
    };
    return `<section class="block mq-block" data-reveal>
      <div class="wrap block-head"><h2 class="block-title">${t('galleryHomeTitle')}</h2><a class="link" href="#/gallery">${t('viewAll')}</a></div>
      <div class="marquee">${rows.map((r, i) => row(r, i ? half : 0, i === 1)).join('')}</div>
    </section>`;
  }
  function pageGallery() {
    const all = allGallery();
    const cats = [['all', t('galleryAll')]].concat(GALLERY.length ? [['_ours', t('galleryOurs')]] : [],
      CATEGORIES.filter(c => c.id !== 'all' && all.some(g => g.cat === c.id)).map(c => [c.id, L(c.name)]));
    const list = galleryList();
    return `<div class="wrap page">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${t('galleryTitle')}</span></nav>
      <div class="cat-head"><div><h1>${t('galleryTitle')}</h1><p class="muted">${t('galleryIntro')}</p></div></div>
      ${cats.length > 2 ? `<div class="gal-filter" role="group" aria-label="${t('galleryTitle')}">${cats.map(([k, l]) => `<button class="gf" data-gcat="${esc(k)}" aria-pressed="${galCat === k}">${esc(l)}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="masonry">${list.map((g, i) => `<figure class="m-item" data-reveal style="--d:${(i % 6) * 70}ms">
        <button class="g-item" data-gal="${i}" aria-label="${esc(g.caption || t('photo') + ' ' + (i + 1))}"><img src="${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy"></button>
        ${g.caption ? `<figcaption>${g.href ? `<a href="${g.href}">${esc(g.caption)}</a>` : esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : `<p class="muted">${t('galleryEmpty')}</p>`}
    </div>`;
  }
  // গ্যালারি = অ্যাডমিনে আপলোড করা ছবি + সব পণ্যের ছবি (নতুন পণ্য যোগ করলে নিজে থেকেই আসে)
  function allGallery() {
    const own = GALLERY.map(g => ({ src: g.image, caption: L(g.caption), href: g.product && byId(g.product) ? '#/p/' + g.product : '', cat: '_ours' }));
    const prod = [];
    PRODUCTS.forEach(p => p.images.forEach((src, i) => prod.push({ src, caption: L(p.name) + (L(p.color) ? ', ' + L(p.color) : ''), href: '#/p/' + p.id, cat: p.cat, first: i === 0 })));
    // প্রথমে প্রতিটি পণ্যের মূল ছবি, তারপর বাকি ছবি, যাতে স্লাইডে বৈচিত্র্য থাকে
    return own.concat(prod.filter(x => x.first), prod.filter(x => !x.first));
  }
  let galCat = 'all';
  const galleryList = () => allGallery().filter(g => galCat === 'all' || g.cat === galCat);
  const galleryItems = galleryList;

  // ---------- lightbox ----------
  let lb = { items: [], i: 0 };
  function openLightbox(items, i) {
    lb = { items, i };
    drawLightbox();
    if (!$('#lightbox').open) $('#lightbox').showModal();
  }
  function drawLightbox() {
    const it = lb.items[lb.i], n = lb.items.length;
    $('#lbBody').innerHTML = `<button class="icon-btn lb-x" data-close aria-label="${t('close')}">×</button>
      <figure class="lb-fig"><img src="${esc(it.src)}" alt="${esc(it.caption || '')}">
      <figcaption>${it.caption ? `<span>${esc(it.caption)}</span>` : ''}${it.href ? `<a class="link" href="${it.href}" data-close>${t('viewProduct')}</a>` : ''}${n > 1 ? `<span class="lb-count">${lb.i + 1} / ${n}</span>` : ''}</figcaption></figure>
      ${n > 1 ? `<button class="lb-nav lb-prev" data-lb="-1" aria-label="${t('prev')}">‹</button><button class="lb-nav lb-next" data-lb="1" aria-label="${t('nextPhoto')}">›</button>` : ''}`;
  }
  const lbMove = d => { if (lb.items.length > 1) { lb.i = (lb.i + d + lb.items.length) % lb.items.length; drawLightbox(); } };
  $('#lightbox').addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (b) lbMove(Number(b.dataset.lb)); });
  $('#lightbox').addEventListener('keydown', e => { if (e.key === 'ArrowRight') lbMove(1); if (e.key === 'ArrowLeft') lbMove(-1); });
  let lbX = null;
  $('#lightbox').addEventListener('touchstart', e => { lbX = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', e => { if (lbX == null) return; const dx = e.changedTouches[0].clientX - lbX; if (Math.abs(dx) > 50) lbMove(dx < 0 ? 1 : -1); lbX = null; });

  // ---------- অর্ডার ট্র্যাক ----------
  function pageTrack() {
    return `<div class="wrap page info">
      <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${t('trackTitle')}</span></nav>
      <h1>${t('trackTitle')}</h1>
      <form class="track-form" id="trackForm" novalidate>
        <p class="muted">${t('trackIntro')}</p>
        <div class="track-row">
          <label class="field"><span>${t('trackNo')}</span><input name="no" placeholder="AH2611091234" autocomplete="off"></label>
          <label class="field"><span>${t('trackPhone')}</span><input name="phone" type="tel" inputmode="numeric" placeholder="01XXXXXXXXX" autocomplete="tel"></label>
          <button class="btn btn-dark" type="submit">${t('trackBtn')}</button>
        </div>
        <p class="error" id="trackErr" hidden></p>
      </form>
      <div id="trackOut"></div>
    </div>`;
  }
  function bindTrack() {
    const form = $('#trackForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const no = form.no.value.trim(), phone = form.phone.value.trim();
      const btn = form.querySelector('button'); btn.disabled = true; $('#trackErr').hidden = true;
      let d = null;
      try { const r = await fetch('/api/track?' + new URLSearchParams({ no, phone })); d = await r.json(); if (!r.ok) throw new Error(); }
      catch (err) { $('#trackErr').textContent = t('trackErr'); $('#trackErr').hidden = false; btn.disabled = false; $('#trackOut').innerHTML = ''; return; }
      btn.disabled = false;
      const S = STR[lang].statuses, flow = ['new', 'confirmed', 'shipped', 'delivered'], at = flow.indexOf(d.status);
      const when = new Date(d.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric' });
      $('#trackOut').innerHTML = `<div class="track-card">
        <div class="track-top"><div><strong>${esc(d.orderNo)}</strong><p class="muted small">${t('trackPlaced')} ${when}</p></div><strong>${money(d.total)}</strong></div>
        ${d.status === 'cancelled' ? `<p class="track-cancel">${S.cancelled}</p>` : `<ol class="track-steps">${flow.map((k, i) => `<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${S[k]}</li>`).join('')}</ol>`}
        ${d.tracking ? `<p class="small"><a class="link" href="https://steadfast.com.bd/t/${encodeURIComponent(d.tracking)}" target="_blank" rel="noopener">Steadfast: ${esc(d.tracking)}</a></p>` : ''}
        <ul class="track-items">${d.items.map(l => `<li>${esc(l.custom ? t('customItem') : l.name)}, ${esc(l.color)}, ${esc(l.custom && l.size === 'Made to measure' ? t('madeToMeasure') : l.size)} × ${l.qty}</li>`).join('')}</ul>
      </div>`;
    });
  }

  // ---------- চ্যাট ----------
  const chatState = () => { try { return JSON.parse(store.get(CHAT_KEY) || 'null'); } catch (e) { return null; } };
  const saveChat = c => store.set(CHAT_KEY, c ? JSON.stringify(c) : '');
  let chat = chatState(), chatMsgs = [], chatTimer = null, chatClosed = false;
  const lastId = () => (chatMsgs.length ? chatMsgs[chatMsgs.length - 1].id : 0);
  const fmtTime = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' });

  function renderChat() {
    const panel = $('#chatPanel');
    const alt = [SHOP.whatsapp && ['whatsapp', waLink(), 'WhatsApp'], SHOP.messenger && ['messenger', SHOP.messenger, 'Messenger']].filter(Boolean);
    const head = `<div class="chat-head"><div><strong>${t('chatTitle')}</strong><small>${t('chatIntro')}</small></div><button class="icon-btn" data-chat-close aria-label="${t('close')}">×</button></div>`;
    const foot = alt.length ? `<div class="chat-alt"><span>${t('chatOr')}</span>${alt.map(([k, h, l]) => `<a class="soc-${k}" href="${esc(h)}" target="_blank" rel="noopener">${icon(k, 16)}${l}</a>`).join('')}</div>` : '';
    if (!chat) {
      panel.innerHTML = head + `<form class="chat-start" id="chatStart" novalidate>
        <label class="field"><span>${t('chatName')}</span><input name="name" autocomplete="name" required></label>
        <label class="field"><span>${t('chatPhone')}</span><input name="phone" type="tel" inputmode="numeric" placeholder="01XXXXXXXXX" autocomplete="tel"></label>
        <label class="field"><span>${t('chatMsgPh').replace('…', '')}</span><textarea name="body" rows="3" required></textarea></label>
        <p class="error" id="chatErr" hidden></p>
        <button class="btn btn-dark btn-block" type="submit">${t('chatStart')}</button></form>` + foot;
      return;
    }
    panel.innerHTML = head + `<div class="chat-log" id="chatLog" aria-live="polite"></div>
      <form class="chat-compose" id="chatCompose"><textarea name="body" rows="1" placeholder="${t('chatMsgPh')}" aria-label="${t('chatMsgPh')}"></textarea>
      <button class="chat-send" type="submit" aria-label="${t('chatSend')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button></form>
      <p class="error chat-err" id="chatErr" hidden></p>
      <div class="chat-foot">${foot}<button class="text-btn" data-chat-new>${t('chatEnd')}</button></div>`;
    drawLog();
  }
  function drawLog() {
    const log = $('#chatLog'); if (!log) return;
    const onlyMine = chatMsgs.length && chatMsgs.every(m => m.sender === 'customer');
    log.innerHTML = chatMsgs.map(m => `<div class="msg ${m.sender === 'admin' ? 'them' : 'me'}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><time>${m.sender === 'admin' ? t('chatShop') + ' · ' : ''}${fmtTime(m.created_at)}</time></div>`).join('')
      + (onlyMine ? `<p class="chat-note">${t('chatWait')}</p>` : '') + (chatClosed ? `<p class="chat-note">${t('chatClosed')}</p>` : '');
    log.scrollTop = log.scrollHeight;
  }
  async function pollChat() {
    if (!chat) return;
    try {
      const r = await fetch(`/api/chat/${chat.token}?after=${lastId()}`);
      if (r.status === 404) { chat = null; chatMsgs = []; saveChat(null); renderChat(); return; }
      const d = await r.json();
      chatClosed = d.status === 'closed';
      if (d.messages && d.messages.length) {
        chatMsgs.push(...d.messages);
        const isOpen = !$('#chatPanel').hidden;
        if (isOpen) { chat.seen = lastId(); saveChat(chat); drawLog(); }
        else if (d.messages.some(m => m.sender === 'admin' && m.id > (chat.seen || 0))) $('#chatDot').hidden = false;
      }
    } catch (e) { /* offline, try later */ }
  }
  function schedule() {
    clearTimeout(chatTimer);
    if (!chat) return;
    const open = !$('#chatPanel').hidden;
    chatTimer = setTimeout(async () => { if (!document.hidden) await pollChat(); schedule(); }, open ? 4000 : 45000);
  }
  async function openChat() {
    $('#chatPanel').hidden = false; $('#chatFab').setAttribute('aria-expanded', 'true'); $('#chatDot').hidden = true;
    renderChat();
    if (chat) { await pollChat(); chat.seen = lastId(); saveChat(chat); drawLog(); }
    const first = $('#chatPanel').querySelector('input, textarea'); if (first) first.focus();
    schedule();
  }
  function closeChat() { $('#chatPanel').hidden = true; $('#chatFab').setAttribute('aria-expanded', 'false'); schedule(); }

  $('#chatFab').addEventListener('click', () => ($('#chatPanel').hidden ? openChat() : closeChat()));
  $('#chatPanel').addEventListener('click', e => {
    if (e.target.closest('[data-chat-close]')) closeChat();
    if (e.target.closest('[data-chat-new]')) { chat = null; chatMsgs = []; saveChat(null); renderChat(); }
  });
  $('#chatPanel').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeChat();
    if (e.key === 'Enter' && !e.shiftKey && e.target.closest('#chatCompose')) { e.preventDefault(); $('#chatCompose').requestSubmit(); }
  });
  $('#chatPanel').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]'), err = $('#chatErr');
    const body = f.body.value.trim();
    if (!body) return;
    btn.disabled = true; err.hidden = true;
    try {
      if (f.id === 'chatStart') {
        const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name.value, phone: f.phone.value, body }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message);
        chat = { token: d.token, name: d.name }; chatMsgs = d.messages; chat.seen = lastId(); saveChat(chat);
        renderChat(); schedule();
      } else {
        const r = await fetch(`/api/chat/${chat.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message);
        f.body.value = ''; chatClosed = false;
        await pollChat(); chat.seen = lastId(); saveChat(chat); drawLog();
      }
    } catch (x) { err.textContent = x.message && lang === 'en' ? x.message : t('chatErr'); err.hidden = false; }
    btn.disabled = false;
  });
  document.addEventListener('click', e => {
    const w = e.target.closest('[data-wish]');
    if (w) { e.preventDefault(); e.stopPropagation(); toggleWish(w.dataset.wish); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.copy) : Promise.reject()).then(() => toast(t('linkCopied'))).catch(() => prompt(t('copyLink'), cp.dataset.copy)); return; }
    if (e.target.closest('[data-chat]')) { e.preventDefault(); openChat(); }
    const g = e.target.closest('[data-gal]');
    if (g) openLightbox(galleryItems(), Number(g.dataset.gal));
  });
  if (chat) { pollChat().then(() => { chatMsgs.length && drawLog(); }); schedule(); }

  // ---------- হিরো ব্যানার স্লাইডার (Admin › Banners) ----------
  function bannerSlider() {
    return `<section class="bslider" id="bslider" aria-roledescription="carousel">
      <div class="bs-track">${BANNERS.map((b, i) => `<div class="bs-slide ${i === 0 ? 'on' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${BANNERS.length}" ${i ? 'aria-hidden="true"' : ''}>
        <img src="${esc(b.image)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>
        ${L(b.title) || L(b.text) || L(b.btn) ? `<div class="bs-copy wrap">${L(b.title) ? `<h1>${esc(L(b.title))}</h1>` : ''}${L(b.text) ? `<p>${esc(L(b.text))}</p>` : ''}
          ${L(b.btn) ? `<a class="btn btn-light" href="${esc(b.link || '#/c/all')}">${esc(L(b.btn))}</a>` : ''}</div>` : ''}
      </div>`).join('')}</div>
      ${BANNERS.length > 1 ? `<button class="bs-nav prev" data-bs="-1" aria-label="${t('prev')}">‹</button><button class="bs-nav next" data-bs="1" aria-label="${t('nextPhoto')}">›</button>
      <div class="bs-dots">${BANNERS.map((_, i) => `<button data-bsgo="${i}" aria-label="${i + 1}" aria-current="${i === 0}"><i></i></button>`).join('')}</div>` : ''}
    </section>`;
  }
  let bsTimer = null;
  function bindSlider() {
    clearInterval(bsTimer);
    const root = $('#bslider'); if (!root || BANNERS.length < 2) return;
    let i = 0;
    const show = n => {
      i = (n + BANNERS.length) % BANNERS.length;
      root.querySelectorAll('.bs-slide').forEach((s, k) => { s.classList.toggle('on', k === i); s.setAttribute('aria-hidden', k !== i); });
      root.querySelectorAll('[data-bsgo]').forEach((d, k) => d.setAttribute('aria-current', k === i));
    };
    const start = () => { clearInterval(bsTimer); if (!calm.matches) bsTimer = setInterval(() => { if (!document.hidden && document.body.contains(root)) show(i + 1); else if (!document.body.contains(root)) clearInterval(bsTimer); }, 6000); };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-bs]'), g = e.target.closest('[data-bsgo]');
      if (b) { show(i + Number(b.dataset.bs)); start(); }
      if (g) { show(Number(g.dataset.bsgo)); start(); }
    });
    root.addEventListener('mouseenter', () => clearInterval(bsTimer));
    root.addEventListener('mouseleave', start);
    let x0 = null;
    root.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { show(i + (dx < 0 ? 1 : -1)); start(); } x0 = null; });
    start();
  }

  // ---------- সম্প্রতি দেখা পণ্য ----------
  function recentBlock(except) {
    const list = recent.filter(id => id !== except).map(byId).filter(Boolean).slice(0, 4);
    return list.length ? `<section class="wrap block"><h2 class="block-title">${t('recent')}</h2><div class="grid">${list.map(card).join('')}</div></section>` : '';
  }

  // ---------- উইশলিস্ট ----------
  function renderWishCount() { $('#wishCount').textContent = wish.length; $('#wishCount').hidden = !wish.length; }
  function toggleWish(id) {
    wish = wish.includes(id) ? wish.filter(x => x !== id) : [id].concat(wish);
    store.set(WISH_KEY, JSON.stringify(wish));
    const on = wish.includes(id);
    document.querySelectorAll(`[data-wish="${CSS.escape(id)}"]`).forEach(b => { b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? t('wishRemove') : t('wishAdd')); });
    renderWishCount();
    if (on) { toast(t('wishSaved')); const p = byId(id); if (p) px('AddToWishlist', { content_ids: [id], value: p.price, currency: 'BDT' }); }
    if (location.hash.startsWith('#/wishlist')) route();
  }
  function pageWishlist() {
    const list = wish.map(byId).filter(Boolean);
    return `<div class="wrap page"><nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${t('wishlist')}</span></nav>
      <div class="cat-head"><h1>${t('wishlist')}</h1>${list.length ? `<span class="muted">${list.length} ${t('items')}</span>` : ''}</div>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty-state"><p class="muted">${t('wishEmpty')}</p><a class="btn btn-dark" href="#/c/all">${t('continueShopping')}</a></div>`}</div>`;
  }

  // ---------- স্টকে ফিরলে জানানো ----------
  function notifyForm(p, s) {
    const box = $('#notifyBox');
    box.innerHTML = `<form class="notify" id="notifyForm" novalidate><p><strong>${t('notifyTitle', esc(s.label))}</strong><br><span class="muted small">${t('notifyText')}</span></p>
      <div class="coupon-row"><input name="phone" type="tel" inputmode="numeric" placeholder="01XXXXXXXXX" autocomplete="tel" aria-label="${t('phone')}"><button class="btn btn-dark" type="submit">${t('notifyBtn')}</button></div>
      <p class="error" hidden></p></form>`;
    const f = $('#notifyForm'); f.phone.focus();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const err = f.querySelector('.error'); err.hidden = true;
      try {
        const r = await fetch('/api/stock-alert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: p.id, sizeId: s.id, phone: f.phone.value, lang }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.message);
        box.innerHTML = `<p class="notify-done">${t('notifyDone')}</p>`;
      } catch (x) { err.textContent = x.message && lang === 'en' ? x.message : t('errPhone'); err.hidden = false; }
    });
  }

  // ---------- সার্চ ----------
  const norm = s => String(s || '').toLowerCase();
  function searchProducts(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return PRODUCTS.map(p => {
      const hay = norm([p.id, p.name.en, p.name.bn, p.color.en, p.color.bn, p.fabric.en, p.fabric.bn, p.desc.en, p.desc.bn, (catOf(p.cat) || { name: {} }).name.en, (catOf(p.cat) || { name: {} }).name.bn].join(' '));
      const name = norm(p.name.en + ' ' + p.name.bn);
      const score = words.reduce((s, w) => s + (hay.includes(w) ? (name.includes(w) ? 3 : 1) : -100), 0);
      return { p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.p).slice(0, 12);
  }
  function drawSearch() {
    const q = $('#searchInput').value.trim(), out = $('#searchResults');
    if (!q) { out.innerHTML = `<p class="muted search-hint">${t('searchHint')}</p>`; return; }
    const list = searchProducts(q);
    out.innerHTML = list.length ? list.map(p => `<a class="sr" href="#/p/${p.id}" data-close><span class="sr-media">${media(p, 0)}</span>
      <span class="sr-txt"><strong>${esc(L(p.name))}</strong><small class="muted">${esc(L(p.color))} · ${p.id}</small></span><span class="sr-price">${money(p.price)}</span></a>`).join('')
      : `<p class="muted search-hint">${t('searchNone', esc(q))}</p>`;
  }
  let sTimer;
  $('#searchOpen').addEventListener('click', () => { $('#searchInput').placeholder = t('searchPh'); drawSearch(); $('#searchDialog').showModal(); $('#searchInput').focus(); });
  $('#searchInput').addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => { drawSearch(); if ($('#searchInput').value.trim().length > 2) px('Search', { search_string: $('#searchInput').value.trim() }); }, 150); });
  $('#searchInput').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); $('#searchDialog').close(); } if (e.key === 'Enter') { const a = $('#searchResults .sr'); if (a) { location.hash = a.getAttribute('href'); $('#searchDialog').close(); } } });

  // ---------- অ্যাকাউন্ট (SMS কোড দিয়ে লগইন) ----------
  let acct = null, acctPhone = '';
  async function loadAccount() {
    try { const r = await fetch('/api/account'); acct = r.ok ? await r.json() : null; } catch (e) { acct = null; }
    return acct;
  }
  function pageAccount() {
    const head = `<nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${t('account')}</span></nav>`;
    if (!FEATURES.otp && !acct) return `<div class="wrap page info">${head}<h1>${t('account')}</h1><p class="muted">${t('loginOff')}</p><p><a class="btn btn-dark" href="#/track">${t('trackNav')}</a></p></div>`;
    if (!acct) return `<div class="wrap page info">${head}<h1>${t('login')}</h1>
      <form class="login-box" id="otpForm" novalidate><p class="muted">${t('loginIntro')}</p>
        <div id="otpStep1" ${acctPhone ? 'hidden' : ''}><label class="field"><span>${t('phone')}</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
          <button class="btn btn-dark btn-block" type="submit" data-step="1">${t('sendCode')}</button></div>
        <div id="otpStep2" ${acctPhone ? '' : 'hidden'}><p class="small" id="otpSent">${acctPhone ? t('codeSent', esc(acctPhone)) : ''}</p>
          <label class="field"><span>${t('codeLabel')}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="otp-in"></label>
          <button class="btn btn-dark btn-block" type="submit" data-step="2">${t('verify')}</button>
          <button class="text-btn" type="button" id="otpBack">${t('changeNumber')}</button></div>
        <p class="error" id="otpErr" hidden></p></form></div>`;
    const S = STR[lang].statuses, pr = acct.profile || {};
    return `<div class="wrap page account">${head}
      <div class="cat-head"><div><h1>${t('account')}</h1><p class="muted">${esc(acct.phone)}</p></div><button class="btn btn-outline" id="logoutBtn">${t('logout')}</button></div>
      <div class="acct-grid">
        <section><h2 class="block-title">${t('myOrders')}</h2>
          ${acct.orders.length ? acct.orders.map(o => `<article class="acct-order">
            <div class="ao-top"><strong>${esc(o.orderNo)}</strong><span class="ao-st st-${o.status}">${S[o.status] || o.status}</span></div>
            <p class="muted small">${new Date(o.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${money(o.total)}${o.paid ? ' · ' + t('paid') : ''}</p>
            <ul>${o.items.map(l => `<li>${esc(l.custom ? t('customItem') : l.name)}, ${esc(l.color)}, ${esc(l.custom && l.size === 'Made to measure' ? t('madeToMeasure') : l.size)} × ${l.qty}</li>`).join('')}</ul>
            <div class="ao-actions">${o.tracking ? `<a class="link" href="https://steadfast.com.bd/t/${encodeURIComponent(o.tracking)}" target="_blank" rel="noopener">Steadfast ${esc(o.tracking)}</a>` : ''}
              ${o.payment === 'bkash_online' && !o.paid && o.status !== 'cancelled' ? `<button class="btn btn-dark" data-pay="${esc(o.orderNo)}">${t('payNow')}</button>` : ''}
              ${o.items.some(l => !l.custom && byId(l.code)) ? `<button class="btn btn-outline" data-reorder="${esc(o.orderNo)}">${t('reorder')}</button>` : ''}</div>
          </article>`).join('') : `<p class="muted">${t('noOrders')}</p>`}
        </section>
        <section><h2 class="block-title">${t('myDetails')}</h2>
          <form id="profileForm" class="profile-form">
            <label class="field"><span>${t('name')}</span><input name="name" value="${esc(pr.name || '')}" autocomplete="name"></label>
            <label class="field"><span>${t('address')}</span><textarea name="address" placeholder="${t('addressPh')}">${esc(pr.address || '')}</textarea></label>
            <fieldset class="options"><legend>${t('area')}</legend>
              <label class="opt"><input type="radio" name="area" value="inside" ${pr.area !== 'outside' ? 'checked' : ''}><span>${t('inside')}</span></label>
              <label class="opt"><input type="radio" name="area" value="outside" ${pr.area === 'outside' ? 'checked' : ''}><span>${t('outside')}</span></label></fieldset>
            <button class="btn btn-dark" type="submit">${t('saveDetails')}</button>
          </form>
        </section>
      </div></div>`;
  }
  function bindAccount() {
    const otp = $('#otpForm');
    if (otp) {
      const err = m => { $('#otpErr').textContent = m; $('#otpErr').hidden = !m; };
      $('#otpBack').addEventListener('click', () => { acctPhone = ''; route(); });
      otp.addEventListener('submit', async e => {
        e.preventDefault();
        const step = acctPhone ? 2 : 1, btn = otp.querySelector(`[data-step="${step}"]`); btn.disabled = true; err('');
        try {
          if (step === 1) {
            const phone = otp.phone.value.replace(/\D/g, '').slice(-11);
            const r = await fetch('/api/account/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, lang }) });
            const d = await r.json(); if (!r.ok) throw new Error(d.message);
            acctPhone = phone; route(); $('#otpForm').code.focus(); return;
          }
          const r = await fetch('/api/account/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: acctPhone, code: otp.code.value }) });
          const d = await r.json(); if (!r.ok) throw new Error(d.message);
          acctPhone = ''; await loadAccount(); route();
        } catch (x) { err(x.message && lang === 'en' ? x.message : t('errServer')); btn.disabled = false; }
      });
      return;
    }
    const lo = $('#logoutBtn');
    if (!lo) return;
    lo.addEventListener('click', async () => { await fetch('/api/account/logout', { method: 'POST' }); acct = null; route(); });
    $('#profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, body = { name: f.name.value, address: f.address.value, area: f.area.value };
      try { const r = await fetch('/api/account', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(); acct.profile = { ...acct.profile, ...body }; toast(t('detailsSaved')); } catch (x) { toast(t('errServer')); }
    });
    $('.account').addEventListener('click', e => {
      const ro = e.target.closest('[data-reorder]'), pay = e.target.closest('[data-pay]');
      if (pay) startBkash(pay.dataset.pay, acct.phone, pay);
      if (ro) {
        const o = acct.orders.find(x => x.orderNo === ro.dataset.reorder);
        let added = 0;
        o.items.forEach(l => { const p = byId(l.code); const s = p && p.sizes.find(z => z.label === l.size && z.stock > 0); if (s) { addToCart(s.id, l.qty); added++; } });
        if (added) { renderCart(); $('#cartDialog').showModal(); } else toast(t('soldOut'));
      }
    });
  }

  // ---------- bKash অনলাইন পেমেন্ট ----------
  async function startBkash(orderNo, phone, btn) {
    if (btn) { btn.disabled = true; btn.textContent = t('payGoing'); }
    try {
      const r = await fetch('/api/pay/bkash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderNo, phone }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.message);
      store.set('alhadaf_pay', JSON.stringify({ orderNo, phone }));
      location.href = d.url;
    } catch (x) { toast(x.message || t('errServer')); if (btn) { btn.disabled = false; btn.textContent = t('payRetry'); } }
  }
  function pagePay(no, result) {
    const msg = { success: t('paySuccess'), cancelled: t('payCancelled') }[result] || t('payFailed');
    let saved = null; try { saved = JSON.parse(store.get('alhadaf_pay') || 'null'); } catch (e) { /* none */ }
    const canRetry = result !== 'success' && saved && saved.orderNo === no;
    return `<div class="wrap page info pay-result ${result === 'success' ? 'ok' : 'bad'}">
      <div class="pay-icon" aria-hidden="true">${result === 'success' ? '✓' : '!'}</div>
      <h1>${result === 'success' ? t('thanks') : t('payNow')}</h1>
      ${no ? `<p>${t('orderNo')} <strong>${esc(no)}</strong></p>` : ''}<p class="muted">${msg}</p>
      <p class="pay-actions">${canRetry ? `<button class="btn btn-dark" id="payRetry">${t('payRetry')}</button>` : ''}<a class="btn btn-outline" href="#/track">${t('trackNav')}</a></p></div>`;
  }

  // ---------- অসম্পূর্ণ অর্ডার: চেকআউটে নম্বর দিয়ে চলে গেলে অ্যাডমিনে দেখা যায় ----------
  let abTimer;
  function captureAbandoned(form) {
    clearTimeout(abTimer);
    abTimer = setTimeout(() => {
      const phone = form.elements.custPhone.value.replace(/\D/g, '').slice(-11);
      if (!/^01[3-9]\d{8}$/.test(phone) || !cart.length) return;
      const items = cart.map(i => { const ln = lineOf(i); return { name: ln.name + (ln.sub[0] ? ', ' + ln.sub[0] : ''), size: (i.custom ? (i.custom.size || t('madeToMeasure')) : findSize(i.sizeId).s.label), qty: i.qty, price: ln.price }; });
      fetch('/api/abandoned', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ phone, name: form.elements.custName.value, address: form.elements.custAddress.value, area: form.elements.area.value, items, lang }) }).catch(() => {});
    }, 1200);
  }

  // ---------- router ----------
  function route() {
    if (!loaded) { $('#view').innerHTML = `<div class="wrap page"><p class="muted">${t('loading')}</p></div>`; return; }
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    const view = $('#view');
    let active = '';
    if (!parts[0]) { view.innerHTML = pageHome(); bindSlider(); }
    else if (parts[0] === 'c') { active = parts[1]; view.innerHTML = pageCategory(parts[1]); bindCategory(); }
    else if (parts[0] === 'p') { const p = byId(parts[1]); active = p ? p.cat : ''; view.innerHTML = pageProduct(parts[1]); bindProduct(p); }
    else if (parts[0] === 'page') view.innerHTML = pageInfo(parts[1]);
    else if (parts[0] === 'custom') { active = 'custom'; view.innerHTML = pageCustom(); bindCustom(); }
    else if (parts[0] === 'gallery') { active = 'gallery'; view.innerHTML = pageGallery(); bindGallery(); }
    else if (parts[0] === 'track') { view.innerHTML = pageTrack(); bindTrack(); }
    else if (parts[0] === 'wishlist') view.innerHTML = pageWishlist();
    else if (parts[0] === 'account') { view.innerHTML = pageAccount(); bindAccount(); }
    else if (parts[0] === 'pay') {
      const no = decodeURIComponent(parts[1] || ''), result = parts[2] || 'failed';
      view.innerHTML = pagePay(no, result);
      const rb = $('#payRetry'); if (rb) rb.addEventListener('click', () => { const sv = JSON.parse(store.get('alhadaf_pay') || '{}'); startBkash(no, sv.phone, rb); });
      if (result === 'success') store.set('alhadaf_pay', '');
    }
    else view.innerHTML = pageNotFound();
    renderNav(active);
    const titleEl = view.querySelector('h1');
    document.title = (parts[0] && titleEl ? titleEl.textContent + ' | ' : '') + 'Al Hadaf';
    view.classList.remove('view-in'); void view.offsetWidth; view.classList.add('view-in');
    reveal(view);
    px('PageView');
  }

  // ---------- স্ক্রল করলে কার্ড আর সেকশন আস্তে আস্তে ভেসে ওঠে ----------
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: .08 }) : null;
  function reveal(root) {
    const groups = ['.grid', '.tiles', '.trust', '.rv-list'];
    groups.forEach(sel => root.querySelectorAll(sel).forEach(g => [...g.children].forEach((c, i) => { c.setAttribute('data-reveal', ''); c.style.setProperty('--d', (i % 4) * 80 + 'ms'); })));
    root.querySelectorAll('.promo, .custom-promo, .block-title').forEach(el => el.setAttribute('data-reveal', ''));
    root.querySelectorAll('[data-reveal]:not(.in)').forEach(el => (io && !calm.matches ? io.observe(el) : el.classList.add('in')));
  }

  function bindGallery() {
    const f = $('.gal-filter'); if (!f) return;
    f.addEventListener('click', e => {
      const b = e.target.closest('[data-gcat]'); if (!b) return;
      galCat = b.dataset.gcat;
      const y = window.scrollY; route(); window.scrollTo(0, y);
    });
  }
  window.addEventListener('hashchange', () => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); route(); window.scrollTo(0, 0); });

  function bindCategory() {
    const sel = $('#sortSel');
    if (!sel) return;
    sel.value = sortBy;
    sel.addEventListener('change', () => { sortBy = sel.value; route(); });
  }

  function bindProduct(p) {
    if (!p) return;
    recent = [p.id].concat(recent.filter(x => x !== p.id)).slice(0, 12); store.set(RECENT_KEY, JSON.stringify(recent));
    px('ViewContent', { content_ids: [p.id], content_type: 'product', content_name: L(p.name), value: p.price, currency: 'BDT' });
    const rvOpen = $('#rvOpen'), rvForm = $('#rvForm');
    rvOpen.addEventListener('click', () => { rvForm.hidden = false; rvOpen.hidden = true; rvForm.querySelector('input').focus(); });
    rvForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = rvForm, rating = f.rating.value, name = f.name.value.trim();
      if (!rating || name.length < 2) { $('#rvErr').textContent = t('reviewErr'); $('#rvErr').hidden = false; return; }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const r = await fetch('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: p.id, rating: Number(rating), name, phone: f.phone.value, body: f.body.value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message);
        f.outerHTML = `<p class="rv-thanks">${t('reviewThanks')}</p>`;
      } catch (x) { $('#rvErr').textContent = x.message && lang === 'en' ? x.message : t('chatErr'); $('#rvErr').hidden = false; btn.disabled = false; }
    });
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
        $('#galleryMain').dataset.idx = th.dataset.view;
        root.querySelectorAll('.thumb').forEach(b => b.setAttribute('aria-pressed', b === th));
        return;
      }
      if (e.target.closest('#galleryMain.zoomable')) {
        openLightbox(p.images.map(src => ({ src, caption: L(p.name) })), Number($('#galleryMain').dataset.idx) || 0);
        return;
      }
      const sc = e.target.closest('[data-scroll]');
      if (sc) { document.getElementById(sc.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); return; }
      const sb = e.target.closest('.size');
      if (sb && sb.classList.contains('out')) { notifyForm(p, p.sizes.find(x => x.id === Number(sb.dataset.size))); return; }
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
        px('AddToCart', { content_ids: [p.id], content_type: 'product', value: p.price * qty, currency: 'BDT' });
        if (buy) openCheckout(); else toast(t('added', L(p.name)));
      }
    });
  }

  // ---------- chrome: nav, menu, footer ----------
  const extraLinks = () => [CUSTOM ? ['custom', t('customNav')] : null, allGallery().length ? ['gallery', t('galleryNav')] : null].filter(Boolean);
  function renderNav(active) {
    $('#catNav').innerHTML = `<div class="wrap cat-nav-row">${CATEGORIES.map(c =>
      `<a href="#/c/${c.id}" ${c.id === active ? 'aria-current="page"' : ''}>${esc(L(c.name))}</a>`).join('')}${extraLinks().map(([k, l], i) =>
      `<a href="#/${k}" class="${i === 0 ? 'nav-gap' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</div>`;
  }

  // ---------- social links with icons ----------
  const ICON = {
    facebook: '<path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4a21 21 0 0 0-2.3-.1c-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21h2.9Z"/>',
    instagram: '<path d="M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm4.9-8.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM21 8.3c-.1-1.5-.4-2.8-1.5-3.8S17.2 3.1 15.7 3c-1.5-.1-6-.1-7.4 0-1.5.1-2.8.4-3.8 1.5S3.1 6.8 3 8.3c-.1 1.5-.1 6 0 7.4.1 1.5.4 2.8 1.5 3.8s2.3 1.4 3.8 1.5c1.5.1 6 .1 7.4 0 1.5-.1 2.8-.4 3.8-1.5s1.4-2.3 1.5-3.8c.1-1.4.1-5.9 0-7.4Zm-2 9.3c-.3.8-1 1.4-1.7 1.7-1.2.5-4 .4-5.3.4s-4.1.1-5.3-.4c-.8-.3-1.4-1-1.7-1.7-.5-1.2-.4-4-.4-5.3s-.1-4.1.4-5.3c.3-.8 1-1.4 1.7-1.7 1.2-.5 4-.4 5.3-.4s4.1-.1 5.3.4c.8.3 1.4 1 1.7 1.7.5 1.2.4 4 .4 5.3s.1 4.1-.4 5.3Z"/>',
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z"/>',
    messenger: '<path d="M12 2.5C6.7 2.5 2.5 6.4 2.5 11.4c0 2.8 1.4 5.3 3.6 7v3.1l3.3-1.8c.8.2 1.7.3 2.6.3 5.3 0 9.5-3.9 9.5-8.9S17.3 2.5 12 2.5Zm1 11.9-2.4-2.6-4.7 2.6 5.2-5.5 2.5 2.6 4.6-2.6-5.2 5.5Z"/>',
    youtube: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z"/>',
    tiktok: '<path d="M16.6 3h-3v12.2a2.7 2.7 0 1 1-2.7-2.7c.3 0 .5 0 .8.1V9.5a5.8 5.8 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.4 1.4V7.5a4.4 4.4 0 0 1-4.4-4.5Z"/>',
    email: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Zm2 .9v9.6h14V7.4l-7 5.1-7-5.1Zm1.7-.4L12 10.9 17.3 7H6.7Z"/>',
    phone: '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/>',
    chat: '<path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.6 1.3 4.9 3.4 6.5L4.6 21.5l3.9-2c1.1.3 2.3.5 3.5.5 5.5 0 10-3.9 10-8.7S17.5 3 12 3Z"/>',
    map: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/>'
  };
  const icon = (k, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[k]}</svg>`;
  const socials = () => [
    SHOP.facebook && ['facebook', SHOP.facebook, 'Facebook'],
    SHOP.messenger && ['messenger', SHOP.messenger, 'Messenger'],
    SHOP.whatsapp && ['whatsapp', waLink(), 'WhatsApp'],
    SHOP.instagram && ['instagram', SHOP.instagram, 'Instagram'],
    SHOP.youtube && ['youtube', SHOP.youtube, 'YouTube'],
    SHOP.tiktok && ['tiktok', SHOP.tiktok, 'TikTok'],
    SHOP.email && ['email', 'mailto:' + SHOP.email, SHOP.email]
  ].filter(Boolean);
  const socialRow = cls => `<div class="socials ${cls || ''}">${socials().map(([k, href, label]) =>
    `<a class="soc soc-${k}" href="${esc(href)}" ${k === 'email' ? '' : 'target="_blank" rel="noopener"'} aria-label="${esc(label)}" title="${esc(label)}">${icon(k)}</a>`).join('')}</div>`;
  function renderMenu() {
    $('#menuBody').innerHTML = `
      <div class="side-head"><span>${t('menu')}</span><button class="icon-btn" data-close aria-label="${t('close')}">×</button></div>
      <nav class="menu-list">${CATEGORIES.map(c => `<a href="#/c/${c.id}" data-close>${esc(L(c.name))}</a>`).join('')}${extraLinks().map(([k, l]) => `<a href="#/${k}" data-close>${esc(l)}</a>`).join('')}</nav>
      <nav class="menu-list small">${FEATURES.otp ? `<a href="#/account" data-close>${t('account')}</a>` : ''}<a href="#/wishlist" data-close>${t('wishlist')}</a><a href="#/track" data-close>${t('trackNav')}</a>${['size-guide', 'exchange', 'contact'].map(s => `<a href="#/page/${s}" data-close>${STR[lang].pages[s]}</a>`).join('')}</nav>
      ${socialRow('menu-socials')}
      <button class="lang-btn menu-lang" data-lang>${t('langSwitch')}</button>`;
  }
  function renderFooter() {
    const P = STR[lang].pages, link = s => `<li><a href="#/page/${s}">${P[s]}</a></li>`;
    $('#footer').innerHTML = `<div class="wrap foot-grid">
      <div class="foot-brand">
        <img src="/logo-dark.png" alt="Al Hadaf" width="661" height="357">
        <p>${esc(L(SHOP.address))}</p>
        ${socials().length ? `<p class="foot-follow">${t('followUs')}</p>${socialRow('foot-socials')}` : ''}
      </div>
      <div><h3>${t('legal')}</h3><ul>${link('shipping')}${link('exchange')}${link('privacy')}</ul></div>
      <div><h3>${t('information')}</h3><ul>${link('size-guide')}${link('about')}${allGallery().length ? `<li><a href="#/gallery">${t('galleryNav')}</a></li>` : ''}${link('contact')}</ul></div>
      <div><h3>${t('service')}</h3><ul class="foot-contact">
        <li><a href="tel:${esc(SHOP.phone)}">${icon('phone', 16)}${esc(SHOP.phone)}</a></li>
        ${SHOP.whatsapp ? `<li><a href="${waLink()}" target="_blank" rel="noopener">${icon('whatsapp', 16)}WhatsApp</a></li>` : ''}
        ${SHOP.email ? `<li><a href="mailto:${esc(SHOP.email)}">${icon('email', 16)}${esc(SHOP.email)}</a></li>` : ''}
        <li><a href="#/track">${t('trackNav')}</a></li>
        ${CUSTOM ? `<li><a href="#/custom">${t('customNav')}</a></li>` : ''}</ul></div>
    </div>
    <div class="wrap foot-bottom">
      <div class="pay"><span>${t('payBy')}</span><span class="pay-chip">bKash</span><span class="pay-chip">Nagad</span><span class="pay-chip">${t('cod')}</span></div>
      <p>© ${new Date().getFullYear()} Al Hadaf. ${t('rights')}</p>
    </div>`;
  }

  // ---------- cart ----------
  function addCustom(c, qty) {
    cart.push({ custom: JSON.parse(JSON.stringify(c)), qty: Math.min(5, qty) });
    saveCart(); renderCartCount();
  }
  function addToCart(sizeId, qty) {
    const max = findSize(sizeId).s.stock;
    const f = cart.find(i => !i.custom && i.sizeId === sizeId);
    if (f) f.qty = Math.min(max, 10, f.qty + qty); else cart.push({ sizeId, qty: Math.min(max, qty) });
    saveCart(); renderCartCount();
  }
  let coupon = null; // { code, kind, value, min }
  const totals = area => {
    const sub = cart.reduce((s, i) => s + lineOf(i).price * i.qty, 0);
    const del = cart.length ? (area === 'outside' ? SHOP.deliveryOutside : SHOP.deliveryInside) : 0;
    const qty = cart.reduce((s, i) => s + i.qty, 0);
    const bundle = SHOP.bundleMin >= 2 && SHOP.bundlePct && qty >= SHOP.bundleMin ? Math.round(sub * SHOP.bundlePct / 100) : 0;
    const base = sub - bundle;
    let off = 0;
    if (coupon && base >= coupon.min) off = coupon.kind === 'percent' ? Math.round(base * Math.min(90, coupon.value) / 100) : coupon.kind === 'fixed' ? Math.min(base, coupon.value) : del;
    return { sub, del, off, bundle, qty, total: Math.max(0, sub + del - off - bundle) };
  };
  let lastCount = null;
  function renderCartCount() {
    const n = cart.reduce((s, i) => s + i.qty, 0);
    if (lastCount != null && n > lastCount) { const b = $('#cartOpen'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    lastCount = n;
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
      const ln = lineOf(i);
      return `<div class="ci">
        <a class="ci-media" href="${ln.href}" data-close>${ln.media}</a>
        <div class="ci-info">
          <h4>${esc(ln.name)}</h4>
          ${ln.sub.map(x => `<p>${x.startsWith('<') ? x : esc(x)}</p>`).join('')}
          <div class="ci-row">
            <div class="qty sm"><button data-ci="${idx}" data-d="-1" aria-label="−">−</button><span>${i.qty}</span><button data-ci="${idx}" data-d="1" aria-label="+">+</button></div>
            <strong>${money(ln.price * i.qty)}</strong>
          </div>
          <button class="text-btn" data-remove="${idx}">${t('remove')}</button>
        </div></div>`;
    }).join('')}</div>
    <div class="cart-foot">
      <p class="row"><span>${t('subtotal')}</span><strong>${money(totals().sub)}</strong></p>
      ${totals().bundle ? `<p class="row disc"><span>${t('bundleOff', SHOP.bundlePct)}</span><span>−${money(totals().bundle)}</span></p>`
        : SHOP.bundleMin >= 2 && SHOP.bundlePct ? `<p class="bundle-note sm">${t('bundleMore', SHOP.bundleMin - totals().qty, SHOP.bundlePct)}</p>` : ''}
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
      if (i.qty < 1) cart.splice(Number(b.dataset.ci), 1); else i.qty = Math.min(lineOf(i).max, i.qty);
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
          ${FEATURES.bkashPay ? `<label class="opt"><input type="radio" name="payment" value="bkash_online"><span>${t('payOnline')}<small>${t('payOnlineNote')}</small></span></label>` : ''}
          <label class="opt"><input type="radio" name="payment" value="bkash"><span>${t('bkash')}<small>${t('bkashNote')}</small></span></label>
        </fieldset>
        <div class="bkash-box" id="bkashBox" hidden><p id="bkashText"></p>
          <label class="field"><span>${t('trx')}</span><input name="trx" autocomplete="off"></label></div>
        <label class="field"><span>${t('note')}</span><textarea name="note" placeholder="${t('notePh')}"></textarea></label>
        <div class="coupon-box">
          <label class="field"><span>${t('coupon')}</span>
          <span class="coupon-row"><input name="coupon" placeholder="${t('couponPh')}" autocomplete="off" value="${coupon ? esc(coupon.code) : ''}" ${coupon ? 'readonly' : ''}><button type="button" class="btn btn-outline" id="couponBtn">${coupon ? t('couponRemove') : t('couponApply')}</button></span></label>
          <p class="small" id="couponMsg" ${coupon ? '' : 'hidden'}>${coupon ? t('couponOk', esc(coupon.code)) : ''}</p>
        </div>
        <div class="summary" id="coSummary"></div>
        <p class="error" id="coErr" hidden></p>
        <button class="btn btn-dark btn-block" type="submit">${t('confirm')}</button>
      </form>`;
    const form = $('#coForm');
    const update = () => {
      const tt = totals(form.elements.area.value);
      $('#coSummary').innerHTML = `<p class="row"><span>${t('subtotal')}</span><span>${money(tt.sub)}</span></p>
        <p class="row"><span>${t('deliveryCharge')}</span><span>${money(tt.del)}</span></p>
        ${tt.bundle ? `<p class="row disc"><span>${t('bundleOff', SHOP.bundlePct)}</span><span>−${money(tt.bundle)}</span></p>` : ''}
        ${tt.off ? `<p class="row disc"><span>${coupon.kind === 'free_ship' ? t('freeShip') : t('discount')} (${esc(coupon.code)})</span><span>−${money(tt.off)}</span></p>` : ''}
        <p class="row total"><span>${t('total')}</span><span>${money(tt.total)}</span></p>`;
      const bk = form.elements.payment.value === 'bkash';
      $('#bkashBox').hidden = !bk;
      $('#bkashText').innerHTML = t('sendTo', money(tt.total), SHOP.bkash);
    };
    form.addEventListener('change', update);
    form.addEventListener('submit', e => { e.preventDefault(); submitOrder(form); });
    form.addEventListener('input', e => { if (['custPhone', 'custName', 'custAddress'].includes(e.target.name)) captureAbandoned(form); });
    if (acct) {
      const pr = acct.profile || {};
      form.elements.custPhone.value = acct.phone;
      if (pr.name) form.elements.custName.value = pr.name;
      if (pr.address) form.elements.custAddress.value = pr.address;
      if (pr.area === 'outside') form.elements.area.value = 'outside';
    }
    const cMsg = (m, bad) => { const el = $('#couponMsg'); el.innerHTML = m; el.hidden = !m; el.className = 'small ' + (bad ? 'error' : 'ok'); };
    $('#couponBtn').addEventListener('click', async () => {
      const inp = form.elements.coupon, btn = $('#couponBtn');
      if (coupon) { coupon = null; inp.readOnly = false; inp.value = ''; btn.textContent = t('couponApply'); cMsg(''); update(); return; }
      const code = inp.value.trim(); if (!code) return;
      btn.disabled = true;
      try {
        const r = await fetch('/api/coupon?' + new URLSearchParams({ code, subtotal: totals().sub }));
        const d = await r.json();
        if (!r.ok) throw new Error(d.message);
        coupon = { code: d.code, kind: d.kind, value: d.value, min: 0 };
        inp.value = d.code; inp.readOnly = true; btn.textContent = t('couponRemove'); cMsg(t('couponOk', esc(d.code)));
      } catch (x) { cMsg(esc(x.message || t('errServer')), true); }
      btn.disabled = false; update();
    });
    update();
    px('InitiateCheckout', { value: totals().sub, currency: 'BDT', num_items: cart.reduce((s, i) => s + i.qty, 0) });
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
        body: JSON.stringify({ name, phone, address, area, payment: pay, trx, note, lang, coupon: coupon ? coupon.code : '', items: cart.map(i => i.custom ? { custom: i.custom, qty: i.qty } : { sizeId: i.sizeId, qty: i.qty }) })
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
      ...data.items.map(l => l.custom
        ? `- ${l.name}, ${l.color}, ${l.details.options.map(o => o.choice).join(', ')}, ${l.size}${l.details.meas ? ' (' + Object.entries(l.details.meas).filter(e => e[1]).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''} x${l.qty}`
        : `- ${l.name}, ${l.color} (${l.code}), ${l.size} x${l.qty}`),
      `${t('total')}: ${money(data.total)}`
    ].join('\n');
    $('#checkoutBody').innerHTML = `<button class="icon-btn dlg-x" data-close aria-label="${t('close')}">×</button>
      <div class="success"><h2>${t('thanks')}</h2><p>${t('orderNo')} <strong>${data.orderNo}</strong></p>
      <p class="row total"><span>${t('total')}</span><span>${money(data.total)}</span></p>
      ${data.discount ? `<p class="row disc"><span>${t('discount')}</span><span>−${money(data.discount)}</span></p>` : ''}
      ${data.bundleOff ? `<p class="row disc"><span>${t('bundleOff', SHOP.bundlePct)}</span><span>−${money(data.bundleOff)}</span></p>` : ''}
      <p class="muted">${t('thanksText')}</p>
      <p class="muted small">${t('trackLater')}</p>
      ${SHOP.whatsapp ? `<a class="btn btn-outline btn-block" href="${waLink(msg)}" target="_blank" rel="noopener">${t('alsoWa')}</a>` : ''}</div>`;
    px('Purchase', { value: data.total, currency: 'BDT', content_ids: data.items.map(l => l.code), content_type: 'product' });
    cart = []; coupon = null; saveCart(); renderCartCount();
    if (data.payment === 'bkash_online') {
      $('#checkoutBody').querySelector('.success').insertAdjacentHTML('beforeend', `<button class="btn btn-dark btn-block" id="payBtn">${t('payNow')}</button>`);
      const pb = $('#payBtn'); pb.addEventListener('click', () => startBkash(data.orderNo, phone, pb));
      startBkash(data.orderNo, phone, pb);
      return;
    }
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
    $('#chatFab').setAttribute('aria-label', t('chatTitle'));
    $('#searchOpen').setAttribute('aria-label', t('search'));
    $('#wishLink').setAttribute('aria-label', t('wishlist'));
    $('#accountLink').setAttribute('aria-label', t('account'));
    $('#accountLink').hidden = !FEATURES.otp;
    renderWishCount();
    if (!$('#chatPanel').hidden) renderChat();
    renderFooter(); renderCartCount();
  }

  applyChrome();
  route();
  loadStore().then(async () => { applyChrome(); if (FEATURES.otp) await loadAccount(); route(); }).catch(() => {
    $('#view').innerHTML = `<div class="wrap page"><p class="muted">${t('errServer')}</p></div>`;
  });
})();
