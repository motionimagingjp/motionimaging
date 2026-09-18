-- PartyConnect スキーマ
-- 仕様: docs/partyconnect_requirements.md 6章
--
-- 設計方針:
--   - 参加者データ(participants/votes/matches)と主催者統計(event_analytics)を二層に分離する
--   - 両者は外部キーで直結せず event_id で疎結合にする。個人情報の削除が統計を壊さないようにするため
--   - 連絡先カラムは存在しない。アプリは連絡先を保持・表示・仲介しない(11-1)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 主催者(永続)。id は auth.users.id と一致させ、RLS で auth.uid() と突き合わせる
CREATE TABLE organizers (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email             VARCHAR(255) UNIQUE NOT NULL,
    phone_number      VARCHAR(20) UNIQUE NOT NULL,
    is_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    plan_type         VARCHAR(50) NOT NULL DEFAULT 'free',
    free_trial_used   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organizers_plan_type_check CHECK (plan_type IN ('free','spot','light','pro'))
);
COMMENT ON COLUMN organizers.phone_number IS '無料枠の不正利用防止用。1電話番号につき初回無料は1回のみ';

-- 2. イベント(永続)
CREATE TABLE events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
    event_name    VARCHAR(100) NOT NULL,
    event_date    DATE,
    passcode      VARCHAR(4) NOT NULL,
    checkin_token TEXT NOT NULL UNIQUE,
    seed_value    INTEGER NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'draft',
    is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_status_check CHECK (status IN ('draft','active','finished','purged')),
    CONSTRAINT events_passcode_check CHECK (passcode ~ '^[0-9]{4}$')
);
-- 削除バッチが status/finished_at で走査するための索引
CREATE INDEX idx_events_purge ON events(status, finished_at);
CREATE INDEX idx_events_organizer ON events(organizer_id);
COMMENT ON COLUMN events.checkin_token IS '掲示QR用の固定トークン。phase=checkin の間のみ有効(7-3)';
COMMENT ON COLUMN events.finished_at IS '30分削除バッチの起点';

-- 2-b. 一斉キック同期用の公開ステート。参加者が唯一 SELECT できるテーブルで、個人情報を一切持たない
CREATE TABLE event_states (
    event_id   UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    phase      VARCHAR(30) NOT NULL DEFAULT 'draft',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT event_states_phase_check CHECK (phase IN (
        'draft','checkin','browse','like_vote','like_reveal','final_vote','calculating','result','purged'
    ))
);

-- 2-c. 参加者番号の採番カウンタ。イベント作成時に male/female の2行を必ず先に作る(6-4)
CREATE TABLE participant_counters (
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    gender      VARCHAR(10) NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (event_id, gender),
    CONSTRAINT participant_counters_gender_check CHECK (gender IN ('male','female'))
);

