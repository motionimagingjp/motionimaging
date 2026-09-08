/**
 * 確定（仕様 6-2 フェーズA）。
 * マッチング計算 -> 統計の算出 -> finalize_event_commit で「結果・統計・phase」を一括書き込み。
 * 統計は必ず結果配信より前に確定させる。順序を入れ替えないこと。
 */
import { requireOrganizer, serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { computeMatching, type Nomination } from '../_shared/matching.ts';
import { buildAnalytics, type ParticipantForStats } from '../_shared/analytics.ts';

interface Body { eventId: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const organizerId = await requireOrganizer(req).catch(() => {
      throw new AppError('ログインが必要です', 401);
    });
    const body = await readJson<Body>(req);
    const db = serviceClient();

    const { data: event, error: eventError } = await db
      .from('events').select('id, organizer_id, seed_value, status, started_at')
      .eq('id', body.eventId).single();
    if (eventError) throw eventError;
    if (event.organizer_id !== organizerId) throw new AppError('権限がありません', 403);
    if (event.status === 'purged') throw new AppError('消去済みのイベントです', 409);

    const { data: participants, error: pError } = await db
      .from('participants')
      .select('id, gender, status, profile_data')
      .eq('event_id', event.id);
    if (pError) throw pError;

    const active = participants.filter((p) => p.status === 'active');
    const activeIds = new Set(active.map((p) => p.id as string));

    const { data: votes, error: vError } = await db
      .from('votes')
      .select('from_participant_id, to_participant_id, vote_type, preference_order')
      .eq('event_id', event.id);
    if (vError) throw vError;

    // 辞退者が絡む投票はここで落とす（仕様 6-6）
    const nominations: Nomination[] = votes
      .filter((v) => v.vote_type === 'final')
      .filter((v) => activeIds.has(v.from_participant_id) && activeIds.has(v.to_participant_id))
      .map((v) => ({
        from: v.from_participant_id,
        to: v.to_participant_id,
        order: v.preference_order as number,
      }));

    const matching = computeMatching({
      maleIds: active.filter((p) => p.gender === 'male').map((p) => p.id as string),
      femaleIds: active.filter((p) => p.gender === 'female').map((p) => p.id as string),
      nominations,
      seed: event.seed_value,
    });

    const statsInput: ParticipantForStats[] = participants.map((p) => ({
      id: p.id as string,
      gender: p.gender as 'male' | 'female',
      status: p.status as ParticipantForStats['status'],
      profileData: (p.profile_data ?? {}) as Record<string, unknown>,
    }));

    const analytics = buildAnalytics({
      participants: statsInput,
      matchedPairs: matching.pairs,
      likeVoteCount: votes.filter((v) => v.vote_type === 'like').length,
      oneSidedPairsCount: matching.oneSidedPairsCount,
      startedAt: event.started_at,
      finishedAt: new Date().toISOString(),
    });

    const { data: committed, error: commitError } = await db.rpc('finalize_event_commit', {
      p_event_id: event.id,
      p_pairs: matching.pairs.map((pair) => ({
        male_participant_id: pair.maleId,
        female_participant_id: pair.femaleId,
        score: pair.score,
      })),
      p_analytics: analytics,
    });
    if (commitError) throw commitError;

    return json({
      matchedPairsCount: (committed as { matched_pairs_count: number }).matched_pairs_count,
      matchRate: (committed as { match_rate: number }).match_rate,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
