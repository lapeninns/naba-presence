#!/usr/bin/env bash
# Run a PostgreSQL 17 client tool (psql, pg_dump, ...) against the throwaway
# cluster from scripts/ci/postgres.mjs, whatever the runner has installed.
#
#   scripts/ci/pg-client.sh pg_dump --schema-only "$DIRECT_DATABASE_URL"
#
# Hosted Ubuntu ships an older client that refuses to dump a 17 server, so on
# Linux (docker mode) the tool runs from the same postgres:17-alpine image on
# the host network. On macOS (native mode) it uses Homebrew postgresql@17, or
# NABA_PG_BIN when set.
set -euo pipefail

tool="${1:?usage: pg-client.sh <tool> [args...]}"
shift

mode="${NABA_PG_MODE:-$([ "$(uname -s)" = Darwin ] && echo native || echo docker)}"
if [ "$mode" = docker ]; then
  exec docker run --rm -i --network host postgres:17-alpine "$tool" "$@"
fi
bin="${NABA_PG_BIN:-$(brew --prefix postgresql@17)/bin}"
exec "$bin/$tool" "$@"
