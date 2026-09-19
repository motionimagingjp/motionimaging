/**
 * 参加者の写真アップロード用URL発行。
 * ★顔写真である必要はない（食べ物・趣味の写真などでもよい）。会話のきっかけ用。
 * ★ファイル本体はここを経由せず、クライアントが署名付きURLへ直接PUTする。
 * ★閲覧は list_participants 側が都度、署名付きURLを発行して返す（このAPIには閲覧機能はない）。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { requireParticipant } from '../_shared/session.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

interface Body { sessionToken: string }

const BUCKET = 'participant-photos';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    // 事前入力（会場到着前）でも写真を登録できるよう、出席登録済みかどうかは問わない
    const session = await requireParticipant(db, body.sessionToken);
    if (!checkRateLimit(`photo:${body.sessionToken}`, 10)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }
    if (['calculating', 'result', 'purged'].includes(session.phase)) {
      throw new AppError('結果発表後は写真を変更できません', 409);
    }

    const path = `${session.eventId}/${session.id}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    return json({ path: data.path, token: data.token });
  } catch (error) {
    return toErrorResponse(error);
  }
});
