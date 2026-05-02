import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTodayLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function getTodayLabelEN() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return jst.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
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

function getSeasonalFlowersEN() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  if (m === 1)            return ['Narcissus', 'Japanese winter sweet'];
  if (m === 2)            return ['Japanese plum', 'Rapeseed blossom', 'Narcissus'];
  if (m === 3)            return ['Cherry blossom', 'Rapeseed blossom', 'Japanese plum'];
  if (m === 4 && d <= 15) return ['Cherry blossom', 'Rapeseed blossom', 'Tulip'];
  if (m === 4 && d > 15)  return ['Nemophila', 'Azalea', 'Wisteria', 'Tulip'];
  if (m === 5)            return ['Nemophila', 'Azalea', 'Wisteria', 'Rose'];
  if (m === 6)            return ['Hydrangea', 'Rose', 'Poppy', 'Lavender'];
  if (m === 7)            return ['Sunflower', 'Lotus', 'Lavender'];
  if (m === 8)            return ['Sunflower', 'Lotus'];
  if (m === 9)            return ['Red spider lily', 'Cosmos'];
  if (m === 10)           return ['Cosmos', 'Autumn foliage'];
  if (m === 11)           return ['Autumn foliage', 'Cosmos'];
  if (m === 12)           return ['Narcissus', 'Japanese winter sweet'];
  return [];
}

function julianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function getRokuyo(year, month, day) {
  const list = ['先勝', '友引', '先負', '仏滅', '大安', '赤口'];
  return list[julianDay(year, month, day) % 6];
}

function getIchryuManbaibi(year, month, day) {
  const kanshi = julianDay(year, month, day) % 60;
  const map = {
    1:[1,13,25,37,49], 2:[4,16,28,40,52], 3:[7,19,31,43,55],
    4:[10,22,34,46,58], 5:[1,13,25,37,49], 6:[4,16,28,40,52],
    7:[7,19,31,43,55], 8:[10,22,34,46,58], 9:[1,13,25,37,49],
    10:[4,16,28,40,52], 11:[7,19,31,43,55], 12:[10,22,34,46,58],
  };
  return (map[month] || []).includes(kanshi);
}

function getTenshaDay(year, month, day) {
  const kanshi = julianDay(year, month, day) % 60;
  const map = {
    1:[25], 2:[25], 3:[31], 4:[31], 5:[37], 6:[37],
    7:[43], 8:[43], 9:[49], 10:[49], 11:[55], 12:[55],
  };
  return (map[month] || []).includes(kanshi);
}

function getHoliday(year, month, day) {
  const h = {
    '1-1':'元日', '2-11':'建国記念の日', '2-23':'天皇誕生日',
    '3-20':'春分の日', '4-29':'昭和の日', '5-3':'憲法記念日',
    '5-4':'みどりの日', '5-5':'こどもの日', '7-15':'海の日',
    '8-11':'山の日', '9-16':'敬老の日', '9-23':'秋分の日',
    '10-13':'スポーツの日', '11-3':'文化の日', '11-23':'勤労感謝の日',
  };
  return h[month + '-' + day] || null;
}

