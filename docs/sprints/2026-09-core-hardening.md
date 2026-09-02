# Core hardening sprints — September 2026

Branch: `core-hardening`. Baseline commit: `160131a` (in-flight inbox work captured as-is).

Each sprint has one outcome. Each goal inside a sprint has one owner agent, an explicit
file allowlist (so parallel agents never collide), and a done-when check. Every sprint ends
with the same gate, run by the orchestrator only:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:integration
```

Agents never run `pnpm build` or the integration suite (the harness boots the shared
`.next/standalone` build), never commit, and never touch files outside their allowlist.

---

## Sprint 0 — Baseline green

**Outcome:** typecheck, lint, unit, component and integration suites all pass on the branch.

| Goal                           | Owner scope                                                                                              | Done when                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Typecheck red              | `tests/components/action-bar.test.tsx`                                                                   | `pnpm typecheck` exits 0                                                                                                                    |
| 0.2 Retention cron 500         | `app/api/cron/retention/route.ts`, `tests/integration/routes/privacy-fulfilment.test.ts`                 | route no longer nulls a NOT NULL column; regression test seeds an expired snapshot and asserts 200                                          |
| 0.3 Drafts contract            | `tests/integration/routes/timeouts.test.ts`, `lib/server/ai.ts` (only if a clearer error code is needed) | test matches the documented contract (omit body → generate); asserts no OpenAI call and a stable non-500 code when AI is unconfigured       |
| 0.4 Date-pinned analytics test | `tests/integration/routes/performance-analytics.test.ts`                                                 | fixtures use dates relative to now; test passes on any calendar day                                                                         |
| 0.5 Dead publish pulse         | `components/inbox/inbox-view.tsx`, `components/inbox/review-detail.tsx`, matching tests                  | pulse is observable before navigation, or navigation is deferred until the pulse ends; listener effect no longer re-subscribes every render |

---

## Sprint 1 — One authorization rule, one route skeleton

**Outcome:** location visibility has exactly one implementation; every API handler runs through one wrapper that owns request id, session, role/location gate, parsing and error mapping; per-surface kill switches exist.

| Goal                                                                  | Owner scope                                                                                                                                                                                                                                                                                                                                                      | Done when                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Visibility helper                                                 | `lib/server/permissions.ts`, `lib/server/capabilities.ts`, `lib/server/reviews-query.ts`, `tests/integration/**` for those                                                                                                                                                                                                                                       | `visibilityPredicate(sql, session)` + `grantsFor(sql, session, ids)` exported; the two copies in capabilities.ts and the one in reviews-query.ts are gone                                                               |
| 1.2 Route wrapper                                                     | new `lib/server/route.ts`, `lib/server/http.ts`, unit test                                                                                                                                                                                                                                                                                                       | wrapper owns request id, session, roles, params, body/query parsing, `apiError(error, requestId)`; documented in file header                                                                                            |
| 1.3a–e Migrate handlers (5 parallel agents, partitioned by directory) | `app/api/reviews/**`, `app/api/drafts/**`; `app/api/locations/**`, `app/api/location-*`; `app/api/settings/**`, `privacy`, `legal-holds`, `audit-log`, `members`, `invitations`, `organisations`, `operations`, `support`; `app/api/sync/**`, `cron/**`, `jobs/**`, `webhooks/**`, `analytics/**`; `app/api/auth/**`, `session/**`, `google/**`, `import-review` | every handler uses the wrapper; inline visibility SQL replaced by 1.1 helper; no `getDatabase()` in route files except cross-tenant enumeration that is commented as such; `apiError` never called without a request id |
| 1.4 Kill switches                                                     | `lib/server/env.ts`, the six write modules' capability checks, `tests/env-flags.test.ts`                                                                                                                                                                                                                                                                         | `GBP_{PERFORMANCE,KEYWORDS,POSTS,MEDIA,PLACE_ACTIONS,PROFILE_WRITES}_ENABLED` are read where the docs say they are; the two labelled stubs are deleted                                                                  |

Ordering: 1.1 and 1.2 run in parallel; 1.3a–e and 1.4 start after both land.

---

## Sprint 2 — One write pipeline

**Outcome:** posts, media, place actions, hours, profile, food menus and reply publishing all run through one shared "durable intent → provider call → readback/settle" helper; `publishing.ts` is decomposed along its documented phases.

| Goal                                        | Owner scope                                                                                                                  | Done when                                                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 `gbpWrite` helper                       | `lib/server/gbp-management.ts` (extend), new `lib/server/gbp-write.ts`, `lib/server/db.ts` (`jsonColumn`)                    | helper covers: linked-location context, capability + kill switch, idempotency key, start intent, provider call outside txn, readback compare, settle success/failure/ambiguous, audit; unit tests with a fake provider |
| 2.2–2.7 Migrate modules (6 parallel agents) | one of `hours.ts`, `profile.ts`, `media.ts`, `place-actions.ts`, `food-menus.ts`, `posts.ts` each, plus its routes and tests | module's private context/capability/intent/settle helpers deleted; behaviour and error codes unchanged; existing integration tests pass                                                                                |
| 2.8 Decompose publishing                    | `lib/server/publishing.ts` → `lib/server/publishing/*.ts`, `jobs.ts` imports                                                 | no function over 120 lines; phases named after `docs/architecture.md`; shared phases delegate to 2.1                                                                                                                   |

Ordering: 2.1 first; 2.2–2.8 in parallel after it lands.

---

## Sprint 3 — One contract per endpoint

**Outcome:** request and response schemas are declared once under `lib/contracts/` (no `server-only` imports) and imported by both the route and the client module; the 13 duplicate type names and the 7-site sort enum are gone.

| Goal                                                               | Owner scope                                                                                                                                                                                              | Done when                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Reviews contract                                               | new `lib/contracts/reviews.ts`, `app/api/reviews/**`, `lib/api/reviews.ts`, `lib/inbox/url-state.ts`, `lib/inbox/filter-labels.ts`, `lib/server/reviews-query.ts`, `components/inbox/review-filters.tsx` | one sort/status/filter vocabulary + one wire codec; adding a sort value is a one-line change                                 |
| 3.2–3.5 Location contracts (4 parallel agents)                     | hours+profile; media+posts+place-actions; capabilities+import-review+links+directory; business-information+industry+administration+booking+menu                                                          | each route's body/query schema and response type live in `lib/contracts/*`; `lib/api/*` imports them instead of re-declaring |
| 3.6 Settings, connections, privacy, members, invitations contracts | matching `lib/api/*`, routes                                                                                                                                                                             | same                                                                                                                         |

---

## Sprint 4 — Frontend core

**Outcome:** the locations area follows the inbox's "pure evaluator + thin renderer" pattern; one tab shell, one mutation hook, one error-copy module, server prefetch on the main routes.

| Goal                                                  | Owner scope                                                                                                            | Done when                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 `LocationTab` shell + `useResourceMutation`       | new `components/locations/location-tab.tsx`, new `lib/queries/use-resource-mutation.ts`, `lib/locations/*`             | shell owns capabilities → gate → fetch → pending/error → loaded; hook owns mutationFn + invalidate + toast                                          |
| 4.2a–c Migrate tabs (3 parallel agents)               | hours+booking+menu; profile+industry+posts+activity; business-information+photos                                       | no `TabLoaded` wrapper copies; no drilled `toast`/`invalidate`; photos page/filters in URL                                                          |
| 4.3 Split administration tab                          | `components/locations/administration-tab.tsx` → `components/locations/administration/*.tsx`, `lib/locations/` adapters | no file over 350 lines; `asRecord`/`asString`/`enumOptionsFor` live once in `lib/locations/`                                                        |
| 4.4 One error-copy module + query states + boundaries | `lib/errors/action-errors.ts` (merge of 3), `components/ui/query-states.tsx`, `app/(dashboard)/**/error.tsx`           | one map with 401/5xx fallbacks; the three hand-rolled retry alerts use `QueryStates`; each dashboard segment has an error boundary                  |
| 4.5 Data-layer hygiene                                | `lib/queries/**`, `lib/api/client.ts`                                                                                  | invalidations use the key factory; redundant `staleTime` removed; `signal` forwarded from every `queryFn`; 401 redirect only on foreground requests |
| 4.6 Server prefetch                                   | `app/(dashboard)/inbox/page.tsx`, `app/(dashboard)/(business)/**/page.tsx`, `app/(dashboard)/home/page.tsx`            | inbox, locations tabs and home hydrate their first queries server-side using the layout's existing pattern                                          |

Ordering: 4.1, 4.4, 4.5 in parallel; then 4.2a–c, 4.3, 4.6 in parallel.

---

## Sprint 5 — Verification and docs

**Outcome:** full suite green including e2e and a11y; architecture doc matches the code; an independent review finds no regressions.

| Goal                              | Owner scope                                                              | Done when                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 5.1 Docs                          | `docs/architecture.md`, `docs/frontend-backend-feature-map.md`, `README` | route wrapper, contracts, write helper, kill switches described accurately                 |
| 5.2 Independent review (2 agents) | read-only                                                                | server and frontend reviewers report no correctness regressions against baseline behaviour |
| 5.3 Full gate + e2e               | orchestrator                                                             | `pnpm test:e2e` and `pnpm test:a11y` pass                                                  |

---

## Ledger

Baseline `160131a` (wip inbox ergonomics, captured as-is). Every sprint below passed the
gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:integration`)
before its commit.

