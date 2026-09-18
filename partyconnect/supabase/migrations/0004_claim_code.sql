-- 受付導線の確定。
--
-- 事前配布URL(session_token)を紛失した参加者と、当日の飛び込み参加者をどう受け付けるか。
-- 参加者に性別を自己申告させない方針(6-5)のため、掲示QRからの完全セルフ登録は採用しない。
--
-- 採用する導線:
--   1. 主催者が受付で参加者に6桁の引換コードを渡す（主催者画面に表示される）
--   2. 参加者は掲示QR(または4桁パスコード)で受付ページを開き、引換コードを入力する
--   3. 引換コードと交換に session_token を受け取り、そのままチェックインへ進む
-- 引換コードはイベント内で一意。総当たり対策として phase='checkin' の間のみ有効とし、
-- Edge Function 側で checkin_token 単位のレート制限をかける。

ALTER TABLE participants ADD COLUMN claim_code VARCHAR(6);
ALTER TABLE participants ADD CONSTRAINT unique_event_claim_code UNIQUE (event_id, claim_code);
COMMENT ON COLUMN participants.claim_code IS
    '受付で口頭・画面提示により参加者へ渡す引換コード。session_token と交換する';

-- issue_participant_slot に引換コードの発行を足す
CREATE OR REPLACE FUNCTION issue_participant_slot(
    p_event_id      UUID,
    p_gender        TEXT,
    p_session_token TEXT,
    p_is_proxy      BOOLEAN DEFAULT FALSE
) RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_participant participants;
    v_code        TEXT;
    v_attempt     INT := 0;
BEGIN
    IF p_gender NOT IN ('male','female') THEN
        RAISE EXCEPTION '性別は male / female のいずれかです' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND status IN ('draft','active')) THEN
        RAISE EXCEPTION '受付可能なイベントではありません' USING ERRCODE = '22023';
    END IF;

    LOOP
        v_attempt := v_attempt + 1;
        v_code := LPAD((FLOOR(RANDOM() * 1000000))::INT::TEXT, 6, '0');
        BEGIN
            INSERT INTO participants (event_id, gender, session_token, is_proxy, claim_code)
            VALUES (p_event_id, p_gender, p_session_token, p_is_proxy, v_code)
            RETURNING * INTO v_participant;
            RETURN v_participant;
        EXCEPTION WHEN unique_violation THEN
            -- 引換コードの衝突なら引き直す。session_token の衝突なら諦める
            IF v_attempt >= 20 THEN
                RAISE EXCEPTION '引換コードを発行できませんでした';
            END IF;
        END;
    END LOOP;
END;
$$;

-- 引換コードと session_token を交換する。phase='checkin' の間だけ有効
CREATE FUNCTION claim_session(p_checkin_token TEXT, p_claim_code TEXT)
RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_event_id    UUID;
    v_participant participants;
BEGIN
    SELECT e.id INTO v_event_id
      FROM events e
      JOIN event_states s ON s.event_id = e.id
     WHERE e.checkin_token = p_checkin_token
       AND e.status = 'active'
       AND s.phase = 'checkin';
    IF NOT FOUND THEN
        RAISE EXCEPTION '現在は受付時間ではありません' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_participant
      FROM participants
     WHERE event_id = v_event_id AND claim_code = p_claim_code AND status <> 'withdrawn';
    IF NOT FOUND THEN
        RAISE EXCEPTION '引換コードが見つかりません' USING ERRCODE = '42501';
    END IF;

    RETURN v_participant;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_session(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_session(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION issue_participant_slot(UUID, TEXT, TEXT, BOOLEAN) TO service_role;
