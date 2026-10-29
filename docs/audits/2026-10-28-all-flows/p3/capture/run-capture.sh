#!/bin/bash
# p3 screenshot capture: lock -> harness -> shots -> stop -> unlock.
# Same script for BEFORE and AFTER (see ../CAPTURE-BRIEF.md).
#
#   run-capture.sh <WT> <OUT>              # whole sequence (default "all")
#   run-capture.sh <WT> <OUT> lock [secs]  # take the visual lock (waits up to secs, default 540)
#   run-capture.sh <WT> <OUT> start        # fixtures + app on 3532/3533, warm routes
#   run-capture.sh <WT> <OUT> shoot        # URL states + interaction states -> WebP in OUT
#   run-capture.sh <WT> <OUT> stop         # SIGINT harness, wait for teardown, release lock
#
# The phases exist so an agent can run each in a foreground chunk under
# 10 minutes; "all" runs them back to back and always stops + unlocks on exit.
# Never reads .env* (tests/visual/with-visual-db.sh does). Never submits writes.
set -u

WT="${1:?usage: run-capture.sh <WT> <OUT> [all|lock|start|shoot|stop]}"
OUT="${2:?usage: run-capture.sh <WT> <OUT> [all|lock|start|shoot|stop]}"
PHASE="${3:-all}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCK=/tmp/naba-presence-visual.lock
PIDS=/tmp/p3-visual-pids
FIXLOG=/tmp/p3-visual-fixtures.log
APPLOG=/tmp/p3-visual-app.log
APP_PORT=3532
STUB_PORT=3533
BASE="http://localhost:$APP_PORT"
SHOTS="/tmp/p3-capture-png"
RUNLOG="$OUT/capture-run.log"

log() { echo "[p3-capture $(date -u +%H:%M:%SZ)] $*"; }

# The local Supabase on :54322 has no naba_visual database on this Mac (it is
# another project's cluster), so the harness runs on a throwaway PostgreSQL 17
# cluster from scripts/ci/postgres.mjs instead: our own NABA_PG_DIR, a database
# named naba_visual (so fixture-server.ts's guard holds), migrated with the
# repo's own scripts, and stopped afterwards. Nothing shared is touched.
PGDIR=/tmp/p3-pg-visual
DBENV=/tmp/p3-visual-db.env

do_db() {
  cd "$WT" || return 1
  local exports admin runtime marker host
  exports=$(NABA_PG_DIR=$PGDIR NABA_PG_MODE=native node scripts/ci/postgres.mjs start) || return 1
  admin=$(echo "$exports" | sed -n "s/^export DIRECT_DATABASE_URL='\(.*\)'$/\1/p")
  runtime=$(echo "$exports" | sed -n "s/^export TEST_RUNTIME_DATABASE_URL='\(.*\)'$/\1/p")
  marker=$(echo "$exports" | sed -n "s/^export NABA_PG_DISPOSABLE='\(.*\)'$/\1/p")
  admin=${admin%/nabareview_test}/naba_visual
  runtime=${runtime%/nabareview_test}/naba_visual
  node -e 'const p=require("postgres");const s=p(process.argv[1].replace(/naba_visual$/,"nabareview_test"),{max:1});s.unsafe("create database naba_visual").then(()=>s.end())' "$admin" || return 1
  {
    echo "export DIRECT_DATABASE_URL='$admin'"
    echo "export TEST_RUNTIME_DATABASE_URL='$runtime'"
    echo "export DATABASE_URL='$runtime'"
    echo "export DATABASE_SESSION_URL='$runtime'"
    echo "export NABA_PG_DISPOSABLE='$marker'"
  } > "$DBENV"
  chmod 600 "$DBENV"
  ( . "$DBENV" && node scripts/db-migrate.mjs >/dev/null && node scripts/db-create-runtime-role.mjs >/dev/null ) || return 1
  log "throwaway cluster on $marker, naba_visual migrated"
}

do_db_stop() {
  cd "$WT" || return 1
  [ -d "$PGDIR" ] && NABA_PG_DIR=$PGDIR NABA_PG_MODE=native node scripts/ci/postgres.mjs stop && log "throwaway cluster stopped"
  rm -f "$DBENV"
}

port_open() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

descendants() {
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do
    echo "$p"
    descendants "$p"
  done
}

do_lock() {
  local max="${1:-540}" start now
  start=$(date +%s)
  until mkdir "$LOCK" 2>/dev/null; do
    now=$(date +%s)
    if [ $((now - start)) -ge "$max" ]; then
      log "lock still held by: $(cat "$LOCK/owner" 2>/dev/null) (waited $((now - start))s)"
      return 75
    fi
    sleep 5
  done
  echo "p3 $(date)" > "$LOCK/owner"
  log "lock taken after $(( $(date +%s) - start ))s"
}

