'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './api';

let client: SupabaseClient | null = null;

/** 主催者用のブラウザクライアント。参加者側では使わない（参加者はDBを直接触らない） */
export function supabaseBrowser(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
