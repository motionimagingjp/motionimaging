// 一時テスト用（動作確認後に削除する）
export const dynamic = 'force-dynamic';

async function postTextToThreads(token, text) {
  if (!token) return { skipped: 'no token' };
  const meRes = await fetch('https://graph.threads.net/v1.0/me?fields=id,username&access_token=' + token);
  const me = await meRes.json();
  if (me.error) throw new Error('Threads me: ' + me.error.message);
  const cRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token }),
  });
  const c = await cRes.json();
  if (c.error) throw new Error('Threads container: ' + c.error.message);
  await new Promise(r => setTimeout(r, 2000));
  const pRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads_publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: token }),
  });
  const p = await pRes.json();
  if (p.error) throw new Error('Threads publish: ' + p.error.message);
  return { username: me.username, postId: p.id };
}

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') !== 'mgr-debug-7519') {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const text = 'ミゴロン指数のテキスト投稿テスト（X連携動作確認）。この投稿は確認用のため削除予定です。';
    const result = await postTextToThreads(process.env.THREADS_MOTION_TOKEN, text);
    return new Response(JSON.stringify({ message: 'done', result }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
