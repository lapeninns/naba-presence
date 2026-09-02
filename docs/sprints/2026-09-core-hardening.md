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
