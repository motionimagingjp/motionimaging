// app/api/post-morning-all/route.js
// 朝のX投稿（1本）＋Threads
// ============================================================
// 2026-07-24 改修版 v3
// 2026-09-13 英語版（Kanto Bloom Report）の投稿を廃止。日本語の
//            花畑指数・お出かけ開運指数の2本のみに変更。
// 2026-09-14 当日重複防止（SET NXによる原子的な予約）を追加。post-daily
//            で雲海指数が2回投稿された事故と同型の穴がこのファイルにも
//            あったため（そもそも当日重複チェック自体が無かった）。
// 2026-09-28 お出かけ開運指数の投稿を廃止。風景写真アカウントの世界観に
//            合わないため。花畑指数の1本のみに変更（六曜・選日計算も
//            使用箇所がなくなったため削除）。
//
//  ★ Xの「重み付き文字数」に対応
//    Xの280字制限は重み付きで、CJK（漢字・かな・全角記号）と絵文字は
//    1文字あたり2としてカウントされます。日本語は実質140字までです。
//    weightedLength() でXと同じ数え方を実装し、段階的短縮を適用する。
//
//  ※ Instagramは独立cron（/api/post-instagram、/api/post-jake-images）
//    このファイルからは呼びません。
//
// 2026-10-15 改善指示書P1対応：
//   スコアをGeminiの出力そのものから、src/app/api/_lib/migoron-scoring.js
//   によるOpen-Meteo連動のコード計算に変更。スポットも月別の固定候補
//   （FLOWER_SPOTS_BY_MONTH、緯度経度つき）から選ぶようにし、Geminiが
//   自由にスポット・スコアを生成する余地をなくした（季節外れスポットが
//   混入していた直接原因）。Geminiには算出済みスコア・天気を渡して
//   メモ文のみを書かせる。スコア上限は95に固定。
//   月単位の候補プールで「見頃期間」を代用しており、日単位の精密な
//   判定（spots.jsonのfrom/to）はP2で対応する。
//
//  クエリパラメータ
//    ?key=CRON_SECRET  … ブラウザから直接実行
//    ?report=1         … 前回の実行レポートを表示（投稿しない）
//    ?dry=1            … 投稿せず本文と重み付き文字数を確認（重複予約の対象外）
//    ?force=1          … 当日の重複チェックを無視して強制実行
//    ?skip=flower_ja,... … 個別スキップ
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';
import { recordJobStatus } from '../../../lib/job-status';
import { getFlowerSpotsForMonth, computeFlowerScores } from '../_lib/migoron-scoring';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const X_LIMIT = 280;      // Xの重み付き上限
const X_TARGET = 272;     // 余裕を見た目標値

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// Xの重み付き文字数（twitter-text と同じ規則）
//   重み1：U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, U+2032–U+2037
//   それ以外（CJK・全角記号・絵文字など）は重み2
//   URLは実際の長さに関わらず23
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
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = weightedLength(ch);
    if (w + cw > maxWeight - 1) break;
    out += ch;
    w += cw;
  }
  return out.trim() + '…';
}

// ============================================================
// 日付
// ============================================================
function getTodayLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

// スコアとメモの語感が矛盾していないか検査する（雲海・星空指数と同型の安全弁）
const NEGATIVE_PHRASES = ['難しい', '困難', '期待薄', '厳しい', '見込みは低', '見頃を過ぎ', '望めない', '見られない'];
const POSITIVE_PHRASES = ['見頃', 'おすすめ', '満開', '狙い目', '期待できます', '期待大'];

function memoContradictsScore(avgScore, memo) {
  const hasNegative = NEGATIVE_PHRASES.some(p => memo.includes(p));
  const hasPositive = POSITIVE_PHRASES.some(p => memo.includes(p));
  if (avgScore >= 60 && hasNegative && !hasPositive) return true;
  if (avgScore < 35 && hasPositive && !hasNegative) return true;
  return false;
}

function buildFallbackMemo(avgScore, weatherJA) {
  if (avgScore >= 70) return `${weatherJA}の一日、見頃の花をチェック。`;
  if (avgScore >= 45) return `${weatherJA}。見頃はもう少し先か終盤の花も。`;
  return `${weatherJA}の影響で、今回は見頃がやや控えめです。`;
}

