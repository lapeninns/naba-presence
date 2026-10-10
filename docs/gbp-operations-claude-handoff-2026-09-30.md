# Claude takeover: full NabaPresence GBP operations programme

Prepared on 2026-09-30 at the user's explicit request to hand implementation to
Claude. This is a continuation checkpoint, not completion or release acceptance.
The previous agent has stopped implementation. No build, lint, browser,
integration-test or standalone app process needs resuming. The owned local
PostgreSQL service remains available.

## Read first and preserve the goal

Workspace: `/Users/amankumarshrestha/LapenInns Project/platform/naba-presence`.

Read this entire handoff, then the ENTIRE original authoritative goal brief:
`/Users/amankumarshrestha/.codex/attachments/a866bbb0-f8f6-4691-8a45-78084dab8929/pasted-text-1.txt`.
Its SHA-256 at handoff is
`cb2cd0343788490442121befdc2c0dee884f0b2b15a62d7d1c379244c743d10e`.
That brief governs all WP1–WP9 / M0–M8 requirements, exclusions and release gates.
This checkpoint locates work; it does not replace or narrow the original brief.

Read current root `AGENTS.md`, `docs/gbp-operations-acceptance.md`,
`docs/google-provider-support.md`, `docs/architecture.md`,
`docs/frontend-backend-feature-map.md`, relevant `docs/runbook.md` sections,
and `docs/specs/2026-09-23-operators-desk-identity.md`.
The earlier `docs/gbp-operations-goal-handoff-2026-09-30.md` retains historical
context. Its unfinished PIN/lodging/lifecycle paragraphs are superseded by this
dated checkpoint. Inspect current source and artifacts rather than trusting
stale register table cells or summaries.

Continue implementation, verification and release acceptance autonomously within
the user's authorised scope. Do not reduce this to verification, an MVP, the
easiest findings, or already implemented packages. Mark complete only after
current evidence proves EVERY original requirement and release gate.

## Checkout and operating boundaries

Checkout: `main`, HEAD `e80c18987f5109b195cc448b5e3f5ccb3d62457e`.
Before creating this handoff, `git status --short` showed 432 entries. Preserve
ALL uncommitted and untracked programme work and unrelated changes; no reset,
clean or discard. Preserve Workers AI work, `.omo/`, `prompt-exports/` and
`supabase/.temp/`. No programme commit, push, deployment, production migration,
live Google write or customer message was performed during this takeover.

Current root AGENTS rules govern. Read relevant installed
`node_modules/next/dist/docs/` sections before Next.js API/routing/rendering/
caching/config changes. Dev uses Turbopack; keep production `pnpm build` on
webpack with `postbuild` running `scripts/prepare-standalone.mjs`. Archived July
milestone instructions and dependency/staged guidance are not programme policy.
Retain Next.js, TanStack Query, shared Zod contracts, tenant-scoped PostgreSQL,
existing environment loading and canonical Operators Desk controls.

Keep implemented, automatically verified, deployment verified and live-provider
verified evidence separate. Owned PostgreSQL and loopback Google stubs establish
local acceptance only. No eligible live cohort or designated destructive public
target is established. Do not create fake public businesses; destructive live
lifecycle checks require a specifically designated authorised target.
The original exclusions remain: billing, review-request campaigns, SMS/WhatsApp
alerts, white-label report delivery, other providers and paid Places API.
Preserve PIN/private-context/credential secrecy and exact approval boundaries.

Apply relevant programming/frontend/visual-QA guidance. The visual-QA workflow
used here requires TWO independent read-only reviewers, EACH individually
opening EVERY accepted PNG. No sampling/montage substitute. Freeze source/build
and bind all captures by hash/dimensions/timestamps. Preserve rejected artifacts;
an older candidate's approval never accepts subsequent source changes.

## Accepted combined LOCAL increment: Cjqt

Evidence: `.omo/evidence/specialist-general-services-2026-09-30/`.
Frozen build: `Cjqt2NwvqI0olT6sJL4qS`.

This bounded local candidate is accepted by BOTH fresh visual/integrity reviewers.
It includes healthcare/general Services, retail attributes/product handoff, the
corrected lifecycle interlock, and shared START/PIN/access/lodging regressions.

- `build-candidate-corrected.log`: production webpack/standalone PASS.
- `typecheck-candidate-corrected.log`, `lint-candidate.log`: PASS.
- `unit-candidate.log`: 2,849 active PASS; 772 conditional skips EXCLUDED.
- `lifecycle-regression.log`: 21 PASS; `lifecycle-regression-results/`.
- `lodging-regression.log`: 24 PASS; `lodging-regression-results/`.
- `start-regression.log`: 39 PASS; `start-regression-results/`.
- `pin-regression.log`: 57 PASS; `pin-regression-results/`.
- `access-regression.log`: 30 PASS; `access-regression-results/`.
- `services-complete-captures.log`: 15 PASS; `services-regression-results/`.

