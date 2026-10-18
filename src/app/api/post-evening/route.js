// app/api/post-evening/route.js
// 今夜星指数予報（18:05 JST）
// ============================================================
// 2026-09-12 修正版
//  1. weightedLength()によるX文字数チェック未実装 → 追加（花畑指数と同じ地雷の予防）
//  2. スコアを整数に強制clamp（10〜100）
//  3. リトライ・重複403のハンドリングを追加
//  4. ?key= / ?dry=1 / ?force=1 / ?report=1 の標準デバッグインターフェース追加
//  5. 星カテゴリの写真をローテーション添付（Upstash Redis管理）
//
// 2026-09-16 修正版
//  ★ 天気を指数に反映（最重要）
//    旧実装は天気を一切取得せず、月齢だけをGeminiに渡してスコアを
//    "想像"させていた。そのため全国的に雨だった9/16でも「秩父95%」
//    のような現実と真逆の指数が投稿されていた。
//    花畑指数・雲海指数は天気を取得して補正していたのに、星空指数だけ
//    この処理が丸ごと欠けていたのが原因。
//    → open-meteoで5スポットそれぞれの今夜19時〜翌3時の雲量・天気コードを
//      取得し、コード側で決定的にスコアを算出する方式へ変更。
//      Geminiにはメモ文のみを書かせ、スコアとの矛盾はコードで検出・上書きする。
//
// 2026-10-18 改善指示書P4/P5対応：
//   P4: 投稿した指数を予測ログ(lib/prediction-log.js)に保存し、翌日
//       /api/verify-predictions が答え合わせする。
//   P5: 1行目を結論型フック、見出しに「出現期待度」を付ける。
//
// 2026-10-15 改善指示書P1対応：
//   スコア算出ロジック（スポット座標・weatherCap・月齢補正）を
//   src/app/api/_lib/migoron-scoring.js に集約（雲海・富士山と共通化）。
//   湿度・降水確率による補正を追加し、スコア上限を100→95に変更
//   （「100%は出さない」要件）。
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';
import { recordJobStatus } from '../../../lib/job-status';
import { savePredictions } from '../../../lib/prediction-log';
import { STAR_SPOTS, moonAdjustment, computeStarScores, currentSeasonJST, seasonalIndices, jstDateString } from '../_lib/migoron-scoring';
import { buildHook, SCORE_LABELS } from '../_lib/migoron-format';
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

// スコアとメモの語感が矛盾していないか検査する（雲海指数と同型の安全弁）。
// 「雨なのに絶好の観測日和」のような矛盾をコード側で弾く。
const NEGATIVE_PHRASES = ['難しい', '困難', '期待薄', '厳しい', '見込みは低', '観測できません', '望めない', '見られない', '不向き'];
const POSITIVE_PHRASES = ['絶好', 'チャンス', 'おすすめ', '好条件', '狙い目', '期待できます', '期待大'];

function memoContradictsScore(bestScore, memo) {
  const hasNegative = NEGATIVE_PHRASES.some(p => memo.includes(p));
  const hasPositive = POSITIVE_PHRASES.some(p => memo.includes(p));
  if (bestScore >= 60 && hasNegative && !hasPositive) return true;
  if (bestScore < 35 && hasPositive && !hasNegative) return true;
  return false;
}

