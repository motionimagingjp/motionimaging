// app/api/_lib/post-jake-ai-core.js
// @jake_images 生成AIトレンド発信 X自動投稿の共通ロジック（朝・夜で共有）
// ============================================================
// 投稿先：@jake_images（Migoron・スクアドとは別アカウント）
// 環境変数は JAKE_X_* を使用（Instagram用の JAKE_IMAGES_ACCESS_TOKEN とは別物）
//
// 本番：Geminiに投稿の都度、Google検索groundingで直近ニュース/事例を調べさせて生成
// 繋ぎ：動的生成が失敗した場合、立ち上げ用の静的JSON（tweets.json）にフォールバック
//       （スクアドの idx/cycle ローテーション方式を流用）
//
// ?key= / ?dry=1 / ?force=1 / ?report=1 に対応（Migoron・スクアドと同じ運用パターン）
// ============================================================
import { TwitterApi } from 'twitter-api-v2';
import { Redis } from '@upstash/redis';

import morningData from '../post-jake-ai-morning/tweets.json';
import nightData from '../post-jake-ai-night/tweets.json';
import diaryData from '../post-jake-ai-night/diary.json';

const X_LIMIT = 280;
const GEMINI_MODEL = 'gemini-2.5-flash';
const HISTORY_DAYS = 14;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
// スロット定義
// ============================================================
const SLOTS = {
  morning: {
    data: morningData,
    promptTopic: '直近7日以内の生成AIの新サービス・新機能・価格改定のニュース',
    hashtagHint: '#生成AI #ChatGPT #Gemini など',
    staticIdxKey:   'jake_ai_morning_static_idx',
    staticCycleKey: 'jake_ai_morning_static_cycle',
    postedKey:      'jake_ai_morning_posted',
    historyKey:     'jake_ai_morning_history',
    reportKey:      'jake_ai_morning_report',
    ctaEligible: true,
  },
  night: {
    data: nightData,
    promptTopic: '直近の生成AI活用事例（行政・企業・個人クリエイターのいずれか）',
    hashtagHint: '#生成AI #自治体DX #個人開発 など',
    staticIdxKey:   'jake_ai_night_static_idx',
    staticCycleKey: 'jake_ai_night_static_cycle',
    postedKey:      'jake_ai_night_posted',
    historyKey:     'jake_ai_night_history',
    reportKey:      'jake_ai_night_report',
    ctaEligible: false,
  },
};

// CTA：月・水・金の朝枠のみ。スクアドAIチャットとSCADビューティーを交互表示
const CTA_LAST_KEY = 'jake_ai_cta_last';
const CTA_OPTIONS = {
  sukuado: '\n\n---\n生成AIを実際のアプリに落とし込んだ例として、婚活AI相談アプリ「スクアド」も動いています。\nhttps://scad-chat.vercel.app/',
  beauty:  '\n\n---\n生成AIの活用例として、AIパーソナルカラー診断アプリ「SCADビューティー」も動いています。\nhttps://scad-beauty.vercel.app/',
};

// ============================================================
// Xの重み付き文字数（Migoron・スクアド側と同一実装）
// ============================================================
function weightedLength(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  const stripped = text.replace(urlRegex, '');
  let total = urls.length * 23;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    const isWeight1 =
      (cp >= 0x0000 && cp <= 0x10ff) ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    total += isWeight1 ? 1 : 2;
  }
  return total;
}

// ============================================================
// カテゴリ分散並べ替え（静的フォールバック用。スクアドと同一ロジック）
// ============================================================
function interleaveByCategory(items) {
  const buckets = new Map();
  for (const it of items) {
    const c = it.cat || '_';
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(it);
  }
  const order = [];
  for (const it of items) {
    const c = it.cat || '_';
    if (!order.includes(c)) order.push(c);
  }
  const result = [];
  let remaining = items.length;
  while (remaining > 0) {
    for (const c of order) {
      const q = buckets.get(c);
      if (q && q.length > 0) {
        result.push(q.shift());
        remaining--;
      }
    }
  }
  return result;
}

// ============================================================
// X投稿（リトライ付き・重複403は再試行しない）
// ============================================================
function isDuplicateError(err) {
  // 「重複」以外の403（権限不足・課金設定不足など）まで重複扱いにすると
  // 本当のエラーが握りつぶされて「投稿されないのに毎回成功扱い」になるため、
  // 本文に"duplicate"を含む場合のみ重複と判定する（コード403だけでは判定しない）
  const msg = ((err && err.message) || '') + ' ' + JSON.stringify((err && err.data) || {});
  return /duplicate/i.test(msg);
}

