'use client';
import { useEffect, useState } from 'react';

/** 消去までの残り時間。端末の時計ずれがあっても負の値は出さない */
export default function Countdown({ deadline }: { deadline: string }) {
  const target = Date.parse(deadline);
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [target]);

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="countdown">
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  );
}
