export default async function handler(req, res) {

  const body = req.body
  const message = body.message

  const systemPrompt = `
انت مدرب فتنس احترافي تابع لمتجر Fitness Factory.

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
- تجاوب بالعربية.
- تجاوب كمدرب محترف.
- لا تتكلم في مواضيع خارج الفتنس.
- إذا السؤال خارج المجال قل:
"أنا مختص في الفتنس والتغذية الرياضية فقط."

اجعل الإجابات:
واضحة
عملية
مختصرة لكن مفيدة
  `

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    })
  })

  const data = await response.json()

  res.status(200).json({
    reply: data.choices[0].message.content
  })

}
          
