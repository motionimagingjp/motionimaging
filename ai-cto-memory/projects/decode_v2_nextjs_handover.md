# DECODE v2（Next.js版）引き継ぎ書

> 別チャットでこのファイルを貼れば、続きから作業できます。
> **公開中のWeb版（vanilla HTML）の引き継ぎ書とは別物です。**
> あちらは現在稼働中の `decode-app-fin.vercel.app`、こちらはこれから差し替える新しい実装です。

作成日：2026年7月27日
状態：**コード一式が完成・ビルド確認済み。まだデプロイしていない。**

---

## 1. なぜ作り直したか

現行のWeb版は1ファイル1,100行のHTMLに全部入っている構造で、機能を足すたびに壊れやすくなっていました。加えて今回、以下を入れたかったため作り直しています。

- ログイン・ユーザー登録
- 会話履歴をブラウザではなくサーバー側に保存（iPhoneとMacで同じ履歴が見られる）
- 前回バグで断念した「分析レポートを開く」ボタン
- Geminiレビューで指摘された文字サイズ・コントラストの改善

iOS化の方式は**まだ決めていません**。Next.jsで作っておけば、後からCapacitorで包む選択肢も残ります。FlutterFlowには戻らない方針です（無料プランのState Management制限と、数値入力欄に手入力できない問題で前回詰まったため）。

---

## 2. 技術構成

```
ブラウザ
  ↓ fetch('/api/chat')  ※ストリーミング受信
Next.js API Route（サーバー）← ここでGEMINI_API_KEYを隠す
  ↓
Gemini API（gemini-2.5-flash / streamGenerateContent）

  ＋

Supabase（認証・会話履歴）
  Row Level Security で「自分の行しか読めない」をDB側で強制
```

| 項目 | 採用 |
|---|---|
| フレームワーク | Next.js 16.2.12（App Router） |
| 言語 | TypeScript |
| スタイル | Tailwind CSS v4（CSSベース設定・`@theme`） |
| 認証・DB | Supabase（メール＋パスワード／Googleログイン） |
| AI | Gemini 2.5 Flash |
| ホスティング | Vercel（予定） |

**Next.jsのバージョンについて**：最初 15.1.6 を入れたところ脆弱性の警告が出たため 16.2.12 に上げました。さらに残っていた `postcss` と `sharp` の脆弱性も `package.json` の `overrides` で潰してあります。`npm audit` は現在ゼロ件です。**`overrides` の項目は消さないでください。**

---

## 3. ファイル構成

```
decode-next/
├── package.json              ← overrides で postcss/sharp を固定している
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── middleware.ts             ← 未ログインなら /login へ飛ばす
├── .env.local.example        ← 環境変数のひな形
├── supabase/
│   └── schema.sql            ← テーブル定義＋Row Level Security
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css       ← 色・書体のトークン定義
    │   ├── page.tsx          ← 相談室（要ログイン）
    │   ├── login/page.tsx    ← ログイン・新規登録
    │   ├── auth/
    │   │   ├── callback/route.ts   ← Googleログインとメール確認の戻り先
    │   │   └── signout/route.ts
    │   ├── privacy/page.tsx
    │   ├── disclaimer/page.tsx
    │   └── api/chat/route.ts       ← Geminiプロキシ（この1本が心臓部）
    ├── components/
    │   ├── Chat.tsx          ← 状態管理とストリーミング受信
    │   ├── AdvisorBar.tsx    ← 男性・女性・ジェイ本人のラジオボタン
    │   ├── MessageBubble.tsx ← 吹き出し＋分析レポートの折りたたみ
    │   ├── Composer.tsx      ← 入力欄・画像添付・圧縮
    │   ├── HistoryPanel.tsx  ← 過去の相談一覧
    │   ├── LegalPage.tsx     ← 法務ページの共通レイアウト
    │   └── Wordmark.tsx
    └── lib/
        ├── advisors.ts       ← 3人の設定とシステムプロンプト（ここを触れば人格が変わる）
        ├── safety.ts         ← NGワード判定（クライアントとサーバー両方から呼ぶ）
        ├── types.ts
        └── supabase/
            ├── client.ts     ← ブラウザ用
            ├── server.ts     ← サーバーコンポーネント／API Route用
            └── middleware.ts ← セッション更新とリダイレクト
```

---

## 4. 旧版から変えたところ

