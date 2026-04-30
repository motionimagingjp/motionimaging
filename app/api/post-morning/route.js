import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTodayLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function isSakuraSeason() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  return (m === 2) || (m === 3) || (m === 4 && d <= 15);
}

function getSeasonalFlowers() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  if (m === 1)            return ['水仙', '蝋梅'];
  if (m === 2)            return ['梅', '菜の花', '水仙'];
  if (m === 3)            return ['桜', '菜の花', '梅'];
  if (m === 4 && d <= 15) return ['桜', '菜の花', 'チューリップ'];
  if (m === 4 && d > 15)  return ['ネモフィラ', 'ツツジ', '藤', 'チューリップ'];
  if (m === 5)            return ['ネモフィラ', 'ツツジ', '藤', 'バラ'];
  if (m === 6)            return ['紫陽花', 'バラ', 'ポピー', 'ラベンダー'];
  if (m === 7)            return ['ひまわり', '蓮', 'ラベンダー'];
  if (m === 8)            return ['ひまわり', '蓮'];
  if (m === 9)            return ['彼岸花', 'コスモス'];
  if (m === 10)           return ['コスモス', '紅葉'];
  if (m === 11)           return ['紅葉', 'コスモス'];
  if (m === 12)           return ['水仙', '蝋梅'];
  return [];
}

async function getWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const code = data.daily.weathercode[0];
    const max  = Math.round(data.daily.temperature_2m_max[0]);
    let weather, penalty;
    if (code === 0)      { weather = '快晴';     penalty = 0;  }
    else if (code <= 2)  { weather = '晴れ';     penalty = 0;  }
    else if (code <= 3)  { weather = '曇り';     penalty = 10; }
    else if (code <= 49) { weather = '霧';       penalty = 20; }
    else if (code <= 67) { weather = '雨';       penalty = 30; }
    else if (code <= 69) { weather = '大雨';     penalty = 40; }
    else if (code <= 79) { weather = '雪';       penalty = 40; }
    else if (code <= 84) { weather = 'にわか雨'; penalty = 20; }
    else                 { weather = '荒天';     penalty = 50; }
    return { weather, penalty, max };
  } catch {
    return { weather: '不明', penalty: 0, max: '--' };
  }
}

async function callGemini(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 300,
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

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const dateLabel = getTodayLabel();
    const sakura = isSakuraSeason();
    const flowers = getSeasonalFlowers();
    const { weather, penalty, max } = await getWeather();

    const seasonInfo = sakura
      ? '桜シーズン。2月1日からの積算温度で開花進捗を算出（開花210℃/満開370℃）。関東・近郊の桜名所5件。'
      : '今が旬の花：' + flowers.join('、') + '。関東・近郊の実在する名所5件を選ぶ。';

    const prompt = '以下の条件で花スポット5件のミゴロン指数を算出してください。\n'
      + '条件：' + seasonInfo + '\n'
      + '日付：' + dateLabel + '\n'
      + '今日の天気：' + weather + '（最高' + max + '℃）\n'
      + '天気による指数補正：各スポットの指数から' + penalty + '%を差し引くこと。晴れ系は補正なし。\n\n'
      + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
      + '{"spots":[{"name":"ひたち海浜公園（茨城）","emoji":"🌼","score":65},{"name":"あしかがフラワーパーク（栃木）","emoji":"🌸","score":58},{"name":"昭和記念公園（東京）","emoji":"🌷","score":52},{"name":"国営武蔵丘陵森林公園（埼玉）","emoji":"🌿","score":45},{"name":"横浜公園（神奈川）","emoji":"🌺","score":38}],"memo":"今朝のコンディションを一言で"}';

    const raw = await callGemini(process.env.GEMINI_API_KEY, prompt);
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
      memo = weather + 'のため撮影条件に注意。';
    }

    const ranked = spots.sort((a, b) => b.score - a.score);

    let tweet = '花畑指数【' + dateLabel + '】\n';
    for (const s of ranked) {
      tweet += s.emoji + ' ' + s.name + '(' + s.score + '%)\n';
    }
    tweet += 'ミゴロンメモ：' + memo + '\n';
    tweet += '#花撮影 #風景写真 #ミゴロン';

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await xClient.v2.tweet(tweet);

    return new Response(JSON.stringify({ message: 'Success', tweet, weather, penalty }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
