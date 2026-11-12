// ===== Al Hadaf — admin panel (v4) =====
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => 'BDT ' + Number(n || 0).toLocaleString('en-IN');
  const num = n => Number(n || 0).toLocaleString('en-IN');
  const STATUSES = [
    ['new', 'New'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']
  ];
  const stLabel = k => (STATUSES.find(s => s[0] === k) || [k, k])[1];
  const THOBE_SIZES = ['XS/52', 'S/54', 'M/56', 'L/58', 'XL/60', '2XL/62'];
  const KIDS_SIZES = ['4Y', '6Y', '8Y', '10Y', '12Y'];
  const MEAS_NAMES = { length: 'Length', chest: 'Chest', shoulder: 'Shoulder', sleeve: 'Sleeve', neck: 'Neck', cuff: 'Sleeve opening', waist: 'Waist', height: 'Height' };
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const toDate = s => new Date(String(s).replace(' ', 'T') + 'Z');
  const fmtWhen = s => toDate(s).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ago = s => {
    const m = Math.round((Date.now() - toDate(s)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    return fmtWhen(s);
  };

  let categories = [], products = [], orderFilter = '', orderQuery = '', orderFrom = '', orderTo = '', orderCustom = false, lastOrders = [];
  let viewTimer = null;
  let integ = { steadfast: false, sms: false, bkash: false, bdcourier: false };

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

  async function uploadFile(file, max) {
    const blob = await compress(file, max);
    return (await api('upload', { method: 'POST', body: blob, headers: { 'content-type': blob.type } })).key;
  }

  // ---------- login ----------
  function showLogin() { $('#appView').hidden = true; $('#loginView').hidden = false; $('#loginForm').password.focus(); }
  function showApp() { $('#loginView').hidden = true; $('#appView').hidden = false; route(); pollBadges(); }

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

  // ---------- sidebar (mobile) ----------
  const setMenu = open => { document.body.classList.toggle('menu-open', open); $('#menuToggle').setAttribute('aria-expanded', open); };
  $('#menuToggle').addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $('#sideBackdrop').addEventListener('click', () => setMenu(false));
  $('#tabs').addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });

  // ---------- badges: নতুন অর্ডার আর না-পড়া চ্যাট ----------
  let badgeTimer, lastUnread = -1;
  async function pollBadges() {
    clearTimeout(badgeTimer);
    try {
      const b = await api('badges');
      const set = (id, n) => { const el = $(id); el.textContent = n; el.hidden = !n; };
      set('#bOrders', b.newOrders); set('#bChats', b.unreadChats); set('#bReviews', b.pendingReviews); set('#bAbandoned', b.abandoned);
      integ = { steadfast: b.steadfast, sms: b.sms, bkash: b.bkash, bdcourier: b.bdcourier };
      $('#bAny').hidden = !(b.newOrders || b.unreadChats || b.pendingReviews || b.abandoned);
      const total = b.newOrders + b.unreadChats;
      document.title = (total ? `(${total}) ` : '') + 'Admin | Al Hadaf';
      if (lastUnread >= 0 && b.unreadChats > lastUnread) toast('New chat message');
      lastUnread = b.unreadChats;
    } catch (e) { /* ignore */ }
    if (!$('#appView').hidden) badgeTimer = setTimeout(pollBadges, 25000);
  }

  // ---------- router ----------
  function route() {
    clearTimeout(viewTimer);
    const [tab, arg] = (location.hash.slice(1) || 'dashboard').split('/');
    const active = tab === 'product' ? 'products' : tab;
    document.querySelectorAll('#tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === active ? 'page' : 'false'));
    const main = $('#main');
    main.className = 'main' + (tab === 'chats' ? ' wide' : '');
    main.innerHTML = '<p class="muted">Loading…</p>';
    const views = {
      dashboard: viewDashboard, orders: viewOrders, chats: () => viewChats(arg), customers: viewCustomers,
      products: viewProducts, product: () => viewProductEdit(arg), custom: viewCustom, gallery: viewGallery,
      categories: viewCategories, settings: viewSettings, coupons: viewCoupons, reviews: viewReviews,
      abandoned: viewAbandoned, banners: viewBanners
    };
    (views[tab] || viewDashboard)().catch(fail);
  }
  window.addEventListener('hashchange', () => { if (!$('#appView').hidden) { route(); window.scrollTo(0, 0); } });
  // ড্যাশবোর্ড, চ্যাট বা কাস্টমার থেকে অর্ডারে গেলে ফিল্টার সেট হয়
  $('#main').addEventListener('click', e => {
    const a = e.target.closest('a[href="#orders"]');
    if (!a) return;
    orderFilter = a.dataset.st || ''; orderQuery = a.dataset.q || ''; orderCustom = a.hasAttribute('data-custom'); orderFrom = orderTo = '';
  });

  // ================= DASHBOARD =================
  async function viewDashboard() {
    const [d, bd] = await Promise.all([api('stats'), api('badges')]);
    const aov = d.month.n ? Math.round(d.month.rev / d.month.n) : 0;
    const diff = d.yesterday.rev ? Math.round((d.today.rev - d.yesterday.rev) / d.yesterday.rev * 100) : null;
    const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false }));
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const todayStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long' });
    const todo = [
      d.statuses.new ? `<a class="todo" href="#orders" data-st="new"><b>${d.statuses.new}</b> new order${d.statuses.new > 1 ? 's' : ''} to confirm</a>` : '',
      d.unreadChats ? `<a class="todo" href="#chats"><b>${d.unreadChats}</b> chat${d.unreadChats > 1 ? 's' : ''} waiting for a reply</a>` : '',
      d.statuses.confirmed ? `<a class="todo" href="#orders" data-st="confirmed"><b>${d.statuses.confirmed}</b> confirmed order${d.statuses.confirmed > 1 ? 's' : ''} to ship</a>` : '',
      d.customOpen ? `<a class="todo" href="#orders" data-custom><b>${d.customOpen}</b> custom thobe${d.customOpen > 1 ? 's' : ''} to tailor</a>` : '',
      bd.abandoned ? `<a class="todo" href="#abandoned"><b>${bd.abandoned}</b> unfinished order${bd.abandoned > 1 ? 's' : ''} to call</a>` : '',
      bd.pendingReviews ? `<a class="todo" href="#reviews"><b>${bd.pendingReviews}</b> review${bd.pendingReviews > 1 ? 's' : ''} to approve</a>` : '',
      d.lowStock.length ? `<a class="todo" href="#products"><b>${d.lowStock.length}</b> size${d.lowStock.length > 1 ? 's' : ''} low on stock</a>` : ''
    ].filter(Boolean);
    const statusTotal = STATUSES.reduce((s, [k]) => s + (d.statuses[k] || 0), 0);
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>${hello}</h1><p class="muted">${todayStr}</p></div><a class="btn primary" href="#product/new">Add product</a></div>
      <div class="kpis">
        <div class="kpi"><span>Today’s sales</span><strong>${money(d.today.rev)}</strong><small>${plural(d.today.n, 'order')}${diff == null ? '' : ` · <em class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff}% vs yesterday</em>`}</small></div>
        <div class="kpi"><span>Last 7 days</span><strong>${money(d.week.rev)}</strong><small>${plural(d.week.n, 'order')}</small></div>
        <div class="kpi"><span>Last 30 days</span><strong>${money(d.month.rev)}</strong><small>${plural(d.month.n, 'order')}</small></div>
        <div class="kpi"><span>Average order</span><strong>${money(aov)}</strong><small>${plural(d.customers, 'customer')} in total</small></div>
      </div>
      <div class="dash-grid"><div class="dash-col">
        <section class="card chart-card"><div class="card-head"><h2>Sales, last 30 days</h2><span class="muted small">Cancelled orders not counted</span></div>${salesChart(d.daily)}</section>
        <section class="card"><div class="card-head"><h2>Best sellers, 30 days</h2></div>
          ${d.top.length ? `<table class="tbl"><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th></tr></thead><tbody>${d.top.map(p => `<tr><td>${esc(p.name)}<span class="muted block">${esc(p.code)}${p.color ? ' · ' + esc(p.color) : ''}</span></td><td class="r">${p.qty}</td><td class="r">${money(p.rev)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Sales will show here after your first orders.</p>'}
        </section>
        <section class="card"><div class="card-head"><h2>Low stock</h2><a class="link" href="#products">Products</a></div>
          ${d.lowStock.length ? `<ul class="mini-list">${d.lowStock.map(s => `<li><a href="#product/${s.id}"><span>${esc(s.name_en)}<span class="muted block">${esc(s.code)} · Size ${esc(s.label)}</span></span><span class="r ${s.stock ? 'warn' : 'danger'}">${s.stock ? s.stock + ' left' : 'Sold out'}</span></a></li>`).join('')}</ul>` : '<p class="muted">Every size has more than 3 in stock.</p>'}
        </section>
      </div><div class="dash-col">
        <section class="card"><h2>To do</h2>${todo.length ? `<div class="todos">${todo.join('')}</div>` : '<p class="muted">All caught up. Nothing is waiting for you.</p>'}
          ${statusTotal ? `<h3 class="sub">All orders by status</h3><div class="stbar">${STATUSES.map(([k, l]) => d.statuses[k] ? `<span class="st-${k}" style="flex:${d.statuses[k]}" title="${l}: ${d.statuses[k]}"></span>` : '').join('')}</div>
          <ul class="stlegend">${STATUSES.map(([k, l]) => `<li><i class="st-${k}"></i>${l} <b>${d.statuses[k] || 0}</b></li>`).join('')}</ul>` : ''}
        </section>
        <section class="card"><div class="card-head"><h2>Recent orders</h2><a class="link" href="#orders">All orders</a></div>
          ${d.recent.length ? `<ul class="mini-list">${d.recent.map(o => `<li><a href="#orders" data-q="${esc(o.order_no)}"><span><strong>${esc(o.order_no)}</strong><span class="muted block">${esc(o.name)} · ${ago(o.created_at)}</span></span><span class="r">${money(o.total)}<span class="badge st-${o.status}">${stLabel(o.status)}</span></span></a></li>`).join('')}</ul>` : '<p class="muted">No orders yet.</p>'}
        </section>
      </div></div>`;
  }

  function salesChart(daily) {
    const days = [];
    const now = new Date(Date.now() + 6 * 3600e3);
    for (let i = 29; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
    const by = Object.fromEntries(daily.map(r => [r.d, r]));
    const vals = days.map(d => (by[d] ? by[d].rev : 0)), max = Math.max(...vals, 1);
    const W = 720, H = 220, pad = 28, bw = (W - pad - 18) / 30;
    const nice = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / nice) * nice;
    const y = v => H - 24 - (v / top) * (H - 44);
    const grid = [0, .5, 1].map(f => `<line x1="${pad}" x2="${W}" y1="${y(top * f)}" y2="${y(top * f)}" class="gl"/><text x="${pad - 6}" y="${y(top * f) + 4}" class="ax" text-anchor="end">${top * f >= 1000 ? Math.round(top * f / 1000) + 'k' : Math.round(top * f)}</text>`).join('');
    const bars = days.map((d, i) => {
      const v = vals[i], x = pad + i * bw + 2, h = Math.max(v ? 2 : 0, H - 24 - y(v));
      const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return `<g><title>${label}: ${money(v)} (${by[d] ? by[d].n : 0} orders)</title><rect x="${x}" y="${y(v)}" width="${bw - 4}" height="${h}" rx="2" class="${i === 29 ? 'today' : ''}"/><rect x="${x - 2}" y="0" width="${bw}" height="${H}" fill="transparent"/>${i % 5 === 4 || i === 29 ? `<text x="${x + (bw - 4) / 2}" y="${H - 6}" class="ax" text-anchor="middle">${i === 29 ? 'Today' : label}</text>` : ''}</g>`;
    }).join('');
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily sales for the last 30 days">${grid}${bars}</svg></div>`;
  }

  // ================= ORDERS =================
  async function viewOrders() {
    const qs = new URLSearchParams();
    if (orderFilter) qs.set('status', orderFilter);
    if (orderQuery) qs.set('q', orderQuery);
    if (orderFrom) qs.set('from', orderFrom);
    if (orderTo) qs.set('to', orderTo);
    if (orderCustom) qs.set('custom', '1');
    const { orders, counts } = await api('orders?' + qs);
    lastOrders = orders;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#main').innerHTML = `
      <div class="page-head"><h1>Orders</h1>
        <div class="head-tools"><button class="btn ghost sm" id="csvBtn" ${orders.length ? '' : 'disabled'}>Download CSV</button></div></div>
      <div class="filters">
        <input class="search" id="orderSearch" type="search" placeholder="Search order no, phone or name" value="${esc(orderQuery)}">
        <label class="date-f">From <input type="date" id="fFrom" value="${esc(orderFrom)}"></label>
        <label class="date-f">To <input type="date" id="fTo" value="${esc(orderTo)}"></label>
        <label class="check"><input type="checkbox" id="fCustom" ${orderCustom ? 'checked' : ''}> Custom thobes only</label>
      </div>
      <div class="chips">
        <button class="chip" data-st="" aria-pressed="${!orderFilter}">All <b>${total}</b></button>
        ${STATUSES.map(([k, l]) => `<button class="chip st-${k}" data-st="${k}" aria-pressed="${orderFilter === k}">${l} <b>${counts[k] || 0}</b></button>`).join('')}
      </div>
      ${orders.length ? `<p class="muted small">${orders.length} order${orders.length > 1 ? 's' : ''} shown, total ${money(orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0))} without cancelled</p><div class="orders">${orders.map(orderCard).join('')}</div>`
        : '<p class="empty">No orders match. Clear the filters, or wait for new orders from the website.</p>'}`;

    const reload = () => viewOrders().catch(fail);
    $('#main').querySelector('.chips').addEventListener('click', e => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      orderFilter = b.dataset.st; reload();
    });
    let t;
    $('#orderSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { orderQuery = e.target.value.trim(); viewOrders().then(() => { const s = $('#orderSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }).catch(fail); }, 400); });
    $('#fFrom').addEventListener('change', e => { orderFrom = e.target.value; reload(); });
    $('#fTo').addEventListener('change', e => { orderTo = e.target.value; reload(); });
    $('#fCustom').addEventListener('change', e => { orderCustom = e.target.checked; reload(); });
    $('#csvBtn').addEventListener('click', () => downloadCsv(orders));
    $('#main').querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', async () => {
      const prev = sel.dataset.prev;
      if (sel.value === 'cancelled' && !confirm('Cancel this order? Its items will be added back to stock.')) { sel.value = prev; return; }
      try { await api('orders/' + sel.dataset.id, { method: 'PUT', body: { status: sel.value } }); toast('Order marked ' + stLabel(sel.value)); reload(); pollBadges(); }
      catch (e) { sel.value = prev; fail(e); }
    }));
    $('#main').querySelectorAll('.note-form').forEach(fm => fm.addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('orders/' + fm.dataset.id, { method: 'PUT', body: { admin_note: fm.note.value } }); toast('Note saved'); } catch (err) { fail(err); }
    }));
    $('#main').querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printInvoice(orders.find(o => String(o.id) === b.dataset.print))));
    $('#main').querySelectorAll('[data-fraud] button').forEach(b => b.addEventListener('click', () => runFraud(b.parentElement)));
    $('#main').querySelectorAll('[data-odel]').forEach(b => b.addEventListener('click', async () => {
      const o = orders.find(x => String(x.id) === b.dataset.odel);
      const back = o.status === 'new' || o.status === 'confirmed';
      if (!confirm(`Delete order ${o.order_no} for good?${back ? ' Its items will go back into stock.' : ''} This cannot be undone.`)) return;
      try { await api('orders/' + o.id, { method: 'DELETE' }); toast('Order deleted'); reload(); pollBadges(); } catch (e) { fail(e); }
    }));
    $('#main').querySelectorAll('[data-courier]').forEach(b => b.addEventListener('click', async () => {
      const o = orders.find(x => String(x.id) === b.dataset.courier);
      if (!integ.steadfast) return toast('Steadfast is not set up yet. See Shop info › Courier.', true);
      if (!confirm(`Book ${o.order_no} with Steadfast? COD amount: ${o.payment === 'bkash' ? 'BDT 0 (paid by bKash)' : money(o.total)}. The order will be marked Shipped.`)) return;
      b.disabled = true;
      try { const r = await api('courier/' + o.id, { method: 'POST' }); toast('Booked with Steadfast. Tracking ' + (r.tracking || r.consignment)); reload(); pollBadges(); } catch (e) { fail(e); b.disabled = false; }
    }));
    $('#main').querySelectorAll('[data-cstatus]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api('courier/' + b.dataset.cstatus); toast('Courier status: ' + (r.status || 'unknown').replace(/_/g, ' ')); reload(); } catch (e) { fail(e); b.disabled = false; }
    }));
    if (orderQuery && orders.length === 1) $('#main').querySelector('.order').open = true;
  }

  // আগের অর্ডারের রেকর্ড: বেশি বাতিল হলে লাল সতর্কতা
  function histChip(h) {
    if (!h || h.orders <= 1) return '<b class="hchip new">New customer</b>';
    const risky = h.cancelled >= 2 && h.cancelled >= h.delivered;
    return `<b class="hchip ${risky ? 'risk' : 'ok'}" title="${h.orders} orders, ${h.delivered} delivered, ${h.cancelled} cancelled">${h.delivered} delivered · ${h.cancelled} cancelled</b>`;
  }
  async function runFraud(box) {
    box.innerHTML = '<span class="muted small">Checking…</span>';
    try {
      const d = await api('fraud?phone=' + encodeURIComponent(box.dataset.fraud));
      const own = d.own, c = d.courier;
      const ratio = c && !c.error && c.total ? Math.round(c.success / c.total * 100) : null;
      box.innerHTML = `<div class="fraud-box ${ratio != null && ratio < 60 ? 'risk' : ''}">
        <p><b>With Al Hadaf:</b> ${own.orders} orders, ${own.delivered} delivered, ${own.cancelled} cancelled</p>
        ${c ? (c.error ? `<p class="muted small">All couriers: ${esc(c.error)}</p>` : `<p><b>All couriers:</b> ${c.total} parcels, ${c.success} delivered, ${c.cancelled} returned${ratio != null ? ` · <b>${ratio}% success</b>` : ''}</p>
          ${c.couriers.length ? `<p class="muted small">${c.couriers.map(x => `${esc(x.name)} ${x.success}/${x.total}`).join(' · ')}</p>` : ''}
          ${ratio != null && ratio < 60 ? '<p class="warn-t">Low success rate. Call and confirm before sending, or ask for advance delivery charge.</p>' : ''}`)
        : `<p class="muted small">Add BDCOURIER_API_KEY in Cloudflare to also see this number’s record with Steadfast, Pathao, RedX and others.</p>`}</div>`;
    } catch (e) { box.innerHTML = ''; fail(e); }
  }

  function itemHtml(l) {
    if (!l.custom) return `<li><span>${esc(l.name)}, ${esc(l.color)} <span class="muted">${esc(l.code)}</span><br>Size ${esc(l.size)} × ${l.qty}</span><span>${money(l.price * l.qty)}</span></li>`;
    const d = l.details || {};
    return `<li class="custom-item"><span><b class="tag">Custom</b> ${esc(l.name)} × ${l.qty}<br>
      <span class="muted">Fabric:</span> ${esc(d.fabric)}<br>
      ${(d.options || []).map(o => `<span class="muted">${esc(o.group)}:</span> ${esc(o.choice)}`).join('<br>')}<br>
      ${d.meas ? `<span class="muted">Fit:</span> ${esc(d.fit)}<table class="meas-t">${Object.entries(d.meas).filter(([, v]) => v).map(([k, v]) => `<tr><td>${MEAS_NAMES[k] || k}</td><td>${esc(v)}${k === 'height' ? '' : '"'}</td></tr>`).join('')}</table>` : `<span class="muted">Size:</span> ${esc(l.size)}`}
      ${d.note ? `<br><span class="muted">Note:</span> ${esc(d.note)}` : ''}</span><span>${money(l.price * l.qty)}</span></li>`;
  }

  function orderCard(o) {
    const phone = o.phone.replace(/^\+?88/, '');
    const hasCustom = o.items.some(l => l.custom);
    return `<details class="order st-${o.status}">
      <summary>
        <div class="o-main"><strong>${esc(o.order_no)}${hasCustom ? ' <b class="tag">Custom</b>' : ''}</strong><span class="muted">${fmtWhen(o.created_at)}</span></div>
        <div class="o-cust">${esc(o.name)}<span class="muted">${esc(phone)} ${histChip(o.history)}</span></div>
        <div class="o-total">${money(o.total)}<span class="muted">${o.payment === 'bkash_online' ? (o.paid ? '<b class="paid">bKash paid</b>' : 'bKash, not paid yet') : o.payment === 'bkash' ? 'bKash/Nagad' : 'COD'}</span></div>
        <span class="badge st-${o.status}">${stLabel(o.status)}</span>
      </summary>
      <div class="o-body">
        <div class="o-cols">
          <div>
            <h4>Customer</h4>
            <p>${esc(o.name)}<br><a href="tel:${esc(phone)}">${esc(phone)}</a><br>${esc(o.address)}</p>
            <p class="muted">${o.area === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'}</p>
            ${o.payment === 'bkash' || (o.payment === 'bkash_online' && o.paid) ? `<p><b>bKash${o.payment === 'bkash_online' ? ' (online)' : '/Nagad'} TrxID:</b> ${esc(o.trx)}</p>` : ''}
            <div class="fraud" data-fraud="${esc(phone)}"><button class="btn ghost sm" type="button">Check customer record</button></div>
            ${o.note ? `<p><b>Customer note:</b> ${esc(o.note)}</p>` : ''}
            ${o.consignment ? `<p class="courier-line"><b>Steadfast</b> #${esc(o.consignment)}${o.tracking_code ? ` · <a href="https://steadfast.com.bd/t/${esc(o.tracking_code)}" target="_blank" rel="noopener">${esc(o.tracking_code)}</a>` : ''}${o.courier_status ? ` · <span class="badge">${esc(o.courier_status.replace(/_/g, ' '))}</span>` : ''}</p>` : ''}
            <form class="note-form" data-id="${o.id}"><h4>Private note</h4><textarea name="note" rows="2" placeholder="Courier tracking number, call notes…">${esc(o.admin_note || '')}</textarea><button class="btn ghost sm" type="submit">Save note</button></form>
          </div>
          <div>
            <h4>Items</h4>
            <ul class="o-items">${o.items.map(itemHtml).join('')}</ul>
            <p class="o-sum"><span>Subtotal</span><span>${money(o.subtotal)}</span></p>
            <p class="o-sum"><span>Delivery</span><span>${money(o.delivery)}</span></p>
            ${o.bundle_off ? `<p class="o-sum disc"><span>Bundle offer</span><span>−${money(o.bundle_off)}</span></p>` : ''}
            ${o.discount ? `<p class="o-sum disc"><span>Coupon ${esc(o.coupon)}</span><span>−${money(o.discount)}</span></p>` : ''}
            <p class="o-sum total"><span>Total</span><span>${money(o.total)}</span></p>
          </div>
        </div>
        <div class="o-actions">
          <label>Status <select class="status-select" data-id="${o.id}" data-prev="${o.status}">${STATUSES.map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <a class="btn ghost sm" href="https://wa.me/88${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn ghost sm" href="tel:${esc(phone)}">Call</a>
          <button class="btn ghost sm" type="button" data-print="${o.id}">Print invoice</button>
          ${o.consignment ? `<button class="btn ghost sm" type="button" data-cstatus="${o.id}">Check courier status</button>`
            : o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn ghost sm" type="button" data-courier="${o.id}">Send to Steadfast</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost sm danger-t" type="button" data-odel="${o.id}">Delete order</button>
        </div>
      </div>
    </details>`;
  }

  function downloadCsv(orders) {
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Order', 'Date', 'Status', 'Name', 'Phone', 'Address', 'Area', 'Payment', 'TrxID', 'Items', 'Subtotal', 'Delivery', 'Discount', 'Coupon', 'Total', 'Customer note', 'Private note']];
    orders.forEach(o => rows.push([o.order_no, fmtWhen(o.created_at), o.status, o.name, o.phone, o.address, o.area, o.payment, o.trx, o.items.map(l => `${l.name} ${l.color} ${l.size} x${l.qty}`).join('; '), o.subtotal, o.delivery, o.discount || 0, o.coupon || '', o.total, o.note, o.admin_note]));
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `al-hadaf-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function printInvoice(o) {
    if (!o) return;
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print the invoice.', true);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.order_no)}</title><style>
      body{font-family:system-ui,sans-serif;color:#1A1A1A;max-width:720px;margin:32px auto;padding:0 20px;font-size:14px}
      header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A1A1A;padding-bottom:14px}
      img{height:56px}h1{font-size:22px;margin:0;font-weight:500}table{width:100%;border-collapse:collapse;margin-top:18px}
      th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #ddd;vertical-align:top}th{font-weight:500;color:#666;font-size:12px}
      .r{text-align:right}.tot td{font-weight:600;border-top:2px solid #1A1A1A}.muted{color:#666}.cols{display:flex;gap:40px;margin-top:18px}
      @media print{button{display:none}}</style></head><body>
      <header><img src="${location.origin}/logo-light.png" alt="Al Hadaf"><div class="r"><h1>Invoice</h1><div>${esc(o.order_no)}</div><div class="muted">${fmtWhen(o.created_at)}</div></div></header>
      <div class="cols"><div><div class="muted">Deliver to</div><strong>${esc(o.name)}</strong><br>${esc(o.phone)}<br>${esc(o.address)}<br>${o.area === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'}</div>
      <div><div class="muted">Payment</div>${o.payment === 'bkash' ? 'bKash/Nagad, TrxID ' + esc(o.trx) : 'Cash on delivery'}</div></div>
      <table><thead><tr><th>Item</th><th>Size</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>
      ${o.items.map(l => `<tr><td>${esc(l.name)}<div class="muted">${esc(l.custom ? (l.details.fabric + ', ' + l.details.options.map(x => x.choice).join(', ')) : l.code + ' · ' + l.color)}</div></td><td>${esc(l.size)}</td><td class="r">${l.qty}</td><td class="r">${num(l.price)}</td><td class="r">${num(l.price * l.qty)}</td></tr>`).join('')}
      <tr><td colspan="4" class="r">Subtotal</td><td class="r">${num(o.subtotal)}</td></tr>
      <tr><td colspan="4" class="r">Delivery</td><td class="r">${num(o.delivery)}</td></tr>
      ${o.discount ? `<tr><td colspan="4" class="r">Discount (${esc(o.coupon)})</td><td class="r">−${num(o.discount)}</td></tr>` : ''}
      <tr class="tot"><td colspan="4" class="r">Total (BDT)</td><td class="r">${num(o.total)}</td></tr></tbody></table>
      <p class="muted" style="margin-top:28px">Thank you for shopping with Al Hadaf. Jazakallahu khairan.</p>
      <button onclick="print()">Print</button><script>setTimeout(()=>print(),400)<\/script></body></html>`);
    w.document.close();
  }

  // ================= CHATS =================
  const QUICK = [
    'Assalamu alaikum! How can we help you?',
    'Please share your height and chest size, and we will suggest the right size.',
    'Your order is confirmed. It will reach you in 1–2 days inside Dhaka, 2–4 days outside.',
    'Please send your order number so we can check it.',
    'JazakAllahu khairan for shopping with Al Hadaf!'
  ];
  let chatList = [], chatOpen = 0, chatMsgs = [];

  async function viewChats(arg) {
    chatOpen = Number(arg) || 0;
    chatList = await api('chats');
    $('#main').innerHTML = `
      <div class="page-head"><h1>Chats</h1><span class="muted small">Customers chat from the button on the website. New messages also show in the menu.</span></div>
      <div class="chat-shell ${chatOpen ? 'has-open' : ''}">
        <aside class="chat-list" id="chatList"></aside>
        <section class="chat-view" id="chatView"><div class="chat-empty"><p>Select a chat to read and reply.</p></div></section>
      </div>`;
    drawChatList();
    if (chatOpen) await openAdminChat(chatOpen);
    const tick = async () => {
      if (!location.hash.startsWith('#chats')) return;
      try {
        if (!document.hidden) {
          chatList = await api('chats'); drawChatList();
          if (chatOpen) await refreshChat();
        }
      } catch (e) { /* ignore */ }
      viewTimer = setTimeout(tick, chatOpen ? 4000 : 10000);
    };
    viewTimer = setTimeout(tick, 4000);
  }

  function drawChatList() {
    const el = $('#chatList'); if (!el) return;
    el.innerHTML = chatList.length ? chatList.map(c => `<a href="#chats/${c.id}" class="cl-item ${c.id === chatOpen ? 'on' : ''} ${c.admin_unread ? 'unread' : ''} ${c.status === 'closed' ? 'closed' : ''}">
      <span class="cl-av">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</span>
      <span class="cl-main"><span class="cl-top"><strong>${esc(c.name)}</strong><time>${ago(c.updated_at)}</time></span><span class="cl-last">${esc(c.last_msg)}</span></span>
      ${c.admin_unread ? `<b class="nbadge">${c.admin_unread}</b>` : ''}</a>`).join('')
      : '<p class="empty">No chats yet. When a customer writes from the website, the chat appears here.</p>';
  }

  async function openAdminChat(id) {
    const d = await api('chats/' + id);
    chatMsgs = d.messages;
    const c = d.chat, phone = (c.phone || '').replace(/^\+?88/, '');
    $('#chatView').innerHTML = `
      <div class="cv-head">
        <a href="#chats" class="cv-back" aria-label="Back to chats">‹</a>
        <div class="cv-who"><strong>${esc(c.name)}</strong><span class="muted small">${phone ? esc(phone) + ' · ' : ''}started ${fmtWhen(c.created_at)}</span></div>
        <div class="cv-tools">
          ${phone ? `<a class="btn ghost sm" href="tel:${esc(phone)}">Call</a><a class="btn ghost sm" href="https://wa.me/88${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn ghost sm" id="cvStatus">${c.status === 'closed' ? 'Reopen' : 'Mark done'}</button>
          <button class="btn ghost sm danger-t" id="cvDel">Delete</button>
        </div>
      </div>
      ${d.orders.length ? `<div class="cv-orders">Orders from this number: ${d.orders.map(o => `<a href="#orders" data-q="${esc(o.order_no)}">${esc(o.order_no)}</a> <span class="badge st-${o.status}">${stLabel(o.status)}</span>`).join(' ')}</div>` : ''}
      <div class="cv-log" id="cvLog"></div>
      <div class="quick">${QUICK.map((q, i) => `<button type="button" data-quick="${i}">${esc(q.length > 38 ? q.slice(0, 36) + '…' : q)}</button>`).join('')}</div>
      <form class="cv-compose" id="cvCompose"><textarea name="body" rows="2" placeholder="Write a reply. Enter sends, Shift+Enter for a new line."></textarea><button class="btn primary" type="submit">Send</button></form>`;
    drawAdminLog();
    const form = $('#cvCompose');
    form.body.focus();
    form.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = form.body.value.trim(); if (!body) return;
      const btn = form.querySelector('button'); btn.disabled = true;
      try { await api('chats/' + id, { method: 'POST', body: { body } }); form.body.value = ''; await refreshChat(); chatList = await api('chats'); drawChatList(); }
      catch (err) { fail(err); }
      btn.disabled = false; form.body.focus();
    });
    $('#chatView').querySelector('.quick').addEventListener('click', e => {
      const b = e.target.closest('[data-quick]'); if (!b) return;
      form.body.value = QUICK[+b.dataset.quick]; form.body.focus();
    });
    $('#cvStatus').addEventListener('click', async () => {
      try { await api('chats/' + id, { method: 'PUT', body: { status: c.status === 'closed' ? 'open' : 'closed' } }); toast(c.status === 'closed' ? 'Chat reopened' : 'Chat marked done'); route(); } catch (err) { fail(err); }
    });
    $('#cvDel').addEventListener('click', async () => {
      if (!confirm('Delete this chat and all its messages?')) return;
      try { await api('chats/' + id, { method: 'DELETE' }); toast('Chat deleted'); location.hash = 'chats'; } catch (err) { fail(err); }
    });
    pollBadges();
  }

  async function refreshChat() {
    const last = chatMsgs.length ? chatMsgs[chatMsgs.length - 1].id : 0;
    const d = await api(`chats/${chatOpen}?after=${last}`);
    if (d.messages.length) { chatMsgs.push(...d.messages); drawAdminLog(); }
  }

  function drawAdminLog() {
    const log = $('#cvLog'); if (!log) return;
    let lastDay = '';
    log.innerHTML = chatMsgs.map(m => {
      const day = toDate(m.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long' });
      const sep = day !== lastDay ? `<p class="day">${day}</p>` : ''; lastDay = day;
      return `${sep}<div class="bubble ${m.sender === 'admin' ? 'me' : 'them'}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><time>${toDate(m.created_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })}</time></div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  // ================= CUSTOMERS (কে কতবার কিনেছে, অফার পাঠানো) =================
  let custQuery = '', custSeg = 'all', custSort = 'last', custSel = new Set(), custList = [];
  const DAY = 864e5;
  const SEGMENTS = [
    ['all', 'All', () => true],
    ['vip', 'VIP', c => c.delivered >= 3 || c.spent >= 10000],
    ['repeat', 'Bought 2+ times', c => c.orders - c.cancelled >= 2],
    ['once', 'Bought once', c => c.orders - c.cancelled === 1],
    ['custom', 'Custom thobe buyers', c => c.custom_orders > 0],
    ['inactive', 'No order in 90 days', c => Date.now() - toDate(c.last_order) > 90 * DAY],
    ['risk', 'Many cancels', c => c.cancelled >= 2 && c.cancelled >= c.delivered]
  ];
  const segOf = c => SEGMENTS.filter(([k, , f]) => k !== 'all' && k !== 'once' && f(c)).map(([k, l]) => `<b class="seg seg-${k}">${l}</b>`).join('');

  async function viewCustomers() {
    custList = await api('customers');
    custSel = new Set();
    drawCustomers();
  }
  function custFiltered() {
    const seg = SEGMENTS.find(s => s[0] === custSeg);
    const q = custQuery.toLowerCase();
    let list = custList.filter(c => (seg ? seg[2](c) : (c.tags || '').split(', ').includes(custSeg.slice(4))) &&
      (!q || (c.name || '').toLowerCase().includes(q) || c.phone.includes(q) || (c.tags || '').toLowerCase().includes(q)));
    const by = { last: (a, b) => toDate(b.last_order) - toDate(a.last_order), orders: (a, b) => b.orders - a.orders || b.spent - a.spent, spent: (a, b) => b.spent - a.spent, name: (a, b) => (a.name || '').localeCompare(b.name || '') }[custSort];
    return list.sort(by);
  }
  function drawCustomers() {
    const list = custFiltered();
    const tags = [...new Set(custList.flatMap(c => (c.tags || '').split(', ').filter(Boolean)))];
    const total = list.reduce((s, c) => s + c.spent, 0);
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Customers <span class="muted">${custList.length}</span></h1>
        <p class="muted">Everyone who has ordered, grouped by mobile number. Pick a group, tick customers and send them an offer.</p></div>
        <div class="head-tools"><button class="btn ghost sm" id="csvCust">Download CSV</button><button class="btn primary sm" id="smsBtn" ${custSel.size ? '' : 'disabled'}>Send SMS offer${custSel.size ? ` (${custSel.size})` : ''}</button></div></div>
      <div class="chips">${SEGMENTS.map(([k, l, f]) => `<button class="chip" data-seg="${k}" aria-pressed="${custSeg === k}">${l} <b>${custList.filter(f).length}</b></button>`).join('')}
        ${tags.map(tg => `<button class="chip tagchip" data-seg="tag:${esc(tg)}" aria-pressed="${custSeg === 'tag:' + tg}"># ${esc(tg)} <b>${custList.filter(c => (c.tags || '').split(', ').includes(tg)).length}</b></button>`).join('')}</div>
      <div class="filters"><input class="search" id="custSearch" type="search" placeholder="Search name, phone or tag" value="${esc(custQuery)}">
        <label class="date-f">Sort <select id="custSort">${[['last', 'Latest order'], ['orders', 'Most orders'], ['spent', 'Most spent'], ['name', 'Name']].map(([k, l]) => `<option value="${k}" ${custSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="muted small">${list.length} shown · ${money(total)} spent in total</span></div>
      ${list.length ? `<div class="card flush"><table class="tbl cust-tbl">
        <thead><tr><th class="ck"><input type="checkbox" id="selAll" aria-label="Select all shown" ${list.length && list.every(c => custSel.has(c.phone)) ? 'checked' : ''}></th><th>Customer</th><th class="r">Times bought</th><th class="r">Spent</th><th>Last order</th><th></th></tr></thead>
        <tbody>${list.slice(0, 500).map(c => `<tr class="${custSel.has(c.phone) ? 'sel' : ''}">
          <td class="ck"><input type="checkbox" data-sel="${c.phone}" ${custSel.has(c.phone) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></td>
          <td><button class="linklike" data-cust="${c.phone}"><strong>${esc(c.name)}</strong></button> ${segOf(c)}${(c.tags || '').split(', ').filter(Boolean).map(tg => `<b class="seg tag"># ${esc(tg)}</b>`).join('')}
            <span class="muted block">${esc(c.phone)} · ${esc((c.address || '').slice(0, 60))}</span></td>
          <td class="r"><strong class="big">${c.orders - c.cancelled}</strong><span class="muted block small">${c.delivered} delivered${c.cancelled ? ` · ${c.cancelled} cancelled` : ''}</span></td>
          <td class="r">${money(c.spent)}</td><td>${fmtWhen(c.last_order)}<span class="muted block small">${ago(c.last_order)}</span></td>
          <td class="r nowrap"><a class="btn ghost sm" href="tel:${esc(c.phone)}">Call</a> <a class="btn ghost sm" href="https://wa.me/88${esc(c.phone)}" target="_blank" rel="noopener">WhatsApp</a></td></tr>`).join('')}</tbody></table></div>
        ${list.length > 500 ? '<p class="muted small">Showing the first 500. Use search or a group to narrow down.</p>' : ''}`
        : '<p class="empty">No customers in this group yet.</p>'}
      <dialog class="adlg" id="custDlg"></dialog><dialog class="adlg" id="smsDlg"></dialog></div>`;

    const root = $('#main .vroot');
    let t;
    $('#custSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { custQuery = e.target.value.trim(); drawCustomers(); const s = $('#custSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 300); });
    $('#custSort').addEventListener('change', e => { custSort = e.target.value; drawCustomers(); });
    $('#csvCust').addEventListener('click', () => custCsv(custSel.size ? custList.filter(c => custSel.has(c.phone)) : list));
    $('#smsBtn').addEventListener('click', () => openSmsDialog(custList.filter(c => custSel.has(c.phone))));
    root.addEventListener('click', e => {
      const sg = e.target.closest('[data-seg]'); if (sg) { custSeg = sg.dataset.seg; custSel = new Set(); drawCustomers(); return; }
      const cu = e.target.closest('[data-cust]'); if (cu) openCustomer(cu.dataset.cust);
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'selAll') { list.forEach(c => (e.target.checked ? custSel.add(c.phone) : custSel.delete(c.phone))); drawCustomers(); return; }
      const sel = e.target.dataset.sel;
      if (sel) { e.target.checked ? custSel.add(sel) : custSel.delete(sel); e.target.closest('tr').classList.toggle('sel', e.target.checked);
        $('#smsBtn').disabled = !custSel.size; $('#smsBtn').textContent = 'Send SMS offer' + (custSel.size ? ` (${custSel.size})` : ''); }
    });
  }

  function custCsv(list) {
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Name', 'Phone', 'Phone (with 88)', 'Address', 'Times bought', 'Delivered', 'Cancelled', 'Spent', 'First order', 'Last order', 'Tags', 'Note']];
    list.forEach(c => rows.push([c.name, c.phone, '88' + c.phone, c.address, c.orders - c.cancelled, c.delivered, c.cancelled, c.spent, fmtWhen(c.first_order), fmtWhen(c.last_order), c.tags, c.note]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `al-hadaf-customers-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  async function openCustomer(phone) {
    const dlg = $('#custDlg');
    dlg.innerHTML = '<div class="adlg-body"><p class="muted">Loading…</p></div>'; dlg.showModal();
    const d = await api('customer?phone=' + phone).catch(e => { fail(e); dlg.close(); });
    if (!d) return;
    const c = custList.find(x => x.phone === phone) || {};
    dlg.innerHTML = `<div class="adlg-body">
      <div class="adlg-head"><div><h2>${esc(c.name)}</h2><p class="muted">${esc(phone)} · customer since ${fmtWhen(c.first_order)}</p></div><button class="icon" data-x aria-label="Close">×</button></div>
      <div class="cstats"><div><strong>${c.orders - c.cancelled}</strong><span>times bought</span></div><div><strong>${money(c.spent)}</strong><span>spent</span></div>
        <div><strong>${c.orders - c.cancelled ? money(Math.round(c.spent / (c.orders - c.cancelled))) : '—'}</strong><span>per order</span></div><div><strong>${c.cancelled}</strong><span>cancelled</span></div></div>
      <div class="row-btns"><a class="btn ghost sm" href="tel:${esc(phone)}">Call</a><a class="btn ghost sm" href="https://wa.me/88${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn ghost sm" id="cSms">Send SMS</button><div class="fraud" data-fraud="${esc(phone)}"><button class="btn ghost sm" type="button">Check courier record</button></div></div>
      <form id="noteForm" class="note-form"><div class="g2"><label class="field"><span>Tags <small>comma separated, like Eid buyer, wholesale</small></span><input name="tags" value="${esc(d.tags)}"></label>
        <label class="field"><span>Private note</span><input name="note" value="${esc(d.note)}" placeholder="Likes slim fit, calls after 6 pm…"></label></div>
        <button class="btn primary sm" type="submit">Save</button></form>
      ${d.profile && d.profile.meas ? `<p class="small"><b>Saved measurements:</b> ${esc(Object.entries(JSON.parse(d.profile.meas)).map(([k, v]) => `${k} ${v}`).join(', '))}</p>` : ''}
      <h3 class="sub">What they bought</h3>
      ${d.bought.length ? `<ul class="bought">${d.bought.map(b => `<li><span>${esc(b.name)}</span><b>× ${b.qty}</b></li>`).join('')}</ul>` : '<p class="muted">Nothing delivered yet.</p>'}
      <h3 class="sub">Orders</h3>
      <ul class="mini-list">${d.orders.map(o => `<li><a href="#orders" data-q="${esc(o.order_no)}"><span><strong>${esc(o.order_no)}</strong><span class="muted block">${fmtWhen(o.created_at)} · ${o.items.reduce((s, l) => s + l.qty, 0)} pcs${o.coupon ? ' · ' + esc(o.coupon) : ''}</span></span><span class="r">${money(o.total)}<span class="badge st-${o.status}">${stLabel(o.status)}</span></span></a></li>`).join('')}</ul>
    </div>`;
    dlg.querySelector('[data-x]').addEventListener('click', () => dlg.close());
    dlg.querySelector('.fraud button').addEventListener('click', e => runFraud(e.target.parentElement));
    $('#cSms').addEventListener('click', () => { dlg.close(); openSmsDialog([c]); });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); const a = e.target.closest('a[data-q]'); if (a) { orderQuery = a.dataset.q; orderFilter = ''; orderCustom = false; orderFrom = orderTo = ''; dlg.close(); } });
    $('#noteForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const r = await api('customer', { method: 'PUT', body: { phone, tags: e.target.tags.value, note: e.target.note.value } });
        c.tags = r.tags; c.note = e.target.note.value; toast('Customer saved'); dlg.close(); drawCustomers();
      } catch (err) { fail(err); }
    });
  }

  async function openSmsDialog(people) {
    const dlg = $('#smsDlg');
    const coupons = await api('coupons').catch(() => []);
    const live = coupons.filter(c => c.active);
    dlg.innerHTML = `<form class="adlg-body" id="smsForm">
      <div class="adlg-head"><div><h2>Send SMS offer</h2><p class="muted">To ${people.length} customer${people.length > 1 ? 's' : ''}</p></div><button type="button" class="icon" data-x aria-label="Close">×</button></div>
      ${integ.sms ? '' : '<p class="warn-box">SMS is not set up yet, so this cannot send. Add SMS_API_KEY and SMS_SENDER_ID in Cloudflare (see README). Meanwhile you can download these customers as CSV and use them in Facebook ads.</p>'}
      ${live.length ? `<label class="field"><span>Add a coupon <small>optional</small></span><select id="smsCoupon"><option value="">No coupon</option>${live.map(c => `<option value="${esc(c.code)}">${esc(c.code)} · ${couponText(c)}</option>`).join('')}</select></label>` : '<p class="muted small">Tip: create a coupon first (Marketing › Coupons) and add it to the message.</p>'}
      <label class="field"><span>Message <small>{name} becomes each customer’s first name</small></span>
        <textarea name="message" rows="5">Assalamu alaikum {name}, thank you for shopping with Al Hadaf. </textarea></label>
      <p class="muted small" id="smsCount"></p>
      <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary" type="submit" ${integ.sms ? '' : 'disabled'}>Send to ${people.length}</button></div>
      <p class="small" id="smsProg"></p></form>`;
    dlg.showModal();
    const f = $('#smsForm');
    const count = () => { const m = f.message.value, uni = /[^\x00-\x7F]/.test(m), per = uni ? 70 : 160, parts = Math.max(1, Math.ceil((m.length + 6) / per));
      $('#smsCount').textContent = `${m.length} letters · about ${parts} SMS each${uni ? ' (Bangla uses more SMS)' : ''} · about ${parts * people.length} SMS in total`; };
    f.message.addEventListener('input', count); count();
    const sc = $('#smsCoupon');
    if (sc) sc.addEventListener('change', () => { if (sc.value) { const c = live.find(x => x.code === sc.value); f.message.value = f.message.value.replace(/\s*Use code \S+.*$/, '') + ` Use code ${c.code} for ${couponText(c).toLowerCase()}${c.expires ? ' till ' + c.expires : ''}. ${location.origin}`; count(); } });
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!confirm(`Send this SMS to ${people.length} customer${people.length > 1 ? 's' : ''}?`)) return;
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      let sent = 0;
      for (let i = 0; i < people.length; i += 40) {
        $('#smsProg').textContent = `Sending ${Math.min(i + 40, people.length)} of ${people.length}…`;
        try { const r = await api('sms', { method: 'POST', body: { message: f.message.value, people: people.slice(i, i + 40).map(p => ({ phone: p.phone, name: p.name })) } }); sent += r.sent; }
        catch (err) { fail(err); break; }
      }
      $('#smsProg').textContent = `${sent} of ${people.length} SMS sent.`;
      toast(`${sent} SMS sent`);
    });
  }

  // ================= UNFINISHED ORDERS (চেকআউটে নম্বর দিয়ে অর্ডার করেনি) =================
  async function viewAbandoned() {
    const list = await api('abandoned');
    const open = list.filter(a => a.status === 'open' || a.status === 'contacted');
    const tmpl = a => `Assalamu alaikum ${(a.name || '').split(' ')[0]}, this is Al Hadaf. We saw you were ordering ${a.items.map(i => i.name).join(', ')}. Can we help you finish the order?`;
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Unfinished orders <span class="muted">${open.length}</span></h1>
        <p class="muted">People who typed their mobile number at checkout but did not place the order. A friendly call or WhatsApp often brings them back.</p></div></div>
      ${list.length ? `<div class="ab-list">${list.map(a => `<article class="card ab ${a.status}">
        <div class="ab-head"><div><strong>${esc(a.name || 'No name')}</strong> <span class="muted">${esc(a.phone)}</span>
          <span class="muted block small">${ago(a.updated_at)} · ${a.area === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'}${a.address ? ' · ' + esc(a.address.slice(0, 60)) : ''}</span></div>
          <span class="badge ${a.status === 'recovered' ? 'st-delivered' : a.status === 'contacted' ? 'st-confirmed' : a.status === 'dismissed' ? '' : 'st-new'}">${{ open: 'Not contacted', contacted: 'Contacted', recovered: 'Ordered later', dismissed: 'Dismissed' }[a.status]}</span></div>
        <ul class="o-items">${a.items.map(i => `<li><span>${esc(i.name)} · ${esc(i.size)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}</ul>
        <p class="o-sum total"><span>Cart value</span><span>${money(a.subtotal)}</span></p>
        ${a.status !== 'recovered' ? `<div class="o-actions"><a class="btn ghost sm" href="tel:${esc(a.phone)}">Call</a>
          <a class="btn ghost sm" href="https://wa.me/88${esc(a.phone)}?text=${encodeURIComponent(tmpl(a))}" target="_blank" rel="noopener">WhatsApp</a>
          ${a.status !== 'contacted' ? `<button class="btn ghost sm" data-ab="${a.id}" data-s="contacted">Mark contacted</button>` : ''}
          ${a.status !== 'dismissed' ? `<button class="btn ghost sm" data-ab="${a.id}" data-s="dismissed">Dismiss</button>` : `<button class="btn ghost sm" data-ab="${a.id}" data-s="open">Restore</button>`}
          <span class="spacer"></span><button class="btn ghost sm danger-t" data-abdel="${a.id}">Delete</button></div>` : ''}
      </article>`).join('')}</div>` : '<p class="empty">Nothing here. When someone leaves at checkout after typing their number, they show up here.</p>'}</div>`;
    $('#main .vroot').addEventListener('click', async e => {
      const b = e.target.closest('[data-ab]'), d = e.target.closest('[data-abdel]');
      try {
        if (b) await api('abandoned/' + b.dataset.ab, { method: 'PUT', body: { status: b.dataset.s } });
        else if (d && confirm('Delete this entry?')) await api('abandoned/' + d.dataset.abdel, { method: 'DELETE' });
        else return;
        viewAbandoned().catch(fail); pollBadges();
      } catch (err) { fail(err); }
    });
  }

  // ================= BANNERS (হোম পেজের বড় স্লাইড) =================
  async function viewBanners() {
    const list = await api('banners');
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Banners</h1><p class="muted">Big photos that slide at the top of the home page. Use wide photos, at least 1600 pixels across. Without banners the site shows the logo hero.</p></div>
        <label class="upload"><input type="file" id="bnUp" accept="image/*" hidden><span class="btn primary">Add banner</span></label></div>
      <p class="muted small" id="bnStatus"></p>
      ${list.length ? `<div class="bn-list">${list.map(b => `<form class="card bn" data-id="${b.id}" data-image="${esc(b.image)}">
        <div class="bn-img"><img src="/img/${esc(b.image)}" alt=""><label class="upload bn-change"><input type="file" accept="image/*" hidden data-change><span>Change photo</span></label></div>
        <div class="bn-fields">
          <div class="g2"><label class="field"><span>Heading (English)</span><input name="title_en" value="${esc(b.title_en)}" placeholder="Eid collection is here"></label>
            <label class="field"><span>শিরোনাম (বাংলা)</span><input name="title_bn" value="${esc(b.title_bn)}" placeholder="ঈদ কালেকশন চলে এসেছে"></label></div>
          <div class="g2"><label class="field"><span>Short line (English)</span><input name="text_en" value="${esc(b.text_en)}"></label>
            <label class="field"><span>ছোট লাইন (বাংলা)</span><input name="text_bn" value="${esc(b.text_bn)}"></label></div>
          <div class="g3"><label class="field"><span>Button (English)</span><input name="btn_en" value="${esc(b.btn_en)}" placeholder="Shop now"></label>
            <label class="field"><span>বাটন (বাংলা)</span><input name="btn_bn" value="${esc(b.btn_bn)}" placeholder="এখনই দেখুন"></label>
            <label class="field"><span>Button goes to</span><input name="link" value="${esc(b.link)}" placeholder="#/c/thobe" list="bnLinks"></label></div>
          <div class="row-btns"><label class="check"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Show</label>
            <label class="date-f">Order <input name="sort" type="number" value="${b.sort}" class="num" style="width:70px"></label><span class="spacer"></span>
            <button type="button" class="btn ghost sm danger-t" data-del>Delete</button><button class="btn primary sm" type="submit">Save banner</button></div>
        </div></form>`).join('')}</div>` : '<p class="empty">No banners yet. Add an Eid or new-collection photo to make the home page come alive.</p>'}
      <datalist id="bnLinks"><option value="#/c/all"><option value="#/custom"><option value="#/gallery"></datalist></div>`;
    api('categories').then(cs => { $('#bnLinks').insertAdjacentHTML('beforeend', cs.map(c => `<option value="#/c/${esc(c.slug)}">`).join('')); }).catch(() => {});
    $('#bnUp').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      $('#bnStatus').textContent = 'Uploading…';
      try { const key = await uploadFile(file, 2000); await api('banners', { method: 'POST', body: { image: key, active: true, sort: list.length } }); toast('Banner added. Add a heading and save.'); viewBanners().catch(fail); }
      catch (err) { fail(err); $('#bnStatus').textContent = ''; }
    });
    $('#main').querySelectorAll('.bn').forEach(fm => {
      fm.querySelector('[data-change]').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { toast('Uploading…'); fm.dataset.image = await uploadFile(file, 2000); fm.querySelector('.bn-img img').src = '/img/' + fm.dataset.image; toast('Photo changed. Save the banner to keep it.'); } catch (err) { fail(err); }
      });
      fm.addEventListener('submit', async e => {
        e.preventDefault();
        const body = { ...Object.fromEntries(new FormData(fm)), active: fm.active.checked, image: fm.dataset.image };
        try { await api('banners/' + fm.dataset.id, { method: 'PUT', body }); toast('Banner saved'); } catch (err) { fail(err); }
      });
      fm.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Delete this banner?')) return;
        try { await api('banners/' + fm.dataset.id, { method: 'DELETE' }); toast('Banner deleted'); viewBanners().catch(fail); } catch (err) { fail(err); }
      });
    });
  }

  // ================= PRODUCTS =================
  async function loadCatalog() {
    [categories, products] = await Promise.all([api('categories'), api('products')]);
  }

  async function viewProducts() {
    const [, alerts] = await Promise.all([loadCatalog(), api('stock-alerts').catch(() => [])]);
    const waiting = code => alerts.filter(a => a.product_code === code).reduce((s, a) => s + a.n, 0);
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
          <div class="pstock ${stock === 0 ? 'zero' : stock <= 5 ? 'low' : ''}">${stock} in stock${out ? `<span class="muted">${out} size${out > 1 ? 's' : ''} sold out</span>` : ''}${waiting(p.code) ? `<span class="waiting">${waiting(p.code)} waiting for restock</span>` : ''}</div>
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
        const r = await api(isNew ? 'products' : 'products/' + p.id, { method: isNew ? 'POST' : 'PUT', body });
        toast(r.notified ? `Changes saved. ${r.notified} customer${r.notified > 1 ? 's' : ''} will get a back-in-stock SMS.` : isNew ? 'Product added' : 'Changes saved');
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
  async function compress(file, max = 1600) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
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

  // ================= TAILORING (নিজের মাপে জুব্বা) =================
  async function viewCustom() {
    const [cfg, fabrics] = await Promise.all([api('custom'), api('fabrics')]);
    let groups = JSON.parse(JSON.stringify(cfg.groups));
    const minFab = fabrics.filter(f => f.active).reduce((m, f) => Math.min(m, f.price_add), Infinity);
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Tailoring</h1><p class="muted">Customers design a thobe on the website: fabric, style and their own measurements. You set the prices here.</p></div>
        <a class="btn ghost" href="/#/custom" target="_blank" rel="noopener">See it on the website</a></div>
      <form id="cfgForm" class="editor">
        <section class="card">
          <h2>Price and timing</h2>
          <div class="g3">
            <label class="field"><span>Tailoring price (BDT) <small>before fabric and extras</small></span><input name="base_price" type="number" min="0" value="${cfg.base_price}"></label>
            <label class="field"><span>Ready in (days) <small>shown to customers</small></span><input name="lead_days" type="number" min="1" value="${cfg.lead_days}"></label>
            <div class="checks"><label class="check"><input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''}> Take custom orders</label>
              <span class="muted small">Cheapest custom thobe now: ${Number.isFinite(minFab) ? money(cfg.base_price + minFab) : 'add a fabric first'}</span></div>
          </div>
          <label class="field"><span>Standard sizes <small>comma separated, for customers who choose a size instead of measurements</small></span><input name="sizes" value="${esc(cfg.sizes.join(', '))}"></label>
        </section>
        <section class="card">
          <h2>Style options</h2>
          <p class="muted small">Each group is one choice the customer makes. The first option in each group is selected by default. “Extra” is added to the price.</p>
          <div id="groupsEd"></div>
          <button type="button" class="btn ghost sm" id="addGroup">Add option group</button>
        </section>
        <div class="save-bar"><span class="spacer"></span><button class="btn primary" type="submit">Save tailoring settings</button></div>
      </form>
      <section class="card">
        <div class="card-head"><h2>Fabrics <span class="muted">${fabrics.length}</span></h2><button class="btn primary sm" id="addFabric">Add fabric</button></div>
        <p class="muted small">Add a close-up photo of each fabric so customers can see the texture. “Extra” is added to the tailoring price.</p>
        <div class="fab-list" id="fabList">${fabrics.map(fabricRow).join('') || '<p class="muted">No fabrics yet. Customers need at least one fabric to order.</p>'}</div>
        <div id="fabEditor"></div>
      </section>`;

    function drawGroups() {
      $('#groupsEd').innerHTML = groups.map((g, gi) => `<div class="grp">
        <div class="grp-head">
          <input data-g="${gi}" data-k="name_en" value="${esc(g.name_en)}" placeholder="Group name (English)" aria-label="Group name English">
          <input data-g="${gi}" data-k="name_bn" value="${esc(g.name_bn)}" placeholder="গ্রুপের নাম (বাংলা)" aria-label="Group name Bangla">
          <button type="button" class="icon" data-gmv="${gi}" data-d="-1" ${gi === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="icon" data-gdel="${gi}" aria-label="Remove group">×</button>
        </div>
        <div class="opt-head"><span>Option (English)</span><span>বাংলা</span><span>Extra (BDT)</span><span></span></div>
        ${g.options.map((o, oi) => `<div class="opt-row">
          <input data-g="${gi}" data-o="${oi}" data-k="en" value="${esc(o.en)}" aria-label="Option English">
          <input data-g="${gi}" data-o="${oi}" data-k="bn" value="${esc(o.bn)}" aria-label="Option Bangla">
          <input data-g="${gi}" data-o="${oi}" data-k="add" type="number" min="0" value="${o.add}" aria-label="Extra price">
          <button type="button" class="icon" data-odel="${gi}:${oi}" aria-label="Remove option">×</button></div>`).join('')}
        <button type="button" class="text-btn" data-oadd="${gi}">+ Add option</button>
      </div>`).join('');
    }
    const ed = $('#groupsEd');
    ed.addEventListener('input', e => {
      const el = e.target, gi = el.dataset.g; if (gi == null) return;
      if (el.dataset.o != null) groups[gi].options[el.dataset.o][el.dataset.k] = el.dataset.k === 'add' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
      else groups[gi][el.dataset.k] = el.value;
    });
    ed.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.gdel != null && confirm('Remove this option group?')) groups.splice(+b.dataset.gdel, 1);
      if (b.dataset.gmv != null) { const i = +b.dataset.gmv; [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]; }
      if (b.dataset.odel) { const [g, o] = b.dataset.odel.split(':').map(Number); groups[g].options.splice(o, 1); }
      if (b.dataset.oadd != null) groups[+b.dataset.oadd].options.push({ en: '', bn: '', add: 0 });
      drawGroups();
    });
    $('#addGroup').addEventListener('click', () => { groups.push({ key: 'opt' + Date.now().toString(36), name_en: '', name_bn: '', options: [{ en: '', bn: '', add: 0 }] }); drawGroups(); });
    drawGroups();

    $('#cfgForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const body = { enabled: f.enabled.checked, base_price: f.base_price.value, lead_days: f.lead_days.value, sizes: f.sizes.value.split(','), groups };
      try { await api('custom', { method: 'PUT', body }); toast('Tailoring settings saved'); viewCustom().catch(fail); } catch (err) { fail(err); }
    });

    const openFabric = f => {
      let image = f.image || '';
      $('#fabEditor').innerHTML = `<form class="fab-form" id="fabForm">
        <h3 class="sub">${f.id ? 'Edit fabric' : 'New fabric'}</h3>
        <div class="fab-grid">
          <div><div class="fab-img" id="fabImg" style="--c:${esc(f.color_hex || '#F2F0EA')}">${image ? `<img src="/img/${esc(image)}" alt="">` : ''}</div>
            <label class="upload"><input type="file" id="fabUp" accept="image/*" hidden><span>${image ? 'Change photo' : 'Add photo'}</span></label>
            ${image ? '<button type="button" class="text-btn" id="fabRm">Remove photo</button>' : ''}</div>
          <div>
            <div class="g2"><label class="field"><span>Name (English)</span><input name="name_en" value="${esc(f.name_en || '')}" required></label>
              <label class="field"><span>নাম (বাংলা)</span><input name="name_bn" value="${esc(f.name_bn || '')}"></label></div>
            <div class="g2"><label class="field"><span>Short description (English)</span><textarea name="desc_en" rows="2">${esc(f.desc_en || '')}</textarea></label>
              <label class="field"><span>বর্ণনা (বাংলা)</span><textarea name="desc_bn" rows="2">${esc(f.desc_bn || '')}</textarea></label></div>
            <div class="g3"><label class="field"><span>Extra price (BDT)</span><input name="price_add" type="number" min="0" value="${f.price_add || 0}"></label>
              <label class="field"><span>GSM <small>optional</small></span><input name="gsm" type="number" min="0" value="${f.gsm == null ? '' : f.gsm}"></label>
              <label class="field"><span>Colour</span><input name="color_hex" type="color" value="${esc(f.color_hex || '#F2F0EA')}"></label></div>
            <div class="g3"><label class="field"><span>Display order</span><input name="sort" type="number" value="${f.sort || 0}"></label>
              <div class="checks"><label class="check"><input type="checkbox" name="active" ${f.active === 0 ? '' : 'checked'}> Show to customers</label></div></div>
            <div class="row-btns">${f.id ? '<button type="button" class="btn danger sm" id="fabDel">Delete fabric</button>' : ''}<span class="spacer"></span>
              <button type="button" class="btn ghost sm" id="fabCancel">Cancel</button><button class="btn primary sm" type="submit">${f.id ? 'Save fabric' : 'Add fabric'}</button></div>
          </div>
        </div></form>`;
      const form = $('#fabForm');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const drawImg = () => { $('#fabImg').innerHTML = image ? `<img src="/img/${esc(image)}" alt="">` : ''; };
      $('#fabUp').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { toast('Uploading photo…'); image = await uploadFile(file); drawImg(); toast('Photo added. Save the fabric to keep it.'); } catch (err) { fail(err); }
      });
      const rm = $('#fabRm'); if (rm) rm.addEventListener('click', () => { image = ''; drawImg(); });
      $('#fabCancel').addEventListener('click', () => { $('#fabEditor').innerHTML = ''; });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const body = { ...Object.fromEntries(new FormData(form)), active: form.active.checked, image };
        try { await api('fabrics' + (f.id ? '/' + f.id : ''), { method: f.id ? 'PUT' : 'POST', body }); toast('Fabric saved'); viewCustom().catch(fail); } catch (err) { fail(err); }
      });
      const del = $('#fabDel');
      if (del) del.addEventListener('click', async () => {
        if (!confirm(`Delete “${f.name_en}”? Past orders keep their fabric name.`)) return;
        try { await api('fabrics/' + f.id, { method: 'DELETE' }); toast('Fabric deleted'); viewCustom().catch(fail); } catch (err) { fail(err); }
      });
    };
    $('#addFabric').addEventListener('click', () => openFabric({}));
    $('#fabList').addEventListener('click', e => { const r = e.target.closest('[data-fab]'); if (r) openFabric(fabrics.find(f => f.id === +r.dataset.fab)); });
  }
  const fabricRow = f => `<button type="button" class="fab-row ${f.active ? '' : 'inactive'}" data-fab="${f.id}">
    <span class="pthumb" style="--c:${esc(f.color_hex)}">${f.image ? `<img src="/img/${esc(f.image)}" alt="" loading="lazy">` : ''}</span>
    <span class="pinfo"><strong>${esc(f.name_en)}</strong><span class="muted">${esc(f.name_bn)}${f.gsm ? ' · GSM ' + f.gsm : ''}</span></span>
    <span>${f.price_add ? '+' + money(f.price_add) : 'No extra'}</span>
    <span>${f.active ? '<span class="badge st-delivered">Live</span>' : '<span class="badge">Hidden</span>'}</span></button>`;

  // ================= GALLERY =================
  async function viewGallery() {
    const list = await api('gallery');
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Gallery <span class="muted">${list.length}</span></h1><p class="muted">Customer photos, Eid looks, the workshop. They show on the home page and on the Gallery page.</p></div>
        <label class="upload"><input type="file" id="galUp" accept="image/*" multiple hidden><span class="btn primary">Upload photos</span></label></div>
      <p class="muted small" id="galStatus"></p>
      ${list.length ? `<div class="gal-grid">${list.map(g => `<form class="gal-card" data-id="${g.id}">
        <div class="gal-img"><img src="/img/${esc(g.image)}" alt="" loading="lazy"></div>
        <input name="caption_en" value="${esc(g.caption_en)}" placeholder="Caption (English)" aria-label="Caption English">
        <input name="caption_bn" value="${esc(g.caption_bn)}" placeholder="ক্যাপশন (বাংলা)" aria-label="Caption Bangla">
        <div class="gal-row"><input name="product_code" value="${esc(g.product_code)}" placeholder="Product code" aria-label="Link to product code" list="codes">
          <input name="sort" type="number" value="${g.sort}" aria-label="Order" title="Display order, lower shows first" class="num"></div>
        <div class="gal-row"><button class="btn ghost sm danger-t" type="button" data-del>Delete</button><button class="btn primary sm" type="submit">Save</button></div>
      </form>`).join('')}</div>` : '<p class="empty">No photos yet. Upload a few to start the gallery. Customers wearing your thobes work best.</p>'}
      <datalist id="codes"></datalist>`;
    api('products').then(ps => { $('#codes').innerHTML = ps.map(p => `<option value="${esc(p.code)}">${esc(p.name_en)}</option>`).join(''); }).catch(() => {});
    $('#galUp').addEventListener('change', async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (let i = 0; i < files.length; i++) {
        $('#galStatus').textContent = `Uploading photo ${i + 1} of ${files.length}…`;
        try { const key = await uploadFile(files[i]); await api('gallery', { method: 'POST', body: { image: key, sort: 0 } }); } catch (err) { fail(err); }
      }
      toast(files.length > 1 ? 'Photos added' : 'Photo added'); viewGallery().catch(fail);
    });
    $('#main').querySelectorAll('.gal-card').forEach(fm => {
      fm.addEventListener('submit', async e => {
        e.preventDefault();
        try { await api('gallery/' + fm.dataset.id, { method: 'PUT', body: Object.fromEntries(new FormData(fm)) }); toast('Photo saved'); } catch (err) { fail(err); }
      });
      fm.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Delete this photo from the gallery?')) return;
        try { await api('gallery/' + fm.dataset.id, { method: 'DELETE' }); toast('Photo deleted'); viewGallery().catch(fail); } catch (err) { fail(err); }
      });
    });
  }

  // ================= SHOP INFO =================
  async function viewSettings() {
    const s = await api('settings');
    await pollBadges();
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
            ${f('email', 'Email', { type: 'email', hint: 'optional', ph: 'info@alhadaf.com' })}
          </div>
        </section>
        <section class="card"><h2>Social media</h2>
          <p class="muted small">Paste the full link. Each one shows as an icon in the footer, menu and contact page. Leave empty to hide.</p>
          <div class="g2">
            ${f('facebook', 'Facebook page', { ph: 'https://facebook.com/alhadaf' })}
            ${f('messenger', 'Messenger', { hint: 'm.me link', ph: 'https://m.me/alhadaf' })}
            ${f('instagram', 'Instagram', { ph: 'https://instagram.com/alhadaf' })}
            ${f('youtube', 'YouTube', { ph: 'https://youtube.com/@alhadaf' })}
            ${f('tiktok', 'TikTok', { ph: 'https://tiktok.com/@alhadaf' })}
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
        <section class="card"><h2>Bundle offer</h2>
          <p class="muted small">Automatic discount when a customer buys several pieces together, like “Buy 2, save 10%”. It shows on product pages and in the cart. Set either box to 0 to turn it off.</p>
          <div class="g2">${f('bundle_min', 'Minimum pieces', { type: 'number', ph: '2' })}${f('bundle_pct', 'Discount (%)', { type: 'number', hint: 'up to 50', ph: '10' })}</div>
        </section>
        <section class="card"><h2>Online payment and logins</h2>
          <ul class="integ">
            <li>${integ.bkash ? '<span class="badge st-delivered">Connected</span>' : '<span class="badge">Not set up</span>'} <b>bKash online payment.</b> Customers pay inside bKash at checkout, no Transaction ID needed. Needs BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD and BKASH_MODE=live from your bKash merchant account.</li>
            <li>${integ.sms ? '<span class="badge st-delivered">On</span>' : '<span class="badge">Off</span>'} <b>Customer login.</b> Works when SMS is set up: customers log in with a code sent to their phone.</li>
            <li>${integ.bdcourier ? '<span class="badge st-delivered">Connected</span>' : '<span class="badge">Not set up</span>'} <b>Courier fraud check.</b> Shows how often a number received or returned parcels across all couriers. Needs BDCOURIER_API_KEY from bdcourier.com.</li>
          </ul>
        </section>
        <section class="card"><h2>Facebook Pixel</h2>
          <p class="muted small">Paste the Pixel ID from Facebook Events Manager (numbers only). The website then reports page views, product views, add to cart, checkout and purchases, so your Facebook ads can find more buyers.</p>
          <div class="g2">${f('fb_pixel', 'Pixel ID', { ph: '123456789012345' })}</div>
        </section>
        <section class="card"><h2>SMS to customers</h2>
          <p class="muted small">${integ.sms ? '<span class="badge st-delivered">Connected</span> ' : '<span class="badge">Not set up</span> '}Sends an SMS from bulksmsbd.net when the order status changes. Add <b>SMS_API_KEY</b> and <b>SMS_SENDER_ID</b> as secrets in Cloudflare. Steps are in the README.</p>
          <div class="checks-row">
            ${[['sms_new', 'Order received'], ['sms_confirmed', 'Order confirmed'], ['sms_shipped', 'Order shipped'], ['sms_delivered', 'Order delivered']].map(([k, l]) => `<label class="check"><input type="checkbox" data-flag="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`).join('')}
          </div>
        </section>
        <section class="card"><h2>Courier</h2>
          <p class="muted small">${integ.steadfast ? '<span class="badge st-delivered">Steadfast connected</span> ' : '<span class="badge">Not set up</span> '}With Steadfast connected, each order gets a “Send to Steadfast” button that books the parcel and saves the tracking number. Add <b>STEADFAST_API_KEY</b> and <b>STEADFAST_SECRET_KEY</b> as secrets in Cloudflare (ask Steadfast support for your API keys).</p>
        </section>
        <section class="card"><h2>Phone notifications</h2>
          <p class="muted small">Get a Telegram message on your phone for every new order and chat. Create a bot with @BotFather, then add two secrets in Cloudflare (Worker › Settings › Variables and Secrets): <b>TELEGRAM_BOT_TOKEN</b> and <b>TELEGRAM_CHAT_ID</b>. Full steps are in the README.</p>
        </section>
        <div class="save-bar"><span class="spacer"></span><button class="btn primary" type="submit">Save shop info</button></div>
      </form>`;
    $('#sForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      e.target.querySelectorAll('[data-flag]').forEach(c => { body[c.dataset.flag] = c.checked ? '1' : ''; });
      try { await api('settings', { method: 'PUT', body }); toast('Shop info saved'); } catch (err) { fail(err); }
    });
  }

  // ================= COUPONS =================
  const couponText = c => c.kind === 'percent' ? `${c.value}% off` : c.kind === 'fixed' ? `${money(c.value)} off` : 'Free delivery';
  async function viewCoupons() {
    const list = await api('coupons');
    const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
    const state = c => !c.active ? ['Paused', ''] : c.expires && c.expires < today ? ['Expired', 'st-cancelled'] : c.max_uses && c.used >= c.max_uses ? ['Used up', 'st-cancelled'] : ['Active', 'st-delivered'];
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Coupons</h1><p class="muted">Codes customers type at checkout. Share them on Facebook, in SMS or on the parcel.</p></div><button class="btn primary" id="newCoupon">New coupon</button></div>
      <div id="couponEd"></div>
      ${list.length ? `<div class="card flush"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th class="r">Used</th><th>Ends</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(c => { const [l, cls] = state(c); return `<tr><td><strong class="code">${esc(c.code)}</strong></td><td>${couponText(c)}</td><td>${c.min_order ? money(c.min_order) : '—'}</td>
          <td class="r">${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}</td><td>${c.expires || 'No end date'}</td><td><span class="badge ${cls}">${l}</span></td>
          <td class="r nowrap"><button class="btn ghost sm" data-cedit="${c.id}">Edit</button> <button class="btn ghost sm danger-t" data-cdel="${c.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="empty">No coupons yet. Try one for Eid, like EID10 for 10% off.</p>'}</div>`;
    const open = c => {
      $('#couponEd').innerHTML = `<form class="card" id="cForm">
        <h2>${c.id ? 'Edit coupon' : 'New coupon'}</h2>
        <div class="g3">
          <label class="field"><span>Code <small>letters and numbers</small></span><input name="code" value="${esc(c.code || '')}" placeholder="EID10" required style="text-transform:uppercase"></label>
          <label class="field"><span>Type</span><select name="kind">${[['percent', 'Percent off'], ['fixed', 'Fixed amount off'], ['free_ship', 'Free delivery']].map(([k, l]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" id="cVal"><span>Discount <small id="cValHint"></small></span><input name="value" type="number" min="0" value="${c.value || ''}"></label>
        </div>
        <div class="g3">
          <label class="field"><span>Minimum order (BDT) <small>0 for none</small></span><input name="min_order" type="number" min="0" value="${c.min_order || 0}"></label>
          <label class="field"><span>How many times <small>0 for unlimited</small></span><input name="max_uses" type="number" min="0" value="${c.max_uses || 0}"></label>
          <label class="field"><span>Last day <small>optional</small></span><input name="expires" type="date" value="${esc(c.expires || '')}"></label>
        </div>
        <div class="row-btns"><label class="check"><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}> Active</label><span class="spacer"></span>
          <button type="button" class="btn ghost sm" id="cCancel">Cancel</button><button class="btn primary sm" type="submit">${c.id ? 'Save coupon' : 'Create coupon'}</button></div>
      </form>`;
      const f = $('#cForm');
      const kind = () => { const k = f.kind.value; $('#cVal').hidden = k === 'free_ship'; $('#cValHint').textContent = k === 'percent' ? '% (1–90)' : 'BDT'; };
      f.kind.addEventListener('change', kind); kind();
      f.code.focus();
      $('#cCancel').addEventListener('click', () => { $('#couponEd').innerHTML = ''; });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const body = { ...Object.fromEntries(new FormData(f)), active: f.active.checked };
        try { await api('coupons' + (c.id ? '/' + c.id : ''), { method: c.id ? 'PUT' : 'POST', body }); toast('Coupon saved'); viewCoupons().catch(fail); } catch (err) { fail(err); }
      });
    };
    $('#newCoupon').addEventListener('click', () => open({}));
    $('#main .vroot').addEventListener('click', async e => {
      const ed = e.target.closest('[data-cedit]'), del = e.target.closest('[data-cdel]');
      if (ed) open(list.find(c => c.id === +ed.dataset.cedit));
      if (del && confirm('Delete this coupon? Orders that used it keep their discount.')) {
        try { await api('coupons/' + del.dataset.cdel, { method: 'DELETE' }); toast('Coupon deleted'); viewCoupons().catch(fail); } catch (err) { fail(err); }
      }
    });
  }

  // ================= REVIEWS =================
  async function viewReviews() {
    const list = await api('reviews');
    const pending = list.filter(r => r.status === 'pending').length;
    const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Reviews ${pending ? `<span class="muted">${pending} waiting</span>` : ''}</h1><p class="muted">Customers write reviews on product pages. They show on the website only after you approve them.</p></div></div>
      ${list.length ? `<div class="rv-admin">${list.map(r => `<article class="card rv-card ${r.status}">
        <div class="rv-h"><span class="rv-st" aria-label="${r.rating} stars">${stars(r.rating)}</span><strong>${esc(r.name)}</strong>${r.verified ? '<b class="tag ok">Verified buyer</b>' : ''}
          <span class="badge ${r.status === 'approved' ? 'st-delivered' : r.status === 'pending' ? 'st-new' : ''}">${r.status === 'approved' ? 'On website' : r.status === 'pending' ? 'Waiting' : 'Hidden'}</span></div>
        <p class="muted small">${esc(r.name_en || r.product_code)} · ${esc(r.product_code)} · ${fmtWhen(r.created_at)}${r.phone ? ' · ' + esc(r.phone) : ''}</p>
        ${r.body ? `<p>${esc(r.body)}</p>` : ''}
        <div class="row-btns">${r.status !== 'approved' ? `<button class="btn primary sm" data-rv="${r.id}" data-s="approved">Approve</button>` : `<button class="btn ghost sm" data-rv="${r.id}" data-s="hidden">Hide</button>`}
          <button class="btn ghost sm danger-t" data-rvdel="${r.id}">Delete</button></div>
      </article>`).join('')}</div>` : '<p class="empty">No reviews yet. After delivery, ask customers to review on the website. The “Order delivered” SMS does this for you.</p>'}</div>`;
    $('#main .vroot').addEventListener('click', async e => {
      const b = e.target.closest('[data-rv]'), d = e.target.closest('[data-rvdel]');
      try {
        if (b) { await api('reviews/' + b.dataset.rv, { method: 'PUT', body: { status: b.dataset.s } }); toast(b.dataset.s === 'approved' ? 'Review approved' : 'Review hidden'); }
        else if (d && confirm('Delete this review?')) { await api('reviews/' + d.dataset.rvdel, { method: 'DELETE' }); toast('Review deleted'); }
        else return;
        viewReviews().catch(fail); pollBadges();
      } catch (err) { fail(err); }
    });
  }

  // ---------- start ----------
  api('me').then(showApp).catch(e => { if (e.message !== 'auth') showLogin(); });
})();
