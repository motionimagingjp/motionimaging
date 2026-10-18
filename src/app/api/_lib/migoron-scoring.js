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
// 2026-10-16 改善指示書P3対応：
//   投稿画像に季節タグ(IMAGE_SEASONS)を付け、投稿月の季節と一致する画像
//   からのみロングテーションするようにした（seasonalIndices）。一致する
//   季節の画像が無いカテゴリ・季節の組み合わせでは種別一致のみ（全件）
//   にフォールバックする。季節は全47枚を実際に目視確認して判定したが、
//   夜景・曇天・シルエットなどで季節の手がかりが乏しい画像はnull
//   （季節を問わず使う）のままにしている。
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

// JST基準の日付文字列（YYYY-MM-DD）。offsetDaysで今日からずらせる。
export function jstDateString(offsetDays = 0) {
  return jstDateStr(new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000));
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return jstDateStr(d);
}

// dateStr（YYYY-MM-DD）の fromHour〜toHour の時間帯だけ抜き出す。
// 日をまたぐ時間帯（例: 19時〜翌3時）はnightIndicesForDateを使うこと。
export function hourIndicesForDate(times, dateStr, fromHour, toHour) {
  const idx = [];
  times.forEach((t, i) => {
    const [datePart, timePart] = String(t).split('T');
    const hour = parseInt(String(timePart).slice(0, 2), 10);
    if (datePart === dateStr && hour >= fromHour && hour <= toHour) idx.push(i);
  });
  return idx;
}

// dayOffset: 0=今日, 1=明日, -1=昨日（JST基準）
export function hourIndicesForOffset(times, dayOffset, fromHour, toHour) {
  return hourIndicesForDate(times, jstDateString(dayOffset), fromHour, toHour);
}

// dateStrの夜19時〜翌3時（星空指数が対象とする夜間帯）
export function nightIndicesForDate(times, dateStr) {
  return [...hourIndicesForDate(times, dateStr, 19, 23), ...hourIndicesForDate(times, addDays(dateStr, 1), 0, 3)];
}

// 今夜19時〜翌3時
export function nightIndices(times) {
  return nightIndicesForDate(times, jstDateString(0));
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

// 対象日(dateStr)の早朝5〜7時の気象要素を取り出す。diurnalRangeの基準となる
// 前日最高気温は「対象日の前日」（明日早朝なら今日）の日最高気温を使う。
function extractDawnMetrics(entry, dateStr) {
  const h = entry.hourly;
  if (!h) return null;
  const idx = hourIndicesForDate(h.time, dateStr, 5, 7);
  if (!idx.length) return null;
  const d = entry.daily;
  const prevIdx = d && d.time ? d.time.indexOf(addDays(dateStr, -1)) : -1;
  const prevMax = prevIdx >= 0 ? Number(d.temperature_2m_max[prevIdx]) : NaN;
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
    yesterdayMaxTemp: Number.isFinite(prevMax) ? prevMax : null,
  };
}

const DAWN_HOURLY = ['weathercode', 'cloudcover', 'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
  'relativehumidity_2m', 'windspeed_10m', 'visibility', 'temperature_2m'];

async function fetchDawnMetrics(spots, dateStr, { pastDays = 1, forecastDays = 2 } = {}) {
  const list = await fetchOpenMeteo({
    spots, hourly: DAWN_HOURLY, daily: ['temperature_2m_max'], pastDays, forecastDays,
  });
  return list.map(entry => extractDawnMetrics(entry, dateStr));
}

function cloudScoreFromMetrics(e) {
  return scoreCloudSea({
    dawnWeatherCode: e.weatherCode,
    dawnWindAvg: e.windAvg,
    dawnHumidityAvg: e.humidityAvg,
    diurnalRange: e.yesterdayMaxTemp - e.tempMin,
  });
}