async function tweetWithRetry(xClient, text, attempts = 3) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await xClient.v2.tweet(text);
      return { ok: true, id: res && res.data ? res.data.id : null, attempts: i };
    } catch (err) {
      lastErr = err;
      if (isDuplicateError(err)) {
        return { ok: false, duplicate: true, error: err, attempts: i };
      }
      if (i < attempts) await new Promise(r => setTimeout(r, 4000 * i));
    }
  }
  return { ok: false, duplicate: false, error: lastErr, attempts };
}

function describeXError(err, text, attempts) {
  const detail = err && err.data ? JSON.stringify(err.data).slice(0, 300) : '';
  return 'error: ' + (err && err.message ? err.message : String(err))
    + (detail ? ' | detail: ' + detail : '')
    + ' | w:' + weightedLength(text)
    + ' | attempts:' + attempts;
}

function getDateStringJST() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function getJstDay() {
  // 0=日, 1=月, ... 6=土
  return new Date(Date.now() + 9 * 3600000).getUTCDay();
}

// X投稿と同じ文面を @jake_images_ のThreadsへテキスト投稿（画像なし・ベストエフォート）
async function postTextToThreads(token, text) {
  if (!token) return null;
  const meRes = await fetch('https://graph.threads.net/v1.0/me?fields=id&access_token=' + token);
  const me = await meRes.json();
  if (me.error) throw new Error('Threads me: ' + me.error.message);
  const cRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token }),
  });
  const c = await cRes.json();
  if (c.error) throw new Error('Threads container: ' + c.error.message);
  await new Promise(r => setTimeout(r, 2000));
  const pRes = await fetch('https://graph.threads.net/v1.0/' + me.id + '/threads_publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: token }),
  });
  const p = await pRes.json();
  if (p.error) throw new Error('Threads publish: ' + p.error.message);
  return p.id;
}

// ============================================================
// 動的生成：Gemini + Google検索grounding
// ============================================================
function buildPrompt(slot, history) {
  const historyText = history.length ? history.map(h => '・' + h).join('\n') : '（まだ履歴なし）';
  return `あなたは生成AIニュースを日本語で発信するXアカウント「@jake_images」の投稿担当です。\n`
    + `${slot.promptTopic}について、Google検索で最新情報を確認し、実際に存在する具体的な内容を1つ選んでください。\n\n`
    + `【直近${HISTORY_DAYS}日以内に投稿済みのため避けるべき話題】\n${historyText}\n\n`
    + `【出力条件】\n`
    + `- 本文は日本語で120字程度。URLやハッシュタグ、出典表記は本文に含めない（別項目で出力する）\n`
    + `- Google検索で確認できる事実のみを扱う。存在しない情報を創作しない\n`
    + `- 出典メディア名（例：Yahoo!ニュース、日本経済新聞、ITmediaなど）を15字以内で\n`
    + `- 出典記事のURLを1つ\n`
    + `- 関連ハッシュタグを1〜2個（${slot.hashtagHint}）。#記号は付けず単語のみ\n`
    + `- 確認できる話題がなければ topic を "NO_NEWS" にする\n\n`
    + `必ず以下のJSON形式のみで出力してください。マークダウンや説明文は不要です。\n`
    + `{"topic":"話題を15字以内で要約したもの（重複チェック用）","body":"本文のみ。改行は\\nで表現","sourceName":"出典メディア名","sourceUrl":"出典URL","hashtags":["タグ1","タグ2"]}`;
}

async function callGeminiWithSearch(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 512 },
      },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Gemini Error: ' + data.error.message);
  const candidate = data.candidates && data.candidates[0];
  const finishReason = (candidate && candidate.finishReason) || 'UNKNOWN';
  if (!candidate || !candidate.content) throw new Error(`Gemini: candidatesが空です（finishReason=${finishReason}）`);
  // 検索の引用が原文に近すぎる場合など、STOP以外で打ち切られることがある
  if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(finishReason)) {
    throw new Error(`Gemini: 応答がブロックされました（finishReason=${finishReason}）`);
  }
  const parts = candidate.content.parts || [];
  const textPart = parts.find(p => p.text && !p.thought);
  const text = (textPart ? textPart.text : (parts[parts.length - 1] || {}).text || '').trim();
  if (!text) throw new Error(`Gemini: 空の応答（finishReason=${finishReason}）`);
  return { text, finishReason };
}

