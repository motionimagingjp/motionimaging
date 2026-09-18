import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText, decryptText, encryptOptional, decryptOptional } from '../supabase/functions/_shared/crypto.ts';

const key = () => crypto.getRandomValues(new Uint8Array(32));

test('暗号化した自由記述を復号できる', async () => {
  const k = key();
  const plain = '休日はサウナに行きます。得意料理は肉じゃがです。';
  assert.equal(await decryptText(await encryptText(plain, k), k), plain);
});

test('暗号文には平文が現れない', async () => {
  const k = key();
  const cipher = await encryptText('肉じゃが', k);
  assert.ok(!cipher.includes('肉じゃが'));
});

test('同じ平文でも毎回異なる暗号文になる(IVがランダム)', async () => {
  const k = key();
  assert.notEqual(await encryptText('同じ文章', k), await encryptText('同じ文章', k));
});

test('鍵が違えば復号できない = 鍵破棄で復元不能になる', async () => {
  const cipher = await encryptText('秘密の自由記述', key());
  await assert.rejects(() => decryptText(cipher, key()));
});

test('改ざんされた暗号文は復号に失敗する(GCMの認証)', async () => {
  const k = key();
  const cipher = await encryptText('本文', k);
  const tampered = cipher.slice(0, -4) + (cipher.endsWith('A') ? 'BBB=' : 'AAA=');
  await assert.rejects(() => decryptText(tampered, k));
});

test('32バイト以外の鍵を拒否する', async () => {
  await assert.rejects(() => encryptText('x', new Uint8Array(16)), /32バイト/);
});

test('null と空文字はそのまま通す', async () => {
  const k = key();
  assert.equal(await encryptOptional(null, k), null);
  assert.equal(await encryptOptional('', k), null);
  assert.equal(await decryptOptional(null, k), null);
});
