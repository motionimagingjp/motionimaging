// app/api/post-sukuado-night/route.js
// スクアド 夜枠（22:00 JST）— 街コン・アプリ・婚活実務のポイント
// 実体は共通ロジック。slot='night' で呼ぶだけ。
import { runSukuado } from '../_lib/post-sukuado-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runSukuado(request, 'night');
}
