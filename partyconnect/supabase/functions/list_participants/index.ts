/**
 * 閲覧一覧。
 * ★参加者IDはクライアントへ一切返さない。やり取りは参加者番号だけで行う。
 * ★辞退者は返さない（仕様 6-6）。
 * ★好印象の★は like_reveal フェーズ以降のみ。それ以前は誰が誰に投票したかを一切返さない。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { assertPhase, requireParticipant } from '../_shared/session.ts';
import { decryptOptional } from '../_shared/crypto.ts';
import { PostgresEventKeyStore } from '../_shared/key-store.ts';

interface Body { sessionToken: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    const session = await requireParticipant(db, body.sessionToken);
    assertPhase(session, ['browse', 'like_vote', 'like_reveal', 'final_vote', 'calculating', 'result']);

    const { data, error } = await db
      .from('participants')
      .select('id, gender, participant_number, nickname, profile_data, free_text')
      .eq('event_id', session.eventId)
      .eq('status', 'active')
      .not('participant_number', 'is', null)
      .order('participant_number', { ascending: true });
    if (error) throw error;

    // 自分に好印象を送った相手の番号。開示フェーズ以降のみ集計する
    const likedByNumbers = new Set<number>();
    if (['like_reveal', 'final_vote', 'calculating', 'result'].includes(session.phase)) {
      const { data: likes, error: likeError } = await db
        .from('votes')
        .select('from_participant_id')
        .eq('event_id', session.eventId)
        .eq('vote_type', 'like')
        .eq('to_participant_id', session.id);
      if (likeError) throw likeError;
      const numberById = new Map(data.map((p) => [p.id, p.participant_number as number]));
      for (const like of likes) {
        const n = numberById.get(like.from_participant_id);
        if (n !== undefined) likedByNumbers.add(n);
      }
    }

    const keyStore = new PostgresEventKeyStore(db);
    const dataKey = await keyStore.getKey(session.eventId);

    const cards = await Promise.all(data.map(async (p) => ({
      gender: p.gender,
      number: p.participant_number,
      nickname: p.nickname,
      profile: p.profile_data,
      freeText: await decryptOptional(p.free_text, dataKey),
      isSelf: p.id === session.id,
      likedMe: likedByNumbers.has(p.participant_number as number),
    })));

    return json({
      phase: session.phase,
      self: { gender: session.gender, number: session.participantNumber },
      // 0件を可視化しないため件数は返さない（仕様 4-1④）
      hasLikes: likedByNumbers.size > 0,
      participants: cards,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
