// app/api/post-jake-images/route.js
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function callGemini(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 500,
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

function getJST() {
  return new Date(Date.now() + 9 * 3600000);
}

function getDateString() {
  const jst = getJST();
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, '0');
  const d = String(jst.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

const FOLDER_PATH = 'ig_jake_images/portrait';
const REDIS_KEY = 'ig_jake_images_portrait';
const IMAGE_COUNT = parseInt(process.env.JAKE_IMAGES_IMAGE_COUNT || '18');

async function getNextImageIndex() {
  let current = await redis.get(REDIS_KEY);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % IMAGE_COUNT;
  await redis.set(REDIS_KEY, next);
  return next + 1;
}

function buildImageUrl(index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const paddedIndex = String(index).padStart(2, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${FOLDER_PATH}/${paddedIndex}.jpg`;
}

async function getExifData(index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${FOLDER_PATH}/jake_exif.csv`;

  const res = await fetch(csvUrl);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const paddedIndex = String(index).padStart(2, '0') + '.jpg';

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => row[h.trim()] = (values[idx] || '').trim());
    if (row['FileName'] === paddedIndex) return row;
  }
  return null;
}

async function generateCaption(apiKey, exif) {
  const location = exif?.location && exif.location !== 'TBA' ? exif.location : 'Japan';
  const fNumber = exif?.FNumber ? `f/${exif.FNumber}` : '';
  const ss = exif?.ExposureTime ? `${exif.ExposureTime}s` : '';
  const iso = exif?.ISO ? `ISO${exif.ISO}` : '';
  const lens = exif?.LensModel || 'FE 50mm F1.4 GM';

  const prompt = `あなたはポートレート写真家のInstagramキャプションライターです。
以下の撮影情報をもとに、エモーショナルで詩的な日本語キャプション（60〜80文字）を1文だけ生成してください。
余計な説明・ハッシュタグ・絵文字は不要です。純粋な1文のみ出力してください。

撮影場所：${location}
レンズ：${lens}
絞り：${fNumber}
シャッタースピード：${ss}
ISO：${iso}`;

  return await callGemini(apiKey, prompt);
}

async function postToInstagram(imageUrl, caption) {
  const igAccountId = process.env.JAKE_IMAGES_ACCOUNT_ID;
  const accessToken = process.env.JAKE_IMAGES_ACCESS_TOKEN;

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

  try {
    const imageIndex = await getNextImageIndex();
    const imageUrl = buildImageUrl(imageIndex);
    const exif = await getExifData(imageIndex);
    const dateStr = getDateString();

    const emotionalLine = await generateCaption(process.env.GEMINI_API_KEY, exif);

    const location = exif?.location && exif.location !== 'TBA' ? exif.location : 'Japan';
    const fNumber = exif?.FNumber ? `f/${exif.FNumber}` : '';
    const ss = exif?.ExposureTime || '';
    const iso = exif?.ISO ? `ISO ${exif.ISO}` : '';
    const lens = exif?.LensModel || 'FE 50mm F1.4 GM';

    const caption = `${emotionalLine}

📷 Sony a7R5 | ${lens}
⚙️ ${fNumber} | ${ss} | ${iso}
📍 ${location}
🗓 ${dateStr}

Follow → @jake_images_
Sub → @motion.imaging
💾 保存して後で見返してね
お仕事依頼はプロフィールから

#ポートレート #portrait #Sony #a7R5 #写真好きな人と繋がりたい`;

    // Instagram投稿（テスト完了後にコメントを外す）
    const postId = "TEST_MODE"; // await postToInstagram(imageUrl, caption);

    return new Response(JSON.stringify({
      message: 'Success',
      imageUrl,
      caption,
      exif,
      postId,
    }), { status: 200 });

  } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({
      error: error.message,
    }), { status: 500 });
  }
}
