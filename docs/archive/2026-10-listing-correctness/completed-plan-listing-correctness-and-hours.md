# listing-correctness-and-hours - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** Venue operators managing Google listings get accurate status, complete venue/service hours, and trustworthy previews before publishing.

**What you'll get:** Correct menu comparisons; kitchen, bar and other available hours; useful recovery actions; honest post timestamps; clearer profile actions; navigable large menus and mobile routes.

**Why this approach:** Correct the data and comparison layers before adding controls or changing the presentation. Preserve Google identifiers and untouched data.

**What it will NOT do:** Publish real venue changes, alter Google permissions, deploy, or redesign unrelated parts of the app.

**Effort:** Large
**Risk:** High - hours and menus prepare full resource replacements for Google.
**Decisions to sanity-check:** Preserve the existing design system and save/publish model. Display only service types supported or already present for the actual listing.

Your next move: authorize execution of this plan. No implementation is included in the current request.

---

> TL;DR (machine): Large; High; 12 implementation tasks, 4 verification tasks; complete listing correctness, service hours and usability remediation.

## Scope
### Affected user and ideal state

**Affected user:** Hospitality operators use the listing overview to decide what needs attention and editors to prepare Google changes; customers depend on the resulting published hours/menu. This plan makes those decisions accurate without changing live data during tests.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Menu previews reflect actual replacements | Avoid incorrect publication or operator confusion |
| GAP-1 | Duplicate matching fabricates changes and cleared fields are omitted | Must be covered by task 1 |
| IS-2 | Conflicts and saved changes have consistent meaning | Avoid incorrect publication or operator confusion |
| GAP-2 | Unmatched items imply false concurrent conflicts and pages disagree | Must be covered by task 2 |
| IS-3 | Hours round-trip without losing service identity or end boundaries | Avoid incorrect publication or operator confusion |
| GAP-3 | Kitchen remapping and dropped closeDay/endDate lose information | Must be covered by task 3 |
| IS-4 | Every supported service schedule is visible and reviewable | Avoid incorrect publication or operator confusion |
| GAP-4 | Only regular/special controls exist; extra-hour times are absent from preview | Must be covered by task 4 |
| IS-5 | Health labels describe confirmed evidence | Avoid incorrect publication or operator confusion |
| GAP-5 | Unchecked areas coexist with In sync | Must be covered by task 5 |
| IS-6 | Listing and client failures have recoverable states | Avoid incorrect publication or operator confusion |
| GAP-6 | Initial directory failure is blank; no-client filing disappears | Must be covered by task 6 |
| IS-7 | Administration failures explain and offer the right recovery | Avoid incorrect publication or operator confusion |
| GAP-7 | Partial account-admin errors have generic refresh advice | Must be covered by task 7 |
| IS-8 | Post dates mean content changes | Avoid incorrect publication or operator confusion |
| GAP-8 | Reconciliation advances the timestamp displayed as Changed | Must be covered by task 8 |
| IS-9 | Profile actions describe exactly what they persist | Avoid incorrect publication or operator confusion |
| GAP-9 | Saved-here and direct-to-Google labels conflict with actual review flow | Must be covered by task 9 |
| IS-10 | Large menus are navigable without changing hidden data | Avoid incorrect publication or operator confusion |
| GAP-10 | 274-item form has no search or section navigation | Must be covered by task 10 |
| IS-11 | Mobile listing actions and navigation are discoverable | Avoid incorrect publication or operator confusion |
| GAP-11 | Long horizontal navigation and dense health blocks obscure tasks | Must be covered by task 11 |
| IS-12 | Completion has reproducible evidence and a controlled release boundary | Avoid incorrect publication or operator confusion |
| GAP-12 | Read-only audit does not establish save/publish/deployment correctness | Must be covered by task 12 |

