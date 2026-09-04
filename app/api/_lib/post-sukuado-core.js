// app/api/_lib/post-sukuado-core.js
// スクアド X自動投稿の共通ロジック（朝・夜で共有）
// ============================================================
// 投稿先：@scadchatapp（Migoronの @motion_imaging とは別アカウント）
// 環境変数は SCAD_X_* を使用（Migoronの X_* を上書きしないこと）
//
// このファイルは直接cronから呼ばれません。
// /api/post-sukuado-morning と /api/post-sukuado-night が
// slot を指定して runSukuado() を呼びます。
//
// Migoronで実績のある実装パターンを踏襲：
//  - 内部fetchを使わない（独立cron）
//  - Redisカウンタは投稿成功後に更新
//  - weightedLength() で投稿前チェック（超過はスキップしてレポート）
//  - X投稿は自動リトライ最大3回・重複403は再試行しない
//  - ?key= / ?dry=1 / ?force=1 / ?report=1 に対応
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';

// 朝夜のJSONを静的import（ビルド時に同梱される）
import morningData from '../post-sukuado-morning/tweets.json';
import nightData from '../post-sukuado-night/tweets.json';
import promoData from '../post-sukuado-promo/tweets.json';

const X_LIMIT  = 280;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// スロット定義
// ============================================================
const SLOTS = {
  morning: {
    data: morningData,
    idxKey:   'sukuado_morning_idx',    // 次に投稿するデータindex（0始まり）
    cycleKey: 'sukuado_morning_cycle',  // 周回数
    postedKey: 'sukuado_morning_posted', // 本日投稿済みフラグ（日付）
    reportKey: 'sukuado_morning_report',
  },
  night: {
    data: nightData,
    idxKey:   'sukuado_night_idx',
    cycleKey: 'sukuado_night_cycle',
    postedKey: 'sukuado_night_posted',
    reportKey: 'sukuado_night_report',
  },
  promo: {
    // 宣伝ツイート：固定3パターンをローテーション（夜枠の後、22:01頃）
    // 全件 cat が同じなので interleaveByCategory は id順のまま返す＝単純な周回になる
    data: promoData,
    idxKey:   'sukuado_promo_idx',
    cycleKey: 'sukuado_promo_cycle',
    postedKey: 'sukuado_promo_posted',
    reportKey: 'sukuado_promo_report',
  },
};

// ============================================================
// Xの重み付き文字数（Migoron側と同一実装）
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

// ============================================================
// カテゴリ分散並べ替え（決定的・シードなし）
//   JSONはcatごとに固まって並んでいるため、そのまま投稿すると
//   同カテゴリが10連続する。ラウンドロビンで散らす。
//   入力が同じなら出力も必ず同じ（?dry=1と実投稿が一致する）。
// ============================================================
function interleaveByCategory(items) {
  // カテゴリごとのキュー（元のid昇順を保持）
  const buckets = new Map();
  for (const it of items) {
    const c = it.cat || '_';
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(it);
  }
  // カテゴリの順序は「最初に出現した順」で固定（決定的）
  const order = [];
  for (const it of items) {
    const c = it.cat || '_';
    if (!order.includes(c)) order.push(c);
  }
  const result = [];
  let remaining = items.length;
  while (remaining > 0) {
    for (const c of order) {
      const q = buckets.get(c);
      if (q && q.length > 0) {
        result.push(q.shift());
        remaining--;
      }
    }
  }
  return result;
}

// ============================================================
// X投稿（リトライ付き・重複403は再試行しない）
// ============================================================
function isDuplicateError(err) {
  const msg = ((err && err.message) || '') + ' ' + JSON.stringify((err && err.data) || {});
  return /duplicate/i.test(msg) || (err && err.code === 403);
}

async function tweetWithRetry(xClient, text, attempts = 3) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await xClient.v2.tweet(text);
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

