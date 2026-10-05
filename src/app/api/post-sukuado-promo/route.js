// app/api/post-sukuado-promo/route.js
// スクアド 宣伝枠（22:01 JST、post-sukuado-nightの直後）
// 固定3パターンをローテーション投稿。実体は共通ロジック。slot='promo' で呼ぶだけ。
import { runSukuado } from '../_lib/post-sukuado-core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  return runSukuado(request, 'promo');
}