-- 2-d. イベント別データ鍵(crypto-shredding 用)。purge 時に破棄する
--
-- ★制約の明示: このテーブルは暗号文と同じデータベースにあるため、
--   「DBのバックアップを丸ごと復元する」攻撃者に対しては鍵破棄が効かない。
--   真の crypto-shredding には鍵を DB 外(KMS / 外部KV)へ置く必要がある。
--   MVP では PITR 無効・日次バックアップ7日保持(7-4)と併せて運用し、
--   鍵ストアの実装は _shared/key-store.ts の EventKeyStore で差し替え可能にしてある。
CREATE TABLE event_keys (
    event_id   UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    data_key   BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 参加者プロフィール(30分後に物理削除)。外部キー制約はあえて付けず独立させる
CREATE TABLE participants (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           UUID NOT NULL,
    gender             VARCHAR(10) NOT NULL,
    participant_number INTEGER,
    status             VARCHAR(20) NOT NULL DEFAULT 'invited',
    nickname           VARCHAR(50),
    profile_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    free_text          TEXT,
    session_token      TEXT NOT NULL UNIQUE,
    is_proxy           BOOLEAN NOT NULL DEFAULT FALSE,
    agreed_at          TIMESTAMPTZ,
    checked_in_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT participants_gender_check CHECK (gender IN ('male','female')),
    CONSTRAINT participants_status_check CHECK (status IN ('invited','active','withdrawn')),
    CONSTRAINT unique_event_gender_number UNIQUE (event_id, gender, participant_number)
);
CREATE INDEX idx_participants_event ON participants(event_id);
CREATE INDEX idx_participants_event_status ON participants(event_id, status);
COMMENT ON COLUMN participants.participant_number IS 'チェックイン確定時にトランザクション内で採番(6-4)。事前入力段階では NULL';
COMMENT ON COLUMN participants.free_text IS 'イベント別鍵で暗号化した base64 文字列を格納(7-4)。連絡先の記入はサーバ側でブロック(11-1)';
COMMENT ON TABLE  participants IS '連絡先カラムを持たないこと。アプリは連絡先を保持・表示・仲介しない(11-1)';

-- 4. 投票(30分後に物理削除)
CREATE TABLE votes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL,
    from_participant_id UUID NOT NULL,
    to_participant_id   UUID NOT NULL,
    vote_type           VARCHAR(20) NOT NULL,
    preference_order    INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT votes_type_check CHECK (vote_type IN ('like','final')),
    CONSTRAINT votes_self_check CHECK (from_participant_id <> to_participant_id),
    CONSTRAINT votes_order_check CHECK (
        (vote_type = 'final' AND preference_order BETWEEN 1 AND 3)
        OR (vote_type = 'like' AND preference_order IS NULL)
    ),
    CONSTRAINT unique_vote UNIQUE (event_id, from_participant_id, to_participant_id, vote_type)
);
CREATE INDEX idx_votes_event ON votes(event_id);
CREATE INDEX idx_votes_to ON votes(event_id, to_participant_id, vote_type);
-- 同一人物が同じ希望順位を2人に付けられないようにする
CREATE UNIQUE INDEX uq_final_preference ON votes(event_id, from_participant_id, preference_order)
    WHERE vote_type = 'final';

-- 5. マッチング結果(30分後に物理削除)
CREATE TABLE matches (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id              UUID NOT NULL,
    male_participant_id   UUID NOT NULL,
    female_participant_id UUID NOT NULL,
    score                 INTEGER NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_match_male UNIQUE (event_id, male_participant_id),
    CONSTRAINT unique_match_female UNIQUE (event_id, female_participant_id)
);
CREATE INDEX idx_matches_event ON matches(event_id);

-- 6. 主催者向け匿名統計(永続保存・個人情報ゼロ)
CREATE TABLE event_analytics (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id              UUID UNIQUE NOT NULL,
    organizer_id          UUID NOT NULL,
    total_male_count      INTEGER NOT NULL DEFAULT 0,
    total_female_count    INTEGER NOT NULL DEFAULT 0,
    withdrawn_count       INTEGER NOT NULL DEFAULT 0,
    matched_pairs_count   INTEGER NOT NULL DEFAULT 0,
    match_rate            NUMERIC(5,2),
    like_vote_count       INTEGER NOT NULL DEFAULT 0,
    one_sided_pairs_count INTEGER NOT NULL DEFAULT 0,
    duration_minutes      INTEGER,
    attributes_summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_analytics_organizer ON event_analytics(organizer_id);
COMMENT ON COLUMN event_analytics.attributes_summary IS
    '該当者3名未満のカテゴリは "other" に丸めて格納すること(個人特定の防止)';
COMMENT ON COLUMN event_analytics.one_sided_pairs_count IS
    '片側指名のみで不成立になった組の数。相互指名限定(5-1)の方針を後から検証するための指標';

-- 7. 主催者の破壊的操作の監査ログ(永続・個人情報を含めない)
CREATE TABLE organizer_audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id UUID NOT NULL,
    event_id     UUID NOT NULL,
    action       VARCHAR(50) NOT NULL,
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_event ON organizer_audit_logs(event_id);
COMMENT ON TABLE organizer_audit_logs IS 'detail には参加者番号までを許容し、ニックネーム・自由記述は入れないこと';
