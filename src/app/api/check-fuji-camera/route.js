// app/api/check-fuji-camera/route.js
// 富士山指数の「実際に見えたか」をライブカメラで判定する（毎朝8:20 JST）。投稿はしない。
//   今日が対象日の富士山の予測ログ（前日21:15の投稿分）に、カメラごとの判定を
//   割り当てたスポットの rec.actual として記録する。判定方法は _lib/fuji-cameras.js。
//
//   ?key=CRON_SECRET  : ブラウザから実行する際のクエリ認証（Bearerでも可）
//   ?dry=1            : 判定だけして保存しない
//   ?debug=1          : 判定せず、各カメラページ内の画像URL一覧を返す（imagePattern設定用）
//   ?date=YYYY-MM-DD  : 記録先の対象日（既定は今日）
import { recordJobStatus } from '../../../lib/job-status';
import { readPredictionRecord, saveActualObservation } from '../../../lib/prediction-log';
import { FUJI_CAMERAS, findCameraImage, judgeFujiVisibility } from '../_lib/fuji-cameras';
import { jstDateString } from '../_lib/migoron-scoring';
import { shortSpotName } from '../_lib/migoron-format';
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

  const respond = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: jsonHeaders });

  if (url.searchParams.get('debug') === '1') {
    const cameras = await Promise.all(FUJI_CAMERAS.map(async (c) => {
      try {
        const { imageUrl, images } = await findCameraImage(c);
        return { id: c.id, page: c.page, imagePattern: c.imagePattern, imageUrl, images };
      } catch (e) {
        return { id: c.id, page: c.page, error: e.message };
      }
    }));
    return respond({ message: 'debug（判定・保存していません）', cameras });
  }

  const dryRun = url.searchParams.get('dry') === '1';
  const dateParam = url.searchParams.get('date');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : jstDateString(0);

  try {
    const rec = await readPredictionRecord('fuji', date);
    const results = [];
    for (const camera of FUJI_CAMERAS) {
      const r = { camera: camera.id, label: camera.label };
      results.push(r);
      if (!camera.imagePattern) { r.status = 'skip: カメラ画像の指定(imagePattern)が未設定'; continue; }
      try {
        const { imageUrl } = await findCameraImage(camera);
        if (!imageUrl) throw new Error('ページ内にカメラ画像が見つからない');
        r.imageUrl = imageUrl;
        Object.assign(r, await judgeFujiVisibility(imageUrl, process.env.GEMINI_API_KEY));
        if (r.seen === null) { r.status = 'skip: 判定不能（夜間・故障など）'; continue; }

        // このカメラに割り当てたスポットへ記録する
        r.spots = [];
        if (rec) {
          rec.items.forEach((it, i) => {
            if (!camera.spots.includes(shortSpotName(it.name))) return;
            r.spots.push(it.name);
          });
          if (!dryRun) {
            for (const [i, it] of rec.items.entries()) {
              if (!camera.spots.includes(shortSpotName(it.name))) continue;
              await saveActualObservation('fuji', date, i, r.seen, {
                source: 'camera', camera: camera.label, visibility: r.visibility, reason: r.reason,
              });
            }
          }
        }
        r.status = rec ? (r.spots.length ? 'ok' : 'ok: 割り当てスポットが予測にない') : 'ok: この日の予測ログなし';
      } catch (e) {
        r.status = 'error: ' + e.message;
      }
    }

    if (!dryRun) {
      const errors = results.filter((r) => String(r.status).startsWith('error'));
      await recordJobStatus('fuji_camera', {
        main: errors.length ? { カメラ判定: `${errors[0].camera} ${errors[0].status}` } : { カメラ判定: 'ok' },
        note: results.map((r) => `${r.camera}: ${r.visibility || r.status}`).join(' / '),
      });
    }
    return respond({ message: dryRun ? 'Dry run（保存していません）' : 'Done', date, hasPrediction: !!rec, results });
  } catch (error) {
    if (!dryRun) await recordJobStatus('fuji_camera', { fatalError: error.message });
    return respond({ error: error.message }, 500);
  }
}
