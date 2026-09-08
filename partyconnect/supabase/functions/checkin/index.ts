/**
 * チェックイン。引換コードから session_token を得る導線も兼ねる。
 * 番号の採番は checkin_participant RPC がトランザクション内で行う（仕様 6-4）。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

interface Body {
  sessionToken?: string;
  checkinToken?: string;
  claimCode?: string;
  agreed?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();

    let sessionToken = body.sessionToken;

    // 引換コードによる受付。総当たり対策としてイベント単位でレート制限する
    if (!sessionToken) {
      if (!body.checkinToken || !body.claimCode) {
        throw new AppError('受付コードを入力してください');
      }
      if (!checkRateLimit(`claim:${body.checkinToken}`, 30)) {
        throw new AppError('受付が混み合っています。少し待ってからもう一度お試しください', 429);
      }
      const { data, error } = await db.rpc('claim_session', {
        p_checkin_token: body.checkinToken,
        p_claim_code: body.claimCode,
      });
      if (error) throw error;
      sessionToken = (data as { session_token: string }).session_token;
    }

    // 規約・プライバシーポリシーへの同意はチェックイン時に必須（仕様 11-2）
    if (body.agreed !== true) {
      throw new AppError('利用規約とプライバシーポリシーへの同意が必要です');
    }
    if (!checkRateLimit(`checkin:${sessionToken}`, 20)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }

    const { data, error } = await db.rpc('checkin_participant', { p_session_token: sessionToken });
    if (error) throw error;
    const p = data as {
      event_id: string; gender: string; participant_number: number; nickname: string | null;
    };

    return json({
      sessionToken,
      // Realtime で phase を購読するために返す。event_states は元々 anon が読めるので秘匿情報ではない
      eventId: p.event_id,
      gender: p.gender,
      participantNumber: p.participant_number,
      nickname: p.nickname,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
