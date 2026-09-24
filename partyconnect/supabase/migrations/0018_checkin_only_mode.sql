-- 受付のみモード（checkin_only）。
--
-- マッチングを使わず「受付・人数管理」だけを使うイベント。マッチング利用への導入口として無料で提供する。
--   - 性別を聞かず、gender = 'none' の通し番号（No.1, No.2 ...）で受付する
--   - 進行は「受付開始 → 受付終了 → データ消去」のみ。投票系フェーズには進めない
--   - 受付終了時に最小限の統計（人数のみ）を書き、既存の消去経路（手動・30分後の自動）をそのまま使う

-- 1. イベント種別
ALTER TABLE events ADD COLUMN event_mode TEXT NOT NULL DEFAULT 'matching';
ALTER TABLE events ADD CONSTRAINT events_event_mode_check
    CHECK (event_mode IN ('matching', 'checkin_only'));

-- 2. 性別なし（受付のみモード専用）を許可する。
--    マッチング処理は male / female で絞り込むため、'none' の参加者が混入しても計算対象にならない
ALTER TABLE participants DROP CONSTRAINT participants_gender_check;
ALTER TABLE participants ADD CONSTRAINT participants_gender_check
    CHECK (gender IN ('male', 'female', 'none'));
ALTER TABLE participant_counters DROP CONSTRAINT participant_counters_gender_check;
ALTER TABLE participant_counters ADD CONSTRAINT participant_counters_gender_check
    CHECK (gender IN ('male', 'female', 'none'));

-- 3. create_event に p_event_mode を追加する。
--    ★引数の数が変わる CREATE OR REPLACE は既存関数を置き換えず「別のオーバーロード」を増やしてしまい、
--      PostgREST の呼び出しが失敗する（0016 で実際に起きた不具合）。旧6引数版を先に必ず DROP する。
DROP FUNCTION IF EXISTS public.create_event(text, date, boolean, text, text, text);

CREATE FUNCTION public.create_event(
    p_event_name    TEXT,
    p_event_date    DATE    DEFAULT NULL,
    p_is_demo       BOOLEAN DEFAULT FALSE,
    p_event_time    TEXT    DEFAULT NULL,
    p_checkin_time  TEXT    DEFAULT NULL,
    p_matching_mode TEXT    DEFAULT 'max_pairs',
    p_event_mode    TEXT    DEFAULT 'matching'
) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
    v_event     events;
    v_mode      TEXT;
