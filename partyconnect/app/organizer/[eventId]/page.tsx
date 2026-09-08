'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { finalizeEvent, organizerCall, purgeEvent, type Progress } from '../../../lib/api';
import { supabaseBrowser } from '../../../lib/supabase-browser';

const PHASES: { key: string; label: string }[] = [
  { key: 'checkin', label: '① 受付開始' },
  { key: 'browse', label: '② 歓談開始（一覧公開）' },
  { key: 'like_vote', label: '③ 好印象の投票開始' },
  { key: 'like_reveal', label: '④ 好印象を開示' },
  { key: 'final_vote', label: '⑤ 最終希望の受付開始' },
];

interface RosterRow {
  gender: 'male' | 'female';
  number: number | null;
  status: string;
  nickname: string | null;
  claimCode: string | null;
}

export default function EventConsole({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const supabase = supabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>('draft');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [pairs, setPairs] = useState<{ male: number | null; female: number | null }[]>([]);
  const [checkinToken, setCheckinToken] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [{ data: event }, { data: state }] = await Promise.all([
      supabase.from('events').select('checkin_token, is_demo').eq('id', eventId).single(),
      supabase.from('event_states').select('phase').eq('event_id', eventId).single(),
    ]);
    if (event) {
      setCheckinToken((event as { checkin_token: string }).checkin_token);
      setIsDemo((event as { is_demo: boolean }).is_demo);
    }
    if (state) setPhase((state as { phase: string }).phase);
    try {
      setProgress(await organizerCall<Progress>({ action: 'progress', eventId }, token));
      const r = await organizerCall<{ participants: RosterRow[] }>({ action: 'roster', eventId }, token);
      setRoster(r.participants);
      const p = await organizerCall<{ pairs: typeof pairs }>({ action: 'pairs', eventId }, token);
      setPairs(p.pairs);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '取得に失敗しました');
    }
  }, [supabase, eventId, token]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    // 進捗は自動更新する。会場では画面を見っぱなしにするため
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [token, refresh]);

  const run = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const kick = (next: string) => run(async () => {
    const { error } = await supabase.rpc('set_event_phase', { p_event_id: eventId, p_phase: next });
    if (error) throw error;
  });

  const issue = (gender: 'male' | 'female') => run(async () => {
    if (!token) return;
    await organizerCall({ action: 'issue_slots', eventId, gender, count: 1, isProxy: true }, token);
  });

  const withdraw = (row: RosterRow, withdrawn: boolean) => run(async () => {
    if (!token || row.number === null) return;
    await organizerCall({
      action: 'withdraw', eventId, gender: row.gender, participantNumber: row.number, withdrawn,
    }, token);
  });

  if (!token) return <main><p className="muted">ログインが必要です。</p></main>;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <main>
      <h1>イベント進行</h1>
      <p className="muted">現在のフェーズ: <strong>{phase}</strong></p>
      {message && <div className="error" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>進捗</h2>
        {progress ? (
          <table>
            <tbody>
              <tr><th>受付済み</th><td>{progress.checkedIn} / {progress.invited} 名</td></tr>
              <tr><th>男女</th><td>男性 {progress.male} / 女性 {progress.female}</td></tr>
              <tr><th>プロフ登録</th><td>{progress.profileCompleted} / {progress.checkedIn} 名</td></tr>
              <tr><th>好印象 投票済み</th><td>{progress.likeVoted} / {progress.checkedIn} 名</td></tr>
              <tr><th>最終希望 投票済み</th><td>{progress.finalVoted} / {progress.checkedIn} 名</td></tr>
              <tr><th>辞退</th><td>{progress.withdrawn} 名</td></tr>
            </tbody>
          </table>
        ) : <p className="muted">読み込み中…</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>一斉キック</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {PHASES.map((p) => (
            <button key={p.key} type="button" disabled={busy}
              className={phase === p.key ? 'primary' : ''} onClick={() => kick(p.key)}>
              {p.label}
            </button>
          ))}
          <button type="button" className="primary" disabled={busy}
            onClick={() => run(
              () => finalizeEvent(eventId, token),
              `最終希望の登録は ${progress?.finalVoted ?? 0} / ${progress?.checkedIn ?? 0} 名です。確定して結果を配信しますか？`,
            )}>
            ⑥ 確定して結果を配信
          </button>
          <button type="button" className="danger" disabled={busy}
            onClick={() => run(
              () => purgeEvent(eventId, token),
              '参加者のプロフィールと投票データを今すぐ消去します。よろしいですか？',
            )}>
            ⑦ データを今すぐ消去
          </button>
        </div>
      </div>

      {pairs.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>成立ペア（会場で発表・呼び出し）</h2>
          <div className="grid">
            {pairs.map((pair) => (
              <div key={`${pair.male}-${pair.female}`} className="person" style={{ textAlign: 'center' }}>
                <div className="no">
                  <span style={{ color: 'var(--male)' }}>男 {pair.male}</span>
                  {' × '}
                  <span style={{ color: 'var(--female)' }}>女 {pair.female}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="muted">連絡先の交換は、お二人に会場で直接行っていただきます。</p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>受付</h2>
        {checkinToken && (
          <p className="muted" style={{ wordBreak: 'break-all' }}>
            掲示用URL: {origin}/e/{checkinToken}
          </p>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => issue('male')}>男性の枠を1つ発行</button>
          <button type="button" disabled={busy} onClick={() => issue('female')}>女性の枠を1つ発行</button>
          {isDemo && (
            <button type="button" disabled={busy}
              onClick={() => run(async () => {
                await organizerCall({ action: 'demo_seed', eventId }, token);
              })}>
              ダミー参加者20名を投入（デモ）
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>参加者</h2>
        <p className="muted">受付コードは受付でご本人にお伝えください。</p>
        <table>
          <thead>
            <tr><th>性別</th><th>No.</th><th>受付コード</th><th>状態</th><th /></tr>
          </thead>
          <tbody>
            {roster.map((row, index) => (
              <tr key={`${row.gender}-${row.number ?? `pending-${index}`}`}>
                <td>{row.gender === 'male' ? '男' : '女'}</td>
                <td>{row.number ?? '—'}</td>
                <td>{row.claimCode ?? '—'}</td>
                <td>{row.status === 'withdrawn' ? '辞退' : row.status === 'active' ? '受付済' : '未受付'}</td>
                <td>
                  {row.number !== null && (
                    <button type="button" className="inline" disabled={busy}
                      onClick={() => withdraw(row, row.status !== 'withdrawn')}>
                      {row.status === 'withdrawn' ? '戻す' : '辞退'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
