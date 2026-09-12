// app/api/post-evening/route.js
// 今夜星指数予報（18:05 JST）
// ============================================================
// 2026-09-12 修正版
//  1. weightedLength()によるX文字数チェック未実装 → 追加（花畑指数と同じ地雷の予防）
//  2. プロンプト例示に具体的な数値(75,70,65,60,55)があり、Geminiが
//     そのままコピーして返す事故のリスク → 数値を消してスキーマのみ提示、
//     looksLikeEchoedExample()で丸写しを検出
//  3. スコアを整数に強制clamp（10〜100）。Geminiが返した生の値には
//     下限処理が一切かかっていなかった
//  4. リトライ・重複403のハンドリングを追加
//  5. ?key= / ?dry=1 / ?force=1 / ?report=1 の標準デバッグインターフェース追加
//  6. 星カテゴリの写真をローテーション添付（Upstash Redis管理）
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
// Xの重み付き文字数（Migoron全体で統一の実装）
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

// ============================================================
// 日付・月齢
// ============================================================
function getTodayLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function getMoonAge() {
  const now = new Date();
  const known = new Date('2000-01-06T18:14:00Z');
  const diff = (now - known) / (1000 * 60 * 60 * 24);
  return Math.floor(diff % 29.53);
}

function getMoonInfo(age) {
  if (age <= 3)  return { age, label: '新月直後', effect: '星空絶好調、指数+10%補正' };
  if (age <= 7)  return { age, label: '三日月', effect: '星空良好' };
  if (age <= 12) return { age, label: '上弦の月', effect: '月の影響やや出始め、指数-10%補正' };
  if (age <= 17) return { age, label: '満月前後', effect: '月明かり強く星空に不利、指数-20%補正' };
  if (age <= 22) return { age, label: '下弦の月', effect: '深夜以降は改善傾向' };
  return           { age, label: '晦日月', effect: '新月に向け星空回復中、指数+5%補正' };
}

// 安全なJSON抽出
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

