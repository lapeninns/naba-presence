#!/usr/bin/env bash
# Set up the self-hosted macOS runner for lapeninns/naba-presence.
# Implements the "Self-hosted runner runbook" in docs/ci.md.
#
# Run from a checkout, as the Mac's admin user (NOT with sudo; the script asks
# for sudo itself, and Homebrew must not run as root):
#
#   RUNNER_TOKEN="$(gh api -X POST repos/lapeninns/naba-presence/actions/runners/registration-token --jq .token)" \
#     bash scripts/ci/runner-setup.sh          # install or update, then verify
#   bash scripts/ci/runner-setup.sh verify     # checks only, changes nothing
#
# The registration token (repo Settings -> Actions -> Runners -> New runner, or
# the gh command above as lapeninns) is read from RUNNER_TOKEN or prompted for.
# It is only needed while an instance is still unregistered, is valid for one
# hour, and is passed to config.sh through stdin and the environment, never
# on a command line. Never commit a token.
#
# Idempotent: every step checks the current state first, so re-running is safe.
# A registered instance is never re-registered and its runner (which updates
# itself) is never downgraded. Stops at the first error.
#
# What it does:
#   1. brew install postgresql@17 gitleaks jq (as you)
#   2. hidden, non-admin user gh-runner; your home folder closed to other users
#   3. actions/runner (pinned version, SHA256-checked) in two instances,
#      mac-1 and mac-2, label naba-trusted, registered at repo level
#   4. pre/post job hooks from scripts/ci/runner-hooks/ installed root-owned
#      in /usr/local/libexec/naba-runner and wired through each runner's .env
#   5. one LaunchDaemon per instance, running as gh-runner
#   6. pmset: no sleep on AC power, restart after a power failure
#   7. verify
#
# Environment overrides:
#   RUNNER_TOKEN            registration token (else prompted when needed)
#   NABA_KEEP_HOME_PERMS=1  do not chmod 700 your home folder
#
# Undo, per instance N:
#   sudo launchctl bootout system/com.lapeninns.naba-runner.mac-N
#   sudo rm /Library/LaunchDaemons/com.lapeninns.naba-runner.mac-N.plist
#   (cd /Users/gh-runner/actions-runner/mac-N && sudo -u gh-runner ./config.sh remove --token <removal token>)
set -Eeuo pipefail
trap 'echo "runner-setup: FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

REPO=lapeninns/naba-presence
REPO_URL="https://github.com/$REPO"
RUNNER_VERSION=2.337.0
RUNNER_SHA256=5a2cd92908a93d7276a194e1de6008099f3e7946f3f8e14aa7a1a7b4a31fdec2
RUNNER_TARBALL="actions-runner-osx-arm64-$RUNNER_VERSION.tar.gz"
RUNNER_TARBALL_URL="https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$RUNNER_TARBALL"
RUNNER_USER=gh-runner
RUNNER_HOME="/Users/$RUNNER_USER"
RUNNER_BASE="$RUNNER_HOME/actions-runner"
RUNNER_LABEL=naba-trusted
INSTANCES=(mac-1 mac-2)
HOOK_DIR=/usr/local/libexec/naba-runner
DAEMON_PREFIX=com.lapeninns.naba-runner
BREW_PREFIX=/opt/homebrew
RUNNER_PATH="$BREW_PREFIX/bin:$BREW_PREFIX/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="$SCRIPT_DIR/runner-hooks"
OWNER="$(id -un)"
OWNER_HOME="$(dscl . -read "/Users/$OWNER" NFSHomeDirectory | awk '{print $2}')"

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  echo "runner-setup: $*" >&2
  exit 1
}

# Run a command as gh-runner from a directory it can enter.
as_runner() { (cd / && sudo -u "$RUNNER_USER" -H "$@"); }

daemon_label() { echo "$DAEMON_PREFIX.$1"; }
daemon_plist() { echo "/Library/LaunchDaemons/$(daemon_label "$1").plist"; }

