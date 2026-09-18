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
 * 閲覧一覧。100人規模を前提に、番号ジャンプ検索と男女タブを必ず用意する（仕様 4-1③）。
 * 辞退者はサーバ側で除外済み。
 */
export default function PersonList({
  participants, selfGender, mode, selected, onToggle, showStars,
}: Props) {
  const oppositeGender = selfGender === 'male' ? 'female' : 'male';
  const [tab, setTab] = useState<'male' | 'female'>(oppositeGender);
  const [jump, setJump] = useState('');

  const visible = useMemo(() => {
    const inTab = participants.filter((p) => p.gender === tab);
    const wanted = Number.parseInt(jump, 10);
    if (!Number.isNaN(wanted)) return inTab.filter((p) => String(p.number).startsWith(String(wanted)));
    return inTab;
  }, [participants, tab, jump]);

  const selectable = mode !== 'none' && tab === oppositeGender;

  return (
    <div>
      <div className="tabs">
        <button type="button" aria-pressed={tab === 'male'} onClick={() => setTab('male')}>
          男性 {participants.filter((p) => p.gender === 'male').length}名
        </button>
        <button type="button" aria-pressed={tab === 'female'} onClick={() => setTab('female')}>
          女性 {participants.filter((p) => p.gender === 'female').length}名
        </button>
      </div>

      <label htmlFor="jump">番号でさがす</label>
      <input
        id="jump"
        inputMode="numeric"
        placeholder="例: 12"
        value={jump}
        onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
      />

      {mode !== 'none' && tab !== oppositeGender && (
        <p className="muted" style={{ marginTop: 12 }}>
          選べるのは{oppositeGender === 'male' ? '男性' : '女性'}のみです。タブを切り替えてください。
        </p>
      )}

      <div className="grid" style={{ marginTop: 14 }}>
        {visible.map((p) => {
          const order = selected.indexOf(p.number);
          return (
            <button
              type="button"
              key={`${p.gender}-${p.number}`}
              className={`person ${p.gender}`}
              aria-pressed={order >= 0}
              disabled={!selectable || p.isSelf}
              onClick={() => onToggle(p.number)}
            >
              <div className="no">
                No.{p.number}
                {p.isSelf && <span className="muted" style={{ fontSize: 13 }}>（あなた）</span>}
              </div>
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