do_start() {
  if port_open $APP_PORT || port_open $STUB_PORT; then
    log "port $APP_PORT or $STUB_PORT already in use; refusing to start"
    return 1
  fi
  : > "$PIDS"
  cd "$WT" || return 1
  [ -f "$DBENV" ] || { log "no $DBENV: run the db phase first"; return 1; }
  . "$DBENV"
  VISUAL_APP_PORT=$APP_PORT PLAYWRIGHT_GOOGLE_STUB_PORT=$STUB_PORT nohup \
    node --experimental-strip-types \
    --import ./tests/visual/ts-resolve-hook.mjs tests/visual/fixture-server.ts \
    > "$FIXLOG" 2>&1 &
  echo "fixtures $!" >> "$PIDS"
  log "fixtures node pid $!"
  local i
  for i in $(seq 1 120); do
    grep -q "\[visual-fixtures\] seeded" "$FIXLOG" && break
    if ! kill -0 "$(awk '/^fixtures/{print $2}' "$PIDS")" 2>/dev/null; then
      log "fixture server exited:"; tail -20 "$FIXLOG"; return 1
    fi
    sleep 2
  done
  grep -q "\[visual-fixtures\] seeded" "$FIXLOG" || { log "fixtures never seeded"; return 1; }
  log "fixtures seeded"

  # The standalone server does not read .env files; load them the way
  # scripts/run-test-command.mjs does for Playwright (already-set variables,
  # such as the throwaway database URLs, win).
  printf '%s\n' 'import nextEnv from "@next/env"' 'nextEnv.loadEnvConfig(process.cwd(), false)' > test-results/p3-load-env.mjs
  # The .claude/launch.json "visual-app" environment on 3532/3533, password
  # auth off, served from the production build (`pnpm build` first), as the
  # 15 Oct after-evidence was.
  LOCAL_BOOTSTRAP_ENABLED=false GOOGLE_API_PROXY_BASE=http://127.0.0.1:$STUB_PORT \
    NEXTAUTH_URL=http://localhost:$APP_PORT OPENAI_API_KEY= WEBHOOKS_ENABLED=false \
    GBP_PROFILE_WRITES_ENABLED=true GBP_MEDIA_ENABLED=true GBP_POSTS_ENABLED=true \
    GBP_FOOD_MENUS_ENABLED=true GBP_PLACE_ACTIONS_ENABLED=true \
    GBP_PERFORMANCE_ENABLED=true GBP_KEYWORDS_ENABLED=true \
    DESIGN_SYSTEM_EVIDENCE_ENABLED=true PASSWORD_AUTH_ENABLED=false \
    PORT=$APP_PORT HOSTNAME=localhost ABUSE_LIMITS_ENABLED=false nohup node --import ./test-results/p3-load-env.mjs .next/standalone/server.js \
    > "$APPLOG" 2>&1 &
  echo "app $!" >> "$PIDS"
  log "app pid $!"
  for i in $(seq 1 120); do
    curl -s -o /dev/null "$BASE/api/session" && break
    sleep 2
  done
  curl -s -o /dev/null "$BASE/api/session" || { log "app never answered"; return 1; }
  log "app up; warming routes"

  local loc cookie viewer member route code
  loc=$(node -e 'console.log(require("./test-results/e2e-journey-state.json").primaryLocationId)')
  cookie=$(node -e 'console.log(require("./test-results/e2e-journey-state.json").cookie)')
  viewer=$(node -e 'console.log(require("./test-results/e2e-journey-state.json").viewerCookie)')
  member=$(node -e 'console.log(require("./test-results/e2e-journey-state.json").memberAssignedCookie)')
  for route in /listings "/listings?q=zzqx" /listings/$loc /listings/$loc/profile \
    /listings/$loc/hours /listings/$loc/menu /listings/$loc/people /listings/$loc/booking; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 240 -H "cookie: $cookie" "$BASE$route")
    log "warm owner $route -> $code"
  done
  for route in /listings/$loc /listings/$loc/hours /listings/$loc/booking; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 240 -H "cookie: $viewer" "$BASE$route")
    log "warm viewer $route -> $code"
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 240 -H "cookie: $member" "$BASE/listings/$loc/menu")
  log "warm member /listings/$loc/menu -> $code"
  # One throwaway browser pass so the client chunks (dynamic editors) compile too.
  rm -rf /tmp/p3-capture-warm
  for route in /listings /listings/{loc} /listings/{loc}/profile /listings/{loc}/hours \
    /listings/{loc}/menu /listings/{loc}/people /listings/{loc}/booking; do
    node tests/visual/shoot.mjs --base "$BASE" --route "$route" --role owner \
      --widths 1280 --wait 1500 --out /tmp/p3-capture-warm >/dev/null 2>&1 \
      && log "warm browser $route ok" || log "warm browser $route FAILED"
  done
  rm -rf /tmp/p3-capture-warm
  log "started"
}

