export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {

    const { message } = req.body;

    const systemPrompt = `
أنت مدرب فتنس احترافي تابع لـ Fitness Factory.

تتخصص فقط في:
- بناء العضلات
- خسارة الدهون
- التمارين المقاومة
- الكارديو
- التغذية الرياضية
- السعرات والماكروز
- استشفاء العضلات
- تقسيم الجداول التدريبية

تعتمد على مصادر علمية مثل:
ACSM
NSCA
NASM
PubMed
Examine.com

القواعد:
- أجب بالعربية.
- لا تجاوب عن أي شيء خارج الفتنس.
- إذا كان السؤال خارج المجال قل:
"أنا متخصص في الفتنس والتغذية الرياضية فقط."
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(500).json({
        reply: "خطأ في الاتصال بالذكاء الصناعي."
      });
    }

    const reply = data.choices?.[0]?.message?.content;

    return res.status(200).json({
      reply: reply || "لم أستطع توليد الرد."
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      reply: "حدث خطأ في السيرفر."
    });

  }

}
