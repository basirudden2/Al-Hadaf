// ===== দোকানের তথ্য: এখানে নিজের নম্বর আর লিংক বসান =====
const SHOP = {
  whatsapp: '8801700000000',   // দেশের কোড 88 সহ, + ছাড়া
  phone: '01700000000',
  bkash: '01700000000',        // bKash/Nagad পার্সোনাল নম্বর (Send Money)
  facebook: 'https://facebook.com/',
  address: 'ঢাকা, বাংলাদেশ',
  deliveryInside: 70,          // ঢাকার ভেতরে ডেলিভারি চার্জ (টাকা)
  deliveryOutside: 130         // ঢাকার বাইরে ডেলিভারি চার্জ (টাকা)
};

// ===== ক্যাটাগরি =====
const CATEGORIES = [
  { id: 'all', label: 'সব' },
  { id: 'jubba', label: 'জুব্বা' },
  { id: 'kids', label: 'কিডস' },
  { id: 'combo', label: 'কম্বো' },
  { id: 'accessories', label: 'এক্সেসরিজ' }
];

const JUBBA_SIZES = ['50', '52', '54', '56', '58', '60'];
const JUBBA_HINT = 'সাইজ মানে জুব্বার লম্বা (ইঞ্চি)। নিশ্চিত না হলে নিচের সাইজ গাইড দেখুন।';
const KIDS_SIZES = ['2-3 বছর', '4-5 বছর', '6-7 বছর', '8-10 বছর'];

// ===== পণ্যের তালিকা =====
// নতুন পণ্য যোগ করতে একটা ব্লক কপি করে id, নাম, দাম বদলান।
// shape: 'jubba' | 'combo' | 'cap' | 'bottle'  (আসল ছবি দেওয়ার আগ পর্যন্ত এই আঁকা ছবি দেখাবে)
const PRODUCTS = [
  {
    id: 'saudi-classic', category: 'jubba', shape: 'jubba',
    name: 'সৌদি ক্লাসিক জুব্বা', price: 2450, badge: 'বেস্ট সেলার',
    fabric: 'জাপানি টেট্রন', color: '#F1EFE9', colorName: 'অফ-হোয়াইট',
    description: 'সোজা কাট, উঁচু কলার আর লুকানো বোতাম। জুমা আর ঈদের জন্য সবচেয়ে জনপ্রিয় স্টাইল।',
    sizes: JUBBA_SIZES, sizeLabel: 'সাইজ (লম্বা, ইঞ্চি)', sizeHint: JUBBA_HINT
  },
  {
    id: 'omani-navy', category: 'jubba', shape: 'jubba',
    name: 'ওমানি জুব্বা', price: 2650,
    fabric: 'কোরিয়ান কটন ব্লেন্ড', color: '#2C3E57', colorName: 'নেভি ব্লু',
    description: 'গোল গলা আর সামনে ছোট টাসেল। হালকা কাপড়, সারাদিন পরে আরাম।',
    sizes: JUBBA_SIZES, sizeLabel: 'সাইজ (লম্বা, ইঞ্চি)', sizeHint: JUBBA_HINT
  },
  {
    id: 'kuwaiti-sand', category: 'jubba', shape: 'jubba',
    name: 'কুয়েতি কাট জুব্বা', price: 2850, badge: 'নতুন',
    fabric: 'প্রিমিয়াম টিআর', color: '#CFC6B5', colorName: 'স্যান্ড বেইজ',
    description: 'চাপা কাঁধ আর পরিষ্কার লাইন। অফিস থেকে মসজিদ, সব জায়গায় মানানসই।',
    sizes: JUBBA_SIZES, sizeLabel: 'সাইজ (লম্বা, ইঞ্চি)', sizeHint: JUBBA_HINT
  },
  {
    id: 'moroccan-brown', category: 'jubba', shape: 'jubba',
    name: 'মরোক্কান জুব্বা', price: 3250,
    fabric: 'লিনেন ব্লেন্ড', color: '#6B4E3D', colorName: 'কফি ব্রাউন',
    description: 'গলায় আর হাতায় হালকা এমব্রয়ডারি। বিয়ে আর দাওয়াতের জন্য।',
    sizes: JUBBA_SIZES, sizeLabel: 'সাইজ (লম্বা, ইঞ্চি)', sizeHint: JUBBA_HINT
  },
  {
    id: 'daily-sage', category: 'jubba', shape: 'jubba',
    name: 'ডেইলি কটন জুব্বা', price: 1850,
    fabric: '১০০% কটন', color: '#A9B4AE', colorName: 'সেজ গ্রিন',
    description: 'প্রতিদিনের জন্য নরম কটন। গরমে আরাম, ধোয়াও সহজ।',
    sizes: JUBBA_SIZES, sizeLabel: 'সাইজ (লম্বা, ইঞ্চি)', sizeHint: JUBBA_HINT
  },
  {
    id: 'kids-white', category: 'kids', shape: 'jubba',
    name: 'কিডস জুব্বা', price: 1250,
    fabric: 'নরম কটন', color: '#F5F4F0', colorName: 'সাদা',
    description: 'ছোটদের ত্বকের জন্য নরম কাপড়, বাবার সৌদি ক্লাসিকের মতো ডিজাইন।',
    sizes: KIDS_SIZES, sizeLabel: 'বয়স', sizeHint: 'বাচ্চা লম্বা হলে এক ধাপ বড় নিন।'
  },
  {
    id: 'father-son', category: 'combo', shape: 'combo',
    name: 'বাবা-ছেলে কম্বো', price: 3450, badge: '২৫০ টাকা সাশ্রয়',
    fabric: 'জাপানি টেট্রন', color: '#F1EFE9', color2: '#F1EFE9', colorName: 'অফ-হোয়াইট',
    description: 'বাবা আর ছেলের একই রকম সৌদি ক্লাসিক জুব্বা। ঈদের ছবির জন্য সেরা।',
    sizes: JUBBA_SIZES, sizeLabel: 'বাবার সাইজ (লম্বা, ইঞ্চি)', sizeHint: 'ছেলের বয়স চেকআউটের নোটে লিখে দিন।'
  },
  {
    id: 'tupi-white', category: 'accessories', shape: 'cap',
    name: 'নেট টুপি', price: 250,
    fabric: 'কটন নেট', color: '#F5F4F0', colorName: 'সাদা',
    description: 'হালকা, বাতাস চলাচল করে। যেকোনো জুব্বার সাথে মানায়।',
    sizes: ['ফ্রি সাইজ'], sizeLabel: 'সাইজ'
  },
  {
    id: 'attar-oud', category: 'accessories', shape: 'bottle',
    name: 'আতর (উদ)', price: 450,
    fabric: 'অ্যালকোহল-মুক্ত', color: '#B08D3E', colorName: '৬ মিলি',
    description: 'দীর্ঘস্থায়ী উদের ঘ্রাণ, অ্যালকোহল-মুক্ত।',
    sizes: ['6 ml'], sizeLabel: 'পরিমাণ'
  }
];
