# AI-CTO-Memory / 西村専用ナレッジベース

> 注記: このファイルは1チャットで3プロジェクト（ミゴロン・DECODE・婚活船長ジェイ）を横断的に扱った、開発初期段階のスナップショット。ミゴロン・DECODEは他ファイルにより詳細な後続版があるため、Step3統合では「婚活船長ジェイ（konkatsu-jay）」の部分が本ファイル固有の一次情報。

---

# PROJECT_SUMMARY

## プロジェクト名: ミゴロン SNS自動投稿システム

* **目的**: 風景写真家ジェイクのXアカウントに毎日21:15自動投稿
* **対象ユーザー**: カメラマン・風景写真愛好家
* **作成した機能**: 花畑・雲海・富士山ミゴロン指数の自動生成・投稿
* **技術スタック**: Next.js / Vercel Cron / Gemini 2.5 Flash / Twitter API v2
* **アーキテクチャ概要**: Vercel Cron → API Route → Gemini生成 → X投稿
* **達成した成果**: 毎日3投稿の完全自動化
* **成功事例**: ミゴロン指数フォーマット統一（花畑・雲海・富士山）
* **失敗事例**: モデル名の変更で何度もエラー / APIキーハードコード
* **技術選定理由**: 既存Next.jsプロジェクトに相乗り・外部ライブラリ最小化
* **次回改善点**: Open-Meteo APIで実際の気象データを使ったスコアリング

---

## プロジェクト名: DECODE（恋愛・婚活AI相談室）

* **目的**: LINEスクショを解析してAIがアドバイスを生成
* **対象ユーザー**: 婚活中の男性（30代以上）
* **作成した機能**: チャットUI・画像解析・アドバイザー切替（サキ・レン・ジェイ）
* **技術スタック**: HTML / Vercel / Gemini 2.5 Flash / Firebase（予定）
* **アーキテクチャ概要**: 静的HTML + Vercel API Route + Gemini API
* **達成した成果**: Web版完成・パスワード保護実装・iOS版開発開始
* **成功事例**: HTMLにパスワード認証をJSで直接実装
* **失敗事例**: middleware.jsをHTMLサイトに適用しようとして失敗
* **技術選定理由**: ノーコードで作れるシンプル構成
* **次回改善点**: FlutterFlowでiOS版完成・Firebaseとの連携

---

## プロジェクト名: 婚活船長ジェイ（konkatsu-jay）

* **目的**: LINEメッセージ添削・レストラン検索ツール
* **対象ユーザー**: 婚活男性
* **作成した機能**: メッセージ添削UI・レストラン検索
* **技術スタック**: Next.js 14 / Vercel / Gemini API
* **アーキテクチャ概要**: Next.js App Router + Gemini API
* **達成した成果**: Web版稼働中
* **失敗事例**: パスワード保護実装でビルドエラー継続中（放置）
* **技術選定理由**: 既存Next.jsテンプレートを流用
* **次回改善点**: ビルドエラー解消・パスワード保護の再実装

---

# LESSONS_CANDIDATE

## 成功パターン

```
✅ Gemini APIは外部ライブラリなしでfetchのみで呼べる
✅ Vercel Cronは vercel.json に "15 12 * * *" で21:15 JSTを実現
✅ APIキーは必ずprocess.env経由で読む（ハードコード厳禁）
✅ X投稿は直列処理（2秒間隔）でレート制限を回避
✅ Geminiプロンプトに「必ず日本語で」「投稿文のみ出力」を明記
✅ maxOutputTokens は1500以上にしないと出力が途中で切れる
✅ Geminiの改行は replace(/\n/g, ' ') でスペースに変換してからX投稿
✅ HTMLサイトのパスワード認証はJSをindex.htmlに直接埋め込むのが最速
✅ Next.js + src/フォルダ構成ではmiddleware.jsはsrc/直下に置く
✅ Firebase iOS/Android設定ファイルは後回しにできる
```

---

# FAILURES_CANDIDATE

## 失敗パターン

```
❌ gemini-1.5-flash / gemini-2.0-flash は廃止済み → gemini-2.5-flash を使う
❌ APIキーをコードにハードコードすると環境変数変更が反映されない
❌ middleware.jsをHTMLサイト（Pages Router以外）に適用しようとしても動かない
❌ Next.js App RouterでloginフォルダとAPIのloginフォルダが競合するとビルドエラー
❌ Vercelの環境変数を変更してもRedeployしないと反映されない
❌ X APIの無料枠は月17〜20件 → テスト投稿で枠を使い切らないよう注意
❌ 特殊絵文字をJSテンプレートリテラルに入れるとビルドエラーになることがある
❌ maxOutputTokens: 200 は短すぎる（最低500以上、推奨1500）
❌ Geminiに短いプロンプトを渡すと英語で返ってくることがある
❌ FlutterFlowのTextFieldはフォントサイズを手入力できないことがある → テーマから選ぶ
```

---

# PATTERNS_CANDIDATE

## 再利用可能な設計

### Vercel Cron APIルートの基本構造

```javascript
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // 処理
  return Response.json({ success: true });
}
```

### vercel.json Cron設定（21:15 JST）

```json
{
  "crons": [
    { "path": "/api/post-daily", "schedule": "15 12 * * *" }
  ]
}
```

## 再利用可能な機能

### Gemini API呼び出し（外部ライブラリなし）

```javascript
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
  return data.candidates[0].content.parts[0].text.trim();
}
```

### HTMLサイトのパスワード保護

