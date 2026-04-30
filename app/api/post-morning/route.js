import { TwitterApi } from 'twitter-api-v2';
export const dynamic = 'force-dynamic';

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

async function callGemini(apiKey, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 300,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  const parts = data.candidates[0].content.parts;
  const textPart = parts.find(p => p.text && !p.thought);
  return (textPart ? textPart.text : parts[parts.length - 1].text).trim();
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const dateLabel = getTodayLabel();
    const sakura = isSakuraSeason();
    const flowers = getSeasonalFlowers();

    const spots = sakura
      ? ['高遠城址公園（長野）', '吉野山（奈良）', '千鳥ヶ淵（東京）', '目黒川（東京）', '新宿御苑（東京）']
      : flowers.slice(0, 2).map(f => f + 'の名所');

    const seasonInfo = sakura
      ? '桜シーズン。2月1日からの積算温度で開花進捗を算出（開花210℃/満開370℃）。関東・近郊の桜名所5件。'
      : '今が旬の花：' + flowers.join('、') + '。関東・近郊の実在する名所5件を選ぶ。';

    const prompt = '以下の条件で花スポット5件のミゴロン指数を算出してください。\n'
      + '条件：' + seasonInfo + '\n'
      + '日付：' + dateLabel + '\n\n'
      + '必ず以下のJSON形式のみで返してください。マークダウン不要。\n'
      + '{"spots":[{"name":"ひたち海浜公園（茨城）","emoji":"🌼","score":95},{"name":"あしかがフラワーパーク（栃木）","emoji":"🌸","score":88},{"name":"昭和記念公園（東京）","emoji":"🌷","score":82},{"name":"国営武蔵丘陵森林公園（埼玉）","emoji":"🌿","score":75},{"name":"横浜公園（神奈川）","emoji":"🌺","score":68}],"memo":"今朝の光と空気感を一言で"}';

    const raw = await callGemini(process.env.GEMINI_API_KEY, prompt);
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    let spots2, memo;
    if (match) {
      const parsed = JSON.parse(match[0]);
      spots2 = parsed.spots;
      memo = parsed.memo;
    } else {
      spots2 = [
        { name: 'ひたち海浜公園（茨城）', emoji: '🌼', score: 95 },
        { name: 'あしかがフラワーパーク（栃木）', emoji: '🌸', score: 88 },
        { name: '昭和記念公園（東京）', emoji: '🌷', score: 82 },
        { name: '国営武蔵丘陵森林公園（埼玉）', emoji: '🌿', score: 75 },
        { name: '横浜公園（神奈川）', emoji: '🌺', score: 68 },
      ];
      memo = '朝の光が美しい季節です。';
    }

    const ranked = spots2.sort((a, b) => b.score - a.score);

    let tweet = '花畑指数【' + dateLabel + '】\n';
    for (const s of ranked) {
      tweet += s.emoji + ' ' + s.name + '(' + s.score + '%)\n';
    }
    tweet += 'ミゴロンメモ：' + memo + '\n';
    tweet += '#花撮影 #風景写真 #ミゴロン';

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