### Sprint 0 — `c9a1ec5` baseline green

Shipped: retention cron 500 fixed (stopped nulling the NOT NULL
`profile_field_state.snapshot_expires_at`, regression test seeds an expired snapshot);
action-bar test typecheck; drafts timeout test aligned with the omit-body-generates
contract plus an `ai_not_configured` case; performance-analytics fixtures relative to
now; inbox publish pulse visible before advancing with a stable event listener; this
plan. Deviations: none.

### Sprint 1 — `aa8515b` (1a) and `1a703cc` (1b)

Shipped: `lib/server/permissions.ts` is the only home of the visibility rule
(`visibilityPredicate`, `requireLocationAccess`, `canPublishLocation`, `grantsFor`);
`lib/server/route.ts` owns request id, auth mode, role gate, parsing, `ctx.tenant` and
error mapping with `x-request-id`; 70/71 route files migrated (the 71st re-exports);
zero direct `apiError()`/`serverRequestId()` calls in `app/api`; every inline
`location_member` SQL replaced (analytics overview x6, presence, keywords, reviews,
counts, directory, import review); `session/switch` and the Google connection helpers
on `withTenant`; `getDatabase()` only for commented cross-tenant enumeration; the
`GBP_*` per-surface kill switches wired at each module's provider boundary and the two
labelled stub flags deleted. Deviations: none.

