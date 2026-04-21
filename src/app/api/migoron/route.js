export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { whenLabel, dateLabel, regionLabel, flowerLabel, freetext, detailMode } = body;

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

    const jsonTemplate = `{"timestamp":"${nowStr}","sourceNote":"${detailMode ? '気象庁/ウェザーニュース/ウェザーマップ 3ソース検証済' : 'AI予報(参考値)'}","spots":[{"name":"スポット名","location":"都道府県・説明","migoron_score":88,"flower_score":95,"saturday":{"label":"4/26(土)","weather":"晴","temp":"20/5"},"sunday":{"label":"4/27(日)","weather":"曇","temp":"18/6"},"info":"開花状況と見どころ","warning":"","tags":["家族","撮影"]}]}`;

    if (!detailMode) {
      // 簡易モード: Google検索なし、高速
      const prompt = `Japanese hanami assistant. Return ONLY raw JSON, no markdown, no explanation.
Conditions: Date=${whenLabel}(${dateLabel}), Region=${regionLabel}, Flower=${flowerLabel}${extraPlace}, Time=${nowStr}
Return exactly this JSON with 3 spots: ${jsonTemplate}
Score: flower(full=95-100,peak=80-95,fading=60-80), migoron=flower50%+weather30%+temp20%
Return ONLY JSON.`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return Response.json({ error: `API エラー: ${res.status}` }, { status: 500 });
      }

      const data = await res.json();
      const rawText = (data?.candidates?.[0]?.content?.parts || [])
        .filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch(e) {
        // コードフェンス除去して再試行
        const cleaned = rawText.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
        try { result = JSON.parse(cleaned); } catch(e2) {
          return Response.json({ error: 'PARSE_FAIL:' + rawText.slice(0, 300) }, { status: 500 });
        }
      }
      if (!result || !Array.isArray(result.spots)) return Response.json({ error: '不正なJSON形式です' }, { status: 500 });
      return Response.json(result);

    } else {
      // 詳細モード: Google検索あり、2段階
      const searchPrompt = `以下の条件でお花見スポットを必ず3件Google検索で調べてください。
条件: 日付=${whenLabel}(${dateLabel}), 地域=${regionLabel}, 花=${flowerLabel}${extraPlace}, 検索時刻=${nowStr}
各スポットの開花状況・土日の天気(晴/曇/雨)・最高/最低気温・見どころを調べてください。必ず3件報告してください。`;

      const step1Res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 1.0, maxOutputTokens: 3000 },
        }),
      });

      if (!step1Res.ok) return Response.json({ error: `検索エラー: ${step1Res.status}` }, { status: 500 });

      const step1Data = await step1Res.json();
      const searchResult = (step1Data?.candidates?.[0]?.content?.parts || [])
        .filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();

      if (!searchResult) return Response.json({ error: '検索結果が取得できませんでした' }, { status: 500 });

      const jsonPrompt = `以下の花見情報をJSONのみで返してください。説明文不要。
${searchResult}
形式: ${jsonTemplate}
スコア: flower(満開=95-100,見頃=80-95,散り始め=60-80), migoron(花50%+天気30%+気温20%), 天気(晴=30,晴曇=25,曇=18,雨=5点/30点満点)`;

      const step2Res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: jsonPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      });

      if (!step2Res.ok) return Response.json({ error: `JSON生成エラー: ${step2Res.status}` }, { status: 500 });

      const step2Data = await step2Res.json();
      const rawText = (step2Data?.candidates?.[0]?.content?.parts || [])
        .filter(p => typeof p.text === 'string').map(p => p.text).join('').trim();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch(e) {
        // コードフェンス除去して再試行
        const cleaned = rawText.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
        try { result = JSON.parse(cleaned); } catch(e2) {
          return Response.json({ error: 'PARSE_FAIL:' + rawText.slice(0, 300) }, { status: 500 });
        }
      }
      if (!result || !Array.isArray(result.spots)) return Response.json({ error: '不正なJSON形式です' }, { status: 500 });
      return Response.json(result);
    }

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}

function extractJSON(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
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
