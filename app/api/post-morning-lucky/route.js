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

// 旧暦変換して六曜を正確に計算
function getRokuyo(year, month, day) {
  const list = ['先勝', '友引', '先負', '仏滅', '大安', '赤口'];
  // 旧暦月+旧暦日のmod6で算出（簡易旧暦推算）
  const jd = julianDay(year, month, day);
  // 既知の新月JD基準から旧暦日を推算
  const newMoonJD = 2451550.1; // 2000年1月6日の新月
  const lunarCycle = 29.53058867;
  const daysSinceNewMoon = (jd - newMoonJD) % lunarCycle;
  const lunarDay = Math.floor(daysSinceNewMoon < 0 ? daysSinceNewMoon + lunarCycle : daysSinceNewMoon) + 1;
  // 旧暦月の推算
  const totalMonths = Math.floor((jd - newMoonJD) / lunarCycle);
  const lunarMonth = ((totalMonths % 12) + 12) % 12 + 1;
  return list[(lunarMonth + lunarDay) % 6];
}

function getIchryuManbaibi(year, month, day) {
  const kanshi = julianDay(year, month, day) % 60;
  const map = {
    1:[1,13,25,37,49], 2:[4,16,28,40,52], 3:[7,19,31,43,55],
    4:[10,22,34,46,58], 5:[1