BEGIN
    IF v_organizer IS NULL THEN
        RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM organizers WHERE id = v_organizer) THEN
        RAISE EXCEPTION '主催者として登録されていません' USING ERRCODE = '42501';
    END IF;
    IF p_matching_mode NOT IN ('max_pairs', 'greedy_priority') THEN
        RAISE EXCEPTION 'マッチング方式が不正です' USING ERRCODE = '22023';
    END IF;
    IF p_event_mode NOT IN ('matching', 'checkin_only') THEN
        RAISE EXCEPTION 'イベントの種類が不正です' USING ERRCODE = '22023';
    END IF;

    -- デモはマッチングの全工程を一人で体験するためのものなので、常にマッチングありで作る
    v_mode := CASE WHEN p_is_demo THEN 'matching' ELSE p_event_mode END;

    INSERT INTO events (
        organizer_id, event_name, event_date, passcode, checkin_token, prelink_token,
        seed_value, is_demo, event_time, checkin_time, matching_mode, event_mode
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
        p_checkin_time,
        CASE WHEN p_is_demo THEN 'max_pairs' ELSE p_matching_mode END,
        v_mode
    )
    RETURNING * INTO v_event;

    INSERT INTO event_states (event_id, phase) VALUES (v_event.id, 'draft');
    IF v_mode = 'checkin_only' THEN
        INSERT INTO participant_counters (event_id, gender) VALUES (v_event.id, 'none');
    ELSE
        INSERT INTO participant_counters (event_id, gender)
        VALUES (v_event.id, 'male'), (v_event.id, 'female');
    END IF;
    INSERT INTO event_keys (event_id, data_key) VALUES (v_event.id, extensions.gen_random_bytes(32));

    RETURN v_event;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event(TEXT, DATE, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(TEXT, DATE, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4. 枠の発行。イベント種別と性別の組み合わせをここで強制する
--    （受付のみイベントに男女枠が混ざる／マッチングイベントに性別なし枠が混ざる、を防ぐ）。
--    受付コードの先頭1桁: 1=男性 / 2=女性 / 3=受付のみ（性別なし）
CREATE OR REPLACE FUNCTION public.issue_participant_slot(
    p_event_id UUID, p_gender TEXT, p_session_token TEXT, p_is_proxy BOOLEAN DEFAULT FALSE
) RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_participant participants;
    v_mode        TEXT;
    v_code        TEXT;
    v_prefix      TEXT;
    v_seq         INT;
    v_attempt     INT := 0;
BEGIN
    SELECT event_mode INTO v_mode
      FROM events WHERE id = p_event_id AND status IN ('draft','active');
    IF NOT FOUND THEN
        RAISE EXCEPTION '受付可能なイベントではありません' USING ERRCODE = '22023';
    END IF;

    IF v_mode = 'checkin_only' AND p_gender <> 'none' THEN
        RAISE EXCEPTION '受付のみのイベントでは性別を指定しません' USING ERRCODE = '22023';
    END IF;
    IF v_mode = 'matching' AND p_gender NOT IN ('male','female') THEN
        RAISE EXCEPTION '性別は male / female のいずれかです' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(*) + 1 INTO v_seq
      FROM participants WHERE event_id = p_event_id AND gender = p_gender;

    v_prefix := (CASE p_gender WHEN 'male' THEN '1' WHEN 'female' THEN '2' ELSE '3' END)
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
            IF v_attempt >= 20 THEN
                RAISE EXCEPTION '受付コードを発行できませんでした';
            END IF;
        END;
    END LOOP;
END;
$$;

-- 5. フェーズ操作。受付のみイベントは「受付」以外のフェーズ（投票など）へ進めない。
--    画面でボタンを隠すだけでなく、ここで止めておく（API直叩きでも投票フェーズに入らない）
CREATE OR REPLACE FUNCTION public.set_event_phase(p_event_id UUID, p_phase TEXT)
RETURNS event_states
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
    v_mode      TEXT;
    v_state     event_states;
BEGIN
    SELECT event_mode INTO v_mode FROM events WHERE id = p_event_id AND organizer_id = v_organizer;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'このイベントを操作する権限がありません' USING ERRCODE = '42501';
    END IF;
    IF p_phase NOT IN ('checkin','browse','like_vote','like_reveal','final_vote','calculating') THEN
        RAISE EXCEPTION 'このフェーズは主催者からは設定できません: %', p_phase USING ERRCODE = '22023';
    END IF;
    IF v_mode = 'checkin_only' AND p_phase <> 'checkin' THEN
        RAISE EXCEPTION '受付のみのイベントでは投票・マッチングは行えません' USING ERRCODE = '22023';
    END IF;

    UPDATE events
       SET status = 'active',
           started_at = COALESCE(started_at, NOW())
     WHERE id = p_event_id AND status = 'draft';

    UPDATE event_states
       SET phase = p_phase, updated_at = NOW()
     WHERE event_id = p_event_id
    RETURNING * INTO v_state;

    INSERT INTO organizer_audit_logs (organizer_id, event_id, action, detail)
    VALUES (v_organizer, p_event_id, 'set_phase', jsonb_build_object('phase', p_phase));

    RETURN v_state;
END;
$$;

-- 6. 受付のみイベントの終了。
--    マッチングイベントの finalize_event_commit に相当する。統計（人数のみ）を書いてから finished にするので、
--    既存の purge_event（統計が無いと消去を拒否する）と30分後の自動消去がそのまま動く。
CREATE FUNCTION public.finish_checkin_event(p_event_id UUID)
RETURNS event_analytics
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
    v_event     events;
    v_invited   INT;
    v_checked   INT;
    v_withdrawn INT;
    v_analytics event_analytics;
BEGIN
    SELECT * INTO v_event FROM events
     WHERE id = p_event_id AND organizer_id = v_organizer FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'このイベントを操作する権限がありません' USING ERRCODE = '42501';
    END IF;
    IF v_event.event_mode <> 'checkin_only' THEN
        RAISE EXCEPTION 'マッチングありのイベントは「確定して結果を配信」で終了してください' USING ERRCODE = '22023';
    END IF;
    -- 二度押しは何もせず既存の統計を返す
    IF v_event.status IN ('finished', 'purged') THEN
        SELECT * INTO v_analytics FROM event_analytics WHERE event_id = p_event_id;
        RETURN v_analytics;
    END IF;
    IF v_event.status <> 'active' THEN
        RAISE EXCEPTION 'まだ受付を開始していません' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE status = 'active'),
           COUNT(*) FILTER (WHERE status = 'withdrawn')
      INTO v_invited, v_checked, v_withdrawn
      FROM participants WHERE event_id = p_event_id;

    INSERT INTO event_analytics (
        event_id, organizer_id, withdrawn_count, duration_minutes, attributes_summary
    ) VALUES (
        p_event_id,
        v_event.organizer_id,
        v_withdrawn,
        CASE WHEN v_event.started_at IS NULL THEN NULL
             ELSE (EXTRACT(EPOCH FROM (NOW() - v_event.started_at)) / 60)::INT END,
        jsonb_build_object('event_mode', 'checkin_only', 'invited', v_invited, 'checked_in', v_checked)
    )
    ON CONFLICT (event_id) DO UPDATE SET
        withdrawn_count    = EXCLUDED.withdrawn_count,
        duration_minutes   = EXCLUDED.duration_minutes,
        attributes_summary = EXCLUDED.attributes_summary
    RETURNING * INTO v_analytics;

    UPDATE events SET status = 'finished', finished_at = NOW() WHERE id = p_event_id;
    -- 'result' を「終了」として使う。受付のみの参加者画面は phase を見て受付完了表示を出し分けない
    UPDATE event_states SET phase = 'result', updated_at = NOW() WHERE event_id = p_event_id;

    INSERT INTO organizer_audit_logs (organizer_id, event_id, action, detail)
    VALUES (v_organizer, p_event_id, 'finish_checkin', jsonb_build_object('checked_in', v_checked));

    RETURN v_analytics;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_checkin_event(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_checkin_event(UUID) TO authenticated;

-- 7. 受付のみイベントをマッチング確定の経路で終了させない（API直叩き対策）。
--    それ以外の処理は従来と同一。
CREATE OR REPLACE FUNCTION public.finalize_event_commit(p_event_id UUID, p_pairs JSONB, p_analytics JSONB)
RETURNS event_analytics
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_event     events;
    v_analytics event_analytics;
BEGIN
    SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'イベントが見つかりません' USING ERRCODE = '42501';
    END IF;
    IF v_event.event_mode = 'checkin_only' THEN
        RAISE EXCEPTION '受付のみのイベントではマッチングの確定は行えません' USING ERRCODE = '22023';
    END IF;

    IF v_event.status IN ('finished','purged') THEN
        SELECT * INTO v_analytics FROM event_analytics WHERE event_id = p_event_id;
        RETURN v_analytics;
    END IF;

    INSERT INTO matches (event_id, male_participant_id, female_participant_id, score)
    SELECT p_event_id,
           (pair->>'male_participant_id')::UUID,
           (pair->>'female_participant_id')::UUID,
           (pair->>'score')::INT
      FROM jsonb_array_elements(p_pairs) AS pair;

    INSERT INTO event_analytics (
        event_id, organizer_id, total_male_count, total_female_count, withdrawn_count,
        matched_pairs_count, match_rate, like_vote_count, one_sided_pairs_count,
        duration_minutes, attributes_summary
    ) VALUES (
        p_event_id,
        v_event.organizer_id,
        COALESCE((p_analytics->>'total_male_count')::INT, 0),
        COALESCE((p_analytics->>'total_female_count')::INT, 0),
        COALESCE((p_analytics->>'withdrawn_count')::INT, 0),
        COALESCE((p_analytics->>'matched_pairs_count')::INT, 0),
        (p_analytics->>'match_rate')::NUMERIC,
        COALESCE((p_analytics->>'like_vote_count')::INT, 0),
        COALESCE((p_analytics->>'one_sided_pairs_count')::INT, 0),
        (p_analytics->>'duration_minutes')::INT,
        COALESCE(p_analytics->'attributes_summary', '{}'::jsonb)
    )
    ON CONFLICT (event_id) DO UPDATE SET
        total_male_count      = EXCLUDED.total_male_count,
        total_female_count    = EXCLUDED.total_female_count,
        withdrawn_count       = EXCLUDED.withdrawn_count,
        matched_pairs_count   = EXCLUDED.matched_pairs_count,
        match_rate            = EXCLUDED.match_rate,
        like_vote_count       = EXCLUDED.like_vote_count,
        one_sided_pairs_count = EXCLUDED.one_sided_pairs_count,
        duration_minutes      = EXCLUDED.duration_minutes,
        attributes_summary    = EXCLUDED.attributes_summary
    RETURNING * INTO v_analytics;

    UPDATE events SET status = 'finished', finished_at = NOW() WHERE id = p_event_id;
    UPDATE event_states SET phase = 'result', updated_at = NOW() WHERE event_id = p_event_id;

    INSERT INTO organizer_audit_logs (organizer_id, event_id, action, detail)
    VALUES (v_event.organizer_id, p_event_id, 'finalize',
            jsonb_build_object('matched_pairs_count', v_analytics.matched_pairs_count));

    RETURN v_analytics;
END;
$$;

NOTIFY pgrst, 'reload schema';
