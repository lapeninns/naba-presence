# M6 Connections + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Settings surface — four sibling sub-routes (Policy `/settings`, Team `/settings/team`, Compliance `/settings/compliance`, Connections `/settings/connections`) — on the M1 foundation and M4/M5's Query/typed-client/dirty-guard/gating machinery, closing the audit-flagged flows in spec §8 (Connections + Settings clauses) while treating the backend as consume-only except three sanctioned additions (spec §3): an additive org/settings capability object, a new settings-capabilities read route, and the new invitation-revoke route. The `/connections → /settings/connections` legacy redirect is restored, forwarding its query string so the OAuth return state survives (audit C-2).

**Architecture:** `app/(dashboard)/settings/layout.tsx` is a server component that auth-gates and renders a client `SettingsShell` owning the single page `<main>` (via `PageFrame`) and a capability-filtered sub-nav (`SettingsNav`); each sub-route is its own server page that renders its own single `<h1>` via `PageHeader` and one client feature component seeded by client fetch through TanStack Query over the M1 typed client (`apiFetch` + zod). These are **sibling routes, not nested-shell tabs** (unlike M5's location workspace) — the settings layout owns `<main>` and the sub-nav, but each page owns its own distinct `<h1>` (`Reply policy` / `Team access` / `Data and compliance` / `Google Business Profile`, matching the surviving `tests/e2e/settings.spec.ts` contract). Every privileged control gates on one server-computed capability object — `{ canManageTeam, canManageConnections, canEditSettings, canViewCompliance, canManageCompliance }` from the ONE sanctioned capability addition (`lib/server/capabilities.ts` + `GET /api/settings/capabilities`), consumed by `useSettingsCapabilities()` — so a member/viewer never reaches a 403 from a primary control (spec §9). Connections is decomposed into six cards (connection, account picker, import, backfill, notifications, management) over three hooks (`useConnectionWorkspace`, `useGoogleAccounts`, `useLocationImport`) plus a single pure `deriveAutoSelection` rule; the OAuth handshake is a redirect flow (`POST /api/google/connect/start → { authorizationUrl }`, `window.location.assign`, Google → server callback → `/connections?google=…` → the query-forwarding redirect → `/settings/connections?google=…`), never rendering or collecting Google credentials. All mutations are server-confirmed with per-action pending; no optimistic writes. The shell freshness chip reuses the already-built `useConnectionHealth` (M3) over the shared `['connections']` key. No server prefetch/dehydration this milestone (deferred carry-forward, D3).

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives, TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Next.js 16 App Router, webpack ONLY (`next dev`/`build --webpack`; never touch the `--webpack` flags). React 19, TS strict, Tailwind v4, @base-ui/react primitives, TanStack Query v5 (staleTime 30s, keepPreviousData), zod 4. NO new npm dependency (everything from installed deps).
- M1 design tokens ONLY: no raw hex, no `text-[NNpx]` arbitrary sizes, no hardcoded `duration-N`. Token/CSS-var classes only.
- Exactly one `<h1>` and one `<main>` PER PAGE. The Settings shell/layout owns the page `<main>`; each sub-page (Policy/Team/Compliance/Connections) provides its own single `<h1>` via `PageHeader` (they are sibling routes, NOT nested-inside-one-shell tabs like M5 — confirm against the `settings.spec.ts` which expects a distinct level-1 heading per route). Leaf card components use `<h2>`/`<h3>`.
- GB English spelling; NO error codes or env-flag names or byte counts or internal jargon shown to users — one `describeActionError` mapping layer; humanised enums.
- PROTECTED PATHS (`app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`) are CONSUME-ONLY EXCEPT the sanctioned M6 edits: (1) `lib/server/capabilities.ts` ADDITIVE org/settings capabilities; (2) NEW `app/api/settings/capabilities/route.ts`; (3) MODIFY `app/api/invitations/[token]/route.ts` — add a `DELETE` revoke handler, reusing the existing `[token]` slug (App Router forbids a second slug name at the same path level), keeping its existing `GET` byte-identical (spec §3). Everything else under protected paths stays byte-identical. `app/(dashboard)/settings/**` page routes are NOT under `app/api` — fine to create.
- Commit conventional + trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Every route: server component that auth-gates, renders a client feature component seeded by client fetch (server-hydration §5 deferred — document it, like M5 did). Client-safe zod form schemas go in `lib/settings/forms/` (NOT `lib/domain` — protected), mirrored from the route schemas with parity tests. Hand-rolled `useState`+zod forms (no react-hook-form — not installed).
- Package manager `pnpm`. Branch: `frontend-rebuild-m6-connections-settings` (cut from `main` @ `cf875ee`). Delivery model is **per-milestone merge to `main`** (spec §10). `main` serves a partially-rebuilt product: `/performance` still 404s until M7; the three M8 consoles (business-info / industry / administration, and the location Administration danger zone) do not exist yet.
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`, mirroring `lib/api/connections.ts`). TanStack Query hooks carry `staleTime: 30s` (spec §6); the shared `['connections']` key keeps its M3 `refetchInterval: 60s` + `refetchOnWindowFocus`. Mutations invalidate their keys — the card re-reads within one round trip. All writes go through the typed client via `ApiClientError { status, code, details }`; server codes map to user copy through one mapping layer (`lib/settings/action-errors.ts`) — no component invents its own error text.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`). House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- The gate command (Task 11): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`.

## Design decisions (LOCKED — encode exactly)

- **D1 — Scope.** Four settings sub-areas (Policy, Team, Compliance, Connections) + the Connections six-card workspace. **DEFERRED:** the three raw-JSON consoles including the per-location Administration console (add/remove admins, ownership transfer, delete-location danger zone) → M8; Home KPIs / `providerTotals.divergence` → M7; the audit-log viewer (`GET /api/audit-log` exists but §8 does not scope a viewer) → later; per-location team assignment editing (`PUT /api/location-members` exists) → M8 (Administration); account/profile/password self-service → **NOT in §8 scope, no backend exists, do NOT invent one**.
- **D2 — Routing.** SIBLING routes under `app/(dashboard)/settings/`: `layout.tsx` (owns `<main>` + sub-nav), `page.tsx` (Policy), `team/page.tsx`, `compliance/page.tsx`, `connections/page.tsx`. Each page owns its own single `<h1>` via `PageHeader`. The layout does **not** render an `<h1>`. Distinct headings: `Reply policy`, `Team access`, `Data and compliance`, `Google Business Profile` (the surviving `settings.spec.ts` invariants). The active sub-route is the URL path segment (not a searchParam). Role-gated sub-pages `redirect("/settings")` server-side when the session role lacks access (Policy is readable by any authenticated user; Team/Connections need owner|admin; Compliance needs owner|admin to view, owner to manage).
- **D3 — Rendering.** CLIENT-FETCH via TanStack Query (consistent with M3/M4/M5). Server-hydration per spec §5 is **DEFERRED** — RECORDED as a prominent carry-forward. `listConnections` (`lib/server/connections.ts`) and the settings SQL (inline in `app/api/settings/route.ts`) exist, so a later dedicated effort can retrofit RSC prefetch + dehydrate **additively** — seeding the same Query keys this plan defines — without reshaping the client. Data hooks inherit `staleTime: 30s`; `['connections']` keeps its 60s poll.
- **D4 — Capabilities (the ONE sanctioned capability edit — spec §3).** Add an additive `SettingsCapabilities` type + a pure `settingsCapabilities(session)` to `lib/server/capabilities.ts` computing `{ canManageTeam: role∈{owner,admin}, canManageConnections: role∈{owner,admin}, canEditSettings: role∈{owner,admin}, canViewCompliance: role∈{owner,admin}, canManageCompliance: role==="owner" }`, mirroring the route guards exactly (pure role predicates, no new SQL). **Mechanism (mirrors M5's D4): a dedicated read-only route** `GET /api/settings/capabilities` → `{ capabilities: SettingsCapabilities }`, consumed by one client + `useSettingsCapabilities()` hook reused across the shell and every page. In-page controls gate on the hook's caps; the sub-nav derives visibility synchronously from the server-provided `role` via a pure `settingsGatingFromRole(role)` mirror (no flash) that a parity test proves identical to the server predicates. Unit-test every role EXECUTABLY (owner / admin / member / viewer) as an integration test hitting the real route.
- **D5 — Compliance gating split (owner vs admin).** Two capabilities: `canViewCompliance = role∈{owner,admin}` and `canManageCompliance = role==="owner"`. The Compliance sub-nav item + page are visible to owner AND admin (the backend lets admins `GET`/`POST /api/privacy/requests` and `GET /api/legal-holds`); within the page, the privacy-request **list + create** are available to both, while the owner-only controls — privacy-request **fulfil/reject/status**, the **export** card, and the **entire legal-holds card** (create/release) — gate on `canManageCompliance` (hidden or disabled-with-`GateNote`). This preserves "no reachable 403 from a primary control" (spec §9) while surfacing the reads/creates admins are entitled to, and matches spec §8 ("legal-holds card owner-gated" — only the holds card, not the whole surface). The page server-redirects when `role` is neither owner nor admin.
- **D6 — Connections decomposition (spec §8).** Six cards over three hooks + one pure rule: `connection-card` + `reconnect-alert` + `oauth-return` (hook `useConnectionWorkspace`); `account-picker-card` + `use-google-locations` discovery (hook `useGoogleAccounts` + pure `deriveAutoSelection`); `import-card` (hook `useLocationImport`); `backfill-card` (hook `useBackfill`); `notifications-card` (hook `useNotificationSetting`); `management` = the connection list rows with per-connection status/disconnect inside `connection-card`. OAuth NEVER renders/collects Google credentials — `POST /api/google/connect/start` → `window.location.assign(authorizationUrl)`. "Reconnect" = re-run `connect/start`; the callback closes the open reconnect task server-side. Import resolves re-link conflicts upfront in ONE dialog (`confirmRelink`) and reports per-item pending/results. Honest stepper (real query signal, no fake progress). Backfill polls (`refetchInterval`) ONLY while any progress row is `running`. Freshness chip reuses `useConnectionHealth`.
- **D7 — Forms + dirty guard.** Policy uses the shared `useDirtyGuard` (`lib/hooks/use-dirty-guard.ts`) + a client-safe zod mirror in `lib/settings/forms/`; server field errors map to fields by `details` path where the shape is flat (Policy). Team/Compliance create-forms are short one-shot dialogs (no long-lived draft) and use inline validation + per-submit pending, not the dirty guard. Notifications editing (pubsub topic + types) uses the dirty guard when dirty-away is possible; kept simple with a per-save pending.
- **D8 — Feature/paused states.** Backfill `POST` 503 `sync_paused` → honest "Review sync is paused" state (never the env-flag name). Notifications empty `pubsubTopic` = disable (surfaced as "Turn off Google notifications"). No error codes shown.
- **D9 — Nav prefetch + legacy redirect.** Flip `/settings` → `prefetch: true` in `components/app-shell/nav.tsx` (M1 carry-forward, now that `/settings` ships). Restore the `/connections → /settings/connections` legacy redirect as a 3-line server page that **forwards the query string** (audit C-2: the backend OAuth callback hardcodes `/connections?google=…`, so losing the query string loses the OAuth return state), mirroring the existing `app/reviews/page.tsx` pattern.
- **D10 — Milestone e2e.** Rewrite `tests/e2e/settings.spec.ts` to the `locations.spec.ts` template (`readJourneyState` + cookie + zero-console-error/zero-pageerror + best-practice structural axe on all four sub-routes in both themes) with the distinct-`h1`-per-route assertions and the `/connections → /settings/connections` query-forward redirect. Add a NEW OAuth-outcomes spec (stub-driven `?google=connected|error` on `/settings/connections`) and a per-role permission walk (owner / admin / member / viewer) with no reachable 403 from a primary control and an axe pass with a dialog open. Add `use-connection-workspace`, `deriveAutoSelection`, and dirty-guard unit tests. Full gate + parity-oracle integration. Un-ignore `settings.spec.ts` in `playwright.config.ts`.
- **D11 — Standard constraints** (copied into Global Constraints above): M1 tokens only; one h1/one main; GB English / no error codes shown; protected paths consume-only except D4's three sanctioned files; no new deps; gate green + `pnpm build` for page tasks; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Backend response shapes consumed (READ-ONLY unless a task sanctions the edit)

- `GET /api/settings` (`requireSession`, any role) → `{ settings: { approvalRequired: boolean, requireTwoPersonApproval: boolean, rawContentRetentionDays: number, defaultLanguageCode: string, defaultTimezone: string, directPublishConsentAt: string | null } }`. `PATCH` (`requireRole owner/admin`) body `{ approvalRequired: boolean, requireTwoPersonApproval?: boolean, rawContentRetentionDays: int 1..30, defaultLanguageCode: /^[a-z]{2,3}(?:-[A-Z]{2})?$/, defaultTimezone: 1..80 (refined via Intl), directPublishConsent: boolean (default false) }` → `{ settings }` (same shape; note GET/PATCH return `directPublishConsentAt`, the body sends `directPublishConsent`). Codes: `direct_publish_consent_required`(403 — when `!approvalRequired && (role !== "owner" || !directPublishConsent)`), `organisation_not_found`(404, GET only).
- `GET /api/settings/capabilities` (NEW, Task 1) → `{ capabilities: SettingsCapabilities }`.
- `GET /api/members` (`requireRole owner/admin`) → `{ members: [{ userId, email, displayName, role: "owner"|"admin"|"member"|"viewer", canPublish: boolean, createdAt, locations: [{ locationId, canPublish }] }] }` (ordered owner→admin→member→viewer, then `lower(displayName)`). `PATCH` `{ userId: uuid, role, canPublish: boolean }` → `{ member: { userId, role, canPublish, createdAt } }`; codes `owner_role_required`(403 — non-owner assigning owner OR non-owner changing an existing owner), `last_owner`(409), `member_not_found`(404). `DELETE` `{ userId: uuid }` → `{ removed: true }`; codes `cannot_remove_self`(409), `member_not_found`(404), `owner_role_required`(403), `last_owner`(409). `POST` → ALWAYS `410 use_invitations`.
- `GET /api/invitations` (`requireRole owner/admin`) → `{ items: [{ id, email, role, canPublish, expiresAt, acceptedAt, createdAt, inviteUrl }] }` (`accepted_at IS NULL`, `order by created_at desc`). `POST` `{ email (lowercased), role, canPublish (default false) }` → `{ invitation: { id, email, role, canPublish, expiresAt, createdAt }, inviteUrl }` (**201**); codes `invitation_pending`(409), `owner_role_required`(403 — admin inviting an owner, via `assertRoleChangeAllowed`). `inviteUrl` is a **secret** (raw-token link) — surface as a deliberate copy-once action, never log.
- `DELETE /api/invitations/[token]` (Task 1; a NEW `DELETE` handler on the EXISTING `[token]` route; `requireRole owner/admin`) → `{ revoked: true }`; code `invitation_not_found`(404). The client calls `DELETE /api/invitations/${id}` with the invitation UUID, which rides in the `[token]` segment.
- `GET /api/privacy/requests` (`requireRole owner/admin`) → `{ requests: [{ id, requestType, status, subjectReference, reason, requestedBy, resolvedBy, resolutionNote, resolvedAt, createdAt, updatedAt }] }`. `POST` (`owner/admin`) `{ requestType: "access"|"rectification"|"erasure"|"restriction", subjectReference: 3..240, reason?: ≤2000 }` → **201** `{ request: { id, requestType, status, subjectReference, createdAt } }`. `PATCH` (`requireRole OWNER`) union `{ id, action:"fulfil", resolutionNote: 3..2000 }` OR `{ id, status: "pending"|"in_progress"|"completed"|"rejected", resolutionNote: 3..2000 }` → `{ request: { id, requestType, status, subjectReference, resolutionNote, resolvedAt } }`; fulfil of an `erasure` blocked by a hold → **409** `privacy_legal_hold` `{ holds: [reviewId] }`; code `privacy_request_not_found`(404).
- `GET /api/privacy/export?subject=3..240` (`requireRole OWNER`) → JSON attachment (`content-disposition: attachment; filename="privacy-export.json"`, `cache-control: private, no-store`); code `privacy_subject_not_found`(404). **`subject` is a query param** (§8 tension — flagged D-flag below).
- `GET /api/legal-holds` (`requireRole owner/admin`) → `{ holds: [{ id, reviewId, reason, approvedBy, releasedBy, releasedAt, createdAt }] }`. `POST` (`requireRole OWNER`) `{ reviewId: uuid, reason: 10..1000 }` → **201** `{ hold: { id, reviewId, reason, approvedBy, createdAt } }`; code `review_not_found`(404). `DELETE` (`requireRole OWNER`) body `{ reviewId: uuid }` → `{ released: true }`; code `legal_hold_not_found`(404).
- `POST /api/google/connect/start` (`requireRole owner/admin`) → `{ authorizationUrl }`; code `google_not_configured`(503). Callback (`GET /api/auth/callback/google`, a re-export of `google/connect/callback`) server-redirects to `/connections?google=connected` on success, `/connections?google=error&status=<httpStatus>` on failure (or `/sign-in?google=error&status=401` when the error is `authentication_required`).
- `GET /api/google/connections` (`requireSession`) → `{ connections: ConnectionSummary[] }` where `ConnectionSummary = { id, googleEmail: string|null, status, scope?, notificationsEnabled, lastRefreshAt: string|null, lastErrorCode: string|null, reconnectRequired: boolean, createdAt }` (scope stripped + `googleEmail` masked `a***@domain` for non-owner/admin). Zod mirror + `fetchConnections` already exist at `lib/api/connections.ts`.
- `POST /api/google/connections/[id]/disconnect` (`requireRole owner/admin`) → `{ status: "disconnected" }` — DESTRUCTIVE (7-day purge; deactivates location_link + webhooks); code `connection_not_found`(404). No server confirmation literal → client `OverwriteConfirmDialog` with 7-day-purge copy.
- `GET /api/google/accounts?connection_id` (`requireRole owner/admin`) → `{ accounts: [{ id, googleAccountName, accountName, type, role, permissionLevel, isActive }] }`; codes `connection_not_found`(404), `google_pagination_cycle`(502). `PATCH` `{ accountIds: uuid[] (max 100) }` → `{ accounts }`.
- `GET /api/google/locations?account_name` (`requireRole owner/admin`) → `{ locations: [{ id, accountName, googleLocationName, title, address, verified }] }`; codes `accounts_not_discovered`(409), `location_routing_conflict`(409), `google_pagination_cycle`(502).
- `POST /api/location-links` (`requireRole owner/admin`) `{ externalLocationId: uuid, locationId?: uuid, name?: 1..160, timezone: 1..80 (default "Europe/London"), confirmRelink: boolean (default false) }` → **201** `{ link: { id, locationId, externalLocationId, isActive } }`; codes `relink_confirmation_required`(409), `location_already_linked`(409), `external_location_not_found`(404), `location_not_found`(404). `DELETE ?externalLocationId` → `{ unlinked: true }`; code `location_link_not_found`(404).
- `GET /api/google/notifications?account_id` (`requireRole owner/admin`) → `{ setting: { name, pubsubTopic?, notificationTypes? } }`; codes `account_required`(400), `active_google_account_not_found`(404). `PATCH` `{ accountId: uuid, pubsubTopic: /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/ OR "", notificationTypes: enum[] (from GOOGLE_NOTIFICATION_TYPES, default all) }` → `{ setting }`. Empty `pubsubTopic` disables. `GOOGLE_NOTIFICATION_TYPES = ["GOOGLE_UPDATE","NEW_REVIEW","UPDATED_REVIEW","NEW_CUSTOMER_MEDIA","DUPLICATE_LOCATION","VOICE_OF_MERCHANT_UPDATED"]` (client-safe const in `lib/domain/google-contract.ts`).
- `POST /api/sync/backfill` (`requireRole owner/admin`, `maxDuration 60`) `{ externalLocationIds?: uuid[] (max 50), maxPagesPerLocation: 1..20 (default 10) }` → `{ batches, progress }`; gated by `SYNC_ENABLED` → `503 sync_paused`. `DELETE` `{ externalLocationIds: uuid[] (1..50) }` → `{ cancelledExternalLocationIds, progress }`; code `backfill_batch_running`(409). `GET ?external_location_id` → `{ progress }`. `progress = { items: [{ externalLocationId, locationName, status: "not_started"|"pending"|"running"|"succeeded"|"failed"|"cancelled", attemptCount, hasMorePages, lastErrorCode, startedAt, finishedAt, nextAttemptAt }], counts: Record<status, number>, total }`.

**Client-safe constants import (already client-safe, `lib/domain/google-contract.ts`):** `GOOGLE_NOTIFICATION_TYPES`, `GoogleNotificationType`. (This file is pure consts — no `server-only`, no node builtins — so client imports are safe. Type-only imports from `lib/server/*` are NOT allowed at runtime.)

**Cross-cutting error envelope (from `lib/server/http.ts`, via `apiFetch`/`ApiClientError`):** `ApiError → { error: <code>, message }`; `ZodError → { error: "invalid_request", message, details }` at 400; anything else → `{ error: "internal_error" }` at 500. Guards: `authentication_required`(401), `permission_denied`(403).

## File structure

```
lib/server/
  capabilities.ts                     MODIFY (SANCTIONED, protected, additive): SettingsCapabilities + settingsCapabilities(session)
app/api/settings/capabilities/
  route.ts                            NEW (SANCTIONED, protected): GET -> { capabilities: SettingsCapabilities }
app/api/invitations/[token]/
  route.ts                            MODIFY (SANCTIONED, protected): add DELETE -> { revoked: true } (reuse the [token] slug; existing GET stays byte-identical)
tests/integration/routes/
  settings-capabilities.test.ts       NEW (Task 1): all four roles, executable
  invitation-revoke.test.ts           NEW (Task 1): revoke happy path + 404 + role gating
lib/api/
  connections.ts                      MODIFY (Task 2): add startGoogleConnect, disconnectConnection
  settings.ts                         NEW (Task 2)
  settings-capabilities.ts            NEW (Task 2)
  members.ts                          NEW (Task 2)
  invitations.ts                      NEW (Task 2)
  privacy.ts                          NEW (Task 2)
  legal-holds.ts                      NEW (Task 2)
  google-accounts.ts                  NEW (Task 2)
  google-locations.ts                 NEW (Task 2)
  location-links.ts                   NEW (Task 2)
  notifications.ts                    NEW (Task 2)
  backfill.ts                         NEW (Task 2)
lib/settings/
  forms/settings-policy.ts            NEW (Task 2): settingsPolicyFormSchema (mirror) + timezone helpers
  forms/invitation.ts                 NEW (Task 2): invitationFormSchema (mirror) + ROLE_OPTIONS/roleLabel
  forms/privacy-request.ts            NEW (Task 2): privacyRequestFormSchema (mirror) + REQUEST_TYPE_OPTIONS/labels
  forms/legal-hold.ts                 NEW (Task 2): legalHoldFormSchema (mirror)
  action-errors.ts                    NEW (Task 2): describeActionError (all M6 codes) + isPausedError
  gating.ts                           NEW (Task 2): SettingsCapabilities + settingsGatingFromRole + disabled-reason/team helpers
lib/queries/
  keys.ts                             MODIFY (Task 2): settingsCapabilities/members/invitations/privacyRequests/legalHolds/googleAccounts/googleLocations/notificationSetting/backfill keys
  use-settings.ts                     NEW (Task 2)
  use-settings-capabilities.ts        NEW (Task 2)
  use-members.ts                      NEW (Task 2)
  use-invitations.ts                  NEW (Task 2)
  use-privacy-requests.ts             NEW (Task 2)
  use-legal-holds.ts                  NEW (Task 2)
lib/connections/
  derive-auto-selection.ts            NEW (Task 8): pure rule + unit tested
components/settings/
  settings-nav.tsx                    NEW (Task 3): capability-filtered sub-nav
  settings-shell.tsx                  NEW (Task 3): PageFrame + nav wrapper (owns <main>)
  policy-form.tsx                     NEW (Task 4)
  members-table.tsx                   NEW (Task 5)
  invitations-panel.tsx               NEW (Task 5)
  privacy-requests-card.tsx           NEW (Task 6)
  legal-holds-card.tsx                NEW (Task 6)
  privacy-export-card.tsx             NEW (Task 6)
  connections-workspace.tsx           NEW (Task 7): ties the six cards together; reads ?google=
  connection-card.tsx                 NEW (Task 7): connect / list / disconnect
  reconnect-alert.tsx                 NEW (Task 7)
  oauth-return.tsx                    NEW (Task 7): ?google=connected|error handling
  account-picker-card.tsx             NEW (Task 8)
  import-card.tsx                     NEW (Task 9)
  backfill-card.tsx                   NEW (Task 10)
  notifications-card.tsx              NEW (Task 10)
lib/queries/
  use-connection-workspace.ts         NEW (Task 7)
  use-google-accounts.ts              NEW (Task 8)
  use-google-locations.ts             NEW (Task 8)
  use-location-import.ts              NEW (Task 9)
  use-backfill.ts                     NEW (Task 10)
  use-notification-setting.ts         NEW (Task 10)
app/(dashboard)/settings/
  layout.tsx                          NEW (Task 3): server layout (auth-gate + SettingsShell)
  loading.tsx                         NEW (Task 3)
  page.tsx                            NEW (Task 4): Policy (h1 "Reply policy")
  team/page.tsx                       NEW (Task 5): Team (h1 "Team access")
  compliance/page.tsx                 NEW (Task 6): Compliance (h1 "Data and compliance")
  connections/page.tsx                NEW (Task 7): Connections (h1 "Google Business Profile")
app/connections/
  page.tsx                            NEW (Task 3): legacy redirect -> /settings/connections (forwards query string)
components/app-shell/nav.tsx          MODIFY (Task 3): /settings prefetch: true
tests/components/*.test.tsx           NEW per task
tests/e2e/settings.spec.ts            REWRITE (Task 11)
tests/e2e/connections-oauth.spec.ts   NEW (Task 11): OAuth-return outcomes + permission walk
tests/e2e/helpers/stub-bridge.ts      MODIFY (Task 11): connect/start + accounts/locations stub matchers if needed
playwright.config.ts                  MODIFY (Task 11): un-ignore settings.spec.ts; enable SYNC/GBP env as needed
```

**Dependency chain:** Tasks **1 → 2** are a hard sequential chain (capability + revoke shapes → clients/schemas/hooks). **Task 3** (shell + nav + redirect) needs Task 2's gating + capabilities hook. After Task 3, Tasks **4, 5, 6** (Policy / Team / Compliance) can run in parallel (each consumes only Task 2's per-resource client/hook + Task 3's shell). **Task 7** (Connections shell) needs Task 2 + Task 3; **Tasks 8, 9, 10** (account picker / import / backfill+notifications) each consume Task 7's `useConnectionWorkspace` selection state + Task 2's clients and can run substantially in parallel after Task 7. **Task 11** is the terminal gate. **Task 1 is the only protected-path task.**

---

### Task 1: Settings capabilities + invitation-revoke backend (SANCTIONED protected-path edits)

> **⚠ Protected-path task — flag for whole-branch-review scrutiny (M6's analog of M5 Task 1).** This is the ONLY task that edits `app/api/**` / `lib/server/**`. It touches exactly three files there: `lib/server/capabilities.ts` (additive `SettingsCapabilities`/`settingsCapabilities`), `app/api/settings/capabilities/route.ts` (new read-only GET), and `app/api/invitations/[token]/route.ts` (a new `DELETE` revoke handler added to the existing route — its `GET` stays byte-identical). Every other protected file stays **byte-identical**. The reviewer must confirm that with `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` (exactly those three paths), that the capability predicates mirror the route guards for every role, and that the untouched backend integration suite (the parity oracle) stays green.

**Files:**
- Create: `app/api/settings/capabilities/route.ts`
- Modify (protected): `lib/server/capabilities.ts` (add `SettingsCapabilities`, `settingsCapabilities`), `app/api/invitations/[token]/route.ts` (add a `DELETE` revoke handler; keep the existing `GET` byte-identical)
- Test: `tests/integration/routes/settings-capabilities.test.ts`, `tests/integration/routes/invitation-revoke.test.ts`

**Interfaces:**
- Consumes: `Session`/`requireSession`/`requireRole` (`@/lib/server/session`), `withTenant` (`@/lib/server/db`), `apiError`/`ApiError` (`@/lib/server/http`), `z` (`zod`), `NextResponse` (`next/server`).
- Produces (Task 2 consumes these EXACT shapes):
  - `type SettingsCapabilities = { canManageTeam: boolean; canManageConnections: boolean; canEditSettings: boolean; canViewCompliance: boolean; canManageCompliance: boolean }`.
  - `settingsCapabilities(session: Session): SettingsCapabilities` — `canManageTeam/canManageConnections/canEditSettings/canViewCompliance = role ∈ {owner,admin}`; `canManageCompliance = role === "owner"`.
  - `GET /api/settings/capabilities` → `{ capabilities: SettingsCapabilities }`.
  - `DELETE /api/invitations/[token]` → `{ revoked: true }` (a new `DELETE` handler on the existing `[token]` route; owner/admin; `404 invitation_not_found` when no pending invitation with that id; the invitation UUID rides in the `[token]` segment).

**Capability definition (mirrors the route guards exactly):**
- `canManageTeam` = `role ∈ {owner,admin}` (matches `GET/PATCH/DELETE /api/members`, `GET/POST /api/invitations`, and the new revoke — all `requireRole(["owner","admin"])`).
- `canManageConnections` = `role ∈ {owner,admin}` (matches every connection/account/location-link/notification/backfill mutation — all `requireRole(["owner","admin"])`).
- `canEditSettings` = `role ∈ {owner,admin}` (matches `PATCH /api/settings`).
- `canViewCompliance` = `role ∈ {owner,admin}` (matches `GET`/`POST /api/privacy/requests` + `GET /api/legal-holds`, which admins may reach — so admins see the Compliance surface).
- `canManageCompliance` = `role === "owner"` (matches the owner-only compliance mutations: privacy fulfil/status, export, legal-hold create/release; per D5 only these controls + the whole legal-holds card are owner-gated).

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/routes/settings-capabilities.test.ts` — every role, executed against the real route. A helper seeds a member user + session in an existing org (identical to the M5 `location-capabilities.test.ts` helper).

```ts
import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

async function seedMemberUser(
  admin: ReturnType<typeof postgres>,
  organisationId: string,
  role: "owner" | "admin" | "member" | "viewer",
  canPublish: boolean
) {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${`cap-${userId.slice(0, 8)}@nabapresence.test`}, 'Cap user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, ${role}, ${canPublish})
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${organisationId}, now() + interval '1 hour')
  `
  return { userId, cookie: `naba_session=${token}` }
}

describeDatabase("settings capabilities route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function caps(cookie: string) {
    const response = await fetch(`${server.baseUrl}/api/settings/capabilities`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    return (await response.json()) as {
      capabilities: {
        canManageTeam: boolean
        canManageConnections: boolean
        canEditSettings: boolean
        canViewCompliance: boolean
        canManageCompliance: boolean
      }
    }
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("owner can manage everything including compliance", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    expect((await caps(tenant.cookie)).capabilities).toEqual({
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
      canViewCompliance: true,
      canManageCompliance: true,
    })
  })

  it("admin manages team/connections/settings and views compliance but can't manage it", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const adminUser = await seedMemberUser(admin, tenant.organisationId, "admin", true)
    expect((await caps(adminUser.cookie)).capabilities).toEqual({
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
      canViewCompliance: true,
      canManageCompliance: false,
    })
  })

  it("member and viewer manage nothing", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const member = await seedMemberUser(admin, tenant.organisationId, "member", true)
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer", false)
    const allFalse = {
      canManageTeam: false,
      canManageConnections: false,
      canEditSettings: false,
      canViewCompliance: false,
      canManageCompliance: false,
    }
    expect((await caps(member.cookie)).capabilities).toEqual(allFalse)
    expect((await caps(viewer.cookie)).capabilities).toEqual(allFalse)
  })
})
```

`tests/integration/routes/invitation-revoke.test.ts` — creates a pending invitation via the real `POST /api/invitations` (avoids hand-seeding token ciphertext), then exercises the new DELETE.

```ts
import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

async function seedMemberUser(
  admin: ReturnType<typeof postgres>,
  organisationId: string,
  role: "admin" | "member" | "viewer"
) {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${`rev-${userId.slice(0, 8)}@nabapresence.test`}, 'Rev user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, ${role}, false)
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${organisationId}, now() + interval '1 hour')
  `
  return { userId, cookie: `naba_session=${token}` }
}

describeDatabase("invitation revoke route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function createInvitation(cookie: string, email: string) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email, role: "member", canPublish: false }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { invitation: { id: string } }).invitation
  }

  async function revoke(cookie: string, id: string) {
    return fetch(`${server.baseUrl}/api/invitations/${id}`, {
      method: "DELETE",
      headers: { cookie },
    })
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("an owner revokes a pending invitation and a second revoke 404s", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const invitation = await createInvitation(tenant.cookie, "revoke-me@nabapresence.test")

    const first = await revoke(tenant.cookie, invitation.id)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ revoked: true })

    const second = await revoke(tenant.cookie, invitation.id)
    expect(second.status).toBe(404)
    expect(((await second.json()) as { error: string }).error).toBe("invitation_not_found")
  })

  it("an admin may revoke; a member and a viewer may not", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const adminUser = await seedMemberUser(admin, tenant.organisationId, "admin")
    const member = await seedMemberUser(admin, tenant.organisationId, "member")
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer")

    const adminInvite = await createInvitation(tenant.cookie, "admin-can@nabapresence.test")
    expect((await revoke(adminUser.cookie, adminInvite.id)).status).toBe(200)

    const guarded = await createInvitation(tenant.cookie, "guarded@nabapresence.test")
    expect((await revoke(member.cookie, guarded.id)).status).toBe(403)
    expect((await revoke(viewer.cookie, guarded.id)).status).toBe(403)
    // Still revocable by the owner afterwards (the guarded attempts changed nothing).
    expect((await revoke(tenant.cookie, guarded.id)).status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run:
```bash
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/settings-capabilities.test.ts tests/integration/routes/invitation-revoke.test.ts
```
Expected: FAIL — `/api/settings/capabilities` 404s (route absent) and `DELETE /api/invitations/<id>` 405/404s (route absent).

- [ ] **Step 3: Extend `lib/server/capabilities.ts` (additive)**

Append below the existing `locationCapabilities` export. `settingsCapabilities` is a pure role predicate — no SQL, so it takes only the `Session` (the file's existing functions take `sql` because they query `location_member`; this one does not need it).

```ts
// Org/settings capabilities for the Settings workspace (spec §3):
//   canManageTeam/canManageConnections/canEditSettings/canViewCompliance === role in {owner, admin}
//   canManageCompliance === role === "owner"
// Pure role predicates that mirror the route guards; no SQL.
export type SettingsCapabilities = {
  canManageTeam: boolean
  canManageConnections: boolean
  canEditSettings: boolean
  canViewCompliance: boolean
  canManageCompliance: boolean
}

export function settingsCapabilities(session: Session): SettingsCapabilities {
  const managerial = session.role === "owner" || session.role === "admin"
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
    canViewCompliance: managerial,
    canManageCompliance: session.role === "owner",
  }
}
```

- [ ] **Step 4: Create the settings-capabilities route**

`app/api/settings/capabilities/route.ts`:

```ts
import { NextResponse } from "next/server"

import { settingsCapabilities } from "@/lib/server/capabilities"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ capabilities: settingsCapabilities(session) })
  } catch (error) {
    return apiError(error)
  }
}
```

- [ ] **Step 5: Add a DELETE revoke handler to the EXISTING `[token]` route**

Do **NOT** create `app/api/invitations/[id]/route.ts`. Next.js App Router forbids two different slug names at the same dynamic path level (`app/api/invitations/[token]/route.ts` already exists for the public invite-lookup `GET`), and a second `[id]` slug throws at build: *"You cannot use different slug names for the same dynamic path ('id' !== 'token')."* Instead ADD a `DELETE` handler to the **existing** `app/api/invitations/[token]/route.ts`, reusing the `[token]` slug — the param arrives named `token` but carries the invitation UUID for `DELETE` (parse it as a uuid). Keep the existing `GET` and `export const runtime` byte-identical.

Merge these imports into the file's existing import block (it already imports `NextResponse`, `sha256`, `getDatabase` from `@/lib/server/db`, `ApiError`, `apiError`) — add `z`, `writeAudit`, `withTenant` (alongside `getDatabase` on the `@/lib/server/db` line), `requireRole`, `requireSession`:

```ts
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { requireRole, requireSession } from "@/lib/server/session"
```

Then append the handler below the existing `GET`:

```ts
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { token } = await context.params
    const invitationId = z.uuid().parse(token)
    await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        delete from invitation
        where id = ${invitationId}
          and accepted_at is null
        returning id::text as id
      `
      if (!row) {
        throw new ApiError(404, "invitation_not_found", "Invitation not found.")
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.invitation_revoked",
        subjectType: "invitation",
        subjectId: invitationId,
      })
    })
    return NextResponse.json({ revoked: true })
  } catch (error) {
    return apiError(error)
  }
}
```

> **Executor note:** `writeAudit(sql, event)` matches the real signature in `lib/server/audit.ts` (`{ organisationId, actorUserId?, action, subjectType, subjectId, requestId?, metadata? }`) — confirmed against the `legal-holds` / `members` call sites. Confirm the `invitation` table name + `accepted_at` column against `app/api/invitations/route.ts` (its GET filters `where accepted_at is null` and its inserts target the same table). Keep the response `{ revoked: true }` and the `404 invitation_not_found` contract; the existing public-lookup `GET` in this file must stay byte-identical (only imports + the new `DELETE` are added). The client still calls `DELETE /api/invitations/${id}` with the invitation UUID (it rides in the `[token]` segment), so the client + integration test are unchanged.

- [ ] **Step 6: Run to verify pass, then the full parity oracle**

```bash
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/settings-capabilities.test.ts tests/integration/routes/invitation-revoke.test.ts
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
pnpm typecheck && pnpm lint
git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts
```

Expected: the two new tests pass; every existing integration test stays green (the additions are a new symbol, one new route, and a new `DELETE` handler on the existing `[token]` route — that route's existing `GET` is untouched, so the invite-lookup tests stay green). The `git diff --stat` lists **exactly** `app/api/settings/capabilities/route.ts`, `app/api/invitations/[token]/route.ts`, and `lib/server/capabilities.ts` — nothing else under those paths (the new test files are under `tests/`, outside the protected set).

- [ ] **Step 7: Commit**

```bash
git add lib/server/capabilities.ts "app/api/settings/capabilities/route.ts" "app/api/invitations/[token]/route.ts" tests/integration/routes/settings-capabilities.test.ts tests/integration/routes/invitation-revoke.test.ts
git commit -m "feat(settings): settings-capabilities route + invitation revoke route (sanctioned)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Typed API clients + client-safe form schemas + action-errors + gating + query keys/hooks

**Files:**
- Create: `lib/api/settings.ts`, `lib/api/settings-capabilities.ts`, `lib/api/members.ts`, `lib/api/invitations.ts`, `lib/api/privacy.ts`, `lib/api/legal-holds.ts`, `lib/api/google-accounts.ts`, `lib/api/google-locations.ts`, `lib/api/location-links.ts`, `lib/api/notifications.ts`, `lib/api/backfill.ts`, `lib/settings/forms/settings-policy.ts`, `lib/settings/forms/invitation.ts`, `lib/settings/forms/privacy-request.ts`, `lib/settings/forms/legal-hold.ts`, `lib/settings/action-errors.ts`, `lib/settings/gating.ts`, `lib/queries/use-settings.ts`, `lib/queries/use-settings-capabilities.ts`, `lib/queries/use-members.ts`, `lib/queries/use-invitations.ts`, `lib/queries/use-privacy-requests.ts`, `lib/queries/use-legal-holds.ts`
- Modify: `lib/api/connections.ts` (add `startGoogleConnect`, `disconnectConnection`), `lib/queries/keys.ts`
- Test: `tests/components/settings-api.test.tsx`, `tests/components/settings-forms.test.ts`, `tests/components/settings-action-errors.test.ts`, `tests/components/settings-gating.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` (`@/lib/api/client`); `z` (`zod`); `GOOGLE_NOTIFICATION_TYPES`/`GoogleNotificationType` (`@/lib/domain/google-contract`); `useQuery` (`@tanstack/react-query`); `queryKeys` (`@/lib/queries/keys`); `SettingsCapabilities` shape from Task 1.
- Produces (Tasks 3–11 consume these EXACT signatures):
  - `lib/api/settings.ts`: `type OrgSettings`; `fetchSettings(): Promise<OrgSettings>`; `saveSettings(input: SettingsPatchInput): Promise<OrgSettings>`; `type SettingsPatchInput`.
  - `lib/api/settings-capabilities.ts`: `type SettingsCapabilities = { canManageTeam; canManageConnections; canEditSettings; canViewCompliance; canManageCompliance }`; `fetchSettingsCapabilities(): Promise<SettingsCapabilities>`.
  - `lib/api/members.ts`: `type Member`, `type MemberRole`; `fetchMembers(): Promise<{ members: Member[] }>`; `updateMember(input): Promise<{ member: { userId; role; canPublish; createdAt } }>`; `removeMember(userId: string): Promise<{ removed: true }>`.
  - `lib/api/invitations.ts`: `type Invitation`; `fetchInvitations(): Promise<{ items: Invitation[] }>`; `createInvitation(input): Promise<{ invitation: Invitation; inviteUrl: string }>`; `revokeInvitation(id: string): Promise<{ revoked: true }>`.
  - `lib/api/privacy.ts`: `type PrivacyRequest`; `fetchPrivacyRequests(): Promise<{ requests: PrivacyRequest[] }>`; `createPrivacyRequest(input): Promise<{ request: { id; requestType; status; subjectReference; createdAt } }>`; `updatePrivacyRequest(input): Promise<{ request: PrivacyRequestResolution }>`; `exportPrivacyData(subject: string): Promise<void>` (fetch-and-download).
  - `lib/api/legal-holds.ts`: `type LegalHold`; `fetchLegalHolds(): Promise<{ holds: LegalHold[] }>`; `createLegalHold(input): Promise<{ hold: LegalHold }>`; `releaseLegalHold(reviewId: string): Promise<{ released: true }>`.
  - `lib/api/google-accounts.ts`: `type GoogleAccount`; `fetchGoogleAccounts(connectionId?: string | null): Promise<{ accounts: GoogleAccount[] }>`; `saveActiveAccounts(accountIds: string[]): Promise<{ accounts: GoogleAccount[] }>`.
  - `lib/api/google-locations.ts`: `type DiscoveredLocation`; `fetchGoogleLocations(accountName?: string | null): Promise<{ locations: DiscoveredLocation[] }>`.
  - `lib/api/location-links.ts`: `type LinkResult`; `linkExternalLocation(input): Promise<{ link: LinkResult }>`; `unlinkExternalLocation(externalLocationId: string): Promise<{ unlinked: true }>`.
  - `lib/api/notifications.ts`: `type NotificationSetting`; `fetchNotificationSetting(accountId: string): Promise<{ setting: NotificationSetting }>`; `saveNotificationSetting(input): Promise<{ setting: NotificationSetting }>`.
  - `lib/api/backfill.ts`: `type BackfillProgress`, `type BackfillItem`, `type BackfillStatus`; `fetchBackfillProgress(externalLocationId?: string): Promise<{ progress: BackfillProgress }>`; `startBackfill(input): Promise<{ progress: BackfillProgress }>`; `cancelBackfill(externalLocationIds: string[]): Promise<{ progress: BackfillProgress }>`.
  - `lib/api/connections.ts` (extended): `startGoogleConnect(): Promise<{ authorizationUrl: string }>`; `disconnectConnection(id: string): Promise<{ status: "disconnected" }>`.
  - `lib/settings/forms/*`: `settingsPolicyFormSchema`/`SettingsPolicyFormValues`/`isValidTimezone`/`TIMEZONE_OPTIONS`; `invitationFormSchema`/`InvitationFormValues`/`ROLE_OPTIONS`/`roleLabel`; `privacyRequestFormSchema`/`PrivacyRequestFormValues`/`REQUEST_TYPE_OPTIONS`/`requestTypeLabel`/`requestStatusLabel`; `legalHoldFormSchema`/`LegalHoldFormValues`.
  - `lib/settings/action-errors.ts`: `describeActionError(error: unknown): string`; `isPausedError(error: unknown): boolean`.
  - `lib/settings/gating.ts`: `type SettingsCapabilities`; `settingsGatingFromRole(role: string | null): SettingsCapabilities`; `editSettingsDisabledReason(caps)`; `manageTeamDisabledReason(caps)`; `manageComplianceDisabledReason(caps)`; `roleOptionsFor(actorRole)`; `memberRowGate(input)`; `describeNotificationType(type)`.
  - `lib/queries/use-*.ts`: `useSettings()`, `useSettingsCapabilities()`, `useMembers()`, `useInvitations()`, `usePrivacyRequests()`, `useLegalHolds()`.

- [ ] **Step 1: Add query keys**

In `lib/queries/keys.ts`, add these to the `queryKeys` object (keep the existing entries; `settings` stays the bare `["settings"]` used by `useSettings`):

```ts
  settingsCapabilities: ["settings-capabilities"] as const,
  members: ["members"] as const,
  invitations: ["invitations"] as const,
  privacyRequests: ["privacy-requests"] as const,
  legalHolds: ["legal-holds"] as const,
  googleAccounts: (connectionId: string | null) =>
    ["google-accounts", connectionId] as const,
  googleLocations: (accountName: string | null) =>
    ["google-locations", accountName] as const,
  notificationSetting: (accountId: string | null) =>
    ["notification-setting", accountId] as const,
  backfill: ["backfill"] as const,
```

- [ ] **Step 2: Write the failing form-schema parity tests**

`tests/components/settings-forms.test.ts` (the client-safe mirrors accept/reject the same shapes as the server route schemas):

```ts
import { describe, expect, it } from "vitest"

import { invitationFormSchema } from "@/lib/settings/forms/invitation"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"
import { privacyRequestFormSchema } from "@/lib/settings/forms/privacy-request"
import { settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"

describe("settingsPolicyFormSchema (mirror of settings/route.ts settingsSchema)", () => {
  it("accepts a valid policy and defaults directPublishConsent to false", () => {
    const parsed = settingsPolicyFormSchema.parse({
      approvalRequired: true,
      requireTwoPersonApproval: false,
      rawContentRetentionDays: 14,
      defaultLanguageCode: "en-GB",
      defaultTimezone: "Europe/London",
    })
    expect(parsed.directPublishConsent).toBe(false)
  })
  it("rejects an out-of-range retention, a bad language code and an unknown timezone", () => {
    const base = {
      approvalRequired: true,
      rawContentRetentionDays: 14,
      defaultLanguageCode: "en-GB",
      defaultTimezone: "Europe/London",
    }
    expect(settingsPolicyFormSchema.safeParse({ ...base, rawContentRetentionDays: 31 }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, rawContentRetentionDays: 0 }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, defaultLanguageCode: "english" }).success).toBe(false)
    expect(settingsPolicyFormSchema.safeParse({ ...base, defaultTimezone: "Middle/Earth" }).success).toBe(false)
  })
})

describe("invitationFormSchema (mirror of invitations/route.ts invitationSchema)", () => {
  it("lowercases the email and defaults canPublish to false", () => {
    const parsed = invitationFormSchema.parse({ email: "Chef@Riverside.TEST", role: "member" })
    expect(parsed.email).toBe("chef@riverside.test")
    expect(parsed.canPublish).toBe(false)
  })
  it("rejects a non-email and an unknown role", () => {
    expect(invitationFormSchema.safeParse({ email: "not-an-email", role: "member" }).success).toBe(false)
    expect(invitationFormSchema.safeParse({ email: "a@b.test", role: "superuser" }).success).toBe(false)
  })
})

describe("privacyRequestFormSchema (mirror of privacy/requests createSchema)", () => {
  it("accepts a request with an optional reason", () => {
    expect(
      privacyRequestFormSchema.safeParse({ requestType: "erasure", subjectReference: "guest-4821" }).success
    ).toBe(true)
  })
  it("rejects a short subject and an unknown request type", () => {
    expect(privacyRequestFormSchema.safeParse({ requestType: "erasure", subjectReference: "ab" }).success).toBe(false)
    expect(privacyRequestFormSchema.safeParse({ requestType: "delete", subjectReference: "guest-1" }).success).toBe(false)
  })
})

describe("legalHoldFormSchema (mirror of legal-holds createSchema)", () => {
  it("requires a reason of at least ten characters and a uuid review id", () => {
    expect(
      legalHoldFormSchema.safeParse({ reviewId: "11111111-1111-1111-1111-111111111111", reason: "Litigation pending" }).success
    ).toBe(true)
    expect(legalHoldFormSchema.safeParse({ reviewId: "not-a-uuid", reason: "Litigation pending" }).success).toBe(false)
    expect(
      legalHoldFormSchema.safeParse({ reviewId: "11111111-1111-1111-1111-111111111111", reason: "short" }).success
    ).toBe(false)
  })
})
```

`tests/components/settings-action-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError, isPausedError } from "@/lib/settings/action-errors"

describe("describeActionError", () => {
  it("maps known M6 codes to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["direct_publish_consent_required", 403, /owner must/i],
      ["last_owner", 409, /last owner/i],
      ["cannot_remove_self", 409, /your own/i],
      ["use_invitations", 410, /invitation/i],
      ["invitation_pending", 409, /already/i],
      ["invitation_not_found", 404, /no longer|not found/i],
      ["privacy_legal_hold", 409, /legal hold/i],
      ["privacy_subject_not_found", 404, /no records/i],
      ["legal_hold_not_found", 404, /no active/i],
      ["relink_confirmation_required", 409, /confirm/i],
      ["location_already_linked", 409, /already linked/i],
      ["accounts_not_discovered", 409, /discover/i],
      ["google_reconnect_required", 401, /reconnect/i],
      ["sync_paused", 503, /paused/i],
      ["backfill_batch_running", 409, /in progress|running|wait/i],
      ["active_google_account_not_found", 404, /active Google account/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw server message"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
  it("flags paused errors and falls back for unknown errors", () => {
    expect(isPausedError(new ApiClientError(503, "sync_paused", "x"))).toBe(true)
    expect(isPausedError(new Error("boom"))).toBe(false)
    expect(describeActionError(new Error("boom"))).toMatch(/something went wrong/i)
  })
})
```

`tests/components/settings-gating.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { memberRowGate, roleOptionsFor, settingsGatingFromRole } from "@/lib/settings/gating"

describe("settingsGatingFromRole (mirror of server settingsCapabilities)", () => {
  it("matches the server predicates for every role", () => {
    expect(settingsGatingFromRole("owner")).toEqual({
      canManageTeam: true, canManageConnections: true, canEditSettings: true, canViewCompliance: true, canManageCompliance: true,
    })
    expect(settingsGatingFromRole("admin")).toEqual({
      canManageTeam: true, canManageConnections: true, canEditSettings: true, canViewCompliance: true, canManageCompliance: false,
    })
    for (const role of ["member", "viewer", null]) {
      expect(settingsGatingFromRole(role)).toEqual({
        canManageTeam: false, canManageConnections: false, canEditSettings: false, canViewCompliance: false, canManageCompliance: false,
      })
    }
  })
})

describe("roleOptionsFor", () => {
  it("offers Owner only to an owner actor", () => {
    expect(roleOptionsFor("owner").map((o) => o.value)).toContain("owner")
    expect(roleOptionsFor("admin").map((o) => o.value)).not.toContain("owner")
  })
})

describe("memberRowGate", () => {
  const base = { actorRole: "owner" as const, actorUserId: "me", ownerCount: 2 }
  it("disables removing yourself", () => {
    const gate = memberRowGate({ ...base, member: { userId: "me", role: "admin", canPublish: true } })
    expect(gate.removeDisabled).toBe(true)
    expect(gate.removeReason).toMatch(/your own/i)
  })
  it("disables demoting/removing the last owner", () => {
    const gate = memberRowGate({ ...base, ownerCount: 1, member: { userId: "o", role: "owner", canPublish: true } })
    expect(gate.roleDisabled).toBe(true)
    expect(gate.removeDisabled).toBe(true)
    expect(gate.roleReason).toMatch(/last owner/i)
  })
  it("stops an admin actor from changing an owner", () => {
    const gate = memberRowGate({ actorRole: "admin", actorUserId: "me", ownerCount: 2, member: { userId: "o", role: "owner", canPublish: true } })
    expect(gate.roleDisabled).toBe(true)
    expect(gate.removeDisabled).toBe(true)
  })
  it("forces canPublish off for a viewer", () => {
    const gate = memberRowGate({ ...base, member: { userId: "v", role: "viewer", canPublish: false } })
    expect(gate.canPublishForced).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/settings-forms.test.ts tests/components/settings-action-errors.test.ts tests/components/settings-gating.test.ts --project components`
Expected: FAIL — the `lib/settings/*` modules do not exist.

- [ ] **Step 4: Implement the client-safe form schemas**

`lib/settings/forms/settings-policy.ts` (mirrors `settingsSchema`; the timezone list is the canonical `Intl.supportedValuesOf('timeZone')` subset — every value it contains is accepted by the server's `new Intl.DateTimeFormat` refinement, so the picker can only produce server-valid timezones):

```ts
import { z } from "zod"

function supportedTimezones(): string[] {
  const withValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    return withValues.supportedValuesOf ? withValues.supportedValuesOf("timeZone") : ["Europe/London", "UTC"]
  } catch {
    return ["Europe/London", "UTC"]
  }
}

export const TIMEZONE_OPTIONS: readonly string[] = supportedTimezones()
const TIMEZONE_SET = new Set(TIMEZONE_OPTIONS)

export function isValidTimezone(value: string): boolean {
  return TIMEZONE_SET.has(value)
}

export const settingsPolicyFormSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean().optional(),
  rawContentRetentionDays: z.number().int().min(1).max(30),
  defaultLanguageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "Use a language code such as en or en-GB."),
  defaultTimezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => isValidTimezone(value), "Choose a valid timezone."),
  directPublishConsent: z.boolean().default(false),
})

export type SettingsPolicyFormValues = z.infer<typeof settingsPolicyFormSchema>
```

`lib/settings/forms/invitation.ts` (mirrors `invitationSchema`; `ROLE_OPTIONS` + `roleLabel` are the humanised enum layer):

```ts
import { z } from "zod"

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role]
}

export const ROLE_OPTIONS = MEMBER_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))

export const invitationFormSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean().default(false),
})

export type InvitationFormValues = z.infer<typeof invitationFormSchema>
```

`lib/settings/forms/privacy-request.ts` (mirrors `createSchema`; the enums are humanised):

```ts
import { z } from "zod"

export const PRIVACY_REQUEST_TYPES = ["access", "rectification", "erasure", "restriction"] as const
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number]

const TYPE_LABELS: Record<PrivacyRequestType, string> = {
  access: "Access",
  rectification: "Rectification",
  erasure: "Erasure",
  restriction: "Restriction",
}

export function requestTypeLabel(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type] ?? type
}

export const REQUEST_TYPE_OPTIONS = PRIVACY_REQUEST_TYPES.map((value) => ({
  value,
  label: TYPE_LABELS[value],
}))

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
}

export function requestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export const privacyRequestFormSchema = z.object({
  requestType: z.enum(PRIVACY_REQUEST_TYPES),
  subjectReference: z.string().trim().min(3, "Enter at least 3 characters.").max(240),
  reason: z.string().trim().max(2000).optional(),
})

export type PrivacyRequestFormValues = z.infer<typeof privacyRequestFormSchema>
```

`lib/settings/forms/legal-hold.ts` (mirrors the legal-holds `createSchema`):

```ts
import { z } from "zod"

export const legalHoldFormSchema = z.object({
  reviewId: z.uuid("Enter the review identifier."),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
})

export type LegalHoldFormValues = z.infer<typeof legalHoldFormSchema>
```

- [ ] **Step 5: Implement the action-error copy map**

`lib/settings/action-errors.ts` (mirrors `lib/locations/action-errors.ts`: named `code → copy` record, `ApiClientError` guard, status fallbacks, single generic fallback — no error code ever shown):

```ts
import { ApiClientError } from "@/lib/api/client"

const COPY: Record<string, string> = {
  // Settings / policy
  direct_publish_consent_required: "An owner must confirm direct publishing before approval can be turned off.",
  organisation_not_found: "We couldn’t find this organisation’s settings.",
  // Team
  owner_role_required: "Only an owner can grant, change or remove the owner role.",
  last_owner: "You can’t remove or demote the last owner. Make someone else an owner first.",
  cannot_remove_self: "You can’t remove your own access. Ask another owner or admin to do it.",
  member_not_found: "That team member no longer exists.",
  use_invitations: "Send an invitation instead of adding someone directly.",
  invitation_pending: "There’s already a pending invitation for that email address.",
  invitation_not_found: "That invitation is no longer available.",
  viewer_cannot_publish: "Viewers can’t be given publishing access.",
  duplicate_location: "That location appears more than once.",
  location_not_found: "That location no longer exists.",
  // Compliance
  privacy_request_not_found: "That privacy request no longer exists.",
  privacy_legal_hold: "Some matching reviews are under an active legal hold and can’t be erased yet.",
  privacy_subject_not_found: "No records matched that reference.",
  legal_hold_not_found: "There’s no active legal hold for that review.",
  review_not_found: "That review no longer exists.",
  // Connections — OAuth
  google_oauth_denied: "Google sign-in was cancelled before it finished.",
  invalid_oauth_callback: "Google sign-in didn’t complete. Try connecting again.",
  invalid_oauth_state: "That Google sign-in link has expired. Try connecting again.",
  oauth_session_changed: "Your session changed during sign-in. Try connecting again.",
  google_not_configured: "Google Business Profile isn’t available right now.",
  google_reconnect_required: "Google access has expired. Reconnect this account to continue.",
  connection_not_found: "That connection is no longer available.",
  google_pagination_cycle: "Google returned an unexpected response. Try again shortly.",
  // Connections — accounts / locations / links
  accounts_not_discovered: "Discover your Google accounts before importing locations.",
  location_routing_conflict: "That Google location is already managed by another organisation.",
  relink_confirmation_required: "Confirm the change before moving this location’s history.",
  location_already_linked: "That location is already linked to a different Google location.",
  external_location_not_found: "That Google location couldn’t be found.",
  location_link_not_found: "That location link no longer exists.",
  // Notifications
  account_required: "Choose a Google account first.",
  active_google_account_not_found: "Select an active Google account first.",
  // Backfill
  sync_paused: "Review sync is paused right now. Try again shortly.",
  backfill_batch_running: "A sync batch is already in progress. Wait for it to finish before cancelling.",
}

export function describeActionError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const mapped = COPY[error.code]
    if (mapped) return mapped
    if (error.status === 401) return "Your session has expired. Sign in again to continue."
    if (error.status >= 500) return "Google or our service is temporarily unavailable. Try again shortly."
  }
  return "Something went wrong. Please try again."
}

export function isPausedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "sync_paused"
}
```

- [ ] **Step 6: Implement the gating helpers**

`lib/settings/gating.ts` (`settingsGatingFromRole` is the client mirror of the server `settingsCapabilities` — a parity test in Step 2 pins them equal; the disabled-reason + team-row helpers encode the exact server guards for owner-role / last-owner / self / viewer):

```ts
import { MEMBER_ROLES, type MemberRole, roleLabel } from "@/lib/settings/forms/invitation"

export type SettingsCapabilities = {
  canManageTeam: boolean
  canManageConnections: boolean
  canEditSettings: boolean
  canViewCompliance: boolean
  canManageCompliance: boolean
}

export function settingsGatingFromRole(role: string | null): SettingsCapabilities {
  const managerial = role === "owner" || role === "admin"
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
    canViewCompliance: managerial,
    canManageCompliance: role === "owner",
  }
}

export function editSettingsDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canEditSettings ? null : "Only owners and admins can change these settings."
}

export function manageTeamDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canManageTeam ? null : "Only owners and admins can manage the team."
}

export function manageComplianceDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canManageCompliance ? null : "Only owners can manage data and compliance."
}

// The role select never offers "Owner" to a non-owner actor (server: assertRoleChangeAllowed).
export function roleOptionsFor(actorRole: string): Array<{ value: MemberRole; label: string }> {
  return MEMBER_ROLES.filter((role) => role !== "owner" || actorRole === "owner").map((role) => ({
    value: role,
    label: roleLabel(role),
  }))
}

export function memberRowGate(input: {
  actorRole: MemberRole
  actorUserId: string
  ownerCount: number
  member: { userId: string; role: MemberRole; canPublish: boolean }
}): {
  roleDisabled: boolean
  roleReason: string | null
  removeDisabled: boolean
  removeReason: string | null
  canPublishForced: boolean
} {
  const { actorRole, actorUserId, ownerCount, member } = input
  const isSelf = member.userId === actorUserId
  const targetIsOwner = member.role === "owner"
  const lastOwner = targetIsOwner && ownerCount <= 1
  // Non-owner actors can neither assign nor change an owner (server: owner_role_required).
  const actorCannotTouchOwner = actorRole !== "owner" && targetIsOwner

  const roleDisabled = lastOwner || actorCannotTouchOwner
  const roleReason = lastOwner
    ? "Make someone else an owner before changing the last owner’s role."
    : actorCannotTouchOwner
      ? "Only an owner can change an owner’s role."
      : null

  const removeDisabled = isSelf || lastOwner || actorCannotTouchOwner
  const removeReason = isSelf
    ? "You can’t remove your own access."
    : lastOwner
      ? "Make someone else an owner before removing the last owner."
      : actorCannotTouchOwner
        ? "Only an owner can remove an owner."
        : null

  return {
    roleDisabled,
    roleReason,
    removeDisabled,
    removeReason,
    canPublishForced: member.role === "viewer",
  }
}

const NOTIFICATION_LABELS: Record<string, string> = {
  GOOGLE_UPDATE: "Profile updates from Google",
  NEW_REVIEW: "New reviews",
  UPDATED_REVIEW: "Updated reviews",
  NEW_CUSTOMER_MEDIA: "New customer photos",
  DUPLICATE_LOCATION: "Duplicate location alerts",
  VOICE_OF_MERCHANT_UPDATED: "Verification status changes",
}

export function describeNotificationType(type: string): string {
  return NOTIFICATION_LABELS[type] ?? type
}
```

- [ ] **Step 7: Write the failing wire-mapping test**

`tests/components/settings-api.test.tsx` (representative: settings save, member update, invitation create, connect start, disconnect, backfill start, privacy export download):

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"

import { startGoogleConnect, disconnectConnection } from "@/lib/api/connections"
import { fetchSettings, saveSettings } from "@/lib/api/settings"
import { fetchSettingsCapabilities } from "@/lib/api/settings-capabilities"
import { updateMember } from "@/lib/api/members"
import { createInvitation } from "@/lib/api/invitations"
import { startBackfill } from "@/lib/api/backfill"
import { exportPrivacyData } from "@/lib/api/privacy"

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("settings clients", () => {
  it("fetchSettings parses the settings envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ settings: { approvalRequired: true, requireTwoPersonApproval: false, rawContentRetentionDays: 14, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsentAt: null } })
    ))
    const settings = await fetchSettings()
    expect(settings.defaultTimezone).toBe("Europe/London")
    expect(settings.directPublishConsentAt).toBeNull()
  })

  it("saveSettings PATCHes the policy body and parses the result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ settings: { approvalRequired: false, requireTwoPersonApproval: false, rawContentRetentionDays: 7, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsentAt: "2026-08-02T00:00:00.000Z" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await saveSettings({ approvalRequired: false, requireTwoPersonApproval: false, rawContentRetentionDays: 7, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsent: true })
    expect(result.directPublishConsentAt).not.toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
  })

  it("fetchSettingsCapabilities parses the capability envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ capabilities: { canManageTeam: true, canManageConnections: true, canEditSettings: true, canViewCompliance: true, canManageCompliance: false } })
    ))
    expect((await fetchSettingsCapabilities()).canManageCompliance).toBe(false)
  })
})

describe("team clients", () => {
  it("updateMember PATCHes /api/members", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ member: { userId: "u1", role: "admin", canPublish: true, createdAt: "x" } }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await updateMember({ userId: "u1", role: "admin", canPublish: true })
    expect(result.member.role).toBe("admin")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
  })

  it("createInvitation POSTs and returns the invite url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ invitation: { id: "i1", email: "a@b.test", role: "member", canPublish: false, expiresAt: "x", createdAt: "y" }, inviteUrl: "https://app.test/invite/secret" }, 201)
    ))
    const result = await createInvitation({ email: "a@b.test", role: "member", canPublish: false })
    expect(result.inviteUrl).toContain("/invite/")
  })
})

describe("connection clients", () => {
  it("startGoogleConnect POSTs connect/start and returns the authorization url", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ authorizationUrl: "https://accounts.google.test/o/oauth2/v2/auth?x=1" }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await startGoogleConnect()
    expect(result.authorizationUrl).toContain("accounts.google")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/google/connect/start")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })

  it("disconnectConnection POSTs the disconnect route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "disconnected" }))
    vi.stubGlobal("fetch", fetchMock)
    expect((await disconnectConnection("c1")).status).toBe("disconnected")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/google/connections/c1/disconnect")
  })

  it("startBackfill surfaces the paused error as an ApiClientError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "sync_paused", message: "Review sync is paused." }, 503)))
    await expect(startBackfill({ maxPagesPerLocation: 10 })).rejects.toMatchObject({ code: "sync_paused", status: 503 })
  })
})

describe("privacy export download", () => {
  it("exportPrivacyData fetches the attachment and triggers a download without JSON-parsing", async () => {
    const blob = new Blob([JSON.stringify({ reviews: [] })], { type: "application/json" })
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200, headers: { "content-disposition": 'attachment; filename="privacy-export.json"' } }))
    vi.stubGlobal("fetch", fetchMock)
    const createURL = vi.fn(() => "blob:mock")
    const revokeURL = vi.fn()
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: revokeURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    await exportPrivacyData("guest-4821")
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/privacy/export")
    expect(url.searchParams.get("subject")).toBe("guest-4821")
    expect(createURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  it("exportPrivacyData throws a mapped ApiClientError when the subject is not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "privacy_subject_not_found", message: "No retained records matched that subject reference." }, 404)))
    await expect(exportPrivacyData("nobody")).rejects.toMatchObject({ code: "privacy_subject_not_found", status: 404 })
  })
})
```

- [ ] **Step 8: Implement the typed clients**

`lib/api/settings.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const orgSettingsSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean(),
  rawContentRetentionDays: z.number(),
  defaultLanguageCode: z.string(),
  defaultTimezone: z.string(),
  directPublishConsentAt: z.string().nullable(),
})

const settingsResponseSchema = z.object({ settings: orgSettingsSchema })

export type OrgSettings = z.infer<typeof orgSettingsSchema>

export type SettingsPatchInput = {
  approvalRequired: boolean
  requireTwoPersonApproval?: boolean
  rawContentRetentionDays: number
  defaultLanguageCode: string
  defaultTimezone: string
  directPublishConsent: boolean
}

export async function fetchSettings(): Promise<OrgSettings> {
  const { settings } = await apiFetch("/api/settings", { schema: settingsResponseSchema })
  return settings
}

export async function saveSettings(input: SettingsPatchInput): Promise<OrgSettings> {
  const { settings } = await apiFetch("/api/settings", {
    method: "PATCH",
    body: input,
    schema: settingsResponseSchema,
  })
  return settings
}
```

`lib/api/settings-capabilities.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const settingsCapabilitiesSchema = z.object({
  canManageTeam: z.boolean(),
  canManageConnections: z.boolean(),
  canEditSettings: z.boolean(),
  canViewCompliance: z.boolean(),
  canManageCompliance: z.boolean(),
})

const responseSchema = z.object({ capabilities: settingsCapabilitiesSchema })

export type SettingsCapabilities = z.infer<typeof settingsCapabilitiesSchema>

export async function fetchSettingsCapabilities(): Promise<SettingsCapabilities> {
  const { capabilities } = await apiFetch("/api/settings/capabilities", { schema: responseSchema })
  return capabilities
}
```

`lib/api/members.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"
import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/forms/invitation"

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean(),
  createdAt: z.string(),
  locations: z.array(z.object({ locationId: z.string(), canPublish: z.boolean() })),
})

const membersResponseSchema = z.object({ members: z.array(memberSchema) })
const memberResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    role: z.enum(MEMBER_ROLES),
    canPublish: z.boolean(),
    createdAt: z.string(),
  }),
})
const removedResponseSchema = z.object({ removed: z.literal(true) })

export type Member = z.infer<typeof memberSchema>
export type { MemberRole }

export function fetchMembers() {
  return apiFetch("/api/members", { schema: membersResponseSchema })
}

export function updateMember(input: { userId: string; role: MemberRole; canPublish: boolean }) {
  return apiFetch("/api/members", { method: "PATCH", body: input, schema: memberResponseSchema })
}

export function removeMember(userId: string) {
  return apiFetch("/api/members", { method: "DELETE", body: { userId }, schema: removedResponseSchema })
}
```

`lib/api/invitations.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"
import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/forms/invitation"

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  inviteUrl: z.string().optional(),
})

const invitationsResponseSchema = z.object({ items: z.array(invitationSchema) })
const createResponseSchema = z.object({ invitation: invitationSchema, inviteUrl: z.string() })
const revokedResponseSchema = z.object({ revoked: z.literal(true) })

export type Invitation = z.infer<typeof invitationSchema>

export function fetchInvitations() {
  return apiFetch("/api/invitations", { schema: invitationsResponseSchema })
}

export function createInvitation(input: { email: string; role: MemberRole; canPublish: boolean }) {
  return apiFetch("/api/invitations", { method: "POST", body: input, schema: createResponseSchema })
}

export function revokeInvitation(id: string) {
  return apiFetch(`/api/invitations/${id}`, { method: "DELETE", schema: revokedResponseSchema })
}
```

`lib/api/privacy.ts` (note `exportPrivacyData` uses a raw `fetch` — NOT `apiFetch` — because the response is a downloadable attachment, not JSON; it still throws `ApiClientError` on failure so `describeActionError` handles it):

```ts
import { z } from "zod"

import { ApiClientError, apiFetch } from "./client"
import { PRIVACY_REQUEST_TYPES } from "@/lib/settings/forms/privacy-request"

export const privacyRequestSchema = z.object({
  id: z.string(),
  requestType: z.enum(PRIVACY_REQUEST_TYPES),
  status: z.string(),
  subjectReference: z.string(),
  reason: z.string().nullable(),
  requestedBy: z.string(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const requestsResponseSchema = z.object({ requests: z.array(privacyRequestSchema) })
const createResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: z.enum(PRIVACY_REQUEST_TYPES),
    status: z.string(),
    subjectReference: z.string(),
    createdAt: z.string(),
  }),
})
const resolutionResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: z.enum(PRIVACY_REQUEST_TYPES),
    status: z.string(),
    subjectReference: z.string(),
    resolutionNote: z.string().nullable(),
    resolvedAt: z.string().nullable(),
  }),
})

export type PrivacyRequest = z.infer<typeof privacyRequestSchema>

export function fetchPrivacyRequests() {
  return apiFetch("/api/privacy/requests", { schema: requestsResponseSchema })
}

export function createPrivacyRequest(input: {
  requestType: string
  subjectReference: string
  reason?: string
}) {
  return apiFetch("/api/privacy/requests", { method: "POST", body: input, schema: createResponseSchema })
}

export type UpdatePrivacyInput =
  | { id: string; action: "fulfil"; resolutionNote: string }
  | { id: string; status: string; resolutionNote: string }

export function updatePrivacyRequest(input: UpdatePrivacyInput) {
  return apiFetch("/api/privacy/requests", { method: "PATCH", body: input, schema: resolutionResponseSchema })
}

// The export is a private, no-store attachment (?subject= query param — see the §8
// tension flagged in the plan's carry-forward list). Read the blob and trigger a
// download; never log the subject reference.
export async function exportPrivacyData(subject: string): Promise<void> {
  const response = await fetch(`/api/privacy/export?subject=${encodeURIComponent(subject)}`)
  if (!response.ok) {
    let code = "http_error"
    let message = `Request failed (${response.status}).`
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiClientError(response.status, code, message)
  }
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = "privacy-export.json"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}
```

`lib/api/legal-holds.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const legalHoldSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  reason: z.string(),
  approvedBy: z.string(),
  releasedBy: z.string().nullable(),
  releasedAt: z.string().nullable(),
  createdAt: z.string(),
})

const holdsResponseSchema = z.object({ holds: z.array(legalHoldSchema) })
const createResponseSchema = z.object({
  hold: z.object({
    id: z.string(),
    reviewId: z.string(),
    reason: z.string(),
    approvedBy: z.string(),
    createdAt: z.string(),
  }),
})
const releasedResponseSchema = z.object({ released: z.literal(true) })

export type LegalHold = z.infer<typeof legalHoldSchema>

export function fetchLegalHolds() {
  return apiFetch("/api/legal-holds", { schema: holdsResponseSchema })
}

export function createLegalHold(input: { reviewId: string; reason: string }) {
  return apiFetch("/api/legal-holds", { method: "POST", body: input, schema: createResponseSchema })
}

export function releaseLegalHold(reviewId: string) {
  return apiFetch("/api/legal-holds", { method: "DELETE", body: { reviewId }, schema: releasedResponseSchema })
}
```

`lib/api/google-accounts.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const googleAccountSchema = z.object({
  id: z.string(),
  googleAccountName: z.string(),
  accountName: z.string(),
  type: z.string().nullable(),
  role: z.string().nullable(),
  permissionLevel: z.string().nullable(),
  isActive: z.boolean(),
})

const accountsResponseSchema = z.object({ accounts: z.array(googleAccountSchema) })

export type GoogleAccount = z.infer<typeof googleAccountSchema>

export function fetchGoogleAccounts(connectionId?: string | null) {
  const path = connectionId
    ? `/api/google/accounts?connection_id=${encodeURIComponent(connectionId)}`
    : "/api/google/accounts"
  return apiFetch(path, { schema: accountsResponseSchema })
}

export function saveActiveAccounts(accountIds: string[]) {
  return apiFetch("/api/google/accounts", {
    method: "PATCH",
    body: { accountIds },
    schema: accountsResponseSchema,
  })
}
```

`lib/api/google-locations.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const discoveredLocationSchema = z.object({
  id: z.string(),
  accountName: z.string(),
  googleLocationName: z.string(),
  title: z.string(),
  address: z.string(),
  verified: z.boolean(),
})

const locationsResponseSchema = z.object({ locations: z.array(discoveredLocationSchema) })

export type DiscoveredLocation = z.infer<typeof discoveredLocationSchema>

export function fetchGoogleLocations(accountName?: string | null) {
  const path = accountName
    ? `/api/google/locations?account_name=${encodeURIComponent(accountName)}`
    : "/api/google/locations"
  return apiFetch(path, { schema: locationsResponseSchema })
}
```

`lib/api/location-links.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const linkResponseSchema = z.object({
  link: z.object({
    id: z.string(),
    locationId: z.string(),
    externalLocationId: z.string(),
    isActive: z.boolean(),
  }),
})
const unlinkedResponseSchema = z.object({ unlinked: z.literal(true) })

export type LinkResult = z.infer<typeof linkResponseSchema>["link"]

export function linkExternalLocation(input: {
  externalLocationId: string
  locationId?: string
  name?: string
  timezone?: string
  confirmRelink?: boolean
}) {
  return apiFetch("/api/location-links", { method: "POST", body: input, schema: linkResponseSchema })
}

export function unlinkExternalLocation(externalLocationId: string) {
  return apiFetch(
    `/api/location-links?externalLocationId=${encodeURIComponent(externalLocationId)}`,
    { method: "DELETE", schema: unlinkedResponseSchema }
  )
}
```

`lib/api/notifications.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"
import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"

export const notificationSettingSchema = z.object({
  name: z.string(),
  pubsubTopic: z.string().optional(),
  notificationTypes: z.array(z.enum(GOOGLE_NOTIFICATION_TYPES)).optional(),
})

const settingResponseSchema = z.object({ setting: notificationSettingSchema })

export type NotificationSetting = z.infer<typeof notificationSettingSchema>

export function fetchNotificationSetting(accountId: string) {
  return apiFetch(`/api/google/notifications?account_id=${encodeURIComponent(accountId)}`, {
    schema: settingResponseSchema,
  })
}

export function saveNotificationSetting(input: {
  accountId: string
  pubsubTopic: string
  notificationTypes: string[]
}) {
  return apiFetch("/api/google/notifications", {
    method: "PATCH",
    body: input,
    schema: settingResponseSchema,
  })
}
```

`lib/api/backfill.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const BACKFILL_STATUSES = [
  "not_started",
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number]

export const backfillItemSchema = z.object({
  externalLocationId: z.string(),
  locationName: z.string().nullable(),
  status: z.string(),
  attemptCount: z.number(),
  hasMorePages: z.boolean(),
  lastErrorCode: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
})

export const backfillProgressSchema = z.object({
  items: z.array(backfillItemSchema),
  counts: z.record(z.string(), z.number()),
  total: z.number(),
})

const progressResponseSchema = z.object({ progress: backfillProgressSchema })
const startResponseSchema = z.object({ progress: backfillProgressSchema }).loose()
const cancelResponseSchema = z.object({ progress: backfillProgressSchema }).loose()

export type BackfillItem = z.infer<typeof backfillItemSchema>
export type BackfillProgress = z.infer<typeof backfillProgressSchema>

export function fetchBackfillProgress(externalLocationId?: string) {
  const path = externalLocationId
    ? `/api/sync/backfill?external_location_id=${encodeURIComponent(externalLocationId)}`
    : "/api/sync/backfill"
  return apiFetch(path, { schema: progressResponseSchema })
}

export function startBackfill(input: { externalLocationIds?: string[]; maxPagesPerLocation: number }) {
  return apiFetch("/api/sync/backfill", { method: "POST", body: input, schema: startResponseSchema })
}

export function cancelBackfill(externalLocationIds: string[]) {
  return apiFetch("/api/sync/backfill", {
    method: "DELETE",
    body: { externalLocationIds },
    schema: cancelResponseSchema,
  })
}
```

Extend `lib/api/connections.ts` (append below `fetchConnections`, keep everything existing byte-identical):

```ts
const authorizationResponseSchema = z.object({ authorizationUrl: z.string() })
const disconnectResponseSchema = z.object({ status: z.literal("disconnected") })

export function startGoogleConnect() {
  return apiFetch("/api/google/connect/start", { method: "POST", body: {}, schema: authorizationResponseSchema })
}

export function disconnectConnection(id: string) {
  return apiFetch(`/api/google/connections/${id}/disconnect`, {
    method: "POST",
    body: {},
    schema: disconnectResponseSchema,
  })
}
```

- [ ] **Step 9: Implement the read hooks**

`lib/queries/use-settings.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettings } from "@/lib/api/settings"
import { queryKeys } from "./keys"

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: fetchSettings, staleTime: 30_000 })
}
```

`lib/queries/use-settings-capabilities.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettingsCapabilities } from "@/lib/api/settings-capabilities"
import { queryKeys } from "./keys"

export function useSettingsCapabilities() {
  return useQuery({
    queryKey: queryKeys.settingsCapabilities,
    queryFn: fetchSettingsCapabilities,
    staleTime: 30_000,
  })
}
```

`lib/queries/use-members.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMembers } from "@/lib/api/members"
import { queryKeys } from "./keys"

export function useMembers() {
  return useQuery({ queryKey: queryKeys.members, queryFn: fetchMembers, staleTime: 30_000 })
}
```

`lib/queries/use-invitations.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchInvitations } from "@/lib/api/invitations"
import { queryKeys } from "./keys"

export function useInvitations() {
  return useQuery({ queryKey: queryKeys.invitations, queryFn: fetchInvitations, staleTime: 30_000 })
}
```

`lib/queries/use-privacy-requests.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPrivacyRequests } from "@/lib/api/privacy"
import { queryKeys } from "./keys"

export function usePrivacyRequests() {
  return useQuery({ queryKey: queryKeys.privacyRequests, queryFn: fetchPrivacyRequests, staleTime: 30_000 })
}
```

`lib/queries/use-legal-holds.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLegalHolds } from "@/lib/api/legal-holds"
import { queryKeys } from "./keys"

export function useLegalHolds() {
  return useQuery({ queryKey: queryKeys.legalHolds, queryFn: fetchLegalHolds, staleTime: 30_000 })
}
```

- [ ] **Step 10: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/settings-forms.test.ts tests/components/settings-action-errors.test.ts tests/components/settings-gating.test.ts tests/components/settings-api.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass. (No page built yet — `pnpm build` waits for the page tasks.)

- [ ] **Step 11: Commit**

```bash
git add lib/api lib/settings lib/queries/keys.ts lib/queries/use-settings.ts lib/queries/use-settings-capabilities.ts lib/queries/use-members.ts lib/queries/use-invitations.ts lib/queries/use-privacy-requests.ts lib/queries/use-legal-holds.ts tests/components/settings-forms.test.ts tests/components/settings-action-errors.test.ts tests/components/settings-gating.test.ts tests/components/settings-api.test.tsx
git commit -m "feat(settings): typed clients, client-safe form mirrors, action-error + gating layer, read hooks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Settings shell (layout + capability-filtered sub-nav) + legacy redirect + nav prefetch

**Files:**
- Create: `app/(dashboard)/settings/layout.tsx`, `app/(dashboard)/settings/loading.tsx`, `components/settings/settings-nav.tsx`, `app/connections/page.tsx`
- Modify: `components/app-shell/nav.tsx` (`/settings` → `prefetch: true`)
- Test: `tests/components/settings-nav.test.tsx`

**Interfaces:**
- Consumes: `getSession` (`@/lib/server/session`), `PageFrame` (`@/components/app-shell/page-frame`), `usePathname` (`next/navigation`), `redirect` (`next/navigation`), `settingsGatingFromRole` (`@/lib/settings/gating`), `cn` (`@/lib/utils`).
- Produces (Tasks 4–7 consume): the settings layout owns the single `<main>` (via `PageFrame`) so every sub-page renders only its own `<h1>` (via `PageHeader`) and `<h2>`-and-below; `SettingsNav` (props `{ role: string | null }`). No `SettingsShell` component is needed — the server layout composes `PageFrame` + `SettingsNav` directly (the file-structure overview's `settings-shell.tsx` is folded into `layout.tsx`).

- [ ] **Step 1: Write the failing sub-nav test**

`tests/components/settings-nav.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SettingsNav } from "@/components/settings/settings-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/team" }))

describe("SettingsNav", () => {
  it("shows every area to an owner and marks the active one", () => {
    render(<SettingsNav role="owner" />)
    const nav = screen.getByRole("navigation", { name: "Settings sections" })
    for (const label of ["Policy", "Team", "Compliance", "Connections"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
  })

  it("shows every area to an admin too (admins can view Compliance)", () => {
    render(<SettingsNav role="admin" />)
    for (const label of ["Policy", "Team", "Compliance", "Connections"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("shows a member only the Policy area", () => {
    render(<SettingsNav role="member" />)
    expect(screen.getByRole("link", { name: "Policy" })).toBeInTheDocument()
    for (const gone of ["Team", "Compliance", "Connections"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/settings-nav.test.tsx --project components`
Expected: FAIL — `SettingsNav` does not exist.

- [ ] **Step 3: Implement the sub-nav**

`components/settings/settings-nav.tsx` (visibility derives synchronously from the server-provided `role` via the pure `settingsGatingFromRole` mirror — no capability fetch, no flash; the parity test from Task 2 keeps it equal to the server predicates):

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { settingsGatingFromRole } from "@/lib/settings/gating"
import { cn } from "@/lib/utils"

const AREAS = [
  { href: "/settings", label: "Policy", capability: "always" as const },
  { href: "/settings/team", label: "Team", capability: "canManageTeam" as const },
  { href: "/settings/compliance", label: "Compliance", capability: "canViewCompliance" as const },
  { href: "/settings/connections", label: "Connections", capability: "canManageConnections" as const },
]

export function SettingsNav({ role }: { role: string | null }) {
  const pathname = usePathname()
  const caps = settingsGatingFromRole(role)
  const visible = AREAS.filter(
    (area) => area.capability === "always" || caps[area.capability]
  )

  return (
    <nav aria-label="Settings sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {visible.map((area) => {
          const isActive =
            area.href === "/settings"
              ? pathname === "/settings"
              : pathname === area.href || pathname.startsWith(`${area.href}/`)
          return (
            <li key={area.href}>
              <Link
                href={area.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-ui font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {area.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 4: Implement the layout + loading**

`app/(dashboard)/settings/layout.tsx` (server component owning the single `<main>` via `PageFrame`; each sub-page supplies its own `<h1>`):

```tsx
import { SettingsNav } from "@/components/settings/settings-nav"
import { PageFrame } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  return (
    <PageFrame width="standard">
      <SettingsNav role={session?.role ?? null} />
      {children}
    </PageFrame>
  )
}
```

`app/(dashboard)/settings/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
```

- [ ] **Step 5: Restore the `/connections` legacy redirect (forwards the query string — audit C-2)**

`app/connections/page.tsx` (mirrors `app/reviews/page.tsx`; the backend OAuth callback hardcodes `/connections?google=connected|error`, so the query string MUST survive the redirect or the OAuth return state is lost):

```tsx
import { redirect } from "next/navigation"

// Legacy redirect (spec §4): /connections -> /settings/connections, forwarding the
// query string so the OAuth callback's ?google=connected|error&status=… survives
// (audit C-2). The Google callback server-redirects to /connections?google=…, so
// dropping the query here would strand the connection-return state.
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined) query.set(key, value[0])
  }
  const suffix = query.toString()
  redirect(suffix ? `/settings/connections?${suffix}` : "/settings/connections")
}
```

- [ ] **Step 6: Flip the nav prefetch (D9)**

In `components/app-shell/nav.tsx`, change the `/settings` item to `prefetch: true`:

```tsx
  { href: "/settings", label: "Settings", icon: Settings, prefetch: true },
```

Update the explanatory comment so it no longer lists `/settings` among the 404-until-milestone routes — only `/performance` remains `prefetch: false` (it 404s until M7).

- [ ] **Step 7: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/settings-nav.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/settings` layout + `/connections` redirect compile; the `/settings` leaf page lands in Task 4 — land Task 3 and Task 4 together if the build requires the Policy leaf).

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/settings/layout.tsx" "app/(dashboard)/settings/loading.tsx" components/settings/settings-nav.tsx "app/connections/page.tsx" components/app-shell/nav.tsx tests/components/settings-nav.test.tsx
git commit -m "feat(settings): shell layout, capability-filtered sub-nav, /connections redirect, /settings prefetch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Policy page (`/settings`) + reply-policy form

> **Direct-publish nuance (spec §8 + the server rule):** turning OFF `approvalRequired` requires `role === "owner"` AND `directPublishConsent === true`, else the server returns `403 direct_publish_consent_required`. The form mirrors this exactly so an admin (or an owner who hasn’t ticked consent) never reaches that 403: the consent checkbox appears only when approval is off, is interactive for owners only, and Save is disabled with a `GateNote` whenever `!approvalRequired && (role !== "owner" || !directPublishConsent)`.

**Files:**
- Create: `app/(dashboard)/settings/page.tsx`, `components/settings/policy-form.tsx`
- Test: `tests/components/policy-form.test.tsx`

**Interfaces:**
- Consumes: `useSettings` (Task 2), `useSettingsCapabilities` (Task 2), `saveSettings`/`type OrgSettings` (Task 2), `settingsPolicyFormSchema`/`TIMEZONE_OPTIONS` (Task 2), `editSettingsDisabledReason` (Task 2), `describeActionError` (Task 2), `useDirtyGuard` (`@/lib/hooks/use-dirty-guard`), `useMutation`/`useQueryClient` (`@tanstack/react-query`), `useToastManager` (`@/components/ui/toast`), `GateNote` (`@/components/locations/publish-gate`), `Field`/`FieldLabel`/`FieldError`/`Input`/`Checkbox`/`Select…`/`Button`/`Alert…` (existing), `getSession`/`PageHeader` (server).
- Produces: `PolicyForm` (props `{ role: string | null }`).

- [ ] **Step 1: Write the failing test**

`tests/components/policy-form.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PolicyForm } from "@/components/settings/policy-form"
import { Toaster } from "@/components/ui/toast"
import type { OrgSettings } from "@/lib/api/settings"

const useSettingsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-settings", () => ({ useSettings: () => useSettingsMock() }))
vi.mock("@/lib/queries/use-settings-capabilities", () => ({ useSettingsCapabilities: () => useCapsMock() }))

function makeSettings(overrides: Partial<OrgSettings> = {}): OrgSettings {
  return {
    approvalRequired: true,
    requireTwoPersonApproval: false,
    rawContentRetentionDays: 14,
    defaultLanguageCode: "en-GB",
    defaultTimezone: "Europe/London",
    directPublishConsentAt: null,
    ...overrides,
  }
}

function renderForm(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PolicyForm role={role} />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PolicyForm", () => {
  it("renders the current policy and enables save once an owner edits", () => {
    useSettingsMock.mockReturnValue({ data: makeSettings(), isPending: false, isError: false, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canManageTeam: true, canManageConnections: true, canEditSettings: true, canManageCompliance: true } })
    renderForm("owner")
    const retention = screen.getByRole("spinbutton", { name: "Days to keep raw review content" })
    expect(retention).toHaveValue(14)
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    fireEvent.change(retention, { target: { value: "7" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
  })

  it("disables everything with a reason for a member (read-only)", () => {
    useSettingsMock.mockReturnValue({ data: makeSettings(), isPending: false, isError: false, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canManageTeam: false, canManageConnections: false, canEditSettings: false, canManageCompliance: false } })
    renderForm("member")
    expect(screen.getByRole("spinbutton", { name: "Days to keep raw review content" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByText("Only owners and admins can change these settings.")).toBeInTheDocument()
  })

  it("blocks turning off approval unless an owner confirms consent", () => {
    useSettingsMock.mockReturnValue({ data: makeSettings(), isPending: false, isError: false, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canManageTeam: true, canManageConnections: true, canEditSettings: true, canManageCompliance: false } })
    // Admin turns approval off -> consent checkbox is owner-only, save stays blocked.
    renderForm("admin")
    fireEvent.click(screen.getByRole("checkbox", { name: "Require approval before replies publish" }))
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(
      screen.getByText("Only an owner can turn off approval before replies publish.")
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/policy-form.test.tsx --project components`
Expected: FAIL — `PolicyForm` does not exist.

- [ ] **Step 3: Implement the policy form**

`components/settings/policy-form.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import { saveSettings, type OrgSettings, type SettingsPatchInput } from "@/lib/api/settings"
import { queryKeys } from "@/lib/queries/keys"
import { useSettings } from "@/lib/queries/use-settings"
import { useSettingsCapabilities } from "@/lib/queries/use-settings-capabilities"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/settings/action-errors"
import { editSettingsDisabledReason } from "@/lib/settings/gating"
import { TIMEZONE_OPTIONS, settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"

type FormState = {
  approvalRequired: boolean
  requireTwoPersonApproval: boolean
  rawContentRetentionDays: string
  defaultLanguageCode: string
  defaultTimezone: string
  directPublishConsent: boolean
}

function toState(settings: OrgSettings): FormState {
  return {
    approvalRequired: settings.approvalRequired,
    requireTwoPersonApproval: settings.requireTwoPersonApproval,
    rawContentRetentionDays: String(settings.rawContentRetentionDays),
    defaultLanguageCode: settings.defaultLanguageCode,
    defaultTimezone: settings.defaultTimezone,
    directPublishConsent: false,
  }
}

export function PolicyForm({ role }: { role: string | null }) {
  const query = useSettings()
  const caps = useSettingsCapabilities()
  const client = useQueryClient()
  const toast = useToastManager()
  const isOwner = role === "owner"
  const canEdit = caps.data?.canEditSettings ?? false

  const initial = query.data ? toState(query.data) : null
  const [form, setForm] = useState<FormState | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const current = form ?? initial

  const isDirty = useMemo(() => {
    if (!current || !initial) return false
    return JSON.stringify(current) !== JSON.stringify(initial)
  }, [current, initial])

  // Called for its effects only — arms beforeunload while dirty (spec §6). Do NOT
  // bind the return value; the repo lints unused vars as errors.
  useDirtyGuard({
    key: "settings-policy",
    isDirty,
    snapshot: () => JSON.stringify(current ?? {}),
  })

  const mutation = useMutation({
    mutationFn: (input: SettingsPatchInput) => saveSettings(input),
    onSuccess: async (settings) => {
      setForm(toState(settings))
      setFieldErrors({})
      setFormError(null)
      await client.invalidateQueries({ queryKey: queryKeys.settings })
      toast.add({ title: "Settings saved", type: "success" })
    },
    onError: (error) => {
      if (error instanceof ApiClientError && Array.isArray(error.details)) {
        const next: Partial<Record<keyof FormState, string>> = {}
        for (const issue of error.details as Array<{ path?: unknown[]; message?: string }>) {
          const key = issue.path?.[0]
          if (typeof key === "string" && key in ({} as FormState)) {
            next[key as keyof FormState] = issue.message ?? "Invalid value."
          }
        }
        setFieldErrors(next)
      }
      setFormError(describeActionError(error))
    },
  })

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your settings</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)}{" "}
          <Button variant="link" size="sm" onClick={() => query.refetch()}>Try again</Button>
        </AlertDescription>
      </Alert>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...current, [key]: value })
  }

  // Mirror the server rule: turning approval off needs an owner + explicit consent.
  const consentBlocked = !current.approvalRequired && (!isOwner || !current.directPublishConsent)
  const consentReason = !current.approvalRequired && !isOwner
    ? "Only an owner can turn off approval before replies publish."
    : null
  const editReason = editSettingsDisabledReason(caps.data)
  const parsed = settingsPolicyFormSchema.safeParse({
    approvalRequired: current.approvalRequired,
    requireTwoPersonApproval: current.requireTwoPersonApproval,
    rawContentRetentionDays: Number(current.rawContentRetentionDays),
    defaultLanguageCode: current.defaultLanguageCode,
    defaultTimezone: current.defaultTimezone,
    directPublishConsent: current.directPublishConsent,
  })
  const canSave = canEdit && isDirty && parsed.success && !consentBlocked && !mutation.isPending

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!parsed.success || !canSave) return
    mutation.mutate({
      approvalRequired: parsed.data.approvalRequired,
      requireTwoPersonApproval: parsed.data.requireTwoPersonApproval,
      rawContentRetentionDays: parsed.data.rawContentRetentionDays,
      defaultLanguageCode: parsed.data.defaultLanguageCode,
      defaultTimezone: parsed.data.defaultTimezone,
      directPublishConsent: parsed.data.directPublishConsent,
    })
  }

  return (
    <form className="flex max-w-2xl flex-col gap-5" onSubmit={onSubmit}>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <label className="flex items-start gap-2 text-ui">
        <Checkbox
          checked={current.approvalRequired}
          disabled={!canEdit}
          onCheckedChange={(value) => set("approvalRequired", value === true)}
          aria-label="Require approval before replies publish"
        />
        <span>Require approval before replies publish</span>
      </label>

      {current.approvalRequired ? (
        <label className="flex items-start gap-2 text-ui">
          <Checkbox
            checked={current.requireTwoPersonApproval}
            disabled={!canEdit}
            onCheckedChange={(value) => set("requireTwoPersonApproval", value === true)}
            aria-label="Require a second person to approve"
          />
          <span>Require a second person to approve each reply</span>
        </label>
      ) : (
        <div className="flex flex-col gap-2 rounded-(--nr-radius-md) border border-warning/40 bg-warning/5 p-3">
          <p className="text-ui font-medium">Replies will publish without approval</p>
          {query.data?.directPublishConsentAt ? (
            <p className="text-caption text-muted-foreground">
              Direct publishing was confirmed on{" "}
              {new Date(query.data.directPublishConsentAt).toLocaleDateString("en-GB")}.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-ui">
            <Checkbox
              checked={current.directPublishConsent}
              disabled={!isOwner || !canEdit}
              onCheckedChange={(value) => set("directPublishConsent", value === true)}
              aria-label="Confirm direct publishing"
            />
            <span>I confirm replies may publish to Google without approval.</span>
          </label>
          <GateNote reason={consentReason} />
        </div>
      )}

      <Field error={fieldErrors.rawContentRetentionDays}>
        <FieldLabel>Days to keep raw review content</FieldLabel>
        <Input
          type="number"
          min={1}
          max={30}
          value={current.rawContentRetentionDays}
          disabled={!canEdit}
          aria-label="Days to keep raw review content"
          onChange={(event) => set("rawContentRetentionDays", event.target.value)}
        />
        <FieldError>{fieldErrors.rawContentRetentionDays}</FieldError>
      </Field>

      <Field error={fieldErrors.defaultLanguageCode}>
        <FieldLabel>Default language</FieldLabel>
        <Input
          value={current.defaultLanguageCode}
          disabled={!canEdit}
          aria-label="Default language"
          placeholder="en-GB"
          onChange={(event) => set("defaultLanguageCode", event.target.value)}
        />
        <FieldError>{fieldErrors.defaultLanguageCode}</FieldError>
      </Field>

      <Field error={fieldErrors.defaultTimezone}>
        <FieldLabel>Default timezone</FieldLabel>
        <Select
          value={current.defaultTimezone}
          disabled={!canEdit}
          onValueChange={(value: string) => set("defaultTimezone", value)}
        >
          <SelectTrigger aria-label="Default timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{fieldErrors.defaultTimezone}</FieldError>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSave}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
        <GateNote reason={editReason} />
      </div>
    </form>
  )
}
```

> **Executor note:** `useDirtyGuard` is called for its effects only (it arms `beforeunload` while dirty, spec §6) — do not bind its return value, since the repo lints unused vars as errors (`pnpm lint` fails otherwise). Confirm the `Select`/`Checkbox` prop names against `components/ui/select.tsx`/`checkbox.tsx` (base-ui `onValueChange`/`onCheckedChange`); if `Select` needs an explicit `items` prop like `Combobox`, adapt the trigger/content accordingly (the M4/M5 select usages are the reference).

- [ ] **Step 4: Run to verify failure resolved, then implement the route**

`app/(dashboard)/settings/page.tsx` (Policy is readable by any authenticated user — no role redirect; the form self-gates editing):

```tsx
import { PolicyForm } from "@/components/settings/policy-form"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Reply policy · NabaPresence" }

export default async function SettingsPolicyPage() {
  const session = await getSession()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reply policy" description="How replies are approved and how long raw review content is kept." />
      <PolicyForm role={session?.role ?? null} />
    </div>
  )
}
```

- [ ] **Step 5: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/policy-form.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/settings` renders "Reply policy" as the sole `<h1>` inside the layout's single `<main>`).

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/settings/page.tsx" components/settings/policy-form.tsx tests/components/policy-form.test.tsx
git commit -m "feat(settings): reply-policy page with owner-consent direct-publish gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Team page (`/settings/team`) — members table + invitations

> **Gating mirrors the server guards exactly (spec §8 + `assertRoleChangeAllowed`/last-owner/self):** no "Owner" option for a non-owner actor; a non-owner actor can’t change or remove an owner; the sole owner can’t be demoted or removed; you can’t remove yourself; a viewer’s `canPublish` is forced off. The `inviteUrl` is a raw-token secret surfaced as a deliberate copy-once action — never logged, never rendered into markup that persists.

**Files:**
- Create: `app/(dashboard)/settings/team/page.tsx`, `components/settings/members-table.tsx`, `components/settings/invitations-panel.tsx`
- Test: `tests/components/members-table.test.tsx`, `tests/components/invitations-panel.test.tsx`

**Interfaces:**
- Consumes: `useMembers` (Task 2), `updateMember`/`removeMember`/`type Member`/`type MemberRole` (Task 2), `useInvitations`/`createInvitation`/`revokeInvitation`/`type Invitation` (Task 2), `invitationFormSchema`/`ROLE_OPTIONS`/`roleLabel` (Task 2), `roleOptionsFor`/`memberRowGate` (Task 2), `describeActionError` (Task 2), `useMutation`/`useQueryClient`, `useToastManager`, `GateNote`, `Table…`/`Badge`/`Select…`/`Checkbox`/`Button`/`Field…`/`Input`/`Empty`/`Skeleton` (existing), `getSession`/`PageHeader` (server), `redirect` (`next/navigation`).
- Produces: `MembersTable` (props `{ actorRole: MemberRole; actorUserId: string }`); `InvitationsPanel` (props `{ actorRole: MemberRole }`).

- [ ] **Step 1: Write the failing tests**

`tests/components/members-table.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MembersTable } from "@/components/settings/members-table"
import { Toaster } from "@/components/ui/toast"
import type { Member } from "@/lib/api/members"

const useMembersMock = vi.fn()
vi.mock("@/lib/queries/use-members", () => ({ useMembers: () => useMembersMock() }))

function member(overrides: Partial<Member>): Member {
  return {
    userId: "u",
    email: "u@test",
    displayName: "User",
    role: "member",
    canPublish: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    locations: [],
    ...overrides,
  }
}

function renderTable(actorRole: Member["role"], actorUserId: string, members: Member[]) {
  useMembersMock.mockReturnValue({ data: { members }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <MembersTable actorRole={actorRole} actorUserId={actorUserId} />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("MembersTable", () => {
  it("marks the current user, disables self-removal and last-owner demotion", () => {
    renderTable("owner", "owner-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "m-1", displayName: "Ben Member", email: "ben@test", role: "member" }),
    ])
    expect(screen.getByText("You")).toBeInTheDocument()
    const removeAna = screen.getByRole("button", { name: "Remove Ana Owner" })
    expect(removeAna).toBeDisabled()
  })

  it("stops an admin from editing an owner row", () => {
    renderTable("admin", "admin-1", [
      member({ userId: "owner-1", displayName: "Ana Owner", email: "ana@test", role: "owner", canPublish: true }),
      member({ userId: "admin-1", displayName: "Al Admin", email: "al@test", role: "admin", canPublish: true }),
    ])
    expect(screen.getByRole("button", { name: "Remove Ana Owner" })).toBeDisabled()
  })
})
```

`tests/components/invitations-panel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { Toaster } from "@/components/ui/toast"
import type { Invitation } from "@/lib/api/invitations"

const useInvitationsMock = vi.fn()
vi.mock("@/lib/queries/use-invitations", () => ({ useInvitations: () => useInvitationsMock() }))

function renderPanel(items: Invitation[]) {
  useInvitationsMock.mockReturnValue({ data: { items }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <InvitationsPanel actorRole="owner" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("InvitationsPanel", () => {
  it("badges an expired invitation and offers copy + revoke", () => {
    renderPanel([
      {
        id: "i1",
        email: "chef@test",
        role: "member",
        canPublish: false,
        expiresAt: "2020-01-01T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2019-12-25T00:00:00.000Z",
        inviteUrl: "https://app.test/invite/secret",
      },
    ])
    expect(screen.getByText("Expired")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy invite link for chef@test" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke invitation for chef@test" })).toBeInTheDocument()
  })

  it("shows the create form with a role select and an email field", () => {
    renderPanel([])
    expect(screen.getByRole("textbox", { name: "Email address" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/members-table.test.tsx tests/components/invitations-panel.test.tsx --project components`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Implement the members table**

`components/settings/members-table.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { GateNote } from "@/components/locations/publish-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useMembers } from "@/lib/queries/use-members"
import { removeMember, updateMember, type Member, type MemberRole } from "@/lib/api/members"
import { describeActionError } from "@/lib/settings/action-errors"
import { memberRowGate, roleOptionsFor } from "@/lib/settings/gating"
import { roleLabel } from "@/lib/settings/forms/invitation"

export function MembersTable({ actorRole, actorUserId }: { actorRole: MemberRole; actorUserId: string }) {
  const query = useMembers()
  const client = useQueryClient()
  const toast = useToastManager()

  const mutation = useMutation({
    mutationFn: (input: { userId: string; role: MemberRole; canPublish: boolean }) => updateMember(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Team updated", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const removal = useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Member removed", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your team"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const members = query.data.members
  const ownerCount = members.filter((m) => m.role === "owner").length
  const options = roleOptionsFor(actorRole)

  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Can publish</TableHead>
          <TableHead>Remove</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m: Member) => {
          const gate = memberRowGate({ actorRole, actorUserId, ownerCount, member: m })
          const busy = mutation.isPending || removal.isPending
          return (
            <TableRow key={m.userId}>
              <TableCell>
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {m.displayName}
                    {m.userId === actorUserId ? <Badge variant="secondary">You</Badge> : null}
                  </span>
                  <span className="text-caption text-muted-foreground">{m.email}</span>
                </span>
              </TableCell>
              <TableCell>
                <Select
                  value={m.role}
                  disabled={gate.roleDisabled || busy}
                  onValueChange={(role: string) =>
                    mutation.mutate({
                      userId: m.userId,
                      role: role as MemberRole,
                      canPublish: role === "viewer" ? false : m.canPublish,
                    })
                  }
                >
                  <SelectTrigger aria-label={`Role for ${m.displayName}`} className="w-36">
                    <SelectValue>{roleLabel(m.role)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <GateNote reason={gate.roleReason} />
              </TableCell>
              <TableCell>
                <Checkbox
                  checked={m.canPublish && !gate.canPublishForced}
                  disabled={gate.canPublishForced || gate.roleDisabled || busy}
                  aria-label={`Publishing access for ${m.displayName}`}
                  onCheckedChange={(value) =>
                    mutation.mutate({ userId: m.userId, role: m.role, canPublish: value === true })
                  }
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={gate.removeDisabled || busy}
                  aria-label={`Remove ${m.displayName}`}
                  onClick={() => removal.mutate(m.userId)}
                >
                  Remove
                </Button>
                <GateNote reason={gate.removeReason} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 4: Implement the invitations panel**

`components/settings/invitations-panel.tsx` (`inviteUrl` copied via the clipboard on demand — never written to logs; a fresh invite surfaces its link once in a success toast + stays copyable from the row):

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useInvitations } from "@/lib/queries/use-invitations"
import { createInvitation, revokeInvitation, type Invitation } from "@/lib/api/invitations"
import { describeActionError } from "@/lib/settings/action-errors"
import { roleOptionsFor } from "@/lib/settings/gating"
import { invitationFormSchema, roleLabel, type MemberRole } from "@/lib/settings/forms/invitation"

function isExpired(invitation: Invitation): boolean {
  return !invitation.acceptedAt && new Date(invitation.expiresAt).getTime() <= Date.now()
}

async function copyInviteLink(url: string, toast: ReturnType<typeof useToastManager>) {
  try {
    await navigator.clipboard.writeText(url)
    toast.add({ title: "Invite link copied", type: "success" })
  } catch {
    toast.add({ title: "Couldn’t copy the link. Copy it manually.", type: "error" })
  }
}

export function InvitationsPanel({ actorRole }: { actorRole: MemberRole }) {
  const query = useInvitations()
  const client = useQueryClient()
  const toast = useToastManager()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [canPublish, setCanPublish] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (input: { email: string; role: MemberRole; canPublish: boolean }) => createInvitation(input),
    onSuccess: async (result) => {
      setEmail("")
      setRole("member")
      setCanPublish(false)
      setEmailError(null)
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
      toast.add({
        title: "Invitation sent",
        description: "Copy the invite link to share it.",
        type: "success",
        actionProps: { children: "Copy link", onClick: () => copyInviteLink(result.inviteUrl, toast) },
      })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
      toast.add({ title: "Invitation revoked", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = invitationFormSchema.safeParse({ email, role, canPublish })
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Enter a valid email address.")
      return
    }
    create.mutate(parsed.data)
  }

  const options = roleOptionsFor(actorRole)

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Field error={emailError ?? undefined} className="min-w-56 flex-1">
          <FieldLabel>Email address</FieldLabel>
          <Input
            type="email"
            value={email}
            aria-label="Email address"
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError>{emailError}</FieldError>
        </Field>
        <Select value={role} onValueChange={(value: string) => setRole(value as MemberRole)}>
          <SelectTrigger aria-label="Invitation role" className="w-36">
            <SelectValue>{roleLabel(role)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-ui">
          <Checkbox
            checked={role === "viewer" ? false : canPublish}
            disabled={role === "viewer"}
            aria-label="Can publish"
            onCheckedChange={(value) => setCanPublish(value === true)}
          />
          <span>Can publish</span>
        </label>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Sending…" : "Send invitation"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty title="We couldn’t load invitations" description={describeActionError(query.error)} />
      ) : query.data.items.length === 0 ? (
        <Empty title="No pending invitations" description="Invite a teammate to give them access." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">{invitation.email}</TableCell>
                <TableCell>{roleLabel(invitation.role)}</TableCell>
                <TableCell>
                  {isExpired(invitation) ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="secondary">Pending</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex gap-2">
                    {invitation.inviteUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Copy invite link for ${invitation.email}`}
                        onClick={() => copyInviteLink(invitation.inviteUrl!, toast)}
                      >
                        Copy link
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      aria-label={`Revoke invitation for ${invitation.email}`}
                      onClick={() => revoke.mutate(invitation.id)}
                    >
                      Revoke
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

> **Executor note:** confirm the toast manager’s action API shape against `components/ui/toast.tsx` — if `toast.add` doesn’t accept `actionProps`, drop it and rely on the row-level "Copy link" button (the primary copy affordance); the success toast then just confirms "Invitation sent". Never `console.log` `inviteUrl`.

- [ ] **Step 5: Implement the route (owner/admin gated)**

`app/(dashboard)/settings/team/page.tsx`:

```tsx
import { redirect } from "next/navigation"

import { InvitationsPanel } from "@/components/settings/invitations-panel"
import { MembersTable } from "@/components/settings/members-table"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"
import type { MemberRole } from "@/lib/settings/forms/invitation"

export const metadata = { title: "Team access · NabaPresence" }

export default async function SettingsTeamPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Team access" description="Who can see and act on this organisation’s reviews and settings." />
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Members</h2>
        <MembersTable actorRole={session.role as MemberRole} actorUserId={session.userId} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Invitations</h2>
        <InvitationsPanel actorRole={session.role as MemberRole} />
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/members-table.test.tsx tests/components/invitations-panel.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/settings/team` renders "Team access" as the sole `<h1>`).

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/settings/team/page.tsx" components/settings/members-table.tsx components/settings/invitations-panel.tsx tests/components/members-table.test.tsx tests/components/invitations-panel.test.tsx
git commit -m "feat(settings): team access — members table + invitations with server-mirrored gating

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Compliance page (`/settings/compliance`) — privacy requests + legal holds + export

> **Owner/admin split (D5).** The page is reachable by owner AND admin (it server-redirects only when the role is neither). Admins see the privacy-request **list + create** (backend: `GET`/`POST /api/privacy/requests`, `GET /api/legal-holds`). The owner-only controls — privacy-request **fulfil/reject/status** (`PATCH`), the **export** card (`GET /api/privacy/export`), and the **entire legal-holds card** (`POST`/`DELETE /api/legal-holds`) — gate on `canManageCompliance` (owner) so no control produces a reachable 403 (spec §9). The privacy-export `?subject=` query param is a known §8 tension (flagged in the carry-forward list) — consumed as-is because the backend exposes no POST alternative; the subject reference is never logged.

**Files:**
- Create: `app/(dashboard)/settings/compliance/page.tsx`, `components/settings/privacy-requests-card.tsx`, `components/settings/legal-holds-card.tsx`, `components/settings/privacy-export-card.tsx`
- Test: `tests/components/privacy-requests-card.test.tsx`, `tests/components/legal-holds-card.test.tsx`, `tests/components/privacy-export-card.test.tsx`

**Interfaces:**
- Consumes: `usePrivacyRequests`/`createPrivacyRequest`/`updatePrivacyRequest`/`exportPrivacyData`/`type PrivacyRequest` (Task 2), `useLegalHolds`/`createLegalHold`/`releaseLegalHold`/`type LegalHold` (Task 2), `privacyRequestFormSchema`/`REQUEST_TYPE_OPTIONS`/`requestTypeLabel`/`requestStatusLabel` + `legalHoldFormSchema` (Task 2), `describeActionError` (Task 2), `useMutation`/`useQueryClient`, `useToastManager`, `Table…`/`Badge`/`Select…`/`Field…`/`Input`/`Textarea`/`Button`/`Empty`/`Skeleton`/`Alert…` (existing), `getSession`/`PageHeader` (server), `redirect`.
- Produces: `PrivacyRequestsCard` (props `{ canManage: boolean }` — owner+admin render it; `canManage` gates the fulfil/reject controls); `LegalHoldsCard`, `PrivacyExportCard` (no props — the page renders them only for owners).

- [ ] **Step 1: Write the failing tests**

`tests/components/privacy-requests-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PrivacyRequestsCard } from "@/components/settings/privacy-requests-card"
import { Toaster } from "@/components/ui/toast"
import type { PrivacyRequest } from "@/lib/api/privacy"

const useRequestsMock = vi.fn()
vi.mock("@/lib/queries/use-privacy-requests", () => ({ usePrivacyRequests: () => useRequestsMock() }))

function request(overrides: Partial<PrivacyRequest>): PrivacyRequest {
  return {
    id: "r1",
    requestType: "erasure",
    status: "pending",
    subjectReference: "guest-4821",
    reason: null,
    requestedBy: "u",
    resolvedBy: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCard(requests: PrivacyRequest[]) {
  useRequestsMock.mockReturnValue({ data: { requests }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PrivacyRequestsCard canManage />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PrivacyRequestsCard", () => {
  it("lists a request with a humanised type and status", () => {
    renderCard([request({})])
    expect(screen.getByText("guest-4821")).toBeInTheDocument()
    expect(screen.getByText("Erasure")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })

  it("renders the create form", () => {
    renderCard([])
    expect(screen.getByRole("textbox", { name: "Subject reference" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Log request" })).toBeInTheDocument()
  })
})
```

`tests/components/legal-holds-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LegalHoldsCard } from "@/components/settings/legal-holds-card"
import { Toaster } from "@/components/ui/toast"
import type { LegalHold } from "@/lib/api/legal-holds"

const useHoldsMock = vi.fn()
vi.mock("@/lib/queries/use-legal-holds", () => ({ useLegalHolds: () => useHoldsMock() }))

function renderCard(holds: LegalHold[]) {
  useHoldsMock.mockReturnValue({ data: { holds }, isPending: false, isError: false, refetch: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <LegalHoldsCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("LegalHoldsCard", () => {
  it("lists an active hold with a release action", () => {
    renderCard([
      { id: "h1", reviewId: "rev-1", reason: "Litigation pending", approvedBy: "u", releasedBy: null, releasedAt: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ])
    expect(screen.getByText("Litigation pending")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Release hold on rev-1" })).toBeInTheDocument()
  })
})
```

`tests/components/privacy-export-card.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PrivacyExportCard } from "@/components/settings/privacy-export-card"
import { Toaster } from "@/components/ui/toast"
import * as privacyApi from "@/lib/api/privacy"

afterEach(() => vi.restoreAllMocks())

describe("PrivacyExportCard", () => {
  it("exports the entered subject reference", async () => {
    const spy = vi.spyOn(privacyApi, "exportPrivacyData").mockResolvedValue()
    render(<Toaster><PrivacyExportCard /></Toaster>)
    fireEvent.change(screen.getByRole("textbox", { name: "Subject reference" }), { target: { value: "guest-4821" } })
    fireEvent.click(screen.getByRole("button", { name: "Download export" }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith("guest-4821"))
  })

  it("surfaces a not-found error without showing the code", async () => {
    const { ApiClientError } = await import("@/lib/api/client")
    vi.spyOn(privacyApi, "exportPrivacyData").mockRejectedValue(new ApiClientError(404, "privacy_subject_not_found", "x"))
    render(<Toaster><PrivacyExportCard /></Toaster>)
    fireEvent.change(screen.getByRole("textbox", { name: "Subject reference" }), { target: { value: "nobody" } })
    fireEvent.click(screen.getByRole("button", { name: "Download export" }))
    expect(await screen.findByText("No records matched that reference.")).toBeInTheDocument()
    expect(screen.queryByText(/privacy_subject_not_found/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/privacy-requests-card.test.tsx tests/components/legal-holds-card.test.tsx tests/components/privacy-export-card.test.tsx --project components`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Implement the privacy-requests card**

`components/settings/privacy-requests-card.tsx` (create + fulfil/status; a legal-hold-blocked fulfil surfaces the mapped `privacy_legal_hold` copy — no review ids leaked):

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { usePrivacyRequests } from "@/lib/queries/use-privacy-requests"
import { createPrivacyRequest, updatePrivacyRequest, type PrivacyRequest } from "@/lib/api/privacy"
import { describeActionError } from "@/lib/settings/action-errors"
import {
  REQUEST_TYPE_OPTIONS,
  privacyRequestFormSchema,
  requestStatusLabel,
  requestTypeLabel,
  type PrivacyRequestType,
} from "@/lib/settings/forms/privacy-request"

const OPEN_STATUSES = new Set(["pending", "in_progress"])

export function PrivacyRequestsCard({ canManage }: { canManage: boolean }) {
  const query = usePrivacyRequests()
  const client = useQueryClient()
  const toast = useToastManager()
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access")
  const [subjectReference, setSubjectReference] = useState("")
  const [reason, setReason] = useState("")
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.privacyRequests })

  const create = useMutation({
    mutationFn: (input: { requestType: string; subjectReference: string; reason?: string }) =>
      createPrivacyRequest(input),
    onSuccess: async () => {
      setSubjectReference("")
      setReason("")
      setSubjectError(null)
      await invalidate()
      toast.add({ title: "Request logged", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const resolve = useMutation({
    mutationFn: (id: string) =>
      updatePrivacyRequest({ id, action: "fulfil", resolutionNote: "Fulfilled from the compliance console." }),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Request fulfilled", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const reject = useMutation({
    mutationFn: (id: string) =>
      updatePrivacyRequest({ id, status: "rejected", resolutionNote: "Rejected from the compliance console." }),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Request rejected", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = privacyRequestFormSchema.safeParse({
      requestType,
      subjectReference,
      reason: reason.trim() ? reason : undefined,
    })
    if (!parsed.success) {
      setSubjectError(parsed.error.issues[0]?.message ?? "Enter a subject reference.")
      return
    }
    create.mutate(parsed.data)
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Privacy requests</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Select value={requestType} onValueChange={(value: string) => setRequestType(value as PrivacyRequestType)}>
          <SelectTrigger aria-label="Request type" className="w-40">
            <SelectValue>{requestTypeLabel(requestType)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REQUEST_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Field error={subjectError ?? undefined} className="min-w-56 flex-1">
          <FieldLabel>Subject reference</FieldLabel>
          <Input
            value={subjectReference}
            aria-label="Subject reference"
            placeholder="e.g. guest-4821"
            onChange={(event) => setSubjectReference(event.target.value)}
          />
          <FieldError>{subjectError}</FieldError>
        </Field>
        <Field className="min-w-56 flex-1">
          <FieldLabel>Reason (optional)</FieldLabel>
          <Textarea value={reason} aria-label="Reason" rows={1} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Logging…" : "Log request"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty title="We couldn’t load privacy requests" description={describeActionError(query.error)} />
      ) : query.data.requests.length === 0 ? (
        <Empty title="No privacy requests" description="Logged data-subject requests appear here." />
      ) : (
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.requests.map((row: PrivacyRequest) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.subjectReference}</TableCell>
                <TableCell>{requestTypeLabel(row.requestType)}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "completed" ? "success" : row.status === "rejected" ? "outline" : "secondary"}>
                    {requestStatusLabel(row.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {OPEN_STATUSES.has(row.status) ? (
                    canManage ? (
                      <span className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate(row.id)}
                        >
                          Fulfil
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reject.isPending}
                          onClick={() => reject.mutate(row.id)}
                        >
                          Reject
                        </Button>
                      </span>
                    ) : (
                      <span className="text-caption text-muted-foreground">Awaiting an owner</span>
                    )
                  ) : (
                    <span className="text-caption text-muted-foreground">Resolved</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Implement the legal-holds card**

`components/settings/legal-holds-card.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useLegalHolds } from "@/lib/queries/use-legal-holds"
import { createLegalHold, releaseLegalHold, type LegalHold } from "@/lib/api/legal-holds"
import { describeActionError } from "@/lib/settings/action-errors"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"

export function LegalHoldsCard() {
  const query = useLegalHolds()
  const client = useQueryClient()
  const toast = useToastManager()
  const [reviewId, setReviewId] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.legalHolds })

  const create = useMutation({
    mutationFn: (input: { reviewId: string; reason: string }) => createLegalHold(input),
    onSuccess: async () => {
      setReviewId("")
      setReason("")
      setError(null)
      await invalidate()
      toast.add({ title: "Legal hold applied", type: "success" })
    },
    onError: (mutationError) => toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const release = useMutation({
    mutationFn: (id: string) => releaseLegalHold(id),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Legal hold released", type: "success" })
    },
    onError: (mutationError) => toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = legalHoldFormSchema.safeParse({ reviewId, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the review and reason.")
      return
    }
    create.mutate(parsed.data)
  }

  const active = query.data?.holds.filter((hold) => !hold.releasedAt) ?? []

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Legal holds</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Field error={error ?? undefined} className="min-w-56 flex-1">
          <FieldLabel>Review identifier</FieldLabel>
          <Input value={reviewId} aria-label="Review identifier" onChange={(event) => setReviewId(event.target.value)} />
          <FieldError>{error}</FieldError>
        </Field>
        <Field className="min-w-56 flex-1">
          <FieldLabel>Reason</FieldLabel>
          <Textarea value={reason} aria-label="Hold reason" rows={1} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Applying…" : "Apply hold"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty title="We couldn’t load legal holds" description={describeActionError(query.error)} />
      ) : active.length === 0 ? (
        <Empty title="No active legal holds" description="Holds prevent matching reviews from being erased." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Review</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((hold: LegalHold) => (
              <TableRow key={hold.id}>
                <TableCell className="font-medium">{hold.reviewId}</TableCell>
                <TableCell className="text-muted-foreground">{hold.reason}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={release.isPending}
                    aria-label={`Release hold on ${hold.reviewId}`}
                    onClick={() => release.mutate(hold.reviewId)}
                  >
                    Release
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Implement the export card**

`components/settings/privacy-export-card.tsx`:

```tsx
"use client"

import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { exportPrivacyData } from "@/lib/api/privacy"
import { describeActionError } from "@/lib/settings/action-errors"

export function PrivacyExportCard() {
  const [subject, setSubject] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onExport = async () => {
    if (subject.trim().length < 3) {
      setError("Enter at least 3 characters.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await exportPrivacyData(subject.trim())
    } catch (caught) {
      setError(describeActionError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Export a subject’s records</h2>
      <p className="text-caption text-muted-foreground">
        Downloads a private file of the retained records for a subject reference. The file isn’t stored.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-56 flex-1">
          <FieldLabel>Subject reference</FieldLabel>
          <Input value={subject} aria-label="Subject reference" onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Button type="button" disabled={busy} onClick={onExport}>
          {busy ? "Preparing…" : "Download export"}
        </Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Implement the route (owner gated)**

`app/(dashboard)/settings/compliance/page.tsx`:

```tsx
import { redirect } from "next/navigation"

import { LegalHoldsCard } from "@/components/settings/legal-holds-card"
import { PrivacyExportCard } from "@/components/settings/privacy-export-card"
import { PrivacyRequestsCard } from "@/components/settings/privacy-requests-card"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Data and compliance · NabaPresence" }

export default async function SettingsCompliancePage() {
  const session = await getSession()
  // Owner + admin may view/create privacy requests; only owners manage (D5).
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  const canManage = session.role === "owner"
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Data and compliance" description="Handle data-subject requests, legal holds and record exports." />
      <PrivacyRequestsCard canManage={canManage} />
      {canManage ? <LegalHoldsCard /> : null}
      {canManage ? <PrivacyExportCard /> : null}
    </div>
  )
}
```

- [ ] **Step 7: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/privacy-requests-card.test.tsx tests/components/legal-holds-card.test.tsx tests/components/privacy-export-card.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/settings/compliance` renders "Data and compliance" as the sole `<h1>`).

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/settings/compliance/page.tsx" components/settings/privacy-requests-card.tsx components/settings/legal-holds-card.tsx components/settings/privacy-export-card.tsx tests/components/privacy-requests-card.test.tsx tests/components/legal-holds-card.test.tsx tests/components/privacy-export-card.test.tsx
git commit -m "feat(settings): data and compliance — privacy requests, legal holds, subject export

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Connections page (`/settings/connections`) — workspace shell + connection card + reconnect alert + OAuth return

> **OAuth is a redirect flow — NEVER render/collect Google credentials.** `POST /api/google/connect/start → { authorizationUrl }`, then `window.location.assign(authorizationUrl)`. Google redirects the browser to the server callback, which redirects to `/connections?google=connected|error&status=…`; the Task-3 redirect forwards that query to `/settings/connections?google=…`, which this task reads. "Reconnect" re-runs the same `connect/start`. Disconnect is destructive (7-day purge) → an `OverwriteConfirmDialog` acknowledgement. The freshness chip in the app shell already reflects `['connections']` via `useConnectionHealth` (M3) — no bespoke status machine.

**Files:**
- Create: `app/(dashboard)/settings/connections/page.tsx`, `components/settings/connections-workspace.tsx`, `components/settings/connection-card.tsx`, `components/settings/reconnect-alert.tsx`, `components/settings/oauth-return.tsx`, `lib/queries/use-connection-workspace.ts`
- Test: `tests/components/connection-card.test.tsx`, `tests/components/oauth-return.test.tsx`

**Interfaces:**
- Consumes: `fetchConnections`/`startGoogleConnect`/`disconnectConnection`/`type ConnectionSummary` (`@/lib/api/connections`), `queryKeys` (Task 2), `describeActionError` (Task 2), `OverwriteConfirmDialog` (`@/components/locations/overwrite-confirm-dialog`), `useQuery`/`useMutation`/`useQueryClient`, `useToastManager`, `useSearchParams`/`useRouter` (`next/navigation`), `Alert…`/`Badge`/`Button`/`Empty`/`Skeleton`/`Table…` (existing), `getSession`/`PageHeader` (server), `redirect`.
- Produces (Tasks 8–10 consume): `useConnectionWorkspace()` returning `{ query, connect, disconnect }`; `ConnectionsWorkspace` (the client root that Tasks 8–10 extend by inserting their cards); `ConnectionCard`, `ReconnectAlert`, `OAuthReturn`.

- [ ] **Step 1: Implement the workspace hook**

`lib/queries/use-connection-workspace.ts`:

```ts
"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useToastManager } from "@/components/ui/toast"
import { disconnectConnection, fetchConnections, startGoogleConnect } from "@/lib/api/connections"
import { describeActionError } from "@/lib/settings/action-errors"
import { queryKeys } from "./keys"

export function useConnectionWorkspace() {
  const client = useQueryClient()
  const toast = useToastManager()
  const query = useQuery({
    queryKey: queryKeys.connections,
    queryFn: fetchConnections,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const connect = useMutation({
    mutationFn: startGoogleConnect,
    onSuccess: (result) => {
      // Hand off to Google — the browser leaves the app here.
      window.location.assign(result.authorizationUrl)
    },
    // Surface a failed handshake (503 google_not_configured / 403 permission_denied);
    // the Connect button, ReconnectAlert and OAuthReturn "Try again" all call this bare.
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => disconnectConnection(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.connections }),
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })
  return { query, connect, disconnect }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/components/connection-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionCard } from "@/components/settings/connection-card"
import { Toaster } from "@/components/ui/toast"
import type { ConnectionSummary } from "@/lib/api/connections"

const workspaceMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))

function connection(overrides: Partial<ConnectionSummary>): ConnectionSummary {
  return {
    id: "c1",
    googleEmail: "owner@riverside.test",
    status: "active",
    notificationsEnabled: true,
    lastRefreshAt: "2026-08-01T00:00:00.000Z",
    lastErrorCode: null,
    reconnectRequired: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCard(connections: ConnectionSummary[]) {
  workspaceMock.mockReturnValue({
    query: { data: { connections }, isPending: false, isError: false, refetch: vi.fn() },
    connect: { mutate: vi.fn(), isPending: false },
    disconnect: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ConnectionCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ConnectionCard", () => {
  it("lists a connected account with a humanised status and a disconnect action", () => {
    renderCard([connection({})])
    expect(screen.getByText("owner@riverside.test")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disconnect owner@riverside.test" })).toBeInTheDocument()
  })

  it("offers a connect button when there are no connections", () => {
    renderCard([])
    expect(screen.getByRole("button", { name: "Connect Google Business Profile" })).toBeInTheDocument()
  })
})
```

`tests/components/oauth-return.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OAuthReturn } from "@/components/settings/oauth-return"
import { Toaster } from "@/components/ui/toast"

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}))
const connectMutate = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => ({ connect: { mutate: connectMutate, isPending: false } }),
}))

afterEach(() => {
  vi.clearAllMocks()
  search = new URLSearchParams()
})

describe("OAuthReturn", () => {
  it("shows a mapped error and a Try again action for ?google=error&status=502", () => {
    search = new URLSearchParams("google=error&status=502")
    render(<Toaster><OAuthReturn /></Toaster>)
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
    expect(screen.queryByText(/status=502/)).not.toBeInTheDocument()
  })

  it("clears the query and renders nothing for ?google=connected", () => {
    search = new URLSearchParams("google=connected")
    const { container } = render(<Toaster><OAuthReturn /></Toaster>)
    expect(replace).toHaveBeenCalledWith("/settings/connections")
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/connection-card.test.tsx tests/components/oauth-return.test.tsx --project components`
Expected: FAIL — the components do not exist.

- [ ] **Step 4: Implement the OAuth-return handler**

`components/settings/oauth-return.tsx` (maps the HTTP status carried in `?status=` to copy — a status, not an error code, so a small local map; clears the query so a refresh doesn’t re-fire):

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

function describeOAuthStatus(status: string | null): string {
  switch (status) {
    case "400":
      return "Google sign-in was cancelled or couldn’t be completed. Try connecting again."
    case "401":
      return "Your session expired during sign-in. Sign in again, then reconnect."
    case "403":
      return "You don’t have permission to connect Google for this organisation."
    case "429":
      return "Google is rate-limiting requests right now. Try again shortly."
    default:
      return "Google is temporarily unavailable. Try connecting again shortly."
  }
}

export function OAuthReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const toast = useToastManager()
  const { connect } = useConnectionWorkspace()
  const google = params.get("google")
  const status = params.get("status")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (google === "connected") {
      toast.add({ title: "Google Business Profile connected", type: "success" })
      router.replace("/settings/connections")
    } else if (google === "error") {
      setError(describeOAuthStatus(status))
      // Keep the message; strip the query so a refresh doesn’t re-toast/re-error.
      router.replace("/settings/connections")
    }
    // Only react to the raw query values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google, status])

  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn’t connect Google</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}
```

- [ ] **Step 5: Implement the reconnect alert**

`components/settings/reconnect-alert.tsx` (pinned when any connection needs reconnecting):

```tsx
"use client"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

export function ReconnectAlert() {
  const { query, connect } = useConnectionWorkspace()
  const needsReconnect = query.data?.connections.some((connection) => connection.reconnectRequired) ?? false
  if (!needsReconnect) return null
  return (
    <Alert variant="warning">
      <AlertTitle>Reconnect Google to keep syncing</AlertTitle>
      <AlertDescription>
        Google access for one of your accounts has expired. Reconnect to resume reviews and publishing.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          Reconnect
        </Button>
      </AlertAction>
    </Alert>
  )
}
```

- [ ] **Step 6: Implement the connection card**

`components/settings/connection-card.tsx`:

```tsx
"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { describeActionError } from "@/lib/settings/action-errors"
import type { ConnectionSummary } from "@/lib/api/connections"

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "outline" }> = {
  active: { label: "Connected", variant: "success" },
  disconnected: { label: "Disconnected", variant: "outline" },
  revoked: { label: "Access revoked", variant: "warning" },
  expired: { label: "Access expired", variant: "warning" },
}

function statusBadge(status: string) {
  const entry = STATUS[status] ?? { label: status, variant: "secondary" as const }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export function ConnectionCard() {
  const { query, connect, disconnect } = useConnectionWorkspace()
  const [pendingDisconnect, setPendingDisconnect] = useState<ConnectionSummary | null>(null)

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your connections"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const connections = query.data.connections

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google account</h2>
      {connections.length === 0 ? (
        <Empty
          title="No Google account connected"
          description="Connect a Google Business Profile to import locations and manage reviews."
          action={
            <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
              Connect Google Business Profile
            </Button>
          }
        />
      ) : (
        <>
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell className="font-medium">{connection.googleEmail ?? "Google account"}</TableCell>
                  <TableCell>{statusBadge(connection.status)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disconnect.isPending || connection.status === "disconnected"}
                      aria-label={`Disconnect ${connection.googleEmail ?? "Google account"}`}
                      onClick={() => setPendingDisconnect(connection)}
                    >
                      Disconnect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button variant="outline" disabled={connect.isPending} onClick={() => connect.mutate()}>
              Connect another account
            </Button>
          </div>
        </>
      )}

      <OverwriteConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null)
        }}
        title="Disconnect this Google account?"
        description="Reviews and publishing stop immediately. Linked locations and notifications are deactivated, and the account’s data is permanently removed after 7 days."
        confirmLabel="Disconnect"
        requireAcknowledgement
        acknowledgementLabel="I understand this deactivates linked locations and purges the data after 7 days."
        pending={disconnect.isPending}
        onConfirm={() => {
          if (pendingDisconnect) {
            disconnect.mutate(pendingDisconnect.id, { onSuccess: () => setPendingDisconnect(null) })
          }
        }}
      />
    </section>
  )
}
```

- [ ] **Step 7: Implement the workspace root + route**

`components/settings/connections-workspace.tsx` (Tasks 8–10 insert their cards at the marked region — the account picker, import, backfill and notifications cards render only when a connection exists):

```tsx
"use client"

import { ConnectionCard } from "@/components/settings/connection-card"
import { OAuthReturn } from "@/components/settings/oauth-return"
import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

export function ConnectionsWorkspace() {
  const { query } = useConnectionWorkspace()
  const hasConnection = (query.data?.connections.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-8">
      <OAuthReturn />
      <ReconnectAlert />
      <ConnectionCard />
      {/* CONNECTION-CARDS: Task 8 (AccountPickerCard) / Task 9 (ImportCard) / Task 10 (BackfillCard, NotificationsCard) render below when hasConnection. */}
      {hasConnection ? null : null}
    </div>
  )
}
```

`app/(dashboard)/settings/connections/page.tsx` (owner/admin gated):

```tsx
import { redirect } from "next/navigation"

