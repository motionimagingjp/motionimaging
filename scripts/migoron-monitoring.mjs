// ミゴロン予報の精度記録をGitHubに残すスクリプト（.github/workflows/migoron-monitoring.yml から実行）。
//
//   1. 本番の /api/verify-predictions?export=1 から直近の予測・答え合わせ・ライブカメラ判定を取得し、
//      <OUT_DIR>/predictions.csv に追記・更新する（キー: 対象日・種別・スポット）。
//   2. 毎月1日・15日（JST）か REVIEW=true のとき、?review=1 の結果を
//      <OUT_DIR>/reviews/YYYY-MM-DD.md と <OUT_DIR>/latest-review.md に書く。
//
// 環境変数: CRON_SECRET（必須）, BASE_URL（既定 https://motionimaging.vercel.app）,
//           OUT_DIR（既定 monitoring-data）, REVIEW（"true"で強制的にレビューを書く）
// 依存パッケージなし（Node 20以上）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'https://motionimaging.vercel.app';
const OUT_DIR = process.env.OUT_DIR || 'monitoring-data';
const SECRET = process.env.CRON_SECRET;

const COLUMNS = [
  'target_date', 'kind', 'spot', 'predicted', 'model_score', 'model_hit', 'brier',
  'camera_seen', 'camera_hit', 'camera_note', 'verified_at', 'inputs',
];
const KIND_LABEL = { star: '星空', cloud: '雲海', fuji: '富士山', flower: '花畑' };

function jstToday() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

async function api(query) {
  const res = await fetch(`${BASE_URL}/api/verify-predictions?${query}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) throw new Error(`${query}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- CSV（ダブルクォート対応の最小実装） ----
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function mergeRows(existingCsv, newRows) {
  const byKey = new Map();
  const keyOf = (r) => `${r.target_date}|${r.kind}|${r.spot}`;
  if (existingCsv) {
    const [header, ...lines] = parseCsv(existingCsv);
    for (const line of lines) {
      if (line.length < 3) continue;
      const r = Object.fromEntries(header.map((h, i) => [h, line[i] ?? '']));
      byKey.set(keyOf(r), r);
    }
  }
  for (const r of newRows) {
    const prev = byKey.get(keyOf(r)) || {};
    // 新しい行が空欄の項目は、既存の値を残す（APIの保持期間を過ぎても記録が消えないように）
    const merged = { ...prev };
    for (const c of COLUMNS) if (r[c] !== '' && r[c] != null) merged[c] = r[c];
    byKey.set(keyOf(r), merged);
  }
  const rows = [...byKey.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

function reviewMarkdown(data, today) {
  const { review, calibration, misses } = data;
  const L = [];
  L.push(`# ミゴロン予報レビュー ${today}`, '');
  L.push(`対象: ${review.period.since}〜${review.period.until}（比較: ${review.previousPeriod.since}〜${review.previousPeriod.until}）`, '');
  L.push(`**総合判定: ${review.verdictLabel}**`, '');
  L.push('| 種別 | 判定 | 的中率 | 前の14日 | Brier | 偏り | 件数 | カメラ一致 |', '|---|---|---|---|---|---|---|---|');
  for (const k of review.kinds) {
    const c = k.current, p = k.previous;
    L.push(`| ${k.label} | ${k.verdict === 'ok' ? '合格' : k.verdict === 'watch' ? '様子見' : k.verdict === 'action' ? '要見直し' : 'データ不足'} | ${c.hitRate ?? '-'}% | ${p.hitRate ?? '-'}% | ${c.brier ?? '-'} | ${c.bias ?? '-'} | ${c.n} | ${c.fieldN ? `${c.fieldHitRate}%（${c.fieldN}件）` : '-'} |`);
  }
  const reasons = review.kinds.filter((k) => k.reasons.length);
  if (reasons.length) {
    L.push('', '## 判定の理由', '');
    for (const k of reasons) L.push(`- ${k.label}: ${k.reasons.join('、')}`);
  }
  L.push('', '## 信頼度（直近28日、指数の帯ごとに結果が良かった割合）', '');
  const kinds = Object.keys(calibration);
  L.push(`| 指数 | ${kinds.map((k) => KIND_LABEL[k]).join(' | ')} |`, `|---|${kinds.map(() => '---').join('|')}|`);
  calibration[kinds[0]].forEach((row, i) => {
    L.push(`| ${row.label} | ${kinds.map((k) => { const r = calibration[k][i]; return r.n ? `${r.goodRate}%（${r.n}件）` : '-'; }).join(' | ')} |`);
  });
  L.push('', '## 外れた予測（直近14日）', '');
  if (!misses.length) L.push('なし');
  for (const m of misses) {
    L.push(`- ${m.date} ${KIND_LABEL[m.kind] || m.kind} ${m.name}: 予測 ${m.score}% → 結果 ${m.observedScore}%` + (m.inputs ? ` / ${JSON.stringify(m.inputs)}` : ''));
  }
  L.push('');
  return L.join('\n');
}

async function main() {
  if (!SECRET) {
    console.error('CRON_SECRET が未設定です。GitHubのリポジトリ設定 → Secrets and variables → Actions に、Vercelと同じ値で CRON_SECRET を登録してください。');
    process.exit(1);
  }
  await mkdir(join(OUT_DIR, 'reviews'), { recursive: true });

  const { rows } = await api('export=1&days=14');
  const csvPath = join(OUT_DIR, 'predictions.csv');
  const existing = await readFile(csvPath, 'utf8').catch(() => '');
  await writeFile(csvPath, mergeRows(existing, rows));
  console.log(`predictions.csv: ${rows.length}行を反映`);

  const today = jstToday();
  const day = Number(today.slice(8, 10));
  if (process.env.REVIEW === 'true' || day === 1 || day === 15) {
    const md = reviewMarkdown(await api('review=1'), today);
    await writeFile(join(OUT_DIR, 'reviews', `${today}.md`), md);
    await writeFile(join(OUT_DIR, 'latest-review.md'), md);
    console.log(`reviews/${today}.md を作成`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
