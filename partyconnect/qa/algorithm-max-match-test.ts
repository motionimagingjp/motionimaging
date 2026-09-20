/**
 * 理論上の最大組数（min(男性数,女性数)）をアルゴリズムが完全に導けるかの検証。
 *
 * ★独立した単一ファイルで完結。qa/data配下には何も追加しない。
 * ★参加者・投票データはすべて実行時にオンメモリで生成し、ディスクには一切書き出さない。
 * ★実際にデプロイされているマッチングロジック本体（_shared/matching.ts）を直接呼び出す。
 *
 * 設計:
 *   M[i] と W[i] が必ず相互指名し合うベースラインを埋め込み、49組の「隠れた正解」を保証する。
 *   残り2枠はランダムなダミー指名で埋め、3枠の順序もシャッフルして正解が常に第1希望に
 *   来ないようにする（順位バイアスでアルゴリズムが有利になるのを防ぐため）。
 *
 * 実行方法:
 *   deno run --allow-read qa/algorithm-max-match-test.ts
 *   deno run --allow-read qa/algorithm-max-match-test.ts --seed=123
 */
import { computeMatching, type Nomination } from '../supabase/functions/_shared/matching.ts';

const COUNT = 49; // 男女とも49名
const maleIds = Array.from({ length: COUNT }, (_, i) => `M${i + 1}`);
const femaleIds = Array.from({ length: COUNT }, (_, i) => `W${i + 1}`);

const seedArg = Deno.args.find((a) => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 42;

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 正解相手(guaranteed)以外から重複なくn件のダミーを選ぶ */
function pickDummies(pool: string[], exclude: string, n: number): string[] {
  const candidates = pool.filter((x) => x !== exclude);
  const picked: string[] = [];
  const remaining = [...candidates];
  for (let i = 0; i < n; i++) {
    const idx = randInt(0, remaining.length - 1);
    picked.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return picked;
}

// ---- 最終投票（1人3枠、正解ペアを必ず含み、順序はシャッフル） ----------------
const finalNominations: Nomination[] = [];
for (let i = 0; i < COUNT; i++) {
  const male = maleIds[i];
  const female = femaleIds[i]; // 正解ペア

  const maleTargets = shuffle([female, ...pickDummies(femaleIds, female, 2)]);
  maleTargets.forEach((to, idx) => finalNominations.push({ from: male, to, order: idx + 1 }));

  const femaleTargets = shuffle([male, ...pickDummies(maleIds, male, 2)]);
  femaleTargets.forEach((to, idx) => finalNominations.push({ from: female, to, order: idx + 1 }));
}

// ---- 第一印象（いいね）。computeMatchingには渡さない実データ（要件3の再現用） -----
// 実システムでも like は matching の入力に含めない（好印象は成立条件に使わない仕様）。
for (const id of maleIds) pickDummies(femaleIds, '', randInt(3, 8));
for (const id of femaleIds) pickDummies(maleIds, '', randInt(3, 8));

// ---- 生成データの健全性を実行前に確認（失敗時のみ例外で止める。正常時は無出力） ----
const byFrom = new Map<string, Set<string>>();
for (const n of finalNominations) {
  if (!byFrom.has(n.from)) byFrom.set(n.from, new Set());
  const set = byFrom.get(n.from)!;
  if (set.has(n.to)) throw new Error(`重複指名: ${n.from} -> ${n.to}`);
  set.add(n.to);
}
for (let i = 0; i < COUNT; i++) {
  if (!byFrom.get(maleIds[i])?.has(femaleIds[i])) throw new Error(`正解ペア欠落: M${i + 1}`);
  if (!byFrom.get(femaleIds[i])?.has(maleIds[i])) throw new Error(`正解ペア欠落: W${i + 1}`);
}

// ---- 実行 -------------------------------------------------------------------
const startedAt = performance.now();
const result = computeMatching({ maleIds, femaleIds, nominations: finalNominations, seed });
const elapsedMs = performance.now() - startedAt;

const sortedPairs = [...result.pairs].sort(
  (a, b) => Number(a.maleId.slice(1)) - Number(b.maleId.slice(1)),
);

console.log(`参加人数: Male=${COUNT}, Female=${COUNT}`);
console.log(`実行時間: ${elapsedMs.toFixed(3)} ms`);
console.log(`成立組数: ${result.pairs.length}`);
console.log('成立ペア一覧:');
for (const p of sortedPairs) {
  console.log(`  ${p.maleId} × ${p.femaleId} (score=${p.score})`);
}