# Install $2 at $1 (owner $3, mode $4) only if the content differs.
# Returns 0 if the file changed, 1 if it was already up to date.
install_if_changed() {
  local dest=$1 src=$2 owner=$3 mode=$4
  if sudo test -f "$dest" && sudo cmp -s "$src" "$dest"; then
    sudo chown "$owner" "$dest"
    sudo chmod "$mode" "$dest"
    return 1
  fi
  sudo install -o "${owner%%:*}" -g "${owner##*:}" -m "$mode" "$src" "$dest"
  return 0
}

preflight() {
  step "Preflight"
  [ "$(uname -s)" = Darwin ] || die "macOS only"
  [ "$(uname -m)" = arm64 ] || die "Apple Silicon (arm64) only; the pinned runner is osx-arm64"
  [ "$(id -u)" -ne 0 ] || die "run as your admin user, not with sudo (Homebrew refuses root)"
  dseditgroup -o checkmember -m "$OWNER" admin >/dev/null 2>&1 || die "$OWNER is not an admin user"
  [ -x "$BREW_PREFIX/bin/brew" ] || die "Homebrew not found at $BREW_PREFIX"
  xcode-select -p >/dev/null 2>&1 || die "Command Line Tools missing (git): xcode-select --install"
  for f in pre-job.sh post-job.sh; do
    [ -f "$HOOK_SRC/$f" ] || die "missing $HOOK_SRC/$f; run from a checkout of $REPO"
  done
  sudo -v
  info "ok: $OWNER on $(sw_vers -productName) $(sw_vers -productVersion)"
}

install_packages() {
  step "Homebrew packages"
  local pkg
  for pkg in postgresql@17 gitleaks jq; do
    if "$BREW_PREFIX/bin/brew" list --versions "$pkg" >/dev/null 2>&1; then
      info "$pkg already installed"
    else
      "$BREW_PREFIX/bin/brew" install "$pkg"
    fi
  done
  # Never started as a service: CI starts a throwaway cluster per job.
  [ -x "$BREW_PREFIX/opt/postgresql@17/bin/pg_ctl" ] || die "postgresql@17 has no pg_ctl"
}

create_user() {
  step "User $RUNNER_USER"
  if id "$RUNNER_USER" >/dev/null 2>&1; then
    info "exists"
  else
    # Random password that nobody keeps: the account is never logged into.
    sudo sysadminctl -addUser "$RUNNER_USER" -fullName "GitHub Actions runner" \
      -home "$RUNNER_HOME" -password "$(openssl rand -base64 30)"
    info "created"
  fi
  if dseditgroup -o checkmember -m "$RUNNER_USER" admin >/dev/null 2>&1; then
    die "$RUNNER_USER is an admin; remove it: sudo dseditgroup -o edit -d $RUNNER_USER -t user admin"
  fi
  sudo dscl . -create "/Users/$RUNNER_USER" IsHidden 1
  [ -d "$RUNNER_HOME" ] || sudo createhomedir -c -u "$RUNNER_USER" >/dev/null
  sudo chown "$RUNNER_USER:staff" "$RUNNER_HOME"
  sudo chmod 700 "$RUNNER_HOME"
  # Only relevant when Remote Login is limited to a group; harmless otherwise.
  if dscl . -read /Groups/com.apple.access_ssh >/dev/null 2>&1; then
    sudo dseditgroup -o edit -d "$RUNNER_USER" -t user com.apple.access_ssh 2>/dev/null || true
  fi

  if [ "${NABA_KEEP_HOME_PERMS:-}" = 1 ]; then
    info "NABA_KEEP_HOME_PERMS=1: leaving $OWNER_HOME permissions alone"
  elif [ "$(stat -f '%Lp' "$OWNER_HOME")" != 700 ]; then
    # Keeps jobs away from checkouts, .env files and ~/.naba-presence-prod.env.
    chmod 700 "$OWNER_HOME"
    info "closed $OWNER_HOME to other users (chmod 700)"
  fi
}

