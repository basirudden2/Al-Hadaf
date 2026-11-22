// ===== Al Hadaf — backend (Cloudflare Worker) =====
// Bindings (wrangler.jsonc): DB = D1 database, IMAGES = KV namespace, ASSETS = static files
// Secret: ADMIN_PASSWORD  (Cloudflare dashboard > Worker > Settings > Variables and Secrets)
// Optional secrets: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (নতুন অর্ডার আর চ্যাট মেসেজের নোটিফিকেশন মোবাইলে পেতে)
//                   STEADFAST_API_KEY + STEADFAST_SECRET_KEY  (এক ক্লিকে Steadfast কুরিয়ারে পার্সেল বুক)
//                   SMS_API_KEY + SMS_SENDER_ID  (bulksmsbd.net দিয়ে কাস্টমারকে অর্ডারের SMS)
//                   BKASH_APP_KEY + BKASH_APP_SECRET + BKASH_USERNAME + BKASH_PASSWORD (+ BKASH_MODE=live)  (bKash অনলাইন পেমেন্ট)
//                   BDCOURIER_API_KEY  (bdcourier.com থেকে কাস্টমারের সব কুরিয়ারের ডেলিভারি রেকর্ড)

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
      if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt' || /^\/(p|c)\/[^/]+\/?$/.test(url.pathname)) {
        await ensureSchema(env);
        return await seoPage(req, env, url);
      }
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
  `CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at)`,
  `CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'percent', value INTEGER NOT NULL DEFAULT 0,
    min_order INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, expires TEXT DEFAULT '', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, product_code TEXT NOT NULL, name TEXT NOT NULL, phone TEXT DEFAULT '', rating INTEGER NOT NULL,
    body TEXT DEFAULT '', status TEXT DEFAULT 'pending', verified INTEGER DEFAULT 0, ip TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_code, status)`,
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff',
    salt TEXT NOT NULL, hash TEXT NOT NULL, ver INTEGER DEFAULT 1, active INTEGER DEFAULT 1, last_login TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS login_fails (k TEXT PRIMARY KEY, n INTEGER DEFAULT 0, until INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, user_name TEXT, action TEXT, area TEXT, ref TEXT DEFAULT '', details TEXT DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at)`,
  `CREATE TABLE IF NOT EXISTS acc_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', opening INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS acc_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS acc_partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', target INTEGER DEFAULT 0, share_pct REAL DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS acc_target_log (id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER, old_target INTEGER, new_target INTEGER, note TEXT DEFAULT '', by_name TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS acc_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, type TEXT NOT NULL, category_id INTEGER, amount INTEGER NOT NULL,
    account_id INTEGER, to_account_id INTEGER, partner_id INTEGER, person TEXT DEFAULT '', ref TEXT DEFAULT '', note TEXT DEFAULT '', attachment TEXT DEFAULT '',
    source TEXT DEFAULT 'manual', order_no TEXT, import_id TEXT, created_by TEXT DEFAULT '', updated_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_acc_day ON acc_entries(day)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_order ON acc_entries(order_no) WHERE order_no IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_import ON acc_entries(import_id) WHERE import_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS banners (id INTEGER PRIMARY KEY AUTOINCREMENT, image TEXT NOT NULL, title_en TEXT DEFAULT '', title_bn TEXT DEFAULT '', text_en TEXT DEFAULT '', text_bn TEXT DEFAULT '',
    btn_en TEXT DEFAULT '', btn_bn TEXT DEFAULT '', link TEXT DEFAULT '', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS abandoned (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL, name TEXT DEFAULT '', address TEXT DEFAULT '', area TEXT DEFAULT '',
    items TEXT DEFAULT '[]', subtotal INTEGER DEFAULT 0, lang TEXT DEFAULT 'en', status TEXT DEFAULT 'open', note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS stock_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, product_code TEXT NOT NULL, size_id INTEGER NOT NULL, size_label TEXT DEFAULT '', phone TEXT NOT NULL,
    lang TEXT DEFAULT 'en', created_at TEXT DEFAULT CURRENT_TIMESTAMP, notified_at TEXT DEFAULT '', UNIQUE(size_id, phone))`,
  `CREATE TABLE IF NOT EXISTS customer_notes (phone TEXT PRIMARY KEY, note TEXT DEFAULT '', tags TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS profiles (phone TEXT PRIMARY KEY, name TEXT DEFAULT '', address TEXT DEFAULT '', area TEXT DEFAULT 'inside', meas TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS otps (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER DEFAULT 0, sent INTEGER DEFAULT 1, window_start INTEGER DEFAULT 0)`
];
// পুরনো ডাটাবেসে নতুন কলাম যোগ (আগে থেকে থাকলে এরর হয়, সেটা উপেক্ষা করা হয়)
const MIGRATIONS = [
  `ALTER TABLE orders ADD COLUMN admin_note TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN discount INTEGER DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN coupon TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN consignment TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN tracking_code TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN courier_status TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN bundle_off INTEGER DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN paid INTEGER DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN pay_id TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN color_en TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN color_bn TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN family TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN composition TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN origin TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN season TEXT DEFAULT ''`,
  `ALTER TABLE fabrics ADD COLUMN stock REAL`,
  `ALTER TABLE fabrics ADD COLUMN per_thobe REAL DEFAULT 3.5`,
  `ALTER TABLE products ADD COLUMN cost INTEGER`,
  `ALTER TABLE fabrics ADD COLUMN cost_per_gaj REAL`,
  `ALTER TABLE orders ADD COLUMN channel TEXT DEFAULT 'website'`,
  `ALTER TABLE orders ADD COLUMN delivery_mode TEXT DEFAULT 'courier'`,
  `ALTER TABLE orders ADD COLUMN paid_amount INTEGER DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN sold_by TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN cancel_type TEXT DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN cancel_reason TEXT DEFAULT ''`,
  `ALTER TABLE customer_notes ADD COLUMN follow_up TEXT DEFAULT ''`,
  `ALTER TABLE customer_notes ADD COLUMN follow_note TEXT DEFAULT ''`
];

const DEFAULT_SHOP = {
  phone: '01700000000', whatsapp: '8801700000000', email: '', bkash: '01700000000',
  facebook: '', instagram: '', messenger: '', youtube: '', tiktok: '', fb_pixel: '',
  sms_new: '1', sms_confirmed: '1', sms_shipped: '1', sms_delivered: '', bundle_min: 0, bundle_pct: 0, free_ship_over: 0,
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
    { key: 'style', name_en: 'Cut', name_bn: 'কাট', options: [
      { en: 'Saudi', bn: 'সৌদি', add: 0 }, { en: 'Omani', bn: 'ওমানি', add: 0 }, { en: 'Kuwaiti', bn: 'কুয়েতি', add: 0 }, { en: 'Moroccan', bn: 'মরোক্কান', add: 300 }] },
    { key: 'collar', name_en: 'Collar', name_bn: 'কলার', options: [
      { en: 'Shirt collar', bn: 'শার্ট কলার', add: 0, look: 'shirt' }, { en: 'Band collar (no collar)', bn: 'বেল্ট কলার (কলার ছাড়া)', add: 0, look: 'band' },
      { en: 'Round neck', bn: 'গোল গলা', add: 0, look: 'round' }] },
    { key: 'front', name_en: 'Front buttons', name_bn: 'সামনের বোতাম', options: [
      { en: 'Hidden buttons', bn: 'লুকানো বোতাম', add: 0, look: 'hidden' }, { en: 'Visible buttons', bn: 'খোলা বোতাম', add: 0, look: 'visible' },
      { en: 'Zip', bn: 'চেইন', add: 100, look: 'zip' }] },
    { key: 'pocket', name_en: 'Pocket', name_bn: 'পকেট', options: [
      { en: 'Left chest pocket', bn: 'বাম বুকে পকেট', add: 0, look: 'chest' }, { en: 'Left chest and side pockets', bn: 'বাম বুকে আর দুই পাশে পকেট', add: 100, look: 'chest_side' },
      { en: 'Side pockets only', bn: 'শুধু দুই পাশে পকেট', add: 0, look: 'side' }, { en: 'No pocket', bn: 'পকেট ছাড়া', add: 0, look: 'none' }] },
    { key: 'cuff', name_en: 'Sleeve', name_bn: 'হাতা', options: [
      { en: 'Cuff sleeve with button', bn: 'কাফ হাতা (বোতাম)', add: 0, look: 'cuff' }, { en: 'Cufflink cuff', bn: 'কাফলিংক কাফ', add: 150, look: 'cufflink' },
      { en: 'Plain sleeve (no cuff)', bn: 'সাধারণ হাতা (কাফ ছাড়া)', add: 0, look: 'plain' }] }
  ]
};
// কাস্টম জুব্বার ছবিতে কোন অপশন কেমন দেখাবে
const LOOKS = ['shirt', 'band', 'round', 'hidden', 'visible', 'zip', 'chest', 'chest_side', 'side', 'none', 'cuff', 'cufflink', 'plain'];
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
  const ac = await env.DB.prepare('SELECT COUNT(*) AS n FROM acc_accounts').first();
  if (!ac.n) await seedAccounts(env);
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
// লগইন করা মানুষটি কে: uid 0 = মালিক (ADMIN_PASSWORD দিয়ে), বাকিরা users টেবিল থেকে
async function adminUser(req, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const tok = getCookie(req, 'ah_admin');
  if (!tok) return null;
  const [uid, exp, ver, sig] = tok.split('.');
  if (!sig || Number(exp) < Date.now()) return null;
  if (!sameBytes(enc.encode(sig), enc.encode(await hmac(env, `u:${uid}.${exp}.${ver}`)))) return null;
  if (uid === '0') return { id: 0, name: 'Owner', username: 'owner', role: 'super' };
  const u = await env.DB.prepare('SELECT id, name, username, role, ver, active FROM users WHERE id = ?').bind(int(uid)).first();
  if (!u || !u.active || String(u.ver) !== ver) return null;
  return u;
}
// টিমের পাসওয়ার্ড: PBKDF2 + একবার তৈরি হওয়া গোপন pepper (ডাটাবেসে রাখা), তাই ADMIN_PASSWORD বদলালেও টিমের পাসওয়ার্ড ঠিক থাকে
let pepperCache = null;
async function pepper(env) {
  if (pepperCache) return pepperCache;
  let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'pepper'").first();
  if (!row) {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('pepper', ?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify(crypto.randomUUID() + crypto.randomUUID())).run();
    row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'pepper'").first();
  }
  return (pepperCache = JSON.parse(row.value));
}
async function pbkdf(password, pep, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password + '|' + pep), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 20000 }, key, 256));
}
const hashPassword = async (env, password, salt) => pbkdf(password, await pepper(env), salt);
// আগের সংস্করণে তৈরি পাসওয়ার্ড (ADMIN_PASSWORD-নির্ভর) মিললে নতুন পদ্ধতিতে বদলে রাখা হয়
async function checkUserPassword(env, u, password) {
  if (sameBytes(enc.encode(await hashPassword(env, password, u.salt)), enc.encode(u.hash))) return true;
  if (!sameBytes(enc.encode(await pbkdf(password, await hmac(env, 'pepper'), u.salt)), enc.encode(u.hash))) return false;
  await env.DB.prepare('UPDATE users SET hash = ? WHERE id = ?').bind(await hashPassword(env, password, u.salt), u.id).run();
  return true;
}

// ---------- কে কী করতে পারবে ----------
const ROLES = {
  super: 'Super admin', admin: 'Admin', accountant: 'Accountant', staff: 'Order staff', view: 'View only'
};
const AREAS = {
  sales: ['orders', 'courier', 'chats', 'abandoned', 'customers', 'customer', 'fraud', 'stock-alerts', 'sales', 'due'],
  catalog: ['products', 'categories', 'custom', 'fabrics', 'gallery', 'upload', 'banners', 'reviews', 'coupons', 'sms', 'settings'],
  money: ['stats', 'report', 'finance', 'expenses', 'acc', 'goals'],
  people: ['users', 'audit']
};
function can(user, res, method) {
  if (res === 'me' || res === 'badges' || res === 'password') return true;
  const r = user.role, read = method === 'GET';
  if (r === 'super') return true;
  if (AREAS.people.includes(res)) return r === 'admin' && res === 'audit' && read;
  if (r === 'admin') return true;
  if (r === 'view') return read;
  if (r === 'accountant') return AREAS.money.includes(res) || (read && (AREAS.sales.includes(res) || res === 'products'));
  if (r === 'staff') return AREAS.sales.includes(res) || (read && ['products', 'categories'].includes(res));
  return false;
}
function permsOf(user) {
  const all = [...AREAS.sales, ...AREAS.catalog, ...AREAS.money, ...AREAS.people, 'stats'];
  return { read: all.filter(a => can(user, a, 'GET')), write: all.filter(a => can(user, a, 'POST')) };
}
async function audit(env, user, action, area, ref, details) {
  try {
    await env.DB.prepare('INSERT INTO audit (user_id, user_name, action, area, ref, details) VALUES (?,?,?,?,?,?)')
      .bind(user ? user.id : null, user ? user.name : 'system', action, area, String(ref || '').slice(0, 60), String(details || '').slice(0, 1500)).run();
  } catch (e) { console.error('audit', e); }
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

// ---------- SMS (bulksmsbd.net, ঐচ্ছিক) ----------
const SMS_TEXT = {
  new: { en: (o, s) => `Al Hadaf: Thank you, ${o.name}! We got your order ${o.order_no}, total BDT ${o.total}. We will call you to confirm.`,
         bn: (o, s) => `আল হাদাফ: ধন্যবাদ ${o.name}! আপনার অর্ডার ${o.order_no} পেয়েছি, মোট ${o.total} টাকা। কনফার্ম করতে ফোন করব।` },
  confirmed: { en: o => `Al Hadaf: Your order ${o.order_no} is confirmed. We will ship it soon.`,
               bn: o => `আল হাদাফ: আপনার অর্ডার ${o.order_no} কনফার্ম হয়েছে। শিগগিরই পাঠানো হবে।` },
  shipped: { en: o => `Al Hadaf: Your order ${o.order_no} is on the way.${o.tracking_code ? ' Track: steadfast.com.bd/t/' + o.tracking_code : ''}`,
             bn: o => `আল হাদাফ: আপনার অর্ডার ${o.order_no} পাঠানো হয়েছে।${o.tracking_code ? ' ট্র্যাক: steadfast.com.bd/t/' + o.tracking_code : ''}` },
  delivered: { en: o => `Al Hadaf: Order ${o.order_no} delivered. JazakAllahu khairan! Please leave a review on our website.`,
               bn: o => `আল হাদাফ: অর্ডার ${o.order_no} ডেলিভারি হয়েছে। জাযাকাল্লাহু খাইরান! ওয়েবসাইটে রিভিউ দিলে খুশি হব।` }
};
async function orderSms(env, ctx, order, event) {
  if (!env.SMS_API_KEY || !env.SMS_SENDER_ID || !SMS_TEXT[event]) return;
  const shop = await getShop(env);
  if (!shop['sms_' + event]) return;
  const number = '88' + String(order.phone).replace(/\D/g, '').slice(-11);
  const message = SMS_TEXT[event][order.lang === 'bn' ? 'bn' : 'en'](order);
  const q = new URLSearchParams({ api_key: env.SMS_API_KEY, type: 'text', number, senderid: env.SMS_SENDER_ID, message });
  const p = fetch('https://bulksmsbd.net/api/smsapi?' + q).then(r => r.text()).then(t => console.log('sms', event, t.slice(0, 120))).catch(e => console.error('sms', e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// ---------- router ----------
async function api(req, env, url, ctx) {
  const p = url.pathname, m = req.method;

  if (p === '/api/store' && m === 'GET') return json(await getStore(env), 200, { 'cache-control': 'public, max-age=20' });
  if (p === '/api/orders' && m === 'POST') return createOrder(req, env, ctx);
  if (p === '/api/track' && m === 'GET') return trackOrder(env, url);
  if (p === '/api/coupon' && m === 'GET') return checkCoupon(env, url);
  if (p === '/api/reviews' && m === 'POST') return submitReview(req, env, ctx);
  if (p === '/api/abandoned' && m === 'POST') return saveAbandoned(req, env);
  if (p === '/api/stock-alert' && m === 'POST') return saveStockAlert(req, env);
  if (p === '/api/account/otp' && m === 'POST') return sendOtp(req, env, ctx);
  if (p === '/api/account/verify' && m === 'POST') return verifyOtp(req, env);
  if (p === '/api/account/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': custCookie('', 0) });
  if (p === '/api/account') {
    const phone = await customerPhone(req, env);
    if (!phone) return json({ error: 'auth', message: 'Please log in.' }, 401);
    if (m === 'GET') return accountData(env, phone);
    if (m === 'PUT') return saveProfile(req, env, phone);
  }
  if (p === '/api/pay/bkash' && m === 'POST') return bkashCreate(req, env, url);
  if (p === '/api/pay/bkash/callback' && m === 'GET') return bkashCallback(env, url, ctx);
  if (p === '/api/chat' && m === 'POST') return startChat(req, env, ctx);
  if (p.startsWith('/api/chat/')) {
    const token = p.slice('/api/chat/'.length);
    if (m === 'GET') return readChat(env, token, url);
    if (m === 'POST') return customerMessage(req, env, token, ctx);
  }

  if (p === '/api/admin/login' && m === 'POST') return adminLogin(req, env);
  if (p === '/api/admin/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

  if (p.startsWith('/api/admin/')) {
    const user = await adminUser(req, env);
    if (!user) return json({ error: 'auth', message: 'Please log in.' }, 401);
    if (m !== 'GET' && req.headers.get('x-admin') !== '1') return bad('Missing header.', 403);
    const path = p.slice('/api/admin/'.length), res = path.split('/')[0];
    if (!can(user, res, m)) return json({ error: 'forbidden', message: 'You do not have permission for this.' }, 403);
    // সব পরিবর্তন লগে লেখা হয় (হিসাবের এন্ট্রি নিজেরা আরও বিস্তারিত লেখে)
    let bodyText = '';
    if (m !== 'GET' && res !== 'upload' && res !== 'acc') { try { bodyText = await req.clone().text(); } catch (e) { /* none */ } }
    const resp = await adminApi(req, env, path, m, url, ctx, user);
    if (m !== 'GET' && resp.status < 400 && res !== 'acc' && res !== 'password')
      ctx.waitUntil(audit(env, user, m === 'DELETE' ? 'DELETE' : m === 'POST' ? 'ADD' : 'EDIT', res, path.split('/')[1] || '', bodyText.replace(/"(password|pass)":"[^"]*"/g, '"$1":"***"').slice(0, 600)));
    return resp;
  }
  return json({ error: 'not_found' }, 404);
}

async function adminApi(req, env, path, m, url, ctx, user) {
  const [res, idStr] = path.split('/');
  const id = int(idStr, 0);
  if (res === 'me') return json({ ok: true, user: { id: user.id, name: user.name, username: user.username, role: user.role, roleName: ROLES[user.role] }, perms: permsOf(user) });
  if (res === 'password' && m === 'PUT') return changeOwnPassword(req, env, user);
  if (res === 'users') return usersApi(req, env, m, id, user);
  if (res === 'audit' && m === 'GET') return auditList(env, url);
  if (res === 'acc') return accApi(req, env, path.split('/').slice(1), m, url, user);
  if (res === 'badges' && m === 'GET') return adminBadges(env);
  if (res === 'report' && m === 'GET') return json(await profitReport(env, url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('basis')));
  if (res === 'finance') {
    if (m === 'GET') return json(await getFinance(env));
    if (m === 'PUT') return saveFinance(req, env);
  }
  if (res === 'expenses') {
    // Profit & loss পেজের খরচ এখন হিসাবের খাতায় (Accounts) যায়
    if (m === 'POST') {
      const b = await readJson(req) || {};
      const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
      const amount = Math.round(Number(b.amount) || 0);
      if (amount <= 0) return bad('Enter the amount.');
      const cash = await env.DB.prepare("SELECT id FROM acc_accounts WHERE kind = 'cash' ORDER BY sort, id LIMIT 1").first();
      const cat = await expenseCategory(env, b.category);
      await env.DB.prepare("INSERT INTO acc_entries (day, type, category_id, amount, account_id, note, created_by) VALUES (?, 'out', ?, ?, ?, ?, ?)").bind(day, cat, amount, cash.id, str(b.note, 200), user.name).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      if (!['super', 'admin'].includes(user.role)) return bad('Only an admin can delete entries.', 403);
      await env.DB.prepare('DELETE FROM acc_entries WHERE id = ?').bind(id).run(); return json({ ok: true });
    }
  }

  if (res === 'coupons') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM coupons ORDER BY id DESC').all()).results);
    if (m === 'POST') return saveCoupon(req, env, 0);
    if (m === 'PUT' && id) return saveCoupon(req, env, id);
    if (m === 'DELETE' && id) { await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  if (res === 'reviews') {
    if (m === 'GET') return json((await env.DB.prepare("SELECT r.*, p.name_en FROM reviews r LEFT JOIN products p ON p.code = r.product_code ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 300").all()).results);
    if (m === 'PUT' && id) { const b = await readJson(req) || {}; await env.DB.prepare('UPDATE reviews SET status = ? WHERE id = ?').bind(b.status === 'approved' ? 'approved' : 'hidden', id).run(); return json({ ok: true }); }
    if (m === 'DELETE' && id) { await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  if (res === 'banners') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM banners ORDER BY sort, id').all()).results);
    if (m === 'POST' || (m === 'PUT' && id)) return saveBanner(req, env, id);
    if (m === 'DELETE' && id) return deleteBanner(env, id);
  }
  if (res === 'abandoned') {
    if (m === 'GET') return json((await env.DB.prepare("SELECT * FROM abandoned ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 200").all()).results.map(a => ({ ...a, items: JSON.parse(a.items || '[]') })));
    if (m === 'PUT' && id) { const b = await readJson(req) || {}; await env.DB.prepare('UPDATE abandoned SET status = ?, note = ? WHERE id = ?').bind(['open', 'contacted', 'dismissed'].includes(b.status) ? b.status : 'open', str(b.note, 500), id).run(); return json({ ok: true }); }
    if (m === 'DELETE' && id) { await env.DB.prepare('DELETE FROM abandoned WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  if (res === 'customer' && m === 'GET') return adminCustomer(env, url);
  if (res === 'customer' && m === 'PUT') return saveCustomerNote(req, env);
  if (res === 'fraud' && m === 'GET') return fraudCheck(env, url);
  if (res === 'sms' && m === 'POST') return bulkSms(req, env, ctx);
  if (res === 'stock-alerts' && m === 'GET') return json((await env.DB.prepare("SELECT product_code, size_id, size_label, COUNT(*) AS n FROM stock_alerts WHERE notified_at = '' GROUP BY size_id").all()).results);
  if (res === 'courier' && m === 'POST' && id) return sendToSteadfast(env, id, ctx);
  if (res === 'courier' && m === 'GET' && id) return steadfastStatus(env, id);
  if (res === 'stats' && m === 'GET') return adminStats(env);
  if (res === 'customers' && m === 'GET') return adminCustomers(env, url);
  if (res === 'custom') {
    if (m === 'GET') return json({ ...(await getCustom(env)), defaults: DEFAULT_CUSTOM.groups });
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
    if (m === 'POST') return saveProduct(req, env, 0, ctx);
    if (m === 'PUT' && id) return saveProduct(req, env, id, ctx);
    if (m === 'DELETE' && id) return deleteProduct(env, id);
  }
  if (res === 'sales') {
    const sub = path.split('/')[1];
    if (sub === 'report' && m === 'GET') return salesReport(env, url);
    if (sub === 'meta' && m === 'GET') return json(await salesMeta(env));
    if (!sub && m === 'POST') return createSale(req, env, user, ctx);
  }
  if (res === 'due' && m === 'POST' && id) return collectDue(req, env, id, user);
  if (res === 'goals') {
    if (m === 'GET') return json(await getGoals(env));
    if (m === 'PUT') { const b = await readJson(req) || {}; const v = { month_target: Math.max(0, int(b.month_target)) };
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('goals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(v)).run(); return json(v); }
  }
  if (res === 'orders') {
    if (m === 'GET') return adminOrders(env, url);
    if (m === 'PUT' && id && path.split('/')[2] === 'edit') return editOrder(req, env, id, user);
    if (m === 'PUT' && id) return updateOrder(req, env, id, ctx);
    if (m === 'DELETE' && id) return deleteOrder(env, id);
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
  const [shop, cats, prods, sizes, custom, fabrics, gallery, revs, banners] = await Promise.all([
    getShop(env),
    D.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
    D.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort, id DESC').all(),
    D.prepare('SELECT s.id, s.product_id, s.label, s.stock FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE p.active = 1 ORDER BY s.sort, s.id').all(),
    getCustom(env),
    D.prepare('SELECT * FROM fabrics WHERE active = 1 AND (stock IS NULL OR stock >= per_thobe) ORDER BY sort, id').all(),
    D.prepare('SELECT * FROM gallery ORDER BY sort, id DESC LIMIT 200').all(),
    D.prepare("SELECT product_code, name, rating, body, verified, created_at FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 800").all(),
    D.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY sort, id').all()
  ]);
  const reviews = {};
  for (const r of revs.results) (reviews[r.product_code] = reviews[r.product_code] || []).push({ name: r.name, rating: r.rating, body: r.body, verified: !!r.verified, date: r.created_at.slice(0, 10) });
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
      rating: reviews[p.code] ? { avg: Math.round(reviews[p.code].reduce((s, r) => s + r.rating, 0) / reviews[p.code].length * 10) / 10, count: reviews[p.code].length } : null,
      reviews: (reviews[p.code] || []).slice(0, 30),
      sizes: sizes.results.filter(s => s.product_id === p.id).map(s => ({ id: s.id, label: s.label, stock: s.stock }))
    };
  });
  return {
    shop,
    categories: cats.results.map(c => ({ id: c.slug, name: { en: c.name_en, bn: c.name_bn }, tile: !!c.on_home })),
    products,
    custom: custom.enabled ? {
      basePrice: custom.base_price, leadDays: custom.lead_days, sizes: custom.sizes,
      groups: custom.groups.map(g => ({ key: g.key, name: { en: g.name_en, bn: g.name_bn }, options: g.options.map(o => ({ name: { en: o.en, bn: o.bn }, add: o.add, look: o.look || '' })) })),
      fabrics: fabrics.results.map(f => ({ id: f.id, name: { en: f.name_en, bn: f.name_bn }, desc: { en: f.desc_en, bn: f.desc_bn }, add: f.price_add, hex: f.color_hex, gsm: f.gsm, image: f.image ? '/img/' + f.image : '',
        color: { en: f.color_en || '', bn: f.color_bn || f.color_en || '' }, family: f.family || '', composition: f.composition || '', origin: f.origin || '', season: f.season || '',
        left: f.stock == null ? null : Math.floor(f.stock / (f.per_thobe || 3.5)) }))
    } : null,
    gallery: gallery.results.map(g => ({ id: g.id, image: '/img/' + g.image, caption: { en: g.caption_en, bn: g.caption_bn }, product: g.product_code || '' })),
    banners: banners.results.map(b => ({ image: '/img/' + b.image, title: { en: b.title_en, bn: b.title_bn }, text: { en: b.text_en, bn: b.text_bn }, btn: { en: b.btn_en, bn: b.btn_bn }, link: b.link })),
    features: { otp: smsReady(env), bkashPay: bkashReady(env) }
  };
}

// ---------- orders (public) ----------
async function createOrder(req, env, ctx) {
  const b = await readJson(req);
  if (!b) return bad('Invalid request.');
  const name = str(b.name, 100), phone = str(b.phone, 20).replace(/[\s-]/g, ''), address = str(b.address, 500);
  const area = b.area === 'outside' ? 'outside' : 'inside', payment = ['bkash', 'bkash_online'].includes(b.payment) ? b.payment : 'cod';
  if (payment === 'bkash_online' && !bkashReady(env)) return bad('Online bKash payment is not available right now.');
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
    const fin = await getFinance(env);
    for (const it of customRaw) {
      const line = buildCustomLine(it.custom, Math.min(5, Math.max(1, int(it.qty, 1))), cfg, fabrics);
      if (line.error) return bad(line.error);
      const fb = fabrics[line.details.fabricId];
      line.cost = fb && fb.cost_per_gaj != null && fin.tailoring_cost != null ? Math.round(fin.tailoring_cost + fb.cost_per_gaj * (fb.per_thobe || 3.5)) : null;
      customLines.push(line);
    }
  }

  // নিজের মাপের জুব্বার কাপড় স্টক থেকে কমানো (স্টক রাখা হলে)
  const fabricUndo = [];
  for (const l of customLines) {
    const need = l.details.perThobe * l.qty;
    const r = await D.prepare('UPDATE fabrics SET stock = stock - ? WHERE id = ? AND (stock IS NULL OR stock >= ?)').bind(need, l.details.fabricId, need).run();
    if (!r.meta.changes) {
      if (fabricUndo.length) await D.batch(fabricUndo);
      return bad(`Sorry, we do not have enough ${l.details.fabric} fabric left. Please choose another fabric.`, 409);
    }
    fabricUndo.push(D.prepare('UPDATE fabrics SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(need, l.details.fabricId));
  }
  const lineItems = [], short = [];
  if (items.length) {
    const ids = [...new Set(items.map(i => i.sizeId))];
    const rows = (await D.prepare(`SELECT s.id, s.label, s.stock, p.id AS pid, p.code, p.name_en, p.color_en, p.price, p.cost, p.active
      FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE s.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    for (const it of items) {
      const r = byId[it.sizeId];
      if (!r || !r.active) { short.push({ sizeId: it.sizeId, available: 0 }); continue; }
      if (r.stock < it.qty) short.push({ sizeId: it.sizeId, available: r.stock, code: r.code, size: r.label });
      lineItems.push({ sizeId: r.id, productId: r.pid, code: r.code, name: r.name_en, color: r.color_en, size: r.label, qty: it.qty, price: r.price, cost: r.cost == null ? null : r.cost });
    }
    if (short.length) { if (fabricUndo.length) await D.batch(fabricUndo); return json({ error: 'stock', message: 'Some items are out of stock.', short }, 409); }

    // কমানো হবে শুধু যদি স্টক যথেষ্ট থাকে; কোনোটা ব্যর্থ হলে আগেরগুলো ফেরত দেওয়া হয়
    const res = await D.batch(lineItems.map(l => D.prepare('UPDATE product_sizes SET stock = stock - ? WHERE id = ? AND stock >= ?').bind(l.qty, l.sizeId, l.qty)));
    const failed = res.some(r => !r.meta.changes);
    if (failed) {
      const undo = lineItems.filter((l, i) => res[i].meta.changes).map(l => D.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId));
      if (undo.length || fabricUndo.length) await D.batch(undo.concat(fabricUndo));
      return json({ error: 'stock', message: 'Some items just sold out.', short: [] }, 409);
    }
  }
  lineItems.push(...customLines);

  const shop = await getShop(env);
  const subtotal = lineItems.reduce((s, l) => s + l.price * l.qty, 0);
  let delivery = area === 'outside' ? int(shop.delivery_outside) : int(shop.delivery_inside);
  const bundleOff = bundleDiscount(shop, lineItems.reduce((s, l) => s + l.qty, 0), subtotal);
  if (int(shop.free_ship_over) > 0 && subtotal - bundleOff >= int(shop.free_ship_over)) delivery = 0;
  let discount = 0, couponCode = '';
  if (str(b.coupon, 30)) {
    const c = await findCoupon(env, b.coupon, subtotal - bundleOff);
    if (c.error) return bad(c.error);
    // ব্যবহারের সংখ্যা একবারে বাড়ানো হয়, যাতে সীমার বেশি ব্যবহার না হয়
    const u = await D.prepare('UPDATE coupons SET used = used + 1 WHERE id = ? AND (max_uses = 0 OR used < max_uses)').bind(c.row.id).run();
    if (!u.meta.changes) return bad('This coupon has been fully used.');
    couponCode = c.row.code;
    if (c.row.kind === 'free_ship') { discount = delivery; } else discount = c.discount;
  }
  const total = Math.max(0, subtotal + delivery - discount - bundleOff);
  const now = new Date(Date.now() + 6 * 3600e3); // Bangladesh time for the number
  const orderNo = 'AH' + now.toISOString().slice(2, 10).replace(/-/g, '') + String(Math.floor(Math.random() * 9000) + 1000);
  await D.prepare(`INSERT INTO orders (order_no, name, phone, address, area, payment, trx, note, items, subtotal, delivery, total, lang, discount, coupon, bundle_off)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderNo, name, phone, address, area, payment, trx, note, JSON.stringify(lineItems), subtotal, delivery, total, lang, discount, couponCode, bundleOff).run();
  await D.prepare("UPDATE abandoned SET status = 'recovered', updated_at = CURRENT_TIMESTAMP WHERE phone = ?").bind(phone.replace(/\D/g, '').slice(-11)).run();
  notify(env, ctx, `🛒 New order ${orderNo}\n${name}, ${phone}\n${lineItems.map(l => `• ${l.name} (${l.size}) ×${l.qty}`).join('\n')}${couponCode ? `\nCoupon ${couponCode}: -${discount}` : ''}\nTotal: BDT ${total} (${payment === 'bkash' ? 'bKash ' + trx : 'COD'})`);
  await orderSms(env, ctx, { order_no: orderNo, name, phone, total, lang }, 'new');
  return json({ ok: true, orderNo, subtotal, delivery, discount, coupon: couponCode, bundleOff, total, payment, items: lineItems });
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
    chosen.push({ group: g.name_en, groupBn: g.name_bn, choice: o.en, choiceBn: o.bn, add: int(o.add), look: o.look || '' });
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
    details: { fabric: fab.name_en + (fab.color_en ? ', ' + fab.color_en : ''), fabricBn: fab.name_bn, fabricId: fab.id, perThobe: fab.per_thobe || 3.5, hex: fab.color_hex || '', image: fab.image || '', options: chosen, fit, meas, note: str(c.note, 300) }
  };
}

async function trackOrder(env, url) {
  const no = str(url.searchParams.get('no'), 30).toUpperCase();
  const phone = str(url.searchParams.get('phone'), 20).replace(/\D/g, '').slice(-11);
  if (!no || phone.length !== 11) return bad('Enter your order number and mobile number.');
  const o = await env.DB.prepare('SELECT order_no, created_at, phone, status, items, total, delivery, payment, tracking_code FROM orders WHERE order_no = ?').bind(no).first();
  if (!o || o.phone.replace(/\D/g, '').slice(-11) !== phone) return bad('No order found with this number and phone.', 404);
  return json({ orderNo: o.order_no, createdAt: o.created_at, status: o.status, total: o.total, delivery: o.delivery, payment: o.payment, tracking: o.tracking_code || '',
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
  for (const k of Object.keys(DEFAULT_SHOP)) shop[k] = typeof DEFAULT_SHOP[k] === 'number' ? Math.max(0, int(b[k], DEFAULT_SHOP[k])) : str(b[k], 500);
  shop.bundle_pct = Math.min(50, shop.bundle_pct);
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

async function saveProduct(req, env, id, ctx) {
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
    price, compare_price: intOrNull(b.compare_price), cost: intOrNull(b.cost), badge_en: str(b.badge_en, 40), badge_bn: str(b.badge_bn, 40),
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

  const existingRows = (await D.prepare('SELECT id, stock FROM product_sizes WHERE product_id = ?').bind(pid).all()).results;
  const existing = existingRows.map(r => r.id);
  const wasOut = new Set(existingRows.filter(r => r.stock <= 0).map(r => r.id));
  const keep = sizes.filter(s => existing.includes(s.id)).map(s => s.id);
  const ops = [
    ...existing.filter(x => !keep.includes(x)).map(x => D.prepare('DELETE FROM product_sizes WHERE id = ?').bind(x)),
    ...sizes.map(s => keep.includes(s.id)
      ? D.prepare('UPDATE product_sizes SET label=?, stock=?, sort=? WHERE id=?').bind(s.label, s.stock, s.sort, s.id)
      : D.prepare('INSERT INTO product_sizes (product_id, label, stock, sort) VALUES (?,?,?,?)').bind(pid, s.label, s.stock, s.sort))
  ];
  await D.batch(ops);
  await Promise.all(oldImages.filter(k => !images.includes(k)).map(k => env.IMAGES.delete(k)));
  // স্টক শেষ ছিল এমন সাইজ আবার এলে যারা "জানাবেন" চেয়েছিল তাদের SMS
  const back = sizes.filter(s => keep.includes(s.id) && wasOut.has(s.id) && s.stock > 0 && fields.active);
  let notified = 0;
  for (const sz of back) notified += await notifyBackInStock(env, ctx, new URL(req.url).origin, code, nameEn, sz);
  return json({ ok: true, id: pid, notified });
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
  const ch = str(url.searchParams.get('channel'), 20);
  if (ch) { where.push("COALESCE(channel, 'website') = ?"); args.push(ch); }
  if (url.searchParams.get('due') === '1') where.push("delivery_mode = 'handover' AND status != 'cancelled' AND total > paid_amount");
  const from = str(url.searchParams.get('from'), 10), to = str(url.searchParams.get('to'), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("date(created_at, '+6 hours') >= ?"); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("date(created_at, '+6 hours') <= ?"); args.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 300';
  const [list, counts] = await Promise.all([
    env.DB.prepare(sql).bind(...args).all(),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()
  ]);
  const hist = await phoneHistory(env, list.results.map(o => o.phone));
  return json({
    orders: list.results.map(o => ({ ...o, items: JSON.parse(o.items || '[]'), history: hist[last11(o.phone)] || null })),
    counts: Object.fromEntries(counts.results.map(c => [c.status, c.n]))
  });
}

async function updateOrder(req, env, id, ctx) {
  const b = await readJson(req) || {};
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  if (b.admin_note != null && b.status == null) {
    await env.DB.prepare('UPDATE orders SET admin_note = ? WHERE id = ?').bind(str(b.admin_note, 1000), id).run();
    return json({ ok: true });
  }
  if (!ORDER_STATUSES.includes(b.status)) return bad('Unknown status.');
  if (b.status === 'cancelled') await env.DB.prepare('UPDATE orders SET cancel_type = ?, cancel_reason = ? WHERE id = ?').bind(b.cancel_type === 'returned' ? 'returned' : 'cancelled', str(b.cancel_reason, 200), id).run();
  const items = JSON.parse(o.items || '[]').filter(l => l.sizeId);
  const ops = [env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, id)];
  // বাতিল করলে স্টক ফেরত যায়; আবার চালু করলে স্টক আবার কমে (নিজের মাপের জুব্বার স্টক নেই)
  const fab = JSON.parse(o.items || '[]').filter(l => l.custom && l.details && l.details.fabricId && l.details.perThobe);
  if (b.status === 'cancelled' && o.status !== 'cancelled') {
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId)));
    fab.forEach(l => ops.push(env.DB.prepare('UPDATE fabrics SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(l.details.perThobe * l.qty, l.details.fabricId)));
  }
  if (o.status === 'cancelled' && b.status !== 'cancelled') {
    items.forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = MAX(0, stock - ?) WHERE id = ?').bind(l.qty, l.sizeId)));
    fab.forEach(l => ops.push(env.DB.prepare('UPDATE fabrics SET stock = MAX(0, stock - ?) WHERE id = ? AND stock IS NOT NULL').bind(l.details.perThobe * l.qty, l.details.fabricId)));
  }
  await env.DB.batch(ops);
  if (b.status !== o.status) await orderSms(env, ctx, o, b.status);
  if (b.status === 'delivered' && o.delivery_mode !== 'handover') await postOrderSale(env, { ...o, status: 'delivered' });
  else if (o.status === 'delivered' && o.delivery_mode !== 'handover') await env.DB.prepare("DELETE FROM acc_entries WHERE order_no = ? AND source = 'order'").bind(o.order_no).run();
  // বাতিল বা ফেরত: এই বিক্রির সব টাকার এন্ট্রি মুছে যায় (টাকা ফেরত দেওয়া হয়েছে ধরে)
  if (b.status === 'cancelled') await env.DB.prepare("DELETE FROM acc_entries WHERE source = 'order' AND (order_no = ? OR ref = ?)").bind(o.order_no, o.order_no).run();
  return json({ ok: true });
}

async function deleteOrder(env, id) {
  const o = await env.DB.prepare('SELECT status, items, coupon, delivery_mode FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  const ops = [];
  // এখনো পাঠানো হয়নি এমন অর্ডার, বা দোকানের বিক্রি ভুল করে দেওয়া হলে, মুছলে স্টক ফেরত যায়
  if (o.status === 'new' || o.status === 'confirmed' || (o.delivery_mode === 'handover' && o.status !== 'cancelled')) {
    const all = JSON.parse(o.items || '[]');
    all.filter(l => l.sizeId).forEach(l => ops.push(env.DB.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId)));
    all.filter(l => l.custom && l.details && l.details.fabricId && l.details.perThobe).forEach(l => ops.push(env.DB.prepare('UPDATE fabrics SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(l.details.perThobe * l.qty, l.details.fabricId)));
  }
  if (o.coupon) ops.push(env.DB.prepare('UPDATE coupons SET used = MAX(0, used - 1) WHERE code = ?').bind(o.coupon));
  ops.push(env.DB.prepare("DELETE FROM acc_entries WHERE source = 'order' AND (order_no = (SELECT order_no FROM orders WHERE id = ?) OR ref = (SELECT order_no FROM orders WHERE id = ?))").bind(id, id));
  ops.push(env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id));
  await env.DB.batch(ops);
  return json({ ok: true });
}

// ---------- coupons ----------
async function findCoupon(env, code, subtotal) {
  const c = await env.DB.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').bind(str(code, 30).toUpperCase()).first();
  if (!c) return { error: 'This coupon code is not valid.' };
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  if (c.expires && c.expires < today) return { error: 'This coupon has expired.' };
  if (c.max_uses && c.used >= c.max_uses) return { error: 'This coupon has been fully used.' };
  if (subtotal < c.min_order) return { error: `This coupon needs a minimum order of BDT ${c.min_order}.`, min: c.min_order };
  const discount = c.kind === 'percent' ? Math.round(subtotal * Math.min(90, c.value) / 100) : c.kind === 'fixed' ? Math.min(subtotal, c.value) : 0;
  return { row: c, discount };
}

async function checkCoupon(env, url) {
  const c = await findCoupon(env, url.searchParams.get('code'), int(url.searchParams.get('subtotal')));
  if (c.error) return json({ error: 'invalid', message: c.error, min: c.min || 0 }, 400);
  return json({ code: c.row.code, kind: c.row.kind, value: c.row.value, discount: c.discount });
}

async function saveCoupon(req, env, id) {
  const b = await readJson(req) || {};
  const code = str(b.code, 30).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (code.length < 3) return bad('Coupon code needs at least 3 letters or numbers.');
  const kind = ['percent', 'fixed', 'free_ship'].includes(b.kind) ? b.kind : 'percent';
  const value = Math.max(0, int(b.value));
  if (kind === 'percent' && (value < 1 || value > 90)) return bad('Percent discount must be between 1 and 90.');
  if (kind === 'fixed' && value < 1) return bad('Enter the discount amount.');
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(b.expires || '') ? b.expires : '';
  const vals = [code, kind, value, Math.max(0, int(b.min_order)), Math.max(0, int(b.max_uses)), expires, b.active ? 1 : 0];
  try {
    if (id) await env.DB.prepare('UPDATE coupons SET code=?, kind=?, value=?, min_order=?, max_uses=?, expires=?, active=? WHERE id=?').bind(...vals, id).run();
    else await env.DB.prepare('INSERT INTO coupons (code, kind, value, min_order, max_uses, expires, active) VALUES (?,?,?,?,?,?,?)').bind(...vals).run();
  } catch (e) { return bad('This coupon code already exists.'); }
  return json({ ok: true });
}

// ---------- reviews ----------
async function submitReview(req, env, ctx) {
  const b = await readJson(req) || {};
  const code = str(b.code, 40).toUpperCase(), name = str(b.name, 60), body = str(b.body, 1000);
  const phone = str(b.phone, 20).replace(/\D/g, '').slice(-11), rating = int(b.rating);
  if (rating < 1 || rating > 5) return bad('Choose 1 to 5 stars.');
  if (name.length < 2) return bad('Write your name.');
  const p = await env.DB.prepare('SELECT id FROM products WHERE code = ? AND active = 1').bind(code).first();
  if (!p) return bad('Product not found.', 404);
  const ip = clientIp(req);
  if (ip) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE ip = ? AND created_at > datetime('now', '-1 day')").bind(ip).first();
    if (r.n >= 5) return bad('Too many reviews today. Please try again tomorrow.', 429);
  }
  // যিনি এই পণ্যটি কিনে ডেলিভারি পেয়েছেন, তার রিভিউ "Verified buyer"
  let verified = 0;
  if (phone.length === 11) {
    const o = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'delivered' AND substr(replace(phone, '+', ''), -11) = ? AND items LIKE ?`).bind(phone, `%"code":"${code}"%`).first();
    verified = o.n ? 1 : 0;
  }
  await env.DB.prepare('INSERT INTO reviews (product_code, name, phone, rating, body, verified, ip) VALUES (?,?,?,?,?,?,?)').bind(code, name, phone, rating, body, verified, ip).run();
  notify(env, ctx, `⭐ New ${rating}-star review on ${code} from ${name}\n${body}`);
  return json({ ok: true });
}

