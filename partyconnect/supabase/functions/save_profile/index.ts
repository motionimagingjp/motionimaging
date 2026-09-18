/**
 * プロフィールの保存。
 * ★ここが連絡先を通してしまうと、アプリが連絡手段を伝達していることになり、
 *   出会い系規制法の該当要件③が復活する（仕様 11-1）。サーバ側での検査は必須。
 * ★性別は書き換えさせない（仕様 6-5）。リクエストに含まれていても無視する。
 */
import { serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { requireParticipant } from '../_shared/session.ts';
import { assertNoContactInfo } from '../_shared/contact-filter.ts';
import { encryptOptional } from '../_shared/crypto.ts';
import { PostgresEventKeyStore } from '../_shared/key-store.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

interface Body {
  sessionToken: string;
  nickname?: string;
  profileData?: Record<string, unknown>;
  freeText?: string;
}

const ALLOWED_PROFILE_KEYS = [
  'age_group', 'residence', 'hometown', 'blood_type', 'height',
  'occupation', 'holiday', 'marital_status',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const body = await readJson<Body>(req);
    const db = serviceClient();
    const session = await requireParticipant(db, body.sessionToken);
    if (!checkRateLimit(`profile:${body.sessionToken}`, 30)) {
      throw new AppError('操作が多すぎます。少し待ってからお試しください', 429);
    }
    if (['calculating', 'result', 'purged'].includes(session.phase)) {
      throw new AppError('結果発表後はプロフィールを変更できません', 409);
    }

    // 自由記述・ニックネームの双方を検査する。ニックネームに書かれても伝達は成立してしまう
    assertNoContactInfo(body.nickname, 'nickname');
    assertNoContactInfo(body.freeText, 'free_text');

    if (body.nickname !== undefined && body.nickname.length > 50) {
      throw new AppError('ニックネームは50文字以内で入力してください');
    }
    if (body.freeText !== undefined && body.freeText.length > 500) {
      throw new AppError('自由記述は500文字以内で入力してください');
    }

    // 想定した選択項目以外は保存しない（任意のJSONを溜め込ませない）
    const profileData: Record<string, unknown> = {};
    for (const key of ALLOWED_PROFILE_KEYS) {
      const value = body.profileData?.[key];
      if (typeof value === 'string' && value !== '') profileData[key] = value;
    }

    const keyStore = new PostgresEventKeyStore(db);
    const dataKey = await keyStore.getKey(session.eventId);

    const { error } = await db.from('participants').update({
      nickname: body.nickname ?? null,
      profile_data: profileData,
      free_text: await encryptOptional(body.freeText, dataKey),
      // gender はここに含めない。参加者からは変更できない
    }).eq('id', session.id);
    if (error) throw error;

    return json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
});
