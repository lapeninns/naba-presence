# p3 screenshot capture brief (BEFORE and AFTER use the same script)

> The working brief as given to the capture run, copied from the research
> notes. What actually ran is recorded in [`capture/README.md`](capture/README.md)
> and the report: the app was served from a production build, not
> `next dev`, and the 1280 shots show the top 860 px only, because the app
> scrolls inside its shell at that width.

Goal: a reusable, repeatable capture of the Listings-core states below, run once
on the unchanged code (BEFORE) and later on the changed code (AFTER), with the
same script, fixtures, viewports, names and steps.

## Rules

- Never read or print `.env*`, tokens, keys, cookies or OTPs. `.env.local` is a
  symlink; leave it alone (the harness scripts read it themselves).
- Never kill processes you didn't start. Never touch other worktrees.
- The visual harness is one-at-a-time machine-wide. Take the lock first:
  `until mkdir /tmp/naba-presence-visual.lock 2>/dev/null; do sleep 30; done; echo "p3 $(date)" > /tmp/naba-presence-visual.lock/owner`
  (run it in the foreground with a timeout under 10 min; repeat if needed —
  another thread holds it now and will release it). Remove the lock
  (`rm -rf /tmp/naba-presence-visual.lock`) only after both harness processes
  you started have stopped. Always release it, even on failure.
- Ports: app **3532**, Google stub **3533**. Fixture tenants are the harness's
  own "Sprint 5 Journey" tenants in the isolated `naba_visual` database; they
  are destroyed when the fixture server gets SIGINT. Nothing reaches real
  Google (the app's `GOOGLE_API_PROXY_BASE` points at the stub).
- Interactions may open sheets and type into fields but must **never submit**
  a write (no Save, Review, Send, Publish, Upload, Remove confirm).

## Harness (run from the worktree being captured, `$WT`)

1. Fixtures (background, keep PID):
   `cd $WT && VISUAL_APP_PORT=3532 PLAYWRIGHT_GOOGLE_STUB_PORT=3533 nohup tests/visual/with-visual-db.sh node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs tests/visual/fixture-server.ts > /tmp/p3-visual-fixtures.log 2>&1 &`
   Wait until the log says `[visual-fixtures] seeded`.
2. App (background, keep PID): the `visual-app` command from
   `$WT/.claude/launch.json` with ports changed to 3532/3533
   (`GOOGLE_API_PROXY_BASE=http://127.0.0.1:3533 NEXTAUTH_URL=http://localhost:3532`,
   `next dev --turbopack --port 3532`) plus `PASSWORD_AUTH_ENABLED=false`, logging to
   `/tmp/p3-visual-app.log`. Warm every route once (curl or one throwaway shot)
   so Turbopack compile time doesn't land in the screenshots.
3. Stop: `kill -INT` the fixture server's **node** PID and the app's PIDs (and
   their children you started: `pgrep -P`), wait for
   `[visual-fixtures] tenants destroyed` in the log and the ports to close,
   then remove the lock.

## States

Viewports for every state: **390 light, 390 dark, 1280 light** (Chromium, as
`tests/visual/shoot.mjs` does: `isMobile`/`hasTouch` below 768, reduced motion,
height 860). Full-page screenshots.

URL states — use `node tests/visual/shoot.mjs --base http://localhost:3532
--route <route> --role <role> --widths 390,1280 [--theme dark --widths 390]
--full --wait 2500 --name <name> --out <tmpdir>`:

| name               | route                                                                                                                          | role   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 01-board           | `/listings`                                                                                                                    | owner  |
| 02-board-no-match  | `/listings?q=zzqx` (check the board reads `q` from the URL; if not, make it an interaction state that types in the search box) | owner  |
| 04-overview        | `/listings/{loc}`                                                                                                              | owner  |
| 05-overview-viewer | `/listings/{loc}`                                                                                                              | viewer |
| 06-profile         | `/listings/{loc}/profile`                                                                                                      | owner  |
| 07-hours           | `/listings/{loc}/hours`                                                                                                        | owner  |
| 09-hours-viewer    | `/listings/{loc}/hours`                                                                                                        | viewer |
| 10-menu            | `/listings/{loc}/menu`                                                                                                         | owner  |
| 11-menu-member     | `/listings/{loc}/menu`                                                                                                         | member |
| 12-people          | `/listings/{loc}/people`                                                                                                       | owner  |
| 14-booking         | `/listings/{loc}/booking`                                                                                                      | owner  |
| 15-booking-viewer  | `/listings/{loc}/booking`                                                                                                      | viewer |

Interaction states — write ONE small Playwright script `capture-interactions.mjs`
modelled on `shoot.mjs` (same cookie loading from
`test-results/e2e-journey-state.json`, same fixture-tenant guard, same context
options), placed at
the area's research-notes `p3/capture/` folder (kept in the repo as
[`capture/`](capture/))
and copied into `$WT/test-results/` to run (so `@playwright/test` resolves).
Find stable selectors from the e2e specs (`tests/e2e/desk-quick-look.spec.ts`,
`listings.spec.ts`, `touch-critical.spec.ts`, `administration-access-*.spec.ts`,
`place-actions-backend.spec.ts`) and the components. Prefer role/label locators
that are likely to survive copy edits (e.g. open the first day row by its day
name, the invite button by `/invite/i`). If a step's locator fails, save the
screenshot anyway with a `-FAILED` suffix and log the error; don't abort.

| name                | steps                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03-board-quick-look | 1280 only: `/listings`, open the first listing's desk quick look (see `desk-quick-look.spec.ts`)                                                                                                                       |
| 08-hours-day-sheet  | `/listings/{loc}/hours`, open Monday's day sheet (on desk it may be inline; capture whatever opening Monday shows), set the closing time earlier than the opening time (e.g. opens 18:00, closes 02:00) without saving |
| 13-people-invite    | `/listings/{loc}/people`, open the invite sheet, type `not-an-email` into the email field, then press Tab                                                                                                              |
| 16-booking-add      | `/listings/{loc}/booking`, type `example.com/book` into the booking link field (do not submit)                                                                                                                         |
| 17-profile-invalid  | `/listings/{loc}/profile`, clear the business name field, then press Tab (do not save)                                                                                                                                 |

## Output

- Convert every PNG to WebP (`cwebp -q 80`), named
  `<name>-<390-light|390-dark|1280>.webp`, into
  `$OUT` (given in your task). Delete the PNGs.
- Write `$OUT/CAPTURE-NOTES.md`: date/time UTC, worktree + `git rev-parse HEAD`,
  exact commands, the per-shot JSON lines from shoot.mjs (status, overflow,
  console errors), every interaction step's result (ok / FAILED + error), and
  anything odd you saw (e.g. fixture listing's time zone, empty menu, etc.).
  Describe what each screenshot shows in one line (look at a few with Read to
  confirm they rendered the intended state, not a skeleton or error).
- Save a `run-capture.sh` next to the interaction script that runs the whole
  sequence (lock → harness → shots → stop → unlock) for a given `$WT` and `$OUT`,
  so AFTER can be produced with one command.
