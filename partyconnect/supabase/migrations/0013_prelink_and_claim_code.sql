-- 事前リンクのイベント共通化と、受付コードの構造化。
--
-- 1. 事前リンク(prelink_token)をイベントに1本だけ持たせる
--    これまでは参加者1人ずつに /join?t=<session_token> を送る必要があり、案内メールの
--    作成が人数分の手作業になっていた。今後は「イベント共通の事前リンク + 本人の受付コード」
--    でプロフィール入力画面に入れる。案内文はテンプレート1本で済む。
--
--    ★prelink_token はチェックイン(出席登録・採番)の権限を持たない。
--      チェックインできるのは会場に掲示した checkin_token の経路だけ、という原則は変えない。
--      会場でしか見られないQRを読めたことが「本当に来場した」根拠になっている。
--
-- 2. 受付コードを [性別1桁][登録順2桁][ランダム4桁] の7桁にする
--    例: 1010473 = 男性・登録1番目 / 2030912 = 女性・登録3番目
--    主催者が口頭で聞き取るとき、先頭3桁で男女と登録順が分かるため名簿と照合しやすい。
--    ランダム部は3桁→4桁に増やして総当たりの成功率を1/10にしている
--    （先頭3桁は推測可能なため、ランダム部の桁数がそのまま強度になる）。
--    既存の6桁コードはそのまま有効。発行済みのイベントを作り直す必要はない。

-- ---------------------------------------------------------------------------
-- 1. 事前リンク用トークン
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN prelink_token TEXT;

-- 既存イベントにも必ず1本用意する。NULL のままだと過去のイベントで事前リンクが使えない
UPDATE events SET prelink_token = ENCODE(extensions.gen_random_bytes(24), 'hex')
 WHERE prelink_token IS NULL;

ALTER TABLE events ALTER COLUMN prelink_token SET NOT NULL;
ALTER TABLE events ADD CONSTRAINT events_prelink_token_key UNIQUE (prelink_token);
COMMENT ON COLUMN events.prelink_token IS
    '事前案内に載せるイベント共通リンクのトークン。プロフィール事前入力専用で、チェックインはできない';

-- ---------------------------------------------------------------------------
-- 2. 受付コードを7桁へ。既存の6桁はそのまま残る
-- ---------------------------------------------------------------------------
ALTER TABLE participants ALTER COLUMN claim_code TYPE VARCHAR(7);

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
    v_prefix      TEXT;
    v_seq         INT;
    v_attempt     INT := 0;
BEGIN
    IF p_gender NOT IN ('male','female') THEN
        RAISE EXCEPTION '性別は male / female のいずれかです' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND status IN ('draft','active')) THEN
        RAISE EXCEPTION '受付可能なイベントではありません' USING ERRCODE = '22023';
    END IF;

    -- 登録順 = その性別で何人目に発行したか。100人目以降は下2桁だけを使う
    -- （桁あふれよりコードの長さを一定に保つことを優先する。一意性はランダム部と
    --   unique_event_claim_code 制約が担保する）
    SELECT COUNT(*) + 1 INTO v_seq
      FROM participants WHERE event_id = p_event_id AND gender = p_gender;

    v_prefix := (CASE WHEN p_gender = 'male' THEN '1' ELSE '2' END)
             || LPAD((v_seq % 100)::TEXT, 2, '0');

    LOOP
        v_attempt := v_attempt + 1;
        v_code := v_prefix || LPAD((FLOOR(RANDOM() * 10000))::INT::TEXT, 4, '0');
        BEGIN
            INSERT INTO participants (event_id, gender, session_token, is_proxy, claim_code)
            VALUES (p_event_id, p_gender, p_session_token, p_is_proxy, v_code)
            RETURNING * INTO v_participant;
            RETURN v_participant;
        EXCEPTION WHEN unique_violation THEN
            -- 受付コードの衝突なら引き直す。session_token の衝突なら諦める
            IF v_attempt >= 20 THEN
                RAISE EXCEPTION '受付コードを発行できませんでした';
            END IF;
        END;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. 事前リンク + 受付コード → セッション（★チェックインはしない）
--
-- claim_session との違いはここだけ:
--   claim_session         : 会場掲示QR経由。phase='checkin' 必須。呼び出し側が続けて採番する
--   claim_session_prefill : 事前リンク経由。いつでも可。採番は絶対に行わない
-- ---------------------------------------------------------------------------
CREATE FUNCTION claim_session_prefill(p_prelink_token TEXT, p_claim_code TEXT)
RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_event_id    UUID;
    v_participant participants;
BEGIN
    SELECT e.id INTO v_event_id
      FROM events e
     WHERE e.prelink_token = p_prelink_token
       AND e.status IN ('draft','active');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'このイベントの受付は終了しています' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_participant
      FROM participants
     WHERE event_id = v_event_id AND claim_code = p_claim_code AND status <> 'withdrawn';
    IF NOT FOUND THEN
        RAISE EXCEPTION '受付コードが見つかりません' USING ERRCODE = '42501';
    END IF;

    -- ★ここで checkin_participant を呼んではいけない。
    --   呼ぶと、自宅からでも出席済みにできてしまい出席情報が信用できなくなる。
    RETURN v_participant;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_session_prefill(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_session_prefill(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. 新規イベントにも事前リンクを用意する
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_event(
    p_event_name  TEXT,
    p_event_date  DATE DEFAULT NULL,
    p_is_demo     BOOLEAN DEFAULT FALSE,
    p_event_time  TEXT DEFAULT NULL,
    p_checkin_time TEXT DEFAULT NULL
) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
    v_event     events;
BEGIN
    IF v_organizer IS NULL THEN
        RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM organizers WHERE id = v_organizer) THEN
        RAISE EXCEPTION '主催者として登録されていません' USING ERRCODE = '42501';
    END IF;

    INSERT INTO events (
        organizer_id, event_name, event_date, passcode, checkin_token, prelink_token,
        seed_value, is_demo, event_time, checkin_time
    )
    VALUES (
        v_organizer,
        p_event_name,
        p_event_date,
        LPAD((FLOOR(RANDOM() * 10000))::INT::TEXT, 4, '0'),
        ENCODE(extensions.gen_random_bytes(24), 'hex'),
        ENCODE(extensions.gen_random_bytes(24), 'hex'),
        (FLOOR(RANDOM() * 2147483646) + 1)::INT,
        p_is_demo,
        p_event_time,
        p_checkin_time
    )
    RETURNING * INTO v_event;

    INSERT INTO event_states (event_id, phase) VALUES (v_event.id, 'draft');
    INSERT INTO participant_counters (event_id, gender) VALUES (v_event.id, 'male'), (v_event.id, 'female');
    INSERT INTO event_keys (event_id, data_key) VALUES (v_event.id, extensions.gen_random_bytes(32));

    RETURN v_event;
END;
$$;
