// /api/chat.js
import fs from "fs";
import path from "path";

// تحميل قاعدة التمارين
const filePath = path.join(process.cwd(), "data", "exercises.json");
let EXERCISES = [];
try {
  EXERCISES = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (e) {
  console.error("Failed to read exercises.json:", e);
  EXERCISES = [];
}

/* ---------------------- أدوات مساعدة ---------------------- */

// تبسيط النص العربي + lowercase (بحث أذكى)
function norm(s = "") {
  return (s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\u0600-\u06FF\w\s]/g, " ")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

// استخراج كلمات بحث نظيفة لليوتيوب (نشيل كلمات عامة)
function toYtQuery(userMsg = "") {
  const stopWords = [
    "ابي", "ابغى", "ابي", "ابغا", "اريد", "محتاج", "ابي رابط", "لينك", "فيديو", "يوتيوب",
    "عطني", "اعطني", "لو سمحت", "من فضلك", "بحث", "تمرين", "تمارين", "عن", "صور", "شرح",
    "كيف", "وش", "ايش", "افضل", "لي", "بديل", "بدائل", "رابط يوتيوب",
  ];
  const words = norm(userMsg).split(" ").filter(Boolean);
  const filtered = words.filter((w) => !stopWords.includes(w));
  // لو فاضية، نرجع الكلمات الأصلية كحل أخير
  return filtered.length ? filtered.join(" ") : words.join(" ");
}

function ytSearchLink(userMsg = "") {
  const q = toYtQuery(userMsg) || "تمارين";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

// بحث في قاعدة التمارين (score بسيط)
function searchExercises(query, k = 5) {
  const q = norm(query);
  if (!q) return [];

  return EXERCISES.map((ex) => {
    const hay = [
      ex.name_ar || "",
      ex.muscle || "",
      ex.level || "",
      (ex.equipment || []).join(" "),
      (ex.cues_ar || []).join(" "),
      (ex.alternatives_ar || []).join(" "),
    ]
      .map(norm)
      .join(" ");

    let s = 0;
    if (hay.includes(q)) s += 3;
    q.split(/\s+/).forEach((w) => (hay.includes(w) ? (s += 1) : null));
    return { score: s, ex };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.ex);
}

function briefExercise(ex) {
  const cues = (ex.cues_ar || []).slice(0, 2).join("؛ ");
  const alt = (ex.alternatives_ar || []).slice(0, 1).join("، ");
  const vids = [ex.video, ex.alt_video].filter(Boolean);
  const vidsLine = vids.length ? `روابط: ${vids.join(" | ")}` : "روابط: لا يوجد";
  return (
    `• ${ex.name_ar} — عضلة: ${ex.muscle} — مستوى: ${ex.level}\n` +
    `ملاحظات: ${cues || "—"}\n` +
    (alt ? `بدائل: ${alt}\n` : "") +
    vidsLine
  );
}

/* ---------------------- OpenAI ---------------------- */

async function askOpenAI({ message, topEx = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const sys =
      "أنت مدرب شخصي سعودي مختصر ومهذب. اجعل إجاباتك عملية وقصيرة وواضحة. " +
      "إن سأل المستخدم عن تمرين موجود في قاعدة البيانات أدناه، قدّم له ملخصًا سريعًا. " +
      "لا تضع روابط خارجية إلا لو طلبها صراحة.";

    const context =
      topEx.length > 0
        ? "تمارين محتملة:\n" +
          topEx.map((e, i) => `${i + 1}) ${briefExercise(e)}`).join("\n\n")
        : "لا توجد تمارين مطابقة في القاعدة.";

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: sys },
          { role: "user", content: `رسالة المستخدم: ${message}` },
          { role: "user", content: context },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("OpenAI error:", resp.status, txt);
      return null;
    }

    const data = await resp.json();
    const text =
      data.output_text ||
      (data.output?.[0]?.content?.[0]?.text?.value ?? "");
    return (text || "").trim() || null;
  } catch (e) {
    console.error("OpenAI call failed:", e);
    return null;
  }
}

/* ---------------------- Handler ---------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No message provided" });
    }

    // 1) لو طلب روابط/يوتيوب صراحة → نعطيه رابط احترافي + إرشاد بسيط
    const wantsLinks = /\b(يوتيوب|رابط|لينك|فيديو)\b/iu.test(message);
    if (wantsLinks) {
      const yt = ytSearchLink(message);
      const reply =
        "هذه نتائج يوتيوب المقترحة 👇\n" +
        yt +
        "\n\n" +
        "لو تبيني أضيق البحث: اكتب اسم التمرين بالضبط أو العضلة/الأداة.";
      return res.status(200).json({ reply });
    }

    // 2) ابحث في قاعدة التمارين
    const top = searchExercises(message, 3);

    if (top.length > 0) {
      // ملخص لطيف من القاعدة (يظهر الروابط لو موجودة)
      const reply =
        "اقتراحاتي من قاعدة البيانات:\n\n" +
        top.map(briefExercise).join("\n\n") +
        "\n\n" +
        "تحتاج فيديو إضافي؟ اكتب: رابط تمرين + اسم التمرين (أو قل: يوتيوب تمرين ...).";
      return res.status(200).json({ reply });
    }

    // 3) ما لقيْنا مطابقًا في القاعدة → جرّب OpenAI (إن توفر)
    const ai = await askOpenAI({ message, topEx: [] });
    if (ai) {
      // نُرفق أيضًا رابط بحث يوتيوب محترم
      const reply = `${ai}\n\nنتائج يوتيوب المقترحة 👇\n${ytSearchLink(message)}`;
      return res.status(200).json({ reply });
    }

    // 4) لو ما فيه OpenAI أو فشل → fallback محترم
    const reply =
      "ما وجدت تمرين مطابق في القاعدة.\n" +
      "تقدر تشوف نتائج يوتيوب مباشرة 👇\n" +
      ytSearchLink(message) +
      "\n\n" +
      "لو تبيني أحدد لك تمرين بعينه: اكتب اسم التمرين أو العضلة/الأداة بدقة أكثر.";
    return res.status(200).json({ reply });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({
      reply: "صار خطأ بسيط بالاتصال، حاول مجددًا 🙏",
    });
  }
}
