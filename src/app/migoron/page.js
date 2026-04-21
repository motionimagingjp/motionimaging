'use client';

import { useState, useEffect } from 'react';

const monthFlowers = {
  1: ['水仙', '椿', '梅', 'おまかせ'],
  2: ['梅', '椿', '菜の花', 'おまかせ'],
  3: ['桜', '菜の花', 'チューリップ', 'おまかせ'],
  4: ['桜', 'チューリップ', '藤', 'おまかせ'],
  5: ['藤', 'バラ', 'カーネーション', 'おまかせ'],
  6: ['紫陽花', 'バラ', '花菖蒲', 'おまかせ'],
  7: ['向日葵', '朝顔', '蓮', 'おまかせ'],
  8: ['向日葵', '朝顔', '百日紅', 'おまかせ'],
  9: ['彼岸花', 'コスモス', '向日葵', 'おまかせ'],
  10: ['コスモス', '金木犀', '菊', 'おまかせ'],
  11: ['菊', '山茶花', '紅葉', 'おまかせ'],
  12: ['ポインセチア', 'シクラメン', '山茶花', 'おまかせ'],
};

const regions = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州', '沖縄', 'おまかせ'];

const flowerIcons = {
  '桜': '<circle cx="8" cy="8" r="2.5" fill="#ED93B1"/><circle cx="14" cy="6" r="2" fill="#F4C0D1"/><circle cx="16" cy="12" r="2.5" fill="#ED93B1"/><circle cx="10" cy="14" r="2" fill="#F4C0D1"/><circle cx="12" cy="10" r="1.5" fill="#D4537E"/>',
  'チューリップ': '<path d="M8 14 Q8 8 12 6 Q16 8 16 14 Z" fill="#D4537E"/><path d="M12 14 L12 20" stroke="#3B6D11" stroke-width="1.5"/><path d="M10 17 Q7 16 7 14" stroke="#3B6D11" stroke-width="1.5" fill="none"/>',
  '藤': '<circle cx="9" cy="7" r="1.5" fill="#AFA9EC"/><circle cx="13" cy="9" r="1.5" fill="#AFA9EC"/><circle cx="11" cy="11" r="1.5" fill="#7F77DD"/><circle cx="14" cy="13" r="1.5" fill="#AFA9EC"/><circle cx="10" cy="15" r="1.5" fill="#7F77DD"/>',
  '梅': '<circle cx="12" cy="12" r="5" fill="#F4C0D1"/><circle cx="12" cy="12" r="1.5" fill="#D4537E"/>',
  '水仙': '<circle cx="12" cy="12" r="4" fill="#FAC775"/><circle cx="12" cy="12" r="2" fill="#EF9F27"/>',
  '椿': '<circle cx="12" cy="12" r="5" fill="#E24B4A"/><circle cx="12" cy="12" r="1.5" fill="#FAC775"/>',
  '菜の花': '<circle cx="9" cy="9" r="2" fill="#FAC775"/><circle cx="14" cy="10" r="2" fill="#FAC775"/><circle cx="11" cy="14" r="2" fill="#EF9F27"/>',
  'バラ': '<circle cx="12" cy="12" r="5" fill="#D4537E"/><circle cx="12" cy="12" r="3" fill="#993556"/><circle cx="12" cy="12" r="1" fill="#D4537E"/>',
  'カーネーション': '<path d="M12 7 L14 10 L17 11 L14 13 L15 16 L12 14 L9 16 L10 13 L7 11 L10 10 Z" fill="#D4537E"/>',
  '紫陽花': '<circle cx="9" cy="9" r="2" fill="#85B7EB"/><circle cx="13" cy="8" r="2" fill="#AFA9EC"/><circle cx="15" cy="12" r="2" fill="#85B7EB"/><circle cx="11" cy="14" r="2" fill="#AFA9EC"/>',
  '花菖蒲': '<path d="M12 6 L10 10 L8 14 L12 12 L16 14 L14 10 Z" fill="#7F77DD"/><circle cx="12" cy="11" r="1" fill="#FAC775"/>',
  '向日葵': '<g transform="translate(12 12)"><path d="M0 -6 L1.5 -2 L-1.5 -2 Z M4 -4 L3 0 L0 -1 Z M6 0 L2 1 L3 -2 Z M4 4 L0 3 L1 -1 Z M0 6 L-1 2 L1 2 Z M-4 4 L-1 1 L-2 4 Z M-6 0 L-2 -1 L-3 2 Z M-4 -4 L0 -1 L-2 -3 Z" fill="#EF9F27"/><circle r="2" fill="#633806"/></g>',
  '朝顔': '<circle cx="12" cy="12" r="5" fill="#AFA9EC"/><circle cx="12" cy="12" r="2" fill="#FFFFFF"/>',
  '蓮': '<path d="M12 7 Q9 9 8 13 Q12 11 16 13 Q15 9 12 7 Z" fill="#F4C0D1"/><circle cx="12" cy="11" r="1" fill="#FAC775"/>',
  '百日紅': '<circle cx="10" cy="10" r="1.5" fill="#D4537E"/><circle cx="13" cy="9" r="1.5" fill="#ED93B1"/><circle cx="14" cy="13" r="1.5" fill="#D4537E"/><circle cx="10" cy="14" r="1.5" fill="#ED93B1"/>',
  '彼岸花': '<g stroke="#E24B4A" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M12 12 L8 7"/><path d="M12 12 L16 7"/><path d="M12 12 L7 11"/><path d="M12 12 L17 11"/><path d="M12 12 L9 16"/><path d="M12 12 L15 16"/></g>',
  'コスモス': '<g transform="translate(12 12)"><ellipse cx="0" cy="-4" rx="1.5" ry="3" fill="#ED93B1"/><ellipse cx="4" cy="0" rx="3" ry="1.5" fill="#ED93B1"/><ellipse cx="0" cy="4" rx="1.5" ry="3" fill="#ED93B1"/><ellipse cx="-4" cy="0" rx="3" ry="1.5" fill="#ED93B1"/><circle r="1.5" fill="#FAC775"/></g>',
  '金木犀': '<circle cx="9" cy="9" r="1.5" fill="#EF9F27"/><circle cx="13" cy="9" r="1.5" fill="#FAC775"/><circle cx="11" cy="12" r="1.5" fill="#EF9F27"/><circle cx="14" cy="14" r="1.5" fill="#FAC775"/><circle cx="10" cy="15" r="1.5" fill="#EF9F27"/>',
  '菊': '<g transform="translate(12 12)"><g fill="#FAC775"><ellipse cx="0" cy="-4" rx="1.5" ry="3"/><ellipse cx="4" cy="0" rx="3" ry="1.5"/><ellipse cx="0" cy="4" rx="1.5" ry="3"/><ellipse cx="-4" cy="0" rx="3" ry="1.5"/></g><circle r="1.5" fill="#EF9F27"/></g>',
  '山茶花': '<circle cx="12" cy="12" r="5" fill="#ED93B1"/><circle cx="12" cy="12" r="1.5" fill="#FAC775"/>',
  '紅葉': '<path d="M12 4 L13 8 L16 7 L14 10 L18 11 L14 13 L15 17 L12 14 L9 17 L10 13 L6 11 L10 10 L8 7 L11 8 Z" fill="#D85A30"/>',
  'ポインセチア': '<path d="M12 7 L14 11 L18 11 L15 13 L16 17 L12 15 L8 17 L9 13 L6 11 L10 11 Z" fill="#A32D2D"/><circle cx="12" cy="12" r="1" fill="#FAC775"/>',
  'シクラメン': '<path d="M10 8 Q9 12 12 13 Q15 12 14 8 Q13 10 12 10 Q11 10 10 8 Z" fill="#D4537E"/>',
  'おまかせ': '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><text x="12" y="15" text-anchor="middle" font-size="9" fill="currentColor">?</text>',
};

