# NabaPresence Public Paid SaaS Production Readiness Plan

Execution ledger: docs/release/ledger.md

Prepared 9 October 2026. Target: public paid SaaS, with a controlled pilot before open customer onboarding. Baseline commit: `b22cda1bfed8b8ddc0a84222b022c4e832ab5139` on `main`.

NabaPresence has a working application, tenant isolation, durable Google publishing, and organisation-level AI credit accounting. A paid launch needs a complete commercial lifecycle, current provider support, dependable operations, and verification of real customer journeys. The release decision remains NO-GO until the gates in this plan have evidence for the candidate being released.

This is a plan, not authorisation to implement it, charge customers, send messages, change provider configuration, migrate production, or publish listing changes. Roles below describe responsibility; they do not imply that those people have been appointed. Estimates are planning allowances, not commitments.

## 1 Current baseline and gaps

| Area | Evidence from the 9 October assessment | Consequence for this plan |
| --- | --- | --- |
| Source and deployment | Clean checkout; Vercel production target READY; deployment metadata matches the baseline commit; public sign-in serves successfully | Reuse the current architecture. Verify the deployed candidate again at release. |
| Local validation | Typecheck, lint, 2,557 active unit/component tests, webpack build, and fresh-database migration/runtime-role preparation passed | Preserve these gates through every change. |
| Integration | Fresh database: 376/376 tests across 74 files passed | Keep disposable databases. Earlier reused-database run had two scheduler failures; isolated leases and the clean full run passed. |
| Browser verification | 13 authentication checks passed; three-step agentic reviews passed locally and on production | Full authenticated, mobile, billing, and provider journeys still need execution. |
| Hosted verification | CI and CodeQL jobs were prevented from starting by the GitHub Actions budget | Restore execution and require green checks for the candidate. A local pass does not clear this gate. |
| Dependencies | Production audit reported 4 critical and 27 high advisory findings, including Next.js 16.2.6 | Triage installed paths and applicability, upgrade affected dependencies, and retain the before/after audit. Advisory matches are not a complete exploitability assessment. |
| Operational configuration | Project production variables lacked operational email credentials/recipients, Pub/Sub verification identity/token, and an OTLP collector endpoint | Complete configuration and prove actual delivery, ingestion, monitoring, and recovery. Sensitive Vercel variables could not be read back through the environment pull; their blank export values are not evidence that runtime secrets are blank. |
| Runtime sample | Five jobs-runner requests returned 200; no recorded 5xx in the two-hour window inspected | Useful liveness evidence, insufficient for freshness, successful work, or a soak. |
| Commercial foundation | AI usage, draft reservations, settlement, exhaustion UI, organisation overrides, and token backstop exist | Extend existing accounting. Stripe subscriptions, checkout, customer portal, and paid plan enforcement are absent from the inspected source. |
| Google support | Industry code still constructs calls to Business Calls, HealthProviderAttributes, and InsuranceNetworks endpoints; old roadmap includes Q&A | Reconcile the feature catalogue with current Google support before advertising or selling these capabilities. |
| Product promises | Terms describe invitation-only access; public account creation exists; scheduling is deliberately absent from the post input contract | Align terms, onboarding, pricing, feature descriptions, and actual capabilities. |
| Release records | Live certification, connection soak, recovery rehearsal, and sign-off records remain incomplete and contain outdated topology references | Replace stale assumptions with current Vercel evidence and a candidate-bound release record. |

Current source should take precedence over older plans. In particular, the September billing roadmap places billing near the end; a public paid launch makes billing and entitlements prerequisites. The existing AI accounting is the starting point for paid allowances.

## 2 Launch definition and decisions

The first public release should serve business owners and agencies managing authorised Google Business Profiles. Sell the supported, verified subset of the current app. Additional channels, rank tracking, campaigns, advanced bulk editing, recurring publication, and enterprise SSO can follow unless they become explicit paid launch promises.

Before implementation, the product owner should resolve the following decisions in a short decision log. Independent infrastructure, security, and provider checks can proceed while commercial decisions are being resolved.

| Decision | Proposed starting position | What must be settled |
| --- | --- | --- |
| Paying unit | One subscription per organisation; separate business and agency packages only if their limits differ | Who pays when an agency manages multiple clients; whether client organisations need separate subscriptions |
| Pricing | Small number of fixed monthly packages based primarily on active locations, with a shared AI allowance | Prices, currency, location limits, member limits, included credits, support coverage, and advertised features |
| Trial | One finite organisation trial with an explicitly disclosed allowance | Trial duration, card requirement, abuse controls, and trial expiry behaviour |
| Annual billing | Defer until monthly billing works, or specify monthly credit grants within the annual term | Renewal date, cancellation, refund and grant timing; annual payment must not accidentally grant twelve usable months of credits immediately |
| Extra credits | No automatic paid overage in the initial launch | Whether optional prepaid top-ups are needed; expiry and refund rules if introduced |
| Payment failure | Time-limited grace followed by restricted service | Duration, reminder schedule, restrictions on new provider work, and access to billing, exports, privacy requests and disconnection |
| Cancellation | Clear self-service cancellation with an explicit effective date | Immediate versus period-end cancellation; access, queued work, export window and deletion schedule |
| Geography | Initially UK business customers, with explicit expansion later | Legal entity/operator, tax treatment, service region, data transfers and customer eligibility |
| Production scale | Define a launch ceiling for organisations, active locations, users, reviews, and concurrency | Staging fixtures, admission limits, capacity headroom and upgrade triggers |
| Feature catalogue | Only currently supported and independently verified operations | Decide whether scheduling, bulk changes and industry features are launch promises or deferred items |

