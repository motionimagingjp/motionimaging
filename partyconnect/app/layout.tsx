import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PartyConnect',
  description: '街コンの受付からマッチングまでを進める進行システム',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0f1020',
  width: 'device-width',
  initialScale: 1,
  // 暗所で誤操作しやすいのでズーム自体は許可する（アクセシビリティ）
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
