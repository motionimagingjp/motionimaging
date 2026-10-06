# motionimaging (MOTIONIMAGING LAB)

本番URL: https://motion-imaging-lab.vercel.app/ (Vercelプロジェクト名は `motionimaging`、`motionimagingjps-projects`チーム配下)

このリポジトリには性質の異なる2つのアプリが同居している。

1. **ルート(`src/app/`)**: motionimaging本体。トップページ + Instagram/X/Threadsへの自動投稿bot群(Vercel Cron)
2. **`partyconnect/`**: 「SCADコネクト」(旧PartyConnect)。街コンの受付〜マッチング〜データ消去を行う主催者向け進行システム。自己完結しており、そのまま独立リポジトリへ切り出せる構成([詳細](partyconnect/README.md))。内部識別子(ディレクトリ名・DBスキーマ・Cronジョブ名)は`partyconnect`のまま、表示名のみ「SCADコネクト」に改称済み。完全に別プロジェクト(自前の`package.json`/`next.config.mjs`、別デプロイ先。デプロイ手順は`partyconnect/DEPLOY.md`)なので、ルート側のビルドには含まれない。

MOTIONIMAGING LABは「SCAD」シリーズ(婚活AIチャット「スクアド」、「SCADビューティー」)の親ブランド。

## コマンド

```
npm run dev     # next dev (http://localhost:3000)
npm run build   # next build
npm run start   # next start (本番ビルドの起動確認)
npm run lint    # next lint
```

ルート側にテストはない。`partyconnect/`は別プロジェクトとして独自のテストを持つ(`cd partyconnect && npm test`でunit + function + SQLテストを実行)。

## 重大な注意: `app/`と`src/app/`を絶対に共存させない

2026年9月、ルート直下に`app/api/*`(cron投稿ルート)が追加された際、既存の`src/app/`(本来のページ用App Router)と共存してしまい、**Next.jsがルート直下の`app/`を優先して`src/app/page.js`を完全に無視 → 本番トップページが404になる障害**が発生した。原因特定に時間がかかったため明記する。

- **このプロジェクトのApp Routerは`src/app/`に一本化されている。新しいルート/ページ/API routeは必ず`src/app/`配下に追加すること**
- ルート直下に`app/`ディレクトリを新規作成しない(空でも作らない)
- 何かのツール/コマンドが誤ってルート直下に`app/`を生成した場合は、ビルド前に気づいて`src/app/`へ統合する

## ディレクトリ構成(ルート側)

