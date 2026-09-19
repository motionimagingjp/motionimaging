'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** 掲示・チケット印刷用のQRコード表示。URLを都度クライアント側で画像化する */
export default function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!src) return <p className="muted">QR生成中…</p>;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QRコード"
      style={{ borderRadius: 8, background: '#fff', padding: 4 }}
    />
  );
}
