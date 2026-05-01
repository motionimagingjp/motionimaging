import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

async function callGemini(apiKey, prompt, maxTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: maxTokens || 300,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim();
}

async function buildFlowerTweet(apiKey, dateLabel) {
  const prompt = '明日の花スポット5件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '条件：実在する日本の名所5件、季節の花を選ぶ\n\n'
    + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
    + '{"spots":[{"name":"ひたち海浜公園（茨城）","emoji":"🌼","score":95},{"name":"あしかがフラワーパーク（栃木）","emoji":"🌸","score":88},{"name":"昭和記念公園（東京）","emoji":"🌷","score":82},{"name":"国営武蔵丘陵森林公園（埼玉）","emoji":"🌿","score":75},{"name":"横浜公園（神奈川）","emoji":"🌺","score":68}],"memo":"明日のおすすめ理由を一言で"}';

  const raw = await callGemini(apiKey, prompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);

  let spots, memo;
  if (match) {
    const parsed = JSON.parse(match[0]);
    spots = parsed.spots;
    memo = parsed.memo;
  } else {
    spots = [
      { name: 'ひたち海浜公園（茨城）', emoji: '🌼', score: 95 },
      { name: 'あしかがフラワーパーク（栃木）', emoji: '🌸', score: 88 },
      { name: '昭和記念公園（東京）', emoji: '🌷', score: 82 },
      { name: '国営武蔵丘陵森林公園（埼玉）', emoji: '🌿', score: 75 },
      { name: '横浜公園（神奈川）', emoji: '🌺', score: 68 },
    ];
    memo = '明日も花撮影日和です。';
  }

  const ranked = spots.sort((a, b) => b.score - a.score);
  let tweet = '花畑指数【' + dateLabel + '】\n';
  for (const s of ranked) {
    tweet += s.emoji + ' ' + s.name + '(' + s.score + '%)\n';
  }
  tweet += 'ミゴロンメモ：' + memo + '\n';
  tweet += '#花撮影 #風景写真 #ミゴロン';
  return tweet;
}

async function buildCloudSeaTweet(apiKey, dateLabel) {
  const prompt = '明日の雲海スポット3件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '条件：実在する日本の山・高原3件\n\n'
    + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
    + '{"spots":[{"name":"高ボッチ高原（長野）","emoji":"☁️","score":80},{"name":"山中湖パノラマ台（山梨）","emoji":"☁️","score":70},{"name":"秩父美の山公園（埼玉）","emoji":"☁️","score":55}],"time":"4:00〜6:00","memo":"明日の雲海コンディションを一言で"}';

  const raw = await callGemini(apiKey, prompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);

  let spots, time, memo;
  if (match) {
    const parsed = JSON.parse(match[0]);
    spots = parsed.spots;
    time  = parsed.time || '4:00〜6:00';
    memo  = parsed.memo;
  } else {
    spots = [
      { name: '高ボッチ高原（長野）',     emoji: '☁️', score: 80 },
      { name: '山中湖パノラマ台（山梨）', emoji: '☁️', score: 70 },
      { name: '秩父美の山公園（埼玉）',   emoji: '☁️', score: 55 },
    ];
    time = '4:00〜6:00';
    memo = '早朝の冷え込みに期待。';
  }

  const ranked = spots.sort((a, b) => b.score - a.score);
  let tweet = '雲海指数【' + dateLabel + '】\n';
  for (const s of ranked) {
    tweet += s.emoji + ' ' + s.name + '(' + s.score + '%)\n';
  }
  tweet += 'ミゴロンメモ：' + memo + '\n';
  tweet += '⏰' + time + 'がベスト\n';
  tweet += '#雲海予報 #絶景 #ミゴロン';
  return tweet;
}

async function buildFujisanTweet(apiKey, dateLabel) {
  const prompt = '明日の富士山撮影スポット3件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '条件：富士山周辺の実在する場所3件\n\n'
    + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
    + '{"spots":[{"name":"河口湖畔（山梨）","emoji":"🗻","score":90},{"name":"田貫湖（静岡）","emoji":"🗻","score":85},{"name":"山中湖パノラマ台（山梨）","emoji":"🗻","score":75}],"time":"5:00〜7:00","memo":"明日の富士山撮影ポイントを一言で"}';

  const raw = await callGemini(apiKey, prompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);

  let spots, time, memo;
  if (match) {
    const parsed = JSON.parse(match[0]);
    spots = parsed.spots;
    time  = parsed.time || '5:00〜7:00';
    memo  = parsed.memo;
  } else {
    spots = [
      { name: '河口湖畔（山梨）',         emoji: '🗻', score: 90 },
      { name: '田貫湖（静岡）',           emoji: '🗻', score: 85 },
      { name: '山中湖パノラマ台（山梨）', emoji: '🗻', score: 75 },
    ];
    time = '5:00〜7:00';
    memo = '早朝の富士山撮影に期待。';
  }

  const ranked = spots.sort((a, b) => b.score - a.score);
  let tweet = '富士山指数【' + dateLabel + '】\n';
  for (const s of ranked) {
    tweet += s.emoji + ' ' + s.name + '(' + s.score + '%)\n';
  }
  tweet += 'ミゴロンメモ：' + memo + '\n';
  tweet += '⏰' + time + 'がベスト\n';
  tweet += '#富士山 #風景写真 #ミゴロン';
  return tweet;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const API_KEY   = process.env.GEMINI_API_KEY;
    const dateLabel = getTomorrowLabel();

    const flowerTweet   = await buildFlowerTweet(API_KEY, dateLabel);
    const cloudSeaTweet = await buildCloudSeaTweet(API_KEY, dateLabel);
    const fujisanTweet  = await buildFujisanTweet(API_KEY, dateLabel);

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    const results = {};
    for (const [key, text] of [
      ['cloud_sea', cloudSeaTweet],
      ['fujisan',   fujisanTweet],
      ['flower',    flowerTweet],
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
    return new Response(JSON.stringify({
      error: error.message,
      detail: 'エラーが発生しました。'
    }), { status: 500 });
  }
}