Recommended pricing principle: members of the same paying organisation share its allowance. Adding employees must not multiply credits or entitlements. Use measured costs to set prices; this plan does not invent a price or margin.

## 3 Release gates and ownership

P0 denotes a blocker to opening paid public signup. P1 denotes work required for the advertised launch scope or operational targets. P2 denotes later improvements that can be deferred without contradicting product promises.

| Gate | Required outcome | Responsible role | Depends on |
| --- | --- | --- | --- |
| G0 Scope and provider eligibility | Approved feature/price catalogue, Google policy model, commercial decisions, and current evidence ledger | Product owner with provider/legal input | Baseline inventory |
| G1 Secure and repeatable candidate | Addressed dependency risk, reviewed boundaries, green CI/CodeQL, reproducible migrations/build and isolated staging | Engineering and security reviewer | G0 decisions relevant to scope |
| G2 Customer and commercial lifecycle | Working signup, email, organisation provisioning, checkout, subscription lifecycle, entitlements and cost controls | Engineering, product and QA | G1 foundations and pricing decisions |
| G3 Advertised product verification | Full applicable role/browser matrix and eligible live Google operations verified | QA and pilot operator | G1 and relevant G2/product work |
| G4 Operational recovery | Monitoring and alert delivery, capacity evidence, restore/rollback drills, privacy fulfilment and support procedures | Operations, engineering and privacy reviewer | Stable G2/G3 candidate |
| G5 Controlled paid pilot | Approved limited live purchase plus pilot journeys; soak and failure-recovery criteria pass | Product owner and pilot operator | G0–G4 |
| G6 Public paid launch | Candidate-bound approval, honest public pages, admission limits and incident coverage | Product owner as release decision maker | G5 and all mandatory evidence |

An unresolved account approval, test account, tax decision, or provider permission stays pending. Marking code implemented or an API response successful does not satisfy deployment, independent provider readback, public visibility, or delivery requirements.

Preserve the existing six-role release approval requirement: product, engineering, QA, security, operations and pilot owner must each record GO for the same candidate. Any change to that governance belongs in PR01 as an explicit decision; this plan does not weaken it. Include privacy and accounting review where their decisions affect the launch.

## 4 Work packages

### PR01 Establish the current release ledger and product catalogue

Priority P0. Owner: product and engineering. Scope: `docs/requirements-matrix.md`, `docs/frontend-backend-feature-map.md`, `docs/sprints/2026-09-18-platform-roadmap.md`, and `docs/live-certification/`.

Inventory actual routes, roles, API operations, background jobs, migrations, Google endpoints and marketing claims. Record each capability as supported and verified, implemented but awaiting evidence, unavailable, or deferred. Replace obsolete references to no Git remote, container-image deployment and retired provider features. Preserve archived plans as history rather than applying their instructions.

Create a maintained acceptance ledger with task ID, priority, owner, dependencies, code status, automated evidence, deployed SHA, live-provider evidence, customer-visible outcome, residual risk and decision. Keep restricted traffic and tokens outside the public documentation and Tailwind scan paths. Require source/candidate changes to identify which earlier evidence must be rerun.

Acceptance: every advertised paid feature has an owner, implementation location and explicit verification requirement. There is one authoritative launch checklist for the actual Vercel topology.

### PR02 Resolve dependency risk and review security boundaries

Priority P0. Owner: engineering and independent security reviewer. Scope: `package.json`, `pnpm-lock.yaml`, Next.js configuration, shared route/session/permission modules, support access, public token links and provider transports.

Reproduce `pnpm audit --prod --audit-level high`; map findings to installed dependency paths, shipped runtime paths, affected platform/features, and available fixes. Update Next.js and related dependencies to a supported patched combination selected from current official advisories at implementation time. Consult the installed Next.js guides before API/configuration changes. Keep the production build on webpack and retain Node/package-manager compatibility.

Separate build-time tools from production dependencies where justified; the current production tree includes tooling such as shadcn and its transitive packages. Avoid forcing transitive overrides without compatibility evidence. Keep exception records narrow, dated and reviewable; an advisory suppression is not a repair.

Review tenant boundaries, object-ID guessing, visibility grants, role changes, public report tokens, uploads/URLs, exported CSV, request-origin protections, token encryption/rotation, OAuth state/PKCE, logging and session expiry. Preserve deliberate location-assignment semantics until the product owner chooses changes. Replace or constrain shared-secret support impersonation with named operator identity, MFA, short sessions, visible customer context and audited reasons; disable the feature for launch if those controls are not available. Verify provider-account MFA and recovery access. Resolve the historical secret-rotation follow-up in `docs/ci.md` using actual owner confirmation.

Acceptance: no unaccepted reachable critical/high issue; all audit findings have a disposition; negative isolation and support-access tests pass; secrets and customer content do not appear in client bundles or evidence; an independent review covers security-sensitive changes. This package includes scheduling a security assessment, not claiming that one has already been performed.

### PR03 Restore hosted CI and control production promotion

Priority P0. Owner: engineering/operations. Scope: `.github/workflows/`, `scripts/ci/`, `scripts/vercel-ignore-build.mjs`, migration scripts and Vercel project settings.

Resolve the GitHub Actions budget restriction and prove CI and CodeQL can execute. Verify actual branch/ruleset enforcement of `CI result`, review requirements and bypass rights. Keep all jobs required for code changes; a docs-only optimisation must not skip application changes. Add or verify a production dependency audit gate and an explicit migration/build/integration/browser gate.

