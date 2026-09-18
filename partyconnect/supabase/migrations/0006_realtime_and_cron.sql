-- Realtime と定期実行の設定。
-- どちらも「設定し忘れると本番でだけ静かに壊れる」種類のものなので、マイグレーションに含める。

-- 1) 一斉キックの配信。event_states を Realtime のパブリケーションに載せる。
--    これを忘れると、参加者の画面がフェーズ変更で切り替わらない（ポーリングだけが頼りになる）。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_states'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.event_states;
        END IF;
    ELSE
        RAISE NOTICE 'supabase_realtime パブリケーションがないため Realtime の設定をスキップしました（ローカル検証時は正常）';
    END IF;
END
$$;

-- 参加者に配信されるのは phase と更新時刻だけ。個人情報は載らない
COMMENT ON TABLE event_states IS
    'Realtime配信対象。個人情報を絶対に足さないこと。参加者(anon)がSELECTできる唯一のテーブル';

-- 2) 30分後の自動消去。pg_cron から purge_due_events() を毎分呼ぶ。
--    HTTP を経由しないので、Edge Function の起動失敗やネットワーク断の影響を受けない。
--    ※ Supabase ダッシュボードの Database > Extensions で pg_cron を有効化しておくこと。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('partyconnect-purge')
          WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'partyconnect-purge');
        PERFORM cron.schedule('partyconnect-purge', '* * * * *', 'SELECT purge_due_events();');
    ELSE
        RAISE NOTICE 'pg_cron が未有効のため定期消去を登録しませんでした。ダッシュボードで有効化して再実行すること';
    END IF;
END
$$;
