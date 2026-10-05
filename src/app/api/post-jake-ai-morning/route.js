// app/api/post-jake-ai-morning/route.js
// @jake_images 朝枠（7:30 JST）— 生成AIのサービス・技術ニュース
// 実体は共通ロジック。slot='morning' で呼ぶだけ。
import { runJakeAI } from '../_lib/post-jake-ai-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runJakeAI(request, 'morning');
}