do_shoot() {
  cd "$WT" || return 1
  mkdir -p "$OUT"
  rm -rf "$SHOTS"; mkdir -p "$SHOTS"
  : > "$RUNLOG"
  {
    echo "# worktree $WT"
    echo "# HEAD $(git -C "$WT" rev-parse HEAD)"
    echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >> "$RUNLOG"
  # name|route|role
  local states="01-board|/listings|owner
02-board-no-match|/listings?q=zzqx|owner
04-overview|/listings/{loc}|owner
05-overview-viewer|/listings/{loc}|viewer
06-profile|/listings/{loc}/profile|owner
07-hours|/listings/{loc}/hours|owner
09-hours-viewer|/listings/{loc}/hours|viewer
10-menu|/listings/{loc}/menu|owner
11-menu-member|/listings/{loc}/menu|member
12-people|/listings/{loc}/people|owner
14-booking|/listings/{loc}/booking|owner
15-booking-viewer|/listings/{loc}/booking|viewer"
  local name route role
  while IFS='|' read -r name route role; do
    echo "# shoot $name light 390,1280" >> "$RUNLOG"
    node tests/visual/shoot.mjs --base "$BASE" --route "$route" --role "$role" \
      --widths 390,1280 --full --wait 2500 --name "$name" --out "$SHOTS" \
      >> "$RUNLOG" 2>&1 || echo "# FAILED $name light" >> "$RUNLOG"
    echo "# shoot $name dark 390" >> "$RUNLOG"
    node tests/visual/shoot.mjs --base "$BASE" --route "$route" --role "$role" \
      --theme dark --widths 390 --full --wait 2500 --name "$name" --out "$SHOTS" \
      >> "$RUNLOG" 2>&1 || echo "# FAILED $name dark" >> "$RUNLOG"
    log "shot $name"
  done <<< "$states"

  cp "$HERE/capture-interactions.mjs" "$WT/test-results/capture-interactions.mjs"
  echo "# interactions" >> "$RUNLOG"
  node test-results/capture-interactions.mjs --base "$BASE" --out "$SHOTS" \
    --wait 2500 >> "$RUNLOG" 2>&1 || echo "# FAILED interactions script" >> "$RUNLOG"
  log "interactions done"

  # shoot.mjs names: <name>-chromium-<theme>-<width>.png -> <name>-<390-light|390-dark|1280>
  local f base out
  for f in "$SHOTS"/*.png; do
    [ -e "$f" ] || continue
    base=$(basename "$f" .png)
    out=$(echo "$base" | sed -E \
      -e 's/-chromium-light-390$/-390-light/' \
      -e 's/-chromium-dark-390$/-390-dark/' \
      -e 's/-chromium-light-1280$/-1280/')
    cwebp -quiet -q 80 "$f" -o "$OUT/$out.webp" && rm -f "$f"
  done
  echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RUNLOG"
  log "webp written to $OUT"
  log "FAILED markers in run log: $(grep -c FAILED "$RUNLOG")"
}

do_stop() {
  local kind pid all p i
  if [ -f "$PIDS" ]; then
    all=""
    while read -r kind pid; do
      [ -n "${pid:-}" ] || continue
      all="$all $pid $(descendants "$pid")"
    done < "$PIDS"
    # SIGINT: the fixture node destroys its tenants on SIGINT.
    for p in $all; do kill -INT "$p" 2>/dev/null; done
    for i in $(seq 1 60); do
      grep -q "\[visual-fixtures\] tenants destroyed" "$FIXLOG" 2>/dev/null \
        && ! port_open $APP_PORT && ! port_open $STUB_PORT && break
      sleep 2
    done
    grep -q "\[visual-fixtures\] tenants destroyed" "$FIXLOG" 2>/dev/null \
      && log "tenants destroyed" || log "WARNING: no 'tenants destroyed' line"
    # Anything of ours still alive after SIGINT gets SIGTERM.
    for p in $all; do kill -0 "$p" 2>/dev/null && kill -TERM "$p" 2>/dev/null; done
    for i in $(seq 1 15); do
      port_open $APP_PORT || port_open $STUB_PORT || break
      sleep 1
    done
    rm -f "$PIDS"
  fi
  if port_open $APP_PORT || port_open $STUB_PORT; then
    log "WARNING: port $APP_PORT/$STUB_PORT still open"
  fi
  if [ -n "${KEEP_LOCK:-}" ]; then
    log "lock kept (KEEP_LOCK)"
  elif grep -q "^p3 " "$LOCK/owner" 2>/dev/null; then
    rm -rf "$LOCK" && log "lock released"
  fi
}

case "$PHASE" in
  lock) do_lock "${4:-540}" ;;
  db) do_db ;;
  dbstop) do_db_stop ;;
  start) do_start ;;
  shoot) do_shoot ;;
  stop) do_stop ;;
  all)
    do_lock 86400 || exit $?
    trap 'do_stop; do_db_stop' EXIT INT TERM
    do_db && do_start && do_shoot
    ;;
  *) echo "unknown phase $PHASE" >&2; exit 2 ;;
esac
