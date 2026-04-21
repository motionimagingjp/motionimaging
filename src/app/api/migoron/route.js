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

    const extraPlace = freetext ? `\n追加の指定場所: ${freetext}` : '';

    const prompt = `あなたはお花見ナビのアシスタントです。以下の条件で日本のお花スポットを3-4件提案してください。

条件:
日付: ${whenLabel}(${dateLabel})
地域: ${regionLabel}
花: ${flowerLabel}${extraPlace}
検索時刻: ${nowStr}

Google検索で開花状況と天気予報(気象庁・ウェザーニュース・ウェザーマップ)を調べて、以下のJSON形式で返してください。

{
  "timestamp": "${nowStr}",
  "sourceNote": "3ソース検証済",
  "spots": [
    {
      "name": "スポット名",
      "location": "場所の説明",
      "migoron_score": 88,
      "flower_score": 95,
      "saturday": { "label": "4/26(土)", "weather": "晴", "temp": "20/5" },
      "sunday": { "label": "4/27(日)", "weather": "曇", "temp": "18/6" },
      "info": "見どころの説明",
      "warning": "",
      "tags": ["家族", "撮影"]
    }
  ]
}

スコア: flower_score(満開=95-100、見頃=80-95、散り始め=60-80)、migoron_score(花50%+天気30%+気温20%)`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return Response.json({ error: `Gemini API エラー: ${geminiRes.status}` }, { status: 500 });
    }

    const data = await geminiRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];

    // テキスト部分のみ結合(grounding_metadataなど除外)
    const text = parts
      .filter(p => typeof p.text === 'string')
      .map(p => p.text)
      .join('')
      .trim();

    if (!text) {
      return Response.json({ error: 'AIからの応答が空でした' }, { status: 500 });
    }

    // コードフェンス除去
    let jsonText = text;
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    // 文字列内の括弧を正確にトラッキングして最初の完結JSONを取得
    const startIdx = jsonText.indexOf('{');
    if (startIdx >= 0) {
      let depth = 0;
      let endIdx = -1;
      let inString = false;
      let escape = false;
      for (let i = startIdx; i < jsonText.length; i++) {
        const ch = jsonText[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }
      if (endIdx > startIdx) {
        jsonText = jsonText.substring(startIdx, endIdx + 1);
      }
    }

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw text:', text.slice(0, 500));
      return Response.json({ error: 'AI応答の解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(result);

  } catch (error) {
    console.error('API route error:', error);
    return Response.json({ error: error.message || '予期しないエラーが発生しました' }, { status: 500 });
  }
}