// ============================================================
// Gemini（メモ文のみ生成）
// ============================================================
async function callGemini(apiKey, prompt, maxTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: maxTokens || 300,
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

async function buildMemo(apiKey, ranked, avgScore, weatherJA) {
  let memo = null;
  try {
    const prompt = '今日の花畑のコンディションを一言でまとめてください。\n'
      + '算出済みの指数：' + ranked.map(s => `${s.name}=${s.score}%`).join('、') + '\n'
      + '今日の天気：' + weatherJA + '\n'
      + '【重要】上記の指数と天気に矛盾しない内容にすること。数値は変更・追加しないこと。\n'
      + '20文字以内の日本語1文のみを出力（JSONやマークダウン不要）。';
    const raw = await callGemini(apiKey, prompt, 100);
    if (raw) memo = raw.replace(/\n/g, '').replace(/^["'`]|["'`]$/g, '').trim();
  } catch { memo = null; }

  if (!memo || memoContradictsScore(avgScore, memo)) {
    memo = buildFallbackMemo(avgScore, weatherJA);
  }
  return memo;
}

// ============================================================
// 花畑指数（日本語）— 重み付きで必ず280以内に収める
// ============================================================
function buildFlowerTweetText(dateLabel, ranked, memo) {
  const build = (nameW, memoW, count) => {
    let t = '花畑指数【' + dateLabel + '】\n';
    for (const s of ranked.slice(0, count)) {
      const emoji = s.emoji || '🌸';
      t += emoji + ' ' + clipWeighted(s.name, nameW) + '(' + s.score + '%)\n';
    }
    if (memoW > 0) t += 'ミゴロンメモ：' + clipWeighted(memo, memoW) + '\n';
    t += '#花撮影 #風景写真 #ミゴロン';
    return t;
  };

  // 段階的に削りながら、最初に収まったものを採用
  const plans = [
    [30, 44, 3], [26, 36, 3], [24, 28, 3],
    [22, 20, 3], [22,  0, 3], [20,  0, 3],
    [18,  0, 2],
  ];
  for (const [nameW, memoW, count] of plans) {
    const t = build(nameW, memoW, count);
    if (weightedLength(t) <= X_TARGET) return t;
  }
  // 最終手段：最小構成をさらに強制的に切り詰める
  return clipWeighted(build(16, 0, 2), X_LIMIT);
}

// ============================================================
// Threads（テキスト・ベストエフォート・タイムアウト付き）
// ============================================================
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

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} タイムアウト(${ms}ms)`)), ms)),
  ]);
}

// ============================================================
// X投稿（リトライ付き・重複403は再試行しない）
// ============================================================
function isDuplicateError(err) {
  const msg = ((err && err.message) || '') + ' ' + JSON.stringify((err && err.data) || {});
  return /duplicate/i.test(msg) || (err && err.code === 403);
}

// mediaId を渡すと画像付きで投稿する。画像アップロード自体は事前に
// 済ませておき、ここでは media_ids をツイート本文に添えるだけ。
async function tweetWithRetry(xClient, text, attempts = 3, mediaId = null) {
  let lastErr = null;
  const options = mediaId ? { media: { media_ids: [mediaId] } } : {};
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await xClient.v2.tweet(text, options);
      return { ok: true, id: res && res.data ? res.data.id : null, attempts: i };
    } catch (err) {
      lastErr = err;
      if (isDuplicateError(err)) {
        return { ok: false, duplicate: true, error: err, attempts: i };
      }
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  return { ok: false, duplicate: false, error: lastErr, attempts };
}

function describeXError(err, text, attempts) {
  const detail = err && err.data ? JSON.stringify(err.data).slice(0, 300) : '';
  return 'error: ' + (err && err.message ? err.message : String(err))
    + (detail ? ' | detail: ' + detail : '')
    + ' | w:' + weightedLength(text)
    + ' | attempts:' + attempts;
}

// ============================================================
// X投稿への画像添付
//  Instagram側と同じ「連番フォルダ + Redisローテーション」方式。
//  スポット名と写真の厳密な一致は求めない（写真の枚数に対して
//  スポット候補数の方が多いため）。カテゴリ単位で順番に使い回す。
// ============================================================
// ファイル名は「接頭辞（漢字）+ 5桁連番」の実物に合わせる: 花00201.jpg〜
const IMAGE_CATEGORIES = {
  flower: { path: 'flower', count: parseInt(process.env.FLOWER_IMAGE_COUNT || '17'), startNum: 201, prefix: '花' },
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

async function getNextPhotoIndex(category) {
  const cat = IMAGE_CATEGORIES[category];
  const key = `x_photo_idx_${category}`;
  let current = await redis.get(key);
  if (current === null || current === undefined) current = -1;
  const next = (parseInt(current) + 1) % cat.count;
  return { next, key };
}

// 画像をダウンロードしてXにアップロードし、media_idを返す。
// 失敗しても呼び出し元は「画像なしで投稿続行」にフォールバックできるよう
// エラーはthrowせず null を返す。
async function uploadPhotoToX(xClient, category, imageIndex) {
  // 診断のため失敗理由を { mediaId, error, sizeMB } の形で返す（従来はnullのみで理由不明だった）
  try {
    const url = buildPhotoUrl(category, imageIndex);  // startNum + index で組み立てるため+1しない
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
      // X側のアップロード拒否（5MB超過など）をここで捕捉する
      return { mediaId: null, error: `X画像アップロード失敗(${sizeMB}MB): ${uploadErr.message}`, sizeMB };
    }
  } catch (e) {
    return { mediaId: null, error: `画像取得/変換エラー: ${e.message}` };
  }
}

// ============================================================
// メインハンドラ
// ============================================================
export async function GET(request) {
  const url = new URL(request.url);

  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  // ?report=1 → 前回の実行レポートを表示するだけ（投稿しない）
  if (url.searchParams.get('report') === '1') {
    try {
      const [morning, motion, jake, morningPosted] = await Promise.all([
        redis.get('last_morning_report'),
        redis.get('ig_motion_posted_date'),
        redis.get('ig_jake_posted_date'),
        redis.get('morning_posted_date'),
      ]);
      const parsed = typeof morning === 'string' ? JSON.parse(morning) : morning;
      return new Response(JSON.stringify({
        lastMorningReport: parsed,
        morningPostedDate: morningPosted || '(記録なし)',
        instagramLastPosted: {
          'motion.imaging': motion || '(記録なし)',
          'jake_images_':   jake   || '(記録なし)',
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const skipList = (url.searchParams.get('skip') || '').split(',').filter(Boolean);
  const dryRun   = url.searchParams.get('dry') === '1';
  const force    = url.searchParams.get('force') === '1';
  const jstToday = new Date(Date.now() + 9 * 3600000);
  const todayStr = `${jstToday.getFullYear()}/${String(jstToday.getMonth() + 1).padStart(2, '0')}/${String(jstToday.getDate()).padStart(2, '0')}`;

  const t0 = Date.now();
  const report = {
    x: {},
    threads: {},
    lengths: {},
    weather: null,
    dryRun,
    startedAt: new Date().toISOString(),
  };
  let claimedToday = false;

  try {
    // ★ 当日重複防止（2026-09-14 追加）
    //   post-dailyで雲海指数が2回投稿された事故（check-then-act構造の
    //   race condition）と同型の事故を防ぐため、他の2ファイルと同じく
    //   投稿処理前にredis SET NXで原子的に「今日の枠」を予約する。
    if (!dryRun && !force) {
      const claimed = await redis.set('morning_posted_date', todayStr, { nx: true, ex: 82800 });
      if (claimed === null) {
        report.result = '本日投稿済み、または同時実行のためスキップ';
        report.finishedAt = new Date().toISOString();
        report.totalMs = Date.now() - t0;
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
      claimedToday = true;
    }

    const API_KEY     = process.env.GEMINI_API_KEY;
    const dateLabel   = getTodayLabel();
    const jstNow      = new Date(Date.now() + 9 * 3600000);
    const curMonth    = jstNow.getMonth() + 1;

    // ★ スコアはOpen-Meteo連動でコード側が決定的に算出する
    //  （migoron-scoring.js）。候補スポットは月別の固定リストから選び、
    //   Geminiにはスコア・天気を渡さずメモ文だけを書かせる。
    let scored, scoreSource;
    try {
      scored = await computeFlowerScores(curMonth);
      if (!scored.every(s => s.ok)) throw new Error('一部スポットの天気取得に失敗');
      scoreSource = 'open-meteo';
    } catch (e) {
      const spots = getFlowerSpotsForMonth(curMonth);
      scored = spots.map(s => ({ ...s, score: s.baseScore, ok: false }));
      scoreSource = 'フォールバック（Open-Meteo取得失敗、季節ベーススコアを使用: ' + e.message + '）';
    }

    const ranked = scored.slice().sort((a, b) => b.score - a.score);
    const avgScore = Math.round(ranked.reduce((s, x) => s + x.score, 0) / ranked.length);
    // 参考情報としての今日の天気（メモ生成用。スコアはscoredに反映済み）
    const weatherJA = avgScore >= 70 ? '穏やかな天気' : avgScore >= 45 ? 'やや崩れ気味の天気' : '荒れ気味の天気';

    const memo = await buildMemo(API_KEY, ranked, avgScore, weatherJA);
    const tweetJA = buildFlowerTweetText(dateLabel, ranked, memo);

    report.weather = weatherJA;
    report.scoreSource = scoreSource;
    // 重み付き文字数を必ず記録（超過していれば一目で分かる）
    report.lengths = {
      flower_ja: { weighted: weightedLength(tweetJA), raw: tweetJA.length },
      limit: X_LIMIT,
    };

    if (dryRun) {
      report.finishedAt = new Date().toISOString();
      report.totalMs = Date.now() - t0;
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        tweets: {
          flower_ja: { weighted: weightedLength(tweetJA), text: tweetJA, scores: scored },
        },
        scoreSource,
        report,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    // 花畑指数（日本語）にだけ、花カテゴリの画像をローテーションで添付する。
    // ?noimage=1 を付けると画像なしでテスト投稿できる（デバッグ用）。
    const noImage = url.searchParams.get('noimage') === '1';
    const IMAGE_MAP = { flower_ja: 'flower' };

    const entries = [
      ['flower_ja', tweetJA],
    ];

    for (let idx = 0; idx < entries.length; idx++) {
      const [key, text] = entries[idx];
      if (skipList.includes(key)) { report.x[key] = 'skipped'; continue; }

      // ---- 画像の準備（対象カテゴリがあれば） ----
      let mediaId = null;
      let photoMeta = null;
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
        // 画像投稿が成功した場合のみローテーションを進める
        if (photoMeta && photoMeta.uploaded) {
          await redis.set(photoMeta.photoKey, photoMeta.index);
        }
      } else if (r.duplicate) {
        report.x[key] = '重複のため投稿されず | w:' + weightedLength(text);
      } else {
        report.x[key] = describeXError(r.error, text, r.attempts);
      }

      // Threads（ベストエフォート・最大60秒、画像なしのテキストのみ）
      try {
        await withTimeout(
          postTextToThreads(process.env.THREADS_MOTION_TOKEN, text),
          60000,
          'Threads'
        );
        report.threads[key] = 'ok';
      } catch (te) {
        report.threads[key] = 'error: ' + te.message;
      }

      // 最後の1件のあとは待たない
      if (idx < entries.length - 1) await new Promise(r2 => setTimeout(r2, 5000));
    }

    // !forceの場合は冒頭のSET NXで既に予約済み。forceはNX予約をスキップしているので、
    // 同日中の通常cronによる再投稿を防ぐため、ここで（上書きで）フラグを立てる。
    if (force) {
      try { await redis.set('morning_posted_date', todayStr, { ex: 82800 }); } catch {}
    }

    report.finishedAt = new Date().toISOString();
    report.totalMs = Date.now() - t0;
    try { await redis.set('last_morning_report', JSON.stringify(report)); } catch {}
    await recordJobStatus('x_morning', {
      main: { 'X 花畑指数': report.x.flower_ja },
      sub:  { Threads: report.threads.flower_ja, 画像: report.flower_ja_image },
    });
    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), {
      status: 200, headers: jsonHeaders,
    });

  } catch (error) {
    report.fatalError = error.message;
    report.totalMs = Date.now() - t0;
    // 投稿完了前に致命的エラーで落ちた場合、予約したフラグを解放し
    // 当日中の再実行をブロックしたままにしない
    if (claimedToday) { try { await redis.del('morning_posted_date'); } catch {} }
    try { await redis.set('last_morning_report', JSON.stringify(report)); } catch {}
    await recordJobStatus('x_morning', { fatalError: error.message });
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), {
      status: 500, headers: jsonHeaders,
    });
  }
}
