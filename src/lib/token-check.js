// Instagram / Threads のアクセストークンが今使えるかを、実際に /me を呼んで確認する。
// トークンそのものは画面に出さない。
const TOKENS = [
  { label: 'Instagram @motion.imaging', env: 'INSTAGRAM_ACCESS_TOKEN',   base: 'https://graph.instagram.com/v23.0' },
  { label: 'Instagram @jake_images_',   env: 'JAKE_IMAGES_ACCESS_TOKEN', base: 'https://graph.instagram.com/v23.0' },
  { label: 'Threads（ミゴロン用）',      env: 'THREADS_MOTION_TOKEN',     base: 'https://graph.threads.net/v1.0' },
  { label: 'Threads（jake用）',          env: 'THREADS_JAKE_TOKEN',       base: 'https://graph.threads.net/v1.0' },
  { label: 'Threads（スクアド用）',      env: 'THREADS_SUKUADO_TOKEN',    base: 'https://graph.threads.net/v1.0' },
];

async function checkOne({ label, env, base }) {
  const token = process.env[env];
  if (!token) return { label, env, valid: false, message: '未設定' };
  try {
    const res = await fetch(`${base}/me?fields=username&access_token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json.error) return { label, env, valid: false, message: json.error.message };
    return { label, env, valid: true, message: json.username ? '@' + json.username : '有効' };
  } catch (e) {
    return { label, env, valid: null, message: '確認できませんでした: ' + e.message };
  }
}

export function checkAllTokens() {
  return Promise.all(TOKENS.map(checkOne));
}
