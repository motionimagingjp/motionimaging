import { TwitterApi } from 'twitter-api-v2';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 【重要】ここに、先ほど AI Studio で新しく作ったキー（AIza...）を「直接」貼り付けてください
    // テストが終わったら消すので、一度だけこの「直書き」で強行突破します。
    const apiKey = "AIzaSyD6ZdH0z8Sm-yYYrraSlNpWPCVzbddvRZg"; 
    
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // モデル名を最も汎用的な「gemini-1.5-flash」に固定
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = "マルチイメージクリエーター・ジェイクとして、大人の独り言を60文字程度で生成してください。#motionimaging を含む。";

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const tweetText = response.text();

    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await client.v2.tweet(tweetText.trim());

    return new Response(JSON.stringify({ message: 'Success', tweet: tweetText.trim() }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
