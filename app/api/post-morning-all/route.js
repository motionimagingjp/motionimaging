// app/api/post-morning-all/route.js
// 朝のX投稿（3本）＋Threads
// ============================================================
// 2026-07-24 改修版 v3
//
//  ★ 今回の主眼：Xの「重み付き文字数」に対応
//    Xの280字制限は重み付きで、CJK（漢字・かな・全角記号）と絵文字は
//    1文字あたり2としてカウントされます。日本語は実質140字までです。
//    従来は text.length（CJKを1と数える）で判定していたため、
//    日本語版の花畑指数が上限を超えて弾かれる日がありました。
//    「全部通る日と抜ける日がある」原因はこれです。
//
//    - weightedLength() でXと同じ数え方を実装
//    - 日本語版・英語版・開運指数すべてに段階的短縮を適用
//    - レポートには重み付き文字数(w)を記録
//
//  ★ 併せて追加
//    - X投稿の自動リトライ（重複403は再試行しない）
//    - Threads投稿にタイムアウト（ハングで全体を止めない）
//
//  ※ Instagramは独立cron（/api/post-instagram、/api/post-jake-images）
//    このファイルからは呼びません。vercel.json も5本構成のものを使用。
//
//  クエリパラメータ
//    ?key=CRON_SECRET  … ブラウザから直接実行
//    ?report=1         … 前回の実行レポートを表示（投稿しない）
//    ?dry=1            … 投稿せず本文と重み付き文字数を確認
//    ?skip=lucky,...   … 個別スキップ
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const X_LIMIT = 280;      // Xの重み付き上限
const X_TARGET = 272;     // 余裕を見た目標値

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// Xの重み付き文字数（twitter-text と同じ規則）
//   重み1：U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, U+2032–U+2037
//   それ以外（CJK・全角記号・絵文字など）は重み2
//   URLは実際の長さに関わらず23
// ============================================================
function weightedLength(text) {
  // URLを先に23として計上し、本文から除外する
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  const stripped = text.replace(urlRegex, '');

  let total = urls.length * 23;

  for (const ch of stripped) {          // for...of はコードポイント単位
    const cp = ch.codePointAt(0);
    const isWeight1 =
      (cp >= 0x0000 && cp <= 0x10ff) ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    total += isWeight1 ? 1 : 2;
  }
  return total;
}

// 重み付きで n 以内に収まるよう末尾を落とす
function clipWeighted(str, maxWeight) {
  str = String(str);
  if (weightedLength(str) <= maxWeight) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = weightedLength(ch);
    if (w + cw > maxWeight - 1) break;   // 末尾の「…」分を確保
    out += ch;
    w += cw;
  }
  return out.trim() + '…';
}

// ============================================================
// 日付・季節
// ============================================================
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

// ============================================================
// 暦
// ============================================================
function julianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

// ============================================================
// 六曜（2026-09 修正）
//
//  旧実装は julianDay % 6 で算出していたが根本的に誤り。
//  六曜は「(旧暦月 + 旧暦日) % 6」で決まり、朔（新月）のたびに
//  旧暦1日にリセットされる。単純な通日の剰余では朔をまたぐたびに
//  ズレが発生する。実際 2026/9/11(朔) を境に
//  9/11「友引→赤口」9/12「先負→先勝」と2日連続で誤投稿していた。
//
//  修正版は Meeus の朔時刻計算で直近の新月を求め、
//  旧暦日・旧暦月を出してから六曜を決定する。
//  2026/9/10〜9/17 の8日間で暦データと完全一致を確認済み。
// ============================================================
const ROKUYO_LIST = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'];
const NM_ANCHOR_K = 330;   // 2026-09-11 の朔
const NM_ANCHOR_MONTH = 8; // そのときの旧暦月

