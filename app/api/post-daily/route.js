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
    
    // ここを最も基本的な指定方法に変更します
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      マルチイメージクリエーター・ジェイクとして、大人の独り言を1つ生成してください。
      条件：50代、国際派、宮古・石垣の海、RAW撮影へのこだわり、丁寧な日本語、140文字以内、#motionimaging を含む。
    `;

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
    // エラーが出た場合、Jakeさんに「どのURLで404が出たか」を正確に報告させます
    return new Response(JSON.stringify({ 
      error_message: error.message,
      help: "Google AI Studioで新しいAPIキーを作成し、'Pay-as-you-go'プラン（無料枠あり）が有効か確認してください。"
    }), { status: 500 });
  }
}
