# M6 Connections + Settings — SDD ledger & carry-forward register

Preserved from the gitignored SDD progress ledger at merge time. Plan:
`docs/archive/2026-07-frontend-rebuild/plans/2026-08-02-frontend-rebuild-m6-connections-settings.md`
(commit `6d59b1d` + plan-review revisions `51e2800`). Merged to `main` as a
clean fast-forward from `cf875ee` (M5). Milestone HEAD at merge: `150616f`.

## What shipped (11 tasks, ~84 files, +9.7k)

**Settings** — three sub-areas under a shared shell (`app/(dashboard)/settings/
layout.tsx` owns the single `<main>`; each sub-page owns one `<h1>`):
- **Policy** (`/settings`, h1 "Reply policy") — the org policy form: one save
  path (PATCH /api/settings), Intl-validated timezone, and the direct-publish
  gate (turning `approvalRequired` off requires owner + a `directPublishConsent`
  tick, mirroring the server 403 `direct_publish_consent_required`).
- **Team** (`/settings/team`, h1 "Team access") — members table (server-mirrored
  gating: no Owner option for admins, last-owner demote/remove disabled,
  self-removal disabled, "you" badge, viewer `canPublish` forced false) +
  invitations (create, **revoke via the new endpoint**, copy-once `inviteUrl`,
  expired badges).
- **Compliance** (`/settings/compliance`, h1 "Data and compliance") — privacy
  requests (list + create for owner∪admin), fulfil/status + export + legal-holds
  owner-only, 409 `privacy_legal_hold` handling, fetch-and-download export.

**Connections** (`/settings/connections`, h1 "Google Business Profile") — the
six-card OAuth workspace: `useConnectionWorkspace` + connect (full-page
`window.location.assign` to Google — the app never renders/collects
credentials) / disconnect (7-day-purge confirm) / reconnect alert / OAuth-return
handler / freshness chip (reuses `useConnectionHealth`); account-picker (the
pure `deriveAutoSelection` rule + discover/activate); import (N per-location
links, upfront relink confirm, per-item results); backfill (honest stepper —
polls only while a row is `running`, real signal, no fabricated progress);
notifications. Plus the `/connections → /settings/connections` **query-forwarding
redirect** (audit C-2 — the OAuth `?google=…&status=` return survives).

**Sanctioned protected backend (T1):** additive `settingsCapabilities` in
`lib/server/capabilities.ts` (`canManageTeam`/`canManageConnections`/
`canEditSettings`/`canViewCompliance` = owner∪admin; `canManageCompliance` =
owner — pure role predicates, no SQL), a new `GET /api/settings/capabilities`,
and a new `DELETE` revoke handler **added to the existing
`app/api/invitations/[token]/route.ts`** (reusing the `[token]` slug — a second
`[id]` slug would fail the App Router build; the plan-review caught this before
any code was written).

## Gate at merge (independently re-run on `150616f`, GATE GREEN)

- typecheck clean; lint 0 errors / 2 pre-existing warnings (untouched
  `tests/components/app-shell.test.tsx`).
- Unit + component: **544 passed** / 183 skipped.
- `pnpm build` (webpack): Compiled successfully, 62 pages.
- E2e: **65 passed / 0 failed** (clean first-pass parallel run). `settings.spec.ts`
  12/12 (four sub-route headings, the `/connections` query-forward redirect, the
  per-role permission walk, both-theme clean-load with the zero-console-error /
  zero-pageerror guards + axe on every settings route). `connections-oauth.spec.ts`
  3/3 (deterministic across isolated reruns — the OAuth-error-banner defect the
  fix wave repaired).
- Integration: **183 passed / 0 failed**, incl. `settings-capabilities.test.ts`
  (4-role matrix) and `invitation-revoke.test.ts` (revoke + double-revoke 404 +
  role gating), `RUN_DB_TESTS=true` via `naba_test_runtime`.
- **Protected-path discipline:** exactly the **3 sanctioned files**
  (`lib/server/capabilities.ts` additive; `app/api/settings/capabilities/route.ts`
  new; `app/api/invitations/[token]/route.ts` +DELETE, GET byte-identical).

## Whole-branch review (three parallel agents on `150616f`)

- **General (opus): clean** — no token/structure/copy/dep violations; fix-wave
  `oauth-return` change traced correct + side-effect-free; all carry-forwards
  safe to defer.
