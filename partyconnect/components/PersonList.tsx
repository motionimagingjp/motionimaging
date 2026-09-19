'use client';
import { useMemo, useState } from 'react';
import type { ParticipantCard } from '../lib/api';
import { labelOf } from '../lib/profile-options';

type SelectMode = 'none' | 'like' | 'final';

interface Props {
  participants: ParticipantCard[];
  selfGender: 'male' | 'female';
  mode: SelectMode;
  selected: number[];
  onToggle: (number: number) => void;
  showStars: boolean;
}

/**
 * 閲覧一覧。100人規模を前提に、番号ジャンプ検索を必ず用意する（仕様 4-1③）。
 * ★表示されるのは異性のみ。サーバー側で同性は返していないため、男女の切替タブは持たない。
 *   （同性を混ぜると男女で番号が重複し、好印象の★が別人に付いてしまう）
 * 辞退者はサーバー側で除外済み。
 */
export default function PersonList({
  participants, selfGender, mode, selected, onToggle, showStars,
}: Props) {
  const oppositeGender = selfGender === 'male' ? 'female' : 'male';
  const [jump, setJump] = useState('');

  const visible = useMemo(() => {
    const wanted = Number.parseInt(jump, 10);
    if (!Number.isNaN(wanted)) {
      return participants.filter((p) => String(p.number).startsWith(String(wanted)));
    }
    return participants;
  }, [participants, jump]);

  return (
    <div>
      <p className="notice" style={{ marginTop: 0 }}>
        {oppositeGender === 'male' ? '男性' : '女性'} {participants.length}名
      </p>

      <label htmlFor="jump">番号でさがす</label>
      <input
        id="jump"
        inputMode="numeric"
        placeholder="例: 12"
        value={jump}
        onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
      />

      <div className="grid" style={{ marginTop: 14 }}>
        {visible.map((p) => {
          const order = selected.indexOf(p.number);
          return (
            <button
              type="button"
              key={`${p.gender}-${p.number}`}
              className={`person ${p.gender}`}
              aria-pressed={order >= 0}
              disabled={mode === 'none'}
              onClick={() => onToggle(p.number)}
            >
              {p.photoUrl && (
                <img src={p.photoUrl} alt="" style={{
                  width: '100%', aspectRatio: '1 / 1', objectFit: 'cover',
                  borderRadius: 'var(--radius)', marginBottom: 6,
                }} />
              )}
              <div className="no">No.{p.number}</div>
              {showStars && p.likedMe && <div className="star">★ 好印象!</div>}
              {mode === 'final' && order >= 0 && (
                <div className="star">第{order + 1}希望</div>
              )}
              {mode === 'like' && order >= 0 && <div className="star">選択中</div>}
              <div className="nick">{p.nickname ?? '（未入力）'}</div>
              <div className="free">
                {Object.entries(p.profile).slice(0, 3)
                  .map(([k, v]) => labelOf(k, v)).join(' / ')}
              </div>
              {p.freeText && <div className="free">{p.freeText}</div>}
            </button>
          );
        })}
      </div>

      {visible.length === 0 && <p className="muted">該当する方がいません。</p>}
    </div>
  );
}
