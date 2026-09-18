#!/usr/bin/env bash
# マイグレーションと RLS / RPC の挙動をローカル postgres で検証する。
# Supabase の auth スキーマ・ロール・既定 GRANT は tests/sql/00_supabase_shim.sql で再現する。
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/pctest}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-/tmp}"
DB=pc

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    echo "==> postgres を起動します ($PGDATA)"
    if [ ! -d "$PGDATA/base" ]; then
        rm -rf "$PGDATA"; mkdir -p "$PGDATA"
        chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
        su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
    fi
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/pg.log -o '-p $PGPORT -k $PGHOST' -w start" >/dev/null
fi

echo "==> データベースを作り直します"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -q \
     -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>&1 | grep -v NOTICE || true

echo "==> マイグレーションを適用します"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
     -f "$here/tests/sql/00_supabase_shim.sql"
# マイグレーションは番号順に全部当てる。新しいファイルを足しても書き換え不要
for migration in "$here"/supabase/migrations/*.sql; do
    psql -h "$PGHOST" -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$migration"
done

echo "==> RLS / RPC テストを実行します"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
     -f "$here/tests/sql/10_security.test.sql" 2>&1 \
  | grep -E 'PASS|FAIL|ERROR' | sed 's/^psql:[^ ]*: //'

echo "==> SQL テスト完了"
