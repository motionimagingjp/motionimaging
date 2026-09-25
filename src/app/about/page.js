const PROFILE_ICON = 'https://scad-beauty.vercel.app/profile-avatar.jpg';

const SERIES_APPS = [
  { emoji: '🌸', label: 'ミゴロンナビ', sub: '花見・花スポット検索', kind: 'internal', url: '/migoron' },
  { emoji: '💬', label: 'SCAD CHAT', sub: '恋活・婚活AIチャット', kind: 'external', url: 'https://scad-chat.vercel.app' },
  { emoji: '✂️', label: 'イロナビ', sub: 'パーソナルカラー診断', kind: 'external', url: 'https://scad-beauty.vercel.app' },
  { emoji: '🎉', label: 'SCADコネクト', sub: '街コン運営システム', kind: 'external', url: 'https://scad-partyconnect.vercel.app/' },
];

export default function About() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f9f9f7',
      fontFamily: "'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif",
      color: '#1a1a1a',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #e5e5e5',
        display: 'flex', alignItems: 'center', gap: '12px',
        position: 'sticky', top: 0, background: '#f9f9f7', zIndex: 10,
      }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
          background: 'rgba(59,109,17,0.1)', border: '1px solid rgba(59,109,17,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#3B6D11', fontSize: '15px', fontWeight: 'bold', fontFamily: 'Georgia, serif',
        }}>i</div>
        <div>
          <div style={{ fontSize: '10px', color: '#3B6D11', letterSpacing: '2px', fontWeight: 'bold' }}>ABOUT</div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#1a1a1a' }}>MOTION IMAGINGについて</div>
        </div>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 20px 40px' }}>
        <a href="/" style={{
          display: 'inline-block', fontSize: '13px', color: '#6b7280',
          textDecoration: 'none', marginBottom: '22px',
        }}>← 閉じる</a>

        <div style={{ display: 'flex', alignItems: 'center', gap: '13px', marginBottom: '26px' }}>
          <img
            src={PROFILE_ICON}
            alt=""
            style={{ width: '60px', height: '60px', borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
          />
          <div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1a1a1a' }}>はじめまして</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '3px', lineHeight: '1.7' }}>
              日々の暮らしをちょっと楽しくするWebアプリを、個人で作っています。
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12px', color: '#3B6D11', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '1px' }}>私について</div>
        <div style={{
          background: '#fff', borderLeft: '3px solid #3B6D11',
          borderRadius: '4px', padding: '14px 16px',
          fontSize: '13.5px', color: '#333', lineHeight: '2', marginBottom: '16px',
        }}>
          空いた時間で「あったら便利・楽しい」と思ったWebアプリを、企画からリリースまで一人で手がけています。MOTION IMAGINGは、そうして生まれたアプリをまとめて公開している場所です。
        </div>

        <div style={{ fontSize: '12px', color: '#3B6D11', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '1px' }}>このサイトについて</div>
        <div style={{
          background: '#fff', borderLeft: '3px solid #3B6D11',
          borderRadius: '4px', padding: '14px 16px',
          fontSize: '13.5px', color: '#333', lineHeight: '2', marginBottom: '28px',
        }}>
          MOTION IMAGINGでは「MOTION IMAGINGシリーズ」として、恋活・婚活のAIチャット「SCAD CHAT」、パーソナルカラー診断の「イロナビ」、街コン運営を支える「SCADコネクト」、そしてお花見スポットを探せる「ミゴロンナビ」など、複数のWebアプリを展開しています。
        </div>

        <div style={{ fontSize: '12px', color: '#3B6D11', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '1px' }}>MOTION IMAGINGシリーズ</div>
        <div style={{
          display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: '10px',
          padding: '2px 16px', marginBottom: '28px',
        }}>
          {SERIES_APPS.map((app, i) => {
            const isExternal = app.kind === 'external';
            return (
              <a
                key={i}
                href={app.url}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '13px 0',
                  borderBottom: i < SERIES_APPS.length - 1 ? '1px solid #eee' : 'none',
                  textDecoration: 'none', color: 'inherit', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(59,109,17,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
                }}>{app.emoji}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '7px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 'bold', color: '#1a1a1a' }}>{app.label}</span>
                  <span style={{ fontSize: '11.5px', color: '#999' }}>{app.sub}</span>
                </span>
                <span style={{ fontSize: '18px', color: '#999', flexShrink: 0 }}>›</span>
              </a>
            );
          })}
        </div>

        <a href="/" style={{
          display: 'block', width: '100%', marginTop: '22px', padding: '13px',
          background: '#fff', border: '1px solid #ddd',
          borderRadius: '10px', color: '#6b7280', fontSize: '13.5px',
          textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box',
        }}>閉じる</a>
      </div>
    </div>
  );
}
