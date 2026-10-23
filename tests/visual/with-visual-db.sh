#!/bin/sh
# Runs a command against the isolated `naba_visual` database on the local
# Supabase Postgres instead of the shared dev database. Other sessions'
# integration and e2e runs reset the shared database, and `next dev` signs
# any request without a valid session in as the local owner. On its own
# database the fixture app can never see or touch the real dev organisation.
set -e
cd "$(dirname "$0")/../.."
swap() { grep "^$1=" .env.local | cut -d= -f2- | sed 's#/postgres$#/naba_visual#'; }
export DATABASE_URL="$(swap DATABASE_URL)"
export DIRECT_DATABASE_URL="$(swap DIRECT_DATABASE_URL)"
case "$DATABASE_URL$DIRECT_DATABASE_URL" in
  *naba_visual*naba_visual*) ;;
  *) echo "with-visual-db: could not derive naba_visual URLs" >&2; exit 1 ;;
esac
# naba_visual lives on the local Supabase cluster (port 54322), which the
# harness guard refuses by default (scripts/test-database.mjs). This is the
# deliberate exception: a separate database, checked just above. Pin the
# session URL to it too, so nothing falls back to the dev database's.
export DATABASE_SESSION_URL="$DATABASE_URL"
export NABA_ALLOW_DEV_DB=1
exec "$@"
