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
//     富士山指数への画像添付を追加。
//
// 2026-09-15 追加：雲海指数にも画像添付を追加。取り急ぎ4枚
//   （app/api/post-images/cloud/雲海001.jpg〜雲海004.jpg）を用意。
//   富士山は5桁連番だが雲海は3桁連番のため、IMAGE_CATEGORIESに
//   カテゴリごとのpad桁数を持たせて両対応にした。
//
// 2026-10-15 改善指示書P1対応：
//   スコアをGeminiの出力そのものから、src/app/api/_lib/migoron-scoring.js
//   によるOpen-Meteo連動のコード計算に変更。スポットも固定座標リスト
//   （CLOUD_SPOTS/FUJI_SPOTS）に変更し、Geminiが実在しない/季節外れの
//   スポットを選ぶ余地をなくした。Geminiにはスコア・天気を渡してメモ文
//   のみを書かせる（星空指数と同じ設計）。スコア上限は95に固定（100%は
//   出さない）。
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';
import { recordJobStatus } from '../../../lib/job-status';
import { computeCloudAndFujiScores, CLOUD_SPOTS, FUJI_SPOTS, currentSeasonJST, seasonalIndices } from '../_lib/migoron-scoring';
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

// スコアと日本語メモの語感が矛盾していないか検査する。
// 「雲海指数80%なのにメモは発生困難」という事故の再発防止。
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
// Gemini（メモ文のみ生成。スコアは渡すだけで変更させない）
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

