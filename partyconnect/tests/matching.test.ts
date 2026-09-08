import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMatching, type Nomination } from '../supabase/functions/_shared/matching.ts';

const nom = (from: string, to: string, order: number): Nomination => ({ from, to, order });

test('相互第1希望のペアが成立する', () => {
  const r = computeMatching({
    maleIds: ['m1'], femaleIds: ['f1'],
    nominations: [nom('m1', 'f1', 1), nom('f1', 'm1', 1)],
    seed: 1,
  });
  assert.deepEqual(r.pairs, [{ maleId: 'm1', femaleId: 'f1', score: 6 }]);
  assert.equal(r.oneSidedPairsCount, 0);
});

test('片側指名は成立させず、件数だけ数える', () => {
  const r = computeMatching({
    maleIds: ['m1', 'm2'], femaleIds: ['f1'],
    nominations: [nom('m1', 'f1', 1), nom('m2', 'f1', 1), nom('f1', 'm2', 3)],
    seed: 1,
  });
  assert.deepEqual(r.pairs, [{ maleId: 'm2', femaleId: 'f1', score: 4 }]);
  // m1 -> f1 の片側のみが1組
  assert.equal(r.oneSidedPairsCount, 1);
});

test('スコア合計よりも成立ペア数を優先する', () => {
  // {m1-f1} だけなら 1組6点。{m1-f2, m2-f1} なら 2組4点。ペア数優先で後者を選ぶ
  const r = computeMatching({
    maleIds: ['m1', 'm2'], femaleIds: ['f1', 'f2'],
    nominations: [
      nom('m1', 'f1', 1), nom('f1', 'm1', 1),
      nom('m1', 'f2', 3), nom('f2', 'm1', 3),
      nom('m2', 'f1', 3), nom('f1', 'm2', 3),
    ],
    seed: 12345,
  });
  assert.equal(r.pairs.length, 2);
  assert.deepEqual(
    r.pairs.map((p) => `${p.maleId}-${p.femaleId}`).sort(),
    ['m1-f2', 'm2-f1'],
  );
});

test('ペア数が同じならスコア合計が最大の組み合わせを選ぶ', () => {
  // 1組しか作れない。m1-f1(6点) と m1-f2(2点) のうち高い方
  const r = computeMatching({
    maleIds: ['m1'], femaleIds: ['f1', 'f2'],
    nominations: [
      nom('m1', 'f1', 1), nom('f1', 'm1', 1),
      nom('m1', 'f2', 3), nom('f2', 'm1', 3),
    ],
    seed: 7,
  });
  assert.deepEqual(r.pairs, [{ maleId: 'm1', femaleId: 'f1', score: 6 }]);
});

test('1人1ペアの制約を守る', () => {
  const r = computeMatching({
    maleIds: ['m1'], femaleIds: ['f1', 'f2', 'f3'],
    nominations: [
      nom('m1', 'f1', 1), nom('f1', 'm1', 1),
      nom('m1', 'f2', 2), nom('f2', 'm1', 1),
      nom('m1', 'f3', 3), nom('f3', 'm1', 1),
    ],
    seed: 99,
  });
  assert.equal(r.pairs.length, 1);
});

test('辞退者(IDリストに無い参加者)は入力から除外される', () => {
  const r = computeMatching({
    maleIds: ['m1'], femaleIds: ['f1'], // f2 は辞退済み
    nominations: [
      nom('m1', 'f2', 1), nom('f2', 'm1', 1),
      nom('m1', 'f1', 2), nom('f1', 'm1', 2),
    ],
    seed: 3,
  });
  assert.deepEqual(r.pairs, [{ maleId: 'm1', femaleId: 'f1', score: 4 }]);
  assert.equal(r.oneSidedPairsCount, 0);
});

test('同性への指名は無視する', () => {
  const r = computeMatching({
    maleIds: ['m1', 'm2'], femaleIds: ['f1'],
    nominations: [nom('m1', 'm2', 1), nom('m2', 'm1', 1)],
    seed: 3,
  });
  assert.deepEqual(r.pairs, []);
  assert.equal(r.oneSidedPairsCount, 0);
});