import { ConnectionsWorkspace } from "@/components/settings/connections-workspace"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Google Business Profile · NabaPresence" }

export default async function SettingsConnectionsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Google Business Profile" description="Connect Google, choose accounts, import locations and manage notifications." />
      <ConnectionsWorkspace />
    </div>
  )
}
```

- [ ] **Step 8: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/connection-card.test.tsx tests/components/oauth-return.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/settings/connections` renders "Google Business Profile" as the sole `<h1>`).

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/settings/connections/page.tsx" components/settings/connections-workspace.tsx components/settings/connection-card.tsx components/settings/reconnect-alert.tsx components/settings/oauth-return.tsx lib/queries/use-connection-workspace.ts tests/components/connection-card.test.tsx tests/components/oauth-return.test.tsx
git commit -m "feat(settings): connections workspace — connect/disconnect, reconnect alert, OAuth return

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Account picker card + locations discovery + `deriveAutoSelection`

> **The single auto-selection rule (spec §8):** one pure `deriveAutoSelection` resolves the working connection and account from the loaded data + the user’s current choice, unit-tested in isolation. The account picker activates the chosen accounts (`PATCH /api/google/accounts`); Task 9’s import card reuses the same derivation to know which account’s locations to discover — no shared component state, both derive from the shared Query cache.

