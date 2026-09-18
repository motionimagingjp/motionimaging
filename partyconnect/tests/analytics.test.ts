import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics, roundSmallCategories, type ParticipantForStats } from '../supabase/functions/_shared/analytics.ts';

const p = (
  id: string, gender: 'male' | 'female', status: ParticipantForStats['status'],
  profileData: Record<string, unknown> = {},
): ParticipantForStats => ({ id, gender, status, profileData });

const base = {
  matchedPairs: [] as { maleId: string; femaleId: string; score: number }[],
  likeVoteCount: 0,
  oneSidedPairsCount: 0,
  startedAt: '2026-09-08T10:00:00Z',
  finishedAt: '2026-09-08T12:00:00Z',
};

test('辞退者は人数と成立率の母数から外れ、withdrawn_count に計上される', () => {
  const r = buildAnalytics({
    ...base,
    participants: [
      p('m1', 'male', 'active'), p('m2', 'male', 'active'),
      p('f1', 'female', 'active'), p('f2', 'female', 'withdrawn'),
      p('m3', 'male', 'invited'),
    ],
    matchedPairs: [{ maleId: 'm1', femaleId: 'f1', score: 6 }],
  });
  assert.equal(r.total_male_count, 2);
  assert.equal(r.total_female_count, 1);
  assert.equal(r.withdrawn_count, 1);
  // 成立2名 / active3名
  assert.equal(r.match_rate, 66.67);
});

test('成立ゼロでも例外にならない', () => {
  const r = buildAnalytics({ ...base, participants: [] });
  assert.equal(r.match_rate, 0);
  assert.equal(r.matched_pairs_count, 0);
});

test('所要時間を分で記録する', () => {
  assert.equal(buildAnalytics({ ...base, participants: [] }).duration_minutes, 120);
  assert.equal(buildAnalytics({ ...base, participants: [], startedAt: null }).duration_minutes, null);
});

test('該当3名未満の属性は other に丸める', () => {
  assert.deepEqual(roundSmallCategories({ IT: 4, Medical: 3, Service: 2, Other1: 1 }),
    { IT: 4, Medical: 3, other: 3 });
  assert.deepEqual(roundSmallCategories({ A: 1, B: 1 }), { other: 2 });
  assert.deepEqual(roundSmallCategories({}), {});
});

test('属性集計に少人数カテゴリがそのまま残らない', () => {
  const r = buildAnalytics({
    ...base,
    participants: [
      p('m1', 'male', 'active', { age_group: '30s', occupation: 'IT' }),
      p('m2', 'male', 'active', { age_group: '30s', occupation: 'IT' }),
      p('m3', 'male', 'active', { age_group: '30s', occupation: 'IT' }),
      p('f1', 'female', 'active', { age_group: '20s', occupation: 'Medical' }),
    ],
  });
  assert.deepEqual(r.attributes_summary.age_groups, { '30s': 3, other: 1 });
  assert.deepEqual(r.attributes_summary.occupations, { IT: 3, other: 1 });
});

test('統計に個人情報が入らない', () => {
  const r = buildAnalytics({
    ...base,
    participants: [p('m1', 'male', 'active', { occupation: 'IT', nickname: 'たろう' })],
  });
  const json = JSON.stringify(r);
  assert.ok(!json.includes('たろう'));
  assert.ok(!json.includes('m1'));
});

test('成立ペアの職業の組は順序を正規化して数える', () => {
  const r = buildAnalytics({
    ...base,
    participants: [
      p('m1', 'male', 'active', { occupation: 'IT' }), p('f1', 'female', 'active', { occupation: 'Medical' }),
      p('m2', 'male', 'active', { occupation: 'Medical' }), p('f2', 'female', 'active', { occupation: 'IT' }),
      p('m3', 'male', 'active', { occupation: 'IT' }), p('f3', 'female', 'active', { occupation: 'Medical' }),
    ],
    matchedPairs: [
      { maleId: 'm1', femaleId: 'f1', score: 6 },
      { maleId: 'm2', femaleId: 'f2', score: 4 },
      { maleId: 'm3', femaleId: 'f3', score: 4 },
    ],
  });
  // IT x Medical と Medical x IT を同一視して3件
  assert.deepEqual(r.attributes_summary.matched_occupation_pairs, { 'IT x Medical': 3 });
});
