import { createHash, timingSafeEqual } from 'node:crypto';

// Basic認証のパスワード部分だけを ADMIN_PASSWORD と照合する（ユーザー名は何でもよい）。
// ADMIN_PASSWORD 未設定時は常に拒否する。
export function isAdminAuthorized(authHeader) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !authHeader || !authHeader.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const a = createHash('sha256').update(password).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
