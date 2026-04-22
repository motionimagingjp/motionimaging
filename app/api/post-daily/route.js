import { TwitterApi } from 'twitter-api-v2';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    // ここで APIバージョンを明示的に指定しない（SDKに任せる）
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // AI Studioの「Gemini Flash Latest」に相当する最も確実な指定
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
    });

    const prompt = `
      マルチイメージクリエーター・ジェイクとして、大人の独り言を1つ生成してください。
      【条件】50代、国際派、宮古・石垣の海、RAW撮影へのこだわり、丁寧な日本語、140文字以内、#motionimaging を含む。
    `;

    // 呼び出しオプションを空にして、標準設定で叩く
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

    return new Response(JSON.stringify({ 
      message: 'Success', 
      tweet: tweetText.trim() 
    }), { status: 200 });

  } catch (error) {
    // エラーの詳細をより詳しく出すように修正
    return new Response(JSON.stringify({ 
      error_message: error.message,
      detail: "AI Studioで動いているなら、Vercelのキーが古い可能性があります。"
    }), { status: 500 });
  }
}
