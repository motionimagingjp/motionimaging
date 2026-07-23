// app/api/post-jake-images/route.js
// @jake_images_ 専用 Instagram自動投稿
// ============================================================
// 2026-07-23 修正版（post-instagram と同じ対策を適用）
//  1. Graph API を v19.0 → v23.0 に更新
//  2. base64変換を Buffer に置換（数十秒 → 1秒未満）／4MB超はVisionスキップ
//  3. 起動時に環境変数チェック＋トークン検証
//  4. 画像URLをHEADで事前確認
//  5. 公開は status_code ポーリング＋リトライ
//  6. Metaエラー詳細（code / error_subcode / fbtrace_id）を全て返す
//  7. exif.csv の取得失敗を致命的にしない（空EXIFで続行）
//  8. Instagram API側の重複チェックを追加（motion側と同等に）
//  9. ?key=CRON_SECRET でブラウザから直接デバッグ可能
// 10. ?force=1 で重複チェックをスキップ（テスト用）
// ※ Redisフラグは元から投稿成功後に更新されているため順序変更なし
// ============================================================
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const IG_API_VERSION = 'v23.0';
const IG_BASE = `https://graph.instagram.com/${IG_API_VERSION}`;
const MAX_VISION_BYTES = 4 * 1024 * 1024; // これを超える画像はGemini Visionに送らない

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

// ---- 環境変数チェック --------------------------------------
function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error('環境変数が未設定です: ' + missing.join(', '));
  }
}

// ---- Meta APIエラーを詳細に整形 ------------------------------
async function metaFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

function formatMetaError(prefix, status, json) {
  const e = json && json.error ? json.error : null;
  if (e) {
    return `${prefix} [HTTP ${status}] ${e.message}`
      + ` (code=${e.code ?? '-'}`
      + `, subcode=${e.error_subcode ?? '-'}`
      + `, type=${e.type ?? '-'}`
      + `, fbtrace=${e.fbtrace_id ?? '-'})`;
  }
  return `${prefix} [HTTP ${status}] ${JSON.stringify(json).slice(0, 400)}`;
}

// ---- 画像の実在確認とサイズ取得 ------------------------------
async function checkImage(imageUrl) {
  let res;
  try {
    res = await fetch(imageUrl, { method: 'HEAD' });
  } catch (e) {
    throw new Error(`画像URLへの接続に失敗: ${e.message} / ${imageUrl}`);
  }
  if (!res.ok) {
    throw new Error(`画像URLにアクセスできません [HTTP ${res.status}] ${imageUrl}`);
  }
  const size = parseInt(res.headers.get('content-length') || '0', 10);
  return { size };
}

// ---- base64変換（高速版）------------------------------------
function toBase64(arrayBuffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(arrayBuffer).toString('base64');
  }
  // フォールバック：32KBずつチャンク処理
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function imageUrlToBase64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return toBase64(buffer);
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

// ============================================================
// CSV読み込み
// ============================================================

async function fetchExifCSV() {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const url    = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${JAKE_FOLDER_PATH}/exif.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} / ${url}`);
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

async function detectJakeTheme(imageUrl, imageSize) {
  // 巨大画像はVisionに送らない（タイムアウト防止）
  if (imageSize > MAX_VISION_BYTES) {
    console.log(`⚠️ 画像が大きいためVisionをスキップ (${Math.round(imageSize / 1024 / 1024)}MB)`);
    return { themeInfo: JAKE_THEME_INFO['other'], theme: 'skipped(size)' };
  }

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
      return { themeInfo: flowerInfo, theme: `${theme}/${flowerName}` };
    }

    const key = Object.keys(JAKE_THEME_INFO).find(k => theme.includes(k)) || 'other';
    return { themeInfo: JAKE_THEME_INFO[key], theme: key };
  } catch (e) {
    console.error('Jake theme detection failed:', e.message);
    return { themeInfo: JAKE_THEME_INFO['other'], theme: 'fallback: ' + e.message };
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
// Threads投稿（500字制限・ベストエフォート）
// ============================================================
function buildThreadsText(fullCaption) {
  // フッター（───区切り）以降＝固定コメント等を除去
  let t = fullCaption.split('─')[0].trim();
  if (t.length > 500) t = t.slice(0, 497).trim() + '…';
  return t;
}

async function getThreadsUserId(token) {
  const r = await fetch(`https://graph.threads.net/v1.0/me?fields=id&access_token=${token}`);
  const d = await r.json();
  if (d.error) throw new Error('Threads me error: ' + d.error.message);
  return d.id;
}

