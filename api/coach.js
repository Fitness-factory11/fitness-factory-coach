export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      reply: "إعدادات السيرفر ناقصة. تأكد من متغيرات البيئة."
    });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    const { message, activationCode } = req.body;

    if (!message || !activationCode) {
      return res.status(400).json({
        reply: "الرسالة أو كود التفعيل غير موجود."
      });
    }

    const code = activationCode.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);

    // 1) تحقق من كود التفعيل
    const activationRes = await fetch(
      `${SUPABASE_URL}/rest/v1/activation_codes?code=eq.${encodeURIComponent(code)}&select=id,code,status,device_fingerprint`,
      { headers }
    );

    const activationData = await activationRes.json();

    if (!activationData || !activationData.length) {
      return res.status(403).json({
        reply: "كود التفعيل غير صحيح."
      });
    }

    const activation = activationData[0];

    if (activation.status !== "activated") {
      return res.status(403).json({
        reply: "هذا الكود غير مفعل بعد."
      });
    }

    // 2) تحقق من الحد اليومي
    const usageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_usage?activation_code=eq.${encodeURIComponent(code)}&usage_date=eq.${today}&select=id,message_count`,
      { headers }
    );

    const usageData = await usageRes.json();
    let currentCount = 0;

    if (usageData && usageData.length) {
      currentCount = usageData[0].message_count || 0;
    }

    if (currentCount >= 35) {
      return res.status(429).json({
        reply: "وصلت للحد اليومي المسموح وهو 35 رسالة. ارجع بكرة أو تواصل مع الدعم."
      });
    }

    // 3) اقرأ ملف المستخدم
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?activation_code=eq.${encodeURIComponent(code)}&select=*`,
      { headers }
    );

    const profileData = await profileRes.json();
    const profile = profileData && profileData.length ? profileData[0] : null;

    // 4) استخراج بيانات العميل من رسالته عبر AI
    const extractionPrompt = `
استخرج بيانات اللياقة فقط من رسالة المستخدم وأعدها كـ JSON صالح فقط بدون أي شرح.

المفاتيح المطلوبة:
{
  "full_name": string|null,
  "age": number|null,
  "height_cm": number|null,
  "weight_kg": number|null,
  "goal": string|null,
  "training_days": number|null,
  "level": string|null,
  "injuries": string|null,
  "last_context": string|null
}

تعليمات:
- إذا لم تجد قيمة، أرجع null.
- goal أمثلة: تضخيم / تنشيف / الحفاظ على الوزن / زيادة اللياقة
- level أمثلة: مبتدئ / متوسط / متقدم
- last_context يكون ملخص عربي قصير جدًا لأهم ما فهمته من المستخدم.
- أخرج JSON فقط.
`;

    const extractionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: extractionPrompt },
          { role: "user", content: message }
        ]
      })
    });

    const extractionData = await extractionRes.json();

    let extracted = {
      full_name: null,
      age: null,
      height_cm: null,
      weight_kg: null,
      goal: null,
      training_days: null,
      level: null,
      injuries: null,
      last_context: null
    };

    if (extractionRes.ok) {
      try {
        const raw = extractionData?.choices?.[0]?.message?.content || "{}";
        extracted = JSON.parse(raw);
      } catch (e) {
        console.error("JSON parse error:", e);
      }
    }

    // 5) حفظ/تحديث بيانات العميل إذا وجدنا شيء مفيد
    const hasUsefulData = Object.values(extracted).some(
      (v) => v !== null && v !== ""
    );

    if (hasUsefulData) {
      const mergedProfile = {
        activation_code: code,
        full_name: extracted.full_name ?? profile?.full_name ?? null,
        age: extracted.age ?? profile?.age ?? null,
        height_cm: extracted.height_cm ?? profile?.height_cm ?? null,
        weight_kg: extracted.weight_kg ?? profile?.weight_kg ?? null,
        goal: extracted.goal ?? profile?.goal ?? null,
        training_days: extracted.training_days ?? profile?.training_days ?? null,
        level: extracted.level ?? profile?.level ?? null,
        injuries: extracted.injuries ?? profile?.injuries ?? null,
        current_plan: profile?.current_plan ?? null,
        last_context: extracted.last_context ?? profile?.last_context ?? null,
        plan_version: profile?.plan_version ?? 1,
        updated_at: new Date().toISOString()
      };

      if (!profile) {
        mergedProfile.created_at = new Date().toISOString();

        await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
          method: "POST",
          headers,
          body: JSON.stringify(mergedProfile)
        });
      } else {
        await fetch(
          `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${profile.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify(mergedProfile)
          }
        );
      }
    }

    // 6) اقرأ الملف مرة ثانية بعد التحديث
    const refreshedProfileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?activation_code=eq.${encodeURIComponent(code)}&select=*`,
      { headers }
    );

    const refreshedProfileData = await refreshedProfileRes.json();
    const refreshedProfile =
      refreshedProfileData && refreshedProfileData.length
        ? refreshedProfileData[0]
        : profile;

    const profileSummary = refreshedProfile
      ? `
بيانات العميل الحالية:
- الاسم: ${refreshedProfile.full_name || "غير محدد"}
- العمر: ${refreshedProfile.age || "غير محدد"}
- الطول: ${refreshedProfile.height_cm || "غير محدد"} سم
- الوزن: ${refreshedProfile.weight_kg || "غير محدد"} كجم
- الهدف: ${refreshedProfile.goal || "غير محدد"}
- عدد أيام التمرين: ${refreshedProfile.training_days || "غير محدد"}
- المستوى: ${refreshedProfile.level || "غير محدد"}
- الإصابات/القيود: ${refreshedProfile.injuries || "لا يوجد"}
- الجدول الحالي: ${refreshedProfile.current_plan || "غير محفوظ بعد"}
- آخر سياق: ${refreshedProfile.last_context || "لا يوجد"}
- إصدار الجدول: ${refreshedProfile.plan_version || 1}
`
      : `
لا توجد بيانات محفوظة لهذا العميل حتى الآن.
إذا احتجت بناء خطة دقيقة، اطلب منه:
الاسم - العمر - الطول - الوزن - الهدف - عدد أيام التمرين - المستوى - الإصابات - اسم أو نوع الجدول الحالي.
`;

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
- تعديل برامج التمرين
- اقتراح بدائل للتمارين

تعتمد على مصادر علمية قوية مثل:
ACSM
NSCA
NASM
ISSA
PubMed
Examine.com

قواعد مهمة:
- أجب بالعربية فقط.
- لا تخرج عن مجال الفتنس والتغذية الرياضية.
- إذا كان السؤال خارج المجال قل:
"أنا متخصص في الفتنس والتغذية الرياضية فقط."
- كن واضحًا وعمليًا ومباشرًا.
- إذا طلب المستخدم تعديل جدوله، فعدل له بناءً على عدد الأيام أو الهدف أو القيود المتاحة.
- إذا كانت بياناته ناقصة وتؤثر على دقة الجواب، اطلبها منه باختصار.
- تعامل مع البيانات المحفوظة كمرجع أساسي للمستخدم.

${profileSummary}
`;

    // 7) اسأل OpenAI للرد النهائي
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      })
    });

    const openaiData = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("OpenAI error:", openaiData);
      return res.status(500).json({
        reply: "صار خطأ في الاتصال بالذكاء الصناعي."
      });
    }

    const reply = openaiData?.choices?.[0]?.message?.content || "لم أستطع توليد الرد.";

    // 8) زيادة عداد الاستخدام
    if (!usageData || !usageData.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/daily_usage`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          activation_code: code,
          usage_date: today,
          message_count: 1
        })
      });
    } else {
      await fetch(
        `${SUPABASE_URL}/rest/v1/daily_usage?id=eq.${usageData[0].id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            message_count: currentCount + 1
          })
        }
      );
    }

    // 9) حفظ الجلسة
    await fetch(`${SUPABASE_URL}/rest/v1/coach_sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        activation_code: code,
        question: message,
        answer: reply
      })
    });

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      reply: "حدث خطأ داخلي في السيرفر."
    });
  }
}
