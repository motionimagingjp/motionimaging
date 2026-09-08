#!/usr/bin/env bash
# partyconnect/ を履歴ごと独立リポジトリへ切り出す。
# 仕様書も docs/requirements.md として持っていき、README のリンクを張り替える。
#
#   bash partyconnect/scripts/split-repo.sh /path/to/output
set -euo pipefail

dest="${1:?出力先ディレクトリを指定してください}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -e "$dest" ]; then
    echo "エラー: $dest は既に存在します" >&2
    exit 1
fi

echo "==> partyconnect/ の履歴を切り出します"
git -C "$repo_root" subtree split --prefix=partyconnect -b partyconnect-split >/dev/null

git clone --branch partyconnect-split --single-branch "$repo_root" "$dest" >/dev/null 2>&1
git -C "$dest" branch -m partyconnect-split main
git -C "$dest" remote remove origin
git -C "$repo_root" branch -D partyconnect-split >/dev/null

echo "==> 仕様書を持っていきます"
mkdir -p "$dest/docs"
cp "$repo_root/docs/partyconnect_requirements.md" "$dest/docs/requirements.md"
# 切り出し後は ../docs/ が存在しないのでリンクを張り替える
sed -i 's|\.\./docs/partyconnect_requirements\.md|docs/requirements.md|g' "$dest/README.md"

git -C "$dest" add -A
git -C "$dest" commit -q -m "Bring the requirements document into the standalone repository

The README pointed at ../docs/partyconnect_requirements.md, which does not
exist once this directory stands on its own. The document now lives at
docs/requirements.md and the link points there."

echo "==> 完了: $dest"
echo "    git remote add origin <新しいリポジトリのURL> && git push -u origin main"
