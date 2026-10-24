// ミゴロン指数の予測ログと答え合わせ（改善指示書P4）。
//
// 投稿した指数（日付・スポット・スコア・元の天気要素）をRedisに保存し、
// 対象日が過ぎたあとに同じスポット・同じ式で実測に近い値から指数を再計算して
// 「当たり／外れ」を判定する。週次・月次の的中率とBrierスコアは
// summarizePredictions()で出し、管理画面(/admin)と /api/verify-predictions?report=1
// から参照する。
//
// 【判定の定義】
//   予測スコアp = score/100、実測スコア（同じ式を実測値で再計算）が
//   GOOD_THRESHOLD(60)以上なら y=1（良い条件だった）、未満なら y=0。
//   的中: 予測も実測も「良い(>=60)」か、どちらも「良くない(<60)」。
//   Brierスコア: (p - y)^2 の平均。0に近いほど良く、常に0.5と答える
//   場合が0.25なので、0.25を下回れば当て推量より良い。
//   MAE: |予測スコア - 実測スコア| の平均（スコア点数のズレ）。
import { Redis } from '@upstash/redis';
import { GOOD_THRESHOLD, jstDateString, observeScores } from '../app/api/_lib/migoron-scoring';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const KINDS = [
  { id: 'star',   label: '星空' },
  { id: 'cloud',  label: '雲海' },
  { id: 'fuji',   label: '富士山' },
  { id: 'flower', label: '花畑' },
];

const TTL_SECONDS = 120 * 86400; // 120日分を保持
const VERIFY_LOOKBACK_DAYS = 7;   // 検証できなかった日があっても、直近7日分まで遡って再試行する

const key = (kind, date) => `pred:${kind}:${date}`;

function parse(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

// items: [{ name, lat, lon, score, inputs?, reflection?, baseScore? }]
// targetDate: 指数の対象日（JST, YYYY-MM-DD）。星空・花畑は投稿当日、雲海・富士山は翌日。
// 実際に投稿した回だけ呼ぶこと（dry runでは呼ばない）。失敗しても投稿本体は止めない。
export async function savePredictions(kind, targetDate, items, meta = {}, r = redis) {
  try {
    const usable = items.filter((s) => s.ok !== false);
    if (!usable.length) return false;
    await r.set(key(kind, targetDate), {
      kind,
      targetDate,
      postedAt: new Date().toISOString(),
      meta,
      items: usable.map((s) => ({
        name: s.name, lat: s.lat, lon: s.lon, score: s.score,
        ...(s.reflection !== undefined ? { reflection: !!s.reflection } : {}),
        ...(s.baseScore !== undefined ? { baseScore: s.baseScore } : {}),
        ...(s.inputs ? { inputs: s.inputs } : {}),
      })),
      verified: null,
    }, { ex: TTL_SECONDS });
    return true;
  } catch (e) {
    console.error('savePredictions failed:', e.message);
    return false;
  }
}

// 1スポットぶんの判定
export function judge(score, observedScore) {
  const p = score / 100;
  const y = observedScore >= GOOD_THRESHOLD ? 1 : 0;
  const predictedGood = score >= GOOD_THRESHOLD;
  return {
    observedScore,
    y,
    hit: predictedGood === (y === 1),
    brier: Math.round((p - y) ** 2 * 10000) / 10000,
    absErr: Math.abs(score - observedScore),
  };
}

// 対象日が昨日以前で、まだ答え合わせしていない予測を検証して保存する。
// 戻り値: 検証した件数などのレポート。dryRun=trueなら保存しない。
export async function verifyPendingPredictions({ dryRun = false, r = redis, observe = observeScores } = {}) {
  const report = { verifiedRecords: 0, skipped: [], errors: [], details: [] };

  for (const { id: kind } of KINDS) {
    for (let n = 1; n <= VERIFY_LOOKBACK_DAYS; n++) {
      const date = jstDateString(-n);
      let rec;
      try {
        rec = parse(await r.get(key(kind, date)));
      } catch (e) {
        report.errors.push(`${kind} ${date}: 読み込み失敗 ${e.message}`);
        continue;
      }
      if (!rec || rec.verified) continue;

      try {
        const obs = await observe(kind, rec.items, date, rec.meta || {});
        const items = rec.items.map((it, i) => {
          const o = obs[i];
          if (!o || !o.ok) return { name: it.name, error: '実測データなし' };
          return { name: it.name, ...judge(it.score, o.observedScore) };
        });
        if (!items.some((x) => !x.error)) {
          report.skipped.push(`${kind} ${date}: 実測データなし`);
          continue;
        }
        const verified = { at: new Date().toISOString(), items };
        if (!dryRun) await r.set(key(kind, date), { ...rec, verified }, { ex: TTL_SECONDS });
        report.verifiedRecords++;
        report.details.push({ kind, date, items });
      } catch (e) {
        report.errors.push(`${kind} ${date}: ${e.message}`);
      }
    }
  }
  return report;
}

// 直近days日ぶん（今日を含む）の予測ログを読み出す
export async function readPredictionRecords(days = 28, r = redis) {
  const keys = [];
  for (const { id: kind } of KINDS) {
    for (let n = 0; n < days; n++) keys.push(key(kind, jstDateString(-n)));
  }
  const values = await r.mget(...keys);
  return values.map(parse).filter(Boolean);
}

function emptyAgg() { return { n: 0, hits: 0, brierSum: 0, absErrSum: 0 }; }

function addTo(agg, it) {
  agg.n++;
  if (it.hit) agg.hits++;
  agg.brierSum += it.brier;
  agg.absErrSum += it.absErr;
}

function finish(agg) {
  if (!agg.n) return { n: 0, hitRate: null, brier: null, mae: null };
  return {
    n: agg.n,
    hitRate: Math.round((agg.hits / agg.n) * 1000) / 10, // %、小数1桁
    brier: Math.round((agg.brierSum / agg.n) * 1000) / 1000,
    mae: Math.round((agg.absErrSum / agg.n) * 10) / 10,
  };
}

// records: readPredictionRecords の結果。sinceDate(YYYY-MM-DD)以降の対象日だけ集計する。
// 戻り値: { overall, byKind: { star: {...}, ... }, pending }（pending=答え合わせ待ちの予測日数）
export function summarizePredictions(records, sinceDate) {
  const overall = emptyAgg();
  const byKind = Object.fromEntries(KINDS.map((k) => [k.id, emptyAgg()]));
  let pending = 0;
  for (const rec of records) {
    if (rec.targetDate < sinceDate) continue;
    if (!rec.verified) { pending++; continue; }
    for (const it of rec.verified.items) {
      if (it.error) continue;
      addTo(overall, it);
      if (byKind[rec.kind]) addTo(byKind[rec.kind], it);
    }
  }
  return {
    since: sinceDate,
    overall: finish(overall),
    byKind: Object.fromEntries(KINDS.map((k) => [k.id, finish(byKind[k.id])])),
    pending,
  };
}

// SNS発信用の文面（投稿はしない。管理画面とreport=1のJSONに載せるだけ）
export function buildReportText(summary, days) {
  const lines = [`ミゴロンの予報、直近${days}日の答え合わせ`];
  if (summary.overall.n === 0) {
    lines.push('まだ集計できるデータがありません。');
    return lines.join('\n');
  }
  lines.push(`的中率 ${summary.overall.hitRate}%（${summary.overall.n}件）`);
  for (const k of KINDS) {
    const s = summary.byKind[k.id];
    if (s.n > 0) lines.push(`・${k.label} ${s.hitRate}%`);
  }
  lines.push('#ミゴロン');
  return lines.join('\n');
}
