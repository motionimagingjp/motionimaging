'use client';
import { useEffect } from 'react';
import type { Branding } from '../lib/api';

/**
 * 主催者のブランド設定（会社名・ロゴ・イメージカラー）を画面に反映する。
 * 色は --accent を上書きするだけで、ボタンやタブなど既存のCSSがそのまま追従する。
 */
export default function BrandBar({ branding }: { branding: Branding | null }) {
  useEffect(() => {
    if (branding?.brandColor) {
      document.documentElement.style.setProperty('--accent', branding.brandColor);
    }
    return () => {
      document.documentElement.style.removeProperty('--accent');
    };
  }, [branding?.brandColor]);

  if (!branding || (!branding.logoUrl && !branding.companyName)) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {branding.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storageの動的URLのため
        <img
          src={branding.logoUrl} alt=""
          style={{ height: 32, width: 32, objectFit: 'contain', borderRadius: 6, flex: '0 0 auto' }}
        />
      )}
      {branding.companyName && (
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--muted)' }}>{branding.companyName}</span>
      )}
    </div>
  );
}
