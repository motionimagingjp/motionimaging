import { TwitterApi } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  
  // Jakeさんが決めた合言葉のチェック
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });

  try {
    // まずは画像なしのテキスト投稿でテスト！
    const message = "motionimaging 自動投稿テスト成功！\nSystem is running smoothly. #motionimaging";
    await client.v2.tweet(message);

    return new Response(JSON.stringify({ message: 'Success' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('X Post Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
