// src/app/api/_lib/fuji-cameras.js
// ============================================================
// 富士山指数の「実際に見えたか」を、公開ライブカメラの画像から判定する。
//
// 答え合わせ（verify-predictions）の「結果」は予報モデルの解析値で、
// 実際に富士山が見えたかどうかではない。そこで毎朝、自治体が公開している
// ライブカメラの画像を1枚取得し、Gemini（画像入力）に「富士山が見えているか」
// を判定させて、予測ログの rec.actual に記録する。画像そのものは保存・
// 再配布しない（判定結果と理由の短文だけを残す）。
//
// カメラは指数のスポットと同じ側（南西側／北側）のものを割り当てる。
// 富士山は南西と北で見え方が違うことがあるため、側ごとに1台ずつ。
//
// page: 画像が載っているページ（HTMLを取得して<img>を探す）
// imagePattern: ページ内の<img src>のうち、カメラ画像を指すものを選ぶ正規表現。
//   nullの間は判定せず、?debug=1 でページ内の画像一覧を確認して埋める。
// spots: このカメラで判定するスポット（spots.jsonの名前の前半。「田貫湖」など）
// ============================================================

export const FUJI_CAMERAS = [
  {
    id: 'fujinomiya',
    label: '富士宮（静岡県 ライブカメラ富士山ビュー 午前8時）',
    // 毎朝8時に撮影された640x480の写真（ページの<img>から確認、2026-11-21）
    page: 'https://www.pref.shizuoka.jp/fujisanview/fujinomiya/1045759.html',
    imagePattern: '/~live/fujinomiya/08/l\\.jpg$',
    spots: ['田貫湖'],
  },
  {
    // 富士吉田市のカメラ（山梨県「富士山ライブカメラ」掲載）は海外のサーバー（Vercel）から
    // 接続できなかった（EBUSY、2026-11-21）ため、同じ北側の精進湖のカメラを使う。
    id: 'shojiko',
    label: '精進湖（山梨県 今見える富士山ライブカメラ）',
    page: 'https://www.yamanashi-kankou.jp/heritage/fujisanwatcher/jp/live/index.html',
    imagePattern: 'lcnet\\.jp/~live-cam/shoji/shoji-capt\\.jpg$',
    spots: ['新道峠', '山中湖パノラマ台'],
  },
];

const UA = 'Mozilla/5.0 (compatible; MigoronAccuracyCheck/1.0; +https://motionimaging.vercel.app/migoron)';

// ページ内の<img>のsrcを絶対URLにして返す
export function extractImageUrls(html, pageUrl) {
  const out = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(new URL(m[1], pageUrl).href); } catch { /* 不正なsrcは無視 */ }
  }
  return [...new Set(out)];
}

async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } catch (e) {
    // "fetch failed" だけでは原因が分からないため、接続エラーのコードを添える
    const cause = e.cause && (e.cause.code || e.cause.message);
    throw new Error(`${new URL(url).host} に接続できない: ${e.name === 'AbortError' ? `タイムアウト(${ms}ms)` : e.message}${cause ? ` (${cause})` : ''}`);
  } finally {
    clearTimeout(t);
  }
}

// カメラページを読み、カメラ画像のURLを決める（debug時はページ内の画像一覧も返す）
export async function findCameraImage(camera) {
  const res = await fetchWithTimeout(camera.page, 15000);
  if (!res.ok) throw new Error(`ページ取得失敗 HTTP ${res.status}`);
  const html = await res.text();
  const images = extractImageUrls(html, camera.page);
  const re = camera.imagePattern ? new RegExp(camera.imagePattern) : null;
  const imageUrl = re ? images.find((u) => re.test(u)) || null : null;
  return { imageUrl, images };
}

const JUDGE_PROMPT = [
  'これは富士山方向を写した定点ライブカメラの画像です。',
  '富士山が見えているかを判定してください。',
  '- clear: 山頂を含む富士山の山体がはっきり見える',
  '- partial: 雲や霞がかかっているが、山頂付近の稜線は見分けられる',
  '- hidden: 雲・霧・雨などで富士山が見えない（山があるはずの場所が雲や空）',
  '- unusable: 夜間で暗い、画像が壊れている、カメラの故障・メンテナンス表示などで判定できない',
  'JSONのみで答えてください: {"visibility":"clear|partial|hidden|unusable","reason":"日本語で30字以内の根拠"}',
].join('\n');

const VISIBILITIES = ['clear', 'partial', 'hidden', 'unusable'];

// 画像URL → { visibility, reason, seen }（seen: 見えた=true / 見えない=false / 判定不能=null）
export async function judgeFujiVisibility(imageUrl, apiKey) {
  const img = await fetchWithTimeout(imageUrl, 15000);
  if (!img.ok) throw new Error(`画像取得失敗 HTTP ${img.status}`);
  const mimeType = (img.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!mimeType.startsWith('image/')) throw new Error(`画像ではない応答 (${mimeType})`);
  const data = Buffer.from(await img.arrayBuffer()).toString('base64');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const res = await fetchWithTimeout(url, 30000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: JUDGE_PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error('Gemini Error: ' + body.error.message);
  const parts = body.candidates?.[0]?.content?.parts || [];
  const text = (parts.find((p) => p.text && !p.thought) || {}).text || '';
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim()); } catch { throw new Error('判定結果を読めない: ' + text.slice(0, 80)); }
  const visibility = VISIBILITIES.includes(parsed.visibility) ? parsed.visibility : 'unusable';
  const reason = String(parsed.reason || '').slice(0, 60);
  const seen = visibility === 'unusable' ? null : visibility !== 'hidden';
  return { visibility, reason, seen };
}
