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

// 曜日を取得（JST）
function getDayOfWeek() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return jst.getDay(); // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
}

// アカウント識別子
const ACCOUNT = 'ig_motion_imaging';

// フォルダと画像枚数の設定
const FOLDERS = {
  miyakojima: {
    path: `${ACCOUNT}/miyakojima`,
    count: parseInt(process.env.MIYAKOJIMA_IMAGE_COUNT || '10'),
  },
  ishigaki: {
    path: `${ACCOUNT}/ishigaki`,
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '7'),
  },
};

// 曜日ごとの設定（0=日曜は投稿なし）
const DAY_CONFIG = {
  1: { folder: 'miyakojima', theme: '宮古島' },
  2: { folder: 'ishigaki',   theme: '石垣島・離島' },
  3: { folder: 'miyakojima', theme: '宮古島' },
  4: { folder: 'ishigaki',   theme: '石垣島・離島' },
  5: { folder: 'miyakojima', theme: '宮古島' },
  6: { folder: 'ishigaki',   theme: '石垣島・離島' },
};

// 次の画像インデックスを取得（Upstash Redisで管理）
async function getNextImageIndex(folderKey, totalCount) {
  const kvKey = `${ACCOUNT}_${folderKey}`;
  let current = await redis.get(kvKey);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % totalCount;
  await redis.set(kvKey, next);
  return next + 1; // 1始まり（1.jpg, 2.jpg...）
}

// GitHub Raw URLを組み立て
function buildImageUrl(folderPath, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/images/${folderPath}/${index}.jpg`;
}

// Geminiでキャプション生成
async function generateCaption(apiKey, theme) {
  const today = new Date(Date.now() + 9 * 3600000);
  const dateStr = `${today.getMonth() + 1}月${today.getDate()}日`;

  const prompt = `あなたはInstagramの写真投稿のキャプションを書くプロです。
今日（${dateStr}）の${theme}の絶景について、魅力的なキャプションを日本語で書いてください。

条件：
- 100文字程度（前後10文字はOK）
- 旅行や写真撮影が好きな人に向けた内容
- 具体的なスポット名や見どころを含める
- 自然な口語体で親しみやすく
- 末尾にハッシュタグを3〜5個（例：#宮古島 #絶景 #離島 #旅行 #写真好きな人と繋がりたい）
- キャプション本文のみ返す（説明文不要）
- 毎回違う内容にすること

キャプション：`;

  return await callGemini(apiKey, prompt);
}

// Instagram Graph APIで投稿
async function postToInstagram(imageUrl, caption) {
  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  // Step 1: メディアコンテナ作成
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

  // Step 2: 少し待つ
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: 公開
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
  // Cron認証
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const dayOfWeek = getDayOfWeek();

  // 日曜は投稿しない
  if (dayOfWeek === 0) {
    return new Response(JSON.stringify({ message: '日曜日のため投稿をスキップ' }), { status: 200 });
  }

  const config = DAY_CONFIG[dayOfWeek];
  if (!config) {
    return new Response(JSON.stringify({ message: '設定なし' }), { status: 200 });
  }

  try {
    const folder = FOLDERS[config.folder];

    // 次の画像インデックス取得
    const imageIndex = await getNextImageIndex(config.folder, folder.count);

    // 画像URL組み立て
    const imageUrl = buildImageUrl(folder.path, imageIndex);

    // キャプション生成
    const caption = await generateCaption(process.env.GEMINI_API_KEY, config.theme);

    // Instagram投稿
    const postId = await postToInstagram(imageUrl, caption);

    return new Response(JSON.stringify({
      message: 'Success',
      day: dayOfWeek,
      theme: config.theme,
      imageUrl,
      caption,
      postId,
    }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
    }), { status: 500 });
  }
}