const heroScenes = {
  spring: `<defs><linearGradient id="sky-spring" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFF4F7"/><stop offset="100%" stop-color="#FBEAF0"/></linearGradient></defs><rect width="380" height="140" fill="url(#sky-spring)"/><ellipse cx="60" cy="110" rx="90" ry="30" fill="#F4C0D1" opacity="0.5"/><ellipse cx="320" cy="115" rx="80" ry="25" fill="#ED93B1" opacity="0.5"/><g transform="translate(80 60)"><rect x="-3" y="20" width="6" height="40" fill="#5F5E5A"/><ellipse cx="0" cy="15" rx="35" ry="28" fill="#F4C0D1"/><ellipse cx="-10" cy="8" rx="22" ry="18" fill="#ED93B1" opacity="0.7"/><ellipse cx="12" cy="20" rx="20" ry="16" fill="#ED93B1" opacity="0.7"/></g><g transform="translate(300 50)"><rect x="-3" y="30" width="6" height="40" fill="#5F5E5A"/><ellipse cx="0" cy="20" rx="40" ry="30" fill="#F4C0D1"/><ellipse cx="-15" cy="12" rx="22" ry="18" fill="#ED93B1" opacity="0.7"/><ellipse cx="14" cy="25" rx="22" ry="16" fill="#ED93B1" opacity="0.7"/></g><g fill="#D4537E" opacity="0.7"><circle cx="140" cy="40" r="3"/><circle cx="180" cy="55" r="2"/><circle cx="210" cy="30" r="2.5"/><circle cx="160" cy="70" r="2"/><circle cx="230" cy="60" r="3"/><circle cx="190" cy="85" r="2"/><circle cx="250" cy="45" r="2.5"/><circle cx="130" cy="65" r="2"/></g><g transform="translate(190 85)"><circle cx="0" cy="-8" r="4" fill="#FAC775"/><path d="M-4 -4 L-4 6 L-2 14 L-5 20 M4 -4 L4 6 L6 14 L3 20" stroke="#D4537E" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M-4 -2 L-8 4 M4 -2 L8 4" stroke="#FAC775" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>`,
  summer: `<defs><linearGradient id="sky-summer" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#85B7EB"/><stop offset="100%" stop-color="#E6F1FB"/></linearGradient></defs><rect width="380" height="140" fill="url(#sky-summer)"/><circle cx="320" cy="30" r="22" fill="#FAC775"/><circle cx="320" cy="30" r="16" fill="#EF9F27"/><ellipse cx="80" cy="35" rx="25" ry="10" fill="#FFFFFF" opacity="0.8"/><ellipse cx="200" cy="25" rx="30" ry="8" fill="#FFFFFF" opacity="0.7"/><rect y="100" width="380" height="40" fill="#639922" opacity="0.3"/><g transform="translate(90 90)"><path d="M0 30 L0 0" stroke="#3B6D11" stroke-width="3"/><circle cx="0" cy="-5" r="14" fill="#EF9F27"/><circle cx="0" cy="-5" r="7" fill="#633806"/><path d="M-8 15 Q-14 10 -12 5" stroke="#3B6D11" stroke-width="2" fill="none"/></g><g transform="translate(180 95)"><path d="M0 30 L0 0" stroke="#3B6D11" stroke-width="3"/><circle cx="0" cy="-5" r="16" fill="#EF9F27"/><circle cx="0" cy="-5" r="8" fill="#633806"/><path d="M8 18 Q14 12 12 5" stroke="#3B6D11" stroke-width="2" fill="none"/></g><g transform="translate(270 92)"><path d="M0 30 L0 0" stroke="#3B6D11" stroke-width="3"/><circle cx="0" cy="-5" r="13" fill="#EF9F27"/><circle cx="0" cy="-5" r="6" fill="#633806"/></g>`,
  autumn: `<defs><linearGradient id="sky-autumn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FAEEDA"/><stop offset="100%" stop-color="#FAECE7"/></linearGradient></defs><rect width="380" height="140" fill="url(#sky-autumn)"/><path d="M0 130 Q80 100 150 110 T380 115 L380 140 L0 140 Z" fill="#D85A30" opacity="0.3"/><g transform="translate(80 55)"><rect x="-3" y="25" width="6" height="40" fill="#5F5E5A"/><circle cx="0" cy="15" r="28" fill="#D85A30"/><circle cx="-12" cy="10" r="18" fill="#EF9F27" opacity="0.8"/><circle cx="12" cy="18" r="18" fill="#A32D2D" opacity="0.7"/></g><g transform="translate(300 45)"><rect x="-3" y="35" width="6" height="40" fill="#5F5E5A"/><circle cx="0" cy="20" r="32" fill="#EF9F27"/><circle cx="-12" cy="12" r="20" fill="#D85A30" opacity="0.8"/><circle cx="14" cy="25" r="18" fill="#FAC775" opacity="0.8"/></g><g transform="translate(190 85)"><circle cx="0" cy="-10" r="4" fill="#FAC775"/><path d="M-4 -6 L-4 6 L-2 14 L-5 22 M4 -6 L4 6 L6 14 L3 22" stroke="#993C1D" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g fill="#D85A30" opacity="0.85"><path d="M150 40 L152 44 L156 44 L153 47 L154 51 L150 49 L146 51 L147 47 L144 44 L148 44 Z"/><path d="M220 55 L221 58 L224 58 L222 60 L223 63 L220 61 L217 63 L218 60 L216 58 L219 58 Z" fill="#EF9F27"/><path d="M170 70 L171 73 L174 73 L172 75 L173 78 L170 76 L167 78 L168 75 L166 73 L169 73 Z"/><path d="M240 35 L241 38 L244 38 L242 40 L243 43 L240 41 L237 43 L238 40 L236 38 L239 38 Z" fill="#FAC775"/></g>`,
  winter: `<defs><linearGradient id="sky-winter" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#FFF9E8"/></linearGradient></defs><rect width="380" height="140" fill="url(#sky-winter)"/><ellipse cx="190" cy="135" rx="220" ry="30" fill="#F1EFE8"/><circle cx="320" cy="35" r="20" fill="#FAC775" opacity="0.9"/><g transform="translate(80 65)"><rect x="-3" y="30" width="6" height="35" fill="#5F5E5A"/><ellipse cx="0" cy="20" rx="30" ry="25" fill="#FFFFFF" stroke="#D3D1C7" stroke-width="1"/><ellipse cx="-10" cy="14" rx="18" ry="14" fill="#F1EFE8"/><ellipse cx="10" cy="22" rx="16" ry="12" fill="#F1EFE8"/></g><g transform="translate(300 55)"><rect x="-3" y="40" width="6" height="40" fill="#5F5E5A"/><ellipse cx="0" cy="25" rx="35" ry="28" fill="#FFFFFF" stroke="#D3D1C7" stroke-width="1"/><ellipse cx="-12" cy="18" rx="18" ry="14" fill="#F1EFE8"/></g><g fill="#FFFFFF" stroke="#B4B2A9" stroke-width="0.5"><circle cx="150" cy="40" r="2.5"/><circle cx="180" cy="55" r="2"/><circle cx="210" cy="30" r="2.5"/><circle cx="160" cy="75" r="2"/><circle cx="230" cy="60" r="2.5"/><circle cx="190" cy="85" r="2"/><circle cx="140" cy="60" r="2"/></g><g transform="translate(190 85)"><circle cx="0" cy="-10" r="4" fill="#FAC775"/><path d="M-4 -6 L-4 6 L-2 14 L-5 22 M4 -6 L4 6 L6 14 L3 22" stroke="#BA7517" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M-10 -12 L-6 -14 M10 -12 L6 -14" stroke="#BA7517" stroke-width="2" fill="none" stroke-linecap="round"/></g>`,
};

