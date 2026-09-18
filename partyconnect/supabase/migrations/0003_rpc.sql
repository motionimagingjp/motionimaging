-- トランザクションを要する操作は SECURITY DEFINER 関数に閉じ込める。
-- supabase-js から複数文をひとつのトランザクションで実行することはできないため、
-- 「採番」「確定」「消去」のような不可分でなければならない処理は必ずここを通す。
-- 仕様: docs/partyconnect_requirements.md 6-2 / 6-4 / 12-5

-- 既定では関数の EXECUTE は PUBLIC に付与される。最後に明示的な GRANT だけを残す。

-- ---------------------------------------------------------------------------
-- イベント作成。event_states / participant_counters / event_keys を同時に作る。
-- カウンタ行が無いとチェックイン採番が失敗するため、ここで必ず作ること(6-4)。
-- ---------------------------------------------------------------------------
CREATE FUNCTION create_event(
    p_event_name TEXT,
    p_event_date DATE DEFAULT NULL,
    p_is_demo    BOOLEAN DEFAULT FALSE
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

    INSERT INTO events (organizer_id, event_name, event_date, passcode, checkin_token, seed_value, is_demo)
    VALUES (
        v_organizer,
        p_event_name,
        p_event_date,
        LPAD((FLOOR(RANDOM() * 10000))::INT::TEXT, 4, '0'),
        ENCODE(gen_random_bytes(24), 'hex'),
        (FLOOR(RANDOM() * 2147483646) + 1)::INT,
        p_is_demo
    )
    RETURNING * INTO v_event;

    INSERT INTO event_states (event_id, phase) VALUES (v_event.id, 'draft');
    INSERT INTO participant_counters (event_id, gender) VALUES (v_event.id, 'male'), (v_event.id, 'female');
    INSERT INTO event_keys (event_id, data_key) VALUES (v_event.id, gen_random_bytes(32));

    RETURN v_event;
END;
$$;

-- ---------------------------------------------------------------------------
-- 一斉キック。phase を進め、Realtime で全参加者へ配信する。
-- 'calculating' 以降は finalize_event_commit / purge_event だけが設定できる。
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_event_phase(p_event_id UUID, p_phase TEXT)
RETURNS event_states
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_organizer UUID := auth.uid();
    v_state     event_states;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = v_organizer) THEN
        RAISE EXCEPTION 'このイベントを操作する権限がありません' USING ERRCODE = '42501';
    END IF;
    IF p_phase NOT IN ('checkin','browse','like_vote','like_reveal','final_vote') THEN
        RAISE EXCEPTION 'このフェーズは主催者からは設定できません: %', p_phase USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- 参加者枠の発行。事前入力URL用と、当日の飛び込み(代理登録)用を兼ねる。
-- gender はここで確定し、以後 participants 側では変更させない(6-5)。
-- ---------------------------------------------------------------------------
CREATE FUNCTION issue_participant_slot(
    p_event_id      UUID,
    p_gender        TEXT,
    p_session_token TEXT,
    p_is_proxy      BOOLEAN DEFAULT FALSE
) RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_participant participants;
BEGIN
    IF p_gender NOT IN ('male','female') THEN
        RAISE EXCEPTION '性別は male / female のいずれかです' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND status IN ('draft','active')) THEN
        RAISE EXCEPTION '受付可能なイベントではありません' USING ERRCODE = '22023';
    END IF;

    INSERT INTO participants (event_id, gender, session_token, is_proxy)
    VALUES (p_event_id, p_gender, p_session_token, p_is_proxy)
    RETURNING * INTO v_participant;

    RETURN v_participant;
END;
$$;

-- ---------------------------------------------------------------------------
-- チェックイン。参加者番号を到着順にアトミックに採番する(6-4)。
--   UPDATE ... RETURNING がカウンタ行を排他ロックするため、同時チェックインは
--   自動的に直列化される。アプリ側のリトライループは不要。
--   二重チェックインは既存の番号をそのまま返す(冪等)。
-- ---------------------------------------------------------------------------
CREATE FUNCTION checkin_participant(p_session_token TEXT)
RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_participant participants;
    v_number      INTEGER;
