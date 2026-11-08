// ===== Al Hadaf — backend (Cloudflare Worker) =====
// Bindings (wrangler.jsonc): DB = D1 database, IMAGES = KV namespace, ASSETS = static files
// Secret: ADMIN_PASSWORD  (Cloudflare dashboard > Worker > Settings > Variables and Secrets)

const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        return await api(req, env, url);
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
  `CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone, created_at)`
];

const DEFAULT_SHOP = {
  phone: '01700000000', whatsapp: '8801700000000', email: '', bkash: '01700000000',
  facebook: '', instagram: '',
  address_en: 'Dhaka, Bangladesh', address_bn: 'ঢাকা, বাংলাদেশ',
  delivery_inside: 70, delivery_outside: 130,
  announce_en: 'Cash on delivery all over Bangladesh. Easy size exchange within 7 days.',
  announce_bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি। ৭ দিনের মধ্যে সহজ সাইজ এক্সচেঞ্জ।'
};

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM categories').first();
  if (!c.n) await seed(env);
  schemaReady = true;
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

// ---------- router ----------
async function api(req, env, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/store' && m === 'GET') return json(await getStore(env), 200, { 'cache-control': 'public, max-age=20' });
  if (p === '/api/orders' && m === 'POST') return createOrder(req, env);

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
    return adminApi(req, env, p.slice('/api/admin/'.length), m, url);
  }
  return json({ error: 'not_found' }, 404);
}

async function adminApi(req, env, path, m, url) {
  const [res, idStr] = path.split('/');
  const id = int(idStr, 0);
  if (res === 'me') return json({ ok: true });
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
  const [shop, cats, prods, sizes] = await Promise.all([
    getShop(env),
    D.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
    D.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort, id DESC').all(),
    D.prepare('SELECT s.id, s.product_id, s.label, s.stock FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE p.active = 1 ORDER BY s.sort, s.id').all()
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
    products
  };
}

// ---------- orders (public) ----------
async function createOrder(req, env) {
  const b = await readJson(req);
  if (!b) return bad('Invalid request.');
  const name = str(b.name, 100), phone = str(b.phone, 20).replace(/[\s-]/g, ''), address = str(b.address, 500);
  const area = b.area === 'outside' ? 'outside' : 'inside', payment = b.payment === 'bkash' ? 'bkash' : 'cod';
  const trx = str(b.trx, 40), note = str(b.note, 500), lang = b.lang === 'bn' ? 'bn' : 'en';
  if (name.length < 2 || !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone) || address.length < 8) return bad('Please check your name, phone and address.');
  if (payment === 'bkash' && trx.length < 6) return bad('Transaction ID is required.');
  const items = Array.isArray(b.items) ? b.items.slice(0, 30).map(i => ({ sizeId: int(i.sizeId), qty: Math.min(10, Math.max(1, int(i.qty, 1))) })) : [];
  if (!items.length) return bad('Your cart is empty.');

  const D = env.DB;
  const recent = await D.prepare("SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND created_at > datetime('now', '-1 hour')").bind(phone).first();
  if (recent.n >= 5) return bad('Too many orders from this number. Please call us.', 429);

  const ids = [...new Set(items.map(i => i.sizeId))];
  const rows = (await D.prepare(`SELECT s.id, s.label, s.stock, p.id AS pid, p.code, p.name_en, p.color_en, p.price, p.active
    FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE s.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const lineItems = [], short = [];
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

  const shop = await getShop(env);
  const subtotal = lineItems.reduce((s, l) => s + l.price * l.qty, 0);
  const delivery = area === 'outside' ? int(shop.delivery_outside) : int(shop.delivery_inside);
  const now = new Date(Date.now() + 6 * 3600e3); // Bangladesh time for the number
  const orderNo = 'AH' + now.toISOString().slice(2, 10).replace(/-/g, '') + String(Math.floor(Math.random() * 9000) + 1000);
  await D.prepare(`INSERT INTO orders (order_no, name, phone, address, area, payment, trx, note, items, subtotal, delivery, total, lang)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderNo, name, phone, address, area, payment, trx, note, JSON.stringify(lineItems), subtotal, delivery, subtotal + delivery, lang).run();
  return json({ ok: true, orderNo, subtotal, delivery, total: subtotal + delivery, items: lineItems });
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
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 200';
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
  if (!ORDER_STATUSES.includes(b.status)) return bad('Unknown status.');
  const o = await env.DB.prepare('SELECT status, items FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  const items = JSON.parse(o.items || '[]');
  const ops = [env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, id)];
  // বাতিল করলে স্টক ফেরত যায়; আবার চালু করলে স্টক আবার কমে
  if (b.status === 'cancelled' && o.status !== 'cancelled')
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId)));
  if (o.status === 'cancelled' && b.status !== 'cancelled')
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = MAX(0, stock - ?) WHERE id = ?').bind(l.qty, l.sizeId)));
  await env.DB.batch(ops);
  return json({ ok: true });
}
