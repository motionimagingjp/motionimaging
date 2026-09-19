-- 「投票した」ことと「votesテーブルに行がある」ことを分離する。
--
-- submit_vote は0人選択（誰も選ばない）を許可しているが、0件なら votes に1行も
-- INSERT されないため、「0人で送信済み」と「まだ一度も送信していない」が
-- 区別できず、主催者の進捗表示が永遠に「未投票」のまま止まる不具合があった
-- （実際に発生：全員投票済みなのに1名だけ未投票と表示された）。
--
-- 対策として、送信した事実そのものを participants に直接記録する。
-- votes の中身（誰に投票したか）とは独立させ、進捗表示はこちらだけを見る。
ALTER TABLE participants ADD COLUMN like_voted_at TIMESTAMPTZ;
ALTER TABLE participants ADD COLUMN final_voted_at TIMESTAMPTZ;
COMMENT ON COLUMN participants.like_voted_at IS
    '好印象投票を送信した時刻。0人選択でも送信していれば記録する（未投票との区別のため）';
COMMENT ON COLUMN participants.final_voted_at IS
    '最終希望投票を送信した時刻。同上';

-- 既存データの補完: 実際に投票行がある人は、その最初の投票時刻を入れておく
-- （0人送信だった人はこの方法では救えないが、今後の送信からは正しく記録される）
UPDATE participants p SET like_voted_at = sub.first_voted_at
  FROM (
    SELECT from_participant_id, MIN(created_at) AS first_voted_at
      FROM votes WHERE vote_type = 'like' GROUP BY from_participant_id
  ) sub
 WHERE p.id = sub.from_participant_id AND p.like_voted_at IS NULL;

UPDATE participants p SET final_voted_at = sub.first_voted_at
  FROM (
    SELECT from_participant_id, MIN(created_at) AS first_voted_at
      FROM votes WHERE vote_type = 'final' GROUP BY from_participant_id
  ) sub
 WHERE p.id = sub.from_participant_id AND p.final_voted_at IS NULL;
