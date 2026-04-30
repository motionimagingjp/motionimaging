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

    const prompt = 'あなたは風景写真家アカウント「ミゴロン」のSNS担当兼、気象アナリストです。夕方の時間帯に、今夜の星空と翌朝の絶景期待値をデータに基づいて予報する投稿文を作成してください。\n\n'
      + '【対象スポット】以下の5箇所を固定で使用すること\n'
      + '✨ 秩父市（美の山公園）\n'
      + '✨ 三浦市（馬の背洞門）\n'
      + '✨ 河口湖（富士吉田市エリア）\n'
      + '✨ 下田市（爪木崎）\n'
      + '✨ 大洗町（大洗磯前神社）\n\n'
      + '【星指数の算出基準】\n'
      + '雲量0〜10% かつ 湿度60%以下 → 指数90〜100%\n'
      + '雲量20〜30% かつ 低風速 → 指数70〜80%\n'
      + '雲量40%以上 かつ 高湿度 → 指数50%以下\n\n'
      + '【投稿作成条件】\n'
      + 'ロケーション星指数予報【' + dateLabel + '】で必ず始めること\n'
      + '5箇所すべてに✨とミゴロン星指数（XX%）を付ける\n'
      + '指数が高い順に並べる\n'
      + 'ミゴロンメモとして明日の朝なぜそこがおすすめかの理由を専門的な視点で1文で書く\n'
      + 'マークダウン（**や##など）は使わない\n'
      + '箇条書き（・や-）は使わず1行ずつシンプルに並べる\n'
      + 'ハッシュタグ3個（#星空撮影 #風景写真 #ミゴロン）を最後に\n'
      + 'カメラの技術設定（F値、SS、ISO等）のアドバイスは絶対禁止\n'
      + '投稿文のみ出力（前置き・解説不要）';

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