**Files:**
- Create: `lib/connections/derive-auto-selection.ts`, `lib/queries/use-google-accounts.ts`, `lib/queries/use-google-locations.ts`, `components/settings/account-picker-card.tsx`
- Modify: `components/settings/connections-workspace.tsx` (insert `AccountPickerCard`)
- Test: `tests/components/derive-auto-selection.test.ts`, `tests/components/account-picker-card.test.tsx`

**Interfaces:**
- Consumes: `fetchGoogleAccounts`/`saveActiveAccounts`/`type GoogleAccount` (`@/lib/api/google-accounts`), `fetchGoogleLocations`/`type DiscoveredLocation` (`@/lib/api/google-locations`), `useConnectionWorkspace` (Task 7), `queryKeys` (Task 2), `describeActionError` (Task 2), `useQuery`/`useMutation`/`useQueryClient`, `useToastManager`, `Checkbox`/`Select…`/`Button`/`Empty`/`Skeleton`/`Table…` (existing).
- Produces (Task 9 consumes): `deriveAutoSelection(input): { connectionId: string | null; accountName: string | null }`; `useGoogleAccounts(connectionId: string | null)` → `{ query, save }`; `useGoogleLocations(accountName: string | null)` → the discovery query; `AccountPickerCard`.

- [ ] **Step 1: Write the failing `deriveAutoSelection` test**

