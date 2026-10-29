# P5 AFTER capture notes

- Head: `ux/flows-presence-p5` at `8da8cae217e0b439e6a48c103158c3264608e81a`
  ("fix(ux): address independent review of the p5 pass"), worktree `/tmp/naba-presence-p5`.
- When: 2026-10-28. Waited from 21:06 GMT for the visual lock (held by "p6" since 20:30),
  took it 22:00:06 GMT, shots 22:01:06 to 22:03:39 GMT, lock released 22:04:09 GMT.
- Stack: Next.js 16.4.1 (`next dev --turbopack --port 3200`), Node 24.16.0,
  Chromium via Playwright, system time zone Europe/London. Same as BEFORE.
- Output: 42 PNGs (14 states: light at 390 and 1280, dark at 390) and
  `shoot-log.jsonl` (42 JSON lines from `tests/visual/shoot.mjs`).

## Recipe (same as BEFORE, run from `/tmp/naba-presence-p5`)

1. `LC_ALL=en_US.UTF-8 NABA_PG_DIR=~/Library/Caches/naba-p5-after/pg node scripts/ci/postgres.mjs start`
   (Homebrew PostgreSQL 17, port 58490), then `create database naba_visual`,
   `pnpm db:migrate` (149 migrations, through `20260729000400_remove_local_demo_data`)
   and `pnpm db:runtime-role` (`naba_test_runtime`), with `DIRECT_DATABASE_URL` pointing at
   `.../naba_visual`.
2. Env for both servers: `DIRECT_DATABASE_URL` = postgres@cluster/naba_visual;
   `DATABASE_URL`, `DATABASE_SESSION_URL`, `TEST_RUNTIME_DATABASE_URL` =
   naba_test_runtime@cluster/naba_visual; `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`,
   `CRON_SECRET` set to the public placeholders from
   `tests/integration/helpers/env-defaults.ts`. `.env.local` symlinked from the main
   checkout (never read) and removed at the end.
3. Fixtures: `VISUAL_APP_PORT=3200 PLAYWRIGHT_GOOGLE_STUB_PORT=3201 node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs tests/visual/fixture-server.ts`.
4. App: the `visual-app` flags from `.claude/launch.json` unchanged (`LOCAL_BOOTSTRAP_ENABLED=false`,
   `GOOGLE_API_PROXY_BASE=http://127.0.0.1:3201`, `NEXTAUTH_URL=http://localhost:3200`,
   `OPENAI_API_KEY=`, `WEBHOOKS_ENABLED=false`, all `GBP_*_ENABLED=true`,
   `DESIGN_SYSTEM_EVIDENCE_ENABLED=true`) plus the env above, then
   `pnpm exec next dev --turbopack --port 3200`.
5. Teardown: SIGINT to both servers ("tenants destroyed"), `postgres.mjs stop` with the
   same `NABA_PG_DIR` (cluster and data deleted), ports 3200/3201 confirmed free,
   `.env.local` symlink removed, lock directory removed.

