/**
 * 【廃止】会場到着チェックイン専用エンドポイント。
 *
 * ★参加者本人が自分の端末から叩ける「出席登録API」は、会場にいなくても実行できてしまうため廃止した。
 *   出席登録の経路は次の2つだけに限定する:
 *     - 会場に掲示したQR(checkin_token)から6桁コードを引き換える（checkin Edge Function）
 *     - 主催者がコードを聞き取って代理で登録する（organizer Edge Function の checkin_by_code）
 *
 * 古いクライアントが残っていても出席登録されないよう、ここでは常に拒否する。
 */
import { json, preflight, toErrorResponse } from '../_shared/http.ts';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    return json({ error: 'この方法でのチェックインは廃止されました。会場のQRを読み取ってください' }, 410);
  } catch (error) {
    return toErrorResponse(error);
  }
});
