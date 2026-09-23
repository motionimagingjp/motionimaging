'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ApiError, checkin, getResult, listParticipants, submitVote,
  type Branding, type ListResult, type ResultPayload,
} from '../lib/api';
import { watchPhase } from '../lib/phase';
import {
  clearEventLocalData, loadMemos, loadSessionToken, loadVoteDraft,
  saveMemos, saveSessionToken, saveVoteDraft, type MemoMap,
} from '../lib/storage';
import BrandBar from './BrandBar';
import PersonList from './PersonList';
import ProfileForm from './ProfileForm';
import ResultScreen from './ResultScreen';

interface Me {
  eventId: string;
  gender: 'male' | 'female';
  // null = まだ会場到着チェックインが済んでいない（事前入力のみ）
  participantNumber: number | null;
  nickname: string | null;
  profileData: Record<string, string | string[]>;
  freeText: string | null;
  enabledProfileFields: string[] | null;
}

const LIST_PHASES = ['browse', 'like_vote', 'like_reveal', 'final_vote', 'calculating', 'result'];

export default function ParticipantApp({ tokenFromUrl }: { tokenFromUrl: string | null }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [phase, setPhase] = useState<string>('checkin');
  const [step, setStep] = useState<'checkin' | 'arrive' | 'number' | 'profile' | 'event'>('checkin');
  const [agreed, setAgreed] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [list, setList] = useState<ListResult | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [memos, setMemos] = useState<MemoMap>({});
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

  const openSession = useCallback(async (withConsent: boolean) => {
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await checkin({ sessionToken, agreed: withConsent });
      setNeedsConsent(false);
      setBranding(res.branding);
      setMe({
        eventId: res.eventId,
        gender: res.gender,
        participantNumber: res.participantNumber,
        nickname: res.nickname,
        profileData: res.profileData ?? {},
        freeText: res.freeText,
        enabledProfileFields: res.enabledProfileFields,
      });
      // 番号未確定 = まだ会場でチェックインしていない。事前入力の案内へ
      setStep(res.participantNumber === null ? 'arrive' : 'number');
    } catch (e) {
      // 未同意なら同意画面を出す。すでに同意済みの人には二度と聞かない
      if (e instanceof ApiError && e.code === 'consent_required') {
        setNeedsConsent(true);
      } else {
        setError(e instanceof ApiError ? e.message : '受付に失敗しました');
        setNeedsConsent(true);
      }
    } finally {
      setBusy(false);
    }
  }, [sessionToken]);

  // 一度同意した人は、会場でアプリを開き直しても同意画面を経由しないで戻れる
  useEffect(() => {
    if (!sessionToken || me) return;
    void openSession(false);
  }, [sessionToken, me, openSession]);

  // 一斉キックの受信。Realtime とポーリングの二重化は watchPhase 側で行う
  useEffect(() => {
    if (!me) return;
    return watchPhase(me.eventId, (next) => setPhase(next));
  }, [me]);

  useEffect(() => {
    if (!me) return;
    setMemos(loadMemos(me.eventId));
  }, [me]);

  const updateMemo = (key: string, text: string) => {
    if (!me) return;
    setMemos((prev) => {
      const next = { ...prev };
      if (text.trim() === '') delete next[key]; else next[key] = text;
      saveMemos(me.eventId, next);
      return next;
    });
  };

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
    // プロフィール編集中は画面を奪わない（フェーズが進んでも入力を消さない）
    if (step !== 'event' && step !== 'profile') setStep('event');
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

  // データ消去まで進んだら、端末に残したメモと下書きもここで消す
  useEffect(() => {
    if (phase !== 'purged' || !me) return;
    clearEventLocalData(me.eventId);
    setMemos({});
  }, [phase, me]);

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

  // 0人のまま送信すると「誰にも好印象を送っていない」ことになる。
  // 選び直し中の誤送信を防ぐため、0人の時だけ確認を挟む
  const handleSendClick = (voteType: 'like' | 'final') => {
    if (selected.length === 0) {
      const label = voteType === 'like' ? '気になる方を1人も選んでいません' : '希望を1人も選んでいません';
      if (!window.confirm(`${label}。このまま0人で送信しますか？`)) return;
    }
    void send(voteType);
  };

  if (!sessionToken) {
    return (
      <main>
        <h1>受付</h1>
        <div className="card">
          <p>
            主催者からお送りした<strong>事前リンク</strong>を開き、お手元の
            <strong>受付コード</strong>を入力してください。
            お困りの場合は、会場の受付でお声がけください。
          </p>
        </div>
      </main>
    );
  }

  if (!me) {
    if (!needsConsent) {
      return <main><p className="muted">読み込んでいます…</p></main>;
    }
    return (
      <main>
        <BrandBar branding={branding} />
        <h1>受付</h1>
        <div className="card">
          <p>お申し込みありがとうございます。以下をご確認のうえ受付を完了してください。</p>
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
            <Link href="/terms" target="_blank">利用規約</Link>とプライバシーポリシーに同意します
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <button
          type="button" className="primary" disabled={!agreed || busy}
          onClick={() => void openSession(true)}
        >
          {busy ? '受付中…' : '受付する'}
        </button>
      </main>
    );
  }

  if (step === 'arrive') {
    return (
      <main>
        <h1>事前受付</h1>
        <div className="card">
          <p>プロフィールを先に入力しておくと、当日の受付がスムーズです。</p>
          <button type="button" className="primary" onClick={() => setStep('profile')}>
            プロフィールを{me.nickname ? '編集する' : '入力する'}
          </button>
          {me.nickname && <p className="muted" style={{ marginBottom: 0 }}>入力済み：{me.nickname}</p>}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>当日のチェックイン</h2>
          <p>
            会場に到着したら、<strong>会場に掲示されているQRコード</strong>を読み取り、
            お手元の受付コードを入力してください。そこで番号が決まります。
          </p>
          {/* 出席の確認は会場でしか行えないようにしている。この画面からは登録できない（仕様） */}
          <p className="muted">
            このページからはチェックインできません。QRが読み取れない場合は、会場の受付で
            受付コードをお伝えください。
          </p>
        </div>
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
          eventId={me.eventId}
          initial={{ nickname: me.nickname, profileData: me.profileData, freeText: me.freeText }}
          enabledFields={me.enabledProfileFields}
          onSaved={(saved) => {
            setMe({ ...me, ...saved });
            setStep(me.participantNumber === null ? 'arrive' : 'event');
          }}
          onCancel={() => setStep(me.participantNumber === null ? 'arrive' : 'event')}
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
        <button type="button" onClick={() => setStep('profile')}>
          自分のプロフィールを確認・修正する
        </button>
      </main>
    );
  }

  const mode = phase === 'like_vote' ? 'like' : phase === 'final_vote' ? 'final' : 'none';
  const showStars = ['like_reveal', 'final_vote', 'calculating', 'result'].includes(phase);

  return (
    <main>
      <BrandBar branding={branding} />
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h1 style={{ margin: 0 }}>
          {phase === 'like_vote' ? '気になる方を選ぶ'
            : phase === 'final_vote' ? '第1〜第3希望を選ぶ'
              : phase === 'like_reveal' ? '好印象のお知らせ' : '参加者一覧'}
        </h1>
        {/* 自分の番号は必ず見える位置に出す。タイトルが長いと右端に押し出されて
            見切れることがあったため、折り返し可能なバッジにしている */}
        <button
          type="button" className={`my-number ${me.gender}`}
          onClick={() => setStep('profile')}
          title="自分のプロフィールを確認・修正する"
        >
          あなた: No.{me.participantNumber}{me.nickname ? `（${me.nickname}）` : ''} ✎
        </button>
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
          memos={memos}
          onMemoChange={updateMemo}
        />
      )}

      {mode !== 'none' && (
        <div className="sticky-actions">
          <div>
            {submitted === mode
              ? <button type="button" onClick={() => setSubmitted(null)}>送信しました（選び直す）</button>
              : (
                <button type="button" className="primary" disabled={busy} onClick={() => handleSendClick(mode)}>
                  {busy ? '送信中…' : `${selected.length}名を送信する`}
                </button>
              )}
          </div>
        </div>
      )}
    </main>
  );
}
