-- マッチング方式の選択（オプション機能）。
--
-- 既定は現行の「成立組数最優先」方式(max_pairs)のまま。あぶれる人が増える可能性がある
-- 「第1希望（熱量）優先」方式(greedy_priority)は、イベント作成時に主催者が明示的に
-- 選んだ場合のみ有効になる。既存イベントはすべて既定値(max_pairs)になり挙動は変わらない。
--
-- ★方式の変更はイベント作成時のみ。投票開始後に切り替えられると「あちらの方式なら
--   成立していたのに」という不公平感を生むため、変更用RPCはあえて用意しない。
ALTER TABLE events ADD COLUMN matching_mode TEXT NOT NULL DEFAULT 'max_pairs'
  CONSTRAINT events_matching_mode_check CHECK (matching_mode IN ('max_pairs', 'greedy_priority'));
COMMENT ON COLUMN events.matching_mode IS
    'max_pairs=成立組数を最優先(既定・推奨) / greedy_priority=相互の熱量(スコア)が高いペアを最優先し、あぶれる人が出ても許容する方式';

CREATE OR REPLACE FUNCTION create_event(
    p_event_name    TEXT,
    p_event_date    DATE DEFAULT NULL,
    p_is_demo       BOOLEAN DEFAULT FALSE,
    p_event_time    TEXT DEFAULT NULL,
    p_checkin_time  TEXT DEFAULT NULL,
    p_matching_mode TEXT DEFAULT 'max_pairs'
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
    IF p_matching_mode NOT IN ('max_pairs', 'greedy_priority') THEN
        RAISE EXCEPTION 'マッチング方式が不正です' USING ERRCODE = '22023';
    END IF;

    INSERT INTO events (
        organizer_id, event_name, event_date, passcode, checkin_token, prelink_token,
        seed_value, is_demo, event_time, checkin_time, matching_mode
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
        -- デモは検証済みの max_pairs 前提でダミー投票を作っているため、常にmax_pairsに固定する
        CASE WHEN p_is_demo THEN 'max_pairs' ELSE p_matching_mode END
    )
    RETURNING * INTO v_event;

    INSERT INTO event_states (event_id, phase) VALUES (v_event.id, 'draft');
    INSERT INTO participant_counters (event_id, gender) VALUES (v_event.id, 'male'), (v_event.id, 'female');
    INSERT INTO event_keys (event_id, data_key) VALUES (v_event.id, extensions.gen_random_bytes(32));

    RETURN v_event;
END;
$$;
