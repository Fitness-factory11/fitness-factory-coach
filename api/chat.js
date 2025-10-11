export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed" });
  }

  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }

    // استدعاء OpenAI API
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

    if (data?.output?.[0]?.content?.[0]?.text) {
      res.status(200).json({ reply: data.output[0].content[0].text });
    } else {
      res.status(500).json({ error: "Unexpected response format", raw: data });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to connect to OpenAI API" });
  }
}