```javascript
(function() {
  const PASSWORD = 'your_password';
  const cookie = document.cookie.split(';').find(c => c.trim().startsWith('auth='));
  if (cookie && cookie.split('=')[1].trim() === PASSWORD) return;
  const pw = prompt('パスワードを入力してください');
  if (pw !== PASSWORD) {
    document.body.innerHTML = '<p style="color:white;text-align:center;padding:40px">アクセスが拒否されました</p>';
    return;
  }
  document.cookie = `auth=${PASSWORD};max-age=${60*60*24*30};path=/`;
})();
```

## 再利用可能なプロンプト

### SNS投稿生成プロンプトの基本構造

```
あなたは{accountName}のSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「{title}【{dateLabel}】」で必ず始めること
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 合計100文字以内で出力すること
- ハッシュタグN個を最後に
- 必ず日本語で出力すること
- 投稿文のみ出力（説明・前置き不要）

出力例：
{具体的な例文}
```

---

# BUSINESS_KNOWLEDGE

## 業務改善ノウハウ

```
1. テスト投稿はcurlで行い、X APIの月間枠を節約する
2. Gemini APIキーは用途別に分けて管理する（MIGORON用・DECODE用など）
3. 不要なAPIキーは定期的に削除する（セキュリティ対策）
4. Vercelの環境変数変更後は必ずRedeployする
5. GitHubのコミットメッセージは変更内容を明確に書く
6. 開発中のサイトはパスワード保護して公開状態を管理する
7. X APIの無料枠（月17〜20件）はテストで使い切らないよう注意
8. Cronジョブのスケジュールは UTC で設定する（JST = UTC+9）
```

## ドメイン知識

### 婚活・恋愛アプリ（DECODE）

```
- ターゲット：30代以上の婚活男性
- 差別化：LINEスクショ1枚でAI解析
- 特許範囲：スクショ検知→AI解析→OS通知の自動フロー
- IDデータ化：
  RT_ID: 返信速度（FAST/MID/SLOW）
  TM_ID: 送信時間（WORK/HOME/DEEP）
  BAL_ID: 文章量（MATCH/OVER/UNDER）
  EMO_ID: 絵文字（RICH/NONE/STAMP）
  HOST_ID: 主導権（USER/OPP/FLAT）
  BST_ID: 連投（YES/NO）
  TOP_ID: 話題（DATE/PRIVATE/DAILY）
  END_ID: 会話状態（OPEN/CLOSE）
```

### ミゴロン指数

```
- 花畑ミゴロン指数：開花状況から算出
- 雲海ミゴロン指数：湿度・気温・風速・露点から算出
- 富士山ミゴロン指数：雲量・降水確率・視界から算出
- 秩父補正ルール：
  - 保守的スコアリング（空振りペナルティ重視）
  - 前夜21時湿度85%未満→強制30%以下
  - 風速2m/s以上→1ランク下げ
  - 露点差2度以内→雲海の質を明記
  - 4〜5月雨上がり翌朝→+10%上方修正可
```

---

# AI_TIPS_CANDIDATE

## AI活用ノウハウ

### モデル選定

```
- 現行の正しいモデル名：gemini-2.5-flash
- 廃止済み：gemini-1.5-flash / gemini-2.0-flash
- 用途：投稿文生成・画像解析・JSON生成すべてgemini-2.5-flash
```

### プロンプト設計

```
- 「必ず日本語で」を明記しないと英語で返ってくる
- 「投稿文のみ出力」を明記しないと説明文が付く
- 「マークダウン不使用」を明記しないと**太字**が混入する
- 出力例を必ず入れると精度が上がる
- maxOutputTokens: 1500 以上を推奨
```

### Geminiの2段階生成パターン

```javascript
// Step1: Google検索で最新情報取得
tools: [{ google_search: {} }]

// Step2: 取得情報をJSON化
generationConfig: { responseMimeType: 'application/json' }
```

### コスト管理

```
- Gemini 2.5 Flash：ほぼ無料枠内で運用可能
- X API：月$5のpay-per-use（月100件まで）
- Vercel：無料枠でCron・Functionsが使える
- Instagram API：Meta Business API必須・プロアカウント必要
```

### デバッグ方法

```
1. curlでAPIエンドポイントを直接テスト
   curl -X GET "https://xxx.vercel.app/api/endpoint" \
     -H "Authorization: Bearer SECRET"

2. Vercel Logsで実行状況を確認

3. エラーメッセージのGeminiモデル名を確認

4. 環境変数の確認手順：
   Vercel → Settings → Environment Variables → Edit
```

---

## 引き継ぎ情報（最新・当時時点）

### Vercelプロジェクト

| プロジェクト | URL | 状態 |
|------------|-----|------|
| decode-app-fin | decode-app-fin.vercel.app | 稼働中・PW保護済み |
| konkatsu-jay | konkatsu-jay.vercel.app | ビルドエラー中 |
| motionimaging | motionimaging.vercel.app | 稼働中・X自動投稿 |

### GitHubリポジトリ

| リポジトリ | 構成 |
|-----------|------|
| motionimagingjp/decode-app | 静的HTML |
| motionimagingjp/konkatsu-jay | Next.js 14 App Router |
| motionimagingjp/motionimaging | Next.js App Router |

### 次にやること（当時時点）

```
1. FlutterFlow DECODEアプリのUI完成（ログイン・メイン・結果画面）
2. Apple Developer承認後にiOSビルド設定
3. ミゴロン指数にOpen-Meteo APIを接続（実気象データ化）
4. Instagram自動投稿の実装（Meta Business API）
5. konkatsu-jayのビルドエラー解消
```
