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

    // STEP1: Google検索で情報収集
    const searchPrompt = `${whenLabel}(${dateLabel})に${regionLabel}で${flowerLabel}${extraPlace}を見に行く場合のおすすめスポットを3件、Google検索で調べてください。各スポットの開花状況、土日の天気予報と気温(最高/最低)を調べてください。検索時刻: ${nowStr}`;

    const step1Res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 2048 },
      }),
    });

    if (!step1Res.ok) {
      const errText = await step1Res.text();
      console.error('Step1 error:', errText);
      return Response.json({ error: `検索エラー: ${step1Res.status}` }, { status: 500 });
    }

    const step1Data = await step1Res.json();
    console.log('Step1 candidates count:', step1Data?.candidates?.length);
    console.log('Step1 parts count:', step1Data?.candidates?.[0]?.content?.parts?.length);

    // 全partsのテキストを収集してログ
    const allParts = step1Data?.candidates?.[0]?.content?.parts || [];
    console.log('Step1 parts types:', allParts.map(p => Object.keys(p).join(',')).join(' | '));

    // テキストpartsのみ抽出して最後のものを使用
    const textParts = allParts.filter(p => typeof p.text === 'string' && p.text.length > 0);
    console.log('Step1 text parts count:', textParts.length);

    const searchResult = textParts.map(p => p.text).join('\n');
    console.log('Step1 result length:', searchResult.length);

    if (!searchResult) {
      return Response.json({ error: '検索結果が取得できませんでした' }, { status: 500 });
    }

    // STEP2: JSON変換(google_searchなし + responseMimeType: json)
    const jsonPrompt = `以下の花見スポット情報をJSONに変換してください。

${searchResult}

以下の形式のJSONのみ返してください:
{"timestamp":"${nowStr}","sourceNote":"3ソース検証済","spots":[{"name":"スポット名","location":"場所","migoron_score":88,"flower_score":95,"saturday":{"label":"4/26(土)","weather":"晴","temp":"20/5"},"sunday":{"label":"4/27(日)","weather":"曇","temp":"18/6"},"info":"見どころ","warning":"","tags":["家族","撮影"]}]}`;

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
      const errText = await step2Res.text();
      console.error('Step2 error:', errText);
      return Response.json({ error: `JSON生成エラー: ${step2Res.status}` }, { status: 500 });
    }

    const step2Data = await step2Res.json();
    const rawText = (step2Data?.candidates?.[0]?.content?.parts || [])
      .filter(p => typeof p.text === 'string')
      .map(p => p.text)
      .join('')
      .trim();

    console.log('Step2 raw text (first 200):', rawText.slice(0, 200));

    // コードフェンス除去
    let jsonText = rawText;
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    // 先頭の{から末尾の}まで抽出
    const si = jsonText.indexOf('{');
    const ei = jsonText.lastIndexOf('}');
    if (si >= 0 && ei > si) jsonText = jsonText.substring(si, ei + 1);

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Raw:', rawText.slice(0, 300));
      return Response.json({ error: 'AI応答の解析に失敗しました。もう一度お試しください。' }, { status: 500 });
    }

    return Response.json(result);

  } catch (error) {
    console.error('API route error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}
