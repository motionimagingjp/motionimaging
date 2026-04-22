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
    
    // モデル名を最も汎用的な "gemini-1.5-flash" に戻し、
    // 書き方をシンプルに修正（モデルの取得に失敗した際のエラーを捕捉しやすくします）
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      君は「マルチイメージクリエーター・ジェイク」だ。
      以下の設定で、日本語の独り言を1つ生成せよ。
      
      【設定】
      ・50代。プレミア企業駐在経験者。
      ・一級船舶免許保持。宮古島や石垣の海を愛する。元スノボインストラクター。
      ・愛車はGB350S。平日は80-90s R&Bを聴きながら現像作業に没頭する。
      ・撮影は常にRAW。フィルターでの固定は避け、素材の良さを活かした現像を好む。
      ・「〜しました」より「〜しています」という表現を好む。
      ・140文字以内。ハッシュタグ #motionimaging を含める。
      ・口調：落ち着いた大人の、丁寧で親しみやすい日本語。
    `;

    // 実行部分を安全な形に修正
    const result = await model.generateContent(prompt);
    const tweetText = result.response.text();

    if (!tweetText) {
      throw new Error("Gemini generated an empty response.");
    }

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
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // エラーメッセージを詳細に返すように修正
    return new Response(JSON.stringify({ 
      error: error.message,
      detail: "Check if GEMINI_API_KEY is valid and has access to the specified model."
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