```
src/app/
  page.js, layout.js        トップページ
  about/                    自己紹介 + MOTION IMAGINGシリーズ(姉妹アプリ)紹介ページ
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

### ページとmetadataの関係

`src/app/*/page.js`はインタラクティブなため`'use client'`のClient Component。Client Componentは`metadata`をexportできないため、ルートごとのOGP/Twitterカード用metadataは、`children`をそのまま返すだけのServer Component`layout.js`を同階層に置いて定義する(`src/app/migoron/layout.js`が実例)。新しいルートにmetadataを足すときはこのパターンに従うこと。`metadataBase`はルートの`src/app/layout.js`で一度だけ設定している。

### MOTION IMAGINGシリーズ(姉妹アプリ)

`src/app/about/page.js`が「MOTION IMAGINGシリーズ」として姉妹アプリを一覧表示している。いずれも別々にデプロイされたVercelプロジェクト: SCAD CHAT(`scad-chat.vercel.app`)、SCAD BEAUTY(`scad-beauty.vercel.app`)、SCADコネクト(`scad-partyconnect.vercel.app`、`partyconnect/`からビルド)、そしてこのリポジトリ自身のミゴロンナビ。プロフィールアイコンなど一部画像はSCAD BEAUTY(`scad-beauty.vercel.app`)を参照元として共有しており、アプリごとに複製していない。

## 自動投稿: アカウントと環境変数の対応

| 環境変数 | プラットフォーム | 使用箇所 | アカウント |
|---|---|---|---|
| `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram | `src/app/api/post-instagram/route.js` | @motion.imaging |
| `THREADS_MOTION_TOKEN` | Threads | 同上(IG投稿後に連動) | @motion.imaging |
| `JAKE_IMAGES_ACCESS_TOKEN` + `JAKE_IMAGES_ACCOUNT_ID` | Instagram | `src/app/api/post-jake-images/route.js` | @jake_images_ |
| `THREADS_JAKE_TOKEN` | Threads | 同上 | @jake_images_ |
| `THREADS_SUKUADO_TOKEN` | Threads | `post-sukuado-*`系 | Sukuado |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` / `X_API_KEY` / `X_API_SECRET` | X | `post-daily`等 | motion |
| `JAKE_X_ACCESS_TOKEN` / `JAKE_X_ACCESS_SECRET` / `JAKE_X_API_KEY` / `JAKE_X_API_SECRET` | X | `post-jake-ai-*` | jake(`JAKE_IMAGES_ACCESS_TOKEN`とは別物) |
| `SCAD_X_ACCESS_TOKEN` / `SCAD_X_ACCESS_SECRET` / `SCAD_X_API_KEY` / `SCAD_X_API_SECRET` | X | `post-sukuado-*` | SCAD |
| `GEMINI_API_KEY` | Gemini | キャプション生成全般(共通) | - |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis | 重複投稿防止・画像ローテーション状態保存 | - |
| `CRON_SECRET` | - | 全cronルートの認証(`Authorization: Bearer`またはURLクエリ`key`) | - |
| `*_IMAGE_COUNT`(`FUJI_IMAGE_COUNT`等) | - | `src/app/api/post-images/<category>/`配下の連番画像の枚数 | - |

**Instagramアクセストークンの期限**: Meta Graph APIの長期トークンは通常60日で失効する。期限確認は
`https://graph.instagram.com/debug_token?input_token=<TOKEN>&access_token=<APP_ID>|<APP_SECRET>`
のレスポンス`data.expires_at`(UNIX時間)で行う。トークン値・Vercelの環境変数更新日時はこのリポジトリのコード/git履歴には記録されていないため、確認は都度Vercelダッシュボードで行うこと。

### 自動投稿ルートの共通パターン

複数アカウント対応ルート(スクアド、@jake_images)は`src/app/api/_lib/post-sukuado-core.js` / `post-jake-ai-core.js`に投稿ロジックを集約し、`post-sukuado-morning`等の薄いルートファイルがslot名を渡して`run*()`を呼ぶだけになっている。単一アカウントのルート(`post-daily`、`post-instagram`、`post-evening`、`post-morning-all`)は各ファイル内で完結。

**稼働状況の記録(必須)**: 全cronルートは実際に投稿を試みた回の結果を`src/lib/job-status.js`の`recordJobStatus()`でRedis(`job_status:<id>`)に記録し、管理画面`/admin`に表示している。新しいcronを足すときは`JOBS`配列に登録し、成功時・失敗時(catch)の両方で`recordJobStatus()`を呼ぶこと(本日投稿済みスキップ・dry runでは呼ばない)。

それ以外の共通ヘルパーは無いため、新しいルートを足す際は以下を各ファイルにコピーする形で踏襲する:

- **Xの重み付き文字数**: 280字制限は重み付きで、CJK(漢字・かな・全角記号)と絵文字は1文字あたり2、URLは実際の長さに関わらず常に23としてカウントされる。各ルートが`weightedLength()` / `clipWeighted()`を個別に実装している(単純な`.length`判定だと日本語ツイートが上限を超えて弾かれる)。全角中心のツイートは実質140字程度が上限。
- **デバッグ用クエリパラメータ**: `?key=CRON_SECRET`(ブラウザから直接実行する際のクエリ認証)、`?dry=1`(投稿せず本文と重み付き文字数を確認)、`?force=1`(当日の重複チェックを無視)、`?report=1`(前回実行レポートを表示)、`?noimage=1`、`?skip=name,...`。
- **Redis利用**: 当日重複防止は`SET NX`による原子的な予約、画像ローテーションは投稿成功後にのみindexを進めるカウンタ、@jake_imagesは直近の投稿履歴をプロンプトに渡して同じニュースの繰り返しを避けている。
- 投稿本文の作り方はアカウントで異なる。@jake_images(`post-jake-ai-*`)はGemini(`gemini-2.5-flash`)がGoogle検索groundingを使って都度生成し、`tweets.json`は生成失敗時のフォールバック(`diary.json`の30日振り返りは固定文)。スクアド(`post-sukuado-*`)はGeminiを使わず、各ルートの`tweets.json`をカテゴリが偏らない順番で1日1本ずつ投稿する。ミゴロン(`post-morning-all`/`post-evening`/`post-daily`)は天気データ(open-meteo)をもとに指数を出す。Geminiの出力は例示の丸写しや指数とメモの矛盾を検査し、問題があれば季節別の固定データ・定型文に差し替える(星空指数は指数自体をコードで計算し、Geminiは一言メモのみ)。

`docs/jake_images_ai_trends_plan.md`と`docs/jake_images_x_handover.md`は`@jake_images`アカウント固有の編集方針(投稿頻度、扱う話題の範囲、CTAのローテーション)をまとめている。このアカウントのプロンプトやスケジュールを変更する前に読むこと。

## Cronスケジュール(`vercel.json`)

`/api/post-*`の各ルートがUTC基準で`crons`に登録されている(JST = UTC+9で換算)。パスを変更する場合は`vercel.json`の`path`も合わせて更新すること。ルート移動(`src/app/`配下である限り)だけならパスは変わらない。

## 開発メモ

- `npm install` → `npm run build`でローカルビルド確認可能。`[Upstash Redis] The 'url' property is missing`(`KV_REST_API_URL`/`KV_REST_API_TOKEN`未設定)の警告は無視してよい(本番はVercel側に設定済み)。
- `package-lock.json`はリポジトリで管理している(2026-09-25追加)。依存を変えたとき以外は差分をコミットしない。
- 運用手順(投稿一覧・管理画面・画像フォルダ・Metaトークン更新手順・障害記録)は`README.md`にまとめている。
- ブランチが既にmainにマージ済みで古くなっている場合は`git fetch origin main && git merge-base --is-ancestor HEAD origin/main`で確認し、`git checkout -B <branch> origin/main`で作業ブランチを最新化してから着手する。
