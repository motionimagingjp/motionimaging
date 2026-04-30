import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getTomorrowLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  jst.setDate(jst.getDate() + 1);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

async function generateTweet(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2000 }
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
      flower: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「花畑指数【${dateLabel}】」で必ず始めること
- おすすめ花スポットを5件（実在する日本の名所）
- 各スポットに絵文字とミゴロン指数（XX%）を付ける
- 各スポットに1〜2文でおすすめポイント（見頃の状況、光の条件、空気感など）を書く
- 指数が高い順に並べる
- 最後に「ミゴロンメモ」として明日全体のおすすめ理由を1文でまとめる
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 各スポットを1行ずつシンプルに並べる
- 合計400〜450文字を目安に出力すること
- ハッシュタグ3個（#花撮影 #風景写真 #ミゴロン）を最後に
- 投稿文のみ出力（説明・前置き不要）`,

      cloud_sea: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「雲海指数【${dateLabel}】」で必ず始めること
- おすすめスポットを3件（実在する日本の山・高原）
- 各スポットにミゴロン指数（XX%）を付ける
- 各スポットに1〜2文でおすすめポイント（雲海の発生条件、狙い目の時間帯、地形の特徴など）を書く
- ゴールデンタイム（早朝4〜6時）を明記
- 最後に「ミゴロンメモ」として明日全体のコンディションを1文でまとめる
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 各スポットを1行ずつシンプルに並べる
- 合計280〜300文字を目安に出力すること
- ハッシュタグ3個（#雲海予報 #絶景 #ミゴロン）を最後に
- 投稿文のみ出力（説明・前置き不要）

秩父が含まれる場合の補正ルール：
- 迷った時は確率を5〜10%低めに保守的に丸める
- 前夜21時の湿度が85%未満なら強制的に30%以下に下方修正
- 風速2m/s以上が1時間でもある場合は判定を1ランク下げる
- 露点温度と最低気温の差が2度以内なら「濃い雲海」または「夜景が透ける薄い雲海」を明記
- 4〜5月の雨上がり翌朝のみ例外的に+10%上方修正可`,

      fujisan: `あなたはプロ風景写真家・ジェイクのSNS担当です。X（Twitter）投稿文を1つだけ日本語で作成してください。

条件：
- 「富士山指数【${dateLabel}】」で必ず始めること
- 撮影条件から指数の高いスポットを3件選ぶ（富士山周辺の実在する場所）
- 各スポットにミゴロン指数（XX%）を付ける
- 各スポットに1〜2文でおすすめポイント（光の条件、撮影アングル、季節感など）を書く
- 最良撮影時間帯を明記
- 最後に「ミゴロンメモ」として明日の富士山撮影全体のポイントを1文でまとめる
- マークダウン（**や##など）は使わないこと
- 箇条書きは使わないこと
- 各スポットを1行ずつシンプルに並べる
- 合計280〜300文字を目安に出力すること
- ハッシュタグ3個（#富士山 #風景写真 #ミゴロン）を最後に
- 投稿文のみ出力（説明・前置き不要）`,
    };

    const flowerTweet   = await generateTweet(API_KEY, prompts.flower);
    const cloudSeaTweet = await generateTweet(API_KEY, prompts.cloud_sea);
    const fujisanTweet  = await generateTweet(API_KEY, prompts.fujisan);

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
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
      detail: 'エラーが発生しました。'
    }), { status: 500 });
  }
}