Choose a controlled promotion path: build/review a candidate, pass its checks, apply compatible migrations through the approved operator procedure, then promote that candidate. A Vercel READY build must not be promoted automatically while required checks are blocked. Keep direct CLI deployments visible and constrained. Record Git SHA, deployment ID, migration versions/checksums and approved configuration as the release record.

Use a separate hosted staging database, Auth tenant, Stripe sandbox and approved Google test/pilot resources. Preview deployments must not inherit production credentials or run against active customer data. Use ephemeral PostgreSQL databases for automated test suites, including independent full reruns; do not reuse a failed test database and interpret fixture interference as a product defect.

Acceptance: one green full CI run on the candidate; CodeQL completes; production promotion honours checks; clean-install and upgrade migrations pass; stage/preview isolation is demonstrated; the previous deploy and migration compatibility are recorded.

### PR04 Make registration and account recovery dependable

Priority P0. Owner: engineering, operations and QA. Scope: `lib/server/password-auth.ts`, `email-auth.ts`, `session-store.ts`, auth/invitation routes, `supabase/templates/`, auth components and provider settings.

Configure branded application URLs, exact confirmation/recovery redirects, email confirmations and custom SMTP in hosted Supabase Auth. Disable email link tracking that alters one-time links. Test email-scanner behaviour, replay, expiration, second-device confirmation, password changes and invalid-link recovery. Supabase's default mail service is intended for non-production use and restricts recipients; use [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Prove clean public registration, organisation provisioning, business/agency selection, invitations to the correct organisation, switching between organisations, logout-all, absolute/idle expiry, revoked membership and connection persistence. Align terms with public self-service registration. Consider MFA/step-up for sensitive owner actions; if required for launch, account for the app's own session issuance rather than assuming Supabase MFA automatically protects it.

Add distributed application-level limits for login, signup, resend, recovery, invitations, expensive lookups and AI operations. Use trusted client-IP extraction, per-identity and per-organisation controls, consistent `429`/retry information, abuse telemetry and bounded storage. Avoid exposing account existence through different rate-limit responses. Introduce CAPTCHA where it materially limits abuse without breaking accessibility.

Acceptance: actual confirmation/recovery/invitation messages arrive at controlled external recipient accounts; redirects and tokens work; duplicate signup and cross-device login preserve identity; expired/replayed links fail safely; public endpoints cannot generate unbounded mail or provider costs.

### PR05 Certify Google access and current capabilities

Priority P0. Owner: integration engineering and authorised pilot operator. Scope: Google Cloud/OAuth/Pub/Sub configuration, `lib/domain/google-contract.ts`, `lib/server/google/`, `industry-management.ts`, capability contracts and corresponding UI.

Verify the API project's access approval, OAuth publishing/verification status and scope, authorised domain/redirects, quotas, token refresh and current customer authorisation model. Resolve how business customers and agencies use the service under Google's third-party policies before opening signup. Confirm ownership of the Google Cloud project and escalation access.

Configure a dedicated Pub/Sub topic/subscription, dead-letter handling, exact OIDC audience and pinned service-account identity. Keep webhooks explicitly disabled until authentication and delivery are proven. Polling may be used during development, but its freshness and scale must be measured and described honestly. Verify RISC registration where supported and document the refresh/API-call fallback for revocation detection.