download_runner() {
  TARBALL_DIR="$(mktemp -d)"
  trap 'rm -rf "$TARBALL_DIR"' EXIT
  local tgz="$TARBALL_DIR/$RUNNER_TARBALL"
  info "downloading actions/runner v$RUNNER_VERSION"
  curl -fsSL --retry 3 -o "$tgz" "$RUNNER_TARBALL_URL"
  echo "$RUNNER_SHA256  $tgz" | shasum -a 256 -c - >/dev/null || die "SHA256 mismatch for $RUNNER_TARBALL"
  RUNNER_TGZ="$tgz"
}

read_token() {
  if [ -z "${RUNNER_TOKEN:-}" ]; then
    [ -t 0 ] || die "RUNNER_TOKEN is not set and there is no terminal to prompt on"
    echo "    Registration token for $REPO (Settings -> Actions -> Runners -> New runner):"
    IFS= read -rs RUNNER_TOKEN
    echo
  fi
  [ -n "$RUNNER_TOKEN" ] || die "empty registration token"
}

install_runners() {
  step "actions/runner v$RUNNER_VERSION: ${INSTANCES[*]}"
  sudo install -d -o "$RUNNER_USER" -g staff -m 700 "$RUNNER_BASE"
  local name dir
  for name in "${INSTANCES[@]}"; do
    dir="$RUNNER_BASE/$name"
    if sudo test -f "$dir/config.sh"; then
      info "$name: already unpacked (the runner updates itself; not replaced)"
    else
      [ -n "${RUNNER_TGZ:-}" ] || download_runner
      sudo install -d -o "$RUNNER_USER" -g staff -m 700 "$dir"
      sudo tar -xzf "$RUNNER_TGZ" -C "$dir"
      sudo chown -R "$RUNNER_USER:staff" "$dir"
      info "$name: unpacked"
    fi

    if sudo test -f "$dir/.runner"; then
      info "$name: already registered"
      continue
    fi
    read_token
    # Token via stdin -> ACTIONS_RUNNER_INPUT_TOKEN, so it never shows in ps.
    # --replace takes over a stale registration of the same name.
    # shellcheck disable=SC2016 # expanded by the inner bash
    printf '%s\n' "$RUNNER_TOKEN" | as_runner bash -c '
      set -euo pipefail
      cd "$1"
      IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
      export ACTIONS_RUNNER_INPUT_TOKEN
      exec ./config.sh --unattended --replace --url "$2" --name "$3" \
        --labels "$4" --work _work
    ' _ "$dir" "$REPO_URL" "$name" "$RUNNER_LABEL"
    info "$name: registered"
  done
  unset RUNNER_TOKEN
}

install_hooks() {
  step "Job hooks -> $HOOK_DIR"
  sudo install -d -o root -g wheel -m 755 "$HOOK_DIR"
  local f
  for f in pre-job.sh post-job.sh; do
    if install_if_changed "$HOOK_DIR/$f" "$HOOK_SRC/$f" root:wheel 755; then
      info "$f installed"
    else
      info "$f up to date"
    fi
  done
}