function buildFallbackMemo(bestScore, moon) {
  if (bestScore >= 70) return `${moon.label}で好条件。雲の様子を見つつ狙い目。`;
  if (bestScore >= 45) return `条件は半々。雲の切れ間次第です。`;
  return `今夜の星空観測は厳しい見通しです。`;
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
// 星空ツイート本文の組み立て（スコアはmigoron-scoring.jsで算出済み）
// ============================================================
async function buildStarTweet(apiKey, dateLabel, moon, diag) {
  const moonAdj = moonAdjustment(moon.age);

  let scored, source;
  try {
    scored = await computeStarScores(moonAdj);
    if (!scored.every(s => s.ok)) throw new Error('一部スポットの天気取得に失敗');
    source = '天気連動（open-meteo）';
    // 答え合わせ(P4)は天気連動で算出できた回だけ記録する
    diag.logItems = scored;
    diag.moonAdj = moonAdj;
  } catch (e) {
    // 天気取得に失敗した場合のみ月齢ベースにフォールバック
    const base = moon.age <= 7 ? 80 : moon.age <= 17 ? 55 : 70;
    scored = STAR_SPOTS.map((s, i) => ({
      ...s,
      score: Math.max(10, Math.min(95, [base, base - 5, base - 10, base - 15, base - 20][i] + moonAdj)),
    }));
    source = 'フォールバック（天気取得失敗・月齢のみ: ' + e.message + '）';
  }
  diag.source = source;
  diag.weather = scored.map(s => `${s.name}:${s.score}%` + (s.bestWindow ? `(${s.bestWindow}・雲量${s.cloudAvg}%)` : '')).join('、');

  const bestScore = Math.max(...scored.map(s => s.score));

  // メモだけGeminiに書かせる（実際のスコアを渡して矛盾を防ぐ）
  let memo = null;
  try {
    const prompt = '星空観測の今夜のコンディションを一言でまとめてください。\n'
      + '月齢：' + moon.age + '日（' + moon.label + '）\n'
      + '算出済みの星空指数：' + scored.map(s => `${s.name}=${s.score}%`).join('、') + '\n'
      + '【重要】上記の指数に矛盾しない内容にすること。数値は変更・追加しないこと。雨や曇りの傾向なら無理に前向きな表現をしないこと。\n'
      + '28文字以内の日本語1文のみを出力（JSONやマークダウン不要）。'
      + '「絶望」のような過度に悲観的な表現は避け、事実を淡々と伝えること。';
    const raw = await callGemini(apiKey, prompt);
    if (raw) memo = raw.replace(/\n/g, '').replace(/^["'`]|["'`]$/g, '').trim();
  } catch { memo = null; }

  if (!memo || memoContradictsScore(bestScore, memo)) {
    if (memo) diag.memoOverridden = `矛盾検出のため上書き: "${memo}"`;
    memo = buildFallbackMemo(bestScore, moon);
  } else if (weightedLength(memo) > 56) {
    // 28文字の指示を超えたメモは本文組み立て時に「…」で途中切れするため、
    // 文の途中で切らずに定型文に差し替える
    diag.memoOverridden = `文字数超過のため上書き: "${memo}"`;
    memo = buildFallbackMemo(bestScore, moon);
  }

  const ranked = scored.slice().sort((a, b) => b.score - a.score);

  const build = (nameW, memoW) => {
    let t = clipWeighted(buildHook('star', ranked), 48) + '\n';
    t += '今夜星指数予報【' + dateLabel + '】' + SCORE_LABELS.star + '\n';
    for (const s of ranked) t += '✨ ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '#星空撮影 #風景写真 #ミゴロン';
    return t;
  };

  // memoWは「重み付き」の上限なので、日本語N文字を収めるには 2N 必要。
  // 旧設定は先頭プランがmemoW=40（日本語20文字）しかなく、30文字程度の
  // メモが毎回「…」で途中切れしていた（実際のツイートは221/272で
  // 50文字分以上余っていた）。実測に合わせて先頭プランを広げる。
  const plans = [[30, 64], [30, 48], [26, 36], [22, 20], [22, 0], [18, 0]];
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
  // 画像の実体は src/app/api/post-images/ 配下（2026-09-24にapp/から移動）
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/src/app/api/post-images/${category}/${cat.prefix}${num}.jpg`;
}

// 改善指示書P3: 投稿月の季節に合う画像だけをローテーション対象にする
// （該当がなければ種別一致のみ＝全件にフォールバック）。
async function getNextPhotoIndex(category) {
  const cat = IMAGE_CATEGORIES[category];
  const candidates = seasonalIndices(category, cat.count, currentSeasonJST());
  const key = `x_photo_idx_${category}`;
  let current = await redis.get(key);
  current = (current === null || current === undefined) ? -1 : parseInt(current);
  const pos = candidates.indexOf(current);
  const next = candidates[(pos + 1) % candidates.length];
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
  let claimedToday = false;

  try {
    // ★ 重複投稿バグの修正（2026-09-14、post-dailyと同型の事故を予防）
    //   旧実装は「redis.getで確認→投稿→最後にredis.setでフラグを立てる」
    //   check-then-act 構造で、確認とフラグ確定の間にGemini生成・画像
    //   アップロード・X投稿・Threads投稿の時間差があった。この間にcronが
    //   二重に起動すると両方とも「未投稿」と判定してしまう（post-dailyで
    //   雲海指数が2回投稿される実害が発生済み）。
    //   → dry run以外は投稿処理を始める前に SET NX で原子的に
    //     「今日の枠」を予約する。
    if (!dryRun && !force) {
      const claimed = await redis.set(todayKey, today, { nx: true, ex: 82800 });
      if (claimed === null) {
        report.result = '本日投稿済み、または同時実行のためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
      claimedToday = true;
    }

    const dateLabel = getTodayLabel();
    const moon = getMoonInfo(getMoonAge());
    const tweet = await buildStarTweet(process.env.GEMINI_API_KEY, dateLabel, moon, diag);
    report.moonAge = moon;
    report.source = diag.source;
    report.weather = diag.weather || '(なし)';
    if (diag.memoOverridden) report.memoOverridden = diag.memoOverridden;
    report.weighted = weightedLength(tweet);

    if (dryRun) {
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweet, weighted: weightedLength(tweet), moon,
        source: diag.source,
        weather: diag.weather || '(なし)',
        memoOverridden: diag.memoOverridden || null,
      }, null, 2), { status: 200, headers: jsonHeaders });
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
      if (diag.logItems) {
        report.predictionLogged = await savePredictions('star', jstDateString(0), diag.logItems, { moonAdj: diag.moonAdj, moonAge: moon.age });
      }
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
    await recordJobStatus('x_evening', {
      main: { 'X 星空指数': report.result },
      sub:  { Threads: report.threads, 画像: report.image },
    });

    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), { status: 200, headers: jsonHeaders });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    // 投稿完了前に致命的エラーで落ちた場合、予約したフラグを解放し
    // 当日中の再実行をブロックしたままにしない
    if (claimedToday) { try { await redis.del(todayKey); } catch {} }
    try { await redis.set('last_evening_report', JSON.stringify(report)); } catch {}
    await recordJobStatus('x_evening', { fatalError: error.message });
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
