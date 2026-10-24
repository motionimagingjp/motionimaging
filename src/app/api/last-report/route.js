// app/api/last-report/route.js
// post-morning-all の直近実行レポートを閲覧する（Hobbyプランのログ制限対策）
import { Redis } from '@upstash/redis';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function GET(request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  // 認証はCRON_SECRETのみ（ヘッダーまたは?key=）。未設定なら常に拒否
  const secret = process.env.CRON_SECRET;
  if (!secret || (authHeader !== 'Bearer ' + secret && url.searchParams.get('key') !== secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const raw = await redis.get('last_morning_report');
  const body = raw == null ? '{"message":"no report yet"}' : (typeof raw === 'string' ? raw : JSON.stringify(raw));
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
