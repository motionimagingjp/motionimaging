/**
 * 端末内の保存。
 * 会場は電波が弱い前提のため、入力は送信前から端末に残す（仕様 10章）。
 * ブラウザを閉じても番号が失われないよう、セッションもここに持つ（仕様 4-1①）。
 */
const SESSION_KEY = 'pc.sessionToken';
const DRAFT_KEY = 'pc.profileDraft';
const VOTE_KEY_PREFIX = 'pc.voteDraft.';

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // プライベートブラウジング等で例外になることがある
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても操作は続行させる */
  }
}

export const loadSessionToken = () => read(SESSION_KEY);
export const saveSessionToken = (token: string) => write(SESSION_KEY, token);

export interface ProfileDraft {
  nickname: string;
  profileData: Record<string, string>;
  freeText: string;
}

export function loadProfileDraft(): ProfileDraft | null {
  const raw = read(DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProfileDraft;
  } catch {
    return null;
  }
}

export const saveProfileDraft = (draft: ProfileDraft) => write(DRAFT_KEY, JSON.stringify(draft));

export function loadVoteDraft(voteType: 'like' | 'final'): number[] {
  const raw = read(VOTE_KEY_PREFIX + voteType);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export const saveVoteDraft = (voteType: 'like' | 'final', numbers: number[]) =>
  write(VOTE_KEY_PREFIX + voteType, JSON.stringify(numbers));
