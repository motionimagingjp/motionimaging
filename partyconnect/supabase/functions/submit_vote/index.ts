/**
 * 投票の登録。好印象(like) と最終希望(final) の両方を扱う。
 * ★ from_participant_id はクライアントの申告を使わず、必ず session_token から解決する（仕様 7-5）。
 * ★ クライアントは参加者番号しか知らない。番号 -> ID の解決はサーバ側で行う。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { assertCheckedIn, assertPhase, requireParticipant } from '../_shared/session.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

interface Body {
  sessionToken: string;
  voteType: 'like' | 'final';
  /** like: 番号の配列 / final: 第1〜第3希望の順に並べた番号の配列（最大3件） */
  targetNumbers: number[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    const session = await requireParticipant(db, body.sessionToken);
    assertCheckedIn(session);
    if (!checkRateLimit(`vote:${body.sessionToken}`, 30)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }

    if (body.voteType === 'like') assertPhase(session, ['like_vote']);
    else if (body.voteType === 'final') assertPhase(session, ['final_vote']);
    else throw new AppError('投票種別が不正です');

    const numbers = Array.isArray(body.targetNumbers) ? body.targetNumbers : [];
    if (new Set(numbers).size !== numbers.length) {
      throw new AppError('同じ相手を複数回選ぶことはできません');
    }
    if (body.voteType === 'final' && numbers.length > 3) {
      throw new AppError('最終希望は第3希望までです');
    }

    // 異性かつ active の参加者に限定して番号を解決する
    const oppositeGender = session.gender === 'male' ? 'female' : 'male';
    const { data: targets, error: targetError } = await db
      .from('participants')
      .select('id, participant_number')
      .eq('event_id', session.eventId)
      .eq('gender', oppositeGender)
      .eq('status', 'active')
      .in('participant_number', numbers.length > 0 ? numbers : [-1]);
    if (targetError) throw targetError;

    const idByNumber = new Map(targets.map((t) => [t.participant_number as number, t.id as string]));
    for (const n of numbers) {
      if (!idByNumber.has(n)) throw new AppError(`${n}番の方は選択できません`);
    }

    // 投票し直しを許すため、いったん自分の同種の投票を消してから入れ直す
    const { error: deleteError } = await db.from('votes').delete()
      .eq('event_id', session.eventId)
      .eq('from_participant_id', session.id)
      .eq('vote_type', body.voteType);
    if (deleteError) throw deleteError;

    if (numbers.length > 0) {
      const rows = numbers.map((n, index) => ({
        event_id: session.eventId,
        from_participant_id: session.id,
        to_participant_id: idByNumber.get(n)!,
        vote_type: body.voteType,
        preference_order: body.voteType === 'final' ? index + 1 : null,
      }));
      const { error: insertError } = await db.from('votes').insert(rows);
      if (insertError) throw insertError;
    }

    // 投票内容そのものは返さない
    return json({ ok: true, submittedCount: numbers.length });
  } catch (error) {
    return toErrorResponse(error);
  }
});
