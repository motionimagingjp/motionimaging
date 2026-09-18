/**
 * 主催者向け操作。
 *   progress     進捗カウンタ（集計値のみ。個々の投票内容は返さない）
 *   issue_slots  参加者枠と引換コードの発行（事前配布URL・当日の代理登録の両方）
 *   roster       参加者の一覧（番号・状態・引換コードのみ。自由記述と投票は返さない）
 *   withdraw     辞退の設定・解除
 *   pairs        成立ペアの番号一覧（会場での発表・呼び出しに使う）
 *   demo_seed    デモモード用のダミー参加者20名を投入する
 */
import { requireOrganizer, serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';

interface Body {
  action: 'progress' | 'issue_slots' | 'roster' | 'withdraw' | 'pairs' | 'demo_seed';
  eventId: string;
  gender?: 'male' | 'female';
  count?: number;
  isProxy?: boolean;
  participantNumber?: number;
  withdrawn?: boolean;
}

function newSessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DEMO_NICKNAMES = [
  'あきら', 'かなで', 'さとし', 'たくみ', 'なおや', 'はると', 'まさき', 'ゆうた', 'りく', 'そうた',
  'あおい', 'かおり', 'さくら', 'ちなつ', 'なつみ', 'はるか', 'みさき', 'ゆい', 'りな', 'あんな',
];
const DEMO_OCCUPATIONS = ['IT', '医療', '公務員', 'サービス', '製造'];
const DEMO_AGE_GROUPS = ['20s', '30s', '40s'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    const organizerId = await requireOrganizer(req).catch(() => {
      throw new AppError('ログインが必要です', 401);
    });
    const body = await readJson<Body>(req);
    const db = serviceClient();

    const { data: event, error: eventError } = await db
      .from('events').select('id, organizer_id, is_demo').eq('id', body.eventId).single();
    if (eventError) throw eventError;
    if (event.organizer_id !== organizerId) throw new AppError('権限がありません', 403);

    switch (body.action) {
      case 'progress': {
        const { data, error } = await db
          .from('participants')
          .select('gender, status, participant_number, nickname')
          .eq('event_id', event.id);
        if (error) throw error;

        const { data: voters, error: voteError } = await db
          .from('votes').select('from_participant_id, vote_type').eq('event_id', event.id);
        if (voteError) throw voteError;

        const active = data.filter((p) => p.status === 'active');
        const likeVoters = new Set(voters.filter((v) => v.vote_type === 'like').map((v) => v.from_participant_id));
        const finalVoters = new Set(voters.filter((v) => v.vote_type === 'final').map((v) => v.from_participant_id));

        return json({
          invited: data.length,
          checkedIn: active.length,
          male: active.filter((p) => p.gender === 'male').length,
          female: active.filter((p) => p.gender === 'female').length,
          withdrawn: data.filter((p) => p.status === 'withdrawn').length,
          profileCompleted: active.filter((p) => p.nickname !== null && p.nickname !== '').length,
          likeVoted: likeVoters.size,
          finalVoted: finalVoters.size,
        });
      }

      case 'issue_slots': {
        const count = Math.min(Math.max(body.count ?? 1, 1), 100);
        if (body.gender !== 'male' && body.gender !== 'female') {
          throw new AppError('性別を指定してください');
        }
        const issued: { claimCode: string; sessionToken: string }[] = [];
        for (let i = 0; i < count; i++) {
          const sessionToken = newSessionToken();
          const { data, error } = await db.rpc('issue_participant_slot', {
            p_event_id: event.id,
            p_gender: body.gender,
            p_session_token: sessionToken,
            p_is_proxy: body.isProxy ?? false,
          });
          if (error) throw error;
          issued.push({ claimCode: (data as { claim_code: string }).claim_code, sessionToken });
        }
        return json({ issued });
      }

      case 'roster': {
        // 自由記述・投票は返さない。主催者に見せてよいのは番号と状態まで
        const { data, error } = await db
          .from('participants')
          .select('id, gender, participant_number, status, nickname, claim_code')
          .eq('event_id', event.id)
          .order('gender', { ascending: true })
          .order('participant_number', { ascending: true, nullsFirst: false });
        if (error) throw error;
        return json({
          participants: data.map((p) => ({
            gender: p.gender,
            number: p.participant_number,
            status: p.status,
            nickname: p.nickname,
            claimCode: p.claim_code,
          })),
        });
      }

      case 'withdraw': {
        if (body.gender === undefined || body.participantNumber === undefined) {
          throw new AppError('参加者を指定してください');
        }
        const { data: target, error: targetError } = await db
          .from('participants').select('id')
          .eq('event_id', event.id).eq('gender', body.gender)
          .eq('participant_number', body.participantNumber).single();
        if (targetError) throw targetError;

        const { error } = await db.rpc('set_participant_withdrawn', {
          p_participant_id: target.id,
          p_withdrawn: body.withdrawn ?? true,
          p_organizer_id: organizerId,
        });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'pairs': {
        const { data, error } = await db
          .from('matches')
          .select('male_participant_id, female_participant_id')
          .eq('event_id', event.id);
        if (error) throw error;
        if (data.length === 0) return json({ pairs: [] });

        const ids = data.flatMap((m) => [m.male_participant_id, m.female_participant_id]);
        const { data: people, error: peopleError } = await db
          .from('participants').select('id, gender, participant_number').in('id', ids);
        if (peopleError) throw peopleError;
        const byId = new Map(people.map((p) => [p.id, p]));

        return json({
          pairs: data.map((m) => ({
            male: byId.get(m.male_participant_id)?.participant_number ?? null,
            female: byId.get(m.female_participant_id)?.participant_number ?? null,
          })).sort((a, b) => (a.male ?? 0) - (b.male ?? 0)),
        });
      }

      case 'demo_seed': {
        // デモは営業ツール。一人で全フローを通せることが目的（仕様 4-2 / 9章）
        if (!event.is_demo) throw new AppError('デモモードのイベントではありません');
        const { count: existing, error: countError } = await db
          .from('participants').select('id', { count: 'exact', head: true }).eq('event_id', event.id);
        if (countError) throw countError;
        if ((existing ?? 0) > 0) throw new AppError('すでに参加者が登録されています');

        // 受付フェーズにしてから採番する。本番と同じ経路を通す
        await db.from('event_states').update({ phase: 'checkin' }).eq('event_id', event.id);
        await db.from('events').update({ status: 'active' })
          .eq('id', event.id).eq('status', 'draft');

        const males: string[] = [];
        const females: string[] = [];
        for (let i = 0; i < 20; i++) {
          const gender = i < 10 ? 'male' : 'female';
          const sessionToken = newSessionToken();
          const { data: slot, error: slotError } = await db.rpc('issue_participant_slot', {
            p_event_id: event.id, p_gender: gender, p_session_token: sessionToken, p_is_proxy: true,
          });
          if (slotError) throw slotError;
          const { error: updateError } = await db.from('participants').update({
            nickname: DEMO_NICKNAMES[i],
            profile_data: {
              age_group: DEMO_AGE_GROUPS[i % DEMO_AGE_GROUPS.length],
              occupation: DEMO_OCCUPATIONS[i % DEMO_OCCUPATIONS.length],
            },
            // デモの自由記述は暗号化しない。復号鍵の取り回しを増やさないため空にしておく
            free_text: null,
          }).eq('id', (slot as { id: string }).id);
          if (updateError) throw updateError;

          const { error: checkinError } = await db.rpc('checkin_participant', {
            p_session_token: sessionToken,
          });
          if (checkinError) throw checkinError;
          (gender === 'male' ? males : females).push((slot as { id: string }).id);
        }

        // ダミーの投票も入れる。これが無いと主催者が一人で確定まで通せない（デモは営業ツール）
        const votes: Record<string, unknown>[] = [];
        const pushVotes = (from: string[], to: string[], offset: number) => {
          from.forEach((fromId, i) => {
            for (let k = 0; k < 3; k++) {
              votes.push({
                event_id: event.id,
                from_participant_id: fromId,
                to_participant_id: to[(i + offset + k) % to.length],
                vote_type: 'final',
                preference_order: k + 1,
              });
            }
            votes.push({
              event_id: event.id,
              from_participant_id: fromId,
              to_participant_id: to[(i + offset) % to.length],
              vote_type: 'like',
              preference_order: null,
            });
          });
        };
        // 男女で offset を揃えると全員が相互指名になり不自然なので、片側だけずらす
        pushVotes(males, females, 0);
        pushVotes(females, males, 1);
        const { error: voteError } = await db.from('votes').insert(votes);
        if (voteError) throw voteError;

        return json({ seeded: 20, votes: votes.length });
      }

      default:
        throw new AppError('不明な操作です');
    }
  } catch (error) {
    return toErrorResponse(error);
  }
});