function newMoonJde(k) {
  const rad = Math.PI / 180;
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k
          + 0.00015437 * T * T - 0.000000150 * Math.pow(T, 3) + 0.00000000073 * Math.pow(T, 4);
  const E  = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M  = ((2.5534 + 29.10535670 * k - 0.0000014 * T * T - 0.00000011 * Math.pow(T, 3)) % 360) * rad;
  const Mp = ((201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * Math.pow(T, 3)) % 360) * rad;
  const F  = ((160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * Math.pow(T, 3)) % 360) * rad;
  const O  = ((124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * Math.pow(T, 3)) % 360) * rad;

  jde += -0.40720 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp)
       + 0.01039 * Math.sin(2 * F) + 0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M)
       + 0.00208 * E * E * Math.sin(2 * M) - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F)
       + 0.00056 * E * Math.sin(2 * Mp + M) - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F)
       + 0.00038 * E * Math.sin(M - 2 * F) - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O)
       - 0.00007 * Math.sin(Mp + 2 * M);

  const corr = [
    [0.000325, 299.77,  0.107408, -0.009173], [0.000165, 251.88,  0.016321, 0],
    [0.000164, 251.83, 26.651886, 0],         [0.000126, 349.42, 36.412478, 0],
    [0.000110,  84.66, 18.206239, 0],         [0.000062, 141.74, 53.303771, 0],
    [0.000060, 207.14,  2.453732, 0],         [0.000056, 154.84,  7.306860, 0],
    [0.000047,  34.52, 27.261239, 0],         [0.000042, 207.19,  0.121824, 0],
    [0.000040, 291.34,  1.844379, 0],         [0.000037, 161.72, 24.198154, 0],
    [0.000035, 239.56, 25.513099, 0],         [0.000023, 331.55,  3.592518, 0],
  ];
  for (const c of corr) {
    jde += c[0] * Math.sin((c[1] + c[2] * k + c[3] * T * T) * rad);
  }
  return jde;
}

function newMoonJdnJst(k) {
  return Math.floor(newMoonJde(k) + 0.5 + 9 / 24);
}

function getLunarDate(year, month, day) {
  const jdn = julianDay(year, month, day);
  const k0 = Math.round((jdn - 2451550.0) / 29.530588861);
  let bestK = null, bestNm = -Infinity;
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    const nm = newMoonJdnJst(k);
    if (nm <= jdn && nm > bestNm) { bestNm = nm; bestK = k; }
  }
  const lunarDay = jdn - bestNm + 1;
  const lunarMonth = (((bestK - NM_ANCHOR_K + NM_ANCHOR_MONTH - 1) % 12) + 12) % 12 + 1;
  return { lunarMonth, lunarDay };
}

