'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '../../lib/supabase-browser';

interface EventRow {
  id: string; event_name: string; event_date: string | null;
  status: string; is_demo: boolean; passcode: string;
}

export default function OrganizerHome() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventName, setEventName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events').select('id, event_name, event_date, status, is_demo, passcode')
      .order('created_at', { ascending: false });
    setEvents((data ?? []) as EventRow[]);
  }, [supabase]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      if (data.session) void loadEvents();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
      if (session) void loadEvents();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, loadEvents]);

  const sendMagicLink = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setMessage(error ? error.message : 'ログイン用のリンクをメールで送信しました');
    setBusy(false);
  };

  const createEvent = async (isDemo: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const { error: orgError } = await supabase.rpc('ensure_organizer', { p_phone_number: phone });
      if (orgError) throw orgError;
      const { error } = await supabase.rpc('create_event', {
        p_event_name: isDemo ? 'デモイベント' : eventName,
        p_event_date: new Date().toISOString().slice(0, 10),
        p_is_demo: isDemo,
      });
      if (error) throw error;
      setEventName('');
      await loadEvents();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (signedIn === null) return <main><p className="muted">読み込み中…</p></main>;

  if (!signedIn) {
    return (
      <main>
        <h1>主催者コンソール</h1>
        <div className="card">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={busy || !email} onClick={sendMagicLink}>
              ログインリンクを送る
            </button>
          </div>
          {message && <p className="muted">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>主催者コンソール</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>イベントを作る</h2>
        <label htmlFor="phone">電話番号（初回のみ・無料枠の不正利用防止に使います）</label>
        <input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="name">イベント名</label>
        <input id="name" value={eventName} onChange={(e) => setEventName(e.target.value)} />
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <button type="button" className="primary" disabled={busy || !eventName || !phone}
            onClick={() => createEvent(false)}>
            イベントを作成
          </button>
          <button type="button" disabled={busy || !phone} onClick={() => createEvent(true)}>
            デモイベントを作成（ダミー20名で一人で試せます）
          </button>
        </div>
        {message && <div className="error" style={{ marginTop: 12 }}>{message}</div>}
      </div>

      <h2>イベント一覧</h2>
      {events.length === 0 && <p className="muted">まだイベントがありません。</p>}
      {events.map((event) => (
        <Link key={event.id} href={`/organizer/${event.id}`} className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <strong>{event.event_name}</strong>
          {event.is_demo && <span className="star"> デモ</span>}
          <div className="muted">
            {event.event_date ?? '日付未設定'} / {event.status} / 4桁コード {event.passcode}
          </div>
        </Link>
      ))}

      <button type="button" style={{ marginTop: 24 }} onClick={() => supabase.auth.signOut()}>
        ログアウト
      </button>
    </main>
  );
}