### 回答がリアルタイムで流れてくる
旧版は全文が生成されるまで「考え中…」で待つ設計でした。今回は Gemini の `streamGenerateContent` を使い、書き始めた瞬間から文字が出ます。体感速度が大きく変わります。書いている最中はカーソルが点滅します。

### 「分析レポートを開く」ボタン
AIが以下の4部構成で返すようプロンプトを組んでいます。

```
## 読み取れること      ← チャット上にはここだけ表示
## 返信案
## なぜこれが効くのか
## いつ送るか・その後どうするか
```

`MessageBubble.tsx` の `splitSections()` が `## ` で分割し、2節以上あればボタンを出します。雑談レベルの相談では4部構成を使わないようプロンプトで条件を明示してあるので、「こんにちは」にレポートは出ません。

### 文字サイズとコントラスト
`globals.css` で `html { font-size: 17px }` に設定。グレーも旧版の `#6b7a74` から `#94a5a0` に上げました。旧版は背景に対してコントラストが足りていませんでした。Geminiレビューへの対応です。

### 履歴がアカウントに紐づく（ログイン時）／端末に残る（ゲスト時）
**ログインは必須ではありません。** ゲストのまま使うと会話はブラウザのLocalStorageに保存され、ログインするとSupabaseに保存されて他の端末からも見られるようになります。

| | ゲスト | ログイン済み |
|---|---|---|
| 履歴の保存先 | ブラウザのLocalStorage（`src/lib/localHistory.ts`） | Supabase（DB） |
| 他の端末から見られるか | 見られない | 見られる |
| 会話の文脈をAIに渡す方法 | クライアントが持っている履歴をそのままリクエストに含める（`guestHistory`） | サーバーがDBから読み込む |
| `/api/chat` の認証 | 不要 | 不要（両方ともログインなしで呼べる。ユーザーがいれば保存し、いなければ保存しない、という分岐） |

`middleware.ts` はもう `/` へのアクセスをログイン必須にしていません。ログイン済みの人が `/login` を開いたときだけ `/` に戻す、という最小限の制御だけ残っています。

### 画像は引き続き保存しない
公開中のプライバシーポリシーで「画像はサーバーに保存しない」と書いているので、その設計を維持しています。DBには `has_image` という真偽値だけ残し、画像データそのものは保存しません。会話を再開したときは、過去の画像は `［画像を添付］` というテキストとしてGeminiに渡されます。

---

## 5. セットアップ手順（まだ未実施）

