// ===== Al Hadaf: কাপড়ের ছবি থেকে রং বের করা আর নাম দেওয়া =====
// ছবির মাঝখানের অংশ থেকে আলো-ছায়া বাদ দিয়ে মূল রং বের হয়, তারপর CIEDE2000 (ΔE00) দিয়ে
// সবচেয়ে কাছের কাপড়ের রঙের নাম খোঁজা হয়।
(function (root) {
  'use strict';
  const PALETTE = [
    ['White', 'সাদা', '#FAFAF7', 'white'], ['Off-white', 'অফ-হোয়াইট', '#F1EEE4', 'white'], ['Ivory', 'আইভরি', '#EFE8D3', 'cream'],
    ['Cream', 'ক্রিম', '#E6D9BC', 'cream'], ['Beige', 'বেইজ', '#D6C3A0', 'cream'], ['Sand', 'বালু রং', '#C6AE86', 'cream'],
    ['Khaki', 'খাকি', '#B3A077', 'brown'], ['Camel', 'ক্যামেল', '#AE8858', 'brown'], ['Tan', 'ট্যান', '#9E7656', 'brown'],
    ['Rust', 'মরিচা রং', '#9C5130', 'brown'], ['Coffee', 'কফি', '#6B4C37', 'brown'], ['Chocolate', 'চকলেট', '#4C3427', 'brown'], ['Dark brown', 'গাঢ় বাদামি', '#36281F', 'brown'],
    ['Light grey', 'হালকা ছাই', '#D2D3D2', 'grey'], ['Silver grey', 'সিলভার গ্রে', '#B6B9BC', 'grey'], ['Ash grey', 'অ্যাশ গ্রে', '#9A9C9D', 'grey'],
    ['Grey', 'ছাই রং', '#7E8083', 'grey'], ['Steel grey', 'স্টিল গ্রে', '#687078', 'grey'], ['Charcoal', 'চারকোল', '#3C3E42', 'grey'],
    ['Black', 'কালো', '#161616', 'black'],
    ['Light blue', 'হালকা নীল', '#B5CDE2', 'blue'], ['Sky blue', 'আকাশি', '#8BB5DB', 'blue'], ['Powder blue', 'পাউডার ব্লু', '#9DB3C9', 'blue'],
    ['Denim', 'ডেনিম', '#587DA3', 'blue'], ['Royal blue', 'রয়্যাল ব্লু', '#2E4EA0', 'blue'], ['Navy', 'নেভি', '#1F2C4B', 'blue'], ['Midnight blue', 'মিডনাইট ব্লু', '#192132', 'blue'],
    ['Mint', 'মিন্ট', '#A6D3B8', 'green'], ['Sage', 'সেজ', '#9AAD86', 'green'], ['Olive', 'অলিভ', '#6A6A3B', 'green'], ['Forest green', 'বন সবুজ', '#445E3C', 'green'], ['Teal', 'টিল', '#2E7078', 'green'],
    ['Emerald', 'পান্না সবুজ', '#1E7853', 'green'], ['Bottle green', 'বোতল সবুজ', '#1F4C39', 'green'],
    ['Maroon', 'মেরুন', '#5C1F27', 'red'], ['Burgundy', 'বারগান্ডি', '#6B2131', 'red'], ['Wine', 'ওয়াইন', '#7A3038', 'red'], ['Brick red', 'ইট রং', '#A63D32', 'red'],
    ['Lemon', 'লেবু রং', '#ECE49E', 'other'], ['Mustard', 'সরিষা রং', '#C7A02A', 'other'], ['Gold', 'সোনালি', '#C3A055', 'other'],
    ['Peach', 'পিচ', '#EEC6A6', 'other'], ['Pink', 'গোলাপি', '#E6B2BA', 'other'], ['Lavender', 'ল্যাভেন্ডার', '#B5A8CD', 'other'], ['Purple', 'বেগুনি', '#5A3A6E', 'other']
  ].map(([en, bn, hex, family]) => ({ en, bn, hex, family }));

  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function rgbToLab([r, g, b]) {
    const f = c => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const R = f(r), G = f(g), B = f(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const h = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
    const fx = h(X), fy = h(Y), fz = h(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labToRgb([L, a, b]) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const g = t => t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27);
    const X = g(fx) * 0.95047, Y = g(fy), Z = g(fz) * 1.08883;
    const lin = [X * 3.2406 - Y * 1.5372 - Z * 0.4986, -X * 0.9689 + Y * 1.8758 + Z * 0.0415, X * 0.0557 - Y * 0.2040 + Z * 1.0570];
    return lin.map(c => 255 * (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c));
  }
  // CIEDE2000
  function deltaE00(l1, l2) {
    const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hp = (a, b) => { if (!a && !b) return 0; const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; };
    const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
    const Lmp = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
    let hmp = h1p + h2p;
    if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hmp += hmp < 360 ? 360 : -360; hmp /= 2; }
    const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hmp - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7)));
    const SL = 1 + 0.015 * Math.pow(Lmp - 50, 2) / Math.sqrt(20 + Math.pow(Lmp - 50, 2)), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T;
    const RT = -Math.sin(2 * dTheta * rad) * RC;
    return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
  }
  const PAL_LAB = PALETTE.map(p => ({ ...p, lab: rgbToLab(hexToRgb(p.hex)) }));
  function nameColor(hex) {
    const lab = rgbToLab(hexToRgb(hex));
    let best = null;
    PAL_LAB.forEach(p => { const d = deltaE00(lab, p.lab); if (!best || d < best.dE) best = { ...p, dE: d }; });
    return { en: best.en, bn: best.bn, family: best.family, dE: Math.round(best.dE * 10) / 10 };
  }

  // ছবি থেকে মূল রং: মাঝের ৭০% অংশ, সবচেয়ে উজ্জ্বল আর অন্ধকার ৮% বাদ, তারপর k-means (k=3)-এর বড় দলটি
  function dominantFromImage(img) {
    const max = 160, sc = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * sc)), h = Math.max(1, Math.round((img.naturalHeight || img.height) * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    const x0 = Math.floor(w * .15), y0 = Math.floor(h * .15), cw = Math.max(1, Math.floor(w * .7)), ch = Math.max(1, Math.floor(h * .7));
    const d = ctx.getImageData(x0, y0, cw, ch).data, px = [];
    for (let i = 0; i < d.length; i += 8) if (d[i + 3] > 200) px.push(rgbToLab([d[i], d[i + 1], d[i + 2]]));
    if (!px.length) return '#808080';
    px.sort((a, b) => a[0] - b[0]);
    const cut = Math.floor(px.length * .08), pts = px.slice(cut, px.length - cut || px.length);
    let cents = [pts[Math.floor(pts.length * .2)], pts[Math.floor(pts.length * .5)], pts[Math.floor(pts.length * .8)]];
    let groups = [];
    for (let it = 0; it < 10; it++) {
      groups = cents.map(() => []);
      pts.forEach(p => { let bi = 0, bd = Infinity; cents.forEach((c, i) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; bi = i; } }); groups[bi].push(p); });
      cents = groups.map((g, i) => g.length ? [0, 1, 2].map(k => g.reduce((s, p) => s + p[k], 0) / g.length) : cents[i]);
    }
    const big = groups.map((g, i) => [g.length, i]).sort((a, b) => b[0] - a[0])[0][1];
    return rgbToHex(labToRgb(cents[big]));
  }
  // ছবির নির্দিষ্ট জায়গায় চাপ দিলে সেখানকার রং (৯×৯ পিক্সেলের গড়)
  function colorAt(img, fx, fy) {
    const W = img.naturalWidth, H = img.naturalHeight, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const x = Math.max(0, Math.min(W - 9, Math.round(fx * W) - 4)), y = Math.max(0, Math.min(H - 9, Math.round(fy * H) - 4));
    const d = ctx.getImageData(x, y, 9, 9).data, s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return rgbToHex(s.map(v => v / 81));
  }
  root.AHColors = { PALETTE, nameColor, dominantFromImage, colorAt, deltaE00, rgbToLab, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