async function buildMemo(apiKey, kind, title, ranked, avgScore, defaultTime) {
  let memo = null;
  try {
    const prompt = `明日早朝の${title}のコンディションを一言でまとめてください。\n`
      + '算出済みの指数：' + ranked.map(s => `${s.name}=${s.score}%`).join('、') + '\n'
      + '【重要】上記の指数と矛盾しない内容にすること。数値を変更・追加しないこと。\n'
      + '20文字以内の日本語1文のみを出力（JSONやマークダウン不要）。';
    const raw = await callGemini(apiKey, prompt, 100);
    if (raw) memo = raw.replace(/\n/g, '').replace(/^["'`]|["'`]$/g, '').trim();
  } catch { memo = null; }

  if (!memo || memoContradictsScore(avgScore, memo)) {
    memo = buildFallbackMemo(avgScore, kind);
  }
  return memo;
}

function buildTweetText(title, dateLabel, ranked, memo, time, hashtag) {
  const build = (nameW, memoW) => {
    let t = `${title}指数【` + dateLabel + '】\n';
    for (const s of ranked) t += s.emoji + ' ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '⏰' + time + 'がベスト\n';
    t += hashtag;
    return t;
  };
  const plans = [[24, 44], [20, 36], [16, 26], [13, 16], [11, 0]];
  for (const [nameW, memoW] of plans) {
    const t = build(nameW, memoW);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  return clipWeighted(build(9, 0), X_LIMIT);
}

// ============================================================
// 画像：富士山・雲海カテゴリのローテーション添付
// ============================================================
// ファイル名は「接頭辞（漢字）+ ゼロ埋め連番 + 拡張子」の実物に合わせる。
// 富士山は5桁・小文字.jpg（富士山00101.jpg〜）、雲海は4桁・大文字.JPG
// （雲海0001.JPG〜、2026-09-16に11枚へ拡充）とpad桁数・拡張子の大小が
// 異なるため、カテゴリごとにpad/extを持たせる（未指定時はpad5・.jpg）。
// GitHubのraw URLは大文字小文字を区別するため、実ファイル名と拡張子の
// 大小を必ず一致させること（ls等で実物を確認してから変更する）。
const IMAGE_CATEGORIES = {
  fuji:  { count: parseInt(process.env.FUJI_IMAGE_COUNT  || '11'), startNum: 101, prefix: '富士山', pad: 5, ext: '.jpg' },
  cloud: { count: parseInt(process.env.CLOUD_IMAGE_COUNT || '11'), startNum: 1, prefix: '雲海',   pad: 4, ext: '.JPG' },
};

function buildPhotoUrl(category, index) {
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const cat    = IMAGE_CATEGORIES[category];
  const num    = String(cat.startNum + index).padStart(cat.pad || 5, '0');
  // 画像の実体は src/app/api/post-images/ 配下。リポジトリ構成を変えたら
  // このパスも必ず合わせること（2026-09-24にapp/→src/app/へ移動した際、
  // ここが旧パスのまま残り全カテゴリの画像添付が無言で404になった）。
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/src/app/api/post-images/${category}/${cat.prefix}${num}${cat.ext || '.jpg'}`;
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
  let claimedToday = false;

  try {
    // ★ 重複投稿バグの修正（2026-09-14）
    //   旧実装は「redis.getで確認→投稿→最後にredis.setでフラグを立てる」
    //   という check-then-act 構造で、確認とフラグ確定の間に
    //   Gemini生成・画像アップロード・2件の投稿・Threads投稿と
    //   数十秒かかっていた。この間にcronが二重に起動すると、両方とも
    //   「未投稿」と判定して雲海指数が2回投稿される事故が発生していた
    //   （9/13夜、内容の異なる雲海指数が2本投稿された）。
    //   → dry run以外は投稿処理を始める前に SET NX で原子的に
    //     「今日の枠」を予約し、二重起動があっても片方は即座に
    //     スキップされるようにする（dry runは投稿しないので対象外）。
    if (!dryRun && !force) {
      const claimed = await redis.set('daily_posted_date', todayStr, { nx: true, ex: 82800 });
      if (claimed === null) {
        report.result = '本日投稿済み、または同時実行のためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
      claimedToday = true;
    }

    const API_KEY   = process.env.GEMINI_API_KEY;
    const dateLabel = getTomorrowLabel();

    // ★ スコアはOpen-Meteo連動でコード側が決定的に算出する
    //  （migoron-scoring.js）。Geminiにはスコアを渡さず、算出結果を
    //   渡してメモ文だけを書かせる。
    let cloudScores, fujiScores, scoreSource = 'open-meteo';
    try {
      ({ cloudScores, fujiScores } = await computeCloudAndFujiScores());
    } catch (e) {
      // Open-Meteo自体が落ちた場合のみ、固定の中間スコアにフォールバックする
      scoreSource = 'フォールバック（Open-Meteo取得失敗: ' + e.message + '）';
      cloudScores = CLOUD_SPOTS.map(s => ({ ...s, score: 50, ok: false }));
      fujiScores  = FUJI_SPOTS.map(s => ({ ...s, score: 50, ok: false }));
    }

    const cloudRanked = cloudScores.slice().sort((a, b) => b.score - a.score);
    const fujiRanked  = fujiScores.slice().sort((a, b) => b.score - a.score);
    const cloudAvg = Math.round(cloudRanked.reduce((s, x) => s + x.score, 0) / cloudRanked.length);
    const fujiAvg  = Math.round(fujiRanked.reduce((s, x) => s + x.score, 0) / fujiRanked.length);

    const cloudMemo = await buildMemo(API_KEY, 'cloud', '雲海', cloudRanked, cloudAvg, '4:00〜6:00');
    const fujiMemo  = await buildMemo(API_KEY, 'fuji', '富士山', fujiRanked, fujiAvg, '5:00〜7:00');

    const cloudSeaTweet = buildTweetText('雲海', dateLabel, cloudRanked, cloudMemo, '4:00〜6:00', '#雲海予報 #絶景 #ミゴロン');
    const fujisanTweet  = buildTweetText('富士山', dateLabel, fujiRanked, fujiMemo, '5:00〜7:00', '#富士山 #風景写真 #ミゴロン');

    report.lengths = {
      cloud_sea: weightedLength(cloudSeaTweet),
      fujisan:   weightedLength(fujisanTweet),
      limit: X_LIMIT,
    };
    report.sources = { cloud_sea: scoreSource, fujisan: scoreSource };

    if (dryRun) {
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweets: {
          cloud_sea: { weighted: weightedLength(cloudSeaTweet), text: cloudSeaTweet, scores: cloudScores },
          fujisan:   { weighted: weightedLength(fujisanTweet),  text: fujisanTweet,  scores: fujiScores },
        },
        scoreSource,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    // 富士山指数・雲海指数それぞれに対応カテゴリの画像を添付
    const IMAGE_MAP = { fujisan: 'fuji', cloud_sea: 'cloud' };

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
        const shownName = `${catInfo.prefix}${String(catInfo.startNum + next).padStart(catInfo.pad || 5, '0')}${catInfo.ext || '.jpg'}`;
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

    // !forceの場合は冒頭のSET NXで既に予約済み。forceはNX予約をスキップしているので、
    // 同日中の通常cronによる再投稿を防ぐため、ここで（上書きで）フラグを立てる。
    if (force) {
      try { await redis.set('daily_posted_date', todayStr, { ex: 82800 }); } catch {}
    }

    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_daily_report', JSON.stringify(report)); } catch {}
    await recordJobStatus('x_daily', {
      main: { 'X 雲海指数': report.x.cloud_sea, 'X 富士山指数': report.x.fujisan },
      sub: {
        'Threads 雲海': report.threads.cloud_sea,
        'Threads 富士山': report.threads.fujisan,
        '画像 雲海': report.cloud_sea_image,
        '画像 富士山': report.fujisan_image,
      },
    });

    return new Response(JSON.stringify({ message: 'Done', date: dateLabel, report }, null, 2), { status: 200, headers: jsonHeaders });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    // 投稿完了前に致命的エラーで落ちた場合、予約したフラグを解放し
    // 当日中の再実行をブロックしたままにしない
    if (claimedToday) { try { await redis.del('daily_posted_date'); } catch {} }
    try { await redis.set('last_daily_report', JSON.stringify(report)); } catch {}
    await recordJobStatus('x_daily', { fatalError: error.message });
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
