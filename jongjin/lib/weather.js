// OUTカテゴリ用の天気コメント（東京 / Open-Meteo・APIキー不要）
// AI生成ではなく「条件分岐＋言い回し候補」から選ぶ。
// 直近に使った言い回しは除外するので、同じ文が続かない。

const TOKYO = { lat: 35.6895, lng: 139.6917 };

// 条件 → 言い回し候補。上から順に最初に当てはまった条件を使う
const RULES = [
  { key: 'snow', when: (w) => w.today.kind === 'snow', lines: [
    '今日は雪でした', '朝起きたら外が白くてびっくりしました', '雪、ちゃんと積もりましたね',
  ] },
  { key: 'rain', when: (w) => w.today.kind === 'rain', lines: [
    '今日は一日雨でした\nこれは晴れてた日の写真です', '雨の音聞きながら、この日のこと思い出してました',
    '今日はずっと雨でしたね\n写真だけでも晴れてるやつを',
  ] },
  { key: 'afterRain', when: (w) => w.yesterday.kind === 'rain' && w.today.kind !== 'rain', lines: [
    '昨日までの雨が嘘みたいに、今日は晴れ間が出てきました', '昨日の雨、ちゃんと止んでくれました',
    '雨上がりで、空気がきれいでした',
  ] },
  { key: 'hot', when: (w) => w.today.max >= 30, lines: [
    `今日も${'{max}'}度超えでした。暑すぎます`, '日差し、もう少し手加減してほしいです', '外に出て5分で後悔するくらい暑かったです',
  ] },
  { key: 'bigGap', when: (w) => w.today.max - w.today.min >= 9, lines: [
    '朝はまだ肌寒かったですが、昼間はだいぶ動きやすい陽気でした', '朝晩と昼で気温が全然違いますね\n上着の調整が難しいです',
    '朝は寒かったのに、昼は上着いらなかったです',
  ] },
  { key: 'colder', when: (w) => w.today.max - w.yesterday.max <= -4, lines: [
    '昨日より一気に寒くなりましたね', '急に冷えました\nみなさんも体調気をつけてください', '今日は昨日より上着が一枚増えました',
  ] },
  { key: 'warmer', when: (w) => w.today.max - w.yesterday.max >= 4, lines: [
    '昨日より随分あったかかったです', '急にあたたかくなって、ちょっと得した気分です', '今日は上着いらなかったです',
  ] },
  { key: 'cold', when: (w) => w.today.min <= 5, lines: [
    '朝は結構冷えましたね', '手が冷たくて、ずっとポケットに入れてました', '息が白かったです',
  ] },
  { key: 'clear', when: (w) => w.today.kind === 'clear', lines: [
    '久しぶりの青空でした', '今日は雲ひとつなかったですね', '天気よくて、それだけで気分いいです',
  ] },
  { key: 'cloudy', when: () => true, lines: [
    '今日はずっと曇ってました', 'すっきりしない空でしたね', '晴れそうで晴れない一日でした',
  ] },
];

export function codeToKind(code) {
  if (code <= 2) return 'clear';
  if (code <= 48) return 'cloudy';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain';
}

// w = { today: {kind,max,min}, yesterday: {kind,max,min} }, recent = 直近で使った文の配列
export function pickWeatherLine(w, recent = [], rand = Math.random) {
  const rule = RULES.find((r) => r.when(w));
  const lines = rule.lines.map((l) => l.replace('{max}', Math.round(w.today.max)));
  const fresh = lines.filter((l) => !recent.includes(l));
  const pool = fresh.length ? fresh : lines;
  return { key: rule.key, line: pool[Math.floor(rand() * pool.length)] };
}

export async function fetchTokyoWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${TOKYO.lat}&longitude=${TOKYO.lng}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + '&timezone=Asia%2FTokyo&past_days=1&forecast_days=1';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d = (await res.json()).daily;
  const day = (i) => ({
    kind: codeToKind(d.weather_code[i]),
    max: d.temperature_2m_max[i],
    min: d.temperature_2m_min[i],
  });
  return { yesterday: day(0), today: day(1) };
}
