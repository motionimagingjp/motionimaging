// app/api/post-instagram/route.js
// @motion.imaging 専用 Instagram自動投稿
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

const ACCOUNT = 'ig_motion_imaging';

const FOLDERS = {
  miyakojima: {
    path: `${ACCOUNT}/miyakojima`,
    count: parseInt(process.env.MIYAKOJIMA_IMAGE_COUNT || '22'),
    location: 'Miyakojima Island, Okinawa Japan',
    locationJa: '宮古島',
    theme: '宮古島のビーチ',
    lat: 24.8056,
    lng: 125.2814,
  },
  ishigaki: {
    path: `${ACCOUNT}/ishigaki`,
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '12'),
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

function buildImageUrl(folderPath, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const paddedIndex = String(index).padStart(2, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${folderPath}/${paddedIndex}.jpg`;
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

async function getTokyoWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&timezone=Asia%2FTokyo&forecast_days=2`;
    const res = await fetch(url);
    const data = await res.json();
    const hourIndex = getCurrentHourIndex();
    const code    = data.hourly.weathercode[hourIndex];
    const todayTemps = data.hourly.temperature_2m.slice(0, 24);
    const maxTemp = Math.round(Math.max(...todayTemps));
    return { weather: weatherCodeToText(code), maxTemp };
  } catch {
    return { weather: '晴れ', maxTemp: 25 };
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
// ビジネスロジック
// ============================================================

// 6枚ごとに宮古島↔石垣島を切り替え
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
  await redis.set(kvKey, next);
  return next + 1;
}

async function detectTheme(apiKey, imageUrl, locationJa) {
  try {
    const base64 = await imageUrlToBase64(imageUrl);
    const theme  = await callGeminiWithImage(
      apiKey,
      base64,
      `これは${locationJa}で撮影された写真です。以下の選択肢から最も当てはまるテーマを1つだけ答えてください。選択肢以外の言葉は不要です。\n選択肢: beach, star, diving, flower_buffalo, sunset, other`
    );
    console.log('🎨 Theme:', theme);
    const key = Object.keys(THEME_INFO).find(k => theme.includes(k)) || 'other';
    return THEME_INFO[key][locationJa] || THEME_INFO['other'][locationJa];
  } catch (e) {
    console.error('Theme detection failed:', e.message);
    return THEME_INFO['other'][locationJa];
  }
}

async function generateCaption(folder, weatherInfo, marineInfo, subWeatherInfo, imageUrl) {
  const dateStr    = getDateString();
  const monthDay   = getMonthDayString();
  const tokyoWx    = await getTokyoWeather();
  const themeInfo  = await detectTheme(process.env.GEMINI_API_KEY, imageUrl, folder.locationJa);
  const subLocJa   = folder.locationJa === '宮古島' ? '石垣島' : '宮古島';

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
おはようございます。今日の東京は${tokyoWx.weather}、最高気温${tokyoWx.maxTemp}度です。

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

async function postToInstagram(imageUrl, caption) {
  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  const cRes = await fetch(
    `https://graph.instagram.com/v19.0/${igAccountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
    }
  );
  const cData = await cRes.json();
  if (cData.error) throw new Error('Container Error: ' + cData.error.message);

  await new Promise(r => setTimeout(r, 3000));

  const pRes = await fetch(
    `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: cData.id, access_token: accessToken }),
    }
  );
  const pData = await pRes.json();
  if (pData.error) throw new Error('Publish Error: ' + pData.error.message);

  return pData.id;
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
  const todayKey   = 'ig_motion_posted_date';
  const lastPosted = await redis.get(todayKey);

  if (lastPosted === today) {
    console.log('⚠️ Already posted today, skipping');
    return new Response(JSON.stringify({ message: '本日投稿済みのためスキップ' }), { status: 200 });
  }

  try {
    const folderKey = await getCurrentFolder();
    const folder    = FOLDERS[folderKey];
    const subKey    = folderKey === 'miyakojima' ? 'ishigaki' : 'miyakojima';
    const subFolder = FOLDERS[subKey];

    const [weatherInfo, marineInfo, subWeatherInfo] = await Promise.all([
      getWeather(folder.lat, folder.lng),
      getMarineInfo(folder.lat, folder.lng),
      getWeather(subFolder.lat, subFolder.lng),
    ]);

    const imageIndex = await getNextImageIndex(folderKey);
    const imageUrl   = buildImageUrl(folder.path, imageIndex);
    const caption    = await generateCaption(folder, weatherInfo, marineInfo, subWeatherInfo, imageUrl);
    const postId     = await postToInstagram(imageUrl, caption);

    // 投稿済み日付を保存（25時間で期限切れ）
    await redis.set(todayKey, today, { ex: 90000 });

    console.log(`✅ motion.imaging posted: ${folderKey} ${String(imageIndex).padStart(2,'0')}.jpg`);

    return new Response(JSON.stringify({
      message: 'Success',
      folder: folderKey,
      imageIndex,
      imageUrl,
      caption,
      postId,
    }), { status: 200 });

  } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
