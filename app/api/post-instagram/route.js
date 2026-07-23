// app/api/post-instagram/route.js
// @motion.imaging 専用 Instagram自動投稿
// ============================================================
// 2026-07-23 修正版
//  1. Graph API を v19.0 → v23.0 に更新
//  2. base64変換を Buffer に置換（数十秒 → 1秒未満）／4MB超はVisionスキップ
//  3. Redisの「投稿済み」フラグを投稿"成功後"に移動
//  4. 起動時に環境変数チェック＋トークン検証
//  5. 画像URLをHEADで事前確認
//  6. 公開は status_code ポーリング＋リトライ
//  7. Metaエラー詳細（code / error_subcode / fbtrace_id）を全て返す
//  8. ?key=CRON_SECRET でブラウザから直接デバッグ可能
//  9. ?force=1 でRedis重複チェックをスキップ（テスト用）
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

const FIXED_COMMENT = `いつもご覧いただきありがとうございます。
写真はすべて私自身が撮影したものですが、投稿文の最適化や気象データの解析には生成AIを活用しています。AIの進化に圧倒され、一時期は撮影を離れたこともありましたが、現在は「リアルな一瞬」と「AI」を融合させた表現を追求しています。
【My Challenge & Life】 アラフィフからの新たな挑戦として、AI活用やアプリ開発をゆっくりですが心から楽しんでいます。いくつになっても新しいことを学ぶ楽しさを、発信を通じて共有できれば嬉しいです。
【Social Media & Projects】
* Landscape: @motion.imaging (海・風景)
* Portrait: @jake_images_ (撮影条件も公開中)
* X (Twitter): @motion_imaging ↳ 毎朝6時に「花・富士山・雲海・星空」のミゴロン指数を独自計算して発信中！
* Development: 現在、新しいコミュニケーションツールを開発中です。
自動生成の予報データに不具合があれば、優しく教えていただけると助かります（笑）。コメントやフォロー、お気軽にどうぞ！`;

const ACCOUNT = 'ig_motion_imaging';

const FOLDERS = {
  miyakojima: {
    path: `${ACCOUNT}/miyakojima`,
    count: parseInt(process.env.MIYAKOJIMA_IMAGE_COUNT || '47'),
    location: 'Miyakojima Island, Okinawa Japan',
    locationJa: '宮古島',
    theme: '宮古島のビーチ',
    lat: 24.8056,
    lng: 125.2814,
  },
  ishigaki: {
    path: `${ACCOUNT}/ishigaki`,
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '109'),
    location: 'Ishigaki & Remote Islands, Okinawa Japan',
    locationJa: '石垣島',
    theme: '石垣島・離島のビーチ',
    lat: 24.3448,
    lng: 124.1572,
  },
};

