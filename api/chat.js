// /api/chat.js — يقرأ قاعدة التمارين ويضيفها كسياق للرد
import fs from "fs";
const exercises = JSON.parse(fs.readFileSync("./data/exercises.json", "utf8"));
function searchExercises(query, k = 5){
  const q = (query || "").toLowerCase();
  if (!q) return [];
  const score = (ex) => {
    const hay = [
      ex.name_ar, ex.muscle, ex.level, ...(ex.equipment || []),
      ...(ex.cues_ar || []), ...(ex.alternatives_ar || [])
    ].join(" ").toLowerCase();
    let s = 0;
    if (hay.includes(q)) s += 3;
    q.split(/\s+/).forEach(w => { if (w && hay.includes(w)) s += 1; });
    return s;
  };
  return exercises
    .map(ex => ({ ex, s: score(ex) }))
    .filter(x => x.s > 0)
    .sort((a,b)=> b.s - a.s)
    .slice(0, k)
    .map(x => x.ex);
}

function buildContext(userMsg){
  const top = searchExercises(userMsg, 5);
  if (!top.length) return "";
  const lines = top.map((ex, i) => {
    const vids = [ex.video, ...(ex.alt_videos || [])].filter(Boolean);
    const vidsLine = vids.length ? `روابط: ${vids.join(" , ")}` : "روابط: لا يوجد";
    return (
      `#${i+1} ${ex.name_ar} — عضلة: ${ex.muscle} — مستوى: ${ex.level}\n` +
      `الملاحظات: ${(ex.cues_ar||[]).join("، ")}\n` +
      `بدائل: ${(ex.alternatives_ar||[]).join("، ")}\n` +
      `${vidsLine}`
    );
  }).join("\n\n");
  return `\n[سياق تمارين من قاعدة Fitness Factory]\n${lines}\n[انتهى السياق]\n`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST" });
  try {
    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "No message" });

    const context = buildContext(message);

    const systemPrompt = `
أنت مدرب شخصي افتراضي لبراند Fitness Factory. ردودك قصيرة وواضحة وبالسعودي:
- قدّم 3–5 نقاط عملية فقط.
- إن توفّر "سياق تمارين" أعلاه فاستخدمه أولًا (الاسم/العضلة/الملاحظات/البدائل/الروابط).
- لا تشخّص طبيًا. في ألم قوي: نصيحة مراجعة مختص.
- حساب السعرات تقديري مع تنبيه أنه تقريبي.
`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          ...(context ? [{ role: "system", content: context }] : []),
          { role: "user", content: message }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "OpenAI error", raw: data });
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ? res.status(200).json({ reply: text }) : res.status(500).json({ error: "Unexpected format", raw: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
