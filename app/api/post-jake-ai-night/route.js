// app/api/post-jake-ai-night/route.js
// @jake_images 夜枠（22:00 JST）— 生成AI活用の取り組み事例・レビュー
// ＋「ノーコード×生成AI開発 30日振り返り」企画（day30まで自動停止）を2件目として続けて投稿。
// 新しいVercel cronは追加せず、この夜cronの中で2本投稿する。
import { runJakeAI, runJakeAIDiary } from '../_lib/post-jake-ai-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const mainRes = await runJakeAI(request, 'night');
  // 認証エラーは共通なので、ここで弾かれた場合は振り返り投稿も呼ばずそのまま返す
  if (mainRes.status === 401) return mainRes;

  const diaryRes = await runJakeAIDiary(request);

  const [main, diary] = await Promise.all([
    mainRes.json().catch((e) => ({ error: 'main応答の解析失敗: ' + e.message })),
    diaryRes.json().catch((e) => ({ error: 'diary応答の解析失敗: ' + e.message })),
  ]);

  const status = (mainRes.status >= 400 || diaryRes.status >= 400) ? 500 : 200;

  return new Response(JSON.stringify({ main, diary }, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
