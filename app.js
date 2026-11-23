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

  // আগে বেছে না থাকলে বাংলাদেশের সময় অঞ্চল বা বাংলা ব্রাউজার হলে বাংলায় খোলে
  const savedLang = store.get(LANG_KEY);
  let lang = savedLang === 'bn' || savedLang === 'en' ? savedLang
    : ((Intl.DateTimeFormat().resolvedOptions().timeZone || '') === 'Asia/Dhaka' || /^bn/i.test(navigator.language || '')) ? 'bn' : 'en';
  let SHOP = { whatsapp: '', phone: '', email: '', bkash: '', facebook: '', instagram: '', messenger: '', youtube: '', tiktok: '', address: { en: '', bn: '' }, deliveryInside: 0, deliveryOutside: 0, announce: { en: '', bn: '' } };
  let CUSTOM = null;
  let GALLERY = [];
  let GALLERY_OPTS = { products: true };
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
      bundleMin: Number(s.bundle_min) || 0, bundlePct: Number(s.bundle_pct) || 0, freeShipOver: Number(s.free_ship_over) || 0
    };
    CATEGORIES = [{ id: 'all', name: { en: 'All', bn: 'সব' } }, ...d.categories];
    PRODUCTS = d.products.map(p => ({ ...p, shape: PLACEHOLDER[p.cat] || 'thobe' }));
    CUSTOM = d.custom && d.custom.fabrics.length ? d.custom : null;
    GALLERY = d.gallery || [];
    GALLERY_OPTS = d.galleryOpts || { products: true };
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
        sub: [L(f.name) + (L(f.color) ? ', ' + L(f.color) : ''), CUSTOM.groups.map(g => optName(g, c)).join(', '), c.fit === 'standard' ? t('sizeIs', esc(c.size)) : t('madeToMeasure')]
      };
    }
    const { p, s } = findSize(i.sizeId);
    return { name: L(p.name), price: p.price, max: Math.min(10, s.stock), href: '#/p/' + p.id, media: media(p, 0, true), sub: [L(p.color), t('sizeIs', esc(s.label))] };
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
  // ছোট কপি (-sm.webp) আগে, না থাকলে মূল ছবি
  const sm = src => String(src).replace(/\.(webp|jpg|png)$/, '-sm.webp');
  const imgTag = (src, alt, small, eager) => small && /^\/img\//.test(src)
    ? `<img src="${esc(sm(src))}" data-full="${esc(src)}" onerror="this.onerror=null;this.src=this.dataset.full" alt="${esc(alt || '')}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`
    : `<img src="${esc(src)}" alt="${esc(alt || '')}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
  function media(p, v = 0, small) {
    const src = p.images && typeof v === 'number' ? p.images[v] : null;
    if (src) return imgTag(src, L(p.name), small);
    return `<div class="ph">${art(p, typeof v === 'string' ? v : 'front')}</div>`;
  }
  const priceHtml = p => p.compare
    ? `<span class="price-now">${money(p.price)}</span> <s>${money(p.compare)}</s>`
    : money(p.price);

  const wishBtn = (p, cls = '') => `<button class="wish ${cls}" data-wish="${esc(p.id)}" aria-pressed="${wish.includes(p.id)}" aria-label="${wish.includes(p.id) ? t('wishRemove') : t('wishAdd')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/></svg></button>`;
  // ---------- প্রোডাক্ট কার্ড: এক ডিজাইনের সব রং এক কার্ডে, দ্রুত কার্টে যোগ ----------
  const stockOf = p => p.sizes.reduce((n, z) => n + Math.max(0, z.stock), 0);
  const siblingsOf = p => { const g = PRODUCTS.filter(x => x.group === p.group); return g.length ? g : [p]; };
  const pctOff = p => p.compare && p.compare > p.price ? Math.round((1 - p.price / p.compare) * 100) : 0;
  const bagIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8M12 11.5v5M9.5 14h5" stroke-linecap="round"/></svg>';
  function card(p, open) {
    const sib = siblingsOf(p), out = stockOf(p) === 0, off = pctOff(p);
    const alt = p.images && p.images[1] ? `<div class="card-alt">${media(p, 1, true)}</div>` : '';
    return `<div class="card-wrap pc" data-card="${esc(p.id)}">
      <div class="pc-media">
        <a class="pc-img" href="#/p/${p.id}" tabindex="-1" aria-hidden="true">${media(p, 0, true)}${alt}</a>
        <div class="pc-badges">${off ? `<span class="b-sale">${t('sale')}</span>` : ''}${p.badge ? `<span class="badge">${esc(L(p.badge))}</span>` : ''}</div>
        ${wishBtn(p)}
        <div class="pc-bar">
          <button class="pc-bag" data-quick="${esc(p.id)}" aria-label="${t('quickAdd')}: ${esc(L(p.name))}" ${out ? 'disabled' : ''}>${bagIcon}</button>
          ${out ? `<span class="pc-out">${t('outOfStock')}</span>` : `<button class="pc-qa" data-quick="${esc(p.id)}" tabindex="-1">${t('quickAdd')}</button>`}
        </div>
      </div>
      <div class="pc-info">
        <div class="pc-title"><h3><a href="#/p/${p.id}">${esc(L(p.name))}</a></h3><span class="pc-code">${esc(p.id)}</span></div>
        ${sib.length > 1 ? `<button class="pc-colors" data-colors aria-expanded="${!!open}">${t('colorsN', sib.length)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
          <div class="pc-sw" ${open ? '' : 'hidden'}>${sib.map(x => `<button class="pc-dot" data-swap="${esc(x.id)}" style="--sw:${esc(x.color.hex)}" aria-label="${esc(L(x.color))}" title="${esc(L(x.color))}" aria-current="${x.id === p.id}"></button>`).join('')}<span class="pc-cname">${esc(L(p.color))}</span></div>`
          : `<p class="pc-sub">${esc(L(p.color))}</p>`}
        <p class="pc-price"><strong>${money(p.price)}</strong>${off ? ` <s>${money(p.compare)}</s> <em>${off}% ${t('off')}</em>` : ''}</p>
        ${p.rating ? `<p class="card-rating">${starsHtml(p.rating.avg, 'sm')}<span>(${p.rating.count})</span></p>` : ''}
      </div>
    </div>`;
  }
  // প্রতিটি ডিজাইনের একটাই কার্ড; স্টকে থাকা রংটা আগে দেখায়
  function byDesign(list) {
    const seen = new Map();
    list.forEach(p => {
      const cur = seen.get(p.group);
      if (!cur || (stockOf(cur) === 0 && stockOf(p) > 0)) seen.set(p.group, p);
    });
    return [...seen.values()];
  }

  // ---------- দ্রুত কার্টে যোগ (সাইজ বেছে) ----------
  function openQuick(id) {
    const p = byId(id); if (!p) return;
    const sib = siblingsOf(p);
    const inStock = p.sizes.filter(z => z.stock > 0);
    let chosen = inStock.length === 1 ? inStock[0].id : null, qty = 1;
    const draw = () => {
      $('#quickBody').innerHTML = `<button class="icon-btn dlg-x" data-close aria-label="${t('close')}">×</button>
        <div class="qk">
          <a class="qk-media" href="#/p/${p.id}" data-close>${media(p, 0)}</a>
          <div class="qk-info">
            <p class="pc-code">${esc(p.id)}</p>
            <h2>${esc(L(p.name))}</h2>
            <p class="pc-price"><strong>${money(p.price)}</strong>${pctOff(p) ? ` <s>${money(p.compare)}</s> <em>${pctOff(p)}% ${t('off')}</em>` : ''}</p>
            ${sib.length > 1 ? `<p class="opt-label">${t('color')}: <strong>${esc(L(p.color))}</strong></p><div class="swatches qk-sw">${sib.map(x => `<button class="swatch" data-qswap="${esc(x.id)}" style="--sw:${esc(x.color.hex)}" aria-label="${esc(L(x.color))}" aria-current="${x.id === p.id}"></button>`).join('')}</div>` : ''}
            <div class="opt-row"><p class="opt-label">${t('chooseSize')} <span class="fs-hint" data-fs-hint hidden></span></p>${p.shape === 'thobe' ? `<button class="link link-btn fs-btn" data-findsize>${t('findSize')}</button>` : ''}</div>
            <div class="sizes">${p.sizes.map(z => `<button class="size ${z.stock > 0 ? '' : 'out'}" data-qsize="${z.id}" aria-pressed="${chosen === z.id}" ${z.stock > 0 ? '' : `disabled title="${t('soldOut')}"`}>${esc(z.label)}</button>`).join('')}</div>
            <div class="buy-row"><div class="qty"><button data-qq="-1" aria-label="−">−</button><span>${qty}</span><button data-qq="1" aria-label="+">+</button></div>
              <button class="btn btn-dark" id="qkAdd">${t('addToCart')}</button></div>
            <p class="error" id="qkErr" hidden></p>
            <a class="link" href="#/p/${p.id}" data-close>${t('viewDetails')}</a>
          </div>
        </div>`;
    };
    draw(); markRecommended();
    const dlg = $('#quickDialog');
    dlg.onclick = e => {
      if (e.target === dlg) return dlg.close();
      const sw = e.target.closest('[data-qswap]'); if (sw) { openQuick(sw.dataset.qswap); return; }
      const sz = e.target.closest('[data-qsize]'); if (sz && !sz.disabled) { chosen = Number(sz.dataset.qsize); draw(); markRecommended(); return; }
      if (e.target.closest('[data-findsize]')) { dlg.close(); openSizeFinder(null); return; }
      const q = e.target.closest('[data-qq]'); if (q) { const max = chosen ? Math.min(10, p.sizes.find(z => z.id === chosen).stock) : 10; qty = Math.min(max, Math.max(1, qty + Number(q.dataset.qq))); draw(); return; }
      if (e.target.closest('#qkAdd')) {
        if (!chosen) { $('#qkErr').textContent = t('chooseSize'); $('#qkErr').hidden = false; return; }
        addToCart(chosen, qty);
        px('AddToCart', { content_ids: [p.id], content_type: 'product', value: p.price * qty, currency: 'BDT' });
        dlg.close(); toast(t('added', L(p.name)));
      }
    };
    if (!dlg.open) dlg.showModal();
  }

  // ---------- মেনুর ঠিক নিচে চলমান গ্যালারি (হোম পেজ) ----------
  function topGallery() {
    galCat = 'all';
    const list = allGallery();
    if (!list.length) return '';
    let fill = list; while (fill.length < 10) fill = fill.concat(list);
    const prices = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
    const item = (g, k, hidden) => {
      const pid = g.href ? g.href.split('/').pop() : '', p = prices[pid];
      const inner = `${imgTag(g.src, '', true, k < 6)}<span class="tg-cap"><b>${esc(p ? L(p.name) : g.caption)}</b>${p ? `<i>${money(p.price)}</i>` : ''}</span>`;
      const tab = hidden ? 'tabindex="-1"' : '';
      return g.href ? `<a class="tg-item" href="${g.href}" ${tab} aria-label="${esc(g.caption)}">${inner}</a>`
        : `<button class="tg-item" data-gal="${k % list.length}" ${tab} aria-label="${esc(g.caption || t('photo'))}">${inner}</button>`;
    };
    const track = hidden => `<div class="tg-track" ${hidden ? 'aria-hidden="true"' : ''}>${fill.map((g, k) => item(g, k, hidden || k >= list.length)).join('')}</div>`;
    return `<section class="topgal" aria-label="${t('galleryTitle')}" style="--dur:${Math.max(40, fill.length * 6)}s">
      <div class="tg-row">${track(false)}${track(true)}</div>
      <a class="tg-all" href="#/gallery">${t('galleryTitle')} →</a>
    </section>`;
  }

  // ---------- pages ----------
  function pageHome() {
    const tiles = CATEGORIES.filter(c => c.tile).map(c => {
      const p = PRODUCTS.find(x => x.cat === c.id);
      return `<a class="tile" href="#/c/${c.id}"><div class="tile-media">${p ? media(p, 0) : ''}</div><span>${esc(L(c.name))}</span></a>`;
    }).join('');
    const newOnes = PRODUCTS.filter(p => p.isNew);
    const fresh = byDesign(newOnes.length ? newOnes : PRODUCTS).slice(0, 4);
    const combo = PRODUCTS.find(p => p.cat === 'father-son');
    return `
    ${topGallery()}
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
      ${fresh.length ? `<div class="grid">${fresh.map(p => card(p)).join('')}</div>` : `<p class="muted">${t('emptyList')}</p>`}
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
    ${recentBlock()}
    <section class="wrap trust">${STR[lang].trust.map(([h, s]) => `<div><h3>${h}</h3><p>${s}</p></div>`).join('')}</section>`;
  }

  // ---------- ক্যাটাগরি পেজ: রং, সাইজ, দাম ফিল্টার আর সর্ট ----------
  let filt = { cat: null, colors: [], sizes: [], price: '', stock: false };
  const PRICE_STEPS = [2000, 3000, 5000];
  const priceBucket = v => v < PRICE_STEPS[0] ? 'a' : v < PRICE_STEPS[1] ? 'b' : v < PRICE_STEPS[2] ? 'c' : 'd';
  const bucketLabel = k => ({ a: t('priceUnder', PRICE_STEPS[0]), b: t('priceBetween', PRICE_STEPS[0], PRICE_STEPS[1]), c: t('priceBetween', PRICE_STEPS[1], PRICE_STEPS[2]), d: t('priceOver', PRICE_STEPS[2]) }[k]);
  const applyFilt = (base, f) => byDesign(base.filter(p => (!f.colors.length || f.colors.includes(p.color.en))
      && (!f.sizes.length || p.sizes.some(z => f.sizes.includes(z.label) && (!f.stock || z.stock > 0)))
      && (!f.price || priceBucket(p.price) === f.price)
      && (!f.stock || stockOf(p) > 0)));
  function pageCategory(id) {
    const c = catOf(id) || catOf('all');
    if (filt.cat !== c.id) filt = { cat: c.id, colors: [], sizes: [], price: '', stock: false };
    const base = PRODUCTS.filter(p => c.id === 'all' || p.cat === c.id);
    const colors = [...new Map(base.map(p => [p.color.en, p])).values()];
    const sizes = [...new Set(base.flatMap(p => p.sizes.map(z => z.label)))];
    const buckets = ['a', 'b', 'c', 'd'].filter(k => base.some(p => priceBucket(p.price) === k));
    let list = applyFilt(base, filt);
    if (sortBy === 'low') list.sort((a, b) => a.price - b.price);
    if (sortBy === 'high') list.sort((a, b) => b.price - a.price);
    if (sortBy === 'new') list.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    const n = filt.colors.length + filt.sizes.length + (filt.price ? 1 : 0) + (filt.stock ? 1 : 0);
    const chev = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const drop = (label, count, body, cls = '') => `<details class="fdrop ${cls}"><summary>${label}${count ? ` <b>${count}</b>` : ''}${chev}</summary><div class="fpanel">${body}</div></details>`;
    const sortLabels = { default: t('sortDefault'), new: t('sortNew'), low: t('sortLow'), high: t('sortHigh') };
    return `<div class="wrap page">
      <div class="cat-bar">
        <nav class="crumbs"><a href="#/">${t('home')}</a><span>/</span><span>${esc(L(c.name))}</span></nav>
        <div class="filters" id="filters">
          ${colors.length > 1 ? drop(t('fColor'), filt.colors.length, colors.map(p => `<label class="fopt"><input type="checkbox" data-f="colors" value="${esc(p.color.en)}" ${filt.colors.includes(p.color.en) ? 'checked' : ''}><i class="fsw" style="--sw:${esc(p.color.hex)}"></i>${esc(L(p.color))}</label>`).join('')) : ''}
          ${sizes.length > 1 ? drop(t('fSize'), filt.sizes.length, `<div class="fsizes">${sizes.map(z => `<label class="fchip"><input type="checkbox" data-f="sizes" value="${esc(z)}" ${filt.sizes.includes(z) ? 'checked' : ''}><span>${esc(z)}</span></label>`).join('')}</div>`) : ''}
          ${buckets.length > 1 ? drop(t('fPrice'), filt.price ? 1 : 0, buckets.map(k => `<label class="fopt"><input type="radio" name="fprice" data-f="price" value="${k}" ${filt.price === k ? 'checked' : ''}>${bucketLabel(k)}</label>`).join('')) : ''}
          <label class="fstock"><input type="checkbox" data-f="stock" ${filt.stock ? 'checked' : ''}> ${t('inStockOnly')}</label>
          ${drop(sortLabels[sortBy], 0, Object.entries(sortLabels).map(([k, l]) => `<label class="fopt"><input type="radio" name="fsort" data-f="sort" value="${k}" ${sortBy === k ? 'checked' : ''}>${l}</label>`).join(''), 'fsort')}
        </div>
      </div>
      <div class="mfbar">
        <button type="button" class="mf-btn" data-msheet="filter"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>${t('filter')}${n ? ` <b>${n}</b>` : ''}</button>
        <button type="button" class="mf-btn" data-msheet="sort"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>${esc(sortLabels[sortBy])}</button>
      </div>
      <div class="cat-head"><h1>${esc(L(c.name))}</h1><span class="muted">${list.length} ${t('items')}${n ? ` · <button class="text-btn" data-fclear>${t('fClear')}</button>` : ''}</span></div>
      <dialog class="msheet" id="filterSheet" aria-label="${t('filtersTitle')}"><form method="dialog" class="ms-body" id="msForm">
        <div class="ms-head"><span class="ms-grab" aria-hidden="true"></span><h2>${t('filtersTitle')}</h2><button type="button" class="icon-btn" data-mx aria-label="${t('close')}">×</button></div>
        <div class="ms-scroll">
          ${colors.length > 1 ? `<fieldset class="ms-sec"><legend>${t('fColor')}</legend><div class="ms-chips">${colors.map(p => `<label class="ms-chip"><input type="checkbox" data-mf="colors" value="${esc(p.color.en)}" ${filt.colors.includes(p.color.en) ? 'checked' : ''}><span><i style="--sw:${esc(p.color.hex)}"></i>${esc(L(p.color))}</span></label>`).join('')}</div></fieldset>` : ''}
          ${sizes.length > 1 ? `<fieldset class="ms-sec"><legend>${t('fSize')}</legend><div class="ms-chips">${sizes.map(z => `<label class="ms-chip"><input type="checkbox" data-mf="sizes" value="${esc(z)}" ${filt.sizes.includes(z) ? 'checked' : ''}><span>${esc(z)}</span></label>`).join('')}</div></fieldset>` : ''}
          ${buckets.length > 1 ? `<fieldset class="ms-sec"><legend>${t('fPrice')}</legend><div class="ms-chips">${buckets.map(k => `<label class="ms-chip"><input type="radio" name="mprice" data-mf="price" value="${k}" ${filt.price === k ? 'checked' : ''}><span>${bucketLabel(k)}</span></label>`).join('')}</div></fieldset>` : ''}
          <label class="ms-toggle"><span>${t('inStockOnly')}</span><input type="checkbox" data-mf="stock" ${filt.stock ? 'checked' : ''}></label>
        </div>
        <div class="ms-foot"><button type="button" class="btn btn-outline" data-mclear>${t('fClear')}</button><button type="submit" class="btn btn-dark" id="msShow">${t('showResults', list.length)}</button></div>
      </form></dialog>
      <dialog class="msheet" id="sortSheet" aria-label="${t('sortBy')}"><form method="dialog" class="ms-body">
        <div class="ms-head"><span class="ms-grab" aria-hidden="true"></span><h2>${t('sortBy')}</h2><button type="button" class="icon-btn" data-mx aria-label="${t('close')}">×</button></div>
        <div class="ms-list">${Object.entries(sortLabels).map(([k, l]) => `<label class="ms-row"><span>${l}</span><input type="radio" name="msort" value="${k}" ${sortBy === k ? 'checked' : ''}></label>`).join('')}</div>
      </form></dialog>
      ${list.length ? `<div class="grid">${list.map(p => card(p)).join('')}</div>` : `<div class="empty-state"><p class="muted">${n ? t('noMatch') : t('emptyList')}</p>${n ? `<button class="btn btn-outline" data-fclear>${t('fClear')}</button>` : ''}</div>`}
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
        ${p.images && p.images.length ? `<div class="pswipe" aria-label="${t('photo')}">
          <div class="ps-track" id="psTrack">${p.images.map((src, i) => `<button class="ps-slide" data-psi="${i}" aria-label="${t('photo')} ${i + 1}">${imgTag(src, L(p.name), false, i === 0)}</button>`).join('')}</div>
          ${p.images.length > 1 ? `<div class="ps-dots">${p.images.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><span class="ps-count" id="psCount">1 / ${p.images.length}</span>` : ''}
        </div>` : ''}
        <div class="gallery ${p.images && p.images.length ? 'has-swipe' : ''}">
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

          <div class="opt-row"><p class="opt-label">${t('size')} <span class="fs-hint" data-fs-hint hidden></span></p>${(p.shape === 'thobe' || p.shape === 'combo') && p.sizes.length > 1 ? `<span class="size-links"><button class="link link-btn fs-btn" data-findsize>${t('findSize')}</button><a class="link" href="#/page/size-guide">${t('sizeGuide')}</a></span>` : ''}</div>
          <div class="sizes">${p.sizes.map(s => `<button class="size ${s.stock > 0 ? '' : 'out'}" data-size="${s.id}" aria-pressed="${p.sizes.length === 1 && s.stock > 0}" ${s.stock > 0 ? '' : `title="${t('soldOut')}" aria-label="${esc(s.label)}, ${t('soldOut')}"`}>${sizeHtml(s)}</button>`).join('')}</div>
          <div id="notifyBox"></div>
          <p class="muted small stock-note" id="stockNote"></p>
          <p class="error" id="sizeErr" hidden>${t('pickSize')}</p>

          <div class="buy-row">
            <div class="qty"><button data-q="-1" aria-label="−">−</button><span id="qtyVal">1</span><button data-q="1" aria-label="+">+</button></div>
            <button class="btn btn-outline" id="addBtn">${t('addToCart')}</button>
          </div>
          <button class="btn btn-dark btn-block" id="buyBtn">${t('buyNow')}</button>
          ${SHOP.whatsapp ? `<button class="btn btn-wa btn-block" id="waOrderBtn">${icon('whatsapp', 18)}${t('waOrder')}</button>` : ''}
          ${deliveryEta()}
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
      ${rel.length ? `<section class="block"><h2 class="block-title">${t('related')}</h2><div class="grid">${rel.map(p => card(p)).join('')}</div></section>` : ''}
    </div>`;
  }

  // ডেলিভারির আনুমানিক তারিখ (শুক্রবার বাদে): ঢাকায় ১–২ দিন, বাইরে ২–৪ দিন
  function deliveryEta() {
    const add = n => { const d = new Date(Date.now() + 6 * 3600e3); let k = 0; while (k < n) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 5) k++; } return d; };
    const f = d => d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const truck = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>';
    return `<div class="eta">${truck}<div><p>${t('arrives', f(add(1)), f(add(2)))} <span class="muted">(${t('insideDhaka')})</span></p>
      <p class="muted small">${t('outside')}: ${f(add(2))} – ${f(add(4))}</p></div></div>`;
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
  const PRESETS = { saudi: { collar: 'shirt', front: 'hidden', pocket: 'chest', cuff: 'cuff' }, band: { collar: 'band', front: 'visible', pocket: 'chest', cuff: 'cuff' } };
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
    const fams = [...new Set(CUSTOM.fabrics.map(f => f.family).filter(Boolean))];
    const fabrics = (fams.length > 1 ? `<div class="fam-chips" role="group">${['all'].concat(fams).map(k => `<button type="button" class="fam" data-fam="${k}" aria-pressed="${(cu.fam || 'all') === k}">${k === 'all' ? t('famAll') : `<i style="--sw:${esc((CUSTOM.fabrics.find(f => f.family === k) || {}).hex || '#ccc')}"></i>${STR[lang].fam[k] || k}`}</button>`).join('')}</div>` : '')
      + `<div class="fab-cards">${CUSTOM.fabrics.map((f, i) => `<label class="fcard" data-family="${esc(f.family)}" ${cu.fam && cu.fam !== 'all' && f.family !== cu.fam ? 'hidden' : ''}>
        <input type="radio" name="fabric" value="${f.id}" ${cu.fabric === f.id ? 'checked' : ''}>
        <span class="fc-img" style="--sw:${esc(f.hex)}">${f.image ? imgTag(f.image, '', true) : ''}
          ${f.image ? `<button type="button" class="fc-zoom" data-fzoom="${i}" aria-label="${t('zoomFabric')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg></button>` : ''}
          ${f.left != null && f.left < 5 ? `<em class="fc-few">${t('fewLeft', f.left)}</em>` : ''}<span class="fc-check" aria-hidden="true"></span></span>
        <span class="fc-txt"><strong>${esc(L(f.name))}</strong>
          <span class="fc-color"><i style="--sw:${esc(f.hex)}"></i>${esc(L(f.color) || '')}</span>
          ${[f.composition, f.origin, f.gsm ? 'GSM ' + f.gsm : '', f.season].filter(Boolean).length ? `<small>${esc([f.composition, f.origin, f.gsm ? 'GSM ' + f.gsm : '', f.season].filter(Boolean).join(' · '))}</small>` : ''}
          ${L(f.desc) ? `<small>${esc(L(f.desc))}</small>` : ''}
          <b class="fc-price">${f.add ? '+' + money(f.add) : '&nbsp;'}</b></span></label>`).join('')}</div>`;
    // স্টাইল: দুটি তৈরি স্টাইল (প্রিসেট), তারপর প্রতিটি অংশের ছবিসহ কার্ড
    const T = window.AHThobe, fab0 = fabricOf(cu.fabric) || CUSTOM.fabrics[0];
    const looks = T.looksFrom(CUSTOM.groups.map(g => ({ key: g.key, options: g.options.map(o => ({ ...o, en: o.name.en })) })), cu.opts);
    const presetCard = (k, title, note, lk) => `<button type="button" class="preset" data-preset="${k}" aria-pressed="${['collar', 'front', 'cuff'].every(x => looks[x] === lk[x])}">
      <span class="pr-img">${T.draw({ hex: fab0.hex, image: fab0.image, ...looks, ...lk, crop: undefined, title })}</span><span class="pr-txt"><strong>${title}</strong><small>${note}</small></span></button>`;
    const groups = `<p class="opt-label">${t('presetsTitle')}</p><div class="presets">
        ${presetCard('saudi', t('presetSaudi'), t('presetSaudiNote'), PRESETS.saudi)}${presetCard('band', t('presetBand'), t('presetBandNote'), PRESETS.band)}</div>
      <p class="muted small preset-or">${t('presetOr')}</p>`
      + CUSTOM.groups.map(g => {
        const kind = T.KIND[T.lookOf(g.key, { ...g.options[0], en: g.options[0].name.en })];
        return `<fieldset class="cu-group"><legend>${esc(L(g.name))}</legend>${kind === 'pocket' ? `<p class="muted small">${t('pocketNote')}</p>` : ''}<div class="${kind ? 'look-opts' : 'chip-opts'}">${g.options.map((o, i) => {
          const lk = T.lookOf(g.key, { ...o, en: o.name.en }), k2 = T.KIND[lk];
          return k2 ? `<label class="look-opt"><input type="radio" name="opt-${esc(g.key)}" value="${i}" ${cu.opts[g.key] === i ? 'checked' : ''}>
              <span class="lo-img">${T.draw({ hex: fab0.hex, image: fab0.image, ...looks, [k2]: lk, crop: k2 })}</span>
              <span class="lo-txt">${esc(L(o.name))}${o.add ? `<small>+${money(o.add)}</small>` : ''}</span></label>`
            : `<label class="chip-opt"><input type="radio" name="opt-${esc(g.key)}" value="${i}" ${cu.opts[g.key] === i ? 'checked' : ''}><span>${esc(L(o.name))}${o.add ? ` <small>+${money(o.add)}</small>` : ''}</span></label>`;
        }).join('')}</div></fieldset>`;
      }).join('');
    const M = STR[lang].meas, H = STR[lang].measHelp;
    const measInputs = MEAS_FIELDS.map(([k, req]) => `<label class="meas ${req ? 'req' : ''}"><span class="meas-l">${M[k]}${req ? '' : ` <small>(${t('optional')})</small>`}</span>
      <span class="meas-in"><input name="m-${k}" ${k === 'height' ? 'type="text"' : 'type="number" step="0.25" inputmode="decimal"'} value="${esc(cu.meas[k] || '')}">${k === 'height' ? '' : `<em>${t('inches')}</em>`}</span>
      <small class="meas-h">${H[k]}</small></label>`).join('');
    const sizeBody = `<div class="options fit-choice">
        <label class="opt"><input type="radio" name="fit" value="standard" ${cu.fit === 'standard' ? 'checked' : ''}><span>${t('fitStandard')}<small>${t('fitStandardNote')}</small></span></label>
        <label class="opt"><input type="radio" name="fit" value="measure" ${cu.fit === 'measure' ? 'checked' : ''}><span>${t('fitMeasure')}<small>${t('fitMeasureNote')}</small></span></label>
      </div>
      <div id="cuStd" ${cu.fit === 'standard' ? '' : 'hidden'}>
        <div class="opt-row"><p class="opt-label">${t('size')} <span class="fs-hint" data-fs-hint hidden></span></p><span class="size-links"><button type="button" class="link link-btn fs-btn" data-findsize>${t('findSize')}</button><a class="link" href="#/page/size-guide">${t('sizeGuide')}</a></span></div>
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
      const T = window.AHThobe;
      const looks = T.looksFrom(CUSTOM.groups.map(g => ({ key: g.key, options: g.options.map(o => ({ ...o, en: o.name.en })) })), cu.opts);
      $('#cuArt').innerHTML = `<div class="cu-thobe">${T.draw({ hex: f.hex, image: f.image, ...looks, title: t('customItem') })}</div>${f.image ? `<span class="cu-swatch"><img src="${esc(f.image)}" alt=""></span>` : ''}`;
      // অংশের ছোট ছবিগুলোও বাছাই করা কাপড়ে
      form.querySelectorAll('.look-opt').forEach(lb => {
        const inp = lb.querySelector('input'), g = CUSTOM.groups.find(x => 'opt-' + x.key === inp.name), o = g.options[Number(inp.value)];
        const lk = T.lookOf(g.key, { ...o, en: o.name.en }), k2 = T.KIND[lk];
        lb.querySelector('.lo-img').innerHTML = T.draw({ hex: f.hex, image: f.image, ...looks, [k2]: lk, crop: k2 });
      });
      form.querySelectorAll('[data-preset]').forEach(b => {
        const lk = PRESETS[b.dataset.preset];
        b.setAttribute('aria-pressed', ['collar', 'front', 'cuff'].every(x => looks[x] === lk[x]));
        b.querySelector('.pr-img').innerHTML = T.draw({ hex: f.hex, image: f.image, ...looks, ...lk });
      });
      const sizeTxt = cu.fit === 'standard' ? (cu.size ? t('sizeIs', esc(cu.size)) : '—') : t('madeToMeasure');
      $('#cuSum').innerHTML = `<h3>${t('customItem')}</h3>
        <dl><dt>${t('fabricL')}</dt><dd>${esc(L(f.name))}${L(f.color) ? ', ' + esc(L(f.color)) : ''}</dd>
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
      const pr = e.target.closest('[data-preset]');
      if (pr) {
        const want = PRESETS[pr.dataset.preset], T = window.AHThobe;
        CUSTOM.groups.forEach(g => {
          const idx = g.options.findIndex(o => { const lk = T.lookOf(g.key, { ...o, en: o.name.en }); return T.KIND[lk] && want[T.KIND[lk]] === lk; });
          if (idx >= 0) { cu.opts[g.key] = idx; const r = form.querySelector(`input[name="opt-${CSS.escape(g.key)}"][value="${idx}"]`); if (r) r.checked = true; }
        });
        draw(); return;
      }
      const fz = e.target.closest('[data-fzoom]');
      if (fz) { e.preventDefault(); openLightbox(CUSTOM.fabrics.filter(f => f.image).map(f => ({ src: f.image, caption: L(f.name) + (L(f.color) ? ', ' + L(f.color) : '') })), CUSTOM.fabrics.filter(f => f.image).indexOf(CUSTOM.fabrics[Number(fz.dataset.fzoom)])); return; }
      const fm = e.target.closest('[data-fam]');
      if (fm) { cu.fam = fm.dataset.fam; form.querySelectorAll('[data-fam]').forEach(b => b.setAttribute('aria-pressed', b === fm)); form.querySelectorAll('.fcard').forEach(c => { c.hidden = cu.fam !== 'all' && c.dataset.family !== cu.fam; }); return; }
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

  // ---------- গ্যালারি (লুকবুক) ----------
  // অ্যাডমিনের ছবি (অ্যালবাম, ফিচার্ড, ট্যাগ) + চাইলে প্রতিটি ডিজাইনের একটি করে ছবি
  function allGallery() {
    const own = GALLERY.map(g => {
      const codes = [...new Set([...(g.spots || []).map(s => s.code), g.product].filter(c => c && byId(c)))];
      return { id: 'g' + g.id, src: g.image, caption: L(g.caption), album: g.album || '', featured: g.featured, spots: (g.spots || []).filter(s => byId(s.code)), codes, href: codes[0] ? '#/p/' + codes[0] : '' };
    });
    const prod = GALLERY_OPTS.products ? byDesign(PRODUCTS).filter(p => p.images && p.images[0]).map(p => ({ id: 'p' + p.id, src: p.images[0], caption: L(p.name), album: '_products', featured: false, spots: [], codes: [p.id], href: '#/p/' + p.id })) : [];
    return own.concat(prod);
  }
  let galCat = 'all';
  const galleryList = () => allGallery().filter(g => galCat === 'all' || g.album === galCat);
  const galleryItems = () => galleryList().map(g => ({ src: g.src, caption: g.caption, href: g.href }));
  // হোম পেজের চলমান সারির জন্য আগের মতো
  function marquee() { return ''; }

  function pageGallery() {
    const all = allGallery();
    const albums = [...new Set(all.map(g => g.album).filter(a => a && a !== '_products'))];
    const tabs = [['all', t('galAll'), all.length]].concat(albums.map(a => [a, a, all.filter(g => g.album === a).length]), all.some(g => g.album === '_products') ? [['_products', t('galProducts'), all.filter(g => g.album === '_products').length]] : []);
    if (!tabs.some(x => x[0] === galCat)) galCat = 'all';
    const list = galleryList();
    const feat = all.filter(g => g.featured);
    const hero = feat.length ? feat : [];
    return `<div class="gpage">
      ${hero.length ? `<section class="ghero" id="ghero">${hero.map((g, i) => `<button class="gh-slide ${i ? '' : 'on'}" data-gopen="${g.id}" aria-label="${esc(g.caption || t('photo'))}">${imgTag(g.src, g.caption, false, i === 0)}
          <span class="gh-copy"><small>${esc(g.album || t('galleryTitle'))}</small>${g.caption ? `<b>${esc(g.caption)}</b>` : ''}${g.spots.length || g.codes.length ? `<em>${t('shopLook')} →</em>` : ''}</span></button>`).join('')}
        ${hero.length > 1 ? `<div class="gh-dots">${hero.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</section>` : ''}
      <div class="wrap">
        <div class="ghead"><div><h1>${t('galleryTitle')}</h1><p class="muted">${t('galleryIntro')}</p></div><span class="muted">${t('galCount', list.length)}</span></div>
        ${tabs.length > 2 ? `<div class="gtabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-gcat="${esc(k)}" aria-selected="${galCat === k}">${esc(l)} <small>${n}</small></button>`).join('')}</div>` : ''}
        ${list.length ? `<div class="ggrid">${list.map((g, i) => `<button class="gtile ${i % 9 === 0 && list.length > 4 ? 'big' : ''}" data-gopen="${g.id}" style="--d:${(i % 8) * 50}ms" aria-label="${esc(g.caption || t('photo') + ' ' + (i + 1))}">
            ${imgTag(g.src, g.caption, true, i < 4)}
            ${g.spots.length ? `<span class="gt-shop">${t('shopLook')}</span>` : ''}
            ${g.caption ? `<span class="gt-cap">${esc(g.caption)}</span>` : ''}</button>`).join('')}</div>` : `<p class="muted">${t('galleryEmpty')}</p>`}
      </div>
      <dialog class="gviewer" id="gviewer" aria-label="${t('galleryTitle')}"></dialog>
    </div>`;
  }

  // পুরো স্ক্রিনে দেখা: আঙুলে সরানো, ট্যাগ করা জুব্বা, শেয়ার
  function openViewer(list, id) {
    const dlg = $('#gviewer'); if (!dlg) return;
    let i = Math.max(0, list.findIndex(g => g.id === id));
    dlg.innerHTML = `<div class="gv-top"><span id="gvCount"></span><span class="gv-act"><button class="gv-btn" id="gvShare" aria-label="${t('galShare')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></button><button class="gv-btn" data-gvx aria-label="${t('close')}">×</button></span></div>
      <div class="gv-track" id="gvTrack">${list.map(g => `<div class="gv-slide"><figure class="gv-fig"><img src="${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy" decoding="async">
        ${g.spots.map(s => `<a class="gv-dot" href="#/p/${esc(s.code)}" style="left:${s.x}%;top:${s.y}%" aria-label="${esc(L(byId(s.code).name))}"><i></i></a>`).join('')}</figure></div>`).join('')}</div>
      <button class="gv-nav prev" data-gvm="-1" aria-label="${t('prev')}">‹</button><button class="gv-nav next" data-gvm="1" aria-label="${t('nextPhoto')}">›</button>
      <div class="gv-bottom" id="gvBottom"></div>`;
    const tr = $('#gvTrack');
    const info = () => {
      const g = list[i];
      $('#gvCount').textContent = `${i + 1} / ${list.length}`;
      const prods = g.codes.map(byId).filter(Boolean);
      $('#gvBottom').innerHTML = `${g.caption ? `<p class="gv-cap">${esc(g.caption)}</p>` : ''}${prods.length ? `<p class="gv-in">${t('inThisPhoto')}</p><div class="gv-prods">${prods.map(p => `<a class="gv-prod" href="#/p/${p.id}">${media(p, 0, true)}<span><b>${esc(L(p.name))}</b><small>${esc(L(p.color))}</small><strong>${money(p.price)}</strong></span><em>${t('buyThis')}</em></a>`).join('')}</div>` : ''}`;
      history.replaceState(null, '', '#/gallery/' + g.id);
    };
    const go = (n, smooth) => { i = Math.max(0, Math.min(list.length - 1, n)); tr.scrollTo({ left: i * tr.clientWidth, behavior: smooth ? 'smooth' : 'auto' }); info(); };
    let st; tr.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => { const n = Math.round(tr.scrollLeft / tr.clientWidth); if (n !== i) { i = n; info(); } }, 80); }, { passive: true });
    dlg.onclick = e => {
      if (e.target.closest('[data-gvx]')) return dlg.close();
      const m = e.target.closest('[data-gvm]'); if (m) return go(i + Number(m.dataset.gvm), true);
      if (e.target.closest('a')) dlg.close();
    };
    dlg.onkeydown = e => { if (e.key === 'ArrowRight') go(i + 1, true); if (e.key === 'ArrowLeft') go(i - 1, true); };
    dlg.onclose = () => { if (location.hash.startsWith('#/gallery/')) history.replaceState(null, '', '#/gallery'); document.body.classList.remove('sheet-open'); };
    $('#gvShare').onclick = async () => {
      const url = location.origin + '/#/gallery/' + list[i].id;
      try { if (navigator.share) await navigator.share({ title: 'Al Hadaf', text: list[i].caption || 'Al Hadaf', url }); else { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } } catch (e) { /* cancelled */ }
    };
    dlg.showModal(); document.body.classList.add('sheet-open');
    requestAnimationFrame(() => go(i, false));
  }

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
    if (!e.target.closest('.fdrop')) document.querySelectorAll('.fdrop[open]').forEach(d => { d.open = false; });
    const fsb = e.target.closest('[data-findsize]');
    if (fsb && !fsb.closest('#quickDialog')) { e.preventDefault(); const pid = (location.hash.match(/^#\/p\/([^/]+)/) || [])[1]; openSizeFinder(pid ? byId(decodeURIComponent(pid)) : null); return; }
    const ins = e.target.closest('[data-install]');
    if (ins) { e.preventDefault(); doInstall(); return; }
    const qa = e.target.closest('[data-quick]');
    if (qa) { e.preventDefault(); openQuick(qa.dataset.quick); return; }
    const ct = e.target.closest('[data-colors]');
    if (ct) { const open = ct.getAttribute('aria-expanded') !== 'true'; ct.setAttribute('aria-expanded', open); ct.nextElementSibling.hidden = !open; return; }
    const sw = e.target.closest('[data-swap]');
    if (sw) { const c = sw.closest('[data-card]'), p = byId(sw.dataset.swap); if (c && p) { c.outerHTML = card(p, true); const n = document.querySelector(`[data-card="${CSS.escape(p.id)}"]`); if (n) n.classList.add('in'); } return; }
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
    return list.length ? `<section class="wrap block"><h2 class="block-title">${t('recent')}</h2><div class="grid">${list.map(p => card(p)).join('')}</div></section>` : '';
  }

  // ---------- উইশলিস্ট ----------
  function renderWishCount() { $('#wishCount').textContent = wish.length; $('#wishCount').hidden = !wish.length; const b = $('#bnWish'); if (b) { b.textContent = wish.length; b.hidden = !wish.length; } }
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
      ${list.length ? `<div class="grid">${list.map(p => card(p)).join('')}</div>` : `<div class="empty-state"><p class="muted">${t('wishEmpty')}</p><a class="btn btn-dark" href="#/c/all">${t('continueShopping')}</a></div>`}</div>`;
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
    out.innerHTML = list.length ? list.map(p => `<a class="sr" href="#/p/${p.id}" data-close><span class="sr-media">${media(p, 0, true)}</span>
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

  // ---------- "আমার সাইজ কত?": উচ্চতা আর ওজন থেকে সাইজ চার্ট মিলিয়ে ----------
  const FIT_KEY = 'alhadaf_fit';
  const savedFit = () => { try { return JSON.parse(store.get(FIT_KEY) || 'null'); } catch (e) { return null; } };
  function recommendSize(ft, inch, kg, fit) {
    const hIn = ft * 12 + inch, m = hIn * 0.0254, bmi = kg / (m * m);
    const lens = SIZE_CHART.map(r => parseFloat(r[1]));
    const want = hIn * 0.835;
    let idx = 0; lens.forEach((l, i) => { if (Math.abs(l - want) < Math.abs(lens[idx] - want)) idx = i; });
    const base = idx;
    let bump = bmi >= 31 ? 2 : bmi >= 27 ? 1 : 0;
    if (fit === 'loose' && bump === 0) bump = 1;
    idx = Math.min(lens.length - 1, idx + bump);
    // লম্বার দিক থেকে মাঝামাঝি হলে বিকল্প সাইজ
    const alt = !bump && want > lens[base] + 0.6 && base + 1 < lens.length ? base + 1 : null;
    return { label: SIZE_CHART[idx][0], length: lens[idx], chest: parseFloat(SIZE_CHART[idx][2]), roomy: bmi >= 27, alt: alt != null ? SIZE_CHART[alt][0] : null };
  }
  function openSizeFinder(p) {
    const sv = savedFit() || {};
    const dlg = $('#sizeDialog');
    const draw = res => {
      const inStock = res && p ? p.sizes.find(z => z.label === res.label && z.stock > 0) : null;
      $('#sizeBody').innerHTML = `<button class="icon-btn dlg-x" data-close aria-label="${t('close')}">×</button>
        <form class="fs" id="fsForm" novalidate>
          <h2>${t('fsTitle')}</h2><p class="muted">${t('fsIntro')}</p>
          <div class="fs-row"><span class="fs-l">${t('fsHeight')}</span>
            <label class="fs-in"><input name="ft" type="number" inputmode="numeric" min="4" max="7" value="${esc(sv.ft || '')}" placeholder="5"><em>${t('fsFeet')}</em></label>
            <label class="fs-in"><input name="inch" type="number" inputmode="numeric" min="0" max="11" value="${sv.inch == null ? '' : esc(sv.inch)}" placeholder="7"><em>${t('fsInch')}</em></label></div>
          <div class="fs-row"><span class="fs-l">${t('fsWeight')}</span><label class="fs-in wide"><input name="kg" type="number" inputmode="numeric" min="25" max="200" value="${esc(sv.kg || '')}" placeholder="68"><em>kg</em></label></div>
          <fieldset class="cu-group"><legend>${t('fsFit')}</legend><div class="chip-opts">${['regular', 'loose'].map(k => `<label class="chip-opt"><input type="radio" name="fit" value="${k}" ${(sv.fit || 'regular') === k ? 'checked' : ''}><span>${STR[lang].fits[k]}</span></label>`).join('')}</div></fieldset>
          <button class="btn btn-dark btn-block" type="submit">${t('fsGo')}</button>
          <p class="error" id="fsErr" hidden></p>
          ${res ? `<div class="fs-res"><p class="fs-big">${t('fsResult', `<strong>${esc(res.label)}</strong>`)}</p><p class="muted">${t('fsLength', res.length, res.chest)}</p>
            ${res.roomy ? `<p class="small">${t('fsRoomy')}</p>` : ''}${res.alt ? `<p class="small">${t('fsBetween', esc(res.alt))}</p>` : ''}
            ${p ? (inStock ? `<button type="button" class="btn btn-dark" id="fsUse">${t('fsUse')}</button>` : `<p class="small error">${t('fsOut')}</p>`) : ''}
            ${CUSTOM ? `<a class="link" href="#/custom" data-close>${t('fsCustom')}</a>` : ''}</div>` : ''}
        </form>`;
      const f = $('#fsForm');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const ft = Number(f.ft.value), inch = Number(f.inch.value || 0), kg = Number(f.kg.value);
        if (!(ft >= 4 && ft <= 7) || !(kg >= 25 && kg <= 200) || inch < 0 || inch > 11) { $('#fsErr').textContent = t('fsErr'); $('#fsErr').hidden = false; return; }
        const r = recommendSize(ft, inch, kg, f.fit.value);
        Object.assign(sv, { ft, inch, kg, fit: f.fit.value, size: r.label });
        store.set(FIT_KEY, JSON.stringify(sv));
        draw(r); markRecommended();
      });
      const use = $('#fsUse');
      if (use) use.addEventListener('click', () => { const b = document.querySelector(`#view .size[data-size="${inStock.id}"]`); if (b) b.click(); dlg.close(); });
    };
    draw(sv.size ? recommendSize(sv.ft, sv.inch, sv.kg, sv.fit) : null);
    dlg.showModal();
  }
  // আগে সাইজ বের করে থাকলে পণ্যের পেজে সেই সাইজে চিহ্ন
  function markRecommended() {
    const sv = savedFit(); if (!sv || !sv.size) return;
    document.querySelectorAll('#view .sizes .size, #quickBody .sizes .size').forEach(b => { b.classList.toggle('rec', b.textContent.trim() === sv.size); });
    document.querySelectorAll('[data-fs-hint]').forEach(el => { el.textContent = t('fsYour', sv.size); el.hidden = false; });
  }

  // ---------- অ্যাপ ইনস্টল (PWA) ----------
  let installEvt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; toast(t('installDone')); document.querySelectorAll('[data-install]').forEach(b => { b.hidden = true; }); $('#installBar').hidden = true; });
  function showInstall() {
    if (standalone() || (!installEvt && !isIos)) return;
    document.querySelectorAll('[data-install]').forEach(b => { b.hidden = false; });
    // দ্বিতীয় বা পরের ভিজিটে নিচে ছোট একটা বার, একবার বন্ধ করলে আর দেখায় না
    const visits = Number(store.get('alhadaf_visits') || 0);
    if (visits >= 2 && !store.get('alhadaf_install_no')) $('#installBar').hidden = false;
  }
  async function doInstall() {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome !== 'accepted') store.set('alhadaf_install_no', '1'); installEvt = null; $('#installBar').hidden = true; }
    else if (isIos) toast(t('installIos'));
  }
  store.set('alhadaf_visits', String(Number(store.get('alhadaf_visits') || 0) + 1));
  // ---------- router ----------
  function route() {
    if (!loaded) { $('#view').innerHTML = `<div class="wrap page" aria-busy="true" aria-label="${t('loading')}"><div class="sk sk-title"></div><div class="grid">${'<div><div class="sk sk-img"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>'.repeat(8)}</div></div>`; return; }
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    document.body.classList.remove('sbar');
    const view = $('#view');
    let active = '';
    if (!parts[0]) { view.innerHTML = pageHome(); bindSlider(); }
    else if (parts[0] === 'c') { active = parts[1]; view.innerHTML = pageCategory(parts[1]); bindCategory(); }
    else if (parts[0] === 'p') { const p = byId(parts[1]); active = p ? p.cat : ''; view.innerHTML = pageProduct(parts[1]); bindProduct(p); }
    else if (parts[0] === 'page') view.innerHTML = pageInfo(parts[1]);
    else if (parts[0] === 'custom') { active = 'custom'; view.innerHTML = pageCustom(); bindCustom(); }
    else if (parts[0] === 'gallery') {
      if (parts[1] && $('#gviewer') && $('#gviewer').open) return; // ভিউয়ারের ভেতরে ঠিকানা বদল
      active = 'gallery'; view.innerHTML = pageGallery(); bindGallery(parts[1]);
    }
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
    setHeadH();
    const cur = !parts[0] ? 'home' : parts[0] === 'c' ? 'shop' : parts[0] === 'wishlist' ? 'wish' : '';
    document.querySelectorAll('#bnav [data-bn]').forEach(a => a.setAttribute('aria-current', a.dataset.bn === cur ? 'page' : 'false'));
    markRecommended();
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

  function bindGallery(openId) {
    const root = $('.gpage'); if (!root) return;
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-gcat]');
      if (b) { galCat = b.dataset.gcat; const y = window.scrollY; route(); window.scrollTo(0, y); return; }
      const o = e.target.closest('[data-gopen]');
      if (o) { const all = allGallery(), inList = galleryList().some(g => g.id === o.dataset.gopen); openViewer(inList ? galleryList() : all.filter(g => g.featured), o.dataset.gopen); }
    });
    // ফিচার্ড স্লাইড নিজে নিজে বদলায়
    const hero = $('#ghero'), slides = hero ? [...hero.querySelectorAll('.gh-slide')] : [];
    if (slides.length > 1 && !calm.matches) {
      let k = 0; const dots = [...hero.querySelectorAll('.gh-dots i')];
      const tm = setInterval(() => { if (!document.body.contains(hero)) return clearInterval(tm); if (document.hidden || $('#gviewer').open) return;
        slides[k].classList.remove('on'); dots[k].classList.remove('on'); k = (k + 1) % slides.length; slides[k].classList.add('on'); dots[k].classList.add('on'); }, 5000);
    }
    if (openId) { const all = allGallery(); if (all.some(g => g.id === openId)) { galCat = 'all'; openViewer(all, openId); } }
  }

  window.addEventListener('hashchange', () => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); route(); window.scrollTo(0, 0); });

  // মোবাইল: নিচ থেকে উঠে আসা ফিল্টার আর সর্ট শিট
  // স্টিকি হেডারের উচ্চতা, যাতে ফিল্টার বার ঠিক তার নিচে আটকে থাকে
  function setHeadH() { const h = document.querySelector('.site-header'); if (h) document.documentElement.style.setProperty('--head-h', h.offsetHeight + 'px'); }
  window.addEventListener('resize', setHeadH);
  function bindMobileSheets() {
    const fs = $('#filterSheet'), ss = $('#sortSheet'); if (!fs) return;
    const c = catOf(filt.cat) || catOf('all'), base = PRODUCTS.filter(p => c.id === 'all' || p.cat === c.id);
    let draft = { ...filt, colors: [...filt.colors], sizes: [...filt.sizes] };
    const count = () => { $('#msShow').textContent = t('showResults', applyFilt(base, draft).length); };
    const open = d => { draft = { ...filt, colors: [...filt.colors], sizes: [...filt.sizes] }; d.showModal(); document.body.classList.add('sheet-open'); };
    $('#view').querySelectorAll('[data-msheet]').forEach(b => b.onclick = () => open(b.dataset.msheet === 'sort' ? ss : fs));
    [fs, ss].forEach(d => {
      d.addEventListener('close', () => document.body.classList.remove('sheet-open'));
      d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); });
      d.querySelectorAll('[data-mx]').forEach(x => x.onclick = () => d.close('cancel'));
    });
    $('#msForm').addEventListener('change', e => {
      const k = e.target.dataset.mf; if (!k) return;
      if (k === 'colors' || k === 'sizes') draft[k] = e.target.checked ? draft[k].concat(e.target.value) : draft[k].filter(x => x !== e.target.value);
      if (k === 'price') draft.price = e.target.value;
      if (k === 'stock') draft.stock = e.target.checked;
      count();
    });
    fs.querySelector('[data-mclear]').onclick = () => { draft = { cat: filt.cat, colors: [], sizes: [], price: '', stock: false }; fs.querySelectorAll('input').forEach(i => { i.checked = false; }); count(); };
    // "ফলাফল দেখুন" চাপলে বা বন্ধ করলে ফিল্টার বসে; বাইরে চাপলে বাতিল
    fs.addEventListener('close', () => { if (fs.returnValue === 'cancel') return; filt = draft; route(); window.scrollTo(0, 0); });
    ss.addEventListener('change', e => { if (e.target.name === 'msort') { sortBy = e.target.value; ss.close(); route(); } });
  }
  function bindCategory() {
    bindMobileSheets();
    const box = $('#filters'); if (!box) return;
    const redraw = () => {
      const open = [...box.querySelectorAll('details')].findIndex(d => d.open), y = window.scrollY;
      route(); window.scrollTo(0, y);
      if (open >= 0) { const d = $('#filters').querySelectorAll('details')[open]; if (d) d.open = true; }
    };
    box.addEventListener('toggle', e => { if (e.target.open) box.querySelectorAll('details').forEach(d => { if (d !== e.target) d.open = false; }); }, true);
    box.addEventListener('change', e => {
      const f = e.target.dataset.f; if (!f) return;
      if (f === 'colors' || f === 'sizes') { const v = e.target.value; filt[f] = e.target.checked ? filt[f].concat(v) : filt[f].filter(x => x !== v); }
      if (f === 'price') filt.price = e.target.value;
      if (f === 'stock') filt.stock = e.target.checked;
      if (f === 'sort') { sortBy = e.target.value; route(); return; }
      redraw();
    });
    $('#view').querySelectorAll('[data-fclear]').forEach(b => b.addEventListener('click', () => { filt = { cat: filt.cat, colors: [], sizes: [], price: '', stock: false }; route(); }));
  }


  function bindProduct(p) {
    if (!p) return;
    // মোবাইলে আঙুল দিয়ে ছবি সরানো, নিচে বিন্দু
    const tr = $('#psTrack');
    if (tr) {
      const dots = [...document.querySelectorAll('.ps-dots i')];
      tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); const c = $('#psCount'); if (c) c.textContent = `${i + 1} / ${dots.length}`; }, { passive: true });
      tr.addEventListener('click', e => { const sl = e.target.closest('[data-psi]'); if (sl) openLightbox(p.images.map(src => ({ src, caption: L(p.name) })), Number(sl.dataset.psi)); });
    }
    const wa = $('#waOrderBtn');
    if (wa) wa.onclick = () => {
      const sel = document.querySelector('.sizes .size[aria-pressed="true"]');
      if (!sel && p.sizes.length > 1) { $('#sizeErr').textContent = t('pickSizeFirst'); $('#sizeErr').hidden = false; document.querySelector('.sizes').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      const z = sel ? p.sizes.find(x => String(x.id) === sel.dataset.size) : p.sizes[0];
      const msg = t('waOrderMsg', L(p.name), p.id, L(p.color), z ? z.label : '-', money(p.price), location.origin + '/p/' + p.id);
      px('Contact', { content_ids: [p.id] });
      window.open(waLink(msg), '_blank', 'noopener');
    };
    // মোবাইলে নিচে স্থায়ী "কার্টে যোগ করুন" বার, যখন আসল বাটন স্ক্রিনের বাইরে
    const bar = document.createElement('div');
    bar.className = 'sticky-buy'; bar.innerHTML = `<div><strong>${esc(L(p.name))}</strong><span>${money(p.price)}</span></div><button class="btn btn-dark">${t('addToCart')}</button>`;
    $('#view').appendChild(bar);
    bar.querySelector('button').addEventListener('click', () => { const s = $('.sizes'); if (!document.querySelector('.size[aria-pressed="true"]')) { s.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#sizeErr').hidden = false; } else $('#addBtn').click(); });
    const gm = $('#galleryMain');
    if (gm && window.matchMedia('(hover: hover)').matches) {
      gm.addEventListener('mousemove', e => { const r = gm.getBoundingClientRect(), img = gm.querySelector('img'); if (img) img.style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`; });
    }
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
      <button class="menu-install" data-install hidden>${t('installApp')}</button>
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
        <li><a href="#" data-install hidden>${t('installShort')}</a></li>
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
    const freeShip = SHOP.freeShipOver > 0 && base >= SHOP.freeShipOver;
    if (freeShip) return finish(sub, 0, bundle, qty, base);
    return finish(sub, del, bundle, qty, base);
  };
  function finish(sub, del, bundle, qty, base) {
    let off = 0;
    if (coupon && base >= coupon.min) off = coupon.kind === 'percent' ? Math.round(base * Math.min(90, coupon.value) / 100) : coupon.kind === 'fixed' ? Math.min(base, coupon.value) : del;
    return { sub, del, off, bundle, qty, base, total: Math.max(0, sub + del - off - bundle) };
  };
  let lastCount = null;
  function renderCartCount() {
    const n = cart.reduce((s, i) => s + i.qty, 0);
    if (lastCount != null && n > lastCount) { const b = $('#cartOpen'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    lastCount = n;
    $('#cartCount').textContent = n;
    $('#cartCount').hidden = n === 0;
    const bc = $('#bnCart'); if (bc) { bc.textContent = n; bc.hidden = n === 0; }
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
      ${SHOP.freeShipOver > 0 ? (() => { const b = totals().base, pct = Math.min(100, Math.round(b / SHOP.freeShipOver * 100));
        return `<div class="fship ${pct >= 100 ? 'done' : ''}"><p>${pct >= 100 ? t('freeShipGot') : t('freeShipMore', money(SHOP.freeShipOver - b))}</p><i style="--p:${pct}%"></i></div>`; })() : ''}
      ${SHOP.freeShipOver > 0 && totals().base >= SHOP.freeShipOver ? '' : `<p class="muted small">${t('deliveryLater')}</p>`}
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
    // এই ফোনে আগের বার দেওয়া নাম, নম্বর, ঠিকানা
    let last = null; try { last = JSON.parse(store.get('alhadaf_checkout') || 'null'); } catch (e) { /* none */ }
    if (last && !acct) {
      form.elements.custName.value = last.name || ''; form.elements.custPhone.value = last.phone || ''; form.elements.custAddress.value = last.address || '';
      if (last.area === 'outside') form.elements.area.value = 'outside';
      const note = document.createElement('p'); note.className = 'muted small saved-note'; note.textContent = t('savedDetails'); form.prepend(note);
    }
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

    store.set('alhadaf_checkout', JSON.stringify({ name, phone, address, area }));
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
  $('#bnav').addEventListener('click', e => {
    const b = e.target.closest('[data-bn]'); if (!b) return;
    if (b.dataset.bn === 'cart') { renderCart(); $('#cartDialog').showModal(); }
    if (b.dataset.bn === 'search') $('#searchOpen').click();
  });
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
  let annTimer = null;
  // স্ক্রল করলে হেডার ছোট হয়, নিচে গেলে "উপরে যান" বাটন
  const topBtn = document.createElement('button');
  topBtn.className = 'to-top'; topBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(topBtn);
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY; document.body.classList.toggle('scrolled', y > 60); topBtn.classList.toggle('on', y > 900);
      // পণ্যের পেজে "এখনই কিনুন" বাটন উপরে চলে গেলে নিচের বার দেখায়
      const bb = document.getElementById('buyBtn'), bar = document.querySelector('.sticky-buy');
      if (bb && bar) { const on = bb.getBoundingClientRect().bottom < 0; bar.classList.toggle('on', on); document.body.classList.toggle('sbar', on); }
      ticking = false;
    });
  }, { passive: true });
  function applyChrome() {
    topBtn.setAttribute('aria-label', t('backTop'));
    document.documentElement.lang = lang;
    document.body.classList.toggle('bn', lang === 'bn');
    const msgs = (L(SHOP.announce) || t('announce')).split('|').map(x => x.trim()).filter(Boolean);
    clearInterval(annTimer);
    $('#announce').innerHTML = `<span class="ann-msg">${esc(msgs[0])}</span>`;
    if (msgs.length > 1) { let k = 0; annTimer = setInterval(() => { k = (k + 1) % msgs.length; $('#announce').innerHTML = `<span class="ann-msg in">${esc(msgs[k])}</span>`; }, 4500); }
    $('#langBtn').textContent = t('langSwitch');
    $('#menuOpen').setAttribute('aria-label', t('menu'));
    $('#cartOpen').setAttribute('aria-label', t('cartTitle'));
    $('#chatFab').setAttribute('aria-label', t('chatTitle'));
    $('#searchOpen').setAttribute('aria-label', t('search'));
    [['home', 'navHome'], ['shop', 'navShop'], ['search', 'navSearch'], ['wish', 'navSaved'], ['cart', 'navCart']].forEach(([k, l]) => { const el = document.querySelector(`[data-bn="${k}"] span`); if (el) el.textContent = t(l); });
    $('#wishLink').setAttribute('aria-label', t('wishlist'));
    $('#accountLink').setAttribute('aria-label', t('account'));
    $('#accountLink').hidden = !FEATURES.otp;
    renderWishCount();
    $('#installBar').innerHTML = `<img src="/icon-192.png" alt="" width="40" height="40"><span>${t('installApp')}</span><button class="btn btn-dark" data-install>${t('installShort')}</button><button class="icon-btn" id="installNo" aria-label="${t('close')}">×</button>`;
    $('#installNo').onclick = () => { store.set('alhadaf_install_no', '1'); $('#installBar').hidden = true; };
    showInstall();
    if (!$('#chatPanel').hidden) renderChat();
    renderFooter(); renderCartCount();
  }

  applyChrome();
  route();
  loadStore().then(async () => { applyChrome(); if (FEATURES.otp) await loadAccount(); route(); }).catch(() => {
    $('#view').innerHTML = `<div class="wrap page"><p class="muted">${t('errServer')}</p></div>`;
  });
})();