### Must have
- All findings from this chat: menu duplicate/clearing/preview bugs, misleading conflict timing, unknown health, blank route errors, filing/admin recovery, post timestamps, mixed profile copy, large-menu and mobile usability, kitchen/bar/other service schedules.
- Read-only live baseline for the named Old Crown listing when authenticated access is available. Confirm what Google actually returns for bar/kitchen; do not infer provider IDs from Maps labels or assume the synthetic BAR fixture is its actual ID.
- Existing Next.js 16.2.6, TanStack Query and UI components remain. Before changing Next APIs/routing/rendering/caching/config, consult applicable node_modules/next/dist/docs sections. Build remains webpack.
- Compatibility with existing canonical JSON, drafts, hashes and revision checks. No destructive rewrite to make new comparison logic pass.
- An additive internal hours-observation record is permitted where current persistence cannot represent successful checks independently of publication. Use the existing tenant-scoped persistence conventions; no live backfill or public configuration change.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No real Google publication/deletion, customer-data mutation, permission expansion, automatic client creation, production backfill, merge or deployment under this planning authorization.
- No fresh framework, package, paid service or broad design-system replacement. No secret copying into fixtures or evidence.
- Preserve unrelated prompt-exports/ and any concurrent changes. Inspect attached worktrees before implementation; reuse a suitable one or create an isolated managed worktree and codex/ branch when execution is authorized.
- Do not present source tests as proof of Google acceptance or of production deployment. Do not weaken existing tests.

## Verification strategy
> Verification is agent-executed. Production actions require separate authorization and are not needed for local acceptance.
- Test decision: TDD for deterministic data-loss/comparison/error-state bugs; component and browser regression tests alongside UI changes.
- Use Vitest plus existing Playwright/stub bridge. Inspect scripts/run-test-command.mjs and playwright.config.ts before running integration/E2E; use disposable services, never shared production credentials.
- Evidence: .omo/evidence/listing-correctness/task-N.md and screenshots/logs. Record exact commands, exit codes, revision and fixture identity.
- Responsive matrix: desktop default, 390x844 portrait, 844x390 landscape; keyboard and accessibility; role matrix owner/admin/member/viewer where routes are gated.
- Source-backed audit findings are confirmed locally. Live account-admin failure cause and actual Google service-type IDs still need read-only diagnosis. Do not describe all 76 menu rows as verified false positives.
- Google contract reference: https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#MoreHours (supported types from category metadata, hoursTypeId and TimePeriod).
- Existing tests are references, not evidence that they currently pass. Run required checks during execution.

## Execution strategy
### Parallel execution waves
1. Correctness and recovery foundations: tasks 1, 3, 6, 7, 8, 9 in bounded parallel work; do not share file ownership.
2. Dependent editing and status: tasks 2 and 4, then 5 and 10 after their prerequisites; serialize shared review/overview files.
3. Navigation and final integration: task 11, then 12.
4. Final verification: F1-F4 after implementation evidence exists.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | None | 2,10,12 | Any ready task with no shared owned files |
| 2 | 1 | 5,10,12 | Any ready task with no shared owned files |
| 3 | None | 4,12 | Any ready task with no shared owned files |
| 4 | 3 | 5,12 | Any ready task with no shared owned files |
| 5 | 2,4 | 11,12 | Any ready task with no shared owned files |
| 6 | None | 11,12 | Any ready task with no shared owned files |
| 7 | None | 11,12 | Any ready task with no shared owned files |
| 8 | None | 12 | Any ready task with no shared owned files |
| 9 | None | 11,12 | Any ready task with no shared owned files |
| 10 | 1,2 | 11,12 | Any ready task with no shared owned files |
| 11 | 5,6,7,9,10 | 12 | Any ready task with no shared owned files |
| 12 | 1,2,3,4,5,6,7,8,9,10,11 | Final verification | Any ready task with no shared owned files |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Correct menu matching and outbound differences
  Recommended task executor category: deep-low - cross-module correctness and compatibility.
  What to do / Must NOT do: Create a dedicated outbound comparison; do not change inbound import semantics to satisfy publish tests. Exact equal menus return zero rows. Match identical duplicate occurrences deterministically before matching unique changed items; ambiguous pairs remain explicitly unresolved, never fabricated delete/add operations. Compare descriptions, prices, cleared fields, section names/order, options and other fields actually sent by whole-menu replacement. Give rows collision-free keys and field-level before/after values. Keep whole-menu publishing intact.
  Closes: GAP-1.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: lib/locations/menu-diff.ts; lib/domain/food-menu-import.ts; lib/domain/food-menus.ts; tests/food-menu-import-domain.test.ts; tests/components/menu-tab.test.tsx.
  Acceptance criteria: Identical duplicate fixtures yield zero; description edit exposes both descriptions; clearing yields an explicit removal; section/order changes cannot disappear. Ambiguous matches explain uncertainty and block publication until an accurate replacement preview can be presented.
  QA scenarios: pnpm exec vitest run tests/food-menu-import-domain.test.ts tests/components/menu-tab.test.tsx (extend these or add tests/menu-diff.test.ts). Happy: duplicate equality and price/description changes. Failure: ambiguous identity and cleared fields. Evidence: .omo/evidence/listing-correctness/task-1.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): correct menu matching and outbound differences.

