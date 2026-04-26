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

    const flowerPrompt = '【' + dateLabel + 'の花スポット】 🌸おすすめ3選を出力せよ。AIの知識で実在スポットを選べ。形式：絵文字+スポット名(都道府県)+状況 を3件、最後にハッシュタグ2個。1行で出力せよ。';

const cloudSeaPrompt = '【' + dateLabel + 'の雲海予報】 AIの気象知識で関東・中部の雲海スポット3選を出力せよ。形式：☁️スポット名 成功率XX% を3件、⏰ベスト時間、ハッシュタグ2個。1行で出力せよ。断り文句は不要。秩父補正：湿度・風速・露点を考慮し保守的に。';

const fujisanPrompt = '【' + dateLabel + 'の富士山予報】 AIの気象知識で富士山ビュースポット3選を出力せよ。形式：🗻スポット名(評価X/5) を3件、⏰ベスト時間、ハッシュタグ2個。1行で出力せよ。断り文句は不要。';
    // Geminiで3つ生成（直列）
    const flowerTweet   = await generateTweet(API_KEY, flowerPrompt);
    const cloudSeaTweet = await generateTweet(API_KEY, cloudSeaPrompt);
    const fujisanTweet  = await generateTweet(API_KEY, fujisanPrompt);

    // X投稿（2秒間隔）
    const xClient = new TwitterApi({
      appKey:      process.env.X_API_KEY,
      appSecret:   process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret:process.env.X_ACCESS_SECRET,
    });

    const results = {};
    for (const [key, text] of [
      ['flower',    flowerTweet],
      ['cloud_sea', cloudSeaTweet],
      ['fujisan',   fujisanTweet],
    ]) {
      try {
        await xClient.v2.tweet(text);
        results[key] = { ok: true, tweet: text };
      } catch (err) {
        results[key] = { ok: false, error: err.message };
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({
      message: 'Success',
      date: dateLabel,
      results
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      error: error.message,
      detail: "エラーが発生しました。APIキーやモデル設定を確認してください。"
    }), { status: 500 });
  }
}
