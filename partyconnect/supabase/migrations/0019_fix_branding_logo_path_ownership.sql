-- セキュリティレビューでの指摘: update_organizer_branding が p_logo_path の所有者チェックをしていなかった。
--
-- Storage側（organizer-logos バケットのRLS）はアップロード・更新を本人フォルダ配下に正しく制限しているが、
-- このRPCは「表示用に参照するパス」を文字列としてそのまま受け取って保存するだけだったため、
-- 他人のUUIDフォルダのパスを（推測等で）指定すれば、自分の受付画面にその人のロゴを
-- 表示させることができてしまっていた（ロゴ自体は公開読み取りのため情報漏えいにはならないが、
-- 他人のロゴを無断で自分のブランドとして表示できる、なりすまし・改ざんに近い抜け）。
-- 自分のUUID配下のパス以外を拒否するよう修正する。

CREATE OR REPLACE FUNCTION update_organizer_branding(
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
    IF p_logo_path IS NOT NULL AND p_logo_path NOT LIKE (v_id::TEXT || '/%') THEN
        RAISE EXCEPTION '自分がアップロードしたロゴのみ設定できます' USING ERRCODE = '42501';
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
