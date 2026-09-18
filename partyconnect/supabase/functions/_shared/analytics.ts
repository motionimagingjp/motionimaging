/**
 * 主催者向け匿名統計の集計。
 * 仕様: docs/partyconnect_requirements.md 6-3 / 6-2
 *
 * 個人情報を一切含めないこと。ニックネーム・自由記述は入力にも取らない。
 * 該当者が MIN_CATEGORY_SIZE 未満のカテゴリは "other" に丸める（個人特定の防止）。
 */

export interface ParticipantForStats {
  id: string;
  gender: 'male' | 'female';
  status: 'invited' | 'active' | 'withdrawn';
  /** 選択式のプロフィール項目のみ。自由記述は渡さない */
  profileData: Record<string, unknown>;
}

export interface AnalyticsInput {
  participants: ParticipantForStats[];
  matchedPairs: { maleId: string; femaleId: string; score: number }[];
  likeVoteCount: number;
  oneSidedPairsCount: number;
  startedAt: string | null;
  finishedAt: string;
}

export interface AnalyticsRecord {
  total_male_count: number;
  total_female_count: number;
  withdrawn_count: number;
  matched_pairs_count: number;
  match_rate: number;
  like_vote_count: number;
  one_sided_pairs_count: number;
  duration_minutes: number | null;
  attributes_summary: {
    age_groups: Record<string, number>;
    occupations: Record<string, number>;
    matched_occupation_pairs: Record<string, number>;
  };
}

/** これ未満の人数のカテゴリは "other" に丸める */
export const MIN_CATEGORY_SIZE = 3;

function tally(values: (string | null | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

/** 少人数カテゴリを "other" に集約する。集約後の other 自体は丸めない */
export function roundSmallCategories(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let other = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count < MIN_CATEGORY_SIZE) other += count;
    else out[key] = count;
  }
  if (other > 0) out.other = (out.other ?? 0) + other;
  return out;
}

function stringField(profile: Record<string, unknown>, key: string): string | null {
  const value = profile[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function buildAnalytics(input: AnalyticsInput): AnalyticsRecord {
  const active = input.participants.filter((p) => p.status === 'active');
  const maleCount = active.filter((p) => p.gender === 'male').length;
  const femaleCount = active.filter((p) => p.gender === 'female').length;
  const withdrawnCount = input.participants.filter((p) => p.status === 'withdrawn').length;

  const matchedPairsCount = input.matchedPairs.length;
  const activeCount = maleCount + femaleCount;
  // 成立率は「成立した人数 / active参加者数」。辞退者は母数から外す（6-6）
  const matchRate = activeCount === 0
    ? 0
    : Math.round(((matchedPairsCount * 2) / activeCount) * 10000) / 100;

  let durationMinutes: number | null = null;
  if (input.startedAt) {
    const started = Date.parse(input.startedAt);
    const finished = Date.parse(input.finishedAt);
    if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
      durationMinutes = Math.round((finished - started) / 60000);
    }
  }

  const occupationById = new Map<string, string | null>();
  for (const p of active) occupationById.set(p.id, stringField(p.profileData, 'occupation'));

  const matchedOccupationPairs: Record<string, number> = {};
  for (const pair of input.matchedPairs) {
    const a = occupationById.get(pair.maleId);
    const b = occupationById.get(pair.femaleId);
    if (!a || !b) continue;
    // 男女の別を残すと属性の組み合わせから個人が推定されやすいので、並び順を正規化する
    const key = [a, b].sort().join(' x ');
    matchedOccupationPairs[key] = (matchedOccupationPairs[key] ?? 0) + 1;
  }

  return {
    total_male_count: maleCount,
    total_female_count: femaleCount,
    withdrawn_count: withdrawnCount,
    matched_pairs_count: matchedPairsCount,
    match_rate: matchRate,
    like_vote_count: input.likeVoteCount,
    one_sided_pairs_count: input.oneSidedPairsCount,
    duration_minutes: durationMinutes,
    attributes_summary: {
      age_groups: roundSmallCategories(tally(active.map((p) => stringField(p.profileData, 'age_group')))),
      occupations: roundSmallCategories(tally(active.map((p) => stringField(p.profileData, 'occupation')))),
      matched_occupation_pairs: roundSmallCategories(matchedOccupationPairs),
    },
  };
}
