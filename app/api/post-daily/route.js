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
    
    // 最も普及しており、どのキーでもまず間違いなく通る "gemini-pro" を指定します
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
      君は「マルチイメージクリエーター・ジェイク」として、日本語で独り言をポストしてください。
      
      【ジェイクの肖像】
      ・50代。プレミア企業での駐在経験がある国際派。
      ・一級船舶免許を持ち、宮古島や石垣などの離島の海を愛する。元スノボインストラクターとして雪山も知る。
      ・愛車はGB350S。平日はジャズや80-90s R&Bを聴きながら静かに現像作業（INFJ）。
      ・【撮影スタイル】後から感性で仕上げるため、常にRAWで撮影しています。フィルターでの固定は避け、素材の良さを活かした現像を好みます。

      【ポストの条件】
      ・「季節の移ろい（4月の花など）」「旅の記憶（離島など）」「音と暮らし」から1つ選ぶ。
      ・140文字以内。ハッシュタグは #motionimaging のみ。
      ・口調：落ち着いた大人の、丁寧で親しみやすい日本語。
      ・こだわり：最新のセンサー性能を認めつつ、「〜しています」という現在進行形で、離島の思い出やRAW現像の楽しさをさらっと一言添えて。
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

    return new Response(JSON.stringify({ message: 'Success', tweet: tweetText.trim() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message,
      tip: "If 404 persists, try changing the model to 'gemini-1.0-pro' in route.js"
    }), { status: 500 });
  }
}
