-- 主催者ブランディング（会社名・ロゴ・イメージカラー）
--
-- 顧客ごとのカスタム要望（企業ロゴ・会社名・イメージカラーの表示）を、
-- コードを分岐させたり別デプロイを作ったりせず「設定データ」として吸収する。
-- マッチングロジック等の中核機能には一切触れない。

ALTER TABLE organizers ADD COLUMN company_name TEXT;
ALTER TABLE organizers ADD COLUMN brand_color TEXT;
ALTER TABLE organizers ADD COLUMN logo_path TEXT;

ALTER TABLE organizers ADD CONSTRAINT organizers_brand_color_check
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');

-- ロゴ画像用の公開バケット。
-- participant-photos と違いロゴは機密情報ではなく、受付画面等で直接<img>表示するため、
-- 署名付きURLではなく公開URLにする。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('organizer-logos', 'organizer-logos', TRUE, 2097152,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 自分の主催者ID配下のパスにのみ書き込める。読み取りは公開（参加者側が表示するため）。
CREATE POLICY organizer_logo_owner_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'organizer-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY organizer_logo_owner_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'organizer-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY organizer_logo_public_read ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'organizer-logos');

-- organizers への直接UPDATEはRLSで禁止されているため、自分の行だけを更新するRPCを用意する。
-- ensure_organizer と同じく auth.uid() で本人確認する。
CREATE FUNCTION update_organizer_branding(
    p_company_name TEXT DEFAULT NULL,
    p_brand_color  TEXT DEFAULT NULL,
    p_logo_path    TEXT DEFAULT NULL
) RETURNS organizers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id  UUID := auth.uid();
    v_row organizers;
BEGIN
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
    END IF;
    IF p_brand_color IS NOT NULL AND p_brand_color !~ '^#[0-9a-fA-F]{6}$' THEN
        RAISE EXCEPTION 'カラーコードの形式が正しくありません（例: #E63946）' USING ERRCODE = '22023';
    END IF;

    UPDATE organizers SET
        company_name = p_company_name,
        brand_color  = p_brand_color,
        logo_path    = p_logo_path
    WHERE id = v_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION '主催者情報が見つかりません。先にイベント作成画面で電話番号を登録してください'
            USING ERRCODE = '22023';
    END IF;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_organizer_branding(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_organizer_branding(TEXT, TEXT, TEXT) TO authenticated;
