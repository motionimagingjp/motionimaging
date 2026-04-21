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

    // STEP1: Google検索で情報収集(テキストで返す)
    const searchPrompt = `以下の条件でお花見スポットを必ず3件調べてください。

条件:
- 日付: ${whenLabel}(${dateLabel})
- 地域: ${regionLabel}
- 花: ${flowerLabel}${extraPlace}
- 検索時刻: ${nowStr}

各スポットについて以下を調べてください:
1. スポット名と所在地
2. 現在の開花状況(満開/見頃/散り始めなど)
3. 土曜・日曜の天気(晴/曇/雨)
4. 最高気温と最低気温
5. 見どころ

必ず3件報告してください。`;

    const step1Res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 3000 },
      }),
    });

    if (!step1Res.ok) {
      const err = await step1Res.text();
      console.error('Step1 error:', step1Res.status, err.slice(0, 200));
      return Response.json({ error: `検索エラー: ${step1Res.status}` }, { status: 500 });
    }

    const step1Data = await step1Res.json();
    const searchResult = (step1Data?.candidates?.[0]?.content?.parts || [])
      .filter(p => typeof p.text === 'string')
      .map(p => p.text)
      .join('')
      .trim();

    if (!searchResult) {
      return Response.json({ error: '検索結果が取得できませんでした' }, { status: 500 });
    }

    // STEP2: JSON変換(google_searchなし + responseMimeType: json)
    const jsonPrompt = `以下の花見情報をJSONに変換してください。JSONのみ返してください。

${searchResult}

形式:
{"timestamp":"${nowStr}","sourceNote":"3ソース検証済","spots":[{"name":"スポット名","location":"場所","migoron_score":88,"flower_score":95,"saturday":{"label":"4/26(土)","weather":"晴","temp":"20/5"},"sunday":{"label":"4/27(日)","weather":"曇","temp":"18/6"},"info":"見どころ","warning":"","tags":["家族","撮影"]}]}

スコア: flower_score(満開=95-100,見頃=80-95,散り始め=60-80), migoron_score(花50%+天気30%+気温20%), 天気(晴=30,晴曇=25,曇=18,雨=5点/30点満点)`;

    const step2Res = await fetch(url, {
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

    if (!step2Res.ok) {
      const err = await step2Res.text();
      console.error('Step2 error:', step2Res.status, err.slice(0, 200));
      return Response.json({ error: `JSON生成エラー: ${step2Res.status}` }, { status: 500 });
    }

    const step2Data = await step2Res.json();
    const rawText = (step2Data?.candidates?.[0]?.content?.parts || [])
      .filter(p => typeof p.text === 'string')
      .map(p => p.text)
      .join('')
      .trim();

    const result = tryParseJSON(rawText);
    if (!result) {
      console.error('JSON parse failed. Raw:', rawText.slice(0, 300));
      return Response.json({ error: 'AI応答の解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(result);

  } catch (error) {
    console.error('API route error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}

function tryParseJSON(text) {
  if (!text) return null;
  let s = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
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
    if (obj && Array.isArray(obj.spots) && obj.spots.length > 0) return obj;
    return null;
  } catch { return null; }
}
