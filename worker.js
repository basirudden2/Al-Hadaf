// ===== Al Hadaf — backend (Cloudflare Worker) =====
// Bindings (wrangler.jsonc): DB = D1 database, IMAGES = KV namespace, ASSETS = static files
// Secret: ADMIN_PASSWORD  (Cloudflare dashboard > Worker > Settings > Variables and Secrets)
// Optional secrets: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (নতুন অর্ডার আর চ্যাট মেসেজের নোটিফিকেশন মোবাইলে পেতে)

const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        return await api(req, env, url, ctx);
      }
      if (url.pathname.startsWith('/img/')) return await serveImage(env, url.pathname.slice(5));
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return json({ error: 'server', message: 'Something went wrong. Please try again.' }, 500);
    }
  }
};

// ---------- helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const bad = (message, status = 400, extra = {}) => json({ error: 'invalid', message, ...extra }, status);
const str = (v, max = 2000) => (v == null ? '' : String(v).trim().slice(0, max));
const int = (v, def = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; };
const intOrNull = v => (v === '' || v == null ? null : int(v, null));
const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function readJson(req) { try { return await req.json(); } catch (e) { return null; } }

// ---------- schema ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name_en TEXT NOT NULL, name_bn TEXT NOT NULL DEFAULT '', on_home INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, category_id INTEGER, group_key TEXT DEFAULT '',
    name_en TEXT NOT NULL, name_bn TEXT DEFAULT '', desc_en TEXT DEFAULT '', desc_bn TEXT DEFAULT '', features_en TEXT DEFAULT '', features_bn TEXT DEFAULT '',
    fabric_en TEXT DEFAULT '', fabric_bn TEXT DEFAULT '', gsm INTEGER, color_en TEXT DEFAULT '', color_bn TEXT DEFAULT '', color_hex TEXT DEFAULT '#EEEEEE',
    price INTEGER NOT NULL DEFAULT 0, compare_price INTEGER, badge_en TEXT DEFAULT '', badge_bn TEXT DEFAULT '',
    is_new INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, images TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS product_sizes (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, label TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0, sort INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_sizes_product ON product_sizes(product_id)`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    name TEXT, phone TEXT, address TEXT, area TEXT, payment TEXT, trx TEXT, note TEXT, items TEXT,
    subtotal INTEGER, delivery INTEGER, total INTEGER, status TEXT DEFAULT 'new', lang TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone, created_at)`,
  `CREATE TABLE IF NOT EXISTS fabrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name_en TEXT NOT NULL, name_bn TEXT DEFAULT '', desc_en TEXT DEFAULT '', desc_bn TEXT DEFAULT '',
    price_add INTEGER NOT NULL DEFAULT 0, color_hex TEXT DEFAULT '#F2F0EA', image TEXT DEFAULT '', gsm INTEGER, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, image TEXT NOT NULL, caption_en TEXT DEFAULT '', caption_bn TEXT DEFAULT '',
    product_code TEXT DEFAULT '', sort INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, name TEXT, phone TEXT, ip TEXT,
    status TEXT DEFAULT 'open', last_msg TEXT DEFAULT '', admin_unread INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at)`
];
// পুরনো ডাটাবেসে নতুন কলাম যোগ (আগে থেকে থাকলে এরর হয়, সেটা উপেক্ষা করা হয়)
const MIGRATIONS = [
  `ALTER TABLE orders ADD COLUMN admin_note TEXT DEFAULT ''`
];

const DEFAULT_SHOP = {
  phone: '01700000000', whatsapp: '8801700000000', email: '', bkash: '01700000000',
  facebook: '', instagram: '', messenger: '', youtube: '', tiktok: '',
  address_en: 'Dhaka, Bangladesh', address_bn: 'ঢাকা, বাংলাদেশ',
  delivery_inside: 70, delivery_outside: 130,
  announce_en: 'Cash on delivery all over Bangladesh. Easy size exchange within 7 days.',
  announce_bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি। ৭ দিনের মধ্যে সহজ সাইজ এক্সচেঞ্জ।'
};

// নিজের মাপে জুব্বা: দাম = base_price + কাপড়ের দাম + বাছাই করা অপশনের দাম
const DEFAULT_CUSTOM = {
  enabled: true, base_price: 2200, lead_days: 7,
  sizes: ['XS/52', 'S/54', 'M/56', 'L/58', 'XL/60', '2XL/62'],
  groups: [
    { key: 'style', name_en: 'Style', name_bn: 'স্টাইল', options: [
      { en: 'Saudi', bn: 'সৌদি', add: 0 }, { en: 'Omani', bn: 'ওমানি', add: 0 }, { en: 'Kuwaiti', bn: 'কুয়েতি', add: 0 }, { en: 'Moroccan', bn: 'মরোক্কান', add: 300 }] },
    { key: 'collar', name_en: 'Collar', name_bn: 'কলার', options: [
      { en: 'Saudi collar', bn: 'সৌদি কলার', add: 0 }, { en: 'Round neck, no collar', bn: 'গোল গলা, কলার ছাড়া', add: 0 }, { en: 'Mandarin collar', bn: 'চাইনিজ কলার', add: 0 }] },
    { key: 'front', name_en: 'Front opening', name_bn: 'সামনের বোতাম', options: [
      { en: 'Hidden buttons', bn: 'লুকানো বোতাম', add: 0 }, { en: 'Visible buttons', bn: 'খোলা বোতাম', add: 0 }, { en: 'Zip', bn: 'চেইন', add: 100 }] },
    { key: 'cuff', name_en: 'Sleeve end', name_bn: 'হাতার মুখ', options: [
      { en: 'Plain sleeve', bn: 'সাধারণ হাতা', add: 0 }, { en: 'Button cuff', bn: 'বোতাম কাফ', add: 0 }, { en: 'Cufflink cuff', bn: 'কাফলিংক কাফ', add: 150 }] },
    { key: 'pocket', name_en: 'Pockets', name_bn: 'পকেট', options: [
      { en: 'Chest pocket', bn: 'বুক পকেট', add: 0 }, { en: 'Two side pockets', bn: 'দুই পাশে পকেট', add: 0 }, { en: 'Chest and side pockets', bn: 'বুক আর পাশে পকেট', add: 100 }] }
  ]
};
// মাপ ইঞ্চিতে; [সর্বনিম্ন, সর্বোচ্চ, বাধ্যতামূলক কি না]
const MEASURES = { length: [36, 70, 1], chest: [26, 70, 1], shoulder: [12, 26, 1], sleeve: [14, 32, 1], neck: [11, 24, 1], cuff: [5, 14, 0], waist: [22, 64, 0] };
const FITS = ['regular', 'slim', 'loose'];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  for (const m of MIGRATIONS) { try { await env.DB.prepare(m).run(); } catch (e) { /* already there */ } }
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM categories').first();
  if (!c.n) await seed(env);
  const f = await env.DB.prepare('SELECT COUNT(*) AS n FROM fabrics').first();
  if (!f.n) await seedFabrics(env);
  schemaReady = true;
}

