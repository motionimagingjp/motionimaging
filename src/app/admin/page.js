import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAdminAuthorized } from '../../lib/admin-auth';
import { readAllJobStatus } from '../../lib/job-status';
import { checkAllTokens } from '../../lib/token-check';
import { getPartyconnectStats } from '../../lib/partyconnect-stats';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '管理画面',
  robots: { index: false, follow: false },
};

// 1日1回のcronなので、最終実行から26時間を超えたら「動いていない」とみなす
const STALE_MS = 26 * 3600000;

const TONE = {
  green:  { color: '#2f5a0d', bg: '#eaf3e1' },
  yellow: { color: '#7a4f00', bg: '#fff2d6' },
  red:    { color: '#a3261b', bg: '#fde8e6' },
  gray:   { color: '#5f6368', bg: '#efefec' },
};

const PLAN_LABEL = { free: '無料', spot: 'スポット', light: 'ライト', pro: 'プロ' };
const MODE_LABEL = { matching: 'マッチング', checkin_only: '受付のみ' };

function jobState(status, now) {
  if (!status) return { tone: 'gray', text: '記録なし' };
  if (!status.ok) return { tone: 'red', text: '失敗' };
  if (now - Date.parse(status.at) > STALE_MS) return { tone: 'red', text: '止まっている可能性' };
  if (status.warnings && status.warnings.length > 0) return { tone: 'yellow', text: '一部注意' };
  return { tone: 'green', text: '正常' };
}

function tokenState(t) {
  if (t.valid === true) return { tone: 'green', text: '有効' };
  if (t.valid === null) return { tone: 'gray', text: '確認不可' };
  if (t.message === '未設定') return { tone: 'gray', text: '未設定' };
  return { tone: 'red', text: '無効' };
}

function fmt(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ago(iso, now) {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(min, 0)}分前`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}

function fmtDate(d) {
  if (!d) return '日付未定';
  const [y, m, day] = d.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${m}/${day}(${w})`;
}

function Badge({ tone, children }) {
  const t = TONE[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: '999px',
      fontSize: '12px', fontWeight: 'bold', color: t.color, background: t.bg, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginTop: '28px' }}>
      <h2 style={{ fontSize: '15px', margin: '0 0 10px', color: '#1a1a1a' }}>{title}</h2>
      {children}
    </section>
  );
}

const card = {
  background: '#ffffff', border: '1px solid #e5e5e2', borderRadius: '12px', padding: '12px 14px',
};

const sub = { fontSize: '12px', color: '#6b7280', lineHeight: 1.6 };

