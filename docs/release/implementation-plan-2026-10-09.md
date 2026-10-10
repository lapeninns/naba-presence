# NabaPresence: complete implementation and migration plan

Status: active implementation plan (2026-10-09). Tracks against
`docs/release/ledger.md`. Base for new work: `origin/main` (not
`codex/pilot-admission-and-email`, which lands separately as PR #62).

## 1. Outcome, scope and architecture

Implement the fixes from the assessment, then complete billing, one-time post
scheduling and bulk editing across every currently supported Google listing
field family. Deliver the work through small, independently reviewable changes,
with a working application at each stage.

Keep Next.js, React, TypeScript, TanStack Query, PostgreSQL with tenant
isolation, Supabase Auth, the existing Google adapters, and the PostgreSQL job
queue. Retain Turbopack for development and webpack for production builds.

| Boundary             | Responsibility                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Identity and access  | Authentication, MFA assurance, organisation membership, location scope and action permissions |
| Listing management   | Canonical drafts, typed changes, revisions, approval policy and resource-specific publication |
| Provider integration | Google requests, rate budgets, response classification, independent readback and recovery     |
| Operations           | Durable jobs, schedules, batches, incidents, notifications and retention                      |
| Commercial access    | Stripe lifecycle, organisation entitlements, location limits and shared AI allowances         |
| Presentation         | Consistent editors, query state, accessible workflows and truthful outcome messages           |

Build on `lib/server/gbp-write.ts` (Google write pipeline) and
`lib/server/ai-credits.ts` (AI reservation ledger). Several older ledger
findings are already repaired in source (location-administration resource-name
validation, retired industry API removal, dependency upgrades); preserve those
repairs and update their evidence rather than duplicating fixes.

Hosted CI is currently blocked by the GitHub Actions budget; restoring it is an
external prerequisite for release qualification.

### Locked product decisions

| Area                  | Decision                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers             | Google first                                                                                                                                                               |
| Bulk operations       | All supported listing fields: business information, hours, attributes, menus, photos, posts, industry details and place-action links; correct existing bulk review actions |
| Location access       | Explicit `all` or `assigned`; assigned with no locations means no access                                                                                                   |
| Viewer role           | Read-only throughout the product                                                                                                                                           |
| Support impersonation | Disabled for the pilot, including existing support sessions                                                                                                                |
| MFA                   | Required for owners/admins before sensitive team, Google, publishing and billing actions                                                                                   |
| Subscription unit     | One subscription per organisation, business and agency modes; members share allowances                                                                                     |
| Billing               | Monthly subscriptions; 14-day card-required trial; cancellation at period end                                                                                              |
| Failed renewal        | Seven-day grace, then read-only access                                                                                                                                     |
| Commercial catalog    | Configurable offers; approved GBP prices, limits and allowances supplied before live activation                                                                            |
| AI allowances         | One trial grant and one grant per paid period; no rollover or duplicate reset                                                                                              |
| Scheduling            | One-time publication; missed or paused slots require a new time                                                                                                            |

Engineering defaults: plan changes take effect at the next billing boundary
without proration; no annual plans, top-ups or overage charging; existing pilots
keep explicit pilot entitlements until owner-initiated conversion; registration
stays controlled during the pilot; recurring publication, other providers and
campaign automation are later.

## 2. Packages

| Package                                       | Priority / effort | Acceptance criteria                                                                                                                                              |
| --------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 Release controls and developer baseline   | Immediate / M     | Full candidate checks execute; unexpectedly skipped required jobs fail; production promotion bound to the qualified SHA                                          |
| P02 Permissions, explicit scope and MFA       | Immediate / L     | Role/action matrix passes; assigned-empty grants no access; direct publication cannot bypass two-person policy; MFA cannot be bypassed via alternate auth routes |
| P03 Retry-safe mutations and recovery         | Immediate / L     | Same-intent retries return the same receipt; uncertain writes reconciled before repetition; successful-response decoding failures remain uncertain               |
| P04 Retention and privacy fulfilment          | Immediate / M–L   | Fleet > one page completes its walk; expired reviewer photos and AI usage covered; interrupted fulfilment resumes                                                |
| P05 Operational truth, monitoring and reports | Foundation / M–L  | Never-started jobs alert after grace; failed refreshes preserve last-success time; partial reports disclose missing coverage                                     |
| P06 Editor, navigation and accessibility      | Foundation / M–L  | Dirty drafts survive refetches; close/navigation guards; truthful logout failure; keyboard/mobile journeys pass                                                  |
| P07 Billing, entitlements and AI periods      | Product / XL      | Full sandbox lifecycle; duplicate events cannot duplicate grants; expired subscriptions restrict new work; pilots never auto-charged                             |
| P08 One-time scheduled posts                  | Product / M–L     | Exact approved content/time published; revoked access blocks dispatch; missed/paused slots never auto catch up                                                   |
| P09 All-field bulk management                 | Product / XL      | Every supported family has preview, approval, durable execution and recovery; mixed outcomes truthful                                                            |
| P10 Hosted qualification and rollout          | Release / M–L     | Candidate-bound checks, provider evidence, recovery drills and soak pass before activation                                                                       |

### P01 — Release and development controls

- Restore Actions (external), rerun CI and CodeQL on the candidate.
- CI aggregation requires success for every job applicable to a change; skips only where the workflow plan explicitly permits them.
- Require review and successful checks; remove routine admin bypass from the release path.
- Bind production promotion to the tested commit and build artifact; record configuration and migration receipts separately.
- Standardise local, CI and hosted execution on Node 24, current pnpm, webpack standalone build.
- Startup schema-compatibility assertion so incompatible code fails before serving.
- Exclude saved evidence trees from lint and source discovery without deleting evidence; fix current app warnings.
- Refresh architecture, feature, cron and runbook docs; archived plans stay historical.

### P02 — Authorisation and MFA

Shared server/domain action guards; route visibility never authorises a mutation. Across individual, bulk, scheduled and recovery entry points:

- Viewers read only; no editing drafts, rejecting posts, assigning reviews or changing triage.
- Draft editing and approval requests need a non-viewer role and location access.
- Approve/reject/publish need publication authority.
- Two-person policy applies to every publication path including direct publish; approval binds to exact content revision and author.
- Workers recheck membership, location scope, publication grant, connection identity, policy and entitlement before new dispatch.

Explicit membership and invitation scope (`all` | `assigned`). Preserve per-location publication grants and invitation token/expiry/email matching. Scope and grant changes commit atomically. Assigned invitation whose targets disappeared fails explicitly.

As built (P02-S4), the scope is read per check inside the tenant transaction, filtered by the tenant's organisation; there is no `Session.locationScope`. P06-2 (client cache reset) and P02-S8 use P02's `securityVersion` as the scope fingerprint, not a session scope field. The staging/production shadow observation was not done: the read-only check in `docs/runbook.md` ("Membership scope switch") or an owner sign-off replaces it before deploy.

Supabase TOTP enrollment/challenge/verify; carry verified assurance into app opaque sessions.

- Enrolled users complete MFA before getting an ordinary session.
- Owners/admins must enroll and have verified within 15 minutes before sensitive actions.
- Existing sessions become AAL1; reading, enrollment, export and invoice viewing still allowed.
- Record identity, assurance, factor, verification time, proof expiry, security version.
- Apply to password login/reset, invitations, callbacks, workspace switching.
- Backup second TOTP; audited operator recovery outside app runtime that invalidates sessions and requires fresh enrollment.
- Scheduled/bulk approvals record the verified authorisation at approval time; workers check security version and permissions, no interactive challenge.

Support sessions: default-off flag disables issuance and resolution; audited release operation revokes outstanding ones.

Also: shared same-origin protection for session-authenticated mutations, PostgreSQL-backed distributed abuse limits, HTTP/S URL validation, URL-aware secret redaction, one CSV formula guard. Keep cron/webhook auth.

### P03 — Mutation lifecycle

Stable operation identity distinct from request ID. Record organisation, actor, action, target, payload hash, expected revision, approval, connection generation, result. Same key+input → same result; same key different input → 409. Provider calls outside DB transactions; persist intent before dispatch. Post-dispatch timeouts, unreadable bodies and malformed success responses are **uncertain**; confirmed rejection is failed; uncertain creates are not blindly repeated.
Readback adapters: normalized field compare for profile, hours, attributes, industry; posts compare content incl. event/offer and language; keep menu replacement verification; media checkpoints with reconcile-or-human-resolution; generic recovery jobs for listing mutations.
States: saved locally, sent, confirmed applied, awaiting confirmation, rejected, failed, uncertain. "Live on Google" only when provider state supports it.

### P04 — Retention and privacy

Dispatcher every 5 min; daily cycle start 03:00 UTC; persisted cursor; unique per-org work; resume unfinished cycles; bounded resumable SQL batches; track enumeration, success and failure separately. Add reviewer profile-photo redaction and 13-month AI usage retention; deletion controls separate from redaction controls. Provenance-aware dataset inventory; 30-day default cache for Google-derived content; stop new persistent derived aggregates pending approval. Dry-run report and hold handling before new destructive cleanup. Resumable privacy withdrawals and exports; owner Data and privacy workflow.

### P05 — Operations

Last attempt vs last success per location/resource; cached response with refresh error does not advance freshness; bounded refresh jobs with time-budget checks; alert on never-completed ticks; protected readiness endpoint + GitHub Actions probe every 5 min; per-incident/recipient notification delivery with retry and evidence states; explicit telemetry export status; DB-backed pause controls checked at claim and dispatch (env switches remain hard overrides). Reports show expected vs covered locations, partial data, oldest complete watermark; missing ≠ zero.

### P06 — Interface

Audience-neutral auth copy; business/agency selection (business default) with controlled admission; app-sent invitations with send/resend, delivery state, copy-link fallback; consistent editor drafts keyed by user/org/resource/schema version; preserve dirty edits on refetch, conflict prompts, close/navigation guards; separate "Save draft" and "Publish to Google"; truthful logout failure with retry; one operation-outcome presentation; org/resource-scoped query keys, clear inaccessible cache on scope change; cursor pagination for growing lists; keyboard, focus, labels, contrast, announcements, mobile.

## 3. Product specifications

### Billing and AI

Stripe Checkout (subscription mode) + Customer Portal; app-controlled plan change and cancel. Records: versioned plan catalog; organisation billing state; billing event receipt; AI credit period; AI usage linkage. Billable locations = distinct linked Google locations, counted once; disconnected ones count until unlinked. Reject downgrade above limit; scheduled downgrade enforces pending limit on new links; never auto-unlink.
Lifecycle: pilot (explicit pilot access, calendar-month allowance) · trial (14 days, one allowance) · paid cycle (one allowance per period) · failed renewal 7-day grace (no new AI grant) · grace end/subscription end → read-only (billing, export, privacy, disconnect still available) · payment recovery restores and grants once · cancellation scheduled keeps access to period end. Failed first payment after trial gets no grace. Next-cycle plan changes, no proration (subscription schedules).
Webhooks: verify signature on raw body, persist receipt before ack, process async, fetch current provider state, serialise per organisation; hourly cursor reconciliation independent of Google sync flags.
AI: keep reservation → call → settlement; one draft credit per generation; verification consumes no customer credit but records usage; stable generation operation IDs; settle against original period; harden token-budget reservations on all provider paths; history unchanged, unknown allowances stay unknown; migration grants nothing; close legacy pilot period only on owner-initiated conversion; manual drafting available when credits exhausted; read-only status blocks new edits/drafts; owner Billing and shared Usage screens; "Confirming subscription" after checkout. Live checkout fails closed until catalog, tax, terms and production Stripe config exist; test offers visibly marked.

### One-time scheduled posts

Schedule record: post revision/payload hash, provider target, author, approver, approval ref, connection generation, security version, UTC instant, local date/time, IANA tz, offset, schedule version, state, deadline, lease, outcome refs. STANDARD/EVENT/OFFER. Earliest +5 min, latest +90 days; reject nonexistent DST times; ambiguous times need explicit offset; 5-minute dispatch window then missed; paused-when-due needs new time; edits invalidate approval; cancel stops unstarted work; recovery may resolve but never initiate a late create.

### All-field bulk management

Select locations → define changes → preview each target → approve exact actions → follow durable results. Limits: 50 locations, 500 items/batch, 10 new photos/location, existing 100-review limit; 2 concurrent bulk items per org; serialise same-resource writes. Preview read-only, expires 15 min; confirmation freezes items, payloads, revisions, masks, targets, assets, overrides and approval needs; dispatch expires 24 h after confirmation.
Family semantics: business info (patch selected fields, explicit clears, provider fields read-only); regular hours (selected weekdays; whole week needs 7 days); special hours (upsert/remove dates); more hours (selected type groups); attributes (stable IDs, false ≠ unset); menus (merge mapped nodes, full replacement, show removals, no label matching); photos (immutable owned assets, mapped categories); posts (independent drafts; publication approved separately); industry (typed allowlists, eligibility, readback); place-action links (explicit add/update/delete by stable identity); reviews (approval bound to draft ID and review update time, assignee eligibility, resumable outcomes).
Fix selective hours publication first; add attribute and industry readback first. Private Supabase Storage via server-only adapter (tenant checks in app); staging key → validate bytes/format/size/dimensions/SHA256 → immutable final key; purge staging after 24 h. Per-location Google media IDs. Blocked items shown; recheck permission/entitlement/connection/baseline before dispatch; stale → new preview; reconcile uncertain before retry; category changes precede dependent work.

### Public interfaces

Membership/invitation scope (legacy compat); mutation `intentId` + expected revision + receipt; `GET /api/operations/{id}`; billing APIs + signed webhook; schedule APIs; batch APIs; asset APIs; privacy APIs. Shared Zod contracts.

## 4. Migration and verification

1. Baseline. 2. Append-only schema. 3. Dual-write scope. 4. Backfill + shadow compare (any assignment → `assigned`, none → `all`; keep latent grants). 5. Switch readers (precondition: only scope-aware writers live, shadow compare clean; 0064 runs the now narrowing-only `reconcile_member_location_scope()` and adds triggers so older writers cannot leave a member holding rows on `all`); never return to absence-means-all. 6. Durable single-resource commands/readback before scheduling/bulk. 7. AI linkage migration without extra grant. 8. Org-level feature flags. 9. Paid access activated separately.
   Legacy schedule values → needs review, not jobs. Composite tenant-parent FKs with low-lock validation; rollback preserves receipts.

Verification: typecheck, lint, unit, webpack build, fresh/upgrade/no-op/concurrent migrations, integration, audit, secret scan, CodeQL, plus access, MFA, mutation, retention, billing, scheduling, bulk, UI and operations matrices (see package criteria).

Release gates: foundation → feature pilot → paid pilot → public paid release. Keep implementation, local checks, hosted checks, deployed revision, provider acceptance and customer outcome as separate evidence columns.
