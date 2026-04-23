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
      generationConfig: { temperature: 0.8, maxOutputTokens: 300 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
  return data.candidates[0].content.parts[0].text.trim();
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
      flower: `あなたはプロ風景写真家・ジェイクのSNS担当です。
X（Twitter）投稿文を1つだけ作成してください。

条件：
- 「${dateLabel}に行くべき花スポット」の文脈
- おすすめスポットを3〜4件リストアップ（実在する日本の名所）
- 各スポットに一言コメント
- プロカメラマン視点のフォトインサイト（機材・構図）を1つ
- 140文字以内、絵文字使用
- 末尾にハッシュタグ3〜5個（#花撮影 #風景写真 #カメラ好き など）
- 投稿文のみ出力（説明・前置き不要）`,

      cloud_sea: `あなたはプロ風景写真家・ジェイクのSNS担当です。
X（Twitter）投稿文を1つだけ作成してください。

条件：
- 「${dateLabel}の雲海撮影予報」の文脈
- おすすめスポットを3〜4件（実在する日本の山・高原）
- 撮影成功確率をスコアで表示（例：成功率80%）
- ゴールデンタイム（早朝4〜6時）を明記
- プロカメラマン視点のフォトインサイトを1つ
- 140文字以内、絵文字使用
- 末尾にハッシュタグ3〜5個（#雲海 #風景写真 #早起き など）

【秩父が含まれる場合の必須補正ルール】
1. 迷った時は確率を5〜10%低めに保守的に丸める（空振りペナルティ重視）
2. 前夜21時の湿度が85%未満なら強制的に30%以下に下方修正
3. 風速2m/s以上が1時間でもある場合は判定を1ランク下げる
4. 露点温度と最低気温の差が2℃以内なら雲海の「質」を明記
   - 差0℃に近い→「街を飲み込む濃い雲海」
   - 差2℃に近い→「夜景が透ける薄い雲海」
5. 4〜5月の雨上がり翌朝のみ例外的に+10%上方修正可

- 投稿文のみ出力（説明・前置き不要）`,

      fujisan: `あなたはプロ風景写真家・ジェイクのSNS担当です。
X（Twitter）投稿文を1つだけ作成してください。

条件：
- 「${dateLabel}の富士山ビュースポット予報」の文脈
- おすすめスポットを3〜4件（河口湖・山中湖・本栖湖など実在する場所）
- スコアに基づく星評価（⭐〜⭐⭐⭐⭐⭐）
- 最良撮影時間帯を明記
- 140文字以内、絵文字使用
- 末尾にハッシュタグ3〜5個（#富士山 #富士山写真 #風景写真 など）
- 投稿文のみ出力（説明・前置き不要）`,
    };

    // Geminiで3つ生成（直列：レート制限対策）
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
      ['flower',    flowerTweet],
      ['cloud_sea', cloudSeaTweet],
      ['fujisan',   fujisanTweet],
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