# Writes .env and .path for one instance and its LaunchDaemon plist, then
# (re)loads the daemon when anything changed or it is not running.
install_daemon() {
  local name=$1 dir="$RUNNER_BASE/$1" label plist tmp changed=0
  label="$(daemon_label "$name")"
  plist="$(daemon_plist "$name")"
  tmp="$(mktemp -d)"

  # Read by the runner at start. Root-owned so it is not edited casually; it
  # is not a security boundary, since jobs already run as gh-runner.
  cat >"$tmp/env" <<EOF
LANG=en_US.UTF-8
ACTIONS_RUNNER_HOOK_JOB_STARTED=$HOOK_DIR/pre-job.sh
ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$HOOK_DIR/post-job.sh
NABA_PG_BIN=$BREW_PREFIX/opt/postgresql@17/bin
EOF
  printf '%s\n' "$RUNNER_PATH" >"$tmp/path"
  install_if_changed "$dir/.env" "$tmp/env" root:staff 644 && changed=1
  install_if_changed "$dir/.path" "$tmp/path" root:staff 644 && changed=1
  # Same as svc.sh: the service entry point lives in the runner root.
  install_if_changed "$dir/runsvc.sh" "$dir/bin/runsvc.sh" "$RUNNER_USER:staff" 755 && changed=1

  local logs="$RUNNER_HOME/Library/Logs/$label"
  as_runner mkdir -p "$logs"

  # Based on the runner's bin/actions.runner.plist.template, as a system
  # LaunchDaemon (runs without anyone logged in) with UserName=gh-runner.
  cat >"$tmp/plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$dir/runsvc.sh</string>
  </array>
  <key>UserName</key>
  <string>$RUNNER_USER</string>
  <key>GroupName</key>
  <string>staff</string>
  <key>WorkingDirectory</key>
  <string>$dir</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$logs/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ACTIONS_RUNNER_SVC</key>
    <string>1</string>
    <key>HOME</key>
    <string>$RUNNER_HOME</string>
    <key>USER</key>
    <string>$RUNNER_USER</string>
    <key>LOGNAME</key>
    <string>$RUNNER_USER</string>
    <key>PATH</key>
    <string>$RUNNER_PATH</string>
    <key>LANG</key>
    <string>en_US.UTF-8</string>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>SessionCreate</key>
  <true/>
</dict>
</plist>
EOF
  plutil -lint "$tmp/plist" >/dev/null
  local plist_changed=0
  install_if_changed "$plist" "$tmp/plist" root:wheel 644 && plist_changed=1
  rm -rf "$tmp"

  if ! sudo launchctl print "system/$label" >/dev/null 2>&1; then
    sudo launchctl bootstrap system "$plist"
    info "$name: daemon loaded"
  elif [ "$plist_changed" = 1 ]; then
    sudo launchctl bootout "system/$label" || true
    sudo launchctl bootstrap system "$plist"
    info "$name: daemon reloaded (plist changed)"
  elif [ "$changed" = 1 ]; then
    sudo launchctl kickstart -k "system/$label"
    info "$name: daemon restarted (.env/.path changed)"
  else
    info "$name: daemon up to date"
  fi
}

install_daemons() {
  step "LaunchDaemons"
  local name
  for name in "${INSTANCES[@]}"; do install_daemon "$name"; done
}

configure_power() {
  step "Power (pmset, on AC)"
  # No system or disk sleep, wake for network access, restart after a power cut.
  sudo pmset -c sleep 0 disksleep 0 womp 1 autorestart 1
  info "$(pmset -g custom | awk '/AC Power/{p=1} p && $1=="sleep"{print "AC sleep =", $2; exit}')"
}

