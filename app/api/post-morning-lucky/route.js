import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTodayJST() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return {
    year:  jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day:   jst.getUTCDate(),
    dow:   ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()],
  };
}

function julianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function getRokuyo(year, month, day) {
  const list = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'];
  const jd = julianDay(year, month, day);
  const knownJD = julianDay(2026, 1, 1);
  const knownIdx = 2;
  const diff = jd - knownJD;
  return list[((diff + knownIdx) % 6 + 6) % 6];
}

function getIchryuManbaibi(year, month, day) {
  const kanshi = julianDay(year, month, day) % 60;
  const map = {
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
  return (map[month] || []).includes(kanshi);
}

function getTenshaDay(year, month, day) {
  const kanshi = julianDay(year, month, day) % 60;
  const map = {
    1:  [25], 2:  [25], 3:  [31], 4:  [31],
    5:  [37], 6:  [37], 7:  [43], 8:  [43],
    9:  [49], 10: [49], 11: [55], 12: [55],
  };
  return (map[month] || []).includes(kanshi);
}

function getHoliday(year, month, day) {
  const h = {
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
  return h[month + '-' + day] || null;
}

async function getWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const code = data.daily.weathercode[0];
    const max  = Math.round(data.daily.temperature_2m_max[0]);
    const min  = Math.round(data.daily.temperature_2m_min[0]);
    let weather, score;
    if (code === 0)      { weather = '快晴';     score = 100; }
    else if (code <= 2)  { weather = '晴れ';     score = 90;  }
    else if (code <= 3)  { weather = '曇り';     score = 70;  }
    else if (code <= 49) { weather = '霧';       score = 50;  }
    else if (code <= 59) { weather = '霧雨';     score = 40;  }
    else if (code <= 69) { weather = '雨';       score = 30;  }
    else if (code <= 79) { weather = '雪';       score = 20;  }
    else if (code <= 84) { weather = 'にわか雨'; score = 35;  }
    else                 { weather = '荒天';     score = 10;  }
    return { weather, score, max, min };
  } catch {
    return { weather: '晴れ', score: 70, max: '--', min: '--' };
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
        maxOutputTokens: 100,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  // 思考ブロックを除いてテキストのみ抽出
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  const text = textPart ? textPart.text : parts[parts.length - 1].text;
  return text.trim().replace(/\n/g, '');
}

export async function GET(request) {
  // 認証チェック一時無効（デバッグ用・確認後必ず戻すこと）

  try {
    const { year, month, day, dow } = getTodayJST();
    const rokuyo   = getRokuyo(year, month, day);
    const isIchryu = getIchryuManbaibi(year, month, day);
    const isTensha = getTenshaDay(year, month, day);
    const holiday  = getHoliday(year, month, day);
    const { weather, score: weatherScore, max, min } = await getWeather();

    let outing = weatherScore;
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
      + '天気：東京' + weather + '（最高' + max + '℃）\n'
      + '選日：' + (senjiText || 'なし') + '\n'
      + '条件：30文字以内、前向きな内容、文章のみ出力';

    const action = await callGemini(process.env.GEMINI_API_KEY, actionPrompt);

    const tweet = '⛩️お出かけ指数' + outing + '％ '
      + dateText + ' '
      + '東京' + weather + '（最高' + max + '℃）'
      + action + ' '
      + hashtag;

    return new Response(JSON.stringify({
      message: 'DEBUG',
      tweet,
      length: tweet.length,
      outing,
      rokuyo,
      weather,
      action
    }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
