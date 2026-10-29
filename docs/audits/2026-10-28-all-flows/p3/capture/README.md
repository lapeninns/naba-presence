# p3 capture harness (reference copy)

`run-capture.sh` and `capture-interactions.mjs.txt` are the scripts that
produce `../evidence/before/` and `../evidence/after/`. The interaction script
is renamed `.mjs` → `.mjs.txt` here, so the format ratchet and lint don't pick
it up. The same two files, fixtures, viewports, state names and steps are used
for BEFORE and AFTER.

## What it does

`run-capture.sh <WT> <OUT> [phase]` runs, for the worktree `WT`:

1. **lock**: takes the machine-wide visual lock `/tmp/naba-presence-visual.lock`
   (one harness at a time).
2. **db**: starts a throwaway PostgreSQL 17 cluster with the repo's own
   `scripts/ci/postgres.mjs` (`NABA_PG_DIR=/tmp/p3-pg-visual`), creates a
   database named `naba_visual` and migrates it with `scripts/db-migrate.mjs`
   and `scripts/db-create-runtime-role.mjs`. This replaces
   `tests/visual/with-visual-db.sh`, because the local Supabase on `:54322` on
   this Mac belongs to another project and has no `naba_visual` database.
3. **start**: the repo's fixture server (`tests/visual/fixture-server.ts`,
   "Sprint 5 Journey" tenants, Google stub on 3533) and the production build
   (`node .next/standalone/server.js`) on 3532, with the `.claude/launch.json`
   "visual-app" environment, `PASSWORD_AUTH_ENABLED=false` and
   `GOOGLE_API_PROXY_BASE` pointing at the stub. It then warms every route.
4. **shoot**: twelve URL states through `tests/visual/shoot.mjs` (390 light,
   390 dark, 1280 light; `--full`; `--wait 2500`; at 1280 the app scrolls
   inside its shell, so those shots stop at 1280 × 860), then the five interaction
   states through the interaction script. PNGs become WebP (`cwebp -q 80`)
   named `<state>-<390-light|390-dark|1280>.webp` in `OUT`. A failed step
   still saves its shot, with a `-FAILED` suffix, and the run log says why.
5. **stop** / **dbstop**: SIGINT to the processes it started (the fixture
   server destroys its tenants), waits for the ports to close, stops the
   throwaway cluster and releases the lock.

`all` (the default) runs lock → db → start → shoot and always runs stop and
dbstop on exit. Nothing reaches real Google, and no interaction submits a
write (no Save, Review, Send, Publish or Remove confirm).

## Rerun

The script expects the interaction script next to it under its real name, so
copy both into a scratch folder outside the repo first:

```sh
WT=/path/to/worktree            # BEFORE: a clean detached worktree at e4123d25
OUT=$WT/docs/audits/2026-10-28-all-flows/p3/evidence/after   # or .../before
H=/tmp/p3-capture-harness
mkdir -p "$H"
cp "$WT/docs/audits/2026-10-28-all-flows/p3/capture/run-capture.sh" "$H/"
cp "$WT/docs/audits/2026-10-28-all-flows/p3/capture/capture-interactions.mjs.txt" \
  "$H/capture-interactions.mjs"
(cd "$WT" && pnpm build)        # the app is served from .next/standalone
bash "$H/run-capture.sh" "$WT" "$OUT"
```

The worktree needs its own `node_modules` and the env files the harness reads
itself (the original runs used symlinks to the main checkout's; the scripts
never print them). Ports 3532 and 3533 must be free. For a long run, call the
phases one at a time (`lock`, `db`, `start`, `shoot`, `stop`, `dbstop`), each
in the foreground.

## Known limits

- The interaction script refuses to run unless every role's cookie resolves to
  the "Sprint 5 Journey tenant", so it can't shoot a real organisation.
- `08-hours-day-sheet` only toggles Monday open if it is closed, and matches
  the switch by either name ("Monday open in this sheet" before, "Open on
  Monday" after).
- Mobile full-page captures paint docked bars at their viewport position;
  overlap in a stitched image is a capture artefact.
