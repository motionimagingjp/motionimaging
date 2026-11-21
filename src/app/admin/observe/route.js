// 管理画面の「実地確認」入力（見えた／見えなかった）を受ける。
// /admin 配下なので proxy.js のBasic認証が先に掛かる。念のためここでも確認する。
import { isAdminAuthorized } from '../../../lib/admin-auth';
import { FIELD_KINDS, saveFieldObservation } from '../../../lib/prediction-log';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAdminAuthorized(request.headers.get('authorization'))) {
    return new Response('Unauthorized', { status: 401 });
  }
  // 他サイトのフォームからの送信は受け付けない
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return new Response('Forbidden', { status: 403 });
  }

  const form = await request.formData();
  const kind = String(form.get('kind') || '');
  const date = String(form.get('date') || '');
  const index = Number(form.get('index'));
  const seenRaw = String(form.get('seen') || '');
  if (!FIELD_KINDS.includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isInteger(index) || index < 0 || !['1', '0', 'clear'].includes(seenRaw)) {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    await saveFieldObservation(kind, date, index, seenRaw === 'clear' ? null : seenRaw === '1');
  } catch (e) {
    return new Response('保存に失敗しました: ' + e.message, { status: 500 });
  }
  return new Response(null, { status: 303, headers: { Location: '/admin#field' } });
}
