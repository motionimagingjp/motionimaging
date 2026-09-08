-- 主催者レコードの作成。
-- organizers への INSERT は anon/authenticated から剥奪してあるため、ここを通す。
-- SMS認証（仕様 8章）は Supabase の電話番号認証で行い、is_phone_verified はその結果で更新する。
-- 1電話番号につき初回無料は1回だけなので、phone_number の UNIQUE 制約が実質的な砦になる。

CREATE FUNCTION ensure_organizer(p_phone_number TEXT)
RETURNS organizers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id    UUID := auth.uid();
    v_email TEXT;
    v_row   organizers;
BEGIN
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM organizers WHERE id = v_id;
    IF FOUND THEN
        RETURN v_row;
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_id;

    INSERT INTO organizers (id, email, phone_number)
    VALUES (v_id, COALESCE(v_email, v_id::TEXT), p_phone_number)
    RETURNING * INTO v_row;

    RETURN v_row;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'この電話番号は既に登録されています' USING ERRCODE = '22023';
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_organizer(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ensure_organizer(TEXT) TO authenticated;