### Sprint 2 — `6e8c16a` (2.1) and `8d2c3e1`

Shipped: `lib/server/gbp-write.ts` (`loadLinkedLocation`, `requireGbpWrite`,
`requirePublishGrant`, `idempotencyKey`, `AttemptStore` + `attemptStore()` over the
existing tables, `runGbpWrite` with the explicit ambiguous-vs-failed policy, 30
pglite-backed tests); `jsonColumn()`/`jsonColumnOrNull()` in `db.ts`;
`gbp-management.ts` kept its exports and delegates; hours, profile, media, place
actions, food menus and posts run their provider writes through the helper with their
private context/gate/intent/settle clones deleted; the linked-location query and the
`google_location_not_linked` 409 exist once; `publishing.ts` (1,580 lines, four
functions of 193-565 lines) decomposed into `lib/server/publishing/{types, intent,
approval, provider, settle, attempt, publish, delete, retry, recover}.ts` with the
barrel keeping every export and no function over 80 lines.

Deviations from the plan:

- The reply pipeline kept its own attempt store instead of delegating its shared
  phases to `runGbpWrite`. `publish_attempt` schedules automatic retries
  (`retryable`, `next_attempt_at`, `attempt_no`, 429 back-off), recovers in-flight and
  ambiguous rows by readback and body comparison rather than 409, treats a permanent
  failure as a 409 rather than a re-arm, and returns provider failures as outcomes;
  forcing that through the helper would have meant smuggling the provider error
  through `settle` and control-flow signals through `find`. Both file headers state
  the boundary.
