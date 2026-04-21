export const runtime = 'nodejs';
export const maxDuration = 60;

// ── スポット定義 ──────────────────────────────────────────
const CLOUD_SEA_SPOTS = [
  { name: '高ボッチ高原', lat: 36.1198, lon: 137.9208 },
  { name: '美ヶ原',       lat: 36.0952, lon: 138.0438 },
  { name: '車山高原',     lat: 36.1065, lon: 138.1948 },
  { name: '竜ヶ岳',       lat: 35.3795, lon: 138.5547 },
  { name: '雲取山',       lat: 35.8538, lon: 138.9443 },
  { name: '大台ヶ原',     lat: 34.1838, lon: 136.1028 },
];

const FUJISAN_SPOTS = [
  { name: '河口湖畔',   lat: 35.5115, lon: 138.7640 },
  { name: '山中湖',     lat: 35.4108, lon: 138.8668 },
  { name: '本栖湖',     lat: 35.4656, lon: 138.6004 },
  { name: '田貫湖',     lat: 35.3606, lon: 138.5747 },
  { name: '朝霧高原',   lat: 35.3820, lon: 138.5735 },
  { name: '忍野八海',   lat: 35.4582, lon: 138.8208 },
];

// ── 気象データ取得（Open-Meteo） ──────────────────────────
async function fetchWeather(spot) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,precipitation_probability&forecast_days=2&timezone=Asia%2FTokyo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`気象取得失敗: ${spot.name}`);
  return res.json();
}

// ── スコアリング ──────────────────────────────────────────
function scoreSpot(spot, weather, type) {
  const h = weather.hourly;
  const dawn = { start: 28, end: 32 }; // 明日4〜8時（24+4〜24+8）

  const slice = (arr) => arr.slice(dawn.start, dawn.end);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

  const tempMin   = Math.min(...slice(h.temperature_2m));
  const humidity  = avg(slice(h.relative_humidity_2m));
  const windSpeed = avg(slice(h.wind_speed_10m));
  const cloudCover= avg(slice(h.cloud_cover));
  const rainProb  = avg(h.precipitation_probability.slice(24, 48));

  let score = 0;
  let reason = '';

  if (type === 'cloud_sea') {
    score += humidity  > 80 ? 30 : humidity  > 60 ? 15 : 0;
    score += tempMin   < 10 ? 25 : tempMin   < 15 ? 15 : 5;
    score += windSpeed < 3  ? 20 : windSpeed < 6  ? 10 : 0;
    score += rainProb  < 20 ? 25 : rainProb  < 40 ? 10 : 0;
    reason = `湿度${Math.round(humidity)}%・最低${tempMin.toFixed(1)}℃・風${windSpeed.toFixed(1)}m/s`;
  } else {
    score += cloudCover < 20 ? 40 : cloudCover < 40 ? 20 : 0;
    score += windSpeed  < 5  ? 20 : windSpeed  < 10 ? 10 : 0;
    score += rainProb   < 10 ? 30 : rainProb   < 30 ? 15 : 0;
    score += tempMin    < 15 ? 10 : 5;
    reason = `雲量${Math.round(cloudCover)}%・降水確率${Math.round(rainProb)}%・風${windSpeed.toFixed(1)}m/s`;
  }

  return { ...spot, score, reason };
}

