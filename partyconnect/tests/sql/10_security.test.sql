-- RLS と RPC の実挙動テスト。ローカル postgres に対して流す。
-- 失敗すると ON_ERROR_STOP で即座に止まる。
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages TO NOTICE;

-- ===== 準備 =====
INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'org1@example.com'),
    ('22222222-2222-2222-2222-222222222222', 'org2@example.com');
INSERT INTO organizers (id, email, phone_number, is_phone_verified) VALUES
    ('11111111-1111-1111-1111-111111111111', 'org1@example.com', '09000000001', TRUE),
    ('22222222-2222-2222-2222-222222222222', 'org2@example.com', '09000000002', TRUE);

-- ===== 主催者1がイベントを作る =====
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', FALSE);
SET ROLE authenticated;
SELECT (create_event('テスト街コン', CURRENT_DATE, FALSE)).id AS event_id \gset
RESET ROLE;
-- psql の変数はドル引用符の中では展開されない。DO ブロックからは GUC 経由で参照する
SELECT set_config('test.event_id', :'event_id', FALSE);

DO $$ BEGIN
    ASSERT (SELECT COUNT(*) FROM participant_counters) = 2, 'create_event が採番カウンタを2行作っていない';
    ASSERT (SELECT COUNT(*) FROM event_states) = 1, 'create_event が event_states を作っていない';
    ASSERT (SELECT COUNT(*) FROM event_keys) = 1, 'create_event が event_keys を作っていない';
    RAISE NOTICE 'PASS: create_event が付随レコードを揃えて作る';
END $$;

-- ===== 匿名参加者(anon)の権限 =====
SET ROLE anon;
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['participants','votes','matches','participant_counters','event_keys',
                             'events','organizers','event_analytics','organizer_audit_logs']
    LOOP
        BEGIN
            EXECUTE format('SELECT 1 FROM %I LIMIT 1', t);
            RAISE EXCEPTION 'FAIL: anon が % を読めてしまった', t;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;
        END;
    END LOOP;
    RAISE NOTICE 'PASS: anon はどのテーブルも直接読めない';
END $$;

DO $$ BEGIN
    PERFORM 1 FROM event_states LIMIT 1;
    RAISE NOTICE 'PASS: anon は event_states(phase のみ)を読める';
END $$;

DO $$ BEGIN
    BEGIN
        PERFORM checkin_participant('dummy');
        RAISE EXCEPTION 'FAIL: anon が checkin_participant を実行できてしまった';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: anon は service_role 専用RPCを実行できない';
    END;
END $$;
RESET ROLE;

-- ===== 他人のイベントは見えない =====
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', FALSE);
SET ROLE authenticated;
DO $$ BEGIN
    ASSERT (SELECT COUNT(*) FROM events) = 0, 'FAIL: 他の主催者のイベントが見えている';
    RAISE NOTICE 'PASS: 主催者は他人のイベントを読めない';
    BEGIN
        PERFORM 1 FROM participants LIMIT 1;
        RAISE EXCEPTION 'FAIL: 主催者が participants を直接読めてしまった';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: 主催者も participants を直接読めない(連絡先以外の機微情報も遮断)';
    END;
    BEGIN
        PERFORM purge_event('00000000-0000-0000-0000-000000000000', TRUE);
        RAISE EXCEPTION 'FAIL: 主催者が purge_event を直接実行できてしまった';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: 主催者は purge_event を直接実行できない';
    END;
END $$;
RESET ROLE;

-- 他人のイベントの phase は動かせない
SET ROLE authenticated;
DO $$ BEGIN
    BEGIN
        PERFORM set_event_phase((SELECT id FROM events LIMIT 1), 'checkin');
        RAISE EXCEPTION 'FAIL: 他人のイベントの phase を変更できてしまった';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: 他人のイベントの phase は変更できない';
    END;
END $$;
RESET ROLE;

-- ===== 採番(6-4) =====
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', FALSE);
SET ROLE authenticated;
SELECT set_event_phase(current_setting('test.event_id')::UUID, 'checkin');
RESET ROLE;