- The `publish_attempt` idempotency recipe (organisation, review, reply-body hash) was
  preserved rather than rewritten onto `idempotencyKey`; only the six migrated
  modules adopted the shared recipe, where the pre-flight snapshot checks already
  cover rows keyed under the old scheme.

### Sprint 4a — `ab64b6a` frontend foundations (landed before Sprint 3)

Shipped: `lib/errors/action-errors.ts` (one `describeActionError` with status
fallbacks; the three per-area maps became deprecated re-exports);
`components/ui/query-states.tsx` used by the inbox list, review detail and tab states;
route-segment error boundaries for inbox, home, settings and business;
`components/locations/location-tab.tsx`, `useResourceMutation`, `useResetOnRevision`;
every invalidation through the key factory, 32 redundant `staleTime`s removed, abort
signals forwarded from every `queryFn`, 401 redirects only on foreground requests.
Deviation: the plan ordered Sprint 3 before Sprint 4; the foundations (4.1, 4.4, 4.5)
did not depend on the contracts and were run first so the tab migrations in 4b could
land on top of both.

### Sprint 3 — `59fc391` one contract per endpoint

Shipped: `lib/contracts/*` for every surface (reviews, hours, profile, media, posts,
place actions, capabilities, import review, links/directory, activity, business
information, industry, administration, food menus, settings, connections, google,
notifications, members, invitations, legal holds, privacy, analytics, sync, session,
operations, auth); routes import request schemas and `satisfies` responses; `lib/api`
imports response schemas; the 13 twice-declared type names and the 7-site sort enum are
gone; one reviews wire codec with the SQL sort map enforced by the compiler; gbp-write
gained the `notFound` override, existence-before-access ordering, contextually typed
intent callbacks and a hash-returning `verify`, so hours dropped its catch-and-rethrow.
Deviations: none beyond the ordering above.

### Sprint 4b — `d981791` locations follow the inbox pattern; server prefetch

Shipped: every location tab is a `<LocationTab>` render prop (nine copy-pasted
wrappers, drilled toast/invalidate props and per-tab caps types gone; 30+ inline
`useMutation` calls are `useResourceMutation`); administration split into six section
files with a provider; business information and photos split into focused components
with the pure Google value adapters in `lib/locations/google-values.ts`; photos page and
filters in the URL; shared `SaveBar`; `lib/domain/*-vocabulary.ts` split with the
import-graph test proving every contract client-safe; `lib/server/prefetch.ts`
hydrating inbox, home, every business/location tab page and settings; analytics
overview SQL moved to `lib/server/analytics-overview.ts`.

### Sprint 5a — `93b6a04` e2e regressions fixed; cleanup follow-ups

Shipped: the three deprecated per-area `action-errors` shims deleted and every
importer moved to `lib/errors/action-errors.ts`; `useIndustry`/`useAdministration`
lost their `enabled` option (the shell gates them); `getSession` wrapped in
`React.cache` (one lookup per server render); the location workspace scrolls its tab
pane instead of squashing the header and nav; `TODO(gbp-write)` notes in media and
place actions rewritten as design decisions. The docs pass (5.1: `docs/architecture.md`,
`docs/frontend-backend-feature-map.md`, `README.md`, this ledger) follows in the working
tree.

Deviation: server prefetch narrowed to DB-backed readers. The 4b prefetch hydrated
every tab and the inbox. End-to-end runs showed two problems: the Google-backed tabs
(hours, profile, photos, booking, menu, business information, industry,
administration) cost 3-5s per request inside the RSC render, which held first paint
and was repeated by every `<Link prefetch>`; and the inbox page, which reads
`searchParams` because its filters, queue and selection live in the URL, re-rendered on
the server for every URL change (the auto-select on load included), after which Next
moved focus to the re-rendered segment and wiped text an operator had typed into the
location filter. `prefetch.ts` now hydrates only home counts and the 30-day overview,
location capabilities and the settings role projection, and the inbox page carries no
prefetch at all with a comment saying why. The photos pages no longer read
`searchParams`.

