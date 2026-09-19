'use client';
import { useEffect, useState } from 'react';
import { ApiError, saveProfile, uploadPhoto } from '../lib/api';
import { PROFILE_FIELDS, labelOf } from '../lib/profile-options';
import { loadProfileDraft, saveProfileDraft } from '../lib/storage';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * プロフィールの確認・修正。原則は事前入力で、当日は確認だけで済ませる（仕様 4-1②）。
 * 入力は都度 localStorage に残す。会場の電波が切れても消えないようにするため。
 */
export default function ProfileForm({
  sessionToken, initial, enabledFields, onSaved,
}: {
  sessionToken: string;
  initial: { nickname: string | null };
  enabledFields: string[] | null;
  onSaved: () => void;
}) {
  const fields = enabledFields ? PROFILE_FIELDS.filter((f) => enabledFields.includes(f.key)) : PROFILE_FIELDS;
  const [nickname, setNickname] = useState(initial.nickname ?? '');
  const [profileData, setProfileData] = useState<Record<string, string | string[]>>({});
  const [freeText, setFreeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  const onPhotoSelected = async (file: File | undefined) => {
    if (!file) return;
    setPhotoMessage(null);
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoMessage('写真は5MB以内にしてください');
      return;
    }
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUploading(true);
    try {
      await uploadPhoto(sessionToken, file);
      setPhotoMessage('写真を登録しました');
    } catch (e) {
      setPhotoMessage(e instanceof ApiError ? e.message : 'アップロードに失敗しました');
    } finally {
      setPhotoUploading(false);
    }
  };

  useEffect(() => {
    const draft = loadProfileDraft();
    if (!draft) return;
    if (draft.nickname) setNickname(draft.nickname);
    setProfileData(draft.profileData ?? {});
    setFreeText(draft.freeText ?? '');
  }, []);

  useEffect(() => {
    saveProfileDraft({ nickname, profileData, freeText });
  }, [nickname, profileData, freeText]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveProfile({ sessionToken, nickname, profileData, freeText });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>プロフィールの確認</h2>
      <p className="muted">
        会場で話すきっかけになります。事前に入力済みの方は内容を確認するだけで大丈夫です。
      </p>

      <label htmlFor="nickname">ニックネーム</label>
      <input
        id="nickname"
        value={nickname}
        maxLength={50}
        placeholder="例: たろう"
        onChange={(e) => setNickname(e.target.value)}
      />

      <label htmlFor="photo">写真（任意）</label>
      <p className="muted" style={{ marginTop: -4 }}>
        顔でなくても大丈夫です（料理・趣味の写真など）。イベント終了後に自動で消去されます。
      </p>
      {photoPreview && (
        <img src={photoPreview} alt="" style={{
          width: 96, height: 96, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 8,
        }} />
      )}
      <input
        id="photo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={photoUploading}
        onChange={(e) => onPhotoSelected(e.target.files?.[0])}
      />
      {photoUploading && <p className="muted">アップロード中…</p>}
      {photoMessage && <p className="muted">{photoMessage}</p>}

      {fields.map((field) => {
        const isMulti = field.type === 'multi';
        const current = profileData[field.key];
        const currentList = Array.isArray(current) ? current : [];
        return (
          <div key={field.key}>
            <label>{field.label}</label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
              {field.options.map((option) => {
                const pressed = isMulti ? currentList.includes(option) : current === option;
                return (
                  <button
                    type="button"
                    key={option}
                    className="person"
                    style={{ minHeight: 52, textAlign: 'center' }}
                    aria-pressed={pressed}
                    onClick={() => setProfileData((prev) => {
                      if (isMulti) {
                        const list = Array.isArray(prev[field.key]) ? prev[field.key] as string[] : [];
                        return {
                          ...prev,
                          [field.key]: list.includes(option)
                            ? list.filter((v) => v !== option) : [...list, option],
                        };
                      }
                      return { ...prev, [field.key]: prev[field.key] === option ? '' : option };
                    })}
                  >
                    {labelOf(field.key, option)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <label htmlFor="freeText">自由記述（休日の過ごし方、得意料理など）</label>
      <textarea
        id="freeText"
        value={freeText}
        maxLength={500}
        placeholder="例: 休日はサウナに行きます。得意料理は肉じゃがです。"
        onChange={(e) => setFreeText(e.target.value)}
      />
      <p className="muted">
        連絡先（LINE ID・電話番号・SNSアカウントなど）は入力できません。
        交換は会場で直接お願いします。
      </p>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        <button type="button" className="primary" disabled={saving} onClick={submit}>
          {saving ? '保存中…' : 'この内容で登録する'}
        </button>
      </div>
    </div>
  );
}