// ── 上位N件を取得 ─────────────────────────────────────────
async function getTopSpots(spots, type, topN) {
  const results = await Promise.all(
    spots.map(async (spot) => {
      try {
        const weather = await fetchWeather(spot);
        return scoreSpot(spot, weather, type);
      } catch {
        return { ...spot, score: 0, reason: 'データ取得失敗' };
      }
    })
  );
  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

// ── 花データ（Phase 1: モック / Phase 2: 自社API） ────────
async function getFlowerSpots() {
  // Phase 2でここを自社APIに切り替える
  // const res = await fetch('https://motionimaging.vercel.app/api/flowers');
  // return res.json();
  return [
    { name: '高遠城址公園', prefecture: '長野県', flower: 'コヒガンザクラ', status: '満開',   score: 95, access: 'JR伊那市駅からバス30分' },
    { name: 'ひたち海浜公園', prefecture: '茨城県', flower: 'ネモフィラ',     status: '見頃',   score: 92, access: 'JR勝田駅からバス15分' },
    { name: '吉野山',         prefecture: '奈良県', flower: 'ヤマザクラ',     status: '見頃',   score: 88, access: '近鉄吉野駅から徒歩' },
    { name: '芝桜の丘',       prefecture: '埼玉県', flower: '芝桜',           status: '満開',   score: 85, access: '西武芝桜駅から徒歩5分' },
  ];
}

// ── Geminiで投稿文生成 ─────────────────────────────────────
async function generatePost(type, spots, dateLabel) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const spotText = spots.map((s, i) => {
    if (type === 'flower') {
      return `${i + 1}. ${s.name}（${s.prefecture}）${s.flower} ${s.status} アクセス：${s.access}`;
    } else if (type === 'cloud_sea') {
      return `${i + 1}. ${s.name} スコア${s.score} ${s.reason}`;
    } else {
      return `${i + 1}. ${s.name} スコア${s.score} ${s.reason}`;
    }
  }).join('\n');

  const prompts = {
    flower: `あなたはプロカメラマン向けSNS運用者です。X（Twitter）投稿文を作成してください。
ルール：140文字以内・絵文字使用・ハッシュタグ3〜5個を最後に・改行で読みやすく
文脈：「${dateLabel}に行くべき花スポット4選」
要件：プロカメラマン視点のフォトインサイト（機材・構図）を1つ含める
スポット情報：
${spotText}
投稿文のみ出力（説明不要）`,

    cloud_sea: `あなたはプロカメラマン向けSNS運用者です。X（Twitter）投稿文を作成してください。
ルール：140文字以内・絵文字使用・ハッシュタグ3〜5個を最後に・改行で読みやすく
文脈：「${dateLabel}の雲海撮影予報」
要件：撮影成功確率をスコアから算出して「成功率XX%」の形式で含める・ゴールデンタイム（4〜6時）を明記
スポット情報：
${spotText}
投稿文のみ出力（説明不要）`,

    fujisan: `あなたはプロカメラマン向けSNS運用者です。X（Twitter）投稿文を作成してください。
ルール：140文字以内・絵文字使用・ハッシュタグ3〜5個を最後に・改行で読みやすく
文脈：「${dateLabel}の富士山ビュースポット予報」
要件：スコアに基づく星評価（⭐〜⭐⭐⭐⭐⭐）・最良撮影時間帯を含める
スポット情報：
${spotText}
投稿文のみ出力（説明不要）`,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompts[type] }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini エラー(${type}): ${res.status}`);

  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts || [])
    .filter(p => typeof p.text === 'string')
    .map(p => p.text)
    .join('')
    .trim();
}

// ── Imagen で画像生成 ──────────────────────────────────────
async function generateImage(type, spotName) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

  const subjects = {
    flower:    `cherry blossoms in full bloom at ${spotName}, pink petals falling gently`,
    cloud_sea: `sea of clouds filling the valley at dawn, golden sunrise, misty mountain peaks at ${spotName}`,
    fujisan:   `Mount Fuji reflected in calm lake at sunrise, pink sky, ${spotName} lakeside`,
  };

  const prompt = `${subjects[type]}, pastel watercolor illustration, soft colors, dreamy atmosphere, Japanese landscape, no text, no people, cinematic composition`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1', personGeneration: 'dont_allow' },
    }),
  });

  if (!res.ok) throw new Error(`Imagen エラー(${type}): ${res.status}`);

  const data = await res.json();
  const base64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!base64) throw new Error(`Imagen: 画像データなし(${type})`);
  return Buffer.from(base64, 'base64');
}

// ── OAuth 1.0a 署名（外部ライブラリなし） ─────────────────
import crypto from 'crypto';

function oauthSign(method, url, params, creds) {
  const enc = (s) => encodeURIComponent(String(s))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');

  const oauthParams = {
    oauth_consumer_key:     creds.apiKey,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            creds.accessToken,
    oauth_version:          '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const base = `${method}&${enc(url)}&${enc(
    Object.keys(allParams).sort().map(k => `${enc(k)}=${enc(allParams[k])}`).join('&')
  )}`;
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  return 'OAuth ' + Object.keys(oauthParams)
    .map(k => `${enc(k)}="${enc(oauthParams[k])}"`)
    .join(', ');
}

// ── X: メディアアップロード ────────────────────────────────
async function uploadMedia(imageBuffer, creds) {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const body = new URLSearchParams({ media_data: imageBuffer.toString('base64') });
  const header = oauthSign('POST', url, {}, creds);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: header, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`メディアアップロード失敗: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.media_id_string;
}

