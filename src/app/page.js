import { SHARED_ABOUT } from '../lib/shared-about-data';
import { SNS_ICON } from './_components/SnsIcons';

// アプリ一覧は共通データ（shared-about-data.js）から生成する。名前・説明の変更はそちらだけで済む。
// トップページ内の並びだけ、使いやすい順に固定している（共通データの順はABOUT用）。
const TOP_ORDER = ['migoron', 'sukuado', 'beauty', 'solo', 'partyconnect'];

const orderOf = (id) => {
  const i = TOP_ORDER.indexOf(id);
  return i === -1 ? TOP_ORDER.length : i;
};

export default function Home() {
  const { apps, sns } = SHARED_ABOUT;
  const sorted = [...apps].sort((a, b) => orderOf(a.id) - orderOf(b.id));

  return (
    <main style={{ minHeight: '100vh', background: '#f9f9f7', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '48px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 500, margin: 0 }}>Motion Imaging</h1>
          <a href="/about" aria-label="ABOUT" title="ABOUT" style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3B6D11', fontFamily: 'Georgia, serif', fontWeight: 'bold', fontSize: '13px', textDecoration: 'none', flexShrink: 0 }}>i</a>
        </div>
        <p style={{ color: '#666', marginBottom: '40px' }}>Image creator supporting site</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sorted.map((app) => {
            const isInternal = app.id === 'migoron';
            return (
              <a
                key={app.id}
                href={isInternal ? '/migoron' : app.prodUrl}
                target={isInternal ? undefined : '_blank'}
                rel={isInternal ? undefined : 'noopener noreferrer'}
                style={{ display: 'block', padding: '20px', background: '#fff', borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.08)', textDecoration: 'none', color: '#333' }}
              >
                <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '4px' }}>{app.emoji} {app.name}</div>
                <div style={{ fontSize: '13px', color: '#888' }}>{app.sub}</div>
              </a>
            );
          })}
          {/* 開発中のアプリ。リンクなし。公開したら共通データ（shared-about-data.js）へ移す */}
          <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '0.5px dashed rgba(0,0,0,0.15)', color: '#333', opacity: 0.6 }}>
            <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '4px' }}>🤖 SNS投稿サポート</div>
            <div style={{ fontSize: '13px', color: '#888' }}>開発中</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '40px' }}>
          {sns.map((s) => (
            <a
              key={s.label}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              style={{
                width: '42px', height: '42px', borderRadius: '50%',
                background: '#fff', border: '1px solid #ddd',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#1a1a1a', textDecoration: 'none',
              }}
            >
              {SNS_ICON[s.icon]}
            </a>
          ))}
        </div>
      </div>
    </main>
  )
}
