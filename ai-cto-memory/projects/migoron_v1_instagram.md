# PROJECT_SUMMARY

- **プロジェクト名**: Migoron SNS自動投稿システム（@motion.imaging Instagram自動投稿）
- **目的**: 宮古島・石垣島の風景写真をInstagramに毎日自動投稿。天気・海況・AIキャプションを組み合わせた高品質な投稿を無人で運用
- **対象ユーザー**: Jake（運用者本人）
- **作成した機能**:
  - Instagram毎日自動投稿（@motion.imaging）
  - Geminiによるテーマ自動判別＋冒頭1行詩的生成（1回のAPI呼び出しに統合）
  - 天気・海況リアルタイム取得（Open-Meteo / Marine API）
  - 2重投稿防止（Redisフラグ＋Instagram API二重チェック）
  - 宮古島・石垣島6枚ごと交互投稿ロジック
- **技術スタック**: Next.js / Vercel Cron / Upstash Redis / Gemini 2.5 Flash / Instagram Graph API / GitHub（画像ホスティング）
- **アーキテクチャ概要**: Vercel CronがGET APIを叩く → Redis二重投稿チェック → Instagram API二重チェック → 天気取得 → 画像index計算（書き込まず） → Gemini画像解析（テーマ+冒頭1行同時） → Redisフラグ＆index確定 → Instagram投稿
- **達成した成果**:
  - 宮古島47枚・石垣島109枚の画像管理体制構築
  - Geminiによる冒頭詩的1行の自動生成（画像に合わせてランダム）
  - 2重投稿問題の根本対策（Redis＋Instagram API二重チェック）
- **成功事例**:
  - テーマ判別と冒頭1行生成を1回のAPI呼び出しに統合してコスト削減
  - GitHubを画像ホスティングとして活用（無料）
  - 投稿前にRedisフラグとインデックスを確定することで2重投稿を防止
- **失敗事例**:
  - `getNextImageIndex`内でRedis書き込みを先にやっていたため、Cronが2回走るとフォルダが切り替わり宮古島・石垣島に別々投稿される事故が複数日発生
  - コード修正のデプロイタイミングとCron実行が重なり古いコード・新コードの両方で投稿される事故
  - GitHubブラウザUIで大量画像を一度にアップロードしてタイムアウト
  - 画像をリポジトリルートに誤アップロード
- **技術選定理由**:
  - Vercel Hobby（無料）でCron運用。ただし最大1時間のズレあり
  - Upstash Redis（無料Tier）で投稿済みフラグ管理
  - Gemini 2.5 Flash（thinkingBudget:0）でコスト抑制しながら高速生成
  - GitHubをPublicリポジトリにして画像URLをraw.githubusercontent.comで取得
- **次回改善点**:
  - @jake_images_にも同様のInstagram API二重チェックを追加
  - GitHubへの大量画像アップロードは10枚ずつに分割する運用ルール化
  - アクセストークン自動更新の実装

---

# LESSONS_CANDIDATE
## 成功パターン

- **Redisへの書き込みは投稿直前に行う**: インデックス計算と書き込みを分離し、投稿成功直前にまとめて確定することで2重実行時のデータ不整合を防止
- **外部APIで二重チェック**: Redisフラグだけでなく Instagram API で直近投稿日時を確認することで、Redisが更新される前に2回目が走るケースも防止できる
- **Gemini Vision呼び出しの統合**: テーマ判別と冒頭1行生成を1プロンプト・1API呼び出しにまとめ、`THEME: xxx / OPENING: xxx` 形式で返させてパースする設計はコスト削減に有効
- **GitHubブラウザUIで大量ファイルアップロードは10枚ずつ**: 一度に大量アップロードするとタイムアウトする

---

# FAILURES_CANDIDATE
## 失敗パターン

- **Redisへの書き込みを処理の途中でやる**: 投稿前にインデックスをRedisに書くと、2回目のCron実行時にフォルダ判定がずれて別フォルダに投稿される
- **コード修正のデプロイ中にCronが走る**: 古いコードと新しいコードが両方実行されて2重投稿になる。デプロイタイミングとCron時刻が重なると発生しやすい
- **GitHubのルートに画像を誤アップロード**: フォルダ階層を確認せずにアップロードすると誤った場所に入る。ターミナルで`git status`を使って確認する習慣が必要
- **ローカルとリモートの乖離**: GitHubブラウザでアップロード後にローカルからpushしようとするとコンフリクトする。`git pull`を先に実行する

---

# PATTERNS_CANDIDATE
## 再利用可能な設計

**SNS自動投稿の安全設計パターン（順序が重要）**:
1. Redisで当日投稿フラグチェック
2. 外部API（Instagram等）で直近投稿日時チェック
3. インデックス計算のみ（Redis書き込みなし）
4. キャプション生成
5. Redisフラグ＆インデックス確定（投稿直前）
6. 投稿実行

**Gemini Vision 複数タスク統合パターン**:
```
TASK1: xxx
TASK2: xxx
```
形式で1回の呼び出しにまとめ、正規表現でパースする

**画像ループ投稿パターン**: Redisにインデックスを保存し `(current + 1) % count` でループ。-1リセットで01から再スタート

## 再利用可能な機能

- `detectThemeAndOpening()`: 画像からテーマと詩的1行を同時生成
- `getNextImageIndex()`: 書き込みなしでインデックス計算のみ返す
- Instagram API当日投稿チェック（`/media?fields=timestamp&limit=1`）

## 再利用可能なプロンプト

```
この写真について2つ答えてください。必ず以下のフォーマットで返してください。
THEME: [選択肢から1つ]
OPENING: [条件に合った1行、20〜35文字、句読点なし、絵文字なし、感嘆詞禁止、疑問文禁止]
```

---

# BUSINESS_KNOWLEDGE
## 業務改善ノウハウ

- **Vercel Hobbyプランの限界を理解する**: CronはUTCベースで最大1時間のズレが発生する。同じCronが複数回実行されることがある前提で設計する
- **画像管理はゼロ埋め2桁ファイル名**: `01.jpg`〜`109.jpg`。環境変数で枚数管理することでコード変更なしに画像追加できる
- **GitHubへの大量アップロードは10枚ずつ**: ブラウザUIの制限でタイムアウトするため分割が必須
- **Upstash RedisのFree Tierで十分**: 投稿済みフラグとインデックス管理程度であれば無料枠で運用可能
- **X APIコスト**: URLなし$0.015/件、URLあり$0.20/件（13倍）。Instagram URLのX投稿は廃止済み

## ドメイン知識

- 宮古島・石垣島のテーマ分類：beach / star / diving / flower_buffalo / sunset / other
- 6枚ごとに宮古島↔石垣島を交互投稿する設計（曜日・カレンダー非依存）

---

# AI_TIPS_CANDIDATE
## AI活用ノウハウ

- **Gemini Vision の`thinkingBudget:0`**: 思考不要な分類タスクはthinkingBudgetを0にして高速化・コスト削減
- **テーマ判別は`temperature: 0.1`**: 分類タスクは低温度で安定させる。キャプション生成は`temperature: 0.9`で多様性を出す
- **`maxOutputTokens`をタスクに合わせる**: テーマ+1行生成は120トークン、キャプション全文は800トークン
- **Geminiへの画像渡し方**: GitHubのraw URLから`imageUrlToBase64()`でbase64変換してinline_dataで渡す
- **開発ワークフロー**: Geminiでアイデア出し・概念設計、Claudeでコード生成・デバッグ、GitHub Desktopでcommit/push
