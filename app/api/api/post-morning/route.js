
import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

function getSunriseUTC(date) {
  const lat = 35.6762, lng = 139.6503;
  const rad = Math.PI / 180;
  const N = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const B = 360 / 365 * (N - 81) * rad;
  const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declination = 23.45 * Math.sin(B) * rad;
  const hourAngle = Math.acos(-Math.tan(lat * rad) * Math.tan(declination)) / rad;
  const solarNoon = 12 - lng / 15 - EoT / 60;
  return solarNoon - hourAngle / 15;
}

function isNearSunrise() {
  const now = new Date();
  const sunriseUTC = getSunriseUTC(now);
  const nowHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  return Math.abs(nowHours - (sunriseUTC - 0.5)) <= 10 / 60;
}

function getTodayLabel() {
  const jst = new Date(Date.now() + 9 * 3600000);
  return `${jst.getMonth() + 1}月${jst.getDate()}日`;
}

function isSakuraSeason() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  return (m === 2) || (m === 3) || (m === 4 && d <= 15);
}

function getSeasonalFlowers() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const m = jst.getMonth() + 1;
  const d = jst.getDate();
  if (m === 1)            return ['水仙', '蝋梅'];
  if (m === 2)            return ['梅', '菜の花', '水仙'];
  if (m === 3)            return ['桜', '菜の花', '梅'];
  if (m === 4 && d <= 15) return ['桜', '菜の花', 'チューリップ'];
  if (m === 4 && d > 15)  return ['ネモフィラ', 'ツツジ', '藤', 'チューリップ'];
  if (m === 5)            return ['ネモフィラ', 'ツツジ', '藤', 'バラ'];
  if (m === 6)            return ['紫陽花', 'バラ', 'ポピー', 'ラベンダー'];
  if (m === 7)            return ['ひまわり', '蓮', 'ラベンダー'];
  if (m === 8)            return ['ひまわり', '蓮'];
  if (m === 9)            return ['彼岸花', 'コスモス'];
  if (m === 10)           return ['コスモス', '紅葉'];
  if (m === 11)           return ['紅葉', 'コスモス'];
  if (m === 12)           return ['水仙', '蝋梅'];
  return [];
}

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
  return data.candidates[0].content.parts[0].text.trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isNearSunrise()) {
    return new Response(JSON.stringify({ message: 'Skipped: not near sunrise' }), { status: 200 });
  }

  try {
    const dateLabel = getTodayLabel();
    const sakura = isSakuraSeason();
    const flowers = getSeasonalFlowers();

    const sakuraInstruction = sakura
      ? `【桜シーズン特別ルール】
今日は桜シーズン（2月〜4月15日）です。
2月1日を起算日として今日までの積算温度（日平均気温の合算）を推定し、以下の基準でミゴロン指数を算出すること。
開花目安：積算温度210℃（指数50%前後）
満開目安：積算温度370℃（指数90%以上）
関東・近郊の実在する桜の名所5件を選び、各地点の標高・地域差を考慮して指数に差をつけること。`
      : `【季節の花ルール】
今の時期（${dateLabel}）に関東・近郊で実際に見頃を迎えている花を選ぶこと。
今が旬の花：${flowers.join('、')}
上記の花が咲いている関東・近郊の実在する名所を5件選ぶこと。
積算温度の計算は不要。現在の季節感と一般的な開花情報からミゴロン指数を算出すること。`;

    const prompt = `あなたは風景写真家アカウント「ミゴロン」のSNS担当です。日の出30分前の高揚感を伝える、カメラマンに刺さる投稿文を作成してください。

${sakuraInstruction}

【投稿作成条件】
花畑指数【${dateLabel}】で必ず始めること
おすすめ花スポットを5件（関東・近郊の実在する名所のみ）
各スポットに絵文字とミゴロン指数（XX%）を付ける
指数が高い順に並べる
ミゴロンメモとして今日その場所がなぜおすすめかの理由（光の条件、空気感、見頃のタイミングなど）を1文で書く
マークダウン（**や##など）は使わない
箇条書き（・や-）は使わず1行ずつシンプルに並べる
ハッシュタグ3個（#花撮影 #風景写真 #ミゴロン）を最後に
カメラの技術設定（F値、SS、ISO等）のアドバイスは絶対禁止
投稿文のみ出力（前置き不要）`;

    const tweet = await generateTweet(process.env.GEMINI_API_KEY, prompt);

    const xClient = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });

    await xClient.v2.tweet(tweet);

    return new Response(JSON.stringify({ message: 'Success', tweet }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
