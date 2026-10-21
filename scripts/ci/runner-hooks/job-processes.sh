# shellcheck shell=bash
# REFERENCE COPY, sourced by pre-job.sh and post-job.sh from the same
# root-owned folder on the self-hosted Mac. See docs/ci.md, "Self-hosted
# runner runbook".
#
# mac-1 and mac-2 both run as gh-runner, so a cleanup keyed on the user (the
# old `pkill -u gh-runner -f ...`) killed the other instance's live
# PostgreSQL, server and browser. Cleanup is keyed on the job instead: a
# process belongs to this job when its command line names, or its working
# directory lies inside, this job's $RUNNER_TEMP or $GITHUB_WORKSPACE. Each
# instance has its own _work folder, so the other instance never matches.
#
# Why both tests: throwaway clusters (scripts/ci/postgres.mjs) put
# `postgres -D $RUNNER_TEMP/...` on the command line, while the standalone
# server (`node .next/standalone/server.js`, relative) and Playwright's
# browsers carry no job path in their arguments but run from inside the
# workspace.

# Prints each usable job root (absolute, existing, not / or $HOME) once.
job_roots() {
  local dir seen=" "
  for dir in "$@"; do
    dir="${dir%/}"
    case "$dir" in /?*) ;; *) continue ;; esac
    [ "$dir" != "${HOME%/}" ] || continue
    [ -d "$dir" ] || continue
    case "$seen" in *" $dir "*) continue ;; esac
    seen+="$dir "
    printf '%s\n' "$dir"
  done
}

# "pid<TAB>cwd" for every process of this user. lsof on macOS, /proc
# elsewhere (the unit test also runs on Linux).
user_cwds() {
  local uid=$1 pid
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -u "$uid" -d cwd -Fpn 2>/dev/null \
      | awk '/^p/ { pid = substr($0, 2) } /^n/ && pid { print pid "\t" substr($0, 2) }'
  elif [ -d /proc/self ]; then
    for pid in /proc/[0-9]*; do
      [ -O "$pid" ] || continue
      printf '%s\t%s\n' "${pid#/proc/}" "$(readlink "$pid/cwd" 2>/dev/null)"
    done
  fi
}

# Prints the PIDs of this user's processes that belong to the job rooted at
# the given folders. Never this hook, its ancestors (the runner may start the
# hook from inside the workspace) or its descendants (forked subshells inherit
# the hook's own command line). A command line matches a root only as a whole
# path, followed by /, whitespace or the end, so .../mac-1/_work never
# matches .../mac-10/_work.
job_pids() {
  local roots uid
  roots="$(job_roots "$@")"
  [ -n "$roots" ] || return 0
  uid="$(id -u)"
  {
    ps -A -o pid=,ppid=,uid=,command= 2>/dev/null | sed 's/^/P /'
    user_cwds "$uid" | sed 's/^/C /'
  } | JOB_ROOTS="$roots" awk -v self="$$" -v uid="$uid" '
    BEGIN { roots = split(ENVIRON["JOB_ROOTS"], root, "\n") }
    $1 == "P" {
      parent[$2] = $3
      owner[$2] = $4
      line = $0
      sub(/^P[ \t]+[0-9]+[ \t]+[0-9]+[ \t]+[0-9]+[ \t]?/, "", line)
      command[$2] = line
      next
    }
    $1 == "C" {
      line = substr($0, 3)
      tab = index(line, "\t")
      if (tab > 1) cwd[substr(line, 1, tab - 1)] = substr(line, tab + 1)
    }
    function names(text, path,    at, rest, next_char) {
      rest = text
      while ((at = index(rest, path)) > 0) {
        next_char = substr(rest, at + length(path), 1)
        if (next_char == "" || next_char == "/" || next_char == " " || next_char == "\t") return 1
        rest = substr(rest, at + 1)
      }
      return 0
    }
    function related(pid,    p, depth) {
      # pid is self, an ancestor of self, or a descendant of self.
      for (p = self; p > 1 && depth < 256; depth++) {
        if (p == pid) return 1
        p = parent[p]
      }
      for (p = pid; p > 1 && depth < 512; depth++) {
        if (p == self) return 1
        p = parent[p]
      }
      return 0
    }
    END {
      for (pid in owner) {
        if (owner[pid] != uid || related(pid)) continue
        for (i = 1; i <= roots; i++) {
          if (names(command[pid], root[i]) || index(cwd[pid] "/", root[i] "/") == 1) {
            print pid
            break
          }
        }
      }
    }
  '
}

# Stops every process of this job: SIGTERM, then SIGKILL for whatever still
# matches after a grace period. Never fails.
stop_job_processes() {
  local pids attempt
  for attempt in 1 2 3 4 5; do
    pids="$(job_pids "$@")"
    [ -n "$pids" ] || return 0
    if [ "$attempt" = 5 ]; then
      # shellcheck disable=SC2086 # one PID per word
      kill -KILL $pids 2>/dev/null || true
      return 0
    fi
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
  done
}
