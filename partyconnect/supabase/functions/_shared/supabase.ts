import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/** service_role クライアント。参加者の操作は必ずこれを経由する（RLSはデフォルト拒否のため） */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 呼び出し元の主催者を Authorization ヘッダから解決する */
export async function requireOrganizer(req: Request): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = req.headers.get('Authorization');
  if (!url || !anonKey) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が未設定です');
  if (!authorization) throw new Error('unauthorized');

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('unauthorized');
  return data.user.id;
}