// ── X: ツイート投稿 ───────────────────────────────────────
async function postTweet(text, imageBuffer, creds) {
  const mediaId = await uploadMedia(imageBuffer, creds);
  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const header = oauthSign('POST', tweetUrl, {}, creds);

  const res = await fetch(tweetUrl, {
    method: 'POST',
    headers: { Authorization: header, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ツイート失敗: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.data?.id;
}

// ── メインハンドラ ─────────────────────────────────────────
export async function GET(request) {
  // Cron認証
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GEMINI_API_KEY が未設定' }, { status: 500 });

  const creds = {
    apiKey:      process.env.X_API_KEY,
    apiSecret:   process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret:process.env.X_ACCESS_SECRET,
  };
  if (!creds.apiKey) return Response.json({ error: 'X API Key が未設定' }, { status: 500 });

  // 明日の日付（JST）
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  const dateLabel = `${jst.getMonth() + 1}月${jst.getDate()}日`;

  const results = {};

  try {
    // ── データ取得（並列） ─────────────────────────────────
    const [cloudSeaSpots, fujisanSpots, flowerSpots] = await Promise.all([
      getTopSpots(CLOUD_SEA_SPOTS, 'cloud_sea', 4),
      getTopSpots(FUJISAN_SPOTS,   'fujisan',   4),
      getFlowerSpots(),
    ]);

    // ── 投稿文＆画像生成（並列） ───────────────────────────
    const [flowerPost, cloudSeaPost, fujisanPost, flowerImg, cloudSeaImg, fujisanImg] =
      await Promise.all([
        generatePost('flower',    flowerSpots,   dateLabel),
        generatePost('cloud_sea', cloudSeaSpots, dateLabel),
        generatePost('fujisan',   fujisanSpots,  dateLabel),
        generateImage('flower',    flowerSpots[0]?.name ?? ''),
        generateImage('cloud_sea', cloudSeaSpots[0]?.name ?? ''),
        generateImage('fujisan',   fujisanSpots[0]?.name ?? ''),
      ]);

    // ── X投稿（直列：レート制限対策） ─────────────────────
    for (const [type, text, img] of [
      ['flower',    flowerPost,    flowerImg],
      ['cloud_sea', cloudSeaPost,  cloudSeaImg],
      ['fujisan',   fujisanPost,   fujisanImg],
    ]) {
      try {
        const tweetId = await postTweet(text, img, creds);
        results[type] = { ok: true, tweetId, text };
      } catch (err) {
        results[type] = { ok: false, error: err.message };
      }
      // 1秒待機（レート制限対策）
      await new Promise(r => setTimeout(r, 1000));
    }

    return Response.json({ success: true, date: dateLabel, results });

  } catch (error) {
    console.error('[post-daily] Error:', error);
    return Response.json({ error: error.message || '予期しないエラー' }, { status: 500 });
  }
}
