// src/app/api/_lib/migoron-format.js
// ============================================================
// ミゴロン各指数の投稿文フォーマット（改善指示書P5）。
//   ・1行目は結論型のフック（例:「明日の朝、竹田城跡で雲海が出そう☁️」）
//   ・「%」が何の数字か伝わるよう、見出しに「出現期待度」などの語を付ける
// フックは算出済みスコアからコードで決める（Geminiは使わない。数値や
// 結論が指数とずれる事故を防ぐため）。
// 文字数チェック（Xの重み付き280）は各routeのweightedLength/clipWeightedで行う。
// ============================================================

// 「竹田城跡（兵庫）」→「竹田城跡」
export function shortSpotName(name) {
  return String(name).replace(/[（(].*$/, '').trim();
}

// 見出し行の「％が何を表すか」の語
export const SCORE_LABELS = {
  star: '出現期待度',
  cloud: '出現期待度',
  fuji: '見え期待度',
  flower: '見頃期待度',
};

const GOOD = 70;
const FAIR = 45;

// kind: 'star' | 'cloud' | 'fuji' | 'flower'
// ranked: スコア降順のスポット配列（先頭が最有力。flowerはflowerType/emojiを持つ）
export function buildHook(kind, ranked) {
  const top = ranked[0];
  const name = shortSpotName(top.name);
  const best = top.score;

  if (kind === 'star') {
    if (best >= GOOD) return `今夜は${name}で星がよく見えそう✨`;
    if (best >= FAIR) return `今夜の星空は${name}が狙い目✨`;
    return '今夜の星空観測は厳しそう…';
  }
  if (kind === 'cloud') {
    if (best >= GOOD) return `明日の朝、${name}で雲海が出そう☁️`;
    if (best >= FAIR) return `明日の朝、${name}で雲海に会えるかも☁️`;
    return '明日の朝は雲海は期待薄…';
  }
  if (kind === 'fuji') {
    if (best >= GOOD) return `明日の朝、${name}で富士山がくっきり🗻`;
    if (best >= FAIR) return `明日の朝の富士山は${name}が狙い目🗻`;
    return '明日の朝の富士山は雲に隠れそう…';
  }
  if (kind === 'flower') {
    const flower = top.flowerType || '花';
    const emoji = top.emoji || '🌸';
    if (best >= GOOD) return `今日は${name}で${flower}が見頃${emoji}`;
    if (best >= FAIR) return `今日は${name}の${flower}を楽しめそう${emoji}`;
    return `今日は${flower}の撮影は天気が微妙…`;
  }
  throw new Error('unknown kind: ' + kind);
}