// ---------- Steadfast courier ----------
async function steadfast(env, path, body) {
  if (!env.STEADFAST_API_KEY || !env.STEADFAST_SECRET_KEY) throw Object.assign(new Error('Steadfast is not set up. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in Cloudflare.'), { user: true });
  const r = await fetch('https://portal.packzy.com/api/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Api-Key': env.STEADFAST_API_KEY, 'Secret-Key': env.STEADFAST_SECRET_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let d = null; try { d = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok || !d) throw Object.assign(new Error((d && (d.message || JSON.stringify(d.errors || ''))) || `Steadfast error (${r.status})`), { user: true });
  return d;
}

async function sendToSteadfast(env, id, ctx) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  if (o.consignment) return bad('This order is already booked with Steadfast.');
  if (o.status === 'cancelled') return bad('This order is cancelled.');
  const items = JSON.parse(o.items || '[]');
  try {
    const d = await steadfast(env, 'create_order', {
      invoice: o.order_no, recipient_name: o.name, recipient_phone: o.phone.replace(/\D/g, '').slice(-11),
      recipient_address: o.address.slice(0, 250), cod_amount: o.payment === 'bkash' || o.paid ? 0 : o.total,
      note: (o.admin_note || o.note || '').slice(0, 200), item_description: items.map(l => `${l.name} ${l.size} x${l.qty}`).join(', ').slice(0, 250),
      total_lot: items.reduce((s, l) => s + l.qty, 0), delivery_type: 0
    });
    const c = d.consignment || {};
    if (!c.consignment_id) return bad(d.message || 'Steadfast did not accept the parcel.');
    await env.DB.prepare("UPDATE orders SET consignment = ?, tracking_code = ?, courier_status = ?, status = 'shipped' WHERE id = ?").bind(String(c.consignment_id), String(c.tracking_code || ''), String(c.status || 'in_review'), id).run();
    if (o.status !== 'shipped') await orderSms(env, ctx, { ...o, tracking_code: c.tracking_code }, 'shipped');
    return json({ ok: true, consignment: c.consignment_id, tracking: c.tracking_code });
  } catch (e) { if (e.user) return bad(e.message); throw e; }
}

