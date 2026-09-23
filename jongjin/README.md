# VERT5X / JONGJIN 自動投稿

Instagram と Threads に月・水・金の 19:00 (JST) に自動投稿します（X は API を用意したら追加）。
ミゴロンとは別の Vercel プロジェクト・別の Redis で動かします。

## 普段やること（これだけ）

1. 画像を `public/images/<カテゴリ>/01.jpg` の形で置く（stage / home / out / studio、各01〜05）
2. 文言を変える・増やすときは `content/posts.json` を編集
3. push する → 次の投稿から反映

在庫が残り1枚以下になると Discord に通知が届きます。補充しなければ古い順に再利用するので、投稿は止まりません。

## 仕組み

- カテゴリは stage → home → out → studio の順番で回す
- カテゴリ内では未投稿の画像を優先。画像ファイルがまだ無い投稿は自動で飛ばす
- out のときだけ、東京の天気（Open-Meteo）に合わせた一言を冒頭に付ける
  - AI生成ではなく条件分岐＋言い回し候補から選ぶ。直近10回で使った言い回しは使わない
  - 天気が取れなかった日は天気コメントなしで投稿する
- `"months": [12, 1, 2]` を付けた投稿はその月だけ出る（雪の写真など）
- `"draft": true` は引き継ぎ書にない追加文言。確認したら消してよい
- Instagram に投稿できた時点で投稿済みにする。Threads が失敗しても二重投稿にはならない（Discord に通知）

## 動作確認

```
https://<ドメイン>/api/post?key=<CRON_SECRET>&dry=1   # 投稿せずに次の内容を表示
https://<ドメイン>/api/post?key=<CRON_SECRET>         # 手動で投稿
```

`npm test` でロジックのテスト。

## 初期設定

1. 新リポジトリを作り、このフォルダを切り出す
   `git subtree split --prefix=jongjin -b jongjin-split` → 新リポジトリに push
2. Vercel で新規プロジェクトとして import、Upstash Redis を新規作成して接続
3. `.env.example` の環境変数を設定
   - Instagram: JONGJIN のプロアカウントの `INSTAGRAM_BUSINESS_ACCOUNT_ID` / `INSTAGRAM_ACCESS_TOKEN`
   - Threads: `THREADS_ACCESS_TOKEN`（未設定なら Threads はスキップ）
   - `DISCORD_WEBHOOK_URL`（任意）
4. `dry=1` で内容を確認してから本番運用

## 注意

- AI 生成の人物画像なので、Instagram/Threads のアプリ側で「AI 情報」ラベルを付けること、
  プロフィールに架空キャラクターであることがわかる一言を入れることを推奨（API からはラベルを付けられないため）
- Instagram のアクセストークンは60日で期限切れ。ミゴロンと同じ方法で更新する
