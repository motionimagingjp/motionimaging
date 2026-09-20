/**
 * 第一印象（好印象/いいね）機能の堅牢性検証。
 *
 * ★単一ファイルで完結。qa/data配下・新規フォルダは一切作成しない。
 * ★DBにもファイルにも書き込まない。実際の submit_vote / list_participants
 *   （supabase/functions/submit_vote, list_participants）のロジックを
 *   オンメモリで忠実に再現してテストする。
 *
 * 実装上の重要な前提（実コードに合わせている）:
 *   - 相手は必ず「送信者と異性」かつ status=active のテーブルからしか解決しない。
 *     クライアントは相手の性別やIDを直接指定できないため、同性への送信は
 *     「そもそも異性テーブルの中に存在しない」という形で弾かれる。
 *   - 好印象の再送信は「差分追加」ではなく「その人の同種の投票を全削除してから
 *     入れ直す」方式（実際の submit_vote と同じ）。そのため同じ内容を2回送っても
 *     行が重複することはない。
 *
 * 実行方法: deno run --allow-read qa/likes-test.ts
 */

interface Participant {
  id: string;
  gender: 'male' | 'female';
  number: number;
  nickname: string;
  status: 'active';
}

const MALE_COUNT = 50;
const FEMALE_COUNT = 50;
const EVENT_ID = 'qa-likes-test';

const males: Participant[] = Array.from({ length: MALE_COUNT }, (_, i) => ({
  id: `M${i + 1}`, gender: 'male', number: i + 1, nickname: `M${i + 1}`, status: 'active',
}));
const females: Participant[] = Array.from({ length: FEMALE_COUNT }, (_, i) => ({
  id: `W${i + 1}`, gender: 'female', number: i + 1, nickname: `W${i + 1}`, status: 'active',
}));
const byId = new Map<string, Participant>([...males, ...females].map((p) => [p.id, p]));

interface VoteRow { event_id: string; from: string; to: string; vote_type: 'like' }
const votes: VoteRow[] = [];

/**
 * submit_vote(voteType='like') の中核ロジックの再現。
 * 呼び出し元(fromId)の性別から相手側テーブルを固定し、そこにしか解決しない。
 */
function submitLikes(fromId: string, targetIds: string[]): { submittedCount: number } {
  const from = byId.get(fromId);
  if (!from) throw new Error('セッションが見つかりません');
  const oppositeGender = from.gender === 'male' ? 'female' : 'male';

  if (new Set(targetIds).size !== targetIds.length) {
    throw new Error('同じ相手を複数回選ぶことはできません');
  }
  // ★解決は全件チェックしてから初めて書き込む。1件でも不正なら何も変更しない。
  for (const t of targetIds) {
    const to = byId.get(t);
    if (!to || to.gender !== oppositeGender || to.status !== 'active') {
      throw new Error(`${t}: 選択できません（存在しないか、異性テーブルに見つかりません）`);
    }
  }
  // 実装どおり: このfromの同種の投票を全削除してから入れ直す（差分追加ではない）
  for (let i = votes.length - 1; i >= 0; i--) {
    if (votes[i].event_id === EVENT_ID && votes[i].from === fromId && votes[i].vote_type === 'like') {
      votes.splice(i, 1);
    }
  }
  for (const to of targetIds) votes.push({ event_id: EVENT_ID, from: fromId, to, vote_type: 'like' });
  return { submittedCount: targetIds.length };
}

/** list_participants が「自分宛ての好印象」を割り出すのと同じクエリ相当 */
function findLikesTo(toId: string): string[] {
  return votes.filter((v) => v.event_id === EVENT_ID && v.vote_type === 'like' && v.to === toId).map((v) => v.from);
}

// =============================================================================
// テスト1: 最大受信負荷・ページネーションテスト
// =============================================================================
console.log('=== テスト1: 最大受信負荷テスト（男性50名 → 女性W1に集中送信） ===');
const t1Start = performance.now();
for (let i = 1; i <= MALE_COUNT; i++) submitLikes(`M${i}`, ['W1']);
const receivedByW1 = findLikesTo('W1');
const t1ElapsedMs = performance.now() - t1Start;

console.log(`取得件数: ${receivedByW1.length} 件（期待値: ${MALE_COUNT} 件）`);
console.log(`処理時間: ${t1ElapsedMs.toFixed(3)} ms`);
console.log(receivedByW1.length === MALE_COUNT ? '判定: PASS（欠落なし）' : '判定: FAIL（件数不一致）');

// =============================================================================
// テスト2: バリデーション（異常系）テスト
// =============================================================================
console.log('\n=== テスト2: バリデーションテスト ===');

// 2-1. 重複送信: 同じ内容を2回連続で送る → 行が増えないこと
{
  const before = votes.filter((v) => v.from === 'M1' && v.vote_type === 'like').length;
  submitLikes('M1', ['W1']);
  submitLikes('M1', ['W1']); // 2回目
  const after = votes.filter((v) => v.from === 'M1' && v.vote_type === 'like').length;
  const pass = after === 1;
  console.log(`[2-1] 重複送信（M1→W1を2連続）: ${pass ? 'PASS' : 'FAIL'}`
    + ` （送信前想定=1件, 実際=${after}件, 2回目送信前の残存=${before}件）`);
}

// 2-2. 同性送信: M1がM2に送る
{
  try {
    submitLikes('M1', ['M2']);
    console.log('[2-2] 同性送信（M1→M2）: FAIL（エラーにならず成立してしまった）');
  } catch (e) {
    console.log(`[2-2] 同性送信（M1→M2）: PASS（拒否された）→ エラー内容: "${(e as Error).message}"`);
  }
}

// 2-3. 存在しないIDへの送信: M1がW999に送る
{
  try {
    submitLikes('M1', ['W999']);
    console.log('[2-3] 存在しないID送信（M1→W999）: FAIL（エラーにならず成立してしまった）');
  } catch (e) {
    console.log(`[2-3] 存在しないID送信（M1→W999）: PASS（拒否された）→ エラー内容: "${(e as Error).message}"`);
  }
}

// =============================================================================
// テスト3: フロントエンドUI表示確認用データ（W1が見る「50人分の好印象」モック）
// =============================================================================
console.log('\n=== テスト3: フロントエンド表示確認用モックデータ（W1視点、50件） ===');

// list_participants が実際に返す ParticipantCard 形式（lib/api.ts）に合わせる
interface ParticipantCardMock {
  gender: 'male' | 'female';
  number: number;
  nickname: string;
  profile: Record<string, string>;
  freeText: string | null;
  photoUrl: string | null;
  isSelf: boolean;
  likedMe: boolean;
}

const likedIds = new Set(findLikesTo('W1'));
const mockCards: ParticipantCardMock[] = males.map((m) => ({
  gender: m.gender,
  number: m.number,
  nickname: m.nickname,
  profile: { age_group: '30s', occupation: 'IT' },
  freeText: null,
  photoUrl: null,
  isSelf: false,
  likedMe: likedIds.has(m.id),
}));

console.log(JSON.stringify(mockCards, null, 2));
