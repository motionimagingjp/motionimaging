// app/api/post-instagram/route.js
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Gemini呼び出し
async function callGemini(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 800,
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

// JSTの日時を取得
function getJST() {
  return new Date(Date.now() + 9 * 3600000);
}

function getDayOfWeek() {
  return getJST().getDay();
}

function getWeekNumber() {
  const jst = getJST();
  const startOfYear = new Date(jst.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((jst - startOfYear) / 86400000);
  return Math.floor(dayOfYear / 7);
}

function getDateString() {
  const jst = getJST();
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, '0');
  const d = String(jst.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function getMonthDayString() {
  const jst = getJST();
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function weatherCodeToText(code) {
  if (code === 0) return '快晴';
  if (code <= 2) return '晴れ';
  if (code <= 3) return '曇り';
  if (code <= 49) return '霧';
  if (code <= 67) return '雨';
  if (code <= 79) return '雪';
  if (code <= 84) return 'にわか雨';
  return '荒天';
}

function windSpeedToText(speed) {
  if (speed < 3) return `微風（${speed}m/s）`;
  if (speed < 6) return `弱風（${speed}m/s）`;
  if (speed < 10) return `やや強い風（${speed}m/s）`;
  if (speed < 15) return `強風（${speed}m/s）`;
  return `非常に強い風（${speed}m/s）`;
}

function waveHeightToText(height) {
  if (height < 0.5) return `穏やか（${height}m）`;
  if (height < 1.0) return `やや穏やか（${height}m）`;
  if (height < 1.5) return `やや高め（${height}m）`;
  if (height < 2.5) return `高め（${height}m）`;
  return `荒れ気味（${height}m）`;
}

function getCurrentHourIndex() {
  return getJST().getHours();
}

async function getWeather(lat, lng) {
  try {
    const hourIndex = getCurrentHourIndex();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=weathercode,temperature_2m,windspeed_10m&timezone=Asia%2FTokyo&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    const code      = data.hourly.weathercode[hourIndex];
    const temp      = Math.round(data.hourly.temperature_2m[hourIndex]);
    const windSpeed = Math.round(data.hourly.windspeed_10m[hourIndex] * 10) / 10;
    const weather   = weatherCodeToText(code);
    return { weather, temp, windSpeed };
  } catch {
    return { weather: '晴れ', temp: 25, windSpeed: 4 };
  }
}

async function getMarineInfo(lat, lng) {
  try {
    const hourIndex = getCurrentHourIndex();
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height&timezone=Asia%2FTokyo&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    const waveHeight = Math.round(data.hourly.wave_height[hourIndex] * 10) / 10;
    return { waveHeight };
  } catch {
    return { waveHeight: 0.8 };
  }
}

function getTideInfo() {
  const hour = getJST().getHours();
  if (hour >= 5 && hour < 9) return '朝の上げ潮';
  if (hour >= 9 && hour < 13) return '昼の満潮';
  if (hour >= 13 && hour < 17) return '午後の引き潮';
  if (hour >= 17 && hour < 21) return '夕方の干潮';
  return '夜の上げ潮';
}

const ACCOUNT = 'ig_motion_imaging';

const FOLDERS = {
  miyakojima: {
    path: `${ACCOUNT}/miyakojima`,
    count: parseInt(process.env.MIYAKOJIMA_IMAGE_COUNT || '10'),
    theme: '宮古島のビーチ',
    location: 'Miyakojima Island, Okinawa Japan',
    locationJa: '宮古島',
    lat: 24.8056,
    lng: 125.2814,
  },
  ishigaki: {
    path: `${ACCOUNT}/ishigaki`,
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '7'),
    theme: '石垣島・離島のビーチ',
    location: 'Ishigaki & Remote Islands, Okinawa Japan',
    locationJa: '石垣島',
    lat: 24.3448,
    lng: 124.1572,
  },
};

function getThisWeekFolder() {
  const week = getWeekNumber();
 return week % 2 === 0 ? 'miyakojima' : 'ishigaki';
}

async function getNextImageIndex(folderKey, totalCount) {
  const kvKey = `${ACCOUNT}_${folderKey}`;
  let current = await redis.get(kvKey);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % totalCount;
  await redis.set(kvKey, next);
  return next + 1;
}

function buildImageUrl(folderPath, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/images/${folderPath}/${index}.jpg`;
}

async function generateCaption(apiKey, folder, weatherInfo, marineInfo) {
  const dateStr  = getDateString();
  const monthDay = getMonthDayString();
  const { weather, temp, windSpeed } = weatherInfo;
  const { waveHeight } = marineInfo;
  const tide = getTideInfo();

  // 天気・海況を文字列として先に組み立てる
  const weatherBlock = `${monthDay}朝6時の${folder.locationJa}：${weather}、気温${temp}℃
服装アドバイス：天気・気温に合った具体的なアドバイスを1文で書く`;

  const marineBlock = `🌊 波の高さ：${waveHeightToText(waveHeight)}
💨 風の強さ：${windSpeedToText(windSpeed)}
🌀 潮の状況：${tide}`;

  const footer = `───────────
📸 Camera: Sony a7R5 / iPhone 17
📍 ${folder.location}
🗓 ${dateStr}

フォロー → @motion.imaging
サブ → @jake_images
💾 保存して後で見返してね
お仕事依頼はプロフィールから
───────────`;

  const prompt = `以下のフォーマットに従って、Instagramのキャプションを完成させてください。
【ルール】
- [本文]の部分だけ新しく書く（100文字程度、${folder.theme}の魅力を自然な文体で）
- わざとらしい疑問文や「え、〜」で始めない
- 毎回違う内容にする
- [天気情報][海況][フッター][ハッシュタグ]はそのまま出力する（変更禁止）
- ハッシュタグは厳選5個のみ（増やさない）
- 余計な説明文は不要、キャプション本文のみ返す

【出力フォーマット】
[本文をここに書く]

☀️ 今日の${folder.locationJa}情報
${weatherBlock}

🌊 海況リアルタイムレポート
${marineBlock}

${footer}

#[タグ1] #[タグ2] #[タグ3] #[タグ4] #[タグ5]`;

  return await callGemini(apiKey, prompt);
}

async function postToInstagram(imageUrl, caption) {
  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  const containerRes = await fetch(
    `https://graph.instagram.com/v19.0/${igAccountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption,
        access_token: accessToken,
      }),
    }
  );
  const containerData = await containerRes.json();
  if (containerData.error) throw new Error('Container Error: ' + containerData.error.message);

  const containerId = containerData.id;
  await new Promise(r => setTimeout(r, 3000));

  const publishRes = await fetch(
    `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    }
  );
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error('Publish Error: ' + publishData.error.message);

  return publishData.id;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const dayOfWeek = getDayOfWeek();

  if (dayOfWeek === 0) {
    return new Response(JSON.stringify({ message: '日曜日のため投稿をスキップ' }), { status: 200 });
  }

  try {
    const folderKey = getThisWeekFolder();
    const folder = FOLDERS[folderKey];

    const [weatherInfo, marineInfo] = await Promise.all([
      getWeather(folder.lat, folder.lng),
      getMarineInfo(folder.lat, folder.lng),
    ]);

    const imageIndex = await getNextImageIndex(folderKey, folder.count);
    const imageUrl = buildImageUrl(folder.path, imageIndex);
    const caption = await generateCaption(process.env.GEMINI_API_KEY, folder, weatherInfo, marineInfo);
    console.error('CAPTION:', caption);

     const postId = await postToInstagram(imageUrl, caption);

    return new Response(JSON.stringify({
      message: 'Success',
      theme: folder.theme,
      weather: weatherInfo,
      marine: marineInfo,
      imageUrl,
      caption,
      postId,
    }), { status: 200 });

 } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({
      error: error.message,
    }), { status: 500 });
  }