function fujiScoreFromMetrics(e, reflection) {
  return scoreFuji({
    dawnWeatherCode: e.weatherCode,
    cloudLowAvg: e.cloudLowAvg,
    cloudMidAvg: e.cloudMidAvg,
    cloudHighAvg: e.cloudHighAvg,
    visibilityAvg: e.visibilityAvg,
    humidityAvg: e.humidityAvg,
    windAvg: e.windAvg,
    reflection,
  });
}

const r1 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// 予測ログ（P4）に残す「元の天気要素」
function cloudInputs(e) {
  return { weatherCode: e.weatherCode, windAvg: r1(e.windAvg), humidityAvg: r1(e.humidityAvg), diurnalRange: r1(e.yesterdayMaxTemp - e.tempMin) };
}
function fujiInputs(e) {
  return {
    weatherCode: e.weatherCode, cloudLow: r1(e.cloudLowAvg), cloudMid: r1(e.cloudMidAvg), cloudHigh: r1(e.cloudHighAvg),
    visibilityKm: r1(e.visibilityAvg / 1000), humidityAvg: r1(e.humidityAvg), windAvg: r1(e.windAvg),
  };
}

// 雲海・富士山まとめて算出（post-daily用）。明日早朝(5〜7時)のデータを使う。
export async function computeCloudAndFujiScores() {
  const targetDate = jstDateString(1);
  const cloudExtremes = await fetchDawnMetrics(CLOUD_SPOTS, targetDate);
  const fujiExtremes = await fetchDawnMetrics(FUJI_SPOTS, targetDate);

  const cloudScores = CLOUD_SPOTS.map((spot, i) => {
    const e = cloudExtremes[i];
    if (!e || e.yesterdayMaxTemp === null) return { ...spot, score: 10, ok: false };
    return { ...spot, score: cloudScoreFromMetrics(e), ok: true, inputs: cloudInputs(e) };
  });

  const fujiScores = FUJI_SPOTS.map((spot, i) => {
    const e = fujiExtremes[i];
    if (!e) return { ...spot, score: 10, ok: false };
    return { ...spot, score: fujiScoreFromMetrics(e, spot.reflection), ok: true, inputs: fujiInputs(e) };
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

// 1時間ごとの星の見えやすさ。天気コード0〜3（快晴〜曇り）はOpen-Meteo側で
// 雲量から決まる値なので雲量だけで評価し、霧・雨・雪など雲量に関係なく
// 星が見えない天気（コード45以上）にだけ上限を掛ける。
// （以前は夜間9時間の天気コードの最悪値で上限を掛けていたため、1時間でも
// 曇りが混ざると全地点が35%に張り付いていた）
function hourlySkyScore(code, cloud) {
  const base = 100 - cloud * 0.9;
  return code >= 45 ? Math.min(base, weatherCap(code)) : base;
}

// 撮影には夜通し晴れる必要はないため、夜間(19〜翌3時)で最も条件の良い
// 連続した時間帯で評価する。
const STAR_WINDOW_HOURS = 3;

function bestStarWindow(h, idx) {
  const hourly = idx.map(i => hourlySkyScore(Number(h.weathercode[i]), Number(h.cloudcover[i])));
  const size = Math.min(STAR_WINDOW_HOURS, idx.length);
  let bestStart = 0, bestAvg = -Infinity;
  for (let s = 0; s + size <= idx.length; s++) {
    const a = avg(hourly.slice(s, s + size));
    if (a > bestAvg) { bestAvg = a; bestStart = s; }
  }
  return { skyScore: bestAvg, windowIdx: idx.slice(bestStart, bestStart + size) };
}

// 晴れ間の見えやすさ・月齢に加え、湿度（透明度の目安）と降水確率を反映する
export function scoreStar({ skyScore, humidityAvg, precipProbMax, moonAdj }) {
  let score = skyScore + moonAdj;
  score += humidityAvg >= 90 ? -10 : humidityAvg <= 50 ? 5 : 0;
  score += precipProbMax >= 30 ? -15 : precipProbMax >= 10 ? -5 : 0;
  return clampScore(score);
}

// 夜間の時間帯idxから、最も条件の良い連続時間帯を選んで指数を出す。
// precipProbOf(windowIdx) は降水確率(%)を返す（予報は precipitation_probability、
// 実測の答え合わせは降水量から換算するため、取得方法だけ呼び出し側で切り替える）。
function evaluateStarSpot(h, idx, moonAdj, precipProbOf) {
  const { skyScore, windowIdx } = bestStarWindow(h, idx);
  const humidityAvg = avg(pick(h.relativehumidity_2m, windowIdx));
  const precipProbMax = precipProbOf(windowIdx);
  const score = scoreStar({ skyScore, humidityAvg, precipProbMax, moonAdj });
  const hourOf = j => parseInt(String(h.time[j]).split('T')[1].slice(0, 2), 10);
  const bestWindow = `${hourOf(windowIdx[0])}時〜${(hourOf(windowIdx[windowIdx.length - 1]) + 1) % 24}時`;
  return {
    score, bestWindow,
    cloudAvg: Math.round(avg(pick(h.cloudcover, windowIdx))),
    humidityAvg: r1(humidityAvg), precipProbMax,
  };
}

const finiteMax = arr => (arr.length ? Math.max(...arr) : 0);

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
    const e = evaluateStarSpot(h, idx, moonAdj, w => finiteMax(pick(h.precipitation_probability, w)));
    return {
      ...spot, score: e.score, ok: true, bestWindow: e.bestWindow, cloudAvg: e.cloudAvg,
      inputs: { cloudAvg: e.cloudAvg, humidityAvg: e.humidityAvg, precipProbMax: e.precipProbMax, bestWindow: e.bestWindow },
    };
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
  return matched.map(s => ({ name: displayName(s), flowerType: s.flowerType, emoji: s.emoji, baseScore: s.baseScore, lat: s.lat, lon: s.lon }));
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
    const inputs = {
      maxTemp: Number(d.temperature_2m_max[todayIdx]),
      pastRainSums: d.precipitation_sum.slice(0, todayIdx).map(Number),
      windMax: Number(d.windspeed_10m_max[todayIdx]),
    };
    const score = scoreFlower({
      baseScore: spot.baseScore,
      todayMaxTemp: inputs.maxTemp,
      pastRainSums: inputs.pastRainSums,
      todayWindMax: inputs.windMax,
    });
    return { ...spot, score, ok: true, inputs };
  });
}

