-- 参加者の写真（顔でなくてもよい。会話のきっかけ用）。
-- 非公開バケットにし、アップロード・閲覧は必ず署名付きURL経由(service_role)で行う。
-- パスは `${event_id}/${participant_id}` に固定し、確認用の追加カラムは持たない
-- （閲覧側は署名URL発行を試みて、存在しなければ「写真なし」として扱う）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('participant-photos', 'participant-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- purge_due_events は消去したイベントIDを返すようにする。
-- Edge Function 側でこのIDを使って、消去されたイベントの写真をStorageからも削除するため。
DROP FUNCTION IF EXISTS purge_due_events();
CREATE FUNCTION purge_due_events() RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id  UUID;
    v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    FOR v_id IN
        SELECT e.id FROM events e
         WHERE e.status = 'finished'
           AND e.finished_at < NOW() - INTERVAL '30 minutes'
           AND EXISTS (SELECT 1 FROM event_analytics a WHERE a.event_id = e.id)
    LOOP
        PERFORM purge_event(v_id, FALSE);
        v_ids := array_append(v_ids, v_id);
    END LOOP;
    RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_due_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_due_events() TO service_role;
