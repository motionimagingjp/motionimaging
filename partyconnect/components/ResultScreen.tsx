'use client';
import type { ResultPayload } from '../lib/api';
import Countdown from './Countdown';

/**
 * 結果表示（仕様 4-1⑥）。
 * ★成立しても連絡先は表示しない。アプリは連絡先を保持していない。
 *   交換は会場で当人同士が対面で行い、主催者が成立ペアを呼び出す。
 */
export default function ResultScreen({ result }: { result: ResultPayload }) {
  if (result.status === 'purged') {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>データの消去が完了しました</h2>
        <p>
          本日入力いただいたプロフィールおよび投票データは、すべて消去されました。
          ご参加ありがとうございました。
        </p>
      </div>
    );
  }

  if (result.status === 'unmatched') {
    return (
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>ご参加ありがとうございました！</h2>
          <p>
            本日のパーティーの集計が完了いたしました。今回はあいにくマッチング成立となりませんでしたが、
            素敵な出会いのきっかけとなっていれば幸いです。
          </p>
          <p className="muted">
            ※参加者の個人情報保護のため、本日入力いただいたプロフィールおよび投票データは
            30分後に自動的に安全に消去されます。
          </p>
        </div>
        <div className="card">
          <p className="muted" style={{ textAlign: 'center', margin: '0 0 6px' }}>消去まで</p>
          <Countdown deadline={result.purgeAt} />
        </div>
      </div>
    );
  }

  const partnerLabel = result.partner.gender === 'male' ? '男性' : '女性';
  return (
    <div>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>マッチング成立です！</h2>
        <div className={`big-number ${result.partner.gender}`} style={{ marginTop: 12 }}>
          <div className="label">{partnerLabel}</div>
          <div className="value">No.{result.partner.number}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{result.partner.nickname ?? ''}</div>
        </div>
      </div>

      <div className="card">
        <div className="notice">
          <strong>会場でお相手と合流して、連絡先を直接交換してください。</strong>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          当サービスは連絡先をお預かりしていません。番号をお呼びしますので、
          お相手と会ってからご自身で交換をお願いします。
        </p>
      </div>

      <div className="card">
        <p className="muted" style={{ textAlign: 'center', margin: '0 0 6px' }}>
          この画面が消えるまで
        </p>
        <Countdown deadline={result.purgeAt} />
        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          プロフィールと投票データは自動的に消去されます
        </p>
      </div>
    </div>
  );
}