const THEME_INFO = {
  beach: {
    '宮古島': '🏖 宮古島ビーチ情報：与那覇前浜は日本屈指の透明度。新城海岸では運が良ければウミガメと泳げる。砂山ビーチは砂丘を越えた先にある隠れ名所。',
    '石垣島': '🏖 石垣島ビーチ情報：川平湾はエメラルドグリーンの海が美しい国名勝。米原ビーチはサンゴ礁豊富でシュノーケル最適。底地ビーチは遠浅で家族向け。',
  },
  star: {
    '宮古島': '🌟 宮古島星空情報：宮古島は日本有数の星空スポット。島の言い伝えでは流れ星に願うと叶うとされる。新月前後の夜が最も美しく天の川が見える。',
    '石垣島': '🌟 石垣島星空情報：石垣島は国内最大の星空保護区。八重山の言い伝えでは天の川は海への道とされている。石垣天文台では南十字星も観測できる。',
  },
  diving: {
    '宮古島': '🤿 宮古島ダイビング情報：ヤビジは宮古最大の珊瑚礁。大神島周辺では青珊瑚の群生が見られる。通り池は地底とつながる神秘的なダイビングスポット。',
    '石垣島': '🤿 石垣島ダイビング情報：マンタスクランブルはマンタと確実に出会えるスポットとして世界的に有名。川平湾周辺はビギナーにも人気の珊瑚礁。',
  },
  flower_buffalo: {
    '宮古島': '🌺 宮古島自然情報：3〜4月は日本最大の蝶・オオゴマダラが舞う季節。ハイビスカスやブーゲンビリアが一年中咲き誇る南国の楽園。',
    '石垣島': '🐃 石垣島文化情報：竹富島では水牛車で島をのんびり巡れる。サキシマスオウノキなど亜熱帯植物が生い茂るジャングルも必見。',
  },
  sunset: {
    '宮古島': '🌅 宮古島サンセット情報：西平安名崎は宮古島随一の夕日スポット。池間大橋からのサンセットも絶景。海が黄金色に染まる瞬間は息をのむ美しさ。',
    '石垣島': '🌅 石垣島サンセット情報：川平湾のサンセットは格別の美しさ。バンナ岳展望台からは島全体が夕日に染まる絶景を楽しめる。',
  },
  other: {
    '宮古島': '🌊 宮古島の魅力：エメラルドグリーンの海と白い砂浜、温かい島人の笑顔。一度訪れたら必ずまた来たくなる島。',
    '石垣島': '🌊 石垣島の魅力：八重山諸島の玄関口として多くの離島へのアクセス拠点。独自の文化と自然が共存する豊かな島。',
  },
};

// ============================================================
// ユーティリティ
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

