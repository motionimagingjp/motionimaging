-- 開催時刻・受付開始時刻を追加。タイムゾーン等の複雑さを避けるため単純な "HH:MM" 文字列で持つ
ALTER TABLE events ADD COLUMN event_time TEXT;
ALTER TABLE events ADD COLUMN checkin_time TEXT;
ALTER TABLE events ADD CONSTRAINT events_event_time_check
  CHECK (event_time IS NULL OR event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE events ADD CONSTRAINT events_checkin_time_check
  CHECK (checkin_time IS NULL OR checkin_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

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
        organizer_id, event_name, event_date, passcode, checkin_token, seed_value, is_demo,
        event_time, checkin_time
    )
    VALUES (
        v_organizer,
        p_event_name,
        p_event_date,
        LPAD((FLOOR(RANDOM() * 10000))::INT::TEXT, 4, '0'),
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
