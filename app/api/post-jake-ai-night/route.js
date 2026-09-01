// app/api/post-jake-ai-night/route.js
// @jake_images 夜枠（22:00 JST）— 生成AI活用の取り組み事例・レビュー
// 実体は共通ロジック。slot='night' で呼ぶだけ。
import { runJakeAI } from '../_lib/post-jake-ai-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runJakeAI(request, 'night');
}
