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

async function generateTweet(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  return data.candidates[0].content.parts[0].text.trim();
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

    const sakuraInstruction = sakura
      ? 'Sakura season (February 1 to April 15). Estimate accumulated temperature since February 1. Bloom starts at 210 degrees C (index 50 percent). Full bloom at 370 degrees C (index 90 percent or higher). Select 5 real sakura spots in Kanto and nearby. Factor in elevation and regional differences.'
      : 'Current season flowers in Kanto and nearby: ' + flowers.join(', ') + '. Select 5 real locations where these flowers are at peak bloom now. No temperature calculation needed.';

    const prompt = 'You are the social media manager for Migoron, a Japanese landscape photography account. Write an English post for professional landscape photographers, 30 minutes before sunrise in Japan.\n\n'
      + 'Date: ' + dateLabel + '\n'
      + 'Season info: ' + sakuraInstruction + '\n\n'
      + 'Requirements:\n'
      + 'Start with: Bloom Index [' + dateLabel + ']\n'
      + 'List 5 flower spots in Kanto region only\n'
      + 'Each spot gets an emoji and Migoron Index (XX%)\n'
      + 'Sort by index descending\n'
      + 'Add a Migoron Note: one sentence on why this spot is ideal today\n'
      + 'Write in the voice of a seasoned professional landscape photographer\n'
      + 'English only\n'
      + 'No markdown, no bullet points\n'
      + 'Each item on its own line\n'
      + 'End with: #JapaneseFlowers #LandscapePhotography #Migoron\n'
      + 'No camera settings (f-stop, shutter speed, ISO etc.)\n'
      + 'Output post text only';

    const tweet = await generateTweet(process.env.GEMINI_API_KEY, prompt);

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
