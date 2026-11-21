# ミゴロン予報の精度記録

このブランチはGitHub Actions（mainの `.github/workflows/migoron-monitoring.yml`）が毎日自動で更新する記録専用ブランチです。手で編集しないでください。Vercelはこのブランチをデプロイしません（`vercel.json`）。

| ファイル | 内容 |
|---|---|
| `predictions.csv` | 投稿した指数1件ごとの記録（対象日・種別・スポット・予測・答え合わせ・ライブカメラ判定・予測時の天気） |
| `latest-review.md` | 最新の2週間レビュー |
| `reviews/YYYY-MM-DD.md` | 毎月1日・15日のレビュー |

列の意味: `predicted`=投稿した指数、`model_score`=翌日の予報モデル解析値で計算し直した指数、`model_hit`=60以上かどうかが一致したら1、`brier`=Brierスコア、`camera_seen`=ライブカメラで富士山が見えたら1、`camera_hit`=予測（60以上なら「見える」）とカメラ判定が一致したら1。

判定の基準と見直しの手順は main の `docs/migoron_accuracy_review.md`。