const themes = {
  spring: { label: '春', bg: 'linear-gradient(135deg, #FDE7EE 0%, #FBEAF0 60%, #FFF4F7 100%)', heroBg: '#FDE7EE', accent: '#D4537E', accentSoft: 'rgba(212, 83, 126, 0.2)', flowerOn: '#FBEAF0', flowerOnInk: '#72243E', ink: '#4B1528', inkSoft: '#993556' },
  summer: { label: '夏', bg: 'linear-gradient(135deg, #E6F1FB 0%, #FAEEDA 60%, #FFF9E8 100%)', heroBg: '#E6F1FB', accent: '#185FA5', accentSoft: 'rgba(24, 95, 165, 0.2)', flowerOn: '#FAC775', flowerOnInk: '#633806', ink: '#042C53', inkSoft: '#185FA5' },
  autumn: { label: '秋', bg: 'linear-gradient(135deg, #FAECE7 0%, #FAEEDA 60%, #FCEBEB 100%)', heroBg: '#FAEEDA', accent: '#993C1D', accentSoft: 'rgba(153, 60, 29, 0.2)', flowerOn: '#F5C4B3', flowerOnInk: '#4A1B0C', ink: '#4A1B0C', inkSoft: '#993C1D' },
  winter: { label: '冬', bg: 'linear-gradient(135deg, #FFFFFF 0%, #FAEEDA 60%, #FFF9E8 100%)', heroBg: '#FFFFFF', accent: '#BA7517', accentSoft: 'rgba(186, 117, 23, 0.2)', flowerOn: '#FAC775', flowerOnInk: '#633806', ink: '#412402', inkSoft: '#854F0B' },
};

