'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, checkin } from '../../../lib/api';
import { saveSessionToken } from '../../../lib/storage';

/**
 * 会場に掲示したQRから開く受付ページ。ここで6桁コードを引き換えると出席登録まで完了する。
 *
 * ★このページのURL(checkin_token)は会場の掲示物でしか見られないため、開けたこと自体が
 *   「会場に来ている」ことの根拠になる。事前送付するリンクにこのURLを含めてはいけない。
 * ★同じ理由で、コードをURLパラメータから自動入力する仕組みは持たせない。
 *   自動入力できると、それを事前にメールで送るだけで自宅から出席登録できてしまう。
 */
export default function ClaimPage({ params }: { params: Promise<{ checkinToken: string }> }) {
  const { checkinToken } = use(params);
  const router = useRouter();
  const [claimCode, setClaimCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await checkin({ checkinToken, claimCode, agreed: true });
      saveSessionToken(res.sessionToken);
      router.replace(`/join?t=${encodeURIComponent(res.sessionToken)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '受付に失敗しました');
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>チェックイン</h1>
      <div className="card">
        <p>
          お持ちの<strong>受付コード</strong>を入力してください。
          お手元にない場合は、会場の受付でお声がけください。
        </p>
        <label htmlFor="claim">受付コード</label>
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
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text)', marginTop: 16 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ width: 24, height: 24, minHeight: 24 }}
          />
          利用規約とプライバシーポリシーに同意します
        </label>
        <p className="muted">
          連絡先はお預かりしません。プロフィールと投票データはイベント終了30分後に消去されます。
        </p>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <button
        type="button"
        className="primary"
        disabled={busy || claimCode.length < 6 || !agreed}
        onClick={submit}
      >
        {busy ? 'チェックイン中…' : 'チェックインする'}
      </button>
    </main>
  );
}
