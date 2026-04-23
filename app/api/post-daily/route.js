import { TwitterApi } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  // Vercel Cronからの認証チェック
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 【最重要】ここをご自身のAPIキー（AIza...）に書き換えてください
    const API_KEY = process.env.GEMINI_API_KEY;
    
    // Google Gemini APIを叩く（最新の v1beta 窓口を直接指定）
    // ✅ models/ を二回重ねず、かつモデル名に -latest を付けないのが「v1beta」の正解です
// ✅ 1.5-flash ではなく、無印の「gemini-pro」にします
const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [{ 
            text: "マルチイメージクリエーター・ジェイクとして、50代の大人の余裕を感じさせる独り言を80文字以内で生成してください。末尾に必ず #motionimaging を含めてください。" 
          }] 
        }]
      })
    });

    const data = await geminiResponse.json();
    
    if (data.error) {
      throw new Error(`Gemini Error: ${data.error.message}`);
    }

    // 生成されたテキストを取得
    const tweetText = data.candidates[0].content.parts[0].text.trim();

    // X (Twitter) APIの設定（環境変数から読み込み）
    const xClient = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    // 【是正ポイント】プロフィール更新ではなく、確実に「ツイート」として投稿
    await xClient.v2.tweet(tweetText);

    return new Response(JSON.stringify({ 
      message: 'Success', 
      tweet: tweetText 
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ 
      error: error.message,
      detail: "エラーが発生しました。APIキーやモデル設定を確認してください。"
    }), { status: 500 });
  }
}