- **Capability/tenant-security (opus): clean** — `settingsCapabilities` exact
  mirror for all four roles (computed booleans, exhaustive — the M4-T1
  missing-role gap cannot recur); the compliance split verified (member/viewer
  redirected; admin sees the privacy list but Fulfil/Reject become inert
  "Awaiting an owner" text, export + legal-holds cards unmounted for non-owners
  — no admin reaches an enabled owner-only control); revoke is RLS
  tenant-isolated (cross-org id → 404, no existence oracle); `inviteUrl`/token/
  PKCE secret handling safe; masked-connection shape rendered without assuming
  full values.
- **Independent gate (sonnet): GATE GREEN.**

Recurring lesson held again: the OAuth-error-banner defect (the return effect
wiped the error on its own settled `router.replace` re-render) was **invisible
to the component unit tests** and caught only by the stub-driven e2e. It was
fixed without weakening any guard.

---

## Carry-forward register → M9 (all triaged "defer" by the whole-branch review)

1. **privacy-export `?subject=` (§8 "no PII in GET query strings") — HIGHEST
   VALUE.** The subject reference is potential PII landing in URL/history/proxy
   logs. Mitigated today (`encodeURIComponent`, never logged, `private,
   no-store` attachment), but the proper fix needs a **backend POST export
   endpoint** — a protected path M6 could not add. Genuinely backend-blocked.
2. **Import location-specific timezone.** `use-location-import.ts` attaches the
   browser's IANA timezone (better than the server's `Europe/London` default for
   a single-region operator, but not the imported location's real zone; the
   discovery payload has no timezone field). Needs a picker or backend
   enrichment.
3. **`invitation-revoke.test.ts` completeness** — add an explicit cross-org case
   (org-B owner revoking org-A's invitation id → 404) and a non-uuid-token 400
   case. The code is correct (RLS + `z.uuid().parse`); this hardens the parity
   oracle on a security-critical route.
4. `lib/settings/forms/legal-hold.ts` `reviewId` uses a UUID-shaped regex, not
   strict `z.uuid()` (a pinned test fixture is an invalid RFC4122 variant; client
   pre-check only, server re-validates) — align the fixture + tighten.
5. `backfill-card.tsx` renders a "Failed" badge but never surfaces
   `BackfillItem.lastErrorCode` (fetched + typed, unrendered) — wire it for the
   honest-stepper intent.
6. `components/locations/overwrite-confirm-dialog.tsx` (an **M5** component)
   passes `aria-label` to a Checkbox already wrapped in a `<label>` (duplicate
   accessible name) — a11y polish.
7. `tests/e2e/helpers/stub-bridge.ts` (an **M5** harness) — the GET `/accounts`
   matcher is last-registered-wins across tenants, so the primary tenant's
   account discovery can pick up another tenant's row (no test failures caused).
8. `tests/e2e/journeys.spec.ts` intermittently times out under full 8-worker
   parallel load on this sandbox (CPU contention once M6 added ~15 e2e tests) —
   green in isolation / at reduced workers; consider pinning `workers` in
   `playwright.config.ts`.
9. Account-picker multi-connection selector deferred (`selectedConnectionId`
   hardcoded `null`; `deriveAutoSelection` degrades gracefully) — single
   connection is current reality.

## Accepted deviations (documented, non-blocking)

- **Server-hydration (§5) deferred again** — client-fetched, consistent with
  M3–M5; the `listConnections`/settings read-services exist for a later RSC
  prefetch retrofit; the other settings reads are still inline in their route
  handlers.

## Decisions beyond the plan's locked list (flagged, all accepted by review)

(a) **Compliance gating split** — `canViewCompliance` (owner∪admin, gates the
privacy-request list + create) vs `canManageCompliance` (owner, gates
fulfil/status/export + all legal-holds), rather than a blanket owner-only gate
that would under-expose admins the server authorises (the M4-T7-#2 anti-pattern).
(b) **Revoke handler on the existing `[token]` route** rather than a new `[id]`
route (App Router slug-collision — a plan-review catch). (c) **Browser-IANA
timezone** on import as an incremental improvement over the server default (real
fix deferred, #2 above). (d) The direct-publish consent gate, team role gating,
and per-tab connection gating all **derived from the real route/service guards**,
not invented.
