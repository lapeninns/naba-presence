# Review-scope manual QA

Run date: 2026-07-30  
Target: current working tree review-scope fix, rebuilt from source

## surfaceEvidence

| Scenario | Criterion reference | Surface | Exact invocation | Verdict | Artifact refs |
| --- | --- | --- | --- | --- | --- |
| RS-01 | Location reviews must issue only location-scoped review/count reads | Browser UI: hard-loaded `/locations/<direct-location-id>/reviews` | `pnpm test:e2e tests/e2e/journeys.spec.ts` (Playwright test `verifyLocationScopedQueue`) | PASS | `build-01`, `journey-01` |
| RS-02 | Location queue refresh journeys must preserve scope | Browser UI: location reviews focus event and `Live data` refresh | Same Playwright invocation; test dispatches `window.dispatchEvent(new Event("focus"))`, then clicks `Live data`, waits for scoped `/api/reviews` responses, and asserts no unscoped GET requests | PASS | `journey-01` |
| RS-03 | Location reviews must not leak the second location’s review | Browser UI: location review list after hard load, focus refresh, and manual refresh | Same Playwright invocation; test asserts the approval-location review has count `0` in the location review list and the scoped `All reviews, 1` tab is visible | PASS | `journey-01` |
| RS-04 | Home roll-up must remain organization-wide after location-scoped queue | Browser UI: location reviews → Home | Same Playwright invocation; test clicks the exact `Home` link and asserts `Needs attention` is `2` | PASS | `journey-01` |
| RS-05 | Filtered Inbox → Home must remain organization-wide | Browser UI: Inbox location filter → Needs reply → Home, then `/inbox` | Same Playwright invocation; test applies the direct location filter, selects `Needs reply`, asserts only the direct review, then clicks `Home` and asserts `Needs attention` is `2`; finally returns to `/inbox` and asserts `Inbox` heading | PASS | `journey-01` |

## adversarialCases

| Scenario | Criterion reference | Adversarial class | Expected behavior | Verdict | Artifact refs |
| --- | --- | --- | --- | --- | --- |
| ADV-01 | Location queue must not receive an unscoped dashboard fetch | Cross-scope request contamination | A hard load and subsequent refreshes of location reviews produce no GET `/api/reviews` without `location_id` | PASS | `journey-01` |
| ADV-02 | Location queue must not display another location’s row | Cross-location data leak | The approval-location review is absent from the direct-location queue after initial load and both refresh paths | PASS | `journey-01` |
| ADV-03 | Scoped queue state must not overwrite org-wide roll-up state | Stale/cross-route state contamination | Navigating from the scoped queue to Home shows org-wide `Needs attention = 2`; the filtered Inbox route returns to the same Home roll-up | PASS | `journey-01` |
| ADV-04 | Filter and refresh interactions must remain server-scoped | Query-state/race regression | Location filter and `Needs reply` query use the direct location; focus/manual refreshes resolve 200 scoped requests and preserve the one-row queue | PASS | `journey-01` |

## artifactRefs

| ID | Kind | Description | Path |
| --- | --- | --- | --- |
| build-01 | command log | Fresh production `pnpm build`; compilation, TypeScript, route generation, and standalone preparation completed successfully. | `/Users/amankumarshrestha/LapenInns Project/NabaPresence/.omo/evidence/review-scope-build.log` |
| journey-01 | browser test log | Real Playwright browser journey with isolated seeded tenant and Google stub; includes location-scope request predicates, cross-location row assertions, focus/manual refresh assertions, Home roll-up assertions, Inbox filter assertions, and cleanup. Result: `1 passed`. | `/Users/amankumarshrestha/LapenInns Project/NabaPresence/.omo/evidence/review-scope-journey.log` |

