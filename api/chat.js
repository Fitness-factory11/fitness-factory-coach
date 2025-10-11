// /api/chat.js  — Vercel Serverless Function

import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No message provided" });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // شخصية المدرب
    const systemPrompt = `
أنت مدرب شخصي افتراضي لبراند Fitness Factory. ردودك قصيرة وواضحة وبالسعودي.
- أعطِ خطوات عملية 3–5 نقاط.
- إذا سُئلت عن تمرين: أعطِ التقنية باختصار + بديلين.
- لا تقدّم تشخيصًا طبيًا. لو فيه ألم شديد: انصح بمراجعة مختص.
- لو سُئلت عن سعرات: أعطِ تقديرًا عامًا مع تنبيه أنه تقريبي.
    `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
    });

    const reply = completion.choices?.[0]?.message?.content || "ما قدرت أرد الحين.";
    return res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