`tests/components/derive-auto-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"

describe("deriveAutoSelection", () => {
  it("returns nulls when there are no connections", () => {
    expect(deriveAutoSelection({ connections: [], accounts: [], selectedConnectionId: null, selectedAccountName: null })).toEqual({
      connectionId: null,
      accountName: null,
    })
  })

  it("keeps a still-valid selection", () => {
    const result = deriveAutoSelection({
      connections: [{ id: "c1", status: "active" }, { id: "c2", status: "active" }],
      accounts: [{ googleAccountName: "accounts/1", isActive: true }, { googleAccountName: "accounts/2", isActive: true }],
      selectedConnectionId: "c2",
      selectedAccountName: "accounts/2",
    })
    expect(result).toEqual({ connectionId: "c2", accountName: "accounts/2" })
  })

  it("prefers the first active connection when nothing valid is selected", () => {
    const result = deriveAutoSelection({
      connections: [{ id: "c1", status: "revoked" }, { id: "c2", status: "active" }],
      accounts: [],
      selectedConnectionId: "gone",
      selectedAccountName: null,
    })
    expect(result.connectionId).toBe("c2")
  })

  it("auto-selects the sole active account but not when several are active", () => {
    expect(
      deriveAutoSelection({
        connections: [{ id: "c1", status: "active" }],
        accounts: [{ googleAccountName: "accounts/only", isActive: true }, { googleAccountName: "accounts/off", isActive: false }],
        selectedConnectionId: null,
        selectedAccountName: null,
      }).accountName
    ).toBe("accounts/only")
    expect(
      deriveAutoSelection({
        connections: [{ id: "c1", status: "active" }],
        accounts: [{ googleAccountName: "accounts/a", isActive: true }, { googleAccountName: "accounts/b", isActive: true }],
        selectedConnectionId: null,
        selectedAccountName: null,
      }).accountName
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/derive-auto-selection.test.ts --project components`
Expected: FAIL — `deriveAutoSelection` does not exist.

