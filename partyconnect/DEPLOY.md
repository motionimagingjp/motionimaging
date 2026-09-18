# デプロイ手順と注意点

Vercel（フロント）と Supabase（DB・Edge Function）に分けて構築する。
**順序が重要**で、Supabase を先に完成させないとフロントは何も動かない。

---

## 0. 事前に必ず確認すること

### 環境変数をどちらに置くかを間違えないこと（最重要）

| 変数 | 置き場所 | 理由 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | 公開して問題ない |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | 公開前提のキー。RLSがデフォルト拒否なので単体では何も読めない |
| `SUPABASE_SERVICE_ROLE_KEY` | **Supabase Edge Function のみ** | **RLSを完全にバイパスする。Vercel に置いてはいけない** |
| `CRON_SECRET` | Supabase Edge Function のみ | 消去エンドポイントの保護 |
| `ALLOWED_ORIGIN` | Supabase Edge Function のみ | CORS。本番ドメインを入れる |

`SUPABASE_SERVICE_ROLE_KEY` を Vercel に置くと、`NEXT_PUBLIC_` を付けなくても
サーバーコンポーネント経由で漏れる経路ができる。本プロジェクトはフロントから
service_role を一切使わない設計なので、**Vercel には置かない**。

---

## 1. Supabase

```bash
supabase link --project-ref <project-ref>
supabase db push          # supabase/migrations/*.sql を番号順に適用
```

### 1-1. pg_cron を有効化する

ダッシュボード > Database > Extensions で `pg_cron` を ON にしてから、
`0006_realtime_and_cron.sql` を**もう一度**流す。
拡張が無い状態では定期消去の登録がスキップされ、`NOTICE` が出るだけで失敗しない
（気づきにくいので、適用後に確認する）。

```sql
-- 登録されたか確認
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'partyconnect-purge';
```

30分後の自動消去は HTTP を経由せず `SELECT purge_due_events();` を直接叩く。
Edge Function の起動失敗やネットワーク断の影響を受けないので、こちらを正とする。
`purge` Edge Function の Cron 経路は予備。

### 1-2. Realtime を確認する

一斉キックが届かないと会場全体が止まる。ここは必ず目視確認する。

```sql
-- event_states がパブリケーションに載っているか
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
```

`event_states` が出てこない場合は Realtime が飛ばない。`0006` を再適用する。

確認すべき点は3つ。
1. `event_states` が `supabase_realtime` パブリケーションに含まれている
2. `anon` に SELECT ポリシーがある（`0002_rls.sql` の `event_states_public_read`）。
   RLS が有効なテーブルは、購読者ごとにポリシーが評価される。読めないと配信もされない
3. ダッシュボード > Database > Replication で Realtime が有効

なお、フロントは Realtime が張れなくても **10秒ポーリングで動き続ける**（`lib/phase.ts`）。
Realtime が死んでいても会場が止まらないようにしてあるが、
体感の遅れは出るので「動いているから設定できている」とは判断しないこと。

### 1-3. Edge Function をデプロイする

```bash
supabase functions deploy checkin save_profile list_participants \
    submit_vote get_result finalize_event purge organizer

supabase secrets set \
    ALLOWED_ORIGIN=https://<本番ドメイン> \
    CRON_SECRET=$(openssl rand -hex 32)
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` は
Supabase が自動で注入するので、手で設定しない。

### 1-4. 認証設定

- Authentication > URL Configuration の Site URL に Vercel の本番URLを入れる
  （マジックリンクのリダイレクト先。ここが未設定だと主催者がログインできない）

---

## 2. Vercel

### 2-1. Root Directory

**モノレポのまま運用する場合は、Root Directory に `partyconnect` を指定する。**
指定しないとリポジトリ直下の別アプリ（SNS自動投稿）がビルドされる。

リポジトリ直下の `.vercelignore` は、**既存のSNS自動投稿アプリのプロジェクト**が
`partyconnect/` を巻き込まないためのもの。PartyConnect 側のプロジェクトには
`partyconnect/.vercelignore` を置かない（置くと自分自身を除外してしまう）。

