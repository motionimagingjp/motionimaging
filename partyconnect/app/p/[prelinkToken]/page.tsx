'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, checkin } from '../../../lib/api';
import { saveSessionToken } from '../../../lib/storage';

/**
 * 事前案内のイベント共通リンク。受付コードを入れるとプロフィール入力画面に入れる。
 *
 * ★このリンクからはチェックイン（出席登録・番号確定）はできない。
 *   出席したかどうかは会場に掲示したQR(/e/...)からしか確定させない。
 *   事前に配るリンクで出席登録できてしまうと、来ていない人まで出席扱いになる。
 * ★参加者1人ずつに別々のURLを送る必要はない。案内メールはこのリンク1本 +
 *   本人の受付コードで足りる。
 */
export default function PrelinkPage({ params }: { params: Promise<{ prelinkToken: string }> }) {
  const { prelinkToken } = use(params);
  const router = useRouter();
  const [claimCode, setClaimCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await checkin({ prelinkToken, claimCode, agreed: true });
      saveSessionToken(res.sessionToken);
      router.replace(`/join?t=${encodeURIComponent(res.sessionToken)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '受付に失敗しました');
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>事前プロフィール登録</h1>
      <div className="card">
        <p>お申し込みありがとうございます。以下をご確認のうえ受付を完了してください。</p>
        <label htmlFor="claim">受付コード</label>
        <p className="muted" style={{ marginTop: -4 }}>
          申し込み時にお送りした番号です。
        </p>
        <input
          id="claim"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="1010473"
          style={{ fontSize: 28, letterSpacing: '0.3em', textAlign: 'center' }}
          value={claimCode}
          onChange={(e) => setClaimCode(e.target.value.replace(/[^0-9]/g, ''))}
        />
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

      <div className="notice" style={{ marginBottom: 12 }}>
        当日の受付（番号の確定）は会場で行います。ここでは<strong>プロフィールの入力だけ</strong>です。
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <button
        type="button"
        className="primary"
        disabled={busy || claimCode.length < 6 || !agreed}
        onClick={submit}
      >
        {busy ? '確認中…' : 'プロフィール入力に進む'}
      </button>
    </main>
  );
}