// 今日の6〜9時の天気をhourlyで取得
async function getMorningWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const hours = data.hourly.time;
    const codes = data.hourly.weathercode;
    const temps = data.hourly.temperature_2m;

    // 6〜9時のインデックスを取得
    const morningIndices = hours
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        const h = new Date(t).getHours();
        return h >= 6 && h <= 9;
      })
      .map(({ i }) => i);

    // 最悪コードと最高気温を取得
    const worstCode = Math.max(...morningIndices.map(i => codes[i]));
    const maxTemp   = Math.max(...morningIndices.map(i => temps[i]));

    let weatherJA, weatherEN, penalty, scoreWeather;
    if (worstCode === 0)      { weatherJA = '快晴';     weatherEN = 'clear skies';     penalty = 0;  scoreWeather = 100; }
    else if (worstCode <= 2)  { weatherJA = '晴れ';     weatherEN = 'sunny';           penalty = 0;  scoreWeather = 90;  }
    else if (worstCode <= 3)  { weatherJA = '曇り';     weatherEN = 'cloudy';          penalty = 10; scoreWeather = 70;  }
    else if (worstCode <= 49) { weatherJA = '霧';       weatherEN = 'foggy';           penalty = 20; scoreWeather = 50;  }
    else if (worstCode <= 67) { weatherJA = '雨';       weatherEN = 'rainy';           penalty = 30; scoreWeather = 30;  }
    else if (worstCode <= 69) { weatherJA = '大雨';     weatherEN = 'heavy rain';      penalty = 40; scoreWeather = 20;  }
    else if (worstCode <= 79) { weatherJA = '雪';       weatherEN = 'snowy';           penalty = 40; scoreWeather = 20;  }
    else if (worstCode <= 84) { weatherJA = 'にわか雨'; weatherEN = 'passing showers'; penalty = 20; scoreWeather = 35;  }
    else                      { weatherJA = '荒天';     weatherEN = 'stormy';          penalty = 50; scoreWeather = 10;  }

    return { weatherJA, weatherEN, penalty, scoreWeather, max: Math.round(maxTemp) };
  } catch {
    return { weatherJA: '晴れ', weatherEN: 'sunny', penalty: 0, scoreWeather: 90, max: '--' };
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

async function buildFlowerTweetJA(apiKey, dateLabel, sakura, flowers, weatherJA, penalty, max) {
  const seasonInfo = sakura
    ? '桜シーズン。2月1日からの積算温度で開花進捗を算出（開花210℃/満開370℃）。関東・近郊の桜名所5件。'
    : '今が旬の花：' + flowers.join('、') + '。関東・近郊の実在する名所5件を選ぶ。';

  const prompt = '以下の条件で花スポット5件のミゴロン指数を算出してください。\n'
    + '条件：' + seasonInfo + '\n'
    + '日付：' + dateLabel + '\n'
    + '今朝の天気：' + weatherJA + '（朝の最高' + max + '℃）\n'
    + '天気による指数補正：各スポットの指数から' + penalty + '%を差し引くこと。\n\n'
    + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
    + '{"spots":[{"name":"ひたち海浜公園（茨城）","emoji":"🌼","score":65},{"name":"あしかがフラワーパーク（栃木）","emoji":"🌸","score":58},{"name":"昭和記念公園（東京）","emoji":"🌷","score":52},{"name":"国営武蔵丘陵森林公園（埼玉）","emoji":"🌿","score":45},{"name":"横浜公園（神奈川）","emoji":"🌺","score":38}],"memo":"今朝のコンディションを一言で"}';

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
    memo = weatherJA + 'のため撮影条件に注意。';
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

async function buildFlowerTweetEN(apiKey, dateLabel, sakura, flowers, weatherEN, penalty, max) {
  const seasonInfo = sakura
    ? 'Cherry blossom season. Calculate bloom progress from Feb 1 accumulated temp (bloom at 210C, full bloom at 370C). Select 5 real sakura spots in Kanto.'
    : 'In-season flowers: ' + flowers.join(', ') + '. Select 5 real flower spots in Kanto region.';

  const prompt = 'Calculate Migoron Index for 5 flower spots in Kanto, Japan.\n'
    + 'Date: ' + dateLabel + '\n'
    + 'Season: ' + seasonInfo + '\n'
    + 'Weather this morning: ' + weatherEN + ' (morning max ' + max + 'C)\n'
    + 'Weather penalty: subtract ' + penalty + '% from each score.\n\n'
    + 'Return ONLY this JSON format, no markdown:\n'
    + '{"spots":[{"name":"Hitachi Seaside Park, Ibaraki","emoji":"🌼","score":65},{"name":"Ashikaga Flower Park, Tochigi","emoji":"🌸","score":58},{"name":"Showa Memorial Park, Tokyo","emoji":"🌷","score":52},{"name":"Musashino Forest Park, Saitama","emoji":"🌿","score":45},{"name":"Yokohama Park, Kanagawa","emoji":"🌺","score":38}],"memo":"One short sentence under 15 words"}';

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
      { name: 'Hitachi Seaside Park, Ibaraki', emoji: '🌼', score: Math.max(10, 95 - penalty) },
      { name: 'Ashikaga Flower Park, Tochigi', emoji: '🌸', score: Math.max(10, 88 - penalty) },
      { name: 'Showa Memorial Park, Tokyo', emoji: '🌷', score: Math.max(10, 82 - penalty) },
      { name: 'Musashino Forest Park, Saitama', emoji: '🌿', score: Math.max(10, 75 - penalty) },
      { name: 'Yokohama Park, Kanagawa', emoji: '🌺', score: Math.max(10, 68 - penalty) },
    ];
    memo = weatherEN + ' conditions this morning.';
  }

  const ranked = spots.sort((a, b) => b.score - a.score);
  let tweet = 'Bloom Index [' + dateLabel + ']\n';
  for (const s of ranked) {
    tweet += s.emoji + ' ' + s.name + ' (' + s.score + '%)\n';
  }
  tweet += 'Migoron Note: ' + memo + '\n';
  tweet += '#JapaneseFlowers #LandscapePhotography #Migoron';
  return tweet;
}

