// app/api/post-jake-images/route.js
// @jake_images_ 専用 Instagram自動投稿
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// 定数
// ============================================================

const FIXED_COMMENT = `いつもご覧いただきありがとうございます。
写真はすべて私自身が撮影したものですが、投稿文の最適化や気象データの解析には生成AIを活用しています。AIの進化に圧倒され、一時期は撮影を離れたこともありましたが、現在は「リアルな一瞬」と「AI」を融合させた表現を追求しています。
【My Challenge & Life】 アラフィフからの新たな挑戦として、AI活用やアプリ開発をゆっくりですが心から楽しんでいます。いくつになっても新しいことを学ぶ楽しさを、発信を通じて共有できれば嬉しいです。
【Social Media & Projects】
* Landscape: @motion.imaging (海・風景)
* Portrait: @jake_images_ (撮影条件も公開中)
* X (Twitter): @motion_imaging ↳ 毎朝6時に「花・富士山・雲海・星空」のミゴロン指数を独自計算して発信中！
* Development: 現在、新しいコミュニケーションツールを開発中です。
自動生成の予報データに不具合があれば、優しく教えていただけると助かります（笑）。コメントやフォロー、お気軽にどうぞ！`;

const JAKE_REDIS_KEY   = 'ig_jake_images_portrait';
const JAKE_IMAGE_COUNT = parseInt(process.env.JAKE_IMAGE_COUNT || '61');
const JAKE_FOLDER_PATH = 'ig_jake_images/portrait';

const JAKE_THEME_INFO = {
  sakura: '🌸 桜とポートレート：日本の春の象徴・桜と人物の組み合わせは儚さと美しさが重なる特別な瞬間。満開の桜の下での撮影は一期一会。',
  kimono: '👘 着物ポートレート：日本の伝統美を纏った姿は街並みと溶け合うとき特別な空気が生まれる。和の美しさを次世代へ。',
  beach:  '🏖 ビーチポートレート：沖縄の透き通る海と人物の組み合わせ。太陽の光が肌を照らし風が髪をなびかせる自然体の美しさ。',
  star:   '🌟 星空ポートレート：満天の星空の下でのポートレートは宇宙と人間の対比が生む圧倒的なスケール感。沖縄の澄んだ夜空だからこそ撮れる一枚。',
  flower: '🌺 フラワーポートレート：花々に囲まれた美しさ。鮮やかな色彩が人物の魅力を引き立てる。',
  street: '🏙 ストリートポートレート：街の空気と人物が混ざり合う瞬間を切り取る。日常の中に潜む美しさを探して。',
  school: '🎒 学生ポートレート：あどけなさの中に宿る目の奥の輝き。その瞬間にしかない純粋さと可能性を、ファインダー越しに切り取った一枚。ぜひ目を見てほしい。',
  studio: '📸 スタジオポートレート：光を完全にコントロールした環境で引き出すその人だけの表情と個性。',
  other:  '📷 ポートレートの魅力：その人だけが持つ表情、空気感、存在感。カメラを通して引き出す瞬間の美しさ。',
};

// ============================================================
// ユーティリティ関数
// ============================================================

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

