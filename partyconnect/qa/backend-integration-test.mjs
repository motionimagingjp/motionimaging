#!/usr/bin/env node
/**
 * バックエンド統合テスト（実際にデプロイ済みのEdge Functions / RPCを叩く）。
 *
 * 事前準備（自動化できない部分。理由は README 参照）:
 *   1. 主催者コンソールに一度ログインし、新規イベントを1件作成しておく（参加者0名の状態）
 *   2. ブラウザの開発者ツールで、そのログインセッションのアクセストークンを控える
 *      例: supabase.auth.getSession() の access_token
 *
 * 実行方法:
 *   SUPABASE_URL=... \
 *   SUPABASE_ANON_KEY=... \
 *   ORGANIZER_ACCESS_TOKEN=... \
 *   EVENT_ID=... \
 *   node qa/backend-integration-test.mjs
 *
 * オプション:
 *   RUN_FINALIZE=true   … ⑥確定して結果を配信 まで実行する（不可逆。既定は false で ⑤直前で止まる）
 *
 * ★このスクリプトは指定した EVENT_ID に実データを書き込む。
 *   本番イベントに向けて実行しないこと。テスト専用イベントを新規作成して使うこと。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  ORGANIZER_ACCESS_TOKEN,
  EVENT_ID,
  RUN_FINALIZE,
} = process.env;

for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, ORGANIZER_ACCESS_TOKEN, EVENT_ID })) {
  if (!value) {
    console.error(`環境変数 ${name} が未設定です。README を参照してください。`);
    process.exit(1);
  }
}

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const REST_BASE = `${SUPABASE_URL}/rest/v1`;

let failures = 0;
function ok(label) { console.log(`  ✓ ${label}`); }
function fail(label, detail) { failures++; console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`); }

/** Edge Function呼び出し。参加者系は anonKey のみ、主催者系は organizerToken を渡す */
async function callFn(name, body, token) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  return { status: res.status, ok: res.ok, payload };
}

/** 主催者操作。RLS/認可は auth.uid() ベースなので、必ず本物の主催者トークンで呼ぶ */
const organizerCall = (action, extra = {}) =>
  callFn('organizer', { action, eventId: EVENT_ID, ...extra }, ORGANIZER_ACCESS_TOKEN);

