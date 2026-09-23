'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { uploadOrganizerLogo } from '../../lib/api';

interface EventRow {
  id: string; event_name: string; event_date: string | null;
  event_time: string | null; checkin_time: string | null;
  status: string; is_demo: boolean; passcode: string;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function formatSchedule(row: EventRow): string {
  if (!row.event_date) return '日時未設定';
  const d = new Date(`${row.event_date}T00:00:00`);
  const dateLabel = `${row.event_date}（${WEEKDAY_LABELS[d.getDay()]}）`;
  if (!row.event_time) return dateLabel;
  const checkinLabel = row.checkin_time ? `　（受付開始 ${row.checkin_time}）` : '';
  return `${dateLabel} ${row.event_time}開催${checkinLabel}`;
}

// 15分前を「HH:MM」で返す。時刻をまたぐ繰り下がりも処理する
function minutesBefore(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m - minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function defaultEventDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function OrganizerHome() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(defaultEventDate);
  const [eventTime, setEventTime] = useState('13:00');
  const [checkinTime, setCheckinTime] = useState('12:45');
  const [matchingMode, setMatchingMode] = useState<'max_pairs' | 'greedy_priority'>('max_pairs');
  const [orgAgreed, setOrgAgreed] = useState(false);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [brandColor, setBrandColor] = useState('#16a34a');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandMessage, setBrandMessage] = useState<string | null>(null);

