-- ローカル検証専用の Supabase 相当環境。マイグレーションには含めない。
-- 本番の Supabase では auth スキーマ・ロール・既定 GRANT が最初から存在する。
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);

-- ロールはクラスタ共通なので、再実行できるようにしておく
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Supabase と同じく、以降 public に作られるテーブルへ既定で全権限を付与する。
-- この既定があるからこそ 0002_rls.sql の REVOKE が必要になる。
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$$;
