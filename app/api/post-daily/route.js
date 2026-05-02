import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

// 今夜21時〜翌朝4時の天気をhourlyで取得
async function getNightWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&timezone=Asia%2FTokyo&forecast_days=2';
    const res = await fetch(url);
    const data = await res.json();
    const hours = data.hourly.time;
    const codes = data.hourly.weathercode;
    const temps = data.hourly.temperature_2m;

    // 今夜21時〜翌朝4時のインデックスを取得
    const nightIndices = hours
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        const d = new Date(t);
        const h = d.getHours();
        const dayOffset = hours.indexOf(t) >= 24 ? 1 : 0;
        return (h >= 21 && dayOffset === 0) || (h <= 4 && dayOffset === 1);
      })
      .map(({ i }) => i);

    const worstCode = Math.max(...nightIndices.map(i => codes[i]));
    const minTemp   = Math.min(...nightIndices.map(i => temps[i]));

    let weather, penalty;
    if (worstCode === 0)      { weather = '快晴';     penalty = 0;  }
    else if (worstCode <= 2)  { weather = '晴れ';     penalty = 0;  }
    else if (worstCode <= 3)  { weather = '曇り';     penalty = 10; }
    else if (worstCode <= 49) { weather = '霧';       penalty = 20; }
    else if (worstCode <= 67) { weather = '雨';       penalty = 30; }
    else if (worstCode <= 69) { weather = '大雨';     penalty = 40; }
    else if (worstCode <= 79) { weather = '雪';       penalty = 40; }
    else if (worstCode <= 84) { weather = 'にわか雨'; penalty = 20; }
    else                      { weather = '荒天';     penalty = 50; }

    return { weather, penalty, min: Math.round(minTemp) };
  } catch {
    return { weather: '晴れ', penalty: 0, min: '--' };
  }
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

async function buildFlowerTweet(apiKey, dateLabel, weather, penalty, min) {
  const prompt = '明日の花スポット5件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '明日早朝の天気：' + weather + '（最低気温' + min + '℃）\n'
    + '天気による指数補正：各スポットの指数から' + penalty + '%を差し引くこと。\n'
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
      { name: 'ひたち海浜公園（茨城）', emoji: '🌼', score: Math.max(10, 95 - penalty) },
      { name: 'あしかがフラワーパーク（栃木）', emoji: '🌸', score: Math.max(10, 88 - penalty) },
      { name: '昭和記念公園（東京）', emoji: '🌷', score: Math.max(10, 82 - penalty) },
      { name: '国営武蔵丘陵森林公園（埼玉）', emoji: '🌿', score: Math.max(10, 75 - penalty) },
      { name: '横浜公園（神奈川）', emoji: '🌺', score: Math.max(10, 68 - penalty) },
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

async function buildCloudSeaTweet(apiKey, dateLabel, weather, penalty, min) {
  const prompt = '明日早朝の雲海スポット3件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '今夜〜明朝の天気：' + weather + '（最低気温' + min + '℃）\n'
    + '天気による指数補正：' + penalty + '%を差し引くこと。\n'
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
      { name: '高ボッチ高原（長野）',     emoji: '☁️', score: Math.max(10, 80 - penalty) },
      { name: '山中湖パノラマ台（山梨）', emoji: '☁️', score: Math.max(10, 70 - penalty) },
      { name: '秩父美の山公園（埼玉）',   emoji: '☁️', score: Math.max(10, 55 - penalty) },
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

async function buildFujisanTweet(apiKey, dateLabel, weather, penalty, min) {
  const prompt = '明日早朝の富士山撮影スポット3件のミゴロン指数を算出してください。\n'
    + '日付：' + dateLabel + '\n'
    + '今夜〜明朝の天気：' + weather + '（最低気温' + min + '℃）\n'
    + '天気による指数補正：' + penalty + '%を差し引くこと。\n'
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
      { name: '河口湖畔（山梨）',         emoji: '🗻', score: Math.max(10, 90 - penalty) },
      { name: '田貫湖（静岡）',           emoji: '🗻', score: Math.max(10, 85 - penalty) },
      { name: '山中湖パノラマ台（山梨）', emoji: '🗻', score: Math.max(10, 75 - penalty) },
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
    const { weather, penalty, min } = await getNightWeather();

    const flowerTweet   = await buildFlowerTweet(API_KEY, dateLabel, weather, penalty, min);
    const cloudSeaTweet = await buildCloudSeaTweet(API_KEY, dateLabel, weather, penalty, min);
    const fujisanTweet  = await buildFujisanTweet(API_KEY, dateLabel, weather, penalty, min);

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
      weather,
      results
    }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      detail: 'エラーが発生しました。'
    }), { status: 500 });
  }
}
