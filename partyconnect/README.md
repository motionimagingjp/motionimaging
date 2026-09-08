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
supabase/
  migrations/
    0001_init.sql   スキーマ
    0002_rls.sql    RLS・GRANT剥奪（デフォルト拒否）
    0003_rpc.sql    トランザクションを要する操作（採番・確定・消去）
  functions/
    _shared/
      matching.ts        最大重み二部マッチング（相互指名のみ・seedで再現性あり）
      contact-filter.ts  連絡先記入のブロック
tests/
  matching.test.ts       アルゴリズムの単体テスト
  contact-filter.test.ts フィルタの単体テスト
  sql/
    00_supabase_shim.sql ローカル検証用の Supabase 相当環境（マイグレーションではない）
    10_security.test.sql RLS・RPC の挙動テスト
scripts/test-sql.sh      ローカル postgres を立ててSQLテストを実行
```

## テスト

```bash
npm test          # 単体テスト + SQLテスト
npm run test:unit # TypeScript のみ（node 22 の型ストリッピングを使うのでビルド不要）
npm run test:sql  # ローカル postgres でマイグレーションとRLSを検証（要 postgresql-16）
```

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
