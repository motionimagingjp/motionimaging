/** 前半の選択式プロフィール項目。会場で文字入力をさせないため、原則タップだけで完結させる */
export interface ProfileField {
  key: string;
  label: string;
  options: string[];
}

export const PROFILE_FIELDS: ProfileField[] = [
  { key: 'age_group', label: '年代', options: ['20s', '30s', '40s', '50s+'] },
  { key: 'residence', label: '住まい', options: ['市内', '市外・県内', '県外'] },
  { key: 'hometown', label: '出身', options: ['地元', '県内', '県外', '海外'] },
  { key: 'occupation', label: '職業', options: ['IT', '医療', '公務員', 'サービス', '製造', '販売', '自営', 'その他'] },
  { key: 'holiday', label: '休日', options: ['土日', '平日', '不定期'] },
  { key: 'blood_type', label: '血液型', options: ['A', 'B', 'O', 'AB', '不明'] },
  { key: 'height', label: '身長', options: ['〜155', '155-165', '165-175', '175-185', '185〜'] },
  { key: 'marital_status', label: '婚姻歴', options: ['未婚', '離婚歴あり'] },
];

/** 年代の表示名。統計側は英語キーのまま持ち、表示だけ日本語にする */
export const AGE_GROUP_LABEL: Record<string, string> = {
  '20s': '20代', '30s': '30代', '40s': '40代', '50s+': '50代以上',
};

export function labelOf(key: string, value: string): string {
  if (key === 'age_group') return AGE_GROUP_LABEL[value] ?? value;
  if (key === 'height') return `${value}cm`;
  return value;
}
