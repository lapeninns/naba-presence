# R2-V1: Adversarial verification of W0 and W1 findings

Read-only. I re-traced every claim from the code at HEAD d8759c74 plus the working tree, and from `@tanstack/query-core@5.101.4` `build/modern`. Nothing was run against a database or provider.

| Claim                                      | Verdict                                    | Priority                              |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------- |
| W1 F2 awaited full refetch                 | PARTIALLY CONFIRMED (1–3 rounds, not 2–4)  | P1 defensible; P2 if k is usually 1–2 |
| W1 F3 unbounded settling and counts poll   | CONFIRMED, with scope and practice caveats | P1 → **P2**                           |
| W1 F8 invalidation drift                   | CONFIRMED (5 sites, not 6)                 | P2 → **P3**                           |
| W1 F10 per-observer timers                 | PARTIALLY CONFIRMED (volume overstated)    | volume **P3**                         |
| W1 F10 background 401                      | CONFIRMED                                  | P2                                    |
| W1 F4 `retry: 1`                           | CONFIRMED (config)                         | P2/P3                                 |
| W0-03 lock across Google calls             | PARTIALLY CONFIRMED (two corrections)      | P1 → **P2**                           |
| W0-04 profile GET cost                     | CONFIRMED                                  | P2                                    |
| W0-05 session write per request            | CONFIRMED                                  | P2                                    |
| W0-01 scheduled posts missed under backlog | PARTIALLY CONFIRMED / PLAUSIBLE            | P1 ok                                 |

## W1 F2: every review write awaits a full refetch. PARTIALLY CONFIRMED

The mechanics are confirmed:

- `lib/queries/invalidate.ts:15-20` awaits `Promise.all` over three invalidations: detail, `reviewsAll` and `reviewCountsAll`.
- That hook is used as `onSuccess` by:
  - `use-publish-review.ts:16`
  - `use-approval-decision.ts:16`
  - `use-delete-reply.ts:15`
  - `use-draft-mutations.ts:66` (verify)
  - `:48-54` (generate/save, which also awaits `aiCreditsAll`)
- `invalidateQueries` returns `refetchQueries` for the active queries, with `cancelRefetch: true` (`queryClient.js:148-179`).
- `mutation.js:123` awaits `options.onSuccess` before `mutateAsync` resolves.
- An infinite refetch walks every cached page in order (`infiniteQueryBehavior.js:64-72`). `useReviews` sets no `maxPages`.
- "All counts" is right: the prefix key matches every active counts query (shell, rail groupBy).

Correction on the round count. A failed publish runs no `onSuccess`, so it triggers no refetch round. The rounds in `action-bar.tsx:149-192` are:

- Verified draft and clean composer: publish only = **1** round.
- Save + publish = **2** rounds.
- `stale_draft_evidence` path: save, then a failed publish (0 rounds), then verify (1 round), then an extra `detail.refetch()`, then publish = **3** rounds plus one detail read.

The real range is **1–3** rounds, not 2–4.

## W1 F3: unbounded settling poll. CONFIRMED, with caveats

Confirmed in code:

- `settling.ts:33-37` has no upper bound, and its own comment says it is unbounded on purpose.
- `use-review-counts.ts:38-43` keys the poll on `byStatus`.
- Each counts request costs:
  - Always: the settings select, the totals with N `count(*) filter`, and the `group by workflow_status` (`review-counts.ts:49-89`).
  - Sometimes: `requireLocationAccess` (location scope only) and the groupBy query (`:91-109`).
  - Per request: the session select + update + billing read.

Caveats:

- The scope is the user's **visible** locations (`visibilityPredicate`, `:67`), not literally the whole organisation.
- The poll lasts only as long as a row stays `publish_requested`. Publish runs inline and the minute recovery cron settles stragglers, so in practice the poll is short-lived.
- P2 suits it better until it is measured.

## W1 F8: invalidation drift. CONFIRMED (5 sites, not 6)

There are 5 invalidation sites:

- `invalidate.ts`
- `template-reply-dialog.tsx:126-130`
- `sync-reviews-button.tsx:44-46`
- `use-clients.ts:95-96`
- `use-bulk-review-action.ts:20-26`

The drift is real:

- `invalidate.ts` does not invalidate `clientsAll`.
- The template dialog does not invalidate the review details.

The impact is client badges that lag by up to 60 s, which makes this **P3**.

## W1 F10: polling observers and background 401. Polling PARTIALLY CONFIRMED, 401 CONFIRMED

The library facts hold:

- Each observer owns its own `#refetchIntervalId` (`queryObserver.js:208-218`).
- The interval ignores `staleTime`.
- The interval is reset only when its value, the query or `enabled` changes (`:116`).

But the extra request volume is overstated:

