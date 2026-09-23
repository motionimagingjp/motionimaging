// JONGJIN 自動投稿（Vercel Cron: 月・水・金 19:00 JST）
//   ?key=CRON_SECRET          ブラウザから手動実行
//   ?key=CRON_SECRET&dry=1    投稿せず内容だけ確認（Redisも更新しない）
//   ?key=CRON_SECRET&force=1  同日二重投稿チェックを無視
import { Redis } from '@upstash/redis';
import posts from '../../../content/posts.json';
import { nextCategory, orderCandidates, remainingUnused, buildCaption } from '../../../lib/pick.js';
import { fetchTokyoWeather, pickWeatherLine } from '../../../lib/weather.js';
import { postToInstagram, postToThreads, notify } from '../../../lib/sns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const K = {
  lastCategory: 'jj:lastCategory',
  usedAt: 'jj:usedAt',          // hash: postId -> 投稿時刻
  postedDate: 'jj:postedDate',
  weatherRecent: 'jj:weatherRecent', // list: 直近の天気コメント
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function GET(request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const ok = secret && (request.headers.get('authorization') === `Bearer ${secret}` || url.searchParams.get('key') === secret);
  if (!ok) return new Response('Unauthorized', { status: 401 });

  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const jst = new Date(Date.now() + 9 * 3600000);
  const today = jst.toISOString().slice(0, 10);
  const base = (process.env.SITE_URL || url.origin).replace(/\/$/, '');

  try {
    if (!dry && !force && (await redis.get(K.postedDate)) === today) {
      return json({ message: '本日投稿済みのためスキップ' });
    }

    const category = nextCategory(await redis.get(K.lastCategory));
    const usedAt = (await redis.hgetall(K.usedAt)) || {};

    // 画像が実在する最初の候補を採用（未配置の画像は飛ばす）
    let post = null;
    let imageUrl = null;
    for (const p of orderCandidates(posts, category, usedAt, jst.getUTCMonth() + 1)) {
      const u = `${base}/images/${p.image}`;
      const head = await fetch(u, { method: 'HEAD' }).catch(() => null);
      if (head?.ok) { post = p; imageUrl = u; break; }
    }
    if (!post) {
      await notify(`カテゴリ「${category}」に投稿できる画像がありません。public/images/${category}/ を確認してください`);
      return json({ error: `no image for ${category}` }, 500);
    }

    let weather = null;
    if (category === 'out') {
      const recent = (await redis.lrange(K.weatherRecent, 0, 9)) || [];
      try {
        weather = pickWeatherLine(await fetchTokyoWeather(), recent);
      } catch (e) {
        // 天気が取れなくても投稿は止めない
        await notify(`天気取得に失敗、天気コメントなしで投稿します: ${e.message}`);
      }
    }
    const caption = buildCaption(post, weather?.line);

    if (dry) return json({ dry: true, category, postId: post.id, imageUrl, weather, caption });

    const igId = await postToInstagram(imageUrl, caption);

    // IG成功後に状態を確定（Threads失敗で二重投稿しないように先に保存）
    await redis.set(K.postedDate, today, { ex: 86400 });
    await redis.set(K.lastCategory, category);
    await redis.hset(K.usedAt, { [post.id]: Date.now() });
    if (weather) {
      await redis.lpush(K.weatherRecent, weather.line);
      await redis.ltrim(K.weatherRecent, 0, 9);
    }

    let threadsId = null;
    try {
      threadsId = await postToThreads(imageUrl, caption);
    } catch (e) {
      await notify(`Threads投稿に失敗（Instagramは成功）: ${e.message}`);
    }

    const left = remainingUnused(posts, category, { ...usedAt, [post.id]: 1 });
    if (left <= 1) {
      await notify(`「${category}」の未投稿画像が残り${left}枚です。補充がなければ古い順に再利用します`);
    }

    return json({ message: 'Success', category, postId: post.id, igId, threadsId, caption, left });
  } catch (e) {
    await notify(`投稿エラー: ${e.message}`);
    return json({ error: e.message }, 500);
  }
}
