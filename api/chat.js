export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "No message provided" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5",
        input: message,
      }),
    });

    const data = await response.json();

    // نحاول نقرأ الرد من كل الصيغ المحتملة
    let text =
      data.output_text ??
      (Array.isArray(data.output)
        ? data.output
            .flatMap((b) =>
              Array.isArray(b.content)
                ? b.content
                    .filter((c) => typeof c.text === "string")
                    .map((c) => c.text)
                : []
            )
            .join(" ")
        : null) ??
      data.choices?.[0]?.message?.content ??
      data.choices?.[0]?.text ??
      null;

    text = (text || "").toString().trim();

    if (text) {
      return res.status(200).json({ reply: text });
    } else {
      // نرجّع الخطأ مع الخام لتشخيص أسرع
      return res
        .status(500)
        .json({ error: "Unexpected response format", raw: data });
    }
  } catch (error) {
    console.error("API error:", error);
    return res.status(500).json({ error: "Failed to connect to OpenAI API" });
  }
}
