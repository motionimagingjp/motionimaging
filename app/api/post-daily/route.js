// app/api/post-daily/route.js
// 雲海指数・富士山指数（21:15 JST）
// ============================================================
// 2026-09-12 修正版
//  1. 富士山指数の「0%表示」の原因を修正。
//     旧実装は Math.max(10, ...) をフォールバック値にしか適用しておらず、
//     Geminiが返した生の値には下限処理がかかっていなかった。
//     → parsed/fallback 問わず必ず10〜100にclampする処理を追加。
//  2. 「雲海80%なのにメモは発生困難」という矛盾を修正。
//     旧実装はスコアとメモをGeminiが独立に生成しており整合性チェックが
//     なかった。平均スコアの帯とメモの語感が矛盾する場合、
//     コード側で決定的に生成したメモへ差し替える安全弁を追加。
//  3. プロンプト例示の具体的数値(80,70,55 / 90,85,75)を削除し、
//     Geminiの丸写し（花畑指数と同型の事故）を防止。
//  4. weightedLength()によるX文字数チェックを追加（未実装だった）。
//  5. リトライ・重複403ハンドリング、?key=/?dry=1/?force=1/?report=1、
//     富士山指数への画像添付（雲海用の写真は未整備のため対象外）を追加。
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const X_LIMIT = 280;
const X_TARGET = 272;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// Xの重み付き文字数
// ============================================================
function weightedLength(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  const stripped = text.replace(urlRegex, '');
  let total = urls.length * 23;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    const isWeight1 =
      (cp >= 0x0000 && cp <= 0x10ff) ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    total += isWeight1 ? 1 : 2;
  }
  return total;
}

