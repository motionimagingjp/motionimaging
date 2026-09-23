/**
 * 参加者向け：受付画面等に表示する主催者のブランド設定（会社名・ロゴ・イメージカラー）を返す。
 * ★受付コード入力前（未認証）でも呼べる必要があるため、checkinToken/prelinkTokenだけで引く。
 * ★主催者が未設定の場合や、トークンが見つからない場合もエラーにせず全部nullを返す
 *   （アプリ既定の見た目のまま表示されるだけで、参加者の操作を止めない）。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';

interface Body { checkinToken?: string; prelinkToken?: string }

const EMPTY = { companyName: null, brandColor: null, logoUrl: null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();

    let eventQuery = db.from('events').select('organizer_id').limit(1);
    if (body.checkinToken) {
      eventQuery = eventQuery.eq('checkin_token', body.checkinToken);
    } else if (body.prelinkToken) {
      eventQuery = eventQuery.eq('prelink_token', body.prelinkToken);
    } else {
      return json(EMPTY);
    }

    const { data: event } = await eventQuery.maybeSingle();
    if (!event) return json(EMPTY);

    const { data: organizer } = await db
      .from('organizers')
      .select('company_name, brand_color, logo_path')
      .eq('id', event.organizer_id as string)
      .maybeSingle();
    if (!organizer) return json(EMPTY);

    const logoUrl = organizer.logo_path
      ? db.storage.from('organizer-logos').getPublicUrl(organizer.logo_path as string).data.publicUrl
      : null;

    return json({
      companyName: organizer.company_name,
      brandColor: organizer.brand_color,
      logoUrl,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
