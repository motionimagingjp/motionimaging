'use client';
import { use, useCallback, useEffect, useState } from 'react';
import {
  finalizeEvent, organizerCall, purgeEvent,
  type PendingVoter, type PreviewResult, type Progress,
} from '../../../lib/api';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { PROFILE_FIELDS, optionsPreview } from '../../../lib/profile-options';
import QrCode from '../../../components/QrCode';

// ⑤最終希望のカウントダウン表示。過ぎても自動では閉じない（主催者が締め切るまで受付継続）
const FINAL_VOTE_SECONDS = 150;

const PHASES: { key: string; label: string; hint: string }[] = [
  { key: 'checkin', label: '① 参加者登録', hint: '会場のQRから番号を確定できるようになります' },
  { key: 'browse', label: '② 歓談開始（一覧公開）', hint: '参加者が相手のプロフィールを見られます' },
  { key: 'like_vote', label: '③ 好印象の投票開始', hint: '気になる人を選んでもらいます' },
  { key: 'like_reveal', label: '④ 好印象を開示', hint: '★が付きます。誰から何件かは出しません' },
  { key: 'final_vote', label: '⑤ 最終希望の受付開始', hint: '第1〜第3希望。150秒の目安を表示します' },
];

interface RosterRow {
  gender: 'male' | 'female';
  number: number | null;
  status: string;
  nickname: string | null;
  claimCode: string | null;
  hasProfile: boolean;
}

