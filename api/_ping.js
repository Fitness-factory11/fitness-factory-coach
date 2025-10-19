// /api/_ping.js
export default function handler(req, res) {
  const hasKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10;
  const masked = hasKey ? process.env.OPENAI_API_KEY.slice(0, 4) + "****" : "NO_KEY";
  return res.status(200).json({
    ok: true,
    hasKey,
    masked,
    vercelEnv: process.env.VERCEL_ENV || "unknown",
  });
}
