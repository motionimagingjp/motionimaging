// app/api/post-instagram/route.js
import { Redis } from '@upstash/redis';
import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const xClient = new TwitterApi({
  appKey:       process.env.X_API_KEY,
  appSecret:    process.env.X_API_SECRET,
  accessToken:  process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
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

async function getTokyoWeather() {
  try {
    // forecast_days=2で当日の最高気温予測を確実に取得
    const url = `https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&daily=temperature_2m_max&timezone=Asia%2FTokyo&forecast_days=2`;
    const res = await fetch(url);
    const data = await res.json();
    const hourIndex = getCurrentHourIndex();
    const code    = data.hourly.weathercode[hourIndex];
    // daily[0]が今日の最高気温
    const maxTemp = Math.round(data.daily.temperature_2m_max[0]);
    const weather = weatherCodeToText(code);
    return { weather, maxTemp };
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

function getMotionThemeInfo(theme, locationJa) {
  const info = {
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
  const themeKey = Object.keys(info).find(k => theme.includes(k)) || 'other';
  return info[themeKey][locationJa] || info['other'][locationJa];
}

function getJakeThemeInfo(theme) {
  const info = {
    sakura: '🌸 桜とポートレート：日本の春の象徴・桜と人物の組み合わせは儚さと美しさが重なる特別な瞬間。満開の桜の下での撮影は一期一会。',
    kimono: '👘 着物ポートレート：日本の伝統美を纏った姿は街並みと溶け合うとき特別な空気が生まれる。和の美しさを次世代へ。',
    beach:  '🏖 ビーチポートレート：沖縄の透き通る海と人物の組み合わせ。太陽の光が肌を照らし風が髪をなびかせる自然体の美しさ。',
    star:   '🌟 星空ポートレート：満天の星空の下でのポートレートは宇宙と人間の対比が生む圧倒的なスケール感。沖縄の澄んだ夜空だからこそ撮れる一枚。',
    flower: '🌺 フラワーポートレート：南国の花々に囲まれた美しさ。ブーゲンビリアやハイビスカスの鮮やかな色彩が人物の魅力を引き立てる。',
    street: '🏙 ストリートポートレート：街の空気と人物が混ざり合う瞬間を切り取る。日常の中に潜む美しさを探して。',
    school: '🎒 学生ポートレート：あどけなさの中に宿る目の奥の輝き。その瞬間にしかない純粋さと可能性を、ファインダー越しに切り取った一枚。ぜひ目を見てほしい。',
    studio: '📸 スタジオポートレート：光を完全にコントロールした環境で引き出すその人だけの表情と個性。',
    other:  '📷 ポートレートの魅力：その人だけが持つ表情、空気感、存在感。カメラを通して引き出す瞬間の美しさ。',
  };
  const themeKey = Object.keys(info).find(k => theme.includes(k)) || 'other';
  return info[themeKey];
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
    count: parseInt(process.env.ISHIGAKI_IMAGE_COUNT || '12'),
    theme: '石垣島・離島のビーチ',
    location: 'Ishigaki & Remote Islands, Okinawa Japan',
    locationJa: '石垣島',
    lat: 24.3448,
    lng: 124.1572,
  },
};

async function getThisWeekFolder() {
  const SWITCH_EVERY = 6;
  const counterKey = 'ig_motion_imaging_folder_counter';
  let counter = await redis.get(counterKey);
  if (counter === null || counter === undefined) counter = 0;
  counter = parseInt(counter);
  const folderIndex = Math.floor(counter / SWITCH_EVERY) % 2;
  await redis.set(counterKey, counter + 1);
  return folderIndex === 0 ? 'miyakojima' : 'ishigaki';
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
  const paddedIndex = String(index).padStart(2, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-instagram/images/${folderPath}/${paddedIndex}.jpg`;
}

async function generateCaption(apiKey, folder, weatherInfo, marineInfo, imageUrl, subWeatherInfo) {
  const dateStr  = getDateString();
  const monthDay = getMonthDayString();
  const { weather, temp, windSpeed } = weatherInfo;
  const { waveHeight } = marineInfo;
  const tide = getTideInfo();

  const tokyoWeather = await getTokyoWeather();

  let themeInfo = getMotionThemeInfo('other', folder.locationJa);
  try {
    const base64 = await imageUrlToBase64(imageUrl);
    const theme = await callGeminiWithImage(
      apiKey,
      base64,
      `これは${folder.locationJa}で撮影された写真です。以下の選択肢から最も当てはまるテーマを1つだけ答えてください。選択肢以外の言葉は不要です。\n選択肢: beach, star, diving, flower_buffalo, sunset, other`
    );
    console.log('🎨 Motion theme:', theme);
    themeInfo = getMotionThemeInfo(theme, folder.locationJa);
  } catch (e) {
    console.error('Theme detection failed:', e.message);
  }

  const subLocationJa = folder.locationJa === '宮古島' ? '石垣島' : '宮古島';
  const subWeatherBlock = `☀️ ${subLocationJa}の天気：${subWeatherInfo.weather}、気温${subWeatherInfo.temp}℃`;

  const weatherBlock = `${monthDay}朝6時の${folder.locationJa}：${weather}、気温${temp}℃
服装アドバイス：天気・気温に合った具体的なアドバイスを1文で書く`;

  const marineBlock = `🌊 波の高さ：${waveHeightToText(waveHeight)}
💨 風の強さ：${windSpeedToText(windSpeed)}
🌀 潮の状況：${tide}`;

  const footer = `───────────
📸 Camera: Sony a7R5 / iPhone 17
📍 ${folder.location}
🗓 ${dateStr}（投稿日、過去画像）

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
- [本文]以外はそのまま出力する（変更禁止）
- ハッシュタグは厳選5個のみ（増やさない）
- 余計な説明文は不要、キャプション本文のみ返す

【出力フォーマット】
おはようございます。今日の東京は${tokyoWeather.weather}、最高気温${tokyoWeather.maxTemp}度です。

☀️ 今日の${folder.locationJa}情報
${weatherBlock}

🌊 海況リアルタイムレポート
${marineBlock}

📌 ${themeInfo}

[本文をここに書く]

${footer}

${subWeatherBlock}

${FIXED_COMMENT}

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
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
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
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    }
  );
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error('Publish Error: ' + publishData.error.message);

  return publishData.id;
}

function buildInstagramUrl(postId) {
  return `https://www.instagram.com/p/${postId}/`;
}

async function postToX(folder, instagramUrl) {
  const tags = folder.locationJa === '宮古島'
    ? '#宮古島 #ビーチ #絶景'
    : '#石垣島 #離島 #ビーチ';
  const tweet = `新しい写真を投稿しました📸✨\n${folder.locationJa}の絶景ビーチ、今日の海況もチェック🌊\n\n${instagramUrl}\n\n${tags}`;
  await xClient.v2.tweet(tweet);
}

// ============================================================
// @jake_images_ 投稿ブロック
// ============================================================

const JAKE_CSV_COLS = {
  filename: 'FileName',
  fstop:    'FNumber',
  shutter:  'ExposureTime',
  iso:      'ISO',
  lens:     'LensModel',
  location: 'location',
};

const JAKE_REDIS_KEY   = 'ig_jake_images_portrait';
const JAKE_IMAGE_COUNT = parseInt(process.env.JAKE_IMAGE_COUNT || '20');
const JAKE_FOLDER_PATH = 'ig_jake_images/portrait';

async function fetchJakeExifCSV() {
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

async function postJakeImages() {
  let current = await redis.get(JAKE_REDIS_KEY);
  if (current === null || current === undefined) current = -1;
  const nextIndex = (parseInt(current) + 1) % JAKE_IMAGE_COUNT;
  const imageNum  = String(nextIndex + 1).padStart(2, '0');

  const imageUrl = buildImageUrl(JAKE_FOLDER_PATH, nextIndex + 1);

  const rows  = await fetchJakeExifCSV();
  const exif  = rows.find(r => (r[JAKE_CSV_COLS.filename] || '') === `${imageNum}.jpg`) || {};
  const fstop   = exif[JAKE_CSV_COLS.fstop]   || '?';
  const shutter = exif[JAKE_CSV_COLS.shutter] || '?';
  const iso     = exif[JAKE_CSV_COLS.iso]      || '?';
  const lens    = exif[JAKE_CSV_COLS.lens]     || '';
  const loc     = exif[JAKE_CSV_COLS.location] || 'Japan';

  let jakeThemeInfo = getJakeThemeInfo('other');
  try {
    const base64 = await imageUrlToBase64(imageUrl);
    const theme = await callGeminiWithImage(
      process.env.GEMINI_API_KEY,
      base64,
      'これはポートレート写真です。以下の選択肢から最も当てはまるテーマを1つだけ答えてください。選択肢以外の言葉は不要です。\n選択肢: sakura, kimono, beach, star, flower, street, school, studio, other'
    );
    console.log('🎨 Jake theme:', theme);

    if (theme.includes('flower') || theme.includes('sakura')) {
      const flowerPrompt = `このポートレート写真に写っている花は何ですか？花の名前を日本語で答えてください（例：桜、ブーゲンビリア、向日葵、紫陽花、ポピー、チューリップなど）。花が特定できない場合は「花」と答えてください。1〜3語で答えてください。`;
      const flowerName = await callGeminiWithImage(process.env.GEMINI_API_KEY, base64, flowerPrompt);
      console.log('🌸 Flower type:', flowerName);
      const flowerInfoPrompt = `ポートレート写真に${flowerName}が写っています。${flowerName}とポートレート撮影の魅力について、インスタグラムのキャプション用に2〜3文で日本語で書いてください。絵文字を1つ使って始めてください。`;
      jakeThemeInfo = await callGemini(process.env.GEMINI_API_KEY, flowerInfoPrompt);
      console.log('🌸 Flower info:', jakeThemeInfo);
    } else {
      jakeThemeInfo = getJakeThemeInfo(theme);
    }
  } catch (e) {
    console.error('Jake theme detection failed:', e.message);
  }

  const dateStr = getDateString();
  const prompt  = `あなたはプロのポートレートフォトグラファーです。
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

📌 ${jakeThemeInfo}

📍 ${loc}
🗓 ${dateStr}（投稿日、過去画像）
フォロー → @jake_images_
サブ → @motion.imaging
お仕事はプロフィールから

${FIXED_COMMENT}

#ポートレート #portrait #portraitphotography #日本 #ソニー`;

  const caption = await callGemini(process.env.GEMINI_API_KEY, prompt);

  const igId    = process.env.JAKE_IMAGES_ACCOUNT_ID;
  const igToken = process.env.JAKE_IMAGES_ACCESS_TOKEN;

  const cRes = await fetch(`https://graph.instagram.com/v19.0/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: igToken })
  });
  const cData = await cRes.json();
  if (cData.error) throw new Error('Jake Container Error: ' + cData.error.message);

  await new Promise(r => setTimeout(r, 3000));

  const pRes = await fetch(`https://graph.instagram.com/v19.0/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: cData.id, access_token: igToken })
  });
  const pData = await pRes.json();
  if (pData.error) throw new Error('Jake Publish Error: ' + pData.error.message);

  await redis.set(JAKE_REDIS_KEY, nextIndex);

  return { success: true, imageNumber: imageNum, postId: pData.id, caption };
}

// ============================================================
// メインハンドラー
// ============================================================

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const folderKey = await getThisWeekFolder();
    const folder = FOLDERS[folderKey];
    const subFolderKey = folderKey === 'miyakojima' ? 'ishigaki' : 'miyakojima';
    const subFolder = FOLDERS[subFolderKey];

    const [weatherInfo, marineInfo, subWeatherInfo] = await Promise.all([
      getWeather(folder.lat, folder.lng),
      getMarineInfo(folder.lat, folder.lng),
      getWeather(subFolder.lat, subFolder.lng),
    ]);

    const imageIndex = await getNextImageIndex(folderKey, folder.count);
    const imageUrl = buildImageUrl(folder.path, imageIndex);
    const caption = await generateCaption(process.env.GEMINI_API_KEY, folder, weatherInfo, marineInfo, imageUrl, subWeatherInfo);

    const postId = await postToInstagram(imageUrl, caption);
    const instagramUrl = buildInstagramUrl(postId);
    await postToX(folder, instagramUrl);

    let jakeResult = null;
    try {
      jakeResult = await postJakeImages();
      console.log('✅ jake_images_ posted:', jakeResult?.imageNumber);
    } catch (err) {
      console.error('❌ jake_images_ failed:', err.message);
    }

    return new Response(JSON.stringify({
      message: 'Success',
      theme: folder.theme,
      imageUrl,
      caption,
      instagramPostId: postId,
      instagramUrl,
      jakeImages: jakeResult,
    }), { status: 200 });

  } catch (error) {
    console.error('ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
