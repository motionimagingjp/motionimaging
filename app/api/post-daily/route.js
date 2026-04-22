import { TwitterApi } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 【重要】ご自身のAPIキー（AIza...）をここに貼り付け
    const API_KEY = "AIzaSyD6ZdH0z8Sm-yYYrraSlNpWPCVzbddvRZg";
    
    // モデル名を、最も確実に存在する「gemini-pro」に変更します
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
    
    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "マルチイメージクリエーター・ジェイクとして、大人の独り言を100文字以内で生成してください。末尾に #motionimaging を付けてください。" }] }]
      })
    });

    const data = await geminiResponse.json();
    
    if (data.error) {
      throw new Error(`Gemini Error: ${data.error.message}`);
    }

    // AIからの回答を取り出す
    const tweetText = data.candidates[0].content.parts[0].text;

    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await client.v2.tweet(tweetText.trim());

    return new Response(JSON.stringify({ 
      message: 'Success', 
      tweet: tweetText.trim() 
    }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