// X投稿と同じ文面を @tokyo_goshuin_tsushin のThreadsへテキスト投稿（画像なし・ベストエフォート）
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
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// ============================================================
// メイン：runSukuado(request, slotName)
// ============================================================
export async function runSukuado(request, slotName) {
  const url = new URL(request.url);
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
  const slot = SLOTS[slotName];
  if (!slot) {
    return new Response(JSON.stringify({ error: 'unknown slot: ' + slotName }), { status: 500, headers: jsonHeaders });
  }

  // 認証：Authorizationヘッダー または ?key=
  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ?report=1 → 前回レポートを表示（投稿しない）
  if (url.searchParams.get('report') === '1') {
    try {
      const [rep, idx, cycle, posted] = await Promise.all([
        redis.get(slot.reportKey),
        redis.get(slot.idxKey),
        redis.get(slot.cycleKey),
        redis.get(slot.postedKey),
      ]);
      const parsed = typeof rep === 'string' ? JSON.parse(rep) : rep;
      return new Response(JSON.stringify({
        slot: slotName,
        lastReport: parsed,
        state: {
          nextIndex: idx ?? '(未設定=0から)',
          cycle: cycle ?? 0,
          lastPostedDate: posted ?? '(記録なし)',
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun = url.searchParams.get('dry') === '1';
  const force  = url.searchParams.get('force') === '1';
  const today  = getDateStringJST();

  // カテゴリ分散した投稿順（決定的）
  const ordered = interleaveByCategory(slot.data.items);
  const total   = ordered.length;

  const report = {
    slot: slotName,
    dryRun,
    startedAt: new Date().toISOString(),
  };

  try {
    // ?dry=1 → 全50本の順序と文字数を返す（投稿しない）
    if (dryRun) {
      const list = ordered.map((it, i) => ({
        order: i,
        id: it.id,
        cat: it.cat,
        cta: !!it.cta,
        weighted: weightedLength(it.tweet),
        over: weightedLength(it.tweet) > X_LIMIT,
        tweet: it.tweet,
      }));
      const overCount = list.filter(x => x.over).length;
      return new Response(JSON.stringify({
        message: 'Dry run（投稿していません）',
        slot: slotName,
        total,
        maxWeighted: Math.max(...list.map(x => x.weighted)),
        over280: overCount,
        order: list,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    // 重複投稿防止（force=1で無視）
    if (!force) {
      const lastPosted = await redis.get(slot.postedKey);
      if (lastPosted === today) {
        report.result = '本日投稿済みのためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
    }

    // 次に投稿するindexを取得
    let idx = await redis.get(slot.idxKey);
    if (idx === null || idx === undefined) idx = 0;
    idx = parseInt(idx) % total;

    const item = ordered[idx];
    const text = item.tweet;
    const w    = weightedLength(text);

    report.picked = { order: idx, id: item.id, cat: item.cat, cta: !!item.cta, weighted: w };

    // 文字数チェック：超過していたらスキップして次回に送る
    // （このデータでは起きない想定だが、Migoronの花畑指数事故を踏まえた保険）
    if (w > X_LIMIT) {
      const nextIdx = (idx + 1) % total;
      await redis.set(slot.idxKey, nextIdx);
      report.result = `文字数超過(${w})のためスキップ。次回はorder=${nextIdx}`;
      try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
    }

    // X投稿
    const xClient = new TwitterApi({
      appKey:       process.env.SCAD_X_API_KEY,
      appSecret:    process.env.SCAD_X_API_SECRET,
      accessToken:  process.env.SCAD_X_ACCESS_TOKEN,
      accessSecret: process.env.SCAD_X_ACCESS_SECRET,
    });

    const r = await tweetWithRetry(xClient, text);

    if (r.ok) {
      // 成功後にカウンタ更新（成功前に進めない）
      const nextIdx = (idx + 1) % total;
      await redis.set(slot.idxKey, nextIdx);
      await redis.set(slot.postedKey, today, { ex: 82800 });
      if (nextIdx === 0) {
        const cycle = parseInt(await redis.get(slot.cycleKey) || '0') + 1;
        await redis.set(slot.cycleKey, cycle);
        report.cycleCompleted = cycle;
      }
      report.result = 'ok';
      report.tweetId = r.id;
      report.nextIndex = nextIdx;

      // 同じ文面を @tokyo_goshuin_tsushin のThreadsへ（ベストエフォート・失敗してもX投稿の成功には影響しない）
      try {
        const threadsId = await postTextToThreads(process.env.THREADS_SUKUADO_TOKEN, text);
        report.threads = threadsId ? 'ok: ' + threadsId : 'skip（トークン未設定）';
      } catch (te) {
        report.threads = 'error: ' + te.message;
      }
    } else if (r.duplicate) {
      // 重複＝既に同じ本文が上がっている。indexだけ進めて次回へ。
      const nextIdx = (idx + 1) % total;
      await redis.set(slot.idxKey, nextIdx);
      await redis.set(slot.postedKey, today, { ex: 82800 });
      report.result = '重複のため投稿されず（indexは進めた）';
      report.nextIndex = nextIdx;
    } else {
      // 恒久エラー：indexは進めない（次回同じ投稿を再試行）
      report.result = describeXError(r.error, text, r.attempts);
    }

    report.finishedAt = new Date().toISOString();
    try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), {
      status: r.ok || r.duplicate ? 200 : 500,
      headers: jsonHeaders,
    });

  } catch (error) {
    report.fatalError = error.message;
    try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
