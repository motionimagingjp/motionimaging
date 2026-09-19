'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { finalizeEvent, organizerCall, purgeEvent, type PendingVoter, type Progress } from '../../../lib/api';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { PROFILE_FIELDS } from '../../../lib/profile-options';
import QrCode from '../../../components/QrCode';

// ⑤最終希望のカウントダウン表示。過ぎても自動では閉じない（主催者が締め切るまで受付継続）
const FINAL_VOTE_SECONDS = 150;

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
  // undefined = 未取得。取得済みなら以後のポーリングで編集中の内容を上書きしない
  const [profileFields, setProfileFields] = useState<string[] | null | undefined>(undefined);
  const [phaseUpdatedAt, setPhaseUpdatedAt] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{ matchedPairsCount: number; oneSidedPairsCount: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [issueCount, setIssueCount] = useState(1);
  const [openQrFor, setOpenQrFor] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    // アクセストークンは裏側で自動更新される。ここで拾わないと、古いトークンのまま
    // 使い続けて期限切れ後にすべての操作が401で失敗する
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [{ data: event }, { data: state }] = await Promise.all([
      supabase.from('events').select('checkin_token, is_demo, profile_field_keys').eq('id', eventId).single(),
      supabase.from('event_states').select('phase, updated_at').eq('event_id', eventId).single(),
    ]);
    if (event) {
      const e = event as { checkin_token: string; is_demo: boolean; profile_field_keys: string[] | null };
      setCheckinToken(e.checkin_token);
      setIsDemo(e.is_demo);
      setProfileFields((prev) => (prev === undefined ? e.profile_field_keys : prev));
    }
    let currentPhase = phase;
    if (state) {
      currentPhase = (state as { phase: string }).phase;
      setPhase(currentPhase);
      setPhaseUpdatedAt((state as { updated_at: string }).updated_at);
    }
    try {
      setProgress(await organizerCall<Progress>({ action: 'progress', eventId }, token));
      const r = await organizerCall<{ participants: RosterRow[] }>({ action: 'roster', eventId }, token);
      setRoster(r.participants);
      const p = await organizerCall<{ pairs: typeof pairs }>({ action: 'pairs', eventId }, token);
      setPairs(p.pairs);
      // 配信前のマッチ確認。計算中フェーズの間だけ取得する（結果はまだ誰にも配信されない）
      if (currentPhase === 'calculating') {
        setPreviewResult(await organizerCall({ action: 'preview_result', eventId }, token));
      } else {
        setPreviewResult(null);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '取得に失敗しました');
    }
  }, [supabase, eventId, token, phase]);

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
    await organizerCall({ action: 'issue_slots', eventId, gender, count: issueCount, isProxy: true }, token);
  });

  const withdraw = (row: RosterRow, withdrawn: boolean) => run(async () => {
    if (!token || row.number === null) return;
    await organizerCall({
      action: 'withdraw', eventId, gender: row.gender, participantNumber: row.number, withdrawn,
    }, token);
  });

  // profileFields が null の間は「全項目有効」の意味。個別に外した時点で明示リストに切り替える
  const activeFields = profileFields ?? PROFILE_FIELDS.map((f) => f.key);
  const toggleField = (key: string) => run(async () => {
    const next = activeFields.includes(key)
      ? activeFields.filter((k) => k !== key) : [...activeFields, key];
    const { error } = await supabase.rpc('set_event_profile_fields', {
      p_event_id: eventId, p_field_keys: next,
    });
    if (error) throw error;
    setProfileFields(next);
  });

  if (!token) return <main><p className="muted">ログインが必要です。</p></main>;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const elapsedSeconds = phaseUpdatedAt ? Math.floor((now - new Date(phaseUpdatedAt).getTime()) / 1000) : 0;
  const finalVoteCountdown = phase === 'final_vote' ? Math.max(0, FINAL_VOTE_SECONDS - elapsedSeconds) : null;

  const pendingLabel = (list: PendingVoter[]) => {
    const male = list.filter((p) => p.gender === 'male').map((p) => p.number).join('、');
    const female = list.filter((p) => p.gender === 'female').map((p) => p.number).join('、');
    return { male, female };
  };

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

          {phase === 'like_vote' && progress && progress.pendingLike.length > 0 && (() => {
            const { male, female } = pendingLabel(progress.pendingLike);
            return (
              <p className="muted" style={{ margin: 0 }}>
                未投票（好印象）: {male && `男 ${male}`} {female && `女 ${female}`}
              </p>
            );
          })()}

          {phase === 'final_vote' && (
            <>
              <p className="countdown" style={{ margin: 0 }}>残り {finalVoteCountdown} 秒</p>
              <p className="muted" style={{ margin: 0 }}>
                時間が来ても自動では締め切りません。締め切るまで投票は受け付けます。
              </p>
              {progress && progress.pendingFinal.length > 0 && (() => {
                const { male, female } = pendingLabel(progress.pendingFinal);
                return (
                  <p className="muted" style={{ margin: 0 }}>
                    未投票（最終希望）: {male && `男 ${male}`} {female && `女 ${female}`}
                  </p>
                );
              })()}
              <button type="button" disabled={busy} onClick={() => kick('calculating')}>
                投票を締め切って集計する
              </button>
            </>
          )}

          {phase === 'calculating' && (
            <div className="notice">
              {previewResult
                ? `本日は ${previewResult.matchedPairsCount} 組マッチしました（まだ参加者には配信されていません）`
                : '集計中…'}
            </div>
          )}

          <button type="button" className="primary" disabled={busy}
            onClick={() => run(
              () => finalizeEvent(eventId, token),
              previewResult
                ? `${previewResult.matchedPairsCount} 組を確定して結果を配信しますか？`
                : `最終希望の登録は ${progress?.finalVoted ?? 0} / ${progress?.checkedIn ?? 0} 名です。確定して結果を配信しますか？`,
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
          <>
            <p className="muted" style={{ wordBreak: 'break-all' }}>
              掲示用URL: {origin}/e/{checkinToken}
            </p>
            <QrCode value={`${origin}/e/${checkinToken}`} />
            <p className="muted">会場の掲示物に印刷して、当日飛び込みの方はここから読み取ってもらえます。</p>
          </>
        )}
        <label htmlFor="issueCount">まとめて発行する人数</label>
        <input
          id="issueCount"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={issueCount}
          onChange={(e) => setIssueCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
        />
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <button type="button" disabled={busy} onClick={() => issue('male')}>男性の枠を{issueCount}件発行</button>
          <button type="button" disabled={busy} onClick={() => issue('female')}>女性の枠を{issueCount}件発行</button>
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
        <h2 style={{ marginTop: 0 }}>プロフィール項目</h2>
        <p className="muted">参加者に聞く項目を選べます（選択肢の中身は固定です）。</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {PROFILE_FIELDS.map((field) => (
            <label key={field.key} style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={activeFields.includes(field.key)}
                disabled={busy}
                onChange={() => toggleField(field.key)}
                style={{ width: 22, height: 22, minHeight: 22 }}
              />
              {field.label}
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>参加者</h2>
        <p className="muted">受付コードは受付でご本人にお伝えください。</p>
        <table>
          <thead>
            <tr><th>性別</th><th>No.</th><th>受付コード</th><th>状態</th><th /><th /></tr>
          </thead>
          <tbody>
            {roster.map((row, index) => {
              const rowKey = `${row.gender}-${row.claimCode ?? row.number ?? index}`;
              return (
                <tr key={rowKey}>
                  <td>{row.gender === 'male' ? '男' : '女'}</td>
                  <td>{row.number ?? '—'}</td>
                  <td>{row.claimCode ?? '—'}</td>
                  <td>{row.status === 'withdrawn' ? '辞退' : row.status === 'active' ? '受付済' : '未受付'}</td>
                  <td>
                    {row.claimCode && checkinToken && (
                      <button type="button" className="inline" disabled={busy}
                        onClick={() => setOpenQrFor(openQrFor === rowKey ? null : rowKey)}>
                        {openQrFor === rowKey ? '閉じる' : '個人QR'}
                      </button>
                    )}
                  </td>
                  <td>
                    {row.number !== null && (
                      <button type="button" className="inline" disabled={busy}
                        onClick={() => withdraw(row, row.status !== 'withdrawn')}>
                        {row.status === 'withdrawn' ? '戻す' : '辞退'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {roster.map((row, index) => {
          const rowKey = `${row.gender}-${row.claimCode ?? row.number ?? index}`;
          if (openQrFor !== rowKey || !row.claimCode || !checkinToken) return null;
          return (
            <div key={`qr-${rowKey}`} className="card" style={{ marginTop: 12 }}>
              <p className="muted">
                {row.gender === 'male' ? '男' : '女'}・受付コード {row.claimCode} の個人QR（事前にメール等で本人へ送付できます）
              </p>
              <QrCode value={`${origin}/e/${checkinToken}?code=${row.claimCode}`} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