async function seedFabrics(env) {
  const rows = [
    ['Japanese Tetron', 'জাপানি টেট্রন', 'Light, breathable and easy to iron. Good for daily wear.', 'হালকা, আরামদায়ক, সহজে ইস্ত্রি হয়। প্রতিদিনের জন্য ভালো।', 0, '#F2F0EA', 150, 1],
    ['Premium Cotton Blend', 'প্রিমিয়াম কটন ব্লেন্ড', 'Soft and cool in summer heat.', 'নরম, গরমে ঠান্ডা থাকে।', 400, '#FAF8F2', 140, 2],
    ['Winter Cashmere Wool', 'উইন্টার ক্যাশমেরি উল', 'Heavier weave for cold months.', 'শীতের জন্য ভারী কাপড়।', 900, '#5B5E63', 260, 3]
  ];
  await env.DB.batch(rows.map(r => env.DB.prepare('INSERT INTO fabrics (name_en, name_bn, desc_en, desc_bn, price_add, color_hex, gsm, sort) VALUES (?,?,?,?,?,?,?,?)').bind(...r)));
}

async function seed(env) {
  const D = env.DB;
  const cats = [['thobe', 'Thobe', 'জুব্বা', 1, 1], ['kids', 'Kids', 'কিডস', 1, 2], ['father-son', 'Father & Son', 'বাবা-ছেলে', 1, 3], ['fragrance', 'Fragrance', 'আতর', 1, 4], ['accessories', 'Accessories', 'এক্সেসরিজ', 0, 5]];
  await D.batch([
    D.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('shop', JSON.stringify(DEFAULT_SHOP)),
    ...cats.map(c => D.prepare('INSERT OR IGNORE INTO categories (slug, name_en, name_bn, on_home, sort) VALUES (?,?,?,?,?)').bind(...c))
  ]);
  // একটি ডেমো পণ্য, যাতে সাইট খালি না দেখায়। অ্যাডমিন থেকে মুছে দিতে পারবেন।
  const thobe = await D.prepare("SELECT id FROM categories WHERE slug='thobe'").first();
  const r = await D.prepare(`INSERT INTO products (code, category_id, group_key, name_en, name_bn, desc_en, desc_bn, features_en, features_bn, fabric_en, fabric_bn, gsm, color_en, color_bn, color_hex, price, compare_price, badge_en, badge_bn, is_new)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).bind(
    'AH-1001', thobe.id, 'saudi-classic', 'Saudi Classic Thobe (demo)', 'সৌদি ক্লাসিক জুব্বা (ডেমো)',
    'A demo product. Edit or delete it from the admin panel.', 'এটি একটি ডেমো পণ্য। অ্যাডমিন প্যানেল থেকে বদলান বা মুছে দিন।',
    'Classic Saudi collar\nHidden button placket\nChest pocket', 'ক্লাসিক সৌদি কলার\nলুকানো বোতাম\nবুক পকেট',
    'Japanese Tetron', 'জাপানি টেট্রন', 150, 'Off-white', 'অফ-হোয়াইট', '#F2F0EA', 2450, 2850, 'Best seller', 'বেস্ট সেলার'
  ).run();
  const pid = r.meta.last_row_id;
  const sizes = ['XS/52', 'S/54', 'M/56', 'L/58', 'XL/60', '2XL/62'];
  await D.batch(sizes.map((l, i) => D.prepare('INSERT INTO product_sizes (product_id, label, stock, sort) VALUES (?,?,?,?)').bind(pid, l, i === 5 ? 0 : 10, i)));
}

// ---------- auth ----------
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode('alhadaf-session:' + env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function sameBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const tok = getCookie(req, 'ah_admin');
  if (!tok) return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameBytes(enc.encode(sig), enc.encode(await hmac(env, exp)));
}
const cookie = (val, maxAge) => `ah_admin=${val}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------- Telegram notification (ঐচ্ছিক) ----------
function notify(env, ctx, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const p = fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 3800), disable_web_page_preview: true })
  }).catch(e => console.error('telegram', e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}
const clientIp = req => req.headers.get('cf-connecting-ip') || '';

// ---------- router ----------
async function api(req, env, url, ctx) {
  const p = url.pathname, m = req.method;

  if (p === '/api/store' && m === 'GET') return json(await getStore(env), 200, { 'cache-control': 'public, max-age=20' });
  if (p === '/api/orders' && m === 'POST') return createOrder(req, env, ctx);
  if (p === '/api/track' && m === 'GET') return trackOrder(env, url);
  if (p === '/api/chat' && m === 'POST') return startChat(req, env, ctx);
  if (p.startsWith('/api/chat/')) {
    const token = p.slice('/api/chat/'.length);
    if (m === 'GET') return readChat(env, token, url);
    if (m === 'POST') return customerMessage(req, env, token, ctx);
  }

  if (p === '/api/admin/login' && m === 'POST') {
    if (!env.ADMIN_PASSWORD) return bad('ADMIN_PASSWORD secret is not set in Cloudflare yet.', 500);
    const body = await readJson(req);
    const ok = sameBytes(await sha(str(body && body.password, 200)), await sha(env.ADMIN_PASSWORD));
    if (!ok) { await new Promise(r => setTimeout(r, 800)); return bad('Wrong password.', 401); }
    const exp = String(Date.now() + 7 * 864e5);
    return json({ ok: true }, 200, { 'set-cookie': cookie(`${exp}.${await hmac(env, exp)}`, 7 * 86400) });
  }
  if (p === '/api/admin/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

  if (p.startsWith('/api/admin/')) {
    if (!(await isAdmin(req, env))) return json({ error: 'auth', message: 'Please log in.' }, 401);
    if (m !== 'GET' && req.headers.get('x-admin') !== '1') return bad('Missing header.', 403);
    return adminApi(req, env, p.slice('/api/admin/'.length), m, url, ctx);
  }
  return json({ error: 'not_found' }, 404);
}

async function adminApi(req, env, path, m, url, ctx) {
  const [res, idStr] = path.split('/');
  const id = int(idStr, 0);
  if (res === 'me') return json({ ok: true });
  if (res === 'badges' && m === 'GET') return adminBadges(env);
  if (res === 'stats' && m === 'GET') return adminStats(env);
  if (res === 'customers' && m === 'GET') return adminCustomers(env, url);
  if (res === 'custom') {
    if (m === 'GET') return json(await getCustom(env));
    if (m === 'PUT') return saveCustom(req, env);
  }
  if (res === 'fabrics') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM fabrics ORDER BY sort, id').all()).results);
    if (m === 'POST') return saveFabric(req, env, 0);
    if (m === 'PUT' && id) return saveFabric(req, env, id);
    if (m === 'DELETE' && id) return deleteFabric(env, id);
  }
  if (res === 'gallery') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM gallery ORDER BY sort, id DESC').all()).results);
    if (m === 'POST') return saveGallery(req, env, 0);
    if (m === 'PUT' && id) return saveGallery(req, env, id);
    if (m === 'DELETE' && id) return deleteGallery(env, id);
  }
  if (res === 'chats') {
    if (m === 'GET' && !id) return adminChats(env);
    if (m === 'GET' && id) return adminChat(env, id, url);
    if (m === 'POST' && id) return adminMessage(req, env, id);
    if (m === 'PUT' && id) return adminChatStatus(req, env, id);
    if (m === 'DELETE' && id) return deleteChat(env, id);
  }
  if (res === 'upload' && m === 'POST') return uploadImage(req, env);
  if (res === 'settings') {
    if (m === 'GET') return json(await getShop(env));
    if (m === 'PUT') return saveShop(req, env);
  }
  if (res === 'categories') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM categories ORDER BY sort, id').all()).results);
    if (m === 'POST') return saveCategory(req, env, 0);
    if (m === 'PUT' && id) return saveCategory(req, env, id);
    if (m === 'DELETE' && id) return deleteCategory(env, id);
  }
  if (res === 'products') {
    if (m === 'GET') return json(await adminProducts(env));
    if (m === 'POST') return saveProduct(req, env, 0);
    if (m === 'PUT' && id) return saveProduct(req, env, id);
    if (m === 'DELETE' && id) return deleteProduct(env, id);
  }
  if (res === 'orders') {
    if (m === 'GET') return adminOrders(env, url);
    if (m === 'PUT' && id) return updateOrder(req, env, id);
  }
  return json({ error: 'not_found' }, 404);
}