function buildImageUrl(index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const paddedIndex = String(index).padStart(2, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${JAKE_FOLDER_PATH}/${paddedIndex}.jpg`;
}

// ============================================================
// API呼び出し
// ============================================================

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

async function callGeminiWithImage(apiKey, imageBase64, textPrompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          { text: textPrompt }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 50,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Vision Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim().toLowerCase();
}

async function imageUrlToBase64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ============================================================
// CSV読み込み
// ============================================================

async function fetchExifCSV() {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const url    = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${JAKE_FOLDER_PATH}/exif.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return parseCSV(await res.text());
}

function parseCSV(text) {
  const lines   = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

// ============================================================
// テーマ判別
// ============================================================

async function detectJakeTheme(imageUrl) {
  try {
    const base64 = await imageUrlToBase64(imageUrl);
    const theme  = await callGeminiWithImage(
      process.env.GEMINI_API_KEY,
      base64,
      'これはポートレート写真です。以下の選択肢から最も当てはまるテーマを1つだけ答えてください。選択肢以外の言葉は不要です。\n選択肢: sakura, kimono, beach, star, flower, street, school, studio, other'
    );
    console.log('🎨 Jake theme:', theme);

    // 花系は花の種類をさらに特定
    if (theme.includes('flower') || theme.includes('sakura')) {
      const flowerName = await callGeminiWithImage(
        process.env.GEMINI_API_KEY,
        base64,
        'このポートレート写真に写っている花は何ですか？花の名前を日本語で1〜3語で答えてください（例：桜、ブーゲンビリア、向日葵、紫陽花、ポピー）。特定できない場合は「花」と答えてください。'
      );
      console.log('🌸 Flower:', flowerName);
      const flowerInfo = await callGemini(
        process.env.GEMINI_API_KEY,
        `ポートレート写真に${flowerName}が写っています。${flowerName}とポートレート撮影の魅力について、インスタグラムのキャプション用に2〜3文で日本語で書いてください。絵文字を1つ使って始めてください。`
      );
      return flowerInfo;
    }

    const key = Object.keys(JAKE_THEME_INFO).find(k => theme.includes(k)) || 'other';
    return JAKE_THEME_INFO[key];
  } catch (e) {
    console.error('Jake theme detection failed:', e.message);
    return JAKE_THEME_INFO['other'];
  }
}

// ============================================================
// キャプション生成
// ============================================================

async function generateCaption(exif, themeInfo, imageNum) {
  const dateStr = getDateString();
  const fstop   = exif.FNumber      || '?';
  const shutter = exif.ExposureTime || '?';
  const iso     = exif.ISO          || '?';
  const lens    = exif.LensModel    || '';
  const loc     = exif.location     || 'Japan';

  const prompt = `あなたはプロのポートレートフォトグラファーです。
以下のフォーマットで日本語のInstagramキャプションを生成してください。

【ルール】
- 1行目：エモーショナルな一行（詩的・余白のある表現、20〜35文字、句読点なし）
- 毎回違う内容にする
- 余計な説明不要、キャプション本文のみ返す

【出力フォーマット】
[エモーショナルな一行]

📷 Sony a7R5
🔭 f/${fstop}  ${shutter}s  ISO${iso}${lens ? `\n🎯 ${lens}` : ''}
👤 Model: TBA

📌 ${themeInfo}

📍 ${loc}
🗓 ${dateStr}（投稿日、過去画像）
フォロー → @jake_images_
サブ → @motion.imaging
お仕事はプロフィールから

${FIXED_COMMENT}

#ポートレート #portrait #portraitphotography #日本 #ソニー`;

  return await callGemini(process.env.GEMINI_API_KEY, prompt);
}

// ============================================================
// メインハンドラー
// ============================================================

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2重投稿防止
  const today      = getDateString();
  const todayKey   = 'ig_jake_posted_date';
  const lastPosted = await redis.get(todayKey);

  if (lastPosted === today) {
    console.log('⚠️ Jake already posted today, skipping');
    return new Response(JSON.stringify({ message: '本日投稿済みのためスキップ' }), { status: 200 });
  }

  try {
    // 次の画像インデックス取得
    let current = await redis.get(JAKE_REDIS_KEY);
    if (current === null || current === undefined) current = -1;
    const nextIndex = (parseInt(current) + 1) % JAKE_IMAGE_COUNT;
    const imageNum  = String(nextIndex + 1).padStart(2, '0');
    const imageUrl  = buildImageUrl(nextIndex + 1);

    // EXIF取得
    const rows = await fetchExifCSV();
    const exif = rows.find(r => (r.FileName || '') === `${imageNum}.jpg`) || {};

    // テーマ判別
    const themeInfo = await detectJakeTheme(imageUrl);

    // キャプション生成
    const caption = await generateCaption(exif, themeInfo, imageNum);

    // Instagram投稿
    const igId    = process.env.JAKE_IMAGES_ACCOUNT_ID;
    const igToken = process.env.JAKE_IMAGES_ACCESS_TOKEN;

    const cRes = await fetch(`https://graph.instagram.com/v19.0/${igId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken })
    });
    const cData = await cRes.json();
    if (cData.error) throw new Error('Container Error: ' + cData.error.message);

    await new Promise(r => setTimeout(r, 3000));

    const pRes = await fetch(`https://graph.instagram.com/v19.0/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: cData.id, access_token: igToken })
    });
    const pData = await pRes.json();
    if (pData.error) throw new Error('Publish Error: ' + pData.error.message);

    // Redis更新
    await redis.set(JAKE_REDIS_KEY, nextIndex);
    await redis.set(todayKey, today, { ex: 90000 });

    console.log(`✅ jake_images_ posted: ${imageNum}.jpg postId=${pData.id}`);

    return new Response(JSON.stringify({
      message: 'Success',
      imageNumber: imageNum,
      imageUrl,
      caption,
      postId: pData.id,
    }), { status: 200 });

  } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
