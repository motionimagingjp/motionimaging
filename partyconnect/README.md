# PartyConnect

街コンの受付〜マッチング〜データ消去までを完結させる主催者向け進行システム。

- 仕様: [`../docs/partyconnect_requirements.md`](../docs/partyconnect_requirements.md)
- このディレクトリは自己完結しており、そのまま独立リポジトリへ移せる構成になっている

## 設計上、絶対に崩してはいけない3点

1. **連絡先を保持・表示・仲介しない。**
   `participants` に連絡先カラムを作らない。成立ペアには参加者番号とニックネームのみを返す。
   自由記述への連絡先記入は `_shared/contact-filter.ts` でサーバ側ブロックする。(仕様 11-1)
2. **統計は結果配信より前に確定させる。**
   `finalize_event_commit` が「マッチ書き込み → 統計書き込み → phase=result」を同一トランザクションで行う。
   削除バッチ側で集計しようとすると統計が空になる。(仕様 6-2)
3. **削除の入口は `purge_event` 一本。**
   Cron も主催者の手動キックもここを通す。`event_analytics` の存在を確認できない限り削除しない。(仕様 12-5)

## 構成

```
app/                     Next.js App Router（PWA）
  page.tsx               トップ
  join/                  参加者アプリ（?t=session_token）
  e/[checkinToken]/      掲示QRからの受付（6桁の受付コード入力）
  organizer/             主催者コンソール
components/              参加者画面のUI
lib/
  api.ts                 Edge Function クライアント
  phase.ts               一斉キックの受信（Realtime + 10秒ポーリングの二重化）
  storage.ts             セッションと入力の端末保存（電波断でも消えない）
supabase/
  migrations/
    0001_init.sql   スキーマ
    0002_rls.sql    RLS・GRANT剥奪（デフォルト拒否）
    0003_rpc.sql    トランザクションを要する操作（採番・確定・消去）
  functions/
    _shared/
    functions/
      _shared/           純粋ロジック（Nodeでテスト可能にするため Deno API に依存させない）
      checkin/           受付・引換コードとの交換・番号の採番
      save_profile/      プロフィール保存（連絡先ブロック・性別は変更不可）
      list_participants/ 閲覧一覧（参加者IDは返さない。★は開示フェーズ以降のみ）
      submit_vote/       好印象・最終希望の投票（投稿者はトークンから解決）
      get_result/        結果（成立時も番号とニックネームのみ）
      finalize_event/    確定（マッチング→統計→配信）
      purge/             消去（Cron一括・主催者の手動キック）
      organizer/         進捗・枠発行・名簿・辞退・成立ペア・デモ投入
tests/
  matching.test.ts       アルゴリズムの単体テスト
  contact-filter.test.ts フィルタの単体テスト
  crypto.test.ts         自由記述の暗号化
  analytics.test.ts      統計の集計と少人数カテゴリの丸め
  sql/
    00_supabase_shim.sql ローカル検証用の Supabase 相当環境（マイグレーションではない）
    10_security.test.sql RLS・RPC の挙動テスト
scripts/test-sql.sh      ローカル postgres を立ててSQLテストを実行
```

## 開発

```bash
cp .env.example .env.local   # Supabase の URL と anon key を入れる
npm run dev
```

デプロイ手順と、ビルドで実際に踏んだ落とし穴は [DEPLOY.md](./DEPLOY.md) にまとめてある。

## テスト

```bash
npm test               # 全部
npm run test:unit      # 純粋ロジックの単体テスト（node 22 の型ストリッピングを使うのでビルド不要）
npm run test:functions # Edge Function の型チェックと lint（要 deno）
npm run test:sql       # ローカル postgres でマイグレーションとRLSを検証（要 postgresql-16）
```

## 受付の導線（実装時に確定）

参加者に性別を自己申告させない方針（仕様 6-5）のため、掲示QRからの完全セルフ登録は採用していない。

1. 主催者が受付で参加者に **6桁の引換コード** を渡す（主催者画面に表示される）
2. 参加者は掲示QR（または4桁パスコード）で受付ページを開き、引換コードを入力する
3. 引換コードと交換に `session_token` を受け取り、そのままチェックインへ進む

事前配布URLを受け取っている参加者は、URLに含まれる `session_token` でそのまま2をスキップできる。
引換コードは `phase='checkin'` の間だけ有効で、Edge Function 側でイベント単位のレート制限をかけている。

## 権限モデル

| ロール | できること |
|---|---|
| `anon`（参加者） | `event_states` の SELECT だけ。それ以外は全テーブル・全RPCが拒否される |
| `authenticated`（主催者） | 自分の `events` / `event_analytics` / `organizers` / 監査ログの SELECT と、`create_event` / `set_event_phase` の実行のみ |
| `service_role`（Edge Function） | 全て。参加者の操作は必ずここを経由する |

主催者であっても `participants` / `votes` を直接は読めない。誰が誰に投票したかは Edge Function が集計した結果しか返さない。

## 既知の制約（実装前に判断が必要）

**`event_keys` はまだ真の crypto-shredding になっていない。**
イベント別のデータ鍵を暗号文と同じ PostgreSQL に置いているため、「DBのバックアップを丸ごと復元する」経路に対しては鍵破棄が効かない。
実際に「復元不可能」と訴求するなら、鍵ストアを DB 外（KMS または外部KV）へ移す必要がある。
`purge_event` は鍵行を削除しており、移行先を差し替えるだけで済むようにはしてある。
当面は PITR 無効・日次バックアップ7日保持（仕様 7-4）と、プライバシーポリシーへの正確な記載で運用する。