function getRokuyo(year, month, day) {
  const ld = getLunarDate(year, month, day);
  return ROKUYO_LIST[(ld.lunarMonth + ld.lunarDay) % 6];
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


// ============================================================
// 季節別スポット（2026-09 追加）
//
//  旧実装のフォールバックは「ひたち海浜公園/あしかがフラワーパーク/
//  昭和記念公園/武蔵丘陵森林公園/横浜公園」の固定5件だった。
//  これは春の藤・ネモフィラ期を前提にした並びで、9月に出すと
//  季節外れになる。月ごとに実際の見頃スポットへ差し替える。
// ============================================================
const SEASONAL_SPOTS = {
  1:  [['熱海梅園（静岡）','🌼',70],['吾妻山公園（神奈川）','🌼',65],['小石川後楽園（東京）','🌸',58],['筑波山梅林（茨城）','🌸',52],['越生梅林（埼玉）','🌿',45]],
  2:  [['偕楽園（茨城）','🌸',85],['越生梅林（埼玉）','🌸',78],['吾妻山公園（神奈川）','🌼',70],['熱海梅園（静岡）','🌸',62],['湯河原梅林（神奈川）','🌿',55]],
  3:  [['権現堂堤（埼玉）','🌸',88],['小田原城址公園（神奈川）','🌸',80],['千鳥ヶ淵（東京）','🌸',74],['三浦海岸（神奈川）','🌸',66],['吉見百穴（埼玉）','🌿',58]],
  4:  [['ひたち海浜公園（茨城）','💙',92],['あしかがフラワーパーク（栃木）','🌸',85],['根津神社（東京）','🌺',76],['昭和記念公園（東京）','🌷',68],['秩父羊山公園（埼玉）','🌸',60]],
  5:  [['ひたち海浜公園（茨城）','💙',88],['あしかがフラワーパーク（栃木）','🌸',82],['京成バラ園（千葉）','🌹',75],['秩父羊山公園（埼玉）','🌸',66],['塩船観音寺（東京）','🌺',58]],
  6:  [['明月院（神奈川）','💠',90],['本土寺（千葉）','💠',82],['権現堂堤（埼玉）','💠',74],['横須賀しょうぶ園（神奈川）','🌿',66],['京成バラ園（千葉）','🌹',58]],
  7:  [['座間ひまわり畑（神奈川）','🌻',88],['古河公方公園（茨城）','🪷',80],['清水公園（千葉）','🪷',72],['たてやま西岬（千葉）','🌻',64],['あけぼの山農業公園（千葉）','🌻',56]],
  8:  [['座間ひまわり畑（神奈川）','🌻',85],['明野ひまわり畑（山梨）','🌻',78],['上野不忍池（東京）','🪷',70],['清水公園（千葉）','🪷',62],['那須フラワーワールド（栃木）','🌺',54]],
  9:  [['巾着田曼珠沙華公園（埼玉）','🌺',90],['ひたち海浜公園（茨城）','🍀',82],['くりはま花の国（神奈川）','🌸',74],['権現堂堤（埼玉）','🌺',66],['昭和記念公園（東京）','🌼',58]],
  10: [['ひたち海浜公園（茨城）','🍁',92],['昭和記念公園（東京）','🌼',82],['くりはま花の国（神奈川）','🌸',74],['鼻高展望花の丘（群馬）','🌼',66],['小江戸川越（埼玉）','🍁',58]],
  11: [['高尾山（東京）','🍁',90],['永観堂もみじ（東京）','🍁',80],['長瀞（埼玉）','🍁',74],['日光いろは坂（栃木）','🍁',66],['昭和記念公園（東京）','🍁',58]],
  12: [['六義園（東京）','🍁',72],['明治神宮外苑（東京）','🍂',64],['爪木崎（静岡）','🌼',56],['あしかがフラワーパーク（栃木）','✨',50],['なばなの里（三重）','✨',44]],
};

function getFallbackSpots(month, penalty) {
  const rows = SEASONAL_SPOTS[month] || SEASONAL_SPOTS[9];
  return rows.map(function (r) {
    return { name: r[0], emoji: r[1], score: Math.max(10, Math.round(r[2] - penalty)) };
  });
}

// Geminiがプロンプトの例示JSONをそのまま返していないか検査する
// （例示の数値をそのままコピーして返す事故が実際に発生していた）
function looksLikeEchoedExample(spots) {
  if (!Array.isArray(spots) || spots.length === 0) return true;
  const scores = spots.map(function (s) { return Number(s.score); });
  const banned = [65, 58, 52, 45, 38];   // 旧プロンプトの例示値
  let hit = 0;
  for (let i = 0; i < scores.length && i < banned.length; i++) {
    if (scores[i] === banned[i]) hit++;
  }
  return hit >= 4;
}

// 安全なJSON抽出（失敗してもnullを返すだけで死なない）
function safeParseJson(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ============================================================
// 天気
// ============================================================
async function getDaytimeWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const hours = data.hourly.time;
    const codes = data.hourly.weathercode;
    const temps = data.hourly.temperature_2m;
    const dayIndices = hours.map((t, i) => ({ t, i })).filter(({ t }) => {
      const h = new Date(t).getHours();
      return h >= 6 && h <= 20;
    }).map(({ i }) => i);
    const worstCode = Math.max(...dayIndices.map(i => codes[i]));
    const maxTemp   = Math.max(...dayIndices.map(i => temps[i]));
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

// ============================================================
// Gemini
// ============================================================
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

// ============================================================
// 花畑指数（日本語）— 重み付きで必ず280以内に収める
// ============================================================
async function buildFlowerTweetJA(apiKey, dateLabel, sakura, flowers, weatherJA, penalty, max, month, diag) {
  const seasonInfo = sakura
    ? '桜シーズン。2月1日からの積算温度で開花進捗を算出（開花210℃/満開370℃）。関東・近郊の桜名所5件。'
    : '今が旬の花：' + flowers.join('、') + '。関東・近郊の実在する名所5件を選ぶ。';
  let parsed = null;
  try {
    // 例示JSONに具体的な数値を書くと、Geminiがそれをそのままコピーして
    // 返してくることがある（2026年9月に3日連続で同一内容が投稿された原因）。
    // スキーマだけを示し、数値は必ず自分で算出させる。
    const prompt = '以下の条件で花スポット5件のミゴロン指数を算出してください。\n'
      + '条件：' + seasonInfo + '\n'
      + '日付：' + dateLabel + '\n'
      + '今日の天気：' + weatherJA + '（最高' + max + '℃）\n'
      + '天気による指数補正：各スポットの指数から' + penalty + '%を差し引くこと。\n'
      + '【重要】スコアは必ず今日の天気と季節から自分で計算すること。例示の数値をそのまま使わないこと。\n'
      + 'スポット名は12文字以内、memoは20文字以内で簡潔に。\n'
      + 'スコアは整数（小数点なし）、10〜100の範囲。\n\n'
      + '次のスキーマのJSONのみで返答（マークダウン不要）：\n'
      + '{"spots":[{"name":"<スポット名（都県名）>","emoji":"<花の絵文字>","score":<整数>}],"memo":"<今日のコンディションを一言>"}';
    const raw = await callGemini(apiKey, prompt);
    parsed = safeParseJson(raw);
  } catch { parsed = null; }

  let spots, memo;
  if (parsed && Array.isArray(parsed.spots) && parsed.spots.length > 0) {
    spots = parsed.spots.filter(s => s && s.name && typeof s.score !== 'undefined');
    memo  = parsed.memo || '各地で花が見頃です。';
  } else {
    spots = [];
  }

  // 例示JSONの丸写しを検出したらフォールバックに切り替える
  if (spots.length > 0 && looksLikeEchoedExample(spots)) {
    if (diag) diag.flower_ja_source = 'echo検出→季節フォールバック';
    spots = [];
  }

  if (spots.length === 0) {
    spots = getFallbackSpots(month, penalty);
    memo  = weatherJA + 'の一日、見頃の花をチェック。';
    if (diag && !diag.flower_ja_source) diag.flower_ja_source = 'フォールバック（Gemini失敗）';
  } else {
    if (diag) diag.flower_ja_source = diag.flower_ja_source || 'Gemini';
  }

  // スコアを整数に正規化（38.5% のような小数表示を防ぐ）
  spots = spots.map(s => ({
    name: s.name,
    emoji: s.emoji || '🌸',
    score: Math.max(10, Math.min(100, Math.round(Number(s.score) || 10))),
  }));

  const ranked = spots.slice().sort((a, b) => b.score - a.score);

  // nameW: スポット名の重み上限 / memoW: メモの重み上限 / count: 掲載件数
  const build = (nameW, memoW, count) => {
    let t = '花畑指数【' + dateLabel + '】\n';
    for (const s of ranked.slice(0, count)) {
      const emoji = s.emoji || '🌸';
      t += emoji + ' ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    }
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '#花撮影 #風景写真 #ミゴロン';
    return t;
  };

  // 段階的に削りながら、最初に収まったものを採用
  const plans = [
    [30, 44, 5], [26, 36, 5], [24, 28, 5],
    [22, 20, 5], [22,  0, 5], [20,  0, 5],
    [20,  0, 4], [18,  0, 4], [18,  0, 3],
  ];
  for (const [nameW, memoW, count] of plans) {
    const t = build(nameW, memoW, count);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  // 最終手段：最小構成をさらに強制的に切り詰める
  return clipWeighted(build(16, 0, 3), X_LIMIT);
}

// ============================================================
// 花畑指数（英語）
// ============================================================
async function buildFlowerTweetEN(apiKey, dateLabel, sakura, flowers, weatherEN, penalty, max, month, diag) {
  const seasonInfo = sakura
    ? 'Cherry blossom season. Calculate bloom progress from Feb 1 accumulated temp (bloom at 210C, full bloom at 370C). Select 5 real sakura spots in Kanto.'
    : 'In-season flowers: ' + flowers.join(', ') + '. Select 5 real flower spots in Kanto region.';
  let parsed = null;
  try {
    // 日本語版と同じく、例示に具体的な数値を書かない（丸写し対策）
    const prompt = 'Calculate Migoron Index for 5 flower spots in Kanto, Japan.\n'
      + 'Date: ' + dateLabel + '\n'
      + 'Season: ' + seasonInfo + '\n'
      + 'Weather today: ' + weatherEN + ' (max ' + max + 'C)\n'
      + 'Weather penalty: subtract ' + penalty + '% from each score.\n'
      + 'IMPORTANT: compute every score yourself from the season and weather. Never reuse numbers from the schema.\n'
      + 'Scores must be integers between 10 and 100. Spot names under 30 characters.\n\n'
      + 'Return ONLY JSON in this schema, no markdown:\n'
      + '{"spots":[{"name":"<Spot Name, Prefecture>","emoji":"<flower emoji>","score":<integer>}],"memo":"<one short sentence under 15 words>"}';
    const raw = await callGemini(apiKey, prompt);
    parsed = safeParseJson(raw);
  } catch { parsed = null; }

  let spots, memo;
  if (parsed && Array.isArray(parsed.spots) && parsed.spots.length > 0) {
    spots = parsed.spots.filter(s => s && s.name && typeof s.score !== 'undefined');
    memo  = parsed.memo || 'Flowers in season across Kanto.';
  } else {
    spots = [];
  }

  if (spots.length > 0 && looksLikeEchoedExample(spots)) {
    if (diag) diag.flower_en_source = 'echo検出→季節フォールバック';
    spots = [];
  }

  if (spots.length === 0) {
    // 英語版のフォールバックも季節連動にする
    const EN_FALLBACK = {
      1:  [['Atami Plum Garden, Shizuoka','🌼',70],['Azumayama Park, Kanagawa','🌼',65],['Koishikawa Korakuen, Tokyo','🌸',58],['Mt. Tsukuba Plum, Ibaraki','🌸',52],['Ogose Plum Grove, Saitama','🌿',45]],
      2:  [['Kairakuen, Ibaraki','🌸',85],['Ogose Plum Grove, Saitama','🌸',78],['Azumayama Park, Kanagawa','🌼',70],['Atami Plum Garden, Shizuoka','🌸',62],['Yugawara Plum, Kanagawa','🌿',55]],
      3:  [['Gongendo Embankment, Saitama','🌸',88],['Odawara Castle, Kanagawa','🌸',80],['Chidorigafuchi, Tokyo','🌸',74],['Miura Beach, Kanagawa','🌸',66],['Yoshimi Hyakuana, Saitama','🌿',58]],
      4:  [['Hitachi Seaside Park, Ibaraki','💙',92],['Ashikaga Flower Park, Tochigi','🌸',85],['Nezu Shrine, Tokyo','🌺',76],['Showa Memorial Park, Tokyo','🌷',68],['Hitsujiyama Park, Saitama','🌸',60]],
      5:  [['Hitachi Seaside Park, Ibaraki','💙',88],['Ashikaga Flower Park, Tochigi','🌸',82],['Keisei Rose Garden, Chiba','🌹',75],['Hitsujiyama Park, Saitama','🌸',66],['Shiofune Kannon, Tokyo','🌺',58]],
      6:  [['Meigetsuin, Kanagawa','💠',90],['Hondoji Temple, Chiba','💠',82],['Gongendo Embankment, Saitama','💠',74],['Yokosuka Iris Garden, Kanagawa','🌿',66],['Keisei Rose Garden, Chiba','🌹',58]],
      7:  [['Zama Sunflower Field, Kanagawa','🌻',88],['Kogakubo Park, Ibaraki','🪷',80],['Shimizu Park, Chiba','🪷',72],['Tateyama Nishizaki, Chiba','🌻',64],['Akebonoyama Park, Chiba','🌻',56]],
      8:  [['Zama Sunflower Field, Kanagawa','🌻',85],['Akeno Sunflower Field, Yamanashi','🌻',78],['Shinobazu Pond, Tokyo','🪷',70],['Shimizu Park, Chiba','🪷',62],['Nasu Flower World, Tochigi','🌺',54]],
      9:  [['Kinchakuda Manjushage Park, Saitama','🌺',90],['Hitachi Seaside Park, Ibaraki','🍀',82],['Kurihama Flower Park, Kanagawa','🌸',74],['Gongendo Embankment, Saitama','🌺',66],['Showa Memorial Park, Tokyo','🌼',58]],
      10: [['Hitachi Seaside Park, Ibaraki','🍁',92],['Showa Memorial Park, Tokyo','🌼',82],['Kurihama Flower Park, Kanagawa','🌸',74],['Hanadaka Hill, Gunma','🌼',66],['Koedo Kawagoe, Saitama','🍁',58]],
      11: [['Mt. Takao, Tokyo','🍁',90],['Jindaiji Temple, Tokyo','🍁',80],['Nagatoro, Saitama','🍁',74],['Irohazaka, Tochigi','🍁',66],['Showa Memorial Park, Tokyo','🍁',58]],
      12: [['Rikugien, Tokyo','🍁',72],['Meiji Jingu Gaien, Tokyo','🍂',64],['Tsumekizaki, Shizuoka','🌼',56],['Ashikaga Flower Park, Tochigi','✨',50],['Nabana no Sato, Mie','✨',44]],
    };
    const rows = EN_FALLBACK[month] || EN_FALLBACK[9];
    spots = rows.map(r => ({ name: r[0], emoji: r[1], score: Math.max(10, Math.round(r[2] - penalty)) }));
    memo  = weatherEN + ' conditions today.';
    if (diag && !diag.flower_en_source) diag.flower_en_source = 'フォールバック（Gemini失敗）';
  } else {
    if (diag) diag.flower_en_source = diag.flower_en_source || 'Gemini';
  }

  spots = spots.map(s => ({
    name: s.name,
    emoji: s.emoji || '🌸',
    score: Math.max(10, Math.min(100, Math.round(Number(s.score) || 10))),
  }));

  const ranked = spots.slice().sort((a, b) => b.score - a.score);

  const build = (nameW, memoW, count) => {
    let t = '🌸 Kanto Bloom Report — ' + dateLabel + '\n';
    let rank = 1;
    for (const s of ranked.slice(0, count)) {
      t += rank + '. ' + clipWeighted(s.name, nameW) + ' — ' + s.score + '%\n';
      rank++;
    }
    if (memoW > 0) t += 'Note: ' + clipWeighted(memo, memoW) + '\n';
    t += '#JapanFlowers #LandscapePhotography #Migoron';
    return t;
  };

  const plans = [
    [34, 60, 5], [30, 45, 5], [28, 30, 5],
    [26,  0, 5], [22,  0, 5], [22,  0, 4], [20,  0, 3],
  ];
  for (const [nameW, memoW, count] of plans) {
    const t = build(nameW, memoW, count);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  return clipWeighted(build(18, 0, 3), X_LIMIT);
}

// ============================================================
// お出かけ開運指数
// ============================================================
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

  let action = '今日も良い一日を！';
  try {
    const actionPrompt = 'Output only the final answer in Japanese. No thinking, no explanation, no reasoning.\n'
      + 'お出かけを促す開運アクションを1文で書いてください。\n'
      + '六曜：' + rokuyo + '\n'
      + '天気：東京' + weatherJA + '（最高' + max + '℃）\n'
      + '選日：' + (senjiText || 'なし') + '\n'
      + '条件：30文字以内、前向きな内容、文章のみ出力';
    const raw = await callGemini(apiKey, actionPrompt, 100);
    if (raw) action = raw.replace(/\n/g, '');
  } catch { /* フォールバック文を使用 */ }

  const build = (actionW) => {
    const a = actionW > 0 ? clipWeighted(action, actionW) : '';
    return '⛩️お出かけ指数' + outing + '％ '
      + dateText + ' '
      + '東京' + weatherJA + '（最高' + max + '℃）'
      + a + ' '
      + hashtag;
  };

  for (const w of [70, 56, 40, 24, 0]) {
    const t = build(w);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  return clipWeighted(build(0), X_LIMIT);
}

// ============================================================
// Threads（テキスト・ベストエフォート・タイムアウト付き）
// ============================================================
async function postTextToThreads(token, text) {
  if (!token) return null;
  const meRes = await fetch('https://graph.threads.net/v1.0/me?fields=id&access_token=' + token);
  const me = await meRes.json();
  if (me.error) throw new Error('Threads me: ' + me.error.message);
  const cRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token }),
  });
  const c = await cRes.json();
  if (c.error) throw new Error('Threads container: ' + c.error.message);
  await new Promise(r => setTimeout(r, 2000));
  const pRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads_publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: token }),
  });
  const p = await pRes.json();
  if (p.error) throw new Error('Threads publish: ' + p.error.message);
  return p.id;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} タイムアウト(${ms}ms)`)), ms)),
  ]);
}

// ============================================================
// X投稿（リトライ付き・重複403は再試行しない）
// ============================================================
function isDuplicateError(err) {
  const msg = ((err && err.message) || '') + ' ' + JSON.stringify((err && err.data) || {});
  return /duplicate/i.test(msg) || (err && err.code === 403);
}

// mediaId を渡すと画像付きで投稿する。画像アップロード自体は事前に
// 済ませておき、ここでは media_ids をツイート本文に添えるだけ。
async function tweetWithRetry(xClient, text, attempts = 3, mediaId = null) {
  let lastErr = null;
  const options = mediaId ? { media: { media_ids: [mediaId] } } : {};
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await xClient.v2.tweet(text, options);
      return { ok: true, id: res && res.data ? res.data.id : null, attempts: i };
    } catch (err) {
      lastErr = err;
      if (isDuplicateError(err)) {
        return { ok: false, duplicate: true, error: err, attempts: i };
      }
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  return { ok: false, duplicate: false, error: lastErr, attempts };
}

function describeXError(err, text, attempts) {
  const detail = err && err.data ? JSON.stringify(err.data).slice(0, 300) : '';
  return 'error: ' + (err && err.message ? err.message : String(err))
    + (detail ? ' | detail: ' + detail : '')
    + ' | w:' + weightedLength(text)
    + ' | attempts:' + attempts;
}


// ============================================================
// X投稿への画像添付（2026-09 追加）
//
//  Instagram側と同じ「連番フォルダ + Redisローテーション」方式。
//  スポット名と写真の厳密な一致は求めない（写真の枚数に対して
//  スポット候補数の方が多いため）。カテゴリ単位で順番に使い回す。
// ============================================================
// ファイル名は連番だが 5桁・カテゴリごとに開始番号が違う実物に合わせる
//   富士山: 00101, 00102, ...   花: 00201, 00202, ...   星: 00301, 00302, ...
const IMAGE_CATEGORIES = {
  flower: { path: 'flower', count: parseInt(process.env.FLOWER_IMAGE_COUNT || '17'), startNum: 201 },
  fuji:   { path: 'fuji',   count: parseInt(process.env.FUJI_IMAGE_COUNT   || '11'), startNum: 101 },
  star:   { path: 'star',   count: parseInt(process.env.STAR_IMAGE_COUNT  || '8'),  startNum: 301 },
};

function buildPhotoUrl(category, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const cat    = IMAGE_CATEGORIES[category];
  const num    = String(cat.startNum + index).padStart(5, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-images/${category}/${num}.jpg`;
}