# Every check runs; the step fails at the end if any failed.
verify() {
  step "Verify"
  local fail=0 name dir label out pid
  check() {
    local desc=$1
    shift
    if "$@" >/dev/null 2>&1; then
      info "ok    $desc"
    else
      info "FAIL  $desc"
      fail=1
    fi
  }
  not() { ! "$@"; }
  fork_event_denied() {
    local ev
    ev="$(mktemp)"
    printf '%s' '{"pull_request":{"head":{"repo":{"full_name":"someone/naba-presence"}},"base":{"repo":{"full_name":"lapeninns/naba-presence"}},"user":{"login":"someone"}}}' >"$ev"
    chmod 644 "$ev"
    # Deny paths exit before the hook's pkill, so this cannot kill a live job.
    local rc=0
    as_runner env PATH="$RUNNER_PATH" GITHUB_EVENT_PATH="$ev" GITHUB_REPOSITORY="$REPO" \
      GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/pull/1/merge GITHUB_ACTOR=someone \
      bash "$HOOK_DIR/pre-job.sh" || rc=$?
    rm -f "$ev"
    [ "$rc" -ne 0 ]
  }
  pr_target_denied() {
    ! as_runner env PATH="$RUNNER_PATH" GITHUB_EVENT_PATH=/dev/null GITHUB_REPOSITORY="$REPO" \
      GITHUB_EVENT_NAME=pull_request_target GITHUB_REF=refs/heads/main \
      bash "$HOOK_DIR/pre-job.sh"
  }
  listening() {
    local log=$1
    for _ in $(seq 1 30); do
      sudo grep -q 'Listening for Jobs' "$log" 2>/dev/null && return 0
      sleep 1
    done
    return 1
  }

  check "user $RUNNER_USER exists" id "$RUNNER_USER"
  check "$RUNNER_USER is not an admin" not dseditgroup -o checkmember -m "$RUNNER_USER" admin
  check "$RUNNER_USER has no ~/.ssh" not sudo test -e "$RUNNER_HOME/.ssh"
  check "$RUNNER_USER cannot read $OWNER_HOME" not as_runner test -r "$OWNER_HOME/."
  check "$RUNNER_USER can run jq" as_runner env PATH="$RUNNER_PATH" jq --version
  check "$RUNNER_USER can run PostgreSQL 17 initdb" as_runner "$BREW_PREFIX/opt/postgresql@17/bin/initdb" --version
  for f in pre-job.sh post-job.sh; do
    check "$f is root-owned, mode 755" test "$(stat -f '%Su %Lp' "$HOOK_DIR/$f" 2>/dev/null)" = "root 755"
    check "$f matches the repo copy" cmp -s "$HOOK_SRC/$f" "$HOOK_DIR/$f"
    check "$RUNNER_USER cannot write $f" not as_runner test -w "$HOOK_DIR/$f"
  done
  check "pre-job hook refuses a fork pull_request" fork_event_denied
  check "pre-job hook refuses pull_request_target" pr_target_denied
  for name in "${INSTANCES[@]}"; do
    dir="$RUNNER_BASE/$name"
    label="$(daemon_label "$name")"
    check "$name registered (.runner)" sudo test -f "$dir/.runner"
    check "$name .env wires both hooks" sudo grep -q "^ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$HOOK_DIR/post-job.sh" "$dir/.env"
    check "$name .env pre-job hook" sudo grep -q "^ACTIONS_RUNNER_HOOK_JOB_STARTED=$HOOK_DIR/pre-job.sh" "$dir/.env"
    out="$(sudo launchctl print "system/$label" 2>/dev/null || true)"
    pid="$(awk '$1=="pid" && $2=="=" {print $3; exit}' <<<"$out")"
    check "$name daemon is running" grep -q "state = running" <<<"$out"
    check "$name daemon runs as $RUNNER_USER" test "$(ps -o user= -p "${pid:-0}" 2>/dev/null | tr -d ' ')" = "$RUNNER_USER"
    check "$name connected: 'Listening for Jobs'" listening "$RUNNER_HOME/Library/Logs/$label/stdout.log"
  done
  check "AC power: sleep 0" test "$(pmset -g custom | awk '/AC Power/{p=1} p && $1=="sleep"{print $2; exit}')" = 0

  if command -v gh >/dev/null 2>&1 && gh api "repos/$REPO/actions/runners" >/dev/null 2>&1; then
    info "GitHub sees:"
    gh api "repos/$REPO/actions/runners" \
      --jq '.runners[] | "      \(.name)  \(.status)  busy=\(.busy)  [\([.labels[].name] | join(","))]"'
  else
    info "(skipped GitHub listing: needs gh logged in as lapeninns)"
  fi

  [ "$fail" = 0 ] || die "verification failed; see FAIL lines above"
  step "Runner ready. Hosted stays the default until: gh variable set SELF_HOSTED_ENABLED --body true -R $REPO"
  info "First run the full graph on both lanes (docs/ci.md, 'Before switching the lane on')."
}

main() {
  case "${1:-install}" in
    install)
      preflight
      install_packages
      create_user
      install_hooks
      install_runners
      install_daemons
      configure_power
      verify
      ;;
    verify)
      preflight
      verify
      ;;
    *) die "usage: $0 [install|verify]" ;;
  esac
}

main "$@"