const seasonKey = (m) => {
  if (m === 12 || m === 1 || m === 2) return 'winter';
  if (m === 3 || m === 4) return 'spring';
  if (m >= 5 && m <= 9) return 'summer';
  return 'autumn';
};

export default function MigoronNavi() {
  const [when, setWhen] = useState('weekend');
  const [region, setRegion] = useState('おまかせ');
  const [flower, setFlower] = useState('おまかせ');
  const [freetext, setFreetext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [now] = useState(new Date());

  const getTargetDate = (w) => {
    const d = new Date(now);
    if (w === 'today') return d;
    if (w === 'tomorrow') { d.setDate(d.getDate() + 1); return d; }
    if (w === 'weekend') {
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? 6 : 6 - day));
      return d;
    }
    if (w === 'nextweekend') {
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? 6 : 6 - day) + 7);
      return d;
    }
    return d;
  };

  const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;

  const targetDate = getTargetDate(when);
  const targetMonth = targetDate.getMonth() + 1;
  const flowers = monthFlowers[targetMonth];
  const theme = themes[seasonKey(targetMonth)];

  useEffect(() => {
    if (!flowers.includes(flower)) setFlower('おまかせ');
  }, [flowers, flower]);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    const whenLabel = { weekend: '今週末', nextweekend: '来週末', today: '今日', tomorrow: '明日' }[when];
    const regionLabel = region === 'おまかせ' ? '全国から一番のおすすめ' : `${region}地方`;
    const flowerLabel = flower === 'おまかせ' ? `${targetMonth}月の旬の花` : flower;

    try {
      const res = await fetch('/api/migoron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whenLabel,
          dateLabel: formatDate(targetDate),
          regionLabel,
          flowerLabel,
          freetext: freetext.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '検索に失敗しました');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const cssVars = {
    '--mn-bg': theme.bg,
    '--mn-hero-bg': theme.heroBg,
    '--mn-accent': theme.accent,
    '--mn-accent-soft': theme.accentSoft,
    '--mn-flower-on': theme.flowerOn,
    '--mn-flower-on-ink': theme.flowerOnInk,
    '--mn-ink': theme.ink,
    '--mn-ink-soft': theme.inkSoft,
  };

  return (
    <div style={{ minHeight: '100vh', padding: '16px', fontFamily: 'system-ui, -apple-system, sans-serif', background: theme.bg }}>
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>
      <div style={{ maxWidth: '420px', margin: '0 auto', ...cssVars }}>

        <div style={{ background: 'var(--mn-bg)', borderRadius: '12px', padding: '16px', position: 'relative', overflow: 'hidden' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', padding: '0 4px' }}>
            <div style={{ fontSize: '22px', fontWeight: 500, color: 'var(--mn-ink)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--mn-accent)' }}></span>
              パステル花予報 ミゴロンナビ
            </div>
            <div style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '999px', background: 'rgba(255,255,255,0.85)', color: 'var(--mn-ink)' }}>
              {theme.label} · {targetMonth}月
            </div>
          </div>

          <div style={{ position: 'relative', height: '140px', borderRadius: '12px', overflow: 'hidden', marginBottom: '14px', background: 'var(--mn-hero-bg)' }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 380 140" preserveAspectRatio="xMidYMid slice" dangerouslySetInnerHTML={{ __html: heroScenes[seasonKey(targetMonth)] }} />
            <div style={{ position: 'absolute', bottom: '10px', left: '14px', fontSize: '12px', color: 'var(--mn-ink)', background: 'rgba(255,255,255,0.75)', padding: '3px 10px', borderRadius: '999px', zIndex: 2 }}>
              今日 {now.getMonth() + 1}/{now.getDate()} ({'日月火水木金土'[now.getDay()]})
            </div>
          </div>

          <Section num="1" label="いつ行く?" accent={theme.accent}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[['weekend', '今週末'], ['nextweekend', '来週末'], ['today', '今日'], ['tomorrow', '明日']].map(([k, l]) => (
                <Pill key={k} active={when === k} onClick={() => setWhen(k)} theme={theme}>{l}</Pill>
              ))}
            </div>
          </Section>

          <Section num="2" label="どこへ?" accent={theme.accent}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
              {regions.map((r) => (
                <Pill key={r} active={region === r} onClick={() => setRegion(r)} theme={theme} small>{r}</Pill>
              ))}
            </div>
          </Section>

          <Section num="3" label={`旬の花 · ${formatDate(targetDate)}`} accent={theme.accent}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
              {flowers.map((f) => (
                <FlowerButton key={f} name={f} active={flower === f} onClick={() => setFlower(f)} theme={theme} />
              ))}
            </div>
          </Section>

          <Section num="4" label="追加で見たい場所(任意)" accent={theme.accent}>
            <input
              type="text"
              value={freetext}
              onChange={(e) => setFreetext(e.target.value)}
              placeholder="例: 弘前、宮古島、吉野山"
              style={{ width: '100%', padding: '12px 14px', fontSize: '14px', borderRadius: '8px', border: '0.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.8)', color: 'var(--mn-ink)', minHeight: '44px' }}
            />
            <div style={{ fontSize: '10px', color: 'var(--mn-ink-soft)', marginTop: '6px' }}>
              地名・公園名などを入力するとその場所も検索対象に追加されます
            </div>
          </Section>

          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              width: '100%', padding: '14px', fontSize: '15px', fontWeight: 500,
              background: loading ? '#888' : theme.accent,
              color: '#fff', border: 'none', borderRadius: '999px', cursor: loading ? 'wait' : 'pointer',
              minHeight: '52px', marginTop: '8px'
            }}
          >
            {loading ? '検索中...' : 'ミゴロン指数でスポットを探す ↗'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '14px', fontSize: '11px', color: 'var(--mn-ink-soft)', flexWrap: 'wrap' }}>
            <span>花</span><span>+</span><span>天気</span><span>+</span><span>気温</span><span>=</span>
            <span style={{ color: 'var(--mn-accent)', fontWeight: 500 }}>ミゴロン指数</span>
          </div>

        </div>

        {error && (
          <div style={{ marginTop: '16px', padding: '14px', background: '#FCEBEB', color: '#791F1F', borderRadius: '12px', fontSize: '13px' }}>
            エラー: {error}
          </div>
        )}

        {result && <ResultCards result={result} theme={theme} />}

      </div>
    </div>
  );
}

