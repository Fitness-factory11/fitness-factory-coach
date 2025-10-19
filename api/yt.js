export default function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();
    const query = q ? encodeURIComponent(q) : "";
    const url = `https://www.youtube.com/results?search_query=${query}`;
    // Redirection: رابط قصير جميل من مشروعك → يوتيوب
    res.writeHead(302, { Location: url });
    res.end();
  } catch (e) {
    res.status(400).json({ ok: false, error: "Bad query" });
  }
}
