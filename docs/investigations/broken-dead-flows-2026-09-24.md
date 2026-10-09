# Investigation: Broken or dead flows across NabaPresence

## Summary
The core daily flows work end to end in a live run on the isolated `naba_visual` DB with the Google stub:
- onboarding wizard
- inbox triage, one-press publish, and approval submit/reject/resubmit/approve
- bulk actions and sync
- all ten listing areas, including save and publish
- client share links
- reports and CSV
- team management
- settings
- every legacy redirect

No flow is broken across the board. The defects sit at the edges:
- **Security (2):** switching organisation escapes a support impersonation (F1), and the end of an impersonation is never audited (F2 / N1).
- **Broken UI (3):**
  - A React hydration error fires on every `/inbox` load (L1).
  - The approver's reject note is stored but never shown to the author (L2).
  - A published-but-stale draft can't be recovered, because the "Re-verify" control the error asks for was removed (F8).
- **Dead or dead-end UI (3):**
  - The Real-time notifications card is dead for logins with two or more Google accounts (L3).
  - "Add listings from Google" on `/listings` dead-ends for existing clients (L4).
  - An archived client's hub is a soft 404 (L5).
- **Background drift (1):** the self-hosted scheduler never runs `/api/cron/health`, so no notifications are ever evaluated or sent outside Vercel (F4).
- **Dead code:** several orphan API routes, query keys and a contract comment. The consoles they belonged to were removed on purpose.

The user's feature map is also out of date in several places. The table under *Feature-map corrections* lists them.

## Scope and method
- Goal (from user interview): find flows that are **broken or dead**, including UI that doesn't work end to end, dead routes, orphan APIs, stubbed steps and mismatched UI↔API contracts.
- Scope: all ten areas of the user's feature map (auth, onboarding, inbox, listings, clients, reports, team, settings, background/system, legacy redirects/static).
- Method: static tracing (UI → fetch/query hook → API route → server logic → DB/Google), then a live run in Playwright against the **isolated `naba_visual` DB** (`tests/visual/with-visual-db.sh`) to confirm the suspects.
- Safety rules for the live run:
  - No publishing to Google from the dev org.
  - No `pnpm test:e2e` against the shared dev DB.
  - Use `localhost`, not 127.0.0.1.
  - Before any write, check that `/api/session` resolves to "Sprint 5 Journey tenant".
- Branch at start: `feat/inbox-simple-inspector` (b639640).