// 例示の丸写し検出（花畑指数の事故と同型の対策）
function looksLikeEchoedExample(scores) {
  if (!Array.isArray(scores) || scores.length === 0) return true;
  const banned = [75, 70, 65, 60, 55]; // 旧プロンプトの例示値
  let hit = 0;
  for (let i = 0; i < scores.length && i < banned.length; i++) {
    if (Number(scores[i]) === banned[i]) hit++;
  }
  return hit >= 4;
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
      generationConfig: { temperature: 0.8, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim();
}

// ============================================================
// 星空ツイート本文の組み立て（スコア整数clamp・文字数保証つき）
// ============================================================
async function buildStarTweet(apiKey, dateLabel, moon, diag) {
  const spots = ['河口湖（山梨）', '爪木崎（静岡）', '大洗（茨城）', '三浦（神奈川）', '秩父（埼玉）'];

  const prompt = '月齢' + moon.age + '日（' + moon.label + '）の夜の星空指数を5スポット分算出してください。\n'
    + '月齢補正：' + moon.effect + '\n'
    + 'スポット：' + spots.join('、') + '\n'
    + '【重要】スコアは月齢補正と季節から必ず自分で計算すること。例示の数値をそのまま使わないこと。\n'
    + 'スコアは整数（10〜100）。memoは30文字以内でスコアの傾向と矛盾しない内容にすること。\n\n'
    + '次のスキーマのJSONのみで返答（マークダウン不要）：\n'
    + '{"scores":[<整数>,<整数>,<整数>,<整数>,<整数>],"memo":"<条件コメント>"}';

  let parsed = null;
  try {
    const raw = await callGemini(apiKey, prompt);
    parsed = safeParseJson(raw);
  } catch { parsed = null; }

  let scores, memo;
  if (parsed && Array.isArray(parsed.scores) && parsed.scores.length === spots.length && !looksLikeEchoedExample(parsed.scores)) {
    scores = parsed.scores;
    memo = parsed.memo || (moon.label + 'の夜、条件を確認してください。');
    diag.source = 'Gemini';
  } else {
    const base = moon.age <= 7 ? 80 : moon.age <= 17 ? 55 : 70;
    scores = [base, base - 5, base - 10, base - 15, base - 20];
    memo = moon.label + 'の夜、条件を確認してください。';
    diag.source = parsed ? 'echo検出→フォールバック' : 'フォールバック（Gemini失敗）';
  }

  // 整数・範囲clampを必ず適用（フォールバックだけでなくGemini値にも）
  scores = scores.map(s => Math.max(10, Math.min(100, Math.round(Number(s) || 10))));

  const ranked = spots
    .map((name, i) => ({ name, score: scores[i] }))
    .sort((a, b) => b.score - a.score);

  const build = (nameW, memoW) => {
    let t = '今夜星指数予報【' + dateLabel + '】\n';
    for (const s of ranked) t += '✨ ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '#星空撮影 #風景写真 #ミゴロン';
    return t;
  };

  const plans = [[30, 40], [26, 30], [22, 20], [22, 0], [18, 0]];
  for (const [nameW, memoW] of plans) {
    const t = build(nameW, memoW);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  return clipWeighted(build(14, 0), X_LIMIT);
}

// ============================================================
// 画像：星カテゴリのローテーション添付
// ============================================================
// ファイル名は「接頭辞（漢字）+ 5桁連番」の実物に合わせる: 星00301.jpg〜
const IMAGE_CATEGORIES = {
  star: { count: parseInt(process.env.STAR_IMAGE_COUNT || '8'), startNum: 301, prefix: '星' },
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
// X投稿（リトライ・重複403は再試行しない・画像対応）
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

function getDateStringJST() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getFullYear()}/${String(jst.getMonth() + 1).padStart(2, '0')}/${String(jst.getDate()).padStart(2, '0')}`;
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
      const saved = await redis.get('last_evening_report');
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      return new Response(JSON.stringify({ lastReport: parsed }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun   = url.searchParams.get('dry') === '1';
  const force    = url.searchParams.get('force') === '1';
  const noImage  = url.searchParams.get('noimage') === '1';
  const today    = getDateStringJST();
  const todayKey = 'evening_posted_date';

  const t0 = Date.now();
  const diag = {};
  const report = { startedAt: new Date().toISOString() };

  try {
    const dateLabel = getTodayLabel();
    const moon = getMoonInfo(getMoonAge());
    const tweet = await buildStarTweet(process.env.GEMINI_API_KEY, dateLabel, moon, diag);
    report.moonAge = moon;
    report.source = diag.source;
    report.weighted = weightedLength(tweet);

    if (dryRun) {
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweet, weighted: weightedLength(tweet), moon, source: diag.source,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    if (!force) {
      const lastPosted = await redis.get(todayKey);
      if (lastPosted === today) {
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

    // 星画像の添付
    let mediaId = null, photoMeta = null;
    if (!noImage) {
      const { next, key: photoKey } = await getNextPhotoIndex('star');
      const up = await uploadPhotoToX(xClient, 'star', next);
      mediaId = up.mediaId;
      photoMeta = { index: next, photoKey, uploaded: !!mediaId };
      const shownName = `${IMAGE_CATEGORIES.star.prefix}${String(IMAGE_CATEGORIES.star.startNum + next).padStart(5, '0')}.jpg`;
      report.image = mediaId ? `添付成功 (star/${shownName}, ${up.sizeMB}MB)` : `添付失敗: ${up.error} (star/${shownName})`;
    }

    const r = await tweetWithRetry(xClient, tweet, 3, mediaId);
    if (r.ok) {
      report.result = 'ok (w:' + weightedLength(tweet) + (r.attempts > 1 ? `, ${r.attempts}回目で成功` : '') + ')';
      report.tweetId = r.id;
      await redis.set(todayKey, today, { ex: 82800 });
      if (photoMeta && photoMeta.uploaded) await redis.set(photoMeta.photoKey, photoMeta.index);
    } else if (r.duplicate) {
      report.result = '重複のため投稿されず';
      await redis.set(todayKey, today, { ex: 82800 });
    } else {
      report.result = describeXError(r.error, tweet, r.attempts);
    }

    let threadsResult = 'skip';
    try {
      await withTimeout(postTextToThreads(process.env.THREADS_MOTION_TOKEN, tweet), 60000, 'Threads');
      threadsResult = 'ok';
    } catch (te) {
      threadsResult = 'error: ' + te.message;
    }
    report.threads = threadsResult;

    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_evening_report', JSON.stringify(report)); } catch {}

    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), { status: 200, headers: jsonHeaders });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_evening_report', JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