async function getNextPhotoIndex(category) {
  const cat = IMAGE_CATEGORIES[category];
  const key = `x_photo_idx_${category}`;
  let current = await redis.get(key);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % cat.count;
  return { next, key };
}

// 画像をダウンロードしてXにアップロードし、media_idを返す。
// 失敗しても呼び出し元は「画像なしで投稿続行」にフォールバックできるよう
// エラーはthrowせず null を返す。
async function uploadPhotoToX(xClient, category, imageIndex) {
  try {
    const url = buildPhotoUrl(category, imageIndex);  // startNum + index で組み立てるため+1しない
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`画像取得失敗 [${category}] ${url} status=${res.status}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mediaId = await xClient.v1.uploadMedia(buffer, { mimeType: 'image/jpeg' });
    return mediaId;
  } catch (e) {
    console.error(`画像アップロード失敗 [${category}]:`, e.message);
    return null;
  }
}

// ============================================================
// メインハンドラ
// ============================================================
export async function GET(request) {
  const url = new URL(request.url);

  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  // ?report=1 → 前回の実行レポートを表示するだけ（投稿しない）
  if (url.searchParams.get('report') === '1') {
    try {
      const [morning, motion, jake] = await Promise.all([
        redis.get('last_morning_report'),
        redis.get('ig_motion_posted_date'),
        redis.get('ig_jake_posted_date'),
      ]);
      const parsed = typeof morning === 'string' ? JSON.parse(morning) : morning;
      return new Response(JSON.stringify({
        lastMorningReport: parsed,
        instagramLastPosted: {
          'motion.imaging': motion || '(記録なし)',
          'jake_images_':   jake   || '(記録なし)',
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const skipList = (url.searchParams.get('skip') || '').split(',').filter(Boolean);
  const dryRun   = url.searchParams.get('dry') === '1';

  const t0 = Date.now();
  const report = {
    x: {},
    threads: {},
    lengths: {},
    weather: null,
    dryRun,
    startedAt: new Date().toISOString(),
  };

  try {
    const API_KEY     = process.env.GEMINI_API_KEY;
    const dateLabel   = getTodayLabel();
    const dateLabelEN = getTodayLabelEN();
    const sakura      = isSakuraSeason();
    const flowers     = getSeasonalFlowers();
    const flowersEN   = getSeasonalFlowersEN();
    const weather     = await getDaytimeWeather();
    report.weather = weather.weatherJA;

    const jstNow     = new Date(Date.now() + 9 * 3600000);
    const curMonth   = jstNow.getUTCMonth() + 1;
    const tweetEN    = await buildFlowerTweetEN(API_KEY, dateLabelEN, sakura, flowersEN, weather.weatherEN, weather.penalty, weather.max, curMonth, report);
    const tweetLucky = await buildLuckyTweet(API_KEY, weather.weatherJA, weather.scoreWeather, weather.max);
    const tweetJA    = await buildFlowerTweetJA(API_KEY, dateLabel, sakura, flowers, weather.weatherJA, weather.penalty, weather.max, curMonth, report);

    // 重み付き文字数を必ず記録（超過していれば一目で分かる）
    report.lengths = {
      flower_en: { weighted: weightedLength(tweetEN),    raw: tweetEN.length },
      lucky:     { weighted: weightedLength(tweetLucky), raw: tweetLucky.length },
      flower_ja: { weighted: weightedLength(tweetJA),    raw: tweetJA.length },
      limit: X_LIMIT,
    };

    if (dryRun) {
      report.finishedAt = new Date().toISOString();
      report.totalMs = Date.now() - t0;
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweets: {
          flower_en: { weighted: weightedLength(tweetEN),    text: tweetEN },
          lucky:     { weighted: weightedLength(tweetLucky), text: tweetLucky },
          flower_ja: { weighted: weightedLength(tweetJA),    text: tweetJA },
        },
        report,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    // 花畑指数（日本語）にだけ、花カテゴリの画像をローテーションで添付する。
    // ?noimage=1 を付けると画像なしでテスト投稿できる（デバッグ用）。
    const noImage = url.searchParams.get('noimage') === '1';
    const IMAGE_MAP = { flower_ja: 'flower' };  // 将来: lucky等に別カテゴリを足す場合はここに追加

    const entries = [
      ['flower_en', tweetEN],
      ['lucky',     tweetLucky],
      ['flower_ja', tweetJA],
    ];

    for (let idx = 0; idx < entries.length; idx++) {
      const [key, text] = entries[idx];
      if (skipList.includes(key)) { report.x[key] = 'skipped'; continue; }

      // ---- 画像の準備（対象カテゴリがあれば） ----
      let mediaId = null;
      let photoMeta = null;
      const category = IMAGE_MAP[key];
      if (category && !noImage) {
        const { next, key: photoKey } = await getNextPhotoIndex(category);
        mediaId = await uploadPhotoToX(xClient, category, next);
        photoMeta = { category, index: next, photoKey, uploaded: !!mediaId };
        const shownNum = String(IMAGE_CATEGORIES[category].startNum + next).padStart(5, '0');
        report[`${key}_image`] = mediaId
          ? `添付成功 (${category}/${shownNum}.jpg)`
          : `添付失敗（画像なしで投稿続行） (${category}/${shownNum}.jpg)`;
      }

      const r = await tweetWithRetry(xClient, text, 3, mediaId);
      if (r.ok) {
        report.x[key] = 'ok (w:' + weightedLength(text) + (r.attempts > 1 ? `, ${r.attempts}回目で成功` : '') + ')';
        // 画像投稿が成功した場合のみローテーションを進める
        if (photoMeta && photoMeta.uploaded) {
          await redis.set(photoMeta.photoKey, photoMeta.index);
        }
      } else if (r.duplicate) {
        report.x[key] = '重複のため投稿されず | w:' + weightedLength(text);
      } else {
        report.x[key] = describeXError(r.error, text, r.attempts);
      }

      // Threads（ベストエフォート・最大60秒、画像なしのテキストのみ）
      try {
        await withTimeout(
          postTextToThreads(process.env.THREADS_MOTION_TOKEN, text),
          60000,
          'Threads'
        );
        report.threads[key] = 'ok';
      } catch (te) {
        report.threads[key] = 'error: ' + te.message;
      }

      // 最後の1件のあとは待たない
      if (idx < entries.length - 1) await new Promise(r2 => setTimeout(r2, 5000));
    }

    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_morning_report', JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), {
      status: 200, headers: jsonHeaders,
    });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_morning_report', JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), {
      status: 500, headers: jsonHeaders,
    });
  }
}