独立リポジトリへ切り出した場合は Root Directory の指定は不要。

### 2-2. ビルド設定

| 項目 | 値 |
|---|---|
| Framework Preset | Next.js |
| Node.js Version | 22.x |
| Build Command | `next build`（既定のまま） |
| Install Command | `npm install`（既定のまま） |

### 2-3. ビルドで実際に踏んだ落とし穴

構築時に遭遇して対処済みの項目。**設定を戻すと再発する**ので、変更しないこと。

1. **TypeScript は `^6` に固定してある。**
   TypeScript 7 は Next.js 15 が必要とする JS コンパイラAPIを持っておらず、
   型チェック段階で `TypeScript 7.0.2 is not supported by this version of Next.js` で落ちる。
   `npm install typescript@latest` を実行すると壊れる。上げるなら Next.js 16.2.11 以降とセットで。

2. **`tsconfig.json` の `exclude` に `supabase` と `tests` が入っている。**
   `supabase/functions/**` は Deno 用のコードで `Deno.serve` などNode/Nextに存在しない
   グローバルを使う。`tests/**` は `node:test` を使う。除外を外すと `next build` が型エラーで落ちる。

3. **パスエイリアス（`@/`）は使っていない。**
   TypeScript 6 で `baseUrl` が廃止され、Next のエイリアス解決と噛み合わなくなったため、
   相対パスに統一した。`@/` を再導入しないこと。

4. **`css.d.ts` が必要。**
   TypeScript 6 は副作用インポートにも型を要求するため、`declare module '*.css';` が無いと
   `app/layout.tsx` の `import './globals.css'` で落ちる。
   `next-env.d.ts` は自動生成で上書きされるので、宣言は `css.d.ts` 側に置いてある。

### 2-4. 環境変数

Production / Preview の両方に設定する。
`NEXT_PUBLIC_` 付きの2つだけを入れ、service_role は入れない（冒頭の表を参照）。

---

## 3. デプロイ後の動作確認（デモモードで一人で完走できる）

1. `/organizer` でメールログイン
2. 電話番号を入れて「デモイベントを作成」
3. イベントを開き「ダミー参加者20名を投入」
   → 20名が受付済みになり、最終希望とlikeの投票も自動で入る
4. 「⑤ 最終希望の受付開始」→「⑥ 確定して結果を配信」
   → 成立ペアが番号の組で表示される
5. 「⑦ データを今すぐ消去」→ 参加者データが消え、統計だけが残ることを確認

参加者側の確認は、参加者一覧に出る**受付コード**を使う。
`/e/<掲示用トークン>` を開いて6桁を入力すると、その参加者として全画面を通せる。
掲示用URLはイベント画面に表示される。

### 確認すべきポイント

- [ ] 受付直後に「男性 No.5」が特大表示される
- [ ] 別端末で「④ 好印象を開示」を押した瞬間に、参加者画面へ★が反映される（Realtime）
- [ ] 好印象が0件の参加者に「0件」と表示されない（中立メッセージになる）
- [ ] 自由記述に `LINE: taro1234` を入れると保存が拒否される
- [ ] 成立画面に連絡先が一切表示されない（番号とニックネームのみ）
- [ ] 消去後、主催者の統計（成立率・属性分布）は残っている

---

## 4. 独立リポジトリへの切り出し

`scripts/split-repo.sh` が `partyconnect/` の履歴だけを持つリポジトリを作る。

```bash
# リポジトリのルートで実行する
bash partyconnect/scripts/split-repo.sh /tmp/partyconnect-standalone
cd /tmp/partyconnect-standalone
git remote add origin git@github.com:<owner>/partyconnect.git
git push -u origin main
```

切り出したあと、`README.md` が参照している仕様書へのパス
（`../docs/partyconnect_requirements.md`）が切れる。スクリプトは仕様書を
`docs/requirements.md` としてコピーし、リンクを張り替える。
