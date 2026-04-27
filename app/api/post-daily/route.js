import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

// 明日の日付（JST）
function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

// Geminiで1つの投稿文を生成
async function generateTweet(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
  const text = data.candidates[0].content.parts[0].text.trim();
  return text.replace(/\n/g, ' ').trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    const dateLabel = getTomorrowLabel();

    const prompts = {
      flower: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「花畑ミゴロン指数【${dateLabel}】」で必ず始めること
- おすすめ花スポットを3件（実在する日本の名所）
- 各スポットに絵文字とミゴロン指数（XX%）を付ける
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 合計100文字以内で出力すること
- ハッシュタグ3個を最後に
- 必ず日本語で出力すること
- 投稿文のみ出力（説明・前置き不要）

出力例：
花畑ミゴロン指数【4月28日】 🌸高遠城址公園(95%) 🌼ひたち海浜公園(90%) 🌷あしかがフラワーパーク(85%) #花撮影 #風景写真 #ミゴロン`,

      cloud_sea: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「雲海ミゴロン指数【${dateLabel}】」で必ず始めること
- おすすめスポットを3件（実在する日本の山・高原）
- 各スポットにミゴロン指数（XX%）を付ける
- ゴールデンタイム（早朝4〜6時）を明記
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 合計100文字以内で出力すること
- ハッシュタグ3個を最後に
- 必ず日本語で出力すること
- 投稿文のみ出力（説明・前置き不要）

秩父が含まれる場合の補正ルール：
- 迷った時は確率を5〜10%低めに保守的に丸める
- 前夜21時の湿度が85%未満なら強制的に30%以下に下方修正
- 風速2m/s以上が1時間でもある場合は判定を1ランク下げる
- 露点温度と最低気温の差が2度以内なら「濃い雲海」または「夜景が透ける薄い雲海」を明記
- 4〜5月の雨上がり翌朝のみ例外的に+10%上方修正可

出力例：
雲海ミゴロン指数【4月28日】 ☁️高ボッチ高原(75%) ☁️山中湖パノラマ台(65%) ☁️秩父美の山公園(50%)濃い雲海期待 ⏰4:00〜6:00がベスト #雲海予報 #絶景 #ミゴロン`,

      fujisan: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「富士山ミゴロン指数【${dateLabel}】」で必ず始めること
- その日の撮影条件から指数の高いスポットを3件選ぶ（富士山周辺の実在する場所）
- 各スポットにミゴロン指数（XX%）を付ける
- 最良撮影時間帯を明記
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 合計100文字以内で出力すること
- ハッシュタグ3個を最後に
- 必ず日本語で出力すること
- 投稿文のみ出力（説明・前置き不要）

出力例：
富士山ミゴロン指数【4月28日】 🗻河口湖畔(90%) 🗻田貫湖(85%) 🗻山中湖パノラマ台(75%) ⏰5:00〜7:00がベスト #富士山 #風景写真 #ミゴロン`,
    };

    // Geminiで3つ生成（直列）
    const flowerTweet   = await generateTweet(API_KEY, prompts.flower);
    const cloudSeaTweet = await generateTweet(API_KEY, prompts.cloud_sea);
    const fujisanTweet  = await generateTweet(API_KEY, prompts.fujisan);

    // X投稿（2秒間隔）
    const xClient = new TwitterApi({
      appKey:      process.env.X_API_KEY,
      appSecret:   process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret:process.env.X_ACCESS_SECRET,
    });

    const results = {};
    for (const [key, text] of [
  ['cloud_sea', cloudSeaTweet],
  ['fujisan',   fujisanTweet],
  ['flower',    flowerTweet],
]) {
      try {
        await xClient.v2.tweet(text);
        results[key] = { ok: true, tweet: text };
      } catch (err) {
        results[key] = { ok: false, error: err.message };
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({
      message: 'Success',
      date: dateLabel,
      results
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      error: error.message,
      detail: "エラーが発生しました。APIキーやモデル設定を確認してください。"
    }), { status: 500 });
  }
}
