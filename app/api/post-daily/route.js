import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

// 明日の日付（JST）
function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

// Geminiで1つの投稿文を生成
async function generateTweet(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
  const text = data.candidates[0].content.parts[0].text.trim();
  return text.replace(/\n/g, ' ').trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    const dateLabel = getTomorrowLabel();

    const prompts = {
      flower: `【重要】必ず100文字以内で完結した投稿文を1つだけ出力してください。説明・前置き・改行は不要です。

以下のフォーマットで作成してください：
【${dateLabel}の花畑】
（おすすめスポット3件を絵文字付きで簡潔に）
（ハッシュタグ2〜3個）

例：
【4月24日の花畑】
🌸高遠城址公園（長野）満開
🌼ひたち海浜公園（茨城）見頃
🌷吉野山（奈良）散り始め
#花撮影 #風景写真`,

      cloud_sea: `【${dateLabel}の雲海予報】を以下の形式で出力せよ。改行なし1行で。
☁️スポット名1 成功率XX% ☁️スポット名2 成功率XX% ☁️スポット名3 成功率XX% ⏰XX:XX〜XX:XXがベスト #雲海 #風景写真

【秩父が含まれる場合の補正ルール】
- 迷った時は確率を5〜10%低めに保守的に丸める
- 前夜21時の湿度が85%未満なら強制的に30%以下に下方修正
- 風速2m/s以上が1時間でもある場合は判定を1ランク下げる
- 露点温度と最低気温の差が2℃以内なら「濃い雲海」または「夜景が透ける薄い雲海」を明記
- 4〜5月の雨上がり翌朝のみ例外的に+10%上方修正可`,

     fujisan: `【${dateLabel}の富士山予報】を以下の形式で出力せよ。改行なし1行で。
🗻スポット名1(評価:5/5) 🗻スポット名2(評価:4/5) 🗻スポット名3(評価:3/5) ⏰XX:XX〜XX:XXがベスト #富士山 #風景写真`,