// ============================================================
// 投稿画像の季節タグ（P3）
//
// post-images/配下の実ファイルを全数目視確認して判定した。キーは
// ファイル名の連番部分（1始まり、IMAGE_CATEGORIESのstartNumからの
// オフセットではなく「何枚目か」）。null は季節の手がかりが乏しい
// （夜景・曇天・シルエットなど）ため、季節を問わず候補に残す画像。
// ============================================================
export const IMAGE_SEASONS = {
  cloud: { 1: 'autumn', 2: 'autumn', 3: 'autumn', 4: 'autumn', 5: 'summer', 6: 'summer', 7: 'summer', 8: null, 9: null, 10: null, 11: null },
  fuji:  { 1: 'winter', 2: 'winter', 3: 'winter', 4: 'winter', 5: 'spring', 6: 'spring', 7: 'summer', 8: 'summer', 9: 'spring', 10: 'winter', 11: null },
  star:  { 1: 'summer', 2: 'summer', 3: 'summer', 4: 'summer', 5: 'winter', 6: null, 7: 'summer', 8: null },
  flower: {
    1: 'spring', 2: 'summer', 3: 'autumn', 4: 'autumn', 5: 'autumn', 6: 'autumn', 7: 'summer', 8: 'autumn',
    9: 'spring', 10: 'summer', 11: 'summer', 12: 'spring', 13: 'autumn', 14: 'summer', 15: 'summer', 16: 'autumn', 17: 'spring',
  },
};

