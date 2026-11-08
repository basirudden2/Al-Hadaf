// ===== Al Hadaf Jubba — app.js =====
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const money = n => '৳' + Number(n).toLocaleString('en-IN');
  const byId = id => PRODUCTS.find(p => p.id === id);
  const STORE_KEY = 'alhadaf_cart_v1';

  let cart = loadCart();
  let activeCat = 'all';
  let current = null, chosenSize = null, chosenQty = 1;

  // ---------- storage ----------
  function loadCart() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(data) ? data.filter(i => byId(i.id) && i.qty > 0) : [];
    } catch (e) { return []; }
  }
  function saveCart() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ }
  }

  // ---------- product art (আসল ছবি আসার আগ পর্যন্ত) ----------
  function art(p) {
    const st = 'rgba(0,0,0,.28)';
    const robe = (c, t = '') =>
      `<g ${t}><path d="M80 20 Q100 36 120 20 L152 32 L192 92 L172 106 L152 76 L152 246 L48 246 L48 76 L28 106 L8 92 L48 32 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/><path d="M100 32 V96" stroke="${st}" stroke-width="2"/></g>`;
    let inner;
    if (p.shape === 'combo') {
      inner = robe(p.color, 'transform="translate(0 6) scale(.8)"') + robe(p.color2 || p.color, 'transform="translate(104 128) scale(.5)"');
    } else if (p.shape === 'cap') {
      inner = `<path d="M40 168 Q100 62 160 168 Z" fill="${p.color}" stroke="${st}" stroke-width="2"/><rect x="34" y="164" width="132" height="22" rx="4" fill="${p.color}" stroke="${st}" stroke-width="2"/>`;
    } else if (p.shape === 'bottle') {
      inner = `<rect x="84" y="56" width="32" height="28" rx="4" fill="#3A3A3A"/><path d="M66 86 H134 V214 Q134 228 120 228 H80 Q66 228 66 214 Z" fill="${p.color}" stroke="${st}" stroke-width="2"/><rect x="80" y="130" width="40" height="40" rx="3" fill="rgba(255,255,255,.55)"/>`;
    } else {
      inner = robe(p.color);
    }
    return `<svg viewBox="0 0 200 260" role="img" aria-label="${p.name}">${inner}</svg>`;
  }

  // ---------- collection ----------
  function renderFilters() {
    $('#filters').innerHTML = CATEGORIES.map(c =>
      `<button class="chip" data-cat="${c.id}" aria-pressed="${c.id === activeCat}">${c.label}</button>`).join('');
  }
  function renderGrid() {
    const list = PRODUCTS.filter(p => activeCat === 'all' || p.category === activeCat);
    $('#productGrid').innerHTML = list.map(p => `
      <a class="card" href="#${p.id}" data-id="${p.id}">
        <div class="card-art">${p.badge ? `<span class="badge">${p.badge}</span>` : ''}${art(p)}</div>
        <h3>${p.name}</h3>
        <p class="meta">${p.fabric}</p>
        <p class="price">${money(p.price)}</p>
      </a>`).join('');
  }
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    activeCat = b.dataset.cat;
    renderFilters(); renderGrid();
  });
  $('#productGrid').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    openProduct(card.dataset.id);
  });

  // ---------- product dialog ----------
  function openProduct(id) {
    const p = byId(id);
    if (!p) return;
    current = p;
    chosenSize = p.sizes.length === 1 ? p.sizes[0] : null;
    chosenQty = 1;
    $('#pdContent').innerHTML = `
      <div class="pd-art">${art(p)}</div>
      <div class="pd-body">
        <h3 id="pdTitle">${p.name}</h3>
        <p class="pd-price">${money(p.price)}</p>
        <p class="pd-desc">${p.description}</p>
        <ul class="pd-specs">
          <li><span>কাপড়</span><span>${p.fabric}</span></li>
          <li><span>রং</span><span>${p.colorName}</span></li>
        </ul>
        <p class="label">${p.sizeLabel}</p>
        <div class="sizes">${p.sizes.map(s =>
          `<button type="button" class="size" data-size="${s}" aria-pressed="${s === chosenSize}">${s}</button>`).join('')}</div>
        <p class="hint">${p.sizeHint || ''}</p>
        <div class="pd-actions">
          <div class="qty">
            <button type="button" data-q="-1" aria-label="কমান">−</button>
            <span id="pdQty">1</span>
            <button type="button" data-q="1" aria-label="বাড়ান">+</button>
          </div>
          <button type="button" class="btn btn-primary" id="pdAdd">কার্টে যোগ করুন</button>
        </div>
        <p class="error" id="pdError" hidden>আগে সাইজ বেছে নিন।</p>
      </div>`;
    $('#productDialog').showModal();
  }
  $('#pdContent').addEventListener('click', e => {
    const sizeBtn = e.target.closest('.size');
    if (sizeBtn) {
      chosenSize = sizeBtn.dataset.size;
      $('#pdContent').querySelectorAll('.size').forEach(b => b.setAttribute('aria-pressed', b === sizeBtn));
      $('#pdError').hidden = true;
      return;
    }
    const q = e.target.closest('[data-q]');
    if (q) {
      chosenQty = Math.min(10, Math.max(1, chosenQty + Number(q.dataset.q)));
      $('#pdQty').textContent = chosenQty;
      return;
    }
    if (e.target.closest('#pdAdd')) {
      if (!chosenSize) { $('#pdError').hidden = false; return; }
      addToCart(current.id, chosenSize, chosenQty);
      $('#productDialog').close();
      toast(`${current.name} কার্টে যোগ হয়েছে`);
    }
  });

  // ---------- cart ----------
  function addToCart(id, size, qty) {
    const found = cart.find(i => i.id === id && i.size === size);
    if (found) found.qty = Math.min(10, found.qty + qty);
    else cart.push({ id, size, qty });
    saveCart(); renderCart();
  }
  function totals(area) {
    const sub = cart.reduce((s, i) => s + byId(i.id).price * i.qty, 0);
    const del = cart.length ? (area === 'outside' ? SHOP.deliveryOutside : SHOP.deliveryInside) : 0;
    return { sub, del, total: sub + del };
  }
  function renderCart() {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    $('#cartCount').textContent = count;
    $('#cartCount').hidden = count === 0;

    if (!cart.length) {
      $('#cartItems').innerHTML = `<div class="empty"><p>আপনার কার্ট খালি।</p><a href="#collection" class="btn btn-ghost" data-close>কালেকশন দেখুন</a></div>`;
      $('#cartFoot').hidden = true;
      return;
    }
    $('#cartFoot').hidden = false;
    $('#cartItems').innerHTML = cart.map((i, idx) => {
      const p = byId(i.id);
      return `<div class="ci">
        <div class="ci-art">${art(p)}</div>
        <div>
          <h4>${p.name}</h4>
          <p>সাইজ ${i.size}</p>
          <p>${money(p.price * i.qty)}</p>
          <button class="ci-remove" data-remove="${idx}">বাদ দিন</button>
        </div>
        <div class="qty">
          <button data-ci="${idx}" data-d="-1" aria-label="কমান">−</button>
          <span>${i.qty}</span>
          <button data-ci="${idx}" data-d="1" aria-label="বাড়ান">+</button>
        </div>
      </div>`;
    }).join('');
    $('#cartSub').textContent = money(totals().sub);
  }
  $('#cartItems').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { cart.splice(Number(rm.dataset.remove), 1); saveCart(); renderCart(); return; }
    const b = e.target.closest('[data-ci]');
    if (b) {
      const item = cart[Number(b.dataset.ci)];
      item.qty += Number(b.dataset.d);
      if (item.qty < 1) cart.splice(Number(b.dataset.ci), 1);
      else item.qty = Math.min(10, item.qty);
      saveCart(); renderCart();
    }
  });
  $('#cartOpen').addEventListener('click', () => { renderCart(); $('#cartDialog').showModal(); });
  $('#toCheckout').addEventListener('click', openCheckout);

  // ---------- checkout ----------
  const form = $('#checkoutForm');
  const field = n => form.elements.namedItem(n);

  function openCheckout() {
    if (!cart.length) return;
    $('#cartDialog').close();
    form.reset();
    form.hidden = false;
    $('#coSuccess').hidden = true;
    $('#coError').hidden = true;
    updateCheckout();
    $('#checkoutDialog').showModal();
  }
  function updateCheckout() {
    const t = totals(field('area').value);
    $('#coSummary').innerHTML = `
      <p class="row"><span>সাবটোটাল</span><span>${money(t.sub)}</span></p>
      <p class="row"><span>ডেলিভারি চার্জ</span><span>${money(t.del)}</span></p>
      <p class="row total"><span>মোট</span><span>${money(t.total)}</span></p>`;
    $('#bkashBox').hidden = field('payment').value !== 'bkash';
    $('#bkashAmount').textContent = money(t.total);
  }
  form.addEventListener('change', updateCheckout);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = field('custName').value.trim();
    const phone = field('custPhone').value.trim().replace(/[\s-]/g, '');
    const address = field('custAddress').value.trim();
    const area = field('area').value;
    const pay = field('payment').value;
    const trx = field('trx').value.trim();
    const note = field('note').value.trim();

    const errs = [];
    if (name.length < 2) errs.push('আপনার নাম লিখুন।');
    if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(phone)) errs.push('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
    if (address.length < 8) errs.push('পুরো ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।');
    if (pay === 'bkash' && trx.length < 6) errs.push('bKash/Nagad-এর Transaction ID দিন।');
    if (errs.length) {
      $('#coError').innerHTML = errs.join('<br>');
      $('#coError').hidden = false;
      return;
    }

    const t = totals(area);
    const orderId = 'AH' + Date.now().toString().slice(-6);
    const lines = [
      `নতুন অর্ডার: ${orderId}`,
      `নাম: ${name}`,
      `মোবাইল: ${phone}`,
      `ঠিকানা: ${address}`,
      `এলাকা: ${area === 'outside' ? 'ঢাকার বাইরে' : 'ঢাকার ভেতরে'}`,
      '',
      'পণ্য:',
      ...cart.map(i => { const p = byId(i.id); return `- ${p.name} (সাইজ ${i.size}) x${i.qty} = ${money(p.price * i.qty)}`; }),
      '',
      `সাবটোটাল: ${money(t.sub)}`,
      `ডেলিভারি: ${money(t.del)}`,
      `মোট: ${money(t.total)}`,
      `পেমেন্ট: ${pay === 'bkash' ? 'bKash/Nagad, TrxID ' + trx : 'ক্যাশ অন ডেলিভারি'}`
    ];
    if (note) lines.push(`নোট: ${note}`);

    const waUrl = `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
    $('#orderId').textContent = orderId;
    $('#waSend').href = waUrl;
    form.hidden = true;
    $('#coSuccess').hidden = false;
    window.open(waUrl, '_blank', 'noopener');

    cart = []; saveCart(); renderCart();
  });

  // ---------- dialogs: close ----------
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- shop info ----------
  function fillShopInfo() {
    const wa = `https://wa.me/${SHOP.whatsapp}`;
    $('#waFloat').href = wa;
    $('#shopWa').href = wa;
    $('#shopPhone').href = `tel:${SHOP.phone}`;
    $('#shopPhone').textContent = SHOP.phone;
    $('#shopFb').href = SHOP.facebook;
    $('#shopAddress').textContent = SHOP.address;
    $('#bkashNumber').textContent = SHOP.bkash;
    $('#delIn').textContent = `ডেলিভারি চার্জ ${money(SHOP.deliveryInside)}`;
    $('#delOut').textContent = `ডেলিভারি চার্জ ${money(SHOP.deliveryOutside)}`;
    $('#deliveryInfo').textContent = `ঢাকার ভেতরে ${money(SHOP.deliveryInside)}, ঢাকার বাইরে ${money(SHOP.deliveryOutside)}। সারা দেশে ক্যাশ অন ডেলিভারি।`;
    $('#year').textContent = new Date().getFullYear();
  }

  // ---------- start ----------
  fillShopInfo();
  renderFilters();
  renderGrid();
  renderCart();
})();
