// パーティコネクト（Supabase）の利用状況を集計する。サーバー側専用。
// 参加者の個人情報（ニックネーム・プロフィール等）は取得しない。
// 終了イベントの参加者は削除される設計のため、終了分の人数は event_analytics の集計値を使う。
const SUPABASE_URL = process.env.PARTYCONNECT_SUPABASE_URL || 'https://pnetjlfxzzyrlkgyredv.supabase.co';

async function query(path) {
  const key = process.env.PARTYCONNECT_SUPABASE_SECRET_KEY;
  const headers = { apikey: key };
  // 旧形式の service_role キー（JWT）は Authorization ヘッダーも必要
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`${path.split('?')[0]} [HTTP ${res.status}] ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

export async function getPartyconnectStats() {
  if (!process.env.PARTYCONNECT_SUPABASE_SECRET_KEY) return { configured: false };

  const [organizers, events, analytics, participants] = await Promise.all([
    query('organizers?select=id,email,company_name,plan_type,created_at&order=created_at.desc'),
    query('events?select=id,organizer_id,event_name,event_date,event_time,status,is_demo,event_mode,created_at&order=event_date.asc.nullslast'),
    query('event_analytics?select=event_id,total_male_count,total_female_count,matched_pairs_count'),
    query('participants?select=event_id,status'),
  ]);

  const analyticsByEvent = new Map(analytics.map((a) => [a.event_id, a]));
  const liveCount = new Map();
  for (const p of participants) {
    if (p.status === 'withdrawn') continue;
    liveCount.set(p.event_id, (liveCount.get(p.event_id) || 0) + 1);
  }

  const today = todayJst();
  const realEvents = events
    .filter((e) => !e.is_demo)
    .map((e) => {
      const a = analyticsByEvent.get(e.id);
      const open = ['draft', 'active'].includes(e.status);
      const upcoming = open && (!e.event_date || e.event_date >= today);
      return {
        ...e,
        upcoming,
        stale: open && !upcoming,
        participantCount: a ? a.total_male_count + a.total_female_count : liveCount.get(e.id) || 0,
        matchedPairs: a ? a.matched_pairs_count : null,
      };
    });

  const orgRows = organizers.map((o) => {
    const own = realEvents.filter((e) => e.organizer_id === o.id);
    return {
      ...o,
      eventCount: own.length,
      upcomingCount: own.filter((e) => e.upcoming).length,
    };
  });

  const organizerName = new Map(organizers.map((o) => [o.id, o.company_name || o.email]));

  return {
    configured: true,
    totals: {
      organizers: organizers.length,
      events: realEvents.length,
      upcoming: realEvents.filter((e) => e.upcoming).length,
      finished: realEvents.filter((e) => ['finished', 'purged'].includes(e.status)).length,
      stale: realEvents.filter((e) => e.stale).length,
      participants: realEvents.reduce((s, e) => s + e.participantCount, 0),
      matchedPairs: realEvents.reduce((s, e) => s + (e.matchedPairs || 0), 0),
      demoEvents: events.length - realEvents.length,
    },
    organizers: orgRows,
    upcomingEvents: realEvents
      .filter((e) => e.upcoming)
      .map((e) => ({ ...e, organizerName: organizerName.get(e.organizer_id) || '-' })),
  };
}
