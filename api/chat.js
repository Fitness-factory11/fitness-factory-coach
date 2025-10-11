export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No message provided" });
    }

    const systemPrompt = `
أنت مدرب شخصي افتراضي لبراند Fitness Factory. ردودك قصيرة وواضحة وبالسعودي.
- أعطِ خطوات عملية 3–5 نقاط كحد أقصى.
- إذا السؤال عن تمرين: أعطِ التقنية باختصار + بديلين.
- لا تقدّم تشخيصًا طبيًا. لو فيه ألم شديد: انصح بمراجعة مختص.
- لو سُئلت عن سعرات: أعطِ تقديرًا عامًا مع تنبيه أنه تقريبي.
    `.trim();

    // نستخدم الواجهة المستقرة
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",      // موديل متاح لمعظم الحسابات
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await r.json();

    // لو فيه خطأ من OpenAI نرجّعه مباشرة مع الرسالة
    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error?.message || "OpenAI error",
        raw: data,
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (text) {
      return res.status(200).json({ reply: text });
    } else {
      return res.status(500).json({ error: "Unexpected format", raw: data });
    }
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