function Tile({ label, value }) {
  return (
    <div style={{ ...card, padding: '12px' }}>
      <div style={sub}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

export default async function AdminPage() {
  const h = await headers();
  if (!isAdminAuthorized(h.get('authorization'))) notFound();

  const [jobs, tokens, party] = await Promise.all([
    readAllJobStatus().catch((e) => ({ error: e.message })),
    checkAllTokens(),
    getPartyconnectStats().catch((e) => ({ configured: true, error: e.message })),
  ]);
  const now = Date.now();

  const jobRows = Array.isArray(jobs) ? jobs.map((j) => ({ ...j, state: jobState(j.status, now) })) : [];
  const tokenRows = tokens.map((t) => ({ ...t, state: tokenState(t) }));
  const problems =
    jobRows.filter((j) => j.state.tone === 'red').length +
    tokenRows.filter((t) => t.state.tone === 'red').length +
    (Array.isArray(jobs) ? 0 : 1) +
    (party.error ? 1 : 0);

  return (
    <div style={{
      minHeight: '100vh', background: '#f9f9f7', color: '#1a1a1a',
      fontFamily: "'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif",
    }}>
      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <h1 style={{ fontSize: '18px', margin: 0 }}>管理画面</h1>
          <a href="/admin" style={{ fontSize: '13px', color: '#3B6D11' }}>更新</a>
        </div>
        <div style={{ ...sub, marginTop: '4px' }}>{fmt(new Date(now).toISOString())} 時点</div>

        <div style={{
          ...card, marginTop: '16px',
          background: problems > 0 ? TONE.red.bg : TONE.green.bg,
          borderColor: 'transparent',
          color: problems > 0 ? TONE.red.color : TONE.green.color,
          fontWeight: 'bold', fontSize: '14px',
        }}>
          {problems > 0 ? `要対応が ${problems} 件あります` : '要対応の項目はありません'}
        </div>

        <Section title="自動投稿の稼働状況">
          {!Array.isArray(jobs) ? (
            <div style={card}>読み込みに失敗しました: {jobs.error}</div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {jobRows.map((j) => (
                <div key={j.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', minWidth: 0 }}>{j.label}</div>
                    <Badge tone={j.state.tone}>{j.state.text}</Badge>
                  </div>
                  <div style={sub}>
                    {j.schedule}
                    {j.status && ` ・ 最終実行 ${fmt(j.status.at)}（${ago(j.status.at, now)}）`}
                  </div>
                  {j.status && !j.status.ok && (
                    <div style={sub}>
                      最後の成功: {j.status.lastSuccessAt ? `${fmt(j.status.lastSuccessAt)}（${ago(j.status.lastSuccessAt, now)}）` : '記録なし'}
                    </div>
                  )}
                  {j.status?.note && <div style={sub}>{j.status.note}</div>}
                  {j.status?.errors?.map((e, i) => (
                    <div key={`e${i}`} style={{ ...sub, color: TONE.red.color, wordBreak: 'break-word' }}>{e}</div>
                  ))}
                  {j.status?.warnings?.map((w, i) => (
                    <div key={`w${i}`} style={{ ...sub, color: TONE.yellow.color, wordBreak: 'break-word' }}>{w}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ ...sub, marginTop: '8px' }}>
            「記録なし」は、この画面を追加してからまだ一度も実行されていない投稿です。次回の実行後に表示されます。
          </div>
        </Section>

        <Section title="SNSトークン">
          <div style={{ ...card, padding: '4px 14px' }}>
            {tokenRows.map((t, i) => (
              <div key={t.env} style={{
                padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid #efefec',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                  <div style={{ fontSize: '14px' }}>{t.label}</div>
                  <Badge tone={t.state.tone}>{t.state.text}</Badge>
                </div>
                <div style={{ ...sub, wordBreak: 'break-word' }}>{t.message}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="パーティコネクト">
          {!party.configured ? (
            <div style={card}>
              <div style={{ fontSize: '14px' }}>未接続です</div>
              <div style={sub}>Vercelの環境変数 PARTYCONNECT_SUPABASE_SECRET_KEY を設定すると表示されます。</div>
            </div>
          ) : party.error ? (
            <div style={card}>読み込みに失敗しました: {party.error}</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                <Tile label="主催者" value={`${party.totals.organizers}人`} />
                <Tile label="開催予定" value={`${party.totals.upcoming}件`} />
                <Tile label="開催済み" value={`${party.totals.finished}件`} />
                <Tile label="延べ参加者" value={`${party.totals.participants}人`} />
                <Tile label="成立ペア" value={`${party.totals.matchedPairs}組`} />
                <Tile label="イベント合計" value={`${party.totals.events}件`} />
              </div>
              <div style={{ ...sub, marginTop: '8px' }}>
                デモイベント{party.totals.demoEvents}件は除いています。
                {party.totals.stale > 0 && ` 日付が過ぎたまま終了していないイベントが${party.totals.stale}件あります。`}
              </div>

              <h3 style={{ fontSize: '14px', margin: '18px 0 8px' }}>開催予定のイベント</h3>
              {party.upcomingEvents.length === 0 ? (
                <div style={{ ...card, ...sub }}>予定はありません</div>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {party.upcomingEvents.map((e) => (
                    <div key={e.id} style={card}>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', wordBreak: 'break-word' }}>{e.event_name}</div>
                      <div style={sub}>
                        {fmtDate(e.event_date)}{e.event_time ? ` ${e.event_time}` : ''} ・ {MODE_LABEL[e.event_mode] || e.event_mode}
                        ・ 参加登録 {e.participantCount}人
                      </div>
                      <div style={sub}>主催：{e.organizerName}</div>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ fontSize: '14px', margin: '18px 0 8px' }}>主催者</h3>
              <div style={{ ...card, padding: '4px 14px' }}>
                {party.organizers.map((o, i) => (
                  <div key={o.id} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid #efefec' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                      <div style={{ fontSize: '14px', minWidth: 0, wordBreak: 'break-word' }}>{o.company_name || '（会社名未設定）'}</div>
                      <Badge tone="gray">{PLAN_LABEL[o.plan_type] || o.plan_type}</Badge>
                    </div>
                    <div style={{ ...sub, wordBreak: 'break-all' }}>{o.email}</div>
                    <div style={sub}>
                      登録 {fmt(o.created_at)} ・ イベント{o.eventCount}件（予定{o.upcomingCount}件）
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section title="準備中">
          <div style={{ ...card, ...sub }}>各アプリのアクセス数、API使用量（Gemini・X）</div>
        </Section>
      </main>
    </div>
  );
}