async function postToThreads(token, imageUrl, text) {
  if (!token) { console.log('ℹ️ Threads token未設定 → スキップ'); return null; }
  const userId = await getThreadsUserId(token);

  const cRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'IMAGE', image_url: imageUrl, text, access_token: token }),
  });
  const cData = await cRes.json();
  if (cData.error) throw new Error('Threads Container Error: ' + cData.error.message);

  async function publish() {
    const pRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    return pRes.json();
  }
  await new Promise(r => setTimeout(r, 5000));
  let pData = await publish();
  if (pData.error) {
    await new Promise(r => setTimeout(r, 5000));
    pData = await publish();
  }
  if (pData.error) throw new Error('Threads Publish Error: ' + pData.error.message);
  return pData.id;
}

// ============================================================
// Instagram投稿（トークン検証＋ポーリング公開）
// ============================================================
async function verifyToken(accessToken) {
  const { status, json } = await metaFetch(
    `${IG_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
  );
  if (json && json.error) {
    throw new Error(formatMetaError('トークンが無効です', status, json));
  }
  console.log(`🔑 Token OK: @${json.username} (id=${json.id})`);
  return json;
}

// コンテナが公開可能になるまで待つ（最大90秒）
async function waitForContainer(creationId, accessToken) {
  const start = Date.now();
  let last = 'UNKNOWN';
  while (Date.now() - start < 90000) {
    const { status, json } = await metaFetch(
      `${IG_BASE}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
    );
    if (json && json.error) {
      throw new Error(formatMetaError('Container Status Error', status, json));
    }
    last = json.status_code || 'UNKNOWN';
    console.log(`⏳ container status: ${last}`);
    if (last === 'FINISHED') return;
    if (last === 'ERROR' || last === 'EXPIRED') {
      throw new Error(`Container失敗: status_code=${last} detail=${String(json.status || '').slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Containerタイムアウト: 最終status_code=${last}`);
}

async function postToInstagram(imageUrl, caption) {
  const igId    = process.env.JAKE_IMAGES_ACCOUNT_ID;
  const igToken = process.env.JAKE_IMAGES_ACCESS_TOKEN;

  // 1) コンテナ作成
  const c = await metaFetch(`${IG_BASE}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken }),
  });
  if (c.json && c.json.error) {
    throw new Error(formatMetaError('Container Error', c.status, c.json));
  }
  const creationId = c.json.id;
  if (!creationId) {
    throw new Error(`Container Error: idが返りません ${JSON.stringify(c.json).slice(0, 300)}`);
  }

  // 2) 処理完了を待つ
  await waitForContainer(creationId, igToken);

  // 3) 公開（失敗時は5秒待って2回までリトライ）
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const p = await metaFetch(`${IG_BASE}/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: igToken }),
    });
    if (p.json && p.json.error) {
      lastErr = formatMetaError(`Publish Error (試行${attempt}/3)`, p.status, p.json);
      console.error(lastErr);
      if (attempt < 3) { await new Promise(r => setTimeout(r, 5000)); continue; }
      throw new Error(lastErr);
    }
    return p.json.id;
  }
  throw new Error(lastErr || 'Publish Error: 原因不明');
}

// ============================================================
// メインハンドラー
// ============================================================

