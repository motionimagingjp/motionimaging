// 各cronの実行結果を Redis に記録し、管理画面（/admin）で一覧表示するための共通処理。
// 「本日投稿済みでスキップ」「dry run」は記録しない（実際に投稿を試みた回だけ残す）。
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// schedule は vercel.json の UTC cron を JST に直したもの
export const JOBS = [
  { id: 'ig_motion',               label: 'Instagram @motion.imaging',   schedule: '毎朝 6:00' },
  { id: 'ig_jake',                 label: 'Instagram @jake_images_',     schedule: '毎朝 6:10' },
  { id: 'x_morning',               label: 'X ミゴロン 花畑指数',          schedule: '毎朝 6:20' },
  { id: 'x_evening',               label: 'X ミゴロン 星空指数',          schedule: '毎日 18:05' },
  { id: 'x_daily',                 label: 'X ミゴロン 雲海・富士山指数',   schedule: '毎日 21:15' },
  { id: 'sukuado_morning',         label: 'X スクアド 朝',                schedule: '毎朝 7:30' },
  { id: 'sukuado_morningQuestion', label: 'X スクアド 朝の質問',          schedule: '毎朝 7:31' },
  { id: 'sukuado_night',           label: 'X スクアド 夜',                schedule: '毎晩 22:00' },
  { id: 'sukuado_promo',           label: 'X スクアド 告知',              schedule: '毎晩 22:01' },
  { id: 'jake_ai_morning',         label: 'X jake 生成AI 朝',             schedule: '毎朝 7:30' },
  { id: 'jake_ai_night',           label: 'X jake 生成AI 夜',             schedule: '毎晩 22:00' },
  { id: 'jake_ai_diary',           label: 'X jake 30日振り返り',          schedule: '毎晩 22:00' },
];

const statusKey = (job) => `job_status:${job}`;

const MAIN_OK = /^(ok|重複|skipped)/;
const SUB_OK  = /^(ok|skip|添付成功)/;
const clip = (s) => String(s).slice(0, 300);

// main: 投稿本体の結果（失敗＝エラー）／ sub: Threads・画像など付随処理の結果（失敗＝注意）
export async function recordJobStatus(job, { main = {}, sub = {}, fatalError = null, note = null } = {}) {
  try {
    const at = new Date().toISOString();
    const errors = [];
    const warnings = [];
    if (fatalError) errors.push(clip(fatalError));
    for (const [label, v] of Object.entries(main)) {
      if (!MAIN_OK.test(String(v))) errors.push(clip(`${label}: ${v}`));
    }
    for (const [label, v] of Object.entries(sub)) {
      if (v != null && !SUB_OK.test(String(v))) warnings.push(clip(`${label}: ${v}`));
    }
    const ok = errors.length === 0;
    const prev = parse(await redis.get(statusKey(job))) || {};
    await redis.set(statusKey(job), {
      at,
      ok,
      errors,
      warnings,
      note,
      lastSuccessAt: ok ? at : prev.lastSuccessAt || null,
      lastFailureAt: ok ? prev.lastFailureAt || null : at,
    });
  } catch (e) {
    console.error('recordJobStatus failed:', e.message);
  }
}

export async function readAllJobStatus() {
  const values = await redis.mget(...JOBS.map((j) => statusKey(j.id)));
  return JOBS.map((job, i) => ({ ...job, status: parse(values[i]) }));
}

function parse(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}