- [ ] **Step 3: Implement the pure rule**

`lib/connections/derive-auto-selection.ts`:

```ts
export type AutoSelectionInput = {
  connections: Array<{ id: string; status: string }>
  accounts: Array<{ googleAccountName: string; isActive: boolean }>
  selectedConnectionId: string | null
  selectedAccountName: string | null
}

export type AutoSelection = { connectionId: string | null; accountName: string | null }

export function deriveAutoSelection(input: AutoSelectionInput): AutoSelection {
  const { connections, accounts, selectedConnectionId, selectedAccountName } = input

  const validSelected = connections.find((connection) => connection.id === selectedConnectionId)
  const firstActive = connections.find((connection) => connection.status === "active")
  const connectionId = validSelected?.id ?? firstActive?.id ?? connections[0]?.id ?? null

  const activeAccounts = accounts.filter((account) => account.isActive)
  const selectedStillActive = activeAccounts.some((account) => account.googleAccountName === selectedAccountName)
  const accountName = selectedStillActive
    ? selectedAccountName
    : activeAccounts.length === 1
      ? activeAccounts[0].googleAccountName
      : null

  return { connectionId, accountName }
}
```

- [ ] **Step 4: Implement the discovery hooks**

`lib/queries/use-google-accounts.ts`:

```ts
"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchGoogleAccounts, saveActiveAccounts } from "@/lib/api/google-accounts"
import { queryKeys } from "./keys"

export function useGoogleAccounts(connectionId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.googleAccounts(connectionId),
    queryFn: () => fetchGoogleAccounts(connectionId),
    staleTime: 30_000,
  })
  const save = useMutation({
    mutationFn: (accountIds: string[]) => saveActiveAccounts(accountIds),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.googleAccounts(connectionId) }),
  })
  return { query, save }
}
```

