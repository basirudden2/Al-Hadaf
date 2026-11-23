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

  let orderChannel = '', orderDue = false;
  const CH = { website: 'Website', shop: 'Shop', facebook: 'Facebook', whatsapp: 'WhatsApp', phone: 'Phone', other: 'Other' };
  const dueOf = o => o.delivery_mode === 'handover' && o.status !== 'cancelled' ? Math.max(0, o.total - (o.paid_amount || 0)) : 0;
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
    const key = (await api('upload', { method: 'POST', body: blob, headers: { 'content-type': blob.type } })).key;
    makeThumb(file, key).catch(() => {}); // মোবাইলে দ্রুত দেখানোর জন্য ছোট কপি
    return key;
  }
  async function makeThumb(fileOrBlob, key) {
    const small = await compress(fileOrBlob, 600, 0.78);
    await api('upload', { method: 'POST', body: small, headers: { 'content-type': small.type, 'x-thumb-for': key } });
  }
  // আগের ছবিগুলোর ছোট কপি একবারে বানানো
  async function backfillThumbs(btn) {
    const keys = new Set();
    try {
      (await api('products')).forEach(p => (p.images || []).forEach(k => keys.add(k)));
      (await api('gallery')).forEach(g => keys.add(g.image));
      (await api('fabrics')).forEach(f => f.image && keys.add(f.image));
    } catch (e) { return fail(e); }
    const list = [...keys].filter(Boolean);
    let done = 0;
    for (const k of list) {
      btn.textContent = `Making small copies… ${done}/${list.length}`;
      try {
        const r = await fetch('/img/' + k.replace(/\.(webp|jpg|png)$/, '-sm.webp'), { method: 'HEAD' });
        if (!r.ok) { const blob = await (await fetch('/img/' + k)).blob(); await makeThumb(blob, k); }
      } catch (e) { /* skip */ }
      done++;
    }
    btn.textContent = `Done: ${list.length} photos ready for fast loading`;
  }

  // ---------- login ----------
  function showLogin() { $('#appView').hidden = true; $('#loginView').hidden = false; $('#loginForm').password.focus(); }
  // কে লগইন করেছে আর কোন অংশ দেখতে পারবে
  let ME = { user: { name: '', role: 'super' }, perms: { read: [], write: [] } };
  const canRead = r => ME.perms.read.includes(r), canWrite = r => ME.perms.write.includes(r);
  const TAB_PERM = { sales: 'sales', dashboard: 'stats', orders: 'orders', abandoned: 'abandoned', chats: 'chats', customers: 'customers', accounts: 'acc', reports: 'report',
    products: 'products', custom: 'custom', gallery: 'gallery', categories: 'categories', banners: 'banners', coupons: 'coupons', reviews: 'reviews',
    settings: 'settings', team: 'users', activity: 'audit' };
  function applyPerms() {
    document.querySelectorAll('#tabs a[data-tab]').forEach(a => { a.hidden = !canRead(TAB_PERM[a.dataset.tab] || a.dataset.tab); });
    document.querySelectorAll('#tabs .side-sep').forEach(sep => {
      let el = sep.nextElementSibling, any = false;
      while (el && !el.classList.contains('side-sep')) { if (el.tagName === 'A' && !el.hidden) any = true; el = el.nextElementSibling; }
      sep.hidden = !any;
    });
    document.body.classList.toggle('ro', ME.user.role === 'view');
    $('#sideUser').innerHTML = `<span class="su-av">${esc(ME.user.name.charAt(0).toUpperCase())}</span><span><strong>${esc(ME.user.name)}</strong><small>${esc(ME.user.roleName || '')}</small></span>
      ${ME.user.id ? '<button class="su-pw" id="myPw" title="Change my password">Password</button>' : ''}`;
    const pw = $('#myPw'); if (pw) pw.onclick = changeMyPassword;
  }
  async function loadMe() {
    const d = await api('me');
    // পুরনো worker.js থাকলে (শুধু admin.js আপলোড হলে) পুরো অনুমতি ধরে নেওয়া
    ME = d && d.perms ? d : { user: { id: 0, name: 'Owner', role: 'super', roleName: 'Super admin' }, perms: { read: Object.values(TAB_PERM).concat(['stats']), write: Object.values(TAB_PERM) } };
    applyPerms();
  }
  function showApp() { $('#loginView').hidden = true; $('#appView').hidden = false; route(); pollBadges(); }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; $('#loginErr').hidden = true;
    try {
      await api('login', { method: 'POST', body: { username: e.target.username.value.trim(), password: e.target.password.value } });
      e.target.reset(); await loadMe(); showApp();
    } catch (err) {
      $('#loginErr').textContent = err.message === 'Wrong username or password.' ? 'Wrong password. Owner: leave Username empty and type the ADMIN_PASSWORD from Cloudflare.' : err.message; $('#loginErr').hidden = false;
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
    let [tab, arg] = (location.hash.slice(1) || (canRead('stats') ? 'dashboard' : 'orders')).split('/');
    if (!canRead(TAB_PERM[tab] || (tab === 'product' ? 'products' : tab))) tab = canRead('stats') ? 'dashboard' : 'orders';
    const active = tab === 'product' ? 'products' : tab;
    document.querySelectorAll('#tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === active ? 'page' : 'false'));
    const main = $('#main');
    main.className = 'main' + (tab === 'chats' ? ' wide' : '');
    $('#main').onclick = null;
    main.innerHTML = '<p class="muted">Loading…</p>';
    const views = {
      dashboard: viewDashboard, orders: viewOrders, chats: () => viewChats(arg), customers: viewCustomers,
      products: viewProducts, product: () => viewProductEdit(arg), custom: viewCustom, gallery: viewGallery,
      categories: viewCategories, settings: viewSettings, coupons: viewCoupons, reviews: viewReviews,
      abandoned: viewAbandoned, banners: viewBanners, reports: viewReports,
      accounts: () => viewAccounts(arg || 'overview'), team: viewTeam, activity: viewActivity, sales: () => viewSales(arg)
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
        <a class="kpi kpi-link" href="#reports"><span>Profit this month</span><strong class="${d.monthProfit.net < 0 ? 'neg' : ''}">${money(d.monthProfit.net)}</strong><small>${d.monthProfit.margin}% margin · avg order ${money(aov)}${d.monthProfit.missing ? ` · <em class="down">${d.monthProfit.missing} without cost</em>` : ''}</small></a>
      </div>
      <div class="dash-top">
        <section class="card goal-card"><div class="card-head"><h2>This month’s target</h2>${canWrite('goals') ? '<button class="text-btn" id="setGoal">Set target</button>' : ''}</div>
          ${d.goal.target ? `<p class="goal-num"><b>${money(d.goal.sold)}</b> of ${money(d.goal.target)}</p><div class="cap-bar"><i style="--w:${Math.min(100, Math.round(d.goal.sold / d.goal.target * 100))}%"></i></div>
            <p class="muted small">${d.goal.sold >= d.goal.target ? '<b class="up">Target reached, Alhamdulillah!</b>' : `${money(d.goal.target - d.goal.sold)} to go · about <b>${money(d.goal.perDay)}</b> a day for the ${d.goal.daysLeft + 1} days left`}</p>`
            : '<p class="muted small">Set a monthly sales target to see progress here.</p>'}</section>
        <section class="card"><h2>Today by channel</h2>${d.todayChannels.length ? `<ul class="mini-list">${d.todayChannels.map(c => `<li><div class="exp-li"><span><b class="chtag ch-${esc(c.ch)}">${esc(c.label)}</b> <span class="muted">${c.n} sale${c.n > 1 ? 's' : ''}</span></span><b>${money(c.v)}</b></div></li>`).join('')}</ul>` : '<p class="muted small">No sales yet today.</p>'}
          ${canWrite('sales') ? '<a class="btn primary sm" href="#sales/new">+ New sale</a>' : ''}</section>
        <section class="card"><h2>Compared with last month</h2><p class="muted small">1st to today, against the same days last month</p>
          <div class="mom"><div><span>Sales</span><b>${money(d.mom.revenue)}</b>${d.mom.revenuePct == null ? '' : `<em class="${d.mom.revenuePct >= 0 ? 'up' : 'down'}">${d.mom.revenuePct >= 0 ? '▲' : '▼'} ${Math.abs(d.mom.revenuePct)}%</em>`}</div>
          <div><span>Orders</span><b>${d.mom.orders}</b>${d.mom.ordersPct == null ? '' : `<em class="${d.mom.ordersPct >= 0 ? 'up' : 'down'}">${d.mom.ordersPct >= 0 ? '▲' : '▼'} ${Math.abs(d.mom.ordersPct)}%</em>`}</div></div></section>
        <section class="card"><div class="card-head"><h2>Due from customers</h2><a class="link" href="#orders" id="dueLink">See all</a></div><p class="goal-num"><b class="${d.dueTotal.v ? 'down' : ''}">${money(d.dueTotal.v)}</b></p><p class="muted small">${d.dueTotal.n} sale${d.dueTotal.n === 1 ? '' : 's'} not fully paid</p></section>
      </div>
      ${d.followUps.length ? `<section class="card follow-card"><h2>Follow up today</h2><ul class="mini-list">${d.followUps.map(f => `<li><div class="exp-li"><span><b>${esc(f.name || f.phone)}</b> <span class="muted">${esc(f.phone)}</span><span class="block">${esc(f.follow_note || '')}${f.follow_up < todayBD() ? ` <em class="down">since ${esc(f.follow_up)}</em>` : ''}</span></span><span class="r"><a class="btn ghost sm" href="tel:${esc(f.phone)}">Call</a> <a class="btn ghost sm" href="https://wa.me/88${esc(f.phone)}" target="_blank" rel="noopener">WhatsApp</a></span></div></li>`).join('')}</ul></section>` : ''}
      <div class="dash-grid"><div class="dash-col">
        <section class="card chart-card"><div class="card-head"><h2>Sales, last 30 days</h2><span class="muted small">Cancelled orders not counted</span></div>${salesChart(d.daily)}</section>
        <section class="card"><div class="card-head"><h2>Best sellers, 30 days</h2></div>
          ${d.top.length ? `<table class="tbl"><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th></tr></thead><tbody>${d.top.map(p => `<tr><td>${esc(p.name)}<span class="muted block">${esc(p.code)}${p.color ? ' · ' + esc(p.color) : ''}</span></td><td class="r">${p.qty}</td><td class="r">${money(p.rev)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Sales will show here after your first orders.</p>'}
        </section>
        ${d.lowFabrics && d.lowFabrics.length ? `<section class="card"><div class="card-head"><h2>Fabric running low</h2><a class="link" href="#custom">Tailoring</a></div>
          <ul class="mini-list">${d.lowFabrics.map(f => `<li><a href="#custom"><span>${esc(f.name_en)}${f.color_en ? ' · ' + esc(f.color_en) : ''}</span><span class="r ${f.stock < f.per_thobe ? 'danger' : 'warn'}">${f.stock} gaj · ${Math.floor(f.stock / f.per_thobe)} thobes</span></a></li>`).join('')}</ul></section>` : ''}
        <section class="card"><div class="card-head"><h2>Low stock</h2><a class="link" href="#products">Products</a></div>
          ${d.lowStock.length ? `<ul class="mini-list">${d.lowStock.map(s => `<li><a href="#product/${s.id}"><span>${esc(s.name_en)}<span class="muted block">${esc(s.code)} · Size ${esc(s.label)}</span></span><span class="r ${s.stock ? 'warn' : 'danger'}">${s.stock ? s.stock + ' left' : 'Sold out'}</span></a></li>`).join('')}</ul>` : '<p class="muted">Every size has more than 3 in stock.</p>'}
        </section>
      </div><div class="dash-col">
        <section class="card"><h2>To do</h2>${todo.length ? `<div class="todos">${todo.join('')}</div>` : '<p class="muted">All caught up. Nothing is waiting for you.</p>'}
          ${statusTotal ? `<h3 class="sub">All orders by status</h3><div class="stbar">${STATUSES.map(([k, l]) => d.statuses[k] ? `<span class="st-${k}" style="flex:${d.statuses[k]}" title="${l}: ${d.statuses[k]}"></span>` : '').join('')}</div>
          <ul class="stlegend">${STATUSES.map(([k, l]) => `<li><i class="st-${k}"></i>${l} <b>${d.statuses[k] || 0}</b></li>`).join('')}</ul>` : ''}
        </section>
        ${d.topCustomers.length ? `<section class="card"><div class="card-head"><h2>Top customers this month</h2><a class="link" href="#customers">Customers</a></div><ul class="mini-list">${d.topCustomers.map(c => `<li><div class="exp-li"><span><b>${esc(c.name)}</b><span class="muted block">${esc(c.phone)} · ${c.n} order${c.n > 1 ? 's' : ''}</span></span><b>${money(c.v)}</b></div></li>`).join('')}</ul></section>` : ''}
        <section class="card"><div class="card-head"><h2>Recent orders</h2><a class="link" href="#orders">All orders</a></div>
          ${d.recent.length ? `<ul class="mini-list">${d.recent.map(o => `<li><a href="#orders" data-q="${esc(o.order_no)}"><span><strong>${esc(o.order_no)}</strong><span class="muted block">${esc(o.name)} · ${ago(o.created_at)}</span></span><span class="r">${money(o.total)}<span class="badge st-${o.status}">${stLabel(o.status)}</span></span></a></li>`).join('')}</ul>` : '<p class="muted">No orders yet.</p>'}
        </section>
      </div></div>`;
    bindDash();
  }

  function bindDash() {
    const g = $('#setGoal');
    if (g) g.onclick = async () => { const v = prompt('Sales target for this month (BDT)', ''); if (v == null) return; try { await api('goals', { method: 'PUT', body: { month_target: v } }); toast('Target saved'); route(); } catch (e) { fail(e); } };
    const dl = $('#dueLink'); if (dl) dl.onclick = () => { setTimeout(() => {}, 0); orderDue = true; };
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
    if (orderChannel) qs.set('channel', orderChannel);
    if (orderDue) qs.set('due', '1');
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
        <select id="fChannel"><option value="">All channels</option>${Object.entries(CH).map(([k, l]) => `<option value="${k}" ${orderChannel === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="fDue" ${orderDue ? 'checked' : ''}> With due only</label>
        <label class="check"><input type="checkbox" id="fCustom" ${orderCustom ? 'checked' : ''}> Custom thobes only</label>
        ${canWrite('sales') ? '<a class="btn primary sm" href="#sales/new">+ New sale</a>' : ''}
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
    $('#fChannel').addEventListener('change', e => { orderChannel = e.target.value; reload(); });
    $('#fDue').addEventListener('change', e => { orderDue = e.target.checked; reload(); });
    $('#main').querySelectorAll('[data-due]').forEach(b => b.addEventListener('click', () => openCollect(orders.find(o => String(o.id) === b.dataset.due), reload)));
    $('#main').querySelectorAll('[data-oedit]').forEach(b => b.addEventListener('click', () => openOrderEdit(orders.find(o => String(o.id) === b.dataset.oedit), reload)));
    $('#csvBtn').addEventListener('click', () => downloadCsv(orders));
    $('#main').querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', async () => {
      const prev = sel.dataset.prev;
      let extra = {};
      if (sel.value === 'cancelled') {
        const kind = prompt('Why is it cancelled? Type 1 or 2:\n1 = Cancelled before delivery\n2 = Customer returned it\n\nItems go back into stock. Money entries for this order are removed.', '1');
        if (kind !== '1' && kind !== '2') { sel.value = prev; return; }
        extra = { cancel_type: kind === '2' ? 'returned' : 'cancelled', cancel_reason: prompt('Reason (optional)', '') || '' };
      }
      try { await api('orders/' + sel.dataset.id, { method: 'PUT', body: { status: sel.value, ...extra } }); toast('Order marked ' + stLabel(sel.value)); reload(); pollBadges(); }
      catch (e) { sel.value = prev; fail(e); }
    }));
    $('#main').querySelectorAll('.note-form').forEach(fm => fm.addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('orders/' + fm.dataset.id, { method: 'PUT', body: { admin_note: fm.note.value } }); toast('Note saved'); } catch (err) { fail(err); }
    }));
    $('#main').querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printInvoice(orders.find(o => String(o.id) === b.dataset.print))));
    $('#main').querySelectorAll('[data-tailor]').forEach(b => b.addEventListener('click', () => printTailor(orders.find(o => String(o.id) === b.dataset.tailor))));
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

  function customLooks(d) {
    const T = window.AHThobe, out = { collar: 'shirt', front: 'hidden', pocket: 'chest', cuff: 'cuff' };
    (d.options || []).forEach(o => { const lk = o.look || T.lookOf(o.group, { en: o.choice }); if (T.KIND[lk]) out[T.KIND[lk]] = lk; });
    return out;
  }
  const thobePic = d => window.AHThobe.draw({ hex: d.hex || '#8A8C90', image: d.image ? '/img/' + d.image : '', ...customLooks(d) });
  function itemHtml(l) {
    if (!l.custom) return `<li><span>${esc(l.name)}, ${esc(l.color)} <span class="muted">${esc(l.code)}</span><br>Size ${esc(l.size)} × ${l.qty}</span><span>${money(l.price * l.qty)}</span></li>`;
    const d = l.details || {};
    return `<li class="custom-item"><span class="ci-pic">${thobePic(d)}</span><span><b class="tag">Custom</b> ${esc(l.name)} × ${l.qty}<br>
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
        <div class="o-main"><strong>${esc(o.order_no)}${hasCustom ? ' <b class="tag">Custom</b>' : ''} <b class="chtag ch-${esc(o.channel || 'website')}">${CH[o.channel || 'website'] || o.channel}</b></strong><span class="muted">${fmtWhen(o.created_at)}${o.sold_by && o.channel !== 'website' ? ' · ' + esc(o.sold_by) : ''}</span></div>
        <div class="o-cust">${esc(o.name)}<span class="muted">${esc(phone)} ${histChip(o.history)}</span></div>
        <div class="o-total">${money(o.total)}<span class="muted">${o.payment === 'bkash_online' ? (o.paid ? '<b class="paid">bKash paid</b>' : 'bKash, not paid yet') : o.payment === 'bkash' ? 'bKash/Nagad' : 'COD'}</span></div>
        <span class="badge st-${o.status}">${o.status === 'cancelled' && o.cancel_type === 'returned' ? 'Returned' : stLabel(o.status)}</span>${dueOf(o) ? `<span class="duetag">Due ${money(dueOf(o))}</span>` : ''}
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
          ${o.items.some(l => l.custom) ? `<button class="btn ghost sm" type="button" data-tailor="${o.id}">Print tailor sheet</button>` : ''}
          ${o.consignment ? `<button class="btn ghost sm" type="button" data-cstatus="${o.id}">Check courier status</button>`
            : o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn ghost sm" type="button" data-courier="${o.id}">Send to Steadfast</button>` : ''}
          ${dueOf(o) && canWrite('due') ? `<button class="btn primary sm" type="button" data-due="${o.id}">Collect due ${money(dueOf(o))}</button>` : ''}
          ${['super', 'admin'].includes(ME.user.role) ? `<button class="btn ghost sm" type="button" data-oedit="${o.id}">Edit order</button>` : ''}
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

  // দর্জির জন্য: ছবি, কাপড়, স্টাইল, পুরো মাপ এক পাতায়
  function printTailor(o) {
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print.', true);
    const pages = o.items.filter(l => l.custom).map((l, i) => { const d = l.details || {};
      return `<section><header><div><h1>Tailor sheet</h1><p>${esc(o.order_no)} · ${esc(o.name)} · ${fmtWhen(o.created_at)}</p></div><div class="qty">× ${l.qty}</div></header>
        <div class="cols"><div class="pic">${thobePic(d).replace('<svg ', '<svg width="300" height="560" ')}</div><div>
          <h2>Fabric</h2><p class="big">${esc(d.fabric)}</p>
          <h2>Style</h2><table>${(d.options || []).map(x => `<tr><td>${esc(x.group)}</td><td><b>${esc(x.choice)}</b></td></tr>`).join('')}</table>
          <h2>${d.meas ? 'Measurements (inches)' : 'Size'}</h2>
          ${d.meas ? `<table class="m">${Object.entries(d.meas).filter(([, v]) => v).map(([k, v]) => `<tr><td>${MEAS_NAMES[k] || k}</td><td><b>${esc(v)}</b></td></tr>`).join('')}<tr><td>Fit</td><td><b>${esc(d.fit || 'regular')}</b></td></tr></table>` : `<p class="big">${esc(l.size)}</p>`}
          ${d.note ? `<h2>Customer note</h2><p class="note">${esc(d.note)}</p>` : ''}
          <p class="small">Chest pocket on the wearer’s LEFT side.</p>
        </div></div></section>`; }).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tailor sheet ${esc(o.order_no)}</title><style>
      body{font-family:system-ui,sans-serif;color:#1A1A1A;margin:0;padding:24px}section{max-width:760px;margin:0 auto 30px;page-break-after:always}
      header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A1A1A;padding-bottom:10px;margin-bottom:16px}
      h1{font-size:22px;margin:0}header p{margin:4px 0 0;color:#555}.qty{font-size:28px;font-weight:700}.cols{display:flex;gap:28px}.pic{flex:none;background:#F4F2EE;border-radius:6px;padding:8px}
      h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#777;margin:16px 0 6px}.big{font-size:18px;margin:0}
      table{border-collapse:collapse;width:100%}td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:15px}.m td b{font-size:18px}.note{background:#FFF6E5;padding:8px 10px}
      .small{font-size:12px;color:#777;margin-top:18px}@media print{button{display:none}body{padding:0}}</style></head><body>${pages}
      <button onclick="print()">Print</button><script>setTimeout(()=>print(),500)<\/script></body></html>`);
    w.document.close();
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
    ['risk', 'Many cancels', c => c.cancelled >= 2 && c.cancelled >= c.delivered],
    ['due', 'Has due', c => c.due > 0],
    ['follow', 'Follow up', c => c.follow_up && c.follow_up <= todayBD()]
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
        <thead><tr><th class="ck"><input type="checkbox" id="selAll" aria-label="Select all shown" ${list.length && list.every(c => custSel.has(c.phone)) ? 'checked' : ''}></th><th>Customer</th><th class="r">Times bought</th><th class="r">Spent</th><th class="r">Due</th><th>Last order</th><th></th></tr></thead>
        <tbody>${list.slice(0, 500).map(c => `<tr class="${custSel.has(c.phone) ? 'sel' : ''}">
          <td class="ck"><input type="checkbox" data-sel="${c.phone}" ${custSel.has(c.phone) ? 'checked' : ''} aria-label="Select ${esc(c.name)}"></td>
          <td><button class="linklike" data-cust="${c.phone}"><strong>${esc(c.name)}</strong></button> ${segOf(c)}${(c.tags || '').split(', ').filter(Boolean).map(tg => `<b class="seg tag"># ${esc(tg)}</b>`).join('')}
            <span class="muted block">${esc(c.phone)} · ${esc((c.address || '').slice(0, 60))}</span></td>
          <td class="r"><strong class="big">${c.orders - c.cancelled}</strong><span class="muted block small">${c.delivered} delivered${c.cancelled ? ` · ${c.cancelled - (c.returned || 0)} cancelled` : ''}${c.returned ? ` · ${c.returned} returned` : ''}</span></td>
          <td class="r">${money(c.spent)}</td><td class="r ${c.due ? 'down' : 'muted'}">${c.due ? money(c.due) : '—'}</td><td>${fmtWhen(c.last_order)}<span class="muted block small">${ago(c.last_order)}</span></td>
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
        <div><strong>${c.orders - c.cancelled ? money(Math.round(c.spent / (c.orders - c.cancelled))) : '—'}</strong><span>per order</span></div><div><strong>${c.cancelled - (c.returned || 0)} / ${c.returned || 0}</strong><span>cancelled / returned</span></div>
        <div class="${c.due ? 'due-stat' : ''}"><strong>${money(c.due || 0)}</strong><span>due now</span></div></div>
      <p class="cust-facts">${d.favSizes.length ? `<span>Usual size: <b>${d.favSizes.map(x => esc(x.name)).join(', ')}</b></span>` : ''}${d.favColors.length ? `<span>Colours: <b>${d.favColors.map(x => esc(x.name)).join(', ')}</b></span>` : ''}
        <span>Buys via: ${(c.channels || 'website').split(',').map(k => `<b class="chtag ch-${esc(k)}">${CH[k] || esc(k)}</b>`).join(' ')}</span><span>Last bought ${c.last_order ? ago(c.last_order) : '—'}</span>
        <span>Trust: ${c.cancelled >= 2 && c.cancelled >= c.delivered ? '<b class="down">Be careful</b>' : '<b class="up">Good</b>'}</span></p>
      <div class="row-btns"><a class="btn ghost sm" href="tel:${esc(phone)}">Call</a><a class="btn ghost sm" href="https://wa.me/88${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn ghost sm" id="cSms">Send SMS</button><div class="fraud" data-fraud="${esc(phone)}"><button class="btn ghost sm" type="button">Check courier record</button></div></div>
      <form id="noteForm" class="note-form"><div class="g2"><label class="field"><span>Tags <small>comma separated, like Eid buyer, wholesale</small></span><input name="tags" value="${esc(d.tags)}"></label>
        <label class="field"><span>Private note</span><input name="note" value="${esc(d.note)}" placeholder="Likes slim fit, calls after 6 pm…"></label>
        <label class="field"><span>Follow up on <small>shows on the dashboard that day</small></span><input type="date" name="follow_up" value="${esc(d.follow_up || '')}"></label>
        <label class="field"><span>Follow-up reason</span><input name="follow_note" value="${esc(d.follow_note || '')}" placeholder="Call before Eid with new colours"></label></div>
        <button class="btn primary sm" type="submit">Save</button></form>
      ${d.profile && d.profile.meas ? `<p class="small"><b>Saved measurements:</b> ${esc(Object.entries(JSON.parse(d.profile.meas)).map(([k, v]) => `${k} ${v}`).join(', '))}</p>` : ''}
      <h3 class="sub">What they bought</h3>
      ${d.bought.length ? `<ul class="bought">${d.bought.map(b => `<li><span>${esc(b.name)}</span><b>× ${b.qty}</b></li>`).join('')}</ul>` : '<p class="muted">Nothing delivered yet.</p>'}
      <h3 class="sub">Timeline</h3>${custTimeline(d)}
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
        const r = await api('customer', { method: 'PUT', body: { phone, tags: e.target.tags.value, note: e.target.note.value, follow_up: e.target.follow_up.value, follow_note: e.target.follow_note.value } });
        c.tags = r.tags; c.note = e.target.note.value; toast('Customer saved'); dlg.close(); drawCustomers();
      } catch (err) { fail(err); }
    });
  }

  // অর্ডার, বিক্রি, বাকি আদায়, চ্যাট, রিভিউ: তারিখ অনুযায়ী এক তালিকায়
  function custTimeline(d) {
    const ev = [];
    d.orders.forEach(o => ev.push({ at: o.created_at, icon: o.status === 'cancelled' ? '✕' : '🛍', cls: o.status === 'cancelled' ? 'tl-x' : 'tl-o',
      html: `<b>${o.status === 'cancelled' ? (o.cancel_type === 'returned' ? 'Returned' : 'Cancelled') : (o.channel === 'website' ? 'Website order' : (CH[o.channel] || 'Sale'))}</b> ${esc(o.order_no)} · ${money(o.total)}${o.due ? ` · <span class="down">due ${money(o.due)}</span>` : ''}<span class="muted block">${o.items.map(l => `${esc(l.custom ? 'Custom thobe' : l.name)} ${esc(l.size)} ×${l.qty}`).join(', ')}</span>` }));
    (d.payments || []).filter(p => /^Due collected/.test(p.note || '')).forEach(p => ev.push({ at: p.created_at, icon: '৳', cls: 'tl-p', html: `<b>Paid due</b> ${money(p.amount)} into ${esc(p.account || '')} <span class="muted">${esc(p.ref || '')}</span>` }));
    (d.chats || []).forEach(c => ev.push({ at: c.created_at, icon: '💬', cls: 'tl-c', html: `<b>Chat</b> <span class="muted">${esc((c.last_msg || '').slice(0, 80))}</span>` }));
    (d.reviews || []).forEach(r => ev.push({ at: r.created_at, icon: '★', cls: 'tl-r', html: `<b>Review ${'★'.repeat(r.rating)}</b> on ${esc(r.product_code)} <span class="muted">${esc((r.body || '').slice(0, 80))}</span>` }));
    ev.sort((a, b) => toDate(b.at) - toDate(a.at));
    return ev.length ? `<ul class="timeline">${ev.slice(0, 40).map(e => `<li class="${e.cls}"><i>${e.icon}</i><div>${e.html}<time>${fmtWhen(e.at)}</time></div></li>`).join('')}</ul>` : '<p class="muted small">Nothing yet.</p>';
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
    setTimeout(() => { const tb = $('#thumbsBtn'); if (tb) tb.onclick = () => { tb.disabled = true; backfillThumbs(tb); }; }, 0);
    const catName = id => (categories.find(c => c.id === id) || {}).name_en || '—';
    $('#main').innerHTML = `
      <div class="page-head"><h1>Products <span class="muted">${products.length}</span></h1><div class="head-tools"><button class="btn ghost sm" id="thumbsBtn" title="Makes small copies of old photos so the website opens faster on phones">Speed up photos</button><a class="btn primary" href="#product/new">Add product</a></div></div>
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
            ${f('cost', 'Cost price (BDT)', p.cost == null ? '' : p.cost, { type: 'number', hint: 'what one piece costs you, only you see it' })}
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
  async function compress(file, max = 1600, q = 0.85) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const toBlob = (type, q) => new Promise(r => c.toBlob(r, type, q));
    let blob = await toBlob('image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', q);
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
  const LOOK_OPTS = [['', 'No picture'], ['shirt', 'Collar: shirt collar'], ['band', 'Collar: band (no collar)'], ['round', 'Collar: round neck'],
    ['hidden', 'Front: hidden buttons'], ['visible', 'Front: visible buttons'], ['zip', 'Front: zip'],
    ['chest', 'Pocket: left chest'], ['chest_side', 'Pocket: left chest + sides'], ['side', 'Pocket: sides only'], ['none', 'Pocket: none'],
    ['cuff', 'Sleeve: cuff with button'], ['cufflink', 'Sleeve: cufflink cuff'], ['plain', 'Sleeve: plain']];
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
          <div class="row-btns"><button type="button" class="btn ghost sm" id="addGroup">Add option group</button><button type="button" class="btn ghost sm" id="loadDefaults">Use recommended options with pictures</button></div>
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
        <div class="opt-head"><span>Option (English)</span><span>বাংলা</span><span>Extra (BDT)</span><span>Picture</span><span></span></div>
        ${g.options.map((o, oi) => `<div class="opt-row">
          <input data-g="${gi}" data-o="${oi}" data-k="en" value="${esc(o.en)}" aria-label="Option English">
          <input data-g="${gi}" data-o="${oi}" data-k="bn" value="${esc(o.bn)}" aria-label="Option Bangla">
          <input data-g="${gi}" data-o="${oi}" data-k="add" type="number" min="0" value="${o.add}" aria-label="Extra price">
          <select data-g="${gi}" data-o="${oi}" data-k="look" aria-label="Picture">${LOOK_OPTS.map(([v, l]) => `<option value="${v}" ${(o.look || window.AHThobe.lookOf(g.key, o)) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
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
    $('#loadDefaults').addEventListener('click', () => { if (confirm('Replace the style options with the recommended set (collar, buttons, left pocket, sleeve) with pictures? Your fabrics and prices stay.')) { groups = JSON.parse(JSON.stringify(cfg.defaults)); drawGroups(); toast('Loaded. Check the prices and press Save.'); } });
    $('#groupsEd').addEventListener('change', e => { const el = e.target; if (el.dataset.k === 'look') groups[el.dataset.g].options[el.dataset.o].look = el.value; });
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
      const FAM = { white: 'White', cream: 'Cream & beige', brown: 'Brown', grey: 'Grey', black: 'Black', blue: 'Blue', green: 'Green', red: 'Red & maroon', other: 'Other' };
      $('#fabEditor').innerHTML = `<form class="fab-form" id="fabForm">
        <h3 class="sub">${f.id ? 'Edit fabric' : 'New fabric'}</h3>
        <div class="fab-grid">
          <div>
            <div class="fab-img ${image ? 'pick' : ''}" id="fabImg" style="--c:${esc(f.color_hex || '#F2F0EA')}" title="Tap the fabric to pick its colour">${image ? `<img src="/img/${esc(image)}" alt="" crossorigin="anonymous">` : '<span class="muted small">Add a close-up photo</span>'}<i class="pick-dot" hidden></i></div>
            <label class="upload"><input type="file" id="fabUp" accept="image/*" hidden><span class="btn ghost sm">${image ? 'Change photo' : 'Add photo'}</span></label>
            ${image ? '<button type="button" class="text-btn" id="fabRm">Remove photo</button>' : ''}
            <p class="muted small">Colour is found from the photo by itself. If it looks wrong, tap on the fabric in the photo.</p>
          </div>
          <div>
            <div class="color-auto">
              <span class="ca-sw" id="caSw" style="--c:${esc(f.color_hex || '#F2F0EA')}"></span>
              <div class="ca-txt"><strong id="caName">${esc(f.color_en || 'No colour yet')}</strong><span class="muted small" id="caInfo">${f.color_bn ? esc(f.color_bn) + ' · ' : ''}${esc(f.color_hex || '')}</span></div>
              <label class="ca-manual" title="Choose colour by hand"><input type="color" name="color_hex" value="${esc(f.color_hex || '#F2F0EA')}"> Change</label>
            </div>
            <div class="g3">
              <label class="field"><span>Colour name (English)</span><input name="color_en" value="${esc(f.color_en || '')}" placeholder="Navy"></label>
              <label class="field"><span>রঙের নাম (বাংলা)</span><input name="color_bn" value="${esc(f.color_bn || '')}" placeholder="নেভি"></label>
              <label class="field"><span>Colour family <small>for the filter</small></span><select name="family"><option value="">—</option>${Object.entries(FAM).map(([k, l]) => `<option value="${k}" ${f.family === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <div class="g2"><label class="field"><span>Fabric name (English)</span><input name="name_en" value="${esc(f.name_en || '')}" placeholder="Japanese Tetron" required></label>
              <label class="field"><span>কাপড়ের নাম (বাংলা)</span><input name="name_bn" value="${esc(f.name_bn || '')}" placeholder="জাপানি টেট্রন"></label></div>
            <div class="g2"><label class="field"><span>Short description (English)</span><textarea name="desc_en" rows="2">${esc(f.desc_en || '')}</textarea></label>
              <label class="field"><span>বর্ণনা (বাংলা)</span><textarea name="desc_bn" rows="2">${esc(f.desc_bn || '')}</textarea></label></div>
            <div class="g3"><label class="field"><span>Made of <small>optional</small></span><input name="composition" value="${esc(f.composition || '')}" placeholder="65% polyester, 35% cotton" list="compList"></label>
              <label class="field"><span>From <small>optional</small></span><input name="origin" value="${esc(f.origin || '')}" placeholder="Japan" list="originList"></label>
              <label class="field"><span>Best for <small>optional</small></span><input name="season" value="${esc(f.season || '')}" placeholder="Summer" list="seasonList"></label></div>
            <datalist id="compList"><option value="100% cotton"><option value="100% polyester"><option value="65% polyester, 35% cotton"><option value="Polyester viscose"><option value="Wool blend"></datalist>
            <datalist id="originList"><option value="Japan"><option value="Korea"><option value="Indonesia"><option value="Thailand"><option value="China"><option value="Bangladesh"><option value="Pakistan"></datalist>
            <datalist id="seasonList"><option value="Summer"><option value="Winter"><option value="All year"></datalist>
            <div class="g3"><label class="field"><span>Extra price (BDT)</span><input name="price_add" type="number" min="0" value="${f.price_add || 0}"></label>
              <label class="field"><span>GSM <small>optional</small></span><input name="gsm" type="number" min="0" value="${f.gsm == null ? '' : f.gsm}"></label>
              <label class="field"><span>Display order</span><input name="sort" type="number" value="${f.sort || 0}"></label></div>
            <div class="g3"><label class="field"><span>Cost per gaj (BDT) <small>only you see it</small></span><input name="cost_per_gaj" type="number" min="0" step="1" value="${f.cost_per_gaj == null ? '' : f.cost_per_gaj}" placeholder="e.g. 320"></label></div>
            <div class="g3 stock-row"><label class="field"><span>In stock (gaj) <small>leave empty if you don’t count</small></span><input name="stock" type="number" min="0" step="0.25" value="${f.stock == null ? '' : f.stock}" placeholder="e.g. 120"></label>
              <label class="field"><span>Gaj per thobe</span><input name="per_thobe" type="number" min="0.5" max="10" step="0.25" value="${f.per_thobe || 3.5}"></label>
              <p class="muted small" id="stockHint"></p></div>
            <div class="checks"><label class="check"><input type="checkbox" name="active" ${f.active === 0 ? '' : 'checked'}> Show to customers</label></div>
            <div class="row-btns">${f.id ? '<button type="button" class="btn danger sm" id="fabDel">Delete fabric</button>' : ''}<span class="spacer"></span>
              <button type="button" class="btn ghost sm" id="fabCancel">Cancel</button><button class="btn primary sm" type="submit">${f.id ? 'Save fabric' : 'Add fabric'}</button></div>
          </div>
        </div></form>`;
      const form = $('#fabForm');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const C = window.AHColors;
      // নতুন রং বসালে নাম আর পরিবার নিজে নিজে বসে (আগে হাতে বদলে থাকলে নাম বদলায় না)
      let nameTouched = !!f.color_en;
      form.color_en.addEventListener('input', () => { nameTouched = true; });
      form.color_bn.addEventListener('input', () => { nameTouched = true; });
      const setColor = (hex, auto) => {
        form.color_hex.value = hex;
        $('#caSw').style.setProperty('--c', hex); $('#fabImg').style.setProperty('--c', hex);
        const n = C.nameColor(hex);
        if (auto || !nameTouched) { form.color_en.value = n.en; form.color_bn.value = n.bn; nameTouched = false; }
        form.family.value = n.family;
        $('#caName').textContent = form.color_en.value || n.en;
        $('#caInfo').textContent = `${form.color_bn.value || n.bn} · ${hex}${n.dE > 6 ? ' · closest name, check it' : ''}`;
      };
      const stockHint = () => {
        const st = parseFloat(form.stock.value), per = parseFloat(form.per_thobe.value) || 3.5;
        $('#stockHint').textContent = Number.isFinite(st) ? `Enough for about ${Math.floor(st / per)} thobe${Math.floor(st / per) === 1 ? '' : 's'}. Customers stop seeing it when less than one is left.` : 'Not counting stock. It stays available.';
      };
      form.stock.addEventListener('input', stockHint); form.per_thobe.addEventListener('input', stockHint); stockHint();
      const bindPick = () => {
        const box = $('#fabImg'), img = box.querySelector('img');
        if (!img) return;
        box.classList.add('pick');
        const auto = () => { try { setColor(C.dominantFromImage(img), !nameTouched); } catch (e) { /* tainted */ } };
        if (!f.color_en || image !== f.image) { if (img.complete) auto(); else img.addEventListener('load', auto, { once: true }); }
        box.onclick = e => {
          const r = img.getBoundingClientRect();
          const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
          if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
          try {
            setColor(C.colorAt(img, fx, fy), true);
            const dot = box.querySelector('.pick-dot'); dot.hidden = false; dot.style.left = (e.clientX - box.getBoundingClientRect().left) + 'px'; dot.style.top = (e.clientY - box.getBoundingClientRect().top) + 'px';
            toast('Colour picked from the photo');
          } catch (err) { toast('Could not read this photo', true); }
        };
      };
      form.color_hex.addEventListener('input', () => setColor(form.color_hex.value, false));
      const drawImg = () => {
        $('#fabImg').innerHTML = image ? `<img src="/img/${esc(image)}" alt="" crossorigin="anonymous"><i class="pick-dot" hidden></i>` : '<span class="muted small">Add a close-up photo</span>';
        bindPick();
      };
      bindPick();
      $('#fabUp').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { toast('Uploading photo…'); image = await uploadFile(file); drawImg(); toast('Photo added. Colour found from the photo.'); } catch (err) { fail(err); }
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
  const fabricRow = f => {
    const left = f.stock == null ? null : Math.floor(f.stock / (f.per_thobe || 3.5));
    return `<button type="button" class="fab-row ${f.active ? '' : 'inactive'}" data-fab="${f.id}">
    <span class="pthumb" style="--c:${esc(f.color_hex)}">${f.image ? `<img src="/img/${esc(f.image)}" alt="" loading="lazy">` : ''}</span>
    <span class="pinfo"><strong>${esc(f.name_en)}${f.color_en ? ` <span class="muted">· ${esc(f.color_en)}</span>` : ''}</strong><span class="muted">${esc([f.composition, f.origin, f.gsm ? 'GSM ' + f.gsm : ''].filter(Boolean).join(' · ') || f.name_bn)}</span></span>
    <span>${f.price_add ? '+' + money(f.price_add) : 'No extra'}</span>
    <span class="${left == null ? 'muted' : left < 1 ? 'danger' : left < 3 ? 'warn' : ''}">${left == null ? 'Not counted' : `${f.stock} gaj<span class="block small muted">${left} thobe${left === 1 ? '' : 's'}</span>`}</span>
    <span>${!f.active ? '<span class="badge">Hidden</span>' : left != null && left < 1 ? '<span class="badge st-cancelled">Out</span>' : '<span class="badge st-delivered">Live</span>'}</span></button>`;
  };

  // ================= GALLERY =================
  async function viewGallery() {
    const [list, opts, prods] = await Promise.all([api('gallery'), api('gallery-opts'), api('products').catch(() => [])]);
    const albums = [...new Set(list.map(g => g.album).filter(Boolean))];
    const spotsOf = g => { try { return JSON.parse(g.spots || '[]'); } catch (e) { return []; } };
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Gallery <span class="muted">${list.length}</span></h1><p class="muted">Your lookbook. Put photos in albums, pick featured ones for the big slider, and tag the thobes so customers can buy from the photo.</p></div>
        <label class="upload"><input type="file" id="galUp" accept="image/*" multiple hidden><span class="btn primary">Upload photos</span></label></div>
      <section class="card gal-opts"><label class="check"><input type="checkbox" id="optProducts" ${opts.products ? 'checked' : ''}> Also show one photo of each product design in the gallery</label>
        <span class="muted small">Upload into album: <input id="upAlbum" list="albumList" placeholder="e.g. Eid 2026" class="inline-in"></span></section>
      <datalist id="albumList">${['Eid 2026', 'Customer photos', 'Photoshoot', 'New fabrics', ...albums].filter((v, i, a) => a.indexOf(v) === i).map(a => `<option value="${esc(a)}">`).join('')}</datalist>
      <datalist id="codes">${prods.map(p => `<option value="${esc(p.code)}">${esc(p.name_en)} · ${esc(p.color_en || '')}</option>`).join('')}</datalist>
      <p class="muted small" id="galStatus"></p>
      ${list.length ? `<div class="gal-grid">${list.map(g => `<form class="gal-card ${g.featured ? 'is-feat' : ''}" data-id="${g.id}">
        <div class="gal-img"><img src="/img/${esc(g.image)}" alt="" loading="lazy">${g.featured ? '<b class="feat-tag">★ Featured</b>' : ''}${spotsOf(g).length ? `<b class="spot-tag">${spotsOf(g).length} tagged</b>` : ''}</div>
        <input name="caption_en" value="${esc(g.caption_en)}" placeholder="Caption (English)" aria-label="Caption English">
        <input name="caption_bn" value="${esc(g.caption_bn)}" placeholder="ক্যাপশন (বাংলা)" aria-label="Caption Bangla">
        <div class="gal-row"><input name="album" value="${esc(g.album || '')}" placeholder="Album" list="albumList" aria-label="Album"><input name="sort" type="number" value="${g.sort}" aria-label="Order" title="Lower shows first" class="num"></div>
        <label class="check sm"><input type="checkbox" name="featured" ${g.featured ? 'checked' : ''}> Featured (big slider at the top)</label>
        <div class="gal-row"><button class="btn ghost sm" type="button" data-tag>Tag thobes</button><span class="spacer"></span><button class="btn ghost sm danger-t" type="button" data-del>Delete</button><button class="btn primary sm" type="submit">Save</button></div>
      </form>`).join('')}</div>` : '<p class="empty">No photos yet. Upload customer photos, Eid shoots and close-ups. They look best in portrait (taller than wide).</p>'}
      <dialog class="adlg wide" id="tagDlg"></dialog></div>`;
    $('#optProducts').onchange = async e => { try { await api('gallery-opts', { method: 'PUT', body: { products: e.target.checked } }); toast('Saved'); } catch (err) { fail(err); } };
    $('#galUp').addEventListener('change', async e => {
      const files = [...e.target.files]; e.target.value = '';
      const album = $('#upAlbum').value.trim();
      for (let i = 0; i < files.length; i++) {
        $('#galStatus').textContent = `Uploading photo ${i + 1} of ${files.length}…`;
        try { const key = await uploadFile(files[i]); await api('gallery', { method: 'POST', body: { image: key, sort: 0, album } }); } catch (err) { fail(err); }
      }
      toast(files.length > 1 ? 'Photos added' : 'Photo added'); viewGallery().catch(fail);
    });
    const body = (fm, g) => ({ ...Object.fromEntries(new FormData(fm)), featured: fm.featured.checked, spots: g._spots || spotsOf(g) });
    $('#main').querySelectorAll('.gal-card').forEach(fm => {
      const g = list.find(x => String(x.id) === fm.dataset.id);
      fm.addEventListener('submit', async e => { e.preventDefault(); try { await api('gallery/' + g.id, { method: 'PUT', body: body(fm, g) }); toast('Photo saved'); viewGallery().catch(fail); } catch (err) { fail(err); } });
      fm.querySelector('[data-del]').addEventListener('click', async () => { if (!confirm('Delete this photo from the gallery?')) return; try { await api('gallery/' + g.id, { method: 'DELETE' }); toast('Photo deleted'); viewGallery().catch(fail); } catch (err) { fail(err); } });
      fm.querySelector('[data-tag]').addEventListener('click', () => tagEditor(g, fm));
    });
    // ছবিতে চাপ দিয়ে জুব্বা ট্যাগ করা
    function tagEditor(g, fm) {
      const dlg = $('#tagDlg'); let spots = (g._spots || spotsOf(g)).map(s => ({ ...s }));
      const draw = () => {
        dlg.innerHTML = `<div class="adlg-body"><div class="adlg-head"><div><h2>Tag thobes in this photo</h2><p class="muted small">Tap on the thobe in the photo, then choose which product it is. Customers see a dot there and can buy it.</p></div><button type="button" class="icon" data-x>×</button></div>
          <div class="tag-grid"><div class="tag-img" id="tagImg"><img src="/img/${esc(g.image)}" alt="">${spots.map((s, i) => `<span class="tdot" style="left:${s.x}%;top:${s.y}%">${i + 1}</span>`).join('')}</div>
          <div><ol class="tag-list">${spots.map((s, i) => `<li><input data-si="${i}" value="${esc(s.code)}" list="codes" placeholder="Product code"><button type="button" class="icon" data-srm="${i}" aria-label="Remove">×</button></li>`).join('') || '<li class="muted small">No tags yet. Tap the photo.</li>'}</ol>
          <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button type="button" class="btn primary" id="tagSave">Save tags</button></div></div></div></div>`;
        dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
        $('#tagImg').onclick = e => { const r = $('#tagImg img').getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100; if (x < 0 || x > 100 || y < 0 || y > 100) return;
          spots.push({ code: g.product_code || '', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); draw(); const ins = dlg.querySelectorAll('[data-si]'); ins[ins.length - 1].focus(); };
        dlg.querySelectorAll('[data-si]').forEach(inp => inp.oninput = () => { spots[inp.dataset.si].code = inp.value.trim().toUpperCase(); });
        dlg.querySelectorAll('[data-srm]').forEach(b => b.onclick = () => { spots.splice(Number(b.dataset.srm), 1); draw(); });
        $('#tagSave').onclick = async () => { g._spots = spots.filter(s => s.code); try { await api('gallery/' + g.id, { method: 'PUT', body: body(fm, g) }); toast('Tags saved'); dlg.close(); viewGallery().catch(fail); } catch (err) { fail(err); } };
      };
      draw(); dlg.showModal();
    }
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
        <section class="card"><h2>Free delivery</h2>
          <p class="muted small">Delivery becomes free when the order is this much or more. The cart shows customers how much more they need. Set 0 to turn off.</p>
          <div class="g2">${f('free_ship_over', 'Free delivery from (BDT)', { type: 'number', ph: '3000' })}</div>
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
        <section class="card"><h2>Nightly summary on Telegram</h2>
          <p class="muted small">Every night at 10 pm you get today’s sales by channel, profit, orders to confirm and ship, money due, chats waiting and who to call tomorrow. It needs Telegram to be connected (below).</p>
          <button type="button" class="btn ghost sm" id="sumTest">Send today’s summary now</button></section>
        <section class="card"><h2>Phone notifications</h2>
          <p class="muted small">Get a Telegram message on your phone for every new order and chat. Create a bot with @BotFather, then add two secrets in Cloudflare (Worker › Settings › Variables and Secrets): <b>TELEGRAM_BOT_TOKEN</b> and <b>TELEGRAM_CHAT_ID</b>. Full steps are in the README.</p>
        </section>
        <div class="save-bar"><span class="spacer"></span><button class="btn primary" type="submit">Save shop info</button></div>
      </form>`;
    $('#sumTest').onclick = async () => { try { await api('summary', { method: 'POST' }); toast('Summary sent to Telegram'); } catch (err) { fail(err); } };
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

  // ================= PROFIT & LOSS (লাভ-ক্ষতি) =================
  const EXP_CATS = ['Facebook ads', 'Rent', 'Salary', 'Packaging', 'Tailoring wages', 'Electricity and internet', 'Transport', 'Other'];
  let rep = { period: 'month', basis: 'all', from: '', to: '' };
  function periodRange(k) {
    const now = new Date(Date.now() + 6 * 3600e3), iso = d => d.toISOString().slice(0, 10), today = iso(now);
    if (k === 'month') return [today.slice(0, 8) + '01', today];
    if (k === 'last') { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); return [iso(d).slice(0, 8) + '01', iso(d)]; }
    if (k === '30') return [iso(new Date(now - 29 * 864e5)), today];
    if (k === 'year') return [today.slice(0, 4) + '-01-01', today];
    return [rep.from || today.slice(0, 8) + '01', rep.to || today];
  }
  let ACC_OLD = '';
  async function viewReports() {
    const [from, to] = periodRange(rep.period);
    if (canRead('acc')) { try { ACC_OLD = (await api('acc/meta')).settings.old_until || ''; } catch (e) { ACC_OLD = ''; } }
    const d = await api(`report?from=${from}&to=${to}&basis=${rep.basis}`);
    const fin = d.finance;
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const bar = (label, v, cls) => `<div class="wf-row ${cls || ''}"><span>${label}</span><i style="--w:${d.revenue ? Math.min(100, Math.abs(v) / d.revenue * 100) : 0}%"></i><b>${v < 0 ? '−' : ''}${money(Math.abs(v))}</b></div>`;
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Profit &amp; loss</h1><p class="muted">${from} to ${to} · ${d.basis === 'delivered' ? 'delivered orders only' : 'all orders except cancelled'}</p></div>
        <button class="btn ghost sm" id="repPrint">Print</button></div>
      <div class="filters rep-filters">
        <div class="chips">${[['month', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['year', 'This year'], ['custom', 'Choose dates']].map(([k, l]) => `<button class="chip" data-period="${k}" aria-pressed="${rep.period === k}">${l}</button>`).join('')}</div>
        ${rep.period === 'custom' ? `<label class="date-f">From <input type="date" id="rFrom" value="${from}"></label><label class="date-f">To <input type="date" id="rTo" value="${to}"></label>` : ''}
        <label class="check"><input type="checkbox" id="rBasis" ${rep.basis === 'delivered' ? 'checked' : ''}> Delivered orders only (money in hand)</label>
      </div>
      ${ACC_OLD && from <= ACC_OLD ? `<p class="info-box">This page uses the <b>new rule</b>. For dates up to ${shortDay(ACC_OLD)} the Accounts and Shareholders pages use the old Google Sheet rule (sales − all khoroch), so their profit can differ for that period.</p>` : ''}
      ${d.missingCost.length ? `<p class="warn-box">The profit is an estimate: ${d.missingCost.length} item${d.missingCost.length > 1 ? 's have' : ' has'} no cost price yet, so their cost counts as 0. Add it in Products${d.missingCost.includes('CUSTOM') ? ' and in Tailoring (fabric cost per gaj) plus the tailoring cost below' : ''}.<br><span class="muted small">${d.missingNames.slice(0, 6).map(esc).join(' · ')}${d.missingNames.length > 6 ? ' …' : ''}</span></p>` : ''}
      <div class="kpis kpis-5">
        <div class="kpi"><span>Sales</span><strong>${money(d.revenue)}</strong><small>${plural(d.orders, 'order')} · ${d.pieces} pcs</small></div>
        <div class="kpi"><span>Cost of goods</span><strong>${money(d.goodsCost)}</strong><small>${pct(d.goodsCost, d.revenue)}% of sales</small></div>
        <div class="kpi"><span>Gross profit</span><strong>${money(d.gross)}</strong><small>after cost, courier and COD fee</small></div>
        <div class="kpi"><span>Expenses</span><strong>${money(d.expenses)}</strong><small>ads, rent, salary…</small></div>
        <div class="kpi kpi-net ${d.net < 0 ? 'neg' : ''}"><span>Net profit</span><strong>${d.net < 0 ? '−' : ''}${money(Math.abs(d.net))}</strong><small>${d.margin}% of sales</small></div>
      </div>
      <div class="dash-grid"><div class="dash-col">
        <section class="card"><div class="card-head"><h2>Sales and profit by day</h2><span class="muted small"><i class="lg lg-s"></i> Sales <i class="lg lg-p"></i> Profit before expenses</span></div>${profitChart(d.daily, from, to)}</section>
        <section class="card"><div class="card-head"><h2>Profit by product</h2></div>
          ${d.products.length ? `<table class="tbl"><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="r">Margin</th></tr></thead><tbody>
          ${d.products.map(p => `<tr><td>${esc(p.name)}<span class="muted block">${esc(p.code)}${p.missing ? ' · <em class="down">no cost price</em>' : ''}</span></td><td class="r">${p.qty}</td><td class="r">${money(p.revenue)}</td><td class="r">${money(p.cost)}</td><td class="r"><b class="${p.profit < 0 ? 'down' : ''}">${money(p.profit)}</b></td><td class="r"><span class="mbar" style="--m:${Math.max(0, p.margin)}%">${p.margin}%</span></td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">No sales in this period.</p>'}
        </section>
      </div><div class="dash-col">
        <section class="card"><h2>Where the money went</h2><div class="wf">
          ${bar('Sales (what customers paid)', d.revenue, 'pos')}
          ${bar('Cost of goods', -d.goodsCost)}${bar('Courier charges', -d.courierCost)}${d.codFee ? bar('COD fee', -d.codFee) : ''}${bar('Expenses', -d.expenses)}
          ${bar('Net profit', d.net, d.net < 0 ? 'neg' : 'net')}</div>
          <p class="muted small">Customers paid ${money(d.deliveryCharged)} delivery charge (included in sales). Discounts given: ${money(d.discounts)}.</p></section>
        <section class="card"><div class="card-head"><h2>Expenses</h2></div>
          <form id="expForm" class="exp-form"><div class="g2">
            <label class="field"><span>Date</span><input type="date" name="day" value="${to}"></label>
            <label class="field"><span>Type</span><select name="category">${EXP_CATS.map(c => `<option>${c}</option>`).join('')}</select></label></div>
            <div class="g2"><label class="field"><span>Amount (BDT)</span><input type="number" name="amount" min="1" required></label>
            <label class="field"><span>Note <small>optional</small></span><input name="note" placeholder="Eid campaign"></label></div>
            <button class="btn primary sm" type="submit">Add expense</button></form>
          ${d.expenseByCat.length ? `<ul class="exp-cats">${d.expenseByCat.map(c => `<li><span>${esc(c.category)}</span><i style="--w:${pct(c.amount, d.expenses)}%"></i><b>${money(c.amount)}</b></li>`).join('')}</ul>` : ''}
          ${d.expenseList.length ? `<ul class="mini-list exp-list">${d.expenseList.map(e => `<li><div class="exp-li"><span><strong>${esc(e.category)}</strong><span class="muted block">${esc(e.day)}${e.note ? ' · ' + esc(e.note) : ''}</span></span><span class="r">${money(e.amount)}<span><button class="text-btn" data-expedit="${e.id}">Edit</button> · <button class="text-btn" data-expdel="${e.id}">Delete</button></span></span></div></li>`).join('')}</ul>` : '<p class="muted small">No expenses in this period.</p>'}
        </section>
        <section class="card"><h2>Your costs</h2><p class="muted small">Used to work out profit. Only you see these.</p>
          <form id="finForm"><div class="g2">
            <label class="field"><span>Courier cost inside Dhaka</span><input type="number" name="courier_inside" min="0" value="${fin.courier_inside}"></label>
            <label class="field"><span>Courier cost outside Dhaka</span><input type="number" name="courier_outside" min="0" value="${fin.courier_outside}"></label>
            <label class="field"><span>COD fee (%) <small>courier keeps this from cash</small></span><input type="number" name="cod_fee_pct" min="0" max="5" step="0.1" value="${fin.cod_fee_pct}"></label>
            <label class="field"><span>Tailoring cost per custom thobe</span><input type="number" name="tailoring_cost" min="0" value="${fin.tailoring_cost == null ? '' : fin.tailoring_cost}" placeholder="e.g. 600"></label></div>
            <button class="btn primary sm" type="submit">Save costs</button></form></section>
      </div></div><dialog class="adlg" id="entryDlg"></dialog></div>`;
    const root = $('#main .vroot');
    root.addEventListener('click', async e => {
      const pb = e.target.closest('[data-period]'); if (pb) { rep.period = pb.dataset.period; viewReports().catch(fail); return; }
      const ed = e.target.closest('[data-expedit]');
      if (ed) { try { ACC = await api('acc/meta'); const r = await api('acc/entries?q=TX-' + ed.dataset.expedit); if (r.rows[0]) openEntry(r.rows[0]); } catch (err) { fail(err); } return; }
      const del = e.target.closest('[data-expdel]');
      if (del && confirm('Delete this expense?')) { try { await api('expenses/' + del.dataset.expdel, { method: 'DELETE' }); toast('Expense deleted'); viewReports().catch(fail); } catch (err) { fail(err); } }
    });
    $('#rBasis').addEventListener('change', e => { rep.basis = e.target.checked ? 'delivered' : 'all'; viewReports().catch(fail); });
    ['rFrom', 'rTo'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('change', () => { rep.from = $('#rFrom').value; rep.to = $('#rTo').value; viewReports().catch(fail); }); });
    $('#repPrint').addEventListener('click', () => window.print());
    $('#expForm').addEventListener('submit', async e => { e.preventDefault(); try { await api('expenses', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Expense added'); viewReports().catch(fail); } catch (err) { fail(err); } });
    $('#finForm').addEventListener('submit', async e => { e.preventDefault(); try { await api('finance', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Costs saved'); viewReports().catch(fail); } catch (err) { fail(err); } });
  }
  function profitChart(daily, from, to) {
    const days = [];
    for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z') && days.length < 400; d = new Date(+d + 864e5)) days.push(d.toISOString().slice(0, 10));
    const by = Object.fromEntries(daily.map(r => [r.day, r]));
    const W = 720, H = 220, pad = 34, n = Math.max(1, days.length), bw = (W - pad - 10) / n;
    const max = Math.max(1, ...days.map(d => by[d] ? Math.max(by[d].revenue, by[d].profit) : 0)), min = Math.min(0, ...days.map(d => by[d] ? by[d].profit : 0));
    const y = v => 14 + (max - v) / (max - min) * (H - 40);
    const lbl = v => Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v);
    let s = [max, (max + min) / 2, min].map(v => `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${pad - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${lbl(v)}</text>`).join('');
    const pts = [];
    days.forEach((d, i) => {
      const r = by[d] || { revenue: 0, profit: 0, orders: 0 }, x = pad + i * bw;
      s += `<g><title>${d}: sales ${money(r.revenue)}, profit ${money(r.profit)} (${r.orders} orders)</title><rect x="${x + bw * .15}" y="${y(r.revenue)}" width="${Math.max(1, bw * .7)}" height="${Math.max(0, y(0) - y(r.revenue))}" rx="2" class="bs"/></g>`;
      pts.push(`${x + bw / 2},${y(r.profit)}`);
      if (n <= 31 ? (i % 5 === 0 || i === n - 1) : (d.endsWith('-01'))) s += `<text x="${x + bw / 2}" y="${H - 6}" class="ax" text-anchor="middle">${d.slice(5).replace('-', '/')}</text>`;
    });
    s += `<polyline points="${pts.join(' ')}" class="pl"/>`;
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and profit by day">${s}</svg></div>`;
  }

  // ================= ACCOUNTS (জমা-খরচ, অ্যাকাউন্ট, শেয়ারহোল্ডার) =================
  const tk = n => '৳ ' + Number(n || 0).toLocaleString('en-IN');
  const KIND_LABEL = { revenue: 'Sales / income', capital: 'Share capital', loan: 'Loan taken', other_income: 'Other income',
    expense: 'Expense', stock: 'Stock (fabric, buttons)', asset: 'Asset (machine, furniture)', payout: 'Profit paid to partner', loan_repay: 'Loan repaid', courier: 'Courier charge' };
  const KIND_HELP = { stock: 'Not counted as expense when bought. Its cost counts when the thobe is sold.', asset: 'Long-term things like a machine. Not an expense for profit.',
    payout: 'Money a partner takes from profit.', capital: 'Shareholder’s investment, not profit.', courier: 'Already estimated in Profit & loss from your courier rates.' };
  let ACC = null, accFilt = { from: '', to: '', type: '', category: '', account: '', partner: '', q: '' }, accPeriod = 'month';
  const todayBD = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const shortDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // আগের নিয়ম + নতুন নিয়ম আলাদা করে দেখানো, যাতে পার্টনাররা Google Sheet-এর সাথে মেলাতে পারেন
  function profitSplit(parts, total, perHead) {
    if (!parts || !parts.old) return '';
    const n = perHead || 1, ph = v => perHead ? ` <span class="muted">(each ${tk(Math.round(v / n))})</span>` : '';
    return `<div class="psplit">
      <div><span>Up to ${shortDay(parts.old.to)} <small>old rule, same as the Google Sheet: sales − all khoroch</small></span><b class="${parts.old.net < 0 ? 'down' : 'up'}">${tk(parts.old.net)}</b>${ph(parts.old.net)}</div>
      ${parts.new ? `<div><span>From ${shortDay(parts.new.from)} <small>new rule: fabric is stock, machine is an asset</small></span><b class="${parts.new.net < 0 ? 'down' : 'up'}">${tk(parts.new.net)}</b>${ph(parts.new.net)}</div>` : ''}
      <div class="ps-tot"><span>Total profit</span><b class="${total < 0 ? 'down' : 'up'}">${tk(total)}</b>${ph(total)}</div></div>`;
  }
  const accTabs = sub => `<div class="acc-tabs">${[['overview', 'Overview'], ['book', 'Cash book'], ['partners', 'Shareholders'], ['settings', 'Settings', 'super'], ['import', 'Import from Google Sheet', 'super']]
    .filter(t => !t[2] || ME.user.role === 'super').map(([k, l]) => `<a href="#accounts/${k}" aria-current="${sub === k ? 'page' : 'false'}">${l}</a>`).join('')}</div>`;
  async function viewAccounts(sub) {
    ACC = await api('acc/meta');
    if (sub === 'book') return accBook();
    if (sub === 'partners') return accPartners();
    if (sub === 'settings') return accSettingsView();
    if (sub === 'import') return accImport();
    return accOverview();
  }
  const entryAmt = e => `<b class="amt ${e.type}">${e.type === 'in' ? '+' : e.type === 'out' ? '−' : '⇄'} ${tk(e.amount)}</b>`;
  const entryWhat = e => e.type === 'transfer' ? `${esc(e.account)} → ${esc(e.to_account)}` : `${esc(e.category || '—')}${e.partner ? ` <span class="muted">(${esc(e.partner)})</span>` : ''}`;
  const typeTag = t => `<span class="tt tt-${t}">${{ in: 'Joma', out: 'Khoroch', transfer: 'Transfer' }[t]}</span>`;

  async function accOverview() {
    const [from, to] = periodRange(accPeriod);
    const d = await api(`acc/overview?from=${from}&to=${to}`);
    const pct = Math.min(100, d.capTarget ? Math.round(d.capPaid / d.capTarget * 100) : 0);
    const outCats = d.categories.filter(c => c.type === 'out'), outTotal = outCats.reduce((t, c) => t + c.v, 0);
    const ruleTxt = { equal: 'shared equally', capital: 'shared by capital paid', custom: 'shared by set percentages' }[d.rule];
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Accounts</h1><p class="muted">Joma, khoroch, balances and shareholders in one place. Website sales post here by themselves when an order is delivered.</p></div>
        <div class="head-tools w-only"><button class="btn ghost sm" id="settleBtn">Courier payment received</button><button class="btn primary" data-new="in">+ Joma</button><button class="btn primary dark" data-new="out">− Khoroch</button><button class="btn ghost" data-new="transfer">⇄ Transfer</button></div></div>
      ${accTabs('overview')}
      <div class="chips">${[['month', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['year', 'This year']].map(([k, l]) => `<button class="chip" data-aperiod="${k}" aria-pressed="${accPeriod === k}">${l}</button>`).join('')}</div>
      <div class="kpis kpis-5">
        <div class="kpi kpi-net"><span>Money in hand now</span><strong>${tk(d.cashNow)}</strong><small>Cash + bKash + Nagad + Bank</small></div>
        <div class="kpi"><span>Courier owes you</span><strong>${tk(d.courierDue)}</strong><small>COD collected, not yet paid to you</small></div>
        <div class="kpi"><span>Joma (${from.slice(5)} to ${to.slice(5)})</span><strong class="up">${tk(d.periodIn)}</strong><small>${d.entries} entries</small></div>
        <div class="kpi"><span>Khoroch</span><strong class="down">${tk(d.periodOut)}</strong><small>stock bought ${tk(d.stockBought)}</small></div>
        <a class="kpi kpi-link" href="#reports"><span>Net profit</span><strong class="${d.profit.net < 0 ? 'neg' : ''}">${tk(d.profit.net)}</strong><small>${d.profit.old ? `old rule up to ${shortDay(d.profit.old.to)}` : `${d.profit.margin}% margin`}${d.profit.missing ? ` · <em class="down">${d.profit.missing} without cost</em>` : ''}</small></a>
      </div>
      <div class="acc-cards">${d.accounts.filter(a => a.active).map(a => `<a class="acard ak-${a.kind}" href="#accounts/book" data-acc="${a.id}"><span>${esc(a.name)}</span><strong class="${a.balance < 0 ? 'neg' : ''}">${tk(a.balance)}</strong></a>`).join('')}</div>
      <div class="dash-grid"><div class="dash-col">
        <section class="card"><div class="card-head"><h2>Joma and khoroch, last 12 months</h2><span class="muted small"><i class="lg lg-in"></i> Joma <i class="lg lg-out"></i> Khoroch</span></div>${monthBars(d.months)}</section>
        <section class="card"><div class="card-head"><h2>Recent entries</h2><a class="link" href="#accounts/book">Cash book</a></div>
          ${d.recent.length ? `<ul class="mini-list">${d.recent.map(e => `<li><div class="exp-li"><span>${typeTag(e.type)} ${entryWhat(e)}<span class="muted block">${esc(e.day)} · ${esc(e.type === 'transfer' ? '' : e.account || '')}${e.note ? ' · ' + esc(e.note.slice(0, 50)) : ''}</span></span><span class="r">${entryAmt(e)}</span></div></li>`).join('')}</ul>` : '<p class="muted">No entries yet. Add your first joma or khoroch.</p>'}
        </section>
      </div><div class="dash-col">
        <section class="card"><div class="card-head"><h2>Shareholder capital</h2><a class="link" href="#accounts/partners">Details</a></div>
          <p class="cap-line"><b>${tk(d.capPaid)}</b> of ${tk(d.capTarget)} <span class="muted">(${pct}%)</span></p><div class="cap-bar"><i style="--w:${pct}%"></i></div>
          <table class="tbl"><thead><tr><th>Name</th><th class="r">Paid</th><th class="r">Due</th><th class="r">Profit share</th></tr></thead><tbody>
          ${d.partners.map(p => `<tr><td><a href="#accounts/partners" class="plink" data-pid="${p.id}">${esc(p.name)}</a> <span class="pst pst-${p.status.toLowerCase()}">${p.status}</span></td><td class="r">${tk(p.paid)}</td><td class="r ${p.due ? 'down' : ''}">${tk(p.due)}</td><td class="r"><b class="${p.profitShare < 0 ? 'down' : ''}">${tk(p.profitShare)}</b></td></tr>`).join('')}</tbody></table>
          ${profitSplit(d.profitParts, d.netProfit)}
          <p class="muted small">Profit to date ${tk(d.netProfit)}, ${ruleTxt}${d.basis === 'delivered' ? ', counting delivered orders' : ''}.</p></section>
        <section class="card"><h2>Where khoroch went</h2>${outCats.length ? donut(outCats.map(c => [c.name, c.v])) + `<ul class="exp-cats">${outCats.map((c, i) => `<li><span><i class="dot" style="--c:${PALETTE[i % PALETTE.length]}"></i>${esc(c.name)} <small class="muted">${KIND_LABEL[c.kind] && c.kind !== 'expense' ? '· ' + KIND_LABEL[c.kind] : ''}</small></span><i style="--w:${outTotal ? Math.round(c.v / outTotal * 100) : 0}%"></i><b>${tk(c.v)}</b></li>`).join('')}</ul>` : '<p class="muted">No khoroch in this period.</p>'}</section>
      </div></div>
      <dialog class="adlg" id="entryDlg"></dialog></div>`;
    bindAccCommon();
    $('#main .vroot').addEventListener('click', e => {
      const pb = e.target.closest('[data-aperiod]'); if (pb) { accPeriod = pb.dataset.aperiod; accOverview().catch(fail); }
      const ac = e.target.closest('[data-acc]'); if (ac) { accFilt = { ...accFilt, account: ac.dataset.acc }; }
      const pl = e.target.closest('[data-pid]'); if (pl) { e.preventDefault(); openStatement(Number(pl.dataset.pid)); }
    });
    const sb = $('#settleBtn'); if (sb) sb.addEventListener('click', openSettle);
  }
  const PALETTE = ['#B5630A', '#1F2D4E', '#2E7D32', '#9C27B0', '#C62828', '#00838F', '#6D4C41', '#F9A825', '#455A64', '#AD1457', '#558B2F'];
  function donut(items) {
    const tot = items.reduce((t, x) => t + x[1], 0) || 1, R = 70, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = items.map((x, i) => { const len = x[1] / tot * C, a = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(x[0])}: ${tk(x[1])}</title></circle>`; off += len; return a; }).join('');
    return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Khoroch by category"><g transform="rotate(-90 90 90)">${arcs}</g><text x="90" y="86" text-anchor="middle" class="dn-l">Total</text><text x="90" y="106" text-anchor="middle" class="dn-v">${tk(tot)}</text></svg></div>`;
  }
  function monthBars(months) {
    if (!months.length) return '<p class="muted">Nothing yet.</p>';
    const W = 720, H = 220, pad = 40, n = months.length, bw = (W - pad) / n, max = Math.max(1, ...months.flatMap(m => [m.inn, m.outt]));
    const y = v => H - 26 - v / max * (H - 46);
    let s = [0, .5, 1].map(f => `<line x1="${pad}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="gl"/><text x="${pad - 6}" y="${y(max * f) + 4}" class="ax" text-anchor="end">${max * f >= 1000 ? Math.round(max * f / 1000) + 'k' : Math.round(max * f)}</text>`).join('');
    months.forEach((m, i) => {
      const x = pad + i * bw, w = Math.max(3, bw * .32);
      s += `<g><title>${m.m}: joma ${tk(m.inn)}, khoroch ${tk(m.outt)}</title><rect x="${x + bw * .14}" y="${y(m.inn)}" width="${w}" height="${H - 26 - y(m.inn)}" rx="2" class="b-in"/><rect x="${x + bw * .14 + w + 2}" y="${y(m.outt)}" width="${w}" height="${H - 26 - y(m.outt)}" rx="2" class="b-out"/></g>`;
      s += `<text x="${x + bw / 2}" y="${H - 8}" class="ax" text-anchor="middle">${new Date(m.m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly joma and khoroch">${s}</svg></div>`;
  }

  // ---------- এন্ট্রি ফর্ম (জমা / খরচ / ট্রান্সফার) ----------
  function bindAccCommon() {
    $('#main .vroot').addEventListener('click', e => { const nb = e.target.closest('[data-new]'); if (nb) openEntry({ type: nb.dataset.new }); });
  }
  function openEntry(e) {
    const dlg = $('#entryDlg'), type = e.type || 'in';
    const cats = ACC.categories.filter(c => c.type === type && (c.active || c.id === e.category_id));
    const accs = ACC.accounts.filter(a => a.active || a.id === e.account_id || a.id === e.to_account_id);
    const partners = ACC.partners.filter(p => p.active || p.id === e.partner_id);
    let attachment = e.attachment || '';
    dlg.innerHTML = `<form class="adlg-body entry-form t-${type}" id="entryForm">
      <div class="adlg-head"><div><h2>${e.id ? 'Edit TX-' + e.id : { in: 'New joma', out: 'New khoroch', transfer: 'Move money between accounts' }[type]}</h2>
        ${e.id ? `<p class="muted small">Added by ${esc(e.created_by || '—')}${e.updated_by ? ` · last edit ${esc(e.updated_by)}` : ''}${e.source === 'order' ? ` · from website order ${esc(e.order_no)}` : ''}</p>` : ''}</div><button type="button" class="icon" data-x aria-label="Close">×</button></div>
      <div class="type-seg">${[['in', 'Joma'], ['out', 'Khoroch'], ['transfer', 'Transfer']].map(([k, l]) => `<button type="button" data-tsw="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}</div>
      <div class="g2">
        <label class="field"><span>Date</span><input type="date" name="day" value="${esc(e.day || todayBD())}" required></label>
        <label class="field big-amt"><span>Amount (৳)</span><input type="number" name="amount" min="1" step="1" inputmode="numeric" value="${e.amount || ''}" required autofocus></label>
      </div>
      ${type === 'transfer' ? `<div class="g2">
        <label class="field"><span>From</span><select name="account_id">${accs.map(a => `<option value="${a.id}" ${a.id === e.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="field"><span>To</span><select name="to_account_id">${accs.map((a, i) => `<option value="${a.id}" ${(e.to_account_id ? a.id === e.to_account_id : i === 1) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>`
      : `<div class="g2">
        <label class="field"><span>Category</span><select name="category_id" id="enCat">${cats.map(c => `<option value="${c.id}" data-kind="${c.kind}" ${c.id === e.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><small class="muted" id="kindHelp"></small></label>
        <label class="field"><span>${type === 'in' ? 'Came into' : 'Paid from'}</span><select name="account_id">${accs.filter(a => a.kind !== 'courier' || a.id === e.account_id).map(a => `<option value="${a.id}" ${a.id === e.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
        <label class="field" id="partnerRow" hidden><span>Shareholder</span><select name="partner_id"><option value="">Choose…</option>${partners.map(p => `<option value="${p.id}" ${p.id === e.partner_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${type === 'in' ? 'Received from' : 'Paid to'} <small>optional</small></span><input name="person" value="${esc(e.person || '')}" list="personList"></label>`}
      <div class="g2">
        <label class="field"><span>Voucher / reference <small>optional</small></span><input name="ref" value="${esc(e.ref || '')}"></label>
        <label class="field"><span>Note <small>optional</small></span><input name="note" value="${esc(e.note || '')}" placeholder="What was it for?"></label></div>
      <div class="attach"><div id="attPrev">${attachment ? `<a href="/img/${esc(attachment)}" target="_blank" rel="noopener"><img src="/img/${esc(attachment)}" alt="Receipt"></a>` : ''}</div>
        <label class="upload"><input type="file" accept="image/*" id="attUp" hidden><span class="btn ghost sm">${attachment ? 'Change receipt photo' : 'Add receipt photo'}</span></label>
        ${attachment ? '<button type="button" class="text-btn" id="attRm">Remove</button>' : ''}</div>
      <p class="err" id="enErr" hidden></p>
      <div class="row-btns">${e.id && ['super', 'admin'].includes(ME.user.role) ? '<button type="button" class="btn danger sm" id="enDel">Delete</button>' : ''}<span class="spacer"></span>
        <button type="button" class="btn ghost" data-x>Cancel</button>${e.id ? '' : '<button type="submit" class="btn ghost" data-again>Save and add another</button>'}<button type="submit" class="btn primary">${e.id ? 'Save changes' : 'Save'}</button></div>
      <datalist id="personList">${[...new Set(ACC.partners.map(p => p.name))].map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    </form>`;
    if (!dlg.open) dlg.showModal();
    const f = $('#entryForm');
    const kindSync = () => {
      const sel = $('#enCat'); if (!sel) return;
      const k = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.kind : '';
      $('#partnerRow').hidden = !(k === 'capital' || k === 'payout');
      $('#kindHelp').textContent = KIND_HELP[k] || '';
    };
    if ($('#enCat')) { $('#enCat').addEventListener('change', kindSync); kindSync(); }
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelectorAll('[data-tsw]').forEach(b => b.onclick = () => openEntry({ ...e, ...Object.fromEntries(new FormData(f)), amount: f.amount.value, type: b.dataset.tsw, category_id: null }));
    $('#attUp').addEventListener('change', async ev => {
      const file = ev.target.files[0]; if (!file) return;
      try { toast('Uploading…'); attachment = await uploadFile(file, 1600); $('#attPrev').innerHTML = `<img src="/img/${esc(attachment)}" alt="Receipt">`; toast('Receipt added'); } catch (err) { fail(err); }
    });
    const rm = $('#attRm'); if (rm) rm.onclick = () => { attachment = ''; $('#attPrev').innerHTML = ''; };
    let again = false;
    const ag = f.querySelector('[data-again]'); if (ag) ag.onclick = () => { again = true; };
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = { ...Object.fromEntries(new FormData(f)), type, attachment };
      try {
        await api('acc/entries' + (e.id ? '/' + e.id : ''), { method: e.id ? 'PUT' : 'POST', body });
        toast(e.id ? 'Entry updated' : 'Saved');
        if (again) { again = false; openEntry({ type, day: body.day, account_id: Number(body.account_id), category_id: Number(body.category_id) || null }); return; }
        dlg.close(); route();
      } catch (err) { $('#enErr').textContent = err.message; $('#enErr').hidden = false; again = false; }
    });
    const del = $('#enDel');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete TX-${e.id} (${tk(e.amount)})? This is written in the activity log.`)) return;
      try { await api('acc/entries/' + e.id, { method: 'DELETE' }); toast('Entry deleted'); dlg.close(); route(); } catch (err) { fail(err); }
    };
  }
  function openSettle() {
    const dlg = $('#entryDlg');
    const accs = ACC.accounts.filter(a => a.active && a.kind !== 'courier');
    dlg.innerHTML = `<form class="adlg-body" id="settleForm"><div class="adlg-head"><div><h2>Courier payment received</h2><p class="muted small">When Steadfast or another courier pays you the cash they collected.</p></div><button type="button" class="icon" data-x>×</button></div>
      <div class="g2"><label class="field"><span>Date</span><input type="date" name="day" value="${todayBD()}"></label>
        <label class="field"><span>Money came into</span><select name="to_account_id">${accs.map(a => `<option value="${a.id}" ${a.kind === 'bank' ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="field big-amt"><span>Amount received (৳)</span><input type="number" name="received" min="0" required></label>
        <label class="field"><span>Courier charges they kept (৳)</span><input type="number" name="charge" min="0" value="0"></label>
        <label class="field"><span>Invoice / reference</span><input name="ref"></label><label class="field"><span>Note</span><input name="note"></label></div>
      <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`;
    dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    $('#settleForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      try { await api('acc/settle', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); toast('Courier payment saved'); dlg.close(); route(); } catch (err) { fail(err); }
    });
  }

  // ---------- ক্যাশ বুক: খোঁজা, ফিল্টার, এডিট ----------
  async function accBook() {
    const qs = new URLSearchParams(Object.entries(accFilt).filter(([, v]) => v));
    const d = await api('acc/entries?' + qs);
    const opt = (list, cur, lab) => list.map(x => `<option value="${x.id}" ${String(cur) === String(x.id) ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Cash book</h1><p class="muted">Every joma, khoroch and transfer. Click a row to see or edit it.</p></div>
        <div class="head-tools"><button class="btn ghost sm" id="bookCsv">Download CSV</button><button class="btn ghost sm" onclick="print()">Print</button>
        <span class="w-only"><button class="btn primary" data-new="in">+ Joma</button> <button class="btn primary dark" data-new="out">− Khoroch</button> <button class="btn ghost" data-new="transfer">⇄</button></span></div></div>
      ${accTabs('book')}
      <form class="filters book-f" id="bookF">
        <label class="date-f">From <input type="date" name="from" value="${esc(accFilt.from)}"></label><label class="date-f">To <input type="date" name="to" value="${esc(accFilt.to)}"></label>
        <select name="type"><option value="">All types</option>${[['in', 'Joma'], ['out', 'Khoroch'], ['transfer', 'Transfer']].map(([k, l]) => `<option value="${k}" ${accFilt.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select name="category"><option value="">All categories</option>${opt(ACC.categories, accFilt.category, c => (c.type === 'in' ? 'Joma · ' : 'Khoroch · ') + c.name)}</select>
        <select name="account"><option value="">All accounts</option>${opt(ACC.accounts, accFilt.account, a => a.name)}</select>
        <select name="partner"><option value="">All shareholders</option>${opt(ACC.partners, accFilt.partner, p => p.name)}</select>
        <input class="search" type="search" name="q" placeholder="Search note, person, TX-12, order no" value="${esc(accFilt.q)}">
        <button class="btn ghost sm" type="button" id="bookClear">Clear</button></form>
      <div class="book-sum"><span>${d.total} entr${d.total === 1 ? 'y' : 'ies'}${d.total > d.rows.length ? ` (latest ${d.rows.length} shown)` : ''}</span><span>Joma <b class="up">${tk(d.sumIn)}</b></span><span>Khoroch <b class="down">${tk(d.sumOut)}</b></span><span>Difference <b>${tk(d.sumIn - d.sumOut)}</b></span></div>
      ${d.rows.length ? `<div class="card flush"><table class="tbl book">
        <thead><tr><th>ID</th><th>Date</th><th>Type</th><th>Category</th><th>Details</th><th>Account</th><th class="r">Amount</th><th>By</th></tr></thead>
        <tbody>${d.rows.map((e, i) => `<tr data-row="${i}" tabindex="0">
          <td class="muted nowrap">TX-${e.id}</td><td class="nowrap">${esc(e.day)}</td><td>${typeTag(e.type)}</td><td>${entryWhat(e)}</td>
          <td>${esc(e.person || '')}${e.person && e.note ? ' · ' : ''}<span class="muted">${esc(e.note || '')}</span>${e.ref ? ` <span class="ref">#${esc(e.ref)}</span>` : ''}${e.attachment ? ' 📎' : ''}${e.source === 'order' ? ' <b class="tag">Website</b>' : e.source === 'import' ? ' <b class="tag">Sheet</b>' : ''}</td>
          <td class="nowrap">${e.type === 'transfer' ? `${esc(e.account)} → ${esc(e.to_account)}` : esc(e.account || '')}</td>
          <td class="r nowrap">${entryAmt(e)}</td><td class="small muted">${esc(e.created_by || '')}${e.updated_by ? `<br>edit: ${esc(e.updated_by)}` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">No entries match. Clear the filters or add a new entry.</p>'}
      <dialog class="adlg" id="entryDlg"></dialog></div>`;
    bindAccCommon();
    const f = $('#bookF');
    let t;
    const apply = () => { accFilt = Object.fromEntries(new FormData(f)); accBook().then(() => { const q = $('#bookF').q; if (document.activeElement === document.body && q.value) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }).catch(fail); };
    f.addEventListener('change', e => { if (e.target.name !== 'q') apply(); });
    f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 400); });
    $('#bookClear').onclick = () => { accFilt = { from: '', to: '', type: '', category: '', account: '', partner: '', q: '' }; accBook().catch(fail); };
    const open = tr => { const e = d.rows[Number(tr.dataset.row)]; if (canWrite('acc')) openEntry(e); };
    $('#main .vroot').addEventListener('click', e => { const tr = e.target.closest('tr[data-row]'); if (tr) open(tr); });
    $('#main .vroot').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-row]'); if (tr && e.key === 'Enter') open(tr); });
    $('#bookCsv').onclick = () => {
      const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const rows = [['ID', 'Date', 'Type', 'Category', 'Shareholder', 'Account', 'To account', 'Amount', 'Person', 'Reference', 'Note', 'Added by', 'Edited by', 'Order']];
      d.rows.forEach(e => rows.push(['TX-' + e.id, e.day, { in: 'Joma', out: 'Khoroch', transfer: 'Transfer' }[e.type], e.category, e.partner, e.account, e.to_account, e.amount, e.person, e.ref, e.note, e.created_by, e.updated_by, e.order_no]));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = `al-hadaf-cashbook-${todayBD()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  // ---------- শেয়ারহোল্ডার ----------
  async function accPartners() {
    const d = await api(`acc/overview?from=${todayBD().slice(0, 8)}01&to=${todayBD()}`);
    const sup = ME.user.role === 'super';
    const pct = Math.min(100, d.capTarget ? Math.round(d.capPaid / d.capTarget * 100) : 0);
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Shareholders</h1><p class="muted">Capital each partner has put in, what is still due, their share of profit and what they have taken.</p></div>
        <div class="head-tools">${sup ? '<button class="btn ghost sm" id="allTarget">Change everyone’s target</button><button class="btn primary sm" id="addPartner">Add shareholder</button>' : ''}<span class="w-only"><button class="btn primary" data-new="in">+ Capital joma</button></span></div></div>
      ${accTabs('partners')}
      <section class="card cap-card"><div class="cap-top"><div><span class="muted">Capital collected</span><strong>${tk(d.capPaid)}</strong><span class="muted">of ${tk(d.capTarget)}</span></div><div class="cap-ring" style="--p:${pct}"><b>${pct}%</b></div></div>
        ${profitSplit(d.profitParts, d.netProfit, d.rule === 'equal' ? d.partners.length : 0)}
        <p class="muted small">Profit to date: <b>${tk(d.netProfit)}</b> · rule: <b>${{ equal: 'equal shares', capital: 'by capital paid', custom: 'by set percentages' }[d.rule]}</b>${sup ? ' · <a href="#accounts/settings" class="link">change</a>' : ''}</p></section>
      <div class="partner-grid">${d.partners.map(p => `<article class="card pcard">
        <div class="pc-head"><span class="pav">${esc(p.name.charAt(0))}</span><div><h3>${esc(p.name)}</h3><span class="pst pst-${p.status.toLowerCase()}">${p.status}</span> <span class="muted small">${Math.round(p.ratio * 1000) / 10}% of profit</span></div></div>
        <div class="pbar"><i style="--w:${p.target ? Math.min(100, Math.round(p.paid / p.target * 100)) : 0}%"></i></div>
        <dl class="pdl"><dt>Target</dt><dd>${tk(p.target)}</dd><dt>Paid</dt><dd>${tk(p.paid)}</dd><dt>Due</dt><dd class="${p.due ? 'down' : ''}">${tk(p.due)}</dd>
          <dt>Profit share</dt><dd><b>${tk(p.profitShare)}</b></dd><dt>Taken</dt><dd>${tk(p.taken)}</dd><dt>Can still take</dt><dd><b class="${p.balance < 0 ? 'down' : 'up'}">${tk(p.balance)}</b></dd></dl>
        <div class="row-btns"><button class="btn ghost sm" data-stmt="${p.id}">Statement</button>${sup ? `<button class="btn ghost sm" data-pedit="${p.id}">Edit</button>` : ''}</div>
      </article>`).join('')}</div>
      <div id="stmtBox"></div>
      <dialog class="adlg" id="entryDlg"></dialog><dialog class="adlg" id="pDlg"></dialog></div>`;
    bindAccCommon();
    $('#main .vroot').addEventListener('click', e => {
      const st = e.target.closest('[data-stmt]'); if (st) openStatement(Number(st.dataset.stmt));
      const pe = e.target.closest('[data-pedit]'); if (pe) partnerForm(ACC.partners.find(p => p.id === Number(pe.dataset.pedit)));
    });
    const ap = $('#addPartner'); if (ap) ap.onclick = () => partnerForm({});
    const at = $('#allTarget'); if (at) at.onclick = () => {
      const dlg = $('#pDlg');
      dlg.innerHTML = `<form class="adlg-body" id="atForm"><div class="adlg-head"><h2>Change everyone’s target</h2><button type="button" class="icon" data-x>×</button></div>
        <p class="muted small">For example from 20,000 to 50,000. Each change is saved in every shareholder’s target history.</p>
        <div class="g2"><label class="field"><span>New target (৳)</span><input type="number" name="target" min="1" required></label><label class="field"><span>Reason <small>optional</small></span><input name="note" placeholder="Meeting decision"></label></div>
        <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Change target</button></div></form>`;
      dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
      $('#atForm').onsubmit = async ev => { ev.preventDefault(); try { await api('acc/targets', { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) }); toast('Targets changed'); dlg.close(); accPartners().catch(fail); } catch (err) { fail(err); } };
    };
  }
  function partnerForm(p) {
    const dlg = $('#pDlg');
    dlg.innerHTML = `<form class="adlg-body" id="pForm"><div class="adlg-head"><h2>${p.id ? 'Edit ' + esc(p.name) : 'Add shareholder'}</h2><button type="button" class="icon" data-x>×</button></div>
      <div class="g2"><label class="field"><span>Name</span><input name="name" value="${esc(p.name || '')}" required></label><label class="field"><span>Mobile <small>optional</small></span><input name="phone" value="${esc(p.phone || '')}"></label>
      <label class="field"><span>Capital target (৳)</span><input type="number" name="target" min="0" value="${p.target == null ? 50000 : p.target}"></label>
      <label class="field"><span>Profit % <small>used only with the “set percentages” rule</small></span><input type="number" name="share_pct" min="0" max="100" step="0.01" value="${p.share_pct || 0}"></label>
      <label class="field"><span>Reason if target changes <small>optional</small></span><input name="note"></label>
      <label class="field"><span>Order</span><input type="number" name="sort" value="${p.sort || 0}"></label></div>
      ${p.id ? `<label class="check"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''}> Active shareholder</label>` : ''}
      <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`;
    dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    $('#pForm').onsubmit = async ev => {
      ev.preventDefault();
      const body = { ...Object.fromEntries(new FormData(ev.target)), active: ev.target.active ? ev.target.active.checked : true };
      try { await api('acc/partners' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body }); toast('Saved'); dlg.close(); accPartners().catch(fail); } catch (err) { fail(err); }
    };
  }
  async function openStatement(id) {
    if (!location.hash.startsWith('#accounts/partners')) { location.hash = 'accounts/partners'; await new Promise(r => setTimeout(r, 400)); }
    const d = await api('acc/partner/' + id), p = d.partner;
    let run = 0;
    $('#stmtBox').innerHTML = `<section class="card stmt" id="stmt">
      <div class="stmt-head"><div><img src="/logo-light.png" alt="Al Hadaf" height="40"><h2>Shareholder statement</h2><p class="big">${esc(p.name)}</p><p class="muted small">Printed ${todayBD()}</p></div>
        <button class="btn ghost sm noprint" onclick="print()">Print</button></div>
      <div class="stmt-kpis"><div><span>Target</span><b>${tk(p.target)}</b></div><div><span>Paid</span><b>${tk(p.paid)}</b></div><div><span>Due</span><b>${tk(p.due)}</b></div>
        <div><span>Profit share</span><b>${tk(p.profitShare)}</b></div><div><span>Taken</span><b>${tk(p.taken)}</b></div><div><span>Balance</span><b>${tk(p.balance)}</b></div></div>
      ${d.profitParts && d.profitParts.old ? `<h3 class="sub">How the profit share is worked out</h3>${profitSplit(d.profitParts, d.netProfit)}<p class="muted small">${esc(p.name)}’s part: ${Math.round(p.ratio * 1000) / 10}% = ${tk(p.profitShare)}</p>` : ''}
      <h3 class="sub">Money in and out</h3>
      <table class="tbl"><thead><tr><th>Date</th><th>What</th><th>Account</th><th>Reference</th><th class="r">Amount</th><th class="r">Capital so far</th></tr></thead><tbody>
      ${d.entries.length ? d.entries.map(e => { if (e.kind === 'capital') run += e.amount; return `<tr><td>${esc(e.day)}</td><td>${e.kind === 'capital' ? 'Capital paid in' : 'Profit taken'}</td><td>${esc(e.account || '')}</td><td>${esc(e.ref || e.note || '')}</td><td class="r">${e.kind === 'capital' ? '+' : '−'} ${tk(e.amount)}</td><td class="r">${tk(run)}</td></tr>`; }).join('') : '<tr><td colspan="6" class="muted">No entries yet.</td></tr>'}</tbody></table>
      <h3 class="sub">Target history</h3>
      ${d.targetLog.length ? `<ul class="tlog">${d.targetLog.map(l => `<li><b>${tk(l.old_target)} → ${tk(l.new_target)}</b> <span class="muted">${fmtWhen(l.at)} by ${esc(l.by_name || '')}${l.note ? ' · ' + esc(l.note) : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">Target has not changed.</p>'}
    </section>`;
    $('#stmt').scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- সেটিংস (শুধু সুপার অ্যাডমিন) ----------
  function accSettingsView() {
    const s = ACC.settings;
    const kinds = type => (type === 'in' ? ACC.inKinds : ACC.outKinds);
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><h1>Accounts settings</h1></div>${accTabs('settings')}
      <section class="card"><h2>Profit sharing</h2><form id="ruleForm"><div class="opts-v">
        ${[['equal', 'Equal shares', 'Every active shareholder gets the same part.'], ['capital', 'By capital paid', 'Whoever has put in more capital gets more.'], ['custom', 'Set percentages', 'Use the profit % written on each shareholder.']]
          .map(([k, l, h]) => `<label class="opt-card"><input type="radio" name="profit_rule" value="${k}" ${s.profit_rule === k ? 'checked' : ''}><span><b>${l}</b><small>${h}</small></span></label>`).join('')}</div>
        <div class="g2"><label class="field"><span>Count profit from</span><select name="profit_basis"><option value="delivered" ${s.profit_basis === 'delivered' ? 'selected' : ''}>Delivered orders only (money received)</option><option value="all" ${s.profit_basis === 'all' ? 'selected' : ''}>All orders except cancelled</option></select></label>
        <label class="field"><span>Business start date <small>profit counts from here</small></span><input type="date" name="start_day" value="${esc(s.start_day)}"></label>
        <label class="field"><span>Old rule used up to <small>leave empty to use only the new rule</small></span><input type="date" name="old_until" value="${esc(s.old_until || '')}"></label>
        <p class="muted small rule-help">Up to this date profit is worked out like your old Google Sheet: sales minus <b>all</b> khoroch, including fabric and machines. After it, fabric counts as stock and a machine as an asset. This keeps the old numbers your partners already know.</p></div>
        <button class="btn primary sm">Save</button></form></section>
      <section class="card"><div class="card-head"><h2>Accounts</h2><button class="btn ghost sm" data-addacc>Add account</button></div>
        <p class="muted small">Opening balance = money already in that account on the day you start using this.</p>
        <table class="tbl"><thead><tr><th>Name</th><th>Type</th><th class="r">Opening</th><th>Active</th><th></th></tr></thead><tbody>
        ${ACC.accounts.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td class="r">${tk(a.opening)}</td><td>${a.active ? 'Yes' : 'No'}</td><td class="r"><button class="btn ghost sm" data-eacc="${a.id}">Edit</button></td></tr>`).join('')}</tbody></table></section>
      <section class="card"><div class="card-head"><h2>Categories</h2><span><button class="btn ghost sm" data-addcat="in">Add joma category</button> <button class="btn ghost sm" data-addcat="out">Add khoroch category</button></span></div>
        <p class="muted small">The “kind” decides how profit is counted. Fabric and buttons are <b>stock</b>: their cost counts when the thobe sells. A machine is an <b>asset</b>.</p>
        <div class="g2">${['in', 'out'].map(type => `<div><h3 class="sub">${type === 'in' ? 'Joma' : 'Khoroch'}</h3><table class="tbl"><tbody>
          ${ACC.categories.filter(c => c.type === type).map(c => `<tr class="${c.active ? '' : 'off'}"><td>${esc(c.name)}</td><td class="muted small">${KIND_LABEL[c.kind]}</td><td class="r"><button class="btn ghost sm" data-ecat="${c.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`).join('')}</div></section>
      <section class="card danger-zone"><h2>Start over</h2>
        <p class="muted small">Deletes the joma, khoroch and transfer entries so you can enter everything again. Shareholders, accounts and categories stay. A full backup file downloads to your computer first.</p>
        <button class="btn danger sm" id="resetBtn">Delete all entries…</button></section>
      <section class="card"><h2>Website sales</h2><p class="muted small">Delivered orders post as Sales by themselves (into bKash if paid by bKash, otherwise into “Courier (to receive)”). Orders delivered before this update can be posted once:</p>
        <button class="btn ghost sm" id="backfill">Post past delivered orders</button></section>
      <dialog class="adlg" id="sDlg"></dialog></div>`;
    $('#ruleForm').onsubmit = async ev => { ev.preventDefault(); try { await api('acc/settings', { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) }); toast('Saved'); } catch (err) { fail(err); } };
    $('#resetBtn').onclick = () => {
      dlg.innerHTML = `<form class="adlg-body" id="rsForm"><div class="adlg-head"><div><h2>Delete all entries</h2><p class="muted small">This cannot be undone from here. A backup file downloads first, and Cloudflare keeps 7 days of history.</p></div><button type="button" class="icon" data-x>×</button></div>
        <label class="check"><input type="checkbox" name="keep_orders" checked> Keep sales that came from website orders</label>
        <label class="check"><input type="checkbox" name="reset_opening" checked> Set every account’s opening balance to 0</label>
        <label class="check"><input type="checkbox" name="reset_target_log"> Also clear shareholders’ target history</label>
        <label class="field"><span>Type <b>DELETE</b> to confirm</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label>
        <p class="err" id="rsErr" hidden></p>
        <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn danger" id="rsGo">Download backup and delete</button></div></form>`;
      dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
      $('#rsForm').onsubmit = async ev => {
        ev.preventDefault();
        const f = ev.target;
        if (f.confirm.value.trim().toUpperCase() !== 'DELETE') { $('#rsErr').textContent = 'Type DELETE in the box to confirm.'; $('#rsErr').hidden = false; return; }
        $('#rsGo').disabled = true; $('#rsGo').textContent = 'Saving backup…';
        try {
          // আগে পুরো ক্যাশ বুক CSV হিসেবে ডাউনলোড
          const d = await api('acc/entries?all=1');
          const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
          const rows = [['ID', 'Date', 'Type', 'Category', 'Description', 'Amount', 'Payment Method', 'Paid/Received By', 'Note', 'Timestamp', 'Shareholder', 'Created By', 'Last Edited By', 'Order']];
          d.rows.slice().reverse().forEach(e => rows.push(['TX-' + e.id, e.day, { in: 'Joma', out: 'Khoroch', transfer: 'Transfer' }[e.type], e.type === 'transfer' ? 'Transfer to ' + e.to_account : e.category, e.note, e.amount, e.account, e.person, e.ref, e.created_at, e.partner, e.created_by, e.updated_by, e.order_no]));
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
          a.download = `al-hadaf-accounts-backup-${todayBD()}.csv`; document.body.appendChild(a); a.click(); a.remove();
          await new Promise(r => setTimeout(r, 800));
          $('#rsGo').textContent = 'Deleting…';
          const r = await api('acc/reset', { method: 'POST', body: { confirm: 'DELETE', keep_orders: f.keep_orders.checked, reset_opening: f.reset_opening.checked, reset_target_log: f.reset_target_log.checked } });
          dlg.close(); toast(`${r.deleted} entries deleted. Backup saved in your Downloads.`); location.hash = 'accounts/overview';
        } catch (err) { $('#rsErr').textContent = err.message; $('#rsErr').hidden = false; $('#rsGo').disabled = false; $('#rsGo').textContent = 'Download backup and delete'; }
      };
    };
    $('#backfill').onclick = async () => { try { const r = await api('acc/backfill', { method: 'POST' }); toast(`${r.posted} orders posted as sales`); } catch (err) { fail(err); } };
    const dlg = $('#sDlg');
    const form = (title, html, path, method) => {
      dlg.innerHTML = `<form class="adlg-body" id="sForm"><div class="adlg-head"><h2>${title}</h2><button type="button" class="icon" data-x>×</button></div>${html}
        <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`;
      dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
      $('#sForm').onsubmit = async ev => { ev.preventDefault(); const b = Object.fromEntries(new FormData(ev.target)); b.active = ev.target.active ? ev.target.active.checked : true;
        try { await api(path, { method, body: b }); toast('Saved'); dlg.close(); viewAccounts('settings').catch(fail); } catch (err) { fail(err); } };
    };
    $('#main .vroot').addEventListener('click', e => {
      const aa = e.target.closest('[data-addacc]'), ea = e.target.closest('[data-eacc]'), ac = e.target.closest('[data-addcat]'), ec = e.target.closest('[data-ecat]');
      if (aa || ea) {
        const a = ea ? ACC.accounts.find(x => x.id === Number(ea.dataset.eacc)) : { kind: 'bank', opening: 0, active: 1 };
        form(a.id ? 'Edit account' : 'Add account', `<div class="g2"><label class="field"><span>Name</span><input name="name" value="${esc(a.name || '')}" required></label>
          <label class="field"><span>Type</span><select name="kind">${['cash', 'bkash', 'nagad', 'bank', 'courier', 'other'].map(k => `<option ${a.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label class="field"><span>Opening balance (৳)</span><input type="number" name="opening" value="${a.opening || 0}"></label><label class="field"><span>Order</span><input type="number" name="sort" value="${a.sort || 0}"></label></div>
          <label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active</label>`, 'acc/accounts' + (a.id ? '/' + a.id : ''), a.id ? 'PUT' : 'POST');
      }
      if (ac || ec) {
        const c = ec ? ACC.categories.find(x => x.id === Number(ec.dataset.ecat)) : { type: ac.dataset.addcat, active: 1 };
        form(c.id ? 'Edit category' : 'Add category', `<input type="hidden" name="type" value="${c.type}"><div class="g2"><label class="field"><span>Name</span><input name="name" value="${esc(c.name || '')}" required></label>
          <label class="field"><span>Kind</span><select name="kind">${kinds(c.type).map(k => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></label>
          <label class="field"><span>Order</span><input type="number" name="sort" value="${c.sort || 0}"></label></div>
          <label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Active</label>`, 'acc/categories' + (c.id ? '/' + c.id : ''), c.id ? 'PUT' : 'POST');
      }
    });
  }

  // ---------- Google Sheet থেকে আনা ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  function accImport() {
    $('#main').innerHTML = `<div class="vroot"><div class="page-head"><div><h1>Import from Google Sheet</h1><p class="muted">Bring your old Al Hadaf Accounts entries here, so the history is not lost.</p></div></div>${accTabs('import')}
      <section class="card"><ol class="steps-ol"><li>Open your Google Sheet and go to the <b>Entries</b> tab.</li><li>File › Download › <b>Comma-separated values (.csv)</b>.</li><li>Choose that file below, check the preview, then press Import.</li></ol>
        <label class="upload"><input type="file" accept=".csv,text/csv" id="csvUp" hidden><span class="btn primary">Choose the CSV file</span></label>
        <p class="muted small">Running it twice is safe: entries already imported are skipped. “Capital” and “Share Capital” become one category. Fabric and buttons are counted as stock.</p>
        <div id="impPrev"></div></section></div>`;
    $('#csvUp').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      const rows = parseCsv((await file.text()).replace(/^\ufeff/, ''));
      // শিরোনামের সারি খোঁজা (প্রথম ৫ সারির মধ্যে যেটায় Date, Type, Amount আছে)
      const norm = h => String(h || '').replace(/^\ufeff/, '').trim().toLowerCase().replace(/\s+/g, ' ');
      let hi = rows.slice(0, 5).findIndex(r => { const h = r.map(norm); return h.some(x => x.startsWith('date') || x.includes('তারিখ')) && h.some(x => x.startsWith('type') || x.includes('ধরন')) && h.some(x => x.startsWith('amount') || x.includes('পরিমাণ')); });
      if (hi < 0) {
        const first = (rows[0] || []).map(norm).filter(Boolean).slice(0, 4).join(', ');
        const tab = /categor/.test(first) ? 'Categories' : /shareholder/.test(first) ? 'Shareholders' : /total joma|financial/.test(first) ? 'Dashboard' : /month/.test(first) ? 'Monthly Report' : /user|action/.test(first) ? 'Audit Log' : '';
        $('#impPrev').innerHTML = `<p class="warn-box"><b>This file is not the Entries tab${tab ? ` (it looks like the <b>${tab}</b> tab)` : ''}.</b><br>
          In Google Sheets, first click the <b>Entries</b> tab at the bottom of the screen so it is open, then File › Download › Comma-separated values (.csv), and choose that new file here.
          ${first ? `<br><span class="muted small">First row of your file: ${esc(first)}</span>` : ''}</p>`;
        return;
      }
      const head = rows[hi].map(norm), body = rows.slice(hi + 1);
      const col = (...names) => head.findIndex(h => names.some(n => h.startsWith(n) || h.includes(n)));
      const ix = { id: col('entry id', 'id'), date: col('date', 'তারিখ'), type: col('type', 'ধরন'), category: col('category', 'ক্যাটাগরি'), description: col('description', 'বিবরণ'),
        amount: col('amount', 'পরিমাণ'), method: col('payment method', 'method', 'মাধ্যম'), person: col('paid/received', 'person'), note: col('note', 'reference'), shareholder: col('shareholder'), createdBy: col('created by') };
      const pick = (r, k) => ix[k] >= 0 ? String(r[ix[k]] || '').trim() : '';
      // তারিখ: 2026-06-01, 01/06/2026 বা 6/1/2026 — পুরো ফাইল দেখে ঠিক করা হয় দিন আগে না মাস আগে
      const slash = body.map(r => pick(r, 'date').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)).filter(Boolean);
      const dayFirst = slash.some(m => Number(m[1]) > 12) || !slash.some(m => Number(m[2]) > 12);
      const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const toDay = v => {
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
        let m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
        if (m) { const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]]; return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
        m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})/);
        if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return v;
      };
      const data = body.map(r => ({ id: pick(r, 'id'), date: toDay(pick(r, 'date')), type: pick(r, 'type'), category: pick(r, 'category'), description: pick(r, 'description'),
        amount: pick(r, 'amount'), method: pick(r, 'method'), person: pick(r, 'person'), ref: pick(r, 'note'), shareholder: pick(r, 'shareholder'), createdBy: pick(r, 'createdBy') }))
        .filter(x => x.type || x.amount);
      const bad = data.filter(x => !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !/^(joma|khoroch|in|out)/i.test(x.type) || !(Number(String(x.amount).replace(/[^0-9.]/g, '')) > 0));
      const sum = t => data.filter(x => new RegExp('^' + t, 'i').test(x.type)).reduce((s, x) => s + (Number(String(x.amount).replace(/[^0-9.]/g, '')) || 0), 0);
      if (!data.length) { $('#impPrev').innerHTML = '<p class="warn-box">The Entries tab is empty. Nothing to import.</p>'; return; }
      $('#impPrev').innerHTML = `<h3 class="sub">Preview: ${data.length} rows · joma ${tk(sum('joma'))} · khoroch ${tk(sum('khoroch'))}</h3>
        <div class="card flush"><table class="tbl"><thead><tr><th>ID</th><th>Date</th><th>Type</th><th>Category</th><th>Shareholder</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>
        ${data.slice(0, 15).map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.date)}</td><td>${esc(x.type)}</td><td>${esc(x.category)}</td><td>${esc(x.shareholder)}</td><td>${esc(x.method)}</td><td class="r">${esc(x.amount)}</td></tr>`).join('')}</tbody></table></div>
        ${data.length > 15 ? `<p class="muted small">…and ${data.length - 15} more</p>` : ''}
        ${bad.length ? `<p class="warn-box">${bad.length} row${bad.length > 1 ? 's have' : ' has'} a problem (date, type or amount) and will be skipped, for example ${esc(bad[0].id || '')} ${esc(bad[0].date)} ${esc(bad[0].type)} ${esc(bad[0].amount)}.</p>` : ''}
        <p class="muted small">Check: the totals above should match “Total Joma” and “Total Khoroch” on your Sheet’s Dashboard.</p>
        <p><button class="btn primary" id="doImport">Import ${data.length - bad.length} entries</button></p><div id="impRes"></div>`;
      $('#doImport').onclick = async ev => {
        ev.target.disabled = true; ev.target.textContent = 'Importing…';
        let added = 0, skipped = 0, errors = [];
        for (let i = 0; i < data.length; i += 200) {
          try { const r = await api('acc/import', { method: 'POST', body: { rows: data.slice(i, i + 200) } }); added += r.added; skipped += r.skipped; errors = errors.concat(r.errors); }
          catch (err) { fail(err); break; }
        }
        $('#impRes').innerHTML = `<p class="ok-box">Imported <b>${added}</b> entries, skipped ${skipped} that were already here.${errors.length ? `<br>${errors.length} rows had problems: ${errors.slice(0, 5).map(esc).join('; ')}` : ''}</p><a class="btn ghost" href="#accounts/overview">See accounts</a>`;
        ev.target.textContent = 'Done';
      };
    });
  }

  // ================= TEAM & ACCESS =================
  const ROLE_HELP = { super: 'Everything, including team, shareholder targets and account settings.', admin: 'Everything except team and accounts settings.',
    accountant: 'Accounts, profit & loss and reports. Can see orders but not change them.', staff: 'Orders, chats, customers and unfinished orders. No money pages.', view: 'Can look at everything but change nothing. Good for partners.' };
  async function viewTeam() {
    const d = await api('users');
    $('#main').innerHTML = `<div class="vroot"><div class="page-head"><div><h1>Team &amp; access</h1><p class="muted">Each person logs in with their own username and password. Everything they change is written in the activity log.</p></div>
        <button class="btn primary" id="addUser">Add person</button></div>
      <div class="role-help">${Object.entries(d.roles).map(([k, l]) => `<div><b>${l}</b><small>${ROLE_HELP[k]}</small></div>`).join('')}</div>
      <div class="card flush"><table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Last login</th><th></th></tr></thead><tbody>
        <tr><td><b>Owner</b></td><td>owner <span class="muted small">(empty username + ADMIN_PASSWORD)</span></td><td><span class="rtag r-super">Super admin</span></td><td>—</td><td></td></tr>
        ${d.users.map(u => `<tr class="${u.active ? '' : 'off'}"><td><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="muted">(turned off)</span>'}</td><td>${esc(u.username)}</td><td><span class="rtag r-${u.role}">${esc(d.roles[u.role])}</span></td>
          <td class="small">${u.last_login ? fmtWhen(u.last_login) : 'Never'}</td><td class="r"><button class="btn ghost sm" data-uedit="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      <dialog class="adlg" id="uDlg"></dialog></div>`;
    const dlg = $('#uDlg');
    const form = u => {
      dlg.innerHTML = `<form class="adlg-body" id="uForm"><div class="adlg-head"><h2>${u.id ? 'Edit ' + esc(u.name) : 'Add person'}</h2><button type="button" class="icon" data-x>×</button></div>
        <div class="g2"><label class="field"><span>Name</span><input name="name" value="${esc(u.name || '')}" required></label>
        <label class="field"><span>Username</span><input name="username" value="${esc(u.username || '')}" ${u.id ? 'disabled' : 'required'} autocapitalize="none" placeholder="tamim"></label>
        <label class="field"><span>${u.id ? 'New password <small>leave empty to keep</small>' : 'Password <small>at least 8 characters</small>'}</span><input type="text" name="password" ${u.id ? '' : 'required minlength="8"'} autocomplete="new-password"></label>
        <label class="field"><span>Role</span><select name="role">${Object.entries(d.roles).map(([k, l]) => `<option value="${k}" ${(u.role || 'staff') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <p class="muted small" id="roleHelp"></p>
        ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Can log in</label>` : ''}
        <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`;
      dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
      const f = $('#uForm'), rh = () => { $('#roleHelp').textContent = ROLE_HELP[f.role.value]; };
      f.role.onchange = rh; rh();
      f.onsubmit = async ev => {
        ev.preventDefault();
        const b = Object.fromEntries(new FormData(f)); if (u.id) b.active = f.active.checked;
        try { await api('users' + (u.id ? '/' + u.id : ''), { method: u.id ? 'PUT' : 'POST', body: b }); toast('Saved. Share the username and password with them privately.'); dlg.close(); viewTeam().catch(fail); } catch (err) { fail(err); }
      };
    };
    $('#addUser').onclick = () => form({});
    $('#main .vroot').addEventListener('click', e => { const b = e.target.closest('[data-uedit]'); if (b) form(d.users.find(u => u.id === Number(b.dataset.uedit))); });
  }
  async function changeMyPassword() {
    const cur = prompt('Your current password'); if (!cur) return;
    const next = prompt('New password (at least 8 characters)'); if (!next) return;
    try { await api('password', { method: 'PUT', body: { current: cur, next } }); alert('Password changed. Please log in again.'); showLogin(); } catch (err) { fail(err); }
  }

  // ================= ACTIVITY LOG =================
  let actF = { user: '', area: '', q: '' };
  async function viewActivity() {
    const d = await api('audit?' + new URLSearchParams(Object.entries(actF).filter(([, v]) => v)));
    const areas = ['auth', 'acc', 'orders', 'products', 'users', 'settings', 'coupons', 'custom', 'fabrics', 'banners', 'reviews', 'chats', 'courier', 'sms'];
    $('#main').innerHTML = `<div class="vroot"><div class="page-head"><div><h1>Activity log</h1><p class="muted">Who did what, and when. The latest 300 actions.</p></div></div>
      <form class="filters" id="actF"><select name="user"><option value="">Everyone</option>${d.users.map(u => `<option ${actF.user === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <select name="area"><option value="">All areas</option>${areas.map(a => `<option ${actF.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <input class="search" type="search" name="q" placeholder="Search details" value="${esc(actF.q)}"></form>
      <div class="card flush"><table class="tbl act"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Area</th><th>Details</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td class="nowrap small">${fmtWhen(r.at)}</td><td><b>${esc(r.user_name || '')}</b></td><td><span class="act-a a-${esc(r.action).toLowerCase()}">${esc(r.action)}</span></td>
        <td class="small">${esc(r.area)}${r.ref ? ` <span class="muted">${esc(r.ref)}</span>` : ''}</td><td class="small act-d">${esc(r.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</tbody></table></div></div>`;
    const f = $('#actF'); let t;
    f.onchange = () => { actF = Object.fromEntries(new FormData(f)); viewActivity().catch(fail); };
    f.q.oninput = () => { clearTimeout(t); t = setTimeout(() => { actF = Object.fromEntries(new FormData(f)); viewActivity().catch(fail); }, 400); };
  }

  // ================= SALES (দোকান, ফেসবুক, হোয়াটসঅ্যাপের বিক্রি + রিপোর্ট) =================
  let salesPeriod = 'month', salesFrom = '', salesTo = '';
  async function viewSales(arg) {
    if (arg === 'new') return saleForm();
    let [from, to] = periodRange(salesPeriod === 'custom' ? 'custom' : salesPeriod);
    if (salesPeriod === 'custom') { from = salesFrom || from; to = salesTo || to; }
    if (salesPeriod === 'today') from = to = todayBD();
    const d = await api(`sales/report?from=${from}&to=${to}`);
    const diff = (a, b) => b ? Math.round((a - b) / b * 100) : null;
    const dr = diff(d.revenue, d.prev.revenue), dn = diff(d.orders, d.prev.orders);
    const arrow = v => v == null ? '' : `<em class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</em> vs before`;
    const bars = (list, labelFn, valFn = x => x.value, cnt = x => x.n) => { const max = Math.max(1, ...list.map(valFn)); return list.length ? `<ul class="hbars">${list.map(x => `<li><span>${labelFn(x)}</span><i style="--w:${Math.round(valFn(x) / max * 100)}%"></i><b>${money(valFn(x))}</b><small>${cnt(x)}</small></li>`).join('')}</ul>` : '<p class="muted small">No sales.</p>'; };
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], wmax = Math.max(1, ...d.weekdays), hmax = Math.max(1, ...d.hours);
    $('#main').innerHTML = `<div class="vroot">
      <div class="page-head"><div><h1>Sales</h1><p class="muted">Website, shop, Facebook and WhatsApp sales together. ${from} to ${to}</p></div>
        <div class="head-tools"><button class="btn ghost sm" onclick="print()">Print</button>${canWrite('sales') ? '<a class="btn primary" href="#sales/new">+ New sale</a>' : ''}</div></div>
      <div class="filters"><div class="chips">${[['today', 'Today'], ['month', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['year', 'This year'], ['custom', 'Choose dates']].map(([k, l]) => `<button class="chip" data-sp="${k}" aria-pressed="${salesPeriod === k}">${l}</button>`).join('')}</div>
        ${salesPeriod === 'custom' ? `<label class="date-f">From <input type="date" id="sFrom" value="${from}"></label><label class="date-f">To <input type="date" id="sTo" value="${to}"></label>` : ''}</div>
      <div class="kpis kpis-5">
        <div class="kpi kpi-net"><span>Sales</span><strong>${money(d.revenue)}</strong><small>${arrow(dr) || '&nbsp;'}</small></div>
        <div class="kpi"><span>Number of sales</span><strong>${d.orders}</strong><small>${d.pieces} pieces${arrow(dn) ? ' · ' + arrow(dn) : ''}</small></div>
        <div class="kpi"><span>Average sale</span><strong>${money(d.avg)}</strong><small>discounts given ${money(d.discount)}</small></div>
        <div class="kpi"><span>Cancelled / returned</span><strong>${d.cancelled} / ${d.returned}</strong><small>${d.cancelRate}% of orders · ${money(d.cancelledValue)}</small></div>
        <a class="kpi kpi-link" href="#orders" data-due-link><span>Due from customers</span><strong class="${d.due.total ? 'down' : ''}">${money(d.due.total)}</strong><small>${d.due.list.length} sale${d.due.list.length === 1 ? '' : 's'} not fully paid</small></a>
      </div>
      <div class="dash-grid"><div class="dash-col">
        <section class="card"><div class="card-head"><h2>Sales by day</h2></div>${salesDaily(d.daily, from, to)}</section>
        <section class="card"><div class="card-head"><h2>Products sold</h2></div>
          ${d.products.length ? `<table class="tbl"><thead><tr><th>Product</th><th class="r">Pieces</th><th class="r">Sales</th></tr></thead><tbody>${d.products.slice(0, 15).map(x => `<tr><td>${esc(x.name)}<span class="muted block">${esc(x.code)}${x.color ? ' · ' + esc(x.color) : ''}</span></td><td class="r">${x.qty}</td><td class="r">${money(x.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales in this period.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Top customers</h2><a class="link" href="#customers">All customers</a></div>
          ${d.topCustomers.length ? `<ul class="mini-list">${d.topCustomers.map(c => `<li><div class="exp-li"><span><button class="linklike" data-cust="${esc(c.phone)}"><strong>${esc(c.name)}</strong></button><span class="muted block">${esc(c.phone)} · ${c.orders} sale${c.orders > 1 ? 's' : ''}</span></span><b>${money(c.value)}</b></div></li>`).join('')}</ul>` : '<p class="muted">No customers with a mobile number yet.</p>'}</section>
      </div><div class="dash-col">
        <section class="card"><h2>Where sales came from</h2>${bars(d.channels, x => `<b class="chtag ch-${x.key}">${esc(x.label)}</b>`)}</section>
        <section class="card"><h2>Sizes</h2>${bars(d.sizes, x => esc(x.key))}</section>
        <section class="card"><h2>Colours</h2>${bars(d.colors.slice(0, 8), x => esc(x.key))}</section>
        <section class="card"><h2>Payment</h2>${bars(d.payments, x => esc(x.key))}</section>
        <section class="card"><h2>Who sold</h2>${bars(d.staff, x => esc(x.key))}</section>
        <section class="card"><h2>Busy days and hours</h2>
          <div class="wd">${WD.map((w, i) => `<div><i style="--h:${Math.round(d.weekdays[i] / wmax * 100)}%"></i><span>${w}</span><small>${d.weekdays[i]}</small></div>`).join('')}</div>
          <div class="hrs">${d.hours.map((h, i) => `<i title="${i}:00 · ${h} sales" style="--o:${(h / hmax).toFixed(2)}"></i>`).join('')}</div><p class="muted small">Darker = more sales. 12 am on the left, 11 pm on the right.</p></section>
        ${d.due.list.length ? `<section class="card"><h2>Due from customers</h2><ul class="mini-list">${d.due.list.slice(0, 12).map(x => `<li><div class="exp-li"><span><strong>${esc(x.name)}</strong><span class="muted block">${esc(x.order_no)} · ${esc(x.day)}${x.phone ? ' · ' + esc(x.phone) : ''}</span></span><span class="r"><b class="down">${money(x.due)}</b>${canWrite('due') ? `<button class="text-btn" data-collect="${x.id}">Collect</button>` : ''}</span></div></li>`).join('')}</ul></section>` : ''}
      </div></div><dialog class="adlg" id="custDlg"></dialog><dialog class="adlg" id="smsDlg"></dialog><dialog class="adlg" id="payDlg"></dialog></div>`;
    const root = $('#main .vroot');
    root.addEventListener('click', async e => {
      const sp = e.target.closest('[data-sp]'); if (sp) { salesPeriod = sp.dataset.sp; viewSales().catch(fail); return; }
      const cu = e.target.closest('[data-cust]'); if (cu) { if (!custList.length) custList = await api('customers'); openCustomer(cu.dataset.cust); return; }
      const co = e.target.closest('[data-collect]'); if (co) { const x = d.due.list.find(y => String(y.id) === co.dataset.collect); openCollect({ ...x, paid_amount: x.total - x.due }, () => viewSales().catch(fail)); return; }
      if (e.target.closest('[data-due-link]')) { orderDue = true; orderFilter = ''; orderQuery = ''; orderChannel = ''; }
    });
    ['sFrom', 'sTo'].forEach(id => { const el = $('#' + id); if (el) el.onchange = () => { salesFrom = $('#sFrom').value; salesTo = $('#sTo').value; viewSales().catch(fail); }; });
  }
  function salesDaily(daily, from, to) {
    const days = [];
    for (let t = Date.parse(from); t <= Date.parse(to) && days.length < 400; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
    const by = Object.fromEntries(daily.map(r => [r.key, r])), W = 720, H = 200, pad = 34, n = days.length, bw = (W - pad) / Math.max(1, n);
    const max = Math.max(1, ...daily.map(r => r.value)), y = v => H - 24 - v / max * (H - 40);
    let s = [0, .5, 1].map(f => `<line x1="${pad}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="gl"/><text x="${pad - 6}" y="${y(max * f) + 4}" class="ax" text-anchor="end">${max * f >= 1000 ? Math.round(max * f / 1000) + 'k' : Math.round(max * f)}</text>`).join('');
    days.forEach((d, i) => { const r = by[d] || { n: 0, value: 0 }, x = pad + i * bw;
      s += `<g><title>${d}: ${r.n} sales, ${money(r.value)}</title><rect x="${x + bw * .12}" y="${y(r.value)}" width="${Math.max(1, bw * .76)}" height="${H - 24 - y(r.value)}" rx="2" class="${d === todayBD() ? 'today' : ''}"/></g>`;
      if (n <= 31 ? (i % 5 === 0 || i === n - 1) : d.endsWith('-01')) s += `<text x="${x + bw / 2}" y="${H - 6}" class="ax" text-anchor="middle">${d.slice(5).replace('-', '/')}</text>`; });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales by day">${s}</svg></div>`;
  }

  // ---------- নতুন বিক্রি ফর্ম ----------
  let SM = null;
  async function saleForm() {
    SM = await api('sales/meta');
    if (!custList.length) { try { custList = await api('customers'); } catch (e) { custList = []; } }
    const st = { lines: [], payments: [{ account_id: (SM.accounts.find(a => a.kind === 'cash') || SM.accounts[0] || {}).id, amount: '' }] };
    $('#main').innerHTML = `<div class="vroot"><div class="page-head"><div><h1>New sale</h1><p class="muted">For sales in the shop, on Facebook, WhatsApp or by phone. Stock, accounts and the customer’s history update by themselves.</p></div><a class="btn ghost" href="#sales">Sales report</a></div>
      <form id="saleF" class="sale-grid" autocomplete="off">
        <div class="sale-left">
          <section class="card"><h2>Items</h2>
            <div class="pick"><input type="search" id="pSearch" placeholder="Search product name, code or colour"><div id="pList" class="spick"></div></div>
            <div id="lines"></div>
            <button type="button" class="text-btn" id="addOther">+ Add an item that is not in the shop list</button></section>
          <section class="card"><h2>Customer</h2><div class="g2">
            <label class="field"><span>Mobile <small>finds old customers</small></span><input name="phone" inputmode="numeric" placeholder="01XXXXXXXXX" list="custPhones"></label>
            <label class="field"><span>Name</span><input name="name" placeholder="Walk-in customer"></label></div>
            <div id="custHint" class="muted small"></div>
            <datalist id="custPhones">${custList.slice(0, 500).map(c => `<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
            <div class="g2"><label class="field"><span>Where was it sold</span><select name="channel">${Object.entries(SM.channels).filter(([k]) => k !== 'website').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
              <label class="field"><span>How it reaches the customer</span><select name="delivery_mode"><option value="handover">Customer took it now</option><option value="courier">Send by courier</option></select></label></div>
            <div id="addrBox" hidden><label class="field"><span>Address</span><textarea name="address" rows="2"></textarea></label>
              <div class="g2"><label class="field"><span>Area</span><select name="area"><option value="inside">Inside Dhaka</option><option value="outside">Outside Dhaka</option></select></label>
              <label class="field"><span>Delivery charge</span><input type="number" name="delivery" min="0" value="0"></label></div>
              <label class="field"><span>The money not paid now will be</span><select name="due_from"><option value="courier">Collected by the courier (cash on delivery)</option><option value="customer">Paid by the customer later (baki)</option></select></label></div>
            <div class="g2"><label class="field"><span>Date <small>change it to enter an old sale</small></span><input type="date" name="day" value="${todayBD()}"></label>
              <label class="field"><span>Sold by</span><input name="sold_by" value="${esc(ME.user.name)}"></label></div>
            <label class="field"><span>Note <small>optional</small></span><input name="note"></label></section>
        </div>
        <aside class="sale-right card">
          <h2>Payment</h2>
          <p class="row"><span>Subtotal</span><b id="sSub">৳ 0</b></p>
          <label class="field inline"><span>Discount</span><input type="number" name="discount" min="0" value="0"></label>
          <p class="row big"><span>Total</span><b id="sTot">৳ 0</b></p>
          <div class="pay-seg" role="group" aria-label="Payment">${[['full', 'Paid in full'], ['part', 'Part paid'], ['none', 'Not paid (due)']].map(([k, l], i) => `<button type="button" data-ps="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
          <div id="pays"></div>
          <button type="button" class="text-btn" id="addPay">+ Split payment (cash + bKash…)</button>
          <p class="row"><span id="sDueL">Due (baki)</span><b id="sDue">৳ 0</b></p>
          <p class="err" id="sErr" hidden></p>
          <button class="btn primary block" type="submit" id="sSave">Save sale</button>
          <p class="muted small">Leave the amount lower than the total if the customer will pay the rest later.</p>
        </aside>
      </form></div>`;
    const f = $('#saleF');
    const tot = () => { const sub = st.lines.reduce((t, l) => t + (Number(l.price) || 0) * (Number(l.qty) || 0), 0); const dis = Math.min(sub, Number(f.discount.value) || 0), del = f.delivery_mode.value === 'courier' ? Number(f.delivery.value) || 0 : 0; return { sub, total: sub - dis + del }; };
    const drawLines = () => {
      $('#lines').innerHTML = st.lines.length ? `<table class="tbl lines"><thead><tr><th>Item</th><th>Size</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th><th></th></tr></thead><tbody>${st.lines.map((l, i) => `<tr>
        <td>${l.sizeId ? `<b>${esc(l.name)}</b><span class="muted block">${esc(l.code)} · ${esc(l.color)}</span>` : `<input data-l="${i}" data-k="name" value="${esc(l.name)}" placeholder="Item name">`}</td>
        <td>${l.sizeId ? `<select data-l="${i}" data-k="sizeId">${l.sizes.map(z => `<option value="${z.id}" ${z.id === l.sizeId ? 'selected' : ''} ${z.stock <= 0 && z.id !== l.sizeId ? 'disabled' : ''}>${esc(z.label)} (${z.stock})</option>`).join('')}</select>` : '<span class="muted">—</span>'}</td>
        <td class="r"><input type="number" min="1" class="num" data-l="${i}" data-k="qty" value="${l.qty}"></td>
        <td class="r"><input type="number" min="0" class="num" data-l="${i}" data-k="price" value="${l.price}"></td>
        <td class="r">${money((Number(l.price) || 0) * (Number(l.qty) || 0))}</td><td><button type="button" class="icon" data-rm="${i}" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small empty-lines">Search above and tap a product to add it.</p>';
      sync();
    };
    const drawPays = () => {
      $('#pays').innerHTML = st.payments.map((p, i) => `<div class="payrow"><select data-p="${i}" data-k="account_id">${SM.accounts.map(a => `<option value="${a.id}" ${Number(p.account_id) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <input type="number" min="0" data-p="${i}" data-k="amount" value="${p.amount}" placeholder="Amount received">${i ? `<button type="button" class="icon" data-prm="${i}">×</button>` : ''}</div>`).join('');
    };
    const sync = () => {
      const t = tot();
      if (st.payments.length === 1 && !st.payTouched) { st.payments[0].amount = t.total || ''; const inp = $('#pays input'); if (inp) inp.value = st.payments[0].amount; }
      const paid = st.payments.reduce((s2, p) => s2 + (Number(p.amount) || 0), 0);
      $('#sSub').textContent = money(t.sub); $('#sTot').textContent = money(t.total); $('#sDue').textContent = money(Math.max(0, t.total - paid));
      $('#sDue').className = t.total - paid > 0 ? 'down' : '';
      $('#sDueL').textContent = f.delivery_mode.value === 'courier' && f.due_from.value === 'courier' ? 'Courier collects (COD)' : 'Due (baki)';
    };
    const plist = q => {
      q = q.trim().toLowerCase();
      const list = SM.products.filter(p => !q || [p.name, p.code, p.color].join(' ').toLowerCase().includes(q)).slice(0, 12);
      $('#pList').innerHTML = list.map(p => `<button type="button" class="pitem" data-add="${p.id}"><span class="pi-img" style="--c:${esc(p.hex || '#ddd')}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}</span><span><b>${esc(p.name)}</b><small>${esc(p.code)} · ${esc(p.color || '')} · ${money(p.price)}</small><small>${p.sizes.map(z => `${esc(z.label)}:${z.stock}`).join(' ')}</small></span></button>`).join('') || '<p class="muted small">No product found.</p>';
    };
    plist('');
    $('#pSearch').oninput = e => plist(e.target.value);
    $('#pList').onclick = e => { const b = e.target.closest('[data-add]'); if (!b) return; const p = SM.products.find(x => x.id === Number(b.dataset.add)); const z = p.sizes.find(x => x.stock > 0) || p.sizes[0];
      if (!z) return toast('This product has no sizes.', true);
      st.lines.push({ sizeId: z.id, sizes: p.sizes, name: p.name, code: p.code, color: p.color, qty: 1, price: p.price }); drawLines(); };
    $('#addOther').onclick = () => { st.lines.push({ name: '', qty: 1, price: '' }); drawLines(); };
    $('#lines').oninput = e => { const el = e.target, i = el.dataset.l; if (i == null) return; const k = el.dataset.k; st.lines[i][k] = k === 'sizeId' ? Number(el.value) : el.value;
      if (k !== 'name') { const cell = el.closest('tr').children[4]; cell.textContent = money((Number(st.lines[i].price) || 0) * (Number(st.lines[i].qty) || 0)); } sync(); };
    $('#lines').onchange = $('#lines').oninput;
    $('#lines').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { st.lines.splice(Number(b.dataset.rm), 1); drawLines(); } };
    $('#pays').oninput = e => { const el = e.target, i = el.dataset.p; if (i == null) return; st.payments[i][el.dataset.k] = el.value; if (el.dataset.k === 'amount') st.payTouched = true; sync(); };
    $('#pays').onchange = $('#pays').oninput;
    $('#pays').onclick = e => { const b = e.target.closest('[data-prm]'); if (b) { st.payments.splice(Number(b.dataset.prm), 1); drawPays(); sync(); } };
    $('#saleF').querySelector('.pay-seg').onclick = e => {
      const b = e.target.closest('[data-ps]'); if (!b) return;
      $('#saleF').querySelectorAll('[data-ps]').forEach(x => x.setAttribute('aria-pressed', x === b));
      const k = b.dataset.ps, t = tot();
      if (k === 'full') { st.payTouched = false; st.payments = [st.payments[0]]; st.payments[0].amount = t.total || ''; }
      if (k === 'part') { st.payTouched = true; st.payments[0].amount = ''; }
      if (k === 'none') { st.payTouched = true; st.payments = [{ ...st.payments[0], amount: 0 }]; }
      $('#pays').hidden = k === 'none'; $('#addPay').hidden = k === 'none';
      drawPays(); sync(); if (k === 'part') { const i = $('#pays input'); if (i) i.focus(); }
    };
    $('#addPay').onclick = () => { st.payTouched = true; st.payments.push({ account_id: (SM.accounts.find(a => a.kind === 'bkash') || SM.accounts[0]).id, amount: '' }); drawPays(); };
    f.discount.oninput = sync; f.delivery.oninput = sync;
    f.delivery_mode.onchange = () => { $('#addrBox').hidden = f.delivery_mode.value !== 'courier'; sync(); };
    f.due_from.onchange = sync;
    f.phone.oninput = () => { const ph = f.phone.value.replace(/\D/g, '').slice(-11), c = custList.find(x => x.phone === ph);
      $('#custHint').innerHTML = c ? `Returning customer: <b>${esc(c.name)}</b> · bought ${c.orders - c.cancelled} times · spent ${money(c.spent)}${c.due ? ` · <b class="down">due ${money(c.due)}</b>` : ''}` : (ph.length === 11 ? 'New customer' : '');
      if (c && !f.name.value) f.name.value = c.name; if (c && c.address && !f.address.value) f.address.value = c.address; };
    drawLines(); drawPays();
    f.onsubmit = async e => {
      e.preventDefault();
      const body = { ...Object.fromEntries(new FormData(f)), items: st.lines.map(l => l.sizeId ? { sizeId: l.sizeId, qty: l.qty, price: l.price } : { name: l.name, qty: l.qty, price: l.price }), payments: st.payments };
      $('#sSave').disabled = true; $('#sErr').hidden = true;
      try { const r = await api('sales', { method: 'POST', body }); toast(`Sale ${r.orderNo} saved${r.due ? ` · due ${money(r.due)}` : ''}`); location.hash = 'sales'; }
      catch (err) { $('#sErr').textContent = err.message; $('#sErr').hidden = false; $('#sSave').disabled = false; }
    };
  }

  // ---------- বাকি আদায় ----------
  async function openCollect(o, done) {
    let dlg = $('#payDlg'); if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'adlg'; dlg.id = 'payDlg'; $('#main').appendChild(dlg); }
    if (!SM) SM = await api('sales/meta');
    const due = o.total - (o.paid_amount || 0);
    dlg.innerHTML = `<form class="adlg-body" id="colF"><div class="adlg-head"><div><h2>Collect due</h2><p class="muted small">${esc(o.order_no)} · ${esc(o.name)} · total ${money(o.total)} · paid ${money(o.paid_amount || 0)}</p></div><button type="button" class="icon" data-x>×</button></div>
      <div class="g2"><label class="field big-amt"><span>Amount received</span><input type="number" name="amount" min="1" max="${due}" value="${due}"></label>
      <label class="field"><span>Came into</span><select name="account_id">${SM.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Date</span><input type="date" name="day" value="${todayBD()}"></label></div>
      <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`;
    dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    $('#colF').onsubmit = async e => { e.preventDefault(); try { const r = await api('due/' + o.id, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(r.due ? `Saved. Still due ${money(r.due)}` : 'Paid in full'); dlg.close(); done && done(); } catch (err) { fail(err); } };
  }

  // ---------- অর্ডার এডিট (সুপার/অ্যাডমিন) ----------
  async function openOrderEdit(o, done) {
    if (!SM && o.channel && o.channel !== 'website') { try { SM = await api('sales/meta'); } catch (e) { /* cash fallback */ } }
    let dlg = $('#oeDlg'); if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'adlg wide'; dlg.id = 'oeDlg'; $('#main').appendChild(dlg); }
    const items = o.items.map(l => ({ ...l }));
    dlg.innerHTML = `<form class="adlg-body" id="oeF"><div class="adlg-head"><div><h2>Edit ${esc(o.order_no)}</h2><p class="muted small">Every change is written in the activity log with the old values.</p></div><button type="button" class="icon" data-x>×</button></div>
      <div class="g3"><label class="field"><span>Name</span><input name="name" value="${esc(o.name || '')}"></label><label class="field"><span>Mobile</span><input name="phone" value="${esc(o.phone || '')}"></label>
        <label class="field"><span>Date</span><input type="date" name="day" value="${toDate(o.created_at).toISOString().slice(0, 10)}"></label></div>
      <label class="field"><span>Address</span><input name="address" value="${esc(o.address || '')}"></label>
      <div class="g3"><label class="field"><span>Area</span><select name="area"><option value="inside" ${o.area !== 'outside' ? 'selected' : ''}>Inside Dhaka</option><option value="outside" ${o.area === 'outside' ? 'selected' : ''}>Outside Dhaka</option></select></label>
        <label class="field"><span>Channel</span><select name="channel">${Object.entries(CH).map(([k, l]) => `<option value="${k}" ${(o.channel || 'website') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Sold by</span><input name="sold_by" value="${esc(o.sold_by || '')}"></label></div>
      <table class="tbl lines"><thead><tr><th>Item</th><th>Size</th><th class="r">Qty</th><th class="r">Price</th></tr></thead><tbody>${items.map((l, i) => `<tr><td>${l.sizeId ? esc(l.name) : `<input data-i="${i}" data-k="name" value="${esc(l.name)}">`}<span class="muted block">${esc(l.color || '')}</span></td><td>${esc(l.size)}</td>
        <td class="r"><input type="number" min="0" class="num" data-i="${i}" data-k="qty" value="${l.qty}"></td><td class="r"><input type="number" min="0" class="num" data-i="${i}" data-k="price" value="${l.price}"></td></tr>`).join('')}</tbody></table>
      <p class="muted small">Set quantity to 0 to remove an item. Stock changes by the difference.</p>
      <div class="g3"><label class="field"><span>Delivery charge</span><input type="number" min="0" name="delivery" value="${o.delivery}"></label><label class="field"><span>Discount</span><input type="number" min="0" name="discount" value="${o.discount || 0}"></label>
        <label class="field"><span>Note</span><input name="note" value="${esc(o.note || '')}"></label></div>
      ${o.channel && o.channel !== 'website' ? `<div class="paid-edit"><div class="g3">
        <label class="field"><span>Money received so far <small>total ${money(o.total)}</small></span><input type="number" min="0" name="paid_amount" value="${o.paid_amount || 0}"></label>
        <label class="field"><span>If more was received, it came into</span><select name="pay_account_id">${(SM ? SM.accounts : []).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('') || '<option value="">Cash</option>'}</select></label>
        <div class="checks"><button type="button" class="btn ghost sm" id="notPaid">Not paid yet (all due)</button></div></div>
        <p class="muted small">Lower it if the customer has not paid. The money entry in Accounts goes down and the rest shows as due. Collect it later with “Collect due”.</p></div>` : ''}
      <div class="row-btns"><span class="spacer"></span><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Save changes</button></div></form>`;
    dlg.showModal(); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    $('#oeF').oninput = e => { const i = e.target.dataset.i; if (i != null) items[i][e.target.dataset.k] = e.target.dataset.k === 'name' ? e.target.value : Number(e.target.value); };
    const np = $('#notPaid'); if (np) np.onclick = () => { $('#oeF').paid_amount.value = 0; };
    $('#oeF').onsubmit = async e => { e.preventDefault(); const body = { ...Object.fromEntries(new FormData(e.target)), items };
      try { const r = await api(`orders/${o.id}/edit`, { method: 'PUT', body }); toast('Order updated · total ' + money(r.total) + (r.due ? ` · due ${money(r.due)}` : '') + (r.refund ? ` · customer paid ${money(r.refund)} more, give it back` : '')); dlg.close(); done && done(); } catch (err) { fail(err); } };
  }

  // ---------- start ----------
  loadMe().then(showApp).catch(e => { if (e.message !== 'auth') showLogin(); });
})();