- [x] 2. Make conflicts and review status truthful
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Separate removal, uncertainty, and proven concurrent conflict in the review contract. Only compare against an observed baseline to claim Google changed since editing; otherwise say the versions differ. Use the outbound diff for menu publishability and the displayed change count, keeping overview/editor/aggregate review consistent. Audit summary invalidation on save, publish, failure/readback and first resource load; preserve dirty editor state. Do not broaden shared mutation semantics without caller tests.
  Closes: GAP-2.
  Parallelization: Blocked by 1; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/editors/review-changes-sheet.tsx; components/locations/menu-tab.tsx; components/listings/review-publish.tsx; components/listings/area-frame.tsx; lib/server/location-summary.ts.
  Acceptance criteria: No-op menus show no changes in all three surfaces; real saved edits appear in overview and aggregate review; unsaved edits are clearly local. Failed/partial publication retains accurate per-step results and does not claim everything or nothing changed.
  QA scenarios: pnpm exec vitest run tests/components/menu-tab.test.tsx tests/components/listing-overview.test.tsx; pnpm test:e2e tests/e2e/listings.spec.ts. Happy: save then navigate overview/editor/changes. Failure: provider drift, partial publication and retry using stubs. Evidence: .omo/evidence/listing-correctness/task-2.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): make conflicts and review status truthful.

- [x] 3. Preserve service-hour identity and time boundaries
  Compatibility transition: use semantic canonicalization so equivalent legacy same-day objects and new explicit end-boundary objects compare equal without resetting stored publication baselines. Never rewrite historical baseline hashes as though a publish occurred. For legacy overnight information already lost, re-read Google and reconcile explicitly while preserving genuine local edits; do not silently borrow Google boundaries for a different local schedule. Reject publish requests reviewed against the old representation after the effective representation/revision changes, rather than silently translating their preconditions. Add fixtures for reconciled legacy payloads, locally edited legacy payloads, and a pre-transition reviewed publish request: no false drift, no discarded edits, stale request rejected.
  Recommended task executor category: deep-low - cross-module correctness and compatibility.
  What to do / Must NOT do: Replace kitchen-only remapping with per-entry provider identifiers. Discover supported types from category metadata using the existing Google adapter; preserve existing types even if metadata lookup fails or stops advertising them. Never map bar to kitchen or silently clear unknown schedules. Represent closing-day/date offsets losslessly in the normalized/wire model, with optional backward-compatible fields and legacy same-day defaults; explicitly mark uncertain legacy overnight data and re-read Google before preparing a replacement. Do not guess equal times mean 24 hours. Preserve special-period end dates and existing periods beyond UI creation limits. Block writes to unsupported/unrepresentable data with an explanation rather than normalize away data. Avoid destructive database backfills.
  Closes: GAP-3.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: lib/domain/hours.ts; lib/domain/hours-vocabulary.ts; lib/contracts/location-hours.ts; lib/server/hours.ts; lib/server/google; tests/hours-domain.test.ts; tests/google-contract.test.ts.
  Acceptance criteria: KITCHEN and BAR test identifiers stay distinct; supported metadata controls creation; unknown existing schedules survive a venue-only edit; overnight/Sunday rollover/24-hour and special-date round trips retain exact semantics; errors do not clear schedules.
  QA scenarios: pnpm exec vitest run tests/hours-domain.test.ts tests/google-contract.test.ts tests/components/location-api.test.tsx. Happy: mixed schedules and boundary round trips. Failure: absent category metadata, legacy ambiguous time boundaries and duplicate service identifiers. Evidence: .omo/evidence/listing-correctness/task-3.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): preserve service-hour identity and time boundaries.