async function steadfastStatus(env, id) {
  const o = await env.DB.prepare('SELECT consignment FROM orders WHERE id = ?').bind(id).first();
  if (!o || !o.consignment) return bad('This order is not booked with Steadfast.');
  try {
    const d = await steadfast(env, 'status_by_cid/' + encodeURIComponent(o.consignment));
    const st = String(d.delivery_status || '');
    await env.DB.prepare('UPDATE orders SET courier_status = ? WHERE id = ?').bind(st, id).run();
    if (st === 'delivered') {
      await env.DB.prepare("UPDATE orders SET status = 'delivered' WHERE id = ? AND status = 'shipped'").bind(id).run();
      const full = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
      if (full && full.status === 'delivered') await postOrderSale(env, full);
    }
    return json({ ok: true, status: st });
  } catch (e) { if (e.user) return bad(e.message); throw e; }
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
    options: (Array.isArray(g.options) ? g.options : []).slice(0, 12).map(o => ({ en: str(o.en, 60), bn: str(o.bn, 60), add: Math.max(0, int(o.add)), look: LOOKS.includes(o.look) ? o.look : '' })).filter(o => o.en)
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
    image: imgKey(b.image), gsm: intOrNull(b.gsm), active: b.active ? 1 : 0, sort: int(b.sort),
    color_en: str(b.color_en, 40), color_bn: str(b.color_bn, 40), family: str(b.family, 20), composition: str(b.composition, 80), origin: str(b.origin, 40), season: str(b.season, 40),
    stock: b.stock === '' || b.stock == null ? null : Math.max(0, Math.round(Number(b.stock) * 100) / 100) || 0,
    per_thobe: Math.min(10, Math.max(0.5, Number(b.per_thobe) || 3.5)),
    cost_per_gaj: b.cost_per_gaj === '' || b.cost_per_gaj == null ? null : Math.max(0, Number(b.cost_per_gaj) || 0)
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
  const [o, c, r, a] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE admin_unread > 0').first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM abandoned WHERE status = 'open' AND updated_at < datetime('now', '-30 minutes') AND updated_at > datetime('now', '-7 days')").first()
  ]);
  return json({ newOrders: o.n, unreadChats: c.n, pendingReviews: r.n, abandoned: a.n, bkash: bkashReady(env), bdcourier: !!env.BDCOURIER_API_KEY, steadfast: !!(env.STEADFAST_API_KEY && env.STEADFAST_SECRET_KEY), sms: !!(env.SMS_API_KEY && env.SMS_SENDER_ID) });
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
  const todayIso = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const mp = await profitReport(env, todayIso.slice(0, 8) + '01', todayIso, 'all', true);
  const lowFabrics = (await D.prepare('SELECT id, name_en, color_en, stock, per_thobe FROM fabrics WHERE active = 1 AND stock IS NOT NULL AND stock < per_thobe * 3 ORDER BY stock').all()).results;
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
    ...(await dashExtras(env)),
    recent: recent.results, lowStock: low.results, lowFabrics, monthProfit: { net: mp.net, gross: mp.gross, margin: mp.margin, missing: mp.missingCost.length }, unreadChats: chats.n, customers: customers.n, customOpen: customOpen.n,
    top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 6)
  });
}

async function adminCustomers(env, url) {
  const [rows, notes] = await Promise.all([
    env.DB.prepare(`SELECT substr(phone, -11) AS phone, MAX(name) AS name, MAX(address) AS address, COUNT(*) AS orders,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS spent, MIN(created_at) AS first_order, MAX(created_at) AS last_order,
      SUM(CASE WHEN items LIKE '%"custom":true%' THEN 1 ELSE 0 END) AS custom_orders,
      SUM(CASE WHEN status = 'cancelled' AND cancel_type = 'returned' THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN delivery_mode = 'handover' AND status != 'cancelled' AND total > paid_amount THEN total - paid_amount ELSE 0 END) AS due,
      GROUP_CONCAT(DISTINCT COALESCE(channel, 'website')) AS channels
      FROM orders WHERE phone IS NOT NULL AND phone != '' GROUP BY substr(phone, -11) ORDER BY last_order DESC LIMIT 3000`).all(),
    env.DB.prepare('SELECT * FROM customer_notes').all()
  ]);
  const byPhone = Object.fromEntries(notes.results.map(n => [n.phone, n]));
  return json(rows.results.map(r => ({ ...r, note: (byPhone[r.phone] || {}).note || '', tags: (byPhone[r.phone] || {}).tags || '', follow_up: (byPhone[r.phone] || {}).follow_up || '', follow_note: (byPhone[r.phone] || {}).follow_note || '' })));
}

// ================= v6 =================
const last11 = p => String(p || '').replace(/\D/g, '').slice(-11);
const smsReady = env => !!(env.SMS_API_KEY && env.SMS_SENDER_ID);
const bkashReady = env => !!(env.BKASH_APP_KEY && env.BKASH_APP_SECRET && env.BKASH_USERNAME && env.BKASH_PASSWORD);
const validPhone = p => /^01[3-9]\d{8}$/.test(p);

async function sendSms(env, phone, message) {
  if (!smsReady(env)) return false;
  const q = new URLSearchParams({ api_key: env.SMS_API_KEY, type: 'text', number: '88' + last11(phone), senderid: env.SMS_SENDER_ID, message });
  try {
    const t = await (await fetch('https://bulksmsbd.net/api/smsapi?' + q)).text();
    return /"response_code"\s*:\s*202/.test(t) || /202/.test(t.slice(0, 40));
  } catch (e) { console.error('sms', e); return false; }
}

// ---------- bundle offer: N বা তার বেশি পিস নিলে X% ছাড় ----------
function bundleDiscount(shop, qty, subtotal) {
  const min = int(shop.bundle_min), pct = Math.min(50, int(shop.bundle_pct));
  return min >= 2 && pct > 0 && qty >= min ? Math.round(subtotal * pct / 100) : 0;
}

