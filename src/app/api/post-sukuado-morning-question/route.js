// app/api/post-sukuado-morning-question/route.js
// スクアド 朝2本目枠（7:31 JST）— 婚活・恋活の質問投げかけ
// 実体は共通ロジック。slot='morningQuestion' で呼ぶだけ。
import { runSukuado } from '../_lib/post-sukuado-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runSukuado(request, 'morningQuestion');
}