- [x] 4. Add venue, kitchen, bar and service-hours editing with exact previews
  Recommended task executor category: visual-engineering - existing product UI and interaction.
  What to do / Must NOT do: Render venue hours plus every existing additional schedule, labelled with provider display names and the exact identifier as fallback. Enable adding only supported types. Reuse a weekly schedule editor for split periods, closed days and explicit next-day endings; keep dated exceptions separate and do not invent service-specific holiday support. Preview actual times by service/day, additions and removals; unify special-hour comparisons rather than relying on counts. Remove a schedule only through an explicit reviewed action. Save/restore drafts, role gates, stale revision handling and untouched schedules must work across the expanded form.
  Closes: GAP-4.
  Parallelization: Blocked by 3; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/locations/hours-editor.tsx; components/locations/hours-tab.tsx; lib/locations/hours-diff.ts; lib/editors/hours-presentation.ts; lib/locations/forms/hours.ts; tests/components/hours-editor.test.tsx; tests/components/hours-tab.test.tsx.
  Acceptance criteria: Changing kitchen 22:00 to 21:00 creates an exact before/after row; venue-only edit leaves kitchen/bar payload unchanged; all returned schedules are discoverable; same-count special-day edits are shown; unsupported types are preserved with a useful read-only explanation.
  QA scenarios: pnpm exec vitest run tests/components/hours-editor.test.tsx tests/components/hours-tab.test.tsx tests/hours-domain.test.ts; pnpm test:e2e tests/e2e/listings.spec.ts. Happy: edit/review/cancel/save/reopen multiple schedules. Failure: invalid overlaps, stale revision, missing capability and provider rejection; use stubs for publication. Evidence: .omo/evidence/listing-correctness/task-4.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): add venue, kitchen, bar and service-hours editing with exact previews.

- [x] 5. Replace false healthy states with evidence-based status
  Data ownership: include lib/server/hours.ts, lib/server/location-summary.ts, lib/contracts/location-summary.ts and an additive tenant-scoped persistence change if required. Record latest successful Google hours hash and checked time separately from the last publication baseline; record failed refresh state without advancing the success timestamp. Read that observation in the summary so opening an unmodified schedule counts as checked after navigation/reload and later observed Google changes appear as drift. Never mark a GET as a successful publication or overwrite local canonical edits. These shared files are serialized after tasks 2, 3 and 4.
  Additional integration acceptance: extend tests/integration/routes/standalone-presence-management.test.ts and tests/integration/routes/listing-summary.test.ts. Open matching unpublished hours, return to overview, reload, simulate provider drift and recheck, then simulate a failed refresh. Assert persistent checked status, detected drift, no new successful-check time on failure, and preserved local edits/publication baseline.
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Introduce explicit unchecked/partially checked status and neutral presentation. In sync requires confirmed comparison for every applicable canonical area; exclude truly unavailable areas without counting failed loads as unavailable. Retain priority for disconnected, access lost, failed, conflict and unpublished states. Show per-area observation time; stale/unreachable data must not claim current sync. Apply the same semantics to listing board, overview and client aggregates.
  Closes: GAP-5.
  Parallelization: Blocked by 2,4; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: lib/listings/health.ts; lib/listings/area-state.ts; lib/clients/health.ts; components/listings/health-strip.tsx; components/listings/listing-overview.tsx; tests/components/listing-health.test.ts; tests/clients-health.test.ts.
  Acceptance criteria: Unchecked hours can never coexist with an overall confirmed In sync label. All applicable areas checked and equal show In sync. Connection failure/stale data and publish failures outrank healthy. Shared consumers compile and agree.
  QA scenarios: pnpm exec vitest run tests/components/listing-health.test.ts tests/components/listing-area-state.test.ts tests/components/listing-overview.test.tsx tests/clients-health.test.ts. Happy: unknown to checked. Failure: one failed area, expired connection, missing summary and unavailable menu. Evidence: .omo/evidence/listing-correctness/task-5.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): replace false healthy states with evidence-based status.

