# P5 BEFORE capture notes

- Base: `origin/ux/all-flows-presence` at `e4123d251cf9414c74e69b9cff018ba1c574d762`
  ("docs(release): record verified 7a70387b production promotion (#261)").
  Detached worktree `/tmp/naba-presence-p5-before`, left in place for comparisons.
- When: 2026-10-28. Visual lock taken 20:14:31 GMT, shots 20:26:58 to 20:29:33 GMT,
  lock released about 20:31 GMT.
- Stack: Next.js 16.4.1 (`next dev --turbopack --port 3200`), Node 24.16.0,
  Chromium via Playwright, system time zone Europe/London.
- Output: 42 PNGs (14 states: light at 390 and 1280, dark at 390) and
  `shoot-log.jsonl` (42 JSON lines from `tests/visual/shoot.mjs`).

## Deviation from the launch.json recipe (read this before the AFTER run)

`visual-fixtures` failed at first with `database "naba_visual" does not exist`.
The local Supabase port 54322 is served by another project's container
(`supabase_db_Nabaperks`). No naba-presence Supabase container exists, running
or stopped. I did not create anything on that cluster.

What I ran instead uses the repo's own disposable cluster script. It is the same
fixture server and app, but `with-visual-db.sh` is bypassed:

1. `LC_ALL=en_US.UTF-8 NABA_PG_DIR=~/Library/Caches/naba-p5-before/pg node scripts/ci/postgres.mjs start`
   (Homebrew PostgreSQL 17, a free port, here 64971), then `create database naba_visual`,
   `pnpm db:migrate` (149 migrations, through `20260729000400_remove_local_demo_data`)
   and `pnpm db:runtime-role` (`naba_test_runtime`), all with `DIRECT_DATABASE_URL`
   pointing at `.../naba_visual` on that cluster.
2. The env for both servers: `DIRECT_DATABASE_URL` set to postgres@cluster/naba_visual,
   and `DATABASE_URL`, `DATABASE_SESSION_URL` and `TEST_RUNTIME_DATABASE_URL` set to
   naba_test_runtime@cluster/naba_visual. `.env.local` (symlinked, not read) defines no
   `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` or `CRON_SECRET`. I checked that through
   `@next/env` as booleans only. The fixture server therefore fell back to the public
   placeholders in `tests/integration/helpers/env-defaults.ts`, and the app was given
   the same three values so the seeded tokens decrypt. Without them, `next dev` refuses
   to boot (env schema error in `instrumentation.ts`).
3. Fixtures: `VISUAL_APP_PORT=3200 PLAYWRIGHT_GOOGLE_STUB_PORT=3201 node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs tests/visual/fixture-server.ts`.
4. App: the `visual-app` flags from `.claude/launch.json` unchanged
   (`LOCAL_BOOTSTRAP_ENABLED=false`, `GOOGLE_API_PROXY_BASE=http://127.0.0.1:3201`,
   `NEXTAUTH_URL=http://localhost:3200`, `OPENAI_API_KEY=`, `WEBHOOKS_ENABLED=false`,
   all `GBP_*_ENABLED=true`, `DESIGN_SYSTEM_EVIDENCE_ENABLED=true`), plus the
   database env above, then `pnpm exec next dev --turbopack --port 3200`.
5. Teardown: SIGINT to both servers ("tenants destroyed"), then
   `node scripts/ci/postgres.mjs stop` (cluster and data deleted).

For a like-for-like AFTER run, use the same recipe, or restore a naba-presence
Supabase on 54322 and use `with-visual-db.sh`. Data differs between the two only in
seed timestamps.

Before shooting, `/api/session` resolved to "Sprint 5 Journey tenant" for the owner
cookie ("Harness user", owner, agency mode) and the viewer cookie ("Journey viewer",
viewer). `shoot.mjs` also refuses any cookie outside the fixture tenant. Every route
was warmed once with curl and returned 200.

## Commands

```
sh "$HOME/LapenInns Project/research/naba-presence-all-flows-2026-10-28/p5/capture/shoot-p5.sh" \
  /tmp/naba-presence-p5-before \
  "$HOME/LapenInns Project/research/naba-presence-all-flows-2026-10-28/p5/evidence/before"
```

Exit 0 on the first run, so no shot was re-run.

## Results from shoot.mjs

- All 42 captures: HTTP 200, `horizontalOverflow: false`, `errors: []` (no console errors).
- App log: only the expected startup warnings (no email provider, no OTEL endpoint,
  password auth without Supabase URL). No request errors.