// ---------- store (public) ----------
async function getShop(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='shop'").first();
  return { ...DEFAULT_SHOP, ...(row ? JSON.parse(row.value) : {}) };
}
const lines = s => str(s, 4000).split('\n').map(x => x.trim()).filter(Boolean);
const imgs = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };

async function getStore(env) {
  const D = env.DB;
  const [shop, cats, prods, sizes, custom, fabrics, gallery] = await Promise.all([
    getShop(env),
    D.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
    D.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort, id DESC').all(),
    D.prepare('SELECT s.id, s.product_id, s.label, s.stock FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE p.active = 1 ORDER BY s.sort, s.id').all(),
    getCustom(env),
    D.prepare('SELECT * FROM fabrics WHERE active = 1 ORDER BY sort, id').all(),
    D.prepare('SELECT * FROM gallery ORDER BY sort, id DESC LIMIT 200').all()
  ]);
  const catById = Object.fromEntries(cats.results.map(c => [c.id, c]));
  const products = prods.results.map(p => {
    const fe = lines(p.features_en), fb = lines(p.features_bn);
    return {
      id: p.code, cat: catById[p.category_id] ? catById[p.category_id].slug : '', group: p.group_key || p.code,
      name: { en: p.name_en, bn: p.name_bn }, desc: { en: p.desc_en, bn: p.desc_bn },
      features: { en: fe, bn: fb.length ? fb : fe }, fabric: { en: p.fabric_en, bn: p.fabric_bn }, gsm: p.gsm,
      color: { en: p.color_en, bn: p.color_bn, hex: p.color_hex || '#EEEEEE' },
      price: p.price, compare: p.compare_price || null,
      badge: p.badge_en || p.badge_bn ? { en: p.badge_en, bn: p.badge_bn } : null,
      isNew: !!p.is_new, images: imgs(p.images).map(k => '/img/' + k),
      sizes: sizes.results.filter(s => s.product_id === p.id).map(s => ({ id: s.id, label: s.label, stock: s.stock }))
    };
  });
  return {
    shop,
    categories: cats.results.map(c => ({ id: c.slug, name: { en: c.name_en, bn: c.name_bn }, tile: !!c.on_home })),
    products,
    custom: custom.enabled ? {
      basePrice: custom.base_price, leadDays: custom.lead_days, sizes: custom.sizes,
      groups: custom.groups.map(g => ({ key: g.key, name: { en: g.name_en, bn: g.name_bn }, options: g.options.map(o => ({ name: { en: o.en, bn: o.bn }, add: o.add })) })),
      fabrics: fabrics.results.map(f => ({ id: f.id, name: { en: f.name_en, bn: f.name_bn }, desc: { en: f.desc_en, bn: f.desc_bn }, add: f.price_add, hex: f.color_hex, gsm: f.gsm, image: f.image ? '/img/' + f.image : '' }))
    } : null,
    gallery: gallery.results.map(g => ({ id: g.id, image: '/img/' + g.image, caption: { en: g.caption_en, bn: g.caption_bn }, product: g.product_code || '' }))
  };
}

