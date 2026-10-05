# motionimaging

Motion Imaging の公式サイト（Next.js 16 / Vercel Hobby）と、SNS自動投稿（Vercel Cron）をまとめたリポジトリ。

| パス | 内容 |
|---|---|
| `/` `/migoron` `/about` | 公開ページ |
| `/admin` | 管理画面（パスワード保護。後述） |
| `/api/post-*` | SNS自動投稿（cronから実行） |
| `partyconnect/` | 別アプリ（パーティコネクト）。詳細は `partyconnect/README.md` |

コードはすべて `src/` 配下（2026-09-24 に `app/` から移動）。

---

## 自動投稿一覧

`vercel.json` の schedule は **UTC**。下表は日本時間。

| 時刻(JST) | エンドポイント | 投稿先 | 内容 | 画像 |
|---|---|---|---|---|
| 6:00 | `/api/post-instagram` | Instagram @motion.imaging ＋Threads | 宮古島・石垣島の写真（6投稿ごとに交互） | `post-instagram/images/ig_motion_imaging/` |
| 6:10 | `/api/post-jake-images` | Instagram @jake_images_ ＋Threads | ポートレート（EXIF付き） | `post-instagram/images/ig_jake_images/portrait/` |
| 6:20 | `/api/post-morning-all` | X ミゴロン ＋Threads | 花畑指数（1本） | `post-images/flower/` |
| 18:05 | `/api/post-evening` | X ミゴロン ＋Threads | 星空指数（実際の天気から算出） | `post-images/star/` |
| 21:15 | `/api/post-daily` | X ミゴロン ＋Threads | 翌日の雲海指数・富士山指数（2本） | `post-images/cloud/` `fuji/` |
| 7:30 | `/api/post-sukuado-morning` | X スクアド ＋Threads | 朝枠 | なし |
| 7:31 | `/api/post-sukuado-morning-question` | X スクアド ＋Threads | 朝の質問 | なし |
| 22:00 | `/api/post-sukuado-night` | X スクアド ＋Threads | 夜枠 | `post-images/scad-night/` |
| 22:01 | `/api/post-sukuado-promo` | X スクアド ＋Threads | 告知 | なし |
| 7:30 | `/api/post-jake-ai-morning` | X jake_images ＋Threads | 生成AI情報（Gemini生成、失敗時は固定文） | なし |
| 22:00 | `/api/post-jake-ai-night` | X jake_images ＋Threads | 生成AI情報 ＋「30日振り返り」（day30で自動停止） | 振り返りのみ `post-images/jake-ai/` |

- Threadsへの投稿はすべて「ついで」の扱い。失敗しても本体（Instagram / X）の投稿には影響しない。
- 廃止済み：英語版 Kanto Bloom Report（2026-09-13）、お出かけ開運指数（2026-09-28）。
- 同じ日に2回投稿しないよう、Redisの `*_posted_date` などで当日分を予約してから投稿する（`SET NX`）。

### 手動実行・確認

一番簡単なのは **Vercel → Settings → Cron Jobs → Run**。キーは不要で、結果は Logs で確認できる。

ブラウザから直接実行する場合は `?key=<CRON_SECRET>` を付ける。対応しているパラメータはエンドポイントごとに違う。

| パラメータ | 意味 |
|---|---|
| `force=1` | 当日投稿済みでも実行する（**実際に投稿される**） |
| `dry=1` | 投稿せず、本文と文字数だけ返す |
| `report=1` | 前回の実行レポートを表示する |
| `noimage=1` | 画像なしで投稿する |

---

## 管理画面 `/admin`

`https://motionimaging.vercel.app/admin`。ユーザー名は何でもよく、パスワードは `ADMIN_PASSWORD`。未設定のときは誰も開けない。

| 項目 | 内容 | データ元 |
|---|---|---|
| 自動投稿の稼働状況 | 上表12本それぞれの「正常／一部注意／失敗／止まっている可能性（26時間以上実行なし）」、エラー内容、最後に成功した日時 | 各cronがRedisの `job_status:<id>` に記録（`src/lib/job-status.js`） |
| SNSトークン | Instagram 2つ・Threads 3つが今使えるか（開くたびに確認） | Meta API の `/me` |
| パーティコネクト | 主催者・開催予定・開催済み・延べ参加者・成立ペア | Supabase（参加者の個人情報は取得しない） |

未実装：各アプリのアクセス数（Hobbyプランでは取得APIに制限あり）、API使用量（Gemini・X）。

---

## 画像

- GitHubのraw URL（`https://raw.githubusercontent.com/<owner>/<repo>/main/src/app/api/...`）からXやInstagramに渡している。**フォルダを移動したり名前を変えたりすると、コード内のURLも直さないと画像が404になる**。
- X用の画像は**長辺2048px以下**にする。カメラ原寸だとアップロード自体は通るが、投稿時に「Your media IDs are invalid」で失敗する。
- ファイル名は大文字・小文字を区別する（`.JPG` と `.jpg` は別物）。