BEGIN
    SELECT * INTO v_participant FROM participants WHERE session_token = p_session_token FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '参加者が見つかりません' USING ERRCODE = '42501';
    END IF;
    IF v_participant.status = 'withdrawn' THEN
        RAISE EXCEPTION '受付が取り消されています' USING ERRCODE = '42501';
    END IF;

    -- 冪等: 既に採番済みならそのまま返す
    IF v_participant.participant_number IS NOT NULL THEN
        RETURN v_participant;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM event_states
         WHERE event_id = v_participant.event_id AND phase = 'checkin'
    ) THEN
        RAISE EXCEPTION '現在は受付時間ではありません' USING ERRCODE = '22023';
    END IF;

    UPDATE participant_counters
       SET next_number = next_number + 1
     WHERE event_id = v_participant.event_id AND gender = v_participant.gender
    RETURNING next_number - 1 INTO v_number;

    IF v_number IS NULL THEN
        RAISE EXCEPTION '採番カウンタが未作成です(event_id=%)', v_participant.event_id;
    END IF;

    UPDATE participants
       SET participant_number = v_number,
           status = 'active',
           checked_in_at = NOW(),
           agreed_at = COALESCE(agreed_at, NOW())
     WHERE id = v_participant.id
    RETURNING * INTO v_participant;

    RETURN v_participant;
END;
$$;

-- ---------------------------------------------------------------------------
-- 辞退(途中退出・当日キャンセル)の論理無効化(6-6)。
-- 番号は欠番のまま再利用しない。result フェーズ以降は操作できない。
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_participant_withdrawn(
    p_participant_id UUID,
    p_withdrawn      BOOLEAN,
    p_organizer_id   UUID
) RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_participant participants;
    v_phase       TEXT;
BEGIN
    SELECT * INTO v_participant FROM participants WHERE id = p_participant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '参加者が見つかりません' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM events WHERE id = v_participant.event_id AND organizer_id = p_organizer_id
    ) THEN
        RAISE EXCEPTION 'このイベントを操作する権限がありません' USING ERRCODE = '42501';
    END IF;

    SELECT phase INTO v_phase FROM event_states WHERE event_id = v_participant.event_id;
    IF v_phase IN ('calculating','result','purged') THEN
        RAISE EXCEPTION '結果確定後は辞退操作ができません' USING ERRCODE = '22023';
    END IF;

    UPDATE participants
       SET status = CASE
                      WHEN p_withdrawn THEN 'withdrawn'
                      WHEN participant_number IS NULL THEN 'invited'
                      ELSE 'active'
                    END
     WHERE id = p_participant_id
    RETURNING * INTO v_participant;

    INSERT INTO organizer_audit_logs (organizer_id, event_id, action, detail)
    VALUES (
        p_organizer_id, v_participant.event_id,
        CASE WHEN p_withdrawn THEN 'withdraw_participant' ELSE 'restore_participant' END,
        -- 個人を特定しうる情報は入れない。番号までに留める
        jsonb_build_object('gender', v_participant.gender, 'number', v_participant.participant_number)
    );

    RETURN v_participant;
END;
$$;

-- ---------------------------------------------------------------------------
-- 確定(6-2 フェーズA)。マッチング結果と統計を同一トランザクションで書き込み、
-- 統計の書き込みが終わってから phase='result' にする。
-- 統計を先に確定させることが最重要。ここを分けると削除バッチ時に統計が空になる。
-- 冪等: 既に finished なら何もしない。
-- ---------------------------------------------------------------------------
CREATE FUNCTION finalize_event_commit(
    p_event_id  UUID,
    p_pairs     JSONB,
    p_analytics JSONB
) RETURNS event_analytics
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

    IF v_event.status IN ('finished','purged') THEN
        SELECT * INTO v_analytics FROM event_analytics WHERE event_id = p_event_id;
        RETURN v_analytics;   -- 二重確定は既存の結果を返すだけにする
    END IF;

    INSERT INTO matches (event_id, male_participant_id, female_participant_id, score)
    SELECT p_event_id,
           (pair->>'male_participant_id')::UUID,
           (pair->>'female_participant_id')::UUID,
           (pair->>'score')::INT
      FROM jsonb_array_elements(p_pairs) AS pair;

    -- ★結果配信より前に統計を確定させる
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

