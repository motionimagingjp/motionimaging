/**
 * 一斉キックの受信。
 * Realtime を主、ポーリングを従にした二重化。会場は電波が弱く、Realtime が切れると
 * 会場全体が止まるため、フォールバックは必須（仕様 10章）。
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './api';

const POLL_INTERVAL_MS = 10_000;

let client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }
  return client;
}

async function fetchPhase(eventId: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from('event_states').select('phase').eq('event_id', eventId).maybeSingle();
  if (error || !data) return null;
  return (data as { phase: string }).phase;
}

/**
 * phase の変化を購読する。戻り値を呼ぶと購読を解除する。
 * onPhase は同じ phase で複数回呼ばれうるので、呼び出し側で冪等に扱うこと。
 */
export function watchPhase(eventId: string, onPhase: (phase: string) => void): () => void {
  let stopped = false;

  const channel = getClient()
    .channel(`event_states:${eventId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'event_states', filter: `event_id=eq.${eventId}` },
      (payload) => {
        const phase = (payload.new as { phase?: string })?.phase;
        if (phase && !stopped) onPhase(phase);
      },
    )
    .subscribe();

  // Realtime が張れていても、取りこぼしに備えてポーリングは止めない
  const timer = setInterval(async () => {
    const phase = await fetchPhase(eventId);
    if (phase && !stopped) onPhase(phase);
  }, POLL_INTERVAL_MS);

  void fetchPhase(eventId).then((phase) => {
    if (phase && !stopped) onPhase(phase);
  });

  return () => {
    stopped = true;
    clearInterval(timer);
    void getClient().removeChannel(channel);
  };
}
