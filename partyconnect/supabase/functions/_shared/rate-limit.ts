/**
 * session_token 単位のレート制限。
 * 会場Wi-Fiは全員が同一IPになるため、IP単位ではなくトークン単位で制限する（仕様 7-5）。
 *
 * 制約: Edge Function のisolateごとのメモリに保持するため、インスタンスをまたいだ制限にはならない。
 *      総当たり的な連打を抑える目的には足りるが、厳密な制限が必要になったら外部KVへ移すこと。
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;

export function checkRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limitPerMinute) return false;
  bucket.count++;
  return true;
}
