// 次に投稿する1件を選ぶ（純粋関数・テスト可能）
export const CATEGORIES = ['stage', 'home', 'out', 'studio'];

export function nextCategory(last) {
  const i = CATEGORIES.indexOf(last);
  return CATEGORIES[(i + 1) % CATEGORIES.length];
}

// usedAt: { [id]: 投稿時刻ms }。未投稿を定義順に優先し、全部使ったら一番古いものから再利用
export function orderCandidates(posts, category, usedAt, month) {
  return posts
    .filter((p) => p.category === category)
    .filter((p) => !p.months || p.months.includes(month))
    .map((p, i) => ({ p, i, t: usedAt[p.id] ? Number(usedAt[p.id]) : 0 }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.p);
}

export function remainingUnused(posts, category, usedAt) {
  return posts.filter((p) => p.category === category && !usedAt[p.id]).length;
}

export function buildCaption(post, weatherLine) {
  const body = weatherLine ? `${weatherLine}\n${post.ig}` : post.ig;
  return post.tags ? `${body}\n\n${post.tags}` : body;
}
