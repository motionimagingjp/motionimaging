# CLAUDE.md

Claude Code 向けの運用メモ。仕様・アーキテクチャは [README.md](./README.md)、
デプロイ手順は [DEPLOY.md](./DEPLOY.md) を参照。ここには「毎回踏みがちな落とし穴」と
「セッションをまたいで要る情報」だけを書く。重複する内容はそちらを正とする。

## 本番環境

- アプリ: https://scad-partyconnect.vercel.app/
  （旧ドメイン `partyconnect-kappa.vercel.app` も同じVercelプロジェクトのエイリアスとして残存）
- Supabase project_id: `pnetjlfxzzyrlkgyredv`
- Vercel project: `partyconnect`（team: motionimagingjps-projects）
- main ブランチへ直接push する運用（PRを経由しない）

## 絶対に壊してはいけないもの

1. **`supabase/functions/_shared/matching.ts` の `computeMatching`（既定のマッチングアルゴリズム）。**
   1行も変更しない。新しい方式が必要なときは `computeGreedyMatching` のように独立した別関数として
   追加し、`runMatching` のディスパッチに分岐を足すだけにする。
2. README.mdの「設計上、絶対に崩してはいけない3点」（連絡先を保持・表示・仲介しない／統計は
   結果配信より前に確定させる／削除の入口は`purge_event`一本）。
3. **マッチングは絶対に間違えてはいけない機能。** アルゴリズムやその周辺（チェックイン時刻の
   タイブレーク等）を変更したら、本番適用前に必ずスクラッチパッドのDeno単体スクリプトで
   「既定経路（max_pairs）の出力が変更前とbyte-identicalであること」を確認してから出す。

## DBマイグレーションで必ずやること

- `CREATE OR REPLACE FUNCTION` で**引数の数や型を変える**と、PostgreSQLは既存関数を置き換えず
  「別のオーバーロードを追加」するだけになる。PostgRESTのRPC解決が混乱し、
  原因不明の「◯◯に失敗しました」エラーになる（実際に`create_event`で発生した）。
  シグネチャが変わる変更では、**同じマイグレーション内で旧シグネチャを明示的に`DROP FUNCTION`**
  してから`CREATE FUNCTION`すること。
- 適用後は `pg_proc` でその関数のオーバーロードが1つだけになっているか確認する。
- `SECURITY DEFINER`関数を新設したら、`has_function_privilege('anon', oid, 'EXECUTE')` 等で
  意図しない権限が開いていないか確認する。参加者から直接呼ばれてよいRPC以外は
  `anon`/`authenticated`からの実行権限を与えない（Edge Functionのservice_role経由のみにする）。
- 他人のリソースを指す文字列（Storageパスなど）を保存するRPCは、所有者チェックを忘れずに入れる
  （`update_organizer_branding`で一度抜けていた）。

## Edge Function デプロイ（Supabase MCPの`deploy_edge_function`経由）

- バンドル後、`index.ts`はpayload内でルート直下に置かれる。ソースの`../_shared/xxx.ts`という
  importはすべて`./_shared/xxx.ts`に書き換えてから渡すこと。
- 既存関数を再デプロイする際、`import_map_path`を省略すると
  `import map path does not exist`エラーになることがある。その場合は明示的に
  `import_map_path: "deno.json"`を渡すと通る。
- デプロイ後は`list_edge_functions`でバージョン番号が上がっているか、`get_edge_function`で
  実際に反映された内容が意図通りかを確認する。

## QA・検証の流儀

- `qa/*.ts`はDeno向けテストスクリプト。新規追加したら`tsconfig.json`の`exclude`にも追記しないと
  `next build`が型エラーで落ちる。
- UIの見た目を確認する必要があるときは、架空データでAPI応答をモックしたPlaywrightスクリプトで
  実物のビルド（`next build && next start`、ポート衝突に注意）に対してスクリーンショットを撮って
  確認する。スクラッチパッドに置き、リポジトリにはコミットしない。
- 本番DBで動作確認が必要な場合は、`DO $$ ... RAISE EXCEPTION 'RESULT: %', v_out; END $$;`の
  パターンでトランザクションを必ずロールバックさせながら検証する（テストデータを残さない）。

## 主な機能（2026-09時点）

README.mdの構成に加えて、このセッションで以下を追加済み：

- **受付のみモード**（`events.event_mode = 'checkin_only'`）：マッチングを使わず受付・人数管理だけを
  無料で使えるプラン。性別を聞かず`gender='none'`の通し番号で受付する。投票フェーズ・マッチング確定は
  DB側（`set_event_phase`/`finalize_event_commit`）でも拒否しており、画面の出し分けだけに頼っていない。
- **主催者のブランド設定**（会社名・ロゴ・イメージカラー）：`organizers.company_name/brand_color/logo_path`。
  ロゴは公開Storageバケット`organizer-logos`（本人フォルダ配下にのみ書き込み可）。
- `/terms` に利用規約ページ（無償提供前提の全部免責。弁護士レビュー前の草案である旨を明記）。
- `docs/monetization-memo.md` に収益化アイディア（クレジット制・不正防止・課金方法）のメモ。実装は未着手。