// ---------- orders (public) ----------
async function createOrder(req, env, ctx) {
  const b = await readJson(req);
  if (!b) return bad('Invalid request.');
  const name = str(b.name, 100), phone = str(b.phone, 20).replace(/[\s-]/g, ''), address = str(b.address, 500);
  const area = b.area === 'outside' ? 'outside' : 'inside', payment = b.payment === 'bkash' ? 'bkash' : 'cod';
  const trx = str(b.trx, 40), note = str(b.note, 500), lang = b.lang === 'bn' ? 'bn' : 'en';
  if (name.length < 2 || !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone) || address.length < 8) return bad('Please check your name, phone and address.');
  if (payment === 'bkash' && trx.length < 6) return bad('Transaction ID is required.');
  const raw = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  const items = raw.filter(i => i && !i.custom).map(i => ({ sizeId: int(i.sizeId), qty: Math.min(10, Math.max(1, int(i.qty, 1))) }));
  const customRaw = raw.filter(i => i && i.custom);
  if (!items.length && !customRaw.length) return bad('Your cart is empty.');

  const D = env.DB;
  const recent = await D.prepare("SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND created_at > datetime('now', '-1 hour')").bind(phone).first();
  if (recent.n >= 5) return bad('Too many orders from this number. Please call us.', 429);

  // নিজের মাপের জুব্বা: দাম সার্ভারেই হিসাব হয়
  const customLines = [];
  if (customRaw.length) {
    const cfg = await getCustom(env);
    if (!cfg.enabled) return bad('Custom orders are paused right now.');
    const fabrics = Object.fromEntries((await D.prepare('SELECT * FROM fabrics WHERE active = 1').all()).results.map(f => [f.id, f]));
    for (const it of customRaw) {
      const line = buildCustomLine(it.custom, Math.min(5, Math.max(1, int(it.qty, 1))), cfg, fabrics);
      if (line.error) return bad(line.error);
      customLines.push(line);
    }
  }

  const lineItems = [], short = [];
  if (items.length) {
    const ids = [...new Set(items.map(i => i.sizeId))];
    const rows = (await D.prepare(`SELECT s.id, s.label, s.stock, p.id AS pid, p.code, p.name_en, p.color_en, p.price, p.active
      FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE s.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    for (const it of items) {
      const r = byId[it.sizeId];
      if (!r || !r.active) { short.push({ sizeId: it.sizeId, available: 0 }); continue; }
      if (r.stock < it.qty) short.push({ sizeId: it.sizeId, available: r.stock, code: r.code, size: r.label });
      lineItems.push({ sizeId: r.id, productId: r.pid, code: r.code, name: r.name_en, color: r.color_en, size: r.label, qty: it.qty, price: r.price });
    }
    if (short.length) return json({ error: 'stock', message: 'Some items are out of stock.', short }, 409);

    // কমানো হবে শুধু যদি স্টক যথেষ্ট থাকে; কোনোটা ব্যর্থ হলে আগেরগুলো ফেরত দেওয়া হয়
    const res = await D.batch(lineItems.map(l => D.prepare('UPDATE product_sizes SET stock = stock - ? WHERE id = ? AND stock >= ?').bind(l.qty, l.sizeId, l.qty)));
    const failed = res.some(r => !r.meta.changes);
    if (failed) {
      const undo = lineItems.filter((l, i) => res[i].meta.changes).map(l => D.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId));
      if (undo.length) await D.batch(undo);
      return json({ error: 'stock', message: 'Some items just sold out.', short: [] }, 409);
    }
  }
  lineItems.push(...customLines);

  const shop = await getShop(env);
  const subtotal = lineItems.reduce((s, l) => s + l.price * l.qty, 0);
  const delivery = area === 'outside' ? int(shop.delivery_outside) : int(shop.delivery_inside);
  const now = new Date(Date.now() + 6 * 3600e3); // Bangladesh time for the number
  const orderNo = 'AH' + now.toISOString().slice(2, 10).replace(/-/g, '') + String(Math.floor(Math.random() * 9000) + 1000);
  await D.prepare(`INSERT INTO orders (order_no, name, phone, address, area, payment, trx, note, items, subtotal, delivery, total, lang)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderNo, name, phone, address, area, payment, trx, note, JSON.stringify(lineItems), subtotal, delivery, subtotal + delivery, lang).run();
  notify(env, ctx, `🛒 New order ${orderNo}\n${name}, ${phone}\n${lineItems.map(l => `• ${l.name} (${l.size}) ×${l.qty}`).join('\n')}\nTotal: BDT ${subtotal + delivery} (${payment === 'bkash' ? 'bKash ' + trx : 'COD'})`);
  return json({ ok: true, orderNo, subtotal, delivery, total: subtotal + delivery, items: lineItems });
}

function buildCustomLine(c, qty, cfg, fabrics) {
  if (!c || typeof c !== 'object') return { error: 'Invalid custom item.' };
  const fab = fabrics[int(c.fabric)];
  if (!fab) return { error: 'Please choose a fabric again.' };
  const opts = c.opts || {}, chosen = [];
  let price = int(cfg.base_price) + int(fab.price_add);
  for (const g of cfg.groups) {
    const o = g.options[int(opts[g.key], 0)] || g.options[0];
    if (!o) continue;
    price += int(o.add);
    chosen.push({ group: g.name_en, groupBn: g.name_bn, choice: o.en, choiceBn: o.bn, add: int(o.add) });
  }
  let size, meas = null;
  const fit = FITS.includes(c.fitPref) ? c.fitPref : 'regular';
  if (c.fit === 'standard') {
    size = str(c.size, 30);
    if (!cfg.sizes.includes(size)) return { error: 'Please choose a size for your custom thobe.' };
  } else {
    meas = {};
    for (const [k, [min, max, req]] of Object.entries(MEASURES)) {
      const v = parseFloat(c.meas && c.meas[k]);
      if (!Number.isFinite(v)) { if (req) return { error: 'Please fill in all required measurements.' }; continue; }
      if (v < min || v > max) return { error: `The ${k} measurement looks wrong. Please check it.` };
      meas[k] = Math.round(v * 4) / 4;
    }
    meas.height = str(c.meas && c.meas.height, 20);
    size = 'Made to measure';
  }
  return {
    custom: true, code: 'CUSTOM', name: 'Custom thobe', color: fab.name_en, size, qty, price,
    details: { fabric: fab.name_en, fabricBn: fab.name_bn, fabricId: fab.id, options: chosen, fit, meas, note: str(c.note, 300) }
  };
}

async function trackOrder(env, url) {
  const no = str(url.searchParams.get('no'), 30).toUpperCase();
  const phone = str(url.searchParams.get('phone'), 20).replace(/\D/g, '').slice(-11);
  if (!no || phone.length !== 11) return bad('Enter your order number and mobile number.');
  const o = await env.DB.prepare('SELECT order_no, created_at, phone, status, items, total, delivery, payment FROM orders WHERE order_no = ?').bind(no).first();
  if (!o || o.phone.replace(/\D/g, '').slice(-11) !== phone) return bad('No order found with this number and phone.', 404);
  return json({ orderNo: o.order_no, createdAt: o.created_at, status: o.status, total: o.total, delivery: o.delivery, payment: o.payment,
    items: JSON.parse(o.items || '[]').map(l => ({ name: l.name, color: l.color, size: l.size, qty: l.qty, custom: !!l.custom })) });
}

// ---------- chat (public) ----------
const CHAT_COLS = 'id, sender, body, created_at';
async function startChat(req, env, ctx) {
  const b = await readJson(req) || {};
  const name = str(b.name, 60), phone = str(b.phone, 20).replace(/[\s-]/g, ''), body = str(b.body, 1000);
  if (name.length < 2) return bad('Please write your name.');
  if (phone && !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone)) return bad('Enter a valid mobile number, or leave it empty.');
  if (!body) return bad('Write a message.');
  const ip = clientIp(req);
  if (ip) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM chats WHERE ip = ? AND created_at > datetime('now', '-1 hour')").bind(ip).first();
    if (r.n >= 5) return bad('Too many new chats. Please try again later or message us on WhatsApp.', 429);
  }
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const c = await env.DB.prepare('INSERT INTO chats (token, name, phone, ip, last_msg, admin_unread) VALUES (?,?,?,?,?,1)').bind(token, name, phone, ip, body.slice(0, 140)).run();
  const chatId = c.meta.last_row_id;
  await env.DB.prepare("INSERT INTO messages (chat_id, sender, body) VALUES (?, 'customer', ?)").bind(chatId, body).run();
  notify(env, ctx, `💬 New chat from ${name}${phone ? ' (' + phone + ')' : ''}\n${body}`);
  const msgs = (await env.DB.prepare(`SELECT ${CHAT_COLS} FROM messages WHERE chat_id = ? ORDER BY id`).bind(chatId).all()).results;
  return json({ ok: true, token, name, messages: msgs, status: 'open' });
}

