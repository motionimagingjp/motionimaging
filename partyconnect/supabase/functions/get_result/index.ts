/**
 * 結果表示。
 * ★成立時に返すのは相手の参加者番号とニックネームだけ。連絡先は保持していない（仕様 11-1）。
 *   交換は会場で当人同士が対面で行う。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { assertPhase, requireParticipant } from '../_shared/session.ts';

interface Body { sessionToken: string }

/** 結果配信から消去までの猶予（仕様 6-2） */
const PURGE_AFTER_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    const session = await requireParticipant(db, body.sessionToken);
    assertPhase(session, ['result', 'purged']);

    if (session.phase === 'purged') {
      return json({ status: 'purged' });
    }

    const column = session.gender === 'male' ? 'male_participant_id' : 'female_participant_id';
    const { data: match, error } = await db
      .from('matches')
      .select('male_participant_id, female_participant_id')
      .eq('event_id', session.eventId)
      .eq(column, session.id)
      .maybeSingle();
    if (error) throw error;

    const { data: event, error: eventError } = await db
      .from('events').select('finished_at').eq('id', session.eventId).single();
    if (eventError) throw eventError;
    const purgeAt = new Date(Date.parse(event.finished_at) + PURGE_AFTER_MINUTES * 60_000).toISOString();

    if (!match) {
      return json({ status: 'unmatched', purgeAt });
    }

    const partnerId = session.gender === 'male' ? match.female_participant_id : match.male_participant_id;
    const { data: partner, error: partnerError } = await db
      .from('participants')
      .select('gender, participant_number, nickname')
      .eq('id', partnerId)
      .single();
    if (partnerError) throw partnerError;

    return json({
      status: 'matched',
      purgeAt,
      partner: {
        gender: partner.gender,
        number: partner.participant_number,
        nickname: partner.nickname,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
