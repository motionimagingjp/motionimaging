export const metadata = {
  metadataBase: new URL('https://motionimaging.vercel.app'),
  title: 'Motion Imaging',
  description: 'Image creator supporting site',
  openGraph: {
    title: 'Motion Imaging',
    description: 'Image creator supporting site',
    url: '/',
    images: [{ url: '/motionimaging-og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motion Imaging',
    description: 'Image creator supporting site',
    images: ['/motionimaging-og.png'],
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
