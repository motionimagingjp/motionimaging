/**
 * 閲覧一覧。
 * ★参加者IDはクライアントへ一切返さない。やり取りは参加者番号だけで行う。
 * ★異性の参加者だけを返す。同性のプロフィールは通信内容にも含めない。
 *   参加者番号は男女それぞれ1から振り直されるため、同性を混ぜると「男性2番」と
 *   「女性2番」が同じ数字になり、好印象(★)が別人に誤表示される（実際に発生した不具合）。
 * ★辞退者は返さない（仕様 6-6）。
 * ★好印象の★は like_reveal フェーズ以降のみ。それ以前は誰が誰に投票したかを一切返さない。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { assertPhase, requireParticipant } from '../_shared/session.ts';
import { decryptOptional } from '../_shared/crypto.ts';
import { PostgresEventKeyStore } from '../_shared/key-store.ts';

interface Body { sessionToken: string }

const PHOTO_BUCKET = 'participant-photos';
const PHOTO_URL_TTL_SECONDS = 1800;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    const session = await requireParticipant(db, body.sessionToken);
    assertPhase(session, ['browse', 'like_vote', 'like_reveal', 'final_vote', 'calculating', 'result']);

    const oppositeGender = session.gender === 'male' ? 'female' : 'male';
    const { data, error } = await db
      .from('participants')
      .select('id, gender, participant_number, nickname, profile_data, free_text')
      .eq('event_id', session.eventId)
      .eq('gender', oppositeGender)
      .eq('status', 'active')
      .not('participant_number', 'is', null)
      .order('participant_number', { ascending: true });
    if (error) throw error;

    // 自分に好印象を送った相手。★を誰に付けるかは必ずIDで判定する。
    // 番号で判定すると、男女で番号が重複しているため別人に★が付く
    const likedMeIds = new Set<string>();
    if (['like_reveal', 'final_vote', 'calculating', 'result'].includes(session.phase)) {
      const { data: likes, error: likeError } = await db
        .from('votes')
        .select('from_participant_id')
        .eq('event_id', session.eventId)
        .eq('vote_type', 'like')
        .eq('to_participant_id', session.id);
      if (likeError) throw likeError;
      for (const like of likes) likedMeIds.add(like.from_participant_id as string);
    }

    const keyStore = new PostgresEventKeyStore(db);
    const dataKey = await keyStore.getKey(session.eventId);

    // 写真は都度、期限付きの閲覧URLを発行する（存在しない参加者はエラーになるので null 扱いにする）
    const photoPaths = data.map((p) => `${session.eventId}/${p.id}`);
    const { data: signedPhotos } = photoPaths.length > 0
      ? await db.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, PHOTO_URL_TTL_SECONDS)
      : { data: [] as { path: string | null; signedUrl: string; error: string | null }[] };
    const photoUrlByPath = new Map(
      (signedPhotos ?? []).filter((s) => !s.error && s.path).map((s) => [s.path as string, s.signedUrl]),
    );

    const cards = await Promise.all(data.map(async (p) => ({
      gender: p.gender,
      number: p.participant_number,
      nickname: p.nickname,
      profile: p.profile_data,
      freeText: await decryptOptional(p.free_text, dataKey),
      photoUrl: photoUrlByPath.get(`${session.eventId}/${p.id}`) ?? null,
      // 異性しか返さないので自分は一覧に含まれない。互換のため常にfalseで残す
      isSelf: false,
      likedMe: likedMeIds.has(p.id as string),
    })));

    return json({
      phase: session.phase,
      eventId: session.eventId,
      self: { gender: session.gender, number: session.participantNumber },
      // 0件を可視化しないため件数は返さない（仕様 4-1④）
      hasLikes: likedMeIds.size > 0,
      participants: cards,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