-- ---------------------------------------------------------------------------
-- 消去(6-2 フェーズB)。削除の唯一の入口。Cron も手動キックもここを通す(12-5)。
-- event_analytics の存在を確認できない限り、絶対に削除しない。
-- ---------------------------------------------------------------------------
CREATE FUNCTION purge_event(
    p_event_id               UUID,
    p_allow_before_deadline  BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_event events;
BEGIN
    SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'イベントが見つかりません' USING ERRCODE = '42501';
    END IF;
    IF v_event.status = 'purged' THEN
        RETURN FALSE;   -- 冪等
    END IF;
    IF v_event.status <> 'finished' THEN
        RAISE EXCEPTION '結果未配信のイベントは消去できません(status=%)', v_event.status USING ERRCODE = '22023';
    END IF;
    IF NOT p_allow_before_deadline AND v_event.finished_at > NOW() - INTERVAL '30 minutes' THEN
        RAISE EXCEPTION '終了から30分が経過していません' USING ERRCODE = '22023';
    END IF;

    -- ★統計の書き込み完了を確認できない限り削除しない。手動消去でも同じ(12-5)
    IF NOT EXISTS (SELECT 1 FROM event_analytics WHERE event_id = p_event_id) THEN
        RAISE EXCEPTION '統計が未書き込みのため消去を中止しました(event_id=%)', p_event_id;
    END IF;

    DELETE FROM votes        WHERE event_id = p_event_id;
    DELETE FROM matches      WHERE event_id = p_event_id;
    DELETE FROM participants WHERE event_id = p_event_id;
    -- 鍵を破棄して自由記述の暗号文を復号不能にする(7-4)
    DELETE FROM event_keys   WHERE event_id = p_event_id;

    UPDATE events       SET status = 'purged'                     WHERE id = p_event_id;
    UPDATE event_states SET phase = 'purged', updated_at = NOW()  WHERE event_id = p_event_id;

    INSERT INTO organizer_audit_logs (organizer_id, event_id, action, detail)
    VALUES (v_event.organizer_id, p_event_id, 'purge',
            jsonb_build_object('before_deadline', p_allow_before_deadline));

    RETURN TRUE;
END;
$$;

-- Cron から呼ぶ一括消去。統計が書けていないイベントはここでは拾わず、放置して気づけるようにする。
CREATE FUNCTION purge_due_events() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id    UUID;
    v_count INTEGER := 0;
BEGIN
    FOR v_id IN
        SELECT e.id FROM events e
         WHERE e.status = 'finished'
           AND e.finished_at < NOW() - INTERVAL '30 minutes'
           AND EXISTS (SELECT 1 FROM event_analytics a WHERE a.event_id = e.id)
    LOOP
        PERFORM purge_event(v_id, FALSE);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 統計が書けていないまま放置されているイベントの検知用。監視から定期的に叩く。
CREATE FUNCTION list_stuck_events() RETURNS TABLE (event_id UUID, finished_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT e.id, e.finished_at FROM events e
     WHERE e.status = 'finished'
       AND e.finished_at < NOW() - INTERVAL '30 minutes'
       AND NOT EXISTS (SELECT 1 FROM event_analytics a WHERE a.event_id = e.id);
$$;

-- ---------------------------------------------------------------------------
-- 実行権限。既定の PUBLIC への付与を剥がし、必要なロールにだけ与える。
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
    create_event(TEXT, DATE, BOOLEAN),
    set_event_phase(UUID, TEXT),
    issue_participant_slot(UUID, TEXT, TEXT, BOOLEAN),
    checkin_participant(TEXT),
    set_participant_withdrawn(UUID, BOOLEAN, UUID),
    finalize_event_commit(UUID, JSONB, JSONB),
    purge_event(UUID, BOOLEAN),
    purge_due_events(),
    list_stuck_events()
FROM PUBLIC, anon, authenticated;

-- 主催者が直接呼んでよいのは、認可を auth.uid() で自己完結できるものだけ
GRANT EXECUTE ON FUNCTION create_event(TEXT, DATE, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_event_phase(UUID, TEXT) TO authenticated;

-- 残りは Edge Function(service_role)専用
GRANT EXECUTE ON FUNCTION
    issue_participant_slot(UUID, TEXT, TEXT, BOOLEAN),
    checkin_participant(TEXT),
    set_participant_withdrawn(UUID, BOOLEAN, UUID),
    finalize_event_commit(UUID, JSONB, JSONB),
    purge_event(UUID, BOOLEAN),
    purge_due_events(),
    list_stuck_events()
TO service_role;