function Section({ num, label, accent, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '12px', color: 'var(--mn-ink-soft)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
        <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: accent, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 500 }}>{num}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function Pill({ active, onClick, theme, small, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: small ? '10px 6px' : '10px 14px',
        fontSize: small ? '13px' : '14px',
        borderRadius: '999px',
        border: '0.5px solid rgba(0,0,0,0.08)',
        background: active ? theme.accent : 'rgba(255,255,255,0.8)',
        color: active ? '#fff' : theme.ink,
        borderColor: active ? theme.accent : 'rgba(0,0,0,0.08)',
        cursor: 'pointer',
        minHeight: '40px',
      }}
    >
      {children}
    </button>
  );
}

function FlowerButton({ name, active, onClick, theme }) {
  const icon = flowerIcons[name] || flowerIcons['おまかせ'];
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 8px',
        fontSize: '14px',
        borderRadius: '8px',
        border: '0.5px solid',
        borderColor: active ? theme.flowerOn : 'rgba(0,0,0,0.08)',
        background: active ? theme.flowerOn : 'rgba(255,255,255,0.8)',
        color: active ? theme.flowerOnInk : theme.ink,
        cursor: 'pointer',
        textAlign: 'center',
        minHeight: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: icon }} />
      <span>{name}</span>
    </button>
  );
}

