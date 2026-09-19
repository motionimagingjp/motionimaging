-- イベントごとのプロフィール項目の使う/使わない設定。
-- 選択肢の中身は固定（アプリ側で管理）で、主催者が変えられるのは項目の有効/無効だけ。
-- NULL は「全項目使用」を意味する（デフォルト）。
ALTER TABLE events ADD COLUMN profile_field_keys TEXT[];

CREATE FUNCTION set_event_profile_fields(p_event_id UUID, p_field_keys TEXT[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
BEGIN
    IF v_organizer IS NULL THEN
        RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
    END IF;
    UPDATE events SET profile_field_keys = p_field_keys
     WHERE id = p_event_id AND organizer_id = v_organizer;
    IF NOT FOUND THEN
        RAISE EXCEPTION '権限がありません' USING ERRCODE = '42501';
    END IF;
END;
$$;
