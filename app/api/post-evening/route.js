import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

async function generateTweet(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  return data.candidates[0].content.parts[0].text.trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const dateLabel = getTomorrowLabel();

    const prompt = 'あなたは風景写真家アカウント「ミゴロン」のSNS担当です。今夜の星空予報の投稿文を作成してください。\n\n'
      + '【対象スポット・固定5箇所】\n'
      + '✨ 秩父市（美の山公園）\n'
      + '✨ 三浦市（馬の背洞門）\n'
      + '✨ 河口湖（富士吉田市エリア）\n'
      + '✨ 下田市（爪木崎）\n'
      + '✨ 大洗町（大洗磯前神社）\n\n'
      + '【出力フォーマット・厳守】\n'
      + '1行目：ロケーション星指数予報【' + dateLabel + '】\n'
      + '2〜6行目：✨ スポット名(XX%) の形式のみ。余計な説明一切不要。指数高い順。\n'
      + '7行目：ミゴロンメモ：全体コンディションを30文字以内で1文。\n'
      + '8行目：#星空撮影 #風景写真 #ミゴロン\n\n'
      + '【絶対ルール】\n'
      + '「ミゴロン星指数」という言葉は使わない。(XX%)のみ。\n'
      + '合計150文字以内に必ず収めること。\n'
      + 'マークダウン禁止、箇条書き禁止、カメラ設定禁止。\n'
      + '投稿文のみ出力。';

    let tweet = await generateTweet(process.env.GEMINI_API_KEY, prompt);

    // 280文字を超えたら安全にカット
    if (tweet.length > 280) {
      tweet = tweet.substring(0, 277) + '...';
    }

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
