// ===== Al Hadaf: কাস্টম জুব্বার লাইভ ছবি =====
// কলার, সামনের বোতাম, পকেট (পরিধানকারীর বাম বুকে, অর্থাৎ ছবিতে ডান দিকে), হাতা — সব বাছাই অনুযায়ী আঁকা হয়।
(function (root) {
  'use strict';
  // অপশনের নাম থেকে ছবির ধরন অনুমান (পুরনো সেটিংসে "look" না থাকলে)
  function lookOf(groupKey, o) {
    if (o && o.look) return o.look;
    const n = String((o && (o.en || (o.name && o.name.en))) || '').toLowerCase();
    const k = String(groupKey || '').toLowerCase();
    if (k.includes('collar') || /collar|neck|mandarin|band/.test(n)) return /round/.test(n) ? 'round' : /band|mandarin|chinese|no collar|without/.test(n) ? 'band' : 'shirt';
    if (k.includes('front') || /button|zip|placket/.test(n)) return /zip/.test(n) ? 'zip' : /hidden|concealed/.test(n) ? 'hidden' : 'visible';
    if (k.includes('pocket') || /pocket/.test(n)) return /no pocket|without/.test(n) ? 'none' : /side/.test(n) && /chest/.test(n) ? 'chest_side' : /side/.test(n) ? 'side' : 'chest';
    if (k.includes('cuff') || k.includes('sleeve') || /cuff|sleeve/.test(n)) return /link/.test(n) ? 'cufflink' : /plain|no cuff|without/.test(n) ? 'plain' : 'cuff';
    return '';
  }
  const KIND = { shirt: 'collar', band: 'collar', round: 'collar', hidden: 'front', visible: 'front', zip: 'front', chest: 'pocket', chest_side: 'pocket', side: 'pocket', none: 'pocket', cuff: 'cuff', cufflink: 'cuff', plain: 'cuff' };
  function looksFrom(groups, opts) {
    const out = { collar: 'shirt', front: 'hidden', pocket: 'chest', cuff: 'cuff' };
    (groups || []).forEach(g => { const o = g.options[(opts || {})[g.key] || 0] || g.options[0]; const l = lookOf(g.key, o); if (KIND[l]) out[KIND[l]] = l; });
    return out;
  }
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  let uid = 0;
  // opts: { hex, image, collar, front, pocket, cuff, crop: 'collar'|'front'|'pocket'|'cuff'|undefined, title }
  function draw(o) {
    const id = 'th' + (++uid);
    const hex = /^#[0-9a-f]{6}$/i.test(o.hex || '') ? o.hex : '#F1EEE4';
    const dark = lum(hex) < 0.45;
    const line = dark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.28)';
    const seam = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.14)';
    const btn = dark ? '#C9A45C' : '#EDE7DA', btnRim = dark ? '#8C6D2E' : '#A79F8E';
    // কাপড়ের ছবি টাইল করলে আলো-ছায়ার দাগ বারবার দেখায়, তাই আসল রং আর হালকা বুনন ব্যবহার হয়
    const useImg = o.image && o.texture;
    const fill = useImg ? `url(#${id}p)` : hex;
    const weave = `url(#${id}w)`;
    const crops = { collar: '105 8 90 72', front: '112 24 76 210', pocket: '88 92 124 230', cuff: '14 270 76 76' };
    const vb = crops[o.crop] || '0 0 300 560';
    const B = (x, y, r = 3.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${btn}" stroke="${btnRim}" stroke-width=".8"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .35}" fill="rgba(255,255,255,.55)"/>`;
    let s = `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${o.title || 'Thobe preview'}"><defs>
      <pattern id="${id}w" patternUnits="userSpaceOnUse" width="3" height="3"><path d="M0 .5H3M.5 0V3" stroke="${dark ? '#fff' : '#000'}" stroke-opacity="${dark ? '.05' : '.045'}" stroke-width=".6"/></pattern>
      ${useImg ? `<pattern id="${id}p" patternUnits="userSpaceOnUse" width="90" height="90"><rect width="90" height="90" fill="${hex}"/><image href="${o.image}" width="90" height="90" preserveAspectRatio="xMidYMid slice"/></pattern>` : ''}
      <linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity=".06"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
      <linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`;
    // হাতা (দুই পাশে)
    const sleeveL = 'M96 66 C80 72 66 84 60 104 L38 318 L74 326 L96 150 Z';
    const sleeveR = 'M204 66 C220 72 234 84 240 104 L262 318 L226 326 L204 150 Z';
    s += `<path d="${sleeveL}" fill="${fill}" stroke="${line}" stroke-width="1.2"/><path d="${sleeveL}" fill="url(#${id}s)"/>`;
    s += `<path d="${sleeveR}" fill="${fill}" stroke="${line}" stroke-width="1.2"/><path d="${sleeveR}" fill="url(#${id}s)" transform="translate(300 0) scale(-1 1)" opacity=".6"/>`;
    // শরীর
    const body = 'M122 38 L96 66 L96 150 L82 540 L218 540 L204 150 L204 66 L178 38 C168 46 132 46 122 38 Z';
    s += `<path d="${body}" fill="${fill}" stroke="${line}" stroke-width="1.2"/><path d="${body}" fill="${weave}"/><path d="${body}" fill="url(#${id}g)"/>`;
    s += `<path d="${sleeveL}" fill="${weave}"/><path d="${sleeveR}" fill="${weave}"/>`;
    s += `<path d="M96 150 L204 150" stroke="${seam}" stroke-width=".8" fill="none" stroke-dasharray="0"/>`.replace('M96 150 L204 150', 'M97 66 Q150 62 203 66');
    // হাতার শেষ: কাফ / কাফলিংক / সাধারণ
    if (o.cuff === 'cuff' || o.cuff === 'cufflink') {
      s += `<path d="M41 292 L76 298 L74 326 L38 318 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/><path d="M224 298 L259 292 L262 318 L226 326 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/>`;
      s += o.cuff === 'cuff' ? B(62, 312, 2.8) + B(238, 312, 2.8)
        : `<rect x="58" y="306" width="9" height="6" rx="1.5" fill="${btn}" stroke="${btnRim}" stroke-width=".7"/><rect x="233" y="306" width="9" height="6" rx="1.5" fill="${btn}" stroke="${btnRim}" stroke-width=".7"/>`;
    } else {
      s += `<path d="M39 314 L74 320" stroke="${seam}" stroke-width="1"/><path d="M226 320 L261 314" stroke="${seam}" stroke-width="1"/>`;
    }
    // সামনের প্লাকেট
    const pBottom = o.front === 'hidden' ? 214 : 204;
    if (o.front === 'zip') {
      s += `<path d="M150 44 L150 200" stroke="${line}" stroke-width="1.4"/><path d="M150 44 L150 200" stroke="${btn}" stroke-width="1.2" stroke-dasharray="1.5 1.5"/><rect x="147" y="52" width="6" height="10" rx="2" fill="${btn}" stroke="${btnRim}" stroke-width=".7"/>`;
    } else {
      s += `<path d="M142 44 L158 44 L158 ${pBottom - 10} ${o.front === 'hidden' ? `L150 ${pBottom}` : `L158 ${pBottom}`} L142 ${o.front === 'hidden' ? pBottom - 10 : pBottom} Z" fill="${fill}" stroke="${line}" stroke-width="1.1"/>`;
      if (o.front === 'visible') [62, 92, 122, 152, 182].forEach(y => { s += B(150, y); });
    }
    // পকেট: পরিধানকারীর বাম বুকে (ছবিতে ডান দিকে)
    if (o.pocket === 'chest' || o.pocket === 'chest_side') {
      s += `<path d="M166 112 L198 112 L198 150 Q198 156 192 156 L172 156 Q166 156 166 150 Z" fill="${fill}" stroke="${line}" stroke-width="1.1"/>`;
      s += `<path d="M166 117 L198 117" stroke="${seam}" stroke-width=".8"/>`;
      if (o.collar === 'band') s += `<rect x="168" y="106" width="11" height="2.6" rx="1" fill="${btn}" stroke="${btnRim}" stroke-width=".5"/>`;
    }
    if (o.pocket === 'side' || o.pocket === 'chest_side') {
      s += `<path d="M100 250 Q104 280 101 308" stroke="${line}" stroke-width="1.3" fill="none"/><path d="M200 250 Q196 280 199 308" stroke="${line}" stroke-width="1.3" fill="none"/>`;
    }
    // কলার
    const inner = `<path d="M124 36 C130 26 170 26 176 36 C168 42 132 42 124 36 Z" fill="${hex}"/><path d="M124 36 C130 26 170 26 176 36 C168 42 132 42 124 36 Z" fill="#000" opacity=".38"/>`;
    if (o.collar === 'band') {
      s += inner;
      s += `<path d="M123 36 C131 44 169 44 177 36 L177 49 C168 57 132 57 123 49 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/>`;
      s += `<path d="M123 36 C131 44 169 44 177 36" stroke="${line}" stroke-width="1" fill="none"/>`;
      s += B(150, 45, 2.5) + B(150, 53.5, 2.3);
    } else if (o.collar === 'shirt') {
      s += inner;
      s += `<path d="M123 36 C131 44 169 44 177 36 L176 42 C167 48 133 48 124 42 Z" fill="${fill}" stroke="${line}" stroke-width="1"/>`;
      s += `<path d="M150 46 L125 38 L112 56 L135 74 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/><path d="M150 46 L125 38 L112 56 L135 74 Z" fill="#000" opacity=".06"/>`;
      s += `<path d="M150 46 L175 38 L188 56 L165 74 Z" fill="${fill}" stroke="${line}" stroke-width="1.2"/>`;
      s += B(150, 50, 2.4);
    } else {
      s += inner + `<path d="M124 36 C132 48 168 48 176 36" stroke="${line}" stroke-width="1.6" fill="none"/>`;
    }
    // নিচের হেম
    s += `<path d="M82 540 L218 540" stroke="${line}" stroke-width="1.2"/>`;
    return s + '</svg>';
  }
  root.AHThobe = { draw, lookOf, looksFrom, KIND };
})(typeof window !== 'undefined' ? window : globalThis);