async function buildLuckyTweet(apiKey, weatherJA, scoreWeather, max) {
  const jst = new Date(Date.now() + 9 * 3600000);
  const year  = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const day   = jst.getUTCDate();
  const dow   = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];

  const rokuyo   = getRokuyo(year, month, day);
  const isIchryu = getIchryuManbaibi(year, month, day);
  const isTensha = getTenshaDay(year, month, day);
  const holiday  = getHoliday(year, month, day);

  let outing = scoreWeather;
  if (rokuyo === '大安')  outing = Math.min(100, outing + 10);
  if (rokuyo === '仏滅')  outing = Math.max(10,  outing - 20);
  if (rokuyo === '赤口')  outing = Math.max(10,  outing - 10);
  if (isIchryu)           outing = Math.min(100, outing + 10);
  if (isTensha)           outing = Math.min(100, outing + 15);

  const senjiList = [];
  if (isIchryu) senjiList.push('一粒万倍日');
  if (isTensha) senjiList.push('天赦日');
  const senjiText = senjiList.length > 0 ? '・' + senjiList.join('・') : '';

  const dateText = year + '年' + month + '月' + day + '日(' + dow + ')'
    + (holiday ? '・' + holiday : '')
    + '・' + rokuyo + senjiText;

  const hashtag = '#開運 #お出かけ #' + (senjiList[0] || rokuyo);

  const actionPrompt = 'Output only the final answer in Japanese. No thinking, no explanation, no reasoning.\n'
    + 'お出かけを促す開運アクションを1文で書いてください。\n'
    + '六曜：' + rokuyo + '\n'
    + '天気：東京' + weatherJA + '（最高' + max + '℃）\n'
    + '選日：' + (senjiText || 'なし') + '\n'
    + '条件：30文字以内、前向きな内容、文章のみ出力';

  const action = await callGemini(apiKey, actionPrompt, 100);

  return '⛩️お出かけ指数' + outing + '％ '
    + dateText + ' '
    + '東京' + weatherJA + '（最高' + max + '℃）'
    + action + ' '
    + hashtag;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const API_KEY     = process.env.GEMINI_API_KEY;
    const dateLabel   = getTodayLabel();
    const dateLabelEN = getTodayLabelEN();
    const sakura      = isSakuraSeason();
    const flowers     = getSeasonalFlowers();
    const flowersEN   = getSeasonalFlowersEN();
    const { weatherJA, weatherEN, penalty, scoreWeather, max } = await getMorningWeather();

    const tweetEN    = await buildFlowerTweetEN(API_KEY, dateLabelEN, sakura, flowersEN, weatherEN, penalty, max);
    const tweetLucky = await buildLuckyTweet(API_KEY, weatherJA, scoreWeather, max);
    const tweetJA    = await buildFlowerTweetJA(API_KEY, dateLabel, sakura, flowers, weatherJA, penalty, max);

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    const results = {};
    for (const [key, text] of [
      ['flower_en', tweetEN],
      ['lucky',     tweetLucky],
      ['flower_ja', tweetJA],
    ]) {
      try {
        await xClient.v2.tweet(text);
        results[key] = { ok: true };
      } catch (err) {
        results[key] = { ok: false, error: err.message };
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({ message: 'Success', results, weatherJA, penalty }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