### Sprint 5b — independent review fixes

The read-only frontend review (5.2) found two should-fix items and four notes; all
were applied:

- Inbox publish auto-advance decided its target after the pulse, by which time the
  publish mutation's list invalidation had dropped the published review out of the
  Needs reply queue (now the default), so it advanced nowhere or skipped a page. The
  target is now chosen at publish time, with a fallback to the row that shifted into
  the same index, then to the next API page.
- The posts list reconciles against Google on every read (`lib/server/posts.ts`), so
  prefetching it blocked first paint the same way the other tabs did. Location pages
  now hydrate capabilities only; `locationTabPrefetch(locationId)` has no tab
  argument.
- A query whose previous background refetch failed is retried as foreground, so
  "Try again" after a session expiry can redirect to sign-in instead of failing the
  same way forever (`lib/queries/request-options.ts`).
- Hours and menu forms remount on an external revision change again (`key`), so form
  error, dialog and mutation state reset with the draft.
- Inbox URL parsing narrows ratings to 1-5 and the three status lists to their
  vocabularies at parse time, so chips never show a value the list ignores.
- A failed capabilities query renders the retry state on every tab, not only gated
  ones; business information no longer sits with every field disabled and no reason.

Noted, not changed: the inbox default queue is now Needs reply (from the in-flight WIP
commit, a product decision); profile field-validation errors also toast.

### Sprint 5c — server review fixes

The read-only server review (5.2) found no authorization escalation, tenant-scoping
leak or constraint-violating attempt write. Its should-fix items were applied:

- `grantsFor` compared location ids as JavaScript strings while Postgres renders uuid
  keys lower-case, so a member with assignments was denied for an upper-case id the
  old SQL equality accepted. The map is now case-insensitive (unit test added).
- Requesting post approval (a local-only write) had moved behind the Google link check
  and the posts kill switch; it now runs after access and publish-right checks only,
  and Google is consulted solely on the publishing path, as on main.
- A replayed post publish reported `published` regardless of the stored attempt; it
  now re-reads the post and answers 409 `post_publish_in_progress` unless it is
  published.
- The post update/delete routes gated on the global `PUBLISH_ENABLED` only, and the
  presence analytics response hard-coded `keywordsEnabled`/`ingestionEnabled`; both
  now derive from the per-surface helpers.
- `webhookReplaySchema` validates a UUID and is imported by its route.

Decided, not reverted (documented behaviour changes): a readback failure after a
successful write settles `ambiguous` for media, posts and food menus (was `failed`);
a missing location answers 404 rather than 409 on the Google-backed modules; the
per-surface kill switches compound with the global one; a paused deploy answers 400
to malformed input before 503. Not fully reviewed: the location-level routes under
`app/api/locations/[id]`, links, members and import review (role gates and the
visibility helper were verified directly; 404/403 ordering and empty-body handling
there were not re-read).

### E2E status (5.3)

23 e2e failures pre-date the sprints: they fail identically on the baseline commit
`160131a`. Groups: `accessibility.spec` inbox/reply-editor expectations written against
the in-flight WIP; `gbp-management-tabs.spec`; journeys viewer/dirty-draft; locations
Menu heading order; photos double "Add photos" button; permission-walk duplicate gate
note; inbox dark-mode contrast and the CSP-blocked thumbnail. Zero branch-only failures
remain. One further failure appeared once in the final full run and not in the
baseline: the light-theme "delete published reply confirmation" accessibility check
reported a missing document title at the moment axe ran (the page's metadata title is
unchanged); it did not reproduce in the targeted reruns and is recorded as a flake to
re-check.

### Known follow-ups

- Settings: `useSettings` is not server-prefetched (only the role projection is).
- Posts publish and delete write no audit event (draft create and update do).
- The 23 pre-existing e2e failures above.