function ResultCards({ result, theme }) {
  if (!result.spots || result.spots.length === 0) {
    return (
      <div style={{ marginTop: '16px', padding: '14px', background: '#fff', borderRadius: '12px', fontSize: '13px' }}>
        該当スポットが見つかりませんでした。
      </div>
    );
  }
  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '11px', color: theme.inkSoft, marginBottom: '8px', padding: '0 4px' }}>
        最新取得: {result.timestamp} · {result.sourceNote || ''}
      </div>
      {result.spots.map((spot, i) => <SpotCard key={i} spot={spot} />)}
    </div>
  );
}

function SpotCard({ spot }) {
  const score = spot.migoron_score || 0;
  const scoreColor = score >= 80 ? '#0F6E56' : score >= 65 ? '#BA7517' : '#A32D2D';
  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.08)', padding: '14px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: 500, lineHeight: 1.4 }}>{spot.name}</div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{spot.location}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '26px', fontWeight: 500, lineHeight: 1, color: scoreColor }}>{score}</div>
          <div style={{ fontSize: '10px', color: '#666' }}>ミゴロン</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', margin: '10px 0' }}>
        <div style={{ background: '#F5F5F3', padding: '10px', borderRadius: '8px' }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>花</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontSize: '18px', fontWeight: 500, color: '#993556' }}>{spot.flower_score || 0}</span>
            <span style={{ fontSize: '10px', color: '#666' }}>/ 100</span>
          </div>
        </div>
        <div style={{ background: '#F5F5F3', padding: '10px', borderRadius: '8px' }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>天気</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#666' }}>{spot.saturday?.label || '土'}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginTop: '2px' }}>{spot.saturday?.weather || '-'}</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{spot.saturday?.temp || ''}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#666' }}>{spot.sunday?.label || '日'}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, marginTop: '2px' }}>{spot.sunday?.weather || '-'}</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{spot.sunday?.temp || ''}</div>
            </div>
          </div>
        </div>
      </div>
      {spot.info && <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', lineHeight: 1.5 }}>{spot.info}</div>}
      {spot.warning && (
        <div style={{ background: '#FAEEDA', color: '#854F0B', borderRadius: '8px', padding: '8px 10px', fontSize: '11px', lineHeight: 1.5, margin: '8px 0' }}>
          ⚠ {spot.warning}
        </div>
      )}
      {spot.tags && spot.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '10px', flexWrap: 'wrap' }}>
          {spot.tags.map((tag, i) => (
            <span key={i} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '999px', background: '#EEEDFE', color: '#3C3489' }}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