Total: 186 real-backend browser cases at 375/768/1280. Actual app routes,
sessions, permissions and database are used with loopback provider stubs.
Lost-response tests perform the actual route request before aborting its browser
response; app APIs are not fulfilled with canned fixtures.

`capture-manifest-current.json` binds 1,021 PNGs to 1,005 frozen source files in
`source-Cjqt2NwvqI0olT6sJL4qS/` plus its preserved BUILD_ID. Width counts:
375=357, 768=355, 1280=309. Root counts: lifecycle 96, START 156, PIN 176,
access 141, lodging 413, services 39. Preserve this snapshot/manifest.

Both reviewers individually opened ALL 1,021 captures and independently verified
all source/PNG hashes, dimensions, freshness, complete inventories and build binding:

- `visual-pass-a-Cjqt.md` and `visual-pass-a-Cjqt-viewed.json`.
- `visual-pass-b-Cjqt.md` and `visual-pass-b-Cjqt-viewed.json`.
- Fallbacks `.omo/evidence/specialist-general-services-gate-review.md` and
  `.omo/evidence/specialist-general-services-pass-b-gate-review.md`.

Both recommend APPROVE, with no criterion-backed blockers. Maintenance notes
cover the oversized services editor and duplicated description formatting.
The first services capture run remains in `services-regression-first-results/`;
final captures include the complete editor, retail attributes and saved index.

Historical XVT build `XVTQ8MP4x-n04yo8HO_cZ` remains REJECTED and preserved in
`.omo/evidence/lifecycle-backend-ui-2026-09-30/` (982 captures/997 source files).
Both reviewers found Add administrator enabled beneath the unresolved lifecycle
warning. It now uses shared `writeBlocked`; a new browser assertion and both
Cjqt pixel reviews prove the visible trigger disabled. Older accepted lodging
build `YBmk6sdDRgoF13gCv0jB3` and its 886 captures remain preserved.

The original EMAIL PIN smoke assertion was corrected to its semantic phase row,
`Email · Completed with Google`. Truthful product wording was retained; 57 PIN
and 39 START cases have since passed on Cjqt.

## Implemented services/lifecycle context

Healthcare reuses the typed general Services editor: freeform/structured items,
category support, descriptions and precise money. Legacy healthcare and unreviewed
general service writes return 409 `service_review_required`; active industry
reads no longer load a parallel healthcare model. Review, approval, consent and
send are separate. Lost responses retain exact intent without replay; even a
failed saved read cannot make that request sendable. A managerial tenant-scoped,
paginated database-only index retains expired outcomes outside the Google-backed
profile boundary. Retail has provider attribute coverage and a capability-driven
Google product-catalogue handoff, with no food-menu substitute. Full healthcare
attribute and live specialist acceptance remain open.

Lifecycle transfer/deletion freezes connection/generation/source/destination,
full inventories and provider identity. Independent provider postcondition and
local transfer reconciliation are separate; 0072 records reconciliation states.
Access/lifecycle share account locks and unresolved guards. Confirmed local
transfer conflicts recover without resending. Legacy lifecycle routes are guarded.
Other creation/accept-Google-update and writer paths still need the full WP2 audit.

## Immediate unfinished increment: Place Actions

Evidence: `.omo/evidence/place-actions-backend-ui-2026-09-30/`.
Latest `.next/BUILD_ID` / standalone: `NR3C5ZFhrlXWHdvECNCGJ`.
`build-reviewed-editor.log` PASSED webpack, TypeScript phase and standalone
preparation. `lint-reviewed-editor.log` PASSED full lint. No fresh browser/full
unit/independent visual acceptance or frozen NR3 capture manifest exists.
Run a separate current `pnpm typecheck`. Earlier `build-initial.log` passed
before final reader cleanup/activity/audit/editor changes.

Evidence so far:

- `backend-initial.log`: seven actual backend cases PASS on the INITIAL build,
  covering approval/no send, single create/retry dedupe, independent readback,
  unknown ACK versus confirmed creation, unresolved recovery, metadata/collection
  drift, update/delete, disconnected saved outcomes/index and intent/tenant guards.
  This does not accept final NR3 source.
- `components-initial.log`: eleven focused PASS (five metadata, four BookingTab,
  two approval/consent/lost-response component cases).
- Five more integration cases were added afterwards: current
  `place-action-reviews.test.ts` has 12 cases and has NOT run as a whole.
- Existing `place-actions.test.ts` was adapted to reviewed operations and has
  NOT been rerun. New five-case browser spec at three widths (15 cases) has NOT run.
