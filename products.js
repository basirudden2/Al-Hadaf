// ===== দোকানের তথ্য: নিজের নম্বর আর লিংক বসান =====
const SHOP = {
  whatsapp: '8801700000000',   // 88 সহ, + ছাড়া
  phone: '01700000000',
  email: 'hello@alhadaf.com',
  bkash: '01700000000',        // bKash/Nagad পার্সোনাল নম্বর
  facebook: 'https://facebook.com/',
  instagram: 'https://instagram.com/',
  address: { en: 'Dhaka, Bangladesh', bn: 'ঢাকা, বাংলাদেশ' },
  deliveryInside: 70,
  deliveryOutside: 130
};

// ===== ক্যাটাগরি (tile: true হলে হোমপেজে বক্স দেখাবে) =====
const CATEGORIES = [
  { id: 'all', name: { en: 'All', bn: 'সব' } },
  { id: 'thobe', name: { en: 'Thobe', bn: 'জুব্বা' }, tile: true },
  { id: 'kids', name: { en: 'Kids', bn: 'কিডস' }, tile: true },
  { id: 'father-son', name: { en: 'Father & Son', bn: 'বাবা-ছেলে' }, tile: true },
  { id: 'fragrance', name: { en: 'Fragrance', bn: 'আতর' }, tile: true },
  { id: 'accessories', name: { en: 'Accessories', bn: 'এক্সেসরিজ' } }
];

// ===== সাইজ টেবিল (সাইজ গাইড পেজে দেখায়) — নিজের মাপ দিয়ে বদলে নিন =====
const SIZE_CHART = [
  ['XS/52', '52"', '40"', '5\'0" – 5\'3"'],
  ['S/54', '54"', '42"', '5\'3" – 5\'5"'],
  ['M/56', '56"', '44"', '5\'5" – 5\'7"'],
  ['L/58', '58"', '46"', '5\'7" – 5\'9"'],
  ['XL/60', '60"', '48"', '5\'9" – 5\'11"'],
  ['2XL/62', '62"', '50"', '5\'11" – 6\'2"']
];

const THOBE_SIZES = () => SIZE_CHART.map(r => ({ label: r[0] }));
const KIDS_SIZES = () => ['4Y', '6Y', '8Y', '10Y', '12Y'].map(l => ({ label: l }));

const SAUDI_FEATURES = {
  en: ['Classic single-button Saudi collar', 'Hidden button placket', 'Chest pocket', 'Plain cuffs', 'Regular fit, ankle length'],
  bn: ['ক্লাসিক এক-বোতামের সৌদি কলার', 'লুকানো বোতাম', 'বুক পকেট', 'সাধারণ কাফ', 'রেগুলার ফিট, টাখনুর উপর পর্যন্ত লম্বা']
};

