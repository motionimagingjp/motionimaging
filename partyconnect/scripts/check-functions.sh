#!/usr/bin/env bash
# Edge Function の型チェックと lint。deno が必要（npm i -g deno でも入る）。
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/functions"

if ! command -v deno >/dev/null 2>&1; then
    echo "deno が見つかりません。 npm i -g deno でインストールしてください" >&2
    exit 1
fi

# --all は付けない。npm パッケージが持ち込む @types/node と Deno のグローバル型が衝突し、
# 自分のコードとは無関係なエラーになるため。
deno check $(ls -d */ | grep -v _shared | sed 's|$|index.ts|')
deno lint
echo "==> Edge Function チェック完了"
