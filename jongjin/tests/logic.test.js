import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextCategory, orderCandidates, remainingUnused, buildCaption } from '../lib/pick.js';
import { pickWeatherLine, codeToKind } from '../lib/weather.js';

const posts = JSON.parse(readFileSync(new URL('../content/posts.json', import.meta.url)));

test('カテゴリは stage→home→out→studio→stage', () => {
  assert.equal(nextCategory(null), 'stage');
  assert.equal(nextCategory('stage'), 'home');
  assert.equal(nextCategory('studio'), 'stage');
});

test('posts.json: IDが一意・各カテゴリ5件・必須項目あり', () => {
  assert.equal(new Set(posts.map((p) => p.id)).size, posts.length);
  for (const c of ['stage', 'home', 'out', 'studio']) {
    assert.equal(posts.filter((p) => p.category === c).length, 5);
  }
  for (const p of posts) assert.ok(p.ig && p.x && p.image.startsWith(`${p.category}/`), p.id);
});

test('未投稿を優先し、使い切ったら古い順に再利用', () => {
  const usedAt = { 'home-01': 100, 'home-02': 200 };
  assert.equal(orderCandidates(posts, 'home', usedAt, 5)[0].id, 'home-03');
  const all = { 'home-01': 500, 'home-02': 100, 'home-03': 300, 'home-04': 400, 'home-05': 200 };
  assert.equal(orderCandidates(posts, 'home', all, 5)[0].id, 'home-02');
  assert.equal(remainingUnused(posts, 'home', all), 0);
});

test('季節限定(雪)は対象月以外で出ない', () => {
  assert.ok(!orderCandidates(posts, 'out', {}, 7).some((p) => p.id === 'out-05'));
  assert.ok(orderCandidates(posts, 'out', {}, 1).some((p) => p.id === 'out-05'));
});

test('天気: 前日雨→今日晴れ、直近の文は避ける', () => {
  const w = { yesterday: { kind: 'rain', max: 20, min: 15 }, today: { kind: 'clear', max: 22, min: 16 } };
  const a = pickWeatherLine(w, [], () => 0);
  assert.equal(a.key, 'afterRain');
  const b = pickWeatherLine(w, [a.line], () => 0);
  assert.notEqual(b.line, a.line);
  assert.equal(codeToKind(61), 'rain');
  assert.equal(codeToKind(73), 'snow');
});

test('キャプション: 天気→本文→タグ、タグ空なら付けない', () => {
  const p = { ig: '本文', tags: '' };
  assert.equal(buildCaption(p, '晴れ'), '晴れ\n本文');
  assert.equal(buildCaption({ ig: '本文', tags: '#a' }), '本文\n\n#a');
});
