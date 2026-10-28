# p6 capture harness (Settings, Team, Billing, Design system)

## How the 28 Oct capture ran (use this)

The local `naba_visual` database was missing on 28 Oct, so both BEFORE and AFTER ran on a throwaway
PostgreSQL cluster from the repo's own e2e harness, against production builds:

```sh
cd "$WT" && pnpm build                       # the checkout under test
until mkdir /tmp/naba-presence-visual.lock 2>/dev/null; do sleep 15; done
echo "p6 $(date)" > /tmp/naba-presence-visual.lock/owner
node scripts/run-test-command.mjs e2e sh \
  /tmp/naba-presence-p6/docs/audits/2026-10-28-all-flows/p6/capture/run-throwaway.sh <out-dir> AB
rm -rf /tmp/naba-presence-visual.lock
```

- `scripts/run-test-command.mjs` starts, migrates and stops the cluster. `run-throwaway.sh` seeds the
  fixtures with `throwaway-fixtures.ts` (refuses unless the cluster is disposable), switches on the two org
  features, serves the app with `pnpm start` on 3562 (Google stub 3563) in config A, then B, and runs
  `shots.mjs` for each.
- `ONLY=id,id` reshoots single states; `HOLD=1` keeps each configuration up until
  `/tmp/p6-capture-release-<A|B>` exists, for running `shots.mjs` by hand; `SERVE=dev` uses `next dev`
  (its billing-on pages looped Fast Refresh reloads on 28 Oct, so it wasn't used for evidence).
- `shots.mjs` visits every selected route once at both widths before shooting (warm-up), and polls up to
  8 s for each setup's control.

The sections below describe the original `naba_visual` route, kept for reference.

`shots.mjs` takes the p6 states (`states.md`) at 390 light, 390 dark and 1280 light against the visual
fixtures. BEFORE and AFTER use the same script, the same two app configurations and the same fixture
settings. Only the checkout under test changes.

## Rules

- **Lock.** Only one visual harness can run on the machine at a time. Take the lock first, and remove it only
  after both of your processes have stopped:
  ```sh
  until mkdir /tmp/naba-presence-visual.lock 2>/dev/null; do sleep 30; done
  echo "p6 $(date)" > /tmp/naba-presence-visual.lock/owner
  # ...harness...
  rm -rf /tmp/naba-presence-visual.lock
  ```
- **Ports.** The app runs on 3562 and the Google stub on 3563. Stop your own processes with `kill -INT <pid>`.
  SIGINT makes the fixture server destroy its tenants. Then check that both ports are free.
- **Database.** Only the local `naba_visual` database, through `tests/visual/with-visual-db.sh`, and only the
  fixture tenant "Sprint 5 Journey tenant". No migrations. No hosted databases.
- **Secrets.** Never read or print `.env*`. `test-results/e2e-journey-state.json` holds session cookies, so
  never print it either.
- **No mutations.** No setup presses a final confirm. Requests to any host other than localhost are aborted in
  the browser. The app process runs with the Stripe and OpenAI keys blanked, and the Google API goes to the stub.

## Env files

The checkout under test needs `.env` and `.env.local` symlinked from the main checkout. Don't read them.
Both are gitignored; check with `git check-ignore .env .env.local`.

```sh
ln -s "$HOME/LapenInns Project/platform/naba-presence/.env" "$WT/.env"
ln -s "$HOME/LapenInns Project/platform/naba-presence/.env.local" "$WT/.env.local"
```

## Start the fixtures (from the checkout under test, `$WT`)

```sh
cd "$WT" && mkdir -p test-results
VISUAL_APP_PORT=3562 PLAYWRIGHT_GOOGLE_STUB_PORT=3563 nohup tests/visual/with-visual-db.sh \
  node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs tests/visual/fixture-server.ts \
  > /tmp/p6-visual-fixtures.log 2>&1 &
echo $! > /tmp/p6-visual-fixtures.pid
# poll until the log says "[visual-fixtures] seeded"
```

The fixtures write `$WT/test-results/e2e-journey-state.json`.

## Fixture settings (applied once, after "seeded", for both configs)

Two organisation features are switched on for the fixture organisation only. The row goes when the tenant is
destroyed. `ORG` is the `organisationId` in the state file; read only that field.

```sh
ORG=$(node -e 'console.log(require("./test-results/e2e-journey-state.json").organisationId)')
for F in privacy_settings workspace_mode_change; do
  tests/visual/with-visual-db.sh pnpm ops:pause feature --organisation "$ORG" \
    --feature "$F" --enable --operator visual-capture-p6
done
```

- `privacy_settings` makes `/settings/privacy` reachable (F08) and adds the Data and privacy row to the index.
- `workspace_mode_change` shows the workspace type card on Reply policy for the owner (F03).

## App configurations

Both start from `.claude/launch.json` "visual-app", with ports 3200→3562 and 3201→3563. Run one at a time,
and stop the app with SIGINT between them. The fixtures can keep running.

**Config A: billing off, MFA off** (the launch.json defaults):

```sh
cd "$WT" && LOCAL_BOOTSTRAP_ENABLED=false GOOGLE_API_PROXY_BASE=http://127.0.0.1:3563 \
  NEXTAUTH_URL=http://localhost:3562 OPENAI_API_KEY= WEBHOOKS_ENABLED=false \
  GBP_PROFILE_WRITES_ENABLED=true GBP_MEDIA_ENABLED=true GBP_POSTS_ENABLED=true \
  GBP_FOOD_MENUS_ENABLED=true GBP_PLACE_ACTIONS_ENABLED=true GBP_PERFORMANCE_ENABLED=true \
  GBP_KEYWORDS_ENABLED=true DESIGN_SYSTEM_EVIDENCE_ENABLED=true \
  STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= STRIPE_PORTAL_CONFIGURATION_ID= EMAIL_PROVIDER=none \
  nohup tests/visual/with-visual-db.sh pnpm exec next dev --turbopack --port 3562 \
  > /tmp/p6-visual-app-A.log 2>&1 &
echo $! > /tmp/p6-visual-app.pid
```

**Config B: billing on, MFA on.** Use the same command with `BILLING_ENABLED=true MFA_ENABLED=true` added, and
log to `/tmp/p6-visual-app-B.log`.

- Only the app process gets these flags. No env file changes.
- `@next/env` doesn't override a variable that is already set, even an empty one. So the blank `STRIPE_*`
  values keep any Stripe key in `.env.local` out, and billing shows its "no Stripe" state.
- `MFA_ENABLED` doesn't gate page rendering. It only holds owner and admin mutations to step-up
  (`lib/server/mfa.ts` `mfaStepUpRefusal`, called from `route()` for `mfa: "step_up"` handlers). It also adds
  the Sign-in security row and tab (`app/(dashboard)/settings/layout.tsx`).
- `BILLING_ENABLED` adds the Billing and Usage rows and tabs, and moves the credits card off Reply policy.
- These index and tab changes are why the billing and security states run in their own config (B), and every
  other state runs with both flags off (A).

Wait for the app with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3562/api/session`.

## Shoot (from /tmp/naba-presence-p6, which holds this script)

```sh
cd /tmp/naba-presence-p6
node docs/audits/2026-10-28-all-flows/p6/capture/shots.mjs --base http://localhost:3562 \
  --state "$WT/test-results/e2e-journey-state.json" --config A --webp \
  --out docs/audits/2026-10-28-all-flows/p6/evidence/<before|after>
# restart the app in config B, then:
node docs/audits/2026-10-28-all-flows/p6/capture/shots.mjs --base http://localhost:3562 \
  --state "$WT/test-results/e2e-journey-state.json" --config B --webp \
  --out docs/audits/2026-10-28-all-flows/p6/evidence/<before|after>
```

- `--only id,id` reruns single states, and `--variants 390-light,1280-light` picks variants.
- The script refuses to run when a cookie doesn't resolve to the fixture tenant, or when the server's billing
  and MFA state (checked by the status of `/settings/billing` and `/settings/security`) doesn't match
  `--config`.
- The first pass on a cold `next dev` compiles each route. If a state times out, rerun it with `--only`.
- Files are named `<id>-390-light`, `<id>-390-dark` and `<id>-1280-light`. They're WebP when `cwebp` is on
  PATH, otherwise PNG. One JSON line per shot goes to `shots.jsonl`.

## Stop

```sh
kill -INT "$(cat /tmp/p6-visual-app.pid)"; kill -INT "$(cat /tmp/p6-visual-fixtures.pid)"
# wait for "[visual-fixtures] tenants destroyed" in /tmp/p6-visual-fixtures.log
lsof -nP -iTCP:3562 -iTCP:3563 -sTCP:LISTEN   # expect nothing
rm -rf /tmp/naba-presence-visual.lock
```

`pnpm exec next dev` runs under `with-visual-db.sh` (exec) and pnpm. If a child is still listening after the
SIGINT, send SIGINT to the process listening on 3562, and to nothing else.