function parseGeminiTweet(raw, finishReason) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Gemini: JSON形式で返答がありません（finishReason=${finishReason}, len=${clean.length}）: ${clean.slice(0, 300)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Gemini: JSON解析失敗（finishReason=${finishReason}）: ${e.message} | raw: ${match[0].slice(0, 300)}`);
  }
  if (!parsed.body || parsed.topic === 'NO_NEWS') {
    throw new Error('Gemini: 該当ニュース/事例なし（NO_NEWS）');
  }
  if (!parsed.sourceUrl) {
    throw new Error('Gemini: 出典URLが取得できませんでした');
  }
  // 本文・出典・ハッシュタグはAIに構造化データとして出させ、最終的な文面組み立てはコード側で確定させる
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.filter(Boolean).map(h => '#' + String(h).trim().replace(/^#/, ''))
    : [];
  const sourceLine = parsed.sourceName
    ? `（出典：${String(parsed.sourceName).trim()}）\n${String(parsed.sourceUrl).trim()}`
    : String(parsed.sourceUrl).trim();
  const tweet = [String(parsed.body).trim(), sourceLine, hashtags.join(' ')]
    .filter(Boolean)
    .join('\n\n');
  return { tweet, topic: String(parsed.topic || '').trim() };
}

async function generateDynamicTweet(slot, history) {
  const prompt = buildPrompt(slot, history);
  const { text, finishReason } = await callGeminiWithSearch(process.env.GEMINI_API_KEY, prompt);
  const { tweet, topic } = parseGeminiTweet(text, finishReason);
  const w = weightedLength(tweet);
  if (w > X_LIMIT) throw new Error(`生成ツイートが文字数超過(${w})`);
  return { tweet, topic, source: 'dynamic' };
}

// ============================================================
// 静的フォールバック（立ち上げ用20本。動的生成が失敗した時のみ使用）
// ============================================================
async function pickStaticFallback(slot) {
  const ordered = interleaveByCategory(slot.data.items);
  const total = ordered.length;
  let idx = await redis.get(slot.staticIdxKey);
  if (idx === null || idx === undefined) idx = 0;
  idx = parseInt(idx) % total;
  const item = ordered[idx];
  return { tweet: item.tweet, topic: item.cat, source: 'static', staticId: item.id, staticIdx: idx, staticTotal: total };
}

async function advanceStaticIndex(slot, idx, total) {
  const nextIdx = (idx + 1) % total;
  await redis.set(slot.staticIdxKey, nextIdx);
  if (nextIdx === 0) {
    const cycle = parseInt((await redis.get(slot.staticCycleKey)) || '0') + 1;
    await redis.set(slot.staticCycleKey, cycle);
  }
}

// ============================================================
// 投稿履歴（重複防止用。直近14件のtopicを保持）
// ============================================================
async function getHistory(slot) {
  const raw = await redis.get(slot.historyKey);
  if (!raw) return [];
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
}

async function pushHistory(slot, topic) {
  if (!topic) return;
  const history = await getHistory(slot);
  history.push(topic);
  await redis.set(slot.historyKey, JSON.stringify(history.slice(-HISTORY_DAYS)));
}

// ============================================================
// メイン：runJakeAI(request, slotName)
// ============================================================
export async function runJakeAI(request, slotName) {
  const url = new URL(request.url);
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
  const slot = SLOTS[slotName];
  if (!slot) {
    return new Response(JSON.stringify({ error: 'unknown slot: ' + slotName }), { status: 500, headers: jsonHeaders });
  }

  // 認証：Authorizationヘッダー または ?key=
  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ?report=1 → 前回レポートを表示（投稿しない）
  if (url.searchParams.get('report') === '1') {
    try {
      const [rep, staticIdx, staticCycle, posted, history, ctaLast] = await Promise.all([
        redis.get(slot.reportKey),
        redis.get(slot.staticIdxKey),
        redis.get(slot.staticCycleKey),
        redis.get(slot.postedKey),
        getHistory(slot),
        redis.get(CTA_LAST_KEY),
      ]);
      const parsed = typeof rep === 'string' ? JSON.parse(rep) : rep;
      return new Response(JSON.stringify({
        slot: slotName,
        lastReport: parsed,
        state: {
          nextStaticIndex: staticIdx ?? '(未設定=0から)',
          staticCycle: staticCycle ?? 0,
          lastPostedDate: posted ?? '(記録なし)',
          history,
          ctaLast: ctaLast ?? '(未設定)',
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun = url.searchParams.get('dry') === '1';
  const force  = url.searchParams.get('force') === '1';
  const today  = getDateStringJST();

  const report = {
    slot: slotName,
    dryRun,
    startedAt: new Date().toISOString(),
  };

  try {
    // 重複投稿防止（force=1・dry=1では無視）
    if (!force && !dryRun) {
      const lastPosted = await redis.get(slot.postedKey);
      if (lastPosted === today) {
        report.result = '本日投稿済みのためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
    }

    const history = await getHistory(slot);

    // 1) 動的生成を試みる。失敗したら静的JSONにフォールバック
    let content;
    try {
      content = await generateDynamicTweet(slot, history);
      report.generation = 'dynamic';
    } catch (genErr) {
      report.dynamicError = genErr.message;
      content = await pickStaticFallback(slot);
      report.generation = 'static_fallback';
    }

    let text = content.tweet;
    report.picked = {
      source: content.source,
      topic: content.topic || null,
      staticId: content.staticId || null,
      weighted: weightedLength(text),
    };

    // 2) CTA付与判定（朝枠・月水金のみ。スクアド/SCADビューティーを交互表示）
    let ctaKeyUsed = null;
    if (slot.ctaEligible && [1, 3, 5].includes(getJstDay())) {
      const lastCta = await redis.get(CTA_LAST_KEY);
      const nextCta = lastCta === 'sukuado' ? 'beauty' : 'sukuado';
      const withCta = text + CTA_OPTIONS[nextCta];
      if (weightedLength(withCta) <= X_LIMIT) {
        text = withCta;
        ctaKeyUsed = nextCta;
      } else {
        report.ctaSkipped = '文字数超過のためCTAなしで投稿';
      }
    }

    const w = weightedLength(text);
    report.finalWeighted = w;

    // ?dry=1 → 生成結果を返すのみ（投稿しない・状態も更新しない）
    if (dryRun) {
      report.result = 'dry run（投稿していません）';
      report.tweetPreview = text;
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
    }

    if (w > X_LIMIT) {
      report.result = `文字数超過(${w})のため投稿中止`;
      try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 500, headers: jsonHeaders });
    }

    // X投稿
    const xClient = new TwitterApi({
      appKey:       process.env.JAKE_X_API_KEY,
      appSecret:    process.env.JAKE_X_API_SECRET,
      accessToken:  process.env.JAKE_X_ACCESS_TOKEN,
      accessSecret: process.env.JAKE_X_ACCESS_SECRET,
    });

    const r = await tweetWithRetry(xClient, text);

    if (r.ok || r.duplicate) {
      // 成功後（重複含む）に状態を確定
      await redis.set(slot.postedKey, today, { ex: 82800 });
      if (content.source === 'dynamic' && content.topic) {
        await pushHistory(slot, content.topic);
      }
      if (content.source === 'static') {
        await advanceStaticIndex(slot, content.staticIdx, content.staticTotal);
      }
      if (ctaKeyUsed) await redis.set(CTA_LAST_KEY, ctaKeyUsed);

      report.result = r.ok ? 'ok' : '重複のため投稿されず（状態は進めた）';
      if (r.ok) report.tweetId = r.id;

      // 同じ文面を @jake_images_ のThreadsへ（ベストエフォート・失敗してもX投稿の成功には影響しない）
      if (r.ok) {
        try {
          const threadsId = await postTextToThreads(process.env.THREADS_JAKE_TOKEN, text);
          report.threads = threadsId ? 'ok: ' + threadsId : 'skip（トークン未設定）';
        } catch (te) {
          report.threads = 'error: ' + te.message;
        }
      }
    } else {
      // 恒久エラー：状態は進めない（次回同じ投稿を再試行）
      report.result = describeXError(r.error, text, r.attempts);
    }

    report.finishedAt = new Date().toISOString();
    try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), {
      status: r.ok || r.duplicate ? 200 : 500,
      headers: jsonHeaders,
    });

  } catch (error) {
    report.fatalError = error.message;
    try { await redis.set(slot.reportKey, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}

// ============================================================
// 「ノーコード×生成AI開発 30日振り返り」企画（夜枠の2件目）
// ============================================================
// 夜cronから runJakeAI(request, 'night') と並行して呼ばれる、独立した投稿枠。
// 固定30本を1日1本ずつ投稿し、day30まで終わったらループせず自動停止する。
// 新しいVercel cronは追加しない（既存の夜cronの中でもう1件投稿するだけ）。
const DIARY_TOTAL      = diaryData.items.length;
const DIARY_IDX_KEY    = 'jake_ai_diary_idx';
const DIARY_POSTED_KEY = 'jake_ai_diary_posted';
const DIARY_REPORT_KEY = 'jake_ai_diary_report';

export async function runJakeAIDiary(request) {
  const url = new URL(request.url);
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  const authHeader = request.headers.get('authorization');
  const keyParam   = url.searchParams.get('key');
  const authorized =
    authHeader === 'Bearer ' + process.env.CRON_SECRET ||
    (keyParam && keyParam === process.env.CRON_SECRET);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (url.searchParams.get('report') === '1') {
    try {
      const [rep, idx, posted] = await Promise.all([
        redis.get(DIARY_REPORT_KEY),
        redis.get(DIARY_IDX_KEY),
        redis.get(DIARY_POSTED_KEY),
      ]);
      const parsed = typeof rep === 'string' ? JSON.parse(rep) : rep;
      const nextIdx = idx === null || idx === undefined ? 0 : parseInt(idx);
      return new Response(JSON.stringify({
        lastReport: parsed,
        state: {
          nextDay: nextIdx >= DIARY_TOTAL ? '完了' : nextIdx + 1,
          total: DIARY_TOTAL,
          lastPostedDate: posted ?? '(記録なし)',
        },
      }, null, 2), { status: 200, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'レポート取得失敗: ' + e.message }), { status: 500, headers: jsonHeaders });
    }
  }

  const dryRun = url.searchParams.get('dry') === '1';
  const force  = url.searchParams.get('force') === '1';
  const today  = getDateStringJST();
  const report = { dryRun, startedAt: new Date().toISOString() };

  try {
    let idx = await redis.get(DIARY_IDX_KEY);
    idx = idx === null || idx === undefined ? 0 : parseInt(idx);

    if (idx >= DIARY_TOTAL) {
      report.result = '30日分の投稿が完了しています（追加投稿なし）';
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
    }

    if (!force && !dryRun) {
      const lastPosted = await redis.get(DIARY_POSTED_KEY);
      if (lastPosted === today) {
        report.result = '本日分は投稿済みのためスキップ';
        return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
      }
    }

    const item = diaryData.items[idx];
    const text = item.tweet;
    const w    = weightedLength(text);
    report.day = item.day;
    report.weighted = w;

    if (dryRun) {
      report.result = 'dry run（投稿していません）';
      report.tweetPreview = text;
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 200, headers: jsonHeaders });
    }

    if (w > X_LIMIT) {
      report.result = `文字数超過(${w})のため投稿中止`;
      try { await redis.set(DIARY_REPORT_KEY, JSON.stringify(report)); } catch {}
      return new Response(JSON.stringify({ message: report.result, report }, null, 2), { status: 500, headers: jsonHeaders });
    }

    const xClient = new TwitterApi({
      appKey:       process.env.JAKE_X_API_KEY,
      appSecret:    process.env.JAKE_X_API_SECRET,
      accessToken:  process.env.JAKE_X_ACCESS_TOKEN,
      accessSecret: process.env.JAKE_X_ACCESS_SECRET,
    });

    const r = await tweetWithRetry(xClient, text);

    if (r.ok || r.duplicate) {
      await redis.set(DIARY_IDX_KEY, idx + 1);
      await redis.set(DIARY_POSTED_KEY, today, { ex: 82800 });
      report.result = r.ok ? 'ok' : '重複のため投稿されず（状態は進めた）';
      if (r.ok) {
        report.tweetId = r.id;
        try {
          const threadsId = await postTextToThreads(process.env.THREADS_JAKE_TOKEN, text);
          report.threads = threadsId ? 'ok: ' + threadsId : 'skip（トークン未設定）';
        } catch (te) {
          report.threads = 'error: ' + te.message;
        }
      }
    } else {
      report.result = describeXError(r.error, text, r.attempts);
    }

    report.finishedAt = new Date().toISOString();
    try { await redis.set(DIARY_REPORT_KEY, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ message: 'Done', report }, null, 2), {
      status: r.ok || r.duplicate ? 200 : 500,
      headers: jsonHeaders,
    });

  } catch (error) {
    report.fatalError = error.message;
    try { await redis.set(DIARY_REPORT_KEY, JSON.stringify(report)); } catch {}
    return new Response(JSON.stringify({ error: error.message, report }, null, 2), { status: 500, headers: jsonHeaders });
  }
}
