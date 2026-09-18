import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>PartyConnect</h1>
      <p className="muted">街コンの受付からマッチングまでを進める進行システム</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>参加者の方へ</h2>
        <p>
          主催者からお送りした<strong>個別URL</strong>を開いてください。
          URLが分からない場合は、会場の受付でお声がけください。
        </p>
        <p className="muted">
          お預かりするのはニックネームとプロフィールだけです。
          <strong>連絡先はお預かりしません。</strong>
          プロフィールと投票内容はイベント終了30分後に自動的に消去されます。
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>主催者の方へ</h2>
        <p className="muted">イベントの作成・進行はコンソールから行います。</p>
        <Link className="btn" href="/organizer" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          主催者コンソールへ
        </Link>
      </div>
    </main>
  );
}
