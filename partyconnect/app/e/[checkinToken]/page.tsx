'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, checkin } from '../../../lib/api';
import { saveSessionToken } from '../../../lib/storage';

/**
 * 掲示QR・4桁パスコードから開く受付ページ。
 * 参加者に性別を自己申告させないため、ここでは主催者が渡した6桁の引換コードを入力してもらう。
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
      <h1>受付</h1>
      <div className="card">
        <p>受付でお渡しした<strong>6桁の受付コード</strong>を入力してください。</p>
        <label htmlFor="claim">受付コード</label>
        <input
          id="claim"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
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
        disabled={busy || claimCode.length !== 6 || !agreed}
        onClick={submit}
      >
        {busy ? '受付中…' : '受付する'}
      </button>
    </main>
  );
}
