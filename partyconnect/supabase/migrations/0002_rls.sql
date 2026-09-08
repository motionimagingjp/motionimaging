-- RLS / 権限設計
-- 仕様: docs/partyconnect_requirements.md 7章
--
-- 基本方針: 参加者はDBを直接触らない。
--   全テーブルをデフォルト拒否にし、参加者の全操作を Edge Function(service_role)経由に一本化する。
--   例外は event_states(phase のみを持ち、漏れても無害)の SELECT だけ。Realtime の一斉キック同期に必要。

-- 1) 全テーブルでRLSを有効化
ALTER TABLE organizers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_states         ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_analytics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_audit_logs ENABLE ROW LEVEL SECURITY;

-- 2) Supabase は public スキーマに anon/authenticated へ既定で GRANT する。
--    RLS 以前にテーブル権限そのものを剥奪しておく(二重防御)
REVOKE ALL ON participants, votes, matches, participant_counters, event_keys
    FROM anon, authenticated;
-- 主催者向けテーブルも書き込みは全て SECURITY DEFINER 関数経由にする
REVOKE INSERT, UPDATE, DELETE
    ON organizers, events, event_states, event_analytics, organizer_audit_logs
    FROM anon, authenticated;
-- 匿名参加者は主催者向けテーブルを一切読めない
REVOKE ALL ON organizers, events, event_analytics, organizer_audit_logs FROM anon;

-- 3) 参加者(anon)が触れるのは event_states の SELECT だけ。
--    INSERT/UPDATE/DELETE のポリシーは作らない = service_role のみが書ける
CREATE POLICY event_states_public_read ON event_states
    FOR SELECT TO anon, authenticated USING (TRUE);

-- 4) 主催者(authenticated)は自分のデータのみ読める。書き込みは全て RPC 経由
CREATE POLICY organizers_self_read ON organizers
    FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY events_owner_read ON events
    FOR SELECT TO authenticated USING (organizer_id = auth.uid());

CREATE POLICY analytics_owner_read ON event_analytics
    FOR SELECT TO authenticated USING (organizer_id = auth.uid());

CREATE POLICY audit_logs_owner_read ON organizer_audit_logs
    FOR SELECT TO authenticated USING (organizer_id = auth.uid());

-- participants / votes / matches / participant_counters / event_keys にはポリシーを一切作らない。
-- 主催者であっても直接は読めない。参加者一覧・進捗は Edge Function が集計して返す。
-- ここにポリシーを足すと投票の生データや自由記述へ到達できる経路が生まれるので、追加しないこと。
