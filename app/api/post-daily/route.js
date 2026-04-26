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
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
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

    const flowerPrompt = '【重要】必ず100文字以内で完結した投稿文を1つだけ出力してください。説明・前置き・改行は不要です。\n【' + dateLabel + 'の花畑】\n例：【4月24日の花畑】 🌸高遠城址公園（長野）満開 🌼ひたち海浜公園（茨城）見頃 🌷吉野山（奈良）散り始め #花撮影 #風景写真';

    const cloudSeaPrompt = '【' + dateLabel + 'の雲海予報】を以下の形式で出力せよ。改行なし1行で。\n☁️スポット名1 成功率XX% ☁️スポット名2 成功率XX% ☁️スポット名3 成功率XX% ⏰XX:XX〜XX:XXがベスト #雲海 #風景写真\n【秩父が含まれる場合の補正ルール】\n- 迷った時は確率を5〜10%低めに保守的に丸める\n- 前夜21時の湿度が85%未満なら強制的に30%以下に下方修正\n- 風速2m/s以上が1時間でもある場合は判定を1ランク下げる\n- 露点温度と最低気温の差が2度以内なら「濃い雲海」または「夜景が透ける薄い雲海」を明記\n- 4〜5月の雨上がり翌朝のみ例外的に+10%上方修正可';

    const fujisanPrompt = '【' + dateLabel + 'の富士山予報】を以下の形式で出力せよ。改行なし1行で。\n🗻スポット名1(評価:5/5) 🗻スポット名2(評価:4/5) 🗻スポット名3(評価:3/5) ⏰XX:XX〜XX:XXがベスト #富士山 #風景写真';

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