- Fixture log: no `googleapis` traffic.

## Rendered states

| # | Route | Role | What rendered |
|---|---|---|---|
| 01 | `/inbox` | owner | Needs reply queue, 2 reviews. At 1280 the first review is auto-selected (URL becomes `?selected=<approval review>`); at 390 the list only |
| 02 | `/inbox?selected={review}` | owner | Review detail ("Sprint 5 journey review", 5 stars, image placeholder tile), empty composer, "AI replies aren't set up here", disabled Publish reply. 390 shows "2 of 2" and a back link to Inbox |
| 03 | `/inbox?queue=failed&sort=rating_asc` | owner | Failed tab, "Sort: Lowest rated" chip, "No reviews match these filters." with Clear filters; right pane "No review selected" |
| 04 | `/inbox?search=zzqx` | owner | Search no-match empty state |
| 05 | `/inbox?selected={review}` | viewer | Amber "View-only access" banner, read-only "No reply yet." box; Team is missing from the viewer's nav |
| 06 | `/notifications` | owner | "No notifications yet" empty state, "0 open and unread", two "Notification settings" buttons (header and empty state) |
| 07 | `/notifications?filter=open` | owner | Open filter, empty |
| 08 | `/calendar` | owner | "Scheduled publishing is off ... turned on per workspace by NabaPresence support", Go to Listings; a Calendar nav item appears only on this route |
| 09 | `/calendar` | viewer | Same, with viewer copy "Ask an owner or admin if you need it." |
| 10 | `/reports` | owner | Reply performance: 2 reviews, 0% response, median "—", 4.5 average, charts |
| 11 | `/reports?tab=google` | owner | Google performance: "Showing 1 of 2 listings" banner, Search views 400, Maps "No data", Calls 12, Website 30, Directions "No data" |
| 12 | `/reports?tab=keywords` | owner | Keywords: "Showing 1 of 2 listings", 2 terms (riverside hotel bath 5,200; spa near me 1,000+), CSV download |
| 13 | `/reports?locationId={loc}` | owner | Single-listing report for "Stub location 07d3a144", with Open listing and Whole client actions, Review activity and Visibility on Google sections |
| 14 | `/reports?clientId=<unknown uuid>` | owner | Silently lands on `/reports` with "All clients"; the final URL drops `clientId` and nothing tells the user the client was not found |

## Fixture tenant contents

- Org "Sprint 5 Journey tenant" (agency mode), one client "Journey Hospitality", 2 listings
  (Stub location 07d3a144 and b37aa684).
- 2 reviews, both in Needs reply: one 5-star "Sprint 5 journey review" with a photo
  placeholder, one 4-star "Sprint 5 approval journey review". No replies. Google sync
  state "Google not checked yet".
- Notifications: none (all, unread and open are empty).
- Calendar: scheduled publishing off for the workspace, for owner and viewer alike.
- Performance and keyword data on 1 of 2 listings only.
- Header status pill: "Some clients need checking".

## Things to note for the UX pass (seen, not judged)

- Reports date labels disagree. Reply performance says "As at 29 Oct" next to a
  "30 Sept – 28 Oct" period; the single-listing view shows "Last 28 days · 30 Sept – 28 Oct"
  beside "Review activity · Last 28 days · 1 Oct – 29 Oct", while Google says
  "Through 28 Oct". Shots were taken at 20:27 GMT on 28 Oct.
- Notifications has two identical "Notification settings" actions when empty.
- The unknown `clientId` case gives no feedback (state 14).

## Capture artefacts and limits

- `--full` had no effect on desktop shots: the app shell scrolls inside its main pane,
  so 1280 shots are 1280x860 viewport crops. Lower sections (for example the rest of
  the Reports charts, Google "Views: Search and Maps" and "Actions over time") are cut off.
  Mobile shots are taller where the document scrolls.
- The Next.js dev indicator (round "N" badge, bottom-left) overlaps the user chip on
  desktop and the Inbox tab/badge on mobile. It appears only in dev.
- No PNG shows a sign-in page or a real organisation. 11 of 42 were checked by eye
  (01-1280, 02-390, 03-1280, 05-1280, 06-1280, 08-1280, 09-390, 10-1280, 11-1280,
  12-dark-390, 13-1280). All show "Sprint 5 Journey tenant" fixture data, so nothing
  was deleted.
- Not captured: nothing in the script failed. States the fixture cannot produce
  (non-empty notifications, calendar on, reviews with replies or failed publishes)
  are not in this set.
