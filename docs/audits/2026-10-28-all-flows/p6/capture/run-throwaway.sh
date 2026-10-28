#!/bin/sh
# Runs the p6 capture against a throwaway cluster. Start it from the
# checkout under test ($WT), under the visual lock:
#
#   cd "$WT" && node scripts/run-test-command.mjs e2e sh \
#     /tmp/naba-presence-p6/docs/audits/2026-10-28-all-flows/p6/capture/run-throwaway.sh <out-dir> [A|B|AB]
#
# ONLY=id,id reruns single states (for example ones that timed out while
# next dev compiled the route the first time).
# scripts/run-test-command.mjs starts, migrates and later stops the cluster
# and exports its URLs; this script seeds the fixtures, turns on two
# organisation features for the fixture organisation, then serves the app
# (next dev, port 3562, Google stub 3563) in each configuration and shoots.
set -e
OUT="$1"; CONFIGS="${2:-AB}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHOTS="$HERE/shots.mjs"
WT="$(pwd)"
mkdir -p test-results "$OUT"
export VISUAL_APP_PORT=3562 PLAYWRIGHT_GOOGLE_STUB_PORT=3563
# The app is served from the checkout's production build (`pnpm build`
# first), as the 15 Oct audit's after-evidence was: on 28 Oct `next dev`
# looped Fast Refresh reloads on the billing-on pages, which interrupted
# shots. SERVE=dev uses next dev instead.
if [ "${SERVE:-prod}" = dev ]; then
  SERVE_CMD='pnpm exec next dev --turbopack --port 3562'
else
  [ -f .next/standalone/server.js ] || { echo "run pnpm build first"; exit 1; }
  SERVE_CMD='pnpm start'
fi

node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs \
  "$HERE/throwaway-fixtures.ts" > /tmp/p6-capture-fixtures.log 2>&1 &
FIX=$!
APP=""
stop_all() {
  [ -n "$APP" ] && kill -INT "$APP" 2>/dev/null || true
  for pid in $(lsof -tiTCP:3562 -sTCP:LISTEN 2>/dev/null); do kill -INT "$pid" 2>/dev/null || true; done
  kill -INT "$FIX" 2>/dev/null || true
  wait "$FIX" 2>/dev/null || true
}
trap stop_all EXIT INT TERM
i=0; until grep -q "seeded" /tmp/p6-capture-fixtures.log; do
  i=$((i+1)); [ $i -gt 180 ] && { echo "fixtures did not start"; tail -20 /tmp/p6-capture-fixtures.log; exit 1; }
  kill -0 "$FIX" 2>/dev/null || { echo "fixtures died"; tail -30 /tmp/p6-capture-fixtures.log; exit 1; }
  sleep 1
done
echo "[p6-capture] fixtures seeded"
ORG=$(node -e 'console.log(require(process.cwd()+"/test-results/e2e-journey-state.json").organisationId)')
for F in privacy_settings workspace_mode_change; do
  pnpm -s ops:pause feature --organisation "$ORG" --feature "$F" --enable --operator visual-capture-p6
done

start_app() { # $1 = A|B
  EXTRA=""; [ "$1" = B ] && EXTRA="BILLING_ENABLED=true MFA_ENABLED=true"
  env LOCAL_BOOTSTRAP_ENABLED=false GOOGLE_API_PROXY_BASE=http://127.0.0.1:3563 \
    NEXTAUTH_URL=http://localhost:3562 OPENAI_API_KEY= WEBHOOKS_ENABLED=false \
    GBP_PROFILE_WRITES_ENABLED=true GBP_MEDIA_ENABLED=true GBP_POSTS_ENABLED=true \
    GBP_FOOD_MENUS_ENABLED=true GBP_PLACE_ACTIONS_ENABLED=true GBP_PERFORMANCE_ENABLED=true \
    GBP_KEYWORDS_ENABLED=true DESIGN_SYSTEM_EVIDENCE_ENABLED=true ABUSE_LIMITS_ENABLED=false \
    STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= STRIPE_PORTAL_CONFIGURATION_ID= EMAIL_PROVIDER=none \
    BILLING_ENABLED=false MFA_ENABLED=false $EXTRA \
    PORT=3562 sh -c "$SERVE_CMD" > "/tmp/p6-capture-app-$1.log" 2>&1 &
  APP=$!
  i=0; until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3562/api/session)" = 200 ]; do
    i=$((i+1)); [ $i -gt 240 ] && { echo "app did not start"; tail -30 "/tmp/p6-capture-app-$1.log"; exit 1; }
    sleep 1
  done
  echo "[p6-capture] app up in config $1"
}
stop_app() {
  kill -INT "$APP" 2>/dev/null || true
  for pid in $(lsof -tiTCP:3562 -sTCP:LISTEN 2>/dev/null); do kill -INT "$pid" 2>/dev/null || true; done
  i=0; while lsof -tiTCP:3562 -sTCP:LISTEN >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 30 ] && break; sleep 1; done
  APP=""
}
for C in A B; do
  case "$CONFIGS" in *$C*) ;; *) continue ;; esac
  start_app "$C"
  if [ -n "$HOLD" ]; then
    # Keep this configuration up until /tmp/p6-capture-release-$C exists, so
    # shots.mjs can be run by hand (and rerun) against it.
    echo "[p6-capture] holding config $C; touch /tmp/p6-capture-release-$C to go on"
    until [ -e "/tmp/p6-capture-release-$C" ]; do sleep 2; done
    rm -f "/tmp/p6-capture-release-$C"
    stop_app
    continue
  fi
  node "$SHOTS" --base http://localhost:3562 --state "$WT/test-results/e2e-journey-state.json" \
    --config "$C" --webp --out "$OUT" ${ONLY:+--only "$ONLY"} || echo "[p6-capture] shots $C exited $?"
  stop_app
done
echo "[p6-capture] done"
