/**
 * 中規模・非対称ストレステスト（男性45名 vs 女性50名）。
 *
 * ★このファイル単体で完結する。qa/data 配下には何も追加しない。
 * ★参加者・投票データはすべて実行時にオンメモリで生成し、ディスクには一切書き出さない。
 * ★実際にデプロイされているマッチングロジック本体（_shared/matching.ts）を直接呼び出す。
 *
 * 実行方法:
 *   deno run --allow-read qa/algorithm-stress-test.ts
 *   deno run --allow-read qa/algorithm-stress-test.ts --seed=12345   # 再現したい場合
 */
import { computeMatching, type Nomination } from '../supabase/functions/_shared/matching.ts';

const MALE_COUNT = 45;
const FEMALE_COUNT = 50;
const POPULAR_MALES = ['M1', 'M2'];
const POPULAR_FEMALES = ['W1', 'W2'];
const POPULAR_BIAS_PROB = 0.2; // 人気者に票が集中する確率

const seedArg = Deno.args.find((a) => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : Date.now();

// mulberry32。seedを固定すれば毎回同じデータで再現できる
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

const maleIds = Array.from({ length: MALE_COUNT }, (_, i) => `M${i + 1}`);
const femaleIds = Array.from({ length: FEMALE_COUNT }, (_, i) => `W${i + 1}`);

/**
 * 異性から重複なくn件選ぶ。POPULAR_BIAS_PROBの確率で人気者(未選択なら)を優先的に選ぶ。
 */
function pickTargets(pool: string[], popular: string[], count: number): string[] {
  const remaining = [...pool];
  const picked: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const availablePopular = popular.filter((p) => remaining.includes(p));
    let choice: string;
    if (availablePopular.length > 0 && rng() < POPULAR_BIAS_PROB) {
      choice = availablePopular[randInt(0, availablePopular.length - 1)];
    } else {
      choice = remaining[randInt(0, remaining.length - 1)];
    }
    picked.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  return picked;
}

const nominations: Nomination[] = [];

// 第一印象（好印象）: 各3〜8名。順位は付かないため matching には使わないが、生成ロジックとして用意する
for (const id of maleIds) pickTargets(femaleIds, POPULAR_FEMALES, randInt(3, 8));
for (const id of femaleIds) pickTargets(maleIds, POPULAR_MALES, randInt(3, 8));

// 最終投票: 各最大3名（1〜3名）。順位1〜3がそのままmatchingの点数になる
for (const id of maleIds) {
  const targets = pickTargets(femaleIds, POPULAR_FEMALES, randInt(1, 3));
  targets.forEach((to, i) => nominations.push({ from: id, to, order: i + 1 }));
}
for (const id of femaleIds) {
  const targets = pickTargets(maleIds, POPULAR_MALES, randInt(1, 3));
  targets.forEach((to, i) => nominations.push({ from: id, to, order: i + 1 }));
}

const startedAt = performance.now();
const result = computeMatching({ maleIds, femaleIds, nominations, seed });
const elapsedMs = performance.now() - startedAt;

const sortedPairs = [...result.pairs].sort(
  (a, b) => Number(a.maleId.slice(1)) - Number(b.maleId.slice(1)),
);

console.log(`参加人数: Male=${MALE_COUNT}, Female=${FEMALE_COUNT}`);
console.log(`実行時間: ${elapsedMs.toFixed(3)} ms`);
console.log(`成立組数: ${result.pairs.length}`);
console.log('成立ペア一覧:');
for (const p of sortedPairs) {
  console.log(`  ${p.maleId} × ${p.femaleId} (score=${p.score})`);
}