async function chatByToken(env, token) {
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  return env.DB.prepare('SELECT * FROM chats WHERE token = ?').bind(token).first();
}

async function readChat(env, token, url) {
  const c = await chatByToken(env, token);
  if (!c) return json({ error: 'not_found', message: 'Chat not found.' }, 404);
  const after = int(url.searchParams.get('after'), 0);
  const msgs = (await env.DB.prepare(`SELECT ${CHAT_COLS} FROM messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 200`).bind(c.id, after).all()).results;
  return json({ messages: msgs, status: c.status, name: c.name });
}

async function customerMessage(req, env, token, ctx) {
  const c = await chatByToken(env, token);
  if (!c) return json({ error: 'not_found', message: 'Chat not found.' }, 404);
  const b = await readJson(req) || {};
  const body = str(b.body, 1000);
  if (!body) return bad('Write a message.');
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND sender = 'customer' AND created_at > datetime('now', '-1 minute')").bind(c.id).first();
  if (r.n >= 12) return bad('You are sending messages too fast. Please wait a moment.', 429);
  const m = await env.DB.prepare("INSERT INTO messages (chat_id, sender, body) VALUES (?, 'customer', ?)").bind(c.id, body).run();
  await env.DB.prepare("UPDATE chats SET last_msg = ?, admin_unread = admin_unread + 1, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.slice(0, 140), c.id).run();
  // প্রতিটি মেসেজে নয়, শুধু যখন আগের মেসেজটা পড়া হয়ে গেছে তখন নোটিফাই
  if (!c.admin_unread) notify(env, ctx, `💬 ${c.name}: ${body}`);
  return json({ ok: true, id: m.meta.last_row_id });
}

// ---------- admin: settings & categories ----------
async function saveShop(req, env) {
  const b = await readJson(req) || {};
  const shop = {};
  for (const k of Object.keys(DEFAULT_SHOP)) shop[k] = k.startsWith('delivery') ? Math.max(0, int(b[k], DEFAULT_SHOP[k])) : str(b[k], 500);
  shop.whatsapp = shop.whatsapp.replace(/\D/g, '');
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('shop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(shop)).run();
  return json(shop);
}

async function saveCategory(req, env, id) {
  const b = await readJson(req) || {};
  const slug = str(b.slug, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const nameEn = str(b.name_en, 80);
  if (!slug || !nameEn) return bad('Slug and English name are required.');
  const vals = [slug, nameEn, str(b.name_bn, 80), b.on_home ? 1 : 0, int(b.sort)];
  try {
    if (id) await env.DB.prepare('UPDATE categories SET slug=?, name_en=?, name_bn=?, on_home=?, sort=? WHERE id=?').bind(...vals, id).run();
    else await env.DB.prepare('INSERT INTO categories (slug, name_en, name_bn, on_home, sort) VALUES (?,?,?,?,?)').bind(...vals).run();
  } catch (e) { return bad('This slug is already used.'); }
  return json({ ok: true });
}

async function deleteCategory(env, id) {
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').bind(id).first();
  if (c.n) return bad(`Move or delete the ${c.n} product(s) in this category first.`);
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- admin: products ----------
async function adminProducts(env) {
  const [prods, sizes] = await Promise.all([
    env.DB.prepare('SELECT * FROM products ORDER BY sort, id DESC').all(),
    env.DB.prepare('SELECT * FROM product_sizes ORDER BY sort, id').all()
  ]);
  return prods.results.map(p => ({ ...p, images: imgs(p.images), sizes: sizes.results.filter(s => s.product_id === p.id) }));
}

async function saveProduct(req, env, id) {
  const D = env.DB;
  const b = await readJson(req);
  if (!b) return bad('Invalid request.');
  const code = str(b.code, 40).toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
  const nameEn = str(b.name_en, 150);
  if (!code || !nameEn) return bad('Product code and English name are required.');
  const price = int(b.price, -1);
  if (price < 0) return bad('Enter a valid price.');
  const cat = await D.prepare('SELECT id FROM categories WHERE id = ?').bind(int(b.category_id)).first();
  if (!cat) return bad('Choose a category.');
  const images = Array.isArray(b.images) ? b.images.filter(k => /^[a-z0-9-]+\.(webp|jpg|png)$/.test(k)).slice(0, 12) : [];
  const hex = /^#[0-9a-fA-F]{6}$/.test(b.color_hex || '') ? b.color_hex : '#EEEEEE';
  const fields = {
    code, category_id: cat.id, group_key: str(b.group_key, 60).toLowerCase(), name_en: nameEn, name_bn: str(b.name_bn, 150),
    desc_en: str(b.desc_en), desc_bn: str(b.desc_bn), features_en: str(b.features_en), features_bn: str(b.features_bn),
    fabric_en: str(b.fabric_en, 150), fabric_bn: str(b.fabric_bn, 150), gsm: intOrNull(b.gsm),
    color_en: str(b.color_en, 60), color_bn: str(b.color_bn, 60), color_hex: hex,
    price, compare_price: intOrNull(b.compare_price), badge_en: str(b.badge_en, 40), badge_bn: str(b.badge_bn, 40),
    is_new: b.is_new ? 1 : 0, active: b.active ? 1 : 0, sort: int(b.sort), images: JSON.stringify(images)
  };
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map((s, i) => ({ id: int(s.id), label: str(s.label, 30), stock: Math.max(0, int(s.stock)), sort: i })).filter(s => s.label);
  if (!sizes.length) return bad('Add at least one size.');

  const keys = Object.keys(fields);
  let pid = id, oldImages = [];
  try {
    if (id) {
      const old = await D.prepare('SELECT images FROM products WHERE id = ?').bind(id).first();
      if (!old) return bad('Product not found.', 404);
      oldImages = imgs(old.images);
      await D.prepare(`UPDATE products SET ${keys.map(k => k + '=?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...keys.map(k => fields[k]), id).run();
    } else {
      const r = await D.prepare(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => fields[k])).run();
      pid = r.meta.last_row_id;
    }
  } catch (e) {
    if (String(e).includes('UNIQUE')) return bad('This product code is already used.');
    throw e;
  }

  const existing = (await D.prepare('SELECT id FROM product_sizes WHERE product_id = ?').bind(pid).all()).results.map(r => r.id);
  const keep = sizes.filter(s => existing.includes(s.id)).map(s => s.id);
  const ops = [
    ...existing.filter(x => !keep.includes(x)).map(x => D.prepare('DELETE FROM product_sizes WHERE id = ?').bind(x)),
    ...sizes.map(s => keep.includes(s.id)
      ? D.prepare('UPDATE product_sizes SET label=?, stock=?, sort=? WHERE id=?').bind(s.label, s.stock, s.sort, s.id)
      : D.prepare('INSERT INTO product_sizes (product_id, label, stock, sort) VALUES (?,?,?,?)').bind(pid, s.label, s.stock, s.sort))
  ];
  await D.batch(ops);
  await Promise.all(oldImages.filter(k => !images.includes(k)).map(k => env.IMAGES.delete(k)));
  return json({ ok: true, id: pid });
}

async function deleteProduct(env, id) {
  const p = await env.DB.prepare('SELECT images FROM products WHERE id = ?').bind(id).first();
  if (!p) return bad('Product not found.', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM product_sizes WHERE product_id = ?').bind(id),
    env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id)
  ]);
  await Promise.all(imgs(p.images).map(k => env.IMAGES.delete(k)));
  return json({ ok: true });
}

// ---------- admin: images ----------
async function uploadImage(req, env) {
  const type = (req.headers.get('content-type') || '').split(';')[0];
  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[type];
  if (!ext) return bad('Only WebP, JPG or PNG images.');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return bad('Image must be under 5 MB.');
  const key = `${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(key, buf, { metadata: { type } });
  return json({ key, url: '/img/' + key });
}

async function serveImage(env, key) {
  if (!/^[a-z0-9-]+\.(webp|jpg|png)$/.test(key)) return new Response('Not found', { status: 404 });
  const { value, metadata } = await env.IMAGES.getWithMetadata(key, { type: 'stream' });
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, { headers: { 'content-type': (metadata && metadata.type) || 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' } });
}

// ---------- admin: orders ----------
async function adminOrders(env, url) {
  const status = url.searchParams.get('status');
  const q = str(url.searchParams.get('q'), 40);
  let sql = 'SELECT * FROM orders', where = [], args = [];
  if (ORDER_STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (q) { where.push('(order_no LIKE ? OR phone LIKE ? OR name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (url.searchParams.get('custom') === '1') where.push(`items LIKE '%"custom":true%'`);
  const from = str(url.searchParams.get('from'), 10), to = str(url.searchParams.get('to'), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("date(created_at, '+6 hours') >= ?"); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("date(created_at, '+6 hours') <= ?"); args.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 300';
  const [list, counts] = await Promise.all([
    env.DB.prepare(sql).bind(...args).all(),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()
  ]);
  return json({
    orders: list.results.map(o => ({ ...o, items: JSON.parse(o.items || '[]') })),
    counts: Object.fromEntries(counts.results.map(c => [c.status, c.n]))
  });
}

async function updateOrder(req, env, id) {
  const b = await readJson(req) || {};
  const o = await env.DB.prepare('SELECT status, items FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  if (b.admin_note != null && b.status == null) {
    await env.DB.prepare('UPDATE orders SET admin_note = ? WHERE id = ?').bind(str(b.admin_note, 1000), id).run();
    return json({ ok: true });
  }
  if (!ORDER_STATUSES.includes(b.status)) return bad('Unknown status.');
  const items = JSON.parse(o.items || '[]').filter(l => l.sizeId);
  const ops = [env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, id)];
  // বাতিল করলে স্টক ফেরত যায়; আবার চালু করলে স্টক আবার কমে (নিজের মাপের জুব্বার স্টক নেই)
  if (b.status === 'cancelled' && o.status !== 'cancelled')
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId)));
  if (o.status === 'cancelled' && b.status !== 'cancelled')
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = MAX(0, stock - ?) WHERE id = ?').bind(l.qty, l.sizeId)));
  await env.DB.batch(ops);
  return json({ ok: true });
}

// ---------- admin: custom tailoring ----------
async function getCustom(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='custom'").first();
  const v = row ? JSON.parse(row.value) : {};
  return { ...DEFAULT_CUSTOM, ...v, groups: Array.isArray(v.groups) && v.groups.length ? v.groups : DEFAULT_CUSTOM.groups, sizes: Array.isArray(v.sizes) && v.sizes.length ? v.sizes : DEFAULT_CUSTOM.sizes };
}

async function saveCustom(req, env) {
  const b = await readJson(req) || {};
  const groups = (Array.isArray(b.groups) ? b.groups : []).slice(0, 10).map((g, i) => ({
    key: str(g.key, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'opt' + i,
    name_en: str(g.name_en, 60), name_bn: str(g.name_bn, 60),
    options: (Array.isArray(g.options) ? g.options : []).slice(0, 12).map(o => ({ en: str(o.en, 60), bn: str(o.bn, 60), add: Math.max(0, int(o.add)) })).filter(o => o.en)
  })).filter(g => g.name_en && g.options.length);
  const keys = groups.map(g => g.key);
  if (new Set(keys).size !== keys.length) return bad('Two option groups have the same key.');
  const sizes = (Array.isArray(b.sizes) ? b.sizes : str(b.sizes).split(',')).map(x => str(x, 30)).filter(Boolean).slice(0, 20);
  const cfg = { enabled: !!b.enabled, base_price: Math.max(0, int(b.base_price, DEFAULT_CUSTOM.base_price)), lead_days: Math.max(1, int(b.lead_days, 7)), sizes: sizes.length ? sizes : DEFAULT_CUSTOM.sizes, groups };
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('custom', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(cfg)).run();
  return json(cfg);
}

const imgKey = k => /^[a-z0-9-]+\.(webp|jpg|png)$/.test(k || '') ? k : '';

async function saveFabric(req, env, id) {
  const b = await readJson(req) || {};
  const nameEn = str(b.name_en, 80);
  if (!nameEn) return bad('Fabric name is required.');
  const f = {
    name_en: nameEn, name_bn: str(b.name_bn, 80), desc_en: str(b.desc_en, 400), desc_bn: str(b.desc_bn, 400),
    price_add: Math.max(0, int(b.price_add)), color_hex: /^#[0-9a-fA-F]{6}$/.test(b.color_hex || '') ? b.color_hex : '#F2F0EA',
    image: imgKey(b.image), gsm: intOrNull(b.gsm), active: b.active ? 1 : 0, sort: int(b.sort)
  };
  const keys = Object.keys(f);
  if (id) {
    const old = await env.DB.prepare('SELECT image FROM fabrics WHERE id = ?').bind(id).first();
    if (!old) return bad('Fabric not found.', 404);
    await env.DB.prepare(`UPDATE fabrics SET ${keys.map(k => k + '=?').join(', ')} WHERE id = ?`).bind(...keys.map(k => f[k]), id).run();
    if (old.image && old.image !== f.image) await env.IMAGES.delete(old.image);
  } else {
    await env.DB.prepare(`INSERT INTO fabrics (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => f[k])).run();
  }
  return json({ ok: true });
}

async function deleteFabric(env, id) {
  const old = await env.DB.prepare('SELECT image FROM fabrics WHERE id = ?').bind(id).first();
  if (!old) return bad('Fabric not found.', 404);
  await env.DB.prepare('DELETE FROM fabrics WHERE id = ?').bind(id).run();
  if (old.image) await env.IMAGES.delete(old.image);
  return json({ ok: true });
}

// ---------- admin: gallery ----------
async function saveGallery(req, env, id) {
  const b = await readJson(req) || {};
  const vals = [str(b.caption_en, 200), str(b.caption_bn, 200), str(b.product_code, 40).toUpperCase(), int(b.sort)];
  if (id) {
    await env.DB.prepare('UPDATE gallery SET caption_en=?, caption_bn=?, product_code=?, sort=? WHERE id=?').bind(...vals, id).run();
  } else {
    const image = imgKey(b.image);
    if (!image) return bad('Upload a photo first.');
    await env.DB.prepare('INSERT INTO gallery (caption_en, caption_bn, product_code, sort, image) VALUES (?,?,?,?,?)').bind(...vals, image).run();
  }
  return json({ ok: true });
}

async function deleteGallery(env, id) {
  const g = await env.DB.prepare('SELECT image FROM gallery WHERE id = ?').bind(id).first();
  if (!g) return bad('Photo not found.', 404);
  await env.DB.prepare('DELETE FROM gallery WHERE id = ?').bind(id).run();
  await env.IMAGES.delete(g.image);
  return json({ ok: true });
}

// ---------- admin: chats ----------
async function adminChats(env) {
  const r = await env.DB.prepare('SELECT id, name, phone, status, last_msg, admin_unread, created_at, updated_at FROM chats ORDER BY updated_at DESC LIMIT 150').all();
  return json(r.results);
}

async function adminChat(env, id, url) {
  const c = await env.DB.prepare('SELECT id, name, phone, status, created_at FROM chats WHERE id = ?').bind(id).first();
  if (!c) return bad('Chat not found.', 404);
  const after = int(url.searchParams.get('after'), 0);
  const msgs = (await env.DB.prepare(`SELECT ${CHAT_COLS} FROM messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 500`).bind(id, after).all()).results;
  await env.DB.prepare('UPDATE chats SET admin_unread = 0 WHERE id = ?').bind(id).run();
  let orders = [];
  if (c.phone) orders = (await env.DB.prepare('SELECT order_no, status, total, created_at FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 5').bind(c.phone).all()).results;
  return json({ chat: c, messages: msgs, orders });
}

async function adminMessage(req, env, id) {
  const b = await readJson(req) || {};
  const body = str(b.body, 2000);
  if (!body) return bad('Write a message.');
  const c = await env.DB.prepare('SELECT id FROM chats WHERE id = ?').bind(id).first();
  if (!c) return bad('Chat not found.', 404);
  const m = await env.DB.prepare("INSERT INTO messages (chat_id, sender, body) VALUES (?, 'admin', ?)").bind(id, body).run();
  await env.DB.prepare("UPDATE chats SET last_msg = ?, admin_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind('You: ' + body.slice(0, 130), id).run();
  return json({ ok: true, id: m.meta.last_row_id });
}

async function adminChatStatus(req, env, id) {
  const b = await readJson(req) || {};
  const status = b.status === 'closed' ? 'closed' : 'open';
  await env.DB.prepare('UPDATE chats SET status = ?, admin_unread = 0 WHERE id = ?').bind(status, id).run();
  return json({ ok: true });
}

async function deleteChat(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM messages WHERE chat_id = ?').bind(id), env.DB.prepare('DELETE FROM chats WHERE id = ?').bind(id)]);
  return json({ ok: true });
}

// ---------- admin: dashboard ----------
async function adminBadges(env) {
  const [o, c] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE admin_unread > 0').first()
  ]);
  return json({ newOrders: o.n, unreadChats: c.n });
}

async function adminStats(env) {
  const D = env.DB;
  const BD = "date(created_at, '+6 hours')", today = "date('now', '+6 hours')";
  const sum = cond => D.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS rev FROM orders WHERE status != 'cancelled' AND ${cond}`).first();
  const [t, y, w, m, all, daily, statuses, recent, low, chats, customers, monthItems, customOpen] = await Promise.all([
    sum(`${BD} = ${today}`),
    sum(`${BD} = date('now', '+6 hours', '-1 day')`),
    sum(`${BD} > date('now', '+6 hours', '-7 days')`),
    sum(`${BD} > date('now', '+6 hours', '-30 days')`),
    sum('1 = 1'),
    D.prepare(`SELECT ${BD} AS d, COUNT(*) AS n, COALESCE(SUM(total), 0) AS rev FROM orders WHERE status != 'cancelled' AND ${BD} > date('now', '+6 hours', '-30 days') GROUP BY d ORDER BY d`).all(),
    D.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all(),
    D.prepare('SELECT id, order_no, name, total, status, created_at FROM orders ORDER BY id DESC LIMIT 6').all(),
    D.prepare('SELECT p.id, p.code, p.name_en, p.color_en, s.label, s.stock FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE p.active = 1 AND s.stock <= 3 ORDER BY s.stock, p.id LIMIT 12').all(),
    D.prepare('SELECT COUNT(*) AS n FROM chats WHERE admin_unread > 0').first(),
    D.prepare('SELECT COUNT(DISTINCT phone) AS n FROM orders').first(),
    D.prepare(`SELECT items FROM orders WHERE status != 'cancelled' AND created_at > datetime('now', '-30 days') LIMIT 3000`).all(),
    D.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('new', 'confirmed') AND items LIKE '%"custom":true%'`).first()
  ]);
  const top = {};
  for (const o of monthItems.results) {
    for (const l of JSON.parse(o.items || '[]')) {
      const k = l.custom ? 'CUSTOM' : l.code;
      top[k] = top[k] || { code: k, name: l.custom ? 'Custom thobe' : l.name, color: l.custom ? '' : l.color, qty: 0, rev: 0 };
      top[k].qty += l.qty; top[k].rev += l.qty * l.price;
    }
  }
  return json({
    today: t, yesterday: y, week: w, month: m, all,
    daily: daily.results, statuses: Object.fromEntries(statuses.results.map(s => [s.status, s.n])),
    recent: recent.results, lowStock: low.results, unreadChats: chats.n, customers: customers.n, customOpen: customOpen.n,
    top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 6)
  });
}

async function adminCustomers(env, url) {
  const q = str(url.searchParams.get('q'), 40);
  let sql = `SELECT phone, MAX(name) AS name, MAX(address) AS address, COUNT(*) AS orders,
    SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS spent, MAX(created_at) AS last_order FROM orders`;
  const args = [];
  if (q) { sql += ' WHERE phone LIKE ? OR name LIKE ?'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' GROUP BY phone ORDER BY last_order DESC LIMIT 300';
  return json((await env.DB.prepare(sql).bind(...args).all()).results);
}