export function currentSeasonJST() {
  const m = new Date(Date.now() + 9 * 3600000).getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

// 投稿月の季節に合う画像の0始まりindex一覧を返す（IMAGE_CATEGORIESの
// count/startNumに対応するローテーション用index）。該当がなければ
// 種別一致のみ（全件）にフォールバックする。
export function seasonalIndices(category, count, season) {
  const map = IMAGE_SEASONS[category] || {};
  const matched = [];
  for (let n = 1; n <= count; n++) {
    if (map[n] === season) matched.push(n - 1);
  }
  return matched.length ? matched : Array.from({ length: count }, (_, i) => i);
}


// ============================================================
// 答え合わせ（P4）: 過去日の「実測に近い値」から同じ式で指数を再計算する
//
// Open-Meteoの予報API（past_days）は過去の時間帯について予報モデルの
// 解析値を返す。観測所の実測値ではないが、予報との差（外れ）を日々
// 追うには十分なので、これを実測の代わりに使う。降水確率は実測が
// 存在しないため、降水量が0.1mm以上の時間があれば100%、なければ0%
// として扱う。
// ============================================================
export const GOOD_THRESHOLD = 60; // この指数以上を「見られる（良い）」と判定する

const OBSERVE_PAST_DAYS = 7;

// items: 予測ログのitems（name/lat/lon/score + 種別ごとの付帯情報）
// 戻り値: itemsと同じ順序の [{ observedScore, ok }]
export async function observeScores(kind, items, dateStr, meta = {}) {
  if (kind === 'star') {
    const list = await fetchOpenMeteo({
      spots: items,
      hourly: ['weathercode', 'cloudcover', 'relativehumidity_2m', 'precipitation'],
      pastDays: OBSERVE_PAST_DAYS, forecastDays: 2,
    });
    return items.map((_, i) => {
      const h = list[i] && list[i].hourly;
      const idx = h ? nightIndicesForDate(h.time, dateStr) : [];
      if (!idx.length) return { observedScore: null, ok: false };
      const e = evaluateStarSpot(h, idx, meta.moonAdj || 0,
        w => (finiteMax(pick(h.precipitation, w)) >= 0.1 ? 100 : 0));
      return { observedScore: e.score, ok: true };
    });
  }

  if (kind === 'cloud' || kind === 'fuji') {
    const metrics = await fetchDawnMetrics(items, dateStr, { pastDays: OBSERVE_PAST_DAYS, forecastDays: 1 });
    return items.map((item, i) => {
      const e = metrics[i];
      if (!e) return { observedScore: null, ok: false };
      if (kind === 'cloud') {
        if (e.yesterdayMaxTemp === null) return { observedScore: null, ok: false };
        return { observedScore: cloudScoreFromMetrics(e), ok: true };
      }
      return { observedScore: fujiScoreFromMetrics(e, !!item.reflection), ok: true };
    });
  }

  if (kind === 'flower') {
    const list = await fetchOpenMeteo({
      spots: items,
      daily: ['temperature_2m_max', 'precipitation_sum', 'windspeed_10m_max'],
      pastDays: OBSERVE_PAST_DAYS, forecastDays: 1,
    });
    return items.map((item, i) => {
      const d = list[i] && list[i].daily;
      const di = d && d.time ? d.time.indexOf(dateStr) : -1;
      if (di < 0) return { observedScore: null, ok: false };
      const rain = d.precipitation_sum.slice(Math.max(0, di - 2), di).map(Number);
      return {
        observedScore: scoreFlower({
          baseScore: item.baseScore,
          todayMaxTemp: Number(d.temperature_2m_max[di]),
          pastRainSums: rain,
          todayWindMax: Number(d.windspeed_10m_max[di]),
        }),
        ok: true,
      };
    });
  }

  throw new Error('unknown kind: ' + kind);
}