- `migration-owned-upgrade.log`: 0073 successfully applied to main owned local
  DB, INCLUDING intent trigger. Mistaken trigger-only repeat failed because it
  already exists; retained `migration-owned-intent-guard.log`. Do not infer a
  missing trigger or blindly reapply 0073. Fresh empty replay through 0073 is open.

Current source starting points:

- `lib/server/google/place-action-metadata.ts`: listing-filtered provider metadata,
  complete pagination, known supported versus future unsupported types and observed
  empty set. Official `/v1/placeActionTypeMetadata` uses a `filter=location=...`
  query, not a location-parent path. Primary endpoint documentation was checked.
- `lib/server/google/place-actions.ts`: full link pagination now fails closed on
  malformed, duplicate, unrelated or unsupported rows/tokens. Future metadata has
  a Google handoff; future unknown link rows currently fail safely and need UX review.
- `lib/contracts/place-action-{review,observation,workflows}.ts`: exact immutable
  create/update/delete intent, target, approval, distinct ACK/confirmation/date,
  and location-bound saved-index cursor contracts.
- `lib/server/place-action-review-state.ts`, `place-action-reviews.ts`: current
  actor/grant/connection/generation/target gates, full links+metadata baseline,
  provider ownership/duplicate/no-change checks and current approval/baseline.
- `place-action-attempts.ts`, `place-action-execution.ts`: existing
  `place_action_mutation` store retained, one claimed attempt per immutable review,
  accepted/rejected/unknown ACK separate from independent collection observation,
  database-only saved reads and refresh without replay. Fresh observation requires
  exact reviewed connection/generation/target; it can read while writes are paused.
- `place-action-workflows.ts`: managerial tenant-scoped DB index, location-bound
  UUID/six-digit timestamp cursor, expired recorded outcomes retained.
- `google-account-change-lock.ts`: SAME account advisory key as access/lifecycle.
  Reciprocal unresolved checks were added to `google-administration-execution.ts`
  and `google-lifecycle-execution.ts`; rerun all relevant shared regressions.
- `supabase/migrations/0073_place_action_reviews.sql`: additive review family,
  unique review attempt/FKs/account/ACK/confirmation fields and immutable intent
  trigger matching the exact review. No attempt-store replacement.
- `app/api/locations/[id]/place-action-reviews/`: preview/index, restore/approve,
  execute/read/refresh. Legacy `/place-actions` POST and link PATCH/DELETE reject
  with 409 `place_action_review_required` before Google calls.
- `lib/server/place-actions.ts` now contains reads/cache refresh only; obsolete
  unreviewed writers and request-ID duplicate-create logic were removed.
- `lib/api/place-action-reviews.ts`, `components/locations/place-actions/`,
  `booking-tab.tsx`: prepares reviews, separate approval/consent/send, unsendable
  uncertain requests, saved work outside Google errors, provider-owned read-only
  links. `location-activity-projection.ts` projects actual Place Actions ACK and
  confirmation. Canonical `place_action.created/updated/deleted` audit is emitted
  when independent confirmation occurs; inspect event/audit idempotency coverage.
- Tests: integration `place-action-reviews.test.ts`, `place-actions.test.ts`;
  components `place-action-review.test.tsx`, `booking-tab.test.tsx`; domain
  `google-place-action-metadata.test.ts`; browser helper `place-actions-backend.ts`
  and `place-actions-backend.spec.ts`; evidence `playwright.config.ts`.

Expand before acceptance: second-manager approval and current approver/requester
revocation, policy/grant/target drift, true shared-account concurrency/reciprocal
access/lifecycle guards, pagination failures/limits, lost response/read failure,
rejection/ambiguous identity, all editable actions including preferred links,
reconnect/reload, index pagination/roles, keyboard/a11y/overflow and provider-owned/
unsupported states. Older unreviewed attempts have nullable new account IDs:
inspect whether unresolved historical attempts need account derivation/backfill.
The current guard queries explicit account IDs. These are specific unfinished
acceptance concerns, not claims that the final new source is already verified.

## Exact local setup and next commands

Owned PostgreSQL 17 cluster:
`/tmp/naba-presence-verification-workflows-01a0ed13/data`, loopback port 56153.
Main DB `nabareview_test`, runtime `naba_test_runtime`, through 0073.
Disposable LOCAL test credentials below are not production credentials.
Retained fresh database `gbp_lifecycle_empty_20260930_1412` passed full chain
through 0072. Use a new named owned DB for the 0073 full empty replay.
Do not relink the shared checkout or silently use hosted URLs from env files.

