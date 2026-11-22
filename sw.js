// Al Hadaf service worker: অ্যাপের মতো ইনস্টল আর ইন্টারনেট না থাকলেও শেষ দেখা পেজ খোলে।
// পেজ আর কোড সবসময় আগে ইন্টারনেট থেকে নেয় (তাই নতুন আপডেট সাথে সাথে আসে); ছবি একবার নামলে মনে রাখে।
const SHELL = 'ah-shell-v1', IMGS = 'ah-img-v1';
const CORE = ['/', '/style.css', '/lang.js', '/app.js', '/thobe.js', '/logo-light.png', '/logo-dark.png', '/favicon.png', '/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMGS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // API, অ্যাডমিন আর পেমেন্ট কখনো ক্যাশ হয় না
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  if (url.pathname.startsWith('/img/')) {
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); c.keys().then(k => { if (k.length > 300) c.delete(k[0]); }); }
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok && (req.mode === 'navigate' || CORE.includes(url.pathname))) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then(r => r || caches.match('/'))));
});
