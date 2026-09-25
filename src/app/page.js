export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: '#f9f9f7', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '48px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 500, margin: 0 }}>Motion Imaging</h1>
          <a href="/about" aria-label="ABOUT" title="ABOUT" style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3B6D11', fontFamily: 'Georgia, serif', fontWeight: 'bold', fontSize: '13px', textDecoration: 'none', flexShrink: 0 }}>i</a>
        </div>
        <p style={{ color: '#666', marginBottom: '40px' }}>Image creator supporting site</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <a href="/migoron" style={{ display: 'block', padding: '20px', background: '#fff', borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.08)', textDecoration: 'none', color: '#333' }}>
            <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '4px' }}>🌸 ミゴロンナビ</div>
            <div style={{ fontSize: '13px', color: '#888' }}>お花見・花スポット検索 / ミゴロン指数でおすすめ提案</div>
          </a>
          <a href="https://scad-partyconnect.vercel.app/" style={{ display: 'block', padding: '20px', background: '#fff', borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.08)', textDecoration: 'none', color: '#333' }}>
            <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '4px' }}>🎉 SCADコネクト</div>
            <div style={{ fontSize: '13px', color: '#888' }}>街コン運営サポートシステム</div>
          </a>
        </div>
      </div>
    </main>
  )
}
