/**
 * 前半の選択式プロフィール項目。会場で文字入力をさせないため、原則タップだけで完結させる。
 * type: 'multi' は複数選択（チェック方式）。省略時は単一選択。
 * 主催者はイベントごとに項目の使う/使わないだけを切り替えられる（選択肢の中身は固定・編集不可）。
 */
export interface ProfileField {
  key: string;
  label: string;
  options: string[];
  type?: 'single' | 'multi';
}

export const PROFILE_FIELDS: ProfileField[] = [
  { key: 'age_group', label: '年代', options: ['20s', '30s', '40s', '50s+'] },
  { key: 'residence', label: '住まい', options: ['東京都', '関東', 'それ以外'] },
  // 出身は「地元/県内/県外」だとどこを基準にした話か人によってずれるため、住まいと同じ区分にそろえる
  { key: 'hometown', label: '出身', options: ['東京都', '関東', 'それ以外'] },
  {
    key: 'occupation', label: '職業',
    options: ['IT', '医療', '公務員', 'サービス', '製造', '販売', '自営', '無職・バイト', 'その他'],
  },
  { key: 'income', label: '年収（百万円）', options: ['〜200', '〜500', '〜800', '〜1200', 'それ以上'] },
  { key: 'holiday', label: '休日', options: ['土日', '平日', '不定期'] },
  { key: 'blood_type', label: '血液型', options: ['A', 'B', 'O', 'AB', '不明'] },
  { key: 'height', label: '身長', options: ['〜155', '155-165', '165-175', '175-185', '185〜'] },
  { key: 'marital_status', label: '婚姻歴', options: ['未婚', '離婚歴あり'] },
  { key: 'smoking', label: '喫煙', options: ['吸わない', 'たまに', '吸う'] },
  { key: 'drinking', label: '飲酒', options: ['飲まない', 'たまに', '飲む'] },
  { key: 'marriage_intent', label: '結婚への意欲', options: ['すぐにでも', 'いずれは', 'まだ考え中'] },
  {
    key: 'sns', label: 'やっているSNS（会話のきっかけに。IDは聞きません）',
    options: ['インスタ', 'TikTok', 'FB', 'それ以外'], type: 'multi',
  },
];

export const PROFILE_FIELD_KEYS = PROFILE_FIELDS.map((f) => f.key);

/** 年代の表示名。統計側は英語キーのまま持ち、表示だけ日本語にする */
export const AGE_GROUP_LABEL: Record<string, string> = {
  '20s': '20代', '30s': '30代', '40s': '40代', '50s+': '50代以上',
};

export function labelOf(key: string, value: string | string[]): string {
  if (Array.isArray(value)) return value.map((v) => labelOf(key, v)).join('・');
  if (key === 'age_group') return AGE_GROUP_LABEL[value] ?? value;
  if (key === 'height') return `${value}cm`;
  return value;
}

/**
 * 主催者が「その項目を入れると参加者に何が聞かれるのか」を一目で判断できるようにする。
 * 項目名だけだと選択肢の粒度が分からず、使う/使わないを決めにくい。
 */
export function optionsPreview(field: ProfileField): string {
  return field.options.map((o) => labelOf(field.key, o)).join(' / ');
}