// ---------- কাস্টমারের অর্ডারের ইতিহাস (ফেক অর্ডার ধরতে) ----------
async function phoneHistory(env, phones) {
  const list = [...new Set(phones.map(last11).filter(Boolean))], out = {};
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT substr(phone, -11) AS p, COUNT(*) AS n, SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS d,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS c FROM orders WHERE substr(phone, -11) IN (${part.map(() => '?').join(',')}) GROUP BY p`).bind(...part).all();
    r.results.forEach(x => { out[x.p] = { orders: x.n, delivered: x.d, cancelled: x.c }; });
  }
  return out;
}

async function fraudCheck(env, url) {
  const phone = last11(url.searchParams.get('phone'));
  if (!validPhone(phone)) return bad('Enter a valid mobile number.');
  const own = (await phoneHistory(env, [phone]))[phone] || { orders: 0, delivered: 0, cancelled: 0 };
  let courier = null;
  if (env.BDCOURIER_API_KEY) {
    try {
      const r = await fetch('https://api.bdcourier.com/courier-check', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.BDCOURIER_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone })
      });
      const d = await r.json();
      const data = d.courierData || d.data || d;
      const sum = data.summary || {};
      const couriers = Object.entries(data).filter(([k, v]) => k !== 'summary' && v && typeof v === 'object').map(([k, v]) => ({
        name: v.name || k, total: int(v.total_parcel), success: int(v.success_parcel), cancelled: int(v.cancelled_parcel)
      })).filter(c => c.total);
      courier = r.ok ? { total: int(sum.total_parcel), success: int(sum.success_parcel), cancelled: int(sum.cancelled_parcel), ratio: Number(sum.success_ratio) || 0, couriers }
        : { error: d.message || d.error || 'BD Courier check failed (' + r.status + ')' };
    } catch (e) { courier = { error: 'Could not reach BD Courier.' }; }
  }
  return json({ phone, own, courier });
}

// ---------- abandoned cart ----------
async function saveAbandoned(req, env) {
  const b = await readJson(req) || {};
  const phone = last11(b.phone);
  if (!validPhone(phone)) return json({ ok: false });
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(i => ({ name: str(i.name, 120), size: str(i.size, 40), qty: Math.max(1, int(i.qty, 1)), price: Math.max(0, int(i.price)) }));
  if (!items.length) return json({ ok: false });
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  await env.DB.prepare(`INSERT INTO abandoned (phone, name, address, area, items, subtotal, lang) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address, area = excluded.area, items = excluded.items, subtotal = excluded.subtotal,
    lang = excluded.lang, status = 'open', updated_at = CURRENT_TIMESTAMP`).bind(phone, str(b.name, 100), str(b.address, 500), b.area === 'outside' ? 'outside' : 'inside', JSON.stringify(items), subtotal, b.lang === 'bn' ? 'bn' : 'en').run();
  return json({ ok: true });
}

// ---------- stock-এ ফিরলে জানানো ----------
async function saveStockAlert(req, env) {
  const b = await readJson(req) || {};
  const phone = last11(b.phone);
  if (!validPhone(phone)) return bad('Enter a valid mobile number, like 01712345678.');
  const s = await env.DB.prepare('SELECT s.id, s.label, s.stock, p.code FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE s.id = ? AND p.code = ?').bind(int(b.sizeId), str(b.code, 40)).first();
  if (!s) return bad('Size not found.');
  if (s.stock > 0) return bad('This size is in stock now. You can order it.');
  await env.DB.prepare("INSERT INTO stock_alerts (product_code, size_id, size_label, phone, lang) VALUES (?,?,?,?,?) ON CONFLICT(size_id, phone) DO UPDATE SET notified_at = ''")
    .bind(s.code, s.id, s.label, phone, b.lang === 'bn' ? 'bn' : 'en').run();
  return json({ ok: true });
}

async function notifyBackInStock(env, ctx, origin, code, name, size) {
  const list = (await env.DB.prepare("SELECT id, phone, lang FROM stock_alerts WHERE size_id = ? AND notified_at = '' LIMIT 40").bind(size.id).all()).results;
  if (!list.length || !smsReady(env)) return 0;
  const link = `${origin}/p/${code}`;
  const job = (async () => {
    for (const a of list) {
      const msg = a.lang === 'bn' ? `আল হাদাফ: ${name}, সাইজ ${size.label} আবার স্টকে এসেছে। অর্ডার: ${link}` : `Al Hadaf: ${name}, size ${size.label} is back in stock. Order: ${link}`;
      await sendSms(env, a.phone, msg);
      await env.DB.prepare('UPDATE stock_alerts SET notified_at = CURRENT_TIMESTAMP WHERE id = ?').bind(a.id).run();
    }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  return list.length;
}

// ---------- customer details, notes, bulk SMS ----------
async function adminCustomer(env, url) {
  const phone = last11(url.searchParams.get('phone'));
  const [orders, note, profile] = await Promise.all([
    env.DB.prepare("SELECT id, order_no, created_at, status, cancel_type, total, items, payment, coupon, discount, COALESCE(channel, 'website') AS channel, delivery_mode, paid_amount, sold_by FROM orders WHERE substr(phone, -11) = ? ORDER BY id DESC").bind(phone).all(),
    env.DB.prepare('SELECT * FROM customer_notes WHERE phone = ?').bind(phone).first(),
    env.DB.prepare('SELECT * FROM profiles WHERE phone = ?').bind(phone).first()
  ]);
  const bought = {}, sizes = {}, colors = {};
  orders.results.forEach(o => { if (o.status === 'cancelled') return; JSON.parse(o.items || '[]').forEach(l => {
    const k = l.custom ? 'Custom thobe · ' + l.color : `${l.name} · ${l.color} · ${l.size}`;
    bought[k] = (bought[k] || 0) + l.qty;
    if (!l.custom && l.size && l.size !== '-') sizes[l.size] = (sizes[l.size] || 0) + l.qty;
    if (l.color) colors[l.color] = (colors[l.color] || 0) + l.qty;
  }); });
  const top = m => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ name: k, qty: n }));
  // টাইমলাইন: অর্ডার/বিক্রি, চ্যাট, রিভিউ, বাকি আদায়
  const [chats, revs, pays] = await Promise.all([
    env.DB.prepare("SELECT id, created_at, last_msg, status FROM chats WHERE substr(replace(phone, '+', ''), -11) = ? ORDER BY id DESC LIMIT 20").bind(phone).all(),
    env.DB.prepare('SELECT created_at, product_code, rating, body, status FROM reviews WHERE phone = ? ORDER BY id DESC LIMIT 20').bind(phone).all(),
    env.DB.prepare(`SELECT e.created_at, e.amount, e.ref, e.note, a.name AS account FROM acc_entries e LEFT JOIN acc_accounts a ON a.id = e.account_id
      WHERE e.source = 'order' AND e.ref IN (SELECT order_no FROM orders WHERE substr(phone, -11) = ?) ORDER BY e.id DESC LIMIT 50`).bind(phone).all()
  ]);
  return json({
    phone, note: note ? note.note : '', tags: note ? note.tags : '', profile: profile || null,
    follow_up: note ? note.follow_up || '' : '', follow_note: note ? note.follow_note || '' : '',
    orders: orders.results.map(o => ({ ...o, items: JSON.parse(o.items || '[]'), due: o.delivery_mode === 'handover' && o.status !== 'cancelled' ? Math.max(0, o.total - (o.paid_amount || 0)) : 0 })),
    bought: Object.entries(bought).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    favSizes: top(sizes), favColors: top(colors), chats: chats.results, reviews: revs.results, payments: pays.results
  });
}

async function saveCustomerNote(req, env) {
  const b = await readJson(req) || {};
  const phone = last11(b.phone);
  if (!validPhone(phone)) return bad('Invalid phone.');
  const tags = str(b.tags, 200).split(',').map(x => x.trim()).filter(Boolean).slice(0, 10).join(', ');
  const fu = /^\d{4}-\d{2}-\d{2}$/.test(b.follow_up || '') ? b.follow_up : '';
  await env.DB.prepare(`INSERT INTO customer_notes (phone, note, tags, follow_up, follow_note) VALUES (?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET note = excluded.note, tags = excluded.tags,
    follow_up = excluded.follow_up, follow_note = excluded.follow_note, updated_at = CURRENT_TIMESTAMP`).bind(phone, str(b.note, 1000), tags, fu, str(b.follow_note, 200)).run();
  return json({ ok: true, tags });
}

async function bulkSms(req, env) {
  if (!smsReady(env)) return bad('SMS is not set up. Add SMS_API_KEY and SMS_SENDER_ID in Cloudflare.');
  const b = await readJson(req) || {};
  const message = str(b.message, 600);
  const people = (Array.isArray(b.people) ? b.people : []).slice(0, 40).map(p => ({ phone: last11(p.phone), name: str(p.name, 60) })).filter(p => validPhone(p.phone));
  if (!message || !people.length) return bad('Write a message and choose customers.');
  let sent = 0;
  // ফ্রি প্ল্যানে এক রিকোয়েস্টে ৫০টির বেশি বাইরের কল করা যায় না, তাই প্রতিবার সর্বোচ্চ ৪০ জন
  await Promise.all(people.map(async p => { if (await sendSms(env, p.phone, message.replace(/\{name\}/g, p.name.split(' ')[0] || ''))) sent++; }));
  return json({ ok: true, sent, tried: people.length });
}

// ---------- banners ----------
async function saveBanner(req, env, id) {
  const b = await readJson(req) || {};
  const image = imgKey(b.image);
  if (!image) return bad('Upload a banner photo first.');
  const f = { image, title_en: str(b.title_en, 120), title_bn: str(b.title_bn, 120), text_en: str(b.text_en, 300), text_bn: str(b.text_bn, 300),
    btn_en: str(b.btn_en, 40), btn_bn: str(b.btn_bn, 40), link: str(b.link, 200), sort: int(b.sort), active: b.active ? 1 : 0 };
  const keys = Object.keys(f);
  if (id) {
    const old = await env.DB.prepare('SELECT image FROM banners WHERE id = ?').bind(id).first();
    if (!old) return bad('Banner not found.', 404);
    await env.DB.prepare(`UPDATE banners SET ${keys.map(k => k + '=?').join(', ')} WHERE id = ?`).bind(...keys.map(k => f[k]), id).run();
    if (old.image !== image) await env.IMAGES.delete(old.image);
  } else await env.DB.prepare(`INSERT INTO banners (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => f[k])).run();
  return json({ ok: true });
}
async function deleteBanner(env, id) {
  const old = await env.DB.prepare('SELECT image FROM banners WHERE id = ?').bind(id).first();
  if (!old) return bad('Banner not found.', 404);
  await env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(id).run();
  await env.IMAGES.delete(old.image);
  return json({ ok: true });
}

// ---------- customer login with SMS code ----------
const custCookie = (val, maxAge) => `ah_cust=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function customerPhone(req, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const tok = getCookie(req, 'ah_cust');
  if (!tok) return null;
  const [phone, exp, sig] = tok.split('.');
  if (!validPhone(phone) || !exp || Number(exp) < Date.now()) return null;
  return sameBytes(enc.encode(sig || ''), enc.encode(await hmac(env, `cust:${phone}.${exp}`))) ? phone : null;
}

async function sendOtp(req, env, ctx) {
  if (!smsReady(env)) return bad('Login by SMS is not available right now.');
  const b = await readJson(req) || {};
  const phone = last11(b.phone);
  if (!validPhone(phone)) return bad('Enter a valid mobile number, like 01712345678.');
  const now = Date.now();
  const row = await env.DB.prepare('SELECT * FROM otps WHERE phone = ?').bind(phone).first();
  if (row && now - row.window_start < 15 * 60e3 && row.sent >= 3) return bad('Too many codes sent. Please try again in 15 minutes.', 429);
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const hash = b64url(await crypto.subtle.digest('SHA-256', enc.encode(phone + ':' + code)));
  const fresh = !row || now - row.window_start >= 15 * 60e3;
  await env.DB.prepare(`INSERT INTO otps (phone, code_hash, expires, tries, sent, window_start) VALUES (?,?,?,0,1,?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, tries = 0, sent = ${fresh ? 1 : 'sent + 1'}, window_start = ${fresh ? 'excluded.window_start' : 'window_start'}`)
    .bind(phone, hash, now + 5 * 60e3, now).run();
  const ok = await sendSms(env, phone, (b.lang === 'bn' ? `আল হাদাফ লগইন কোড: ${code}। ৫ মিনিট কাজ করবে। কাউকে বলবেন না।` : `Al Hadaf login code: ${code}. Valid for 5 minutes. Do not share it.`));
  if (!ok) return bad('Could not send the SMS. Please try again.');
  return json({ ok: true });
}

async function verifyOtp(req, env) {
  const b = await readJson(req) || {};
  const phone = last11(b.phone), code = str(b.code, 10).replace(/\D/g, '');
  const row = await env.DB.prepare('SELECT * FROM otps WHERE phone = ?').bind(phone).first();
  if (!row || row.expires < Date.now()) return bad('The code has expired. Ask for a new one.');
  if (row.tries >= 5) return bad('Too many wrong tries. Ask for a new code.');
  const hash = b64url(await crypto.subtle.digest('SHA-256', enc.encode(phone + ':' + code)));
  if (!sameBytes(enc.encode(hash), enc.encode(row.code_hash))) {
    await env.DB.prepare('UPDATE otps SET tries = tries + 1 WHERE phone = ?').bind(phone).run();
    return bad('Wrong code. Check the SMS and try again.');
  }
  await env.DB.prepare('DELETE FROM otps WHERE phone = ?').bind(phone).run();
  const exp = String(Date.now() + 60 * 864e5);
  return json({ ok: true }, 200, { 'set-cookie': custCookie(`${phone}.${exp}.${await hmac(env, `cust:${phone}.${exp}`)}`, 60 * 86400) });
}

async function accountData(env, phone) {
  const [profile, orders] = await Promise.all([
    env.DB.prepare('SELECT name, address, area, meas FROM profiles WHERE phone = ?').bind(phone).first(),
    env.DB.prepare('SELECT order_no, created_at, status, total, items, payment, paid, tracking_code, name, address, area FROM orders WHERE substr(phone, -11) = ? ORDER BY id DESC LIMIT 50').bind(phone).all()
  ]);
  const last = orders.results[0];
  return json({
    phone,
    profile: profile ? { ...profile, meas: profile.meas ? JSON.parse(profile.meas) : null } : (last ? { name: last.name, address: last.address, area: last.area, meas: null } : { name: '', address: '', area: 'inside', meas: null }),
    orders: orders.results.map(o => ({ orderNo: o.order_no, createdAt: o.created_at, status: o.status, total: o.total, payment: o.payment, paid: !!o.paid, tracking: o.tracking_code,
      items: JSON.parse(o.items || '[]').map(l => ({ name: l.name, color: l.color, size: l.size, qty: l.qty, code: l.code, custom: !!l.custom })) }))
  });
}

async function saveProfile(req, env, phone) {
  const b = await readJson(req) || {};
  let meas = '';
  if (b.meas && typeof b.meas === 'object') meas = JSON.stringify(Object.fromEntries(Object.entries(b.meas).slice(0, 12).map(([k, v]) => [str(k, 20), str(v, 20)])));
  await env.DB.prepare(`INSERT INTO profiles (phone, name, address, area, meas) VALUES (?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address,
    area = excluded.area, meas = CASE WHEN excluded.meas = '' THEN profiles.meas ELSE excluded.meas END, updated_at = CURRENT_TIMESTAMP`)
    .bind(phone, str(b.name, 100), str(b.address, 500), b.area === 'outside' ? 'outside' : 'inside', meas).run();
  return json({ ok: true });
}

// ---------- bKash online payment (Tokenized Checkout, mode 0011) ----------
const bkBase = env => env.BKASH_MODE === 'live' ? 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized' : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized';
let bkToken = null;
async function bkashToken(env) {
  if (bkToken && bkToken.exp > Date.now()) return bkToken.id;
  const r = await fetch(bkBase(env) + '/checkout/token/grant', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', username: env.BKASH_USERNAME, password: env.BKASH_PASSWORD },
    body: JSON.stringify({ app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET })
  });
  const d = await r.json().catch(() => ({}));
  if (!d.id_token) throw Object.assign(new Error('bKash login failed: ' + (d.statusMessage || d.msg || r.status)), { user: true });
  bkToken = { id: d.id_token, exp: Date.now() + 50 * 60e3 };
  return d.id_token;
}
async function bkashCall(env, path, body) {
  const r = await fetch(bkBase(env) + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: await bkashToken(env), 'X-APP-Key': env.BKASH_APP_KEY },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

async function bkashCreate(req, env, url) {
  if (!bkashReady(env)) return bad('Online bKash payment is not available right now.');
  const b = await readJson(req) || {};
  const o = await env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(str(b.orderNo, 30)).first();
  if (!o || last11(o.phone) !== last11(b.phone)) return bad('Order not found.', 404);
  if (o.paid) return bad('This order is already paid.');
  if (o.status === 'cancelled') return bad('This order is cancelled.');
  try {
    const d = await bkashCall(env, '/checkout/create', {
      mode: '0011', payerReference: last11(o.phone), callbackURL: url.origin + '/api/pay/bkash/callback',
      amount: String(o.total), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: o.order_no
    });
    if (!d.bkashURL || !d.paymentID) return bad('bKash could not start the payment: ' + (d.statusMessage || 'unknown error'));
    await env.DB.prepare('UPDATE orders SET pay_id = ? WHERE id = ?').bind(d.paymentID, o.id).run();
    return json({ ok: true, url: d.bkashURL });
  } catch (e) { if (e.user) return bad(e.message); throw e; }
}

async function bkashCallback(env, url, ctx) {
  const paymentID = str(url.searchParams.get('paymentID'), 80), status = url.searchParams.get('status');
  const o = paymentID ? await env.DB.prepare('SELECT * FROM orders WHERE pay_id = ?').bind(paymentID).first() : null;
  const go = (no, result) => Response.redirect(`${url.origin}/#/pay/${encodeURIComponent(no || '')}/${result}`, 302);
  if (!o) return go('', 'failed');
  if (o.paid) return go(o.order_no, 'success');
  if (status !== 'success') return go(o.order_no, status === 'cancel' ? 'cancelled' : 'failed');
  try {
    let d = await bkashCall(env, '/checkout/execute', { paymentID });
    if (d.transactionStatus !== 'Completed') d = await bkashCall(env, '/checkout/payment/status', { paymentID });
    if (d.transactionStatus === 'Completed' && Number(d.amount) >= o.total) {
      await env.DB.prepare('UPDATE orders SET paid = 1, trx = ? WHERE id = ?').bind(str(d.trxID, 40), o.id).run();
      notify(env, ctx, `💳 bKash payment received for ${o.order_no}: BDT ${d.amount}, TrxID ${d.trxID}`);
      return go(o.order_no, 'success');
    }
    return go(o.order_no, 'failed');
  } catch (e) { console.error('bkash', e); return go(o.order_no, 'failed'); }
}

// ---------- SEO: প্রতিটি পণ্যের নিজস্ব লিংক, Google-এর জন্য তথ্য, sitemap ----------
const xmlEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function seoPage(req, env, url) {
  const origin = url.origin, path = url.pathname.replace(/\/$/, '');
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain' } });
  if (path === '/sitemap.xml') {
    const [prods, cats] = await Promise.all([
      env.DB.prepare('SELECT code, updated_at FROM products WHERE active = 1').all(),
      env.DB.prepare('SELECT slug FROM categories').all()
    ]);
    const u = (loc, mod) => `<url><loc>${xmlEsc(origin + loc)}</loc>${mod ? `<lastmod>${mod.slice(0, 10)}</lastmod>` : ''}</url>`;
    const body = [u('/'), ...cats.results.map(c => u('/c/' + c.slug)), ...prods.results.map(p => u('/p/' + p.code, p.updated_at))].join('');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' } });
  }
  const page = await env.ASSETS.fetch(new Request(origin + '/', req));
  const [, kind, slug] = path.match(/^\/(p|c)\/(.+)$/) || [];
  let title = null, desc = null, image = origin + '/logo-light.png', ld = null;
  if (kind === 'p') {
    const p = await env.DB.prepare('SELECT * FROM products WHERE code = ? AND active = 1').bind(decodeURIComponent(slug).toUpperCase()).first();
    if (p) {
      const im = imgs(p.images);
      if (im[0]) image = origin + '/img/' + im[0];
      title = `${p.name_en}${p.color_en ? ', ' + p.color_en : ''} | Al Hadaf`;
      desc = (p.desc_en || `${p.name_en} by Al Hadaf.`).slice(0, 155) + ` BDT ${p.price}. Cash on delivery all over Bangladesh.`;
      const [st, rv] = await Promise.all([
        env.DB.prepare('SELECT SUM(stock) AS n FROM product_sizes WHERE product_id = ?').bind(p.id).first(),
        env.DB.prepare("SELECT COUNT(*) AS n, AVG(rating) AS a FROM reviews WHERE product_code = ? AND status = 'approved'").bind(p.code).first()
      ]);
      ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name_en, sku: p.code, image: im.map(k => origin + '/img/' + k), description: p.desc_en || p.name_en,
        brand: { '@type': 'Brand', name: 'Al Hadaf' }, color: p.color_en || undefined,
        offers: { '@type': 'Offer', price: p.price, priceCurrency: 'BDT', url: `${origin}/p/${p.code}`, availability: st.n > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } };
      if (rv.n) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: Math.round(rv.a * 10) / 10, reviewCount: rv.n };
    }
  } else if (kind === 'c') {
    const c = await env.DB.prepare('SELECT * FROM categories WHERE slug = ?').bind(decodeURIComponent(slug)).first();
    if (c) { title = `${c.name_en} | Al Hadaf`; desc = `Shop ${c.name_en.toLowerCase()} at Al Hadaf. Cash on delivery all over Bangladesh.`; }
  }
  const canonical = origin + path;
  const head = `<link rel="canonical" href="${xmlEsc(canonical)}"><meta property="og:url" content="${xmlEsc(canonical)}"><meta name="twitter:card" content="summary_large_image">`
    + (ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '');
  return new HTMLRewriter()
    .on('title', { element(e) { if (title) e.setInnerContent(title); } })
    .on('meta[name="description"]', { element(e) { if (desc) e.setAttribute('content', desc); } })
    .on('meta[property="og:title"]', { element(e) { if (title) e.setAttribute('content', title); } })
    .on('meta[property="og:description"]', { element(e) { if (desc) e.setAttribute('content', desc); } })
    .on('meta[property="og:image"]', { element(e) { e.setAttribute('content', image); } })
    .on('meta[property="og:type"]', { element(e) { if (kind === 'p') e.setAttribute('content', 'product'); } })
    .on('head', { element(e) { e.append(head, { html: true }); } })
    .transform(new Response(page.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } }));
}

