import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

// 今日の日付（JST）
function getTodayJST() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return {
    year:  jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day:   jst.getUTCDate(),
    dow:   ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()],
  };
}

// 六曜計算
function getRokuyo(year, month, day) {
  const m = month <= 2 ? month + 12 : month;
  const y = month <= 2 ? year - 1 : year;
  const offset = (month + day) % 6;
  const list = ['先勝', '友引', '先負', '仏滅', '大安', '赤口'];
  // 旧暦月日の合計mod6で算出（簡易計算）
  const lunarBase = (Math.floor(y / 4) + Math.floor(y / 400) - Math.floor(y / 100) + y * 365 + Math.floor((m + 1) * 30.6) + day) % 6;
  return list[lunarBase];
}

// 一粒万倍日判定（干支カレンダーベース）
function getIchryuManbaiBi(year, month, day) {
  // 簡易判定：月ごとの一粒万倍日の日干支パターン
  const jd = julianDay(year, month, day);
  const kanshi = jd % 60;
  // 一粒万倍日の干支番号（子・卯・午・酉の日に特定の月）
  const ichryuMap = {
    1:  [1, 13, 25, 37, 49],
    2:  [4, 16, 28, 40, 52],
    3:  [7, 19, 31, 43, 55],
    4:  [10, 22, 34, 46, 58],
    5:  [1, 13, 25, 37, 49],
    6:  [4, 16, 28, 40, 52],
    7:  [7, 19, 31, 43, 55],
    8:  [10, 22, 34, 46, 58],
    9:  [1, 13, 25, 37, 49],
    10: [4, 16, 28, 40, 52],
    11: [7, 19, 31, 43, 55],
    12: [10, 22, 34, 46, 58],
  };
  return (ichryuMap[month] || []).includes(kanshi % 60);
}

// 天赦日判定
function getTenshaDay(year, month, day) {
  const jd = julianDay(year, month, day);
  const kanshi = jd % 60;
  const tenshaMap = {
    1: [25], 2: [25], 3: [31], 4: [31],
    5: [37], 6: [37], 7: [43], 8: [43],
    9: [49], 10: [49], 11: [55], 12: [55],
  };
  return (tenshaMap[month] || []).includes(kanshi % 60);
}

// ユリウス通日
function julianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

// 祝日判定（主要祝日）
function getHoliday(year, month, day) {
  const holidays = {
    '1-1':   '元日',
    '2-11':  '建国記念の日',
    '2-23':  '天皇誕生日',
    '3-20':  '春分の日',
    '4-29':  '昭和の日',
    '5-3':   '憲法記念日',
    '5-4':   'みどりの日',
    '5-5':   'こどもの日',
    '7-15':  '海の日',
    '8-11':  '山の日',
    '9-16':  '敬老の日',
    '9-23':  '秋分の日',
    '10-13': 'スポーツの日',
    '11-3':  '文化の日',
    '11-23': '勤労感謝の日',
  };
  return holidays[month + '-' + day] || null;
}

// Open-Meteoで東京の天気取得
async function getWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const code = data.daily.weathercode[0];
    const max  = Math.round(data.daily.temperature_2m_max[0]);
    const min  = Math.round(data.daily.temperature_2m_min[0]);

    let weather, score;
    if (code === 0)             { weather = '快晴';       score = 100; }
    else if (code <= 2)         { weather = '晴れ';       score = 90;  }
    else if (code <= 3)         { weather = '曇り';       score = 70;  }
    else if (code <= 49)        { weather = '霧';         score = 50;  }
    else if (code <= 59)        { weather = '霧雨';       score = 40;  }
    else if (code <= 69)        { weather = '雨';         score = 30;  }
    else if (code <= 79)        { weather = '雪';         score = 20;  }
    else if (code <= 84)        { weather = 'にわか雨';   score = 35;  }
    else                        { weather = '荒天';       score = 10;  }

    return { weather, score, max, min };
  } catch {
    return { weather: '情報取得中', score: 70, max: '--', min: '--' };
  }
}

// Geminiで投稿文生成
async function generateTweet(apiKey, prompt) {
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
    const { year, month, day, dow } = getTodayJST();
    const rokuyo   = getRokuyo(year, month, day);
    const isIchryu = getIchryuManbaiBi(year, month, day);
    const isTensha = getTenshaDay(year, month, day);
    const holiday  = getHoliday(year, month, day);
    const { weather, score: weatherScore, max, min } = await getWeather();

    // お出かけ指数計算
    let outing = weatherScore;
    if (rokuyo === '大安')  outing = Math.min(100, outing + 10);
    if (rokuyo === '仏滅')  outing = Math.max(10,  outing - 20);
    if (rokuyo === '赤口')  outing = Math.max(10,  outing - 10);
    if (isIchryu)           outing = Math.min(100, outing + 10);
    if (isTensha)           outing = Math.min(100, outing + 15);

    // 選日テキスト
    const senjiList = [];
    if (isIchryu) senjiList.push('一粒万倍日');
    if (isTensha) senjiList.push('天赦日');
    const senjiText = senjiList.length > 0 ? '・' + senjiList.join('・') : '';

    // 日付行
    const dateText = year + '年' + month + '月' + day + '日(' + dow + ')'
      + (holiday ? '・' + holiday : '')
      + '・' + rokuyo + senjiText;

    const prompt = 'あなたは開運コンサルタントです。以下の情報をもとにX投稿文を作成してください。\n\n'
      + 'お出かけ指数：' + outing + '%\n'
      + '日付情報：' + dateText + '\n'
      + '天気：東京' + weather + '（最高' + max + '℃・最低' + min + '℃）\n\n'
      + '【出力ルール】\n'
      + '⛩️お出かけ指数' + outing + '％ で必ず始める\n'
      + '日付情報を1行で入れる\n'
      + '天気に基づく開運アクションを1文で添える\n'
      + '合計140文字以内に収めること\n'
      + 'カメラ・撮影の言及禁止\n'
      + 'マークダウン・箇条書き禁止\n'
      + '最後に #開運 #お出かけ #' + (senjiList[0] || rokuyo) + '\n'
      + '投稿文のみ出力';

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

    return new Response(JSON.stringify({ message: 'Success', tweet, outing, rokuyo, weather }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
