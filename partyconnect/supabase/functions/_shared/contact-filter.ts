/**
 * 自由記述・ニックネームへの連絡先記入をブロックする。
 * 仕様: docs/partyconnect_requirements.md 11-1「これを怠ると要件③が復活する」
 *
 * 重要:
 *  - 必ずサーバ側(Edge Function)で実行する。クライアント側のみのチェックは API 直叩きで回避される
 *  - 完全な検出は原理的に不可能。主催者による開始時アナウンスと二重で担保する運用が前提
 *  - 検出内容そのものはログに残さない（残すと連絡先をログに保存することになる）
 */

export interface ContactScanResult {
  blocked: boolean;
  /** 検出したルール名。監査用。入力内容そのものは含めない */
  rules: string[];
}

/** 連絡先とみなす数字の連続桁数。電話番号(10〜11桁)を確実に捕まえつつ、年号や身長を誤検出しない */
const DIGIT_RUN_THRESHOLD = 8;

/** 数字を分断して隠すのに使われる区切り文字 */
const SEPARATORS = /[\s.\-‐‑–—―−ー~〜〰_/|()（）［］\[\]・:：;；,、]+/g;

const URL_PATTERN = /(https?:\/\/|www\.)/;
const CONTACT_DOMAIN_PATTERN =
  /(line\.me|lin\.ee|t\.co|instagram\.com|facebook\.com|kakao|discord\.gg|open\.kakao)/;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/;
/** @ で始まるハンドル。前が英数字でない場合のみ（メールアドレスの一部を二重に数えない） */
const HANDLE_PATTERN = /(^|[^a-z0-9])@[a-z0-9_.]{2,}/;

/**
 * 連絡先を示すキーワード。単独では判定せず、近傍に英数字トークンがある場合のみブロックする。
 * 「スカイラインが好き」のような誤検出を避けるための設計。
 */
const CONTACT_KEYWORDS = [
  'line', 'ライン', 'らいん', 'アイディ', 'アイディー', 'あいでぃ',
  '連絡先', 'アドレス', 'あどれす', 'メール', 'mail', 'めーる',
  '電話', 'tel', '携帯', 'ケータイ', 'けーたい',
  'インスタ', 'insta', 'instagram', 'twitter', 'カカオ', 'kakao',
  'discord', 'ディスコ', 'skype', 'スカイプ',
];
/** 単語境界が必要なキーワード（id は「アイドル」「video」等に含まれるため別扱い） */
const BOUNDED_KEYWORD_PATTERN = /(^|[^a-z0-9])id([^a-z0-9]|$)/;

/** キーワード直後にこの形のトークンがあれば連絡先の記入とみなす */
const IDENTIFIER_TOKEN = /[a-z0-9][a-z0-9_.\-]{3,}/;
/** キーワードから何文字先までを近傍とみなすか */
const KEYWORD_LOOKAHEAD = 16;

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 区切り文字を取り除いたうえでの、最長の連続数字桁数 */
function longestDigitRun(normalized: string): number {
  const joined = normalized.replace(SEPARATORS, '');
  let max = 0;
  let cur = 0;
  for (const ch of joined) {
    if (ch >= '0' && ch <= '9') {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

function hasKeywordWithIdentifier(normalized: string): boolean {
  for (const keyword of CONTACT_KEYWORDS) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(keyword, from);
      if (at === -1) break;
      const tail = normalized.slice(at + keyword.length, at + keyword.length + KEYWORD_LOOKAHEAD);
      if (IDENTIFIER_TOKEN.test(tail)) return true;
      from = at + keyword.length;
    }
  }
  const bounded = BOUNDED_KEYWORD_PATTERN.exec(normalized);
  if (bounded) {
    const tail = normalized.slice(bounded.index + bounded[0].length, bounded.index + bounded[0].length + KEYWORD_LOOKAHEAD);
    if (IDENTIFIER_TOKEN.test(tail)) return true;
  }
  return false;
}

export function scanForContactInfo(text: string | null | undefined): ContactScanResult {
  if (!text) return { blocked: false, rules: [] };
  const normalized = normalize(text);
  const rules: string[] = [];

  if (URL_PATTERN.test(normalized)) rules.push('url');
  if (CONTACT_DOMAIN_PATTERN.test(normalized)) rules.push('contact_domain');
  if (EMAIL_PATTERN.test(normalized)) rules.push('email');
  if (HANDLE_PATTERN.test(normalized)) rules.push('handle');
  if (longestDigitRun(normalized) >= DIGIT_RUN_THRESHOLD) rules.push('digit_run');
  if (hasKeywordWithIdentifier(normalized)) rules.push('keyword_with_identifier');

  return { blocked: rules.length > 0, rules };
}

export const CONTACT_BLOCKED_MESSAGE =
  '連絡先はご入力いただけません。交換は会場で直接お願いします。';

export class ContactInfoRejected extends Error {
  readonly field: string;
  readonly rules: string[];
  constructor(field: string, rules: string[]) {
    super(CONTACT_BLOCKED_MESSAGE);
    this.name = 'ContactInfoRejected';
    this.field = field;
    this.rules = rules;
  }
}

/** 連絡先が含まれていれば ContactInfoRejected を投げる */
export function assertNoContactInfo(text: string | null | undefined, field: string): void {
  const result = scanForContactInfo(text);
  if (result.blocked) throw new ContactInfoRejected(field, result.rules);
}
