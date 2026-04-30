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

async function callGemini(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 300 }
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

    const spots = [
      '河口湖（山梨）',
      '爪木崎（静岡）',
      '大洗（茨城）',
      '三浦（神奈川）',
      '秩父（埼玉）',
    ];

    // Geminiには指数5つとメモだけ生成させる
    const prompt = '月齢' + moon.age + '日（' + moon.label + '）今夜の気象条件から以下5スポットの星空指数を算出してください。\n'
      + spots.join('、') + '\n\n'
      + '月齢補正：' + moon.effect + '\n\n'
      + '以下のJSON形式のみで出力。説明不要。\n'
      + '{"scores":[75,70,65,60,55],"memo":"新月で全域好条件です"}';

    const raw = await callGemini(process.env.GEMINI_API_KEY, prompt);

    // JSON抽出
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON parse failed: ' + raw);
    const parsed = JSON.parse(match[0]);
    const scores = parsed.scores;
    const memo = parsed.memo;

    // スポットと指数を組み合わせてソート
    const ranked = spots
      .map((name, i) => ({ name, score: scores[i] }))
      .sort((a, b) => b.score - a.score);

    // ツイート組み立て
    let tweet = 'ロケーション星指数予報【' + dateLabel + '】\n';
    for (const s of ranked) {
      tweet += '✨ ' + s.name + '(' + s.score + '%)\n';
    }
    tweet += 'ミゴロンメモ：' + memo + '\n';
    tweet += '#星空撮影 #風景写真 #ミゴロン';

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