`lib/queries/use-google-locations.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchGoogleLocations } from "@/lib/api/google-locations"
import { queryKeys } from "./keys"

export function useGoogleLocations(accountName: string | null) {
  return useQuery({
    queryKey: queryKeys.googleLocations(accountName),
    queryFn: () => fetchGoogleLocations(accountName),
    enabled: accountName !== null,
    staleTime: 30_000,
  })
}
```

- [ ] **Step 5: Write the failing account-picker test**

`tests/components/account-picker-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountPickerCard } from "@/components/settings/account-picker-card"
import { Toaster } from "@/components/ui/toast"
import type { GoogleAccount } from "@/lib/api/google-accounts"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))

function account(overrides: Partial<GoogleAccount>): GoogleAccount {
  return {
    id: "a1",
    googleAccountName: "accounts/1",
    accountName: "Riverside Group",
    type: "LOCATION_GROUP",
    role: "OWNER",
    permissionLevel: "OWNER_LEVEL",
    isActive: false,
    ...overrides,
  }
}

function renderCard(accounts: GoogleAccount[], save = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: { data: { connections: [{ id: "c1", status: "active" }] }, isPending: false, isError: false },
  })
  accountsMock.mockReturnValue({
    query: { data: { accounts }, isPending: false, isError: false, refetch: vi.fn() },
    save: { mutate: save, isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <AccountPickerCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("AccountPickerCard", () => {
  it("lists discovered accounts and saves the active set", () => {
    const save = vi.fn()
    renderCard([account({ id: "a1", accountName: "Riverside Group" })], save)
    expect(screen.getByText("Riverside Group")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Riverside Group" }))
    fireEvent.click(screen.getByRole("button", { name: "Save accounts" }))
    expect(save).toHaveBeenCalledWith(["a1"])
  })

  it("shows an empty state when no accounts are discovered", () => {
    renderCard([])
    expect(screen.getByText("No Google accounts found")).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm exec vitest run tests/components/account-picker-card.test.tsx --project components`
Expected: FAIL — `AccountPickerCard` does not exist.