If stopped, check then start the retained cluster:

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /tmp/naba-presence-verification-workflows-01a0ed13/data -l /tmp/naba-presence-verification-workflows-01a0ed13/postgres.log start
```

Run separate typecheck and focused source tests:

```sh
pnpm typecheck
pnpm exec vitest run tests/google-place-action-metadata.test.ts tests/components/booking-tab.test.tsx tests/components/place-action-review.test.tsx
```

Real backend acceptance:

```sh
NODE_ENV=test DIRECT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:56153/nabareview_test TEST_RUNTIME_DATABASE_URL=postgres://naba_test_runtime:naba_test_runtime@127.0.0.1:56153/nabareview_test node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/place-action-reviews.test.ts tests/integration/routes/place-actions.test.ts
```

New browser matrix; keep output/logs in a NEW run directory:

```sh
NODE_ENV=test DIRECT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:56153/nabareview_test TEST_RUNTIME_DATABASE_URL=postgres://naba_test_runtime:naba_test_runtime@127.0.0.1:56153/nabareview_test node scripts/run-test-command.mjs e2e pnpm exec playwright test --config=.omo/evidence/place-actions-backend-ui-2026-09-30/playwright.config.ts --output=.omo/evidence/place-actions-backend-ui-2026-09-30/browser-first-results
```

Record logs and exit status; fix every failure. Helpers directly read
`.next/standalone/server.js`: NEVER rebuild while browser/integration/standalone
processes run. Do not typecheck concurrently with build (`.next` types regenerate).
After application edits, rebuild before capture/acceptance. NR3 has no frozen
snapshot yet: freeze it before using it or bind the eventual corrected build.
Adapt prior capture inventory tooling to the NEW Place Actions evidence directory
and complete final roots; do not overwrite accepted Cjqt/YB manifests.

Fresh empty replay uses `scripts/db-migrate.mjs` with an explicit owned loopback
`DIRECT_DATABASE_URL`; it follows existing `@next/env` loading. Keep upgrade/full
empty proof separate. No hosted migrations are established or authorised here.

After fixes, run shared backend suites and fresh START/PIN/access/lifecycle/
lodging/services browser matrices using retained evidence configs with new output
roots. Obtain TWO fresh independent complete visual passes for the final build.
Run appropriate full unit/integration/e2e/a11y/release checks, and keep the register
and architecture/feature-map/runbook/operator documentation current.

## Remaining full programme scope

Use the original brief and register to close EVERY requirement; do not invent a
percentage or treat this accepted increment as programme completion:

1. WP1: full resource/action/field catalogue and truthful unknown/unsupported/
   retired history. Discovery revision 20260929 deprecates unpopulated
   `canOperateLocalPost`; catalogue 2026-09-30.2 removes that eligibility source.
   Extract: specialist evidence `provider-discovery-check.md`. Full integration open.
2. WP2: exact intent/current actor/policy/grants/credentials/target/baseline,
   single delivery, ACK versus independent confirmation, ambiguity/recovery,
   account coordination/activity/operational events across EVERY writer family.
3. WP3: complete profile fields/set/clear/preserve, service areas, relationships,
   services, supported category attributes/hours and additional-hours handoff.
4. WP4: zero-location onboarding, complete creation/matching/stable identity/local
   linking/reconciliation, unknown identity, all verification methods, access/
   ownership/lifecycle and closure/removal handoffs. Local increment is not live proof.
5. WP5: complete lodging schema/unknown/false/exception/suggestions (bounded local
   editor accepted), full healthcare/retail/category workflows, Place Actions,
   external handoffs and live specialist acceptance.
6. WP6: durable reviewed bulk <=100 explicit frozen IDs, per-date merge, attributes/
   links, fair claims, per-location results, cancellation/partial failure/retry
   without replaying successful writes.
7. WP7: bounded one-time/daily/weekly/monthly publication, UTC+IANA timezone,
   London DST/monthly skip/24-hour missed grace/expired content, frozen approval
   invalidation/pause/edit/reschedule, durable occurrences and calendar/agenda.
8. WP8: incidents/events, recipient read != resolution, preferences/digests,
   stable email IDs, signed webhook replay/order/suppression/revocation handling
   and owner/admin operational recovery surfaces.
9. WP9: report scope/prior-period comparisons/CSV/print/freshness/coverage,
   missing != zero, and reviews/menus/photos/posts/links/provider-ownership closure.
10. M8: all CI/integration/browser/a11y, empty AND upgrade migrations, exact serving
    deployment/database revision, OAuth/API/quota/cron/worker/scheduler readiness,
    rollback drill, monitoring and designated eligible live cohort.

Merged, approved, queued, deployed, healthy and locally accepted are separate
states. None proves exact live release or real Google outcomes on its own.
The complete programme and deployment/live-provider gates remain unfinished.
