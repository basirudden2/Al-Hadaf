// ===== Al Hadaf — admin panel =====
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => 'BDT ' + Number(n || 0).toLocaleString('en-IN');
  const STATUSES = [
    ['new', 'New'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']
  ];
  const THOBE_SIZES = ['XS/52', 'S/54', 'M/56', 'L/58', 'XL/60', '2XL/62'];
  const KIDS_SIZES = ['4Y', '6Y', '8Y', '10Y', '12Y'];

  let categories = [], products = [], orderFilter = '', orderQuery = '';

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch('/api/admin/' + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'x-admin': '1', ...(opts.body && !(opts.body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body instanceof Blob ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && path !== 'login') { showLogin(); throw new Error('auth'); }
    if (!res.ok) throw new Error((data && data.message) || 'Request failed (' + res.status + ')');
    return data;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = 'toast'), 2800);
  }
  const fail = e => { if (e.message !== 'auth') toast(e.message, true); };

  // ---------- login ----------
  function showLogin() { $('#appView').hidden = true; $('#loginView').hidden = false; $('#loginForm').password.focus(); }
  function showApp() { $('#loginView').hidden = true; $('#appView').hidden = false; route(); }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; $('#loginErr').hidden = true;
    try {
      await api('login', { method: 'POST', body: { password: e.target.password.value } });
      e.target.reset(); showApp();
    } catch (err) {
      $('#loginErr').textContent = err.message; $('#loginErr').hidden = false;
    }
    btn.disabled = false;
  });
  $('#logoutBtn').addEventListener('click', async () => { try { await api('logout', { method: 'POST' }); } catch (e) { /* ignore */ } showLogin(); });

  // ---------- router ----------
  function route() {
    const [tab, arg] = (location.hash.slice(1) || 'orders').split('/');
    document.querySelectorAll('#tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === (tab === 'product' ? 'products' : tab) ? 'page' : 'false'));
    const main = $('#main');
    main.innerHTML = '<p class="muted">Loading…</p>';
    const views = { orders: viewOrders, products: viewProducts, product: () => viewProductEdit(arg), categories: viewCategories, settings: viewSettings };
    (views[tab] || viewOrders)().catch(fail);
  }
  window.addEventListener('hashchange', () => { if (!$('#appView').hidden) { route(); window.scrollTo(0, 0); } });

  // ================= ORDERS =================
  async function viewOrders() {
    const qs = new URLSearchParams();
    if (orderFilter) qs.set('status', orderFilter);
    if (orderQuery) qs.set('q', orderQuery);
    const { orders, counts } = await api('orders?' + qs);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#main').innerHTML = `
      <div class="page-head"><h1>Orders</h1>
        <input class="search" id="orderSearch" type="search" placeholder="Search order no, phone or name" value="${esc(orderQuery)}"></div>
      <div class="chips">
        <button class="chip" data-st="" aria-pressed="${!orderFilter}">All <b>${total}</b></button>
        ${STATUSES.map(([k, l]) => `<button class="chip st-${k}" data-st="${k}" aria-pressed="${orderFilter === k}">${l} <b>${counts[k] || 0}</b></button>`).join('')}
      </div>
      ${orders.length ? `<div class="orders">${orders.map(orderCard).join('')}</div>` : '<p class="empty">No orders here yet. New orders from the website will appear here.</p>'}`;

    $('#main').querySelector('.chips').addEventListener('click', e => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      orderFilter = b.dataset.st; viewOrders().catch(fail);
    });
    let t;
    $('#orderSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { orderQuery = e.target.value.trim(); viewOrders().then(() => { const s = $('#orderSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }).catch(fail); }, 400); });
    $('#main').querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', async () => {
      const prev = sel.dataset.prev;
      if (sel.value === 'cancelled' && !confirm('Cancel this order? Its items will be added back to stock.')) { sel.value = prev; return; }
      try { await api('orders/' + sel.dataset.id, { method: 'PUT', body: { status: sel.value } }); toast('Order marked ' + sel.value); viewOrders().catch(fail); }
      catch (e) { sel.value = prev; fail(e); }
    }));
  }

  function orderCard(o) {
    const phone = o.phone.replace(/^\+?88/, '');
    const when = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<details class="order st-${o.status}">
      <summary>
        <div class="o-main"><strong>${esc(o.order_no)}</strong><span class="muted">${when}</span></div>
        <div class="o-cust">${esc(o.name)}<span class="muted">${esc(phone)}</span></div>
        <div class="o-total">${money(o.total)}<span class="muted">${o.payment === 'bkash' ? 'bKash/Nagad' : 'COD'}</span></div>
        <span class="badge st-${o.status}">${STATUSES.find(s => s[0] === o.status)[1]}</span>
      </summary>
      <div class="o-body">
        <div class="o-cols">
          <div>
            <h4>Customer</h4>
            <p>${esc(o.name)}<br><a href="tel:${esc(phone)}">${esc(phone)}</a><br>${esc(o.address)}</p>
            <p class="muted">${o.area === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'}</p>
            ${o.payment === 'bkash' ? `<p><b>bKash/Nagad TrxID:</b> ${esc(o.trx)}</p>` : ''}
            ${o.note ? `<p><b>Note:</b> ${esc(o.note)}</p>` : ''}
          </div>
          <div>
            <h4>Items</h4>
            <ul class="o-items">${o.items.map(l => `<li><span>${esc(l.name)}, ${esc(l.color)} <span class="muted">${esc(l.code)}</span><br>Size ${esc(l.size)} × ${l.qty}</span><span>${money(l.price * l.qty)}</span></li>`).join('')}</ul>
            <p class="o-sum"><span>Subtotal</span><span>${money(o.subtotal)}</span></p>
            <p class="o-sum"><span>Delivery</span><span>${money(o.delivery)}</span></p>
            <p class="o-sum total"><span>Total</span><span>${money(o.total)}</span></p>
          </div>
        </div>
        <div class="o-actions">
          <label>Status <select class="status-select" data-id="${o.id}" data-prev="${o.status}">${STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <a class="btn ghost sm" href="https://wa.me/88${esc(phone)}" target="_blank" rel="noopener">WhatsApp customer</a>
          <a class="btn ghost sm" href="tel:${esc(phone)}">Call</a>
        </div>
      </div>
    </details>`;
  }

  // ================= PRODUCTS =================
  async function loadCatalog() {
    [categories, products] = await Promise.all([api('categories'), api('products')]);
  }

  async function viewProducts() {
    await loadCatalog();
    const catName = id => (categories.find(c => c.id === id) || {}).name_en || '—';
    $('#main').innerHTML = `
      <div class="page-head"><h1>Products <span class="muted">${products.length}</span></h1><a class="btn primary" href="#product/new">Add product</a></div>
      ${products.length ? `<div class="plist">${products.map(p => {
        const stock = p.sizes.reduce((a, s) => a + s.stock, 0);
        const out = p.sizes.filter(s => s.stock === 0).length;
        return `<a class="prow ${p.active ? '' : 'inactive'}" href="#product/${p.id}">
          <div class="pthumb" style="--c:${esc(p.color_hex)}">${p.images[0] ? `<img src="/img/${esc(p.images[0])}" alt="" loading="lazy">` : ''}</div>
          <div class="pinfo"><strong>${esc(p.name_en)}</strong><span class="muted">${esc(p.code)} · ${esc(p.color_en || '')} · ${esc(catName(p.category_id))}</span></div>
          <div class="pprice">${money(p.price)}</div>
          <div class="pstock ${stock === 0 ? 'zero' : stock <= 5 ? 'low' : ''}">${stock} in stock${out ? `<span class="muted">${out} size${out > 1 ? 's' : ''} sold out</span>` : ''}</div>
          <div>${p.active ? '<span class="badge st-delivered">Live</span>' : '<span class="badge">Hidden</span>'}</div>
        </a>`;
      }).join('')}</div>` : '<p class="empty">No products yet. Add your first product.</p>'}`;
  }

  // ---------- product editor ----------
  async function viewProductEdit(arg) {
    await loadCatalog();
    const isNew = arg === 'new';
    const p = isNew ? {
      code: nextCode(), category_id: (categories[0] || {}).id, group_key: '', name_en: '', name_bn: '', desc_en: '', desc_bn: '',
      features_en: '', features_bn: '', fabric_en: '', fabric_bn: '', gsm: '', color_en: '', color_bn: '', color_hex: '#F2F0EA',
      price: '', compare_price: '', badge_en: '', badge_bn: '', is_new: 1, active: 1, sort: 0, images: [],
      sizes: THOBE_SIZES.map(l => ({ id: 0, label: l, stock: 0 }))
    } : products.find(x => String(x.id) === arg);
    if (!p) { $('#main').innerHTML = '<p class="empty">Product not found.</p>'; return; }
    let images = [...p.images];
    let sizes = p.sizes.map(s => ({ id: s.id, label: s.label, stock: s.stock }));
    const groups = [...new Set(products.map(x => x.group_key).filter(Boolean))];

    const f = (name, label, val, opts = {}) => `<label class="field ${opts.cls || ''}"><span>${label}${opts.hint ? ` <small>${opts.hint}</small>` : ''}</span>
      ${opts.area ? `<textarea name="${name}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(val)}</textarea>`
        : `<input name="${name}" value="${esc(val)}" type="${opts.type || 'text'}" ${opts.list ? `list="${opts.list}"` : ''} placeholder="${esc(opts.ph || '')}" ${opts.req ? 'required' : ''} ${opts.type === 'number' ? 'min="0" inputmode="numeric"' : ''}>`}</label>`;

    $('#main').innerHTML = `
      <div class="page-head"><h1>${isNew ? 'Add product' : 'Edit product'}</h1><a class="btn ghost" href="#products">Back to products</a></div>
      <form id="pForm" class="editor" novalidate>
        <section class="card">
          <h2>Photos</h2>
          <p class="muted small">The first photo is the main one. Use the same light background for every product. Photos are resized automatically.</p>
          <div class="imgs" id="imgs"></div>
          <label class="upload"><input type="file" id="imgInput" accept="image/*" multiple hidden><span>Add photos</span></label>
          <p class="muted small" id="upStatus"></p>
        </section>

        <section class="card">
          <h2>Basic details</h2>
          <div class="g2">
            ${f('name_en', 'Name (English)', p.name_en, { req: true, ph: 'Saudi Classic Thobe' })}
            ${f('name_bn', 'Name (বাংলা)', p.name_bn, { ph: 'সৌদি ক্লাসিক জুব্বা' })}
          </div>
          <div class="g3">
            ${f('code', 'Product code', p.code, { req: true, hint: 'unique' })}
            <label class="field"><span>Category</span><select name="category_id">${categories.map(c => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name_en)}</option>`).join('')}</select></label>
            ${f('sort', 'Display order', p.sort, { type: 'number', hint: 'lower shows first' })}
          </div>
          <div class="g3">
            ${f('price', 'Price (BDT)', p.price, { type: 'number', req: true })}
            ${f('compare_price', 'Old price (BDT)', p.compare_price == null ? '' : p.compare_price, { type: 'number', hint: 'optional, shows as discount' })}
            <div class="checks">
              <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Show on website</label>
              <label class="check"><input type="checkbox" name="is_new" ${p.is_new ? 'checked' : ''}> New arrival</label>
            </div>
          </div>
          <div class="g2">
            ${f('badge_en', 'Badge (English)', p.badge_en, { hint: 'optional', ph: 'Best seller' })}
            ${f('badge_bn', 'Badge (বাংলা)', p.badge_bn, { hint: 'optional', ph: 'বেস্ট সেলার' })}
          </div>
        </section>

        <section class="card">
          <h2>Colour</h2>
          <div class="g3">
            ${f('color_en', 'Colour name (English)', p.color_en, { ph: 'Off-white' })}
            ${f('color_bn', 'Colour name (বাংলা)', p.color_bn, { ph: 'অফ-হোয়াইট' })}
            <label class="field"><span>Swatch colour</span><input type="color" name="color_hex" value="${esc(p.color_hex)}"></label>
          </div>
          ${f('group_key', 'Design group', p.group_key, { list: 'groupList', hint: 'give the same group to the same design in different colours, so customers can switch colour', ph: 'saudi-classic' })}
          <datalist id="groupList">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        </section>

        <section class="card">
          <h2>Sizes and stock</h2>
          <div class="sizes-ed" id="sizesEd"></div>
          <div class="row-btns">
            <button type="button" class="btn ghost sm" id="addSize">Add size</button>
            <button type="button" class="btn ghost sm" data-preset="thobe">Use thobe sizes</button>
            <button type="button" class="btn ghost sm" data-preset="kids">Use kids sizes</button>
            <button type="button" class="btn ghost sm" data-preset="free">Free size</button>
          </div>
        </section>

        <section class="card">
          <h2>Description</h2>
          <div class="g2">
            ${f('desc_en', 'Description (English)', p.desc_en, { area: true, rows: 4 })}
            ${f('desc_bn', 'Description (বাংলা)', p.desc_bn, { area: true, rows: 4 })}
          </div>
          <div class="g2">
            ${f('features_en', 'Features (English)', p.features_en, { area: true, rows: 5, hint: 'one per line', ph: 'Classic Saudi collar\nChest pocket' })}
            ${f('features_bn', 'Features (বাংলা)', p.features_bn, { area: true, rows: 5, hint: 'one per line', ph: 'ক্লাসিক সৌদি কলার\nবুক পকেট' })}
          </div>
          <div class="g3">
            ${f('fabric_en', 'Fabric (English)', p.fabric_en, { ph: 'Japanese Tetron' })}
            ${f('fabric_bn', 'Fabric (বাংলা)', p.fabric_bn, { ph: 'জাপানি টেট্রন' })}
            ${f('gsm', 'GSM', p.gsm == null ? '' : p.gsm, { type: 'number', hint: 'optional' })}
          </div>
        </section>

        <div class="save-bar">
          ${isNew ? '' : '<button type="button" class="btn danger" id="delBtn">Delete product</button>'}
          <span class="spacer"></span>
          <a class="btn ghost" href="#products">Cancel</a>
          <button class="btn primary" type="submit" id="saveBtn">${isNew ? 'Add product' : 'Save changes'}</button>
        </div>
      </form>`;

    const form = $('#pForm');

    function drawImages() {
      $('#imgs').innerHTML = images.map((k, i) => `<div class="img">
        <img src="/img/${esc(k)}" alt="">
        ${i === 0 ? '<span class="main-tag">Main</span>' : ''}
        <div class="img-tools">
          <button type="button" data-mv="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left">‹</button>
          <button type="button" data-rm="${i}" aria-label="Remove">×</button>
          <button type="button" data-mv="${i}" data-d="1" ${i === images.length - 1 ? 'disabled' : ''} aria-label="Move right">›</button>
        </div></div>`).join('') || '<p class="muted small">No photos yet. Until you add photos, the website shows a drawing in the swatch colour.</p>';
    }
    $('#imgs').addEventListener('click', e => {
      const mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]');
      if (mv) { const i = +mv.dataset.mv, j = i + +mv.dataset.d; [images[i], images[j]] = [images[j], images[i]]; drawImages(); }
      if (rm && confirm('Remove this photo?')) { images.splice(+rm.dataset.rm, 1); drawImages(); }
    });
    $('#imgInput').addEventListener('change', async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (let i = 0; i < files.length; i++) {
        $('#upStatus').textContent = `Uploading photo ${i + 1} of ${files.length}…`;
        try {
          const blob = await compress(files[i]);
          const r = await api('upload', { method: 'POST', body: blob, headers: { 'content-type': blob.type } });
          images.push(r.key); drawImages();
        } catch (err) { fail(err); }
      }
      $('#upStatus').textContent = files.length ? 'Photos uploaded. Remember to save the product.' : '';
    });

    function drawSizes() {
      $('#sizesEd').innerHTML = `<div class="sz-head"><span>Size</span><span>Stock</span><span></span></div>` + sizes.map((s, i) => `
        <div class="sz-row">
          <input data-i="${i}" data-k="label" value="${esc(s.label)}" placeholder="M/56" aria-label="Size">
          <div class="stepper"><button type="button" data-step="${i}" data-d="-1" aria-label="Less">−</button><input data-i="${i}" data-k="stock" type="number" min="0" inputmode="numeric" value="${s.stock}" aria-label="Stock"><button type="button" data-step="${i}" data-d="1" aria-label="More">+</button></div>
          <button type="button" class="icon" data-del="${i}" aria-label="Remove size">×</button>
        </div>`).join('');
    }
    const ed = $('#sizesEd');
    ed.addEventListener('input', e => { const el = e.target; if (el.dataset.i == null) return; sizes[+el.dataset.i][el.dataset.k] = el.dataset.k === 'stock' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value; });
    ed.addEventListener('click', e => {
      const st = e.target.closest('[data-step]'), del = e.target.closest('[data-del]');
      if (st) { const s = sizes[+st.dataset.step]; s.stock = Math.max(0, s.stock + +st.dataset.d); drawSizes(); }
      if (del) { sizes.splice(+del.dataset.del, 1); drawSizes(); }
    });
    $('#addSize').addEventListener('click', () => { sizes.push({ id: 0, label: '', stock: 0 }); drawSizes(); ed.querySelector('.sz-row:last-child input').focus(); });
    form.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const list = { thobe: THOBE_SIZES, kids: KIDS_SIZES, free: ['Free size'] }[b.dataset.preset];
      if (sizes.some(s => s.stock > 0) && !confirm('Replace the current sizes? Their stock numbers will be lost.')) return;
      sizes = list.map(l => ({ id: (sizes.find(s => s.label === l) || {}).id || 0, label: l, stock: 0 })); drawSizes();
    }));

    drawImages(); drawSizes();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const body = { ...fd, active: form.active.checked, is_new: form.is_new.checked, images, sizes };
      if (!body.name_en.trim()) return toast('Enter the English name.', true);
      if (body.price === '') return toast('Enter the price.', true);
      if (!sizes.filter(s => s.label.trim()).length) return toast('Add at least one size.', true);
      const btn = $('#saveBtn'); btn.disabled = true;
      try {
        await api(isNew ? 'products' : 'products/' + p.id, { method: isNew ? 'POST' : 'PUT', body });
        toast(isNew ? 'Product added' : 'Changes saved');
        location.hash = 'products';
      } catch (err) { fail(err); btn.disabled = false; }
    });
    const del = $('#delBtn');
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`Delete "${p.name_en}"? This also deletes its photos and cannot be undone.`)) return;
      try { await api('products/' + p.id, { method: 'DELETE' }); toast('Product deleted'); location.hash = 'products'; } catch (err) { fail(err); }
    });
  }

  function nextCode() {
    const nums = products.map(p => parseInt(String(p.code).replace(/\D/g, ''), 10)).filter(Boolean);
    return 'AH-' + (nums.length ? Math.max(...nums) + 1 : 1001);
  }

  // ছবি ব্রাউজারেই ছোট করা হয় (১৬০০px, WebP), যাতে আপলোড দ্রুত হয়
  async function compress(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const toBlob = (type, q) => new Promise(r => c.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
    return blob;
  }

  // ================= CATEGORIES =================
  async function viewCategories() {
    categories = await api('categories');
    const row = c => `<form class="cat-row" data-id="${c.id || ''}">
      <input name="name_en" value="${esc(c.name_en)}" placeholder="Name (English)" aria-label="Name English" required>
      <input name="name_bn" value="${esc(c.name_bn)}" placeholder="নাম (বাংলা)" aria-label="Name Bangla">
      <input name="slug" value="${esc(c.slug)}" placeholder="link-name" aria-label="Link name">
      <input name="sort" type="number" value="${c.sort || 0}" aria-label="Order" class="num">
      <label class="check"><input type="checkbox" name="on_home" ${c.on_home ? 'checked' : ''}> Home</label>
      <button class="btn primary sm" type="submit">${c.id ? 'Save' : 'Add'}</button>
      ${c.id ? '<button class="btn ghost sm" type="button" data-del>Delete</button>' : ''}
    </form>`;
    $('#main').innerHTML = `
      <div class="page-head"><h1>Categories</h1></div>
      <section class="card">
        <p class="muted small">“Link name” is used in the web address, like /#/c/thobe. Use small English letters and dashes. Tick “Home” to show the category as a box on the home page.</p>
        <div class="cat-head"><span>Name (English)</span><span>Name (বাংলা)</span><span>Link name</span><span>Order</span><span></span><span></span></div>
        ${categories.map(row).join('')}
        <h3 class="sub">Add a category</h3>
        ${row({ name_en: '', name_bn: '', slug: '', sort: categories.length + 1, on_home: 0 })}
      </section>`;
    $('#main').querySelectorAll('.cat-row').forEach(fm => {
      fm.name_en.addEventListener('input', () => { if (!fm.dataset.id) fm.slug.value = fm.name_en.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); });
      fm.addEventListener('submit', async e => {
        e.preventDefault();
        const body = { name_en: fm.name_en.value, name_bn: fm.name_bn.value, slug: fm.slug.value, sort: fm.sort.value, on_home: fm.on_home.checked };
        try { await api('categories' + (fm.dataset.id ? '/' + fm.dataset.id : ''), { method: fm.dataset.id ? 'PUT' : 'POST', body }); toast('Category saved'); viewCategories().catch(fail); } catch (err) { fail(err); }
      });
      const d = fm.querySelector('[data-del]');
      if (d) d.addEventListener('click', async () => {
        if (!confirm('Delete this category?')) return;
        try { await api('categories/' + fm.dataset.id, { method: 'DELETE' }); toast('Category deleted'); viewCategories().catch(fail); } catch (err) { fail(err); }
      });
    });
  }

  // ================= SHOP INFO =================
  async function viewSettings() {
    const s = await api('settings');
    const f = (k, label, opts = {}) => `<label class="field"><span>${label}${opts.hint ? ` <small>${opts.hint}</small>` : ''}</span>${opts.area
      ? `<textarea name="${k}" rows="2">${esc(s[k])}</textarea>` : `<input name="${k}" value="${esc(s[k])}" type="${opts.type || 'text'}" placeholder="${esc(opts.ph || '')}" ${opts.type === 'number' ? 'min="0"' : ''}>`}</label>`;
    $('#main').innerHTML = `
      <div class="page-head"><h1>Shop info</h1></div>
      <form id="sForm" class="editor">
        <section class="card"><h2>Contact</h2>
          <div class="g2">
            ${f('phone', 'Phone number', { ph: '01712345678' })}
            ${f('whatsapp', 'WhatsApp number', { hint: 'with 88, no +', ph: '8801712345678' })}
            ${f('bkash', 'bKash / Nagad number', { hint: 'for Send Money', ph: '01712345678' })}
            ${f('email', 'Email', { type: 'email', hint: 'optional' })}
            ${f('facebook', 'Facebook page link', { ph: 'https://facebook.com/yourpage' })}
            ${f('instagram', 'Instagram link', { hint: 'optional', ph: 'https://instagram.com/yourpage' })}
          </div>
        </section>
        <section class="card"><h2>Address</h2>
          <div class="g2">${f('address_en', 'Address (English)', { area: true })}${f('address_bn', 'ঠিকানা (বাংলা)', { area: true })}</div>
        </section>
        <section class="card"><h2>Delivery charge</h2>
          <div class="g2">${f('delivery_inside', 'Inside Dhaka (BDT)', { type: 'number' })}${f('delivery_outside', 'Outside Dhaka (BDT)', { type: 'number' })}</div>
        </section>
        <section class="card"><h2>Announcement bar</h2>
          <p class="muted small">The short line at the very top of the website, for offers or delivery news.</p>
          <div class="g2">${f('announce_en', 'English', { area: true })}${f('announce_bn', 'বাংলা', { area: true })}</div>
        </section>
        <div class="save-bar"><span class="spacer"></span><button class="btn primary" type="submit">Save shop info</button></div>
      </form>`;
    $('#sForm').addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Shop info saved'); } catch (err) { fail(err); }
    });
  }

  // ---------- start ----------
  api('me').then(showApp).catch(e => { if (e.message !== 'auth') showLogin(); });
})();
