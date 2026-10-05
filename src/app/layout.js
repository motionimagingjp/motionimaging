export const metadata = {
  metadataBase: new URL('https://motionimaging.vercel.app'),
  title: 'Motion Imaging',
  description: 'Image creator supporting site',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
