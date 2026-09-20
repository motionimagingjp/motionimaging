'use client';
import { useState } from 'react';
import PersonList from '../../components/PersonList';
import { mockLikeCards } from '../../qa/mock-likes';

/**
 * QA用の一時ページ。好印象を50件受け取った状態のUI（レイアウト崩れ・スクロール）を
 * 目視確認するためだけに存在する。Supabaseへの通信は一切行わない
 * （実際の参加者画面 ParticipantApp.tsx / list_participants には一切触れていない）。
 *
 * 確認が終わったら削除すること:
 *   - app/qa-mock-likes/ (このディレクトリごと)
 *   - qa/mock-likes.ts
 */
export default function QaMockLikesPage() {
  const [selected, setSelected] = useState<number[]>([]);
  const [memos, setMemos] = useState<Record<string, string>>({});

  return (
    <main>
      <div className="notice" style={{ marginBottom: 16 }}>
        QA用モック画面: 男性50名から好印象を受信した状態を再現しています。
        実際の通信は行っていません。
      </div>
      <h1>好印象のお知らせ（モック）</h1>
      <PersonList
        participants={mockLikeCards}
        selfGender="female"
        mode="none"
        selected={selected}
        onToggle={(n) => setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))}
        showStars
        memos={memos}
        onMemoChange={(key, text) => setMemos((prev) => {
          const next = { ...prev };
          if (text.trim() === '') delete next[key]; else next[key] = text;
          return next;
        })}
      />
    </main>
  );
}