SET ROLE service_role;
SELECT issue_participant_slot(current_setting('test.event_id')::UUID, 'male',   'tok-m1');
SELECT issue_participant_slot(current_setting('test.event_id')::UUID, 'male',   'tok-m2');
SELECT issue_participant_slot(current_setting('test.event_id')::UUID, 'male',   'tok-m3');
SELECT issue_participant_slot(current_setting('test.event_id')::UUID, 'female', 'tok-f1');
SELECT issue_participant_slot(current_setting('test.event_id')::UUID, 'female', 'tok-f2');

DO $$
DECLARE n INT;
BEGIN
    -- 到着順は m2 -> m1 -> m3
    SELECT participant_number INTO n FROM checkin_participant('tok-m2'); ASSERT n = 1, '1人目の番号が1でない';
    SELECT participant_number INTO n FROM checkin_participant('tok-m1'); ASSERT n = 2, '2人目の番号が2でない';
    SELECT participant_number INTO n FROM checkin_participant('tok-m3'); ASSERT n = 3, '3人目の番号が3でない';
    -- 性別ごとに独立して1から始まる
    SELECT participant_number INTO n FROM checkin_participant('tok-f1'); ASSERT n = 1, '女性1人目の番号が1でない';
    SELECT participant_number INTO n FROM checkin_participant('tok-f2'); ASSERT n = 2, '女性2人目の番号が2でない';
    -- 冪等: 二重チェックインしても番号は変わらない
    SELECT participant_number INTO n FROM checkin_participant('tok-m2'); ASSERT n = 1, '二重チェックインで番号が変わった';
    RAISE NOTICE 'PASS: 到着順に性別ごとの連番が採番され、二重チェックインは冪等';
END $$;

-- 辞退した参加者はチェックインできない
DO $$
DECLARE pid UUID;
BEGIN
    SELECT id INTO pid FROM participants WHERE session_token = 'tok-f2';
    PERFORM set_participant_withdrawn(pid, TRUE, '11111111-1111-1111-1111-111111111111');
    ASSERT (SELECT status FROM participants WHERE id = pid) = 'withdrawn', '辞退状態になっていない';
    -- 番号は欠番のまま残し、再利用しない
    ASSERT (SELECT participant_number FROM participants WHERE id = pid) = 2, '辞退で番号が消えた';
    RAISE NOTICE 'PASS: 辞退は論理無効化で、番号は欠番のまま残る';
END $$;

-- ===== 消去の安全装置(12-5) =====
DO $$
DECLARE ok BOOLEAN;
BEGIN
    BEGIN
        PERFORM purge_event(current_setting('test.event_id')::UUID, TRUE);
        RAISE EXCEPTION 'FAIL: 結果未配信のイベントを消去できてしまった';
    EXCEPTION WHEN sqlstate '22023' THEN
        RAISE NOTICE 'PASS: 結果未配信のイベントは消去できない';
    END;
END $$;

-- 統計が無いまま finished になったイベントは消去を中止する
UPDATE events SET status = 'finished', finished_at = NOW() - INTERVAL '1 hour' WHERE id = current_setting('test.event_id')::UUID;
DO $$ BEGIN
    BEGIN
        PERFORM purge_event(current_setting('test.event_id')::UUID, FALSE);
        RAISE EXCEPTION 'FAIL: 統計が無いのに消去できてしまった';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%統計が未書き込み%' THEN
            RAISE NOTICE 'PASS: 統計未書き込みのイベントは消去を中止する';
        ELSE
            RAISE;
        END IF;
    END;
END $$;
DO $$ BEGIN
    ASSERT (SELECT COUNT(*) FROM list_stuck_events()) = 1, '統計未書き込みイベントを検知できていない';
    ASSERT (SELECT purge_due_events()) = 0, '統計の無いイベントを一括消去が拾ってしまった';
    RAISE NOTICE 'PASS: 統計未書き込みのイベントは一括消去の対象外で、検知関数に出る';
END $$;

