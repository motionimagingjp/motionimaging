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

    const extraPlace = freetext ? `\n追加の指定場所: ${freetext}(地域選択に加えて、これらの場所も検索対象に含めること)` : '';

    const prompt = `あなたはお花見ナビのアシスタントです。以下の条件で、日本のお花スポットを検索して提案してください。

【条件】
日付: ${whenLabel}(${dateLabel})
地域: ${regionLabel}
花: ${flowerLabel}${extraPlace}

【必要な情報】
Google検索を使って、以下の最新情報を取得してください(検索時刻: ${nowStr}):
1. その花の開花状況(満開/見頃/散り始めなど)
2. 週末の天気予報(気象庁、ウェザーニュース、ウェザーマップの3ソースをクロスチェック)
3. 最高気温/最低気温

【出力形式】
必ず以下のJSON形式のみで返してください。マークダウンのコードブロック(\`\`\`)は使わないこと。他のテキストは一切含めないこと。

{
  "timestamp": "${nowStr}",
  "sourceNote": "気象庁/ウェザーニュース/ウェザーマップ 3ソース検証済",
  "spots": [
    {
      "name": "スポット名",
      "location": "都道府県・市町村、特徴",
      "migoron_score": 88,
      "flower_score": 95,
      "saturday": { "label": "土曜日付(例: 4/26(土))", "weather": "晴", "temp": "20°/5°" },
      "sunday": { "label": "日曜日付(例: 4/27(日))", "weather": "晴曇", "temp": "23°/8°" },
      "info": "開花状況と見どころの詳細(1-2文)",
      "warning": "",
      "tags": ["家族", "デート", "撮影"]
    }
  ]
}

【スコア算出ルール】
- flower_score(0-100): 満開=95-100、見頃=80-95、五分咲き=60-80、つぼみ/葉桜=30-60
- migoron_score(0-100): 花50% + 天気30% + 気温20%の加重平均。両日雨=-10、片方雨=-5
- 天気配点: 晴=30、晴曇=25、曇=18、曇雨=10、雨=5
- 気温: 最高15-23℃=20点満点、それ以外は減点

おすすめスポットを3-4件提案してください。JSONのみで返してください。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return Response.json({ error: `Gemini API エラー: ${geminiRes.status} - ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await geminiRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('').trim();

    if (!text) {
      return Response.json({ error: 'AIからの応答が空でした' }, { status: 500 });
    }

    let jsonText = text;
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    // 最初の { から最初の完結した } までを取得(重複JSON対策)
    const startIdx = jsonText.indexOf('{');
    if (startIdx >= 0) {
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < jsonText.length; i++) {
        if (jsonText[i] === '{') depth++;
        else if (jsonText[i] === '}') {
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