function clipWeighted(str, maxWeight) {
  str = String(str);
  if (weightedLength(str) <= maxWeight) return str;
  let out = '', w = 0;
  for (const ch of str) {
    const cw = weightedLength(ch);
    if (w + cw > maxWeight - 1) break;
    out += ch; w += cw;
  }
  return out.trim() + '…';
}

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function getDateStringJST() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getFullYear()}/${String(jst.getMonth() + 1).padStart(2, '0')}/${String(jst.getDate()).padStart(2, '0')}`;
}

async function getNightWeather() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&hourly=weathercode,temperature_2m&timezone=Asia%2FTokyo&forecast_days=2';
    const res = await fetch(url);
    const data = await res.json();
    const hours = data.hourly.time;
    const codes = data.hourly.weathercode;
    const temps = data.hourly.temperature_2m;
    const nightIndices = hours.map((t, i) => ({ t, i })).filter(({ t }, idx) => {
      const d = new Date(t);
      const h = d.getHours();
      return (h >= 21 && idx < 24) || (h <= 4 && idx >= 24);
    }).map(({ i }) => i);
    const worstCode = Math.max(...nightIndices.map(i => codes[i]));
    const minTemp   = Math.min(...nightIndices.map(i => temps[i]));
    let weather, penalty;
    if (worstCode === 0)      { weather = '快晴';     penalty = 0;  }
    else if (worstCode <= 2)  { weather = '晴れ';     penalty = 0;  }
    else if (worstCode <= 3)  { weather = '曇り';     penalty = 10; }
    else if (worstCode <= 49) { weather = '霧';       penalty = 20; }
    else if (worstCode <= 67) { weather = '雨';       penalty = 30; }
    else if (worstCode <= 69) { weather = '大雨';     penalty = 40; }
    else if (worstCode <= 79) { weather = '雪';       penalty = 40; }
    else if (worstCode <= 84) { weather = 'にわか雨'; penalty = 20; }
    else                      { weather = '荒天';     penalty = 50; }
    return { weather, penalty, min: Math.round(minTemp) };
  } catch {
    return { weather: '晴れ', penalty: 0, min: '--' };
  }
}

function safeParseJson(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 例示の丸写し検出
function looksLikeEchoedExample(spots, banned) {
  if (!Array.isArray(spots) || spots.length === 0) return true;
  let hit = 0;
  for (let i = 0; i < spots.length && i < banned.length; i++) {
    if (Number(spots[i].score) === banned[i]) hit++;
  }
  return hit >= Math.min(2, banned.length);
}

// スコアと日本語メモの語感が矛盾していないか検査する。
// 「雲海指数80%なのにメモは発生困難」という事故の再発防止。
// 矛盾を検出したら、平均スコアの帯に沿った決定的なメモへ差し替える。
// 「期待薄」に「期待」が部分文字列として含まれるなど、単純な語の
// 部分一致では誤判定するため、否定語は複合語も含めて具体的に列挙し、
// 肯定語は誤って否定語を打ち消さない語だけを採用する。
const NEGATIVE_PHRASES = ['難しい', '困難', '期待薄', '厳しい', '見込みは低', '発生しない', '望めない', '見られない'];
const POSITIVE_PHRASES = ['チャンス', '絶好', 'おすすめ', '見頃', '狙い目', '期待できます', '期待大'];

function memoContradictsScore(avgScore, memo) {
  const hasNegative = NEGATIVE_PHRASES.some(p => memo.includes(p));
  const hasPositive = POSITIVE_PHRASES.some(p => memo.includes(p));
  if (avgScore >= 60 && hasNegative && !hasPositive) return true;
  if (avgScore < 35 && hasPositive && !hasNegative) return true;
  return false;
}

function buildFallbackMemo(avgScore, kind) {
  const label = kind === 'cloud' ? '雲海' : '富士山';
  if (avgScore >= 70) return `絶好の${label}コンディションが期待できます。`;
  if (avgScore >= 45) return `条件次第で${label}が見られるかもしれません。`;
  return `今回は${label}の撮影は厳しい見通しです。`;
}

// ============================================================
// Gemini
// ============================================================
async function callGemini(apiKey, prompt, maxTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens || 300, thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim();
}

// ============================================================
// 共通：スポット3件形式のツイート生成（雲海／富士山で共有）
// ============================================================
async function buildSpotTweet(opts) {
  const { apiKey, dateLabel, weather, penalty, min, kind, title, emoji, hashtag,
          fallbackSpots, exampleSpots, defaultTime, diag } = opts;

  const prompt = `明日早朝の${title}スポット3件のミゴロン指数を算出してください。\n`
    + '日付：' + dateLabel + '\n'
    + '今夜〜明朝の天気：' + weather + '（最低気温' + min + '℃）\n'
    + '天気による指数補正：' + penalty + '%を差し引くこと。\n'
    + `条件：${kind === 'cloud' ? '実在する日本の山・高原3件' : '富士山周辺の実在する場所3件'}\n`
    + '【重要】スコアは天気補正を反映して必ず自分で計算すること。例示の数値をそのまま使わないこと。\n'
    + 'スコアは整数（10〜100）。\n'
    + 'スポット名は都道府県名を含めて10文字以内で簡潔に（例：高ボッチ高原(長野)）。\n'
    + 'memoはスコアの傾向と矛盾しない内容で20文字以内。\n\n'
    + '次のスキーマのJSONのみで返答（マークダウン不要）：\n'
    + `{"spots":[{"name":"<10文字以内のスポット名>","emoji":"${emoji}","score":<整数>}],"time":"<最適時間帯>","memo":"<20文字以内のコメント>"}`;

  let parsed = null;
  try {
    const raw = await callGemini(apiKey, prompt);
    parsed = safeParseJson(raw);
  } catch { parsed = null; }

  let spots, time, memo;
  if (parsed && Array.isArray(parsed.spots) && parsed.spots.length > 0
      && !looksLikeEchoedExample(parsed.spots, exampleSpots.map(s => s.score))) {
    spots = parsed.spots.filter(s => s && s.name && typeof s.score !== 'undefined');
    time  = parsed.time || defaultTime;
    memo  = parsed.memo || buildFallbackMemo(60, kind);
    diag.source = 'Gemini';
  } else {
    spots = [];
  }

  if (spots.length === 0) {
    spots = fallbackSpots.map(s => ({ name: s.name, emoji: s.emoji, score: Math.max(10, s.score - penalty) }));
    time = defaultTime;
    diag.source = diag.source || 'フォールバック（Gemini失敗）';
    diag.memoSource = 'fallback';
  }

  // ★ スコアの下限処理を「必ず」適用する（Gemini値・フォールバック値どちらにも）
  //   旧実装はここが抜けており、Geminiが低い値や0を返すとそのまま
  //   0%表示になっていた（富士山指数の事故の直接原因）。
  spots = spots.map(s => ({
    name: s.name,
    emoji: s.emoji || emoji,
    score: Math.max(10, Math.min(100, Math.round(Number(s.score) || 10))),
  }));

  const ranked = spots.slice().sort((a, b) => b.score - a.score);
  const avgScore = Math.round(ranked.reduce((sum, s) => sum + s.score, 0) / ranked.length);

  // ★ スコアとメモの矛盾チェック（雲海80%なのに「発生困難」事故の再発防止）
  if (!memo || memoContradictsScore(avgScore, memo)) {
    if (diag.memoSource !== 'fallback' && memo) diag.memoOverridden = `矛盾検出のため上書き: "${memo}"`;
    memo = buildFallbackMemo(avgScore, kind);
  }

  const build = (nameW, memoW) => {
    let t = `${title}指数【` + dateLabel + '】\n';
    for (const s of ranked) t += s.emoji + ' ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '⏰' + time + 'がベスト\n';
    t += hashtag;
    return t;
  };

  // スポット3件・メモ1件という少ない要素数のため余裕がある。
  // Geminiへの指示（名前10文字以内=重み20、メモ20文字以内=重み40）を
  // 上回る余裕を持たせた予算にする。旧予算(16/30等)は実際の文字数より
  // 小さすぎ、余裕があるのに不必要に途中で切れる不具合があったため修正。
  const plans = [[24, 44], [20, 36], [16, 26], [13, 16], [11, 0]];
  for (const [nameW, memoW] of plans) {
    const t = build(nameW, memoW);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  return clipWeighted(build(9, 0), X_LIMIT);
}

async function buildCloudSeaTweet(apiKey, dateLabel, weather, penalty, min, diag) {
  return buildSpotTweet({
    apiKey, dateLabel, weather, penalty, min, diag,
    kind: 'cloud', title: '雲海', emoji: '☁️', hashtag: '#雲海予報 #絶景 #ミゴロン',
    defaultTime: '4:00〜6:00',
    exampleSpots: [{ score: 80 }, { score: 70 }, { score: 55 }],
    fallbackSpots: [
      { name: '高ボッチ高原（長野）',     emoji: '☁️', score: 80 },
      { name: '山中湖パノラマ台（山梨）', emoji: '☁️', score: 70 },
      { name: '秩父美の山公園（埼玉）',   emoji: '☁️', score: 55 },
    ],
  });
}

async function buildFujisanTweet(apiKey, dateLabel, weather, penalty, min, diag) {
  return buildSpotTweet({
    apiKey, dateLabel, weather, penalty, min, diag,
    kind: 'fuji', title: '富士山', emoji: '🗻', hashtag: '#富士山 #風景写真 #ミゴロン',
    defaultTime: '5:00〜7:00',
    exampleSpots: [{ score: 90 }, { score: 85 }, { score: 75 }],
    fallbackSpots: [
      { name: '新道峠（山梨）',           emoji: '🗻', score: 90 },
      { name: '田貫湖（静岡）',           emoji: '🗻', score: 85 },
      { name: '山中湖パノラマ台（山梨）', emoji: '🗻', score: 75 },
    ],
  });
}

// ============================================================
// 画像：富士山カテゴリのローテーション添付（雲海用の写真は未整備）
// ============================================================
// ファイル名は「接頭辞（漢字）+ 5桁連番」の実物に合わせる: 富士00101.jpg〜
const IMAGE_CATEGORIES = {
  fuji: { count: parseInt(process.env.FUJI_IMAGE_COUNT || '11'), startNum: 101, prefix: '富士' },
};

function buildPhotoUrl(category, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const cat    = IMAGE_CATEGORIES[category];
  const num    = String(cat.startNum + index).padStart(5, '0');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/app/api/post-images/${category}/${cat.prefix}${num}.jpg`;
}

