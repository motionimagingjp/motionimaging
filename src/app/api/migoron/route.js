import { NextResponse } from ‘next/server’;

export const runtime = ‘nodejs’;
export const maxDuration = 60;

export async function POST(request) {
try {
const { whenLabel, dateLabel, regionLabel, flowerLabel, freetext } = await request.json();

```
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  return NextResponse.json({ error: 'GEMINI_API_KEY が設定されていません' }, { status: 500 });
}

const now = new Date();
const jstNow = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
const nowStr = `${jstNow.getFullYear()}/${jstNow.getMonth() + 1}/${jstNow.getDate()} ${String(jstNow.getHours()).padStart(2, '0')}:${String(jstNow.getMinutes()).padStart(2, '0')} JST`;

const extraPlace = freetext ? `\n追加の指定場所: ${freetext}(地域選択に加えて、これらの場所も検索対象に含めること)` : '';

const prompt = `あなたはお花見ナビのアシスタントです。以下の条件で、日本のお花スポットを検索して提案してください。
```

【条件】
日付: ${whenLabel}(${dateLabel})
地域: ${regionLabel}
花: ${flowerLabel}${extraPlace}

【必要な情報】
Google検索を使って、以下の最新情報を取得してください(検索時刻: ${nowStr}):

1. その花の開花状況(満開/見頃/散り始めなど、tenki.jp、ウェザーニュース、ウォーカープラスなどから取得)
1. 週末の天気予報(気象庁、ウェザーニュース、ウェザーマップの3ソースをクロスチェック、取得データは6時間以内のもの優先)
1. 最高気温/最低気温

【出力形式】
必ず以下のJSON形式のみで返してください。他のテキストは一切含めないこと。

{
“timestamp”: “${nowStr}”,
“sourceNote”: “気象庁/ウェザーニュース/ウェザーマップ 3ソース検証済”,
“spots”: [
{
“name”: “スポット名”,
“location”: “都道府県・市町村、特徴(例: 約2600本の桜)”,
“migoron_score”: 88,
“flower_score”: 95,
“saturday”: { “label”: “土曜日付(例: 4/26(土))”, “weather”: “晴”, “temp”: “20°/5°” },
“sunday”: { “label”: “日曜日付(例: 4/27(日))”, “weather”: “晴曇”, “temp”: “23°/8°” },
“info”: “開花状況と見どころの詳細(1-2文)”,
“warning”: “3ソースで天気情報がずれた場合のみ記入、一致なら空文字”,
“tags”: [“家族”, “デート”, “撮影”]
}
]
}

【スコア算出ルール】

- flower_score (0-100): 満開=95-100、見頃=80-95、五分咲き/散り始め=60-80、つぼみ/葉桜=30-60
- migoron_score (0-100): 花50% + 天気30% + 気温20%の加重平均。両日雨なら-10、片方雨なら-5のペナルティ
- 天気: 晴=30、晴曇=25、曇=18、曇雨=10、雨=5(/30満点換算)
- 気温: 最高15-23℃が快適=20点、それ以外は減点

【タグのルール】

- 家族: 混雑少なめ、トイレ・駐車場あり、バリアフリー
- デート: 景観が良い、カフェ近接、夕景が綺麗
- 撮影: 構図が良い、有名スポット、ライトアップあり
- 該当するものを複数つけてOK
- 見頃終盤なら「見頃終盤」タグも追加

必ずおすすめスポットを3-4件提案してください。結果はJSONのみで返してください。`;

```
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

const response = await fetch(url, {
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

if (!response.ok) {
  const errText = await response.text();
  console.error('Gemini API error:', errText);
  return NextResponse.json({ error: `Gemini API エラー: ${response.status}` }, { status: 500 });
}

const data = await response.json();
const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';

let jsonText = text.trim();
const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/) || jsonText.match(/```\s*([\s\S]*?)\s*```/);
if (jsonMatch) {
  jsonText = jsonMatch[1].trim();
}

const startIdx = jsonText.indexOf('{');
const endIdx = jsonText.lastIndexOf('}');
if (startIdx >= 0 && endIdx > startIdx) {
  jsonText = jsonText.substring(startIdx, endIdx + 1);
}

let result;
try {
  result = JSON.parse(jsonText);
} catch (e) {
  console.error('JSON parse error:', e, 'Raw:', text);
  return NextResponse.json({
    error: 'AI応答の解析に失敗しました',
    raw: text.substring(0, 500)
  }, { status: 500 });
}

return NextResponse.json(result);
```

} catch (error) {
console.error(‘API route error:’, error);
return NextResponse.json({ error: error.message || ‘予期しないエラー’ }, { status: 500 });
}
}
