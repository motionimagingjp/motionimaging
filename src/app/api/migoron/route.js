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

    // STEP1: 軽量モデルでGoogle検索+JSON直接生成を試みる
    const step1Url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const step2Url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const jsonTemplate = `{"timestamp":"${nowStr}","sourceNote":"3ソース検証済","spots":[{"name":"スポット名","location":"場所","migoron_score":88,"flower_score":95,"saturday":{"label":"4/26(土)","weather":"晴","temp":"20/5"},"sunday":{"label":"4/27(日)","weather":"曇","temp":"18/6"},"info":"見どころ","warning":"","tags":["家族","撮影"]}]}`;

    const searchPrompt = `${whenLabel}(${dateLabel})に${regionLabel}で${flowerLabel}${extraPlace}を楽しめるお花見スポットを、Google検索で3件調べて以下のJSON形式のみで返してください。説明文不要。

${jsonTemplate}

スコア: flower_score(満開=95-100,見頃=80-95,散り始め=60-80), migoron_score(花50%+天気30%+気温20%), 天気(晴=30,晴曇=25,曇=18,雨=5点/30点), 気温15-23℃=満点
検索時刻: ${nowStr}`;

    const step1Res = await fetch(step1Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 4096 },
      }),
    });

    let result = null;

    if (step1Res.ok) {
      const step1Data = await step1Res.json();
      const parts = step1Data?.candidates?.[0]?.content?.parts || [];
      const rawText = parts.filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();

      // JSON抽出を試みる
      result = tryParseJSON(rawText);
      if (result) {
        return Response.json(result);
      }

      // STEP2: 収集テキストをSTEP2でJSON変換
      const jsonPrompt = `以下の花見情報をJSONのみで返してください。説明文不要。

${rawText}

形式: ${jsonTemplate}`;

      const step2Res = await fetch(step2Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: jsonPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (step2Res.ok) {
        const step2Data = await step2Res.json();
        const rawText2 = (step2Data?.candidates?.[0]?.content?.parts || [])
          .filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();
        result = tryParseJSON(rawText2);
        if (result) {
          return Response.json(result);
        }
      }
    }

    return Response.json({ error: 'AI応答の解析に失敗しました。もう一度お試しください。' }, { status: 500 });

  } catch (error) {
    console.error('API route error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}

function tryParseJSON(text) {
  if (!text) return null;

  // コードフェンス除去
  let s = text;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  // 最初の完結したJSONオブジェクトを抽出(文字列内の括弧を正確にトラッキング)
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
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }

  if (end < 0) return null;

  try {
    const obj = JSON.parse(s.substring(start, end + 1));
    // spotsが配列で1件以上あれば有効
    if (obj && Array.isArray(obj.spots) && obj.spots.length > 0) return obj;
    return null;
  } catch {
    return null;
  }
}