-- ===== 確定 → 消去 =====
UPDATE events SET status = 'active', finished_at = NULL WHERE id = current_setting('test.event_id')::UUID;
DO $$
DECLARE m1 UUID; f1 UUID; a event_analytics;
BEGIN
    SELECT id INTO m1 FROM participants WHERE session_token = 'tok-m1';
    SELECT id INTO f1 FROM participants WHERE session_token = 'tok-f1';
    INSERT INTO votes (event_id, from_participant_id, to_participant_id, vote_type, preference_order)
    VALUES (current_setting('test.event_id')::UUID, m1, f1, 'final', 1), (current_setting('test.event_id')::UUID, f1, m1, 'final', 1);

    SELECT * INTO a FROM finalize_event_commit(
        current_setting('test.event_id')::UUID,
        jsonb_build_array(jsonb_build_object(
            'male_participant_id', m1, 'female_participant_id', f1, 'score', 6)),
        jsonb_build_object('total_male_count', 3, 'total_female_count', 1, 'withdrawn_count', 1,
                           'matched_pairs_count', 1, 'match_rate', 50.00, 'like_vote_count', 0,
                           'one_sided_pairs_count', 0, 'duration_minutes', 120)
    );
    ASSERT a.matched_pairs_count = 1, '統計が書き込まれていない';
    ASSERT (SELECT status FROM events WHERE id = current_setting('test.event_id')::UUID) = 'finished', 'status が finished でない';
    ASSERT (SELECT phase FROM event_states WHERE event_id = current_setting('test.event_id')::UUID) = 'result', 'phase が result でない';
    RAISE NOTICE 'PASS: 確定で 結果書き込み→統計書き込み→result 配信 が同一トランザクションで完了する';

    -- 二重確定は冪等
    SELECT * INTO a FROM finalize_event_commit(current_setting('test.event_id')::UUID, '[]'::jsonb, '{}'::jsonb);
    ASSERT a.matched_pairs_count = 1, '二重確定で統計が壊れた';
    ASSERT (SELECT COUNT(*) FROM matches WHERE event_id = current_setting('test.event_id')::UUID) = 1, '二重確定でマッチが重複した';
    RAISE NOTICE 'PASS: 確定は冪等';
END $$;

-- 30分経過前は消去できない。手動キック(p_allow_before_deadline)のみ許可
DO $$ BEGIN
    BEGIN
        PERFORM purge_event(current_setting('test.event_id')::UUID, FALSE);
        RAISE EXCEPTION 'FAIL: 30分経過前に自動消去できてしまった';
    EXCEPTION WHEN sqlstate '22023' THEN
        RAISE NOTICE 'PASS: 30分経過前は自動消去されない';
    END;
END $$;

DO $$ BEGIN
    ASSERT purge_event(current_setting('test.event_id')::UUID, TRUE), '手動消去が実行されなかった';
    ASSERT (SELECT COUNT(*) FROM participants WHERE event_id = current_setting('test.event_id')::UUID) = 0, '参加者が残っている';
    ASSERT (SELECT COUNT(*) FROM votes        WHERE event_id = current_setting('test.event_id')::UUID) = 0, '投票が残っている';
    ASSERT (SELECT COUNT(*) FROM matches      WHERE event_id = current_setting('test.event_id')::UUID) = 0, 'マッチが残っている';
    ASSERT (SELECT COUNT(*) FROM event_keys   WHERE event_id = current_setting('test.event_id')::UUID) = 0, '暗号鍵が破棄されていない';
    -- 統計は残る。これがサブスクの中核価値
    ASSERT (SELECT matched_pairs_count FROM event_analytics WHERE event_id = current_setting('test.event_id')::UUID) = 1, '統計まで消えた';
    ASSERT (SELECT status FROM events WHERE id = current_setting('test.event_id')::UUID) = 'purged', 'status が purged でない';
    ASSERT (SELECT phase FROM event_states WHERE event_id = current_setting('test.event_id')::UUID) = 'purged', 'phase が purged でない';
    RAISE NOTICE 'PASS: 消去で参加者データと鍵は物理削除され、匿名統計だけが残る';

    ASSERT NOT purge_event(current_setting('test.event_id')::UUID, TRUE), '消去済みイベントの再消去が TRUE を返した';
    RAISE NOTICE 'PASS: 消去は冪等';
END $$;
RESET ROLE;

-- 統計は所有者だけが読める
SET ROLE authenticated;
DO $$ BEGIN
    ASSERT (SELECT COUNT(*) FROM event_analytics) = 1, '主催者が自分の統計を読めない';
    RAISE NOTICE 'PASS: 主催者は消去後も自分の統計を読める';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', FALSE);
SET ROLE authenticated;
DO $$ BEGIN
    ASSERT (SELECT COUNT(*) FROM event_analytics) = 0, '他人の統計が見えている';
    RAISE NOTICE 'PASS: 他人の統計は読めない';
END $$;
RESET ROLE;