  // 開催時刻を変えたら、受付開始時刻もデフォルトの「15分前」に追従させる
  const onEventTimeChange = (value: string) => {
    setEventTime(value);
    setCheckinTime(minutesBefore(value, 15));
  };

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('id, event_name, event_date, event_time, checkin_time, status, is_demo, passcode')
      .order('created_at', { ascending: false });
    setEvents((data ?? []) as EventRow[]);
  }, [supabase]);

  // まだ一度もイベントを作っていない主催者は organizers に行が無いので、無ければ何もしない
  const loadBranding = useCallback(async () => {
    const { data } = await supabase
      .from('organizers').select('company_name, brand_color, logo_path').maybeSingle();
    if (!data) return;
    setCompanyName((data.company_name as string | null) ?? '');
    setBrandColor((data.brand_color as string | null) ?? '#16a34a');
    if (data.logo_path) {
      setLogoPath(data.logo_path as string);
      setLogoPreviewUrl(supabase.storage.from('organizer-logos').getPublicUrl(data.logo_path as string).data.publicUrl);
    }
  }, [supabase]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      if (data.session) { void loadEvents(); void loadBranding(); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
      if (session) { void loadEvents(); void loadBranding(); }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, loadEvents, loadBranding]);

  const sendMagicLink = async () => {
    setBusy(true);
    // リダイレクト先を明示しないと Supabase の既定(Site URL = トップページ)に戻ってしまい、
    // クライアント側の Supabase 初期化が走らないため、この画面のURLに access_token が
    // 渡ってきてもセッションとして拾われない
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/organizer` },
    });
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
        p_event_date: isDemo ? new Date().toISOString().slice(0, 10) : eventDate,
        p_is_demo: isDemo,
        p_event_time: isDemo ? null : eventTime,
        p_checkin_time: isDemo ? null : checkinTime,
        // デモは常にmax_pairs固定（サーバー側でも強制している）。ここでは通常イベントの選択を渡す
        p_matching_mode: matchingMode,
      });
      if (error) throw error;
      setEventName('');
      setMatchingMode('max_pairs');
      await loadEvents();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const saveBranding = async () => {
    setBrandBusy(true);
    setBrandMessage(null);
    try {
      const { error: orgError } = await supabase.rpc('ensure_organizer', { p_phone_number: phone });
      if (orgError) throw orgError;

      // ★RPCはlogo_pathも直接SETするため、新しくアップロードしていなくても
      //   既存のパスを必ず一緒に送る（省略すると保存済みロゴが消えてしまう）
      let nextLogoPath = logoPath;
      if (logoFile) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error('ログインが必要です');
        nextLogoPath = await uploadOrganizerLogo(supabase.storage, userData.user.id, logoFile);
        setLogoPath(nextLogoPath);
        setLogoPreviewUrl(supabase.storage.from('organizer-logos').getPublicUrl(nextLogoPath).data.publicUrl);
        setLogoFile(null);
      }

      const { error } = await supabase.rpc('update_organizer_branding', {
        p_company_name: companyName || null,
        p_brand_color: brandColor,
        p_logo_path: nextLogoPath,
      });
      if (error) throw error;
      setBrandMessage('保存しました');
    } catch (e) {
      setBrandMessage(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBrandBusy(false);
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
        <h2 style={{ marginTop: 0 }}>ブランド設定</h2>
        <p className="muted" style={{ marginTop: -4 }}>
          会社名・ロゴ・イメージカラーを設定すると、参加者の受付画面にも反映されます。
        </p>
        <label htmlFor="companyName">会社名</label>
        <input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />

        <label htmlFor="brandColor">イメージカラー</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input id="brandColor" type="color" style={{ width: 56, padding: 4 }}
            value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
          <span className="muted">{brandColor}</span>
        </div>

        <label htmlFor="logo">ロゴ画像</label>
        {logoPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storageの動的URLのため
          <img src={logoPreviewUrl} alt="" style={{ height: 48, width: 48, objectFit: 'contain', borderRadius: 8, marginBottom: 8 }} />
        )}
        <input id="logo" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />

        <div style={{ marginTop: 12 }}>
          <button type="button" className="primary" disabled={brandBusy || !phone}
            onClick={saveBranding}>
            {brandBusy ? '保存中…' : 'ブランド設定を保存'}
          </button>
        </div>
        {!phone && (
          <p className="muted" style={{ marginTop: 8 }}>
            下の「イベントを作る」欄に電話番号を入力すると保存できます。
          </p>
        )}
        {brandMessage && <p className="muted" style={{ marginTop: 8 }}>{brandMessage}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>イベントを作る</h2>
        <label htmlFor="phone">電話番号（初回のみ・無料枠の不正利用防止に使います）</label>
        <input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="name">イベント名</label>
        <input id="name" value={eventName} onChange={(e) => setEventName(e.target.value)} />
        <label htmlFor="eventDate">開催日</label>
        <input id="eventDate" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        <label htmlFor="eventTime">開催時刻</label>
        <input id="eventTime" type="time" value={eventTime} onChange={(e) => onEventTimeChange(e.target.value)} />
        <label htmlFor="checkinTime">受付開始時刻</label>
        <input id="checkinTime" type="time" value={checkinTime} onChange={(e) => setCheckinTime(e.target.value)} />

        <label>マッチング方式</label>
        <div className="tabs">
          <button type="button" aria-pressed={matchingMode === 'max_pairs'}
            onClick={() => setMatchingMode('max_pairs')}>
            最大組数（推奨）
          </button>
          <button type="button" aria-pressed={matchingMode === 'greedy_priority'}
            onClick={() => setMatchingMode('greedy_priority')}>
            第1希望優先
          </button>
        </div>
        {matchingMode === 'greedy_priority' ? (
          <p className="muted" style={{ marginTop: -4 }}>
            相思相愛の熱量が強いペアを優先して成立させます。<strong>全体の成立組数は
            「最大組数」より少なくなることがあります。</strong>迷ったら「最大組数」を選んでください。
          </p>
        ) : (
          <p className="muted" style={{ marginTop: -4 }}>
            会場全体で成立するカップル数が最も多くなるよう自動計算します（通常はこちらで問題ありません）。
          </p>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={orgAgreed}
            onChange={(e) => setOrgAgreed(e.target.checked)}
            style={{ width: 20, height: 20, minHeight: 20 }} />
          <Link href="/terms" target="_blank">利用規約</Link>に同意します
        </label>

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <button type="button" className="primary" disabled={busy || !eventName || !phone || !orgAgreed}
            onClick={() => createEvent(false)}>
            イベントを作成
          </button>
          <button type="button" disabled={busy || !phone || !orgAgreed} onClick={() => createEvent(true)}>
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
          <div className="muted">{formatSchedule(event)}</div>
          <div className="muted">
            {event.status} / 4桁コード {event.passcode}
          </div>
        </Link>
      ))}

      <button type="button" style={{ marginTop: 24 }} onClick={() => supabase.auth.signOut()}>
        ログアウト
      </button>
    </main>
  );
}