- The interval tick calls `#executeFetch()` with no `cancelRefetch`.
- `Query.fetch` (`query.js:184-193`) returns the in-flight promise when a fetch is already running.
- Observers mounted in the same commit (the shell components) start their timers within milliseconds of each other, so they collapse to one request per minute.
- The extra requests therefore equal the number of distinct mount moments (page navigation, palette or sheet opened), not about 13. That is **P3**.

The 401 issue is confirmed:

- `fetchClients(signal)` (`lib/api/clients.ts:14-18`) passes no `background`.
- So `client.ts:351-355` calls `handleUnauthorized()` on an interval or focus refetch.

## W1 F4: `retry: 1`. CONFIRMED (config)

`query-client.ts:8` sets `retry: 1` unconditionally. The double side effect was not traced end to end. A foreground 401 hard-navigates on the first attempt, so the second attempt rarely matters.

## W0-03: transaction held across Google calls. PARTIALLY CONFIRMED (two corrections)

Confirmed:

- `profile.ts:640-646` holds `pg_advisory_xact_lock` inside `connection.begin` on a dedicated `withSessionConnection` client for the whole flow.
- That flow is the live read, validateOnly, PATCH and up to 3 readback attempts.
- The data work runs on pooled `withTenant`, so the lock transaction sits **idle in transaction**.
- The same pattern appears in `hours.ts:739`, `food-menus.ts:460`, `business-information.ts:203,510` and `industry-management.ts:119`.

Correction 1, the lock type: it is an **advisory** lock, not a row lock.

Correction 2, the timeouts: "no timeouts" is refuted for any deployment that follows the runbook.

- `scripts/db-create-runtime-role.mjs:37-40` pins `statement_timeout=30s` and `idle_in_transaction_session_timeout=60s` on the runtime role itself.
- `docs/runbook.md:1251-1258` says `DATABASE_SESSION_URL` uses that same role.

The real risks are therefore different:

- Google latency over 60 s (GOOGLE_TIMEOUT_MS is 15 s × several calls) kills the backend. The COMMIT then fails _after_ Google accepted the write, so the operator sees an error for a write that succeeded.
- A waiter on the lock errors after 30 s on the statement timeout.
- Each in-flight write holds one session-pooler slot, out of the 15 noted in the runbook.

## W0-04: profile GET cost. CONFIRMED

A profile GET runs these transactions:

1. `loadLinkedLocation` (`profile.ts:189`)
2. `ensureCanonicalResource` (`:216`)
3. `loadStoredStates` (`:100`)
4. `persistObservedFields` (`:144`, a per-field loop)
5. `recordResourceObservation` (`:274`)
6. `latestAttempt` (`:282`)

That is 6 transactions, several of them writes, plus 1 live Google read.

A save-and-publish reads the profile from Google at least 4 times:

1. The PUT (`saveCanonicalProfile` → `readLiveProfile`, `:424`).
2. The editor's `fetchProfile` (`profile-editor.tsx:440`).
3. `prepareProfilePublish` (`:605`).
4. The readback (`:718`, up to 3 attempts).

The `useProfile` refetch adds a fifth.

`use-location-profile.ts:16-21` invalidates 3 query families in a `finally` on every fetch.

## W0-05: session write per request. CONFIRMED

- `session.ts:217-229` runs the `update app_session set last_seen_at = now(), …` with no age condition, so there is **no throttle**.
- `route.ts:364` calls `requireSession()` on every session-auth route.

## W0-01: scheduled posts missed under backlog. PARTIALLY CONFIRMED / PLAUSIBLE

The exact rule for when an occurrence becomes missed:

- `deadline_at = intended_at + 5 min` (`DISPATCH_WINDOW_MS`, `lib/domain/publication-schedule.ts:32`, used at `:354`).
- An occurrence is claimable only while `intended_at <= now() < deadline_at` (`0118_post_schedule_dispatch.sql:210`).
- `mark_missed_post_occurrences()` (latest version `0119_post_schedule_settle.sql:27-43`) sets status `missed` with reason `outside_dispatch_window` on any occurrence still `scheduled` once `deadline_at <= now()`.
- That sweep runs at the start of **every** tick (`jobs.ts` `sweepScheduledOccurrences`), even while publishing is paused.

How the budget runs out:

- The tick's main claim loop runs while `now + GOOGLE_TIMEOUT_MS (15 s) <= deadline`, with a budget of 45 s (`app/api/jobs/run/route.ts:12`).
- Then **bulk children** run, and only then `runDueSchedules`. Both run on the leftover budget.
- `runDueSchedules` needs at least 15 s left before it claims anything (`publication-schedule-runner.ts:942`).

So a post is missed only when about **5 consecutive** minute ticks each end with less than 15 s left after sync and bulk work. That needs a sustained backlog, such as the daily fleet sweep, and it fails silently. The ordering is confirmed; the occurrence rate is unmeasured. P1 is fine.
