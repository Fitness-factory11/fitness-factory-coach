import fetch from "node-fetch";

const SUPABASE_URL = "حط رابط مشروعك";
const SUPABASE_KEY = "حط مفتاح anon";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const data = req.body;
    const order = data.data;

    const product = order.items?.[0];
    const productId = product?.product_id;

    // 🔍 نجيب البرنامج من products_mapping
    const mappingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products_mapping?salla_product_id=eq.${productId}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const mappingData = await mappingRes.json();

    if (!mappingData.length) {
      return res.status(400).json({ error: "Product not mapped" });
    }

    const baseProgram = mappingData[0].base_program_key;

    // 🎲 توليد كود عشوائي
    const activationCode =
      "FF-" + Math.random().toString(36).substring(2, 10).toUpperCase();

    // 💾 حفظ في activation_codes
    await fetch(`${SUPABASE_URL}/rest/v1/activation_codes`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: activationCode,
        product_key: baseProgram,
        is_used: false,
      }),
    });

    return res.status(200).json({
      success: true,
      activation_code: activationCode,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