/** 参加者の状態を記号1文字にする。表で一列ずつ読まなくても全体が掴めるようにする */
function statusMark(row: RosterRow): { mark: string; label: string } {
  if (row.status === 'withdrawn') return { mark: '×', label: '辞退' };
  if (row.number === null) return { mark: '△', label: '未受付' };
  if (!row.hasProfile) return { mark: '○', label: '受付済（プロフ未入力）' };
  return { mark: '◎', label: '受付済・プロフ入力済' };
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
  const [prelinkToken, setPrelinkToken] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined = 未取得。取得済みなら以後のポーリングで編集中の内容を上書きしない
  const [profileFields, setProfileFields] = useState<string[] | null | undefined>(undefined);
  const [phaseUpdatedAt, setPhaseUpdatedAt] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [issueCount, setIssueCount] = useState(1);
  const [manualCode, setManualCode] = useState('');
  const [showVenueQr, setShowVenueQr] = useState(false);

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
      supabase.from('events')
        .select('checkin_token, prelink_token, is_demo, profile_field_keys').eq('id', eventId).single(),
      supabase.from('event_states').select('phase, updated_at').eq('event_id', eventId).single(),
    ]);
    if (event) {
      const e = event as {
        checkin_token: string; prelink_token: string;
        is_demo: boolean; profile_field_keys: string[] | null;
      };
      setCheckinToken(e.checkin_token);
      setPrelinkToken(e.prelink_token);
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
        setPreviewResult(await organizerCall<PreviewResult>({ action: 'preview_result', eventId }, token));
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

  const checkinByCode = () => run(async () => {
    if (!token || manualCode.length < 6) return;
    const res = await organizerCall<{ gender: 'male' | 'female'; participantNumber: number }>(
      { action: 'checkin_by_code', eventId, claimCode: manualCode }, token,
    );
    setManualCode('');
    setMessage(`${res.gender === 'male' ? '男性' : '女性'} No.${res.participantNumber} をチェックインしました`);
  });

  const withdraw = (row: RosterRow, withdrawn: boolean) => run(async () => {
    if (!token) return;
    // 未受付の人はまだ番号が無いので、受付コードで指定する（当日キャンセルの連絡はこのケース）
    await organizerCall({
      action: 'withdraw', eventId, claimCode: row.claimCode,
      gender: row.gender, participantNumber: row.number, withdrawn,
    }, token);
  }, withdrawn
    ? '辞退（欠席・途中退席）にします。この方は一覧に表示されず、マッチングの対象外になります。よろしいですか？'
    : '辞退を取り消して、参加中に戻します。よろしいですか？');

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
  const prelinkUrl = prelinkToken ? `${origin}/p/${prelinkToken}` : null;

  const elapsedSeconds = phaseUpdatedAt ? Math.floor((now - new Date(phaseUpdatedAt).getTime()) / 1000) : 0;
  const finalVoteCountdown = phase === 'final_vote' ? Math.max(0, FINAL_VOTE_SECONDS - elapsedSeconds) : null;

  const pendingLabel = (list: PendingVoter[]) => {
    const male = list.filter((p) => p.gender === 'male').map((p) => p.number).join('、');
    const female = list.filter((p) => p.gender === 'female').map((p) => p.number).join('、');
    return { male, female };
  };

  // 「全員終わったか」を数字の比較ではなく記号で示す。会場では一瞬で判断したい
  const doneMark = (done: number, total: number) =>
    (total > 0 && done >= total ? <span className="done-mark">✓ 完了</span> : null);

  const pairText = (list: { male: number | null; female: number | null }[] | undefined) =>
    (list ?? []).map((p) => `男${p.male} × 女${p.female}`).join(' / ');

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
              <tr>
                <th>受付済み</th>
                <td>{progress.checkedIn} / {progress.invited} 名 {doneMark(progress.checkedIn, progress.invited)}</td>
              </tr>
              <tr><th>男女</th><td>男性 {progress.male} / 女性 {progress.female}</td></tr>
              <tr>
                <th>プロフ登録</th>
                <td>
                  {progress.profileCompleted} / {progress.checkedIn} 名
                  {' '}{doneMark(progress.profileCompleted, progress.checkedIn)}
                </td>
              </tr>
              <tr>
                <th>好印象 投票済み</th>
                <td>
                  {progress.likeVoted} / {progress.checkedIn} 名
                  {' '}{doneMark(progress.likeVoted, progress.checkedIn)}
                  {/* ★フェーズが進んでも消えないようにする。人数だけでは誰が残っているか
                      分からず、声かけできないまま次のフェーズに進んでしまっていた（実際の不具合） */}
                  {progress.pendingLike.length > 0 && (
                    <div className="muted" style={{ marginTop: 2 }}>
                      未投票: {pendingLabel(progress.pendingLike).male && `男 ${pendingLabel(progress.pendingLike).male}`}
                      {' '}{pendingLabel(progress.pendingLike).female && `女 ${pendingLabel(progress.pendingLike).female}`}
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <th>最終希望 投票済み</th>
                <td>
                  {progress.finalVoted} / {progress.checkedIn} 名
                  {' '}{doneMark(progress.finalVoted, progress.checkedIn)}
                  {progress.pendingFinal.length > 0 && (
                    <div className="muted" style={{ marginTop: 2 }}>
                      未投票: {pendingLabel(progress.pendingFinal).male && `男 ${pendingLabel(progress.pendingFinal).male}`}
                      {' '}{pendingLabel(progress.pendingFinal).female && `女 ${pendingLabel(progress.pendingFinal).female}`}
                    </div>
                  )}
                </td>
              </tr>
              <tr><th>辞退</th><td>{progress.withdrawn} 名</td></tr>
            </tbody>
          </table>
        ) : <p className="muted">読み込み中…</p>}
        <p className="muted" style={{ marginBottom: 0 }}>
          この表は5秒ごとに自動更新されます（再読み込みは不要です）。
          参加者が「選び直す」で送信を取り消した場合も、この数に反映されます。
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>一斉キック</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {PHASES.map((p) => (
            <div key={p.key}>
              <button type="button" disabled={busy}
                className={phase === p.key ? 'primary' : ''} onClick={() => kick(p.key)}>
                {p.label}
              </button>
              <p className="muted" style={{ margin: '4px 0 0' }}>{p.hint}</p>
            </div>
          ))}

          {/* 未投票の一覧は上の「進捗」カードに常時表示するため、ここでは繰り返さない */}

          {phase === 'final_vote' && (
            <>
              <p className="countdown" style={{ margin: 0 }}>残り {finalVoteCountdown} 秒</p>
              <p className="muted" style={{ margin: 0 }}>
                時間が来ても自動では締め切りません。締め切るまで投票は受け付けます。
              </p>
              <button type="button" disabled={busy} onClick={() => kick('calculating')}>
                投票を締め切って集計する
              </button>
            </>
          )}

          {phase === 'calculating' && (
            <div className="notice">
              {previewResult ? (
                <>
                  <p style={{ margin: 0 }}>
                    <strong>本日は {previewResult.matchedPairsCount} 組マッチしました</strong>
                    （まだ参加者には配信されていません）
                  </p>
                  {(previewResult.pairs ?? []).length > 0 && (
                    <p style={{ margin: '6px 0 0' }}>成立: {pairText(previewResult.pairs)}</p>
                  )}
                  <p className="muted" style={{ margin: '6px 0 0' }}>
                    片想いのみ {previewResult.oneSidedPairsCount} 組（成立しません）
                  </p>
                </>
              ) : '集計中…'}
            </div>
          )}

          <button type="button" className="primary" disabled={busy}
            onClick={() => run(
              () => finalizeEvent(eventId, token),
              previewResult
                ? `${previewResult.matchedPairsCount} 組（${pairText(previewResult.pairs)}）を確定して結果を配信しますか？`
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
        <h2 style={{ marginTop: 0 }}>① 枠を発行する（申し込みを受けたら）</h2>
        <p className="muted">
          申し込み人数ぶんの枠をまとめて発行します。1枠につき受付コードが1つ発行されます。
          コードは先頭1桁が性別（1=男性 / 2=女性）、続く2桁が登録順です。
        </p>
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

      {prelinkUrl && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>② 事前案内を送る（全員に同じリンク）</h2>
          <p className="muted">
            リンクはこの1本だけです。参加者ごとに違うURLを作る必要はありません。
            メールには<strong>このリンクとご本人の受付コード</strong>を書いてください。
          </p>
          <p className="muted" style={{ wordBreak: 'break-all' }}>{prelinkUrl}</p>
          <QrCode value={prelinkUrl} />
          <div className="notice" style={{ marginTop: 12 }}>
            このリンクは<strong>プロフィール入力専用</strong>です。ここからチェックイン（出席登録）はできません。
          </div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 14 }}>
              案内メールの文例をコピーする
            </summary>
            <textarea readOnly style={{ marginTop: 8, minHeight: 200 }} value={[
              'この度はお申し込みありがとうございます。',
              '',
              '【事前のお願い】',
              '下記のリンクを開き、受付コードを入力してプロフィールをご登録ください。',
              prelinkUrl,
              '',
              '受付コード：（この方の7桁のコード）',
              '',
              '【当日】',
              '会場に掲示しているQRコードを読み取り、同じ受付コードを入力すると番号が決まります。',
              'プロフィールの事前登録がお済みでない場合も、当日その場でご入力いただけます。',
              '',
              '※連絡先はお預かりしません。交換は会場で直接お願いします。',
              '※ご登録いただいた内容はイベント終了30分後に自動的に消去されます。',
            ].join('\n')} />
          </details>
        </div>
      )}

      {checkinToken && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>③ 当日の受付（会場に掲示するQR）</h2>
          <div className="notice" style={{ marginBottom: 12 }}>
            <strong>このQRは会場に掲示する専用です。事前にメール等で送らないでください。</strong>
            <br />
            会場でしか見られないからこそ「本当に来場した」証明になります。送ってしまうと、
            来ていない人でも自宅からチェックインできてしまいます。
          </div>
          <p className="muted">
            読み取ると受付コードの入力画面が開き、入力した時点でチェックイン（出席登録・番号確定）が完了します。
            <br />先に「① 参加者登録」を押しておいてください。押していないと番号が出ません。
          </p>
          <button type="button" onClick={() => setShowVenueQr((v) => !v)}>
            {showVenueQr ? '掲示用QRを隠す' : '掲示用QRを表示する'}
          </button>
          {showVenueQr && (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ wordBreak: 'break-all' }}>
                掲示用URL: {origin}/e/{checkinToken}
              </p>
              <QrCode value={`${origin}/e/${checkinToken}`} />
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>会場到着チェックイン（代理）</h2>
        <p className="muted">
          プロフィールは事前入力済みでも、会場到着チェックインは別操作です（「① 参加者登録」が必要）。
          参加者本人のスマホ操作が難しい場合、受付コードを聞き取って代わりにチェックインできます。
        </p>
        <label htmlFor="manualCode">受付コード</label>
        <input
          id="manualCode"
          inputMode="numeric"
          maxLength={7}
          placeholder="1010473"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <button type="button" className="primary" style={{ marginTop: 8 }}
          disabled={busy || manualCode.length < 6} onClick={checkinByCode}>
          このコードでチェックインさせる
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>プロフィール項目</h2>
        <p className="muted">参加者に聞く項目を選べます（選択肢の中身は固定です）。</p>
        <div style={{ display: 'grid', gap: 10 }}>
          {PROFILE_FIELDS.map((field) => (
            <label key={field.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--text)', margin: 0 }}>
              <input
                type="checkbox"
                checked={activeFields.includes(field.key)}
                disabled={busy}
                onChange={() => toggleField(field.key)}
                style={{ width: 22, height: 22, minHeight: 22, marginTop: 2, flex: '0 0 auto' }}
              />
              <span>
                {field.label}
                {/* 項目名だけだと何を聞かれるのか分からないため、実際の選択肢を並べて見せる */}
                <span className="muted" style={{ display: 'block' }}>{optionsPreview(field)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>参加者</h2>
        <p className="muted">
          △ 未受付 ／ ○ 受付済（プロフ未入力）／ ◎ 受付済・プロフ入力済 ／ × 辞退
          <br />
          「辞退」は欠席連絡や途中退席のときに使います。押すと一覧から外れ、マッチングの対象外になります。
        </p>
        <table>
          <thead>
            <tr><th>状態</th><th>性別</th><th>No.</th><th>受付コード</th><th>ニックネーム</th><th /></tr>
          </thead>
          <tbody>
            {roster.map((row, index) => {
              const { mark, label } = statusMark(row);
              return (
                <tr key={`${row.gender}-${row.claimCode ?? row.number ?? index}`}>
                  <td><span className="state-mark" title={label}>{mark}</span></td>
                  <td>{row.gender === 'male' ? '男' : '女'}</td>
                  <td>{row.number ?? '—'}</td>
                  <td>{row.claimCode ?? '—'}</td>
                  <td>{row.nickname ?? '—'}</td>
                  <td>
                    <button type="button" className="inline" disabled={busy}
                      onClick={() => withdraw(row, row.status !== 'withdrawn')}>
                      {row.status === 'withdrawn' ? '戻す' : '辞退'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {roster.length === 0 && <p className="muted">まだ枠を発行していません。</p>}
      </div>
    </main>
  );
}
