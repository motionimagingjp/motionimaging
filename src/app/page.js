export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: '#f9f9f7', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '48px 16px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 500, marginBottom: '8px' }}>Motion Imaging</h1>
        <p style={{ color: '#666', marginBottom: '40px' }}>Image creator supporting site</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <a href="/migoron" style={{ display: 'block', padding: '20px', background: '#fff', borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.08)', textDecoration: 'none', color: '#333' }}>
            <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '4px' }}>🌸 ミゴロンナビ</div>
            <div style={{ fontSize: '13px', color: '#888' }}>お花見・花スポット検索 / ミゴロン指数でおすすめ提案</div>
          </a>
        </div>
      </div>
    </main>
  )
}