test('指名が1件も無ければ全員不成立', () => {
  const r = computeMatching({ maleIds: ['m1', 'm2'], femaleIds: ['f1'], nominations: [], seed: 3 });
  assert.deepEqual(r.pairs, []);
});

// --- 再現性 ---

function buildLargeInput(seed: number, size: number) {
  const maleIds = Array.from({ length: size }, (_, i) => `m${i + 1}`);
  const femaleIds = Array.from({ length: size }, (_, i) => `f${i + 1}`);
  // 決定的に「全員が3人ずつ指名する」データを作る
  const nominations: Nomination[] = [];
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < 3; k++) {
      nominations.push(nom(`m${i + 1}`, `f${((i * 7 + k * 11) % size) + 1}`, k + 1));
      nominations.push(nom(`f${i + 1}`, `m${((i * 5 + k * 13) % size) + 1}`, k + 1));
    }
  }
  return { maleIds, femaleIds, nominations, seed };
}

test('同一入力・同一seedなら100回計算しても結果が完全に一致する', () => {
  const input = buildLargeInput(20260908, 50);
  const first = JSON.stringify(computeMatching(input));
  for (let i = 0; i < 100; i++) {
    assert.equal(JSON.stringify(computeMatching(input)), first);
  }
});

test('指名の並び順が変わっても結果は変わらない', () => {
  const input = buildLargeInput(4242, 30);
  const shuffled = { ...input, nominations: input.nominations.slice().reverse() };
  assert.equal(
    JSON.stringify(computeMatching(input).pairs.length),
    JSON.stringify(computeMatching(shuffled).pairs.length),
  );
  // ペア数だけでなくスコア合計も一致すること
  const sum = (r: { pairs: { score: number }[] }) => r.pairs.reduce((a, p) => a + p.score, 0);
  assert.equal(sum(computeMatching(input)), sum(computeMatching(shuffled)));
});

test('100名(50x50)の計算が0.1秒以内に終わる', () => {
  const input = buildLargeInput(1, 50);
  const started = performance.now();
  const r = computeMatching(input);
  const elapsed = performance.now() - started;
  assert.ok(r.pairs.length > 0);
  assert.ok(elapsed < 100, `計算に ${elapsed.toFixed(1)}ms かかった（上限100ms）`);
});

test('最適性: 総当たりの最適解と一致する(小規模)', () => {
  // 3x3 を全探索して、ペア数最優先・次にスコア合計の最適解と突き合わせる
  const maleIds = ['m1', 'm2', 'm3'];
  const femaleIds = ['f1', 'f2', 'f3'];
  const nominations: Nomination[] = [
    nom('m1', 'f1', 1), nom('f1', 'm1', 2),
    nom('m1', 'f2', 2), nom('f2', 'm1', 1),
    nom('m2', 'f2', 1), nom('f2', 'm2', 3),
    nom('m2', 'f3', 3), nom('f3', 'm2', 1),
    nom('m3', 'f1', 1), nom('f1', 'm3', 1),
  ];
  const result = computeMatching({ maleIds, femaleIds, nominations, seed: 555 });

  const pts = new Map<string, Map<string, number>>();
  for (const n of nominations) {
    if (!pts.has(n.from)) pts.set(n.from, new Map());
    pts.get(n.from)!.set(n.to, 4 - n.order);
  }
  const scoreOf = (m: string, f: string) => {
    const a = pts.get(m)?.get(f); const b = pts.get(f)?.get(m);
    return a !== undefined && b !== undefined ? a + b : null;
  };
  let best = { count: -1, score: -1 };
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    let count = 0, score = 0;
    for (let i = 0; i < 3; i++) {
      const s = scoreOf(maleIds[i], femaleIds[p[i]]);
      if (s !== null) { count++; score += s; }
    }
    if (count > best.count || (count === best.count && score > best.score)) best = { count, score };
  }
  assert.equal(result.pairs.length, best.count);
  assert.equal(result.pairs.reduce((a, p) => a + p.score, 0), best.score);
});
