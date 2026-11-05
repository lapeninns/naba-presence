# Redesign 2026-11 — Phase A baseline

Owner: worker `a-inventory` (resumed as `a-inventory-2`). Written 2026-11-03.

| | |
| --- | --- |
| Base | `origin/main` at `367719b3` ("fix(ci): document local executor and preserve complete release gate coverage (#269)") |
| Work branch | `redesign-2026-11/a-inventory-2`, cut from `redesign-2026-11/a-inventory` (`aef8ebcf`, the first worker's WIP) |
| App code on the branch | identical to `367719b3`: `git diff --quiet 367719b3 HEAD -- app components lib proxy.ts next.config.ts package.json pnpm-lock.yaml` exits 0. The branch adds only `tests/visual/nm-capture*` and `docs/redesign/2026-11/*` |
| Machine | macOS (Darwin 27.2), node v24.16.0 (`~/.nvm`), pnpm 10.34.5 |
| Execution sandbox | macOS Seatbelt. **Local port binding is denied** (`listen EPERM`), and the shared ledger/evidence folders are read-only (see "Blocked") |

How to read this file: every fact about behaviour comes from **reading the code at 367719b3**, unless it is marked as measured (a command and its exit code). **Nothing was rendered in this phase**: the sandbox could not bind a port, so no app server, database or browser could run. "Verified" therefore means checked against the code, not seen in a screenshot.

## 1. Checks run on the base (measured)

| Command | Tree | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | branch (same lockfile as base) | **0** | 3m15s | `test-results/a-inventory/install.log` |
| `pnpm verify` | detached `367719b3` | **1** | `typecheck` ✓, `lint` ✓, `format:check` ✓ (0 changed files), `test` ✗: 677 files (5 failed, 671 passed, 1 skipped), 10102 tests (39 failed, 10025 passed, 38 skipped), 1 unhandled error. `check:design --ratchet` did not run because `test` failed first. 4m25s | `test-results/a-inventory/verify-base-367719b3.log` |
| `pnpm check:design --ratchet` (alone) | branch (app == base) | **0** | "no file/rule count rose above scripts/design-baseline.json" | `test-results/a-inventory/check-design-base.log` |
| `pnpm build` (webpack + postbuild) | branch (app == base) | **0** | 1m01s. `AGENTS.md` was not rewritten | `test-results/a-inventory/build-base.log` |
| `vitest run tests/visual/nm-capture-lib.test.ts` | branch | **0** | 19/19 | — |
| `tsc --noEmit` | branch | **0** | — | — |
| `e2e list --target desktop --tag desktop` / `--target mobile --tag mobile` | branch | **2** / **2** | `CONFIG_LOAD_FAILED` (see "Blocked") | `test-results/a-inventory/e2e-list-*.log` |
| `with-e2e-db.sh node tests/visual/nm-serve.mjs -- …` | branch | **91** | `postgres.mjs start: listen EPERM: operation not permitted 127.0.0.1` → `[with-e2e-db] migrate failed` | `test-results/a-inventory/nm-serve-probe.log` |

**The 39 `pnpm test` failures all come from the sandbox, not the product.** Each failing file needs to bind a local port or create a temp dir that the sandbox forbids:

| File | Failed | Cause in the log |
| --- | --- | --- |
| `tests/google-transport.test.ts` | 30 | `Error: listen EPERM: operation not permitted 127.0.0.1` (local stub server), then `Server is not running` |
| `tests/notifications-email.test.ts` | 3 | `listen EPERM` (local SMTP/HTTP stub) |
| `tests/server/postgres-docker-ownership.test.ts` | 5 | `postgres.mjs start: listen EPERM` |
| `tests/server/run-test-command-guard.test.ts` | 1 | port probe `listen EPERM`, then a 5 s timeout; this file also raised the unhandled error |
| `tests/server/runner-pre-job-hook.test.ts` | whole file | `EPERM: operation not permitted, mkdtemp '/private/tmp/naba-runner-hook-XXXXXX'` |

These are **environment-blocked, not passes**. They are base findings only in the sense that `pnpm verify` cannot pass inside this sandbox. Re-run `pnpm verify` where port binding is allowed before treating the base as green. Main records release promotions under `docs/release/receipts/` (latest: `61e56a9d`, the 73536ddc promotion, #268); no receipt for `367719b3` itself was checked here.

## 2. Blocked in this phase

| Item | Exact error | Consequence | Unblock |
| --- | --- | --- | --- |
| Local port binding | `listen EPERM: operation not permitted 127.0.0.1` (node `net.createServer().listen(0)`, Postgres, test stubs) | No throwaway Postgres, app server or Google stub, so **no before-screenshots, no Playwright, no agentic journeys, no render review** | Allow `sandbox.network.allowLocalBinding: true` (owner/orchestrator decision), then run `tests/visual/nm-capture-before.sh` |
| Agentic e2e runner (machine install) | `CONFIG_LOAD_FAILED: failed to load config …/e2e.config.ts: The requested module 'e2e/engine' does not provide an export named 'rejectUnknownOptions'` | Even with ports allowed, `tests/agentic` cannot run. `~/node_modules` has `@e2e-dev/web@0.11.2`, whose `dist/browser.js:14` imports `rejectUnknownOptions` from `e2e/engine`, but the installed `e2e@0.15.2` engine does not export it | Reinstall a matching `e2e` / `@e2e-dev/web` pair in `~/node_modules` (machine-level; outside this worktree) |
| Shared lock `notion-mail-ledger/locks/` | `mkdir: …/locks/_probe.lock: Operation not permitted`. `with-lock.sh` treats the failed `mkdir` as "busy" and waits forever (`[with-lock] e2e busy:  since ; waiting`) | Heavy work cannot be serialised with other workers from this sandbox. Build and verify ran without the lock; the lock was not held by anyone at the time (`locks/` held only `LOCK-LOG.txt`) | Writable lock dir for workers, or an orchestrator-run capture |
| Durable evidence and handoff folders `2026-11-redesign/{evidence,handoffs}/` | `mkdir: …/evidence/a-inventory: Operation not permitted`; `touch: …/handoffs/.probe: Operation not permitted` | Logs and parts are kept in the worktree's ignored `test-results/a-inventory/`; the handoff is returned as the result | Orchestrator copies `test-results/a-inventory/` and the handoff into the durable folder |

### Before-evidence: prepared, not captured

`tests/visual/nm-capture-before.sh` performs the whole phase-A capture in one run on a machine that can bind ports:
1. It refuses unless app code matches `367719b3`, then builds.
2. Under `with-lock` + `with-e2e-db` + `nm-serve` it captures:
   - light at phone 390x844 touch, tablet 834x1194 touch and desktop 1440x900 mouse;
   - dark at desktop and phone (`--merge`).
3. It runs `e2e run --target desktop --tag desktop`, then `--target mobile --tag mobile`, and copies the reports.
4. It runs `check-inventory.mjs --manifest` to prove every page row has phone/tablet/desktop shots.
5. It converts the 34 curated shots in `tests/visual/nm-capture-before.curated.txt` to webp in `docs/redesign/2026-11/evidence/before/`.

Every step's exit code goes to `<out>/exit-codes.txt`. The plan was checked without a server (`nm-capture.mjs --list`):
- light, 3 viewports: 225 shots (desktop 75, phone 74, tablet 76; tablet runs both phone-shell and desk-shell states);
- dark, 2 viewports: 149 shots.

The base `nm-serve.mjs` has no `--second-client`, so `state--client-switcher-open` will record `state-not-reached`.

### Agentic journeys: not run

| Run | Status | Why |
| --- | --- | --- |
| `tests/agentic` desktop target | **blocked** | runner `CONFIG_LOAD_FAILED` (above) and no app server (port binding) |
| `tests/agentic` mobile target | **blocked** | same |

## 3. Product model: toolchain, flags, workspace modes, roles, publishing (code-read)

### 3.1 Toolchain versions

| Tool | Declared (package.json) | Installed (node_modules/<pkg>/package.json) |
|---|---|---|
| node (engines) | `>=24 <25` (package.json:6) | v24.16.0 (`~/.nvm`; used for install, verify and build) |
| pnpm (packageManager) | `pnpm@10.34.5` (package.json:4) | `pnpm -v` = 10.34.5 |
| next | `16.4.1` (package.json:64) | 16.4.1 |
| react | `19.3.0` (package.json:67) | 19.3.0 |
| react-dom | `19.3.0` (package.json:68) | 19.3.0 |
| tailwindcss | `^4` (package.json:97) | 4.3.3 |
| @base-ui/react | `^1.8.0` (package.json:50) | 1.9.0 |
| @tanstack/react-query | `^5.101.4` (package.json:57) | 5.101.4 |
| typescript | `^5` (package.json:98) | 5.9.3 |
| vitest | `^5.0.2` (package.json:99) | 5.0.3 |
| @playwright/test | `^1.63.0` (package.json:81) | 1.64.0 |
| shadcn (CLI) | `^4.16.0` (package.json:95) | 4.16.0 |

shadcn config (components.json): `style: "base-rhea"`, `rsc: true`, `tsx: true`, Tailwind `config: ""` (Tailwind 4, CSS-first), `css: app/globals.css`, `baseColor: "olive"`, `cssVariables: true`, no prefix, `iconLibrary: "lucide"`, `rtl: false`, aliases `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`, `menuColor: "inverted-translucent"`, `menuAccent: "subtle"`, no extra registries.

### 3.2 Feature flags and kill switches (names only)

Three layers, all server-side:

1. **Env flags** parsed once per process by zod in `lib/server/env.ts:140-399` (`getServerEnv()` caches, env.ts:403-412, so every env flag is restart-scoped, not hot). `parseFeatureFlag` accepts only "true"/"false" (env.ts:5-10).
2. **Operator pause table** `ops_pause_control` (hot, 5 s cache) in `lib/server/pause-controls.ts`. Scopes at pause-controls.ts:43-72; env hard-override map at :77-92. `effectiveEnabled` (:112-120): env off always wins; DB can only add a pause; unreadable table fails closed for dispatch (`onReadError: "closed"`). `requireGbpDispatch(surface)` (:333-339) checks `publish` + the surface scope and throws 503 `google_writes_paused` (:320-324) with `details.pausedScopes`.
3. **Per-organisation product flags** in table `organisation_feature`, read by `isOrgFeatureEnabled` (`lib/server/org-features.ts:26-38`); missing row = off. Names in `lib/contracts/org-features.ts`.

No `NEXT_PUBLIC_*` flags exist in lib/, app/, components/, next.config.ts (grep returned nothing); the client learns gates only through capability payloads.

**Env flags (name -> where read -> what it gates)**

- `PUBLISH_ENABLED` (env.ts:322) -> pause-controls (scope `publish`), `lib/server/jobs.ts`, `lib/server/capabilities.ts`, `lib/server/publishing/publish.ts:152`/`delete.ts:412` (via `requireScopesEnabled("publish", REPLY_PUBLISHING_PAUSED)`), `lib/server/publishing/retry.ts:433`. Global gate on every Google write; combined with per-surface flags in `gbpWritesEnabled` (env.ts:466-471).
- `GBP_PROFILE_WRITES_ENABLED`, `GBP_POSTS_ENABLED`, `GBP_MEDIA_ENABLED`, `GBP_FOOD_MENUS_ENABLED`, `GBP_PLACE_ACTIONS_ENABLED` (env.ts:356-360) -> per-surface write kill switches (`GBP_SURFACE_FLAG`, env.ts:453-464); `requireGbpWrite` in `lib/server/gbp-write.ts:259-267`; mirrored to UI by `resourceWritesEnabled` (`lib/server/capabilities.ts:130-156`): profile/hours/businessInformation/industry/administration <- profileWrites, photos <- media, posts <- posts, menu <- foodMenus, booking <- placeActions. A paused surface stays visible read-only (`reasonCode: "publishing_paused"`, capabilities.ts:223-229).
- `GBP_PERFORMANCE_ENABLED`, `GBP_KEYWORDS_ENABLED` (env.ts:354-355) -> ingestion-only switches (`gbpIngestionEnabled`, env.ts:473-478); capabilities.ts:151-154 also requires `PUBLISH_ENABLED` for the performance resource.
- `SYNC_ENABLED` (env.ts:323) -> scope `sync`; `lib/server/jobs.ts`, `app/api/sync/reconcile/route.ts`, `app/api/sync/backfill/route.ts`, `app/api/auth/callback/google/route.ts`.
- `JOBS_ENABLED` (env.ts:328) -> scope `jobs`; pauses the background runner wholesale (`lib/server/jobs.ts`).
- `WEBHOOKS_ENABLED` (env.ts:324) -> `app/api/webhooks/google/pubsub/route.ts`, `lib/server/startup.ts`.
- `DRAFTS_ENABLED` (env.ts:304) -> scope `drafts`; AI drafting (`lib/server/review-drafts.ts:300`), `lib/server/jobs.ts`, review topics job (`lib/server/review-topics-job.ts`).
- `SEMANTIC_VERIFY_ENABLED` (env.ts:332) -> `lib/server/ai.ts:326-329` (`semanticVerificationEnabled`, also needs `OPENAI_API_KEY`). Off = deterministic checks alone (degraded mode).
- `NOTIFICATIONS_ENABLED` (env.ts:364) -> scope `notifications`; `app/api/cron/health/route.ts`.
- `TENANT_EMAIL_ENABLED` (env.ts:372) -> `lib/server/notifications/email.ts`, `lib/server/invitations/delivery.ts`.
- `EMAIL_PROVIDER` (enum none/resend, env.ts:365-368) -> `lib/server/notifications/email.ts`, `lib/server/readiness.ts`, `lib/server/startup.ts`.
- `RETENTION_ENABLED`, `RETENTION_DELETES_ENABLED` (env.ts:337-338) -> `lib/server/retention/purge.ts`, `lib/server/retention/inventory.ts`, `app/api/privacy/retention-status/route.ts`.
- `IMPORT_REVIEW_ENABLED` (env.ts:361) -> `lib/server/import-review.ts`, `lib/server/prefetch.ts`, `app/api/locations/[id]/import-review/**`.
- `BILLING_ENFORCEMENT_ENABLED` (env.ts:179) -> `lib/server/entitlement-policy.ts` (`sessionCanWrite`, :185-188), `lib/server/session.ts`, `lib/server/db.ts:120-130` (`app.billing_enforcement` GUC), `lib/server/publication-schedule-runner.ts`. On + org read-only => 402 `billing_read_only` on mutations (route wrapper `lib/server/route.ts` step 4b) and `readOnly`/`billing_read_only` resource state (capabilities.ts:218-221).
- `BILLING_ENABLED` (env.ts:186) -> `lib/server/billing/stripe.ts`, `lib/server/notifications/*`, `app/(dashboard)/settings/layout.tsx`. `BILLING_AUTOMATIC_TAX` (env.ts:204) -> `lib/server/billing/checkout.ts`. `BILLING_ENVIRONMENT` enum (env.ts:190-193).
- `MFA_ENABLED` (env.ts:231) -> `lib/server/mfa.ts`, `lib/server/route.ts` (`mfa: "step_up"` is a no-op while off), `lib/settings/areas.ts`, `app/(dashboard)/settings/security/page.tsx`.
- `REGISTRATION_MODE` (open/invite_only, env.ts:232-235) -> `lib/server/registration.ts`, `app/(auth)/sign-in/page.tsx`.
- `REGISTRATION_WORKSPACE_CHOICE_ENABLED` (env.ts:241) -> `app/api/auth/password/register/route.ts:36-40`, `lib/server/password-auth.ts`, `app/(auth)/sign-in/page.tsx`. Off: every new org is business.
- `PASSWORD_AUTH_ENABLED` (env.ts:339), `BREACHED_PASSWORD_CHECK_ENABLED` (env.ts:343) -> `lib/server/password-auth.ts`, `lib/server/breached-password.ts`, `lib/server/startup.ts`.
- `SUPPORT_IMPERSONATION_ENABLED` (env.ts:167) -> `lib/server/session.ts`, `app/api/support/impersonation/route.ts`.
- `MEDIA_ASSET_STORAGE` (disabled/supabase, env.ts:215-218) -> `lib/server/storage/asset-storage.ts` (asset routes 503 `asset_storage_unavailable` when off).
- `GOOGLE_RATE_BUDGET_ENABLED` (env.ts:265) -> `lib/server/google/rate-budget.ts`. `ABUSE_LIMITS_ENABLED` (env.ts:270) -> `lib/server/abuse-limits.ts`, `lib/server/review-links.ts`.
- `RISC_ENABLED` (env.ts:386) -> `app/api/webhooks/google/risc/route.ts`. `OAUTH_STATE_ACCEPT_LEGACY` (env.ts:160) -> `lib/server/crypto.ts`.
- `LOCAL_BOOTSTRAP_ENABLED` (env.ts:344) -> `lib/server/session.ts`, `lib/server/startup.ts`. `DESIGN_SYSTEM_EVIDENCE_ENABLED` (env.ts:351-353) -> `app/design-system/page.tsx`.
- Raw `process.env` reads outside the schema: `ENFORCE_DB_SAFETY` (`lib/server/startup.ts`), `PAUSE_CACHE_TTL_MS` (test seam, pause-controls.ts:194-202), `GOOGLE_API_PROXY_BASE` (`lib/server/google/transport.ts:137`), `STRIPE_API_PROXY_BASE` (`lib/server/billing/stripe.ts:135`), budget knobs `RETENTION_BUDGET_MS`/`RETENTION_BATCH_ROWS` (`lib/server/retention/purge.ts`), `RECONCILE_BUDGET_MS`, `PRESENCE_RESOURCE_BUDGET_MS`, `PERFORMANCE_BUDGET_MS`, `OPERATIONS_HEALTH_BUDGET_MS`, `KEYWORDS_BUDGET_MS`, `BILLING_RECONCILE_BUDGET_MS`, plus `VERCEL`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV`.

**Pause scopes without an env flag** (pause-controls.ts:57-71): `scheduled_post`, `bulk`, `billing`, `mutation_recover`, `invitation_email`.

**DB-backed organisation features** (`lib/contracts/org-features.ts`):
- `post_scheduling` -> `lib/server/publication-schedules.ts`; dashboard layout hides Calendar nav (`app/(dashboard)/layout.tsx:58-79` -> `hideCalendar`; `lib/navigation/destinations.ts:74-78,203`).
- `post_scheduling_recurring` -> repeating schedule rules (`lib/server/publication-schedules.ts`).
- `bulk_actions` -> `lib/server/bulk-listings.ts`, `lib/server/bulk-reviews.ts`, `lib/server/bulk-listing-runner.ts`.
- `listing_change_approvals` -> two-person listing writes (`lib/server/listing-changes.ts:165-176`).
- `privacy_settings` -> /settings/privacy (`lib/server/capabilities.ts:403-414`, `lib/settings/gating.ts:28`).
- `workspace_mode_change` -> `PATCH /api/organisations { workspaceMode }` (`app/api/organisations/route.ts:52-66`, 403 `workspace_mode_change_unavailable`) and the Settings card `components/settings/workspace-mode-card.tsx`.
- `invitation_email` -> `lib/server/invitations/delivery.ts`.
- `review_topics` -> `lib/server/review-topics-job.ts`, `lib/server/review-topics-alerts.ts`, `app/api/analytics/review-topics/route.ts`, `.../status/route.ts` (Reports panel + Inbox Topic filter).

### 3.3 Workspace modes: business vs agency

- **Where it lives:** column `organisation.workspace_mode` (`'business' | 'agency'`, DB default `'agency'`; `supabase/migrations/0061_workspace_mode.sql:16-17`) plus `client.is_home` with unique index `client_one_home` (0061:18-19). It is an explicit stored attribute, NOT inferred from whether clients exist.
- **How set:** at provisioning, `identity.workspaceMode ?? "business"` (`lib/server/provisioning.ts:153`); business orgs get a hidden home client in the same transaction (:165-170). Agency is only choosable at sign-up when `REGISTRATION_WORKSPACE_CHOICE_ENABLED` is on (`app/api/auth/password/register/route.ts:36-40`). Later switch: owner-only `PATCH /api/organisations` (`app/api/organisations/route.ts:47-84`, `roles: ["owner"]`, `mfa: "step_up"`), gated by the `workspace_mode_change` org feature, implemented in `changeWorkspaceMode` (`lib/server/workspace-mode.ts:122-278`). Refusals: 409 `billing_subscription_active` (:41-77), 409 `workspace_mode_too_many_clients` when agency->business with >1 active client (:175-182), 409 `workspace_mode_report_shares` unless `confirmReportShares` (:204-218). Business->agency demotes the home client to an ordinary client (:156-166); agency->business promotes/creates the home client and refiles every location (:183-252).
- **How the UI reads it:** session carries `workspaceMode` (`lib/server/session.ts:34`, selected at :190; contract `lib/contracts/session.ts:12-13,37`). Client hook `useWorkspaceMode()` reads the `queryKeys.session` cache without fetching and defaults to `"agency"` when no query client/session (`lib/workspace/mode.ts:21-46`). Copy comes from `workspaceTerms(mode)` (`lib/workspace/terms.ts:55-89`): org "Business"/"Agency", scope "location"/"client", access "Location access"/"Client access", orgName, reports/team descriptions; listing words identical in both modes (terms.ts:45-53).
- **Nav differences** (`lib/navigation/destinations.ts`): Clients is `agencyOnly` (:114-125, filtered at :202). Phone tab priority: agency inbox/listings/clients/reports(/calendar/notifications), business inbox/listings/calendar/reports/notifications (:222-232). Scoped links (Inbox, Listings, Reports) carry `?clientId=` only in agency (:292-299; `lib/clients/scope.ts:32`). Reports description differs ("by client" vs "by location", :143-146). `/setup` owner tab is Clients (agency) vs Listings (business) (:334).
- **Route differences:** business sessions are redirected out of the client layer by `redirectOutOfClientLayer` (`lib/server/workspace-redirect.ts:13-20`, rules `businessModeRedirect` in `lib/workspace/terms.ts:117-126`: `/clients`, `/clients/new`, `/clients/[id]/**` -> `/listings`; `/clients/[id]/settings/**` -> `/settings`), called in `app/(dashboard)/clients/page.tsx`, `clients/new/page.tsx`, `clients/[clientId]/layout.tsx`, `clients/[clientId]/page.tsx`, `clients/[clientId]/settings/page.tsx`. `?clientId=` is stripped server-side for business by `redirectOutOfClientScope` (workspace-redirect.ts:27-34), called in `app/(dashboard)/layout.tsx:31`; the layout also nulls the remembered client (`layout.tsx:132`).

### 3.4 Roles and location-access model

- **Roles:** `owner | admin | member | viewer` (`lib/server/session.ts:37`). Managerial = owner/admin (`isManagerialRole`, `lib/server/permissions.ts:143-145`). Only an owner may grant/change the owner role (`lib/server/member-roles.ts:8-19`).
- **Org-level gating:** declared per route via `route({ roles: [...] })` -> `requireRole` (403 `permission_denied`) (`lib/server/route.ts:72-77,232-233,398-406`; `lib/server/session.ts:267-275`). `mfa: "step_up"` on team, connection, settings, publish/approve handlers (route.ts:78-83). Settings capabilities: canManageTeam / canManageConnections / canEditSettings = owner|admin (editSettings also needs billing write), privacy via `privacyAccessFromRole` (`lib/server/capabilities.ts:376-390`; client mirror `lib/settings/gating.ts:9-30`). Team nav is `managersOnly` (`lib/navigation/destinations.ts:72,173,204`).
- **Location visibility is the single source of truth in `lib/server/permissions.ts`** (header rule at :9-96): owner/admin see/edit/publish every location; member/viewer with `member.location_scope = 'all'` see every location; `'assigned'` see exactly their `location_member` rows and NOTHING when there are none ("absence never means all", :40-47). `canEdit` = visible and not viewer; `canPublish` = owner/admin true, viewer false, member 'all' uses `member.can_publish` (session.canPublish), member 'assigned' uses the row's `location_member.can_publish` (:21-25).
- **Action vocabulary:** `LOCATION_ACTIONS` = read, edit, request_approval, triage, assign, decide_approval, publish (:382-390); `actionAllowed` (:394-412): viewer is read-only everywhere; edit/request_approval/triage/assign need canEdit; decide_approval/publish need canPublish.
- **Helpers:** `visibilityPredicate` (:169), `publishPredicate` (:219), `grantsFor` (:246), `memberGrant` (:315), `requireLocationAccess` (:351; hidden == 404 so probes cannot tell "not yours" from "missing"), `requireLocationAction` (:420; 404 hidden, 403 `permission_denied` when visible but not allowed), `requireLocationActionForAll` (:451), `clientVisibilityPredicate` (:486), `requireClientAccess` (:508), `canPublishLocation` (:527). UI capability projections: `reviewCapabilitiesForLocations` (`lib/server/capabilities.ts:59-90`), `locationActionCapabilities` (:166-180), per-resource states available/readOnly/blocked/unavailable with reasonCodes `google_location_not_linked`, `permission_denied`, `billing_read_only`, `publishing_paused`, `publish_not_allowed` (:186-244); industry/administration/businessInformation are owner/admin-only (`canEditCanonical`, :206-215).
- **Client scoping:** there is deliberately no client_member table; client visibility = at least one visible location (permissions.ts:28-32). Client access edits (`PUT /api/members/[userId]/client-access`) and scoped invitations expand a client into one `location_member` row per listing (`lib/server/client-access.ts`: `grantClientListings` :108, `grantLocationListings` :136); "every client" is saved as scope 'all', no clients as 'assigned' with no rows (permissions.ts:49-56). New listings filed under a client extend only 'assigned' holders of every other listing of that client (`extendClientHolders`, client-access.ts:188; audited via `auditExtendedGrants` :238).
- **Report share (anon):** `ClientShareVisibility { kind: "client_share", clientId }` (permissions.ts:127-130) sees exactly one client's locations, carries no role, never edits/publishes (`lib/server/shared-report.ts`).
- **Tenant isolation:** every tenant read/write runs in `withTenant(organisationId, ...)` which sets `app.organisation_id` (and `app.billing_enforcement`) per transaction (`lib/server/db.ts:107-130`); RLS is FORCE-d for the runtime role (0061 comment, :21-23). Route handlers get `ctx.tenant` only for session auth (route.ts step 6). Membership lookups additionally filter on organisation id (permissions.ts:67-71).
- **Scope changes on the client:** session `scopeFingerprint` changes with role, publish right, scope, grants, security version; the client drops cached data on change (`lib/server/session.ts:47-55`; `lib/queries/scope-reset.ts`).
- **Deferred work** (retries, scheduled posts, bulk, recovery) re-derives the queuer's grant at dispatch from current membership via `actorScopeFromMembership` / recheck in `lib/server/authz/actor.ts:18-46` (null = refuse), also rechecking connection, credential generation, security version and frozen approval policy (:48-80).

### 3.5 Publishing permission, approval, verification and provider confirmation

- **Who can publish:** `actionAllowed(..., "publish")` = visible + canPublish (owner/admin always; member per `member.can_publish` or per-location `location_member.can_publish`; viewer never) (permissions.ts:21-25,394-412). Generic Google writes gate with `requirePublishGrant` (403 with module code, `lib/server/gbp-write.ts:270-277`). Billing read-only removes all write controls (`sessionCanWrite`, capabilities.ts:76-87).
- **Org approval policy:** `organisation.approval_required` and `organisation.require_two_person_approval`, read by `currentApprovalPolicy` (`lib/server/authz/approval-policy.ts:42-56`).
- **Reply publish routing** (`lib/server/publishing/intent.ts`): after gates, `canPublishLocation` then `requiresApproval(record, canPublish)` (:447-462). `requiresApproval` = `(!canPublish && approval_required) || (require_two_person_approval && !has_qualifying_approval)` (`lib/server/publishing/approval.ts:24-32`). Requester needs `request_approval` (viewers cannot) and the reply parks as `awaiting_approval` with `pending_draft_id` (approval.ts:34-49). A non-publisher without approval_required gets 403 `publish_permission_required` (intent.ts:463-469). `has_qualifying_approval` requires a decider distinct from the requester and voids approvals predating MFA recovery (intent.ts:102-122). UI flag `canRequestApproval` is only true for a non-publisher when approval_required (capabilities.ts:46-57,82-86).
- **Approval decisions** (`lib/server/review-approval.ts:14-29`, the only implementation): approver needs publish authority on the location; two-person mode requires approver != requester; decision names the parked draft (stale pane -> 409); rejection returns reply to draft. Used by `app/api/reviews/[id]/approval/route.ts` and the bulk endpoint.
- **Reviewed Google change sets, bulk listing batches, scheduled posts** share `lib/server/authz/approval-policy.ts`: only current owners/admins approve (`currentManager`/`requireCurrentManager`, :59-122), `secondApproverSatisfied` (:129-135), `requireUnchangedTwoPersonPolicy` (409 if the frozen two-person flag moved, :150-166), `recheckApprovedWork` before dispatch (:232-283), `approvalSession` for the runner (:298-359). Consumers: `lib/server/gbp-change-sets.ts:14,51` (`canApprove`), `lib/server/bulk-listings.ts`, `lib/server/bulk-listing-runner.ts`, `lib/server/publication-schedules.ts`, `lib/server/publication-schedule-runner.ts`.
- **Two-person listing writes:** with `require_two_person_approval` AND org feature `listing_change_approvals`, a publisher's listing-editor write parks as a `mutation_operation` in `awaiting_approval` (202) and a different publisher approves the exact payload hash, which then dispatches through runGbpWrite as the approver (`lib/server/listing-changes.ts:43-60,165-176`). Policy or feature off: write dispatches directly.
- **AI reply verification gate:** `verifyStoredDraft` (`lib/server/drafts.ts:140-214`) recomputes deterministic checks plus the semantic (OpenAI) pass; verdict `fail` if deterministic fails, `pending` if semantic was attempted and `unavailable`, else checked verdict (:170-178); `checks_version` names layers that ran (:182-185). Semantic `skipped` (kill switch `SEMANTIC_VERIFY_ENABLED` off or no key) leaves deterministic checks standing and the draft publishable (drafts.ts:54-63; `lib/server/ai.ts:326-345`). Publish gates `assertDraftPublishable` (intent.ts:156-213): 409 `review_restricted`, `location_not_verified`, `verification_failed`, `verification_required` (pending), `review_changed` (updateTime mismatch), `stale_draft_evidence` (evidence hash mismatch). Then current content checks re-run: new fail -> 409 `verification_failed`; new warn codes not in the last verification -> 409 `verification_required` (intent.ts:399-432).
- **Reply provider write and readback:** pipeline intent -> approval -> provider (outside txn) -> settle -> attempt -> recover (`lib/server/publishing.ts:3-37`); global gate `requireScopesEnabled("publish", REPLY_PUBLISHING_PAUSED)` (`lib/server/publishing/publish.ts:143-152`). Idempotency key from org, review, publish generation and body hash (intent.ts:215; :478-511 concurrent winner -> 409 `publish_in_progress` or recovery). Ambiguous/in-flight attempts recover by readback and body comparison: `decideRecovery` -> succeeded / not_applied / diverged (`lib/server/publishing/recover.ts:83-97`); diverged surfaces 409 `reply_diverged` (:296-313). Automatic retries in `lib/server/publishing/retry.ts` (skipped while `publish` paused, :433).
- **Other Google writes:** `runGbpWrite` phase machine: permission -> capability + kill switch -> durable intent -> provider call outside txn -> readback -> settle -> audit (`lib/server/gbp-write.ts:3-35`), with dispatch pause gate `requireGbpDispatch` (pause-controls.ts:333-339) and readback verdict hooks (gbp-write.ts:678-708). Management mutations use `executeAndConfirmGbpMutation` / `observeAndConfirmGbpMutation` (`lib/server/gbp-confirmation.ts:22-89`): execution_state accepted/unknown/rejected, confirmation via update-mask readback (`matchesGoogleUpdateMask`, :16-20); mismatch -> `google_readback_mismatch`, status `ambiguous` (not success) unless confirmed. Redesign must keep "sent but unconfirmed/ambiguous" distinct from success and from failure.
- **Unknown:** exact UI rendering of pending/ambiguous/diverged states was not traced in this part (see per-route rows).

## 4. UI baseline: breakpoints, shell, test layers, design direction (code-read)


### 4.1 Breakpoint tokens (app/globals.css)

**Sources and imports** (`app/globals.css:1-7`): `@import "tailwindcss" source(none)`, followed by `@source "./"`, `@source "../components"` and `@source "../lib"`. Only `app/`, `components/` and `lib/` are scanned for classes. A class string placed anywhere else, for example in `tests/` or `scripts/`, never produces CSS.

**Width breakpoints.** Tailwind's defaults are kept: sm 40rem/640, md 48rem/768, lg 64rem/1024, xl 80rem/1280, 2xl 96rem/1536. One custom breakpoint is added in `@theme` (`app/globals.css:98-105`): `--breakpoint-wide: 73.75rem` (1180px), which creates the `wide:` and `max-wide:` variants. The comment there says `wide` replaced earlier `max-[1181px]:` arbitrary variants.

**Custom variants:**

| Variant | Line | Condition | Use |
|---|---|---|---|
| `dark` | 14-23 | `.dark *`, or `prefers-color-scheme: dark` when no `.light` class is set | theme |
| `controls` | 31 | min-width 48rem AND min-height 34rem | stacked segmented controls / multi-row toolbars |
| `capsules` | 32-34 | negation of `controls` | compact one-line chrome |
| `short` | 40 | height < 40rem | fold two-row bottom chrome to one row (pairs with `max-md:`) |
| `tall` | 47 | min-height 38.75rem (620px) | sticky header blocks |
| `float-bar` | 59-71 | width < 48rem and min-height 40rem; or width < 48rem while `[data-keyboard=open]` or the inbox bottom toolbar is in search mode | Inbox bottom toolbar (R10) |
| `drawn-disabled` | 77 | `:disabled`/`[data-disabled]`/`[aria-disabled=true]`, not `[aria-busy=true]` | disabled drawing without opacity |
| `hover-fine` | 80 | hover:hover and pointer:fine | hover motion |
| `desk` | 91 | min-width 48rem AND pointer:fine | compact "operator's desk" size scale |
| `keyboard-open` | 96 | `[data-keyboard="open"]` (set on `<html>` by `components/app-shell/viewport-insets.tsx`) | hide chrome while the on-screen keyboard is up |

**Density switch.** Size tokens are touch-first by default. They step down to desk sizes only inside `@media (min-width: 48rem) and (pointer: fine)` on `:root` (`app/globals.css:1098`). A touch tablet at 834px therefore keeps touch sizes (44px controls) even though it shows the rail.

**Chrome tokens** (`app/globals.css:673-680`): `--np-sidebar-width: 240px`, `--np-rail-width: 72px`, `--np-toolbar-h: 56px`, `--np-appbar-h: 52px`, and `--np-tabbar-h: max(56px, …)`.

**Raw media blocks in globals.css:**
- `@media (width < 48rem)` at line 1228: scroll padding for the app bar and tab bar, and the CSS that hides the tab bar while `[data-docked=bottom]` is present or the keyboard is open (lines 1241-1244).
- Lines 1255, 1288 and 1322: placement of the Inbox bottom toolbar.
- `@media (width >= 48rem)` at line 1354: `scroll-padding-top: var(--np-toolbar-h)`.
- Also present: reduced motion (1174, 1517), reduced transparency (1154) and forced colors (1450, 1470).

**JS mirror.** `lib/ui/breakpoints.ts` holds `BREAKPOINT_REM` (sm/md/lg/wide/xl/2xl) and `MEDIA_QUERIES` (the widths plus `controls`, `capsules`, `desk`, `tall` and `phoneOverlay` = max-width 39.999rem, or pointer:coarse and max-height < 30rem). `tests/breakpoints.test.ts` parses globals.css and fails if the CSS and this file disagree. The hooks live in `lib/hooks/use-media-query.ts`:
- `useMediaQuery` (line 44)
- `useBreakpoint` (line 77)
- `useHydratedBreakpoint` (line 89), which returns `null` during SSR and hydration

**Prefix counts.** Counted by grep of `.ts`/`.tsx` for occurrences of `<prefix>:` preceded by a quote, space, backtick, colon, `{` or `(`. They are approximate.

| Prefix | components/ | app/ | total (files) |
|---|---|---|---|
| `sm:` | 218 | 26 | 244 (86) |
| `md:` | 193 | 29 | 222 (60) |
| `lg:` | 26 | 9 | 35 (15) |
| `xl:` | 1 | 1 | 2 (2) |
| `2xl:` | 0 | 0 | 0 |
| `wide:` | 4 | 0 | 4 (3) |
| `max-sm:` | 52 | 0 | 52 (12) |
| `max-md:` | 158 | 11 | 169 (42) |
| `max-lg:` | 4 | 0 | 4 (3) |
| `max-xl:` | 1 | 0 | 1 (1) |
| `max-wide:` (incl. `md:max-wide:`) | 24 | 0 | 24 (4) |
| `desk:` | 202 | 4 | 206 (73) |
| `hover-fine:` | 56 | 0 | 56 (23) |
| `short:` | 13 | 0 | 13 (2) |
| `float-bar:` | 8 | 0 | 8 (1) |
| `controls:` | 2 | 0 | 2 (1) |
| `drawn-disabled:` | 30 (1 file) | 0 | 30 |
| `keyboard-open:` | 1 | 0 | 1 |
| `capsules:` / `tall:` | 0 | 0 | 0. Both are defined and mirrored in JS, but no class uses them. |

**Container queries.**
- There are 34 `@container` declarations. Named containers: areas, booking, cal, card, card-header, chart, composer, date, detail, diff, kpi, lifecycle, lodging-fields, photos, post, profile-body, report (9 uses), scope, section, setup, table, timeline, venue, week and wiz. There are also 10 unnamed ones.
- Container variants, most used first: `@max-3xl/table:` 153, `@xl/areas:` 25, `@3xl:` 17, `@max-xl/diff:` 16, `@3xl/table:` 16, `@xl/cal:` 11, `@max-md:` 10, `@xl/week:` 7, `@3xl/setup:` 6, plus `@[32rem]:` ×4 and `@[36rem]:` ×1 arbitrary sizes.
- Files that declare containers include `components/ui/{card,diff-view,timeline,lifecycle,kpi-tile,table}.tsx`, `components/settings/{settings-section,access-scope-form}.tsx` and `components/reporting/{reply-figures,report-bar-chart}.tsx`.

**matchMedia and JS breakpoint users.** None of these choose a layout, per the rule in docs/specs/2026-10-13-mobile-interaction-infra.md.
- **Shell:**
  - `components/app-shell/app-shell.tsx:190-208` `useCloseAtDesk`: closes the More sheet and the scope sheet when the viewport reaches `md`.
  - `components/app-shell/nav.tsx:204` `useBreakpoint("wide")`: picks which nav row carries the current-page mark.
- **Inbox:**
  - `components/inbox/inbox-view.tsx:224` `useHydratedBreakpoint("lg")` sets `splitView`. `DESKTOP_MEDIA_QUERY = mediaQuery("lg")` is defined in `lib/inbox/url-state.ts:25`.
  - `components/inbox/review-list.tsx:117-121,176`, `components/inbox/list-header.tsx:54` and `components/inbox/inbox-toolbar.tsx:133` (desk).
- **Overlays and primitives:**
  - `components/ui/overlay.tsx:44-48` (`phoneOverlay`: bottom sheet vs dialog)
  - `components/ui/tabs.tsx:775` (desk)
  - `components/ui/toolbar.tsx:90-92` (desk)
  - `components/ui/combobox.tsx:107` (pointer:coarse)
- **Other:**
  - `components/listings/area-frame.tsx:98,775`. This uses the literal `(min-height: 620px)`, which the `tall` mirror could replace.
  - `components/calendar/calendar-grid.tsx:255`, `components/settings/settings-home.tsx:42`, `components/settings/invitations-panel.tsx:1015` and `components/settings/members-table.tsx:273` (all `useHydratedBreakpoint("md")`)
  - `components/locations/profile/sections/{identity,contact}-section.tsx` (desk)

**Where the shell layout switches.** These are all CSS `md:` and `wide:` classes, in `components/app-shell/app-shell.tsx`, `tab-bar.tsx`, `app-bar.tsx`, `topbar.tsx`, `nav.tsx`, `account-menu.tsx`, `client-switcher.tsx` and `command-palette.tsx`. There are 28 `md:hidden|max-md:hidden|hidden md:|md:flex|wide:` hits in components/app-shell. Section 2 has the details.

### 4.2 Current shell structure

The root is `ShellFrame` in `components/app-shell/app-shell.tsx:297-472`. The outer div is `flex min-h-svh … md:h-svh md:min-h-0` (line 350): the document scrolls below 768px, and from 768px the shell is locked to the viewport.

| Piece | File:line | Deciding classes |
|---|---|---|
| Sidebar / rail `<aside data-slot="sidebar">` | app-shell.tsx:358-371 | `hidden w-(--np-rail-width) md:flex wide:w-(--np-sidebar-width)`: hidden on phone, 72px rail from 768px, 240px sidebar from 1180px. Rail mode inside is `md:max-wide:*`: labels below icons, `text-caption`, centred (nav.tsx:57-60,104,116,125). Pinned clients and the group heading are `max-wide:hidden` (nav.tsx:245,286). Brand text is `md:max-wide:sr-only` (app-shell.tsx:153,167). Account menu: account-menu.tsx:309-340. |
| Content column | app-shell.tsx:380 | `overflow-x-clip md:relative md:min-h-0 md:overflow-y-auto md:scroll-pt-[…]`: from 768px this column scrolls, not the document. |
| App bar (phone top bar) `<header data-slot="app-bar">` | app-bar.tsx:322-325 | `sticky top-0 … md:hidden`. Holds a back control or the org name, a compact title, the view count, and a trailing `ClientScopeChip` (client-switcher.tsx:326) or `NotificationsLink`. Bell and chip swap through `[body:has([data-docked=bottom])_&]` (app-bar.tsx:499-505). |
| Desk toolbar `<header data-slot="toolbar">` | topbar.tsx:70-95 | `hidden h-(--np-toolbar-h) … md:flex`, sticky. Contains ClientSwitcher (agency only), wayfinding, ContextHealthChip, NotificationsLink and CommandPaletteButton. Wayfinding (topbar.tsx:22-39): breadcrumbs `hidden wide:flex`; back link `wide:hidden` (tablet). |
| Tab bar `<nav data-slot="tab-bar">` | tab-bar.tsx:114-118 | `fixed inset-x-0 bottom-0 … md:hidden`, a `grid-cols-5` of 4 destinations plus More. Tabs come from `tabDestinations` (`lib/navigation/destinations.ts:222-258`). Agency priority: inbox, listings, clients, reports, then calendar and notifications; business: inbox, listings, calendar, reports, notifications; `TAB_COUNT = 4`. The tab bar is hidden by CSS when a bar is docked or the keyboard is open (globals.css:1241-1244). `<main>` pads for it with `max-md:pb-[calc(var(--np-tabbar-h)+…)]` (app-shell.tsx:421). |
| More sheet | more-sheet.tsx:84-90 | `<Sheet><SheetContent side="bottom" data-slot="more-sheet">` lists `moreDestinations` (destinations.ts:265), the account panel, and hand-offs to the palette and scope sheet. It opens only from the tab bar's More button and closes at `md` (useCloseAtDesk). |
| Scope sheet (client then locations; locations only for a business) | scope-sheet.tsx:50-63,167,416; wrapper `ClientScopeSheet` client-switcher.tsx:395 | `<SheetContent variant="inset">`, with Business and Agency variants. Opened from the app bar chip or the More sheet; phone only in practice (closes at `md`). Model helpers are in scope-sheet-model.tsx (`SEARCH_THRESHOLD = 8`). |
| Client switcher (desk) | client-switcher.tsx:108-140 | Trigger `max-md:hidden pointer-coarse:h-11`, 34px with a mouse and 44px on touch. Rendered only in agency mode in the toolbar. |
| Command palette | command-palette.tsx:155-170 (Cmd/Ctrl+K or `/`), 235-252 (button); dialog lazy-loaded from command-palette-dialog.tsx:141 (`CommandDialog`) | Button is `md:min-w-50` from 768px and becomes an icon-only `max-md:size-11` circle on phone. The phone app bar opens it too (`onOpenPalette`). |
| Notifications | notifications-link.tsx:28-51 | `useQuery({ queryKey: queryKeys.notifications("badge") })`, linking to `/notifications`. Shown in the toolbar from 768px and in the app bar on phone. Notifications is a tab or a More row on phone and is left out of the sidebar (destinations.ts, `sidebarDestinations`). |
| Notices | app-shell.tsx:396-408 | ImpersonationBanner, ShellOAuthReturn, ShellReconnectBanner, BillingBanner and MfaStepUpHost, at every width. |

**By width (inferred from classes):**
- **Phone (<768, e.g. 390):**
  - Sticky app bar (52px plus safe area) and a fixed bottom tab bar with 5 cells.
  - No sidebar or toolbar. The document scrolls.
  - The More sheet and scope sheet are bottom and inset sheets.
  - The client switcher shows as a chip in the app bar.
  - Overlays become bottom sheets (`phoneOverlay`).
- **Tablet (834, touch):**
  - `md` applies and `wide` does not. That gives the 72px icon rail with labels under the icons, plus the 56px desk toolbar.
  - The toolbar shows a labelled back control instead of breadcrumbs, and no tab bar.
  - `desk` is false on a coarse pointer, so touch sizes stay and the switcher is 44px.
  - Inbox `splitView` (`lg`, 1024) is false, so the Inbox uses push navigation.
  - The `nm-capture` tablet preset is 834x1194 touch (`tests/visual/nm-capture-lib.mjs:14-19`). The e2e.config `tablet` target is 768x1024.
- **Desktop (1440, mouse):**
  - `wide` applies: the 240px sidebar with pinned clients, and a toolbar with breadcrumbs.
  - `desk` density applies.
  - Inbox split view (lg) is on.

### 4.3 Test layers and release gate

**Layers** (`docs/testing.md:9-23`):

| Layer | Location | Runner | Notes |
|---|---|---|---|
| Unit | `tests/*.test.ts`, `tests/server`, `tests/harness`, `tests/lib`, `tests/perf`, `tests/visual` | Vitest project `unit`, Node | |
| Component | `tests/components/**` | Vitest project `components`, jsdom | Setup file `tests/components/setup.ts`; 15s timeout |
| Integration | `tests/integration/**` | Vitest project `integration` | Real PG17 and the standalone server; one file at a time |
| Browser | `tests/e2e/*.spec.ts` | Playwright | |
| Outside the gate | `tests/agentic` (e2e.config.ts), `tests/visual` tools, the perf lab, `pnpm audit:mobile` | by hand | |

The Vitest projects are defined in `vitest.config.ts:19-60`.

**Playwright** (`playwright.config.ts`):
- `testDir` is `./tests/e2e`. It runs on 1 worker with `fullyParallel: false`, retries 1 on CI and 0 locally, and `forbidOnly` on CI.
- Projects:
  - (1) An unnamed default project, which excludes `touch-critical`. `PLAYWRIGHT_SUITE=shared` also excludes the 14 isolated backend specs listed in `ISOLATED` (line 17). `PLAYWRIGHT_SUITE=isolated` runs only those.
  - (2) `touch-390`: `{ width: 390, height: 844 }`, `hasTouch`, `isMobile`, DPR 3, Chromium. Runs only `touch-critical.spec.ts` (lines 56-66).
- The webServer is `pnpm start` on port 3100.
- Specs set their own viewports. Counts of `width:` literals in tests/e2e: 390 ×31, 1280 ×11, 375 ×7, 1440 ×6, 320 ×2, 900 ×1. docs/testing.md:16 says journeys run at 1280, with layout checks at 375 and 768. No spec sets 834.

**Agentic** (`e2e.config.ts`):
- External runner, not a repo dependency, and it needs a model login.
- Tests: `tests/agentic/**/*.e2e.ts`.
- Targets: `desktop` 1440x900, `mobile` 390x844 with an iPhone UA (no hasTouch), `tablet` 768x1024 (lines 67-86).
- Tags per describe:
  - sign-in [desktop, mobile, auth]
  - inbox [desktop, inbox, mutates]
  - content-checks [desktop, listings, mutates]
  - client-switching [desktop, clients]
  - listing-profile [desktop, listings]
  - mobile-nav [mobile, navigation]
  - mobile-review-listings [mobile, inbox, listings]
  - settings [settings], with per-test desktop, mobile and viewer entries
  - tablet-back [tablet, navigation]
- `sessions.setup.e2e.ts` and `support.ts` are setup and helper files.

**Visual tools (test-only branch additions):**
- `tests/visual/nm-capture.mjs` and `nm-capture-lib.mjs`: presets desktop 1440x900 mouse, mobile/phone 390x844 touch, tablet 834x1194 touch with both layout state sets; `TOUCH_BELOW = 1024`.
- `docs/redesign/2026-11/check-inventory.mjs`: checks that every app route file is in INVENTORY.md, that each API group is listed, that row ids are R01.. with no gaps, and, with `--manifest`, that each row has a phone, tablet and desktop light shot.

**scripts/check-design.mjs.** Runs over `SCAN_DIRS = app, components, lib` (line 80) and uses the TS parser.
- Rules:
  - R1: arbitrary type size
  - R2: literal colour
  - R3: arbitrary spacing or size
  - R4: arbitrary radius, shadow or z
  - R5: raw primitive outside components/ui
  - R6: inline style other than custom properties
  - R7: literal breakpoint (literal width in matchMedia, `max-[…]:`, `min-[…]:` or `[@media…]:`; the "768 / 1180 split")
- `--ratchet` fails if any count per file or rule rises above `scripts/design-baseline.json`. Current totals: R1 12, R2 9, R3 53, R4 12, R5 1, R6 2, R7 14.
- Note: `app-shell.tsx:422` `md:[@media(min-height:620px)]:` is one of the R7 hits that the `tall` variant could replace.

**scripts/check-contrast.mjs.** Parses `app/globals.css` with `lib/design/tokens.ts` and audits it with `lib/design/contrast-pairs.ts`, in both themes. It exits 1 on any failure. The same modules back `tests/design-tokens-contrast.test.ts` and the /design-system page.

**`pnpm verify`** (package.json): `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm check:design --ratchet`.
- `pnpm lint` is `eslint --max-warnings 0`.
- `pnpm format:check` checks only the files the change touches.
- `pnpm test` is `vitest run --project unit --project components`.
- No database is needed. `pnpm check:contrast` is not part of `verify`; it is in the gate's `design` step.

**`pnpm verify:release`** runs `scripts/release/verify-local.mjs`.
- It checks HEAD out into a fresh detached worktree and runs `GATE_STEPS` from `scripts/release/local-receipt.mjs:45-160`. Each step starts once the steps it needs have passed, and steps that need a database get their own throwaway PG17.
- Steps:
  - frozen-install
  - typecheck
  - lint
  - unit (`pnpm test`)
  - format (`format-changed --check --base origin/main`)
  - design (`check:design --ratchet` plus `check:contrast`)
  - build (webpack standalone)
  - bundle-budget (`tests/perf/route-js.mjs`; gzip KB: chunk 70, shared 400, route 560)
  - migration-policy
  - migrate-fresh
  - migrate-upgrade
  - migrate-concurrent
  - integration (4 shards by default; must pass more than 0 tests with none skipped)
  - e2e (Playwright `shared` and `isolated` side by side with `--forbid-only`; more than 0 passed, none skipped)
  - audit (`pnpm audit --prod --audit-level high`)
  - workflow-lint (actionlint and zizmor; skipped with a note if not installed)
  - secret-scan (gitleaks; required)
- It writes a v3 receipt to `docs/release/receipts/local/`. `ci.yml`'s Gate job runs the same script (`docs/ci.md:71-119,205-289`).
- The `touch-390` project runs inside `pnpm test:e2e`. The agentic, nm-capture and `audit:mobile` tools are not part of the gate.

### 4.4 Active design direction docs

Earlier identity specs are marked superseded: 2026-07-28-design-system, 2026-09-03-visual-identity, 2026-09-04-apple-identity and 2026-09-19-warm-paper-identity. The current chain is listed below.

- **docs/specs/2026-09-23-operators-desk-identity.md** (accepted). The base visual identity: cool paper, white cards drawn by a 1px line, one green accent, a charcoal "dark bar" once per screen for the action that reaches Google, status as a word plus a tone, and the four-layer tokens in globals.css with a contrast gate.
- **docs/specs/2026-09-23-redesign-route-checklist.md** (working record). The route-by-route implementation and verification log for that identity.
- **docs/specs/2026-10-13-mobile-first-design-system.md** (accepted, amends operators-desk). Touch first and desk earned; layout in CSS and behaviour in JS; one bottom bar at a time; thumb-zone primary actions and bottom sheets; nothing hides focus (WCAG 2.4.11); one primitive per job.
  - Shell table (lines 117-123): <48rem tab bar plus app bar; 48rem to wide, 72px rail plus desk toolbar; ≥wide, 240px sidebar plus breadcrumbs.
  - Amendment D1 (line 196): all sans, serif removed.
- **docs/specs/2026-10-13-mobile-interaction-infra.md.** One source of breakpoints: CSS, mirrored in `lib/ui/breakpoints.ts` and guarded by `tests/breakpoints.test.ts`. No hand-written `(min-width: …px)`. JS media queries are for behaviour only. Keyboard insets become CSS variables, and the viewport meta enables safe areas.
- **docs/specs/2026-10-29-taste-pilot-direction.md** (pilot, refines operators-desk). "States are drawn, chrome is ink, colour is for data and the one action."
  - Disabled is drawn with `--np-disabled-*` roles, never opacity.
  - One `focus-halo`.
  - Accent only on the primary action, focus and the current place.
  - Skeletons match the final layout, with no shimmer.
  - Empty states are a sentence in a frame.
  - KPIs are a hairline-split `KpiStrip` in `text-figure`.
  - Feedback is 140ms on transform and colour.
  - Pilots: P1 Button, P2 field chrome, P3 selection/CountBadge, P4 Empty/Skeleton/QueryPending, P5 KpiStrip.
  - Kept as the owner's call: the green filled primary, 12px card radius, the tinted nav row with a 3px bar, and the sunken table header.
- **docs/specs/2026-09-18-work-first-ia.md, docs/specs/2026-09-19-listings.md, docs/specs/2026-09-03-agency-ux.md.** Information architecture: work-first navigation, the listing workspace built around listing health, and the agency client model. They are amended in turn but still stand for "what is where".
- **docs/specs/2026-10-03-business-mode-and-ai-credits.md (+ -fanout).** Historical (archived 2026-10-09, shipped in PR #56). Its rule still holds: business mode never says "client" or "agency", and agency mode is a setting.
- **docs/specs/2026-10-30-opengmb-gap-features.md.** A shipped feature record, not a visual mandate. It covers the listing completeness score (column on /listings, overview card, owner/admin skip with reason, read-only for members) and four other features.

**Inconsistencies a redesigner should know:**
- `capsules:` and `tall:` are defined but have no class uses.
- Two places still use a literal 620px instead of `tall`: `area-frame.tsx:98` and `app-shell.tsx:422`.
- The tablet width differs by tool: e2e.config uses 768, nm-capture uses 834, and Playwright has no tablet project at all.
- The comment at `topbar.tsx:17` says the rail band is "768 and 1180", while the token is 73.75rem = 1180px. They agree.

## 5. Current defects (code-verified; render pending)

The task asked for a defect list made from reviewing rendered PNGs. **No PNG could be rendered** (section 2), so this list covers only what the code proves at `367719b3`. Each item cites the code. Render-only questions (overflow, clipping, real overlap, contrast as painted) go in 5.2 as "needs render". `tests/visual/nm-capture-before.sh` produces the evidence that settles them.

Severity: **high** breaks or misleads a core journey; **medium** is a visible inconsistency or a friction point on a main route; **low** is polish or debt.

### 5.1 Verified in code

| # | Route | Viewport | Defect | Evidence (code) | Severity | Kind |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | all dashboard routes | phone (Android back) | System back never closes a sheet or dialog; it navigates the page underneath | no popstate/pushState in `components/ui/{overlay,dialog,sheet,alert-dialog}.tsx`; only listener is `lib/editors/use-leave-guard.ts:178-197` | medium | inconsistent pattern |
| D02 | error boundaries (`app/(dashboard)/error.tsx`, `app/global-error.tsx`) | all | "Try again" calls `(unstable_retry ?? reset)()` and never re-fetches server data (AF-5) | `app/(dashboard)/error.tsx:60`, `app/global-error.tsx:96` | medium | recovery state |
| D03 | `/listings/[id]/suggestions` | all | Food-menu suggestion decisions send the profile's revision, which yields `canonical_resource_stale` (AF-1) | `components/locations/suggestions/suggestions-page.tsx:62` | high | broken action |
| D04 | `/listings/[id]/*` (member) | all | "Link it in Setup" is shown to members, and following it leads to Access denied (AF-9) | `components/locations/tab-states.tsx:57-63` (no role check) | medium | permission state |
| D05 | `/listings/[id]/*` (business mode) | desktop | Breadcrumb trail repeats the place; business trails never fold (DSK-05 / AF-13) | `lib/ui/breadcrumb-trail.ts:161-168` | low | redundant control |
| D06 | `/inbox` | phone | Single publish is one press with no confirmation, while bulk approve confirms | `components/inbox/action-bar.tsx:79`; `components/inbox/bulk-action-bar.tsx:306,791-795` | low | inconsistent pattern |
| D07 | `/inbox` (member, viewer) | all | No in-app refresh for members and viewers (the sync button returns null) | `app/(dashboard)/inbox/page.tsx:55`; `components/inbox/sync-reviews-button.tsx:95` | low | stale state |
| D08 | shell (`/settings/billing` worst) | all | Dismissed reconnect banner is server-rendered, then removed on hydration (layout shift) | `components/app-shell/reconnect-banner.tsx:93-97` (server snapshot `() => null`) | medium | layout shift |
| D09 | shell | all | Every full load hydrates the whole location directory into the query cache | `app/(dashboard)/layout.tsx:135-143` | medium | performance |
| D10 | `/setup` | all, phone worst | Locations step embeds a ~3,200-line onboarding form; "You can come back to any step later." is rendered twice | `components/setup/onboarding-*.tsx` (3,234 lines); `components/setup/setup-wizard.tsx:402,425` | high | confusing nesting |
| D11 | `/team`, `/setup` | all | Loading and error states in three idioms (25 literal `role="status"`, `QueryStates`, `Alert`+refetch) | `components/setup/*`, `components/settings/*` | medium | inconsistent states |
| D12 | `/listings/[id]/hours` | phone | `CapabilityBanner` and an `Alert` stack two near-identical banners | `components/locations/hours-tab.tsx:13,143-145`; `components/editors/capability-banner.tsx` | low | redundant control |
| D13 | `/listings/[id]/hours` | all | After "Keep Google's hours" the toast says "Google's hours are in your draft" (AF-19) | `components/locations/hours-tab.tsx:518` | low | copy/state |
| D14 | `/listings/[id]/profile` | all | Lodging and service review/approve controllers and approval sheets are duplicated and have drifted | `components/locations/profile/sections/use-{lodging,service}-review.ts`, `{lodging,service}-approval-sheet.tsx` | medium | inconsistent pattern |
| D15 | `/listings/[id]/people` | all | Per-row role change is a Select plus a separate review button plus Remove | `components/locations/administration/admins.tsx:104,152-169` | medium | redundant control |
| D16 | `/listings/[id]/booking` | all | Booking review sheet says "On Google now: No link" for the Type field (P2-13a) | `components/locations/place-actions/place-action-approval-sheet.tsx:82` | low | copy/state |
| D17 | `/listings/[id]` activity | all | Activity cursor regex lacks `bulk:` and `schedule:`, so those entries cannot page (PR-L02 / AF-26) | `lib/contracts/location-activity.ts:41` | medium | partial state |
| D18 | `/listings/[id]/photos` | phone (touch) | "Use as logo" icon-only star carries its meaning only in a tooltip | `components/locations/media/media-card.tsx:237-255` | low | small target / hidden meaning |
| D19 | forms with tags (global) | phone | TagInput refocuses (reopens keyboard) after each chip removal; remove targets are 32px on touch | `components/ui/tag-input.tsx:106,151` | low | small target |
| D20 | primitives (Switch, Tabs, Checkbox, Radio, …) | all | Disabled still drawn with opacity, against the taste-pilot "drawn disabled" rule (TP-1A) | `components/ui/switch.tsx:24`, `components/ui/tabs.tsx:175,193` | low | inconsistent pattern |
| D21 | menus/popovers | all | Menu surface animates `scale` without listing it in the transition, so it snaps; border plus shadow (TP-1B) | `components/ui/menu-surface.tsx:39-41` | low | polish |
| D22 | index pages (`/team`, `/clients`, `/listings`) | phone | Primary create actions sit in the page header, outside the thumb zone (mux-12) | `components/settings/team-view.tsx:68`; `components/app-shell/page-frame.tsx` PageHeader actions | medium | reachability |
| D23 | `/settings/security` | all | No way to remove or replace an MFA authenticator; the support channel is deferred (AF-6/7) | no unenroll in `components/`, `app/`, `lib/` | medium | missing recovery |
| D24 | `/calendar` | all | "Contact support" is still a dead end when scheduling is off (LST-28 / AF-6) | `components/calendar/publication-calendar.tsx:301-304` | low | missing recovery |
| D25 | shell | all | No help or feedback destination anywhere (SET-27) | `lib/navigation/destinations.ts`, `components/app-shell/more-sheet.tsx` | low | missing route |
| D26 | design tokens | all | Contrast manifest gates `--np-warning-ink` as the attention dot, while the dot paints `bg-warning-solid` (audited 1.97:1) | `lib/design/contrast-pairs.ts:603-607`; `lib/ui/status-tone.ts:97` | medium | contrast |
| D27 | breakpoints | all | `capsules:`/`tall:` are defined but unused; a literal 620px height still appears twice instead of `tall` | `app/globals.css:31-47`; `components/listings/area-frame.tsx:98`; `components/app-shell/app-shell.tsx:422` | low | token drift |
| D28 | test viewports | tablet | Tablet width differs by tool (e2e.config 768x1024, nm-capture 834x1194, no Playwright tablet project); no gate covers 834 | `e2e.config.ts:67-86`; `playwright.config.ts:56-66` | medium | coverage gap |
| D29 | test gates | all | No visual-regression or console-error gate in dev mode (0 `toHaveScreenshot`; e2e runs the production build) | `tests/`; `playwright.config.ts:68-72` | medium | coverage gap |
| D30 | `/` root, boundaries | all | Root layout `lang="en"` while `global-error`, `/r/[code]` and the boundaries use `en-GB` | `app/layout.tsx`; `app/global-error.tsx` (see INVENTORY R-rows for public) | low | inconsistency |

### 5.2 Needs a render (open until `nm-capture-before.sh` runs)

These earlier-audit claims depend on painted layout. The code neither proves nor refutes them.

| Claim (source id) | Route | Viewport | Severity claimed |
| --- | --- | --- | --- |
| Listing workspace header fills ~45% of the first phone viewport; editors start below the fold (listings-content-01, mux-03) | `/listings/[id]/hours` and other areas | phone 390 | high |
| Profile footer bar covers the first field and ~21% of the viewport with nothing to do (listing-admin-profile-02) | `/listings/[id]/profile` | phone | high |
| Reports first screen is mostly controls; KPI tiles single-column at 360px (clients-reports-02) | `/reports` | phone 360/390 | high |
| Board rows become ~228px cards, two listings per screen (listings-content-10) | `/listings` | phone | medium |
| Client cards ~230px tall with 6 labelled fields (clients-reports-12) | `/clients` | phone | medium |
| Members card overlaps Publishing and Joined at 360px (settings-setup-auth-06) | `/team` | phone 360 | medium |
| People page first viewport has no roster and no "Add administrator" (listing-admin-profile-05/v3/r6) | `/listings/[id]/people` | phone | medium |
| Verification page leads with a long standing card; PIN entry below the fold (listing-admin-profile-06) | `/listings/[id]/verification` | phone | medium |
| PageHeader puts every action at the top on phones (shell-17) | `/clients/[clientId]/settings` | phone | medium |
| Prose-heavy listing areas and duplicated headings (mux-18) | `/listings/[id]/booking` | phone | medium |
| Card and divider edges close to invisible; several AA pairs pass by thin margins (foundations-17) | global | all | low |
| Tab bar / docked action bar overlap and keyboard-open behaviour (`[data-docked=bottom]`, `keyboard-open`) | `/inbox`, listing editors | phone, short phones 390x600 | — (verify) |
| Tablet 834 touch: rail plus touch-size controls plus push-navigation inbox (not split) | all | tablet 834 | — (verify) |

## 6. Earlier audits checked against the current code

Each concrete claim in the audits below was checked against the code at `367719b3` (method: code reading, with file:line evidence per claim). The per-claim JSON is in `test-results/a-inventory/parts/audit-{mobile,uxflows}.json`; the orchestrator copies it to the durable evidence folder.

| Audit | Claims | Fixed | Changed | Still present | Needs render | Unknown |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/audits/2026-10-13-mobile-first-audit.md` | 643 | 254 | 174 | 201 (172 are "retain/consolidate" recommendations, not defects; 29 severity-tagged defects → section 5.1) | 14 (→ 5.2) | 0 |
| `docs/audits/2026-10-15-ux-flows/findings.md` | 136 | 127 | 5 | 4 (INB-19 pull-to-refresh, LST-28, DSK-05, SET-27) | 0 | 0 |
| `docs/audits/2026-10-15-ux-flows/results.md` open follow-ups | 14 | 5 | 1 | 2 (P2-13a, PR-L02) | 6 | 0 |
| `docs/audits/2026-10-28-all-flows/README.md` owner decisions and follow-ups | 42 | 0 | 2 | 13 | 4 | 23 |
| `docs/audits/2026-10-29-taste-pilot/README.md` §5-6 fan-out and owner decisions | 25 | 3 | 3 | 10 | 3 | 6 |

The 157 low-level entries in `docs/audits/2026-10-29-taste-pilot/audit-findings.json` were not checked one by one.

Open owner decisions carried from the taste pilot are unchanged in the code:
- **TP-OD-1:** primary green vs near-black (`app/globals.css:799`).
- **TP-OD-2:** 12px card radius (`app/globals.css:596`).

From the 2026-10-28 follow-ups:
- **AF-11:** client health severity order (`lib/clients/health.ts:378`).
- **AF-12:** Hours caption (`components/locations/hours-editor.tsx:526-530`).
