/**
 * PartyConnect マッチングアルゴリズム
 * 仕様: docs/partyconnect_requirements.md 5章
 *
 * - 相互指名のみ成立（片側指名は成立させない）
 * - 第1希望=3点 / 第2希望=2点 / 第3希望=1点、ペアスコア = 双方の点の合計（2〜6）
 * - 目的関数: 成立ペア数の最大化を最優先、同数ならスコア合計が最大
 * - seed により何度計算しても同一結果
 * - 整数演算のみ（浮動小数点を使わない）
 */

export interface Nomination {
  from: string;
  to: string;
  /** 1 | 2 | 3 */
  order: number;
}

export interface MatchingInput {
  /** status='active' の男性参加者ID。辞退者は呼び出し側で除外しておくこと */
  maleIds: string[];
  /** status='active' の女性参加者ID */
  femaleIds: string[];
  nominations: Nomination[];
  /** events.seed_value */
  seed: number;
}

export interface MatchedPair {
  maleId: string;
  femaleId: string;
  /** 2〜6 */
  score: number;
}

export interface MatchingResult {
  pairs: MatchedPair[];
  /** 片側だけの指名で成立しなかった組の数（5-1の方針検証用。event_analytics に記録する） */
  oneSidedPairsCount: number;
}

/** 希望順位 -> 点数 */
const PREFERENCE_POINTS: Record<number, number> = { 1: 3, 2: 2, 3: 1 };

/**
 * 1ペア成立ごとに加算する定数。
 * 「ペア数最優先 → 同数ならスコア最大」を単一の重み最大化で表現するために使う。
 * 成立が1つ増える利得(>= PAIR_BONUS + 2)が、同ペア数内での並べ替えによるスコア差の
 * 最大値(4k)を常に上回る必要があるため、k < (PAIR_BONUS + 2) / 4 が条件。
 * PAIR_BONUS = 1000 なら k <= 250 まで安全。
 */
const PAIR_BONUS = 1000;
const MAX_SAFE_PAIRS = Math.floor((PAIR_BONUS + 2 - 1) / 4);

/** xorshift32。seed が同じなら必ず同じ列を返す */
function createRng(seed: number): () => number {
  let x = seed >>> 0;
  if (x === 0) x = 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
}

/** seed 由来の決定的シャッフル。入力順の揺らぎを取り除き再現性を担保する */
function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * 割当問題（最小化）を解く O(n^3) ハンガリー法。
 * a は 1-indexed の (n+1) x (m+1) 行列で n <= m であること。
 * 戻り値 assign[i] は行 i(0-indexed) に割り当てられた列(0-indexed)。
 */
function hungarianMin(a: number[][], n: number, m: number): number[] {
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assign = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assign[p[j] - 1] = j - 1;
  }
  return assign;
}

export function computeMatching(input: MatchingInput): MatchingResult {
  const maleIds = input.maleIds;
  const femaleIds = input.femaleIds;

  if (Math.min(maleIds.length, femaleIds.length) > MAX_SAFE_PAIRS) {
    throw new Error(
      `参加者数が PAIR_BONUS の安全域(${MAX_SAFE_PAIRS}ペア)を超えています。PAIR_BONUS を引き上げてください`,
    );
  }

  const maleSet = new Set(maleIds);
  const femaleSet = new Set(femaleIds);

  // 1) 有効な指名だけを点数表に落とす（異性間・active同士・順位1〜3のみ）
  const points = new Map<string, Map<string, number>>();
  for (const nom of input.nominations) {
    const pts = PREFERENCE_POINTS[nom.order];
    if (pts === undefined) continue;
    const crossGender =
      (maleSet.has(nom.from) && femaleSet.has(nom.to)) ||
      (femaleSet.has(nom.from) && maleSet.has(nom.to));
    if (!crossGender) continue;

    let row = points.get(nom.from);
    if (!row) { row = new Map(); points.set(nom.from, row); }
    const prev = row.get(nom.to);
    // 同一相手に複数順位が入っている異常データは高い方を採用する
    if (prev === undefined || pts > prev) row.set(nom.to, pts);
  }

  // 2) 相互指名のみを候補辺にする。片側指名は数だけ数える
  const edges = new Map<string, Map<string, number>>();
  let oneSidedPairsCount = 0;
  for (const maleId of maleIds) {
    const row = points.get(maleId);
    if (!row) continue;
    for (const [femaleId, malePts] of row) {
      const femalePts = points.get(femaleId)?.get(maleId);
      if (femalePts === undefined) { oneSidedPairsCount++; continue; }
      let e = edges.get(maleId);
      if (!e) { e = new Map(); edges.set(maleId, e); }
      e.set(femaleId, malePts + femalePts);
    }
  }
  for (const femaleId of femaleIds) {
    const row = points.get(femaleId);
    if (!row) continue;
    for (const maleId of row.keys()) {
      if (points.get(maleId)?.get(femaleId) === undefined) oneSidedPairsCount++;
    }
  }

  if (edges.size === 0 || maleIds.length === 0 || femaleIds.length === 0) {
    return { pairs: [], oneSidedPairsCount };
  }

  // 3) seed で決定的に並べ替えてから解く（同点時の結果を seed に固定する）
  const rng = createRng(input.seed);
  const males = seededShuffle(maleIds, rng);
  const females = seededShuffle(femaleIds, rng);

  // 4) 行が短辺になるよう向きを決める（ハンガリー法は n <= m が前提）
  const maleIsRow = males.length <= females.length;
  const rows = maleIsRow ? males : females;
  const cols = maleIsRow ? females : males;
  const n = rows.length;
  const m = cols.length;

  // 5) コスト行列。相互指名の辺は -(PAIR_BONUS + score)、辺なしは 0。
  //    最小化することで「重み最大 = ペア数最優先かつスコア最大」になる。
  const a: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const maleId = maleIsRow ? rows[i] : cols[j];
      const femaleId = maleIsRow ? cols[j] : rows[i];
      const score = edges.get(maleId)?.get(femaleId);
      a[i + 1][j + 1] = score === undefined ? 0 : -(PAIR_BONUS + score);
    }
  }

  const assign = hungarianMin(a, n, m);

  const pairs: MatchedPair[] = [];
  for (let i = 0; i < n; i++) {
    const j = assign[i];
    if (j < 0) continue;
    if (a[i + 1][j + 1] === 0) continue; // 辺のないダミー割当
    const maleId = maleIsRow ? rows[i] : cols[j];
    const femaleId = maleIsRow ? cols[j] : rows[i];
    pairs.push({ maleId, femaleId, score: -a[i + 1][j + 1] - PAIR_BONUS });
  }

  // 出力順も決定的にする
  pairs.sort((x, y) => (x.maleId < y.maleId ? -1 : x.maleId > y.maleId ? 1 : 0));

  return { pairs, oneSidedPairsCount };
}
