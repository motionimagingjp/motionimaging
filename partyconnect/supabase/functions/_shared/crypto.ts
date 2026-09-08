/**
 * 自由記述の暗号化（イベント別データ鍵による AES-256-GCM）。
 * 仕様: docs/partyconnect_requirements.md 7-4
 *
 * ★重要な制約: 鍵を暗号文と同じDBに置いている限り、DBバックアップ復元に対しては無力。
 *   真の crypto-shredding には EventKeyStore を DB 外（KMS / 外部KV）実装に差し替えること。
 *   Web Crypto のみを使うので Deno / Node 22 双方でそのまま動く。
 */

const IV_BYTES = 12;

/** イベント別データ鍵の取得・破棄。DB外へ移行するときはこの実装だけ差し替える */
export interface EventKeyStore {
  getKey(eventId: string): Promise<Uint8Array>;
  destroyKey(eventId: string): Promise<void>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength !== 32) {
    throw new Error(`データ鍵は32バイトである必要があります (実際: ${key.byteLength})`);
  }
  return await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 平文 -> base64(iv || ciphertext) */
export async function encryptText(plain: string, key: Uint8Array): Promise<string> {
  const cryptoKey = await importKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plain);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded),
  );
  const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(cipher, iv.byteLength);
  return toBase64(packed);
}

/** base64(iv || ciphertext) -> 平文 */
export async function decryptText(packedBase64: string, key: Uint8Array): Promise<string> {
  const cryptoKey = await importKey(key);
  const packed = fromBase64(packedBase64);
  if (packed.byteLength <= IV_BYTES) throw new Error('暗号文が壊れています');
  const iv = packed.slice(0, IV_BYTES);
  const cipher = packed.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher as BufferSource);
  return new TextDecoder().decode(plain);
}

/** null / 空文字はそのまま通す（暗号化しない） */
export async function encryptOptional(plain: string | null | undefined, key: Uint8Array): Promise<string | null> {
  if (plain === null || plain === undefined || plain === '') return null;
  return await encryptText(plain, key);
}

export async function decryptOptional(packed: string | null | undefined, key: Uint8Array): Promise<string | null> {
  if (packed === null || packed === undefined || packed === '') return null;
  return await decryptText(packed, key);
}