// ===== পণ্যের তালিকা =====
// images: ছবি তোলার পর ফাইলের নাম দিন, যেমন ['AH-1001-1.jpg', 'AH-1001-2.jpg']
// ছবি না থাকলে আঁকা ছবি দেখাবে। একই group মানে একই ডিজাইনের ভিন্ন রং।
// sizes-এ কোনো সাইজ শেষ হলে { label: 'XL/60', stock: false } লিখুন।
const PRODUCTS = [
  {
    id: 'AH-1001', cat: 'thobe', group: 'saudi-classic', shape: 'thobe', isNew: true,
    name: { en: 'Saudi Classic Thobe', bn: 'সৌদি ক্লাসিক জুব্বা' },
    color: { en: 'Off-white', bn: 'অফ-হোয়াইট', hex: '#F2F0EA' },
    price: 2450, compare: 2850,
    badge: { en: 'Best seller', bn: 'বেস্ট সেলার' },
    fabric: { en: 'Japanese Tetron', bn: 'জাপানি টেট্রন' }, gsm: 150,
    desc: { en: 'Our most loved cut. A clean off-white thobe with a crisp Saudi collar that stays sharp from Fajr to Isha.', bn: 'আমাদের সবচেয়ে জনপ্রিয় কাট। পরিষ্কার অফ-হোয়াইট রঙে সৌদি কলার, যা ফজর থেকে এশা পর্যন্ত টানটান থাকে।' },
    features: SAUDI_FEATURES,
    sizes: THOBE_SIZES().map(s => s.label === '2XL/62' ? { ...s, stock: false } : s),
    images: []
  },
  {
    id: 'AH-1002', cat: 'thobe', group: 'saudi-classic', shape: 'thobe',
    name: { en: 'Saudi Classic Thobe', bn: 'সৌদি ক্লাসিক জুব্বা' },
    color: { en: 'Navy', bn: 'নেভি', hex: '#2C3E57' },
    price: 2450,
    fabric: { en: 'Japanese Tetron', bn: 'জাপানি টেট্রন' }, gsm: 150,
    desc: { en: 'The Saudi Classic in a deep navy, easy to wear to work, the masjid or a dawat.', bn: 'গাঢ় নেভি রঙে সৌদি ক্লাসিক, অফিস, মসজিদ বা দাওয়াতে সহজে মানায়।' },
    features: SAUDI_FEATURES, sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1003', cat: 'thobe', group: 'saudi-classic', shape: 'thobe',
    name: { en: 'Saudi Classic Thobe', bn: 'সৌদি ক্লাসিক জুব্বা' },
    color: { en: 'Charcoal', bn: 'চারকোল', hex: '#3A3B3C' },
    price: 2450,
    fabric: { en: 'Japanese Tetron', bn: 'জাপানি টেট্রন' }, gsm: 150,
    desc: { en: 'A dark charcoal Saudi Classic for winter evenings and formal gatherings.', bn: 'শীতের সন্ধ্যা আর আনুষ্ঠানিক দাওয়াতের জন্য গাঢ় চারকোল সৌদি ক্লাসিক।' },
    features: SAUDI_FEATURES, sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1011', cat: 'thobe', group: 'omani', shape: 'thobe', isNew: true,
    name: { en: 'Omani Thobe', bn: 'ওমানি জুব্বা' },
    color: { en: 'Sky blue', bn: 'আকাশি', hex: '#A9BED0' },
    price: 2650,
    badge: { en: 'New', bn: 'নতুন' },
    fabric: { en: 'Korean cotton blend', bn: 'কোরিয়ান কটন ব্লেন্ড' }, gsm: 140,
    desc: { en: 'Round collarless neck with a short tassel, cut light for long summer days.', bn: 'গোল কলারবিহীন গলা আর ছোট টাসেল, গরমের লম্বা দিনের জন্য হালকা কাপড়।' },
    features: {
      en: ['Round Omani neckline', 'Detachable tassel', 'Side pockets', 'Relaxed fit'],
      bn: ['গোল ওমানি গলা', 'খোলা যায় এমন টাসেল', 'পাশের পকেট', 'আরামদায়ক ঢিলা ফিট']
    },
    sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1012', cat: 'thobe', group: 'omani', shape: 'thobe',
    name: { en: 'Omani Thobe', bn: 'ওমানি জুব্বা' },
    color: { en: 'Sand', bn: 'স্যান্ড', hex: '#D3CABA' },
    price: 2650,
    fabric: { en: 'Korean cotton blend', bn: 'কোরিয়ান কটন ব্লেন্ড' }, gsm: 140,
    desc: { en: 'The Omani cut in a warm sand tone that pairs with any cap or shawl.', bn: 'উষ্ণ স্যান্ড রঙে ওমানি কাট, যেকোনো টুপি বা চাদরের সাথে মানায়।' },
    features: {
      en: ['Round Omani neckline', 'Detachable tassel', 'Side pockets', 'Relaxed fit'],
      bn: ['গোল ওমানি গলা', 'খোলা যায় এমন টাসেল', 'পাশের পকেট', 'আরামদায়ক ঢিলা ফিট']
    },
    sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1021', cat: 'thobe', group: 'kuwaiti', shape: 'thobe', isNew: true,
    name: { en: 'Kuwaiti Cut Thobe', bn: 'কুয়েতি কাট জুব্বা' },
    color: { en: 'Stone grey', bn: 'স্টোন গ্রে', hex: '#8F9293' },
    price: 2850,
    fabric: { en: 'Premium TR', bn: 'প্রিমিয়াম টিআর' }, gsm: 165,
    desc: { en: 'Sharper shoulders and a straight line through the body for a tailored look.', bn: 'টানটান কাঁধ আর সোজা লাইন, দেখতে টেইলার্ড।' },
    features: {
      en: ['Band collar', 'Concealed placket', 'Structured shoulders', 'Slim regular fit'],
      bn: ['ব্যান্ড কলার', 'লুকানো প্লাকেট', 'গঠনযুক্ত কাঁধ', 'স্লিম রেগুলার ফিট']
    },
    sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1031', cat: 'thobe', group: 'moroccan', shape: 'thobe', isNew: true,
    name: { en: 'Moroccan Thobe', bn: 'মরোক্কান জুব্বা' },
    color: { en: 'Coffee', bn: 'কফি', hex: '#6B4E3D' },
    price: 3250,
    fabric: { en: 'Linen blend', bn: 'লিনেন ব্লেন্ড' }, gsm: 170,
    desc: { en: 'Tonal embroidery at the neck and cuffs. Made for weddings and Eid dawats.', bn: 'গলা আর কাফে একই রঙের এমব্রয়ডারি। বিয়ে আর ঈদের দাওয়াতের জন্য।' },
    features: {
      en: ['Embroidered V-neck', 'Embroidered cuffs', 'Side pockets', 'Relaxed fit'],
      bn: ['এমব্রয়ডারি করা ভি-গলা', 'এমব্রয়ডারি করা কাফ', 'পাশের পকেট', 'আরামদায়ক ঢিলা ফিট']
    },
    sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-1041', cat: 'thobe', group: 'daily', shape: 'thobe',
    name: { en: 'Everyday Cotton Thobe', bn: 'ডেইলি কটন জুব্বা' },
    color: { en: 'Sage', bn: 'সেজ', hex: '#A9B4AE' },
    price: 1850,
    fabric: { en: '100% cotton', bn: '১০০% কটন' }, gsm: 130,
    desc: { en: 'Soft, breathable cotton for daily prayers and hot days. Easy to wash.', bn: 'প্রতিদিনের নামাজ আর গরমের জন্য নরম, বাতাস চলাচলকারী কটন। ধোয়া সহজ।' },
    features: SAUDI_FEATURES, sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-2001', cat: 'kids', group: 'kids-saudi', shape: 'thobe', isNew: true,
    name: { en: 'Kids Saudi Thobe', bn: 'কিডস সৌদি জুব্বা' },
    color: { en: 'White', bn: 'সাদা', hex: '#F6F5F1' },
    price: 1250,
    fabric: { en: 'Soft cotton', bn: 'নরম কটন' }, gsm: 125,
    desc: { en: 'A smaller Saudi Classic in soft cotton that is gentle on young skin.', bn: 'ছোটদের ত্বকের জন্য নরম কটনে ছোট সাইজের সৌদি ক্লাসিক।' },
    features: {
      en: ['Saudi collar', 'Snap buttons for easy dressing', 'Chest pocket'],
      bn: ['সৌদি কলার', 'সহজে পরার জন্য স্ন্যাপ বোতাম', 'বুক পকেট']
    },
    sizes: KIDS_SIZES(), images: []
  },
  {
    id: 'AH-3001', cat: 'father-son', group: 'father-son', shape: 'combo',
    name: { en: 'Father & Son Saudi Set', bn: 'বাবা-ছেলে সৌদি সেট' },
    color: { en: 'Off-white', bn: 'অফ-হোয়াইট', hex: '#F2F0EA' },
    price: 3450, compare: 3700,
    badge: { en: 'Save BDT 250', bn: '৳২৫০ সাশ্রয়' },
    fabric: { en: 'Japanese Tetron', bn: 'জাপানি টেট্রন' }, gsm: 150,
    desc: { en: 'Two matching Saudi Classic thobes. Choose the father’s size here and write the son’s age in the order note.', bn: 'একই রকম দুটি সৌদি ক্লাসিক জুব্বা। এখানে বাবার সাইজ বাছুন, ছেলের বয়স অর্ডারের নোটে লিখুন।' },
    features: SAUDI_FEATURES, sizes: THOBE_SIZES(), images: []
  },
  {
    id: 'AH-4001', cat: 'fragrance', group: 'attar-oud', shape: 'bottle',
    name: { en: 'Oud Attar', bn: 'উদ আতর' },
    color: { en: '6 ml', bn: '৬ মিলি', hex: '#B08D3E' },
    price: 450,
    fabric: { en: 'Alcohol-free oil', bn: 'অ্যালকোহল-মুক্ত তেল' },
    desc: { en: 'A deep, long-lasting oud. Alcohol-free and safe to wear for salah.', bn: 'গভীর, দীর্ঘস্থায়ী উদের ঘ্রাণ। অ্যালকোহল-মুক্ত, নামাজে ব্যবহার করা যায়।' },
    features: { en: ['Lasts 8–10 hours', 'Roll-on bottle'], bn: ['৮–১০ ঘণ্টা থাকে', 'রোল-অন বোতল'] },
    sizes: [{ label: '6 ml' }], images: []
  },
  {
    id: 'AH-5001', cat: 'accessories', group: 'net-cap', shape: 'cap',
    name: { en: 'Net Prayer Cap', bn: 'নেট টুপি' },
    color: { en: 'White', bn: 'সাদা', hex: '#F6F5F1' },
    price: 250,
    fabric: { en: 'Cotton net', bn: 'কটন নেট' },
    desc: { en: 'Light and breathable, made to go with every thobe.', bn: 'হালকা আর বাতাস চলাচল করে, যেকোনো জুব্বার সাথে মানায়।' },
    features: { en: ['One size fits most'], bn: ['ফ্রি সাইজ'] },
    sizes: [{ label: 'Free size' }], images: []
  }
];