function getMonthDayString() {
  const jst = getJST();
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function getCurrentHourIndex() {
  return getJST().getHours();
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

function getTideInfo() {
  const hour = getJST().getHours();
  if (hour >= 5 && hour < 9) return '朝の上げ潮';
  if (hour >= 9 && hour < 13) return '昼の満潮';
  if (hour >= 13 && hour < 17) return '午後の引き潮';
  if (hour >= 17 && hour < 21) return '夕方の干潮';
  return '夜の上げ潮';
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

// ---- 画像URL構築 --------------------------------------------
function buildImageUrl(folderPath, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const paddedIndex = String(index).padStart(2, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${folderPath}/${paddedIndex}.jpg`;
}

// 画像が実在するか＆サイズを事前確認
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
// Gemini
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

async function callGeminiWithImage(apiKey, imageBase64, textPrompt, maxTokens = 50) {
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
        maxOutputTokens: maxTokens,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Vision Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim();
}

// ============================================================
// 天気・海況
// ============================================================
async function getWeather(lat, lng) {
  try {
    const hourIndex = getCurrentHourIndex();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=weathercode,temperature_2m,windspeed_10m&timezone=Asia%2FTokyo&forecast_days=1`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      weather:   weatherCodeToText(data.hourly.weathercode[hourIndex]),
      temp:      Math.round(data.hourly.temperature_2m[hourIndex]),
      windSpeed: Math.round(data.hourly.windspeed_10m[hourIndex] * 10) / 10,
    };
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
    return { waveHeight: Math.round(data.hourly.wave_height[hourIndex] * 10) / 10 };
  } catch {
    return { waveHeight: 0.8 };
  }
}

// ============================================================
// 画像ローテーション
// ============================================================
async function getCurrentFolder() {
  const miyakoVal   = await redis.get(`${ACCOUNT}_miyakojima`) ?? -1;
  const ishigakiVal = await redis.get(`${ACCOUNT}_ishigaki`)   ?? -1;
  const total = (parseInt(miyakoVal) + 1) + (parseInt(ishigakiVal) + 1);
  const block = Math.floor(total / 6) % 2;
  const folderKey = block === 0 ? 'miyakojima' : 'ishigaki';
  console.log(`📁 total=${total} block=${block} → ${folderKey}`);
  return folderKey;
}

async function getNextImageIndex(folderKey) {
  const kvKey  = `${ACCOUNT}_${folderKey}`;
  const folder = FOLDERS[folderKey];
  let current  = await redis.get(kvKey);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % folder.count;
  return { next, kvKey };
}

// ============================================================
// キャプション生成
// ============================================================
async function detectThemeAndOpening(apiKey, imageUrl, locationJa, weatherInfo, imageSize) {
  const fallback = {
    themeInfo: THEME_INFO['other'][locationJa],
    opening:   `${locationJa}の光が静かに海へ溶けていく`,
  };

  // 巨大画像はVisionに送らない（タイムアウト防止）
  if (imageSize > MAX_VISION_BYTES) {
    console.log(`⚠️ 画像が大きいためVisionをスキップ (${Math.round(imageSize / 1024 / 1024)}MB)`);
    return fallback;
  }

  try {
    const base64 = await imageUrlToBase64(imageUrl);
    const raw = await callGeminiWithImage(
      apiKey,
      base64,
      `この写真について2つ答えてください。必ず以下のフォーマットで返してください。

THEME: [beach / star / diving / flower_buffalo / sunset / other のいずれか1つ]
OPENING: [${locationJa}の情景と感情が伝わる詩的な一行、20〜35文字、句読点なし、絵文字なし、感嘆詞禁止、疑問文禁止]

天気の参考情報：${weatherInfo.weather}`,
      120
    );

    console.log('🎨 Raw vision response:', raw);

    const themeMatch   = raw.match(/THEME:\s*(\S+)/i);
    const openingMatch = raw.match(/OPENING:\s*(.+)/i);

    const themeRaw  = themeMatch   ? themeMatch[1].toLowerCase().trim() : 'other';
    const opening   = openingMatch ? openingMatch[1].trim()             : fallback.opening;
    const key       = Object.keys(THEME_INFO).find(k => themeRaw.includes(k)) || 'other';
    const themeInfo = THEME_INFO[key][locationJa] || THEME_INFO['other'][locationJa];

    console.log(`🎨 Theme: ${key} / Opening: ${opening}`);
    return { themeInfo, opening };

  } catch (e) {
    console.error('detectThemeAndOpening failed:', e.message);
    return fallback;
  }
}

async function generateCaption(folder, weatherInfo, marineInfo, subWeatherInfo, imageUrl, imageSize) {
  const dateStr  = getDateString();
  const monthDay = getMonthDayString();
  const subLocJa = folder.locationJa === '宮古島' ? '石垣島' : '宮古島';

  const { themeInfo, opening } = await detectThemeAndOpening(
    process.env.GEMINI_API_KEY, imageUrl, folder.locationJa, weatherInfo, imageSize
  );

  const weatherBlock = `${monthDay}朝6時の${folder.locationJa}：${weatherInfo.weather}、気温${weatherInfo.temp}℃
服装アドバイス：天気・気温に合った具体的なアドバイスを1文で書く`;

  const marineBlock = `🌊 波の高さ：${waveHeightToText(marineInfo.waveHeight)}
💨 風の強さ：${windSpeedToText(weatherInfo.windSpeed)}
🌀 潮の状況：${getTideInfo()}`;

  const footer = `───────────
📸 Camera: Sony a7R5 / iPhone 17
📍 ${folder.location}
🗓 ${dateStr}（投稿日、過去画像）

フォロー → @motion.imaging
サブ → @jake_images_
💾 保存して後で見返してね
お仕事依頼はプロフィールから
───────────`;

  const prompt = `以下のフォーマットに従って、Instagramのキャプションを完成させてください。
【ルール】
- [本文]の部分だけ新しく書く（100文字程度、${folder.theme}の魅力を自然な文体で）
- わざとらしい疑問文や「え、〜」で始めない
- 毎回違う内容にする
- [本文]以外はそのまま出力する（変更禁止）
- ハッシュタグは厳選5個のみ（増やさない）
- 余計な説明文は不要、キャプション本文のみ返す

【出力フォーマット】
${opening}

☀️ 今日の${folder.locationJa}情報
${weatherBlock}

🌊 海況リアルタイムレポート
${marineBlock}

📌 ${themeInfo}

[本文をここに書く]

${footer}

☀️ ${subLocJa}の天気：${subWeatherInfo.weather}、気温${subWeatherInfo.temp}℃

${FIXED_COMMENT}

#[タグ1] #[タグ2] #[タグ3] #[タグ4] #[タグ5]`;

  return await callGemini(process.env.GEMINI_API_KEY, prompt);
}

// ============================================================
// Threads投稿（500字制限・ベストエフォート）
// ============================================================
function buildThreadsText(fullCaption) {
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
  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  // 1) コンテナ作成
  const c = await metaFetch(`${IG_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
  });
  if (c.json && c.json.error) {
    throw new Error(formatMetaError('Container Error', c.status, c.json));
  }
  const creationId = c.json.id;
  if (!creationId) {
    throw new Error(`Container Error: idが返りません ${JSON.stringify(c.json).slice(0, 300)}`);
  }

  // 2) 処理完了を待つ
  await waitForContainer(creationId, accessToken);

  // 3) 公開（失敗時は5秒待って2回までリトライ）
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const p = await metaFetch(`${IG_BASE}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
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
// メインハンドラ
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
  const todayKey = 'ig_motion_posted_date';
  const debug    = { account: '@motion.imaging', apiVersion: IG_API_VERSION, steps: [] };
  const step = (name, detail) => {
    debug.steps.push(detail ? `${name}: ${detail}` : name);
    console.log(`▶ ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    // ---- 0) 環境変数チェック ----
    requireEnv([
      'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'GEMINI_API_KEY',
      'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID',
      'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME',
    ]);
    step('環境変数チェック', 'OK');

    // ---- 1) トークン検証 ----
    const me = await verifyToken(process.env.INSTAGRAM_ACCESS_TOKEN);
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
        const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
        const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
        const m = await metaFetch(
          `${IG_BASE}/${igAccountId}/media?fields=timestamp&limit=1&access_token=${encodeURIComponent(accessToken)}`
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

    // ---- 4) 画像とデータの準備 ----
    const folderKey = await getCurrentFolder();
    const folder    = FOLDERS[folderKey];
    const subKey    = folderKey === 'miyakojima' ? 'ishigaki' : 'miyakojima';
    const subFolder = FOLDERS[subKey];
    step('フォルダ選択', folderKey);

    const { next, kvKey } = await getNextImageIndex(folderKey);
    const imageIndex = next + 1;
    const imageUrl   = buildImageUrl(folder.path, imageIndex);
    debug.imageUrl = imageUrl;

    const { size } = await checkImage(imageUrl);
    step('画像確認', `${imageUrl} (${Math.round(size / 1024)}KB)`);

    const [weatherInfo, marineInfo, subWeatherInfo] = await Promise.all([
      getWeather(folder.lat, folder.lng),
      getMarineInfo(folder.lat, folder.lng),
      getWeather(subFolder.lat, subFolder.lng),
    ]);
    step('天気取得', weatherInfo.weather);

    // ---- 5) キャプション生成 ----
    const caption = await generateCaption(
      folder, weatherInfo, marineInfo, subWeatherInfo, imageUrl, size
    );
    step('キャプション生成', `${caption.length}文字`);

    // ---- 6) Instagram投稿 ----
    const postId = await postToInstagram(imageUrl, caption);
    step('Instagram投稿', `成功 postId=${postId}`);

    // ---- 7) 成功後にフラグとインデックスを確定 ----
    await redis.set(todayKey, today, { ex: 82800 });
    await redis.set(kvKey, next);
    step('Redis更新', `${kvKey}=${next}`);

    console.log(`✅ motion.imaging posted: ${folderKey} ${String(imageIndex).padStart(2, '0')}.jpg`);

    // ---- 8) Threads（ベストエフォート） ----
    let threadsId = null;
    try {
      threadsId = await postToThreads(process.env.THREADS_MOTION_TOKEN, imageUrl, buildThreadsText(caption));
      if (threadsId) step('Threads投稿', `成功 ${threadsId}`);
    } catch (e) {
      step('Threads投稿', '失敗（IGには影響なし）: ' + e.message);
    }

    return new Response(JSON.stringify({
      message: 'Success',
      folder: folderKey,
      imageIndex,
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
