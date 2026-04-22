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
    
    // フルパス指定「models/gemini-1.5-flash」に変更することで、V1 APIの認識エラーを回避します
    const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });

    const prompt = `
      君は「マルチイメージクリエーター・ジェイク」だ。
      以下の設定で、日本語の独り言を1つ生成せよ。
      
      【ジェイクの設定】
      ・50代。プレミア企業駐在経験がある国際派。
      ・一級船舶免許保持。宮古島や石垣の海を愛する。元スノボインストラクター。
      ・愛車はGB350S。平日は80-90s R&Bを聴きながら現像作業に没頭する。
      ・撮影は常にRAW。フィルターでの固定は避け、素材の良さを活かした現像を好む。
      ・140文字以内。ハッシュタグ #motionimaging を含める。
      ・口調：落ち着いた大人の、丁寧で親しみやすい日本語。
      ・内容：今の時期（4月）に咲く花と、離島の記憶やRAW現像の楽しさをさらっと。
    `;

    const result = await model.generateContent(prompt);
    const tweetText = result.response.text();

    if (!tweetText) throw new Error("Generated text is empty");

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
      fix_hint: "If still 404, the API Key might be limited to specific projects in Google Cloud."
    }), { status: 500 });
  }
}
