'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError, checkin, getResult, listParticipants, submitVote,
  type ListResult, type ResultPayload,
} from '../lib/api';
import { watchPhase } from '../lib/phase';
import { loadSessionToken, loadVoteDraft, saveSessionToken, saveVoteDraft } from '../lib/storage';
import PersonList from './PersonList';
import ProfileForm from './ProfileForm';
import ResultScreen from './ResultScreen';

interface Me {
  eventId: string;
  gender: 'male' | 'female';
  participantNumber: number;
  nickname: string | null;
}

const LIST_PHASES = ['browse', 'like_vote', 'like_reveal', 'final_vote', 'calculating', 'result'];

export default function ParticipantApp({ tokenFromUrl }: { tokenFromUrl: string | null }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<string>('checkin');
  const [step, setStep] = useState<'checkin' | 'number' | 'profile' | 'event'>('checkin');
  const [agreed, setAgreed] = useState(false);
  const [list, setList] = useState<ListResult | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<'like' | 'final' | null>(null);

  useEffect(() => {
    // URLのトークンを優先し、無ければ端末に残っているものを使う（ブラウザを閉じても番号が消えない）
    const token = tokenFromUrl ?? loadSessionToken();
    if (token) {
      setSessionToken(token);
      saveSessionToken(token);
    }
  }, [tokenFromUrl]);

  const doCheckin = useCallback(async () => {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await checkin({ sessionToken, agreed: true });
      setMe({
        eventId: (res as unknown as { eventId: string }).eventId,
        gender: res.gender,
        participantNumber: res.participantNumber,
        nickname: res.nickname,
      });
      setStep('number');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '受付に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [sessionToken]);

  // 一斉キックの受信。Realtime とポーリングの二重化は watchPhase 側で行う
  useEffect(() => {
    if (!me) return;
    return watchPhase(me.eventId, (next) => setPhase(next));
  }, [me]);

  const refreshList = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setList(await listParticipants(sessionToken));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '一覧を取得できませんでした');
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!me || !LIST_PHASES.includes(phase)) return;
    if (step !== 'event') setStep('event');
    void refreshList();
    // フェーズが変わったら選択状態は作り直す
    setSubmitted(null);
    setSelected(phase === 'like_vote' || phase === 'final_vote'
      ? loadVoteDraft(phase === 'like_vote' ? 'like' : 'final')
      : []);
  }, [me, phase, refreshList, step]);

  useEffect(() => {
    if (!sessionToken || (phase !== 'result' && phase !== 'purged')) return;
    void getResult(sessionToken).then(setResult).catch(() => setResult(null));
  }, [sessionToken, phase]);

  const toggle = (target: number) => {
    setSelected((prev) => {
      const next = prev.includes(target)
        ? prev.filter((n) => n !== target)
        : phase === 'final_vote' && prev.length >= 3 ? prev : [...prev, target];
      saveVoteDraft(phase === 'like_vote' ? 'like' : 'final', next);
      return next;
    });
  };

  const send = async (voteType: 'like' | 'final') => {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      await submitVote({ sessionToken, voteType, targetNumbers: selected });
      setSubmitted(voteType);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '送信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (!sessionToken) {
    return (
      <main>
        <h1>受付</h1>
        <div className="card">
          <p>
            主催者からお送りした<strong>個別URL</strong>を開いてください。
            お手元にない場合は、会場の受付でお声がけください。
          </p>
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main>
        <h1>受付</h1>
        <div className="card">
          <p>本日はご参加ありがとうございます。以下をご確認のうえ受付を完了してください。</p>
          <ul className="muted" style={{ lineHeight: 1.9 }}>
            <li>お預かりするのはニックネームとプロフィールのみです</li>
            <li><strong>連絡先はお預かりしません</strong>（交換は会場で直接お願いします）</li>
            <li>プロフィールと投票データはイベント終了30分後に自動的に消去されます</li>
          </ul>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: 24, height: 24, minHeight: 24 }}
            />
            利用規約とプライバシーポリシーに同意します
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="primary" disabled={!agreed || busy} onClick={doCheckin}>
          {busy ? '受付中…' : '受付する'}
        </button>
      </main>
    );
  }

  if (step === 'number') {
    return (
      <main>
        <div className={`big-number ${me.gender}`}>
          <div className="label">あなたの番号は</div>
          <div className="value">{me.gender === 'male' ? '男性' : '女性'}<br />No.{me.participantNumber}</div>
        </div>
        <p className="muted" style={{ textAlign: 'center' }}>
          会場ではこの番号でお呼びします。画面を閉じても番号は残ります。
        </p>
        <button type="button" className="primary" onClick={() => setStep('profile')}>
          プロフィールを確認する
        </button>
      </main>
    );
  }

  if (step === 'profile') {
    return (
      <main>
        <ProfileForm
          sessionToken={sessionToken}
          initial={{ nickname: me.nickname }}
          onSaved={() => setStep('event')}
        />
      </main>
    );
  }

  if (phase === 'result' || phase === 'purged') {
    return (
      <main>
        <h1>結果発表</h1>
        {result ? <ResultScreen result={result} /> : <p className="muted">結果を読み込んでいます…</p>}
      </main>
    );
  }

  if (phase === 'calculating') {
    return (
      <main>
        <h1>集計中</h1>
        <div className="card">
          <p>
            全員の第1〜第3希望を解析し、会場全体で最も多くのカップルが誕生する
            最適な組み合わせを自動計算しています。
          </p>
          <p className="muted">そのままお待ちください。</p>
        </div>
      </main>
    );
  }

  if (!LIST_PHASES.includes(phase)) {
    return (
      <main>
        <div className={`big-number ${me.gender}`}>
          <div className="label">{me.gender === 'male' ? '男性' : '女性'}</div>
          <div className="value">No.{me.participantNumber}</div>
        </div>
        <div className="card">
          <p>まもなく開始します。主催者の案内をお待ちください。</p>
        </div>
      </main>
    );
  }

  const mode = phase === 'like_vote' ? 'like' : phase === 'final_vote' ? 'final' : 'none';
  const showStars = ['like_reveal', 'final_vote', 'calculating', 'result'].includes(phase);

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>
          {phase === 'like_vote' ? '気になる方を選ぶ'
            : phase === 'final_vote' ? '第1〜第3希望を選ぶ'
              : phase === 'like_reveal' ? '好印象のお知らせ' : '参加者一覧'}
        </h1>
        <span className="muted">あなた: No.{me.participantNumber}</span>
      </div>

      {phase === 'like_reveal' && (
        <div className="card">
          {list?.hasLikes
            ? <p style={{ margin: 0 }}>★ が付いた方から好印象が届いています。ぜひお話ししてみてください。</p>
            /* 0件を「0件」と見せないこと（仕様 4-1④） */
            : <p style={{ margin: 0 }}>集計中、または順次開示されます。引き続きご歓談ください。</p>}
        </div>
      )}

      {phase === 'final_vote' && (
        <p className="muted">
          選んだ順に第1希望・第2希望・第3希望になります（最大3名）。
          お互いに選び合った場合のみ成立します。
        </p>
      )}

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {list && (
        <PersonList
          participants={list.participants}
          selfGender={me.gender}
          mode={mode}
          selected={selected}
          onToggle={toggle}
          showStars={showStars}
        />
      )}

      {mode !== 'none' && (
        <div className="sticky-actions">
          <div>
            {submitted === mode
              ? <button type="button" onClick={() => setSubmitted(null)}>送信しました（選び直す）</button>
              : (
                <button type="button" className="primary" disabled={busy} onClick={() => send(mode)}>
                  {busy ? '送信中…' : `${selected.length}名を送信する`}
                </button>
              )}
          </div>
        </div>
      )}
    </main>
  );
}
