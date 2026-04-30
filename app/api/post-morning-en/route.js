import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

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

async function getWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=1';
    const res = await fetch(url);
    const data = await res.json();
    const code = data.daily.weathercode[0];
    const max  = Math.round(data.daily.temperature_2m_max[0]);
    let weather, penalty;
    if (code === 0)      { weather = 'clear skies';    penalty = 0;  }
    else if (code <= 2)  { weather = 'sunny';          penalty = 0;  }
    else if (code <= 3)  { weather = 'cloudy';         penalty = 10; }
    else if (code <= 49) { weather = 'foggy';          penalty = 20; }
    else if (code <= 67) { weather = 'rainy';          penalty = 30; }
    else if (code <= 69) { weather = 'heavy rain';     penalty = 40; }
    else if (code <= 79) { weather = 'snowy';          penalty = 40; }
    else if (code <= 84) { weather = 'passing showers';penalty = 20; }
    else                 { weather = 'stormy';         penalty = 50; }
    return { weather, penalty, max };
  } catch {
    return { weather: 'unknown', penalty: 0, max: '--' };
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
        maxOutputTokens: 300,
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

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const dateLabel = getTodayLabelEN();
    const sakura = isSakuraSeason();
    const flowers = getSeasonalFlowersEN();
    const { weather, penalty, max } = await getWeather();

    const seasonInfo = sakura
      ? 'Cherry blossom season. Calculate bloom progress from Feb 1 accumulated temp (bloom at 210C, full bloom at 370C). Select 5 real sakura spots in Kanto.'
      : 'In-season flowers: ' + flowers.join(', ') + '. Select 5 real flower spots in Kanto region.';

    const prompt = 'Calculate Migoron Index for 5 flower spots in Kanto, Japan.\n'
      + 'Date: ' + dateLabel + '\n'
      + 'Season: ' + seasonInfo + '\n'
      + 'Weather today: ' + weather + ' (max ' + max + 'C)\n'
      + 'Weather penalty: subtract ' + penalty + '% from each score due to weather conditions.\n\n'
      + 'Return ONLY this JSON format, no markdown:\n'
      + '{"spots":[{"name":"Hitachi Seaside Park, Ibaraki","emoji":"🌼","score":65},{"name":"Ashikaga Flower Park, Tochigi","emoji":"🌸","score":58},{"name":"Showa Memorial Park, Tokyo","emoji":"🌷","score":52},{"name":"Musashino Forest Park, Saitama","emoji":"🌿","score":45},{"name":"Yokohama Park, Kanagawa","emoji":"🌺","score":38}],"memo":"One short sentence under 15 words about today conditions"}';

    const raw = await callGemini(process.env.GEMINI_API_KEY, prompt);
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
      memo = weather + ' conditions today — plan accordingly.';
    }

    const ranked = spots.sort((a, b) => b.score - a.score);

    let tweet = 'Bloom Index [' + dateLabel + ']\n';
    for (const s of ranked) {
      tweet += s.emoji + ' ' + s.name + ' (' + s.score + '%)\n';
    }
    tweet += 'Migoron Note: ' + memo + '\n';
    tweet += '#JapaneseFlowers #LandscapePhotography #Migoron';

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await xClient.v2.tweet(tweet);

    return new Response(JSON.stringify({ message: 'Success', tweet, weather, penalty }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
