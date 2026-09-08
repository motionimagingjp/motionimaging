import test from 'node:test';
import assert from 'node:assert/strict';
import { scanForContactInfo } from '../supabase/functions/_shared/contact-filter.ts';

const blocked = (text: string) => scanForContactInfo(text).blocked;

test('LINE IDの記入をブロックする', () => {
  assert.ok(blocked('LINE: taro1234'));
  assert.ok(blocked('らいん yamada_taro'));
  assert.ok(blocked('ＬＩＮＥ　ＩＤは taro0101 です'));
  assert.ok(blocked('id: yamada_taro'));
});

test('電話番号をブロックする', () => {
  assert.ok(blocked('090-1234-5678'));
  assert.ok(blocked('09012345678'));
  assert.ok(blocked('０９０−１２３４−５６７８'));
});

test('区切り文字で分断した数字もブロックする', () => {
  assert.ok(blocked('0 9 0 1 2 3 4 5 6 7 8'));
  assert.ok(blocked('090.1234.5678'));
});

test('メールアドレスとハンドルをブロックする', () => {
  assert.ok(blocked('taro@example.com'));
  assert.ok(blocked('インスタは @taro_photo です'));
  assert.ok(blocked('＠taro_1234'));
});

test('URLと連絡先ドメインをブロックする', () => {
  assert.ok(blocked('https://line.me/ti/p/xxxxx'));
  assert.ok(blocked('www.instagram.com/taro'));
  assert.ok(blocked('lin.ee/abcdef'));
});

test('通常のプロフィール文はブロックしない', () => {
  assert.ok(!blocked('休日はサウナに行きます。整うと最高です'));
  assert.ok(!blocked('身長170cm、体重60kgくらいです'));
  assert.ok(!blocked('1990年生まれの35歳です'));
  assert.ok(!blocked('映画は月に3本くらい見ます'));
  assert.ok(!blocked('得意料理は肉じゃがです。実家が居酒屋でした'));
  assert.ok(!blocked('週2でジムに通っています'));
});

test('連絡先キーワードを含んでも英数字が続かなければブロックしない', () => {
  assert.ok(!blocked('スカイラインが好きで、休日はドライブしています'));
  assert.ok(!blocked('アイドルのライブによく行きます'));
  assert.ok(!blocked('メールより電話派です'));
  assert.ok(!blocked('インスタはやっていません'));
});

test('空文字・null は許可する', () => {
  assert.ok(!blocked(''));
  assert.ok(!scanForContactInfo(null).blocked);
  assert.ok(!scanForContactInfo(undefined).blocked);
});

test('検出理由は返すが入力内容は含めない', () => {
  const r = scanForContactInfo('LINE: taro1234 090-1234-5678');
  assert.ok(r.rules.includes('keyword_with_identifier'));
  assert.ok(r.rules.includes('digit_run'));
  assert.ok(!JSON.stringify(r).includes('taro1234'));
});
