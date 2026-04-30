import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function getMoonAge() {
  const now = new Date();
  const known = new Date('2000-01-06T18:14:00Z');
  const diff = (now - known) / (1000 * 60 * 60 * 24);
  return Math.floor(diff % 29.53);
}

function getMoonInfo(age) {
  if (age <= 3)  return { age, label: '新月直後', effect: '星空絶好調、指数+10%補正' };
  if (age <= 7)  return { age, label: '三日月', effect: '星空良好' };
  if (age <= 12) return { age, label: '上弦の月', effect: '月の影響やや出始め、指数-10%補正' };
  if (age <= 17) return { age, label: '満月前後', effect: '月明かり強く星空に不利、指数-20%補正' };
  if (age <= 22) return { age, label: '下弦の月', effect: '深夜以降は改善傾向' };
  return           { age, label: '晦日月', effect: '新月に向け星空回復中、指数+5%補正' };
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
    const moon = getMoonInfo(getMoonAge());

    const prompt = 'あなたは風景写真家アカウント「ミゴロン」のSNS担当です。\n\n'
      + '【今夜の月齢】月齢' + moon.age + '日（' + moon.label + '）' + moon.effect + '\n\n'
      + '以下の5スポットの星指数を月齢・雲量・湿度から算出し、指数高い順に並べて出力してください。\n'
      + '秩父市（美の山公園）、三浦市（馬の背洞門）、河口湖（富士吉田市エリア）、下田市（爪木崎）、大洗町（大洗磯前神社）\n\n'
      + '【出力例・この形式のみ・一切変えるな】\n'
      + 'ロケーション星指数予報【' + dateLabel + '】\n'
      + '✨ 河口湖（富士吉田市エリア）(90%)\n'
      + '✨ 大洗町（大洗磯前神社）(85%)\n'
      + '✨ 下田市（爪木崎）(80%)\n'
      + '✨ 三浦市（馬の背洞門）(70%)\n'
      + '✨ 秩父市（美の山公園）(60%)\n'
      + 'ミゴロンメモ：新月で透明度高く全域で星が期待できます。\n'
      + '#星空撮影 #風景写真 #ミゴロン\n\n'
      + '上記の形式だけで出力。説明・前置き一切不要。';

    let tweet = await generateTweet(process.env.GEMINI_API_KEY, prompt);

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

    return new Response(JSON.stringify({ message: 'Success', tweet, moonAge: moon }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
