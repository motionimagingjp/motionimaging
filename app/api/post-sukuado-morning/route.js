// app/api/post-sukuado-morning/route.js
// スクアド 朝枠（7:30 JST）— 恋愛・婚活の統計データ
// 実体は共通ロジック。slot='morning' で呼ぶだけ。
import { runSukuado } from '../_lib/post-sukuado-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runSukuado(request, 'morning');
}
