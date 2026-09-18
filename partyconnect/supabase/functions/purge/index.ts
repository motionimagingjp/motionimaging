/**
 * 消去（仕様 6-2 フェーズB）。削除の唯一の入口。
 *   - Cron: CRON_SECRET ヘッダ付きで呼ぶと purge_due_events を実行する
 *   - 手動キック: 主催者が自分のイベントを30分待たずに消去する
 * どちらも purge_event を通るため、統計の書き込み確認は必ず行われる（仕様 12-5）。
 */
import { requireOrganizer, serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';

interface Body { eventId?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const db = serviceClient();
    const cronSecret = Deno.env.get('CRON_SECRET');
    const provided = req.headers.get('x-cron-secret');

    // Cron からの一括消去
    if (cronSecret && provided && provided === cronSecret) {
      const { data, error } = await db.rpc('purge_due_events');
      if (error) throw error;
      // 統計が書けないまま止まっているイベントは削除せず、通知できるように返す
      const { data: stuck, error: stuckError } = await db.rpc('list_stuck_events');
      if (stuckError) throw stuckError;
      if (Array.isArray(stuck) && stuck.length > 0) {
        console.error('統計未書き込みのまま滞留しているイベントがあります', stuck);
      }
      return json({ purgedCount: data, stuckCount: Array.isArray(stuck) ? stuck.length : 0 });
    }

    // 主催者による手動消去
    const organizerId = await requireOrganizer(req).catch(() => {
      throw new AppError('ログインが必要です', 401);
    });
    const body = await readJson<Body>(req);
    if (!body.eventId) throw new AppError('イベントを指定してください');

    const { data: event, error: eventError } = await db
      .from('events').select('organizer_id').eq('id', body.eventId).single();
    if (eventError) throw eventError;
    if (event.organizer_id !== organizerId) throw new AppError('権限がありません', 403);

    const { data, error } = await db.rpc('purge_event', {
      p_event_id: body.eventId,
      p_allow_before_deadline: true,
    });
    if (error) throw error;
    return json({ purged: data === true });
  } catch (error) {
    return toErrorResponse(error);
  }
});
