// MOTION IMAGINGシリーズ全アプリのABOUTページ共通データ。
// 「私について」「アプリ一覧」「お問い合わせ・SNS」の3セクションを、
// 各アプリ（SCAD CHAT / イロナビ / ヨイナビ / SCADコネクト / ミゴロンナビ）が
// /api/shared-about 経由でfetchして表示する。アプリ名や紹介文を直す際はここだけ直せばよい。
//
// apps[].demoUrl が無いアプリ（partyconnect・migoron）は、会社共有デモ版では
// 「本番サイトへリンクしない」方針のため一覧から除外する（各アプリ側の実装で対応）。
export const SHARED_ABOUT = {
  me: {
    name: 'はじめまして',
    text: '空いた時間で「あったら便利・楽しい」と思ったWebアプリを、企画からリリースまで一人で手がけています。',
  },
  apps: [
    { id: 'sukuado', emoji: '💬', name: 'SCAD CHAT', sub: '恋活・婚活AIチャット', prodUrl: 'https://scad-chat.vercel.app', demoUrl: 'https://mirai-dev-chat.vercel.app' },
    { id: 'beauty', emoji: '✂️', name: 'イロナビ', sub: 'パーソナルカラー診断', prodUrl: 'https://scad-beauty.vercel.app', demoUrl: 'https://mirai-dev-beauty.vercel.app' },
    { id: 'solo', emoji: '🍶', name: 'ヨイナビ', sub: '今夜の店探し', prodUrl: 'https://scad-solo.vercel.app', demoUrl: 'https://mirai-dev-solo.vercel.app' },
    { id: 'partyconnect', emoji: '🎉', name: 'SCADコネクト', sub: '街コン運営サポートシステム', prodUrl: 'https://scad-partyconnect.vercel.app/' },
    { id: 'migoron', emoji: '🌸', name: 'ミゴロンナビ', sub: '花見・花スポット検索', prodUrl: 'https://motionimaging.vercel.app/migoron' },
  ],
  sns: [
    { label: 'Instagram', icon: 'instagram', url: 'https://www.instagram.com/motion.imaging/' },
    { label: 'X', icon: 'x', url: 'https://x.com/motion_imaging' },
  ],
};
