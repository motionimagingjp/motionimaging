-- create_event のオーバーロード乱立を解消する。
--
-- 0003(3引数) -> 0012(5引数) -> 0015(6引数) と、CREATE OR REPLACE のたびに
-- 引数の数を増やしてきたが、PostgreSQLの関数識別は「名前+引数の型列」で行われるため、
-- 引数の数が変わる CREATE OR REPLACE は既存の関数を置き換えず「別関数を追加」してしまう。
-- 結果として create_event が3つのオーバーロードとして共存しており、これが原因で
-- PostgRESTのRPC呼び出し（マッチング方式セグメントコントロール追加後）が
-- 「作成に失敗しました」で失敗する不具合が発生した。
--
-- 現在フロントエンドが呼ぶのは6引数版（0015）だけなので、古い2つを削除する。
DROP FUNCTION IF EXISTS public.create_event(text, date, boolean);
DROP FUNCTION IF EXISTS public.create_event(text, date, boolean, text, text);

-- PostgRESTのスキーマキャッシュを明示的に更新する。
-- Supabaseは通常DDL完了時に自動でNOTIFYするが、念のため明示しておく。
NOTIFY pgrst, 'reload schema';
