#!/usr/bin/env bash
# REFERENCE COPY. The live hook sits on the self-hosted Mac, outside any
# checkout and not writable by the runner user. See docs/ci.md,
# "Self-hosted runner runbook".
#
# Wired in each runner folder's .env:
#   ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/libexec/naba-runner/post-job.sh
#
# Makes a persistent runner behave nearly like an ephemeral one: no database,
# server or browser survives a job, and the workspace is cleaned. The pnpm
# store and the Playwright browser cache are kept on purpose.
set -uo pipefail

temp="${RUNNER_TEMP:-}"
workspace="${GITHUB_WORKSPACE:-}"

# Throwaway clusters from scripts/ci/postgres.mjs (native mode) keep their
# data directory under $RUNNER_TEMP.
if [ -n "$temp" ] && [ -d "$temp" ]; then
  find "$temp" -maxdepth 4 -name postmaster.pid 2>/dev/null | while read -r pid; do
    data=$(dirname "$pid")
    echo "post-job: stopping PostgreSQL in $data"
    pg_ctl -D "$data" stop -m immediate >/dev/null 2>&1 \
      || "$(brew --prefix postgresql@17)/bin/pg_ctl" -D "$data" stop -m immediate >/dev/null 2>&1 \
      || true
  done
fi

pkill -u "$(id -un)" -f 'standalone/server.js|postgres -D|playwright' 2>/dev/null || true

if [ -n "$temp" ] && [ -d "$temp" ]; then
  rm -rf "${temp:?}"/* "${temp:?}"/.[!.]* 2>/dev/null || true
fi

if [ -n "$workspace" ] && [ -d "$workspace/.git" ]; then
  git -C "$workspace" clean -ffdx -q || true
fi

echo "post-job: cleanup done"
exit 0