Remove active reads, writes, notification subscriptions, capability promises and UI controls for retired APIs. Introduce a central support catalogue and transport guard with a stable unsupported/retired response; historical stored records can remain explainable and read-only. Google has discontinued Q&A and the Business Calls API, and retired HealthProviderAttributes, InsuranceNetworks and location-association methods. Do not label all healthcare or lodging features retired; assess each endpoint separately. See the [official deprecation schedule](https://developers.google.com/my-business/content/sunset-dates).

Run eligible pilot flows: connect/discover/link, paginated backfill, new review delivery, deep reconcile, access loss, revoked grant, reconnect, disconnect, and readback of supported approved changes. Preserve prior specific user consent, explicit approve/send boundaries, changed-field semantics and sibling provider fields. Google's [API policies](https://developers.google.com/my-business/content/policies) require authorised access and specific consent for triggered actions. Review storage, indexing and aggregation uses against those policies; the current 30-day purge alone does not establish policy compliance for every dataset or derived metric.

Acceptance: a current support/eligibility table; no retired endpoint is called; independently verified live provider outcomes and redacted fixtures; no duplicate write after a timeout; permissions and consent survive neither a stale payload nor a changed target silently.

### PR06 Implement subscriptions and entitlements

Priority P0. Owner: billing engineering, product and QA. Proposed scope: new billing contracts/domain/server modules, billing routes/UI, append-only migrations, Stripe configuration and tests. Existing tenant/auth primitives remain authoritative.

Use Stripe Billing with hosted Checkout Sessions in subscription mode and a Customer Portal. Select the current supported SDK/API version when implementation starts, pin it and pin webhook payload expectations. NabaPresence is selling its own SaaS subscription; Stripe Connect is unnecessary unless an explicit marketplace model is added. The proposed integration follows [Stripe's subscription design guidance](https://docs.stripe.com/billing/subscriptions/design-an-integration).

Proposed data model: organisation-to-customer mapping, plan/version catalogue, provider subscription snapshot, application entitlement state, billing event inbox, scheduled entitlement changes, allowance grants and audited support adjustments. Provider IDs need uniqueness and explicit environment separation. Every new tenant table must preserve forced RLS and runtime-role constraints.

Checkout must derive organisation and authorised actor from the session, validate a server-controlled Price allowlist, reject mismatched customer/organisation ownership, and use idempotency keys. A success redirect shows progress; it never grants access by itself. Prevent duplicate active subscriptions from concurrent tabs or retried checkout. Portal sessions are created server-side for an authorised billing administrator.

Receive Stripe events with raw-body signature verification before normal JSON parsing. Store a unique event receipt durably and process it through a retryable worker. Verify account, environment, object-to-organisation mapping and price/version. Do not trust browser-supplied subscription state or arbitrary metadata as tenant authority. Duplicate and out-of-order delivery must converge on current provider state; event timestamp alone is not an ordering guarantee. See [Stripe webhook handling](https://docs.stripe.com/webhooks).

Define which successful billing events create allowances. A paid proration or upgrade invoice must not automatically refill a whole period. Use unique organisation/service-period/grant-type keys, with provider invoice references, to prevent duplicate business grants across distinct events. An annual payment schedules the agreed monthly grants rather than releasing the annual allowance at once. Reconciliation must preserve spent credits and deliberate adjustment history.

Define application behaviour for trial, active, incomplete initial payment, payment requiring action, past due/grace, unpaid, paused, scheduled cancellation and ended subscription. Handle renewal, failed/finalisation-failed invoices, upgrades/downgrades, proration, refunded payments and disputes. Reconcile provider subscriptions and missed events regularly; keep reconciliation observable and bounded. Queue poison events for support rather than silently dropping them. Subscription lifecycle processing follows [Stripe's event guidance](https://docs.stripe.com/billing/subscriptions/webhooks).

Enforce paid entitlements on server routes and again when background work is claimed. Limits cover active locations, members/client scope where sold, AI allowances and advertised advanced features. Bound cache staleness and propagate restriction to new work. Preserve receipts and reconcile any provider action already sent when a state change occurs. Permit controlled billing repair, privacy/export and disconnection after restriction. Define whether pending approved Google work is cancelled, paused or allowed to finish; payment failure must not silently keep creating chargeable work.

Acceptance: sandbox checkout, renewal, retry, upgrade, downgrade, cancellation, refund/dispute handling and reconciliation pass with exact database assertions. Tampered prices, other-tenant customer IDs, duplicate checkout, forged signatures, duplicate/reordered events and worker crashes fail safely. The owner UI explains the actual plan, effective dates, limits, invoices, payment actions and cancellation. The [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal) handles configured self-service payment and subscription changes with local state reconciliation.

### PR07 Extend AI credits into commercial allowances

Priority P0. Owner: backend/billing engineering and product. Scope: `lib/server/ai-credits.ts`, `ai-usage.ts`, drafting/verifying routes, credit contracts/UI, jobs and new grant/adjustment tables.

Retain the current organisation row lock, reservation-before-provider-call, detached settlement/release, model/token records and manual-reply recovery. Keep customer credits distinct from exact provider token/cost accounting. Current accounting uses UTC calendar months; choose and disclose whether paid plans use that calendar or subscription periods, then migrate deliberately. Do not reset existing customers twice at a billing transition.

Add durable plan/trial/top-up/support grants, immutable adjustment records, unique grant keys, effective periods and expiry. Reconcile the spending view to grants while preserving existing `ai_usage` history. Define failed generation, unusable output, semantic verification, manual text verification, re-verification and regeneration charging. Meter every provider-consuming path even where customer credit charge is zero.

Investigate settlement failure and stale reservations: current writes retry and log final failure, and a ten-minute reaper releases abandoned reservations. A paid service needs an operator-visible reconciliation path for uncertain provider cost, late settlement and repeatedly failing usage writes. Strengthen concurrent token/cost budgeting if concurrent verification can pass the current backstop before usage is recorded. Bound model input/output size, requests and provider timeouts; add per-organisation spend caps and platform budget alarms.

Acceptance: concurrent requests cannot exceed agreed entitlements unexpectedly; replay never grants or debits twice; new staff do not create extra allowance; exhausted AI still leaves the approved manual workflow available for an otherwise entitled customer; refunds/adjustments are auditable; unknown provider usage is visible; customer usage and accounting reconciliation agree under crashes and month/period boundaries.

### PR08 Verify database, migration and isolation safety

Priority P0. Owner: backend engineering, operations and security reviewer. Scope: migrations, `lib/server/db.ts`, `startup.ts`, permissions/session code and billing additions.

Read the live migration ledger with the correct identity. Compare committed versions/checksums with production and stage; successful fresh migration does not prove production is current. Verify the runtime role is non-superuser, cannot bypass RLS and has only needed privileges. Test tenant isolation under the actual hosted pooler topology, including SECURITY DEFINER helpers, cross-organisation switching, report shares, billing and support sessions.

Keep `DATABASE_URL` suitable for pooled requests and `DATABASE_SESSION_URL` suitable for advisory leases. Ensure locks are acquired/released on the correct connection and capacity is bounded across Vercel instances. Preserve application-owned sessions and review membership changes before access. Do not introduce a service-role credential into normal runtime operations as a shortcut.

Use expand/contract migrations, compatibility with the previous application, migration locks, from-scratch and upgrade tests, destructive-change review and a rehearsed recovery procedure. Production migrations remain controlled operator work rather than part of `next build`. Billing schema additions must not rewrite or drop unrelated data.

Acceptance: hosted boot safety, RLS/role checks, schema consistency, previous-version compatibility and migration concurrency are demonstrated. Follow the relevant [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) for platform security, capacity and recovery settings.

### PR09 Complete product scope and remove misleading promises

Priority P1, with any falsely advertised capability treated as P0. Owner: frontend/product engineering and integration owner. Scope: setup, business/agency navigation, listings, reviews, reporting, settings and public product/pricing pages.

Give a new paying user a coherent path from account creation through plan selection, authorised Google connection, eligible location choice, import progress and first useful action. Support interrupted setup, unavailable provider access, existing accounts, organisation switching and unsupported categories. Explain what payment unlocks before asking the customer to pay; provide a clear policy for customers whose Google access cannot be established.

Verify every advertised review, profile, hours, special-hours, media, post, menu and booking-link operation at its actual boundary. Keep submission, provider acknowledgement, independent readback and public Search/Maps visibility distinct. Fix fields that leak provider JSON or require developer knowledge. Preserve dirty drafts and handle stale revisions, partial failures, quota and reconnect states.

Post scheduling is currently absent from the write contract. Either defer it in all pricing/UI/docs or build a due-post claim, timezone/DST rules, durable approval, claim-time entitlement/permission checks, ambiguous-write recovery and missed-run policy. Provider event recurrence is not proof that NabaPresence schedules publication. Apply the same choice to bulk edits, campaigns and other roadmap features.

Acceptance: an unaided pilot user can perform the sold tasks; no paid feature implies unsupported provider behaviour; limits and recovery are understandable; canonical, provider and eligibility states are represented honestly.

### PR10 Make operations observable and recoverable

Priority P0. Owner: operations and engineering. Scope: `docs/observability.md`, `docs/runbook.md`, instrumentation, health/notifications, Vercel Cron and provider configuration.

Configure OTLP or an explicitly accepted equivalent collector/error-monitoring path, restricted dashboards, external availability checks and authenticated health scraping. Configure `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` and `OPS_ALERT_EMAILS`, then demonstrate receipt at controlled inboxes. Treat Supabase Auth mail and application incident mail as separate delivery paths.

Track API latency/error rates, each of the eight cron completions, freshness, backlogs, dead letters, ambiguous/stale publishes, reconnection failures, quota pressure, purge delays, AI reservations/usage uncertainty, Stripe worker failures and billing-state divergence. Missing or never-completed ticks must alert, not only ticks that once succeeded. A jobs heartbeat or HTTP 200 is insufficient proof of successful work.

Tune alerts with controlled staging failures, acknowledge/escalate/resolve procedures and deduplication. Verify actual Vercel plan, cron cadences, region, function budgets, concurrency and protection behaviour. Reconcile cron definitions after rollback: Vercel documents that Instant Rollback does not automatically change the active cron schedule. See [cron operations guidance](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Retain current environment switches as documented until a runtime switch is justified. Measure the real stop time for new Google writes, drafting and jobs. If redeploy latency is too slow for the chosen incident target, implement authenticated, audited runtime flags with explicit cache/in-flight semantics; keep fast cron disablement rehearsed. A stop must not erase ambiguous provider intents or financial receipts.

Acceptance: every critical failure produces a useful alert that is received and resolved; deliberately paused services are distinguishable from silent failures; operators can stop new work within the agreed incident window; monitoring itself has an external failure signal.

### PR11 Verify backups and incident recovery

Priority P0. Owner: operations and engineering. Scope: hosted database plan, storage, Auth configuration, encryption key custody, deployment/configuration records and runbooks.

Choose and approve recovery targets. Proposed initial targets are recovery of critical service within two hours and no more than fifteen minutes of database loss; confirm feasibility and cost rather than advertising them immediately. Include database/PITR, externally stored media, auth/configuration dependencies, encryption keys and migration history. A database backup alone is not a complete service backup.

Restore a real staging snapshot into an isolated environment and verify login, memberships, encrypted-token decryption, migration state, drafts, intents, billing mapping and audit integrity. Disable outbound provider calls, mail and live Stripe actions in a restored rehearsal. When returning a restored service to operation, reconcile Google writes and Stripe invoices/events that occurred after the snapshot so restoration cannot double-publish or double-grant credits.

Rehearse application rollback independently from data restoration. Prefer roll-forward fixes for compatible migrations. Record which previous application can run against the new schema, where deployment/configuration versions are retained and how each cron is checked. Perform credential rotation and lost-operator-access exercises with named responsibilities.

Acceptance: timed restore and rollback receipts; successful decryption without exposing keys; working recovery of provider/financial divergence; one accessible incident procedure covering DB outage, Google revocation/quota, AI outage, Stripe webhook backlog, email outage and tenant-data incident.

### PR12 Complete privacy, terms and customer support

Priority P0. Owner: product/operator with legal/privacy/accounting review. Scope: public legal pages, `lib/legal/operator.ts`, privacy/legal-hold routes, provider agreements, support procedures and billing copy.

Verify legal operator, seller identity, privacy/support contacts and the current database region. The current operator file names a sole trader and US Virginia hosting; neither is a substitute for verifying the intended public SaaS arrangements. Document controller/processor roles for customer operations, account/billing data and review data, subprocessors, transfers, security, incident notifications and customer instructions. Use [ICO guidance on controllers and processors](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/) to inform qualified review.

Update terms for public registration, agencies acting for clients, subscriptions, trial, payment failures, renewal, cancellation, refunds, limitations and support. Resolve conflicts between agency use and the existing restriction on sharing/reselling access. Have an accountant determine applicable tax/VAT treatment and supported selling jurisdictions; configure invoices and tax collection accordingly. Record dated acceptance of the appropriate terms version.

Prove content retention across reviews, provider snapshots, media references, AI logs, audit, telemetry and backups. Keep data erasure distinct from account cancellation and Google disconnection. Test legal holds, exceptions, customer exports, public share expiry/revocation and provider-backed erasure. Reflect real limitations in public copy, including the treatment of backups and legally retained financial records. Review the claim that Google data is not used for model training against actual provider agreements/settings.

Establish a domain-based support inbox, receipt-tested routing, incident contact, response hours, refund handling, account/ownership recovery, and escalation to provider owners. Produce simple onboarding, reconnect, billing, credits and cancellation help. Only claim availability or response commitments that staffing can sustain.

Acceptance: approved and versioned commercial/legal documents; functioning external support and privacy contacts; actual export/erasure/hold cases reconciled; consistent pricing/checkout/terms; no automatic deletion or retention promise that the service cannot meet.

### PR13 Run complete QA and capacity verification

Priority P0. Owner: QA with engineering. Scope: existing project checks, Playwright suites, the e2e runner, integration fixtures, manual accessibility and `scripts/load/`.

Use `qa-with-e2e` alongside project checks. Preserve deterministic assertions at money, tenant, permission and provider boundaries. Agentic exploration adds discovery and real UI execution; a no-findings result or step-limited charter does not certify the entire app. Bind each report to source SHA, app URL, environment, runtime identity, fixtures and permitted actions.

Run `pnpm verify`, webpack build, migrations/runtime preparation, `pnpm test:integration`, the complete `pnpm test:e2e`, accessibility and applicable load tests on disposable fixtures. The project's `test:e2e` is Playwright; the user's agentic e2e runner is an additional lane. Inspect reports, failures and screenshots. Keep evidence outside Tailwind source detection. The existing `scripts/run-test-command.mjs` guards must remain active; do not override the remote test-database guard for ordinary QA.

Cover business and agency modes; owner/admin/member/viewer; location-assigned and unassigned access; multi-client/multi-org users; trial/paid/restricted billing states. Declare the supported browser/device versions and retain them in each report. Cover Chrome, Safari/WebKit and Firefox on desktop, plus Safari on iOS and Chrome on Android for the supported mobile experience. Playwright engine coverage does not replace every real-device check; unavailable device prerequisites remain pending. Cover 390 px mobile, a tablet width and desktop, light/dark themes, keyboard-only operation and screen readers. Include long content, empty/loading/error states, slow networks, refresh/reload, expired sessions and interruptions.

Set capacity fixtures from the agreed launch ceiling, test at twice that ceiling in staging where affordable, and define an admission limit from the results. Test invoice renewal bursts, Google webhook storms, concurrent drafting, large backfills, high-volume cursor/search queries, all eight crons and a noisy tenant. Measure CPU/memory, DB pool saturation, rate buckets, job age, provider budgets and unit costs. Use existing 100k-review query and fleet scenarios as baselines, not as proof of the actual hosted deployment.

Proposed initial targets: ordinary DB-backed read API p95 under 1.5 seconds at the declared fixture/load; warm interactive core pages usable within 2.5 seconds on the specified mobile test profile; reconcile normally within 20 minutes; ambiguity detected within 15 minutes; no lost durable events, duplicate provider mutations or cross-tenant leakage. Separate cold starts and provider-bound operation latency. Confirm attainable targets before selling them and define alert budgets around measured behaviour.

Acceptance: all launch journeys accounted for as pass/fail/pending/deferred; complete applicable browser matrix; fresh database and hosted checks green; performance targets met on the declared staging topology; no open launch-blocking defect; retained failed receipts and fixes verified without rewriting prior evidence.

### PR14 Conduct a controlled paid pilot and approve launch

Priority P0. Owner: product owner, operations and authorised pilot customers.

Use staging/sandbox evidence first. Then authorise a narrowly specified real payment and Google pilot with controlled accounts, amounts, recipients, listing changes, rollback/disconnection procedure and operator contact. Confirm payment receipt/invoice, correct organisation entitlement, real AI accounting and the provider/customer outcome. Do not charge or send messages simply to satisfy a checklist without this separate execution authority.

Keep initial signup admission controlled. Complete 48 hours of stable monitored operation before the seven-day product soak. Record daily per-tick freshness, backlog and financial reconciliation, token refresh, incident/alert outcomes and synthetic activity. Stop/restart the relevant soak after a zero-tolerance issue: data leakage, unauthorised action, duplicate mutation/charge/grant, lost durable event or untracked financial/provider outcome.

Reconcile the existing 30-day connection-persistence soak requirement explicitly. Start it as soon as a stable candidate and eligible real account exist; it can overlap other independent work. Do not silently replace it with seven days. Public launch waits for completion unless the product owner accepts a documented alternative supported by equivalent evidence. Changes invalidate the affected evidence according to the ledger, rather than automatically reusing an older sign-off.

Acceptance: pilot records prove actual payment/service outcomes and recovery; seven uninterrupted acceptable days plus the accepted connection-persistence requirement; sign-off on the candidate and residual P2 work; support/incident ownership and immediate pause access exist; limits support the admission rate. Open public paid signup only after this gate.

## 5 Customer and failure acceptance matrix

| Journey | Required cases | Exact outcome to prove | Evidence environment |
| --- | --- | --- | --- |
| Register and confirm | New user, duplicate, expired/replayed/scanned link, validation, rate limit | One correct identity/organisation; received email; confirmed session; safe recovery | Isolated automation plus hosted test accounts |
| Login and recover | Wrong password, unconfirmed account, reset, logout-all, second device | No enumeration; revoked/expired sessions rejected; connection persists | Automation and hosted mail flow |
| Invitations and roles | Existing/new user, revoked/expired invite, client/location scope, last owner | Correct organisation and grants; no other-tenant access or orphaned ownership | DB/HTTP/browser tests |
| Trial | Creation, expiry, repeat attempt, invitation, shared allowance | One allowed trial; limits shared by members; explicit expiry and recovery | Stripe sandbox and fixtures |
| Checkout | Success, decline, action required, abandonment, duplicate tabs, tampered Price | One allowed subscription; no entitlement from redirect; correct invoice/customer mapping | Stripe sandbox; separately approved live pilot |
| Renewal and plan change | Renewal, proration, upgrade/downgrade, annual grant if sold | Correct effective entitlements and one grant for each eligible period | Time-controlled provider tests and DB assertions |
| Billing events | Invalid signature, duplicate, reordered, stale, wrong account, worker crash | Durable receipt; safe retry; converged state; no duplicate grant | Sandbox/contract/integration tests |
| Payment restriction | Past due/grace, unpaid, recovered, paused, dispute | Agreed restrictions at route and worker; billing/export/disconnect access | DB/HTTP/browser tests |
| Cancellation and closure | Period-end/immediate, resubscribe, refund, privacy deletion | Accurate end date, no unauthorised queued work, clear data treatment | Sandbox plus controlled pilot |
| Google connect | Denied consent, missing scopes/quota, multiple accounts, reconnect | Correct authorised connection; understandable operator versus customer issue | Stubs and eligible live accounts |
| Review ingestion | Pagination, Pub/Sub duplicate/malformed/delayed message, missed notification | No lost/duplicated review; checkpoint recovery; independent freshness | Integration plus real Pub/Sub receipt |
| Reply generation | Concurrent last credit, model timeout, bad output, ledger outage, verify-only | Bounded cost; auditable allowance; preserved manual reply; safe retry | Controlled provider fixtures and pilot |
| Approval and publishing | Viewer/member restrictions, stale source, changed actor, edit/delete, timeout after write | Specific approved action only; durable intent; independently observed provider state | DB/HTTP/browser plus approved live listing |
| Listing operations | Each sold field/resource; sibling preservation; eligibility; provider rejection | Exact selected fields, safe replacement semantics, honest partial/readback state | Per-surface contracts and eligible live resource |
| Scheduled/bulk work | Only if sold: cancellation, missed tick, DST, partial failure, changed grants/plan | Agreed per-target outcome; no silent skip/duplicate; effective permission recheck | Fixture-backed full flow plus pilot |
| Reports and sharing | TZ/DST, stale metrics, thresholded keywords, exports, public token revoke/expiry | Correct scoped figures and honest provenance; no token leakage | Fixtures/browser/retention tests |
| Operational incident | Dead tick, DB/API outage, backlog, revoked token, mail failure, billing divergence | Alert received, operator action, recovery and reconciliation | Hosted staging failure drill |
| Restore and rollback | Previous app/new schema, snapshot restore, external writes after snapshot | Recovery targets; no repeated mutation/financial grant; crons checked | Isolated staging rehearsal |
| Privacy and holds | Export, delete, disconnect, hold/release, retained invoice, backups | Agreed fulfilment with auditable exceptions and actual provider effect | Controlled hosted accounts |
| Accessibility and mobile | Roles, modes, overlays, validation, long content, light/dark | Usable keyboard/screen-reader flow; no overflow or hidden recovery | Full browser matrix and manual review |

Live provider receipt, independent readback and public Search/Maps appearance are separate columns in the execution ledger. Public propagation delay must not be misreported as failed local persistence or completed public visibility.

## 6 Delivery order and planning allowance

Execute through small reviewable changes. The following order is based on dependencies, not on the historical roadmap's ordering.

| Phase | Main packages | Planning allowance | Exit |
| --- | --- | --- | --- |
| A Scope and unblock | PR01; pricing decisions; early Google policy/access check; restore Actions | 2–4 engineering days plus external decisions | G0 and executable CI |
| B Secure foundations | PR02, PR03, PR08; staging and recovery configuration | 5–8 days | G1; safe environments and reviewed boundaries |
| C Accounts and operations | PR04, PR05 setup, PR10 initial dashboards/mail | 4–7 days; provider approval may take longer | Real signup/mail and authorised connection; start persistence soak when stable |
| D Paid lifecycle | PR06 and PR07, billing UI and tests | 10–15 days | G2; complete sandbox commercial lifecycle |
| E Product and policy closure | PR05 live verification, PR09, PR12, PR11 drills | 6–10 days; some review overlaps earlier phases | G3/G4 for the advertised feature set |
| F Full qualification | PR13; fixes and relevant retests | 5–8 days | Complete candidate evidence and capacity limits |
| G Pilot and public opening | PR14 | At least 7 acceptable soak days; existing connection requirement is 30 days unless explicitly replaced | G5/G6 |

Budget roughly 8–12 weeks for one primary implementer with available review/QA/operations support, without promising an exact launch date. The work may take longer if Google eligibility, payment onboarding, policy interpretation, security findings or scope changes require redesign. Multiple contributors can overlap independent packages while maintaining clear ownership and isolated environments; this plan does not create agents or assign staff.

Critical dependency chain: commercial scope and Google eligibility → secure identity/environment → billing and entitlement state → allowance and worker enforcement → complete customer/provider verification → recovery/capacity evidence → pilot/soak → public paid signup.

The first five working days should produce the reconciled ledger, approved product/price decisions, dependency disposition, executable hosted CI, staging identity/configuration inventory, and concrete billing design. Do not start by redesigning the whole interface or rewriting working provider pipelines.

## 7 Cost and business viability

Build a measured cost worksheet for one paying organisation, one active location and one successful AI-assisted reply. Include drafting plus semantic verification, repeat verification, failure/retry cost, Vercel execution, database compute/storage/backups, email, telemetry, payment processing, support and staging. Use actual provider invoices/usage and the deployed topology; local ARM timings do not predict hosted costs.

Measure low, normal and high utilisation within each proposed package. Require the product owner to approve a gross-margin floor, cash budget, provider spending alarms and an emergency admission/AI cap. A user must never incur an undisclosed usage charge. Complete seller/payment onboarding, statement descriptor, support contact, invoices, reconciliation, accounting exports, dispute and refund procedures using [Stripe's go-live checklist](https://docs.stripe.com/get-started/checklist/go-live).

Do not buy add-ons or commit to public service levels before comparing their cost with the recovery/capacity requirement. If the chosen database or Vercel plan cannot support the required cron, recovery or admission limits, change the plan or the limits explicitly.

## 8 Public launch checklist

Each item must link to evidence for the actual candidate. An exception requires a named owner, concrete rationale, compensating control, review date and product decision. A waiver cannot manufacture missing provider permission or override a binding policy.

- [ ] Product catalogue, prices, limits, trial, renewal and cancellation rules are approved and consistent everywhere.
- [ ] Google eligibility/consent/storage model and all advertised endpoints are current and accepted.
- [ ] Dependency findings are fixed or individually triaged; no unaccepted launch-blocking security issue remains.
- [ ] Exact candidate has green required CI, CodeQL, audit, migrations, integration and full applicable browser checks.
- [ ] Production schema/runtime role/configuration match the candidate; staging and previews are isolated.
- [ ] Registration, confirmation, invitations, recovery, sessions and cross-device organisation continuity work with received mail.
- [ ] Subscriptions and server/worker entitlements handle the full lifecycle, retries and reconciliation.
- [ ] AI allowances and actual provider usage remain auditable and bounded under concurrency, failures and billing transitions.
- [ ] Every advertised Google operation has eligible live evidence; ambiguous writes recover without duplicate execution.
- [ ] All eight crons, freshness/backlogs, provider budgets and billing reconciliation are monitored.
- [ ] Operator and customer incident/support mail has real receipt evidence.
- [ ] Capacity and unit costs support the admission limits and prices.
- [ ] Restore, rollback, rotation and provider/financial reconciliation drills meet the accepted recovery objectives.
- [ ] Public terms, privacy, processor arrangements, support, taxes/invoices and fulfilment are approved and accurate.
- [ ] No open P0 or advertised-scope P1 issue; deferred P2 work has an owner and date.
- [ ] Seven-day pilot soak and the explicitly accepted connection-persistence requirement are complete.
- [ ] A controlled real payment and customer/provider journey have succeeded with separate authorisation and receipts.
- [ ] All six existing signatory roles—product, engineering, QA, security, operations and pilot owner—record GO for the same candidate; applicable privacy/accounting decisions are approved.
- [ ] Public signup admission, incident contact, rollback unit and pause procedure are ready.

## 9 Evidence and implementation references

The 9 October receipts are local workstation evidence and should be copied into a durable, access-controlled release evidence location before implementation proceeds. They are not a substitute for future candidate verification.

| Receipt | Location |
| --- | --- |
| Typecheck, lint and unit/component results | `/tmp/naba-presence-readiness-20261009-verify.log` |
| Webpack build | `/tmp/naba-presence-readiness-20261009-build.log` |
| Fresh database full integration pass | `/tmp/naba-presence-readiness-20261009-leases-clean.log` (command selected the full integration directory plus the leases path; all 74 files ran) |
| Earlier integration failure | `/tmp/naba-presence-readiness-20261009-integration-after-build.log` |
| Isolated scheduler regression check | `/tmp/naba-presence-readiness-20261009-leases-focused.log` |
| Authentication Playwright suite | `/tmp/naba-presence-readiness-20261009-playwright-auth.log` |
| Agentic production report and trace | `/Users/amankumarshrestha/.e2e/naba-presence-readiness-20261009-production/report.json` and its linked artifacts |
| Dependency advisory snapshot | `/tmp/naba-presence-readiness-20261009-audit.json` |
| Hosted CI budget failure | [CI run 37933418758](https://github.com/lapeninns/naba-presence/actions/runs/37933418758) |
| Hosted CodeQL budget failure | [CodeQL run 37933418741](https://github.com/lapeninns/naba-presence/actions/runs/37933418741) |

Applicable repository guidance remains `AGENTS.md`; current scripts/configuration remain authoritative. Continue using TanStack Query, the shared route/permission contracts, the existing publishing pipeline and the current Next.js environment-loading conventions. New application source locations require registration in `app/globals.css`; documentation, snapshots and evidence remain outside the Tailwind scan. Read relevant Next.js bundled documentation before changing routing, rendering, caching, APIs or configuration.

Implementation should close these packages through reviewable changes and ledger updates. Creating this plan does not mark any remaining release gate complete.