export async function GET(request) {
  const url = new URL(request.url);

  // 認証：Authorizationヘッダー または ?key= のどちらでもOK
  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const force    = url.searchParams.get('force') === '1';
  const today    = getDateString();
  const todayKey = 'ig_jake_posted_date';
  const debug    = { account: '@jake_images_', apiVersion: IG_API_VERSION, steps: [] };
  const step = (name, detail) => {
    debug.steps.push(detail ? `${name}: ${detail}` : name);
    console.log(`▶ ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    // ---- 0) 環境変数チェック ----
    requireEnv([
      'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'GEMINI_API_KEY',
      'JAKE_IMAGES_ACCESS_TOKEN', 'JAKE_IMAGES_ACCOUNT_ID',
      'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME',
    ]);
    step('環境変数チェック', 'OK');

    // ---- 1) トークン検証 ----
    const me = await verifyToken(process.env.JAKE_IMAGES_ACCESS_TOKEN);
    debug.username = me.username;
    step('トークン検証', `@${me.username}`);

    // ---- 2) 重複チェック（Redis） ----
    if (!force) {
      const lastPosted = await redis.get(todayKey);
      if (lastPosted === today) {
        step('重複チェック(Redis)', '本日投稿済み → スキップ');
        return new Response(JSON.stringify({
          message: '本日投稿済みのためスキップ（Redis）', debug,
        }), { status: 200 });
      }
    } else {
      step('重複チェック', 'force=1のためスキップ');
    }

    // ---- 3) 重複チェック（Instagram API） ----
    if (!force) {
      try {
        const m = await metaFetch(
          `${IG_BASE}/${process.env.JAKE_IMAGES_ACCOUNT_ID}/media?fields=timestamp&limit=1&access_token=${encodeURIComponent(process.env.JAKE_IMAGES_ACCESS_TOKEN)}`
        );
        if (m.json && m.json.data && m.json.data.length > 0) {
          const lastPostDate    = new Date(m.json.data[0].timestamp);
          const lastPostJST     = new Date(lastPostDate.getTime() + 9 * 3600000);
          const lastPostDateStr = `${lastPostJST.getFullYear()}/${String(lastPostJST.getMonth() + 1).padStart(2, '0')}/${String(lastPostJST.getDate()).padStart(2, '0')}`;
          if (lastPostDateStr === today) {
            await redis.set(todayKey, today, { ex: 82800 });
            step('重複チェック(IG API)', '本日投稿済み → スキップ');
            return new Response(JSON.stringify({
              message: '本日投稿済みのためスキップ（Instagram API）', debug,
            }), { status: 200 });
          }
        }
        step('重複チェック(IG API)', 'OK');
      } catch (e) {
        step('重複チェック(IG API)', '確認失敗（続行）: ' + e.message);
      }
    }

    // ---- 4) 次の画像インデックス取得 ----
    let current = await redis.get(JAKE_REDIS_KEY);
    if (current === null || current === undefined) current = -1;
    const nextIndex = (parseInt(current) + 1) % JAKE_IMAGE_COUNT;
    const imageNum  = String(nextIndex + 1).padStart(2, '0');
    const imageUrl  = buildImageUrl(nextIndex + 1);
    debug.imageUrl = imageUrl;

    const { size } = await checkImage(imageUrl);
    step('画像確認', `${imageUrl} (${Math.round(size / 1024)}KB)`);

    // ---- 5) EXIF取得（失敗しても続行） ----
    let exif = {};
    try {
      const rows = await fetchExifCSV();
      exif = rows.find(r => (r.FileName || '') === `${imageNum}.jpg`) || {};
      step('EXIF取得', Object.keys(exif).length > 0 ? `${imageNum}.jpg のデータあり` : `${imageNum}.jpg の行が見つからず（?で出力）`);
    } catch (e) {
      step('EXIF取得', '失敗（?で続行）: ' + e.message);
    }

    // ---- 6) テーマ判別 ----
    const { themeInfo, theme } = await detectJakeTheme(imageUrl, size);
    step('テーマ判別', theme);

    // ---- 7) キャプション生成 ----
    const caption = await generateCaption(exif, themeInfo, imageNum);
    step('キャプション生成', `${caption.length}文字`);

    // ---- 8) Instagram投稿 ----
    const postId = await postToInstagram(imageUrl, caption);
    step('Instagram投稿', `成功 postId=${postId}`);

    // ---- 9) 成功後にフラグとインデックスを確定 ----
    await redis.set(JAKE_REDIS_KEY, nextIndex);
    await redis.set(todayKey, today, { ex: 82800 });
    step('Redis更新', `${JAKE_REDIS_KEY}=${nextIndex}`);

    console.log(`✅ jake_images_ posted: ${imageNum}.jpg postId=${postId}`);

    // ---- 10) Threads（ベストエフォート） ----
    let threadsId = null;
    try {
      threadsId = await postToThreads(process.env.THREADS_JAKE_TOKEN, imageUrl, buildThreadsText(caption));
      if (threadsId) step('Threads投稿', `成功 ${threadsId}`);
    } catch (e) {
      step('Threads投稿', '失敗（IGには影響なし）: ' + e.message);
    }

    return new Response(JSON.stringify({
      message: 'Success',
      imageNumber: imageNum,
      imageUrl,
      caption,
      postId,
      threadsId,
      debug,
    }), { status: 200 });

  } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({
      error: error.message,
      debug,
    }), { status: 500 });
  }
}