- [x] 6. Recover failed listing routes and client filing
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Add visible directory error/retry states with accessible focus/status handling; use 404 only after authoritative not-found resolution. Distinguish expired session/access denial from network failures. In filing, distinguish loading/error/empty states and link no-client owners to the existing create-client flow while preserving the listing return context. Preserve existing assignment semantics and other assigned locations; do not create clients automatically.
  Closes: GAP-6.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/listings/listing-gate.tsx; components/listings/file-under-client.tsx; lib/queries/use-locations.ts; lib/queries/use-clients.ts; components/clients; tests/components/listing-overview.test.tsx.
  Acceptance criteria: Initial directory failure renders an actionable panel rather than null. Retry recovers. Missing listing gives 404; viewers do not gain management controls. No clients offers create-client navigation, and a failed clients request offers retry instead of silently disappearing.
  QA scenarios: pnpm exec vitest run tests/components/listing-overview.test.tsx tests/components/client-settings.test.tsx; add focused listing-gate/file-under-client tests. Happy: retry recovery and create-client return. Failure: 401/403/404/network and clients request failure. Evidence: .omo/evidence/listing-correctness/task-6.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): recover failed listing routes and client filing.

- [x] 7. Make administration errors actionable
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Carry safe structured subresource failure categories to the UI if missing. Add an explicit retry through the existing administration query without hiding successfully loaded listing admins. Explain permission/scope failures separately from transient Google failures; no raw provider secrets/errors. Link Team/client access and Connections instructions to verified existing routes with correct context. Do not expand permissions or change Google access.
  Closes: GAP-7.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/locations/section-panel.tsx; components/locations/administration/admins.tsx; components/locations/administration/administration-tab.tsx; lib/server/location-administration.ts; lib/queries/use-location-administration.ts; tests/components/administration-sections.test.tsx.
  Acceptance criteria: Account-admin failure has a usable next step; transient retry can recover; permission failures never promise that waiting will repair access; existing location admins remain visible. Other SectionPanel callers remain compatible.
  QA scenarios: pnpm exec vitest run tests/components/administration-sections.test.tsx. Happy: partial error then recovered read. Failure: permission denied and persistent provider error with no mutation. Evidence: .omo/evidence/listing-correctness/task-7.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): make administration errors actionable.

- [x] 8. Use content timestamps for published posts
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Expose stored provider content timestamps in the post contract. Published posts show provider update time, then provider creation time; when both are missing show date unavailable, not the latest database sync. Drafts retain local edit time. Label last checked separately only when an accurate existing observation timestamp is available; do not overload updatedAt. Keep sorting/filtering coherent with the chosen displayed timestamp and preserve status reconciliation.
  Closes: GAP-8.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: lib/server/posts.ts; lib/contracts/location-posts.ts; components/locations/posts-tab.tsx; supabase/migrations/0015_local_posts.sql; tests/posts.test.ts; tests/components/posts-tab.test.tsx.
  Acceptance criteria: Repeated identical Google reconciliation does not change the displayed content-edit date. Local draft edits still update draft timestamps. Null or malformed provider dates render safely.
  QA scenarios: pnpm exec vitest run tests/posts.test.ts tests/components/posts-tab.test.tsx; integration route local-posts tests through pnpm test:integration. Happy: provider edit versus reconciliation. Failure: missing timestamp and rejected/pending posts. Evidence: .omo/evidence/listing-correctness/task-8.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): use content timestamps for published posts.

- [x] 9. Explain mixed profile save and publish behaviour
  Recommended task executor category: visual-engineering - existing product UI and interaction.
  What to do / Must NOT do: Replace Goes straight to Google on profile fields with wording such as Published after review; explain these fields are not included in Save here. Keep immediate-action language on genuinely direct booking/photo workflows. Make Save here clearly identify which profile values it saves; retain unsaved indicators and leave protection for other edits. Show a useful reviewed-change count and per-step failure result. Preserve current persistence model rather than adding storage/migrations for all fields.
  Closes: GAP-9.
  Parallelization: Blocked by None; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/locations/profile/profile-editor.tsx; components/locations/profile/section-card.tsx; components/editors/editor-footer.tsx; lib/listings/areas.ts; tests/components/profile-editor.test.tsx.
  Acceptance criteria: Editing only address/category does not imply Save here persisted it. Mixed edits show what is saved and what still needs review. Cancel/reload/leave restore or warn correctly. A partial publish reports exactly which step failed.
  QA scenarios: pnpm exec vitest run tests/components/profile-editor.test.tsx; pnpm test:e2e tests/e2e/listings.spec.ts. Happy: canonical-only, provider-only and mixed edits. Failure: save failure, partial publication and navigation with unsaved fields. Evidence: .omo/evidence/listing-correctness/task-9.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): explain mixed profile save and publish behaviour.

