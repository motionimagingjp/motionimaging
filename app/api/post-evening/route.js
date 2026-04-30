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

    const prompt = 'あなたは風景写真家アカウント「ミゴロン」のSNS担当兼、気象アナリストです。今夜の星空と翌朝の絶景期待値を予報する投稿文を作成してください。\n\n'
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
      + '【投稿フォーマット】\n'
      + '1行目：ロケーション星指数予報【' + dateLabel + '】\n'
      + '2〜6行目：各スポットを「✨ スポット名 ミゴロン星指数XX%」のみ1行で。説明は不要。指数高い順。\n'
      + '7行目：ミゴロンメモ：明日の撮影全体のコンディションを1文（40文字以内）でまとめる\n'
      + '8行目：#星空撮影 #風景写真 #ミゴロン\n\n'
      + '【厳守事項】\n'
      + 'マークダウン禁止、箇条書き禁止、カメラ設定禁止\n'
      + '合計200文字以内に収めること\n'
      + '投稿文のみ出力（前置き不要）';

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
