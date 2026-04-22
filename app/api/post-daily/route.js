import { TwitterApi } from 'twitter-api-v2';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // 最も確実なモデル名「gemini-1.0-pro」を直接指定します
    const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

    const prompt = "マルチイメージクリエーター・ジェイクとして、4月の花とRAW撮影の楽しさについて100文字程度で大人っぽく独り言を言って。 #motionimaging";

    const result = await model.generateContent(prompt);
    const tweetText = result.response.text();

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
    return new Response(JSON.stringify({ 
      error_detected: error.message,
      check: "これで404なら、APIキーを 'gemini-1.0-pro' が使えるものに作り直す必要があります"
    }), { status: 500 });
  }
}
