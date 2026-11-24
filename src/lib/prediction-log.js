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

function emptyAgg() {
  return { n: 0, hits: 0, brierSum: 0, absErrSum: 0, biasSum: 0, falseAlarms: 0, misses: 0, fieldN: 0, fieldHits: 0 };
}

// it: verified.itemsの1件、score: そのスポットの予測スコア
function addTo(agg, it, score) {
  agg.n++;
  if (it.hit) agg.hits++;
  agg.brierSum += it.brier;
  agg.absErrSum += it.absErr;
  agg.biasSum += score - it.observedScore;
  const predictedGood = score >= GOOD_THRESHOLD;
  if (predictedGood && it.y === 0) agg.falseAlarms++; // 「良い」と予測したが結果は良くなかった
  if (!predictedGood && it.y === 1) agg.misses++;     // 「良くない」と予測したが結果は良かった
}

function finish(agg) {
  const field = {
    fieldN: agg.fieldN,
    fieldHitRate: agg.fieldN ? Math.round((agg.fieldHits / agg.fieldN) * 1000) / 10 : null,
  };
  if (!agg.n) return { n: 0, hitRate: null, brier: null, mae: null, bias: null, falseAlarms: 0, misses: 0, ...field };
  return {
    n: agg.n,
    hitRate: Math.round((agg.hits / agg.n) * 1000) / 10, // %、小数1桁
    brier: Math.round((agg.brierSum / agg.n) * 1000) / 1000,
    mae: Math.round((agg.absErrSum / agg.n) * 10) / 10,
    bias: Math.round((agg.biasSum / agg.n) * 10) / 10, // +なら高く出し過ぎ、-なら低く出し過ぎ
    falseAlarms: agg.falseAlarms,
    misses: agg.misses,
    ...field,
  };
}

// records: readPredictionRecords の結果。対象日が sinceDate〜untilDate(YYYY-MM-DD、両端含む)の
// 予測だけ集計する。untilDate省略時は上限なし。
// 戻り値: { overall, byKind: { star: {...}, ... }, pending }（pending=答え合わせ待ちの予測日数）
// fieldN/fieldHitRate はライブカメラで判定した「実際に見えたか」(rec.actual)との一致率。
export function summarizePredictions(records, sinceDate, untilDate = null) {
  const overall = emptyAgg();
  const byKind = Object.fromEntries(KINDS.map((k) => [k.id, emptyAgg()]));
  let pending = 0;
  for (const rec of records) {
    if (rec.targetDate < sinceDate) continue;
    if (untilDate && rec.targetDate > untilDate) continue;
    const kindAgg = byKind[rec.kind];

    if (rec.actual) {
      rec.items.forEach((it, i) => {
        const a = rec.actual[i];
        if (!a || typeof a.seen !== 'boolean') return;
        const hit = (it.score >= GOOD_THRESHOLD) === a.seen;
        for (const agg of [overall, kindAgg].filter(Boolean)) {
          agg.fieldN++;
          if (hit) agg.fieldHits++;
        }
      });
    }

    if (!rec.verified) { pending++; continue; }
    rec.verified.items.forEach((it, i) => {
      if (it.error) return;
      const score = rec.items[i].score;
      addTo(overall, it, score);
      if (kindAgg) addTo(kindAgg, it, score);
    });
  }
  return {
    since: sinceDate,
    until: untilDate,
    overall: finish(overall),
    byKind: Object.fromEntries(KINDS.map((k) => [k.id, finish(byKind[k.id])])),
    pending,
  };
}

// 予測スコアの帯ごとに「実際に良かった(実測スコア>=60)割合」を出す。
// 「出現期待度80%台」と出した日が本当に8割前後良かったか、を見るための表。
export const CALIBRATION_BANDS = [
  { label: '10〜39%', min: 10, max: 39 },
  { label: '40〜59%', min: 40, max: 59 },
  { label: '60〜79%', min: 60, max: 79 },
  { label: '80〜95%', min: 80, max: 95 },
];

