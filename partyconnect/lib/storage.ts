/**
 * 端末内の保存。
 * 会場は電波が弱い前提のため、入力は送信前から端末に残す（仕様 10章）。
 * ブラウザを閉じても番号が失われないよう、セッションもここに持つ（仕様 4-1①）。
 */
const SESSION_KEY = 'pc.sessionToken';
const DRAFT_KEY = 'pc.profileDraft';
const VOTE_KEY_PREFIX = 'pc.voteDraft.';
const MEMO_KEY_PREFIX = 'pc.memo.';

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
  // どのイベントの下書きかを必ず持つ。持たないと、前回のイベントの入力が
  // 次のイベントの編集画面に混ざってしまう
  eventId: string;
  nickname: string;
  profileData: Record<string, string | string[]>;
  freeText: string;
}

export function loadProfileDraft(eventId: string): ProfileDraft | null {
  const raw = read(DRAFT_KEY);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as ProfileDraft;
    return draft.eventId === eventId ? draft : null;
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

/**
 * 歓談中の自分用メモ。「3番の人は料理好き」のように、番号と人を結び付けて覚えておくためのもの。
 * ★サーバーには一切送らない。端末の中だけに置き、イベント終了(purge)で消す。
 *   送ってしまうと、アプリが参加者の私的な評価を預かることになり消去の約束が増える。
 */
export type MemoMap = Record<string, string>;

export function loadMemos(eventId: string): MemoMap {
  const raw = read(MEMO_KEY_PREFIX + eventId);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as MemoMap : {};
  } catch {
    return {};
  }
}

export const saveMemos = (eventId: string, memos: MemoMap) =>
  write(MEMO_KEY_PREFIX + eventId, JSON.stringify(memos));

/** イベント終了時の後始末。メモと投票の下書きを端末から消す */
export function clearEventLocalData(eventId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(MEMO_KEY_PREFIX + eventId);
    window.localStorage.removeItem(VOTE_KEY_PREFIX + 'like');
    window.localStorage.removeItem(VOTE_KEY_PREFIX + 'final');
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 消せなくても操作は続行させる */
  }
}
