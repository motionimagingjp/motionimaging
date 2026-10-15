// src/app/api/_lib/migoron-scoring.js
// ============================================================
// ミゴロン各指数（雲海・富士山・星空・花畑）のスコアを決定的に算出する
// 共通モジュール。改善指示書P1対応：Geminiにスコアを計算させず、
// ここに集約した係数・スポット座標から各route.jsが算出する。
// Geminiは各routeで算出済みのスコア・天気を渡され、メモ文のみを書く。
//
// 係数・座標は初期値。実測との答え合わせ（P4）を踏まえて調整すること。
//
// 2026-10-15 改善指示書P2対応：
//   スポットをこのファイルの直書き配列から ./spots.json のマスタデータに
//   移行。id/都道府県/種別を持たせ、花畑指数はスポットごとの見頃期間
//   （bloomFrom/bloomTo、月日のfrom/to）で当日が期間内かを判定し、
//   期間外のスポットは候補から除外するようにした（従来は月単位の
//   固定候補プールだった）。needsReview:trueは実在性・座標の確認優先度が
//   高いスポット（本番投入前にJakeが確認すること）。
//
// 【スポット座標について】
// 緯度経度は既知の有名スポットとして可能な限り正確なものを設定したが、
// 一覧CSV等での現地確認は行っていない。本番投入前にJakeが確認すること。
// なお、既存の花畑フォールバック表にあった「永観堂もみじ（東京）」は、
// 永観堂（禅林寺）自体は京都の寺院であり東京に実在しないため、本モジュール
// では東京の代替スポット（新宿御苑）に差し替えた。要確認。
// ============================================================
import spotsData from './spots.json';

function displayName(s) { return `${s.name}（${s.pref}）`; }

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
// 雲海指数・富士山指数の対象スポット（post-dailyが使用、spots.jsonから生成）
// ============================================================
export const CLOUD_SPOTS = spotsData.spots
  .filter(s => s.type === 'unkai')
  .map(s => ({ name: displayName(s), emoji: '☁️', lat: s.lat, lon: s.lon }));

export const FUJI_SPOTS = spotsData.spots
  .filter(s => s.type === 'fuji')
  .map(s => ({ name: displayName(s), emoji: '🗻', lat: s.lat, lon: s.lon, reflection: !!s.reflection }));

// 雲海指数: 風速が弱いほど・前日との寒暖差が大きいほど・早朝の湿度が
// 高いほど放射冷却による雲海の発生条件が整うとみなす。
// 係数は連続値にしている。段階的な閾値（5刻みの固定加点）にすると、
// 実測データでも結果が5の倍数ばかりに揃ってしまい、以前Geminiの出力が
// 「5刻みで機械的」と指摘された見た目をコード計算でも再現してしまうため。
export function scoreCloudSea({ dawnWeatherCode, dawnWindAvg, dawnHumidityAvg, diurnalRange }) {
  let score = 60;
  score += Math.max(0, 20 - dawnWindAvg * 2.5);      // 無風に近いほど加点、7〜8m/sでほぼ0
  score += (dawnHumidityAvg - 65) * 0.5;              // 早朝湿度が高いほど加点
  score += (diurnalRange - 5) * 1.8;                  // 前日との寒暖差が大きいほど加点
  if (dawnWeatherCode >= 45) score -= 40;             // 霧・雨など、視界自体が悪い
  else if (dawnWeatherCode >= 2) score -= 5;          // 曇り
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
// 星空指数の対象スポット・スコア算出（post-evening用、spots.jsonから生成）
// ============================================================
export const STAR_SPOTS = spotsData.spots
  .filter(s => s.type === 'star')
  .map(s => ({ name: displayName(s), lat: s.lat, lon: s.lon }));

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
// 花畑指数のスポット選定（post-morning-all用）
//
// spots.jsonの各花スポットは見頃期間(bloomFrom〜bloomTo、月日)を持つ。
// 投稿日がこの期間に入っているスポットだけを候補にする（期間外は除外）。
// 12月→1月のように年をまたぐ期間（水仙など）はfrom>toで表現している。
// ============================================================
const FLOWER_MASTER = spotsData.spots.filter(s => s.type === 'flower');

function monthDayNum(monthDay) {
  const [m, d] = monthDay.split('-').map(Number);
  return m * 100 + d;
}

function inBloomWindow(bloomFrom, bloomTo, targetNum) {
  const from = monthDayNum(bloomFrom);
  const to = monthDayNum(bloomTo);
  if (from <= to) return targetNum >= from && targetNum <= to;
  return targetNum >= from || targetNum <= to; // 年またぎ
}

function monthDayOf(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function flowerSpotsOnExactDate(date) {
  const targetNum = monthDayNum(monthDayOf(date));
  return FLOWER_MASTER.filter(s => inBloomWindow(s.bloomFrom, s.bloomTo, targetNum));
}

// 見頃期間内のスポットを返す（最大3件、baseScore順）。
// 該当がゼロの場合（季節の端境期の隙間）のみ、前後に日付をずらして
// 近い時期の見頃スポットを探す。baseScoreが高い順に季節を無視して
// 埋めると季節外れスポットが混ざる（花畑指数の本来の不具合と同型）ため、
// 必ず「近い日付で見頃のスポット」を優先する。
export function getFlowerSpotsForDate(date) {
  let matched = flowerSpotsOnExactDate(date);
  for (let widen = 1; widen <= 10 && matched.length === 0; widen++) {
    const after = flowerSpotsOnExactDate(new Date(date.getTime() + widen * 86400000));
    const before = flowerSpotsOnExactDate(new Date(date.getTime() - widen * 86400000));
    matched = after.length ? after : before;
  }
  matched = matched.slice().sort((a, b) => b.baseScore - a.baseScore).slice(0, 3);
  return matched.map(s => ({ name: displayName(s), emoji: s.emoji, baseScore: s.baseScore, lat: s.lat, lon: s.lon }));
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

export async function computeFlowerScores(date) {
  const spots = getFlowerSpotsForDate(date);
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
