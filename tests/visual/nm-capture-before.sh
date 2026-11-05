#!/usr/bin/env bash
# Redesign 2026-11 phase A before-evidence, in one run (docs/redesign/2026-11/
# BASELINE.md "Before-evidence"). Needs local port binding (Postgres, the
# app, the Google stub) and the notion-mail-ledger QA harness; run it from
# the worktree root:
#
#   tests/visual/nm-capture-before.sh [out-dir]
#
# 1. refuses unless app/ components/ lib/ match the base commit, builds;
# 2. under with-lock + with-e2e-db + nm-serve: light at phone/tablet/desktop,
#    dark at desktop/phone, then the agentic journeys (desktop, mobile);
# 3. check-inventory against the manifest; curated webp into
#    docs/redesign/2026-11/evidence/before/.
#
# Exit codes of every step are written to <out>/exit-codes.txt.
set -u
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
BASE_SHA=367719b3
LEDGER="/Users/amankumarshrestha/LapenInns Project/platform/naba-presence-redesign/notion-mail-ledger"
E2E="$HOME/node_modules/.bin/e2e"
OUT="${1:-/Users/amankumarshrestha/LapenInns Project/platform/naba-presence-redesign/2026-11-redesign/evidence/a-inventory/before-$BASE_SHA}"
CURATED=docs/redesign/2026-11/evidence/before
mkdir -p "$OUT"
codes="$OUT/exit-codes.txt"
: > "$codes"
record() { echo "$1=$2" | tee -a "$codes"; }

if ! git diff --quiet "$BASE_SHA" HEAD -- app components lib proxy.ts next.config.ts; then
  echo "app code differs from $BASE_SHA; refusing" >&2
  exit 2
fi

# The capture and journeys run inside one lock hold and one server.
cat > "$OUT/inner.sh" <<'INNER'
set -u
out="$1"; e2e="$2"; codes="$out/exit-codes.txt"
record() { echo "$1=$2" | tee -a "$codes"; }
node tests/visual/nm-capture.mjs --out "$out" --viewports phone,tablet,desktop \
  --themes light --mobile-dpr 2 --concurrency 4 > "$out/capture-light.log" 2>&1
record CAPTURE_LIGHT $?
node tests/visual/nm-capture.mjs --out "$out" --viewports desktop,phone \
  --themes dark --mobile-dpr 2 --concurrency 4 --merge > "$out/capture-dark.log" 2>&1
record CAPTURE_DARK $?
"$e2e" run --target desktop --tag desktop --output .e2e/desktop > "$out/e2e-desktop.log" 2>&1
record E2E_DESKTOP $?
"$e2e" run --target mobile --tag mobile --output .e2e/mobile > "$out/e2e-mobile.log" 2>&1
record E2E_MOBILE $?
INNER

"$LEDGER/scripts/with-lock.sh" e2e a-inventory bash -c '
  pnpm build > "$0/build.log" 2>&1 || exit 80
  git checkout -q AGENTS.md
  "$1/scripts/with-e2e-db.sh" node tests/visual/nm-serve.mjs -- bash "$0/inner.sh" "$0" "$2"
' "$OUT" "$LEDGER" "$E2E"
record LOCKED_RUN $?
for target in desktop mobile; do
  [ -d ".e2e/$target" ] && rm -rf "$OUT/agentic-$target" && cp -R ".e2e/$target" "$OUT/agentic-$target"
done

node docs/redesign/2026-11/check-inventory.mjs --manifest "$OUT/manifest.json" > "$OUT/check-inventory.log" 2>&1
record CHECK_INVENTORY $?

# Curated set: <viewport-dir>/<shot> pairs, one per line, in the repo as webp.
mkdir -p "$CURATED"
while read -r shot; do
  [ -z "$shot" ] && continue
  src="$OUT/$shot.png"
  dest="$CURATED/$(echo "$shot" | tr '/' '_').webp"
  if [ -f "$src" ]; then cwebp -quiet -q 70 "$src" -o "$dest"; else echo "missing $src" >&2; fi
done < tests/visual/nm-capture-before.curated.txt
record CURATE $?
