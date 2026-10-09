#!/usr/bin/env bash
# REFERENCE COPY. The live hook sits on the self-hosted Mac, outside any
# checkout and not writable by the runner user, so a pull request cannot edit
# it. Editing this file changes nothing on the runner; see docs/ci.md,
# "Self-hosted runner runbook", to install or update it.
#
# Wired in each runner folder's .env:
#   ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/libexec/naba-runner/pre-job.sh
#
# A non-zero exit fails the job before any workflow step runs. This is the
# last line of defence if a fork's workflow file hard-codes
# `runs-on: self-hosted`: the fork controls its YAML, not this script.
set -euo pipefail

deny() {
  echo "naba runner pre-job hook: refusing job: $*" >&2
  exit 1
}

command -v jq >/dev/null || deny "jq is not installed"
[ -r "${GITHUB_EVENT_PATH:-}" ] || deny "no GITHUB_EVENT_PATH"

[ "${GITHUB_REPOSITORY:-}" = "lapeninns/naba-presence" ] \
  || deny "repository ${GITHUB_REPOSITORY:-unset}"

case "${GITHUB_EVENT_NAME:-}" in
  push | schedule | workflow_dispatch)
    [ "${GITHUB_REF:-}" = refs/heads/main ] || deny "$GITHUB_EVENT_NAME on ${GITHUB_REF:-unset}"
    ;;
  pull_request)
    head=$(jq -r '.pull_request.head.repo.full_name // ""' "$GITHUB_EVENT_PATH")
    base=$(jq -r '.pull_request.base.repo.full_name // ""' "$GITHUB_EVENT_PATH")
    author=$(jq -r '.pull_request.user.login // ""' "$GITHUB_EVENT_PATH")
    [ -n "$head" ] && [ "$head" = "$base" ] || deny "cross-repository pull request from ${head:-unknown}"
    [ "$author" != 'dependabot[bot]' ] || deny "Dependabot pull request"
    [ "${GITHUB_ACTOR:-}" != 'dependabot[bot]' ] || deny "Dependabot actor"
    ;;
  *)
    # Includes pull_request_target, issue_comment and workflow_run, which run
    # with secrets on behalf of untrusted input.
    deny "event ${GITHUB_EVENT_NAME:-unset}"
    ;;
esac

# Backstop for a previous job whose post-job hook did not run.
pkill -u "$(id -un)" -f 'standalone/server.js|postgres -D|playwright' 2>/dev/null || true

echo "naba runner pre-job hook: allowed $GITHUB_EVENT_NAME on $GITHUB_REF"