| フォルダ | ファイル名 | 枚数 | 枚数の環境変数 |
|---|---|---|---|
| `post-images/flower/` | `花00201.jpg`〜 | 17 | `FLOWER_IMAGE_COUNT` |
| `post-images/fuji/` | `富士山00101.jpg`〜 | 11 | `FUJI_IMAGE_COUNT` |
| `post-images/star/` | `星00301.jpg`〜 | 8 | `STAR_IMAGE_COUNT` |
| `post-images/cloud/` | `雲海0001.JPG`〜（4桁・大文字） | 11 | `CLOUD_IMAGE_COUNT` |
| `post-images/scad-night/` | `01.jpg`〜 | 8 | `SCAD_NIGHT_IMAGE_COUNT` |
| `post-images/jake-ai/` | `AI00001.JPG`〜 | 8 | `JAKE_AI_IMAGE_COUNT` |
| `post-instagram/images/ig_motion_imaging/miyakojima/` | `01.jpg`〜`47.jpg` | 46（16.jpgが欠番） | `MIYAKOJIMA_IMAGE_COUNT`（既定47） |
| `post-instagram/images/ig_motion_imaging/ishigaki/` | `01.jpg`〜`106.jpg` | 106 | `ISHIGAKI_IMAGE_COUNT`（既定106） |
| `post-instagram/images/ig_jake_images/portrait/` | `01.jpg`〜`61.jpg` ＋ `exif.csv` | 61 | `JAKE_IMAGE_COUNT` |

写真を追加したら、枚数の環境変数も合わせて更新する。@motion.imaging のInstagramは、番号の写真が無い（欠番・枚数の設定ミス）場合は自動で次の番号に進む（最大10枚まで）。

---

## 環境変数（Vercel）

| 用途 | 変数 |
|---|---|
| 共通 | `CRON_SECRET` `KV_REST_API_URL` `KV_REST_API_TOKEN`（Upstash Redis） `GEMINI_API_KEY` `GITHUB_REPO_OWNER` `GITHUB_REPO_NAME` `GITHUB_BRANCH` |
| X ミゴロン | `X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_SECRET` |
| X スクアド | `SCAD_X_API_KEY` `SCAD_X_API_SECRET` `SCAD_X_ACCESS_TOKEN` `SCAD_X_ACCESS_SECRET` |
| X jake_images | `JAKE_X_API_KEY` `JAKE_X_API_SECRET` `JAKE_X_ACCESS_TOKEN` `JAKE_X_ACCESS_SECRET` |
| Instagram | `INSTAGRAM_ACCESS_TOKEN` `INSTAGRAM_BUSINESS_ACCOUNT_ID`（motion） / `JAKE_IMAGES_ACCESS_TOKEN` `JAKE_IMAGES_ACCOUNT_ID`（jake） |
| Threads | `THREADS_MOTION_TOKEN`（ミゴロン・motion） `THREADS_JAKE_TOKEN`（jake） `THREADS_SUKUADO_TOKEN`（スクアド） |
| 管理画面 | `ADMIN_PASSWORD` `PARTYCONNECT_SUPABASE_SECRET_KEY`（`PARTYCONNECT_SUPABASE_URL` は省略可） |
| 画像枚数 | 上の画像表を参照 |

環境変数を変えたら **Redeploy しないと反映されない**。

---

## Meta（Instagram / Threads）トークンの更新手順

Metaのトークンは**約60日で切れる**。また、Facebook側のパスワード変更やセキュリティ判定で**期限前でも無効になる**（エラー `code=190`）。自動延長の仕組みはまだ無いので、管理画面の「SNSトークン」が「無効」になったら次の手順で更新する。

1. [Meta for Developers](https://developers.facebook.com/) → マイアプリ
   - Instagram：**motionimaging_v2** → Instagram → APIのセットアップ → 「アクセストークンを生成」
   - Threads：**migoron_threads** → Threads → 「アクセストークンを生成」
2. 対象アカウントの行で生成し、表示された長い文字列（Instagramは `IGAA…`、Threadsは `THAA…`）をコピーする。数字だけの値はアカウントIDなので違う。
3. Vercelの該当する環境変数を書き換えて **Redeploy**。
4. 管理画面で「有効」になっていることを確認する。

**注意（Threads）**：同意画面には、ブラウザでThreadsにログインしているアカウントが出る。「jake_images_として続行」と出ているときに進むと、どの行のボタンを押してもjake用のトークンになる。motion用を作るときは、その画面に motion.imaging が表示されることを必ず確認する。

---

## 既知の課題

- **Threads（ミゴロン用）のトークンが 2026-09-15 から期限切れのまま**。上の同意画面の問題で motion.imaging のトークンを再発行できていない。本体の投稿には影響なし。jake用は 2026-09-28 に再発行した。スクアド用は未確認（管理画面で確認できる）。
- Metaトークンの自動延長が未実装。
- 管理画面のアクセス数・API使用量は未実装。

---

## 障害の記録

| 時期 | 症状 | 原因 | 対応 |
|---|---|---|---|
| 2026-09-13 | 雲海指数が内容違いで2回投稿された | 「投稿済みか確認→投稿→フラグを立てる」の間にcronが二重起動 | 投稿前に `SET NX` で当日分を予約する方式に変更（朝・夕・夜すべて） |
| 2026-09 | 富士山指数で「Your media IDs are invalid」 | 画像がカメラ原寸（最大9504px） | 全画像を長辺2048pxに縮小 |
| 2026-09 | 星空指数が雨の日に95% | 星空指数が天気を見ていなかった | open-meteo の雲量・天気から算出するよう変更 |
| 2026-09-15頃〜09-28 | Instagram 2アカウントの投稿が止まっていた | Metaトークンの無効化（code=190） | トークンを再発行。気づけなかった反省から管理画面を追加 |
| 2026-09-24〜09-25 | 全アカウントで画像が付かない／Instagramが投稿できない | `app/`→`src/app/` 移動で画像URLが404 | 全7ファイルのURLを `src/app/...` に修正 |
| 2026-10-05（未発生） | 宮古島 `16.jpg` 欠番、石垣島の枚数設定が実際より3枚多い | 該当番号の日にInstagram投稿が失敗する状態だった | 欠番を飛ばす処理を追加、石垣島の既定枚数を106に修正 |
