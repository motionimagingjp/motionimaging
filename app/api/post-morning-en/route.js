import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getSunriseUTC(date) {
  const lat = 35.6762, lng = 139.6503;
  const rad = Math.PI / 180;
  const N = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const B = 360 / 365 * (N - 81) * rad;
  const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declination = 23.45 * Math.sin(B) * rad;
  const hourAngle = Math.acos(-Math.tan(lat * rad) * Math.tan(declination)) / rad;
  const solarNoon = 12 - lng / 15 - EoT / 60;
  return solarNoon - hourAngle / 15;
}

function isNearSunrise() {
  const now = new Date();
  const sunriseUTC = getSunriseUTC(now);
  const nowHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  return Math.abs(nowHours - (sunriseUTC - 0.5)) <= 10 / 60;
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

function getSeasonalFlowersEN() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  if (m === 1)            return ['Narcissus', 'Japanese winter sweet (Roubai)'];
  if (m === 2)            return ['Japanese plum (Ume)', 'Rapeseed blossom', 'Narcissus'];
  if (m === 3)            return ['Cherry blossom (Sakura)', 'Rapeseed blossom', 'Japanese plum'];
  if (m === 4 && d <= 15) return ['Cherry blossom (Sakura)', 'Rapeseed blossom', 'Tulip'];
  if (m === 4 && d > 15)  return ['Nemophila', 'Azalea (Tsutsuji)', 'Wisteria (Fuji)', 'Tulip'];
  if (m === 5)            return ['Nemophila', 'Azalea', 'Wisteria', 'Rose'];
  if (m === 6)            return ['Hydrangea (Ajisai)', 'Rose', 'Poppy', 'Lavender'];
  if (m === 7)            return ['Sunflower', 'Lotus', 'Lavender'];
  if (m === 8)            return ['Sunflower', 'Lotus'];
  if (m === 9)            return ['Red spider lily (Higanbana)', 'Cosmos'];
  if (m === 10)           return ['Cosmos', 'Autumn foliage'];
  if (m === 11)           return ['Autumn foliage', 'Cosmos'];
  if (m === 12)           return ['Narcissus', 'Japanese winter sweet'];
  return [];
}

async function generateTweet(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
  return data.candidates[0].content.parts[0].text.trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isNearSunrise()) {
    return new Response(JSON.stringify({ message: 'Skipped: not near sunrise' }), { status: 200 });
  }

  try {
    const dateLabel = getTodayLabelEN();
    const sakura = isSakuraSeason();
    const flowers = getSeasonalFlowersEN();

    const sakuraInstruction = sakura
      ? `[Sakura Season Rules]
It is currently cherry blossom season (February 1 – April 15).
Estimate the accumulated temperature since February 1 (sum of daily average temperatures) and calculate the Migoron Index using these benchmarks:
Blooming begins around 210°C accumulated (index ~50%)
Full bloom around 370°C accumulated (index 90%+)
Select 5 real cherry blossom spots in the Kanto region and nearby areas. Factor in elevation and regional variation to differentiate the index scores.`
      : `[Seasonal Flower Rules]
Select flowers that are actually at peak bloom in the Kanto region and nearby areas right now (${dateLabel}).
Flowers currently in season: ${flowers.join(', ')}
Choose 5 real, named locations in Kanto or nearby where these flowers are blooming.
No accumulated temperature calculation needed — base
