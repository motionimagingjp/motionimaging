/**
 * イベント別データ鍵の取得・破棄。
 *
 * ★現状の実装は暗号文と同じDBに鍵を置いているため、DBバックアップ復元に対しては
 *   crypto-shredding が成立しない（仕様 7-4 / README「既知の制約」）。
 *   KMS や外部KVへ移すときは、この EventKeyStore の実装だけを差し替える。
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { EventKeyStore } from './crypto.ts';

/** PostgREST は bytea を "\x..." の16進文字列で返す */
function parseByteaHex(value: string): Uint8Array {
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export class PostgresEventKeyStore implements EventKeyStore {
  #db: SupabaseClient;
  #cache = new Map<string, Uint8Array>();

  constructor(db: SupabaseClient) {
    this.#db = db;
  }

  async getKey(eventId: string): Promise<Uint8Array> {
    const cached = this.#cache.get(eventId);
    if (cached) return cached;
    const { data, error } = await this.#db
      .from('event_keys').select('data_key').eq('event_id', eventId).single();
    if (error || !data) throw new Error(`イベントのデータ鍵が見つかりません (event_id=${eventId})`);
    const key = parseByteaHex(data.data_key as string);
    this.#cache.set(eventId, key);
    return key;
  }

  async destroyKey(eventId: string): Promise<void> {
    this.#cache.delete(eventId);
    await this.#db.from('event_keys').delete().eq('event_id', eventId);
  }
}