// ================= v9: লাভ-ক্ষতির হিসাব =================
async function getFinance(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'finance'").first();
  const v = row ? JSON.parse(row.value) : {};
  return { courier_inside: v.courier_inside ?? 60, courier_outside: v.courier_outside ?? 110, tailoring_cost: v.tailoring_cost ?? null, cod_fee_pct: v.cod_fee_pct ?? 1 };
}
async function saveFinance(req, env) {
  const b = await readJson(req) || {};
  const num = (v, d) => v === '' || v == null ? d : Math.max(0, Number(v) || 0);
  const v = { courier_inside: num(b.courier_inside, 0), courier_outside: num(b.courier_outside, 0), tailoring_cost: num(b.tailoring_cost, null), cod_fee_pct: Math.min(5, num(b.cod_fee_pct, 0)) };
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(v)).run();
  return json(v);
}

// অর্ডারের সময়ের কেনা দাম ব্যবহার হয়; পুরনো অর্ডারে না থাকলে এখনকার কেনা দাম ধরা হয়
async function profitReport(env, from, to, basis, quick) {
  const D = env.DB, okDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  to = okDay(to) ? to : today; from = okDay(from) ? from : to.slice(0, 8) + '01';
  const BD = "date(created_at, '+6 hours')";
  const statusSql = basis === 'delivered' ? "status = 'delivered'" : "status != 'cancelled'";
  const [orders, prods, fabs, fin, exp] = await Promise.all([
    D.prepare(`SELECT ${BD} AS day, area, payment, paid, status, items, subtotal, delivery, discount, bundle_off, coupon, total FROM orders WHERE ${statusSql} AND ${BD} BETWEEN ? AND ? LIMIT 10000`).bind(from, to).all(),
    D.prepare('SELECT code, name_en, cost FROM products').all(),
    D.prepare('SELECT id, cost_per_gaj, per_thobe FROM fabrics').all(),
    getFinance(env),
    D.prepare(`SELECT e.id, e.day, e.amount, e.note, c.name AS category FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id
      WHERE e.type = 'out' AND c.kind = 'expense' AND e.day BETWEEN ? AND ? ORDER BY e.day DESC, e.id DESC`).bind(from, to).all()
  ]);
  // দোকানে বা হাতে হাতে বিক্রি (ওয়েবসাইটের বাইরে) আর অন্য আয়
  const other = await D.prepare(`SELECT COALESCE(SUM(e.amount), 0) AS v FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id
    WHERE e.type = 'in' AND c.kind IN ('revenue', 'other_income') AND e.source != 'order' AND e.day BETWEEN ? AND ?`).bind(from, to).first();
  const pc = Object.fromEntries(prods.results.map(p => [p.code, p])), fc = Object.fromEntries(fabs.results.map(f => [f.id, f]));
  const days = {}, byProd = {}, missing = new Set();
  const t = { orders: 0, pieces: 0, revenue: 0, deliveryCharged: 0, discounts: 0, goodsCost: 0, courierCost: 0, codFee: 0 };
  for (const o of orders.results) {
    const items = JSON.parse(o.items || '[]');
    let cost = 0;
    for (const l of items) {
      let c = l.cost;
      if (c == null) {
        if (l.custom) { const f = l.details && fc[l.details.fabricId]; c = f && f.cost_per_gaj != null && fin.tailoring_cost != null ? fin.tailoring_cost + f.cost_per_gaj * (f.per_thobe || 3.5) : null; }
        else c = pc[l.code] ? pc[l.code].cost : null;
      }
      const key = l.custom ? 'CUSTOM' : l.code;
      if (c == null) missing.add(key);
      const bp = byProd[key] = byProd[key] || { code: key, name: l.custom ? 'Custom thobe' : l.name, qty: 0, revenue: 0, cost: 0, missing: false };
      bp.qty += l.qty; bp.revenue += l.price * l.qty; bp.cost += (c || 0) * l.qty; if (c == null) bp.missing = true;
      cost += (c || 0) * l.qty; t.pieces += l.qty;
    }
    const courier = o.area === 'outside' ? fin.courier_outside : fin.courier_inside;
    const cod = o.payment === 'cod' ? Math.round(o.total * fin.cod_fee_pct / 100) : 0;
    t.orders++; t.revenue += o.total; t.deliveryCharged += o.delivery; t.discounts += (o.discount || 0) + (o.bundle_off || 0);
    t.goodsCost += Math.round(cost); t.courierCost += courier; t.codFee += cod;
    const d = days[o.day] = days[o.day] || { day: o.day, revenue: 0, profit: 0, orders: 0 };
    d.revenue += o.total; d.profit += o.total - cost - courier - cod; d.orders++;
  }
  const expTotal = exp.results.reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  exp.results.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  t.otherIncome = other.v; t.revenue += other.v;
  const gross = t.revenue - t.goodsCost - t.courierCost - t.codFee;
  const net = gross - expTotal;
  const out = { from, to, basis: basis === 'delivered' ? 'delivered' : 'all', ...t, gross, expenses: expTotal, net,
    margin: t.revenue ? Math.round(net / t.revenue * 1000) / 10 : 0, missingCost: [...missing] };
  if (quick) return out;
  return { ...out, finance: fin,
    daily: Object.values(days).map(d => ({ ...d, profit: Math.round(d.profit) })).sort((a, b) => a.day < b.day ? -1 : 1),
    products: Object.values(byProd).map(p => ({ ...p, cost: Math.round(p.cost), profit: Math.round(p.revenue - p.cost), margin: p.revenue ? Math.round((p.revenue - p.cost) / p.revenue * 100) : 0 })).sort((a, b) => b.profit - a.profit),
    expenseList: exp.results, expenseByCat: Object.entries(byCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    missingNames: [...missing].map(k => k === 'CUSTOM' ? 'Custom thobe (set tailoring cost and fabric cost per gaj)' : (pc[k] ? `${pc[k].name_en} (${k})` : k)) };
}

// ================= v10: লগইন, ইউজার, অ্যাক্টিভিটি লগ =================
async function adminLogin(req, env) {
  if (!env.ADMIN_PASSWORD) return bad('ADMIN_PASSWORD secret is not set in Cloudflare yet.', 500);
  const b = await readJson(req) || {};
  const username = str(b.username, 40).toLowerCase(), password = str(b.password, 200);
  // ভুল পাসওয়ার্ডে শুধু সেই ডিভাইস/ইন্টারনেট (IP) আটকায়, সবাইকে না
  const key = 'ip:' + (clientIp(req) || 'x'), now = Date.now();
  const f = await env.DB.prepare('SELECT * FROM login_fails WHERE k = ?').bind(key).first();
  if (f && f.until > now) return bad(`Too many wrong tries. Try again in ${Math.ceil((f.until - now) / 60000)} minutes.`, 429);
  let user = null;
  // আগে টিমের কারও username/password মেলে কিনা, না মিললে মালিকের পাসওয়ার্ড (username যা-ই লেখা থাকুক)
  if (username && username !== 'owner' && username !== 'admin') {
    const u = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first();
    if (u && await checkUserPassword(env, u, password)) user = u;
  }
  if (!user && sameBytes(await sha(password.trim()), await sha(env.ADMIN_PASSWORD.trim()))) user = { id: 0, ver: 0, name: 'Owner' };
  if (!user) {
    const n = (f && f.until <= now && f.n >= 8 ? 0 : (f ? f.n : 0)) + 1;
    await env.DB.prepare('INSERT INTO login_fails (k, n, until) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET n = excluded.n, until = excluded.until')
      .bind(key, n, n >= 8 ? now + 15 * 60e3 : 0).run();
    await new Promise(r => setTimeout(r, 600));
    return bad('Wrong username or password.', 401);
  }
  await env.DB.prepare('DELETE FROM login_fails WHERE k = ?').bind(key).run();
  if (user.id) await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  await audit(env, { id: user.id, name: user.name }, 'LOGIN', 'auth', '', clientIp(req));
  const exp = String(now + 7 * 864e5), ver = String(user.ver || 0);
  return json({ ok: true }, 200, { 'set-cookie': cookie(`${user.id}.${exp}.${ver}.${await hmac(env, `u:${user.id}.${exp}.${ver}`)}`, 7 * 86400) });
}

async function changeOwnPassword(req, env, user) {
  if (!user.id) return bad('The owner password is the ADMIN_PASSWORD secret in Cloudflare. Change it there.');
  const b = await readJson(req) || {};
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!(await checkUserPassword(env, u, str(b.current, 200)))) return bad('Your current password is wrong.');
  if (str(b.next, 200).length < 8) return bad('The new password needs at least 8 characters.');
  const salt = crypto.randomUUID();
  await env.DB.prepare('UPDATE users SET salt = ?, hash = ?, ver = ver + 1 WHERE id = ?').bind(salt, await hashPassword(env, str(b.next, 200), salt), user.id).run();
  await audit(env, user, 'EDIT', 'users', user.username, 'Changed own password');
  return json({ ok: true, relogin: true });
}