## User's feature map (input)
1. Auth: /sign-in (password + Google OAuth /api/auth/callback/google), / → /inbox or /sign-in, register + resend confirm + /auth/confirm, /forgot-password → /reset-password, /invite/[token], /api/session/switch, /api/support/impersonation.
2. Onboarding: /clients/new → /setup?client=… wizard (agency name → client summary → connect Google → pick account → pick locations → backfill → notifications → team → done).
3. Inbox: queues (needs reply / awaiting my approval / awaiting others / all), filters, hotkeys; always-open editor, tone, AI draft, templates; approval (/api/reviews/[id]/approval); one-press publish (/api/drafts/[id]/verify); bulk (/api/reviews/bulk); sync now + freshness; activity timeline.
4. Listings: board, overview, profile, hours, photos, posts, menu, booking, people, verification, suggestions (import-review), changes + publish gate.
5. Clients: index, hub, settings (edit/delete, connections, locations), share report (/share/report/[token]).
6. Reports: overview, presence metrics, keywords, deltas, CSV.
7. Team: invite, role, remove, per-client access, pending invitations resend/revoke.
8. Settings: agency, timezone, policy, notifications; connections; privacy (export, requests, legal holds); audit log.
9. Background: Pub/Sub webhooks + RISC, sync jobs, job runner, cron health/retention, ops health/reencrypt.
10. Legacy redirects (/photos, /posts, /profile/*, /settings/listing) and static pages (/privacy, /terms, /design-system).

## Symptoms
- None reported. This is a proactive sweep. The map was built from routes, nav and folders without tracing flows end to end.

## Initial hypotheses (things to test)
- H1: Orphan API routes that no UI calls, or UI fetches to routes/methods that don't exist.
- H2: Contract drift, where the UI sends or expects a shape the route no longer matches (especially after the listings IA move and the inbox publish rework).
- H3: Nav or links that point at retired or renamed routes; legacy redirects that point at the wrong `/listings/[id]/…` area or break when there are no locations.
- H4: Setup wizard steps that can't complete, or that skip or loop (e.g. the OAuth callback returns to the wrong step, or backfill never resolves).
- H5: Features that exist only as UI shells (stubbed handlers, TODOs, disabled buttons with no backend), e.g. menu, booking, verification/voice-of-merchant, legal holds.
- H6: Role-gated flows where the UI shows actions the API forbids, or the reverse (approval, team, client access).
- H7: Background endpoints that nothing triggers (the cron/scheduler doesn't call them).

## Background / Prior Research
- No external research was needed; everything is in the workspace.
- `components/settings/settings-nav.tsx:13-18` records that the privacy, legal-hold, audit and operations consoles were removed on purpose, with the APIs kept server-side. Routes in that group are classed as *intentionally API-only orphans*, not bugs.

## Investigator Findings

## Investigator Findings: Static verification

**Method.** Read-only static tracing on `feat/inbox-simple-inspector`, done on 2026-09-24/25. The explore probes stalled on approval prompts and were cancelled, so every verdict below comes from direct reads and greps. The pass was stopped before completion, and anything not traced is marked **NOT CHECKED**. Line numbers are as of this branch.

### F1 — Org switch drops support-impersonation markers and expiry — CONFIRMED — high (security)
- `app/api/session/switch/route.ts:56-60` calls `createSession(sql, current.userId, membership.organisationId)` with no `options`. It checks membership against `list_user_organisations(current.userId)` (`:44`), which returns the *customer's* memberships.
- `lib/server/session-store.ts:12-24,39-42`: when no options are passed, `support_actor`/`impersonation_reason` are null and expiry uses `SESSION_IDLE_DAYS` (14, sliding) up to `SESSION_ABSOLUTE_DAYS` (90) (`lib/server/env.ts:228-229`). The expiry is therefore neither 1 hour nor 30 days: it is 14 days sliding, up to 90. Impersonation itself passes `maxAgeDays: 1/24` (`app/api/support/impersonation/route.ts:75-82`).
- Neither `route()` nor the handler rejects support sessions. The only support handling is audit attribution when `session.supportActor` is set (`lib/server/route.ts:276-282`). The switcher is shown to everyone (`components/app-shell/account-menu.tsx:147`).
- **Impact:** A support agent can turn a 1-hour impersonation into a long-lived session as the customer in any of the customer's organisations. After the switch, audit rows no longer name the support actor. The 0055 guard is also lost, so "Sign out everywhere" (`lib/api/auth.ts:63`) from the switched session revokes **all** of the customer's sessions (`supabase/migrations/0055_support_session_sign_out.sql:28-33` keys on `support_actor`).
- **Fix:** In `app/api/session/switch/route.ts`, reject with 403 when `current.supportActor` is set. The alternative is to carry `supportActor`, `impersonationReason` and the *remaining* absolute expiry into `createSession`. Hide the switcher for support sessions.

### F2 — Ending impersonation via sign-out is never audited — CONFIRMED — medium
- `app/api/session/route.ts:31-38` DELETE → `clearSession()` (`lib/server/session.ts:256-269`), which just deletes the row. There is no audit.
- Only `DELETE /api/support/impersonation` writes `support.impersonation.ended` (`app/api/support/impersonation/route.ts:110-135`). **Nothing in the UI calls it.** The only references are comments in `lib/contracts/session.ts`, `lib/server/session.ts`, `lib/server/audit.ts` and `lib/server/route.ts`.
- **Impact:** From the UI, an impersonation ends only through sign-out or expiry, and neither leaves an "ended" audit row. The audit trail shows starts with no ends.
- **Fix:** In the `DELETE /api/session` handler (or `clearSession`), write the audit when the session has `supportActor`. Add an "End impersonation" banner that calls the existing DELETE.

### F3 — Role-gated UI vs server — PARTIAL — low
- Inbox "Sync now" is **correctly gated**. `SyncReviewsButton` returns null unless `canTriggerSync(role)` (`components/inbox/sync-reviews-button.tsx:28`, `app/(dashboard)/inbox/page.tsx:41`, `lib/reporting/sync-permission.ts:1-3` = owner/admin). The server does `requireRole(owner, admin)` (`app/api/sync/reconcile/route.ts:51`).
- Reports refresh is **correctly gated**: `RefreshGoogleButton canTrigger={canTriggerSync(role)}` (`components/performance/google-performance-tab.tsx:79-83`, `keywords-tab.tsx:92-96`), matching `requireRole` in `app/api/sync/performance/route.ts:39` and `keywords/route.ts:36`.
- `/settings/listing` → `flatRouteTarget("people")` (`app/settings/listing/page.tsx:15-19`) goes to `/listings/<id>/people` only when the user can see exactly one location. Otherwise it goes to `/clients?moved=listing` (`lib/server/flat-route-redirect.ts:33-39`). The people page renders `AccessTab` for every role (`app/(dashboard)/listings/[id]/people/page.tsx:27-28`). The area is `consoleGated` (`lib/listings/areas.ts:97-105`), and members and viewers get `AdministrationDenied` ("Only owners and admins can see who has access"), which by its own contract never fires the owner/admin GET (`components/locations/administration/administration-tab.tsx:100-150`; API `roles: ["owner","admin"]` at `app/api/locations/[id]/administration/route.ts:23`). I did not open the exact role branch inside `AccessTab`.
- **Impact:** A member's old bookmark lands on a lock page. This is a graceful dead end, not a broken flow.
- **Fix (optional):** For non-console roles, send `/settings/listing` to the listing overview instead of `people`.

### F4 — `scripts/scheduler.mjs` has no health tick — CONFIRMED — medium (non-Vercel deployments only)
- `vercel.json` schedules `/api/cron/health` every 15 minutes. `grep health scripts/scheduler.mjs` finds nothing. The registered ticks are reconcile, retention, jobs, performance, keywords, presence-resources and sweep (`scripts/scheduler.mjs:452-488`).
- The health tick is what evaluates incidents and **delivers notifications** (`app/api/cron/health/route.ts:19-30`: `evaluateOrganisation`, `deliverPending`, `evaluatePlatform`). `lib/server/ops-liveness.ts:23` expects a `health` heartbeat within 2,700 s.
- **Impact:** On `pnpm start:scheduler` deployments (local, compose, non-Vercel), no notification is ever evaluated or sent, and ops health reports the health tick as permanently stale. Vercel is unaffected.
- **Fix:** Add a `recurring("health", …)` tick in `scripts/scheduler.mjs`. NOT CHECKED: whether `app/api/cron/health/route.ts` exports `POST`, since the scheduler's `post()` needs it. Add it if it's missing.

### F5 — Vercel performance/keywords crons only enqueue — REFUTED
- The enqueue side is `enqueueRecurring` → `ensure_recurring_checkpoints(kind)` (`lib/server/recurring-sync.ts:44-65`; `supabase/migrations/0048_fleet_queue.sql:68-75`).
- On the drain side, `vercel.json` runs `/api/jobs/run` every minute. `app/api/jobs/run/route.ts:27-30` GET calls `runDueJobs`. `claim_due_jobs` has a recurring arm, `where s.sync_type in ('reconcile','performance','keywords')` (`0048_fleet_queue.sql:199-205`). The runner lists these kinds (`lib/server/jobs.ts:84-88`) and handles them (`:779-800`). `claimableKinds` gates them on `GBP_PERFORMANCE_ENABLED`/`GBP_KEYWORDS_ENABLED` (`jobs.ts:170-173`), which default to true (`lib/server/env.ts:205-206`, `.env.example:82-83`).
- **Impact:** None. The sync is live on Vercel. Note that the scheduler's cron POST (no session) still walks the fleet inline (`app/api/sync/performance/route.ts:48-56` → `runPerformancePage`), so Vercel and the scheduler use two different execution models. NOT CHECKED: comments in `lib/contracts/operations.ts`.

### F6 — Scheduler sweep body params ignored — CONFIRMED — low
- `app/api/sync/sweep/route.ts:51-54` parses the body, then for cron (no session) calls `enqueueFleetSweep(requestId)`, which ignores `organisationCursor`, `maxOrganisations` and `maxPagesPerLocation`. The scheduler sends `{maxOrganisations: 1, maxPagesPerLocation: 5}` (`scripts/scheduler.mjs:371-375`). Its doc comment (`:356-365`) still describes the old one-organisation-per-request walk.
- **Impact:** Harmless. The queue arms every organisation in one statement. The scheduler's parameters and comment are misleading.
- **Fix:** Drop the body from `runSweep` and update its comment.

### F8 — `/api/drafts/[id]/verify` orphan and stale_draft_evidence recovery — NOT CHECKED

### F9 — Google OAuth state cookie path vs `/api/auth/callback/google` — NOT CHECKED

### F10 — `revokeInvitation(id)` vs `DELETE /api/invitations/[token]`; resend — NOT CHECKED

### F12 — Old `/reviews`, `/connections`, `/home`, `/locations/*` URLs — NOT CHECKED
(Only the flat routes were traced: `/profile`, `/profile/*` and `/settings/listing` all use `flatRouteTarget`.)

### F13 — `/profile/<unknown>` silently falls back to overview — CONFIRMED — low
- `app/profile/[...section]/page.tsx:19` resolves `FLAT_SEGMENT_MAP[section[0] ?? ""] ?? ""`, so any unknown section maps to `""` and lands on the listing overview (single location) or on `/clients?moved=profile` (`lib/server/flat-route-redirect.ts:33-39,65-74`). The user gets no hint that the section was not recognised.
- **Related bug (NEW, reasoned from code, not run):** `FLAT_SEGMENT_MAP` is a plain object, so `/profile/constructor` (or `toString`, …) returns the inherited `Object.prototype` function instead of `undefined`, and `?? ""` does not apply. With one location, the redirect target becomes `/listings/<id>/function Object() { [native code] }`, which 404s.
- **Fix:** Use `Object.hasOwn(FLAT_SEGMENT_MAP, key)` or a `Map` in `app/profile/[...section]/page.tsx`.

### F14 — Is `/listings/[id]/changes` linked? — REFUTED
- `ReviewPublishLink` in `components/listings/area-frame.tsx:~176-186` links to `listingHref(locationId, "changes")`, and every `AreaFrame` renders it in the header actions (`:~426-429`). It is hidden when the summary is missing, Google is unreachable, or `pending === 0`, which is intended. NOT CHECKED: whether the listing overview page (outside `AreaFrame`) links to it as well.

### F15 — "Add listings from Google" → `/setup` without `?client=` — NOT CHECKED

### Orphans (PUT /api/location-members, POST /api/members, GET /api/notifications, dead queryKeys, missing `lib/api/operations-health.ts`) — NOT CHECKED

### H5 shells — PARTIAL (locations only)
- **Administration (verification, voice-of-merchant, danger zone transfer/delete, admins, invitations):** not shells. All 11 operations (`lib/contracts/location-administration.ts:64-76`, confirmations `:81-93`, danger-zone set `:95-99`) go through `runAdministrationOperation` → `PATCH /api/locations/[id]/administration` (`lib/api/location-administration.ts:39-54`). That route exists, owner/admin only, and calls `mutateLocationAdministration` (`app/api/locations/[id]/administration/route.ts:45-57`). NOT CHECKED: that the server implements every operation. The grep was interrupted.
- **Menu and booking tabs:** controls are disabled only through capability/write reasons (`components/locations/menu-tab.tsx:46`, `booking-tab.tsx:131`). The backing routes `food-menus/` and `place-actions/` exist. `GBP_*_ENABLED` flags all default to **true** (`lib/server/env.ts:205-211`, `.env.example:82-90`), so they are not dead in production by default.
- `grep` for `TODO|FIXME|coming soon|not_implemented` across `components/{locations,clients,inbox,share,auth,settings}` found **no hits**.
- NOT CHECKED: client delete (no DELETE on `clients/[clientId]`), share report, reports CSV, inbox bulk, register/resend confirmation, forgot/reset password.

### Cross-reference to the live run
- Live run **L3** (notifications card dead for multi-account logins, `components/settings/notifications-card.tsx:51-70`) and **L2** (approval reject note never read back) were not on this static trace, so they are neither confirmed nor refuted here. Related to L3: per **F4**, notifications are also never evaluated or delivered on scheduler-based (non-Vercel) deployments, whatever the card state.

### New findings beyond the suspects
- **N1 (medium):** There is no UI to end a support impersonation. `DELETE /api/support/impersonation` has no caller (see F2).
- **N2 (high, part of F1):** A switched support session loses the 0055 protection, so "Sign out everywhere" from it signs the customer out on every device.
- **N3 (low):** A prototype-key lookup in `FLAT_SEGMENT_MAP` makes `/profile/constructor`-style URLs redirect to a garbage path (see F13).
- **N4 (low, docs):** Stale comments: the scheduler sweep comment (`scripts/scheduler.mjs:356-365`) describes the old per-organisation walk. `.env.example:74-81` describes the scheduler-only ingestion model, and the Vercel path now enqueues. Vercel and the scheduler run performance/keywords under different models (queue vs inline walk).

## Investigator Findings: Live run

**Setup.** Branch `feat/inbox-simple-inspector`, run on 2026-09-24. `visual-fixtures` (stub + seeder on :3201) and `visual-app` (`next dev --turbopack` on :3200) were started exactly as in `.claude/launch.json`, against `naba_visual` only. Every flow ran in headless Chromium through `http://localhost:3200`. Before each write batch, `/api/session` was checked: "Sprint 5 Journey tenant" for the owner/admin/viewer cookies, and "Harness tenant" (the seeded two-person-approval fixture org) for the approval cookies. No write was made from an anonymous context. Neither server log contains any `*.googleapis.com` traffic. The one outbound Google attempt was a browser navigation to `accounts.google.com/o/oauth2/v2/auth` ("Connect another account" and the wizard's "Sign in with Google"), and a Playwright route abort stopped it. At the end the fixture server got SIGTERM ("tenants destroyed") and the app was stopped. Screenshots are under `test-results/investigation/shots/`, raw events in `test-results/investigation/events.jsonl`, and the scratch Playwright scripts in `test-results/investigation/*.mjs`.

**Harness caveats (read before trusting a PASS or BLOCKED):**
- In dev, `NODE_ENV !== "production"` always permits the local-owner bootstrap, whatever `LOCAL_BOOTSTRAP_ENABLED=false` says (`app/api/session/route.ts:21`, `app/page.tsx:8`, `app/(dashboard)/layout.tsx:34`). Anonymous requests and dead cookies therefore resolve to "Lapen Inns" (the `naba_visual` copy). As a result, `/` and `/sign-in` without a cookie land on `/inbox`, so the anonymous sign-in page can only be seen with an invalid cookie.
- Supabase isn't configured (`startup.safety_violations_ignored: PASSWORD_AUTH_ENABLED requires SUPABASE_URL…`), so every password endpoint returns 503.
- The stub covers only some Google write routes. There's no POST `localPosts`, no media upload (`startUpload`), no admin create, and no performance fetch. Failures on those calls are harness gaps, not proven app bugs.
- `CRON_SECRET` wasn't available to the investigator, so authorised cron calls couldn't be made.

### Findings: BROKEN / DEAD (confirmed live)

| # | Verdict | Flow | Evidence |
|---|---|---|---|
| L1 | **BROKEN** | Inbox: every load of `/inbox` (and `/reviews`, `/home`, `/overview`, `/login` → `/inbox`) | A React hydration error, seen 33 times across 12 flows. `QueueTabs` (`components/inbox/queue-tabs.tsx`) renders count skeletons on the server with `aria-label="Needs reply"`, and real counts on the client with `aria-label="Needs reply, 2 reviews"` plus a count `<span>`. The tree is regenerated on the client every time. In dev, the Next "Issues" badge this raises covers the account-menu button in the sidebar's bottom-left corner, so clicking Sign out there fails. Screenshot: `a3-inbox.png`. |
| L2 | **BROKEN** | Inbox approval: reject note | The approver's "Reject this reply?" dialog asks for a note ("You can add a note explaining why"). POST `/api/reviews/{id}/approval {"decision":"reject","note":"Please mention the spa."}` → 200 `returned_to_draft`. The note is stored in `approval_decision.note` (`lib/server/review-approval.ts:129`), but `GET /api/reviews/{id}` never returns it, and the requester's detail pane and History dialog don't show it. History only says "Additional audit details recorded". So the author gets the draft back with no reason. Screenshot: `a3-approval-returned.png`. |
| L3 | **DEAD** | Settings › Google connections › Real-time notifications | `NotificationsCard` always calls `deriveAutoSelection` with `selectedAccountName: null` (`components/settings/notifications-card.tsx:51-70`), and that function only auto-picks when exactly one account is active (`lib/connections/derive-auto-selection.ts:19-23`). Once a login has two or more active Business Profile accounts (reached here by ticking a second account in the setup wizard), the card permanently shows "Choose a Google account… manage its notifications here", and no picker exists anywhere. Screenshot: `a8-settings-connections.png`. |
| L4 | **DEAD END** | Listings › "Add listings from Google" → `/setup` (no `?client=`) | `/setup` without a client lists only clients "waiting to be set up" (no linked listing) and otherwise offers "New client". With every client linked, the button gives no way to add listings to an existing client. The client hub's own link (`/setup?client=…&step=locations`) works, so only the `/listings` entry point is affected. Screenshot: `a2-setup-noclient.png`. |
| L5 | minor BROKEN | Clients: open an archived client's hub | `/clients/{archivedId}` returns **HTTP 200** containing the "PAGE NOT FOUND · 404" UI, a soft 404, and the client fetch fails with GET `/api/clients/{id}` → 404 `client_not_found`. Restore from `/clients?view=archived` works. Screenshot: `a5-archived-hub.png`. |
| L6 | minor (copy) | Listings › People › Add administrator | When Google returns NOT_FOUND (a stub gap here), the toast says "That could not be found. It may have been removed.", which reads as though the listing vanished rather than the Google call failing. PATCH `/api/locations/{id}/administration` → 404 `{"error":"NOT_FOUND","message":"Google request failed."}`. |

**Feature-map drift found live (not failures):**
- **Google sign-in:** `/sign-in` has email/password only, with no Google button. `/api/auth/callback/google` is the connect-flow callback (`GOOGLE_OAUTH_CALLBACK_PATH`).
- **Inbox queues:** the queues are Needs reply / Approval / Publishing / Failed / Done, with "Approval waiting on: Me" as a filter. There are no separate "awaiting others" or "All" tabs.
- **Templates:** only in the bulk bar, and only when the selection includes a rating-only review. No fixture review is rating-only, so this is BLOCKED.
- **Pending invitations:** "Copy link" and "Revoke" only, with no "Resend".
- **One-press publish:** it calls POST `drafts` (verified inline) and then POST `publish`. The UI never called `/api/drafts/[id]/verify` during the run.
- **Client settings:** Details, Listings and Archive only. There's no Connections section and no hard delete (archive/restore only).
- **Settings:** no notification-preferences section. Privacy export/requests, legal holds, the audit log and ops health have no UI at all; `components/settings/settings-nav.tsx:13-18` records that the consoles were removed on purpose, so those APIs are orphaned.

### Per-flow results

| Area | Flow | Result | Notes / evidence (screenshot in `shots/`) |
|---|---|---|---|
| 1 Auth | `/` (anonymous) | BLOCKED-by-harness | → `/inbox` as the Lapen Inns dev owner. `a1-root-anon.png` |
| 1 Auth | `/sign-in` | PASS (render) / BLOCKED (submit) | Renders with an invalid cookie: email and password fields, Create account, Forgot password, Resend confirmation. No Google button. Password POST `/api/auth/password/login` → 503 `auth_provider_unavailable`; the UI shows "Sign-in is temporarily unavailable". `a1-signin.png` |
| 1 Auth | `/forgot-password` submit | BLOCKED-by-harness | POST `/api/auth/password/reset/request` → 503. Graceful inline message. `a1-forgot-submitted.png` |
| 1 Auth | `/reset-password` (no token) | PASS | "This link is missing or incomplete" plus "Request another link". `a1-reset-notoken.png` |
| 1 Auth | `/invite/<bogus>` | PASS | GET `/api/invitations/bogus-token-123` → 404; the page shows "We could not find that invitation". A real token renders the create-account form. `a1-invite-bogus.png`, `a7-invite-anon.png` |
| 1 Auth | Sign out | PASS | DELETE `/api/session` → 204, landing on `/sign-in`. The old cookie then falls through to the dev owner (harness). `a1-after-signout.png` |
| 2 Onboarding | `/clients/new` → `/setup?client=…` | PASS | POST `/api/clients` → the wizard opens at `step=connect`. Use existing login → POST `/clients/{id}/connections` 200. Save accounts → PATCH `/api/google/accounts` 200. Link → POST `/api/location-links` 201. Import → POST `/api/sync/backfill` 200. Notifications (no enable control, since webhooks are off) → Team (invite form) → Done. "Sign in with Google" goes to accounts.google.com (aborted). `a2-wiz-*.png` |
| 2 Onboarding | `/setup` with no client | DEAD END | See L4. |
| 3 Inbox | Queues, filters, sort, age, search, chips, Clear all | PASS | Each query updates the URL and GET `/api/reviews?...`. `a3-filters.png` |
| 3 Inbox | Hotkeys j/k/r/g/x/?/⌘K/`/` | PASS | Each works on a fresh load. One early `Search: "/"` chip happened only after a chained key sequence and didn't reproduce. |
| 3 Inbox | Tone picker | PASS | `role=radio`, and `aria-checked` flips. |
| 3 Inbox | AI generate (no OpenAI key) | PASS (degrades) | POST `/api/reviews/{id}/drafts {"tone":…}` → 503 `ai_not_configured`. Inline message: "No reply was generated. AI assistance isn't available… Retry / Write my own". `a3-g.png` |
| 3 Inbox | One-press publish (stub) | PASS | drafts 201 (verification pass) → publish 200 `published` → toast "Reply published". `a3-published.png` |
| 3 Inbox | Submit for approval / reject / resubmit / approve | PASS, except L2 | publish 202 `awaiting_approval` → approval reject 200 → resubmit 202 → approve 200 `published`. `a3-approval-*.png` |
| 3 Inbox | Bulk assign / No reply needed | PASS | POST `/api/reviews/bulk` → 200 for both. "Approve" stays disabled (0 approvable). |
| 3 Inbox | Bulk templates | BLOCKED-by-harness | No rating-only fixture review. |
| 3 Inbox | Sync now + freshness | PASS | POST `/api/sync/reconcile` → 200, "Refreshed hh:mm", counts update. |
| 3 Inbox | Activity timeline | PASS | More actions › History: 4 events. `a3-history.png` |
| 4 Listings | Board, overview, all 10 areas (read) | PASS | All return 200 with no console errors or stuck spinners. `a4-*.png` |
| 4 Listings | Profile: Save here → Review & publish | PASS | PUT `/profile` 200 → POST `/profile` (to_google) 200 `published`. |
| 4 Listings | Hours: Save here → publish | PASS | PUT `/hours` 200 → publish via `/changes` 200. |
| 4 Listings | Photos upload | BLOCKED-by-harness | POST `/media` → 502 `media_data_ref_missing` (no stub upload route). The UI marks "1 can't upload" but shows no toast. |
| 4 Listings | Posts: draft → publish | PASS (draft) / BLOCKED (publish) | Draft POST 201. Publish → 404 "Google request failed." (the stub has only GET `localPosts`); the post stays a Draft. |
| 4 Listings | Menu: Save here | PASS | PUT `/food-menus` 200. Later, "Check Google now" raised a food-menu suggestion because the local menu differs from Google's empty one. |
| 4 Listings | Booking link | PASS | POST `/place-actions` 201. |
| 4 Listings | People: add admin | BLOCKED-by-harness (plus L6 copy) | Transfer and Delete open typed-confirm dialogs; neither was confirmed. |
| 4 Listings | Verification: start | PASS | PATCH `/administration start_verification` 200, state PENDING. |
| 4 Listings | Suggestions: check / keep here | PASS | import-review/refresh 200 → decision `keep_local` 200. |
| 4 Listings | Sibling switcher | PASS | The combobox lists siblings and navigates to `/listings/{other}/hours`. |
| 5 Clients | Index / hub / settings | PASS | |
| 5 Clients | Rename | PASS | PATCH `/api/clients/{id}` 200. |
| 5 Clients | Move listing to another client | PASS | POST `/clients/{id}/locations` 200, with an Undo toast. |
| 5 Clients | Archive / restore | PASS, except L5 | PATCH archived:true 200. Hub is a soft 404. Restore 200. |
| 5 Clients | Share report: create → anonymous open → revoke → anonymous open | PASS | POST `report-shares` 201 → anonymous 200 report → DELETE 200 → anonymous **404** "This report link isn't available". `a5-share-*.png` |
| 6 Reports | Reply / Google / Keywords tabs, client and location scope | PASS | All `/api/analytics/*` return 200. Location scope correctly narrows the org-wide overview in the client. |
| 6 Reports | CSV | PASS | `search-keywords-last-6-months.csv` downloaded, with rank, term and impression-range columns. |
| 7 Team | Invite / copy link / revoke | PASS | POST `/api/invitations` 201 → Copy link puts a working URL on the clipboard → DELETE 200. |
| 7 Team | Change role / client access / remove | PASS | PATCH `/api/members` 200, PUT `/members/{id}/client-access` 200, DELETE `/api/members` 200. With per-client access, "Allow publishing" is disabled by design ("Set per client, from Client access"). |
| 8 Settings | Agency name / approval / retention / timezone | PASS | PATCH `/api/organisations` 200; PATCH `/api/settings` 200, and values persist after reload. |
| 8 Settings | Connections: disconnect / connect another | PASS (dialog) / BLOCKED | The Disconnect dialog is correct (not confirmed). Connect goes to accounts.google.com (aborted). |
| 8 Settings | Notifications card | DEAD | See L3. |
| 8 Settings | Audit log / privacy / legal holds UI | DEAD (no UI) | APIs only; removed on purpose (see drift). |
| 9 Legacy | `/photos`, `/posts`, `/profile`, `/profile/*`, `/settings/listing` | PASS | 307 → `/clients?moved=<section>`, with the notice "…moved — pick a client, then its listing". |
| 9 Legacy | `/reviews`, `/home`, `/overview` → `/inbox`; `/login` → `/sign-in`; `/connections` → `/settings/connections`; `/analytics`, `/performance` → `/reports`; `/settings/team` → `/team`; `/locations[/:id[/administration\|/performance]]` | PASS | Each is 307 to the right destination. The `/inbox` destinations hit L1. |
| 9 Static | `/privacy`, `/terms`, `/design-system`; unknown route | PASS | 200 / 200 / 200; unknown route → 404 "Page not found". |
| 10 Background | GET/POST `/api/cron/health`, `/api/jobs/run`; GET `/api/sync/performance` | BLOCKED (no secret) | All **401** `invalid_cron_token`, both without a header and with a bogus bearer. |
| 10 Background | POST `/api/sync/performance` (owner session) | BLOCKED-by-harness | **200**, but every location outcome is `failed / NOT_FOUND`: the stub has no performance route. |

### All 4xx/5xx and console errors seen in the run

| Count | Kind | Request / message | Where | Classification |
|---|---|---|---|---|
| 33 | pageerror | "Hydration failed…" (`QueueTabs` aria-label and count mismatch) | `/inbox`, including every redirect into it | **L1, app bug** |
| 2 | 404 GET | `/api/invitations/bogus-token-123` `invitation_not_found` | `/invite/<bogus>` | Expected |
| 1 | 503 POST | `/api/auth/password/reset/request` `auth_provider_unavailable` | `/forgot-password` | Harness (no Supabase) |
| 1 | 503 POST | `/api/auth/password/login` `auth_provider_unavailable` | `/sign-in` | Harness (no Supabase) |
| 1 | 503 POST | `/api/reviews/{id}/drafts` `ai_not_configured` | `/inbox` generate | Expected degradation (no key) |
| 1 | 404 POST | `/api/locations/{id}/posts/{id}/publish` "Google request failed." | `/listings/{id}/posts` | Harness (stub gap) |
| 1 | 502 POST | `/api/locations/{id}/media` `media_data_ref_missing` | `/listings/{id}/photos` | Harness (stub gap) |
| 1 | 404 PATCH | `/api/locations/{id}/administration` (create_admin) | `/listings/{id}/people` | Harness (stub gap) + L6 copy |
| 1 | 404 GET | `/api/clients/{id}` `client_not_found` | archived client hub | L5 (soft 404 at HTTP 200) |
| 1 | 404 GET | `/definitely-not-a-page` | unknown route | Expected |
| 1 | console | `net::ERR_NETWORK_IO_SUSPENDED` | `/listings/{id}/profile` | Navigation cancelled mid-request by the script; benign |
| 12 | 401 | cron routes (curl, not in the browser log) | background | Expected without the secret |
| 1 | nav (aborted) | `accounts.google.com/o/oauth2/v2/auth` | Settings › Connect another account | Expected OAuth hop; blocked by the harness |

## Investigation Log

### Phase 2: context_builder static sweep
**Hypothesis:** H1–H7 across all ten areas.
**Findings:** It produced 15 suspects (F1–F15). Cross-referencing `lib/api/*` against the `app/api/**` method table found no UI fetch to a missing route or method (H2 contract drift: none found).
**Conclusion:** The suspects were handed to two pairs with separate scopes.

### Phase 3a: Static verification pair
F1, F2, F4, F6 and F13 are CONFIRMED. F5 and F14 are REFUTED. F3 and H5 are PARTIAL. See its section above. The pass was stopped before completion, and the items it didn't cover were closed out below and by the live run.

### Phase 3b: Live-run pair (Playwright, `naba_visual`, Google stub on :3201)
It covered all ten areas and found L1–L6. It confirmed zero `*.googleapis.com` traffic in either server log. The fixture tenants were destroyed and both servers stopped afterwards.

### Phase 4: Orchestrator verification of open items
| Item | Verdict | Evidence |
|---|---|---|
| F1 | CONFIRMED | `app/api/session/switch/route.ts:58-62` calls `createSession(sql, current.userId, membership.organisationId)` with no support/expiry options, and there is no `supportActor` check anywhere in the handler. |
| F8: stale draft can't be re-verified | **CONFIRMED (static)** | `useVerifyDraft` (`lib/queries/use-draft-mutations.ts:19`) and `verifyDraft` (`lib/api/drafts.ts:21`) have no consumers. Once a draft is saved and checked, the composer save is `null` (`components/inbox/dirty-context.tsx:204-206`), so Publish resends `verifiedDraft.id` (`components/inbox/action-bar.tsx:140-143`). If the review changed after verification, `lib/server/publishing/intent.ts:192-197` returns 409 `stale_draft_evidence`. The copy says "Re-verify before publishing." (`lib/errors/action-errors.ts:103-104`), but no control does that. The retry button resends the same draft. The only way out is to edit the text so the composer saves a fresh draft. Not reproduced live (the fixture has no review edited after drafting). |
| F9: OAuth callback path | **REFUTED** | `GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/callback/google"` (`lib/server/google/oauth.ts:31`). The cookie path (`app/api/google/connect/start/route.ts:58`), `redirect_uri` (`oauth.ts:57-60`) and the token exchange (`oauth.ts:104-107`) all use it. `/api/google/connect/callback` is only the module that the alias re-exports (`app/api/auth/callback/google/route.ts:3`). Its own URL is never used as a redirect, so it is an unreachable duplicate route, not a failure. |
| F10: revoke and resend invitation | PARTIAL | Revoke works live (DELETE 200). There is no "Resend"; the panel offers Copy link + Revoke. That is feature-map drift, not a bug. |
| F12: old bookmarks | **REFUTED** | Live: `/reviews`, `/home`, `/overview`, `/login`, `/connections`, `/analytics`, `/performance`, `/settings/team` and `/locations/*` all 307 to the right destination. |
| F15: `/setup` with no client | **CONFIRMED** | This is L4. |
| `PUT /api/location-members` | Orphan, **not risky** | No caller in `lib`, `components`, `app` or `scripts`. Widening to all clients with an empty list is guarded: 409 `would_widen_to_all_clients` unless `allClients: true` (`app/api/location-members/route.ts:44-50`). The UI uses `members/[userId]/client-access` instead. |

## Root Cause
There is no single root cause. The defects fall into four patterns:

1. **Surfaces removed while their other half stayed.**
   - The inbox rework (commits 705443c and fc034d0 on this branch) folded "save + check" into Publish and removed the Re-verify control. The `stale_draft_evidence` path and its copy still assume that control exists (F8), and `drafts/[id]/verify` plus `useVerifyDraft` are now dead.
   - Removing the consoles left the API routes, query keys (`legalHolds`, `privacyRequests`, `operationsHealth`, `webhookFailures`) and the `lib/contracts/operations.ts` → `lib/api/operations-health.ts` reference orphaned.
   - Support impersonation has a start but no UI end (N1 / F2).
2. **Data written but never read back.**
   - The approval reject note is inserted into `approval_decision.note` (`lib/server/review-approval.ts:128-138`). No read path selects it; the only other query (`lib/server/publishing/intent.ts:101-108`) checks existence (L2).
3. **Session invariants enforced at creation only.** Support-session limits (actor, 1-hour expiry, audit attribution, the 0055 sign-out guard) are set when impersonation starts. Every other `createSession` call site, namely `session/switch`, silently drops them (F1).
4. **Two triggers for background work that drifted apart.** `vercel.json` and `scripts/scheduler.mjs` list different jobs (no health tick in the scheduler, F4). They also call the same routes with different semantics (GET enqueues, POST runs inline; the sweep ignores the scheduler's body, F6).

One-offs:
- **L1:** the queue-tab skeleton-versus-count markup differs between the server render and hydration (`components/inbox/queue-tabs.tsx:73-107`, driven by `countsQuery.isPending` at `components/inbox/inbox-view.tsx:652`). The prefetch in `lib/server/prefetch.ts:197-204` only seeds the unscoped `organisation` key, so any first paint where the client resolves a different key or cache state renders different markup. The exact trigger still needs confirming with the React diff in the console.
- **L3:** `NotificationsCard` hard-codes `selectedAccountName: null` (`components/settings/notifications-card.tsx:51-70`).
- **L4:** the `/listings` CTA omits `?client=`.
- **L5:** the archived-client hub renders a not-found UI without calling `notFound()`.

## Recommendations
In priority order:

1. **F1 (security).** In `app/api/session/switch/route.ts`, reject with 403 `support_session_forbidden` when `current.supportActor` is set, as invitations already do. Hide the org switcher in `components/app-shell/account-menu.tsx` for support sessions.
2. **F2 / N1.** Write `support.impersonation.ended` in `DELETE /api/session` when the session has a `supportActor`. Add an "End impersonation" banner that calls the existing `DELETE /api/support/impersonation`.
3. **F8.** Pick one of two fixes:
   - (a) In `components/inbox/action-bar.tsx` `onPublish`, on 409 `stale_draft_evidence`, call `verifyDraft(draftId)` and retry the publish once. This reuses `useVerifyDraft`.
   - (b) Have the composer treat a stale verified draft as needing a save, so one-press publish re-checks it.

   Then update the copy in `lib/errors/action-errors.ts:103-104`. If (b) is chosen, delete `app/api/drafts/[id]/verify` and `useVerifyDraft`.
4. **L1.** Make the queue-tab markup identical on the server and the first client render. Either render the skeleton until mount (a `useSyncExternalStore` hydrated flag, as `use-desktop-layout.ts` does), or prefetch the client-scoped counts key that `inbox-view.tsx:122` actually reads. Confirm with the console's hydration diff before choosing.
5. **L2.** Return the latest rejection `{ note, decidedBy, decidedAt }` from `GET /api/reviews/[id]` (the review detail read in `lib/server`), and show it above the composer and in History.
6. **F4.** Add a `/api/cron/health` tick (every 15 minutes) to `scripts/scheduler.mjs`, and check that the route accepts POST. Treat the 503 returned when `NOTIFICATIONS_ENABLED` is off as "paused", as retention already does.
7. **L3.** Add an account picker to `components/settings/notifications-card.tsx`, reusing the account list from `useGoogleAccounts`. Store the selection in component state, not `null`.
8. **L4.** On `app/(dashboard)/listings/page.tsx`, make "Add listings from Google" ask which client, or link to `/clients`. Or teach `/setup` without a client to offer existing clients.
9. **L5.** In the `app/(dashboard)/clients/[clientId]` page, call `notFound()` (a real 404) for archived or missing clients, or show an "Archived: restore" state.
10. **Cleanup:**
    - Delete `app/api/location-members/route.ts`.
    - Delete the `app/api/google/connect/callback` URL: move the handler into a lib module that `app/api/auth/callback/google/route.ts` imports.
    - Remove the dead query keys in `lib/queries/keys.ts`.
    - Fix the `lib/contracts/operations.ts` consumer comment.
    - Remove the stale sweep params and comments in `scripts/scheduler.mjs` (F6).
    - Use `Object.hasOwn` in `FLAT_SEGMENT_MAP` lookups (N3, `lib/server/flat-route-redirect.ts`).
11. **L6 (copy).** Map the Google `NOT_FOUND` from the administration route to "Google couldn't find that account or listing", not "It may have been removed."

### Feature-map corrections (the user's list vs the app)
| Map says | Reality |
|---|---|
| Sign-in with Google OAuth | Email/password only. `/api/auth/callback/google` is the *connect-a-Business-account* callback. |
| Queues: Needs reply / Awaiting my approval / Awaiting others / All | Needs reply / Approval / Publishing / Failed / Done. "Waiting on me" is a filter. |
| Templates in the editor | Only in the bulk bar, and only for rating-only reviews. |
| One-press publish uses `/api/drafts/[id]/verify` | It uses POST `/reviews/[id]/drafts` (checks inline) then POST `/reviews/[id]/publish`. The verify route is dead. |
| Client settings: delete, connections | Details / Listings / Archive only. Archive and restore; no hard delete. |
| Invitations: resend | Copy link + Revoke only. |
| Settings: notifications, privacy, legal holds, audit log | No UI for any of these; the consoles were removed on purpose. The Notifications card lives under Connections and is dead for multi-account logins (L3). |
| Legacy URLs → `/listings/[id]/…` | → `/clients?moved=<section>` with a "pick a client, then its listing" notice. |

## Fix status (branch `fix/broken-dead-flows`, 2026-09-25)
| Item | Fix |
|---|---|
| F1 | `session/switch` returns 403 `support_session_forbidden` for support sessions, and the account menu hides the switcher for them. |
| F2 / N1 | `DELETE /api/session` audits `support.impersonation.ended` (best effort; failures are logged). A new `ImpersonationBanner` has an "End impersonation" button. |
| L1 | Queue-tab counts render only after hydration (`lib/hooks/use-hydrated.ts`). Browser check: 0 hydration errors across 3 inbox loads. |
| L2 | `GET /api/reviews/[id]` returns `lastRejection`. The reply exception shows the note, and History reads "Note: …". |
| **New: resubmit after reject → 500** | Found by the L2 integration test. The 0006 trigger forbids `drafted → awaiting_approval`, so publishing or resubmitting the unchanged reply after a rejection failed. `preparePublish` now steps a `drafted` review to `verified` once the publish gates pass. |
| F8 | One-press publish re-checks via `useVerifyDraft` on `stale_draft_evidence`, refetches `updateTime` and retries once. The copy no longer mentions a missing "Re-verify" control. |
| L3 | The Notifications card has login and account pickers. |
| L4 | `/setup` without a client lists existing clients with "Add listings" (`?step=locations`). |
| L5 | An archived client's pages show an "archived" page with the restore path. The streamed 200 status is Next's documented behaviour (`streaming.md` §Status codes). |
| F4 / F6 | The scheduler runs `/api/cron/health` (`HEALTH_INTERVAL_SECONDS`, gated on `NOTIFICATIONS_ENABLED`), and the sweep's stale params and comments are gone. |
| L6 | Copy for Google `NOT_FOUND` / `PERMISSION_DENIED` / `INVALID_ARGUMENT`. |
| Cleanup | Deleted `PUT /api/location-members`. Made `/api/auth/callback/google` the real handler and deleted `/api/google/connect/callback`. Removed dead query keys. Fixed the stale contract and permissions comments. Added `flatSegmentFor` (`Object.hasOwn`, all listing areas). |
| Live-run lead: empty `CRON_SECRET` | Not a bug: `CRON_SECRET` is `z.string().min(16)` (`lib/server/env.ts:123`). |

## Preventive Measures
- **Route-coverage test.** In vitest, walk `app/api/**/route.ts` exports and assert that each method either has a `lib/api` caller or is on an explicit `API_ONLY` allow-list (cron, webhooks, support, operations, privacy). This would have caught `location-members`, `drafts/verify` and `notifications`.
- **Trigger parity test.** Assert that the path sets in `vercel.json` `crons` and in the job table of `scripts/scheduler.mjs` are equal, or differ only by an explicit allow-list.
- **Written-but-unread check in review.** When a PR adds a user-entered column (like `approval_decision.note`), require the read path in the same PR.
- **Session invariants in one place.** Route every `createSession` call through a helper that takes the *current* session, and have it copy or refuse support attributes, so new call sites can't drop them.
- **Hydration errors fail e2e.** Make the Playwright harness fail on any `pageerror` matching `Hydration failed`, so L1-style regressions are caught.
- **Error copy names a control that exists.** When removing a UI control, grep `lib/errors/action-errors.ts` for copy that tells the user to use it (as with "Re-verify").