- [x] 10. Make large food menus navigable
  Recommended task executor category: visual-engineering - existing product UI and interaction.
  What to do / Must NOT do: Add item/description search, collapsible sections, section navigation and a changed-items filter backed by the correct diff. Filtering must never remove hidden items from saved/published data. Retain stable item identity across search/reorder and focus validation errors by expanding/revealing their section. Display full menu totals separately from visible matches. Keep controls within the existing design system.
  Closes: GAP-10.
  Parallelization: Blocked by 1,2; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/locations/menu-editor.tsx; components/locations/menu-tab.tsx; tests/components/menu-tab.test.tsx; tests/e2e/listings.spec.ts.
  Acceptance criteria: A 33-section/274-item fixture is navigable without scrolling through every item. Search/change filters leave serialized menu unchanged. Review includes edits in collapsed/filtered sections. Keyboard focus and errors reach off-screen items.
  QA scenarios: pnpm exec vitest run tests/components/menu-tab.test.tsx; pnpm test:e2e tests/e2e/listings.spec.ts. Happy: search/edit/clear-filter/review with large fixture. Failure: no matches, duplicate names, hidden validation error and unsaved navigation. Evidence: .omo/evidence/listing-correctness/task-10.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): make large food menus navigable.

- [x] 11. Clarify overview priorities and mobile area navigation
  Recommended task executor category: visual-engineering - existing product UI and interaction.
  What to do / Must NOT do: Keep existing routes and desktop tabs. Add a labelled mobile area selector with current selection and role/capability gating; preserve URL, back/forward and dirty guards. Place concrete problems/next actions before secondary health detail; compact mobile health presentation. Make overview cards status/action focused, with meaningful Check/Edit/Review labels instead of universal Edit. Preserve profile Jump to section and distinguish Google-owned posts/photos from publications through this app. Do not redesign unrelated pages.
  Closes: GAP-11.
  Parallelization: Blocked by 5,6,7,9,10; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: components/listings/area-frame.tsx; components/listings/area-cards.tsx; components/listings/listing-overview.tsx; components/listings/health-strip.tsx; components/ui/tabs.tsx; tests/e2e/listings.spec.ts.
  Acceptance criteria: Every allowed area is discoverable at 390px without knowing to swipe tabs. 390x844, 844x390 and desktop show no clipped controls, footer overlap or trapped scrolling. Route selection follows direct URL/back/forward; keyboard focus stays logical; hidden admin routes do not gain actions.
  QA scenarios: pnpm test:e2e tests/e2e/listings.spec.ts; pnpm test:a11y. Happy: overview to each area and return at all three viewports. Failure: summary error, long venue name, restricted role and dirty editor navigation. Evidence: .omo/evidence/listing-correctness/task-11.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): clarify overview priorities and mobile area navigation.

- [x] 12. Complete integration and release-readiness evidence
  Recommended task executor category: unspecified-high - bounded multi-file implementation.
  What to do / Must NOT do: Run the repository's full required validation on isolated stub/disposable services. Reconcile every audit finding with a test/browser result. Produce a release checklist: exact commit, checks, deployment revision, authenticated route readback, rollback revision. Deployment and real Google writes are not part of plan authorization; do not publish test content to Old Crown. If later release is authorized, verify served revision and read-only real listing state independently. A sandbox Google account is required for any actual provider-write rehearsal.
  Closes: GAP-12.
  Parallelization: Blocked by 1,2,3,4,5,6,7,8,9,10,11; exclusive ownership of listed files while editing. Shared files require sequential handoff.
  References: package.json; .github/workflows/ci.yml; scripts/run-test-command.mjs; tests/e2e/listings.spec.ts; tests/integration/routes.
  Acceptance criteria: All requested findings have passing evidence or an explicit unresolved blocker; no skipped failing checks. Old Crown's source data and live Google listing remain untouched during implementation QA. Reverting the app is not represented as undoing Google writes.
  QA scenarios: pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm test:integration; pnpm test:e2e. Happy: complete matrix on fresh fixtures. Failure: stale revision/provider rejection/retry and preserved unknown service data. Record environment failures rather than claiming a pass. Evidence: .omo/evidence/listing-correctness/task-12.md plus relevant screenshots/logs.
  Commit: N during planning; after execution authorization, one verified increment, proposed subject: fix(listings): complete integration and release-readiness evidence.