### ① Supabaseのプロジェクトを作る
1. [supabase.com](https://supabase.com) でプロジェクト作成（リージョンは Northeast Asia (Tokyo) 推奨）
2. 左メニュー「SQL Editor」→ `supabase/schema.sql` の中身を全部貼って **Run**
3. 「Project Settings」→「API」から次の2つをコピー
   - Project URL
   - anon public key

### ② Googleログインを有効にする
1. Supabase の「Authentication」→「Providers」→「Google」をオン
2. 表示される Callback URL をコピー
3. [Google Cloud Console](https://console.cloud.google.com) →「APIとサービス」→「認証情報」→ OAuth クライアントIDを作成し、承認済みリダイレクトURIに ② でコピーしたURLを貼る
4. 発行された Client ID と Client Secret を Supabase 側に貼る

### ③ 環境変数を用意する
`.env.local.example` を `.env.local` にコピーして中身を埋めます。

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=（値は伏字。Supabase Project Settings→APIから取得）
GEMINI_API_KEY=（値は伏字。Google AI Studioから取得）
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`GEMINI_API_KEY` に `NEXT_PUBLIC_` を付けないこと。付けるとブラウザに漏れます。

### ④ ローカルで動かす
```bash
cd decode-next
npm install
npm run dev
```
→ http://localhost:3000

### ⑤ Vercelにデプロイ
```bash
vercel
vercel --prod
```
Vercelダッシュボードの「Settings」→「Environment Variables」に上の4つを登録してから `vercel --prod` を実行。`NEXT_PUBLIC_SITE_URL` は本番URLに変えます。

**Supabase側の設定も忘れずに**：「Authentication」→「URL Configuration」の Site URL と Redirect URLs に本番URL（`https://xxx.vercel.app/auth/callback`）を追加してください。ここを忘れるとGoogleログインが本番で失敗します。

---

## 6. 確認済みのこと

| 項目 | 結果 |
|---|---|
| TypeScript型チェック | エラーなし |
| 本番ビルド | 成功（8ルート生成） |
| `npm audit` | 脆弱性 0件 |
| 未ログインで `/` にアクセス | `/login` へリダイレクト（307） |
| `/login` `/privacy` `/disclaimer` | 200で表示 |
| `GEMINI_API_KEY` の露出 | サーバー側の1箇所のみ。フロントには出ていない |
| セーフティフィルター | 恋愛相談16件で誤ブロックなし。`stalk` の見逃しを1件見つけて修正済み |

**未確認**：実際のSupabase接続、Googleログインの往復、Geminiのストリーミング実挙動、iPhone実機での表示。これらは環境変数を入れて動かさないと確認できません。

---

## 7. 次にやること

**優先度 高**
- [ ] Supabaseプロジェクト作成 → schema.sql 実行
- [ ] Googleログインの設定
- [ ] ローカルで一度動かして、ログイン → 相談 → 履歴の往復を確認
- [ ] Vercelにデプロイ

**優先度 中**
- [ ] 現行の `decode-app-fin.vercel.app` からどう切り替えるか決める（同じドメインで差し替えるか、新ドメインを取るか）
- [ ] 分析トーンの選択機能（「ライトに分析」「本音を暴く」「次のアクション重視」）— Geminiレビューの未実装分
- [ ] 送信タイミングのアドバイス強化（相手の生活リズムに基づく推奨時間）

**優先度 低・検討中**
- [ ] iOS化の方式決定（Capacitorで包む案が有力）
- [ ] 独自ドメイン取得
- [ ] PWA化

---

## 8. ハマりそうなところ

**`overrides` を消さないこと**
`package.json` の `overrides` は脆弱性対策です。消すと `npm audit` で3件のhighが復活します。

**Geminiのモデル名は決め打ちしない**
前回、モデルが次々使えなくなって4回変更しました。エラーが出たらまず使えるモデル一覧を取得してください。
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=APIキー" | grep '"name"'
```
モデル名は `src/app/api/chat/route.ts` の先頭 `const MODEL = "gemini-2.5-flash"` の1箇所だけです。

**Supabaseの `cookies()` は非同期**
Next.js 15以降 `cookies()` に `await` が必要です。古い記事のコードをそのまま貼ると型エラーになります。

**middleware の `getUser()` を消さないこと**
`src/lib/supabase/middleware.ts` の `supabase.auth.getUser()` はセッション更新のために呼んでいます。使っていないように見えても消すとログインが切れます。

**「考え中で止まる」系の症状の切り分け**
1. `curl` でAPI単体を叩く → サーバーかフロントかを判定
2. ブラウザのDevTools → Console で赤いエラーを確認

---

## 9. アドバイザーの設定を変えたいとき

`src/lib/advisors.ts` の1ファイルだけ見れば済みます。

- `REPORT_FORMAT` … 3人共通の4部構成の指示。ここを直せば全員のレポート形式が変わる
- `ADVISORS.ren / saki / jay` … それぞれの人格・話し方・やらないこと
- `ADVISOR_ORDER` … ボタンの並び順（現在 男性・女性・ジェイ本人）
- `DEFAULT_ADVISOR` … 初回のデフォルト（現在 `saki` ＝女性）

ジェイの口癖や実体験を足したい場合も、このファイルの `jay.systemPrompt` に追記するだけです。

---

## 10. 法務メモ（現行版から引き継ぎ）

**使ってよい表現**：婚活アドバイザー／恋愛コーチ／恋愛相談AI／AIアドバイザー
**避けるべき表現**：心理カウンセラー／心理士・心理師／セラピスト

- 「カウンセラー」「心理士」は資格が必要な名称。今回の実装では全て「アドバイザー」に統一済み
- マッチング機能を持つと結婚相手紹介サービス業の届出義務が発生する（現状は対象外）
- 「LINE」はLINE社の商標。UI文言は「やり取りのスクショ」等の表現にしてある
- AI生成コンテンツの明示は実装済み（各回答の下＋画面下部）
- 第三者スクショへの配慮注記も実装済み（画像添付時に表示）

---

## 11. 作業スタイルのメモ

- コードは部分diffではなくファイル全体で受け取りたい（削除→新規作成で貼り付けるため）
- ただしデプロイ済みアプリの小さな修正は、ターミナルで短いPythonワンライナーを実行する方が早い。長いコマンドを一度に貼ると途中で止まる
- iPhoneとMacの両方で作業している
- ローカルの作業ディレクトリ：現行版は `~/Downloads/renai-app`
- Node.js / npm / Vercel CLI はインストール済み
