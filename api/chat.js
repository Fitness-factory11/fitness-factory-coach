// /api/chat.js
import fs from 'fs';
import path from 'path';

// --------------------------------------------------
// تحميل قاعدة التمارين مرة واحدة (في بداية التشغيل)
// --------------------------------------------------
const dataPath = path.join(process.cwd(), 'data', 'exercises.json');
let EXERCISES = [];
try {
  const raw = fs.readFileSync(dataPath, 'utf8');
  EXERCISES = JSON.parse(raw);
} catch (e) {
  console.error('Failed to read exercises.json:', e);
  EXERCISES = [];
}

// --------------------------------------------------
// أدوات مساعدة للنص العربي والبحث
// --------------------------------------------------
const TASHKEEL_RE = /[\u064B-\u0652]/g; // التشكيل
const TATWEEL_RE  = /\u0640/g;          // ـ
const PUNCT_RE    = /[^\p{L}\p{N}\s]/gu; // أي رموز غير حروف/أرقام/مسافة (دعم Unicode)

function arNormalize(s = '') {
  return String(s)
    .replace(TASHKEEL_RE, '')
    .replace(TATWEEL_RE, '')
    .replace(PUNCT_RE, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// استخراج كلمات مفيدة لبحث يوتيوب (يشيل الكلمات العامة)
function toYtQuery(userMsg = '') {
  const stopWords = [
    'ابي', 'أبي', 'ابغى', 'أبغى', 'اريد', 'أريد', 'ابغا', 'أبغا', 'لو',
    'تمرين', 'تمارين', 'رابط', 'لينك', 'فيديو', 'يوتيوب', 'عطني', 'بغيت',
    'ممكن', 'ابغا', 'معي', 'بايش', 'عن', 'كيف', 'ابي رابط', 'ابي لينك',
    'عطني رابط', 'عطني لينك', 'ارسلي', 'تكفى', 'لو سمحت', 'رجاء'
  ];
  const clean = arNormalize(userMsg);
  const tokens = clean.split(' ').filter(Boolean);
  const filtered = tokens.filter(t => !stopWords.includes(t));
  // لو الناتج فاضي، رجع الأصل المنظّف
  return (filtered.join(' ').trim()) || clean || 'تمارين';
}

// تحويل مصفوفة لنص عربي جذاب
function joinOrDash(arr) {
  if (!Array.isArray(arr) || !arr.length) return '—';
  return arr.join('، ');
}

// --------------------------------------------------
// البحث في قاعدة البيانات + ترتيب النتائج
// --------------------------------------------------
function searchExercises(query = '', k = 5) {
  const q = arNormalize(query);
  if (!q) return [];

  const tokens = q.split(' ').filter(Boolean);

  // نحضّر نص لكل تمرين للبحث فيه
  const scored = EXERCISES.map((ex) => {
    const hayParts = [
      ex.name_ar,
      ex.muscle,
      ex.level,
      ...(ex.equipment || []),
      ...(ex.cues_ar || []),
      ...(ex.alternatives_ar || []),
    ];
    const hay = arNormalize(hayParts.join(' '));

    // نحتسب سكور بسيط حسب وجود الكلمات
    let score = 0;
    for (const t of tokens) {
      if (!t) continue;
      if (hay.includes(t)) score += 3;                // مطابقة عامة
    }
    // تعزيز لو الاسم أو العضلة فيها نفس الكلمات
    const strong = arNormalize(`${ex.name_ar} ${ex.muscle}`);
    for (const t of tokens) {
      if (strong.includes(t)) score += 2;
    }

    return { ex, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.ex);
}

// --------------------------------------------------
// بناء ردّ سياقي مرتب من النتائج
// --------------------------------------------------
function buildContext(userMsg = '', limit = 5) {
  const top = searchExercises(userMsg, limit);
  if (!top.length) return '';

  const lines = top.map((ex, i) => {
    // فيديوهات: نخليها سطر واحد مع بدائل لو فيه
    const videos = [
      ex.video,
      ...(Array.isArray(ex.alt_videos) ? ex.alt_videos : []),
    ].filter(Boolean);

    const vidsLine = videos.length
      ? `روابط: ${videos.join(' ، ')}`
      : 'روابط: —';

    return [
      `#${i + 1} ${ex.name_ar} — عضلة: ${ex.muscle} • مستوى: ${ex.level}`,
      `ملاحظات: ${joinOrDash(ex.cues_ar)}`,
      `بدائل: ${joinOrDash(ex.alternatives_ar)}`,
      vidsLine,
    ].join('\n');
  });

  return [
    'سِقت لك أقرب تمارين من قاعدتي 👇\n',
    lines.join('\n\n'),
  ].join('\n');
}

// --------------------------------------------------
// الهاندلر الرئيسي
// --------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests are allowed' });
  }

  try {
    const { message = '' } = req.body || {};
    const msg = String(message || '').trim();

    if (!msg) {
      return res.status(200).json({ reply: 'اكتب سؤالك عن التمارين/البدائل/السعرات…' });
    }

    // 1) طلبات "يوتيوب/رابط/لينك/فيديو" — نرد برابط بحث يوتيوب مباشرة
    if (/\b(يوتيوب|رابط|لينك|فيديو)\b/iu.test(msg)) {
      const q = toYtQuery(msg);
      const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      const reply = [
        'ما عندي فيديو معيّن الآن، لكن تقدر تشوف النتائج مباشرة 👇',
        yt,
        'تحب أضيق البحث؟ قلّي اسم التمرين بالضبط أو العضلة/الأداة.',
      ].join('\n');
      return res.status(200).json({ reply });
    }

    // 2) جرّب من قاعدة التمارين أولًا
    const ctx = buildContext(msg, 5);
    if (ctx) {
      return res.status(200).json({ reply: ctx });
    }

    // 3) لا توجد نتائج: نعطي رد مهذّب + رابط يوتيوب نظيف
    const fallbackQuery = toYtQuery(msg);
    const ytFallback = `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackQuery)}`;
    const fallback = [
      'ما لقيت نتيجة واضحة في قاعدتي 🫶',
      'اكتب اسم أدق للتمرين أو العضلة/الأداة… وبخدمك.',
      'وبينما كذا، هذا بحث يوتيوب جاهز بناءً على سؤالك 👇',
      ytFallback
    ].join('\n');
    return res.status(200).json({ reply: fallback });

  } catch (err) {
    console.error('API /chat error:', err);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
    });
  }
}
