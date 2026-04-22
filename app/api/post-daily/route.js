import { TwitterApi } from 'twitter-api-v2';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // APIキーの読み込み（前後の空白を削除する処理を追加して安全性を高めました）
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Tier 1なら、最も高性能な 1.5-flash が確実に使えるはずです
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      マルチイメージクリエーター・ジェイクとして、大人の独り言を1つ生成してください。
      【条件】50代、国際派、宮古・石垣の海、RAW撮影へのこだわり、丁寧な日本語、140文字以内、#motionimaging を含む。
      【こだわり】「〜しました」より「〜しています」という表現を使ってください。
    `;

    // 最新の呼び出し形式
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const tweetText = response.text();

    if (!tweetText) throw new Error("Generated text is empty");

    // X API への投稿
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
    console.error("DEBUG ERROR:", error);
    return new Response(JSON.stringify({ 
      error_message: error.message,
      fix_tip: "VercelのGEMINI_API_KEYの値を、AI Studioの最新キーで再度『上書き保存』してからRedeployしてください。"
    }), { status: 500 });
  }
}
