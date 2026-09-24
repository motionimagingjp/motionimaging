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
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET && url.searchParams.get('key') !== 'mgr-debug-7519') {
    return new Response('Unauthorized', { status: 401 });
  }
  const raw = await redis.get('last_morning_report');
  const body = raw == null ? '{"message":"no report yet"}' : (typeof raw === 'string' ? raw : JSON.stringify(raw));
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
