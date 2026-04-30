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

    const seasonInfo = sakura
      ? 'Cherry blossom season. Calculate bloom progress from Feb 1 accumulated temp (bloom at 210C, full bloom at 370C). Select 5 real sakura spots in Kanto.'
      : 'In-season flowers: ' + flowers.join(', ') + '. Select 5 real flower spots in Kanto region.';

    const prompt = 'Calculate Migoron Index for 5 flower spots in Kanto, Japan.\n'
      + 'Date: ' + dateLabel + '\n'
      + 'Season: ' + seasonInfo + '\n\n'
      + 'Return ONLY this JSON format, no markdown:\n'
      + '{"spots":[{"name":"Hitachi Seaside Park, Ibaraki","emoji":"🌼","score":95},{"name":"Ashikaga Flower Park, Tochigi","emoji":"🌸","score":88},{"name":"Showa Memorial Park, Tokyo","emoji":"🌷","score":82},{"name":"Musashino Forest Park, Saitama","emoji":"🌿","score":75},{"name":"Yokohama Park, Kanagawa","emoji":"🌺","score":68}],"memo":"One short sentence under 15 words about today conditions"}';

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
        { name: 'Hitachi Seaside Park, Ibaraki', emoji: '🌼', score: 95 },
        { name: 'Ashikaga Flower Park, Tochigi', emoji: '🌸', score: 88 },
        { name: 'Showa Memorial Park, Tokyo', emoji: '🌷', score: 82 },
        { name: 'Musashino Forest Park, Saitama', emoji: '🌿', score: 75 },
        { name: 'Yokohama Park, Kanagawa', emoji: '🌺', score: 68 },
      ];
      memo = 'Peak bloom season across Kanto.';
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

    return new Response(JSON.stringify({ message: 'Success', tweet }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