- [ ] **Step 7: Implement the account picker card**

`components/settings/account-picker-card.tsx`:

```tsx
"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { describeActionError } from "@/lib/settings/action-errors"

export function AccountPickerCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const resolvedConnectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId,
    selectedAccountName: null,
  }).connectionId
  void setSelectedConnectionId // retained for the multi-connection selector; single-connection path auto-resolves

  const accounts = useGoogleAccounts(resolvedConnectionId)
  const toast = useToastManager()
  const [checked, setChecked] = useState<Set<string> | null>(null)

  const rows = accounts.query.data?.accounts ?? []
  const activeIds = useMemo(
    () => new Set(rows.filter((account) => account.isActive).map((account) => account.id)),
    [rows]
  )
  const current = checked ?? activeIds

  if (accounts.query.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (accounts.query.isError) {
    return (
      <Empty
        title="We couldn’t load your Google accounts"
        description={describeActionError(accounts.query.error)}
        action={<Button variant="outline" onClick={() => accounts.query.refetch()}>Try again</Button>}
      />
    )
  }
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Google accounts</h2>
        <Empty title="No Google accounts found" description="This connection has no Business Profile accounts to manage." />
      </section>
    )
  }

  const toggle = (id: string) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google accounts</h2>
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Use</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((account) => (
            <TableRow key={account.id}>
              <TableCell>
                <Checkbox
                  checked={current.has(account.id)}
                  aria-label={`Use ${account.accountName}`}
                  onCheckedChange={() => toggle(account.id)}
                />
              </TableCell>
              <TableCell className="font-medium">{account.accountName}</TableCell>
              <TableCell className="text-muted-foreground">{account.role ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div>
        <Button
          disabled={accounts.save.isPending}
          onClick={() =>
            accounts.save.mutate([...current], {
              onSuccess: () => {
                setChecked(null)
                toast.add({ title: "Accounts updated", type: "success" })
              },
              onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
            })
          }
        >
          {accounts.save.isPending ? "Saving…" : "Save accounts"}
        </Button>
      </div>
    </section>
  )
}
```

> **Executor note:** the `void setSelectedConnectionId` line is a marker for the multi-connection selector — when the org has more than one connection, render a `Select` bound to `selectedConnectionId`/`setSelectedConnectionId` above the table so the user can switch connections; the single-connection path resolves automatically via `deriveAutoSelection`. Remove the `void` line once the selector (or the multi-connection deferral note) is in place.

- [ ] **Step 8: Insert the card into the workspace**

In `components/settings/connections-workspace.tsx`, import `AccountPickerCard` and render it in the marked region when `hasConnection`:

```tsx
      <ConnectionCard />
      {hasConnection ? <AccountPickerCard /> : null}
```

- [ ] **Step 9: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/derive-auto-selection.test.ts tests/components/account-picker-card.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green.

- [ ] **Step 10: Commit**

```bash
git add lib/connections/derive-auto-selection.ts lib/queries/use-google-accounts.ts lib/queries/use-google-locations.ts components/settings/account-picker-card.tsx components/settings/connections-workspace.tsx tests/components/derive-auto-selection.test.ts tests/components/account-picker-card.test.tsx
git commit -m "feat(settings): account picker + locations discovery + deriveAutoSelection rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Import card — discover locations → link, upfront relink confirm, per-item results

> **Spec §8:** import resolves re-link conflicts upfront in ONE dialog (`confirmRelink`) and reports per-item pending/results with per-action pending. `location_already_linked` / `location_routing_conflict` surface as per-item honest copy (no error codes). Discovery reuses `deriveAutoSelection` (Task 8) + `useGoogleLocations` (Task 8); already-linked locations are detected against the management directory (`fetchManagementLocations`, M5).

**Files:**
- Create: `lib/queries/use-location-import.ts`, `components/settings/import-card.tsx`
- Modify: `components/settings/connections-workspace.tsx` (insert `ImportCard`)
- Test: `tests/components/import-card.test.tsx`

**Interfaces:**
- Consumes: `linkExternalLocation`/`unlinkExternalLocation` (`@/lib/api/location-links`), `fetchGoogleLocations`/`type DiscoveredLocation` (Task 2, via `useGoogleLocations` from Task 8), `fetchManagementLocations` (`@/lib/api/locations`), `deriveAutoSelection` (Task 8), `useConnectionWorkspace`/`useGoogleAccounts`/`useGoogleLocations` (Tasks 7/8), `queryKeys` (Task 2), `ApiClientError` (`@/lib/api/client`), `describeActionError` (Task 2), `OverwriteConfirmDialog` (`@/components/locations/overwrite-confirm-dialog`), `useMutation`/`useQuery`/`useQueryClient`, `Badge`/`Button`/`Empty`/`Skeleton`/`Table…` (existing).
- Produces (Task 11 exercises): `useLocationImport()` → `{ link, unlink }`; `ImportCard`.

- [ ] **Step 1: Implement the import mutations hook**

`lib/queries/use-location-import.ts`:

```ts
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { linkExternalLocation, unlinkExternalLocation } from "@/lib/api/location-links"
import { queryKeys } from "./keys"

export function useLocationImport() {
  const client = useQueryClient()
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.locationsManagement }),
      client.invalidateQueries({ queryKey: queryKeys.locations }),
    ])
  const link = useMutation({
    mutationFn: (input: { externalLocationId: string; confirmRelink?: boolean }) => linkExternalLocation(input),
    onSuccess: invalidate,
  })
  const unlink = useMutation({
    mutationFn: (externalLocationId: string) => unlinkExternalLocation(externalLocationId),
    onSuccess: invalidate,
  })
  return { link, unlink }
}
```

- [ ] **Step 2: Write the failing test**

`tests/components/import-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ImportCard } from "@/components/settings/import-card"
import { Toaster } from "@/components/ui/toast"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
const locationsMock = vi.fn()
const importMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))
vi.mock("@/lib/queries/use-google-locations", () => ({ useGoogleLocations: () => locationsMock() }))
vi.mock("@/lib/queries/use-location-import", () => ({ useLocationImport: () => importMock() }))
vi.mock("@/lib/api/locations", () => ({ fetchManagementLocations: vi.fn(async () => ({ locations: [] })) }))

function discovered(overrides: Partial<DiscoveredLocation>): DiscoveredLocation {
  return {
    id: "e1",
    accountName: "accounts/1",
    googleLocationName: "locations/1",
    title: "Riverside Rooms",
    address: "1 River Road, Bath",
    verified: true,
    ...overrides,
  }
}