## Final verification wave
> All verification findings must be resolved or reported as blockers; approval of this plan is not a deployment approval.
- [x] F1. Plan compliance audit
  Check every IS/GAP row, dependency, acceptance assertion and evidence artifact; reject omitted hours compatibility or hidden-field preview cases.
- [x] F2. Code quality review
  Review exact final diff, API compatibility, tenant/role gates, stale revisions, untouched Google fields, duplicate identities and failure handling. No grep-only approval.
- [x] F2a. Correct special closing-time field error association
  Final source review found malformed special closing times block save through the summary but do not mark the closing input invalid or show its inline error. Add a closes-only regression, correct the field association, and verify the focused component suite before final source freeze. Owner: hours_domain.
- [x] 12a. Resolve full-suite large-menu validation timeout
  Preserve the33-section274-item fixture and both repeated validation attempts. Measure the slow path and improve test execution without skipping or weakening behavior checks. Owner: menu_diff.
- [x] 12b. Align remaining health contracts and preserve SectionPanel compatibility
  Update legacy client healthy labels to the intentional In sync contract; require neutral unchecked listing health while comparisons load. Preserve the existing default ASCII apostrophe in unrelated SectionPanel consumers so their recovery assertion remains unchanged. Owner: route_recovery.
- [x] 12c. Align E2E health and area-action expectations
  Full E2E passed161cases and failed5stale-label assertions. Change only two E2E test files to require the exact current checked-client label and unchecked-hours Check action; preserve stale failure transition, accessibility, actual navigation and URL assertions. Re-run full E2E/a11y with guarded equivalence for unchanged product/unit/integration inputs.
- [x] 12d. Reveal the whole menu validation error above the footer
  Final real-browser geometry found the focused input visible but8px of its inline error under the sticky footer. Wire compact validated menu fields into the existing whole-field focus-clearance behavior. Follow-up actual-image inspection also found the landscape scroll container ends32px above the window, clipping the helper despite viewport clearance; include the existing scroll parent's client edge in the helper's lower bound. Preserve explicit before/after geometry evidence and verify all3viewports. A new build and final validation/captures are required; do not hide the defect with a manually scrolled screenshot.
- [x] F3. Real manual QA
  Exercise overview, profile, hours, booking, photos, posts, menu, people, verification, suggestions and changes via the local stub-backed browser. Include deep links/back/forward/reload, keyboard, mobile, retries and simulated publish success/failure. Live read-only check if access exists; never mutate real Google data.
- [x] F4. Ideal-state fidelity
  Map every IS row to observed behaviour and test output. Confirm zero false no-op changes, accurate before/after values and stable unknown schedules. Report deployment and actual provider-write verification as separate, unperformed stages unless later authorized.

## Commit strategy
Planning creates only .omo plan artifacts. During authorized implementation, follow actual current repo conventions, group data-contract fixes with their tests, keep every increment buildable, and do not commit unrelated files. Commit/push/PR operations follow the user's execution authorization; proposed subjects in tasks are suggestions, not actions already taken. Release only after required hosted checks/review when authorized. Rollback of application code does not undo Google changes; this plan sends none.

## Success criteria
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1 | Task 1 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-1.md |
| IS-2 | 2 | Task 2 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-2.md |
| IS-3 | 3 | Task 3 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-3.md |
| IS-4 | 4 | Task 4 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-4.md |
| IS-5 | 5 | Task 5 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-5.md |
| IS-6 | 6 | Task 6 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-6.md |
| IS-7 | 7 | Task 7 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-7.md |
| IS-8 | 8 | Task 8 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-8.md |
| IS-9 | 9 | Task 9 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-9.md |
| IS-10 | 10 | Task 10 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-10.md |
| IS-11 | 11 | Task 11 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-11.md |
| IS-12 | 12 | Task 12 happy/failure QA and final route matrix | .omo/evidence/listing-correctness/task-12.md |

Planning review: read-only Metis identified two concrete gaps: legacy hours hash transition and persistent successful-hours observations. Both were incorporated into tasks 3 and 5. High-accuracy dual review was not requested.