async function usersApi(req, env, m, id, me) {
  const D = env.DB;
  if (m === 'GET') return json({ roles: ROLES, users: (await D.prepare('SELECT id, username, name, role, active, last_login, created_at FROM users ORDER BY active DESC, id').all()).results });
  const b = await readJson(req) || {};
  const role = ROLES[b.role] ? b.role : 'staff';
  const supers = async () => (await D.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'super' AND active = 1").first()).n;
  if (m === 'POST') {
    const username = str(b.username, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (username.length < 3 || username === 'owner') return bad('Username needs at least 3 letters (a–z, 0–9). "owner" is reserved.');
    if (str(b.name, 60).length < 2) return bad('Write the person’s name.');
    if (str(b.password, 200).length < 8) return bad('Password needs at least 8 characters.');
    const salt = crypto.randomUUID();
    try {
      await D.prepare('INSERT INTO users (username, name, role, salt, hash) VALUES (?,?,?,?,?)').bind(username, str(b.name, 60), role, salt, await hashPassword(env, str(b.password, 200), salt)).run();
    } catch (e) { return bad('This username is taken.'); }
    await audit(env, me, 'ADD', 'users', username, `${str(b.name, 60)} as ${ROLES[role]}`);
    return json({ ok: true });
  }
  const u = await D.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!u) return bad('User not found.', 404);
  if (m === 'PUT') {
    const active = b.active === false ? 0 : 1;
    if (u.role === 'super' && (role !== 'super' || !active) && (await supers()) <= 1 && me.id !== 0) return bad('Keep at least one active super admin.');
    const sets = ['name = ?', 'role = ?', 'active = ?'], vals = [str(b.name, 60) || u.name, role, active];
    let bump = role !== u.role || active !== u.active;
    if (b.password) {
      if (str(b.password, 200).length < 8) return bad('Password needs at least 8 characters.');
      const salt = crypto.randomUUID();
      sets.push('salt = ?', 'hash = ?'); vals.push(salt, await hashPassword(env, str(b.password, 200), salt)); bump = true;
    }
    if (bump) sets.push('ver = ver + 1'); // পুরনো লগইন বাতিল
    await D.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    await audit(env, me, 'EDIT', 'users', u.username, `${u.role}→${role}${active ? '' : ', turned off'}${b.password ? ', new password' : ''}`);
    return json({ ok: true });
  }
  if (m === 'DELETE') {
    if (u.role === 'super' && (await supers()) <= 1 && me.id !== 0) return bad('Keep at least one active super admin.');
    await D.prepare('UPDATE users SET active = 0, ver = ver + 1 WHERE id = ?').bind(id).run();
    await audit(env, me, 'DELETE', 'users', u.username, 'Turned off');
    return json({ ok: true });
  }
  return bad('Not allowed.', 405);
}

async function auditList(env, url) {
  const q = str(url.searchParams.get('q'), 60), who = str(url.searchParams.get('user'), 60), area = str(url.searchParams.get('area'), 30);
  const where = [], args = [];
  if (who) { where.push('user_name = ?'); args.push(who); }
  if (area) { where.push('area = ?'); args.push(area); }
  if (q) { where.push('(details LIKE ? OR ref LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = (await env.DB.prepare(`SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).bind(...args).all()).results;
  const users = (await env.DB.prepare('SELECT DISTINCT user_name FROM audit ORDER BY user_name').all()).results.map(r => r.user_name);
  return json({ rows, users });
}

// ================= v10: হিসাব (জমা-খরচ, অ্যাকাউন্ট, শেয়ারহোল্ডার) =================
// ক্যাটাগরির ধরন: in: revenue (বিক্রি), capital (শেয়ার মূলধন), loan (ঋণ নেওয়া), other_income
//                 out: expense (খরচ), stock (কাপড়/মাল কেনা), asset (মেশিন ইত্যাদি), payout (পার্টনারকে লাভ দেওয়া), loan_repay, courier (কুরিয়ার চার্জ)
const IN_KINDS = ['revenue', 'capital', 'loan', 'other_income'], OUT_KINDS = ['expense', 'stock', 'asset', 'payout', 'loan_repay', 'courier'];
async function seedAccounts(env) {
  const D = env.DB;
  const accs = [['Cash', 'cash'], ['bKash', 'bkash'], ['Nagad', 'nagad'], ['Bank', 'bank'], ['Courier (to receive)', 'courier']];
  const ins = [['Share Capital', 'capital'], ['Sales', 'revenue'], ['Loan Received', 'loan'], ['Others', 'other_income']];
  const outs = [['Fabric', 'stock'], ['Sutta/Button/Accessories', 'stock'], ['Sewing/Tailor Bill', 'expense'], ['Rong/Dye', 'expense'], ['Packaging', 'expense'],
    ['Transport', 'expense'], ['Rent', 'expense'], ['Utility Bill', 'expense'], ['Salary', 'expense'], ['Marketing', 'expense'], ['Machine', 'asset'],
    ['Courier charge', 'courier'], ['Profit paid to partner', 'payout'], ['Loan repayment', 'loan_repay'], ['Others', 'expense']];
  const partners = ['Basir', 'Tamim', 'Soaib', 'Faruk', 'Noman'];
  await D.batch([
    ...accs.map((a, i) => D.prepare('INSERT INTO acc_accounts (name, kind, sort) VALUES (?,?,?)').bind(a[0], a[1], i)),
    ...ins.map((c, i) => D.prepare("INSERT INTO acc_categories (type, name, kind, sort) VALUES ('in',?,?,?)").bind(c[0], c[1], i)),
    ...outs.map((c, i) => D.prepare("INSERT INTO acc_categories (type, name, kind, sort) VALUES ('out',?,?,?)").bind(c[0], c[1], i)),
    ...partners.map((n, i) => D.prepare('INSERT INTO acc_partners (name, target, share_pct, sort) VALUES (?,?,?,?)').bind(n, 50000, 20, i))
  ]);
  // আগের "Profit & loss" পেজের খরচগুলো হিসাবের খাতায় আনা
  const old = (await D.prepare('SELECT * FROM expenses').all()).results;
  if (old.length) {
    const cash = (await D.prepare("SELECT id FROM acc_accounts WHERE kind = 'cash'").first()).id;
    for (const e of old) {
      const cat = await expenseCategory(env, e.category);
      await D.prepare("INSERT INTO acc_entries (day, type, category_id, amount, account_id, note, source, created_by) VALUES (?, 'out', ?, ?, ?, ?, 'manual', 'system')").bind(e.day, cat, e.amount, cash, e.note || '').run();
    }
  }
}
async function expenseCategory(env, name) {
  const n = str(name, 60) || 'Others';
  const c = await env.DB.prepare("SELECT id FROM acc_categories WHERE type = 'out' AND lower(name) = lower(?)").bind(n).first();
  if (c) return c.id;
  return (await env.DB.prepare("INSERT INTO acc_categories (type, name, kind, sort) VALUES ('out', ?, 'expense', 50)").bind(n).run()).meta.last_row_id;
}
async function accSettings(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'acc'").first();
  const v = row ? JSON.parse(row.value) : {};
  // old_until: এই তারিখ পর্যন্ত আগের Google Sheet-এর নিয়ম (বিক্রি − সব খরচ); পরে নতুন নিয়ম। সেট না থাকলে ২২ নভেম্বর ২০২৬।
  return { profit_rule: ['equal', 'capital', 'custom'].includes(v.profit_rule) ? v.profit_rule : 'equal', profit_basis: v.profit_basis === 'all' ? 'all' : 'delivered', start_day: v.start_day || '',
    old_until: 'old_until' in v ? v.old_until : '2026-11-22' };
}
const nextDay = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
// আগের নিয়ম, ঠিক Google Sheet-এর মতো: বিক্রি ও অন্য আয় − সব খরচ (কাপড়, মেশিন সহ; পার্টনারকে দেওয়া লাভ আর ঋণ শোধ বাদে)
async function oldRuleProfit(env, from, to) {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN e.type = 'in' AND c.kind IN ('revenue', 'other_income') THEN e.amount END), 0) AS inc,
      COALESCE(SUM(CASE WHEN e.type = 'out' AND c.kind IN ('expense', 'stock', 'asset', 'courier') THEN e.amount END), 0) AS out
    FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id WHERE e.day BETWEEN ? AND ?`).bind(from, to).first();
  return { income: r.inc, khoroch: r.out, net: r.inc - r.out };
}
// দুই নিয়ম মিলিয়ে লাভ: old_until পর্যন্ত আগের নিয়ম, তারপর নতুন নিয়ম
async function mixedProfit(env, from, to, basis) {
  const s = await accSettings(env), cut = s.old_until;
  let oldPart = null, newPart = null;
  if (cut && from <= cut) oldPart = { from, to: to < cut ? to : cut, ...(await oldRuleProfit(env, from, to < cut ? to : cut)) };
  const nf = cut && from <= cut ? nextDay(cut) : from;
  if (nf <= to) { const pr = await profitReport(env, nf, to, basis, true); newPart = { from: nf, to, net: pr.net, revenue: pr.revenue, margin: pr.margin, missing: pr.missingCost.length }; }
  const net = (oldPart ? oldPart.net : 0) + (newPart ? newPart.net : 0);
  const revenue = (oldPart ? oldPart.income : 0) + (newPart ? newPart.revenue : 0);
  return { net, revenue, margin: revenue ? Math.round(net / revenue * 1000) / 10 : 0, missing: newPart ? newPart.missing : 0, oldPart, newPart, cut };
}

// ডেলিভারি হলে বিক্রির টাকা নিজে থেকেই জমা: বিকাশে পেমেন্ট হলে বিকাশে, নইলে কুরিয়ারের কাছে পাওনা
async function postOrderSale(env, o) {
  const D = env.DB;
  const sales = await D.prepare("SELECT id FROM acc_categories WHERE type = 'in' AND kind = 'revenue' ORDER BY sort, id LIMIT 1").first();
  const kind = o.payment === 'bkash' || o.paid ? 'bkash' : 'courier';
  const acc = await D.prepare('SELECT id FROM acc_accounts WHERE kind = ? AND active = 1 ORDER BY sort, id LIMIT 1').bind(kind).first()
    || await D.prepare("SELECT id FROM acc_accounts WHERE kind = 'cash' ORDER BY sort, id LIMIT 1").first();
  if (!sales || !acc) return;
  const day = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  await D.prepare(`INSERT INTO acc_entries (day, type, category_id, amount, account_id, person, note, source, order_no, created_by)
    VALUES (?, 'in', ?, ?, ?, ?, ?, 'order', ?, 'website') ON CONFLICT DO NOTHING`).bind(day, sales.id, Math.max(0, o.total - (o.paid_amount || 0)), acc.id, o.name || '', 'Order ' + o.order_no, o.order_no).run();
}

async function accApi(req, env, parts, m, url, user) {
  const D = env.DB, [sub, idStr] = parts, id = int(idStr, 0);
  const superOnly = () => user.role !== 'super' ? bad('Only a super admin can change this.', 403) : null;
  if (sub === 'meta' && m === 'GET') return json(await accMeta(env));
  if (sub === 'overview' && m === 'GET') return json(await accOverview(env, url.searchParams.get('from'), url.searchParams.get('to')));
  if (sub === 'entries') {
    if (m === 'GET') return accEntries(env, url);
    if (m === 'POST') return saveEntry(req, env, 0, user);
    if (m === 'PUT' && id) return saveEntry(req, env, id, user);
    if (m === 'DELETE' && id) {
      if (!['super', 'admin'].includes(user.role)) return bad('Only an admin can delete entries.', 403);
      const e = await entryById(env, id);
      if (!e) return bad('Entry not found.', 404);
      await D.prepare('DELETE FROM acc_entries WHERE id = ?').bind(id).run();
      await audit(env, user, 'DELETE', 'acc', 'TX-' + id, describeEntry(e));
      return json({ ok: true });
    }
  }
  if (sub === 'partner' && m === 'GET' && id) return partnerStatement(env, id);
  if (sub === 'settle' && m === 'POST') return courierSettle(req, env, user);
  // নিচের সব শুধু সুপার অ্যাডমিন
  if (m !== 'GET') { const no = superOnly(); if (no) return no; }
  if (sub === 'settings' && m === 'PUT') {
    const b = await readJson(req) || {}, old = await accSettings(env);
    const v = { profit_rule: ['equal', 'capital', 'custom'].includes(b.profit_rule) ? b.profit_rule : old.profit_rule, profit_basis: b.profit_basis === 'all' ? 'all' : 'delivered', start_day: /^\d{4}-\d{2}-\d{2}$/.test(b.start_day || '') ? b.start_day : '',
      old_until: /^\d{4}-\d{2}-\d{2}$/.test(b.old_until || '') ? b.old_until : '' };
    await D.prepare("INSERT INTO settings (key, value) VALUES ('acc', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(v)).run();
    await audit(env, user, 'EDIT', 'acc', 'settings', `Profit rule ${old.profit_rule}→${v.profit_rule}, basis ${v.profit_basis}, old rule until ${v.old_until || 'none'}`);
    return json(v);
  }
  if (sub === 'partners' && (m === 'POST' || m === 'PUT')) return savePartner(req, env, id, user);
  if (sub === 'targets' && m === 'PUT') { // সবার টার্গেট একসাথে
    const b = await readJson(req) || {}, target = Math.max(0, int(b.target));
    if (!target) return bad('Enter the new target.');
    const list = (await D.prepare('SELECT id, target FROM acc_partners WHERE active = 1').all()).results;
    const ops = list.filter(p => p.target !== target).flatMap(p => [D.prepare('UPDATE acc_partners SET target = ? WHERE id = ?').bind(target, p.id),
      D.prepare('INSERT INTO acc_target_log (partner_id, old_target, new_target, note, by_name) VALUES (?,?,?,?,?)').bind(p.id, p.target, target, str(b.note, 200), user.name)]);
    if (ops.length) await D.batch(ops);
    await audit(env, user, 'EDIT', 'acc', 'targets', `All targets → ${target}${b.note ? ' (' + str(b.note, 200) + ')' : ''}`);
    return json({ ok: true });
  }
  if (sub === 'accounts' && (m === 'POST' || m === 'PUT')) {
    const b = await readJson(req) || {};
    const f = [str(b.name, 60), ['cash', 'bkash', 'nagad', 'bank', 'courier', 'other'].includes(b.kind) ? b.kind : 'other', int(b.opening), b.active === false ? 0 : 1, int(b.sort)];
    if (!f[0]) return bad('Write the account name.');
    if (id) await D.prepare('UPDATE acc_accounts SET name=?, kind=?, opening=?, active=?, sort=? WHERE id=?').bind(...f, id).run();
    else await D.prepare('INSERT INTO acc_accounts (name, kind, opening, active, sort) VALUES (?,?,?,?,?)').bind(...f).run();
    await audit(env, user, id ? 'EDIT' : 'ADD', 'acc', 'account', `${f[0]} (${f[1]}), opening ${f[2]}`);
    return json({ ok: true });
  }
  if (sub === 'categories' && (m === 'POST' || m === 'PUT')) {
    const b = await readJson(req) || {}, type = b.type === 'in' ? 'in' : 'out';
    const kinds = type === 'in' ? IN_KINDS : OUT_KINDS;
    const f = [type, str(b.name, 60), kinds.includes(b.kind) ? b.kind : kinds[0], b.active === false ? 0 : 1, int(b.sort)];
    if (!f[1]) return bad('Write the category name.');
    if (id) await D.prepare('UPDATE acc_categories SET type=?, name=?, kind=?, active=?, sort=? WHERE id=?').bind(...f, id).run();
    else await D.prepare('INSERT INTO acc_categories (type, name, kind, active, sort) VALUES (?,?,?,?,?)').bind(...f).run();
    await audit(env, user, id ? 'EDIT' : 'ADD', 'acc', 'category', `${f[1]} (${f[0]}, ${f[2]})`);
    return json({ ok: true });
  }
  if (sub === 'import' && m === 'POST') return importEntries(req, env, user);
  if (sub === 'reset' && m === 'POST') {
    // সব এন্ট্রি মুছে নতুন করে শুরু (শুধু সুপার অ্যাডমিন, "DELETE" লিখে নিশ্চিত করতে হয়)
    const b = await readJson(req) || {};
    if (b.confirm !== 'DELETE') return bad('Type DELETE to confirm.');
    const where = b.keep_orders ? "WHERE source != 'order'" : '';
    const atts = (await D.prepare(`SELECT attachment FROM acc_entries ${where ? where + " AND attachment != ''" : "WHERE attachment != ''"}`).all()).results.map(r => r.attachment).filter(Boolean);
    const n = (await D.prepare(`SELECT COUNT(*) AS n FROM acc_entries ${where}`).first()).n;
    const ops = [D.prepare(`DELETE FROM acc_entries ${where}`)];
    if (b.reset_opening) ops.push(D.prepare('UPDATE acc_accounts SET opening = 0'));
    if (b.reset_target_log) ops.push(D.prepare('DELETE FROM acc_target_log'));
    await D.batch(ops);
    for (const k of atts.slice(0, 500)) await env.IMAGES.delete(k);
    await audit(env, user, 'DELETE', 'acc', 'reset', `Deleted ${n} entries${b.keep_orders ? ' (kept website sales)' : ''}${b.reset_opening ? ', opening balances set to 0' : ''}${b.reset_target_log ? ', target history cleared' : ''}`);
    return json({ ok: true, deleted: n });
  }
  if (sub === 'backfill' && m === 'POST') {
    const list = (await D.prepare("SELECT * FROM orders WHERE status = 'delivered' AND order_no NOT IN (SELECT order_no FROM acc_entries WHERE order_no IS NOT NULL)").all()).results;
    for (const o of list) await postOrderSale(env, o);
    await audit(env, user, 'ADD', 'acc', 'backfill', `${list.length} delivered orders posted as sales`);
    return json({ ok: true, posted: list.length });
  }
  return bad('Not found.', 404);
}

async function accMeta(env) {
  const D = env.DB;
  const [a, c, p, s] = await Promise.all([
    D.prepare('SELECT * FROM acc_accounts ORDER BY sort, id').all(), D.prepare('SELECT * FROM acc_categories ORDER BY type, sort, id').all(),
    D.prepare('SELECT * FROM acc_partners ORDER BY sort, id').all(), accSettings(env)]);
  return { accounts: a.results, categories: c.results, partners: p.results, settings: s, inKinds: IN_KINDS, outKinds: OUT_KINDS };
}
async function entryById(env, id) {
  return env.DB.prepare(`SELECT e.*, c.name AS category, c.kind, a.name AS account, t.name AS to_account, p.name AS partner FROM acc_entries e
    LEFT JOIN acc_categories c ON c.id = e.category_id LEFT JOIN acc_accounts a ON a.id = e.account_id LEFT JOIN acc_accounts t ON t.id = e.to_account_id
    LEFT JOIN acc_partners p ON p.id = e.partner_id WHERE e.id = ?`).bind(id).first();
}
const describeEntry = e => [e.day, e.type === 'in' ? 'Joma' : e.type === 'out' ? 'Khoroch' : 'Transfer', e.type === 'transfer' ? `${e.account} → ${e.to_account}` : `${e.category || ''}${e.partner ? ' (' + e.partner + ')' : ''}`, e.amount + ' tk', e.type === 'transfer' ? '' : e.account, e.note || ''].filter(Boolean).join(' | ');

async function saveEntry(req, env, id, user) {
  const D = env.DB, b = await readJson(req) || {};
  const type = ['in', 'out', 'transfer'].includes(b.type) ? b.type : '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : '';
  const amount = Math.round(Number(b.amount) || 0);
  if (!type) return bad('Choose Joma, Khoroch or Transfer.');
  if (!day) return bad('Choose the date.');
  if (amount <= 0) return bad('The amount must be more than 0.');
  const acc = await D.prepare('SELECT id FROM acc_accounts WHERE id = ?').bind(int(b.account_id)).first();
  if (!acc) return bad('Choose the account (Cash, bKash…).');
  let cat = null, to = null, partner = null;
  if (type === 'transfer') {
    to = await D.prepare('SELECT id FROM acc_accounts WHERE id = ?').bind(int(b.to_account_id)).first();
    if (!to || to.id === acc.id) return bad('Choose a different account to move the money to.');
  } else {
    cat = await D.prepare('SELECT * FROM acc_categories WHERE id = ? AND type = ?').bind(int(b.category_id), type).first();
    if (!cat) return bad('Choose the category.');
    if (cat.kind === 'capital' || cat.kind === 'payout') {
      partner = await D.prepare('SELECT id FROM acc_partners WHERE id = ?').bind(int(b.partner_id)).first();
      if (!partner) return bad('Choose the shareholder.');
    }
  }
  const before = id ? await entryById(env, id) : null;
  if (id && !before) return bad('Entry not found.', 404);
  if (before && before.source === 'order' && user.role !== 'super') return bad('This entry comes from a website order. Change the order instead.');
  const attachment = imgKey(b.attachment);
  const vals = [day, type, cat ? cat.id : null, amount, acc.id, to ? to.id : null, partner ? partner.id : null, str(b.person, 80), str(b.ref, 60), str(b.note, 300), attachment];
  let newId = id;
  if (id) {
    await D.prepare('UPDATE acc_entries SET day=?, type=?, category_id=?, amount=?, account_id=?, to_account_id=?, partner_id=?, person=?, ref=?, note=?, attachment=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(...vals, user.name, id).run();
    if (before.attachment && before.attachment !== attachment) await env.IMAGES.delete(before.attachment);
  } else {
    newId = (await D.prepare('INSERT INTO acc_entries (day, type, category_id, amount, account_id, to_account_id, partner_id, person, ref, note, attachment, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(...vals, user.name).run()).meta.last_row_id;
  }
  const after = await entryById(env, newId);
  await audit(env, user, id ? 'EDIT' : 'ADD', 'acc', 'TX-' + newId, id ? `Before: ${describeEntry(before)}  →  After: ${describeEntry(after)}` : describeEntry(after));
  return json({ ok: true, id: newId });
}

async function accEntries(env, url) {
  const g = k => str(url.searchParams.get(k), 80);
  const where = [], args = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(g('from'))) { where.push('e.day >= ?'); args.push(g('from')); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(g('to'))) { where.push('e.day <= ?'); args.push(g('to')); }
  if (['in', 'out', 'transfer'].includes(g('type'))) { where.push('e.type = ?'); args.push(g('type')); }
  if (int(g('category'))) { where.push('e.category_id = ?'); args.push(int(g('category'))); }
  if (int(g('account'))) { where.push('(e.account_id = ? OR e.to_account_id = ?)'); args.push(int(g('account')), int(g('account'))); }
  if (int(g('partner'))) { where.push('e.partner_id = ?'); args.push(int(g('partner'))); }
  if (g('source')) { where.push('e.source = ?'); args.push(g('source')); }
  if (g('q')) { where.push("(e.note LIKE ? OR e.person LIKE ? OR e.ref LIKE ? OR e.order_no LIKE ? OR ('TX-' || e.id) = ?)"); const q = `%${g('q')}%`; args.push(q, q, q, q, g('q').toUpperCase()); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows, tot] = await Promise.all([
    env.DB.prepare(`SELECT e.*, c.name AS category, c.kind, a.name AS account, t.name AS to_account, p.name AS partner FROM acc_entries e
      LEFT JOIN acc_categories c ON c.id = e.category_id LEFT JOIN acc_accounts a ON a.id = e.account_id LEFT JOIN acc_accounts t ON t.id = e.to_account_id
      LEFT JOIN acc_partners p ON p.id = e.partner_id ${W} ORDER BY e.day DESC, e.id DESC LIMIT ${g('all') === '1' ? 20000 : 500}`).bind(...args).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN type = 'in' THEN amount END), 0) AS inn, COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS outt FROM acc_entries e ${W}`).bind(...args).first()
  ]);
  return json({ rows: rows.results, total: tot.n, sumIn: tot.inn, sumOut: tot.outt });
}

