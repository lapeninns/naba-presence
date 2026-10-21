#!/usr/bin/env bash
# REFERENCE COPY. The live hook sits on the self-hosted Mac, outside any
# checkout and not writable by the runner user. See docs/ci.md,
# "Self-hosted runner runbook".
#
# Wired in each runner folder's .env:
#   ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/libexec/naba-runner/post-job.sh
#
# Makes a persistent runner behave nearly like an ephemeral one: no database,
# server or browser of this job survives it, and the workspace is deleted,
# .git included, so nothing a job wrote there (.git/config, hooks) reaches the
# next job. Only this job's processes are stopped; the other instance runs as
# the same user and keeps its live job. The pnpm store and the Playwright
# browser cache are kept on purpose.
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

# shellcheck source=scripts/ci/runner-hooks/job-processes.sh
if . "$(dirname "${BASH_SOURCE[0]}")/job-processes.sh"; then
  stop_job_processes "$temp" "$workspace"
else
  echo "post-job: job-processes.sh is missing; no processes stopped" >&2
fi

if [ -n "$temp" ] && [ -d "$temp" ]; then
  rm -rf "${temp:?}"/* "${temp:?}"/.[!.]* 2>/dev/null || true
fi

# Only a workspace inside a runner's _work folder (config.sh --work _work) is
# deleted, never /, $HOME or anything a misconfigured variable points at.
case "$workspace" in
  /*/_work/?*)
    if [ -d "$workspace" ] && [ "${workspace%/}" != "${HOME%/}" ]; then
      cd / || exit 0
      rm -rf "${workspace:?}" 2>/dev/null || true
      # The runner expects the folder; actions/checkout fills it again.
      mkdir -p "$workspace" 2>/dev/null || true
      echo "post-job: deleted workspace $workspace"
    fi
    ;;
  "") ;;
  *) echo "post-job: workspace $workspace is outside _work; left alone" >&2 ;;
esac

echo "post-job: cleanup done"
exit 0