async function getNextPhotoIndex(category) {
  const cat = IMAGE_CATEGORIES[category];
  const key = `x_photo_idx_${category}`;
  let current = await redis.get(key);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % cat.count;
  return { next, key };
}

async function uploadPhotoToX(xClient, category, index) {
  // 診断のため失敗理由を { mediaId, error, sizeMB } の形で返す
  try {
    const url = buildPhotoUrl(category, index);
    const res = await fetch(url);
    if (!res.ok) {
      return { mediaId: null, error: `GitHub画像取得失敗 [HTTP ${res.status}] ${url}` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    try {
      const mediaId = await xClient.v1.uploadMedia(buffer, { mimeType: 'image/jpeg' });
      return { mediaId, error: null, sizeMB };
    } catch (uploadErr) {
      return { mediaId: null, error: `X画像アップロード失敗(${sizeMB}MB): ${uploadErr.message}`, sizeMB };
    }
  } catch (e) {
    return { mediaId: null, error: `画像取得/変換エラー: ${e.message}` };
  }
}

// ============================================================
// X投稿（リトライ・重複403ハンドリング）
// ============================================================
function isDuplicateError(err) {
  const msg = ((err && err.message) || '') + ' ' + JSON.stringify((err && err.data) || {});
  return /duplicate/i.test(msg) || (err && err.code === 403);
}

async function tweetWithRetry(xClient, text, attempts = 3, mediaId = null) {
  let lastErr = null;
  const options = mediaId ? { media: { media_ids: [mediaId] } } : {};
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await xClient.v2.tweet(text, options);
      return { ok: true, id: res && res.data ? res.data.id : null, attempts: i };
    } catch (err) {
      lastErr = err;
      if (isDuplicateError(err)) return { ok: false, duplicate: true, error: err, attempts: i };
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  return { ok: false, duplicate: false, error: lastErr, attempts };
}

function describeXError(err, text, attempts) {
  const detail = err && err.data ? JSON.stringify(err.data).slice(0, 300) : '';
  return 'error: ' + (err && err.message ? err.message : String(err))
    + (detail ? ' | detail: ' + detail : '')
    + ' | w:' + weightedLength(text) + ' | attempts:' + attempts;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} タイムアウト(${ms}ms)`)), ms)),
  ]);
}

async function postTextToThreads(token, text) {
  if (!token) return null;
  const meRes = await fetch('https://graph.threads.net/v1.0/me?fields=id&access_token=' + token);
  const me = await meRes.json();
  if (me.error) throw new Error('Threads me: ' + me.error.message);
  const cRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token }),
  });
  const c = await cRes.json();
  if (c.error) throw new Error('Threads container: ' + c.error.message);
  await new Promise(r => setTimeout(r, 2000));
  const pRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads_publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: token }),
  });
  const p = await pRes.json();
  if (p.error) throw new Error('Threads publish: ' + p.error.message);
  return p.id;
}

// ============================================================
// メインハンドラ
// ============================================================
export async function GET(request) {
  const url = new URL(request.url);
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) return new Response('Unauthorized', { status: 401 });

  if (url.searchParams.get('report') === '1') {
    try {
      const saved = await redis.get('last_daily_report');
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      return new Response(JSON.stringify({ lastReport: parsed }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun  = url.searchParams.get('dry') === '1';
  const force   = url.searchParams.get('force') === '1';
  const noImage = url.searchParams.get('noimage') === '1';
  const skipList = (url.searchParams.get('skip') || '').split(',').filter(Boolean);
  const today    = new Date(Date.now() + 9 * 3600000);
  const todayStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

  const t0 = Date.now();
  const report = { x: {}, threads: {}, startedAt: new Date().toISOString() };

  try {
    const API_KEY   = process.env.GEMINI_API_KEY;
    const dateLabel = getTomorrowLabel();
    const { weather, penalty, min } = await getNightWeather();
    report.weather = weather;

    const cloudDiag = {};
    const fujiDiag  = {};
    const cloudSeaTweet = await buildCloudSeaTweet(API_KEY, dateLabel, weather, penalty, min, cloudDiag);
    const fujisanTweet  = await buildFujisanTweet(API_KEY, dateLabel, weather, penalty, min, fujiDiag);

    report.lengths = {
      cloud_sea: weightedLength(cloudSeaTweet),
      fujisan:   weightedLength(fujisanTweet),
      limit: X_LIMIT,
    };
    report.sources = { cloud_sea: cloudDiag, fujisan: fujiDiag };

    if (dryRun) {
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweets: {
          cloud_sea: { weighted: weightedLength(cloudSeaTweet), text: cloudSeaTweet, diag: cloudDiag },
          fujisan:   { weighted: weightedLength(fujisanTweet),  text: fujisanTweet,  diag: fujiDiag },
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    if (!force) {
      const lastPosted = await redis.get('daily_posted_date');
      if (lastPosted === todayStr) {
        report.result = '本日投稿済みのためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
    }

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    // 富士山指数にのみ画像を添付（雲海用の写真は未整備）
    const IMAGE_MAP = { fujisan: 'fuji' };

    const entries = [
      ['cloud_sea', cloudSeaTweet],
      ['fujisan',   fujisanTweet],
    ];

    for (let idx = 0; idx < entries.length; idx++) {
      const [key, text] = entries[idx];
      if (skipList.includes(key)) { report.x[key] = 'skipped'; continue; }

      let mediaId = null, photoMeta = null;
      const category = IMAGE_MAP[key];
      if (category && !noImage) {
        const { next, key: photoKey } = await getNextPhotoIndex(category);
        const up = await uploadPhotoToX(xClient, category, next);
        mediaId = up.mediaId;
        photoMeta = { category, index: next, photoKey, uploaded: !!mediaId };
        const catInfo = IMAGE_CATEGORIES[category];
        const shownName = `${catInfo.prefix}${String(catInfo.startNum + next).padStart(5, '0')}.jpg`;
        report[`${key}_image`] = mediaId
          ? `添付成功 (${category}/${shownName}, ${up.sizeMB}MB)`
          : `添付失敗: ${up.error} (${category}/${shownName})`;
      }

      const r = await tweetWithRetry(xClient, text, 3, mediaId);
      if (r.ok) {
        report.x[key] = 'ok (w:' + weightedLength(text) + (r.attempts > 1 ? `, ${r.attempts}回目で成功` : '') + ')';
        if (photoMeta && photoMeta.uploaded) await redis.set(photoMeta.photoKey, photoMeta.index);
      } else if (r.duplicate) {
        report.x[key] = '重複のため投稿されず';
      } else {
        report.x[key] = describeXError(r.error, text, r.attempts);
      }

      try {
        await withTimeout(postTextToThreads(process.env.THREADS_MOTION_TOKEN, text), 60000, 'Threads');
        report.threads[key] = 'ok';
      } catch (te) {
        report.threads[key] = 'error: ' + te.message;
      }

      if (idx < entries.length - 1) await new Promise(r2 => setTimeout(r2, 10000));
    }

    await redis.set('daily_posted_date', todayStr, { ex: 82800 });

    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_daily_report', JSON.stringify(report)); } catch {}

    return new Response(JSON.stringify({ message: 'Done', date: dateLabel, weather, report }, null, 2), { status: 200, headers: jsonHeaders });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_daily_report', JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
