/**
 * 会場到着チェックイン（出席登録・番号採番）。
 * ★事前のプロフィール入力(checkin)とは別の、参加者が「今ここにいる」ことを明示する操作。
 * ★checkin_participant RPC は phase='checkin'（受付中）の間しか採番しない。
 *   会場外・受付開始前に押されても自然に失敗する（仕様通り）。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

interface Body { sessionToken: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    if (!body.sessionToken) throw new AppError('セッションが不正です', 401);
    if (!checkRateLimit(`arrive:${body.sessionToken}`, 10)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }
    const db = serviceClient();

    const { data, error } = await db.rpc('checkin_participant', { p_session_token: body.sessionToken });
    if (error) throw error;
    const p = data as { gender: string; participant_number: number; nickname: string | null };

    return json({
      gender: p.gender,
      participantNumber: p.participant_number,
      nickname: p.nickname,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