// প্রতিটি অ্যাকাউন্টে এখন কত টাকা
async function balances(env) {
  const D = env.DB;
  const [accs, sums] = await Promise.all([
    D.prepare('SELECT * FROM acc_accounts ORDER BY sort, id').all(),
    D.prepare(`SELECT account_id AS id, SUM(CASE WHEN type = 'in' THEN amount WHEN type IN ('out', 'transfer') THEN -amount END) AS v FROM acc_entries GROUP BY account_id
      UNION ALL SELECT to_account_id AS id, SUM(amount) AS v FROM acc_entries WHERE type = 'transfer' GROUP BY to_account_id`).all()
  ]);
  const by = {};
  sums.results.forEach(r => { if (r.id != null) by[r.id] = (by[r.id] || 0) + (r.v || 0); });
  return accs.results.map(a => ({ ...a, balance: (a.opening || 0) + (by[a.id] || 0) }));
}

async function partnersSummary(env) {
  const D = env.DB, s = await accSettings(env);
  const [ps, cap, pay] = await Promise.all([
    D.prepare('SELECT * FROM acc_partners WHERE active = 1 ORDER BY sort, id').all(),
    D.prepare("SELECT e.partner_id AS id, SUM(e.amount) AS v FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id WHERE c.kind = 'capital' GROUP BY e.partner_id").all(),
    D.prepare("SELECT e.partner_id AS id, SUM(e.amount) AS v FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id WHERE c.kind = 'payout' GROUP BY e.partner_id").all()
  ]);
  const capBy = Object.fromEntries(cap.results.map(r => [r.id, r.v])), payBy = Object.fromEntries(pay.results.map(r => [r.id, r.v]));
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const pr = await mixedProfit(env, s.start_day || '2000-01-01', today, s.profit_basis);
  const list = ps.results.map(p => ({ ...p, paid: capBy[p.id] || 0, taken: payBy[p.id] || 0 }));
  const capTotal = list.reduce((t, p) => t + p.paid, 0), pctTotal = list.reduce((t, p) => t + (p.share_pct || 0), 0);
  list.forEach(p => {
    p.ratio = s.profit_rule === 'capital' ? (capTotal ? p.paid / capTotal : 0) : s.profit_rule === 'custom' ? (pctTotal ? (p.share_pct || 0) / pctTotal : 0) : (list.length ? 1 / list.length : 0);
    p.due = Math.max(0, p.target - p.paid);
    p.status = p.paid >= p.target && p.target > 0 ? 'Paid' : p.paid > 0 ? 'Partial' : 'Due';
    p.profitShare = Math.round(pr.net * p.ratio);
    p.balance = p.profitShare - p.taken;
  });
  return { partners: list, rule: s.profit_rule, basis: s.profit_basis, netProfit: pr.net, profitParts: { old: pr.oldPart, new: pr.newPart, cut: pr.cut }, capTarget: list.reduce((t, p) => t + p.target, 0), capPaid: capTotal };
}

async function accOverview(env, from, to) {
  const D = env.DB, ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  to = ok(to) ? to : today; from = ok(from) ? from : today.slice(0, 8) + '01';
  const y0 = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);
  const [bal, period, cats, months, recent, parts, pr] = await Promise.all([
    balances(env),
    D.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN amount END), 0) AS inn, COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS outt, COUNT(*) AS n FROM acc_entries WHERE day BETWEEN ? AND ?`).bind(from, to).first(),
    D.prepare(`SELECT c.name, c.kind, c.type, SUM(e.amount) AS v FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id WHERE e.day BETWEEN ? AND ? GROUP BY c.id ORDER BY v DESC`).bind(from, to).all(),
    D.prepare(`SELECT substr(day, 1, 7) AS m, COALESCE(SUM(CASE WHEN type = 'in' THEN amount END), 0) AS inn, COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS outt FROM acc_entries WHERE day > ? GROUP BY m ORDER BY m`).bind(y0).all(),
    D.prepare(`SELECT e.*, c.name AS category, c.kind, a.name AS account, t.name AS to_account, p.name AS partner FROM acc_entries e LEFT JOIN acc_categories c ON c.id = e.category_id
      LEFT JOIN acc_accounts a ON a.id = e.account_id LEFT JOIN acc_accounts t ON t.id = e.to_account_id LEFT JOIN acc_partners p ON p.id = e.partner_id ORDER BY e.day DESC, e.id DESC LIMIT 10`).all(),
    partnersSummary(env),
    mixedProfit(env, from, to, 'all')
  ]);
  const stockBought = cats.results.filter(c => c.kind === 'stock').reduce((t, c) => t + c.v, 0);
  return { from, to, accounts: bal, cashNow: bal.filter(a => a.kind !== 'courier' && a.active).reduce((t, a) => t + a.balance, 0),
    courierDue: bal.filter(a => a.kind === 'courier').reduce((t, a) => t + a.balance, 0),
    periodIn: period.inn, periodOut: period.outt, entries: period.n, categories: cats.results, months: months.results, recent: recent.results,
    stockBought, profit: { net: pr.net, revenue: pr.revenue, margin: pr.margin, missing: pr.missing, old: pr.oldPart, new: pr.newPart, cut: pr.cut }, ...parts };
}

async function partnerStatement(env, id) {
  const D = env.DB;
  const p = await D.prepare('SELECT * FROM acc_partners WHERE id = ?').bind(id).first();
  if (!p) return bad('Not found.', 404);
  const [rows, log, sum] = await Promise.all([
    D.prepare(`SELECT e.*, c.name AS category, c.kind, a.name AS account FROM acc_entries e JOIN acc_categories c ON c.id = e.category_id LEFT JOIN acc_accounts a ON a.id = e.account_id
      WHERE e.partner_id = ? ORDER BY e.day, e.id`).bind(id).all(),
    D.prepare('SELECT * FROM acc_target_log WHERE partner_id = ? ORDER BY id').bind(id).all(),
    partnersSummary(env)
  ]);
  return json({ partner: sum.partners.find(x => x.id === id) || { ...p, paid: 0, taken: 0 }, rule: sum.rule, netProfit: sum.netProfit, profitParts: sum.profitParts, entries: rows.results, targetLog: log.results });
}

async function savePartner(req, env, id, user) {
  const D = env.DB, b = await readJson(req) || {};
  const name = str(b.name, 60);
  if (!name) return bad('Write the shareholder’s name.');
  const old = id ? await D.prepare('SELECT * FROM acc_partners WHERE id = ?').bind(id).first() : null;
  if (id && !old) return bad('Not found.', 404);
  // যে ঘর পাঠানো হয়নি সেটা আগের মতোই থাকে
  const target = b.target == null || b.target === '' ? (old ? old.target : 0) : Math.max(0, int(b.target));
  const pct = b.share_pct == null || b.share_pct === '' ? (old ? old.share_pct : 0) : Math.max(0, Math.min(100, Number(b.share_pct) || 0));
  if (id) {
    const ops = [D.prepare('UPDATE acc_partners SET name=?, phone=?, target=?, share_pct=?, active=?, sort=? WHERE id=?').bind(name, b.phone == null ? old.phone : str(b.phone, 20), target, pct, b.active === false ? 0 : 1, b.sort == null ? old.sort : int(b.sort), id)];
    if (old.target !== target) ops.push(D.prepare('INSERT INTO acc_target_log (partner_id, old_target, new_target, note, by_name) VALUES (?,?,?,?,?)').bind(id, old.target, target, str(b.note, 200), user.name));
    await D.batch(ops);
    await audit(env, user, 'EDIT', 'acc', 'partner', `${name}${old.target !== target ? `: target ${old.target}→${target}` : ''}${old.share_pct !== pct ? `, share ${old.share_pct}%→${pct}%` : ''}`);
  } else {
    const r = await D.prepare('INSERT INTO acc_partners (name, phone, target, share_pct, sort) VALUES (?,?,?,?,?)').bind(name, str(b.phone, 20), target, pct, int(b.sort)).run();
    await D.prepare('INSERT INTO acc_target_log (partner_id, old_target, new_target, note, by_name) VALUES (?,0,?,?,?)').bind(r.meta.last_row_id, target, 'New shareholder', user.name).run();
    await audit(env, user, 'ADD', 'acc', 'partner', `${name}, target ${target}`);
  }
  return json({ ok: true });
}

// কুরিয়ার টাকা পাঠালে: কুরিয়ারের পাওনা থেকে ব্যাংক/বিকাশে, আর তাদের চার্জ খরচ হিসেবে
async function courierSettle(req, env, user) {
  const D = env.DB, b = await readJson(req) || {};
  const received = Math.round(Number(b.received) || 0), charge = Math.round(Number(b.charge) || 0);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const courier = await D.prepare("SELECT id FROM acc_accounts WHERE kind = 'courier' ORDER BY sort, id LIMIT 1").first();
  const to = await D.prepare('SELECT id FROM acc_accounts WHERE id = ?').bind(int(b.to_account_id)).first();
  if (!courier || !to || to.id === courier.id) return bad('Choose where the money came in.');
  if (received <= 0 && charge <= 0) return bad('Enter the amount received.');
  const ops = [];
  if (received > 0) ops.push(D.prepare("INSERT INTO acc_entries (day, type, amount, account_id, to_account_id, ref, note, created_by) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)")
    .bind(day, received, courier.id, to.id, str(b.ref, 60), 'Courier payment ' + str(b.note, 200), user.name));
  if (charge > 0) {
    const cat = await D.prepare("SELECT id FROM acc_categories WHERE type = 'out' AND kind = 'courier' ORDER BY sort, id LIMIT 1").first();
    ops.push(D.prepare("INSERT INTO acc_entries (day, type, category_id, amount, account_id, ref, note, created_by) VALUES (?, 'out', ?, ?, ?, ?, ?, ?)")
      .bind(day, cat ? cat.id : null, charge, courier.id, str(b.ref, 60), 'Courier charges ' + str(b.note, 200), user.name));
  }
  await D.batch(ops);
  await audit(env, user, 'ADD', 'acc', 'courier', `Received ${received}, charges ${charge}`);
  return json({ ok: true });
}

// Google Sheet থেকে আনা: Entries শিটের CSV
async function importEntries(req, env, user) {
  const D = env.DB, b = await readJson(req) || {};
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
  const meta = await accMeta(env);
  const accBy = n => meta.accounts.find(a => a.name.toLowerCase() === String(n || '').trim().toLowerCase() || a.kind === String(n || '').trim().toLowerCase());
  const guessKind = (type, name) => {
    const n = name.toLowerCase();
    if (type === 'in') return /capital/.test(n) ? 'capital' : /sale/.test(n) ? 'revenue' : /loan/.test(n) ? 'loan' : 'other_income';
    return /fabric|kapor|sutta|button|accessor/.test(n) ? 'stock' : /machine/.test(n) ? 'asset' : /profit|dividend/.test(n) ? 'payout' : /loan/.test(n) ? 'loan_repay' : 'expense';
  };
  let added = 0, skipped = 0;
  const errors = [];
  for (const [i, r] of rows.entries()) {
    const type = /^joma|^in/i.test(r.type) ? 'in' : /^khoroch|^out/i.test(r.type) ? 'out' : '';
    const day = String(r.date || '').slice(0, 10), amount = Math.round(Number(String(r.amount || '').replace(/[^0-9.]/g, '')) || 0);
    if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(day) || amount <= 0) { errors.push(`Row ${i + 2}: missing type, date or amount`); continue; }
    let catName = str(r.category, 60) || 'Others';
    if (/^capital$/i.test(catName)) catName = 'Share Capital'; // আগের "Capital" আর "Share Capital" এক করা
    let cat = meta.categories.find(c => c.type === type && c.name.toLowerCase() === catName.toLowerCase());
    if (!cat) {
      const kind = guessKind(type, catName);
      const nid = (await D.prepare('INSERT INTO acc_categories (type, name, kind, sort) VALUES (?,?,?,60)').bind(type, catName, kind).run()).meta.last_row_id;
      cat = { id: nid, type, name: catName, kind }; meta.categories.push(cat);
    }
    let acc = accBy(r.method) || accBy('cash');
    let partner = null;
    if (cat.kind === 'capital' || cat.kind === 'payout') {
      const pn = str(r.shareholder || r.person, 60);
      partner = meta.partners.find(p => p.name.toLowerCase() === pn.toLowerCase());
      if (!partner && pn) {
        const nid = (await D.prepare('INSERT INTO acc_partners (name, target) VALUES (?, 50000)').bind(pn).run()).meta.last_row_id;
        partner = { id: nid, name: pn }; meta.partners.push(partner);
      }
    }
    const res = await D.prepare(`INSERT INTO acc_entries (day, type, category_id, amount, account_id, partner_id, person, ref, note, source, import_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?, 'import', ?, ?) ON CONFLICT DO NOTHING`).bind(day, type, cat.id, amount, acc.id, partner ? partner.id : null, str(r.person, 80), str(r.ref, 60),
      [str(r.description, 200), str(r.note, 100)].filter(Boolean).join(' · '), r.id ? 'sheet:' + str(r.id, 40) : `sheet:${day}:${amount}:${i}`, str(r.createdBy, 40) || user.name).run();
    if (res.meta.changes) added++; else skipped++;
  }
  await audit(env, user, 'ADD', 'acc', 'import', `Imported ${added}, skipped ${skipped} already there, ${errors.length} with errors`);
  return json({ ok: true, added, skipped, errors: errors.slice(0, 20) });
}


// ================= v11: দোকানের বিক্রি, বাকি, সেলস রিপোর্ট =================
const CHANNELS = { website: 'Website', shop: 'Shop', facebook: 'Facebook', whatsapp: 'WhatsApp', phone: 'Phone', other: 'Other' };
const bdNow = () => new Date(Date.now() + 6 * 3600e3);
async function salesMeta(env) {
  const D = env.DB;
  const [prods, sizes, accs] = await Promise.all([
    D.prepare('SELECT id, code, name_en, color_en, color_hex, price, cost, images FROM products WHERE active = 1 ORDER BY sort, id').all(),
    D.prepare('SELECT s.id, s.product_id, s.label, s.stock FROM product_sizes s JOIN products p ON p.id = s.product_id WHERE p.active = 1 ORDER BY s.sort, s.id').all(),
    D.prepare("SELECT id, name, kind FROM acc_accounts WHERE active = 1 AND kind != 'courier' ORDER BY sort, id").all()
  ]);
  const by = {};
  sizes.results.forEach(z => (by[z.product_id] = by[z.product_id] || []).push({ id: z.id, label: z.label, stock: z.stock }));
  return { channels: CHANNELS, accounts: accs.results,
    products: prods.results.map(p => ({ id: p.id, code: p.code, name: p.name_en, color: p.color_en, hex: p.color_hex, price: p.price, image: imgs(p.images)[0] ? '/img/' + imgs(p.images)[0] : '', sizes: by[p.id] || [] })) };
}

// দোকান/ফেসবুক/হোয়াটসঅ্যাপের বিক্রি: অর্ডার হিসেবেই রাখা হয়, তাই রিপোর্ট, কাস্টমার, স্টক, লাভ সব এক জায়গায়
async function createSale(req, env, user, ctx) {
  const D = env.DB, b = await readJson(req) || {};
  const channel = CHANNELS[b.channel] && b.channel !== 'website' ? b.channel : 'shop';
  const mode = b.delivery_mode === 'courier' ? 'courier' : 'handover';
  const name = str(b.name, 100) || 'Walk-in customer', phone = str(b.phone, 20).replace(/[\s-]/g, '');
  if (phone && !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone)) return bad('Mobile number looks wrong. Leave it empty for a walk-in customer.');
  if (mode === 'courier' && (!phone || str(b.address, 500).length < 5)) return bad('For courier delivery, add the mobile number and address.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : bdNow().toISOString().slice(0, 10);
  const raw = (Array.isArray(b.items) ? b.items : []).slice(0, 40);
  if (!raw.length) return bad('Add at least one item.');
  const sizeIds = raw.filter(i => i.sizeId).map(i => int(i.sizeId));
  const rows = sizeIds.length ? (await D.prepare(`SELECT s.id, s.label, s.stock, p.id AS pid, p.code, p.name_en, p.color_en, p.price, p.cost FROM product_sizes s JOIN products p ON p.id = s.product_id
    WHERE s.id IN (${sizeIds.map(() => '?').join(',')})`).bind(...sizeIds).all()).results : [];
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const lines = [];
  for (const i of raw) {
    const qty = Math.min(50, Math.max(1, int(i.qty, 1)));
    if (i.sizeId) {
      const r = byId[int(i.sizeId)];
      if (!r) return bad('A product in the sale was not found.');
      if (r.stock < qty && !b.allow_negative) return bad(`${r.name_en} ${r.label}: only ${r.stock} in stock.`);
      lines.push({ sizeId: r.id, productId: r.pid, code: r.code, name: r.name_en, color: r.color_en, size: r.label, qty, price: Math.max(0, int(i.price, r.price)), cost: r.cost == null ? null : r.cost });
    } else {
      const nm = str(i.name, 100);
      if (!nm) continue;
      lines.push({ code: 'OTHER', name: nm, color: '', size: str(i.size, 30) || '-', qty, price: Math.max(0, int(i.price)), cost: i.cost === '' || i.cost == null ? null : Math.max(0, int(i.cost)), other: true });
    }
  }
  if (!lines.length) return bad('Add at least one item.');
  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const delivery = Math.max(0, int(b.delivery)), discount = Math.min(subtotal, Math.max(0, int(b.discount)));
  const total = subtotal + delivery - discount;
  const pays = (Array.isArray(b.payments) ? b.payments : []).map(p => ({ account_id: int(p.account_id), amount: Math.max(0, int(p.amount)) })).filter(p => p.amount > 0);
  const paid = pays.reduce((t, p) => t + p.amount, 0);
  if (paid > total) return bad('Payment is more than the total.');
  const accIds = new Set((await D.prepare('SELECT id FROM acc_accounts').all()).results.map(a => a.id));
  if (pays.some(p => !accIds.has(p.account_id))) return bad('Choose where the money came in.');
  // স্টক কমানো
  const st = lines.filter(l => l.sizeId);
  if (st.length) {
    const res = await D.batch(st.map(l => D.prepare(`UPDATE product_sizes SET stock = stock - ? WHERE id = ?${b.allow_negative ? '' : ' AND stock >= ?'}`).bind(...(b.allow_negative ? [l.qty, l.sizeId] : [l.qty, l.sizeId, l.qty]))));
    if (res.some(r => !r.meta.changes)) {
      const undo = st.filter((l, i) => res[i].meta.changes).map(l => D.prepare('UPDATE product_sizes SET stock = stock + ? WHERE id = ?').bind(l.qty, l.sizeId));
      if (undo.length) await D.batch(undo);
      return bad('Some items just ran out of stock. Check the sizes.');
    }
  }
  const orderNo = 'AH' + day.slice(2).replace(/-/g, '') + String(Math.floor(Math.random() * 9000) + 1000);
  const payKinds = pays.length ? (await D.prepare(`SELECT id, kind FROM acc_accounts WHERE id IN (${pays.map(() => '?').join(',')})`).bind(...pays.map(p => p.account_id)).all()).results : [];
  const payment = paid >= total && payKinds.every(a => a.kind === 'bkash' || a.kind === 'nagad') && payKinds.length ? 'bkash' : 'cod';
  const created = `${day} ${bdNow().toISOString().slice(11, 19)}`;
  const createdUtc = new Date(Date.parse(created.replace(' ', 'T') + 'Z') - 6 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  await D.prepare(`INSERT INTO orders (order_no, created_at, name, phone, address, area, payment, trx, note, items, subtotal, delivery, total, status, lang, discount, channel, delivery_mode, paid_amount, sold_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'en',?,?,?,?,?)`).bind(orderNo, createdUtc, name, phone, str(b.address, 500), b.area === 'outside' ? 'outside' : 'inside', payment, str(b.trx, 40), str(b.note, 500),
    JSON.stringify(lines), subtotal, delivery, total, mode === 'handover' ? 'delivered' : 'confirmed', discount, channel, mode, paid, str(b.sold_by, 60) || user.name).run();
  // পাওয়া টাকা হিসাবে জমা (লাভে দুবার গোনা হয় না, কারণ বিক্রি অর্ডার থেকেই গোনা হয়)
  const salesCat = await D.prepare("SELECT id FROM acc_categories WHERE type = 'in' AND kind = 'revenue' ORDER BY sort, id LIMIT 1").first();
  if (pays.length) await D.batch(pays.map(p => D.prepare(`INSERT INTO acc_entries (day, type, category_id, amount, account_id, person, ref, note, source, created_by) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'order', ?)`)
    .bind(day, salesCat ? salesCat.id : null, p.amount, p.account_id, name, orderNo, `${CHANNELS[channel]} sale ${orderNo}`, user.name)));
  await audit(env, user, 'ADD', 'sales', orderNo, `${CHANNELS[channel]} sale, ${lines.map(l => `${l.name} ${l.size} ×${l.qty}`).join(', ')}, total ${total}, paid ${paid}${total > paid ? ', due ' + (total - paid) : ''}`);
  if (phone) await D.prepare("UPDATE abandoned SET status = 'recovered' WHERE phone = ?").bind(phone.replace(/\D/g, '').slice(-11)).run();
  return json({ ok: true, orderNo, total, paid, due: total - paid });
}

async function collectDue(req, env, id, user) {
  const D = env.DB, b = await readJson(req) || {};
  const o = await D.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  const due = o.total - (o.paid_amount || 0), amount = Math.max(0, int(b.amount));
  if (amount <= 0) return bad('Enter the amount received.');
  if (amount > due) return bad(`Only ${due} is due.`);
  const acc = await D.prepare('SELECT id FROM acc_accounts WHERE id = ?').bind(int(b.account_id)).first();
  if (!acc) return bad('Choose where the money came in.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : bdNow().toISOString().slice(0, 10);
  const salesCat = await D.prepare("SELECT id FROM acc_categories WHERE type = 'in' AND kind = 'revenue' ORDER BY sort, id LIMIT 1").first();
  await D.batch([
    D.prepare('UPDATE orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(amount, id),
    D.prepare(`INSERT INTO acc_entries (day, type, category_id, amount, account_id, person, ref, note, source, created_by) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'order', ?)`)
      .bind(day, salesCat ? salesCat.id : null, amount, acc.id, o.name || '', o.order_no, 'Due collected ' + o.order_no, user.name)
  ]);
  await audit(env, user, 'ADD', 'sales', o.order_no, `Due collected ${amount}, still due ${due - amount}`);
  return json({ ok: true, due: due - amount });
}

// সুপার/অ্যাডমিন অর্ডারের সব কিছু বদলাতে পারে: কাস্টমার, ঠিকানা, পণ্য, দাম, ডেলিভারি, ছাড়
async function editOrder(req, env, id, user) {
  if (!['super', 'admin'].includes(user.role)) return bad('Only an admin can edit an order.', 403);
  const D = env.DB, b = await readJson(req) || {};
  const o = await D.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) return bad('Order not found.', 404);
  const old = JSON.parse(o.items || '[]');
  const newItems = (Array.isArray(b.items) ? b.items : old).map((l, i) => {
    const base = old[i] || {};
    return { ...base, ...(l.name != null && !base.sizeId ? { name: str(l.name, 100) } : {}), qty: Math.max(0, int(l.qty, base.qty)), price: Math.max(0, int(l.price, base.price)) };
  }).filter(l => l.qty > 0);
  if (!newItems.length) return bad('An order needs at least one item. Delete the order instead.');
  // স্টকের পার্থক্য ঠিক করা (বাতিল অর্ডারে স্টক আগেই ফেরত গেছে)
  const ops = [];
  if (o.status !== 'cancelled') {
    const qtyOf = list => { const m = {}; list.filter(l => l.sizeId).forEach(l => { m[l.sizeId] = (m[l.sizeId] || 0) + l.qty; }); return m; };
    const a = qtyOf(old), c = qtyOf(newItems);
    new Set([...Object.keys(a), ...Object.keys(c)]).forEach(k => { const diff = (c[k] || 0) - (a[k] || 0); if (diff) ops.push(D.prepare('UPDATE product_sizes SET stock = stock - ? WHERE id = ?').bind(diff, int(k))); });
  }
  const subtotal = newItems.reduce((t, l) => t + l.price * l.qty, 0);
  const delivery = b.delivery == null ? o.delivery : Math.max(0, int(b.delivery));
  const discount = b.discount == null ? (o.discount || 0) : Math.min(subtotal, Math.max(0, int(b.discount)));
  const total = Math.max(0, subtotal + delivery - discount - (o.bundle_off || 0));
  const phone = b.phone == null ? o.phone : str(b.phone, 20).replace(/[\s-]/g, '');
  if (phone && !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone)) return bad('Mobile number looks wrong.');
  const created = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') && b.day !== o.created_at.slice(0, 10) ? b.day + o.created_at.slice(10) : o.created_at;
  ops.push(D.prepare(`UPDATE orders SET name=?, phone=?, address=?, area=?, note=?, items=?, subtotal=?, delivery=?, discount=?, total=?, channel=?, sold_by=?, created_at=? WHERE id=?`)
    .bind(str(b.name ?? o.name, 100), phone, str(b.address ?? o.address, 500), b.area === 'outside' ? 'outside' : b.area === 'inside' ? 'inside' : o.area, str(b.note ?? o.note, 500),
      JSON.stringify(newItems), subtotal, delivery, discount, total, CHANNELS[b.channel] ? b.channel : (o.channel || 'website'), str(b.sold_by ?? o.sold_by, 60), created, id));
  // হাতে হাতে বিক্রিতে "আসলে কত টাকা পেয়েছি" বদলানো: কমালে টাকার এন্ট্রি কমে/মুছে যায় (বাকি দেখায়), বাড়ালে নতুন জমা হয়
  let paidNote = '';
  if (b.paid_amount != null && b.paid_amount !== '' && (o.delivery_mode === 'handover' || o.channel !== 'website')) {
    const newPaid = Math.min(total, Math.max(0, int(b.paid_amount))), oldPaid = o.paid_amount || 0;
    if (newPaid < oldPaid) {
      let cut = oldPaid - newPaid;
      const ents = (await D.prepare("SELECT id, amount FROM acc_entries WHERE source = 'order' AND ref = ? ORDER BY id DESC").bind(o.order_no).all()).results;
      for (const e of ents) {
        if (cut <= 0) break;
        if (e.amount <= cut) { ops.push(D.prepare('DELETE FROM acc_entries WHERE id = ?').bind(e.id)); cut -= e.amount; }
        else { ops.push(D.prepare('UPDATE acc_entries SET amount = amount - ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(cut, user.name, e.id)); cut = 0; }
      }
    } else if (newPaid > oldPaid) {
      const acc = await D.prepare('SELECT id FROM acc_accounts WHERE id = ?').bind(int(b.pay_account_id)).first() || await D.prepare("SELECT id FROM acc_accounts WHERE kind = 'cash' ORDER BY sort, id LIMIT 1").first();
      const cat = await D.prepare("SELECT id FROM acc_categories WHERE type = 'in' AND kind = 'revenue' ORDER BY sort, id LIMIT 1").first();
      ops.push(D.prepare(`INSERT INTO acc_entries (day, type, category_id, amount, account_id, person, ref, note, source, created_by) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'order', ?)`)
        .bind(bdNow().toISOString().slice(0, 10), cat ? cat.id : null, newPaid - oldPaid, acc.id, o.name || '', o.order_no, 'Payment received ' + o.order_no, user.name));
    }
    if (newPaid !== oldPaid) {
      // বাকি হিসাবের জন্য এটাকে হাতে হাতে বিক্রি ধরা হয়
      ops.push(D.prepare("UPDATE orders SET paid_amount = ?, delivery_mode = 'handover' WHERE id = ?").bind(newPaid, id));
      // কুরিয়ারের পাওনা হিসেবে আগে বসে থাকলে সেটা সরানো, নইলে দুবার গোনা হবে
      if (o.delivery_mode !== 'handover') ops.push(D.prepare("DELETE FROM acc_entries WHERE order_no = ? AND source = 'order'").bind(o.order_no));
      paidNote = `; money received ${oldPaid} → ${newPaid}${total > newPaid ? ', due ' + (total - newPaid) : ''}`;
    }
  }
  // ডেলিভারির পর কুরিয়ারের পাওনার এন্ট্রিও নতুন মোট অনুযায়ী
  ops.push(D.prepare("UPDATE acc_entries SET amount = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE order_no = ? AND source = 'order'").bind(Math.max(0, total - (o.paid_amount || 0)), user.name, o.order_no));
  await D.batch(ops);
  await audit(env, user, 'EDIT', 'orders', o.order_no, `Before: ${old.map(l => `${l.name} ${l.size} ×${l.qty} @${l.price}`).join(', ')}; total ${o.total}  →  After: ${newItems.map(l => `${l.name} ${l.size} ×${l.qty} @${l.price}`).join(', ')}; total ${total}${paidNote}`);
  const fresh = await D.prepare('SELECT paid_amount FROM orders WHERE id = ?').bind(id).first();
  return json({ ok: true, total, due: Math.max(0, total - (fresh.paid_amount || 0)), refund: Math.max(0, (fresh.paid_amount || 0) - total) });
}

async function getGoals(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'goals'").first();
  return row ? JSON.parse(row.value) : { month_target: 0 };
}

// ---------- সেলস রিপোর্ট ----------
async function salesReport(env, url) {
  const D = env.DB, ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const today = bdNow().toISOString().slice(0, 10);
  const to = ok(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
  const from = ok(url.searchParams.get('from')) ? url.searchParams.get('from') : to.slice(0, 8) + '01';
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const pTo = new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10), pFrom = new Date(Date.parse(from) - days * 864e5).toISOString().slice(0, 10);
  const BD = "date(created_at, '+6 hours')";
  const [cur, prev, dueRows] = await Promise.all([
    D.prepare(`SELECT id, order_no, ${BD} AS day, CAST(strftime('%H', datetime(created_at, '+6 hours')) AS INTEGER) AS hr, CAST(strftime('%w', datetime(created_at, '+6 hours')) AS INTEGER) AS wd,
      name, phone, status, cancel_type, COALESCE(channel, 'website') AS channel, delivery_mode, payment, paid, paid_amount, sold_by, items, subtotal, delivery, discount, bundle_off, total FROM orders WHERE ${BD} BETWEEN ? AND ? LIMIT 20000`).bind(from, to).all(),
    D.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS rev FROM orders WHERE status != 'cancelled' AND ${BD} BETWEEN ? AND ?`).bind(pFrom, pTo).first(),
    D.prepare(`SELECT id, order_no, name, phone, total, paid_amount, ${BD} AS day FROM orders WHERE delivery_mode = 'handover' AND status != 'cancelled' AND total > paid_amount ORDER BY id`).all()
  ]);
  const t = { orders: 0, pieces: 0, revenue: 0, discount: 0, cancelled: 0, returned: 0, cancelledValue: 0 };
  const ch = {}, prod = {}, size = {}, color = {}, staff = {}, pay = {}, dayS = {}, cust = {}, hours = Array(24).fill(0), wdays = Array(7).fill(0);
  const add = (m, k, n, v) => { m[k] = m[k] || { key: k, n: 0, value: 0 }; m[k].n += n; m[k].value += v; };
  for (const o of cur.results) {
    if (o.status === 'cancelled') { if (o.cancel_type === 'returned') t.returned++; else t.cancelled++; t.cancelledValue += o.total; continue; }
    const items = JSON.parse(o.items || '[]'), pcs = items.reduce((s, l) => s + l.qty, 0);
    t.orders++; t.pieces += pcs; t.revenue += o.total; t.discount += (o.discount || 0) + (o.bundle_off || 0);
    add(ch, o.channel, 1, o.total);
    add(staff, o.channel === 'website' ? 'Website' : (o.sold_by || '—'), 1, o.total);
    add(pay, o.delivery_mode === 'handover' ? (o.paid_amount >= o.total ? 'Paid in full' : o.paid_amount > 0 ? 'Part paid' : 'Due') : o.payment === 'bkash' || o.paid ? 'bKash / online' : 'Cash on delivery', 1, o.total);
    add(dayS, o.day, 1, o.total);
    hours[o.hr] += 1; wdays[o.wd] += 1;
    if (o.phone) add(cust, String(o.phone).replace(/\D/g, '').slice(-11) + '|' + (o.name || ''), 1, o.total);
    items.forEach(l => {
      add(prod, (l.custom ? 'Custom thobe' : l.name) + '|' + (l.custom ? 'CUSTOM' : l.code) + '|' + (l.color || ''), l.qty, l.qty * l.price);
      if (!l.custom && l.size && l.size !== '-') add(size, l.size, l.qty, l.qty * l.price);
      if (l.color) add(color, l.color, l.qty, l.qty * l.price);
    });
  }
  const list = m => Object.values(m).sort((a, b) => b.value - a.value);
  const all = t.orders + t.cancelled + t.returned;
  return json({
    from, to, prevFrom: pFrom, prevTo: pTo, ...t, avg: t.orders ? Math.round(t.revenue / t.orders) : 0,
    cancelRate: all ? Math.round((t.cancelled + t.returned) / all * 1000) / 10 : 0,
    prev: { orders: prev.n, revenue: prev.rev },
    channels: list(ch).map(x => ({ ...x, label: CHANNELS[x.key] || x.key })), staff: list(staff), payments: list(pay),
    products: list(prod).map(x => { const [name, code, colour] = x.key.split('|'); return { name, code, color: colour, qty: x.n, value: x.value }; }),
    sizes: list(size), colors: list(color), daily: Object.values(dayS).sort((a, b) => a.key < b.key ? -1 : 1),
    topCustomers: list(cust).slice(0, 10).map(x => { const [phone, name] = x.key.split('|'); return { phone, name, orders: x.n, value: x.value }; }),
    hours, weekdays: wdays,
    due: { total: dueRows.results.reduce((s, r) => s + r.total - r.paid_amount, 0), list: dueRows.results.map(r => ({ ...r, due: r.total - r.paid_amount })) }
  });
}

