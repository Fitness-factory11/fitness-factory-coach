// api/chat.js
import fs from 'fs';
import path from 'path';

function safeLoadExercises() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'exercises.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse error in exercises.json:', e?.message);
      return [];
    }
  } catch (e) {
    console.warn('exercises.json not found or unreadable, using empty list.');
    return [];
  }
}

let EXES = safeLoadExercises();

// --- helpers ---
function ytSearchLink(userMsg) {
  const stop = ['ابي','أبي','ابغى','أبغى','ابي رابط','رابط','لينك','يوتيوب','فيديو','لو سمحت','ممكن','تكفى','تكفا','اعطني','عطني','من اليوتيوب','اعطيني','عطيني','تمرين','تماريني'];
  let q = (userMsg || '').toString().trim();
  stop.forEach(w => { q = q.replace(new RegExp(`\\b${w}\\b`, 'giu'), ''); });
  q = q.replace(/\s+/g, ' ').trim();
  if (!q) q = 'تمارين';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

function findExercises(q, k = 5) {
  const query = (q || '').toLowerCase().trim();
  if (!query) return [];
  const score = (ex) => {
    const bag = [
      ex.name_ar, ex.muscle, ex.level,
      ...(ex.equipment || []),
      ...(ex.cues_ar || []),
      ...(ex.alternatives_ar || []),
      ex.video || '', ex.alt_video || ''
    ].join(' ').toLowerCase();
    let s = 0;
    if (bag.includes(query)) s += 3;
    query.split(/\s+/).forEach(w => { if (w && bag.includes(w)) s += 1; });
    return s;
  };
  return EXES
    .map(ex => ({ ex, s: score(ex) }))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .slice(0, k)
    .map(x => x.ex);
}

// --- handler ---
export default async function handler(req, res) {
  // تأكد دائمًا أنّنا بنرجّع JSON
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'method_not_allowed' });
    }

    const body = req.body;
    const message = typeof body === 'object' ? body?.message : undefined;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok:false, error:'no_message' });
    }

    // ابحث أولاً في القاعدة
    const top = findExercises(message, 3);
    if (top.length) {
      const lines = top.map((ex, i) => {
        const vids = [ex.video, ex.alt_video].filter(Boolean);
        const v = vids.length ? `روابط: ${vids.join(' ، ')}` : 'لا يوجد فيديو';
        const cues = (ex.cues_ar || []).join('، ');
        return `**${i+1}) ${ex.name_ar}** — عضلة: ${ex.muscle} — مستوى: ${ex.level}
ملاحظات: ${cues || '—'}
بدائل: ${(ex.alternatives_ar || []).join('، ') || '—'}
${v}`;
      }).join('\n\n');

      return res.status(200).json({
        ok: true,
        reply: `أفضل ما وجدته لك من القاعدة:\n\n${lines}`
      });
    }

    // مافيه تطابق: جهّز بحث يوتيوب
    const yt = ytSearchLink(message);

    // جرّب OpenAI إن وجد (بدون إسقاط الرد لو فشل)
    const hasKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10);
    if (hasKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            input: [
              `مستخدم سأل: "${message}".`,
              `إذا ما فيه تمرين محدد في القاعدة، اعطه وصف تمرين مناسب باختصار (4-6 أسطر) ونبّه على السلامة.`,
              `لو احتجت فيديو خارجي لا تعط رابط مباشر—اعطه رابط بحث نظيف فقط: ${yt}`
            ].join('\n')
          })
        });

        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          const text =
            d?.output?.[0]?.content?.[0]?.text ||
            d?.output_text ||
            '';
          if (text) {
            return res.status(200).json({
              ok: true,
              reply: text + `\n\nرابط بحث يوتيوب: ${yt}`
            });
          }
        } else {
          console.warn('OpenAI returned non-OK status:', r.status);
        }
      } catch (e) {
        console.warn('OpenAI call failed:', e?.message);
      }
    }

    // بديل آمن دائمًا
    return res.status(200).json({
      ok: true,
      reply: [
        'ما وجدت تمرين مطابق في القاعدة.',
        'تقدر تشوف نتائج يوتيوب مباشرة 👇',
        yt,
        'لو تبيني أضيق، قلّي اسم التمرين/العضلة/الأداة بدقة أكثر.'
      ].join('\n')
    });

  } catch (err) {
    // لا ترجع HTML أبدًا — رجّع JSON حتى في أسوأ الحالات
    console.error('API /chat fatal error:', err);
    return res.status(200).json({
      ok: false,
      error: 'internal_error',
      detail: err?.message || String(err)
    });
  }
}
