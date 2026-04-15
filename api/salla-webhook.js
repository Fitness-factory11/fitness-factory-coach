function generateActivationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "FF-";

  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "Missing Supabase environment variables"
    });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    let order;

    // وضع تجريبي فقط
    if (req.method === "GET" && req.query.test === "true") {
      order = {
        id: "TEST-ORDER-001",
        customer: {
          name: "Test Customer",
          mobile: "0500000000"
        },
        items: [
          {
            product_id: "1179095647"
          }
        ]
      };
    } else if (req.method === "POST") {
      const data = req.body;
      order = data?.data || data;
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!order) {
      return res.status(400).json({ error: "No order data received" });
    }

    const product = order.items?.[0];
    const productId = String(product?.product_id || "");

    if (!productId) {
      return res.status(400).json({ error: "No product_id found in order" });
    }

    // 1) نبحث عن المنتج في products_mapping
    const mappingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products_mapping?salla_product_id=eq.${encodeURIComponent(productId)}&select=*`,
      {
        method: "GET",
        headers
      }
    );

    const mappingData = await mappingRes.json();

    if (!mappingRes.ok) {
      return res.status(500).json({
        error: "Failed to read products_mapping",
        details: mappingData
      });
    }

    if (!mappingData.length) {
      return res.status(404).json({
        error: "Product not mapped",
        product_id: productId
      });
    }

    const mappedProduct = mappingData[0];
    const activationCode = generateActivationCode();

    // 2) نحفظ الكود في activation_codes
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/activation_codes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        code: activationCode,
        status: "new",
        product_type: mappedProduct.base_program_key,
        customer_name: order.customer?.name || null,
        customer_phone: order.customer?.mobile || null,
        order_id: String(order.id || `TEST-${Date.now()}`)
      })
    });

    const insertData = await insertRes.json().catch(() => null);

    if (!insertRes.ok) {
      return res.status(500).json({
        error: "Failed to save activation code",
        details: insertData
      });
    }

    return res.status(200).json({
      success: true,
      mode: req.query.test === "true" ? "test" : "live",
      product_id: productId,
      mapped_program: mappedProduct.base_program_key,
      activation_code: activationCode
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({
      error: "Something went wrong",
      details: error.message
    });
  }
}