Side effect to know about: on boot, `next dev` 16.4.1 rewrote the
`nextjs-agent-rules` block at the top of the tracked `AGENTS.md` ("Generated AGENTS.md
for AI agents"). That came from Next, not from this capture. It was restored with
`git checkout -- AGENTS.md` after the server stopped, and `git status --short` is empty.

Before shooting, `/api/session` resolved to "Sprint 5 Journey tenant" (agency) for the
owner cookie ("Harness user", owner) and the viewer cookie ("Journey viewer", viewer).
All 12 distinct routes were warmed once and returned 200.

## Commands

```
sh "$HOME/LapenInns Project/research/naba-presence-all-flows-2026-10-28/p5/capture/shoot-p5.sh" \
  /tmp/naba-presence-p5 \
  "$HOME/LapenInns Project/research/naba-presence-all-flows-2026-10-28/p5/evidence/after"
```

Exit 0 on the first run, so no shot was re-run.

## Results from shoot.mjs

- All 42 captures: HTTP 200, `horizontalOverflow: false`, `errors: []` (no console errors).
- The final URL of every capture matches its BEFORE twin. That includes 01 at 1280 auto-selecting
  `?selected=<id>`, and 14 landing on `/reports` with `clientId` dropped.
- All image dimensions match BEFORE (1280x860 desktop crops, the same mobile heights).
- App log: only the expected startup warnings (no email provider, password auth without
  Supabase URL). No request errors. Fixture log: no `googleapis` traffic.

## Rendered states

| # | Route | Role | What rendered |
|---|---|---|---|
| 01 | `/inbox` | owner | Needs reply queue, 2 reviews; 1280 auto-selects the 4-star approval review; composer placeholder "Write your reply.", footer "No reply yet · write one above" |
| 02 | `/inbox?selected={review}` | owner | 5-star "Sprint 5 journey review", photo tile now labelled "Photo unavailable", composer "Write your reply.", disabled Publish reply; 390 shows "2 of 2" and Inbox back link |
| 03 | `/inbox?queue=failed&sort=rating_asc` | owner | Failed tab with "Sort: Lowest rated" chip; empty state is now "No failed publishes. Every reply sent to Google got there." with "Go to Needs reply (2)"; right pane "No review open" |
| 04 | `/inbox?search=zzqx` | owner | "No reviews match "zzqx"" / "Nothing in Needs reply matches. Try other words, or choose another queue above. Your search stays." with "Clear search" |
| 05 | `/inbox?selected={review}` | viewer | No amber banner; one inline line under "No reply yet": "View-only access for this location. You can read the review and its reply; ask an owner or admin for reply access." Read-only "No reply yet." box; "Private until published"; Team still absent from viewer nav |
| 06 | `/notifications` | owner | "No notifications yet", body now "Approval requests, low-rated reviews and problems with Google connections, publishing or syncs show up here."; still two "Notification settings" actions |
| 07 | `/notifications?filter=open` | owner | Open filter, empty: pixel-identical to BEFORE |
| 08 | `/calendar` | owner | "Scheduled publishing is off"; body now "Posts cannot be scheduled in this workspace, so there is nothing to show here. Only NabaPresence support can switch scheduled publishing on; it is not a workspace setting. Posts are published from each listing's Posts tab." Go to Listings; Calendar nav item still appears only here |
| 09 | `/calendar` | viewer | Same heading; viewer body now "...If you need it, ask an owner or admin to request it from NabaPresence support. Posts are published from each listing's Posts tab." |
| 10 | `/reports` | owner | Same figures (2 reviews, 0%, "—", 4.5); 1280 pixel-identical; 390 "By listing" subtitle now "Highest response rate first. Unresolved counts 1- and 2-star reviews with no reply on Google." |
| 11 | `/reports?tab=google` | owner | Pixel-identical to BEFORE in all three shots |
| 12 | `/reports?tab=keywords` | owner | Same 2 terms; "Impressions" wording replaced: "Times shown in search, counted from May 2026", column "Times shown", rank "No. 1 by times shown", footnote "a "+" means at least this many. Google gives a range, not an exact count, for less-searched terms." |
| 13 | `/reports?locationId={loc}` | owner | Single-listing report unchanged except the seed location name and keyword ranks "No. n by times shown" |
| 14 | `/reports?clientId=<unknown uuid>` | owner | Still silently lands on `/reports` "All clients"; every shot is byte- or pixel-identical to AFTER state 10 (no not-found feedback) |

## Fixture tenant contents

Same as BEFORE. Org "Sprint 5 Journey tenant" (agency), client "Journey Hospitality",
2 listings, 2 Needs-reply reviews (5-star with photo placeholder, 4-star approval review),
no replies, no notifications, scheduled publishing off, performance and keyword data on
1 of 2 listings, header pill "Some clients need checking". The only seed difference is the
random location suffixes: BEFORE 07d3a144 / b37aa684, AFTER 00a0c523 / f76a5879.

## Differences from BEFORE

Pixel diff (ImageMagick `compare -metric AE -fuzz 2%`) on all 42 pairs, then checked by eye.
Every pair has the same dimensions. These are pixel-identical: all of 07 and 11, plus
10/14 at 1280. Every remaining difference is listed below. Location-name suffix changes (seed) are not listed.

| State | Before | After |
|---|---|---|
| 01 inbox queue | Composer placeholder "Write a reply, or generate one."; footer "No reply yet" | "Write your reply."; footer "No reply yet · write one above" (1280 only shows composer) |
| 02 inbox review | Photo tile shows an icon only; "Write a reply, or generate one."; footer "No reply yet" | Tile reads "Photo unavailable"; "Write your reply."; footer "No reply yet · write one above" (wraps to 2 lines at 390, partly under the dev "N" badge) |
| 03 failed + sort, empty | Filter icon, "No reviews match these filters." + Clear filters; right pane "No review selected / Pick a review from the list, or press J to open the first one." | Inbox-check illustration, "No failed publishes. Every reply sent to Google got there." + "Go to Needs reply (2)"; right pane "No review open / Reviews in this list open here." Sort chip and "Clear all filters" unchanged |
| 04 search no match | "No reviews match these filters." + Clear filters; "No review selected" | "No reviews match "zzqx"", query-specific help, "Clear search"; "No review open" (chip still uses straight quotes "zzqx") |
| 05 viewer review | Amber "View-only access" banner at top plus a second view-only line in the reply area; "Private until you publish" | Banner removed; single inline view-only line; "Private until published"; review content moves up ~110px |
| 06 notifications | Empty body "Problems with Google connections, publishing and syncs appear here." | "Approval requests, low-rated reviews and problems with Google connections, publishing or syncs show up here." Duplicate "Notification settings" actions remain |
| 07 notifications open | Open, empty | Identical |
| 08 calendar owner | "...turned on per workspace by NabaPresence support; ask them when you are ready to schedule posts." | "Posts cannot be scheduled in this workspace... Only NabaPresence support can switch scheduled publishing on; it is not a workspace setting. Posts are published from each listing's Posts tab." |
| 09 calendar viewer | "Scheduled publishing is not switched on for this workspace. Ask an owner or admin if you need it." | "Posts cannot be scheduled in this workspace... If you need it, ask an owner or admin to request it from NabaPresence support. Posts are published from each listing's Posts tab." |
| 10 reports reply | By listing: "Highest response rate first. Missing figures show "—", never zero." | "Highest response rate first. Unresolved counts 1- and 2-star reviews with no reply on Google." (390 only; 1280 identical). "As at 29 Oct" vs "30 Sept – 28 Oct" mismatch unchanged |
| 11 reports google | "Through 28 Oct · 0 of 2 listings up to date", Showing 1 of 2 | Identical |
| 12 reports keywords | "Impressions counted from 1 May", column "Impressions", "No. n by impressions", footnote about Google reporting impressions | "Times shown in search, counted from May 2026", "Times shown", "No. n by times shown", shorter footnote |
| 13 reports listing | Keyword ranks "No. n by impressions" | "No. n by times shown"; date labels ("30 Sept – 28 Oct" vs "1 Oct – 29 Oct") unchanged |
| 14 unknown clientId | Silent fallback to /reports, All clients | Unchanged: still silent, identical to state 10 |

## Capture artefacts and limits

- As in BEFORE: `--full` has no effect at 1280 (app shell scrolls inside main), so desktop
  shots are 1280x860 crops. At 390 the fixed bottom nav is painted mid-page in the tall
  Reports captures (screenshot artefact, same in BEFORE).
- The Next.js dev "N" badge overlaps the user chip (desktop) and the Inbox tab or composer footer
  (mobile). It appears only in dev.
- Every PNG was compared with its BEFORE twin by pixel diff, and every differing state was checked by eye.
  No PNG shows a sign-in page or a real organisation; all show "Sprint 5 Journey tenant".
- Not captured (fixture cannot produce): non-empty notifications, calendar on, replied or
  failed-publish reviews.