// ড্যাশবোর্ডের নতুন অংশ: টার্গেট, আজকের বিক্রি চ্যানেল অনুযায়ী, বাকি, আগের মাসের তুলনা, সেরা কাস্টমার, আজকের ফলো-আপ
async function dashExtras(env) {
  const D = env.DB, BD = "date(created_at, '+6 hours')", now = bdNow(), today = now.toISOString().slice(0, 10);
  const m0 = today.slice(0, 8) + '01', dom = Number(today.slice(8, 10));
  const pm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const pmSame = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, Math.min(dom, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate()))).toISOString().slice(0, 10);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const [goals, todayCh, monthNow, monthPrev, due, topC, fu] = await Promise.all([
    getGoals(env),
    D.prepare(`SELECT COALESCE(channel, 'website') AS ch, COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status != 'cancelled' AND ${BD} = ? GROUP BY ch`).bind(today).all(),
    D.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status != 'cancelled' AND ${BD} BETWEEN ? AND ?`).bind(m0, today).first(),
    D.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status != 'cancelled' AND ${BD} BETWEEN ? AND ?`).bind(pm, pmSame).first(),
    D.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_amount), 0) AS v FROM orders WHERE delivery_mode = 'handover' AND status != 'cancelled' AND total > paid_amount").first(),
    D.prepare(`SELECT substr(phone, -11) AS phone, MAX(name) AS name, COUNT(*) AS n, SUM(total) AS v FROM orders WHERE status != 'cancelled' AND phone != '' AND ${BD} BETWEEN ? AND ? GROUP BY substr(phone, -11) ORDER BY v DESC LIMIT 5`).bind(m0, today).all(),
    D.prepare("SELECT n.phone, n.follow_up, n.follow_note, (SELECT MAX(name) FROM orders WHERE substr(phone, -11) = n.phone) AS name FROM customer_notes n WHERE n.follow_up != '' AND n.follow_up <= ? ORDER BY n.follow_up LIMIT 20").bind(today).all()
  ]);
  const pctChange = (a, b) => b ? Math.round((a - b) / b * 100) : null;
  return {
    goal: { target: goals.month_target || 0, sold: monthNow.v, daysLeft: daysInMonth - dom, perDay: goals.month_target > monthNow.v ? Math.ceil((goals.month_target - monthNow.v) / Math.max(1, daysInMonth - dom + 1)) : 0 },
    todayChannels: todayCh.results.map(r => ({ ...r, label: CHANNELS[r.ch] || r.ch })),
    mom: { orders: monthNow.n, revenue: monthNow.v, prevOrders: monthPrev.n, prevRevenue: monthPrev.v, ordersPct: pctChange(monthNow.n, monthPrev.n), revenuePct: pctChange(monthNow.v, monthPrev.v) },
    dueTotal: { n: due.n, v: due.v }, topCustomers: topC.results, followUps: fu.results
  };
}
