/**
 * アルゴリズム単体検証（サーバー不要・副作用なし）。
 *
 * 実際にデプロイされている _shared/matching.ts の computeMatching をそのまま呼び出す。
 * ネットワークもDBも使わないため、何度実行してもデータを汚さない。
 *
 * 実行方法:
 *   deno run --allow-read qa/algorithm-test.ts
 *
 * ★このスクリプトはマッチング結果を意図的に出力する（--quiet で抑制可）。
 *   「結果を先に見ない」運用にしたい場合は --quiet を付けて実行し、
 *   assertion（構造検証）だけを確認すること。
 */
import { computeMatching, type Nomination } from '../supabase/functions/_shared/matching.ts';
import finals from './data/finals.json' with { type: 'json' };

const quiet = Deno.args.includes('--quiet');

interface FinalRow { id: string; gender: 'male' | 'female'; targetNumbers: number[] }

// id (M1..M10 / W1..W10) をそのまま computeMatching の参加者IDとして使う。
// 実サーバーではUUIDだが、アルゴリズム自体は文字列IDに依存しないため置き換え可能。
const maleIds = (finals as FinalRow[]).filter((r) => r.gender === 'male').map((r) => r.id);
const femaleIds = (finals as FinalRow[]).filter((r) => r.gender === 'female').map((r) => r.id);

// targetNumbers（1〜10）を相手側のID（W1..W10 / M1..M10）に変換する。
// これは submit_vote が「番号 -> ID」を解決する処理を、テスト側で模したもの。
function toId(gender: 'male' | 'female', number: number): string {
  return gender === 'male' ? `M${number}` : `W${number}`;
}

const nominations: Nomination[] = (finals as FinalRow[]).flatMap((row) => {
  const targetGender = row.gender === 'male' ? 'female' : 'male';
  return row.targetNumbers.map((n, index) => ({
    from: row.id,
    to: toId(targetGender, n),
    order: index + 1, // 1=第1希望 2=第2希望 3=第3希望
  }));
});

console.log(`参加者: 男性${maleIds.length}名 / 女性${femaleIds.length}名`);
console.log(`指名数: ${nominations.length}件（20名 × 最大3件）`);

// --- 構造検証（結果の中身を先読みしない、形の妥当性だけを見る） ---------------
function assertShape(seed: number): ReturnType<typeof computeMatching> {
  const result = computeMatching({ maleIds, femaleIds, nominations, seed });

  const usedMales = new Set(result.pairs.map((p) => p.maleId));
  const usedFemales = new Set(result.pairs.map((p) => p.femaleId));
  if (usedMales.size !== result.pairs.length) throw new Error('男性が二重に組まれています');
  if (usedFemales.size !== result.pairs.length) throw new Error('女性が二重に組まれています');
  for (const p of result.pairs) {
    if (!maleIds.includes(p.maleId)) throw new Error(`未知の男性ID: ${p.maleId}`);
    if (!femaleIds.includes(p.femaleId)) throw new Error(`未知の女性ID: ${p.femaleId}`);
    if (p.score < 2 || p.score > 6) throw new Error(`スコア範囲外: ${p.score}`);
  }
  if (result.pairs.length > Math.min(maleIds.length, femaleIds.length)) {
    throw new Error('ペア数が参加者数を超えています');
  }
  return result;
}

const seeds = [1, 42, 999, 123456789];
const results = seeds.map((s) => assertShape(s));

// seed が変わっても「成立ペア数」自体は変わらないはず（目的関数はペア数最優先のため）。
// 変わる場合は同点内での並べ替えの結果であり、バグではない可能性もあるが要目視確認。
const counts = new Set(results.map((r) => r.pairs.length));
console.log(`\n各シードでの成立ペア数: ${results.map((r) => r.pairs.length).join(', ')}`);
if (counts.size > 1) {
  console.warn('⚠ シードによって成立ペア数が異なります。目的関数（ペア数最優先）を見直してください。');
} else {
  console.log('✓ シードを変えてもペア数は一定でした（期待どおり）。');
}

// 同一seedでの再現性（決定性）
const rerun = assertShape(42);
const same = JSON.stringify(results[1].pairs) === JSON.stringify(rerun.pairs);
console.log(same ? '✓ 同一seedでの再現性: OK' : '⚠ 同一seedでの再現性: NG（非決定的になっています）');

console.log('\n✓ 構造検証はすべて通過しました（二重割当なし・スコア範囲内・IDの整合性）。');

if (!quiet) {
  const base = results[0];
  console.log(`\n--- seed=${seeds[0]} での結果 ---`);
  console.log(`成立: ${base.pairs.length}組 / 片想いのみ: ${base.oneSidedPairsCount}組`);
  for (const p of base.pairs) console.log(`  ${p.maleId} × ${p.femaleId} (score=${p.score})`);
} else {
  console.log('\n(--quiet 指定のため、成立ペアの中身は表示していません)');
}
