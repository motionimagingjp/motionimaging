/**
 * Edge Function クライアント。
 * 参加者は Supabase のテーブルを直接触らない（RLSがデフォルト拒否）。通信は必ずここを通す。
 * 例外は写真アップロードのみ：署名付きURLへのPUTはRLSもテーブルアクセスも経由しないため、
 * ここでだけ Supabase Storage クライアントを直接使う。
 */
import { createClient } from '@supabase/supabase-js';

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

export interface Branding {
  companyName: string | null;
  brandColor: string | null;
  logoUrl: string | null;
}

export interface CheckinResult {
  sessionToken: string;
  eventId: string;
  gender: 'male' | 'female';
  // null = まだ会場到着チェックインが済んでいない（事前入力のみの状態）
  participantNumber: number | null;
  nickname: string | null;
  // 保存済みのプロフィール。編集画面をこれで初期化する（空で開くと上書き消去になる）
  profileData: Record<string, string | string[]>;
  freeText: string | null;
  // null = 全項目使用。イベントごとに主催者が使う項目だけを絞り込める
  enabledProfileFields: string[] | null;
  branding: Branding;
}

/**
 * 受付。
 *  - checkinToken + claimCode（会場掲示QR経由）: 出席登録・番号採番まで行われる
 *  - prelinkToken + claimCode（事前案内のイベント共通リンク経由）: 出席登録はされない
 *  - sessionToken（端末に残ったセッション）: 出席登録はされない
 */
export const checkin = (body: {
  sessionToken?: string; checkinToken?: string; prelinkToken?: string;
  claimCode?: string; agreed: boolean;
}) => callFunction<CheckinResult>('checkin', body);

// 受付コード入力前（未認証）でも呼べる、主催者のブランド設定の取得
export const getBranding = (body: { checkinToken?: string; prelinkToken?: string }) =>
  callFunction<Branding>('branding', body);

export const saveProfile = (body: {
  sessionToken: string; nickname: string; profileData: Record<string, string | string[]>; freeText: string;
}) => callFunction<{ ok: true }>('save_profile', body);

export const getPhotoUploadUrl = (sessionToken: string) =>
  callFunction<{ path: string; token: string }>('photo', { sessionToken });

let storageOnlyClient: ReturnType<typeof createClient> | null = null;
function storageClient() {
  if (!storageOnlyClient) storageOnlyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return storageOnlyClient;
}

export async function uploadPhoto(sessionToken: string, file: File): Promise<void> {
  const { path, token } = await getPhotoUploadUrl(sessionToken);
  const { error } = await storageClient().storage
    .from('participant-photos')
    .uploadToSignedUrl(path, token, file, { upsert: true, contentType: file.type });
  if (error) throw new ApiError(error.message, 0);
}

export interface ParticipantCard {
  gender: 'male' | 'female';
  number: number;
  nickname: string | null;
  profile: Record<string, string | string[]>;
  freeText: string | null;
  photoUrl: string | null;
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

export interface PendingVoter { gender: 'male' | 'female'; number: number }

export interface Progress {
  invited: number; checkedIn: number; male: number; female: number;
  withdrawn: number; profileCompleted: number; likeVoted: number; finalVoted: number;
  pendingLike: PendingVoter[]; pendingFinal: PendingVoter[];
}

export interface PairNumbers { male: number | null; female: number | null }

export type MatchingMode = 'max_pairs' | 'greedy_priority';

export interface PreviewResult {
  matchingMode: MatchingMode;
  matchedPairsCount: number;
  oneSidedPairsCount: number;
  pairs: PairNumbers[];
}

export const organizerCall = <T>(body: Record<string, unknown>, accessToken: string) =>
  callFunction<T>('organizer', body, accessToken);

export const finalizeEvent = (eventId: string, accessToken: string) =>
  callFunction<{ matchedPairsCount: number; matchRate: number }>(
    'finalize_event', { eventId }, accessToken);

export const purgeEvent = (eventId: string, accessToken: string) =>
  callFunction<{ purged: boolean }>('purge', { eventId }, accessToken);

// ロゴは非公開バケットではないため、署名付きURLを介さず本人の supabase-js クライアントで
// 直接アップロードする（storage.objects のRLSで自分のフォルダ配下にしか書けない）
export async function uploadOrganizerLogo(
  storage: ReturnType<typeof createClient>['storage'], organizerId: string, file: File,
): Promise<string> {
  const path = `${organizerId}/logo`;
  const { error } = await storage.from('organizer-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new ApiError(error.message, 0);
  return path;
}
