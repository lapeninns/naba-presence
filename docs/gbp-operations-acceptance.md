# Google Business Profile operations acceptance

Programme started 2026-09-29. The supplied "Complete Google Business Profile
Operations" brief is the scope. This register is an execution ledger, not a
release announcement. Existing functionality is not automatically accepted.

## 2026-09-30 integration branch `feat/gbp-operations-programme`

All uncommitted programme work (both Codex goals and the Claude continuation)
is committed on `feat/gbp-operations-programme` and merged with `origin/main`
at `2dc4db1` (PR #48, listing correctness). PR #48 had already added
`0058_hours_observations`, so this programme's unmerged migrations moved up
by one: `0058_management_confirmation` … `0076_bulk_listing_operations` are
now `0059_management_confirmation` … `0077_bulk_listing_operations`, with their
`schema_migration` versions updated to match. Migration names in older entries
below are historical. Any local database migrated under the old names must be
recreated before reuse.

After the merge: typecheck and lint pass; 3,109 unit/component tests pass
(830 conditional skips). The DB-backed integration suite, browser suites and
standalone build have **not** been rerun on the merged tree. Visual pass A
on `OiPiXqdondoLfQRj-umCl` is a REJECT (blockers in batches 1–4 and 6–11, listed
in `.omo/evidence/operations-programme-2026-09-30/visual-OiPi/`). That evidence
stays local and is not in the branch. None of this is deployment or
live-provider evidence.

## 2026-09-30 takeover: reviewed administration access in progress

Latest combined automatic candidate `Cjqt2NwvqI0olT6sJL4qS` passes production
webpack/standalone build, typecheck, lint, 2,849 active unit tests (772 conditional
skips excluded), and all 186 real-backend browser cases: lifecycle 21, lodging
24, START 39, PIN 57, access 30 and services/retail 15. Its complete six-root
manifest binds 1,021 PNGs to 1,005 frozen source files. Both independent visual
reviews individually inspected every PNG and recommend APPROVE, with no
criterion-backed blockers; reports and exact inventories are in the specialist
evidence directory (`visual-pass-a-Cjqt.md`, `visual-pass-b-Cjqt.md`). The preceding
XVT rejection remains historical evidence. Local database and loopback Google
stubs do not establish deployed or live-provider acceptance.

Place Actions work after the Cjqt freeze now reads exact provider action-type
metadata, and adds immutable review/approval, one claimed attempt per review,
separate acknowledgement/independent observation, database-only saved outcomes,
and shared account coordination with access/lifecycle. The editor prepares a
review rather than sending a mutation. Latest build `NR3C5ZFhrlXWHdvECNCGJ`
passes webpack/standalone and full lint. Seven backend and eleven focused cases
passed before final source changes; the expanded 12-case backend file, adapted
legacy integration, new 15-case browser matrix, complete shared regressions and
fresh visual acceptance remain open. Main owned local DB is through 0073; full
empty replay through 0073 remains open. This source is outside Cjqt acceptance.
Claude continuation is documented in `docs/gbp-operations-claude-handoff-2026-09-30.md`.
The previous agent stopped implementation at the user's handoff request. Full WP1–WP9 /
M0–M8 scope and all release/live-provider gates remain active.

M3.3 current local checkpoint: healthcare reuses the general Services editor;
parallel legacy industry reads/unsafe service writes are removed from active
paths. Twelve three-width service publication/drift/recovery cases and five
actual backend cases pass on the pre-retail `OddQw0YcYKkcYHr3uTjvG` build. Saved
outcomes remain discoverable while disconnected. Full shared-source regression,
fresh visual acceptance, supported healthcare attributes, deployment and live
cohort acceptance remain open. WP5 retail now has a capability-driven Google
product handoff in source; supported category-attribute browser coverage is
added. Place actions still require exact provider metadata and the complete
approval/recovery workflow. Evidence:
`.omo/evidence/specialist-general-services-2026-09-30/review.md`.

Latest lifecycle visual candidate `XVTQ8MP4x-n04yo8HO_cZ` remains rejected:
both independent reviewers reproduced an enabled Add administrator trigger
beneath the unresolved-write warning. The dialog's write remained blocked, but
the visible trigger contradicted the page interlock. The source now uses the
shared `writeBlocked` state, with component and browser assertions added.
Replacement build, full browser regression and fresh visual acceptance remain
required. All 171 XVT browser cases passed automatically; its 982 captures and
997 frozen source files remain preserved. Lifecycle integration passes 15
scenarios, and the separate shared backend run passes 64, including concurrent
administration/lifecycle account coordination. A fresh empty local database
replayed the complete migration chain through 0072 successfully. These are
local evidence only.

WP5 healthcare/general services is active. The parallel legacy healthcare
writer now returns `service_review_required` before provider access; eligible
healthcare listings reuse general Services, with no healthcare placeholder or
parallel industry service fetch. The first two actual backend cases passed.
The shared service editor now separates approval, consent and sending, retains
uncertain attempts, and reads their database outcome without Google access.
Two new component scenarios prove approval sends no write and failed saved
recovery cannot enable a replay; 15 focused component cases and typecheck pass.
The direct general service write now also requires a saved review. Backend
acceptance of these latest changes, full regressions, browser captures and
independent visual reviews are pending. Evidence is in
`.omo/evidence/specialist-general-services-2026-09-30/`. This does not close WP5,
WP2 or any deployment/live-provider gate; the entire WP1–WP9/M0–M8 goal remains
active.

Lodging build `YBmk6sdDRgoF13gCv0jB3` now passes all 24 lodging, 39 START,
57 PIN, 30 access and 63 integration scenarios. Both the recursive tablet-grid
and modal-inert toast interception defects are corrected in that exact build.
Its final capture manifest binds 886 PNGs (312/310/264 by width) to 417 frozen
built-source files and a preserved build identity. Later lifecycle working-tree
changes are explicitly outside that acceptance snapshot. Both independent
reviewers individually inspected all 886 captures and approved the frozen local
increment in `visual-pass-a-YB.md` and `visual-pass-b-YB.md`. The full unit rerun passes 2,836 active cases, with 759 conditional
skips excluded. Valid approval fixtures use a future relative expiry; a slow
search fixture now pastes the same search value instead of re-rendering all
lodging controls once per character. Failed runs are retained. Deployment/live
Google acceptance remains pending.

Lifecycle local checkpoint: fourteen actual backend scenarios pass in
`.omo/evidence/lifecycle-backend-ui-2026-09-30/integration-reconciliation.log`.
The saved index now checks tenant-scoped location existence in addition to
permissions. Independently confirmed transfer reconciles the local destination
binding while saved outcomes retain the exact original reviewed identities.
Migration 0072 stores local reconciliation independently; pending/conflicting
reconciliation blocks another access/lifecycle send. The full unit run passes
2,840 active cases (765 conditional skips excluded). The new desktop browser
run caught an incorrect fixture typed name; traces are preserved and the seeded
local name now drives the fixture. Lifecycle browser, shared-source regressions,
fresh independent visual reviews, deployment and live-provider gates remain open.

Newer frozen lifecycle snapshot `XVTQ8MP4x-n04yo8HO_cZ` passes all 21 lifecycle,
39 START, 57 PIN, 30 access and 24 lodging browser cases. Its manifest binds
982 captures to 997 immutable source copies; both fresh independent full visual
reviews are in progress. Fifteen lifecycle backend cases pass, including local
destination conflict recovery without resend. The full unit run passes 2,841
active cases (766 conditional skips excluded). Shared backend/account lock
regressions remain in progress. Following WP5 healthcare changes are source-only
and outside this frozen acceptance set; deployment/live-provider gates stay open.

Lifecycle work has begun separately: immutable typed transfer/deletion reviews,
approval, single-send execution, conservative independent postconditions and
database-only saved reads are implemented in source. The two legacy direct
routes failed new guards before implementation; their provider-write branches
are now retired. Migration 0071 applied to owned local PostgreSQL and the first
lifecycle webpack/standalone build and lint passed. Ten real-route lifecycle
cases are running; UI, saved-work discovery, concurrency/revocation/ambiguity
closure, local-link reconciliation and full lifecycle semantics remain open.

Latest lodging checkpoint: `GbESeq3simDH4Cw6nzlzD` passed all 24 lodging,
39 START, 57 PIN and 30 access browser cases, 63 selected integration cases,
2,835 active unit cases, lint/typecheck and webpack/standalone preparation.
Its 873 capture hashes and 417 source hashes matched. Independent visual
reviews rejected the 768px nested guest-unit layout: recursive grid subdivision
made controls unreadable. Both scoped rejection reports are retained in the
lodging evidence directory; neither claims a complete image pass. Corrected
structural width and container-based scalar columns are built as
`Tk6UuuaqRohrQuNtEZpIu`; deep nested-control smoke, fresh browser evidence and
two independent visual reviews are pending. Implemented and automated evidence
does not satisfy this open visual gate, deployment or live Google gates.

Strict immutable reviews, explicit approval/execution, account-wide serialization,
independent access observation and read-only recovery are implemented for the
five administrator/invitation actions. Legacy direct access-write bypass is
retired. Exact account acceptance needs an independent account/role read;
location invitation absence does not prove access. The UI now reads Google's
actual `accountAdmins` field, saves reviews before approval/send and restores
work through keyset pagination preserving PostgreSQL time precision.

The backend increment passed 17 domain and 23 real-route cases, including runtime
immutability, tenant isolation and two-location/account concurrency. Empty local
migration replay and additive local upgrade passed. Access UI build and 29
component cases passed. Expanded integration now passes 29 cases/five files;
full automated suite passes 2,792 with 747 conditional skips excluded from
acceptance, and current build/typecheck/full lint pass. The 30-case access
browser matrix is running. Its first complete run passed 27/30; its next run
passed 28/30 after response-aware recovery waits. The remaining two failures
checked contrast during the mobile dialog's opening fade. Waiting for computed
dialog/backdrop opacity to reach one passed both focused mobile cases; no colour
token or accessibility assertion was weakened. Failed runs are retained;
The corrected access rerun passed all 30 cases and START passed all 39. The
independent backend review then found that generic create/update allowed a
desired `PRIMARY_OWNER`, despite the UI restriction. Two route regressions failed
before the new shared guard. Previous passing runs/captures are preserved under
`*-before-primary-guard*`; current-source build, backend regression, all 126
browser scenarios and both complete image reviews must be refreshed. M1.2
remains partial, alongside WP4
location-group UI, invitation identity evidence, ownership and lifecycle work.
Evidence: `.omo/evidence/administration-access-backend-ui-2026-09-30/review.md`.
Local/provider-stub evidence is I/A only. Deployment and live provider gates
remain pending. Full original WP1–WP9 / M0–M8 scope remains active.

Guarded build `OF4xCROsjGppLVGRSZkDB` now passes all 31 backend cases,
2,809 active unit cases (749 conditional skips excluded), production
webpack/standalone build, typecheck and lint. All fresh browser matrices passed:
30 access, 39 START and 57 PIN/combined/drift/recovery cases. The final manifest
reconciles 473 PNGs against 85 immutable source hashes and this build. Both
independent reviewers individually inspected all 473 images and returned APPROVE
with no scoped blockers; each independently reproduced source/capture integrity.
Reports: `.omo/evidence/administration-access-gate-review.md` and
`visual-pass-b-final.md` in the access evidence directory. Deployment/live provider gates
remain pending; M1.2 and the complete programme remain open.

Current WP5 increment: the complete pinned-schema lodging editor is connected to
profile source, with explicit unknown/false/conditional values, all writable
groups and repeated collections, per-field Google suggestions using the actual
`{lodging,diffMask}` envelope, preserved unsupported siblings and exact update
masks. The saved-work index has tenant-scoped, microsecond-safe keyset pagination;
exact saved attempts remain readable after disconnection and review expiry.
Approval and send are separate actions with explicit consent, lost-response
recovery and an unresolved-outcome guard shared across adjacent profile controls.
Thirty-six focused domain/component cases passed. The full unit suite passed
2,832 active cases, with 751 conditional skips excluded from acceptance.
Webpack/standalone build `rk7nywd77qtvuXqGDpmi5`, lint and sequential typecheck
passed. Both new real-route saved-attempt/pagination cases passed, including
tenant isolation and disconnection. The separate-approval desktop smoke passed.
The frozen capture baseline records 417 production-source hashes. Fresh lodging,
START, PIN and access matrices and the expanded integration selection are running;
their acceptance and independent visual reviews remain pending. Initial lodging
mobile suggestion/collection failures queried the database before the reviewed
dialog appeared; the harness now waits for that observable completion barrier.
Failed evidence is retained. The disconnection browser case then found that the
profile error boundary hid saved lodging work. A dedicated regression failed
before moving the saved-work surface outside that boundary; all 37 focused
cases now pass. A new build and unit suite are running for the corrected source.
The preceding build's 39 START, 57 PIN and 63 integration cases passed and remain
historical evidence; the corrected source requires fresh capture acceptance.
No deployed or live-provider result is inferred.

## 2026-09-30 takeover: current verification increment

The full authoritative WP1-WP9 / M0-M8 programme remains active. Existing
uncommitted/untracked programme and unrelated work is preserved. Current PIN
test correction asserts the outcome's semantic verification-request phase row
ends in `Completed with Google`; truthful product copy is unchanged. Removed
one unused drift-test import. Full lint, typecheck and 55 component cases passed.
The corrected desktop EMAIL real-backend smoke passed, including independent
readback, saved restoration and transient-PIN privacy checks.

The fresh 39-case START regression passed against the existing built standalone
app and isolated loopback PostgreSQL with local Google transport stubs. The full
57-case PIN/combined/drift/recovery matrix passed at 375/768/1280 after two
harness races were fixed:
slow navigation now waits for independent confirmation as well as acceptance,
and approver revocation follows completion of the owner's saved-review restore.
The corrected second-manager mobile smoke passed. Full `pnpm test`
passed 2,749 cases; 716 conditional cases were skipped and are not acceptance.
The initial matrix's first mobile
completion cases loaded an incorrect scoped locator; those results are retained
as failed evidence. The final matrix uses the corrected relative phase locator
and observable completion barriers. `accepted-pin.log` records 57 passed in
6.6 minutes; `start-current.log` records 39 passed in 6.4 minutes. The current
capture manifest contains 332 PNGs (176 PIN, 156 START), validated by signature,
dimensions, SHA256 and production-source timestamp. Both independent visual
reviewers individually opened every accepted capture and returned PASS/APPROVE.
Six original team-approval frames exposed outer-document capture displacement.
The helper restores the outer viewport before scrolling the actual section owner;
three correction scenarios passed and replaced all 11 associated frames. Each
reviewer inspected 343 distinct PNGs including the preserved originals and every
replacement. Reports: `.omo/evidence/verification-integrity-gate-review.md` and
`visual-review-b.md` in the current evidence directory. Full screen-reader,
dark/coarse-pointer and performance acceptance is not inferred. Independent
fixture readback found zero organisations, verification reviews and attempts;
the owned loopback database remains running for continued programme validation.
Evidence is retained under
`.omo/evidence/verification-pin-backend-ui-2026-09-30/`, with `*-current.log`
and `smoke-corrected.log`. No deployment or live-provider acceptance is inferred.

The programming skill's auxiliary checker requires TypeScript 7's unstable API
and cannot run against this project's installed TypeScript 5. The project's
actual `tsc --noEmit` and ESLint passed; no dependency upgrade was introduced
for the auxiliary checker. No production source change was needed for the
known test-copy issue. The final verification typecheck used a stable completed
build. A later administration typecheck launched beside a build hit generated
`.next/types` removal; its failure log is retained, and sequential typecheck
after the completed build passed without suppressions.

## Evidence rules

Further WP1 retirement audit, 2026-09-30: two old insights transport regressions
failed before implementation because discontinued location/post insights routes
reached the provider stub. The retirement guard now denies both routes with
410 `provider_capability_retired`. The current Performance API read and legacy
Q&A answers route have explicit transport coverage. Focused transport,
capability and management tests passed 32 cases; typecheck and changed-file lint
passed. Logs: `retired-insights-{before,after,typecheck,lint}.log` in the current
PIN evidence directory. This is local source/automation evidence; a fresh build
passed in `retired-insights-build.log`; deployed enforcement remains pending.

The resource/action catalogue version `2026-09-30.1` adds optional capability
detail across current provider families. Unknown eligibility does not enable
writes; documented reads remain available to establish provider evidence.
Local owner/admin, viewer and disconnected-account projection passed six
standalone cases including the existing surface-map regression. Focused
resource/capability tests passed 35 and 21 cases in their recorded selections;
typecheck, changed-file lint and production webpack/standalone build passed.
Build `bp5KYplDOeAt7Uy8jq99Y` then passed all 39 START cases and one desktop
EMAIL PIN completion/readback smoke. Logs: `resource-catalogue-*.log` in the
current evidence directory. The earlier complete PIN/visual inventory remains
bound to build `BwBHXLRYtsiylIt8hH1ZA`; it is preserved and never relabelled as
captures of the newer catalogue build. Full dynamic field/action integration,
release deployment and live eligible-account proof remain pending.

Historical initial WP2 administration foundation checkpoint, superseded by the
current administration entry above: typed exact-target
contracts, baseline observation and immutable review/approval services are
present; execution/recovery and controls are unfinished. Twelve target/payload
domain cases and typecheck passed. Additive migration 0070 applied to the
disposable database upgraded through 0069. Empty-database replay, runtime
immutability and real-route review/execution acceptance are still pending; no
production migration or administration provider write was performed.

- I: implemented contracts, persistence, permissions, UI and recovery.
- A: task-specific automated unit, integration and browser verification.
- D: exact deployed revision, migrations, configuration and worker verification.
- L: authorised eligible account, exact approved change, independent Google
  readback and public observation where applicable.
- Pending means evidence has not yet been established; partial names what exists.
- API acknowledgement, provider readback and public appearance are separate facts.
- No live account or destructive target has been designated for this programme.
  All live rows remain pending until their prerequisite is supplied and verified.

## Workflow register

| ID | Workflow | I | A | D | L / exact prerequisite |
| --- | --- | --- | --- | --- | --- |
| M0.1 | Versioned resource/action/field support catalogue | Partial: retirement, Business Information fields, pinned lodging schema and resource/action catalogue across API families; dynamic field coverage and complete action integration pending | Field/mask and resource/action unknown/false/true, local permission/flag, manager-only, retired-method identity and read-only/handoff unit cases passed; six standalone current-role/disconnection/surface-map cases passed | Pending | Read-only provider eligibility on each business type |
| M0.2 | Retired endpoint denial and controls removal | Transport, loader, mutation guard and profile controls implemented; historical presentation audit pending | 7 transport cases, standalone loader/legacy mutation test and browser scenario passed | Pending | Deployed read-only inspection; no retired provider request permitted |
| M0.3 | Capability reasons, unknown eligibility and Google handoffs | Partial: Business Information details, service-write guard and profile eligibility explanation; remaining families pending | Unknown/false/true and permission/flag cases passed; standalone unknown/denied write cases passed | Pending | Eligible and ineligible authorised listings |
| M1.1 | Exact payload/target/baseline approval across write families | Partial: persisted lodging/service reviews, policy/actor recheck, frozen payload/mask/target/baseline and one attempt per intent; other families pending | Standalone approval/conflict/revocation and Chrome exact-review scenarios passed | Pending | Designated reversible changes and approvers |
| M1.2 | Administration readback and ambiguous-write recovery | Partial: exact access reviews/approvals, one attempt, independent confirmation, account-wide serialization, readonly recovery, typed controls and saved-work pagination; lifecycle/ownership and remaining access evidence pending | 17 domain, 29 standalone and 35 access component cases passed; three-width invite smoke passed; full browser/visual acceptance in progress | Pending | Authorised access-management targets |
| M1.3 | Industry readback and ambiguous-write recovery | Partial: lodging execution/readback states, unresolved-write guard, exact approval and read-only confirmation retry; other industry paths pending | Standalone accepted/mismatch/read failure/ambiguous response/interrupted-attempt cases passed; Chrome recovery action passed | Pending | Eligible lodging/service targets |
| M1.4 | Unified activity projection and compatible pagination | Eight attempt stores plus bulk children and scheduled occurrences projected with source IDs and cursor/page compatibility | Earlier standalone multi-source/pagination cases passed; bulk and schedule arms exercised through their integration suites; dedicated activity-arm assertion pending | Pending | Authorised tenant with each write family |
| M1.5 | Shared operational event contracts | Implemented locally: `recordOperationalEvent`, organisation target, producers for Place Actions (failed/unresolved/confirmed), schedules (missed/blocked, publication failed/unresolved) and bulk (completed with failures); other write families not yet producing events | Contract tests plus Place Actions, schedule and bulk integration assertions on incidents | Pending | Operational event test cohort |
| M2.1 | Additional phones and nested sibling preservation | Additional-phone controls and exact reviews implemented; phone updates use the required complete phoneNumbers parent, preserving primary/additional siblings | See phone contract correction and editor evidence below: focused, standalone and three-width browser cases | Pending | Approved reversible phone change |
| M2.2 | Address, clearing and partial opening dates | Partial: address components including additional postal fields, customer-only storefront removal and partial opening-date controls implemented; remaining scenario and live-eligibility closure pending | See address/opening-date sections below for domain, standalone and browser evidence | Pending | Eligible listing and approved values |
| M2.3 | Service areas and provider-validated place identifiers | Typed controls, exact review/approval, existing-ID reuse, manual IDs, preflight and readback/recovery implemented; broader service-area scenario closure pending | Domain, standalone conversion/recovery, three-width publication, keyboard initial setup, draft restoration and unsupported-data handoff passed | Pending | Genuine service-area business and valid area IDs |
| M2.4 | Structured/free-form services, descriptions and prices | Partial: typed editor, precise money, category metadata, preflight, persisted service approval and saved-review controls; recovery and edge-state closure pending | Contract, metadata, readback and approval routes passed; initial editor/publish journey passed at three viewport widths; remaining scenario coverage pending | Pending | Listing with canModifyServiceList and supported category metadata |
| M2.5 | Supported relationships and advanced writable fields | Partial: typed chain/parent/child controls, individual masks, draft/review preservation and exact confirmation/recovery; remaining advanced fields pending | Relationship unit/component tests, three standalone set/clear/recovery scenarios and ten browser scenarios passed; see dated entries | Pending | Eligible business with supported relationship |
| M2.6 | Category/region attributes and additional-hours handoff | Pending | Pending | Pending | Provider metadata and supported service-hour IDs |
| M2.7 | Account-scoped zero-location discovery and matching | Implemented locally: scoped matching, persisted drafts, account-access discovery, ownership handoff and saved-match review/approval/link execution/status/recovery UI; deployment and live acceptance pending | Contract, built standalone and focused setup browser cases; exact link execution has rollback, competing-operation and process-restart coverage; see dated entries | Pending | Authorised Google account with no linked app locations |
| M2.8 | Creation validation, frozen request identity and link recovery | Partial: validation/approval, durable execution, independent readback and local-link recovery backend; decision/review/approval/submission and recovery UI available; complete business-type details and unresolved-identity reconciliation pending | Contract, standalone approval/execution/recovery and review/recovery browser scenarios passed; see dated entries | Pending | Genuine business requiring creation, explicitly approved |
| M2.9 | Email/phone/postal/service-context verification and PIN | Typed method-specific START/PIN controls, encrypted reviews, exact approval, single-send execution, independent recovery, saved workflows, shared action guard and legacy credential cleanup implemented locally | 39 fresh START and 57 PIN/combined/drift/recovery cases passed across three widths; corrected capture matrix passed both independent visual reviews; broader accessibility/performance and release gates remain open | Pending | Unverified genuine listing with eligible method |
| M2.8a | Creation regular, special and additional service hours | Typed proposals, supported type discovery, preservation, incomplete-entry guards, frozen review and independent readback implemented locally | 64 focused unit tests, 58 standalone creation/metadata integration cases and 33 onboarding browser journeys passed; 18 final additional-hours captures inspected; see dated entries | Pending | Genuine creation target with supported category hour types; explicitly approved provider operation |
| M2.10 | External verification handoff and state refresh | Typed independent observation and Google-only/unknown-method handoffs implemented locally | Fresh START/PIN external-method, disconnected, refresh/recovery cases and independent visual reviews passed; see takeover entry | Pending | Listing offered Google-only verification method |
| M2.11 | Unlink, access removal, transfer, closure and deletion semantics | Partial: reviewed administrator removal and current last-owner/primary-owner guards implemented; unlink/transfer/closure/delete semantics remain pending | Access removal/ownership guards pass standalone tests; full lifecycle and access browser acceptance pending | Pending | Specifically designated and authorised lifecycle target |
| M3.1 | Lodging writable-schema coverage and typed controls | Complete pinned-schema editor implemented locally, including groups/lists/nested guest units and explicit read-only exclusions | Frozen YB build: 24 lodging cases and complete shared regressions pass; both independent reviewers individually approve all 886 captures, including readable nested tablet fields | Pending | Authorised eligible lodging business |
| M3.2 | Lodging unknown/false/exception values and suggestion draft | Typed distinct unknown/false/conditional values, selected real-envelope suggestions, exact frozen approvals, readback and saved recovery implemented locally | Frozen YB exact masks, sibling preservation, collections, validation, expiry/disconnection and ambiguity pass; both full visual reviews approve. Later shared lifecycle changes require fresh regression evidence | Pending | Lodging account with suitable values/suggestions |
| M3.3 | Healthcare through general services and supported attributes | Partial: general Services editor reused with explicit approval/consent and durable saved outcome/index recovery; supported attributes and final shared acceptance pending | Twelve three-width services cases and five actual backend cases pass on the pre-retail build; fresh complete regression and visual gate pending | Pending | Authorised healthcare listing with service eligibility |
| M3.4 | Retail/category attributes, place actions and product handoff | Implemented locally: capability-driven product handoff, retail attribute coverage and reviewed Place Actions (exact metadata, immutable review, separate approval/consent/send, single attempt, independent confirmation, read-only provider and future-type links, account coordination) | S9MR: 23 Place Actions backend and 210 browser cases incl. 24 Place Actions; see Place Actions evidence `review.md` | Pending | Authorised retail/general listing |
| M4.1 | Frozen selection and preview up to 100 explicit locations | Implemented locally: board selection (owner/admin, max 100), frozen ids, per-listing plan with current/proposed/mask/baseline, hidden-target refusal without disclosure | `bulk-listings.test.ts` 6 real-route cases incl. hidden/foreign/101-target refusal; bulk browser scenario ×3 widths; `.omo/evidence/operations-programme-2026-09-30/` | Pending | Authorised multi-location test cohort |
| M4.2 | Bulk regular/special/additional hours merge semantics | Implemented locally: regular replace, special by date (set/closed/clear, others preserved byte-for-byte), exact service-hours type with unsupported-type skip, overnight periods | `bulk-merge.test.ts` 6 cases; integration merge/readback case | Pending | Reviewed reversible hours changes for cohort |
| M4.3 | Bulk selected attributes and specific action links | Implemented locally: only named attributes (metadata-offered, value-validated), exact-link upsert/delete, provider-owned skip, account lock and unresolved guard for links | Unit merge cases; attribute and link paths not yet exercised end to end | Pending | Supported attributes/links for cohort |
| M4.4 | Durable children, partial results, cancel/retry and revoked access | Implemented locally: job-tick children with fair claims and leases, grant/policy recheck, baseline conflict, readback confirmation, interrupted→ambiguous, retry re-reads (no replay), cancel stops queued only, quota deferral, failure incident | Integration: partial failure + retry, conflict, revoked approver, cancel, interrupted worker, quota deferral | Pending | Controlled batch and worker restart drill |
| M5.1 | One-time and bounded daily/weekly/monthly schedules | Implemented locally: frozen template/location/zone/rule/offsets, approval by hash+revision with two-person policy, occurrences materialised once, job-tick execution | `publication-schedule.test.ts` 14 cases; `post-schedules.test.ts` 8 real-route cases incl. duplicate and concurrent ticks | Pending | Approved posts and designated locations |
| M5.2 | DST, monthly skips, grace period and expired content | Implemented locally: spring-forward to first valid time, earlier of repeated time, month-day skip, latest-within-24h publish with older missed, ended events never published late | Unit cases for 2026 London transitions; integration missed/grace and expired-event cases | Pending | Controlled due-time test batch |
| M5.3 | Approval invalidation, pause/resume/cancel/reschedule | Implemented locally: revisions cancel pending occurrences and require approval; policy/approver revocation blocks; pause/resume/cancel | Integration cases for revision, policy change, revoked approver, pause/resume/cancel | Pending | Approved schedule and authorised approvers |
| M5.4 | Durable occurrence identity and ambiguous-create recovery | Implemented locally: unique (schedule, revision, instant); one post row per occurrence reusing the publish idempotency key; ambiguous publish blocks the schedule and raises events | Integration: repeated/concurrent ticks create one Google post; ambiguous case blocks without resubmission | Pending | Approved post with recoverable provider observation |
| M5.5 | Month/week calendar, agenda and visibility filters | Implemented locally: `/calendar` month, week and agenda with client/location filters; API applies location visibility | Integration visibility case; calendar browser scenario ×3 widths (keyboard-reachable scroll region fix) | Pending | Scoped schedule test cohort |
| M6.1 | Incident events and per-recipient read state | Implemented locally (0074): location-scoped incidents, per-person read state (never resolves), manager resolve for events only, `/notifications` and unread badge | `operational-notifications.test.ts` 5 real-route cases; component and browser cases | Pending | Authorised recipients and operational events |
| M6.2 | Event/channel preferences and daily digest | Implemented locally: explicit-choice preferences with original owner/admin immediate emails preserved and digest categories opt-in; one digest per recipient per local day | Integration digest and opt-in cases; preferences component and browser cases | Pending | Explicit optional email preferences and recipients |
| M6.3 | Email idempotency, signed webhooks and delivery states | Implemented locally: stable `Idempotency-Key`, Svix-verified `/api/webhooks/email`, monotonic delivery states, replay-safe event log | Signature unit cases; integration retry-key, bad/stale signature, replay, out-of-order, bounce cases | Pending | Configured sender, webhook and authorised recipient |
| M6.4 | Access recheck, suppression, replay and callback ordering | Implemented locally: send-time membership/location/preference recheck, provider-missing suppression retained in app | Integration revoked-access and removed-member suppression; existing no-provider suppression test | Pending | Controlled recipient-access and delivery test |
| M6.5 | Owner/admin operational view and guarded retries | Implemented locally: `/settings/operations` (scheduler, sync, queued work, unresolved writes, email evidence, failed review events) with guarded email retry and existing event replay | Browser scenario ×3 widths; retry guard unit-level only | Pending | Worker/sync/delivery observations for authorised tenant |
| M7.1 | Report scope parity and prior-period comparisons | Implemented locally: Google report equal-length prior window and deltas; share links carry the same provenance | `presence-report-provenance.test.ts`; component and browser cases | Pending | Reporting-enabled locations and dated provider data |
| M7.2 | CSV parity, formula escaping and print stylesheet | Implemented locally: Google totals CSV (current and previous, missing empty), existing escaping, print styles for Reports | Existing CSV escaping tests; totals CSV component assertion; print not browser-verified | Pending | Same-scope report/export observations |
| M7.3 | Freshness, data-through, coverage and missing/threshold/zero | Implemented locally: null for missing metrics, fetched-at separate from data-through, coverage counts, honest labels | Integration and component cases; keyword thresholds pre-existing | Pending | Provider data covering these distinct outcomes |
| M7.4 | Shared report scope and revocation | Existing client-scoped shares with revocation; provenance added | Existing report-share tests; no new scope change | Pending | Designated share and revocation test |
| M7.5 | Reviews full action/state/pagination/recovery checklist | Audited 2026-09-30; PENDING-moderation notice added; remaining gaps: no separate publish confirmation, no reload guard | Existing inbox suites; new moderation unit cases | Pending | Authorised restaurant/pub and approved reply |
| M7.6 | Menus full action/state/pagination/recovery checklist | Audited; publish now pinned to the reviewed Google menu; remaining gaps: no two-person approval step, no integration suite, no narrow-width browser test | Component tests | Pending | Menu-eligible listing and approved reversible menu |
| M7.7 | Photos ownership, upload/category/delete and moderation | Audited; ownership and customer read-only present; intent-keyed uploads stop duplicate retries; remaining gaps: category/logo changes without preview, no approval step, no ambiguous-media readback | Closure integration case for intent dedupe; existing media suite | Pending | Authorised merchant media test asset |
| M7.8 | Posts full action/state/pagination/recovery checklist | Audited; fixed: incomplete pagination no longer deletes live posts, two-person policy for publishers, approval state check, readback-confirmed deletes, lost-update check, approver preview with image | Closure integration cases; posts suites; component cases | Pending | Approved post content and location |
| M7.9 | Links full action/state/pagination/recovery checklist | Audited present across all items (see M3.4) | See M3.4 | Pending | Supported action type and approved link |
| M8.1 | Full CI, empty/upgrade migrations and standalone validation | Local: empty and upgrade replay through 0076 identical (schema and grants), no-op rerun; standalone build validated by the browser matrices | `.omo/evidence/operations-programme-2026-09-30/` migration logs; CI on a release revision not run (no PR opened) | Pending | Release revision and isolated test environment |
| M8.2 | OAuth/API/quota, cron, claims and scheduler health | Pending | Pending | Pending | Deployment/operator access and staged cohort |
| M8.3 | Rollback drill, settled outcomes and monitoring | Pending | Pending | Pending | Approved staged release and operational drill |

## Current evidence

2026-09-29, local uncommitted working tree:

- Google deprecation schedule inspected live. Business Calls, healthcare
  provider attributes, insurance networks, Q&A and legacy location association
  are discontinued. Source: https://developers.google.com/my-business/content/sunset-dates
- Added seven transport regression cases. Before implementation: 7 failed,
  2 existing tests passed; retired requests reached the local provider stub.
- After the transport/loader guards: `pnpm exec vitest run
  tests/google-transport.test.ts tests/complete-gbp-management.test.ts` passed
  17 tests. `pnpm typecheck` passed at that stage.
- Historical snapshot/attempt tables are preserved. No migration or live
  Google write has been performed. No deployment evidence yet.
- After profile-control removal: focused transport/component tests passed
  13 tests; typecheck and ESLint for changed files passed. Webpack build and
  standalone preparation passed.
- Disposable PostgreSQL 17 on loopback: existing migrations applied from an
  empty database, runtime role created. No new migration in this increment.
- Standalone route suite passed 2 tests, including retired industry reads
  and both legacy mutation operations returning 410 with zero extra provider
  calls and no mutation attempts created.
- Real Chrome standalone browser suite `gbp-management-tabs.spec.ts` passed
  3 tests, including omission of retired controls with old response data.
  These focused checks are not the full M8 release suite.

Further M0 implementation:

- Added `lib/domain/google-capabilities.ts` and the maintained
  [provider support reference](google-provider-support.md). Business Information
  now returns optional field-level capability details and observation time.
- Missing/non-boolean service eligibility stays unknown, explicit false is
  ineligible, and true is eligible. Validation availability is distinct from
  confirmed write eligibility. Service writes use the catalogue's metadata flag
  after re-reading the provider baseline.
- Focused catalogue/client/flag tests passed 22 cases. Catalogue, profile UI and
  transport tests passed 29 cases after adding the unknown-eligibility notice.
- Standalone suite passed 4 cases including missing/denied service metadata,
  both returning 409 before mutation attempts or provider writes.
- Retired activity records now receive a historical explanation while retaining
  their original outcome. The final standalone suite passed 4 tests including
  an inserted historical record returned with its original succeeded status.
- Final Chrome standalone suite passed 3 tests, including the profile's unknown
  service-eligibility explanation. Final webpack build/standalone preparation
  and full ESLint passed. `pnpm test`: 2,309 passed, 362 skipped; skipped suites
  are not acceptance evidence. Full release integration/e2e/a11y remain pending.
- Feature map no longer promises retired Business Calls, provider-attribute or
  insurance-network development. Remaining catalogue and workflow gaps stay open.

## Next work and boundaries

Lodging confirmation increment, 2026-09-29:

- Added additive migration `0058_management_confirmation`; existing attempts
  keep `unrecorded` evidence states. The migration passed against an empty local
  database and the preceding schema. Runtime permissions were exercised using
  the existing runtime role; all test targets were disposable loopback databases.
- Lodging records execution separately from confirmation and uses an independent
  Google GET before reporting success. The mutation response and readback occupy
  separate columns; only observed data is cached as a provider snapshot.
- An unresolved attempt blocks further lodging writes. Activity offers a
  read-only confirmation retry, including attempts interrupted more than five
  minutes ago. Recovery checks the original provider target, serialises against
  competing work and records its outcome in audit history. No force-resubmit or
  automatic worker retry was added.
- Final webpack build/standalone preparation, full ESLint and TypeScript passed.
  `pnpm test`: 2,343 passed, 368 skipped. Full release integration/e2e/a11y remain
  pending; default-suite skips are not acceptance evidence.
- The rebuilt standalone suite passed 10 tests, including accepted/confirmed,
  accepted/mismatched, accepted/read-denied, ambiguous-response/confirmed and
  interrupted-request recovery. A runtime pool of one connection demonstrated
  that the dedicated recovery lock does not deadlock tenant operations.
- Chrome passed 4 scenarios after fixing a missing unrelated profile API fixture.
  The activity scenario observed one confirmation POST and zero mutation PATCH
  requests. Its screenshot was inspected for readable outcome presentation.
- No deployment or live Google write. Exact approval binding, remaining write
  families, shared operational events and the rest of the programme remain open.

Lodging schema increment, 2026-09-29:

- Pinned Google Lodging v1 discovery revision `20260928` and added shared typed
  Zod payload validation plus writable mask classification. The route rejects
  unknown fields, read-only aggregates, identity overrides, malformed values,
  wildcard masks and masks inside repeated items. Required repeated-entry
  identifiers and unique guest-unit codes are checked.
- Schema preservation covers every writable field in the pinned discovery
  fixture, including provider exception enums. It proves contract coverage,
  not editor coverage or Google acceptance.
- Five focused unit/component/client-safety files passed 85 tests. Typecheck,
  changed-file ESLint, webpack build and standalone preparation passed.
- The rebuilt standalone app passed 5 integration tests against disposable
  loopback PostgreSQL and the Google stub. Four invalid lodging requests
  returned `400 invalid_request`, made zero provider calls and created zero
  management attempts. Existing retirement and service-eligibility checks
  remained green.
- No new migration or live-provider write. Full release checks, complete
  lodging controls, approval, required metadata handling and independent
  confirmation remain pending.

Lodging exact-approval increment, 2026-09-29:

- Added `0059_gbp_change_sets`: immutable reviewed payload/mask/baseline and
  provider target, current-policy binding, initiating/approving users, 24-hour
  approval expiry and 180-day retention. Runtime content updates are denied.
- The editor saves and displays an exact field diff, including the required
  assertion timestamp. Saved reviews can be reopened; a second authorised
  approver is required when configured. Editing requires another review.
- Publication rechecks access, policy, target and Google baseline under the
  resource lock. A unique change-set attempt prevents replay. Independent
  confirmation remains distinct from the mutation response.
- Standalone integration: 12 management scenarios and 4 retention scenarios
  passed. Added approval rejection, changed payload/mask/baseline/policy,
  second-person enforcement, approver revocation and runtime immutability.
  Retention was rerun with an expired change-set fixture: all 4 tests passed.
- Chrome: all 5 management scenarios passed. The exact-review scenario proved
  no write before approval and preservation of a sibling amenity. The captured
  review screenshot was inspected; both changed values and assertion timestamp
  are readable. An initial missing eligibility fixture was corrected.
- TypeScript, full ESLint, webpack build and standalone preparation passed.
  Default suite: 2,369 passed, 371 skipped. Concurrent Workers AI changes are
  included in these checkout-wide checks and are not this programme's work.
  Shared build replacement initially prevented test startup; the successful
  reruns above exercised the completed standalone build.
- Migration applied from empty and to the preceding local schema. All databases
  and Google responses were disposable fixtures. No deployment or live-provider
  acceptance is claimed. Full release integration/e2e/a11y remains pending.
- Exact approval for other write families, full lodging controls, shared events
  and the remaining programme milestones are still open.

Shared event contract increment, 2026-09-29:

- Added client-safe operational-event contracts for publication failure,
  unresolved/confirmed outcomes, schedule missed/blocked, bulk failures,
  verification, suggestions and resource stale/recovered observations.
- Strict payloads exclude raw provider bodies and verification PINs. Incident
  subject identities retain tenant, target and source family and remain stable
  for confirmation/recovery. New email categories require explicit preference.
- Five focused tests, TypeScript and changed-file ESLint passed. This is a
  contract foundation only: existing incidents/deliveries still need the
  additive schema, producers, recipient access checks and preference wiring.

Unified activity increment, 2026-09-29:

- Projected all eight existing attempt stores: management, hours, profile,
  menus, links, media, posts and review replies. Stable source-prefixed IDs
  preserve the underlying source ID for guarded recovery. No store migration.
- Added location-bound timestamp/ID cursors with full PostgreSQL microsecond
  precision. The UI uses cursors; page/pageSize and older response fallback
  remain supported. Current access and tenant-scoped existence are checked.
- Standalone integration passed 14 cases (12 prior management plus 2 new
  activity scenarios). New cases seed every source, including colliding UUIDs
  and timestamps; verify page parity, insert stability, microsecond boundaries,
  malformed/cross-location cursors, foreign tenants and restricted members.
- Chrome passed all 6 management scenarios against the final standalone build.
  Activity pagination and lodging recovery with source-prefixed IDs passed.
  The timeline screenshot was inspected for readable family/status presentation.
- TypeScript, full lint, webpack build/standalone preparation and diff check
  passed. Default suite: 2,375 passed, 373 skipped. Skipped tests are not evidence.
- Historical success does not become independent confirmation; missing review
  attempt actors stay null. Bulk and scheduled sources remain pending their
  implementation. Full release checks, deployment and live acceptance remain
  pending. All database targets were disposable local fixtures.

Service contract increment, 2026-09-29:

- Replaced arbitrary service-item mutation records with mutually exclusive
  structured/free-form variants, typed descriptions/labels and precise Money
  validation. Explicit zero and absent optional values retain their meaning;
  unknown fields fail instead of silently disappearing.
- Verified Business Information discovery revision `20260928` against the REST
  reference. Recorded the guide-example discrepancy (`categoryId`/`isOffered`)
  in the provider-support document; writes follow discovery's `category` shape.
- Focused contract/management/capability suite passed 40 cases. The rebuilt
  standalone management suite passed 13 cases, including four invalid service
  bodies rejected before any provider call or mutation attempt.
- TypeScript, changed-file lint, webpack/standalone build and diff check passed.
  Default suite: 2,396 passed, 374 skipped. No UI changed in this increment;
  no new browser or live-provider acceptance is claimed.
- General services controls, category metadata, whole-list preservation during
  editing, exact service approval and healthcare reuse remain open. The local
  payload contract does not prove provider eligibility or acceptance.

Service metadata increment, 2026-09-29:

- Added location-scoped category service metadata using Google's FULL category
  response. Reads and writes distinguish unknown service eligibility from an
  explicit provider denial. Missing category metadata blocks changed services.
- New or changed structured services must belong to the selected categories;
  free-form services must reference a selected category. Unchanged legacy items
  survive additions, unless categories are also changing and require fresh
  validation of the entire proposed list.
- Focused contract/management suite passed 45 cases. The rebuilt standalone
  management suite passed all 14 cases, including unsupported-service rejection
  before a mutation attempt, incomplete metadata, eligibility reasons, and a
  successful priced-service addition preserving an existing legacy service with
  independent provider readback. Google calls used the isolated stub only.
- TypeScript, full ESLint, final webpack/standalone build and diff check passed.
  Default suite: 2,398 passed, 375 skipped. No UI changed; browser and live-provider
  acceptance for the services editor remain pending.
- Structured editing controls, persisted exact services approval, healthcare
  reuse and deployment evidence remain open. This increment establishes the
  metadata and publication preflight boundary only.

Service clearing confirmation increment, 2026-09-29:

- Replaced subset matching for service readback with complete typed-item
  comparison. Retained descriptions or prices cannot confirm a requested clear.
  Provider ordering may differ; duplicate counts and item contents must match.
  Unrecognised fields remain unconfirmed rather than being silently discarded.
- Focused tests passed 47 cases. The rebuilt standalone suite passed all 14
  cases, including a provider that accepts the mutation but retains the removed
  price: publication returns `business_information_readback_mismatch`.
- Changed-file ESLint, webpack build including TypeScript, standalone
  preparation and diff check passed. Migrations applied to an empty disposable
  PostgreSQL database for the route tests. This does not close upgrade, release,
  services editor, exact approval or live-provider acceptance requirements.

Service approval increment, 2026-09-29:

- Migration `0060_business_information_change_sets` extends the existing
  immutable change-set store to Business Information. Resource-scoped lookup
  prevents cross-family approval use and keeps lodging review lists isolated.
- Business Information PUT persists the exact payload, mask, target, baseline
  and approval policy; POST approves that review. Services PATCH now requires
  the saved approval. Execution checks current actors, policy and content,
  serialises approved attempts per location, and links the attempt to the review.
  Repeating the same approved intent returns its existing attempt without
  resubmitting to Google.
- Rebuilt standalone suite: 15 passed. Coverage includes unapproved and altered
  service payload rejection, cross-family rejection, successful reviewed write,
  repeat submission, retained-price mismatch, second-person approval and revoked
  approver rejection. Existing lodging approval scenarios remain passing.
- Default suite: 2,400 passed, 376 skipped. TypeScript, changed-file ESLint,
  webpack/standalone build and diff check passed. The additive migration applied
  to an empty disposable database. Production-compatible upgrade verification
  remains part of the release gate.
- Services editor, saved-review reopening, confirmation recovery UI and live
  acceptance remain pending. Other legacy Business Information and attribute
  writes still require migration to the persisted approval boundary; this is
  not completion of M1 or the full profile workflow.

Saved service review retrieval increment, 2026-09-29:

- Added a typed client and manager-only GET for persisted Business Information
  reviews. An authorised second approver receives the exact saved review without
  Google requests. The bounded list excludes expired and already-attempted
  reviews; retrieval neither renews approval nor replaces execution checks.
- Rebuilt standalone suite: 15 passed, including exact review reopening,
  cross-tenant rejection, member-role rejection despite publishing permission,
  revoked-session rejection, expiry and removal after an execution attempt.
- Final webpack/standalone build including TypeScript, changed-file lint and
  diff checks passed. The UI for reopening and editing services remains pending;
  this evidence covers the real standalone API surface only.

Service editor increment, 2026-09-29:

- Profile Services now provides structured metadata choices, custom services,
  descriptions and exact decimal prices. Existing identifiers, sibling items,
  language and absent price values survive edits. Explicit price clearing is
  shown in the persisted review before approval and publication.
- Saved service reviews can be opened from the section. The profile footer
  tracks service drafts, opens their separate review and discards them through
  the existing confirmation. Parent edit permissions also disable service
  controls and saved-review retrieval, even if the business response alone
  reports publishing access.
- Focused component/contract/draft tests: 45 passed. ESLint and the production
  webpack build, TypeScript and standalone preparation passed. Built-app Chrome
  management suite: 12 passed, including the service edit/clear/review/publish
  flow at 375, 768 and 1280 pixels. Browser API fixtures assert the exact frozen
  payload and preserved sibling; these browser tests do not call live Google.
- Inspected nine viewport screenshots in `test-results`: service section top,
  section bottom and review at each width. Inputs and review content remained
  readable, and the footer showed unsaved service edits rather than claiming
  all values matched Google. This is scoped visual evidence, not a full
  accessibility or all-state acceptance verdict.
- Added saved-review fixture browser cases for another approver, stale rejection
  and an unconfirmed attempt. Each asserts the exact frozen payload and preserves
  a different local draft. Initial test failures exposed incomplete request/error
  fixtures; fixtures now match the API envelope and the full suite passes.
- Remaining service acceptance includes broader recovery/error states,
  full keyboard journeys and authorised live-provider evidence. The
  broader M1 and M2 milestones remain incomplete.

Service clearing and draft recovery increment, 2026-09-29:

- Added explicit description removal for structured and free-form services,
  preserving identifiers, language and price. Review distinguishes an absent
  description from an explicitly empty description. Clearing does not mutate
  the original provider item.
- Service stashes are shape-validated before restoration is offered. Malformed
  data and unknown provider fields are rejected; unfinished names, prices and
  descriptions remain recoverable and are validated again before preview.
  Other editors retain their existing stash behaviour.
- Focused domain/draft/component/hook tests: 57 passed. Typecheck, ESLint,
  webpack/standalone build and diff checks passed. All migrations applied to
  another empty disposable PostgreSQL database for the browser harness.
- Standalone Chrome management suite: 12 passed. The mobile fixture restores a
  saved draft using the keyboard, clears its description using the keyboard and
  verifies the exact removal in review/publication. Axe reports zero violations
  in the Services section and review dialog at 375, 768 and 1280 pixels. Six
  refreshed editor/review screenshots were inspected. This does not establish
  full keyboard-only navigation, every error state or live provider acceptance.

Approved service confirmation recovery increment, 2026-09-29:

- Approved Business Information writes now use the shared execution/confirmation
  recorder with service-specific exact comparison. Accepted-but-different
  readback remains ambiguous/unresolved. A lost mutation response can still
  become confirmed from an independent GET while execution remains unknown.
- Added manager-only confirmation POST and activity control for approved profile
  attempts. The route rechecks tenant/access and Google target, shares the
  publication advisory lock, reads the stored payload and performs no PATCH.
  Original acknowledgement and independent observation remain separate.
  Confirmation retries return the already-confirmed state without another GET.
- Default suite: 2,414 passed, 376 skipped. Standalone management/activity
  integration: 17 passed, including retained-price mismatch, unresolved retry,
  cross-tenant recovery rejection, later confirmation, repeated confirmation,
  original-acknowledgement preservation and a lost-response single-write case.
  Chrome management suite: 13 passed, including the new service activity action
  with zero mutation resubmissions. Its confirmation screenshot was inspected.
  ESLint, TypeScript/webpack/standalone build and diff checks passed.
- This does not migrate legacy unapproved profile writes, attributes or other
  write families to the full approval/confirmation model. Service-specific
  interrupted-attempt, target-relink, read-failure and revoked-manager recovery
  scenarios still need explicit route coverage. Deployment and live acceptance
  remain pending.

Recovery boundaries and phone preservation increment, 2026-09-29:

- Standalone service recovery explicitly covers a recent interrupted request
  (409), an old attempt with a different Google target (409), denied readback
  (unresolved), later readback (confirmed), manager demotion (403) and membership
  removal (401). Only the two permitted readbacks reach Google; no mutation is
  sent. Revocation setup retains another owner, respecting the last-owner rule.
- Superseded phone-mask claim (see correction below): core profile publishing selected `phoneNumbers.primaryPhone` and
  `profile.description` rather than replacing the parent objects. The transport
  derives its input type from the request contract. Field-mask semantics follow
  Google's [locations.patch reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch),
  checked 2026-09-29. Authorised Google acceptance remains pending.
- Domain/transport tests: 18 passed. Default suite: 2,415 passed, 377 skipped.
  Production webpack/TypeScript/standalone build and ESLint passed. Standalone
  management run: 15 passed plus one final revision assertion corrected for the
  newly added clear-phone save; the affected journey passed on rerun. Both
  primary-phone set and clear preserve two additional numbers in the mask-aware
  Google stub. Diff checks passed.
- This verifies preservation in the existing primary-phone path; it does not
  complete additional-phone controls, profile approval migration, broader
  nested-field editing or deployment/live acceptance.

Opening-date contract and status preservation increment (2026-09-29):

- Google's OpenInfo contract requires year and month, with day optional. The
  shared payload schema now rejects year-only dates, invalid calendar days and
  unknown date properties, accepts an omitted day or Google's explicit zero
  day, and preserves that precision. Local future validation uses the UTC
  calendar date with a one-year limit; partial dates compare year/month only.
  Provider validation remains authoritative. Reference checked:
  https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#OpenInfo
- Existing open-status editing now sends `openInfo.status`, preserving opening
  dates and unknown sibling fields. Both approved and legacy readback paths
  compare the selected status rather than looking for a dotted top-level key.
  Legacy `openInfo` requests remain compatible.
- Regression-first date checks exposed 10 failures before the fix. Focused
  contract/draft/editor tests: 46 passed. Default suite: 2,434 passed and 378
  skipped. Typecheck, changed-file ESLint, production webpack/standalone build
  and diff checks passed.
- A dedicated built-standalone test against disposable PostgreSQL and the
  Google stub passed: changing status retains a partial opening date and
  provider siblings; a later status readback mismatch returns 502 rather than
  success. Harness setup and response-envelope assertions were corrected
  before the passing run. No real Google listing was contacted.
- Opening-date controls, explicit set/clear review, approval migration for
  legacy profile fields, deployment and live-provider acceptance remain open.

Opening-date editor increment (2026-09-29):

- The existing profile editor now provides month/year and optional-day inputs,
  an explicit clear action, inline calendar validation and field-level review
  labels. Unchanged dates remain untouched; set/clear uses only
  `openInfo.openingDate`, preserving status and provider siblings.
- Readback distinguishes a retained full date from a requested partial date or
  clear. Omitted and zero days compare equally as unknown; no first-of-month
  value is manufactured. The existing legacy publication workflow remains in
  use; persisted approval migration and shared ambiguous-write recovery for
  these profile fields remain required before programme acceptance.
- Restored listing drafts are shape-validated, including the date inputs.
  Legacy saved drafts without opening dates remain compatible. A date-only
  edit marks the section changed without falsely marking open status changed.
- Default tests: 2,436 passed, 379 skipped. Production webpack/TypeScript and
  standalone build, full ESLint and diff checks passed. Two standalone route
  scenarios passed against disposable PostgreSQL and Google fixtures, covering
  status/date sibling preservation, partial-date set, rejected retained-date
  clear and confirmed clear. No live provider was contacted.
- Browser scenarios passed at 375px and 1280px: invalid date blocks review,
  partial-date review retains precision, and clearing reviews as Not set.
  Axe reported zero violations within the opening-state section. Screenshots
  are under `test-results/gbp-management-tabs-Openin-*/opening-date*.png`.
  This is scoped browser evidence, not a full accessibility or live claim.
- Deployment, authorised live-provider acceptance, persisted approval and
  process-interruption recovery for opening-date writes remain open.

Shared publish-flow confirmation increment (2026-09-29):

- The multi-step publish flow now inspects returned management-attempt
  envelopes. A non-success status or explicit pending/unresolved confirmation
  stops subsequent steps and suppresses the success callback/toast. Legacy
  succeeded results without confirmation evidence retain their existing
  behaviour; this change does not manufacture confirmation for those writers.
- Review shows Not confirmed, directs the operator to Activity and disables
  immediate resubmission of that unresolved sequence. Later steps are labelled
  not sent because an earlier step needs confirmation. No-op steps no longer
  produce copy claiming earlier changes went through.
- Regression-first tests reproduced two false-success cases. Focused hook and
  profile tests: 22 passed. Default suite: 2,441 passed, 379 skipped. Production
  webpack/TypeScript/standalone build and full ESLint passed. Two browser cases
  at 375px/1280px proved an HTTP 200 ambiguous opening-date attempt remains in
  review, displays Not confirmed and sends exactly one PATCH. Final copy
  corrections received focused component, TypeScript and lint checks.
- Screenshot: `test-results/gbp-management-tabs-Openin-f5c07-eview-and-clearing-at-375px/opening-date-unresolved-375.png`
  (captured before the final no-op wording correction).
- This closes a client false-success path. It does not complete persisted
  approval for legacy profile fields, server-side prevention of resubmission
  after a fresh review, or independent confirmation for writers that discard
  their result before returning to the shared flow. Those remain active work.

Business Information profile approval migration (2026-09-29):

- The profile editor persists its Business Information review before opening
  the review sheet. Publication approves and submits the frozen payload,
  update mask, change-set identity and original Google baseline. Draft/baseline
  fingerprints prevent publishing an obsolete open review. These steps run
  before core-profile writes so their approved baseline is not silently replaced
  after another write in the sequence.
- Every Business Information location-update PATCH now requires a persisted
  approval. Missing approval returns 409 before provider mutation. All internal
  callers have migrated. The existing guarded execution path supplies the
  one-attempt binding, permission/policy checks, independent confirmation and
  Activity recovery for these writes.
- Saved profile reviews expose store-code, label, category, address, open-status
  and opening-date changes to an authorised second manager. Publishing a saved
  review preserves an unrelated local draft. The original requester remains
  blocked where two-person policy requires someone else. Publishing restrictions
  continue to apply to the saved-review surface.
- Verification: default suite 2,443 passed / 379 skipped; two standalone
  integration files 18 passed; management browser suite 16 passed; production
  webpack/TypeScript/standalone build passed. An obsolete hook dependency was
  removed after lint flagged it; changed-file ESLint and diff checks passed.
  Saved-review component tests cover both approver states. Browser evidence
  includes frozen partial-date publication while retaining another local date
  draft. Opening-date integration proves unresolved clearing recovers by readback
  with exactly two total writes for the set and clear operations.
- Screenshot: `test-results/gbp-management-tabs-Saved--ef486-e-another-draft-is-retained/saved-opening-date-review.png`.
- Core-profile/canonical and attribute approval migration remains open, as do
  full nested-field semantics, all-family interrupted-write recovery, mixed-flow
  conflict acceptance, deployment and authorised live-provider checks. This
  increment does not complete M1 or M2.

### Attribute comparison correction (29 September 2026)

- Attribute readback now compares the selected mask against the requested answers.
  A masked attribute omitted from the request is confirmed cleared only when it
  is absent from readback; retained false values are not absence. Unrelated
  attributes and provider output metadata do not affect comparison. Duplicate
  evidence and malformed readback cannot confirm a change.
- A mismatch records an ambiguous attempt and returns
  `google_confirmation_required`, preventing the shared review flow from
  presenting success or offering immediate retry.
- ENUM controls send `values`, matching Google's Attribute contract. Boolean
  review text distinguishes absent, true and false.
- Focused domain/component verification: 34 tests passed across four files.
  This increment has not yet received standalone/browser verification.
- Persisted attribute approval, metadata validation at execution, explicit
  confirmation-state migration and GET-only attribute recovery remain open.
  This correction does not complete the attribute workflow or M1/M2.
- Provider references: [Attribute representation](https://developers.google.com/my-business/reference/businessinformation/rest/v1/Attributes)
  and [attribute mask deletion semantics](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/updateAttributes).

### Attribute execution and confirmation persistence (29 September 2026)

- Attribute publishing now uses the shared execution/readback pipeline. The
  mutation acknowledgement and independently observed attribute values are
  persisted separately, with execution and confirmation states.
- The previous increment's mismatch HTTP error is superseded by a mutation
  envelope with `status: ambiguous` and `confirmationState: unresolved`. The
  shared publish flow blocks success and immediate retry for that envelope.
- A provider server error after application is followed by independent GET
  readback. Matching state can establish confirmation while execution remains
  unknown; the mutation is not resent.
- Built standalone verification passed all three new attribute cases: retained
  false answer during clear, confirmed clear, and applied clear with lost
  mutation response. Each proves one mutation request and reads back persisted
  execution state, confirmation state, observed response and mismatch code.
- Verification: webpack build including TypeScript/standalone preparation;
  changed-file ESLint; 18 focused domain/publish-flow tests; 3 standalone tests
  against fresh isolated PostgreSQL migrated through 0060.
- Attribute approval, metadata validation, guarded GET-only recovery from
  Activity, unresolved-attempt blocking and browser acceptance remain open.
  Deployment and eligible live-account acceptance remain unverified.

### Attribute readback recovery and unresolved-write guard (29 September 2026)

- Activity exposes confirmation checks for attribute attempts. Recovery uses
  the saved payload/mask, checks current location permissions and the original
  account/resource target, and performs GET readback only. Interrupted attempts
  become eligible after five minutes; ambiguous attempts are eligible immediately.
- Attribute execution and recovery share an advisory lock. New writes are
  blocked while an earlier attribute attempt remains unresolved. Successful
  repeated confirmation requests return the recorded confirmed outcome.
- Standalone verification: 5 cases passed across attribute and opening-state
  suites, including cross-tenant denial, blocked duplicate writing, retained
  values staying unresolved, later successful readback and idempotent checks.
  Recovery leaves the original mutation count at one.
- Browser verification: all 3 Activity confirmation cases passed (lodging,
  profile and attributes), asserting one confirmation request and zero PATCH
  requests. The attribute screenshot was visually inspected.
- Webpack build/TypeScript/standalone preparation, changed-file lint, 21 focused
  tests and diff checks passed. Persisted attribute approval, metadata validation,
  further interrupted-write/permission-revocation scenarios and live acceptance
  remain open; this is not completion of M1 or M2.

### Attribute write-shape validation (29 September 2026)

- Attribute PATCH contracts reject malformed/duplicate resource masks, duplicate
  attribute entries, supplied values outside the mask, mixed representations,
  empty answer objects, non-scalar scalar answers, duplicate repeated-enum
  answers and contradictory selected/unselected values. Masked omissions remain
  valid explicit clears. Provider read models remain permissive for preservation.
- The URL control removes a cleared attribute rather than emitting an empty URI
  list. Profile publishing parses outgoing answers through the write schema.
- Default suite: 2471 passed, 382 skipped. After the profile-editor type-boundary
  correction, 42 focused editor/attribute tests and TypeScript passed. Changed
  files passed ESLint. This increment has not received a new standalone build or
  browser run; earlier recovery evidence does not cover this contract change.
- Category/region metadata eligibility, persisted attribute approval and full
  specialist/advanced-field coverage remain incomplete.

### Current attribute metadata gate (29 September 2026)

- Profile reads and attribute execution now load all metadata pages for Google's
  location-scoped `parent`, which applies the location's primary category and
  country. Incomplete/looping pagination fails explicitly. The loader preserves
  metadata fields and parses row identities instead of asserting their type.
- Immediately before starting an attribute write, the server checks current
  metadata: missing/duplicate/deprecated definitions, wrong value types,
  unsupported enum answers (including unset answers), and disallowed URL
  multiplicity block publication. Clearing still requires a current definition;
  recovery reads previously attempted values without reapplying eligibility.
- Official source: [attributes.list and AttributeMetadata](https://developers.google.com/my-business/reference/businessinformation/rest/v1/attributes/list).
- Verification: 2476 default tests passed, 382 skipped; 32 focused metadata and
  attribute tests passed; 3 standalone attribute scenarios passed, including
  deprecation appearing after the initial read and rejection before any PATCH.
  TypeScript, changed-file ESLint, webpack build and standalone preparation passed.
- Persisted attribute approval, metadata-aware disabled editor states and the
  remaining full-programme requirements are still open. No deployment/live claim.

### Attribute editor metadata and clearing (29 September 2026)

- Deprecated metadata now renders the attribute read-only with an explicit
  Google limitation. ENUM answers have a Clear action; the review shows the
  previous display label changing to Not set. Unchanged deprecated answers do
  not enter the review. Editing a URL preserves existing sibling URI entries.
- Verification: 48 focused component/domain tests passed; webpack build,
  TypeScript and standalone preparation passed; changed-file lint and diff check
  passed. Browser scenarios at 375px and 1280px passed; the mobile review capture
  was visually inspected for the explicit Free-to-Not-set change.
- These controls do not complete persisted attribute approval, repeated-enum
  editing, multiple-URL editing or the broader profile coverage requirements.

### Persisted attribute review API foundation (29 September 2026)

- Additive migration 0061 permits attribute records in the existing change-set
  store, retaining its RLS, grants, retention and approval-policy controls.
- Attribute preview persists exact values, mask, target and current Google
  baseline after metadata validation. The business-information route supports
  attribute preview, approval and pending-review listing; typed client methods
  are available for editor migration.
- When a change-set ID is supplied, execution verifies approval, payload/mask,
  baseline, target and current actors/policy under the attribute lock. Repeated
  execution returns the same attempt, including confirmation state.
- Transitional limitation: the current attribute editor has not yet migrated;
  requests without a change-set ID still use the existing publishing path.
  Mandatory approval and saved-review UI are the next required work, not complete.
- Verification: migration applied from an empty isolated database; webpack build,
  TypeScript and standalone preparation passed; changed-file lint passed after
  correcting a test variable declaration. 32 attribute/metadata and 12 existing
  editor tests passed. Five standalone cases passed across attributes/opening
  state, including unapproved rejection, tampered payload rejection, approved
  execution, repeated execution without another PATCH, and GET-only recovery.
- No deployment or live-provider acceptance claim. Upgrade-snapshot migration
  coverage and attribute two-person UI scenarios remain outstanding.

### Mandatory attribute approval and editor integration (29 September 2026)

- Profile review now saves attribute change sets before opening the sheet.
  Publishing approves and executes the saved payload, mask and baseline; the
  fingerprint includes the attribute baseline. Automatic baseline replacement
  after another profile step has been removed.
- Saved attribute reviews expose the existing second-approver policy without
  replacing the user's current draft. Unknown/unsupported display types block
  approval. URL review text includes all URI entries.
- Attribute PATCH requests without a change-set ID now return approval_required.
  The transitional unapproved path described above has been removed.
- Verification: 2481 default tests passed, 382 skipped; 3 built standalone
  attribute scenarios passed, including no-ID/unapproved/tampered rejection,
  current-metadata checks, approved idempotency and recovery. Two browser cases
  at 375px and 1280px proved preview, approval and PATCH with the exact saved ID,
  clear payload and baseline. Second-approver restrictions and saved-payload
  publication passed component tests. Build/TypeScript/standalone preparation,
  changed-file lint and diff checks passed.
- Saved-review second-approver browser acceptance, attribute-specific policy
  revocation scenarios and full repeated-enum/multiple-URL editing remain open.
  Deployment and authorised live-provider acceptance are still unverified.

### Saved attribute review acceptance (29 September 2026)

- Two new mobile browser scenarios passed: the requester sees a disabled publish
  button under two-person policy, while an eligible second approver sends the
  saved approval and exact attribute PATCH. Both preserve an unrelated edited
  business-name draft. The blocked review screenshot was visually inspected.
- The three standalone attribute scenarios passed with added checks that a
  changed organisation approval policy and an expired change set both reject
  publication before any Google mutation. Existing exact-payload, metadata,
  idempotency and recovery assertions remain in those scenarios.
- Only verification and evidence files changed in this increment; it used the
  previously built standalone application. Changed-test ESLint passed. Actor
  removal/grant-revocation and wider programme acceptance remain open.

### Repeated-enum attribute editor (29 September 2026)

- Metadata-backed repeated-enum attributes now expose Yes, No and Not set per
  option. Editing one option preserves sibling selected/unselected answers;
  clearing the final answer removes the attribute. Clear all answers is explicit.
- Main and saved-review text includes each option's state, and saved reviews
  accept this display type. Deprecated definitions remain read-only.
- Verification: 64 focused tests passed across five files; build/TypeScript and
  standalone preparation passed; changed-file lint and diff checks passed. A
  mobile browser scenario proved the saved payload preserves Cash=Yes and
  Cheque=No while changing Card from unknown to No. Its review screenshot was
  visually inspected. An initial raw-label defect was fixed before final checks.
- This increment verifies editing and preview; repeated-enum live-provider
  acceptance and additional multiple-URL controls remain open.

### Multiple-URL attribute controls (29 September 2026)

- Repeatable URL attributes now show every existing URI with a specific Remove
  action, editable fields and a validated Add URL input. Editing/removing one
  preserves siblings. Removing the final URI clears the attribute. Adding is
  available only when metadata explicitly allows repetition.
- Verification: 54 focused tests passed; webpack build/TypeScript/standalone
  preparation, changed-file lint and diff checks passed. A mobile browser case
  removed the Drinks URL, added Wine and proved Food remained in the persisted
  review payload. All before/after URLs were visible in the inspected screenshot.
- This closes the missing multiple-URL editor control, not provider-specific
  eligibility or live acceptance. The broader programme remains incomplete.

### Phone collection contract correction (29 September 2026)

- Google's detailed [PhoneNumbers contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#PhoneNumbers)
  explicitly requires updating both fields together and disallows leaf masks.
  This supersedes the earlier phone-mask claim and its permissive stub evidence.
  Description leaf masks remain valid. Primary-phone publication now sends
  `phoneNumbers` with the preserved additional list. Empty primary numbers are
  rejected before provider writes because the provider requires a primary number.
- The core profile Google snapshot hash now includes additional numbers, so
  changes to those siblings invalidate a reviewed primary-phone operation.
  Independent readback checks the additional list as well as selected core fields.
- The additional-phone draft contract preserves absent values, restores saved
  drafts, supports explicit removal and caps the list at two. New Business
  Information phone writes require both fields; independent confirmation treats
  an omitted empty list as cleared but rejects retained numbers. Historical
  recovery retains its earlier payload parser.
- Verification: 49 focused tests and the default suite passed (2,492 passed,
  383 skipped). Typecheck, changed-file ESLint, production webpack build and
  standalone preparation passed. The standalone core profile journey verifies
  sibling preservation, stale additional-number rejection and required-primary
  rejection. Empty-database migrations through 0061 passed locally.
- A separate standalone approved-phone journey passed: incomplete collections
  return 400, removing one additional number preserves the primary, an accepted
  clear that retains a number remains unresolved, and a later GET-only check
  confirms the cleared list without another PATCH. The import-review suite also
  passed after the core snapshot hash change.
- Additional-phone UI controls and mixed core/advanced-field publishing still
  require implementation and browser evidence. Full release suites, deployment
  and authorised live-provider verification remain pending.

### Additional-phone editor and saved reviews (29 September 2026)

- The profile editor now has an indexed Additional phones section with typed
  telephone inputs, explicit Add/Remove actions and the two-number limit. The
  primary number remains in the approved collection. Empty edited values block
  review until corrected or removed; adding requires an existing primary number.
- Phone collections appear in Saved profile reviews, showing every before/after
  number and preserving the existing second-approver policy. The footer explains
  which fields are saved locally and which publish to Google.
- Verification: 32 focused tests passed, including second-approver allowed and
  denied cases with the frozen phone payload. Three built-app browser journeys
  at 375/768/1280px exercised removal, adding by keyboard, the list limit, invalid
  empty values, exact persisted previews, clearing and an unresolved write.
  Axe found no violations in the phone section. Screenshot review caught and
  corrected the Add button's alignment beside multiline help text.
- This is local UI and stub-provider evidence. Mixed core/advanced publication,
  wider permission/recovery scenarios, full release checks, deployment and
  authorised Google acceptance remain open.

### Address component preservation (29 September 2026)

- The previous editor sent the entire `storefrontAddress` from four projected
  fields, risking removal of county, district, language and other siblings.
  Street lines, town and postcode now use specific nested update masks. The
  contract also handles an intentional country-code change. This follows the
  [locations.patch field-mask contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch);
  live provider acceptance remains pending.
- Saved and immediate reviews name each selected component. Independent readback
  accepts omitted empty values, rejects retained values and compares street lines
  in order. Missing selected fields return a validation error before publication.
- Verification: 30 focused tests, typecheck, changed-file lint, webpack build and
  standalone preparation passed. A standalone approved-write journey preserved
  county, district, language and an unknown sibling while changing the town;
  clearing stayed unresolved until a GET-only check observed the omission. It
  also proved malformed selected-field previews return 400. A mobile built-app
  browser journey and inspected screenshot verified the component-specific
  before/after review and exact approved mask.
- Additional address component controls, whole-address clearing with service-area
  semantics, broader release checks, deployment and live verification remain open.

### District and county address controls (29 September 2026)

- Added optional district/neighbourhood and county/region controls, with existing
  provider values and restored drafts preserved. Untouched absent fields remain
  absent; clearing an existing value creates its own selected-field change.
  Error summaries and changed-section navigation include both fields.
- Immediate and saved reviews support both field masks. Older whole-address
  review summaries also include district and county rather than hiding them.
- Verification: 32 focused tests passed. Three standalone approved-write cases
  separately exercised town, county and district set/clear, sibling preservation,
  invalid selected-field previews and GET-only confirmation after an unresolved
  clear. Three browser journeys at 375/768/1280px verified the controls, exact
  payload/masks, separate before/after rows and unresolved publication behavior.
  Axe found no address-section violations; screenshots were inspected. The
  initial browser assertion expected Not set rather than the component's correct
  Cleared wording; the corrected assertion passed at every width. Typecheck,
  changed-file lint, webpack build and standalone preparation passed.
- Remaining address scope includes whole-address removal with service-area
  semantics and explicit treatment of the other provider address fields. This
  does not close broader profile, release, deployment or live-provider acceptance.

### Service-area transition and confirmation contract (29 September 2026)

- Added typed service-area format validation, unique place IDs and the 20-area
  limit. IDs remain user/provider supplied; format checks do not establish that
  an ID identifies the named place.
- Preview and execution reject changing an existing service-area country,
  customer-only storefront edits and removal of a storefront without the
  customer-only business type. Conversion to customer-only requires an explicit
  empty storefront address and its mask in the same approved payload. This follows
  Google's [ServiceAreaBusiness contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#ServiceAreaBusiness).
- Independent confirmation compares the exact place-ID/name set and business
  type, allowing reordering. Retained places, malformed data or a retained
  storefront after a clear remain unresolved. Recovery uses GET without another
  provider mutation.
- Verification: 11 focused domain/address tests and four built-standalone
  integration scenarios passed against disposable PostgreSQL and Google stubs.
  The conversion scenario proved invalid previews make no PATCH requests,
  reviewed conversion executes once, retained storefront data remains unresolved,
  and a later GET-only confirmation succeeds. Three existing address set/clear
  regression scenarios passed. Typecheck, changed-file lint, webpack build,
  standalone preparation and diff checks passed.
- Service-area form controls, draft preservation, before/after UI, unknown parent
  field preservation and browser coverage remain open. No deployment or live
  service-area acceptance is claimed by this backend increment.

### Service-area draft and review model (29 September 2026)

- Existing supported service-area names, IDs, country and business type now
  survive profile draft loading and restoration. An absent service area stays
  absent. Place clearing remains an explicit empty collection.
- The draft builder emits service-area changes and an explicitly selected whole
  storefront clear. Whole-address removal supersedes conflicting address-leaf
  edits in that draft. Review rows describe the business type, country and exact
  name/ID pairs, plus the specific address removal.
- Preview/execution reject replacement of existing service-area objects containing
  unknown or unsupported fields at any supported nesting level. Unrelated profile
  edits remain allowed. This prevents data loss; it does not claim an editor for
  unknown future provider fields.
- Verification: 15 focused service-area, draft and address tests passed, including
  restoration, untouched values, exact conversion payload, review text, explicit
  place clearing and nested unknown-field guards. Typecheck, changed-file lint and
  diff checks passed. This increment has no new browser evidence; the service-area
  form controls and complete saved-review journey remain in progress.

### Service-area profile controls (29 September 2026)

- Added service-area controls using the existing profile primitives: business
  type, country, existing name/ID pairs, explicit add/remove and a 20-area limit.
  Duplicate IDs are rejected. Existing country is locked, customer-only address
  editing is disabled, and conversion requires an explicit storefront-removal
  checkbox before review. Unknown provider data gives a Google handoff.
- Immediate reviews show exact area names/IDs and address removal. Saved reviews
  include service-area changes and retain second-approver restrictions and exact
  approved payload execution. Section navigation and validation focus include
  service areas.
- Verification: 37 focused tests passed, including saved-review permission cases.
  The default suite passed 2,511 tests with 387 skipped; this is not a claim that
  database suites ran under the default command. Three built-app browser journeys
  at 375/768/1280px exercised duplicate IDs, removing/replacing an area, keyboard
  add, conversion gating, exact preview, approved publication and unresolved
  results. Axe found no violations in the service-area section. Screenshot
  inspection caught a raw enum in the select trigger; it was replaced by readable
  text and verified on a rebuilt application. Typecheck, changed-file lint,
  webpack build and standalone preparation passed.
- Browser journeys mock the app API; the earlier standalone integration evidence
  covers backend/provider-stub execution separately. Expanded browser coverage for
  new/empty service-area setup, draft restoration, unknown-data handoff and full
  keyboard navigation remains to be completed. Broader WP3/M2, release and live
  eligible-account acceptance remain open.

### Service-area setup and recovery browser closure (29 September 2026)

- Added three built-app browser scenarios: keyboard-only initial service-area
  setup with no invented country/ID, restored exact IDs and storefront-removal
  intent, and unsupported-data editing denial with a Google handoff. All three
  passed against mocked app API reads; they assert no write request occurs.
- Keyboard setup traverses the type select, country, removal checkbox, name,
  place ID and Add button. Review remains disabled until the required values
  and removal intent are present. Initial failures came from sending keys before
  menu mounting or focus restoration; the test now waits for the observable menu
  and trigger-focus states rather than sleeping or bypassing keyboard interaction.
- Typecheck and changed-test lint passed. No product code changed in this
  verification increment. Updated M2.1-M2.3 summary rows to reflect the detailed
  implementation evidence; deployment/live-provider columns remain pending.

### Relationship contracts and independent confirmation (29 September 2026)

- Added typed chain resources, parent/child place IDs and the provider's two
  supported relation types. Duplicate child IDs and unsupported fields are
  rejected. Chain, parent and child fields each have an individual update mask,
  explicit clear and required selected-payload validation.
- This follows the current [RelationshipData contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#RelationshipData)
  and [locations.patch field-mask contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch).
  Unknown siblings remain outside a selected leaf mask. Replacing a relationship
  object with unknown fields is blocked, including an unsupported selected parent.
- Readback checks exact chain/parent identity and relation type, and exact child
  collections independent of order. A retained cleared relationship is unresolved;
  a later GET can confirm its omission without repeating the write. Whole-parent
  confirmation no longer accepts a retained known relationship after a full clear.
- Verification: 16 focused relationship/capability tests passed. Three built
  standalone PostgreSQL/Google-stub cases exercised chain, parent and children
  set/clear, malformed preview denial, exact approval, unknown sibling preservation,
  retained-value ambiguity and GET-only recovery. Typecheck, changed-file lint,
  webpack build, standalone preparation and diff checks passed.
- Relationship editor controls, chain search UX, draft/review presentation,
  browser journeys, remaining advanced fields and eligible-account acceptance
  remain open. No deployment or real Google mutation was performed.

### Relationship draft and saved-review model (29 September 2026)

- Added exact relationship ID loading and draft restoration. Each supported leaf
  loads independently, so an unsupported parent-business object does not prevent
  editing a valid chain affiliation. Raw unsupported values remain protected by
  the server's selected-field preservation guard.
- Draft updates include only changed relationship leaves. Empty controls on
  absent relationships and reordered child collections produce no write. Explicit
  chain, parent and child clears have separate before/after review rows. Combined
  relationship changes are retained when a storefront removal is also selected.
- Saved reviews now support the three relationship masks. They show the selected
  changes, preserve second-approver restrictions and send the exact reviewed
  payload, masks, baseline and change-set identity.
- Verification: 34 focused draft, relationship, Google-value, service-area and
  saved-review tests passed. Typecheck, changed-file lint and diff checks passed.
  No new browser or deployment evidence is claimed in this model increment.
  Form controls, chain search and their complete browser journeys remain open.

### Chain affiliation editor (29 September 2026)

- Added a chain search and selection control using the existing scoped metadata
  endpoint. Results retain exact resource IDs, prefer an English display name and
  distinguish malformed responses from empty results. Keyboard submission can
  repeat the same search after failure.
- Explicit removal appears as a cleared chain in the exact review. Parent and
  child relationship data remain outside the selected mask. Restored drafts retain
  the selected ID without another lookup; unsupported existing chain values have
  a read-only Google handoff.
- Verification: 42 focused tests passed; typecheck, changed-file lint, webpack
  build and standalone preparation passed. Five browser cases against the built
  app covered search, malformed/empty results, keyboard retry and selection,
  exact set/clear reviews, unresolved publication, draft restoration and the
  unsupported-data handoff. Three viewport cases (375, 768 and 1280 pixels) had
  zero section-scoped Axe violations. Control screenshots and the mobile clear
  review were inspected. Browser API responses were fixtures, not live Google.
- Parent/child controls, advanced-field coverage, deployment and eligible-account
  live acceptance remain open. This increment does not complete M2 or the programme.

### Parent and child business editor (29 September 2026)

- Added parent replacement and child addition/removal controls. Operators supply
  exact place IDs and explicitly choose the relationship type. Invalid ID format
  and duplicate child IDs are rejected locally. Parent and child clears have
  separate review rows; chain affiliation and unknown siblings are untouched.
- Unsupported nested provider data locks only the affected control, with a Google
  handoff. Draft restoration retains exact IDs and relationship types. These
  controls use the existing saved-review approval and unresolved-outcome handling.
- Verification: the current default suite passed with 2,525 passed and 390 skipped
  tests (246 files passed, 73 skipped). The skipped database scenarios are not
  counted as database evidence. Typecheck, changed-file lint, webpack build and
  standalone preparation passed. Five related-business browser cases passed,
  covering the 375/768/1280-pixel set/clear flows, keyboard selection, malformed
  IDs, duplicate children, exact reviews, unresolved publication, unsupported
  parent preservation and draft restoration. The five chain cases also passed
  against this build. Section-scoped Axe checks reported zero violations.
- Parent/child screenshots at all three widths and the mobile clear review were
  inspected. Browser interactions wait for select focus and popup closure, avoiding
  a race with the control's transition. Browser API fixtures establish editor
  behaviour; the earlier standalone database/Google-stub scenarios establish
  selected-mask execution and recovery. Neither establishes live Google acceptance.
- Advanced-field audit, deployment and eligible-account live acceptance remain
  open. The programme remains active and M2 is not complete.

### Google Ads phone editor (29 September 2026)

- Audited the remaining top-level location fields against the current
  [Google location contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations).
  Advertising location extensions are writable; location language is immutable
  after creation; coordinate updates require Google-approved client access and
  remain an external capability. This does not close the remaining nested-field
  audit or every external handoff.
- Added the alternate ads phone to the typed write/read contracts, draft restore,
  exact reviews and saved-review publication. Empty input clears only an existing
  override. Public primary and additional phones remain outside the update mask.
  Unknown advertising fields prevent parent replacement. Independent readback
  distinguishes retained values from clears; recovery only reads Google.
- Verification: 45 focused tests passed, plus one built standalone PostgreSQL and
  Google-stub scenario covering set, unknown-field denial before provider writes,
  retained-clear ambiguity and GET-only recovery. Four built-app browser scenarios
  passed: set/clear reviews at 375/768/1280 pixels and unsupported-data protection.
  Section-scoped Axe checks found zero violations; the three control screenshots
  and mobile clear review were inspected. Typecheck, changed-file lint, webpack
  build, standalone preparation and diff checks passed.
- The standalone scenario used an isolated database; browser responses were
  fixtures. Deployment, eligible-account Google acceptance and actual advertising
  display remain unverified. M2 and the programme remain active.

### Additional postal-address fields (29 September 2026)

- Audited the nested [PostalAddress contract](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#PostalAddress).
  Added language, organisation, recipients and sorting code to typed contracts,
  draft restoration, individual update masks, exact reviews and saved reviews.
  Schema revision is fixed at zero and catalogued as unavailable for operator
  editing. No language is invented when the provider omits it.
- Added an expandable address-details section. Recipient order and keyboard
  newline entry are preserved. Each explicit clear is reviewed independently.
  Sorting-code input is shown for existing values and the provider's documented
  country examples (FR/JM/MW/CI), not for a new UK address. Broader international
  postal usage is outside this UK launch and is not claimed from these examples.
- Malformed selected fields are rejected by the server and disabled in the
  editor; unrelated unknown siblings remain outside the masks. Readback requires
  exact ordered recipients and distinguishes retained clears from absent defaults.
- Verification: 53 focused tests passed. Seven built standalone PostgreSQL and
  Google-stub scenarios passed, covering set/clear/recovery for locality, county,
  district and all four additional fields. Four browser scenarios passed,
  including 375/768/1280-pixel set/clear reviews, invalid language, recipient
  keyboard entry, UK sorting visibility and malformed-value protection. Axe found
  zero violations within the additional-address section. The three control
  screenshots and mobile four-field clear review were inspected. Typecheck,
  changed-file lint, webpack build, standalone preparation and diff checks passed.
- These are local fixture results. Deployment and eligible-account acceptance
  remain pending; M2 and the full programme remain active.

### Account-scoped matching backend (29 September 2026)

- Added `POST /api/google/accounts/[accountId]/matches`, using the existing
  Google transport and tenant-scoped database access. Matching accepts a bounded
  text query or typed business details with an explicit connection; it requires
  no existing local location, external location or location link.
- Owner/admin access, active account/connection binding and optional client scope
  are checked before provider calls. Google must return the exact selected account
  from `accounts.get`. Local connection/account scope is rechecked before returning
  matches, preventing results from being returned after a mid-search disconnect.
- Potential matches preserve Google resource identities and HTTPS ownership
  handoffs. A search result does not establish ownership or authorise a link or
  creation. Malformed responses and provider denial remain errors, distinct from
  a successful empty result. No listing, external-location or mutation row is
  created by matching.
- Verification: two contract cases passed. Four built standalone PostgreSQL and
  Google-stub cases passed, covering zero locations, claimed/unclaimed/empty
  responses, positive client scope, cross-tenant and connection mismatch, invalid
  client scope, viewer denial, malformed provider data, mismatched provider account,
  account denial and mid-search disconnect. An existing ads-phone recovery case
  also passed after the stub gained asynchronous response handlers. Typecheck,
  changed-file lint, webpack build, standalone preparation and diff checks passed.
- This is backend fixture evidence. Setup UI integration, persisted onboarding
  drafts, creation validation/approval/identity, link recovery, verification,
  deployment and eligible-account live acceptance remain open.

### Persisted onboarding drafts (29 September 2026)

- Added migration `0062_google_onboarding_drafts` and account-scoped create,
  restore, revision-checked save and draft-matching endpoints. No existing local
  location is required. Incomplete typed payloads can be saved, including the
  creation language. Targets and provider request identity are immutable through
  the runtime update grants and API contracts.
- Duplicate submissions with the same draft UUID and initial content restore the
  same row and request identity. Separate draft UUIDs receive different identities.
  Conflicting concurrent saves return 409. Changed content invalidates matches.
  Matching uses saved details, rejects stale revisions and superseded searches,
  and preserves the distinction between failure and an explicit empty result.
- Verification: three contract tests passed; six onboarding and four retention
  scenarios passed against the built standalone application, isolated PostgreSQL
  and Google stub. Coverage includes concurrent draft creation/saves, restore,
  immutable provider identity, RLS isolation, viewer denial, disconnection,
  draft expiry, late and superseded search responses, failed-search invalidation,
  and retention cleanup/idempotency. The migration applied from an empty database.
  Typecheck, changed-file lint, webpack build and standalone preparation passed.
- This is backend fixture evidence. No listing was created at Google. Creation
  decisions, validation, frozen review and approval, submission/readback, local-link
  recovery, setup UI and deployment/live acceptance remain incomplete. The durable
  request ID is prepared for that execution flow; provider retry behaviour is not
  yet claimed by these draft tests.

### Creation validation and approval (29 September 2026)

- Added migration `0063_google_onboarding_reviews` and draft-scoped review,
  restore and approval APIs. A successful search of the saved revision, explicit
  acknowledgement of every returned match and a reason for separate creation are
  required. The server verifies account access and calls `locations.create` with
  `validateOnly=true` before storing a review. Validation and creation identities
  are separate. Review records freeze the payload, target, revision, provider
  creation identity, match evidence, decision and approval policy.
- Approval requires the exact review hash and honours the existing two-person
  policy. Changed payload, rematching, changed policy, expiry, revoked requester
  or approver access and paused writes block approval. Runtime grants prevent
  mutation of reviewed content. Retention cascades from expired drafts.
- Four contract tests and fourteen built standalone onboarding/retention scenarios
  passed, including the final malformed-validation response regression. Typecheck,
  changed-file lint, webpack build, standalone preparation and diff checks passed.
  Scenarios cover exact validate-only
  payloads, unacknowledged matches, approval hash mismatch, second approver,
  cross-tenant access, revocation, expiry, rematching, mid-validation edits,
  provider rejection/malformed responses, paused writes and retention. The additive migration applied
  from an empty isolated database. No live provider creation was attempted.
- Creation submission, independent provider confirmation, resuming local linking,
  review/setup UI, deployment and live acceptance remain incomplete. An approved
  record is not evidence that a Google location exists.

### Durable creation and local-link recovery (29 September 2026)

- Migration `0064_google_onboarding_creation` adds one execution record per draft,
  tied to the exact approved review. Submission freshly checks matches, permissions,
  policy and flags. It uses the draft's provider request UUID. Concurrent duplicate
  submits return the existing attempt; another review cannot replace it. Draft
  saves, matching and new previews are blocked after creation starts.
- Execution, confirmation and linking states are separate. The returned resource
  name is saved before independent GET readback and before linking. Readback checks
  approved values while allowing provider-added output fields. Unknown responses
  without a resource identity remain unresolved and are not automatically resent.
  Interrupted pending attempts become unknown after two minutes on refresh.
- Local linking is transactional, preserves existing mappings, does not merge by
  business name, extends applicable client grants and queues initial backfill.
  Name conflicts preserve the provider outcome; an explicit local-name retry calls
  only provider reads and the local transaction. Recovery of a known resource does
  not depend on the original approval remaining unexpired.
- Verification: eighteen focused onboarding/Google-contract tests and
  twenty-four standalone onboarding/retention cases passed. These include competing
  reviews and a policy change during the final provider search, alongside duplicate
  submit, name-conflict recovery, readback mismatch/recovery, lost response,
  malformed creation identity, provider rejection, interruption and recovery after
  resource persistence with an expired approval. Migration application from an
  empty isolated database, typecheck, changed-file lint, webpack build and
  standalone preparation passed.
- This is backend fixture evidence only. Setup/creation/recovery UI, accessible
  match linking, explicit reconciliation when a response lost the resource identity,
  broader activity/notification integration, deployment and live acceptance remain
  incomplete. No public business was created for testing.

### Setup draft, matching and recovery interface (29 September 2026)

- Setup now lists the latest 20 unexpired drafts for the selected connection,
  Google account and exact client. A standalone scenario verifies client/connection
  isolation, cross-tenant rejection and expiry. Saved URLs restore older drafts.
- Operators can start a draft with a retry-stable identity, restore basic business
  details, save with revision checking, search saved details and open Google's
  returned ownership handoff. Untouched address siblings survive a title edit.
  Failed searches remain errors; successful empty searches have explicit wording.
- Unsaved edits guard in-app links and page unload. Setup Back/Continue preserve
  unsaved or pending draft work. Stale saves retain local input until the operator
  explicitly discards it and reloads the saved version.
- Existing creation attempts show execution, independent confirmation and local
  linking separately. Known-resource linking can resume under a distinct local
  name. Unknown identity outcomes offer refresh without automatic resubmission.
  Linked outcomes point to verification without claiming verification completion.
- Verification: 25 focused contract/setup/component tests, one built standalone
  draft-list isolation scenario, and 12 browser scenarios passed (seven new
  onboarding cases plus five existing setup cases). At 375, 768 and 1280 pixels,
  matching journeys had no horizontal overflow or scoped Axe violations.
  Screenshots of all three layouts and both recovery states were visually inspected.
  Type checking, changed-file lint, webpack build and standalone preparation passed;
  migrations through 0064 applied to an empty local database.
- Browser scenarios mock the application API and prove interface behavior;
  standalone PostgreSQL/Google-stub scenarios provide the separate server evidence.
  This is a partial WP4 increment: category/service-area creation details, exact
  review/approval/submission controls, direct accessible-match linking, unknown
  identity reconciliation and full verification/lifecycle work remain active.
  Deployment and live-provider acceptance are pending. No live Google writes ran.

### Account-scoped creation categories (29 September 2026)

- Added an owner/admin category-discovery route that works with no linked location,
  plus shared query/response contracts and an API client. It preserves category IDs,
  display names and pagination, with explicit region/language and bounded input.
- Uses the existing Google transport. Local account/client access and fresh Google
  account access precede the category request; local access is checked again after
  the provider response. Malformed category responses do not become empty results.
- Six focused onboarding/category contract tests and four built standalone category
  scenarios passed. The latter cover zero-location pagination, malformed responses,
  in-flight revocation, cross-tenant/client restrictions, viewer denial and Google
  account denial before category requests. Typecheck, changed-file lint, webpack
  build and standalone preparation passed.
- This is backend fixture evidence. Category controls, remaining creation details
  and review/submission UI remain active work. Deployment and live acceptance are
  pending; no live Google writes were performed.

### Onboarding category selection (29 September 2026)

- Setup drafts now expose account-scoped Google category search, an explicit
  primary category, up to nine additional categories, removal/clearing, pagination
  and retry. Search uses the current draft country and listing language.
- Primary changes preserve unrelated additional categories and prevent a category
  from occupying both roles. Saving retains provider IDs; editing categories
  invalidates matching evidence through the existing revision-bound draft save.
- Eleven focused contract/component tests and twelve setup browser scenarios
  passed. The three viewport journeys now cover category search failure/retry,
  pagination, primary/additional selection, exact saved IDs, reload and explicit
  clearing alongside the existing matching and recovery checks. Scoped Axe scans
  and horizontal-overflow checks passed at 375, 768 and 1280 pixels; category
  screenshots at each width were visually inspected. Typecheck, changed-file lint,
  webpack build and standalone preparation passed.
- Browser API responses are fixtures; the account-scoped backend has separate
  standalone category coverage in the preceding entry. Remaining creation details,
  exact review/approval/submission controls, verification/lifecycle work and all
  outstanding programme packages remain active. Deployment/live acceptance pending.

### Onboarding creation review and approval (29 September 2026)

- Added creation decisions with explicit acknowledgement of every match and a
  recorded reason. Provider validation produces a frozen review; the interface
  shows saved business details, target account, decision, expiry and approval policy.
- Saved review URLs restore the exact review. Two-person approval disables the
  initiator's approval action. Submission requires approval and an explicit final
  confirmation, sending the exact review identity and hash. Failed or lost submission
  responses read creation status to recover the durable operation.
- Draft revisions and matching timestamps are included in review cache identity.
  Unsaved decisions guard navigation and business edits; explicit discard resets
  the decision. Validation rejection, expired review and refresh errors retain
  actionable recovery controls without exposing an executable stale review.
- Eleven focused contract/component tests and sixteen setup browser scenarios
  passed, including three viewport review journeys, two-person approval, review URL
  restoration, validation rejection, expiry and a lost submission response recovered
  through GET with one creation POST. Scoped Axe and overflow checks passed at
  375, 768 and 1280 pixels. Typecheck, changed-file lint, webpack build and standalone
  preparation passed. Browser API fixtures are separate from the backend standalone
  approval/execution/recovery evidence recorded above.
- Complete creation details, accessible-match linking, unresolved-identity
  reconciliation and verification/lifecycle work remain active. Deployment and
  eligible live-provider acceptance are pending; no live Google writes were made.

### Onboarding contact details (29 September 2026)

- Creation drafts now have website, primary phone and up to two additional-phone
  controls. The shared payload contract rejects malformed URLs and too many
  additional numbers. Untouched contact data remains preserved; editing the
  primary number preserves additional numbers. Clearing all phone inputs omits
  the phone object from the proposal.
- Eighteen focused contract/component tests and eleven onboarding browser
  scenarios passed against the built standalone app. The three matching journeys
  cover invalid input, save, reload, sibling preservation and explicit clearing
  at 375, 768 and 1280 pixels. Scoped Axe and horizontal-overflow checks passed.
  Typecheck, changed-file lint, webpack build and standalone preparation passed.
- Browser fixtures prove local behavior, not Google acceptance. Complete creation
  details, direct accessible-match linking, verification and the remaining
  programme work remain active. Deployment and live-provider evidence are pending.

### Onboarding storefront components (29 September 2026)

- Added town/city, county/region and district controls to saved creation drafts.
  Address edits preserve saved organisation and other untouched components.
  Clearing a district omits only that component; clearing every storefront input
  except country omits the storefront from the creation proposal. An absent,
  untouched postcode stays absent when another component changes.
- Eighteen focused contract/component tests passed. The final built standalone
  application passed eleven onboarding browser scenarios, including saving and
  restoring structured components, preserving siblings and clearing individual
  components or the full address. Typecheck, changed-file ESLint, webpack build
  and standalone preparation passed. Scoped Axe and overflow checks passed at
  375, 768 and 1280 pixels; screenshots at all three widths were inspected and
  show the full form without footer obstruction.
- The browser fixture originally assumed every save retained a storefront. It
  was updated for the explicitly tested clear-address proposal; preservation is
  still asserted for saves that retain an address. No live provider was called.
- Service-area creation details, remaining supported creation fields, direct
  accessible-match linking, verification and unresolved-identity reconciliation
  remain open. Deployment and eligible live-provider acceptance remain pending.

### Service-area onboarding details (29 September 2026)

- Creation drafts now distinguish storefront, customer-only and hybrid businesses.
  The service-area editor supports an explicit country code and up to 20 manually
  supplied place names/IDs. Existing saved IDs survive type changes and individual
  removals. Shape and duplicate checks are local; provider validation remains a
  separate creation-review action. No paid lookup or invented IDs were added.
- Customer-only proposals require a country and no storefront before creation
  review is shown. Storefront removal is explicit. Switching to hybrid preserves
  the saved storefront and area IDs. Unfinished area inputs guard navigation and
  require add/discard before save or matching. Review displays readable business
  type labels and the exact saved place IDs. Rejected validation now has an
  actionable explanation instead of generic failure copy.
- Twenty-three focused contract/component tests and fourteen onboarding browser
  scenarios passed against the final built standalone app. The three service-area
  journeys cover malformed/duplicate IDs, uncommitted-entry guards, hybrid sibling
  preservation, customer-only address removal, save/reload, individual area removal
  and frozen creation review at 375, 768 and 1280 pixels. Scoped Axe and overflow
  checks passed. Typecheck, changed-file ESLint, webpack build and standalone
  preparation passed.
- The three service-area scenarios passed again after increasing the screenshot
  capture height. All three images were inspected; the mobile image now includes
  every review action without the fixed setup footer covering the panel.
- All migrations through `0064_google_onboarding_creation` applied to a fresh
  disposable database. The initial browser launch failed because the new database
  lacked its runtime role; existing migration/runtime setup resolved this before
  the passing run. This does not prove production migration or deployment state.
- Remaining creation fields, direct accessible-match linking, verification,
  unresolved-identity reconciliation and the rest of WP1-WP9 remain active.
  Deployment and eligible live-provider acceptance are pending. No live Google
  writes were made.

### Creation description and organisational fields (29 September 2026)

- Added business description, store code, private listing labels and a separate
  Google Ads phone to creation drafts. Untouched values are preserved. Clearing
  each field omits it from the proposed new listing. The shared contract enforces
  description/label/phone limits; Google validation remains responsible for
  category requirements and account-unique store codes.
- Checked the current [Google Location reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations)
  and its linked profile/advertising definitions. Labels are private organisational
  tags; the Ads phone is separate from the public business contact numbers.
  Frozen review uses the form's readable names for these fields.
- Twenty-five focused contract/component tests and fourteen onboarding browser
  scenarios passed against the final built standalone app. The three matching
  journeys cover too many/overlong labels, save/reload, sibling preservation and
  clearing. The three service-area journeys verify the exact description, code,
  label and Ads phone in the frozen review. Scoped Axe and overflow checks passed
  at 375, 768 and 1280 pixels. Screenshots of the complete form and review were
  inspected at all three widths. Typecheck, changed-file ESLint, webpack build,
  standalone preparation and diff checks passed.
- Opening state/date, services, relationships, other supported creation fields,
  direct accessible-match linking, verification and unresolved-identity recovery
  remain open. The full WP1-WP9 programme remains active. This is local automated
  evidence; deployment and eligible live-provider acceptance remain pending.

Onboarding opening information increment (2026-09-29):

- Account-scoped creation drafts now collect an explicit opening state and an
  optional complete or month/year opening date. Omission remains omission;
  changing state preserves the date, clearing the date preserves the state,
  and choosing omission removes the whole proposed opening object.
- Unknown days remain unknown, including an existing provider day-zero value.
  Calendar validation rejects impossible dates and incomplete years/months.
  The frozen review displays readable states and explicitly identifies a day
  that was not supplied.
- Forty-two focused contract/component tests and seventeen onboarding browser
  scenarios passed against the built standalone app. Three opening journeys
  cover leap-day rejection, save/reload, preservation, independent clearing
  and exact partial-date review. Scoped Axe and overflow checks passed at
  375, 768 and 1280 pixels; complete form/review screenshots were inspected at
  all three widths. Typecheck, changed-file ESLint, webpack build and standalone
  preparation passed. Fresh disposable database migrations and runtime-role
  setup passed before browser testing.
- Current Google OpenInfo documentation was checked. Services, relationships,
  other supported creation fields, direct accessible-match linking,
  verification and unresolved-identity recovery remain open. The full WP1-WP9
  programme remains active; deployment and eligible live-provider acceptance
  remain pending.

Onboarding opening-date confirmation increment (2026-09-29):

- Creation readback now uses the shared partial-opening-date comparison:
  an omitted unknown day and Google's day-zero representation are equivalent.
  A provider-invented concrete day cannot confirm an approved month/year date;
  complete dates still require the exact day, month and year. Other approved
  fields and ordered address lines retain their existing comparison rules.
- Thirty-five focused domain/contract tests passed. Twenty-eight account-scoped
  onboarding integration scenarios passed against the rebuilt standalone app
  and a fresh disposable database through migration 0064. The three added
  creation cases prove both unknown-day representations link successfully,
  while an invented day remains unresolved, creates no local link and does
  not resend Google creation on retry.
- Typecheck, changed-file ESLint, webpack build, standalone preparation and
  diff checks passed. The opening form's preceding seventeen browser scenarios
  and inspected screenshots remain its UI evidence; they were not rerun for
  this server/domain-only comparison change. Current Google Date/OpenInfo
  references were checked. Deployment, live-provider acceptance and the
  remaining WP1-WP9 work are still pending; the programme remains active.

Account-scoped onboarding service metadata increment (2026-09-29):

- Saved onboarding drafts now have a manager-only service metadata read bound
  to the expected revision and payload hash. It works without a linked location,
  obtains fresh Google account proof and FULL metadata for every proposed
  category, preserves draft language/country context, and rechecks current
  account/client/connection scope and revision after provider discovery.
- Category completeness is checked by provider ID, allowing reordered results.
  Confirmed categories with no structured services remain valid. Missing or
  malformed metadata, missing primary category, stale drafts, account denial,
  unconfirmed account identity and access revocation produce explicit errors.
- Nonempty services require fresh eligibility before creation validation and
  again before claiming submission. Structured IDs must be advertised by the
  proposed categories; custom services must belong to a proposed category.
  There is no existing-service exemption for new listings. Eligibility changes
  after approval block submission before any creation record or provider write.
- Fifty-one focused service/draft/transport tests passed. Forty-five onboarding
  integration scenarios passed against the final rebuilt standalone app: the
  original twenty-eight plus seventeen service-discovery/eligibility cases.
  The existing linked-location category/service journey also passed (one
  selected case; twenty-eight unrelated cases excluded by the test filter).
  Fresh disposable migrations through 0064 and runtime-role setup passed.
- Typecheck, changed-file ESLint, webpack build, standalone preparation and
  diff checks passed. New modules and touched creation/review modules remain
  below 200 lines. The supplementary skill audit script could not run because
  it requires TypeScript 7 unstable APIs; this project uses TypeScript 5.9.3.
  No dependency upgrade was made. Source review found no new casts, non-null
  assertions, untyped inputs or swallowed errors in the added modules.
- Setup service-entry controls and their browser journeys remain open. This
  backend increment does not complete onboarding, WP3/WP4 or the full WP1-WP9
  programme. Deployment and eligible live-provider acceptance remain pending.

Onboarding service-entry and exact-review increment (2026-09-29):

- Setup now exposes suggested services from revision-bound Google metadata and
  custom services under a saved proposed category. Discovery failure blocks
  additions until retry succeeds; a confirmed category without suggested types
  still supports a custom proposal. Changed category/language/country context
  must be saved before additions use further metadata.
- Each row preserves its provider ID/category and untouched siblings, language,
  descriptions and prices. Decimal price entry retains up to nine fractional
  digits without floating-point rounding; explicit zero is preserved. Incomplete
  names/prices block save, matching and leaving the draft. Clearing a description
  or price omits that proposed value; removal affects only the selected service.
  Saved service rows restore on reload.
- Frozen creation review shows each service's type, exact ID or custom category,
  name/language, description and price. Missing values remain visibly distinct
  from a zero price. The existing creation validation/approval/submission boundary
  remains required; saving or selecting services does not publish.
- Forty-four focused service/review/draft/onboarding contract tests passed.
  Twenty-one onboarding browser scenarios passed against the built standalone
  app, including four new service journeys. These prove failed-discovery retry,
  incomplete entry guards, precise prices, save/reload, sibling preservation,
  independent clearing, exact review and custom-only category removal. The first
  browser run had three incorrect raw-error-text expectations; these were corrected
  to the established HTTP 502 action message before the complete passing run.
- Scoped Axe and overflow checks passed at 375, 768 and 1280 pixels. Complete
  form/review screenshots at all three widths were inspected, under
  `test-results/google-onboarding-services-in-creation-draft-at-*/services-*.png`.
  Typecheck, changed-file ESLint, webpack build, standalone preparation and diff
  checks passed. Fresh disposable database migrations/runtime-role setup passed.
- Relationships, other supported creation fields, direct accessible-match
  linking, verification and unresolved-identity recovery remain open. This
  increment does not complete WP3/WP4 or the full WP1-WP9 programme. Deployment
  and eligible live-provider acceptance remain pending; the goal stays active.

Onboarding parent/child relationship increment (2026-09-29):

- Creation drafts expose exact parent/child place-ID entry with explicit supported
  relationship types. Local format checks and duplicate-child checks preserve
  existing chain and relationship siblings. Unfinished entries block save,
  matching, review actions and leaving the draft; explicit discard restores them.
- Save/reload restores proposed relationships. Frozen creation review presents
  exact IDs and readable relationship types. Removing the final selected leaf
  omits that proposal field without inventing empty values or erasing siblings.
- Independent creation confirmation accepts reordered children only when all
  exact IDs and relationship types match. Missing, changed or duplicated children
  remain unresolved; retry observes the existing creation attempt without another
  provider creation request.
- Nineteen focused relationship/creation/draft tests and thirty standalone
  creation integration scenarios passed after the parent-union TypeScript fix.
  Twenty-four onboarding browser scenarios passed, including three new relationship
  journeys. Scoped Axe and overflow checks passed at 375, 768 and 1280 pixels;
  all six relationship form/review screenshots were inspected.
- Typecheck, changed-file ESLint, webpack build/standalone preparation, disposable
  migrations through 0064, runtime-role setup and diff checks passed. Current
  Google discovery revision 20260928 confirms both parent and child fields are
  writable and the two explicit relationship types are supported.
- Chain selection is a subsequent increment. Complete creation details, direct
  accessible-match linking, verification, unresolved-identity reconciliation and
  the remaining WP1-WP9 programme stay open. Deployment and eligible live-provider
  acceptance remain pending; the goal stays active.

Onboarding chain selection checkpoint (2026-09-29):

- Saved drafts support Google chain search and explicit selection of an exact
  provider chain ID. Discovery is bound to the saved revision and payload hash,
  verifies the selected account and connection, and rechecks scope after the
  provider response. Malformed or duplicate choices are rejected. Failed and
  empty searches preserve the proposal; removing a chain preserves parent and
  child relationships.
- Twenty-four focused unit tests, fifty-nine standalone integration scenarios
  across creation, services and chains, and all twenty-seven onboarding browser
  scenarios passed. Scoped accessibility and overflow checks passed at 375, 768
  and 1280 pixels. Nine final chain/relationship form and review screenshots at
  those widths were inspected.
- Browser traces identified a test locator race: an exiting parent select popup
  remained mounted while the child popup opened. The helper now selects the exact
  option inside the popup marked open and checks the intended trigger's expanded
  state. Product select behavior was restored; no forced clicks, sleeps or weakened
  payload assertions were introduced.
- Changed-file ESLint, webpack production build, standalone preparation and diff
  checks passed. Disposable migrations through 0064 and runtime-role setup passed.
  Current provider discovery revision 20260928 supports the relationship fields
  and chain search used here. This is local fixture evidence; deployment and
  eligible live-provider acceptance remain pending.
- Complete creation details, direct accessible-match linking, verification,
  unresolved-identity reconciliation and the rest of WP1-WP9 remain active.

Hours readback midnight correction (2026-09-29):

- Google discovery revision 20260928 explicitly documents an empty TimeOfDay
  object as midnight after proto3 omits zero values. The shared hours normalizer
  now preserves this value, including omitted hour with nonzero minutes, across
  regular, special and additional hours. Missing time objects remain missing;
  invalid integer ranges and invalid 24:01 values are rejected.
- Two new regression scenarios failed before the fix: a midnight opening was
  incorrectly shown as a closed day, and an invalid negative hour was accepted.
  All five domain tests and twelve hours component/migration tests passed after
  the fix. A built standalone route scenario also passed: all three hours families
  retain midnight, initial canonical values match Google, and omitted/explicit
  zero representations produce the same hash without provider writes. The other
  twenty-nine scenarios in that targeted run were skipped, not acceptance evidence.
  Typecheck, changed-file ESLint, webpack build, standalone preparation and diff
  checks passed. The component
  harness emitted its existing unimplemented window.scrollBy notices.
- This corrects existing hours readback; creation hours controls remain a separate
  open task. Deployment and live-provider verification remain pending.

Creation regular/special hours increment (2026-09-29):

- Draft contracts, persistence, form controls and frozen review support exact
  regular opening/closing weekdays and special dates at minute precision.
  Overnight weekday/date boundaries and 24:00 are preserved. Incomplete entries
  block save, matching, review and navigation until added or discarded. Removal
  omits only that proposal and preserves other fields; special dates must be
  removed before the final regular period. Save/reload restores the exact values.
- Contracts reject overlapping/duplicate periods, missing or invalid times,
  unspecified weekdays, invalid calendar dates, special hours without regular
  hours and invalid overnight special periods. Closed dates omit ignored fields.
  Current Google discovery revision 20260928 and REST reference were inspected.
- Creation readback now requests both hours fields and compares their exact
  approved period sets. Provider reordering, omitted zero values, false closure
  flags and same-date end defaults are accepted; missing/changed periods leave
  creation unresolved, without linking or sending another creation request.
- Thirty-six focused unit tests and all thirty-five standalone creation
  integration scenarios passed, including four new readback scenarios and
  invalid-hour rejection before provider access or draft persistence.
- All thirty onboarding browser scenarios passed. The three new hours journeys
  passed again with mobile keyboard selection and expanded visual evidence:
  saved controls/review plus regular/custom-special validation states at 375,
  768 and 1280 pixels. Scoped Axe and overflow checks passed. Initial visual review
  found missing custom/error state captures, not a product defect. Captures were
  expanded and repaired to avoid sticky-footer occlusion and closing animations.
- Typecheck, changed-file ESLint, webpack production build, standalone preparation,
  empty-database migrations through 0064, runtime-role setup and diff checks passed.
  Both fresh independent visual reviewers passed all twelve current captures;
  reports are `.omo/evidence/onboarding-hours-final-integrity-gate-review.md`
  and `.omo/evidence/onboarding-hours-final-pixels.md`. These component crops
  establish the enumerated component states; they do not independently establish
  normal-height full-page sticky-footer clearance. Browser actions ran at normal
  height, with expanded height used only for complete evidence captures.
- Additional service-hour category discovery/selection, direct accessible-match
  linking, verification, unresolved-identity reconciliation and remaining WP1-WP9
  work stay active. Deployment and eligible live-provider acceptance remain pending.

Creation additional service hours backend increment (2026-09-29):

- Creation drafts and frozen reviews now accept typed `moreHours` schedules
  with exact provider `hoursTypeId` values. One schedule per type is required;
  empty schedules, duplicate types and overlapping weekly periods are rejected.
- Saved-category metadata preserves `moreHoursTypes` and their English/localised
  labels. The existing revision/account-bound discovery endpoint supplies these
  values. Validation and creation both refresh metadata across all proposed
  categories and reject unsupported types before a provider creation write.
- Independent creation readback requests `moreHours` and compares exact type
  identities and period sets. Reordering and omitted midnight zeros are accepted;
  missing, duplicate or changed schedules remain unresolved without another write.
- Sixty-four focused unit tests and fifty-eight standalone integration scenarios
  passed across onboarding creation and category metadata. These include supported
  additional-category IDs, invalid metadata, unsupported types before validation,
  eligibility revoked after approval, reordered readback and missing-schedule
  readback without duplicate creation. Typecheck, changed-file ESLint, webpack
  build/standalone preparation and fresh migrations through 0064 passed locally.
  All twenty-one metadata/eligibility scenarios passed again after final test
  assertions, including the stable unsupported-hours error response.
- The service-hour selection controls, readable review presentation and browser
  evidence are still pending. This backend increment does not close the additional
  service-hour workflow or any milestone. Deployment and live acceptance are pending.

Creation additional service hours UI increment (2026-09-30):

- Setup now selects category-supported service-hour types from revision/hash-bound
  metadata, reusing the Services query. Failed discovery, changed category context
  and valid empty metadata are separate states. Saved unknown schedules remain
  visible and removable without converting their IDs or erasing other schedules.
- Exact weekdays and 24-hour times support overnight periods and multiple periods
  per service. Incomplete entries block save, matching, review and navigation.
  Removal preserves sibling periods/types; save/reload restores exact IDs and times.
  Frozen review displays exact type IDs beside readable period values.
- All 33 onboarding browser scenarios passed against the final webpack/standalone
  build. The three new service-hour journeys passed again after test-only additions
  for multiple periods, partial removal, cross-service overlap and popup captures.
  Mobile keyboard selection, metadata retry, category-context gating, validation
  retry, scoped Axe and document overflow checks passed.
- The primary executor opened all 18 final captures: failed metadata, invalid
  overlapping entry, saved schedules, frozen review, empty types and open chooser
  at 375/768/1280 pixels. An initial display-label capitalisation issue was fixed
  before the final build. Durable evidence and the recorded self-review are at
  `.omo/evidence/onboarding-additional-hours-2026-09-30/`. The installed OMO 5.1.4
  Codex compatibility workflow defaults to self-review; this is not an independent
  review receipt. Captures establish component states, not full-page sticky-footer
  clearance. No Lighthouse/performance score is claimed by this increment.
- Sixty-four focused unit tests, final typecheck, changed-file ESLint, webpack
  build/standalone preparation and fresh migrations/runtime-role setup passed.
  Server behavior is unchanged from the verified additional-hours backend increment.
  The runbook, feature map, architecture and provider-support notes were updated.
- Additional creation service hours now have local implementation and automated
  evidence. Direct accessible-match linking, verification, unknown-identity
  reconciliation and remaining WP1-WP9 work stay active. Deployment and eligible
  live-provider acceptance remain pending; no real Google/email write occurred.

Accessible-match discovery backend increment (2026-09-30):

- Added saved-draft owner/admin GET discovery, shared request/response contracts,
  client adapter and exact identity correlation. This works with zero local
  listings and requires the current draft revision and match observation time.
- Fresh selected-account proof precedes account-scoped pagination. Pages are
  parsed at the provider boundary; invalid identities, duplicate resources,
  repeated page tokens and unfinished 100-page discovery return errors. Empty
  account results remain distinct from failed discovery.
- Only exact nested resource names or provider metadata place IDs correlate.
  Titles, address similarity and search-resource prefix replacement are not
  access evidence. Ownership URLs do not deny access. Conflicting identities
  and multiple matching place resources remain unconfirmed or ambiguous.
- Local access, draft revision/hash, connection/client assignment, search identity
  and creation-started state are rechecked after provider discovery. Stale,
  expired, superseded, revoked and cross-tenant cases cannot return candidates.
- Twenty-two focused unit tests passed (16 new identity/page cases and six
  neighbouring onboarding/chain cases). Twenty new standalone integration cases
  passed against the final webpack build in 7.03 seconds, using disposable
  PostgreSQL and a Google stub. Coverage includes a page-two accessible match,
  zero mappings, ownership URL, empty/ambiguous data, malformed/duplicate pages,
  token loops, the 100-page limit, concurrent edits/rematching/revocation/creation,
  stale/expired searches, cross-tenant/viewer rejection and unconfirmed accounts.
- Final typecheck, changed-file ESLint, webpack/standalone preparation,
  fresh migrations through 0064, runtime-role setup and diff checks passed.
  The supplemental skill AST audit could not run because the installed
  TypeScript 5.9 package lacks its required unstable TypeScript API. No compiler
  upgrade was made. Evidence: `.omo/evidence/onboarding-accessible-matches-2026-09-30/review.md`.
- This is read-only discovery; no local mapping, provider creation, link approval
  or live-provider outcome is claimed. The API adapter is not yet wired to new
  setup controls. Direct match-link review, durable claim, execution and recovery
  remain active programme work. Deployment/live acceptance are pending.

Exact accessible-match review/approval increment (2026-09-30):

- Added immutable local match-link review contracts/store, owner/admin preview,
  restore and approval routes, plus shared API adapters. No generic name-upsert
  route or provider creation validation is used to represent a local mapping.
- Reviews freeze draft revision/hash, search identity/time, exact account and
  connection/client assignment, exact provider readback, proposed local name,
  existing external identity and collision codes. Unknown verification is null.
  Collisions include inactive prior links and hidden global webhook assignments;
  no other tenant identity is disclosed and conflicted reviews cannot be approved.
- Approval refreshes selected-account membership and resource readback, enforces
  current two-person policy and current initiating/approving actor access, and
  rechecks draft/search/mapping state after provider I/O. Changed baselines,
  stale hashes, expiry, revoked access or concurrent edits block approval.
- Migration 0065 has forced RLS, a composite organisation/draft foreign key and
  runtime update grants limited to approval actor/time. Retention cascades with
  the existing parent draft's 180-day purge; approvals expire after 24 hours.
- Seven new contract cases plus 16 discovery cases passed. Thirty-one new
  standalone review cases passed in 7.52 seconds; the same final build also
  passed the existing 20 discovery cases. Runtime tests prove tenant isolation,
  immutable frozen fields and rejection of cross-tenant parent references.
  Collision, two-person, revoked/stale/provider-change and concurrent approval
  cases passed, with no local mapping or Google mutation created by approval.
- Typecheck, changed-file ESLint, webpack build/standalone preparation and diff
  checks passed. Fresh migration replay through 0065 and prior-schema upgrade
  with an existing draft passed; the draft remained present and the new table's
  enabled/forced RLS was independently read back. Disposable PostgreSQL only.
- Backend review/approval is implemented and locally verified. Setup controls,
  durable link execution/recovery and serialization of the actual link claim
  against creation remain active work. Deployment and live-provider acceptance
  remain pending. Evidence: `.omo/evidence/onboarding-match-link-review-2026-09-30/review.md`.

### 2026-09-30 — Durable approved existing-match execution

- Added migration 0066 and scoped match-link status/submit routes. Each immutable
  review owns one durable operation identity. Pending/completed links exclude
  creation and another link through the shared draft lock and database triggers.
  Active links also block editing, matching and creation review paths.
- Execution refreshes exact account membership and provider baseline, rechecks
  current actors/policy/approval/mapping state and commits local/provider mapping,
  routing, client grants, initial sync, audit and result atomically. Collisions
  never merge names. Existing approved unlinked provider rows retain cached data.
- Failed transactions roll back mapping effects and support generation-bound
  same-intent retry. Status restores pending/linked outcomes; interrupted pending
  claims settle after two minutes. Concurrent duplicate submissions restore the
  same recorded result, including a reproduced discovery-after-link race.
- Final built standalone run passed all 130 cases across review/execution (52),
  discovery (20), onboarding/creation (37) and service metadata (21). Includes
  transaction rollback, competing create/link, runtime exclusion, client grants
  and real application process-stop/restart recovery without another creation.
- Thirty focused unit cases, typecheck, changed-file ESLint, webpack build and
  standalone preparation passed. Fresh migration replay and upgrade from 0065
  with an existing draft/review passed; independent readback preserved both and
  confirmed forced RLS. Disposable local database only.
- Backend execution/recovery is implemented and locally verified. Saved-match
  setup controls, browser/accessibility acceptance, deployment and eligible live
  outcomes remain pending. Evidence:
  `.omo/evidence/onboarding-match-link-execution-2026-09-30/review.md`.

### 2026-09-30 — Saved existing-match setup interface

- Account-access discovery now offers explicit selection only for accessible
  identities. Distinct local name, exact mapping review, policy-aware approval,
  acknowledgement, execution and saved outcome/review recovery are available
  from a persisted setup draft. Inaccessible, unknown, ambiguous and failed
  discovery states remain distinct; failed discovery does not justify creation.
- Draft editing, creation and another submission stay disabled while durable
  link status loads. Dirty link decisions share the navigation guard. A lost
  submission response refreshes recorded status; linked copy preserves the
  distinction between local mapping, queued sync and Google verification.
- Final built-standalone browser run passed 49 cases: 33 existing onboarding and
  16 match-link cases. Includes keyboard, reload, two-person policy, conflicts,
  expiry, failed recovery, pending navigation and blocked outcome-restoration
  scenarios. Scoped axe and overflow checks passed at 375/768/1280.
- Root directly inspected all 30 retained captures at those widths. Final
  webpack/standalone build, compiler and changed-file lint passed; 35 focused
  unit cases and 52 unchanged-backend review/execution cases passed. Fresh
  disposable PostgreSQL replay through 0066/runtime setup passed.
- This is local automatic and root visual/source evidence. No deployment,
  production migration or eligible live Google outcome is claimed. Full-page
  sticky-footer clearance, independent review and broad performance audits are
  outside these component captures. Evidence and limitations:
  `.omo/evidence/onboarding-match-link-ui-2026-09-30/review.md`.

### 2026-09-30 — Transient verification credentials and scoped completion

- Completion validates the selected listing's verification resource and a
  bounded non-empty PIN before Google or attempt writes. Immediate provider
  requests receive credentials; ordinary request/response/audit records exclude
  PINs, partner tokens and arbitrary nested echoes. Shared log/audit redaction
  recognises PIN field variants. Provider failures use static credential-safe
  copy while preserving recognised rejection codes and ambiguous outcomes.
- A regression failed on the previous standalone build. Final verification:
  33 focused unit/component cases and 11 built-standalone/database cases passed;
  webpack/standalone build, compiler and changed-file lint passed. A fresh
  disposable database replayed through existing 0066 and runtime setup.
- M2.9 remains partial: method-specific forms, eligible-option/context preflight,
  approval, independent state confirmation/recovery and historical credential
  cleanup remain required. Deployment and live Google acceptance are pending.
  Evidence: `.omo/evidence/verification-transient-2026-09-30/review.md`.

### 2026-09-30 — Typed verification choices and private-context discovery

- Added owner/admin scoped read-only verification-options GET/POST, current
  Google business-type/identity checks and typed private service context. Unknown
  business type remains unknown. Private context requires confirmed customer-only
  type and stays out of caches, attempts, audit, response and application output.
- Multiple destinations survive; option identity binds exact choice, resource,
  language and context hash. Typed input/destination rules preserve fixed versus
  editable email usernames and exact phone/SMS destinations. Missing, masked,
  unfamiliar or conflicting data offers an external choice rather than a start
  action. Partner and future methods remain explicit handoffs.
- Verification: 24 new and nine existing focused unit cases passed; 22 new and
  11 existing built-standalone/database cases passed. Webpack/standalone build,
  compiler, changed-file lint and fresh PostgreSQL/runtime setup passed.
- Forms, approval/current-policy/fresh-choice execution preflight, independent
  verification confirmation/recovery and historical credential cleanup remain
  required. No frontend, deployment or live-provider completion is claimed.
  Evidence: `.omo/evidence/verification-options-2026-09-30/review.md`.

Finish M0 with a complete current catalogue, capability detail and historical
presentation audit. Then M1 establishes approval,
confirmation, recovery and shared operational events before new bulk/scheduler
writers. Deliver M2 through M8 in the brief's order. Keep each row pending until
its own evidence exists. All remaining programme work is active, not deferred
or claimed complete by this initial change.

### 2026-09-30 — Immutable verification-start review and approval

- Migration `0067_verification_start_reviews` extends the existing change-set
  store. The exact method, destination, language, linked Google target, option
  identity and context hash are frozen for a 20-minute review. Existing review
  families retain their 24-hour expiry. Private context and the provider's postal
  choice are encrypted together; ordinary payload/baseline/audit records contain
  hashes and indicators rather than the private address. Runtime approval grants
  cannot update ciphertext or reviewed content.
- Owner/admin preview, restore and approval routes use shared typed contracts.
  Restore checks target, membership, policy, expiry, hashes and authenticated
  decryption. Approval refreshes eligibility under the exact language/context and
  preserves the current two-person policy. Preview and approval issue no Google
  verification mutation and create no management attempt.
- All 79 built-standalone/database cases passed across review, option discovery,
  transient credential, attribute and canonical management suites. Focused unit
  checks passed 33 cases; compiler and changed-file lint passed. Empty-schema
  migration replay and a separate 0066-to-0067 upgrade passed. The upgrade preserved
  all three existing approved review families, forced RLS and immutable private
  data; repeated migration was a no-op. Evidence:
  `.omo/evidence/verification-reviews-2026-09-30/review.md`.
- M2.9 remains partial. The existing method-only administration start mutation/UI
  have not yet moved to the reviewed execution path. Approved execution must
  recheck policy/access/connection/flags and fresh eligibility immediately before
  the single provider request, then independently observe verification state and
  preserve uncertain outcomes without blind resubmission. Forms, external handoff,
  state recovery and reviewed historical credential cleanup remain required.
  Deployment, eligible live-provider acceptance and the full remaining programme
  retain their separate pending evidence levels.

### 2026-09-30 — Independent verification-state observation

- Added typed owner/admin `verification-state` GET, client adapter and observer.
  It reads the complete verification pagination chain (bounded at 20 pages/2,000
  resources), rejecting malformed/foreign/duplicate identities, repeated tokens
  and incomplete history. It does not return a misleading partial history.
- Provider request phases and merchant standing are separate. A completed
  verification can coexist with merchant review; absent or future enum/boolean
  values retain unknown semantics. Merchant read failures preserve otherwise
  valid history with an explicit separate error. Provider echoes, credentials,
  private context and recommendation details are stripped rather than persisted.
- Current manager membership/role, linked target, active account, connection
  status and credential generation are checked before and after observation.
  Read-only refresh remains available while publishing is paused. No write,
  attempt settlement, cache write or business/public-display success is implied.
- Final standalone run passed 67 cases across state, reviews, options and
  transient credentials; 21 are new state cases. Focused unit checks passed 54
  cases, including 21 new projections. Final compiler, changed-file lint,
  webpack/standalone build, fresh schema replay and runtime setup passed. Evidence:
  `.omo/evidence/verification-state-2026-09-30/review.md`.
- The observer is not yet connected to approved execution or durable attempt
  recovery. Those paths, method-specific forms, external handoff, PIN recovery,
  historical credential cleanup and all remaining programme/release/live checks
  remain required. M2.9 stays partial.

### 2026-09-30 — Approved verification-start execution and recovery

- Added typed execute/status/refresh routes and client adapter. One durable
  management attempt is claimed per approved review under a per-location lock;
  retries return that attempt and never send a second start for the same review.
  Competing unresolved verification attempts, including legacy rows, block new
  starts. No Google idempotency guarantee is invented for this API.
- Reviews now also bind current credential generation and an independent
  verification/merchant-state hash. Approval and execution share fresh baseline
  checks. Expiry, policy, current initiating/approving manager, exact input/target,
  connection and publishing flags remain authoritative before a new request.
  Pending, already-standing, waiting and unknown Google states block another start.
- The immediate provider request uses the decrypted reviewed method/context;
  ordinary attempt/audit records contain public reviewed fields and identifiers
  only. Provider response identity/state fields are sanitised. Execution accepted,
  independent request confirmation, request phase and merchant standing remain
  separate. Confirmation requires the exact returned verification identity and
  reviewed method to appear in an independent read with a known request phase.
- Lost/malformed/foreign responses remain unknown without exact identity; a new
  completed history row or merchant standing alone cannot identify which request
  applied. Recovery is read-only, works after review expiry/policy change and while
  publishing is paused, and checks interrupted claims after five minutes. Saved
  status survives disconnect; failed refresh retains prior confirmed evidence/time
  with an explicit refresh-unavailable outcome. Audit records retain request,
  rejection and observation events; shared settlement stamps terminal outcomes.
- Final built-standalone run passed all 99 cases across execution, reviews, state,
  options and transient credentials, including 32 new execution/recovery cases.
  Focused units passed 54 cases; final compiler, changed-file lint,
  webpack/standalone build and fresh PostgreSQL/runtime setup passed. No new
  migration is required. Evidence:
  `.omo/evidence/verification-execution-2026-09-30/review.md`.
- Existing method-only administration start/PIN controls are not yet migrated to
  this path. A confirmed start request is not verification completion or public
  display. Method-specific UI, external handoff, reviewed/scoped PIN completion
  with independent confirmation, expiry/failure recovery and historical credential
  cleanup remain required. The whole WP1-WP9/M0-M8 programme, release and eligible
  live acceptance retain their separate pending evidence requirements.

### 2026-09-30 — PIN completion preview and approval

- Added typed scoped completion preview, restore and approval with a transient
  PIN. An encrypted random HMAC key/commitment binds the exact normalized PIN and
  verification name; public reviewed payload binds its immutable encrypted bytes.
  The PIN is not persisted or restored. Pending method/request and credential
  generation are independently read and frozen, then rechecked for approval.
- Migration 0068 extends the existing review store with twenty-minute completion
  reviews, private storage checks and no public PIN/token/context. All four older
  approved review families, encrypted context, forced RLS, runtime immutability,
  retention and legal holds are preserved in fresh/upgrade tests.
- Built standalone: 70 cases passed (25 completion reviews, 13 start reviews,
  32 start execution/recovery). Focused units: 25 passed. Final compiler,
  changed-file lint, webpack/standalone build and migration upgrade passed.
  Evidence: `.omo/evidence/verification-completion-reviews-2026-09-30/review.md`.
- This checkpoint performs no Google completion mutation. Completion execution,
  independent phase confirmation and recovery, internal UI migration, external
  handoff and historical credential cleanup remain required. M2.9 and the full
  WP1-WP9/M0-M8 programme remain active; deployment/live acceptance are separate.

### 2026-09-30 — Approved PIN completion execution and recovery

- Completion execute/status/refresh now connect exact approved PIN reviews to
  the existing location lock, management attempt store, observer and settlement.
  Fresh approval/PIN binding/pending baseline/actors/policy/target/connection/
  generation/flags precede the one durable provider claim; only transient PIN
  goes to Google. Replay and recovery never resubmit. Same-target unresolved
  completion blocks another claim; an unrelated lost start identity does not.
- Independent exact name/method COMPLETED confirms success; FAILED confirms
  terminal failure; PENDING/unknown/mismatched identity or method stays unresolved.
  Lost/foreign/malformed ACK can recover against the known reviewed target while
  execution remains unknown. Merchant standing remains separate. Status/recovery
  survive expiry/policy/paused writes/disconnect, preserve old confirmation/time
  on failed refresh, and guard interrupted claims with a five-minute window.
- Broader standalone: 104 cases passed across completion/start execution and
  reviews. Final expanded completion: all 37 cases passed, repeating 34 of those
  broader cases and adding target/foreign/malformed response coverage. Focused
  units: 62 passed. Final compiler, changed-file lint, webpack/standalone build,
  fresh PostgreSQL migration/runtime setup and independent cleanup passed.
  No new migration. Evidence:
  `.omo/evidence/verification-completion-execution-2026-09-30/review.md`.
- M2.9 remains partial: existing administration method/PIN UI and legacy clients
  require migration, saved review/attempt and external handoff controls plus
  browser acceptance, and historical credential cleanup. The full programme,
  deployment and eligible-account live acceptance remain active and separately
  evidenced; no real provider write is claimed by these fixture checks.

### 2026-09-30 — Saved verification workflow discovery and precise cursors

- Added owner/admin location-scoped GET, strict shared query/response contracts
  and typed client for start/completion reviews and recorded attempts. Filters
  apply before pagination and bind into a scope-specific cursor. Stable review
  time/UUID ordering survives execution between pages. Expired reviews are
  optional; recorded outcomes remain visible during disconnection/paused writes.
- Summaries omit credentials, private context/destinations, raw payloads and
  provider/error echoes. Current manager/linked scope applies; approval reasons
  reflect expiry, policy, actors, credentials, reconnection and publish access.
  Unknown stored methods use a safe UNKNOWN label and block summary approval.
  Detail/approval/execution retain their own authoritative preflight.
- Regression fixtures preserving actual PostgreSQL microseconds exposed driver
  timestamp rounding in both this index and existing unified activity cursors.
  Fixed both to bind timestamp text before PostgreSQL conversion. Assertions
  require exact seeded order, including UUID ties and inserts between pages.
- Final built standalone: 23 cases passed (21 workflow discovery, two unified
  activity). Compiler, changed-file lint and webpack/standalone build passed.
  No new migration or Google mutation. Evidence:
  `.omo/evidence/verification-workflows-2026-09-30/review.md`.
- M2.9 and the full WP1-WP9/M0-M8 programme remain active. Administration UI
  migration, external handoff, browser acceptance and historical credential
  cleanup remain required; deployment/live evidence remains separate.

### 2026-09-30 — Verification-start UI migration in progress

- Replaced method-only start mutation controls with fresh typed discovery,
  distinct option IDs/destinations, permitted email username edits, exact offered
  phone destinations, postcard contact and private service-business context.
  Changing language/context invalidates discovery. Unknown customer-only status
  requires context before preview. External methods hand off to Google.
- Preview, approval and explicit send are separate controls using reviewed APIs.
  Lost send responses disable another send until read-only saved-outcome/review
  recovery. Team saved reviews and recorded start outcomes can be reopened, and
  prior observation timestamps remain visible on failed refresh. Expired recorded
  attempts open without restoring an expired approval. Start acknowledgement is
  not represented as verification completion.
- Private discovery/review content stays in component memory; the TanStack cache
  contains only credential-free workflow summaries. No browser draft registration,
  storage, secret query key, legacy start write or automatic provider retry added.
- Focused domain/component checks: 55 cases passed across five files. They cover
  method-specific values, private context, exact preview/send, approval/gates,
  lost response, reload/team restoration and expired outcome recovery.
- This is not UI acceptance: built-browser, keyboard/reader, mobile/visual and
  independent review gates remain pending. PIN completion still uses the legacy
  UI, and the whole-screen observation/disconnection shell still needs migration.
  Evidence/next actions:
  `.omo/evidence/verification-start-ui-2026-09-30/review.md`.
- Full WP1-WP9/M0-M8 scope stays active; deployment/live acceptance is separate.

### 2026-09-30 — Reviewed PIN controls and completion recovery

- Replaced the legacy internal PIN write with exact pending-resource preview,
  approval, PIN re-entry and explicit submission. Preview and submission clear
  the PIN; approval, reload, reopening and review refresh cannot restore it.
  PIN changes require a fresh review; private provider/error echoes are not
  rendered. Action closures avoid PIN-bearing query/mutation caches or drafts.
- Saved start/completion indices now share a safe paginated component. Completion
  reviews and expired recorded outcomes restore through their own scoped APIs.
  Lost send response holds submission for read-only recovery, while definitive
  rejection supports an explicit corrected review. Current typed state refresh
  removes PIN entry when the request is no longer pending. External/future/AUTO
  pending methods hand off to Google and are not labelled waiting for a PIN.
- Shared action and expiry hooks retain single-action guards, safe static error
  copy, invalidation and timed approval expiry without changing backend semantics.
  Removed the acknowledgement-success toast and unsupported fixed-wait retry
  guidance. No legacy verification write remains in the internal control files.
- Focused component/domain verification covers all four PIN methods, leading
  zeros, clearing, re-entry/consent, second manager, changed binding, lost response,
  reload/refresh, expired saved outcome, rejected PIN, paused writes, external
  handoff and current-state refresh. Counts/results are recorded in:
  `.omo/evidence/verification-completion-ui-2026-09-30/review.md`.
- Final six-file suite: 74 cases passed, including 20 new PIN-control scenarios.
  Changed-file lint, final webpack/standalone build and sequential post-build
  typecheck passed. No new migration or provider call was made.
- This is not full UI acceptance: whole-screen independent merchant/history
  presentation and disconnected shell, built-browser, keyboard/reader/mobile,
  visual reviewer gates, historical cleanup and legacy endpoint closure remain
  required. Full WP1-WP9/M0-M8 scope and deployment/live evidence remain separate.

Existing checkout changes in `supabase/.temp/cli-latest`, `.omo/` and
`prompt-exports/` predate this programme and must be preserved.

### 2026-09-30 — Independent verification workspace and disconnected PIN recovery

- Internal verification no longer relies on the legacy administration read
  bundle. Known owner/admin session gates privileged content; unknown/failed
  capability or current observation checks pause writes while preserving scoped
  saved review/outcome recovery.
- Merchant standing, business authority, exact request phase and public display
  remain separate. Typed history keeps unknown states explicit, failed refreshes
  label retained observations, and the header suppresses its contradictory legacy
  Verified/Not verified Boolean. Approved PIN submission uses the shared ActionBar.
- Final 89 focused cases, changed-file lint, webpack/standalone build and
  sequential typecheck passed. Six built-app API-fixture browser journeys passed
  at375/768/1280, including keyboard consent, reload, lost response and disconnected
  recovery. Axe passed across the five captured verification states.
- Fifty fresh viewport/scroll captures passed both independent design/function
  and visual reviews with no blockers. Exact evidence, corrections and limits:
  `.omo/evidence/verification-workspace-ui-2026-09-30/review.md`.
- This is implemented/automatically verified evidence for the narrow workspace
  and PIN recovery increment. All start-method and real-backend browser scenarios,
  further accessibility/rendering cases, historical cleanup, deployment and live
  acceptance remain open. Full WP1–WP9/M0–M8 scope remains active.

### 2026-09-30 — Legacy verification bypass retirement and credential cleanup

- Administration start/completion compatibility requests now return 409
  `verification_review_required` before connection, provider or ledger work.
  Access-page reads retain null moved-workflow fields and make no verification
  calls or raw verification snapshot writes. Reviewed executors remain active.
- Additive migration 0069 redacts untyped legacy verification JSON and raw
  snapshots/audit metadata while preserving known provider identities/outcomes,
  ledger scope/actors/status/timestamps/retention and reviewed payload/hash/cipher
  bytes. Forced RLS, runtime grants and append-only audit protections remain.
- The complete migration chain passed on fresh isolated PostgreSQL 17; 0069
  also applied to the retained 0068 schema. Seeded cleanup tests prove malformed
  echo removal, reviewed/unrelated record preservation, hash consistency,
  transactional rollback and denial of runtime trigger suspension.
- Final webpack/standalone build, sequential typecheck, changed-file lint and
  52 unit/migration-contract cases passed. Final built-app compatibility,
  reviewed start/completion and cleanup regression: 76 cases/four files passed.
  Exact evidence: `.omo/evidence/verification-legacy-retirement-2026-09-30/review.md`.
- Implemented/automatically verified evidence applies to this increment only.
  Production migration/deployment, all-method and real-backend browser acceptance
  and eligible-account live verification remain pending. The full programme
  remains active.

### 2026-09-30 — Reviewed verification START: real-backend browser acceptance

- Approved start sends use the shared ActionBar with visible reasons for active
  work, missing consent, blocked reviews/access and uncertain outcomes. An active
  send does not display unavailable-response copy. Expired or changed reviews
  remain blocked; authoritative no-attempt recovery permits returning to methods
  without enabling the old review.
- Final production webpack/standalone build, sequential typecheck, changed-file
  lint and 52 component cases passed. The final 39-case browser matrix passed
  against real route handlers, sessions, tenant permissions and isolated
  PostgreSQL, with a local Google transport stub and no fulfilled app API mocks.
- EMAIL, PHONE_CALL, SMS, ADDRESS/private service context and AUTO journeys pass
  at 375/768/1280, with exact input, approval/consent, keyboard sending,
  independent readback, separate merchant standing and reload recovery. Eight
  further cases per width cover lost response/disconnection, expiry, policy
  change, rejection, slow-send navigation, second-manager approval and two
  external-only/unknown method handoffs. No successful write is replayed.
- All 156 fresh viewport/scroll captures passed two fresh independent visual
  reviewers, each inspecting every image. Axe and horizontal-overflow checks
  pass on every captured start-section state. Source/capture hashes, PNG
  signatures, dimensions and freshness were independently reproduced.
- The isolated test database was independently read back empty after cleanup,
  append-only triggers remained enabled and the owned cluster was stopped.
  Evidence: `.omo/evidence/verification-start-backend-ui-2026-09-30/review.md`.
- This closes the scoped START browser increment at implemented/automatically
  verified levels. Full real-backend PIN and combined START/PIN interactions,
  broader accessibility/rendering/performance, production migration activation,
  deployment and eligible-account live acceptance remain open. Full
  WP1–WP9/M0–M8 scope remains active.
