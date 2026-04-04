export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const data = req.body;

    console.log("Webhook received:", data);

    // 👇 هنا بنسحب بيانات الطلب
    const order = data.data;

    const customerName = order.customer?.name;
    const customerPhone = order.customer?.mobile;
    const product = order.items?.[0];

    const productId = product?.product_id;

    console.log("Product ID:", productId);

    // 🚀 الخطوة الجاية:
    // نجيب البرنامج من products_mapping (بنسويها بعد شوي)

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
