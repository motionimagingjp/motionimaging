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

// JSTの日時を取得
function getJST() {
  return new Date(Date.now() + 9 * 3600000);
}

// 曜日を取得（0=日, 1=月...6=土）
function getDayOfWeek() {
  return getJST().getDay();
}

// ISO週番号を取得
function getWeekNumber() {
  const jst = getJST();
  const startOfYear = new Date(jst.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((jst - startOfYear) / 86400000);
  return Math.floor(dayOfYear / 7);
}

// 投稿日を整形（例：2026/05/04）
function getDateString() {
  const jst = getJST();
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, '0');
  const d = String(jst.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// アカウント識別子
const ACCOUNT = 'ig_motion_imaging';

// フォルダ設定
const FOLDERS = {
  miyakojima: {
    path: `${ACCOUNT}/miyakojima`,
    count: parseInt(process.env.MIYAKOJIMA_IMAGE_COUNT || '10'),
    theme: '宮古島のビーチ',
    location: 'Miyakojima Island, Okinawa Japan',
  },
  ishigaki: {
    path: `${ACCOUNT}/ishigaki`,
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '7'),
    theme: '石垣島・離島のビーチ',
    location: 'Ishigaki & Remote Islands, Okinawa Japan',
  },
};

// 今週のフォルダ（週番号の偶奇で切り替え）
function getThisWeekFolder() {
  const week = getWeekNumber();
  return week % 2 === 0 ? 'miyakojima' : 'ishigaki';
}

// 次の画像インデックスを取得
async function getNextImageIndex(folderKey, totalCount) {
  const kvKey = `${ACCOUNT}_${folderKey}`;
  let current = await redis.get(kvKey);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % totalCount;
  await redis.set(kvKey, next);
  return next + 1;
}

// GitHub Raw URLを組み立て
function buildImageUrl(folderPath, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/images/${folderPath}/${index}.jpg`;
}

// Geminiでキャプション生成
async function generateCaption(apiKey, folder) {
  const dateStr = getDateString();

  const prompt = `あなたはInstagramのフォロワーを増やすプロのキャプションライターです。
${folder.theme}の写真に合う、魅力的なInstagramキャプションを日本語で書いてください。

【構成】
1. 冒頭1文：共感・疑問・驚きで読者を引き込む
2. 本文：場所の魅力やストーリー（100文字程度）
3. 固定フッター（以下をそのまま使う）：
───────────
📸 Camera: Sony a7R5 / iPhone 17
📍 ${folder.location}
🗓 ${dateStr}

フォロー → @motion.imaging
サブ → @jake_images
💾 保存して後で見返してね
お仕事依頼はプロフィールから
───────────
4. ハッシュタグ：関連する5〜8個

条件：
- 冒頭は必ず疑問・共感・驚きの一文で始める
- 毎回違う内容にすること
- キャプション全体のみ返す（説明文不要）

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

  try {
    const folderKey = getThisWeekFolder();
    const folder = FOLDERS[folderKey];

    // 次の画像インデックス取得
    const imageIndex = await getNextImageIndex(folderKey, folder.count);

    // 画像URL組み立て
    const imageUrl = buildImageUrl(folder.path, imageIndex);

    // キャプション生成
    const caption = await generateCaption(process.env.GEMINI_API_KEY, folder);

    // Instagram投稿
    const postId = await postToInstagram(imageUrl, caption);

    return new Response(JSON.stringify({
      message: 'Success',
      week: getWeekNumber(),
      theme: folder.theme,
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
