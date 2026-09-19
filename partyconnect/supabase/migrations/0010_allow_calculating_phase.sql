-- 主催者が「投票を締め切って集計する」を自分で押せるようにする。
-- calculating に入ると submit_vote は final_vote 以外を拒否するため、以後の投票は自動的に締め切られる。
-- 結果配信(phase=result)は引き続き finalize_event_commit だけが行う。
CREATE OR REPLACE FUNCTION set_event_phase(p_event_id UUID, p_phase TEXT)
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
    IF p_phase NOT IN ('checkin','browse','like_vote','like_reveal','final_vote','calculating') THEN
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
