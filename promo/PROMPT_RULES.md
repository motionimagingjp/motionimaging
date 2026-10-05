# 宣伝動画・画像 生成ルール

Higgsfield等で人物画像・動画を作るときは、毎回プロンプトに以下を含め、生成後にチェックする。

## 1. AIっぽさを抜く（強いレタッチ・肌補正なし）
プロンプトに入れる:
> Candid iPhone-style snapshot, not a studio photo. Unretouched natural skin: visible pores, slight under-eye shadows, flyaway hairs, no beauty filter, no airbrushing, no glow. Slight grain, natural color, real lived-in room.

## 2. スマホの向き（AIのよくある間違い対策）
スマホが映るシーンでは必ず入れる:
> The phone's screen faces the person holding it. The back of the phone, facing the camera, shows the camera lenses and a plain back panel. No screen on the back, no double-sided phone.

生成後チェック:
- 画面は持っている本人側を向いているか
- カメラ側から見える裏面にレンズがあるか（裏にも画面があるのはNG）
- 指の本数・持ち方が自然か

## 3. 明るさ（常に明るい印象）
- 生成時: `bright, well-exposed, soft airy light, no crushed shadows` を入れる（夜のシーンでも暗くしすぎない）
- 仕上げ時: 組み立て段階で全カットに明るさ+約7%（5〜10%の範囲）を一律でかける
  - ffmpeg例: `-vf "eq=brightness=0.03:gamma=1.07"`
  - 画像(PIL)例: `ImageEnhance.Brightness(img).enhance(1.07)`

## 4. 共通
- 主人公は基準画像（Higgsfield job `72cfdc74-a439-421d-ae9d-62f08136bf85`）を参照して同じ顔に揃える
- 透かし入り素材（CapCut AI等）は使わない
- 投稿時は「AI生成」ラベルON、「※演出です」「※AIの回答は一例です」を表記

## 5. 使用NGの素材
- 本物のLINE画面・第三者の情報が写った録画やスクショ（サンプル会話画像のみ使う）