/** フェーズ遷移。実際の主催者コンソールと同じく set_event_phase RPC を直接叩く */
async function setPhase(phase) {
  const res = await fetch(`${REST_BASE}/rpc/set_event_phase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ORGANIZER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ p_event_id: EVENT_ID, p_phase: phase }),
  });
  if (!res.ok) throw new Error(`set_event_phase(${phase}) 失敗: ${res.status} ${await res.text()}`);
  console.log(`→ フェーズ: ${phase}`);
}

async function loadJson(name) {
  return JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
}

async function main() {
  const profiles = await loadJson('profiles.json');
  const likes = await loadJson('likes.json');
  const finals = await loadJson('finals.json');
  const invalidCases = await loadJson('invalid-cases.json');

  // ---- 安全確認: このイベントに既に参加者がいないか -------------------------
  console.log('== 安全確認 ==');
  const rosterCheck = await organizerCall('roster');
  if (!rosterCheck.ok) {
    console.error('rosterの取得に失敗しました。ORGANIZER_ACCESS_TOKEN / EVENT_ID を確認してください。');
    console.error(JSON.stringify(rosterCheck.payload));
    process.exit(1);
  }
  if (rosterCheck.payload.participants.length > 0) {
    console.error(`このイベントには既に ${rosterCheck.payload.participants.length} 名の参加者がいます。`);
    console.error('データ汚染を避けるため、参加者0名のテスト専用イベントを新規作成して指定してください。');
    process.exit(1);
  }
  ok('参加者0名のクリーンなイベントであることを確認');

  // ---- ① 枠の発行（男女10名ずつ）。issue順=登録順=採番順にする -------------
  console.log('\n== ① 参加者登録: 枠の発行 ==');
  const maleSlots = await organizerCall('issue_slots', { gender: 'male', count: 10, isProxy: true });
  const femaleSlots = await organizerCall('issue_slots', { gender: 'female', count: 10, isProxy: true });
  if (!maleSlots.ok || !femaleSlots.ok) throw new Error('issue_slots に失敗しました');
  ok('男性10枠・女性10枠を発行');

  // 発行順 = このあとチェックインする順 = 採番される番号の順、なのでそのまま M1..M10 / W1..W10 に対応させる
  const sessionTokenById = {};
  maleSlots.payload.issued.forEach((s, i) => { sessionTokenById[`M${i + 1}`] = s.sessionToken; });
  femaleSlots.payload.issued.forEach((s, i) => { sessionTokenById[`W${i + 1}`] = s.sessionToken; });

  await setPhase('checkin');

  // ---- チェックイン（発行順どおりに1件ずつ。並行させると採番順序が保証できない） --
  console.log('\n== チェックイン（① 参加者登録） ==');
  for (const id of [...Array(10)].map((_, i) => `M${i + 1}`).concat([...Array(10)].map((_, i) => `W${i + 1}`))) {
    const res = await callFn('checkin', { sessionToken: sessionTokenById[id], agreed: true });
    if (!res.ok) throw new Error(`${id} のチェックインに失敗: ${JSON.stringify(res.payload)}`);
    const expectedNumber = Number(id.replace(/[MW]/, ''));
    if (res.payload.participantNumber !== expectedNumber) {
      fail(`${id} の採番`, `期待=${expectedNumber} 実際=${res.payload.participantNumber}`);
    }
  }
  ok('20名のチェックインと採番順を確認');

  // ---- プロフィール登録 -----------------------------------------------------
  console.log('\n== プロフィール登録 ==');
  for (const p of profiles) {
    const res = await callFn('save_profile', {
      sessionToken: sessionTokenById[p.id],
      nickname: p.nickname,
      profileData: p.profileData,
      freeText: p.freeText,
    });
    if (!res.ok) fail(`${p.id} のプロフィール保存`, JSON.stringify(res.payload));
  }
  ok('20名分のプロフィールを登録');

  await setPhase('browse');

  // ---- ② 好印象 --------------------------------------------------------------
  console.log('\n== ③ 好印象の投票開始 ==');
  await setPhase('like_vote');
  for (const l of likes) {
    const res = await callFn('submit_vote', {
      sessionToken: sessionTokenById[l.id],
      voteType: 'like',
      targetNumbers: l.targetNumbers,
    });
    if (!res.ok) fail(`${l.id} の好印象送信`, JSON.stringify(res.payload));
  }
  ok('20名分の好印象を送信');

  // ---- 異常系1・3（like_vote フェーズで検証） -------------------------------
  console.log('\n== 異常系テスト（好印象フェーズ）==');
  {
    // INVALID-1: 性別改ざん試行。gender は無視され、女性2番(W2)への投票として扱われるべき
    const before = await organizerCall('preview_result').catch(() => null); // 参考取得（失敗しても続行）
    const res = await callFn('submit_vote', {
      sessionToken: sessionTokenById.M1, voteType: 'like', targetNumbers: [2], gender: 'male',
    });
    if (res.ok) ok('INVALID-1: gender改ざんは無視され200 OK（同性への投票にはならない設計）');
    else fail('INVALID-1', `想定外のエラー: ${JSON.stringify(res.payload)}`);
    void before;
  }
  {
    // INVALID-3: 存在しない番号
    const res = await callFn('submit_vote', {
      sessionToken: sessionTokenById.M1, voteType: 'like', targetNumbers: [99],
    });
    if (!res.ok && res.status === 400 && res.payload.error?.includes('選択できません')) {
      ok('INVALID-3: 存在しない番号(99)は400で拒否');
    } else {
      fail('INVALID-3', `期待した400にならず: status=${res.status} ${JSON.stringify(res.payload)}`);
    }
  }

  await setPhase('like_reveal');

  // ---- ⑤ 最終希望 -------------------------------------------------------------
  console.log('\n== ⑤ 最終希望の受付開始 ==');
  await setPhase('final_vote');
  for (const f of finals) {
    const res = await callFn('submit_vote', {
      sessionToken: sessionTokenById[f.id],
      voteType: 'final',
      targetNumbers: f.targetNumbers,
    });
    if (!res.ok) fail(`${f.id} の最終希望送信`, JSON.stringify(res.payload));
  }
  ok('20名分の最終希望（指定パターンどおり）を送信');

  // ---- 異常系2（final_vote フェーズで検証） ----------------------------------
  console.log('\n== 異常系テスト（最終希望フェーズ）==');
  {
    const res = await callFn('submit_vote', {
      sessionToken: sessionTokenById.M1, voteType: 'final', targetNumbers: [1, 2, 3, 4],
    });
    if (!res.ok && res.status === 400 && res.payload.error?.includes('第3希望')) {
      ok('INVALID-2: 4人選択は400で拒否');
    } else {
      fail('INVALID-2', `期待した400にならず: status=${res.status} ${JSON.stringify(res.payload)}`);
    }
  }
  void invalidCases; // JSON側は仕様書として README / invalid-cases.json 自体を参照

  // ---- 進捗確認（全員投票済みになっているか） --------------------------------
  const progress = await organizerCall('progress');
  console.log(`\n進捗: 好印象 ${progress.payload.likeVoted}/${progress.payload.checkedIn} / ` +
    `最終希望 ${progress.payload.finalVoted}/${progress.payload.checkedIn}`);
  if (progress.payload.likeVoted !== 20 || progress.payload.finalVoted !== 20) {
    fail('全員投票済みになっていること', JSON.stringify(progress.payload));
  } else {
    ok('好印象・最終希望とも 20/20（未投票なし）');
  }

  // ---- ⑥ 確定（任意・不可逆） --------------------------------------------------
  if (RUN_FINALIZE === 'true') {
    console.log('\n== ⑥ 確定して結果を配信 ==');
    await setPhase('calculating');
    const finalize = await callFn('finalize_event', { eventId: EVENT_ID }, ORGANIZER_ACCESS_TOKEN);
    if (!finalize.ok) throw new Error(`finalize_event 失敗: ${JSON.stringify(finalize.payload)}`);
    console.log(`確定しました（結果の中身はこのログには出力していません。主催者コンソールで確認してください）。`);
    console.log(`matchedPairsCount: ${finalize.payload.matchedPairsCount}`);
  } else {
    console.log('\n(RUN_FINALIZE=true ではないため、⑥確定は実行していません。calculatingフェーズの手前で停止)');
    await setPhase('calculating');
    const preview = await organizerCall('preview_result');
    console.log(`preview_result: 成立見込み ${preview.payload.matchedPairsCount}組` +
      `（配信はされていません。この時点なら何度でもやり直せます）`);
  }

  console.log(`\n=== 完了: 失敗 ${failures} 件 ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n致命的エラー:', e);
  process.exit(1);
});
