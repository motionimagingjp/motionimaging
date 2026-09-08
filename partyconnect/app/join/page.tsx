'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ParticipantApp from '../../components/ParticipantApp';

function Join() {
  const params = useSearchParams();
  return <ParticipantApp tokenFromUrl={params.get('t')} />;
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main><p className="muted">読み込み中…</p></main>}>
      <Join />
    </Suspense>
  );
}
