// src/app/api/_lib/migoron-scoring.js
// ============================================================
// ミゴロン各指数（雲海・富士山・星空・花畑）のスコアを決定的に算出する
// 共通モジュール。改善指示書P1対応：Geminiにスコアを計算させず、
// ここに集約した係数・スポット座標から各route.jsが算出する。
// Geminiは各routeで算出済みのスコア・天気を渡され、メモ文のみを書く。
//
// 係数・座標は初期値。実測との答え合わせ（P4）を踏まえて調整すること。
//
// 【スポット座標について】
// 緯度経度は既知の有名スポットとして可能な限り正確なものを設定したが、
// 一覧CSV等での現地確認は行っていない。本番投入前にJakeが確認すること。
// なお、既存の花畑フォールバック表にあった「永観堂もみじ（東京）」は、
// 永観堂（禅林寺）自体は京都の寺院であり東京に実在しないため、本モジュール
// では東京の代替スポット（新宿御苑）に差し替えた。要確認。
// ============================================================

export function clampScore(n) {
  // 指示書P1: 「100%は出さない」→ 上限を95に固定
  return Math.max(10, Math.min(95, Math.round(n)));
}

// ============================================================
// Open-Meteo: 複数スポットを1リクエストにまとめて取得する
// ============================================================
export async function fetchOpenMeteo({ spots, hourly = [], daily = [], pastDays = 0, forecastDays = 2 }) {
  const lats = spots.map(s => s.lat).join(',');
  const lons = spots.map(s => s.lon).join(',');
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}`
    + `&timezone=Asia%2FTokyo&forecast_days=${forecastDays}`;
  if (hourly.length) url += `&hourly=${hourly.join(',')}`;
  if (daily.length) url += `&daily=${daily.join(',')}`;
  if (pastDays) url += `&past_days=${pastDays}`;
  const res = await fetch(url);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  if (list.length < spots.length) throw new Error('Open-Meteo: スポット数に対して応答が不足');
  return list;
}

function jstDateStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// dayOffset: 0=今日, 1=明日, -1=昨日（JST基準）。fromHour〜toHourの時間帯だけ抜き出す。
// 日をまたぐ時間帯（例: 19時〜翌3時）はnightIndicesを使うこと。
export function hourIndicesForOffset(times, dayOffset, fromHour, toHour) {
  const jstNow = new Date(Date.now() + 9 * 3600000);
  const targetStr = jstDateStr(new Date(jstNow.getTime() + dayOffset * 24 * 3600000));
  const idx = [];
  times.forEach((t, i) => {
    const [datePart, timePart] = String(t).split('T');
    const hour = parseInt(String(timePart).slice(0, 2), 10);
    if (datePart === targetStr && hour >= fromHour && hour <= toHour) idx.push(i);
  });
  return idx;
}

// 今夜19時〜翌3時（星空指数が対象とする夜間帯）
export function nightIndices(times) {
  return [...hourIndicesForOffset(times, 0, 19, 23), ...hourIndicesForOffset(times, 1, 0, 3)];
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function pick(arr, idx) { return idx.map(i => Number(arr[i])).filter(n => Number.isFinite(n)); }

// ============================================================
// 雲海指数・富士山指数の対象スポット（post-dailyが使用）
// ============================================================
export const CLOUD_SPOTS = [
  { name: '竹田城跡（兵庫）', emoji: '☁️', lat: 35.3011, lon: 134.8186 },
  { name: '高ボッチ高原（長野）', emoji: '☁️', lat: 36.1217, lon: 137.9686 },
  { name: '山中湖パノラマ台（山梨）', emoji: '☁️', lat: 35.4336, lon: 138.9439 },
];

export const FUJI_SPOTS = [
  { name: '田貫湖（静岡）', emoji: '🗻', lat: 35.3306, lon: 138.6253, reflection: true },
  { name: '新道峠（山梨）', emoji: '🗻', lat: 35.4886, lon: 138.7858, reflection: false },
  { name: '山中湖パノラマ台（山梨）', emoji: '🗻', lat: 35.4336, lon: 138.9439, reflection: true },
];

// 雲海指数: 風速が弱いほど・前日との寒暖差が大きいほど・早朝の湿度が
// 高いほど放射冷却による雲海の発生条件が整うとみなす。
export function scoreCloudSea({ dawnWeatherCode, dawnWindAvg, dawnHumidityAvg, diurnalRange }) {
  let score = 70;
  score += dawnWindAvg <= 2 ? 15 : dawnWindAvg <= 4 ? 5 : dawnWindAvg <= 7 ? 0 : -20;
  score += dawnHumidityAvg >= 85 ? 10 : dawnHumidityAvg >= 70 ? 0 : -15;
  score += diurnalRange >= 10 ? 15 : diurnalRange >= 6 ? 5 : -10;
  if (dawnWeatherCode >= 45) score -= 40;       // 霧・雨など、視界自体が悪い
  else if (dawnWeatherCode >= 2) score -= 5;    // 曇り
  return clampScore(score);
}

// 富士山指数: 早朝の雲量（低層・中層を重視）と視程、逆さ富士が狙える
// スポットは風速3m/s以下でボーナス。
export function scoreFuji({ dawnWeatherCode, cloudLowAvg, cloudMidAvg, cloudHighAvg, visibilityAvg, humidityAvg, windAvg, reflection }) {
  let score = 70;
  const weightedCloud = cloudLowAvg * 0.5 + cloudMidAvg * 0.3 + cloudHighAvg * 0.2;
  score += (50 - weightedCloud) * 0.6;
  if (visibilityAvg >= 20000) score += 15;
  else if (visibilityAvg >= 10000) score += 5;
  else score -= 20;
  score += humidityAvg <= 60 ? 5 : humidityAvg >= 85 ? -5 : 0;
  if (reflection && windAvg <= 3) score += 10;
  if (dawnWeatherCode >= 51) score -= 40; // 雨・霧雨など
  return clampScore(score);
}

async function nightlyExtremes(spots, offsetFromHour, offsetToHour, dayOffset) {
  const list = await fetchOpenMeteo({
    spots,
    hourly: ['weathercode', 'cloudcover', 'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
      'relativehumidity_2m', 'windspeed_10m', 'visibility', 'temperature_2m'],
    daily: ['temperature_2m_max'],
    pastDays: 1,
    forecastDays: 2,
  });
  return list.map(entry => {
    const h = entry.hourly;
    const idx = hourIndicesForOffset(h.time, dayOffset, offsetFromHour, offsetToHour);
    if (!idx.length) return null;
    return {
      weatherCode: Math.max(...pick(h.weathercode, idx)),
      cloudAvg: avg(pick(h.cloudcover, idx)),
      cloudLowAvg: avg(pick(h.cloudcover_low, idx)),
      cloudMidAvg: avg(pick(h.cloudcover_mid, idx)),
      cloudHighAvg: avg(pick(h.cloudcover_high, idx)),
      humidityAvg: avg(pick(h.relativehumidity_2m, idx)),
      windAvg: avg(pick(h.windspeed_10m, idx)),
      visibilityAvg: avg(pick(h.visibility, idx)),
      tempMin: Math.min(...pick(h.temperature_2m, idx)),
      // daily配列は past_days=1 により [昨日, 今日, 明日]
      yesterdayMaxTemp: entry.daily && entry.daily.temperature_2m_max ? Number(entry.daily.temperature_2m_max[0]) : null,
    };
  });
}

// 雲海・富士山まとめて算出（post-daily用）。明日早朝(5〜7時)のデータを使う。
export async function computeCloudAndFujiScores() {
  const cloudExtremes = await nightlyExtremes(CLOUD_SPOTS, 5, 7, 1);
  const fujiExtremes = await nightlyExtremes(FUJI_SPOTS, 5, 7, 1);

  const cloudScores = CLOUD_SPOTS.map((spot, i) => {
    const e = cloudExtremes[i];
    if (!e || e.yesterdayMaxTemp === null) return { ...spot, score: 10, ok: false };
    const score = scoreCloudSea({
      dawnWeatherCode: e.weatherCode,
      dawnWindAvg: e.windAvg,
      dawnHumidityAvg: e.humidityAvg,
      diurnalRange: e.yesterdayMaxTemp - e.tempMin,
    });
    return { ...spot, score, ok: true };
  });

  const fujiScores = FUJI_SPOTS.map((spot, i) => {
    const e = fujiExtremes[i];
    if (!e) return { ...spot, score: 10, ok: false };
    const score = scoreFuji({
      dawnWeatherCode: e.weatherCode,
      cloudLowAvg: e.cloudLowAvg,
      cloudMidAvg: e.cloudMidAvg,
      cloudHighAvg: e.cloudHighAvg,
      visibilityAvg: e.visibilityAvg,
      humidityAvg: e.humidityAvg,
      windAvg: e.windAvg,
      reflection: spot.reflection,
    });
    return { ...spot, score, ok: true };
  });

  return { cloudScores, fujiScores };
}

// ============================================================
// 星空指数の対象スポット・スコア算出（post-evening用）
// ============================================================
export const STAR_SPOTS = [
  { name: '河口湖（山梨）', lat: 35.5171, lon: 138.7519 },
  { name: '爪木崎（静岡）', lat: 34.6726, lon: 138.9536 },
  { name: '大洗（茨城）', lat: 36.3133, lon: 140.5750 },
  { name: '三浦（神奈川）', lat: 35.1439, lon: 139.6178 },
  { name: '秩父（埼玉）', lat: 35.9915, lon: 139.0856 },
];

// 天気コードごとの指数上限（雨・雪・霧の夜は雲量に関わらず星は見えない）
function weatherCap(code) {
  if (code >= 95) return 10;
  if (code >= 85) return 15;
  if (code >= 80) return 20;
  if (code >= 71) return 15;
  if (code >= 61) return 15;
  if (code >= 51) return 25;
  if (code >= 45) return 20;
  if (code === 3) return 35;
  if (code === 2) return 65;
  if (code === 1) return 90;
  return 100;
}

export function moonAdjustment(age) {
  if (age <= 3) return 10;
  if (age <= 7) return 0;
  if (age <= 12) return -10;
  if (age <= 17) return -20;
  if (age <= 22) return -5;
  return 5;
}

// 雲量・天気コード・月齢に加え、湿度（透明度の目安）と降水確率を反映する
export function scoreStar({ worstCode, cloudAvg, humidityAvg, precipProbMax, moonAdj }) {
  const cloudScore = 100 - cloudAvg * 0.9;
  let score = Math.min(cloudScore, weatherCap(worstCode)) + moonAdj;
  score += humidityAvg >= 90 ? -10 : humidityAvg <= 50 ? 5 : 0;
  score += precipProbMax >= 30 ? -15 : precipProbMax >= 10 ? -5 : 0;
  return clampScore(score);
}

export async function computeStarScores(moonAdj) {
  const list = await fetchOpenMeteo({
    spots: STAR_SPOTS,
    hourly: ['weathercode', 'cloudcover', 'relativehumidity_2m', 'precipitation_probability'],
    forecastDays: 2,
  });
  return STAR_SPOTS.map((spot, i) => {
    const h = list[i] && list[i].hourly;
    if (!h) return { ...spot, score: 10, ok: false };
    const idx = nightIndices(h.time);
    if (!idx.length) return { ...spot, score: 10, ok: false };
    const worstCode = Math.max(...pick(h.weathercode, idx));
    const cloudAvg = avg(pick(h.cloudcover, idx));
    const humidityAvg = avg(pick(h.relativehumidity_2m, idx));
    const precipProbMax = Math.max(...pick(h.precipitation_probability, idx));
    const score = scoreStar({ worstCode, cloudAvg, humidityAvg, precipProbMax, moonAdj });
    return { ...spot, score, ok: true, worstCode, cloudAvg: Math.round(cloudAvg) };
  });
}

// ============================================================
// 花畑指数の月別スポット・スコア算出（post-morning-all用）
//
// 「見頃期間」は日単位のfrom/toではなく、既存フォールバック表と同じ
// 月単位の候補プールで代用している（日単位の精密な判定はP2のspots.json
// 移行時に対応）。baseScoreはそのスポットの旬としての見頃度の目安で、
// そこから直近の天候で減点する。
// ============================================================
export const FLOWER_SPOTS_BY_MONTH = {
  1: [['熱海梅園（静岡）', '🌼', 70, 35.0958, 139.0661], ['吾妻山公園（神奈川）', '🌼', 65, 35.2994, 139.2461], ['小石川後楽園（東京）', '🌸', 58, 35.7056, 139.7494]],
  2: [['偕楽園（茨城）', '🌸', 85, 36.3722, 140.4642], ['越生梅林（埼玉）', '🌸', 78, 35.9661, 139.2967], ['吾妻山公園（神奈川）', '🌼', 70, 35.2994, 139.2461]],
  3: [['権現堂堤（埼玉）', '🌸', 88, 36.0786, 139.7183], ['小田原城址公園（神奈川）', '🌸', 80, 35.2564, 139.1550], ['千鳥ヶ淵（東京）', '🌸', 74, 35.6881, 139.7514]],
  4: [['ひたち海浜公園（茨城）', '💙', 92, 36.3997, 140.5986], ['あしかがフラワーパーク（栃木）', '🌸', 85, 36.3414, 139.4700], ['根津神社（東京）', '🌺', 76, 35.7206, 139.7611]],
  5: [['ひたち海浜公園（茨城）', '💙', 88, 36.3997, 140.5986], ['あしかがフラワーパーク（栃木）', '🌸', 82, 36.3414, 139.4700], ['京成バラ園（千葉）', '🌹', 75, 35.7836, 140.1250]],
  6: [['明月院（神奈川）', '💠', 90, 35.3331, 139.5458], ['本土寺（千葉）', '💠', 82, 35.7961, 139.9103], ['権現堂堤（埼玉）', '💠', 74, 36.0786, 139.7183]],
  7: [['座間ひまわり畑（神奈川）', '🌻', 88, 35.4878, 139.3978], ['古河公方公園（茨城）', '🪷', 80, 36.1894, 139.7206], ['清水公園（千葉）', '🪷', 72, 35.9394, 139.8886]],
  8: [['座間ひまわり畑（神奈川）', '🌻', 85, 35.4878, 139.3978], ['明野ひまわり畑（山梨）', '🌻', 78, 35.7400, 138.4600], ['上野不忍池（東京）', '🪷', 70, 35.7141, 139.7728]],
  9: [['巾着田曼珠沙華公園（埼玉）', '🌺', 90, 35.9442, 139.2744], ['ひたち海浜公園（茨城）', '🍀', 82, 36.3997, 140.5986], ['くりはま花の国（神奈川）', '🌸', 74, 35.2211, 139.6700]],
  10: [['ひたち海浜公園（茨城）', '🍁', 92, 36.3997, 140.5986], ['昭和記念公園（東京）', '🌼', 82, 35.7014, 139.4089], ['くりはま花の国（神奈川）', '🌸', 74, 35.2211, 139.6700]],
  // 「永観堂もみじ（東京）」は永観堂（禅林寺）自体が京都の寺院で東京に実在しないため、
  // 新宿御苑（東京の紅葉名所）に暫定差し替え。要Jake確認。
  11: [['高尾山（東京）', '🍁', 90, 35.6253, 139.2431], ['新宿御苑（東京）', '🍁', 80, 35.6852, 139.7100], ['長瀞（埼玉）', '🍁', 74, 36.1206, 139.1086]],
  12: [['六義園（東京）', '🍁', 72, 35.7306, 139.7467], ['明治神宮外苑（東京）', '🍂', 64, 35.6761, 139.7186], ['爪木崎（静岡）', '🌼', 56, 34.6726, 138.9536]],
};

export function getFlowerSpotsForMonth(month) {
  const rows = FLOWER_SPOTS_BY_MONTH[month] || FLOWER_SPOTS_BY_MONTH[9];
  return rows.map(([name, emoji, baseScore, lat, lon]) => ({ name, emoji, baseScore, lat, lon }));
}

// 直近の雨・高温・強風で減点する
export function scoreFlower({ baseScore, todayMaxTemp, pastRainSums, todayWindMax }) {
  let score = baseScore;
  score += todayMaxTemp >= 33 ? -15 : todayMaxTemp >= 30 ? -8 : 0;
  const recentRain = Math.max(...pastRainSums, 0);
  score += recentRain >= 10 ? -15 : recentRain > 0 ? -5 : 0;
  score += todayWindMax >= 12 ? -10 : 0;
  return clampScore(score);
}

export async function computeFlowerScores(month) {
  const spots = getFlowerSpotsForMonth(month);
  const list = await fetchOpenMeteo({
    spots,
    daily: ['temperature_2m_max', 'precipitation_sum', 'windspeed_10m_max'],
    pastDays: 2,
    forecastDays: 1,
  });
  return spots.map((spot, i) => {
    const d = list[i] && list[i].daily;
    if (!d) return { ...spot, score: spot.baseScore, ok: false };
    // past_days=2, forecast_days=1 → daily配列は [一昨日, 昨日, 今日]
    const todayIdx = d.time.length - 1;
    const score = scoreFlower({
      baseScore: spot.baseScore,
      todayMaxTemp: Number(d.temperature_2m_max[todayIdx]),
      pastRainSums: d.precipitation_sum.slice(0, todayIdx).map(Number),
      todayWindMax: Number(d.windspeed_10m_max[todayIdx]),
    });
    return { ...spot, score, ok: true };
  });
}