function renderCard(locations: DiscoveredLocation[], link = { mutateAsync: vi.fn(async () => ({ link: {} })), isPending: false }) {
  workspaceMock.mockReturnValue({ query: { data: { connections: [{ id: "c1", status: "active" }] } } })
  accountsMock.mockReturnValue({ query: { data: { accounts: [{ id: "a1", googleAccountName: "accounts/1", isActive: true }] } } })
  locationsMock.mockReturnValue({ data: { locations }, isPending: false, isError: false, refetch: vi.fn() })
  importMock.mockReturnValue({ link, unlink: { mutate: vi.fn(), isPending: false } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ImportCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ImportCard", () => {
  it("lists discovered locations and imports one on click", async () => {
    const mutateAsync = vi.fn(async () => ({ link: {} }))
    renderCard([discovered({})], { mutateAsync, isPending: false })
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Import Riverside Rooms" }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ externalLocationId: "e1", confirmRelink: false }))
  })

  it("shows an empty state when discovery returns nothing", () => {
    renderCard([])
    expect(screen.getByText("No locations to import")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/import-card.test.tsx --project components`
Expected: FAIL — `ImportCard` does not exist.

- [ ] **Step 4: Implement the import card**

`components/settings/import-card.tsx`:

```tsx
"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiClientError } from "@/lib/api/client"
import { fetchManagementLocations } from "@/lib/api/locations"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { queryKeys } from "@/lib/queries/keys"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useGoogleLocations } from "@/lib/queries/use-google-locations"
import { useLocationImport } from "@/lib/queries/use-location-import"
import { describeActionError } from "@/lib/settings/action-errors"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

type RowState = "idle" | "pending" | "imported" | { error: string }

export function ImportCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const connectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId
  const accounts = useGoogleAccounts(connectionId)
  const accountName = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: (accounts.query.data?.accounts ?? []).map((a) => ({ googleAccountName: a.googleAccountName, isActive: a.isActive })),
    selectedConnectionId: connectionId,
    selectedAccountName: null,
  }).accountName

  const discovery = useGoogleLocations(accountName)
  const managed = useQuery({ queryKey: queryKeys.locationsManagement, queryFn: fetchManagementLocations, staleTime: 30_000 })
  const { link } = useLocationImport()

  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [relinkTarget, setRelinkTarget] = useState<DiscoveredLocation | null>(null)

  const linkedExternalIds = new Set((managed.data?.locations ?? []).map((location) => location.externalLocationId))

  const importOne = async (location: DiscoveredLocation, confirmRelink: boolean) => {
    setRowState((prev) => ({ ...prev, [location.id]: "pending" }))
    try {
      await link.mutateAsync({ externalLocationId: location.id, confirmRelink })
      setRowState((prev) => ({ ...prev, [location.id]: "imported" }))
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "relink_confirmation_required") {
        setRowState((prev) => ({ ...prev, [location.id]: "idle" }))
        setRelinkTarget(location)
        return
      }
      setRowState((prev) => ({ ...prev, [location.id]: { error: describeActionError(error) } }))
    }
  }

  if (!accountName) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Import locations</h2>
        <Empty title="Choose a Google account" description="Activate a Google account above to discover its locations." />
      </section>
    )
  }
  if (discovery.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (discovery.isError) {
    return (
      <Empty
        title="We couldn’t discover locations"
        description={describeActionError(discovery.error)}
        action={<Button variant="outline" onClick={() => discovery.refetch()}>Try again</Button>}
      />
    )
  }
  if (discovery.data.locations.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Import locations</h2>
        <Empty title="No locations to import" description="This account has no Business Profile locations." />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Import locations</h2>
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Import</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {discovery.data.locations.map((location) => {
            const alreadyLinked = linkedExternalIds.has(location.id)
            const state = rowState[location.id] ?? "idle"
            return (
              <TableRow key={location.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {location.title}
                    {location.verified ? <Badge variant="success">Verified</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{location.address || "—"}</TableCell>
                <TableCell>
                  {alreadyLinked || state === "imported" ? (
                    <Badge variant="secondary">Linked</Badge>
                  ) : typeof state === "object" ? (
                    <span className="text-caption text-warning">{state.error}</span>
                  ) : (
                    <Badge variant="outline">Not linked</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {alreadyLinked || state === "imported" ? (
                    <span className="text-caption text-muted-foreground">Done</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state === "pending"}
                      aria-label={`Import ${location.title}`}
                      onClick={() => importOne(location, false)}
                    >
                      {state === "pending" ? "Importing…" : "Import"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <OverwriteConfirmDialog
        open={relinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRelinkTarget(null)
        }}
        title="Move this location’s history?"
        description="This Google location was linked before. Confirming re-links it here and moves its historical reviews to this location."
        confirmLabel="Confirm and import"
        requireAcknowledgement
        acknowledgementLabel="I understand historical reviews will move to this location."
        pending={link.isPending}
        onConfirm={() => {
          if (relinkTarget) {
            const target = relinkTarget
            setRelinkTarget(null)
            void importOne(target, true)
          }
        }}
      />
    </section>
  )
}
```

- [ ] **Step 5: Insert the card into the workspace**

In `components/settings/connections-workspace.tsx`, import `ImportCard` and render it after `AccountPickerCard` when `hasConnection`:

```tsx
      {hasConnection ? <AccountPickerCard /> : null}
      {hasConnection ? <ImportCard /> : null}
```

- [ ] **Step 6: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/import-card.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green.

- [ ] **Step 7: Commit**

```bash
git add lib/queries/use-location-import.ts components/settings/import-card.tsx components/settings/connections-workspace.tsx tests/components/import-card.test.tsx
git commit -m "feat(settings): import card — discover, link, upfront relink confirm, per-item results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Backfill card (honest stepper) + notifications card

> **Spec §8:** the backfill stepper shows the real per-location statuses (no fake progress) and polls lightly ONLY while anything is `running`/`pending`; `sync_paused` (503) renders an honest paused state, never the env-flag name. Notifications edits the pub/sub topic + types; an empty topic disables notifications.

**Files:**
- Create: `lib/queries/use-backfill.ts`, `lib/queries/use-notification-setting.ts`, `components/settings/backfill-card.tsx`, `components/settings/notifications-card.tsx`
- Modify: `components/settings/connections-workspace.tsx` (insert `BackfillCard` + `NotificationsCard`)
- Test: `tests/components/backfill-card.test.tsx`, `tests/components/notifications-card.test.tsx`

**Interfaces:**
- Consumes: `fetchBackfillProgress`/`startBackfill`/`cancelBackfill`/`type BackfillItem` (Task 2), `fetchNotificationSetting`/`saveNotificationSetting`/`type NotificationSetting` (Task 2), `GOOGLE_NOTIFICATION_TYPES` (`@/lib/domain/google-contract`), `deriveAutoSelection` (Task 8), `useConnectionWorkspace`/`useGoogleAccounts` (Tasks 7/8), `describeNotificationType` (Task 2), `describeActionError`/`isPausedError` (Task 2), `queryKeys` (Task 2), `useQuery`/`useMutation`/`useQueryClient`, `useToastManager`, `Alert…`/`Badge`/`Checkbox`/`Button`/`Empty`/`Field…`/`Input`/`Skeleton`/`Table…` (existing).
- Produces: `useBackfill()` → `{ query, start, cancel }`; `useNotificationSetting(accountId: string | null)` → `{ query, save }`; `BackfillCard`, `NotificationsCard`.

- [ ] **Step 1: Implement the hooks**

`lib/queries/use-backfill.ts` (polls only while work is in flight):

```ts
"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cancelBackfill, fetchBackfillProgress, startBackfill, type BackfillProgress } from "@/lib/api/backfill"
import { queryKeys } from "./keys"

function anyRunning(progress: { progress: BackfillProgress } | undefined): boolean {
  return (progress?.progress.items ?? []).some(
    (item) => item.status === "running" || item.status === "pending"
  )
}

export function useBackfill() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.backfill,
    queryFn: () => fetchBackfillProgress(),
    refetchInterval: (q) => (anyRunning(q.state.data) ? 3_000 : false),
  })
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.backfill })
  const start = useMutation({
    mutationFn: (input: { externalLocationIds?: string[]; maxPagesPerLocation: number }) => startBackfill(input),
    onSuccess: invalidate,
  })
  const cancel = useMutation({
    mutationFn: (externalLocationIds: string[]) => cancelBackfill(externalLocationIds),
    onSuccess: invalidate,
  })
  return { query, start, cancel }
}
```

`lib/queries/use-notification-setting.ts`:

```ts
"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNotificationSetting, saveNotificationSetting } from "@/lib/api/notifications"
import { queryKeys } from "./keys"

export function useNotificationSetting(accountId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.notificationSetting(accountId),
    queryFn: () => fetchNotificationSetting(accountId as string),
    enabled: accountId !== null,
    staleTime: 30_000,
  })
  const save = useMutation({
    mutationFn: (input: { accountId: string; pubsubTopic: string; notificationTypes: string[] }) =>
      saveNotificationSetting(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notificationSetting(accountId) }),
  })
  return { query, save }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/components/backfill-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackfillCard } from "@/components/settings/backfill-card"
import { Toaster } from "@/components/ui/toast"
import type { BackfillItem } from "@/lib/api/backfill"

const backfillMock = vi.fn()
vi.mock("@/lib/queries/use-backfill", () => ({ useBackfill: () => backfillMock() }))

function item(overrides: Partial<BackfillItem>): BackfillItem {
  return {
    externalLocationId: "e1",
    locationName: "Riverside Rooms",
    status: "running",
    attemptCount: 1,
    hasMorePages: true,
    lastErrorCode: null,
    startedAt: "2026-08-02T00:00:00.000Z",
    finishedAt: null,
    nextAttemptAt: null,
    ...overrides,
  }
}

function renderCard(items: BackfillItem[], start = vi.fn()) {
  backfillMock.mockReturnValue({
    query: { data: { progress: { items, counts: {}, total: items.length } }, isPending: false, isError: false, refetch: vi.fn() },
    start: { mutate: start, isPending: false, error: null },
    cancel: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BackfillCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("BackfillCard", () => {
  it("shows the honest per-location status and a cancel action while running", () => {
    renderCard([item({})])
    expect(screen.getByText("Riverside Rooms")).toBeInTheDocument()
    expect(screen.getByText("Syncing…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel sync for Riverside Rooms" })).toBeInTheDocument()
  })

  it("starts a backfill on click", () => {
    const start = vi.fn()
    renderCard([item({ status: "not_started" })], start)
    fireEvent.click(screen.getByRole("button", { name: "Start sync" }))
    expect(start).toHaveBeenCalledWith({ maxPagesPerLocation: 10 })
  })
})
```

`tests/components/notifications-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationsCard } from "@/components/settings/notifications-card"
import { Toaster } from "@/components/ui/toast"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
const settingMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))
vi.mock("@/lib/queries/use-notification-setting", () => ({ useNotificationSetting: () => settingMock() }))

function renderCard() {
  workspaceMock.mockReturnValue({ query: { data: { connections: [{ id: "c1", status: "active" }] } } })
  accountsMock.mockReturnValue({ query: { data: { accounts: [{ id: "a1", googleAccountName: "accounts/1", isActive: true }] } } })
  settingMock.mockReturnValue({
    query: { data: { setting: { name: "accounts/1/notificationSetting", pubsubTopic: "projects/p/topics/reviews", notificationTypes: ["NEW_REVIEW"] } }, isPending: false, isError: false, refetch: vi.fn() },
    save: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <NotificationsCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("NotificationsCard", () => {
  it("shows the pub/sub topic and humanised notification types", () => {
    renderCard()
    expect(screen.getByRole("textbox", { name: "Pub/Sub topic" })).toHaveValue("projects/p/topics/reviews")
    expect(screen.getByRole("checkbox", { name: "New reviews" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save notifications" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/backfill-card.test.tsx tests/components/notifications-card.test.tsx --project components`
Expected: FAIL — the components do not exist.

- [ ] **Step 4: Implement the backfill card**

`components/settings/backfill-card.tsx`:

```tsx
"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useBackfill } from "@/lib/queries/use-backfill"
import { describeActionError, isPausedError } from "@/lib/settings/action-errors"
import type { BackfillItem } from "@/lib/api/backfill"

const STATUS: Record<string, { label: string; variant: "secondary" | "info" | "success" | "warning" | "outline" }> = {
  not_started: { label: "Not started", variant: "outline" },
  pending: { label: "Queued", variant: "info" },
  running: { label: "Syncing…", variant: "info" },
  succeeded: { label: "Synced", variant: "success" },
  failed: { label: "Failed", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

function statusBadge(status: string) {
  const entry = STATUS[status] ?? { label: status, variant: "secondary" as const }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export function BackfillCard() {
  const { query, start, cancel } = useBackfill()

  if (query.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load sync progress"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const items = query.data.progress.items
  const paused = isPausedError(start.error)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Backfill reviews</h2>
      {paused ? (
        <Alert variant="warning">
          <AlertTitle>Review sync is paused</AlertTitle>
          <AlertDescription>Sync is temporarily paused. Try again shortly.</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button disabled={start.isPending} onClick={() => start.mutate({ maxPagesPerLocation: 10 })}>
          {start.isPending ? "Starting…" : "Start sync"}
        </Button>
      </div>
      {items.length === 0 ? (
        <Empty title="No sync activity yet" description="Import a location, then start a sync to pull its review history." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: BackfillItem) => {
              const inFlight = item.status === "running" || item.status === "pending"
              return (
                <TableRow key={item.externalLocationId}>
                  <TableCell className="font-medium">{item.locationName ?? "Location"}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {statusBadge(item.status)}
                      {item.hasMorePages ? <span className="text-caption text-muted-foreground">More to sync</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.attemptCount}</TableCell>
                  <TableCell>
                    {inFlight ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancel.isPending}
                        aria-label={`Cancel sync for ${item.locationName ?? "location"}`}
                        onClick={() => cancel.mutate([item.externalLocationId])}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <span className="text-caption text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Implement the notifications card**

`components/settings/notifications-card.tsx` (derives the active account’s id from the shared accounts cache; the pub/sub topic mirrors the server regex, empty = disabled):

```tsx
"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useNotificationSetting } from "@/lib/queries/use-notification-setting"
import { describeActionError } from "@/lib/settings/action-errors"
import { describeNotificationType } from "@/lib/settings/gating"

const PUBSUB_TOPIC_RE = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/

export function NotificationsCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const connectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId
  const accountsQuery = useGoogleAccounts(connectionId)
  const accounts = accountsQuery.query.data?.accounts ?? []
  const accountName = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: accounts.map((a) => ({ googleAccountName: a.googleAccountName, isActive: a.isActive })),
    selectedConnectionId: connectionId,
    selectedAccountName: null,
  }).accountName
  const accountId = accounts.find((account) => account.googleAccountName === accountName)?.id ?? null

  const setting = useNotificationSetting(accountId)
  const toast = useToastManager()
  const [topic, setTopic] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<string> | null>(null)
  const [topicError, setTopicError] = useState<string | null>(null)

  if (!accountId) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Google notifications</h2>
        <Empty title="Choose a Google account" description="Activate a Google account above to manage its notifications." />
      </section>
    )
  }
  if (setting.query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (setting.query.isError) {
    return (
      <Empty
        title="We couldn’t load notifications"
        description={describeActionError(setting.query.error)}
        action={<Button variant="outline" onClick={() => setting.query.refetch()}>Try again</Button>}
      />
    )
  }

  const server = setting.query.data.setting
  const currentTopic = topic ?? server.pubsubTopic ?? ""
  const currentTypes = types ?? new Set(server.notificationTypes ?? [])

  const toggle = (type: string) => {
    const next = new Set(currentTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setTypes(next)
  }

  const onSave = () => {
    const trimmed = currentTopic.trim()
    if (trimmed !== "" && !PUBSUB_TOPIC_RE.test(trimmed)) {
      setTopicError("Enter a topic like projects/my-project/topics/reviews, or clear it to turn notifications off.")
      return
    }
    setTopicError(null)
    setting.save.mutate(
      { accountId, pubsubTopic: trimmed, notificationTypes: [...currentTypes] },
      {
        onSuccess: () => {
          setTopic(null)
          setTypes(null)
          toast.add({ title: trimmed === "" ? "Notifications turned off" : "Notifications saved", type: "success" })
        },
        onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
      }
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google notifications</h2>
      <Field error={topicError ?? undefined} className="max-w-xl">
        <FieldLabel>Pub/Sub topic</FieldLabel>
        <Input
          value={currentTopic}
          aria-label="Pub/Sub topic"
          placeholder="projects/my-project/topics/reviews"
          onChange={(event) => setTopic(event.target.value)}
        />
        <FieldError>{topicError}</FieldError>
        <p className="text-caption text-muted-foreground">Clear the topic to turn Google notifications off.</p>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ui font-medium">Notify me about</legend>
        {GOOGLE_NOTIFICATION_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2 text-ui">
            <Checkbox
              checked={currentTypes.has(type)}
              disabled={currentTopic.trim() === ""}
              aria-label={describeNotificationType(type)}
              onCheckedChange={() => toggle(type)}
            />
            <span>{describeNotificationType(type)}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button disabled={setting.save.isPending} onClick={onSave}>
          {setting.save.isPending ? "Saving…" : "Save notifications"}
        </Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Insert both cards into the workspace**

In `components/settings/connections-workspace.tsx`, import `BackfillCard` + `NotificationsCard` and render them after `ImportCard` when `hasConnection`:

```tsx
      {hasConnection ? <ImportCard /> : null}
      {hasConnection ? <BackfillCard /> : null}
      {hasConnection ? <NotificationsCard /> : null}
```

- [ ] **Step 7: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/backfill-card.test.tsx tests/components/notifications-card.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green.

- [ ] **Step 8: Commit**

```bash
git add lib/queries/use-backfill.ts lib/queries/use-notification-setting.ts components/settings/backfill-card.tsx components/settings/notifications-card.tsx components/settings/connections-workspace.tsx tests/components/backfill-card.test.tsx tests/components/notifications-card.test.tsx
git commit -m "feat(settings): backfill honest stepper + Google notifications card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Milestone e2e adaptation + gate

**Files:**
- Modify: `tests/e2e/helpers/stub-bridge.ts` (add a Google `notificationSetting` GET matcher so `/settings/connections` loads clean; reuse the existing `/accounts` + `/{account}/locations` matchers seeded in M5), `playwright.config.ts` (un-ignore `settings.spec.ts`)
- Rewrite: `tests/e2e/settings.spec.ts`
- Create: `tests/e2e/connections-oauth.spec.ts`, `tests/components/use-connection-workspace.test.tsx`
- Gate: full unit + component + integration + e2e suite green, clean production build, whole-branch review.

**Interfaces:** consumes `readJourneyState` (the M5-extended `JourneyState`: `cookie`/`adminCookie`/`memberAssignedCookie`/`memberUnassignedCookie`/`viewerCookie`/`organisationId`), the four settings sub-routes (Tasks 3–10), the sanctioned routes (Task 1), and the `/connections` redirect (Task 3).

Selectors/copy the specs drive (invariants from Tasks 3–10): `h1` "Reply policy" / "Team access" / "Data and compliance" / "Google Business Profile"; `role="navigation"` name "Settings sections"; the buttons "Save changes" (Policy), "Send invitation" (Team), "Log request" / "Download export" (Compliance), "Connect Google Business Profile" / "Connect another account" (Connections), "Disconnect …" (dialog trigger), "Try again" (OAuth error); the gate copy "Only owners and admins can change these settings."

- [ ] **Step 1: Add a dedicated connection-workspace unit test (spec §9)**

`tests/components/use-connection-workspace.test.tsx` (asserts the connect handoff calls `window.location.assign` with the authorization URL — the credential-safe redirect contract):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import * as connectionsApi from "@/lib/api/connections"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  // useConnectionWorkspace calls useToastManager (mutation onError), which requires a
  // Toast provider — wrap in <Toaster> or the real hook throws under renderHook.
  return (
    <QueryClientProvider client={client}>
      <Toaster>{children}</Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe("useConnectionWorkspace", () => {
  it("hands off to Google via window.location.assign on connect", async () => {
    vi.spyOn(connectionsApi, "fetchConnections").mockResolvedValue({ connections: [] })
    vi.spyOn(connectionsApi, "startGoogleConnect").mockResolvedValue({ authorizationUrl: "https://accounts.google.test/o/oauth2/v2/auth?x=1" })
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const { result } = renderHook(() => useConnectionWorkspace(), { wrapper })
    await act(async () => {
      result.current.connect.mutate()
    })
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.test/o/oauth2/v2/auth?x=1"))
    vi.unstubAllGlobals()
  })
})
```

> **Executor note:** if `vi.stubGlobal("location", …)` is awkward under jsdom, spy on `window.location.assign` via `Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true })` inside the test; the assertion (assign called with the authorization URL) is the invariant.

- [ ] **Step 2: Extend the stub bridge with the notifications matcher**

`tests/e2e/helpers/stub-bridge.ts`. After the existing `/accounts` and `/{account}/locations` matchers (registered in M5), add a `notificationSetting` GET matcher so the Connections page’s notifications card loads clean (the M5 bridge already seeds a Google connection + accounts + a linked location):

```ts
    stub.respond({ method: "GET", pathIncludes: "notificationSetting" }, () => ({
      status: 200,
      json: {
        name: "accounts/stub/notificationSetting",
        pubsubTopic: "",
        notificationTypes: [],
      },
    }))
```

> **Executor note:** these GET response shapes are best-effort against the Google client parsers in `lib/server/google.ts`. If a Connections card logs a console error on load, inspect `stub.calls` and the failing parse, and adjust the matcher JSON field names to what the client expects — do NOT weaken the console-error guard. Confirm the M5 `/accounts` matcher returns at least one account so the picker/notifications cards derive an `accountId`; if not, add one (`{ accounts: [{ name: "accounts/stub", accountName: "Stub group", type: "LOCATION_GROUP", role: "OWNER" }] }` shape per the accounts parser). If the accounts/locations reads prove too heavy to stub deterministically, gate the strict zero-console-error assertion for the Connections route behind a documented follow-up and keep it for Policy/Team/Compliance (which hit only our own DB-backed APIs).

- [ ] **Step 3: Rewrite `tests/e2e/settings.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
const AREAS = [
  { path: "/settings", heading: "Reply policy" },
  { path: "/settings/team", heading: "Team access" },
  { path: "/settings/compliance", heading: "Data and compliance" },
  { path: "/settings/connections", heading: "Google Business Profile" },
] as const

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("settings", () => {
  test("each area is a sibling route with its own level-1 heading and a shared sub-nav", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    for (const area of AREAS) {
      await page.goto(area.path)
      await expect(page).toHaveURL(new RegExp(`${area.path.replace("/", "\\/")}$`))
      await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible()
    }
  })

  test("/connections redirects under settings and forwards the query string", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/connections?google=connected")
    await expect(page).toHaveURL(/\/settings\/connections\?google=connected$/)
  })

  for (const theme of ["light", "dark"] as const) {
    for (const area of AREAS) {
      test(`${area.heading} loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(area.path)
        await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
        await page.waitForLoadState("networkidle")
        expect(consoleErrors, `${theme} ${area.heading} console`).toEqual([])
        expect(pageErrors, `${theme} ${area.heading} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${theme} ${area.heading} wcag`).toEqual([])
        const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
        expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} ${area.heading} structure`).toEqual([])
      })
    }
  }

  test("permission walk: a member sees only Policy; privileged routes redirect", async ({ baseURL, browser }) => {
    const state = await readJourneyState()
    for (const cookie of [state.memberUnassignedCookie, state.viewerCookie]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await applyCookie(page, baseURL, cookie)
      await page.goto("/settings")
      const nav = page.getByRole("navigation", { name: "Settings sections" })
      await expect(nav.getByRole("link", { name: "Policy" })).toBeVisible()
      for (const gone of ["Team", "Compliance", "Connections"]) {
        await expect(nav.getByRole("link", { name: gone })).toHaveCount(0)
      }
      // The read-only Policy form shows the gate reason, not an editable control.
      await expect(page.getByText("Only owners and admins can change these settings.")).toBeVisible()
      // A direct visit to a privileged route redirects to Policy.
      await page.goto("/settings/team")
      await expect(page).toHaveURL(/\/settings$/)
      await context.close()
    }
  })

  test("an admin sees Compliance and its list/create, but not the owner-only controls", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.adminCookie)
    await page.goto("/settings")
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    await expect(nav.getByRole("link", { name: "Team" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Compliance" })).toBeVisible()
    // The page renders for admins (no redirect) with the privacy-request create form…
    await page.goto("/settings/compliance")
    await expect(page).toHaveURL(/\/settings\/compliance$/)
    await expect(page.getByRole("heading", { name: "Data and compliance", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Log request" })).toBeVisible()
    // …but the owner-only export card and legal-holds card are absent.
    await expect(page.getByRole("button", { name: "Download export" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Legal holds" })).toHaveCount(0)
  })
})
```

- [ ] **Step 4: Create `tests/e2e/connections-oauth.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("connections OAuth return", () => {
  test("a successful return toasts and clears the query", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections?google=connected")
    await expect(page.getByText("Google Business Profile connected")).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/connections$/)
  })

  test("a failed return shows a mapped error and a Try again action without leaking the code", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections?google=error&status=502")
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(page.getByText(/status=502/)).toHaveCount(0)
  })

  test("axe passes with the disconnect confirmation dialog open", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/settings/connections")
    const disconnect = page.getByRole("button", { name: /^Disconnect/ })
    await expect(disconnect.first()).toBeVisible()
    await disconnect.first().click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    const wcag = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze()
    expect(wcag.violations).toEqual([])
  })
})
```

> **Executor note:** the disconnect-dialog test depends on the M5 journey seeding a Google connection (it does — `seedGoogleConnection`), so a connection row renders with a `Disconnect …` button. If the Connections page can’t load clean under the Google stubs (accounts/notifications), fix the stub JSON (Step 2) rather than deleting the assertion. If `getByRole("alertdialog")` doesn’t match the base-ui `AlertDialog`, target the dialog by its title text "Disconnect this Google account?".

- [ ] **Step 5: Un-ignore the settings spec in `playwright.config.ts`**

In `playwright.config.ts` `testIgnore`, delete the `"**/settings.spec.ts"` line (revive it). `connections-oauth.spec.ts` is new and not ignored, so it runs automatically. Confirm `SYNC_ENABLED` is enabled/default-true and the M5-added `GBP_*_ENABLED: "true"` entries remain in `webServer.env` (no new env needed for M6).

- [ ] **Step 6: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: unit + components green; production build green; e2e runs `foundation.spec.ts` + `home.spec.ts` + `inbox.spec.ts` + `journeys.spec.ts` + `locations.spec.ts` + the revived `settings.spec.ts` + the new `connections-oauth.spec.ts` (four sub-routes clean in both themes, the redirect, the permission walk, the OAuth outcomes, the dialog axe pass), all green; integration green including the new `settings-capabilities.test.ts` + `invitation-revoke.test.ts` (`RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`) and no pre-existing integration test moved. Fix any failure in the product/spec, never by weakening an assertion. Paste every summary line into the report.

- [ ] **Step 7: Whole-branch review (two passes) + one fix wave**

Per spec §10, request a whole-branch review before merge:
1. A general review of the entire M6 diff.
2. A dedicated **capability / permission-gating** pass focused on Task 1 (the sanctioned protected-path edits) — confirm `settingsCapabilities` mirrors the route guards for every role, that `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` lists exactly the three sanctioned files (`lib/server/capabilities.ts`, `app/api/settings/capabilities/route.ts`, `app/api/invitations/[token]/route.ts`), that the `[token]` route's existing `GET` is byte-identical (only imports + a `DELETE` handler added), that the client mirror `settingsGatingFromRole` equals the server predicates (the parity test), and that a member/viewer can never reach an enabled privileged control (spec §9 "no reachable 403 from primary controls") — including the direct-publish owner-consent gate and the compliance owner-vs-admin gating split.

Apply one fix wave for the findings, re-run the gate, then commit.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/settings.spec.ts tests/e2e/connections-oauth.spec.ts tests/e2e/helpers/stub-bridge.ts tests/components/use-connection-workspace.test.tsx playwright.config.ts
git commit -m "test(settings): revive settings e2e across four areas; OAuth-return + permission specs; milestone gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 6 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- E2e green: `foundation.spec.ts`, `home.spec.ts`, `inbox.spec.ts`, `journeys.spec.ts`, `locations.spec.ts`, and the revived `settings.spec.ts` + the new `connections-oauth.spec.ts` — including the zero-console-error + zero-pageerror guard and the best-practice structural axe rules on **every** settings sub-route (Policy / Team / Compliance / Connections) in both light and dark, the `/connections → /settings/connections` query-forwarding redirect, the per-role permission walk (owner / admin / member / viewer with no reachable 403 from a primary control), the OAuth success + error outcomes, and the disconnect-dialog axe pass.
- Integration suite green (the parity oracle), including the new `settings-capabilities.test.ts` (all four roles) and `invitation-revoke.test.ts` (revoke happy path + 404 + owner/admin/member/viewer gating), `RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`. No pre-existing integration test moved.
- **Protected-path discipline:** the ONLY changes under `app/api/**`/`lib/server/**`/`lib/domain/**`/`supabase/**`/`scripts/**`/`instrumentation.ts` are Task 1's three sanctioned files (`lib/server/capabilities.ts` additive; `app/api/settings/capabilities/route.ts` new; `app/api/invitations/[token]/route.ts` modified — a `DELETE` handler added, its `GET` byte-identical). `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` lists exactly those three. Everything else under the protected paths is byte-identical.
- Every M6-scoped spec obligation closed (spec §8 Connections + Settings):
  - **Connections:** decomposed cards (connection, account picker, import, backfill, notifications, management) over three hooks (`useConnectionWorkspace`, `useGoogleAccounts`, `useLocationImport`) + one pure `deriveAutoSelection`; OAuth return rendered (success toast; mapped error + "Try again"); reconnect alert pinned when a token is revoked; import resolves re-link conflicts upfront in one dialog and reports per-item results with per-action pending; honest stepper (real query signal); backfill polls only while anything is running; the freshness chip reuses `useConnectionHealth`; OAuth never renders/collects Google credentials (`window.location.assign`).
  - **Settings — Team:** remove member, revoke invitation (via the new endpoint), role-select gating (no "Owner" option for admins; last-owner demotion/removal blocked with a `GateNote` hint), "you" badge, expired-invite badges, self-removal disabled, viewer `canPublish` normalised, `inviteUrl` a copy-once secret never logged.
  - **Settings — Policy:** one save path; timezone constrained to `Intl.supportedValuesOf('timeZone')`; the owner + explicit-consent direct-publish gate mirrored so no reachable 403.
  - **Settings — Compliance (owner/admin split, D5):** owner + admin view and create privacy requests; owners additionally fulfil/reject/status, run the subject export, and manage the legal-holds card (all owner-gated); the page redirects a member/viewer; exports via fetch-and-download with error handling; no error codes shown.
- No new dependency added. All primitives came from the already-installed set (M1–M5); no new `@base-ui/react` primitive was admitted this milestone (`Table`/`Checkbox`/`Select`/`Combobox`/`Dialog`/`AlertDialog` all pre-exist).
- Whole-branch review complete with a dedicated capability/permission-gating pass; its findings fixed in one wave.
- Carry-forwards recorded for later milestones (see Self-review below).

## Self-review (run before merge; fix inline)

- **Spec coverage.** §3 additions → Task 1 (`settingsCapabilities` + the settings-capabilities route + the invitation-revoke route — the two audit-mandated backend additions for M6). §4 redirect → Task 3 (`/connections → /settings/connections`, query-forwarding). §5 rendering model — client-fetched pages with route-level `loading.tsx`; server-prefetch deviation documented (D3) and carried forward, noting `listConnections` + the settings SQL exist for a later retrofit. §6 data layer — one QueryClient; settings/members/invitations/privacy/legal-holds/connections/accounts/locations/notifications/backfill keys; typed client via `apiFetch`/`ApiClientError`; client-safe zod mirrors in `lib/settings/forms/` (parity-tested); `useDirtyGuard` on the Policy form; server field errors mapped to fields by path (Policy). §7 content — humanised enums (roles, request types/statuses, notification types, connection/backfill statuses); one `describeActionError` mapping layer; no env-flag names / byte counts / error codes shown. §8 Connections + Settings paragraphs — every clause mapped to a task (see exit criteria). §9 testing — loading/error/empty/mutation-failure component tests per card/form; the capability matrix + invitation-revoke as executable integration tests (Task 1); the connection-workspace hook + `deriveAutoSelection` + dirty-guard behaviour unit-tested; e2e per-role walk, per-route clean-load in both themes, OAuth outcomes, redirect, dialog axe (Task 11); parity oracle stays green (Task 1). No M6-scoped requirement is left without a task.
- **Placeholder scan.** No "TBD"/"similar to Task N"/"add validation"/bare "write tests". Every code step carries real code; each non-trivial component (policy form, members table, invitations panel, privacy/legal-holds/export cards, connection/account/import/backfill/notifications cards, the OAuth return + reconnect alert, the sub-nav) ships a numbered contract + a complete pinned test + a reference implementation. Shared blocks are imported by name (`GateNote`, `OverwriteConfirmDialog`, `describeActionError`, `deriveAutoSelection`, `useConnectionWorkspace`) — not re-implemented. The two executor-note markers (`void setSelectedConnectionId` for the multi-connection selector; the connect-handoff test shim) are called out explicitly with the intended resolution, not left silent.
- **Type consistency.** `SettingsCapabilities { canManageTeam, canManageConnections, canEditSettings, canViewCompliance, canManageCompliance }` is identical across `lib/server/capabilities.ts` (Task 1), `lib/api/settings-capabilities.ts` (`settingsCapabilitiesSchema` + `fetchSettingsCapabilities`, Task 2), `lib/settings/gating.ts` (`settingsGatingFromRole`, Task 2), and every `useSettingsCapabilities` consumer — the client mirror `settingsGatingFromRole` and the server `settingsCapabilities` both compute all five fields and the parity test pins them equal. `OrgSettings`/`SettingsPatchInput`, `Member`/`MemberRole`, `Invitation`, `PrivacyRequest`, `LegalHold`, `GoogleAccount`, `DiscoveredLocation`, `NotificationSetting`, `BackfillProgress`/`BackfillItem`/`BackfillStatus`, `ConnectionSummary` (Task 2) are the exact names Tasks 3–10 import. `useSettings`/`useSettingsCapabilities`/`useMembers`/`useInvitations`/`usePrivacyRequests`/`useLegalHolds`/`useConnectionWorkspace`/`useGoogleAccounts`/`useGoogleLocations`/`useLocationImport`/`useBackfill`/`useNotificationSetting` names match producer and consumer. `queryKeys.{settingsCapabilities, members, invitations, privacyRequests, legalHolds, googleAccounts(id), googleLocations(name), notificationSetting(id), backfill}` + the existing `settings`/`connections`/`locationsManagement`/`locations` are identical between hook and invalidation call. `deriveAutoSelection`'s `AutoSelectionInput`/`AutoSelection` shape is identical across the account-picker, import, and notifications cards. `MEMBER_ROLES`/`roleLabel`/`roleOptionsFor`/`memberRowGate` are imported by exactly those names. The four page `<h1>` strings (`Reply policy` / `Team access` / `Data and compliance` / `Google Business Profile`) match the `settings.spec.ts` assertions exactly. The OAuth query contract (`?google=connected` / `?google=error&status=<httpStatus>`) matches the backend callback and the `OAuthReturn` reader.
- **Parity-oracle safety.** Task 1 adds a new pure function to `lib/server/capabilities.ts`, one new route file (`settings/capabilities`), and a new `DELETE` handler on the existing `app/api/invitations/[token]/route.ts` (its public invite-lookup `GET` stays byte-identical); no existing route/service/query behaviour changes, so `reviewCapabilities`/`locationCapabilities`/`settingsSchema` and every existing integration test (including the `[token]` GET lookup) stay green. The revoke `DELETE` does a scoped `delete … where accepted_at is null` and shares no state with the invitations GET/POST. No pre-existing integration test is moved; the two new integration tests are additive under `tests/`.
- **Protected-path footprint.** `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` must list exactly `lib/server/capabilities.ts`, `app/api/settings/capabilities/route.ts`, and `app/api/invitations/[token]/route.ts`. All client-safe schemas, clients, hooks, components, and pages live under `lib/api`, `lib/settings`, `lib/connections`, `lib/queries`, `components/**`, `app/(dashboard)/settings/**`, `app/connections/**`, and `tests/**` — none protected. Confirm no accidental edit to any consumed route or service, and that the `[token]` route's existing `GET` is unchanged.
- **Decisions made BEYOND the surface map / spec (flagged for controller review):**
  - (a) **Capabilities mechanism** — a dedicated `GET /api/settings/capabilities` route + one `useSettingsCapabilities` hook, plus a pure client mirror `settingsGatingFromRole` (parity-tested) used for the no-flash sub-nav — rather than embedding caps into each settings route. Minimal protected footprint (one additive function + one route).
  - (b) **Compliance owner/admin split (D5)** — two capabilities: `canViewCompliance = role∈{owner,admin}` and `canManageCompliance = role==="owner"`. Owner + admin reach the Compliance page and the privacy-request list + create (the backend allows admins `GET`/`POST /api/privacy/requests` and `GET /api/legal-holds`); the owner-only controls — privacy fulfil/reject/status, the export card, and the whole legal-holds card — gate on `canManageCompliance`. This surfaces admins' backend-permitted reads/creates while keeping "no reachable 403 from a primary control", and matches spec §8's "legal-holds card owner-gated" (only the holds card, not the whole surface).
  - (c) **Client-safe form schemas in `lib/settings/forms/` (non-protected), mirrored from the route schemas with parity tests** — because `lib/domain` is a protected consume-only path; the mirror + parity test achieves spec §6's "validate identically" (same pattern as M4/M5).
  - (d) **Forms are hand-rolled `useState` + zod `safeParse`, not `react-hook-form`** — not installed; matches M4/M5.
  - (e) **Per-connection account/notification derivation** shares the single `deriveAutoSelection` rule across three cards, reading the shared Query cache rather than lifting selection into a context — simplest state model; the multi-connection connection selector is stubbed with a documented marker in `AccountPickerCard`.
- **Carry-forwards recorded for later milestones:**
  - **Server-hydrated/dehydrated Settings + Connections** (spec §5 prefetch) — `listConnections` and the settings SQL exist, so a later effort retrofits RSC prefetch + dehydrate additively into the same Query keys (D3).
  - **The `/api/privacy/export?subject=…` §8 tension** — spec §8 (and the privacy rules) say "no PII in GET query strings", but the backend export exposes only a `GET ?subject=` interface with no POST alternative. M6 consumes it as-is (subject never logged; response is `private, no-store`). **Recommend a backend follow-up** to accept the subject via a POST body or a header so no PII rides in the query string. **Flag to the controller.**
  - **Per-location team assignment editing** (`PUT /api/location-members` exists: `viewer_cannot_publish`/`duplicate_location`/`location_not_found`) — not surfaced in M6; folds into the M8 Administration console (add/remove admins, ownership transfer, delete-location danger zone).
  - **The audit-log viewer** (`GET /api/audit-log`, incl. CSV export) exists but §8 scopes no viewer — deferred.
  - **The multi-connection connection selector** in the account picker — single-connection auto-resolves today; the selector is marked in `AccountPickerCard`.
  - **Account/profile/password self-service** — explicitly OUT of §8 scope with no backend; not invented (do NOT add one).
- **Discrepancies found vs the surface map (CODE wins — encoded above):**
  - `lib/server/capabilities.ts` **already** exports `locationCapabilities`/`reviewCapabilities`; M6's edit is purely additive (`SettingsCapabilities` + `settingsCapabilities`). No `[id]` folder exists under `app/api/invitations`, and App Router forbids a second slug name at that path level (`[token]` already exists for the public invite-lookup `GET`), so the revoke `DELETE` is ADDED to the existing `app/api/invitations/[token]/route.ts` rather than created as a new `[id]` route (a new `[id]` slug would throw `'id' !== 'token'` at build).
  - `GET /api/settings` returns `directPublishConsentAt` (a timestamp), while the PATCH **body** sends `directPublishConsent` (a boolean) — the Policy form reads the former for context and sends the latter per save.
  - `location_routing_conflict` (409) is thrown by `GET /api/google/locations` (discovery), **not** by `POST /api/location-links` (whose 409s are `relink_confirmation_required` / `location_already_linked`); both are mapped in `describeActionError` regardless. `DELETE /api/location-links` can also 404 `location_link_not_found` (not just `{ unlinked: true }`).
  - `POST /api/invitations` calls `assertRoleChangeAllowed`, so an admin inviting an `owner` gets `403 owner_role_required` — mirrored by `roleOptionsFor` (no "Owner" option for admins) on both the invite form and the members role select.

## Execution handoff

Plan complete and saved to `docs/archive/2026-07-frontend-rebuild/plans/2026-08-02-frontend-rebuild-m6-connections-settings.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with a two-stage review between tasks. The hard chain is 1 → 2 → 3; after Task 3, Tasks 4/5/6 (Policy/Team/Compliance) run in parallel; Task 7 (Connections shell) then unblocks Tasks 8/9/10 (account picker / import / backfill+notifications), which run substantially in parallel; Task 11 is the terminal gate. Task 1 (protected path) warrants a dedicated capability/permission-scoping reviewer.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batching with checkpoints for review.

Which approach?

