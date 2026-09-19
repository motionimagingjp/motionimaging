/**
 * 受付。3つの入り口があり、出席登録(番号採番)を行うのは1つだけ。
 *
 *  1. checkinToken + claimCode（会場に掲示したQRを読み、受付コードを入力した場合）
 *     → claim_session で本人を特定し、そのまま checkin_participant で出席登録まで行う。
 *     ★掲示QRのURL(checkin_token)は会場でしか見られないため、「会場に来た」ことの根拠になる。
 *       事前送付するリンクには絶対に checkin_token を含めないこと（含めると自宅から出席登録できてしまう）。
 *
 *  2. prelinkToken + claimCode（事前案内のイベント共通リンクを開き、受付コードを入力した場合）
 *     → claim_session_prefill でセッションを開くだけ。番号は採番せず、出席登録もしない。
 *
 *  3. sessionToken（一度開いたあと、端末に残ったセッションで戻ってきた場合）
 *     → セッションを開くだけ。出席登録はしない。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { decryptOptional } from '../_shared/crypto.ts';
import { PostgresEventKeyStore } from '../_shared/key-store.ts';

interface Body {
  sessionToken?: string;
  checkinToken?: string;
  prelinkToken?: string;
  claimCode?: string;
  agreed?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();

    let sessionToken = body.sessionToken;
    // 掲示QR経由かどうか。この経路のときだけ出席登録まで行う
    const viaVenueQr = !sessionToken && !body.prelinkToken;
    const viaPrelink = !sessionToken && !!body.prelinkToken;

    if (viaVenueQr) {
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

    if (viaPrelink) {
      if (!body.claimCode) throw new AppError('受付コードを入力してください');
      if (!checkRateLimit(`prelink:${body.prelinkToken}`, 30)) {
        throw new AppError('アクセスが集中しています。少し待ってからもう一度お試しください', 429);
      }
      // ★この経路では採番しない。出席したかどうかは会場でしか確定させない
      const { data, error } = await db.rpc('claim_session_prefill', {
        p_prelink_token: body.prelinkToken,
        p_claim_code: body.claimCode,
      });
      if (error) throw error;
      sessionToken = (data as { session_token: string }).session_token;
    }

    if (!checkRateLimit(`checkin:${sessionToken}`, 20)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }

    const { data: found, error: findError } = await db
      .from('participants')
      .select('event_id, gender, participant_number, nickname, status, profile_data, free_text, agreed_at')
      .eq('session_token', sessionToken)
      .maybeSingle();
    if (findError) throw findError;
    if (!found) throw new AppError('セッションが見つかりません。主催者にお声がけください', 401);
    if (found.status === 'withdrawn') throw new AppError('受付が取り消されています', 403);

    // 規約・プライバシーポリシーへの同意は必須（仕様 11-2）。
    // ただし同意は一度取れば足りる。会場でアプリを開き直すたびに再同意を求めると、
    // チェックだけを機械的に押す操作になってしまい、同意の意味も受付の速度も損なう
    if (body.agreed !== true && !found.agreed_at) {
      throw new AppError(
        '利用規約とプライバシーポリシーへの同意が必要です', 400, 'consent_required',
      );
    }
    if (body.agreed === true && !found.agreed_at) {
      const { error } = await db.from('participants')
        .update({ agreed_at: new Date().toISOString() }).eq('session_token', sessionToken);
      if (error) throw error;
    }

    let participantNumber = found.participant_number as number | null;
    if (viaVenueQr) {
      // 会場に来ている根拠があるので、ここで出席登録・採番まで行う（phase='checkin' の間のみ成功する）
      const { data, error } = await db.rpc('checkin_participant', { p_session_token: sessionToken });
      if (error) throw error;
      participantNumber = (data as { participant_number: number }).participant_number;
    }

    const { data: event, error: eventError } = await db
      .from('events').select('profile_field_keys').eq('id', found.event_id).single();
    if (eventError) throw eventError;

    // 保存済みのプロフィールを返す。返さないと、別端末やキャッシュ削除のあとに
    // 編集画面が空で開き、そのまま保存して入力済みの内容を消してしまう
    const keyStore = new PostgresEventKeyStore(db);
    const dataKey = await keyStore.getKey(found.event_id);

    return json({
      sessionToken,
      // Realtime で phase を購読するために返す。event_states は元々 anon が読めるので秘匿情報ではない
      eventId: found.event_id,
      gender: found.gender,
      participantNumber,
      nickname: found.nickname,
      profileData: found.profile_data ?? {},
      freeText: await decryptOptional(found.free_text, dataKey),
      enabledProfileFields: (event as { profile_field_keys: string[] | null }).profile_field_keys,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
