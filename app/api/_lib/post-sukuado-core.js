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
