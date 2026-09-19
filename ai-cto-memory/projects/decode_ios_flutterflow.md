# PROJECT_SUMMARY

## プロジェクト名: DECODE iOSアプリ（FlutterFlow版）

**目的:** Web版DECODEをFlutterFlow+FirebaseでiOSアプリ化

**対象ユーザー:** 恋愛・婚活相談をしたいユーザー（クローズド・パスワード制）

**作成した機能:**
- LoginPage（パスワード入力・Enterボタン・MainPageへの遷移）
- MainPage（アドバイザー選択DropDown・相談入力TextField・Sendボタン・回答表示エリア）
- Gemini API呼び出し設定（GeminiChat API Call）

**技術スタック:** FlutterFlow / Firebase / Gemini 2.5 Flash API

**アーキテクチャ概要:**
- LoginPage → パスワード入力 → MainPage遷移
- MainPage → DropDown（サキ/レン/ジェイ）→ TextField入力 → Gemini API呼び出し → 回答表示

**達成した成果:**
- LoginPageのUI完成（黒背景・DECODEタイトル・Password・Enterボタン赤）
- MainPageのUI基本完成（DropDown・TextField・Sendボタン）
- Gemini API Call登録完了（GeminiChat）
- Action Flow EditorでAPI呼び出しの骨格設定完了

**成功事例:**
- DropDownでアドバイザー3人（サキ/レン/ジェイ）を実装→ボタン3つより効率的
- Spacer・Container等FlutterFlowの制約を回避しながらレイアウト調整
- Gemini API CallをFlutterFlowに登録成功

**失敗事例:**
- 数値の手入力が多くの箇所でできない（Padding・Color等）→スライダーや選択式のみ
- ButtonをColumnの外に誤配置→ドラッグ移動不可→削除して再作成が必要
- 条件分岐（Conditional）が無料プランでは使用不可
- Update Page Stateがグレーアウト→無料プラン制限の可能性
- Spacerを追加したらボタンが画面最下部に→Space Betweenで代替

**技術選定理由:**
- FlutterFlow：コードなしでiOSアプリ開発可能
- Gemini 2.5 Flash：既存WebサイトでもGemini使用中・コスト効率良好
- Firebase：FlutterFlowとの親和性が高い

**次回改善点:**
- FlutterFlowの有料プランが必要か確認（条件分岐・State更新の制限解消）
- ResponseTextをTextFieldに変更してSet Form Fieldで回答表示する方法を試す
- パスワード認証をFirebase Authenticationで実装
- アドバイザーごとのシステムプロンプトをGemini APIに渡す実装

> 注記: このFlutterFlow版iOSアプリ化は、無料プランの制約（State Management・数値手入力不可）により後に頓挫し、DECODE v2ではNext.js＋Capacitor方式の検討に方針転換された（decode_v2_nextjs_handover.md参照）。

---

# LESSONS_CANDIDATE

**成功パターン:**
- ボタン3つ横並びよりDropDownの方がスマホUIとして実装が速い
- FlutterFlowでは「削除して再作成」がドラッグ移動より確実
- API CallのBody JSONに`[variableName]`形式で変数を埋め込める
- ヘッダーのContent-Typeは実際に入力欄をクリックして値を入れる必要がある（プレースホルダーに注意）
- Gemini APIキーはURLの末尾に`?key=XXXXX`で付加する

---

# FAILURES_CANDIDATE

**失敗パターン:**
- FlutterFlowの数値入力欄は多くの場所で手入力不可→変数設定ポップアップが開く
- WidgetをドラッグでWidget Tree内移動は不安定→削除＆再作成を推奨
- 検索フィルターを入れたままWidget Treeを見るとButtonが見えない
- Spacerは挿入位置によってレイアウトが大きく崩れる
- 無料プランでは条件分岐・State更新等が制限される可能性あり

---

# PATTERNS_CANDIDATE

**再利用可能な設計:**
- パスワード制ログイン画面：LoginPage（黒背景・タイトル・PasswordField・Button）
- AI相談アプリの基本構成：DropDown（キャラ選択）+ TextField（入力）+ Button（送信）+ Text（回答表示）

**再利用可能な機能:**
- Gemini API Call設定（POST・JSON Body・userMessage変数）
- Action Flow：Backend Call → Conditional → TRUE/FALSE分岐

**再利用可能なプロンプト:**

Gemini API Body:
```json
{
  "contents": [{
    "parts": [{
      "text": "[userMessage]"
    }]
  }]
}
```

---

# BUSINESS_KNOWLEDGE

**業務改善ノウハウ:**
- Apple/Google審査を意識してアプリ内用語を「Counselor」→「Advisor」に変更
- パスワード認証はシンプルに直接設定（後でFirebase Authに移行）
- UIの細かい調整より機能実装を優先する判断が重要

**ドメイン知識:**
- DECODEは恋愛・婚活AI相談室（サキ・レン・ジェイの3アドバイザー）
- Apple審査では「カウンセリング」的な表現に注意が必要

---

# AI_TIPS_CANDIDATE

**AI活用ノウハウ:**
- FlutterFlow操作はスクリーンショットを都度送ってもらい現状確認してから指示する
- 手入力できない制約が多いため、操作前に「手入力できるか」を確認してから指示する
- 複雑な実装より「シンプルな代替案」を早めに提示する（DropDown vs ボタン3つ等）
- FlutterFlowの制限に当たったら有料プランの必要性を早めに確認する
- Widget Tree検索フィルターが残っていると目的のWidgetが見えないことがある→検索クリアを先に指示する
