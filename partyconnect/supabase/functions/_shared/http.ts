/** Edge Function 共通のHTTPヘルパ */
import { ContactInfoRejected } from './contact-filter.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function preflight(): Response {
  return new Response('ok', { headers: corsHeaders });
}

/** アプリ側で意図的に投げるエラー。message はそのまま参加者に見せる */
export class AppError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

/**
 * 例外をレスポンスに変換する。
 * 想定外の例外はメッセージを外に出さない（DBのエラーメッセージが漏れるのを防ぐ）。
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ContactInfoRejected) {
    return json({ error: error.message, code: 'contact_info_rejected' }, 400);
  }
  if (error instanceof AppError) {
    return json({ error: error.message }, error.status);
  }
  const pg = error as { code?: string; message?: string };
  if (pg?.code === '42501') return json({ error: '権限がありません' }, 403);
  if (pg?.code === '22023') return json({ error: pg.message ?? '操作できません' }, 400);
  console.error('unhandled error', error);
  return json({ error: 'サーバーエラーが発生しました' }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    throw new AppError('リクエストの形式が不正です');
  }
}
