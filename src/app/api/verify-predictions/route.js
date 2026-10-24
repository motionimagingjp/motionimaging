// app/api/verify-predictions/route.js
// ミゴロン指数の答え合わせ（改善指示書P4）。毎晩22:40 JSTに実行する。
//   対象日が昨日以前で未検証の予測を、Open-Meteoの過去値から同じ式で
//   再計算して「当たり／外れ」を記録する。投稿はしない。
//
//   ?key=CRON_SECRET  : ブラウザから実行する際のクエリ認証（Bearerでも可）
//   ?dry=1            : 検証結果を表示するだけで保存しない
//   ?report=1         : 検証は行わず、直近の的中率・Brierスコアを返す
//   ?days=7|28        : report=1の集計期間（既定7日）
import { recordJobStatus } from '../../../lib/job-status';
import {
  KINDS, verifyPendingPredictions, readPredictionRecords, summarizePredictions, buildReportText,
} from '../../../lib/prediction-log';
import { jstDateString } from '../_lib/migoron-scoring';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const url = new URL(request.url);
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  const authHeader = request.headers.get('authorization');
  const keyParam = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) return new Response('Unauthorized', { status: 401 });

  if (url.searchParams.get('report') === '1') {
    const days = [7, 28].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7;
    try {
      const records = await readPredictionRecords(days);
      const summary = summarizePredictions(records, jstDateString(-(days - 1)));
      return new Response(JSON.stringify({
        days, summary, kinds: KINDS, snsText: buildReportText(summary, days),
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun = url.searchParams.get('dry') === '1';
  try {
    const report = await verifyPendingPredictions({ dryRun });
    if (!dryRun) {
      await recordJobStatus('verify_predictions', {
        main: report.errors.length ? { 答え合わせ: `error: ${report.errors[0]}` } : { 答え合わせ: 'ok' },
        note: `検証 ${report.verifiedRecords}件` + (report.skipped.length ? ` / 実測なし ${report.skipped.length}件` : ''),
      });
    }
    return new Response(JSON.stringify({ message: dryRun ? 'Dry run（保存していません）' : 'Done', report }, null, 2),
      { status: 200, headers: jsonHeaders });
  } catch (error) {
    if (!dryRun) await recordJobStatus('verify_predictions', { fatalError: error.message });
    return new Response(JSON.stringify({ error: error.message }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