export function calibrationTable(records, sinceDate, kind = null) {
  const rows = CALIBRATION_BANDS.map((b) => ({ ...b, n: 0, good: 0, scoreSum: 0 }));
  for (const rec of records) {
    if (rec.targetDate < sinceDate || !rec.verified) continue;
    if (kind && rec.kind !== kind) continue;
    rec.verified.items.forEach((it, i) => {
      if (it.error) return;
      const score = rec.items[i].score;
      const row = rows.find((r) => score >= r.min && score <= r.max);
      if (!row) return;
      row.n++;
      row.good += it.y;
      row.scoreSum += score;
    });
  }
  return rows.map((r) => ({
    label: r.label,
    n: r.n,
    avgScore: r.n ? Math.round(r.scoreSum / r.n) : null,
    goodRate: r.n ? Math.round((r.good / r.n) * 100) : null,
  }));
}

// 外れた予測（新しい順）。原因を見るため元の天気要素も付ける。
export function listMisses(records, sinceDate, limit = 12) {
  const out = [];
  for (const rec of records) {
    if (rec.targetDate < sinceDate || !rec.verified) continue;
    rec.verified.items.forEach((it, i) => {
      if (it.error || it.hit) return;
      out.push({
        date: rec.targetDate, kind: rec.kind, name: it.name,
        score: rec.items[i].score, observedScore: it.observedScore,
        inputs: rec.items[i].inputs || null,
      });
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out.slice(0, limit);
}

// ============================================================
// 定期レビュー（2週間ごとを想定）
//
// 直近14日とその前の14日を比べ、種別ごとに合格ラインと照らして判定する。
// 合格ラインは 2026-11-21 時点の実績（直近28日: 星空 94.6%・Brier 0.066 /
// 雲海 90.7%・0.121 / 富士山 86.7%・0.121）から、14日ぶんの件数で起きる
// 偶然のブレ（±5ポイント程度）を見込んで少し下に置いた「これを割ったら調べる」線。
// 伸ばしたい目標値と見直しの手順は docs/migoron_accuracy_review.md にある。
// 花畑は当日の予報どうしを比べる形になり差が出ないため、判定対象から外している。
// ============================================================
export const REVIEW_DAYS = 14;
export const REVIEW_MIN_N = 15; // これ未満は「データ不足」として判定しない

export const TARGETS = {
  star:  { hitRate: 90, brier: 0.12, bias: 8 },
  cloud: { hitRate: 85, brier: 0.15, bias: 8 },
  fuji:  { hitRate: 85, brier: 0.15, bias: 8 },
};
export const FIELD_TARGET = { hitRate: 75, minN: 5 }; // ライブカメラ判定（実際に見えたか）との一致率

function reviewKind(cur, prev, target) {
  if (cur.n < REVIEW_MIN_N) {
    return { verdict: 'insufficient', reasons: [`件数が少ない（${cur.n}件）`] };
  }
  const reasons = [];
  let serious = false;
  if (cur.hitRate < target.hitRate) {
    reasons.push(`的中率 ${cur.hitRate}% が合格ライン ${target.hitRate}% に届かない`);
    if (cur.hitRate < target.hitRate - 10) serious = true;
  }
  if (cur.brier > target.brier) reasons.push(`Brier ${cur.brier} が合格ライン ${target.brier} より大きい`);
  if (Math.abs(cur.bias) > target.bias) {
    reasons.push(cur.bias > 0 ? `高く出し過ぎ（平均 +${cur.bias}点）` : `低く出し過ぎ（平均 ${cur.bias}点）`);
    if (Math.abs(cur.bias) > target.bias * 2) serious = true;
  }
  if (prev.n >= REVIEW_MIN_N && cur.hitRate <= prev.hitRate - 10) {
    reasons.push(`前の14日より ${Math.round((prev.hitRate - cur.hitRate) * 10) / 10}ポイント悪化`);
  }
  if (cur.fieldN >= FIELD_TARGET.minN && cur.fieldHitRate < FIELD_TARGET.hitRate) {
    reasons.push(`ライブカメラ判定との一致 ${cur.fieldHitRate}%（${cur.fieldN}件）が合格ライン ${FIELD_TARGET.hitRate}% に届かない`);
    serious = true;
  }
  const verdict = reasons.length === 0 ? 'ok' : (serious || reasons.length >= 2) ? 'action' : 'watch';
  return { verdict, reasons };
}

export const VERDICT_LABEL = { ok: '合格', watch: '様子見', action: '要見直し', insufficient: 'データ不足' };

// records: 直近29日以上ぶん（readPredictionRecords(29)）
export function buildReview(records) {
  const curSince = jstDateString(-REVIEW_DAYS), curUntil = jstDateString(-1);
  const prevSince = jstDateString(-REVIEW_DAYS * 2), prevUntil = jstDateString(-REVIEW_DAYS - 1);
  const cur = summarizePredictions(records, curSince, curUntil);
  const prev = summarizePredictions(records, prevSince, prevUntil);

  const kinds = KINDS.filter((k) => TARGETS[k.id]).map((k) => {
    const r = reviewKind(cur.byKind[k.id], prev.byKind[k.id], TARGETS[k.id]);
    return { id: k.id, label: k.label, target: TARGETS[k.id], current: cur.byKind[k.id], previous: prev.byKind[k.id], ...r };
  });
  const rank = { action: 3, watch: 2, insufficient: 1, ok: 0 };
  const verdict = kinds.reduce((w, k) => (rank[k.verdict] > rank[w] ? k.verdict : w), 'ok');

  const lines = [`ミゴロン予報レビュー（${curSince}〜${curUntil}）: ${VERDICT_LABEL[verdict]}`];
  for (const k of kinds) {
    const c = k.current;
    lines.push(c.n
      ? `・${k.label}: ${VERDICT_LABEL[k.verdict]} / 的中率 ${c.hitRate}%（前 ${k.previous.hitRate ?? '-'}%）・Brier ${c.brier}・偏り ${c.bias > 0 ? '+' : ''}${c.bias}点・${c.n}件`
        + (k.reasons.length ? ` → ${k.reasons.join('、')}` : '')
      : `・${k.label}: データなし`);
  }
  return {
    period: { since: curSince, until: curUntil },
    previousPeriod: { since: prevSince, until: prevUntil },
    verdict, verdictLabel: VERDICT_LABEL[verdict],
    kinds,
    overall: { current: cur.overall, previous: prev.overall },
    text: lines.join('\n'),
  };
}

// ============================================================
// 実際に見えたか（ライブカメラ判定）
//
// 答え合わせの「結果」は予報モデルの解析値で、実際に見えたかどうかではない。
// 富士山は毎朝ライブカメラ画像をGeminiで判定し（/api/check-fuji-camera）、
// rec.actual[スポットの番号] に残す。予測との一致率は fieldHitRate として別枠で集計する。
// ============================================================

// seen: true=見えた / false=見えなかった。detail: { source, camera, visibility, reason }
export async function saveActualObservation(kind, date, index, seen, detail = {}, r = redis) {
  const rec = parse(await r.get(key(kind, date)));
  if (!rec || !rec.items[index]) return false;
  const actual = { ...(rec.actual || {}) };
  actual[index] = { seen: !!seen, at: new Date().toISOString(), ...detail };
  await r.set(key(kind, date), { ...rec, actual }, { ex: TTL_SECONDS });
  return true;
}

export async function readPredictionRecord(kind, date, r = redis) {
  return parse(await r.get(key(kind, date)));
}

// GitHubの記録用（monitoring/predictions.csv）に、スポット単位の行へ平らにする
export function exportRows(records) {
  const rows = [];
  for (const rec of records) {
    rec.items.forEach((it, i) => {
      const v = rec.verified && rec.verified.items[i];
      const a = rec.actual && rec.actual[i];
      rows.push({
        target_date: rec.targetDate,
        kind: rec.kind,
        spot: it.name,
        predicted: it.score,
        model_score: v && !v.error ? v.observedScore : '',
        model_hit: v && !v.error ? (v.hit ? 1 : 0) : '',
        brier: v && !v.error ? v.brier : '',
        camera_seen: a ? (a.seen ? 1 : 0) : '',
        camera_hit: a ? ((it.score >= GOOD_THRESHOLD) === a.seen ? 1 : 0) : '',
        camera_note: a ? [a.camera, a.visibility, a.reason].filter(Boolean).join(' / ') : '',
        verified_at: rec.verified ? rec.verified.at : '',
        inputs: it.inputs ? JSON.stringify(it.inputs) : '',
      });
    });
  }
  rows.sort((x, y) => (x.target_date + x.kind + x.spot).localeCompare(y.target_date + y.kind + y.spot));
  return rows;
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
