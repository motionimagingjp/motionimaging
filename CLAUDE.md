# motionimaging (MOTIONIMAGING LAB)

本番URL: https://motion-imaging-lab.vercel.app/ (Vercelプロジェクト名は `motionimaging`、`motionimagingjps-projects`チーム配下)

このリポジトリには性質の異なる2つのアプリが同居している。

1. **ルート(`src/app/`)**: motionimaging本体。トップページ + Instagram/X/Threadsへの自動投稿bot群(Vercel Cron)
2. **`partyconnect/`**: 「SCADコネクト」(旧PartyConnect)。街コンの受付〜マッチング〜データ消去を行う主催者向け進行システム。自己完結しており、そのまま独立リポジトリへ切り出せる構成([詳細](partyconnect/README.md))。内部識別子(ディレクトリ名・DBスキーマ・Cronジョブ名)は`partyconnect`のまま、表示名のみ「SCADコネクト」に改称済み。

MOTIONIMAGING LABは「SCAD」シリーズ(婚活AIチャット「スクアド」、「SCADビューティー」)の親ブランド。

## 重大な注意: `app/`と`src/app/`を絶対に共存させない

2026年9月、ルート直下に`app/api/*`(cron投稿ルート)が追加された際、既存の`src/app/`(本来のページ用App Router)と共存してしまい、**Next.jsがルート直下の`app/`を優先して`src/app/page.js`を完全に無視 → 本番トップページが404になる障害**が発生した。原因特定に時間がかかったため明記する。

- **このプロジェクトのApp Routerは`src/app/`に一本化されている。新しいルート/ページ/API routeは必ず`src/app/`配下に追加すること**
- ルート直下に`app/`ディレクトリを新規作成しない(空でも作らない)
- 何かのツール/コマンドが誤ってルート直下に`app/`を生成した場合は、ビルド前に気づいて`src/app/`へ統合する

## ディレクトリ構成(ルート側)

```
src/app/
  page.js, layout.js        トップページ
  about/                    会社紹介ページ
  migoron/                  みごろん(季節の見頃情報)ページ + 同名API
  admin/                    管理画面。自動投稿の稼働状況・SCADコネクトの利用状況を一覧表示
  api/
    _lib/                   post-jake-ai-core.js, post-sukuado-core.js など複数アカウント共通ロジック
    post-instagram/         Instagram投稿 (@motion.imaging)
    post-jake-images/       Instagram投稿 (@jake_images_)
    post-daily / post-evening / post-morning-all / post-jake-ai-morning / post-jake-ai-night /
    post-sukuado-morning / post-sukuado-morning-question / post-sukuado-night / post-sukuado-promo
                            X(旧Twitter)・Threads投稿(各アカウント・時間帯別)
    last-report/            直近の投稿結果確認用
    shared-about/           about情報をpartyconnect等の他アプリと共有するAPI
docs/
  jake_images_ai_trends_plan.md, jake_images_x_handover.md, partyconnect_requirements.md
```

## 自動投稿: アカウントと環境変数の対応

| 環境変数 | プラットフォーム | 使用箇所 | アカウント |
|---|---|---|---|
| `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram | `src/app/api/post-instagram/route.js` | @motion.imaging |
| `THREADS_MOTION_TOKEN` | Threads | 同上(IG投稿後に連動) | @motion.imaging |
| `JAKE_IMAGES_ACCESS_TOKEN` + `JAKE_IMAGES_ACCOUNT_ID` | Instagram | `src/app/api/post-jake-images/route.js` | @jake_images_ |
| `THREADS_JAKE_TOKEN` | Threads | 同上 | @jake_images_ |
| `THREADS_SUKUADO_TOKEN` | Threads | `post-sukuado-*`系 | Sukuado |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` / `X_API_KEY` / `X_API_SECRET` | X | `post-daily`等 | motion |
| `JAKE_X_ACCESS_TOKEN` / `JAKE_X_ACCESS_SECRET` / `JAKE_X_API_KEY` / `JAKE_X_API_SECRET` | X | `post-jake-ai-*` | jake |
| `SCAD_X_ACCESS_TOKEN` / `SCAD_X_ACCESS_SECRET` / `SCAD_X_API_KEY` / `SCAD_X_API_SECRET` | X | `post-sukuado-*` | SCAD |
| `GEMINI_API_KEY` | Gemini | キャプション生成全般(共通) | - |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis | 重複投稿防止の状態保存 | - |
| `CRON_SECRET` | - | 全cronルートの認証(`Authorization: Bearer`またはURLクエリ`key`) | - |

**Instagramアクセストークンの期限**: Meta Graph APIの長期トークンは通常60日で失効する。期限確認は
`https://graph.instagram.com/debug_token?input_token=<TOKEN>&access_token=<APP_ID>|<APP_SECRET>`
のレスポンス`data.expires_at`(UNIX時間)で行う。トークン値・Vercelの環境変数更新日時はこのリポジトリのコード/git履歴には記録されていないため、確認は都度Vercelダッシュボードで行うこと。

## Cronスケジュール(`vercel.json`)

`/api/post-*`の各ルートがUTC基準で`crons`に登録されている(JST = UTC+9で換算)。パスを変更する場合は`vercel.json`の`path`も合わせて更新すること。ルート移動(`src/app/`配下である限り)だけならパスは変わらない。

## 開発メモ

- `npm install` → `npm run build`でローカルビルド確認可能。`UPSTASH_REDIS_...`未設定の警告は無視してよい(本番はVercel側に設定済み)。
- `package-lock.json`はリポジトリに含めていない(`.gitignore`対象外だが追跡されていない状態を維持)。`npm install`実行後に誤ってコミットしないこと。
- ブランチが既にmainにマージ済みで古くなっている場合は`git fetch origin main && git merge-base --is-ancestor HEAD origin/main`で確認し、`git checkout -B <branch> origin/main`で作業ブランチを最新化してから着手する。
