import fs from "fs";
import path from "path";

// تحميل القاعدة
const filePath = path.join(process.cwd(), "data", "exercises.json");
const exercises = JSON.parse(fs.readFileSync(filePath, "utf8"));

// أدوات مساعدة
function normalizeArabic(s = "") {
  return s
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreExercise(ex, q) {
  const hay = [
    ex.name_ar || "",
    ex.muscle || "",
    ex.level || "",
    ...(ex.cues_ar || []),
    ...(ex.alternatives_ar || []),
  ]
    .join(" ")
    .toLowerCase();

  let s = 0;
  if (!q) return 0;
  if (hay.includes(q)) s += 5;
  q.split(/\s+/).forEach((w) => {
    if (w.length > 1 && hay.includes(w)) s += 1;
  });
  return s;
}

function searchExercises(query, k = 5) {
  const q = normalizeArabic(query);
  if (!q) return [];
  return exercises
    .map((ex) => ({ ex, s: scoreExercise(ex, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.ex);
}

function toYtQuery(userMsg) {
  // شيل الكلام العام من رسالة المستخدم
  const stopWords = [
    "ابي", "ابغى", "ابغا", "بغى", "ابي", "تمرين", "تمارين", "رابط",
    "يوتيوب", "لينك", "فيديو", "اعطني", "عطني", "لو سمحت", "ممكن",
    "سوي", "ابغا", "ابي رابط", "يوتيوب", "من", "على", "بحث", "عن"
  ];
  const words = normalizeArabic(userMsg)
    .split(" ")
    .filter((w) => w && !stopWords.includes(w));
  // إذا طلع فارغ، رجّع الكلمات الأصلية بعد التطبيع (أفضل من لا شيء)
  return words.length ? words.join(" ") : normalizeArabic(userMsg);
}

function getBaseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] ||
      req.headers["x-forwarded-protocol"] ||
      "https").toString();
  const host = req.headers.host;
  return `${proto}://${host}`;
}

// ——————————————————————————————

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST" });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.toString().trim()) {
      return res.status(400).json({ error: "No message" });
    }

    const userMsg = message.toString();
    const baseUrl = getBaseUrl(req);

    // 1) حاول من القاعدة
    const hits = searchExercises(userMsg, 3);

    if (hits.length > 0) {
      const parts = hits.map((ex, i) => {
        const videos = [ex.video, ...(ex.alt_video ? [ex.alt_video] : [])]
          .filter(Boolean);
        const vidsLine =
          videos.length > 0
            ? `روابط: ${videos.join(" , ")}`
            : "روابط: لا يوجد";
        const cues =
          ex.cues_ar && ex.cues_ar.length ? `ملاحظات: ${ex.cues_ar.join(" • ")}` : "";

        return [
          `#${i + 1}) ${ex.name_ar} • عضله: ${ex.muscle} • مستوى: ${ex.level}`,
          cues,
          vidsLine,
        ]
          .filter(Boolean)
          .join("\n");
      });

      const reply =
        `من القاعدة عندي هذه الأنسب لسؤالك:\n\n${parts.join(
          "\n\n"
        )}\n\nإذا تبي شكل فيديو، هذا بحث سريع: ${baseUrl}/api/yt?q=${encodeURIComponent(
          toYtQuery(userMsg)
        )}`;

      return res.status(200).json({ reply });
    }

    // 2) لو كلمات "يوتيوب/رابط" أو ما في مطابقات —> أعطي رابط يوتيوب مختصر
    if (/\b(يوتيوب|رابط|لينك|فيديو)\b/iu.test(userMsg) || hits.length === 0) {
      const q = toYtQuery(userMsg);
      const shortLink = `${baseUrl}/api/yt?q=${encodeURIComponent(q)}`;
      const reply = [
        "ما وجدت تمرين مطابق في القاعدة.",
        "تقدر تشوف نتائج يوتيوب مباشرة 👇",
        shortLink,
        "لو تبي أحدد لك تمرين بعينه: اكتب اسم التمرين/العضلة/الأداة بدقة أكثر.",
      ].join("\n");
      return res.status(200).json({ reply });
    }

    // افتراضي (ما يوصل غالبًا)
    return res.status(200).json({
      reply:
        "ابعث لي اسم التمرين/العضلة بدقة أكثر، أو اكتب: (رابط يوتيوب + اسم التمرين).",
    });
  } catch (e) {
    console.error("Error:", e);
    return res
      .status(500)
      .json({ error: "Server error", hint: "check server logs" });
  }
}
