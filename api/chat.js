// /api/chat.js  — هجين: يبحث في قاعدة التمارين أولاً، ثم يصيغ الرد بالذكاء.
// عند عدم وجود تطابق: يعطي رابط بحث يوتيوب جاهز.

const fs = require("fs");
const path = require("path");

// ========= تحميل قاعدة التمارين =========
const filePath = path.join(process.cwd(), "data", "exercises.json");
let EXERCISES = [];
try {
  EXERCISES = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (e) {
  console.error("Failed to load exercises.json", e);
  EXERCISES = [];
}

// ========= أدوات بحث بسيطة =========
function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreExercise(ex, qTokens) {
  const hay = normalize(
    [
      ex.name_ar,
      ex.muscle,
      ex.level,
      (ex.cues_ar || []).join(" "),
      (ex.alternatives_ar || []).join(" "),
    ].join(" ")
  );
  let s = 0;
  qTokens.forEach((t) => (hay.includes(t) ? (s += t.length > 2 ? 2 : 1) : 0));
  if (hay.startsWith(qTokens.join(" "))) s += 3;
  return s;
}

function searchExercises(query, k = 4) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  return EXERCISES
    .map((ex) => ({ ex, s: scoreExercise(ex, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.ex);
}
// تنظيف رسالة المستخدم واستخراج كلمات البحث لليوتيوب
function toYtQuery(userMsg) {
  const stopWords = [
    'ابي', 'أبي', 'ابغى', 'أبغى', 'ابغا', 'أبغا', 'اب', 'رابط', 'لينك', 'يوتيوب',
    'فيديو', 'عرفني', 'تمرين', 'تدريب', 'ارجع', 'اعطني', 'عطني', 'قل', 'قول', 'مره', 'ابي', 'حل',
    'لو سمحت', 'رجاءً', 'ابغى رابط', 'ابي رابط', 'رابط تمرين', 'رابط تمرينات'
  ];
}

  // خرائط مختصرة: نحول عضلات/مصطلحات شائعة لكلمات بحث نظيفة
  const map = {
    'بطن': 'تمارين بطن',
    'كروس فيت': 'crossfit workout',
    'صدر': 'تمارين صدر',
    'ظهر': 'تمارين ظهر',
    'كتف': 'تمارين كتف',
    'بايسبس': 'تمارين بايسبس',
    'باي': 'تمارين بايسبس',
    'ترايسبس': 'تمارين ترايسبس',
    'تراي': 'تمارين ترايسبس',
    'رجل': 'تمارين رجل',
    'ارجل': 'تمارين رجل',
    'افخاذ': 'تمارين افخاذ',
    'سمانه': 'تمارين سمانة',
    'مؤخرة': 'تمارين Glutes',
    'قرفصاء': 'Squat',
    'سكوات': 'Squat',
    'بنش': 'Bench Press',
    'ضغط': 'Push Up',
    'بلانك': 'Plank',
    'كارديو': 'Cardio workout',
  };

  let q = userMsg
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')   // نشيل الرموز والإيموجي
    .replace(/\s+/g, ' ')
    .trim();

  // حذف كلمات الحشو
  for (const w of stopWords) {
    const re = new RegExp(`\\b${w}\\b`, 'giu');
    q = q.replace(re, ' ');
  }
  q = q.replace(/\s+/g, ' ').trim();

  // إذا طلعت فاضية، خله “تمارين رياضية”
  if (!q) return 'تمارين رياضية';

  // استبدال مصطلحات معروفة
  Object.entries(map).forEach(([k, v]) => {
    const re = new RegExp(`\\b${k}\\b`, 'giu');
    q = q.replace(re, v);
  });

  // لو المستخدم قال “تمرين بطن” بيبقى “تمارين بطن” – كويس.
  return q;
}

function ytSearchLink(userMsg) {
  const q = encodeURIComponent(toYtQuery(userMsg));
  return `https://www.youtube.com/results?search_query=${q}`;
}

// ========= بناء نصّ موجز من القاعدة (يروح للذكاء) =========
function buildContextFromMatches(matches) {
  if (!matches.length) return "";

  const lines = matches
    .map((ex, i) => {
      const vids = [ex.video, ex.alt_video, ...(ex.alt_videos || [])].filter(Boolean);
      const vidsTxt = vids.length
        ? vids.map((v, idx) => `رابط ${idx + 1}: ${v}`).join(" • ")
        : "لا يوجد روابط في القاعدة.";
      const cues = (ex.cues_ar || []).map((c) => `- ${c}`).join("\n") || "- —";
      const alts = (ex.alternatives_ar || []).join("، ") || "—";
      return `#${i + 1} ${ex.name_ar}
العضلة: ${ex.muscle} • المستوى: ${ex.level}
ملاحظات:\n${cues}
بدائل: ${alts}
روابط: ${vidsTxt}`;
    })
    .join("\n\n");

  return `هذه نتائج من قاعدة التمارين:\n\n${lines}`;
}

// ========= نداء الذكاء =========
async function callOpenAI(systemPrompt, userMsg) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY مفقود");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    }),
  });

  if (!resp.ok) {
    let errText = "";
    try { errText = await resp.text(); } catch {}
    throw new Error(`OpenAI error: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  return (
    data?.choices?.[0]?.message?.content ||
    "تعذّر توليد رد الآن 🙏. جرّب بعد لحظات."
  );
}

// ========= المعالج =========
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No message provided" });
    }
    if (/\b(يوتيوب|رابط|لينك|فيديو)\b/iu.test(message)) {
  const yt = ytSearchLink(message);
  const reply = [
    'ما عندي فيديو محدد، لكن تقدر تفتح نتائج يوتيوب مباشرة 👇',
    yt,
    'لو تبيني أضيق البحث، قلّي اسم التمرين بالضبط أو اسم العضلة/الأداة.'
  ].join('\n');
  return res.status(200).json({ reply });
}


    // 1) ابحث في القاعدة
    const matches = searchExercises(message, 4);
    const context = buildContextFromMatches(matches);

    // 2) حضّر رسالة للموديل
    let userMsg = "";
    if (matches.length) {
      userMsg = `سؤال المستخدم: "${message}"
${context}

اكتب للمستخدم ردًا عربيًا بسيطًا وواضحًا:
- لو فيه أكثر من تمرين، اختَر الأنسب واذكر 1-2 بديل.
- أعد صياغة الملاحظات بنقاط قصيرة.
- ضَع الروابط كما هي (لا تعدّلها).
- لا تعطِ نصائح طبية تشخيصية.`;
    } else {
      const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `تمرين ${message}`
      )}`;
      userMsg = `سؤال المستخدم: "${message}"
لم نجد تطابقًا في القاعدة. هذا رابط بحث يوتيوب:
${yt}

اكتب ردًا عربيًا مختصرًا:
- اعتذر بلطف لأنه غير موجود في القاعدة.
- أعطِ المستخدم الرابط كما هو (قابل للضغط).
- اقترح عليه يعطيك اسم أدق للتمرين/العضلة/الأدوات.`;
    }

    // 3) System Prompt
    const systemPrompt =
      "أنت مدرب لياقة ذكي يتحدث العربية بوضوح وإيجاز. أعطِ خطوات وسلامة أداء مختصرة بدون مبالغة، وتجنّب التشخيص الطبي. حافظ على تنسيق نظيف يصلح للعرض في فقاعة دردشة.";

    // 4) نداء الذكاء والرد
    const reply = await callOpenAI(systemPrompt, userMsg);
    return res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
};
