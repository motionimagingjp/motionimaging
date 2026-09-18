/**
 * Edge Function クライアント。
 * 参加者は Supabase のテーブルを直接触らない（RLSがデフォルト拒否）。通信は必ずここを通す。
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function callFunction<T>(
  name: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // 会場は電波が弱い前提。通信断は例外ではなく通常の状態として扱う
    throw new ApiError('通信できませんでした。電波の良い場所で再度お試しください', 0);
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    throw new ApiError(
      typeof payload.error === 'string' ? payload.error : '処理に失敗しました',
      response.status,
      typeof payload.code === 'string' ? payload.code : undefined,
    );
  }
  return payload as T;
}

// ---- 参加者向け ----

export interface CheckinResult {
  sessionToken: string;
  gender: 'male' | 'female';
  participantNumber: number;
  nickname: string | null;
}

export const checkin = (body: {
  sessionToken?: string; checkinToken?: string; claimCode?: string; agreed: boolean;
}) => callFunction<CheckinResult>('checkin', body);

export const saveProfile = (body: {
  sessionToken: string; nickname: string; profileData: Record<string, string>; freeText: string;
}) => callFunction<{ ok: true }>('save_profile', body);

export interface ParticipantCard {
  gender: 'male' | 'female';
  number: number;
  nickname: string | null;
  profile: Record<string, string>;
  freeText: string | null;
  isSelf: boolean;
  likedMe: boolean;
}

export interface ListResult {
  phase: string;
  self: { gender: 'male' | 'female'; number: number | null };
  hasLikes: boolean;
  participants: ParticipantCard[];
}

export const listParticipants = (sessionToken: string) =>
  callFunction<ListResult>('list_participants', { sessionToken });

export const submitVote = (body: {
  sessionToken: string; voteType: 'like' | 'final'; targetNumbers: number[];
}) => callFunction<{ ok: true; submittedCount: number }>('submit_vote', body);

export type ResultPayload =
  | { status: 'purged' }
  | { status: 'unmatched'; purgeAt: string }
  | {
    status: 'matched';
    purgeAt: string;
    partner: { gender: 'male' | 'female'; number: number; nickname: string | null };
  };

export const getResult = (sessionToken: string) =>
  callFunction<ResultPayload>('get_result', { sessionToken });

// ---- 主催者向け ----

export interface Progress {
  invited: number; checkedIn: number; male: number; female: number;
  withdrawn: number; profileCompleted: number; likeVoted: number; finalVoted: number;
}

export const organizerCall = <T>(body: Record<string, unknown>, accessToken: string) =>
  callFunction<T>('organizer', body, accessToken);

export const finalizeEvent = (eventId: string, accessToken: string) =>
  callFunction<{ matchedPairsCount: number; matchRate: number }>(
    'finalize_event', { eventId }, accessToken);

export const purgeEvent = (eventId: string, accessToken: string) =>
  callFunction<{ purged: boolean }>('purge', { eventId }, accessToken);
