// Instagram / Threads 投稿（ミゴロン post-instagram の実装を移植）
const IG_BASE = 'https://graph.instagram.com/v23.0';
const TH_BASE = 'https://graph.threads.net/v1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, body) {
  const res = await fetch(url, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const e = json.error;
    throw new Error(`[HTTP ${res.status}] ${e.message} (code=${e.code ?? '-'}, subcode=${e.error_subcode ?? '-'}, fbtrace=${e.fbtrace_id ?? '-'})`);
  }
  return json;
}

export async function postToInstagram(imageUrl, caption) {
  const id = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const c = await call(`${IG_BASE}/${id}/media`, { image_url: imageUrl, caption, access_token: token });

  // コンテナ処理完了を待つ（最大90秒）
  const start = Date.now();
  for (;;) {
    const s = await call(`${IG_BASE}/${c.id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`IG container ${s.status_code}`);
    if (Date.now() - start > 90000) throw new Error('IG container timeout');
    await sleep(3000);
  }

  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return (await call(`${IG_BASE}/${id}/media_publish`, { creation_id: c.id, access_token: token })).id;
    } catch (e) {
      last = e;
      await sleep(5000);
    }
  }
  throw last;
}

export async function postToThreads(imageUrl, text) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) return null;
  const me = await call(`${TH_BASE}/me?fields=id&access_token=${encodeURIComponent(token)}`);
  const c = await call(`${TH_BASE}/${me.id}/threads`, { media_type: 'IMAGE', image_url: imageUrl, text, access_token: token });
  let last;
  for (let i = 0; i < 2; i++) {
    await sleep(5000);
    try {
      return (await call(`${TH_BASE}/${me.id}/threads_publish`, { creation_id: c.id, access_token: token })).id;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// X は API 準備後に実装（posts.json の "x" 文言は用意済み）

export async function notify(message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  console.log('[notify]', message);
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `【JONGJIN自動投稿】${message}` }),
  }).catch(() => {});
}
