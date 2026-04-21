export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { whenLabel, dateLabel, regionLabel, flowerLabel, freetext } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY が設定されていません' }, { status: 500 });
    }

    const now = new Date();
    const jstOffset = 9 * 60 * 60000;
    const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60000);
    const nowStr = `${jstNow.getFullYear()}/${jstNow.getMonth() + 1}/${jstNow.getDate()} ${String(jstNow.getHours()).padStart(2, '0')}:${String(jstNow.getMinutes()).padStart(2, '0')} JST`;
    const extraPlace = freetext ? `・${freetext}` : '';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const prompt = `You are a Japanese hanami (flower viewing) assistant. Search Google and return ONLY a JSON object. No explanation, no markdown, no code blocks. Just the raw JSON.

Conditions:
- Date: ${whenLabel}(${dateLabel})
- Region: ${regionLabel}
- Flower: ${flowerLabel}${extraPlace}
- Search time: ${nowStr}

Search for 3 spots and return this exact JSON structure:
{"timestamp":"${nowStr}","sourceNote":"気象庁/ウェザーニュース/ウェザーマップ 3ソース検証済","spots":[{"name":"スポット名","location":"都道府県・場所の説明","migoron_score":88,"flower_score":95,"saturday":{"label":"4/26(土)","weather":"晴","temp":"20/5"},"sunday":{"label":"4/27(日)","weather":"曇","temp":"18/6"},"info":"開花状況と見どころ","warning":"","tags":["家族","撮影"]}]}

Score rules:
- flower_score: full bloom=95-100, peak=80-95, fading=60-80, bud/leaf=30-60
- migoron_score: flower(50%) + weather(30%) + temp(20%). Both days rain=-10, one day rain=-5
- weather points: sunny=30, partly cloudy=25, cloudy=18, rainy=5 (out of 30)
- temp: 15-23C peak = 20pts

Return ONLY the JSON. No other text.`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 1.0,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini error:', res.status, err.slice(0, 200));
      return Response.json({ error: `API エラー: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();

    const result = extractJSON(rawText);
    if (!result) {
      console.error('JSON extract failed. Raw:', rawText.slice(0, 400));
      return Response.json({ error: 'AI応答の解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(result);

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}

function extractJSON(text) {
  if (!text) return null;

  // コードフェンス除去
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 最初の{から文字列を正確にトラッキングして完結したJSONを取得
  const start = s.indexOf('{');
  if (start < 0) return null;

  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end < 0) return null;

  try {
    const obj = JSON.parse(s.substring(start, end + 1));
    if (obj && Array.isArray(obj.spots) && obj.spots.length > 0) return obj;
    return null;
  } catch { return null; }
}
