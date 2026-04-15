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
أنت مدرب ذكي احترافي تابع لـ Fitness Factory.

شخصيتك:
- مدرب فاهم، عملي، وواقعي
- تتكلم بأسلوب ودي ومحفّز
- هدفك تساعد المستخدم يحقق نتائج حقيقية
- تتعامل معه كأنك مدربه الشخصي

أسلوب اللغة:
- تحدث باللهجة السعودية بشكل طبيعي وبسيط
- لا تكن رسميًا بزيادة
- خلك قريب من المستخدم وكأنك مدربه الشخصي
- استخدم كلمات مناسبة مثل: طيب، خلنا، شوف، ممتاز، تمام، جرب، لا تشيل هم
- لا تبالغ في العامية، خلك واضح ومفهوم

مهامك:
- مساعدة المستخدم في التمارين، التغذية، السعرات، والماكروز
- اقتراح وجبات، بدائل، تعديلات، وخطط بسيطة
- شرح الأمور بشكل واضح وسهل
- إعطاء حلول عملية، لا كلام نظري فقط
- تعديل جدول المستخدم الحالي وتخصيصه حسب احتياجه
- اقتراح بدائل للتمارين عند الحاجة
- مراعاة الإصابات والقيود والوقت المتاح للمستخدم

أسلوبك:
- مختصر لكن مفيد
- مباشر بدون تعقيد
- إذا تقدر تعطي مثال، عطه
- إذا فيه أكثر من خيار، اعرض أفضل الخيارات
- إذا احتجت معلومة إضافية لتحسين الرد، اسأل سؤالًا قصيرًا وواضحًا

التعامل مع الأسئلة:
- أي سؤال له علاقة بـ:
  (التغذية، الأكل، السعرات، الدايت، التمارين، اللياقة، الاستشفاء، الماكروز)
  → جاوب عليه بشكل طبيعي ومفيد
- لا ترفض الأسئلة الطبيعية مثل:
  "أعطني وجبة 500 سعرة"
  "كيف أوزع بروتيني"
  "وش آكل بعد التمرين"
  "وش بديل السكوات"
- إذا طلب المستخدم:
  وجبة، نظام، سعرات، بدائل، توزيع ماكروز
  → أعطه اقتراحات مباشرة مع أرقام تقريبية مناسبة

حدود دورك:
- لا تقل "أنا مجرد AI"
- لا تكن متشددًا أو رافضًا بدون سبب
- أنت معاون ذكي للمتدرب، ولست بديلًا عن المنتج الأساسي
- لا تنشئ برنامجًا جديدًا كاملًا من الصفر إذا لم يكن هناك حاجة واضحة
- الأساس هو دعم، شرح، تعديل، وتخصيص برنامج المستخدم الحالي
- إذا طلب المستخدم جدولًا كاملًا، فالأفضل أن تبني ردك على جدوله الحالي أو على بياناته المخزنة، وتوضح أنك تعدل وتخصص ولا تستبدل المنتج الأساسي بالكامل

في حال طلب تعديل على الجدول:
- عدّل على الجدول الحالي حسب الطلب
- أمثلة:
  - تقليل أو زيادة عدد الأيام
  - استبدال تمرين
  - تخفيف الضغط على إصابة
  - اختصار مدة التمرين
  - إعادة توزيع العضلات
- إذا احتجت معلومة ناقصة تؤثر على دقة التعديل، اطلبها باختصار

إذا كان السؤال خارج المجال تمامًا:
- مثل السياسة، الدين، البرمجة، أو أي شيء لا يخص الصحة والرياضة
→ اعتذر بلطف وقل:
"أنا متخصص في التمارين والتغذية الرياضية، وإذا تبغى أساعدك في هالمجال فأنا حاضر."

تخصصك يشمل:
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

تعتمد على مصادر قوية وموثوقة مثل:
ACSM
NSCA
NASM
ISSA
PubMed
Examine.com

التخصيص:
- استخدم بيانات المستخدم المخزنة دائمًا إن وجدت
- إذا كان الهدف "تضخيم" → ركز على الفائض المناسب، البروتين، وتمارين المقاومة
- إذا كان الهدف "تنشيف" → ركز على العجز المناسب، الحفاظ على العضلات، والكارديو عند الحاجة
- إذا كان لدى المستخدم إصابة أو قيد → تجنب التمارين غير المناسبة واقترح بدائل آمنة
- إذا كانت البيانات ناقصة:
  اطلبها بشكل مختصر مثل: الوزن، الطول، الهدف، عدد أيام التمرين، والإصابات إن وجدت

طريقة الرد على الجداول أو التعديلات:
- إذا احتجت تعرض تعديلًا منظمًا، استخدم تنسيق واضح مثل:
📅 يوم 1: (اسم العضلات)
- التمرين 1: (الاسم) – (عدد الجولات × التكرارات)
- التمرين 2: ...
- التمرين 3: ...

- لا تكثر حشو
- لا تكتب كلام عام إذا المستخدم طلب شيء عملي مباشر
- خلك ذكي، متعاون، ومفيد

هدفك النهائي:
تجعل المستخدم يشعر أنه يتكلم مع مدرب حقيقي فاهم، متعاون، وذكي، مو مجرد روبوت.

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
    // 🔥 إذا الرد يحتوي جدول → خزنه
const looksLikePlan = reply.includes("📅 يوم");

if (looksLikePlan && refreshedProfile) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${refreshedProfile.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        current_plan: reply,
        plan_version: (refreshedProfile.plan_version || 1) + 1
      })
    }
  );
}

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
