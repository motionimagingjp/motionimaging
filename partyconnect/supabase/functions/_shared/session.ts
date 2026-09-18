/**
 * 参加者の認可。
 * ★ from_participant_id はクライアントの申告を一切信用せず、必ず session_token から解決する。
 *   これが「他人になりすました投票」を防ぐ唯一の防御（仕様 7-5）。
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { AppError } from './http.ts';

export interface ParticipantSession {
  id: string;
  eventId: string;
  gender: 'male' | 'female';
  participantNumber: number | null;
  status: 'invited' | 'active' | 'withdrawn';
  nickname: string | null;
  phase: string;
}

export async function requireParticipant(
  db: SupabaseClient,
  sessionToken: unknown,
): Promise<ParticipantSession> {
  if (typeof sessionToken !== 'string' || sessionToken.length < 16) {
    throw new AppError('セッションが不正です', 401);
  }
  const { data, error } = await db
    .from('participants')
    .select('id, event_id, gender, participant_number, status, nickname')
    .eq('session_token', sessionToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('セッションが見つかりません。主催者にお声がけください', 401);
  if (data.status === 'withdrawn') {
    throw new AppError('主催者により受付が取り消されました', 403);
  }

  const { data: state, error: stateError } = await db
    .from('event_states').select('phase').eq('event_id', data.event_id).single();
  if (stateError) throw stateError;

  return {
    id: data.id,
    eventId: data.event_id,
    gender: data.gender,
    participantNumber: data.participant_number,
    status: data.status,
    nickname: data.nickname,
    phase: state.phase,
  };
}

export function assertPhase(session: ParticipantSession, allowed: string[]): void {
  if (!allowed.includes(session.phase)) {
    throw new AppError('now is not the time', 409);
  }
}

export function assertCheckedIn(session: ParticipantSession): void {
  if (session.participantNumber === null || session.status !== 'active') {
    throw new AppError('先に受付を済ませてください', 409);
  }
}
