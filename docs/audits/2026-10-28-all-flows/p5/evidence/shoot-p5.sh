#!/bin/sh
# Captures the p5 states with the repo harness. Run from a worktree whose
# visual-fixtures + visual-app are up (ports 3201/3200), under the visual lock.
#   sh shoot-p5.sh <worktree> <out-dir>
set -e
WT="$1"; OUT="$2"
cd "$WT"
mkdir -p "$OUT"
shoot() { # name route role
  node tests/visual/shoot.mjs --route "$2" --role "$3" --widths 390,1280 --theme light --full --wait 2500 --name "$1" --out "$OUT"
  node tests/visual/shoot.mjs --route "$2" --role "$3" --widths 390 --theme dark --full --wait 2500 --name "$1-dark" --out "$OUT"
}
shoot 01-inbox-queue "/inbox" owner
shoot 02-inbox-review "/inbox?selected={review}" owner
shoot 03-inbox-empty-sorted "/inbox?queue=failed&sort=rating_asc" owner
shoot 04-inbox-search-empty "/inbox?search=zzqx" owner
shoot 05-inbox-review-viewer "/inbox?selected={review}" viewer
shoot 06-notifications "/notifications" owner
shoot 07-notifications-open "/notifications?filter=open" owner
shoot 08-calendar-off-owner "/calendar" owner
shoot 09-calendar-off-viewer "/calendar" viewer
shoot 10-reports-reply "/reports" owner
shoot 11-reports-google "/reports?tab=google" owner
shoot 12-reports-keywords "/reports?tab=keywords" owner
shoot 13-reports-listing "/reports?locationId={loc}" owner
shoot 14-reports-unknown-client "/reports?clientId=00000000-0000-4000-8000-000000000000" owner
