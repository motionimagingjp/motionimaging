import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getSunsetUTC(date) {
  const lat = 35.6762, lng = 139.6503;
  const rad = Math.PI / 180;
  const N = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const B = 360 / 365 * (N - 81) * rad;
  const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declination = 23.45 * Math.sin(B) * rad;
  const hourAngle = Math.acos(-Math.tan(lat * rad) * Math.tan(declination)) / rad;
  const solarNoon = 12 - lng / 15 - EoT / 60;
  return solarNoon + hourAngle / 15;
}

function isNearSunset() {
  const now = new Date();
  const sunsetUTC = getSunsetUTC(now);
  const nowHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  return Math.abs(nowHours - (sunsetUTC + 0.5)) <= 10 / 60;
}

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

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
  return data.candidates[0].content.parts[0].text.trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isNearSunset()) {
    return new Response(JSON.stringify({ message: 'Skipped: not near sunset' }), { status: 200 });
  }

  try {
    const dateLabel = getTomorrowLabel();

    const prompt = `あなたは風景写真家アカウント「ミゴロン」のSNS担当兼、気象アナリストです。夕方の時間帯に、今夜の星空と翌朝の絶景期待値をデータに基づいて予報する投稿文を作成してください。

【対象スポット】以下の5箇所を固定で使用すること：
✨ 秩父市（美の山公園）
✨ 三浦市（馬の背洞門）
✨ 河口湖（富士吉田市エリア）
✨ 下田市（爪木崎）
✨ 大洗町（大洗磯前神社）

【星指数の算出基準】
雲量0〜10% かつ 湿度60%以下 → 指数90〜100%
雲量20〜30% かつ 低風速 → 指数70〜80%
雲量40%以上 かつ 高湿度 → 指数50%以下

【投稿作成条件】
ロケーション星指数予報【${dateLabel}】で必ず始めること
5箇所すべてに✨とミゴロン星指数（XX%）を付ける
指数が高い順に並べる
ミゴロンメモとして明日の朝なぜそこがおすすめかの理由（星のヌケ、海霧の可能性、波の状況など）を専門的な視点で1文で書く
マークダウン（**や##など）は使わない
箇条書き（・や-）は使わず1行ずつシンプルに並べる
ハッシュタグ3個（#星空撮影 #風景写真 #ミゴロン）を最後に
カメラの技術設定（F値、SS、ISO等）のアドバイスは絶対禁止
投稿文のみ出力（前置き・解説不要）`;

    const tweet = await generateTweet(process.env.GEMINI_API_KEY, prompt);

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await xClient.v2.tweet(tweet);

    return new Response(JSON.stringify({ message: 'Success', tweet }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
