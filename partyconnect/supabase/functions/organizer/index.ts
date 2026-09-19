/**
 * 主催者向け操作。
 *   progress        進捗カウンタ（集計値のみ。個々の投票内容は返さない）
 *   issue_slots     参加者枠と引換コードの発行（事前配布URL・当日の代理登録の両方）
 *   roster          参加者の一覧（番号・状態・引換コードのみ。自由記述と投票は返さない）
 *   withdraw        辞退の設定・解除
 *   pairs           成立ペアの番号一覧（会場での発表・呼び出しに使う）
 *   demo_seed       デモモード用のダミー参加者20名を投入する
 *   checkin_by_code 主催者が引換コードを聞き取って代わりに会場到着チェックインさせる（スマホ操作が難しい人向け）
 */
import { requireOrganizer, serviceClient } from '../_shared/supabase.ts';
import { AppError, json, preflight, readJson, toErrorResponse } from '../_shared/http.ts';
import { computeMatching } from '../_shared/matching.ts';

interface Body {
  action:
    | 'progress' | 'issue_slots' | 'roster' | 'withdraw' | 'pairs' | 'demo_seed' | 'preview_result'
    | 'checkin_by_code';
  eventId: string;
  gender?: 'male' | 'female';
  count?: number;
  isProxy?: boolean;
  participantNumber?: number;
  withdrawn?: boolean;
  claimCode?: string;
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
      .from('events').select('id, organizer_id, is_demo, seed_value').eq('id', body.eventId).single();
    if (eventError) throw eventError;
    if (event.organizer_id !== organizerId) throw new AppError('権限がありません', 403);

    switch (body.action) {
      case 'progress': {
        const { data, error } = await db
          .from('participants')
          .select('id, gender, status, participant_number, nickname')
          .eq('event_id', event.id);
        if (error) throw error;

        const { data: voters, error: voteError } = await db
          .from('votes').select('from_participant_id, vote_type').eq('event_id', event.id);
        if (voteError) throw voteError;

        const active = data.filter((p) => p.status === 'active');
        const likeVoters = new Set(voters.filter((v) => v.vote_type === 'like').map((v) => v.from_participant_id));
        const finalVoters = new Set(voters.filter((v) => v.vote_type === 'final').map((v) => v.from_participant_id));

        // 会場で「男性N番さん、投票お願いします」と声かけできるよう、未投票の番号を返す
        const pending = (voted: Set<string>) => active
          .filter((p) => !voted.has(p.id) && p.participant_number !== null)
          .map((p) => ({ gender: p.gender as 'male' | 'female', number: p.participant_number as number }))
          .sort((a, b) => a.number - b.number);

        return json({
          invited: data.length,
          checkedIn: active.length,
          male: active.filter((p) => p.gender === 'male').length,
          female: active.filter((p) => p.gender === 'female').length,
          withdrawn: data.filter((p) => p.status === 'withdrawn').length,
          profileCompleted: active.filter((p) => p.nickname !== null && p.nickname !== '').length,
          likeVoted: likeVoters.size,
          finalVoted: finalVoters.size,
          pendingLike: pending(likeVoters),
          pendingFinal: pending(finalVoters),
        });
      }

      case 'preview_result': {
        // 配信前の内輪確認用。DBには何も書き込まない（確定は finalize_event のみが行う）
        const { data: participants, error: pError } = await db
          .from('participants').select('id, gender, status, participant_number').eq('event_id', event.id);
        if (pError) throw pError;
        const active = participants.filter((p) => p.status === 'active');
        const activeIds = new Set(active.map((p) => p.id as string));

        const { data: votes, error: vError } = await db
          .from('votes')
          .select('from_participant_id, to_participant_id, vote_type, preference_order')
          .eq('event_id', event.id).eq('vote_type', 'final');
        if (vError) throw vError;

        const nominations = votes
          .filter((v) => activeIds.has(v.from_participant_id) && activeIds.has(v.to_participant_id))
          .map((v) => ({
            from: v.from_participant_id, to: v.to_participant_id, order: v.preference_order as number,
          }));

        const matching = computeMatching({
          maleIds: active.filter((p) => p.gender === 'male').map((p) => p.id as string),
          femaleIds: active.filter((p) => p.gender === 'female').map((p) => p.id as string),
          nominations,
          seed: event.seed_value,
        });

        // 配信前に「誰と誰が成立するか」を番号で確認できるようにする。
        // 人数だけだと、意図と違う結果のまま配信してしまっても気づけない
        const numberById = new Map(
          participants.map((p) => [p.id as string, p.participant_number as number | null]),
        );
        return json({
          matchedPairsCount: matching.pairs.length,
          oneSidedPairsCount: matching.oneSidedPairsCount,
          pairs: matching.pairs
            .map((pair) => ({
              male: numberById.get(pair.maleId) ?? null,
              female: numberById.get(pair.femaleId) ?? null,
            }))
            .sort((a, b) => (a.male ?? 0) - (b.male ?? 0)),
        });
      }

      case 'checkin_by_code': {
        if (!body.claimCode) throw new AppError('受付コードを入力してください');
        const { data: target, error: targetError } = await db
          .from('participants').select('session_token')
          .eq('event_id', event.id).eq('claim_code', body.claimCode).neq('status', 'withdrawn')
          .maybeSingle();
        if (targetError) throw targetError;
        if (!target) throw new AppError('コードが見つかりません');

        const { data, error } = await db.rpc('checkin_participant', {
          p_session_token: target.session_token,
        });
        if (error) throw error;
        const p = data as { gender: string; participant_number: number };
        return json({ gender: p.gender, participantNumber: p.participant_number });
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
        // 自由記述・投票は返さない。主催者に見せてよいのは番号と状態まで。
        // ★session_token は返さない。事前リンクはイベント共通の1本(prelink_token)になり、
        //   個人のセッショントークンを画面に出す必要が無くなったため。
        //   （本人以外の手に渡ると、その人になりすましてプロフィールを書き換えられる）
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
            // △/○/◎ の判定に使う。中身は返さず「入っているか」だけ
            hasProfile: p.nickname !== null && p.nickname !== '',
          })),
        });
      }

      case 'withdraw': {
        // 当日キャンセルの連絡が来た人は、まだ番号を持っていない（未チェックイン）。
        // 番号だけを手がかりにすると辞退登録ができないので、受付コードでも引けるようにする
        const query = db.from('participants').select('id').eq('event_id', event.id);
        if (body.claimCode) {
          query.eq('claim_code', body.claimCode);
        } else if (body.gender !== undefined && body.participantNumber !== undefined) {
          query.eq('gender', body.gender).eq('participant_number', body.participantNumber);
        } else {
          throw new AppError('参加者を指定してください');
        }
        const { data: target, error: targetError } = await query.single();
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
        // ★同じ offset を使うことで male[i] <-> female[i] が必ず相互の第1希望になり、
        //   相互指名限定(5-1)の下でも成立ペアが生まれる。offset をずらすと
        //   男女の指名がすれ違い、相互指名が1組も生まれず「確定」しても
        //   成立ペア0件になってしまう(実際に発生した不具合)。
        //   2〜3希望は男女で向きを変えているので、一部は片側指名のまま残り
        //   one_sided_pairs_count にも実データが入る。
        pushVotes(males, females, 0);
        pushVotes(females, males, 0);
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
