// api/chat.js
import path from "path";
import fs from "fs";

const filePath = path.join(process.cwd(), "data", "exercises.json");
const exercises = JSON.parse(fs.readFileSync(filePath, "utf8"));

/*==================== 1) أدوات البحث المحلي ====================*/
function scoreExercise(q, ex) {
  const hay = [
    ex.name_ar, ex.muscle, ex.level,
    ...(ex.equipment || []), ...(ex.cues_ar || []),
    ...(ex.alternatives_ar || [])
  ].join(" ").toLowerCase();
  if (!q) return 0;
  let s = 0;
  if (hay.includes(q)) s += 3;
  q.split(/\s+/).forEach(w => { if (w && hay.includes(w)) s += 1; });
  return s;
}
function searchExercises(query, k = 5) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return [];
  return exercises
    .map(ex => ({ ex, s: scoreExercise(q, ex) }))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .slice(0, k)
    .map(x => x.ex);
}

/*==================== 2) رابط بحث يوتيوب احتياطي ====================*/
function toYtQuery(userMsg) {
  const stop = [
    "ابي","أبي","ابغى","أبغى","ابغا","أبغا","لو","ممكن","سمعت",
    "رابط","لينك","يوتيوب","فيديو","اعطني","عطني","ابي رابط","ابغى رابط",
    "تمرين","تمارين"
  ];
  const words = userMsg
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/)
    .filter(w => w && !stop.includes(w))
    .slice(0, 6);               // نخليها قصيرة
  if (words.length === 0) return "تمارين";
  return words.join(" ");
}
function ytSearchLink(userMsg){
  const q = encodeURIComponent(toYtQuery(userMsg));
  return `https://www.youtube.com/results?search_query=${q}`;
}

/*==================== 3) سؤال الـLLM (OpenAI) ====================*/
async function askLLM(context, userMsg) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) return null; // لو المفتاح غير متوفر، رجّع null واستخدم الرد البسيط

  const sys = [
    "أنت مدرّب لياقة عربي محترف.",
    "جاوب باختصار ووضوح وبنقاط، وبدون تنميق زائد.",
    "لا تخترع روابط. لو ما عندك رابط من السياق، لا تضع أي URL.",
    "لو السؤال خارج التمارين/التغذية، اعتذر بلطف واطلب توضيح.",
  ].join("\n");

  const ctx = context?.length
    ? `هذه تمارين من قاعدة البيانات (استخدمها فقط إن كانت مناسبة للسؤال):\n` +
      context.map((ex,i) => (
        `- ${i+1}) ${ex.name_ar} — عضلة: ${ex.muscle} — مستوى: ${ex.level}` +
        (ex.cues_ar?.length ? ` — ملاحظات: ${ex.cues_ar.join("، ")}` : "")
      )).join("\n")
    : "لا توجد تمارين مناسبة في السياق.";

  const body = {
    model,
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content:
        `سؤال المستخدم: """${userMsg}"""\n\n${ctx}\n\nاكتب الرد بالعربية وبصيغة ودودة.` }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) return null;
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

/*==================== 4) الهاندلر الرئيسي ====================*/
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST requests are allowed" });

  try {
    const { message } = req.body || {};
    if (!message || !message.trim())
      return res.status(400).json({ error: "No message provided" });

    // 1) جرّب قاعدة التمارين
    const matches = searchExercises(message, 5);

    // 2) جرّب LLM (إن توفر المفتاح)
    const llmAnswer = await askLLM(matches, message);

    if (llmAnswer) {
      // عندنا رد احترافي من LLM. لو ما فيه نتائج، أرفق رابط بحث يوتيوب من عندنا.
      if (matches.length === 0) {
        const yt = ytSearchLink(message);
        const final = `${llmAnswer}\n\n> ابحث في يوتيوب: ${yt}`;
        return res.status(200).json({ reply: final });
      }
      // وإلا، رجّع رد LLM كما هو (من السياق)
      return res.status(200).json({ reply: llmAnswer });
    }

    // 3) لو ما فيه مفتاح أو فشل LLM:
    if (matches.length > 0) {
      // رد بسيط مبني على القاعدة
      const lines = matches.map((ex,i) => {
        const cues = ex.cues_ar?.length ? `ملاحظات: ${ex.cues_ar.join("، ")}` : "";
        const vids = [ex.video, ex.alt_video].filter(Boolean);
        const vidsLine = vids.length ? `روابط مفيدة: ${vids.join(" ، ")}` : "لا يوجد روابط";
        return `• ${ex.name_ar} — عضلة: ${ex.muscle} — مستوى: ${ex.level}\n${cues}\n${vidsLine}`;
      }).join("\n\n");
      return res.status(200).json({
        reply: `إليك أفضل ما وجدت:\n\n${lines}`
      });
    }

    // 4) لا توجد نتائج → رابط بحث يوتيوب نظيف من دون “أبي رابط…”
    const yt = ytSearchLink(message);
    return res.status(200).json({
      reply: `ما لقيت تمرين مطابق في القاعدة.\nتقدر تفتح نتائج يوتيوب مباشرة:\n${yt}`
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
