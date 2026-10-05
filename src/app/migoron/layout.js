export const metadata = {
  title: 'パステル花予報 ミゴロンナビ',
  description: '花の見頃×天気×気温で「今、行くべき花見スポット」をミゴロン指数で提案するWebアプリ',
  openGraph: {
    title: 'パステル花予報 ミゴロンナビ',
    description: '花の見頃×天気×気温で「今、行くべき花見スポット」をミゴロン指数で提案するWebアプリ',
    url: '/migoron',
    images: [{ url: '/migoron-og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'パステル花予報 ミゴロンナビ',
    description: '花の見頃×天気×気温で「今、行くべき花見スポット」をミゴロン指数で提案するWebアプリ',
    images: ['/migoron-og.png'],
  },
}

export default function MigoronLayout({ children }) {
  return children
}
