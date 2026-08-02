# M9 Hardening / full parity / release bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the frontend rebuild's §10 release bar — every rebuilt surface hardened, zero reproducible Critical/High findings from the 2026-07-31 audit, every quarantined e2e spec re-enabled or retired, the legacy redirects guarded by a live spec, plus the three locked owner decisions (auth-enumeration normalisation, `canRequestApproval`, a documented §5 fast-follow) — so `main` becomes the first genuinely shippable build.

**Architecture:** Unlike M2–M8 (feature surfaces with ZERO protected footprint), M9 is a targeted hardening sweep that **deliberately** touches five protected paths (the "full parity" pass), each additive/normalising and each landed with the backend integration parity oracle re-run green. The security/privacy edits come first (Tasks 1–5, the only protected-path work), then the non-protected accessibility, token and UX-polish cleanups (Tasks 6–7), then the test-bar wiring and spec revivals (Tasks 8–9), then the terminal release-bar gate (Task 10). The one thing M9 ships **without** is the §5 RSC server-hydration retrofit — deferred as a documented, tracked post-release fast-follow (D1).

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives (1.6.0), TanStack Query v5, zod 4, Vitest (unit `node` + component `jsdom` projects), Playwright + `@axe-core/playwright`.

## Global Constraints

- Next.js 16 App Router, **webpack ONLY** (never touch the `--webpack` flags in `package.json` scripts). React 19, TS strict, Tailwind v4, `@base-ui/react`, TanStack Query v5, zod 4.
- **NO NEW npm dependency.** M1 tokens ONLY.
- Exactly one `<h1>` and exactly one `<main>` per page.
- GB English; **NO error codes / env-flag names / raw enums / JSON shown to users.**
- **PROTECTED PATHS** (`app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`) are CONSUME-ONLY **EXCEPT the SANCTIONED M9 edits** listed below (SEC-1 route; auth login/password routes for D3; `next.config.ts`; privacy/export POST; `capabilities.ts` `canRequestApproval`). Everything else under protected paths stays **byte-identical**.
- The backend integration **parity oracle must stay green** (the sanctioned edits are additive/normalising — verify no existing test breaks).
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The MANDATORY e2e **zero-console-error / zero-pageerror + axe (incl. heading-order) guard on every route in BOTH themes** stays — **never weaken it.**
- Package manager `pnpm`. After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages, config, or headers.
- Branch: `frontend-rebuild-m9-hardening` (cut from `main` @ `c2c87a7`, M8 HEAD). Delivery model is per-milestone merge to `main` (spec §10) — this is the FINAL milestone; after it, `main` is the release bar.

## Design decisions (LOCKED — encode exactly)

- **D1 — §5 SERVER-HYDRATION is DEFERRED as a documented post-release fast-follow.** M9 does **NOT** do the RSC-prefetch/dehydrate retrofit. It is recorded in the exit criteria and the carry-forward as an explicit tracked item: extract ~10 inline-SQL read-services from the analytics / counts / members / invitations / privacy / legal-holds routes and wire ~18 pages; `connections` / `inbox-list` / `location-tabs` services already exist. The whole retrofit is guarded by the integration oracle, which is **subset-matching** (RSC first paint calls the same services the routes call), so a later effort seeds the same Query keys additively without reshaping the client. This is the ONE thing M9 intentionally ships without. **No §5 edits in any M9 task.**
- **D2 — `canRequestApproval`: ADD IT.** In approval-required orgs a non-publisher can create/submit a reply for approval — the **server accepts it and routes it to `awaiting_approval`** (verified in `lib/server/publishing.ts:687-696`: the publish path branches to `awaiting_approval` when `(!canPublish && record.approval_required) || (record.require_two_person_approval && !record.has_qualifying_approval)`) — but the inbox UI gates its only submit control (`ActionBar` Publish) on `canPublish`, so a non-publisher sees a disabled button and no route to approval. Add an **additive `canRequestApproval`** to `ReviewCapabilities` and a **"Submit for approval"** affordance in the inbox action bar. Predicate, derived from the real server behaviour: **`canRequestApproval = canEdit && !canPublish && orgApprovalRequired`** where `orgApprovalRequired` is the org's `approval_required` flag (the exact column the publish path reads). The affordance **reuses the existing publish mutation** (the server already routes a non-publisher's publish to approval) — **no new endpoint**.
- **D3 — AUTH ENUMERATION: NORMALISE.** Collapse the sign-in enumeration channels — the distinguishable `email_not_verified` error (403, `lib/server/password-auth.ts` both `mapLoginFailure` and the direct `signInWithPassword` throw) **and** the login `auth_rate_limited` timing signal (429) — into the same generic `invalid_credentials` (401) response the login path already returns for a wrong password, so the flow never confirms whether an email is registered. Touches the anchor auth path (protected). Keep the real auth behaviour; normalise only the **user-facing code/status/message**. **Scope: the LOGIN path only** — `signInWithPassword` + `mapLoginFailure`. `signUpWithPassword` / `requestPasswordReset` / `resendConfirmationEmail` keep their own documented 429 handling (out of scope; those buckets carry their own recorded enumeration rationale). Full unit + component coverage; the distinguishable error no longer leaks.

### Sanctioned protected-path edits (M9 is EXPECTED to touch exactly these; everything else under protected paths stays byte-identical)

| # | File (protected) | Task | Change | Nature |
|---|---|---|---|---|
| 1 | `app/api/locations/[id]/posts/[postId]/approval/route.ts` | T1 | Add `await requireLocationAccess(sql, session, id)` at the top of the reject branch's `withTenant` callback, before the UPDATE. | additive guard |
| 2 | `lib/server/password-auth.ts` | T2 | Normalise the login `email_not_verified` (both sites) + `auth_rate_limited` (429) to the generic `invalid_credentials` (401). | client-surface normalisation |
| 3 | `next.config.ts` | T3 | Add an `async headers()` block: Referrer-Policy, X-Frame-Options, X-Content-Type-Options, a conservative CSP. | additive |
| 4 | `app/api/privacy/export/route.ts` | T4 | Replace `GET` (subject in query string) with `POST` (subject in JSON body); keep `requireRole(["owner"])`, the `private, no-store` + attachment headers, and the query body-for-body. | method move (no PII in URL) |
| 5 | `lib/server/capabilities.ts` | T5 | Add `canRequestApproval` to `ReviewCapabilities` and compute it (reads the org `approval_required` flag). | additive capability |

**No §5 edits. No other protected changes.** At merge, `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` lists **exactly** those five files (plus nothing else). `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts` are untouched.

## The §10 release bar (what "done" means)

"All rebuilt surfaces, zero reproducible Critical/High findings from the 2026-07-31 audit, every quarantined test re-enabled, and the legacy redirects restored" — plus the standing merge gate: **all suites green** (unit / component / integration parity oracle / EVERY e2e spec enabled), **clean production build**, **whole-branch review with findings fixed** (the whole-branch review is the controller's, not a task).

## Backend behaviour consumed / verified (CODE WINS — grounded reads)

- **SEC-1 reject branch** (`app/api/locations/[id]/posts/[postId]/approval/route.ts`): the reject branch is guarded by `requireSession()` **only** (line 22) and scopes by the SQL `where … and location_id = ${id}` under `withTenant` (org-level RLS). The **approve** branch is already safe — it delegates to `requestOrPublishLocalPost(...)` → `loadPostContext(...)` which calls `requireLocationAccess` (`lib/server/posts.ts:359`). So the reject branch is the only path missing per-location authorisation: a member assigned only to location A can currently reject an `awaiting_approval` post on **location B in the same org** (RLS scopes the org, not the member's location grants). SEC-1 closes that.
- **`requireLocationAccess`** (`lib/server/permissions.ts:36`): signature `(sql: TransactionSql, session: Session, locationId: string) => Promise<void>`. owner/admin return immediately; a **member with any assignments who is NOT assigned to this location** throws `ApiError(404, "review_not_found", …)`; a member with **zero** assignments passes. So the SEC-1 test asserts a **member-assigned-elsewhere → 404** (today it would succeed), while owner/admin/assigned-member proceed.
- **Login taxonomy** (`lib/server/password-auth.ts`): `email_not_verified` = 403 / "Confirm your email address before signing in." (distinguishable, thrown at `mapLoginFailure` 124-133 **and** `signInWithPassword` 167-173); `invalid_credentials` = 401 / "The email or password is incorrect." (the generic bad-creds/unknown-email response); `auth_rate_limited` = 429 (login, `mapLoginFailure` 141-147). D3 collapses the first and third into the second.
- **`next.config.ts`** is bare (`output: "standalone"`, `outputFileTracingRoot`) — **no `headers()`, no `redirects()`**. The four legacy redirects are `redirect()` server pages (`app/(dashboard)/overview/page.tsx` → `/home`; `app/(dashboard)/analytics/page.tsx` → `/performance`; `app/reviews/page.tsx` → `/inbox` forwarding the query; `app/connections/page.tsx` → `/settings/connections` forwarding the query) — **already implemented**; T3's `headers()` is purely additive; T8's `routing.spec` revival guards existing redirects.
- **Privacy export** (`app/api/privacy/export/route.ts`): `GET`, `runtime="nodejs"`, `requireRole(await requireSession(), ["owner"])`, `subject` read from `?subject=` (`querySchema = z.string().trim().min(3).max(240)`), response headers `cache-control: private, no-store` + `content-disposition: attachment; filename="privacy-export.json"`, 404 `privacy_subject_not_found` when no rows. The client `exportPrivacyData(subject)` (`lib/api/privacy.ts:66`) does a bare `fetch('…?subject=…')` for the blob; the card (`components/settings/privacy-export-card.tsx`) delegates to it (**no card change needed** — CODE-WINS correction to the brief).
- **`canRequestApproval` predicate** (`lib/server/publishing.ts:602-611, 687-696`): `o.approval_required` and `o.require_two_person_approval` are **organisation** columns; `has_qualifying_approval` is a computed `exists(...)`. Non-publisher publish → `awaiting_approval` when `(!canPublish && approval_required) || (require_two_person_approval && !has_qualifying_approval)`. `ReviewCapabilities` today = `{ canPublish, canEdit }` (no approval concept); the client schema is `capabilitiesSchema = z.object({ canPublish, canEdit })` (`lib/api/reviews.ts`), consumed via `useReviewDetail` (`review.capabilities` in `ActionBar`/`ReplyComposer`) and the review list. Adding `canRequestApproval` ripples to the client zod schema and the `tests/integration/routes/review-capabilities.test.ts` exact-shape expectations (both non-protected).
- **Test harness** (`vitest.config.ts`): two projects — `unit` (node, `tests/**/*.test.ts` excluding `tests/components/**`, `fileParallelism: false`) and `components` (jsdom, `tests/components/**`, `setupFiles: tests/components/setup.ts`); `server-only` is aliased to `tests/helpers/server-only-stub.ts`, so `lib/server/**` modules are importable in `unit` tests. E2e: `playwright.config.ts` (`testDir ./tests/e2e`, `globalSetup ./tests/e2e/helpers/stub-bridge.ts`, `fullyParallel: false`, **no `workers` key**, `testIgnore` = `accessibility.spec.ts` + `review-provider-races.spec.ts` + `routing.spec.ts`, `webServer.env` has `PASSWORD_AUTH_ENABLED: "false"` and the `GBP_*` flags `"true"`).

## File structure

```
PROTECTED (sanctioned edits only):
app/api/locations/[id]/posts/[postId]/approval/route.ts   MODIFY (T1): requireLocationAccess in reject branch
lib/server/password-auth.ts                               MODIFY (T2): normalise login email_not_verified + 429
next.config.ts                                            MODIFY (T3): async headers() security block
app/api/privacy/export/route.ts                           MODIFY (T4): GET -> POST (subject in body)
lib/server/capabilities.ts                                MODIFY (T5): + canRequestApproval on ReviewCapabilities

NON-PROTECTED:
lib/api/privacy.ts                    MODIFY (T4): exportPrivacyData -> POST + JSON body
lib/api/reviews.ts                    MODIFY (T5): capabilitiesSchema + canRequestApproval
lib/inbox/actions.ts                  MODIFY (T5): evaluateRequestApproval helper
components/inbox/action-bar.tsx       MODIFY (T5, U2): Submit-for-approval affordance; honest onDelete toast
components/inbox/reply-composer.tsx   MODIFY (T8): drop the "Reply draft" aria-label (label-in-name)
components/inbox/review-detail.tsx    MODIFY (T8): "1 star"/"n stars" grammar
components/settings/backfill-card.tsx MODIFY (U3): render lastErrorCode
components/locations/photos-tab.tsx   MODIFY (U5): restrict accept to image/jpeg,image/png
lib/locations/console-labels.ts MODIFY (U4, token): neutral empty fallback; drop dead "repeated_enum"
lib/format/delta.ts                   MODIFY (U6): finite/negative guard mirroring formatDuration
lib/inbox/action-errors.ts            MODIFY (U1): add missing inbox codes
app/(dashboard)/error.tsx             MODIFY (T8): wrap in <main>
app/not-found.tsx                     MODIFY (T8): wrap in <main>
components/locations/overwrite-confirm-dialog.tsx MODIFY (T8): drop duplicate Checkbox aria-label
components/ui/alert.tsx               MODIFY (T8): variant-aware role
components/locations/menu-editor.tsx  MODIFY (T8): stable keys + unique aria-labels
components/locations/hours-editor.tsx MODIFY (T8): stable keys + unique aria-labels
components/locations/danger-zone-dialog.tsx MODIFY (T8): empty-expectedName guard
components/ui/toast.tsx               MODIFY (T8, optional): tokenise 500ms/150ms
components/ui/chart.tsx               MODIFY (T8, optional): tokenise fontSize/tooltip literals
components/ui/checkbox.tsx            MODIFY (T8, optional): tokenise rounded-[4px]

TESTS + CONFIG:
tests/integration/routes/post-approval-access.test.ts   NEW (T1)
tests/server/login-enumeration-normalization.test.ts    NEW (T2, unit project)
tests/components/sign-in-form.test.tsx                   MODIFY/NEW (T2)
tests/e2e/foundation.spec.ts                             MODIFY (T3): assert security headers
tests/integration/routes/privacy-fulfilment.test.ts     MODIFY (T4): GET -> POST at line ~295
tests/components/privacy-api.test.ts                     NEW (T4): exportPrivacyData POSTs, no PII in URL
tests/integration/routes/review-capabilities.test.ts    MODIFY (T5): + canRequestApproval expectations
tests/components/action-bar.test.tsx                     MODIFY/NEW (T5, U2)
tests/components/*.test.ts(x)                            NEW/MODIFY (T6-T7 cleanups)
tests/e2e/routing.spec.ts                                REVIVE (T8): un-ignore
tests/e2e/review-provider-races.spec.ts                  DELETE (T8)
tests/e2e/accessibility.spec.ts                          REVIVE + ADAPT (T9)
tests/e2e/helpers/stub-bridge.ts                         MODIFY (T9): /accounts tenant scoping
tests/integration/routes/invitation-revoke.test.ts       MODIFY (T9): cross-org 404 + non-uuid 400
tests/components/console-clients.test.ts                 MODIFY (T9): accept_invitation confirmation literal
tests/components/api-client.test.tsx                     VERIFY (T9): malformed_response present
playwright.config.ts                                     MODIFY (T6, T8): workers:1; un-ignore routing + accessibility; drop races entry
```

**Dependency chain:** Tasks **1–5** (the five protected edits) are independent of one another and may run in parallel worktree passes — each is a self-contained security/privacy hardening with its own tests. Tasks **6** (a11y/token cleanup) and **7** (UX polish) are independent non-protected cleanups; **they must land before Task 9** because reviving the repo-wide axe sweep will otherwise fail on the pre-existing a11y hits Task 6 fixes. Task **8** (workers:1 + revive `routing.spec` + delete `review-provider-races.spec`) is independent test-config wiring. Task **9** (accessibility.spec revival + stub-bridge tenant fix + parity-oracle hardening) depends on Tasks 6/7 for a clean axe. Task **10** is the terminal release-bar gate and runs last. Per-task protected footprint is enforced by the `git diff --stat` assertion in Task 10.

---

### Task 1: SEC-1 — per-location authorisation on the posts reject branch [PROTECTED]

> **Sanctioned protected edit #1.** `app/api/locations/[id]/posts/[postId]/approval/route.ts` + a NEW integration test. `requireLocationAccess` is imported (consumed) from `@/lib/server/permissions`.

**Files:**
- Modify: `app/api/locations/[id]/posts/[postId]/approval/route.ts` (reject branch only)
- Test: `tests/integration/routes/post-approval-access.test.ts` (NEW)

**Interfaces:**
- Consumes: `requireLocationAccess(sql, session, locationId): Promise<void>` (`@/lib/server/permissions`) — owner/admin pass; a member with assignments but not this location throws `ApiError(404, "review_not_found")`; a member with no assignments passes.
- No exported surface changes; the route's success/error contract is unchanged except that a cross-location member now gets `404 review_not_found` instead of silently succeeding.

- [ ] **Step 1a: Author two additive `tests/integration/helpers/tenant.ts` helpers** (grounded — `tenant.ts` today exports only `createTestTenant` / `seedReview` / `seedGoogleConnection` / `seedLinkedReview` / `seedLinkedLocation` / `saveHumanDraft` / `destroyTenants`; there is **no** `seedMemberUser` and no post seeder). Both are `tests/` files, non-protected. `createTestTenant(admin, { role?, canPublish? })` returns `{ organisationId, userId, email, cookie }` (`cookie: naba_session=<token>`); it inserts `organisation` + `app_user` + `member` + `app_session`. The new member helper mirrors that but adds a `location_member` assignment (mirror the exact `location_member` columns the M5 `tests/integration/routes/location-capabilities.test.ts` inserts):

```ts
// tenant.ts — additive. Mirrors createTestTenant, plus a per-location grant.
export async function seedMemberUser(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string; role?: "member" | "viewer"; canPublish?: boolean; assignLocationId?: string }
): Promise<{ userId: string; cookie: string }> {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  const email = `harness-${userId.slice(0, 8)}@nabapresence.test`
  await admin`insert into app_user (id, email, display_name, default_organisation_id)
              values (${userId}, ${email}, 'Harness member', ${input.organisationId})`
  await admin`insert into member (organisation_id, user_id, role, can_publish)
              values (${input.organisationId}, ${userId}, ${input.role ?? "member"}, ${input.canPublish ?? false})`
  if (input.assignLocationId) {
    await admin`insert into location_member (organisation_id, user_id, location_id, can_publish)
                values (${input.organisationId}, ${userId}, ${input.assignLocationId}, ${input.canPublish ?? false})`
  }
  await admin`insert into app_session (token_hash, user_id, organisation_id, expires_at)
              values (${sha256(token)}, ${userId}, ${input.organisationId}, now() + interval '1 hour')`
  return { userId, cookie: `naba_session=${token}` }
}

// Inserts an awaiting_approval local post. Confirm the gbp_local_post NOT NULL
// columns against supabase/ (the schema is protected/consume-only — read it, don't edit).
export async function seedAwaitingApprovalPost(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string; locationId: string; requestedBy: string }
): Promise<{ id: string }> {
  const id = randomUUID()
  await admin`insert into gbp_local_post (id, organisation_id, location_id, status, approval_requested_by, /* + required cols */)
              values (${id}, ${input.organisationId}, ${input.locationId}, 'awaiting_approval', ${input.requestedBy}, /* … */)`
  return { id }
}
```

- [ ] **Step 1b: Write the failing integration test.** Seed one org, one Google connection, two **linked** locations (A and B), a member assigned only to **A**, and an `awaiting_approval` post on **B**. Boot the app server with the publishing flags enabled — **without them the reject branch returns `503 publishing_paused` at `approval/route.ts:18` before the guard runs** (mirror `tests/integration/routes/local-posts.test.ts:25-30`: `startAppServer` with `GOOGLE_API_PROXY_BASE`, `GBP_POSTS_ENABLED: "true"`, `PUBLISH_ENABLED: "true"`). Use the admin postgres handle + `destroyTenants` cleanup exactly as the sibling `tests/integration/routes/*` do.

`tests/integration/routes/post-approval-access.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest"

import {
  createTestTenant, seedGoogleConnection, seedLinkedLocation,
  seedMemberUser, seedAwaitingApprovalPost, destroyTenants,
} from "@/tests/integration/helpers/tenant"
import { startAppServer } from "@/tests/integration/helpers/server" // path per local-posts.test.ts
import { getAdminSql } from "@/tests/integration/helpers/db"        // admin handle per the sibling tests

const admin = getAdminSql()
const organisations: string[] = []
afterAll(async () => { await destroyTenants(admin, organisations) })

// startAppServer boots with the publishing flags ON so the reject branch is reachable.
const env = { GBP_POSTS_ENABLED: "true", PUBLISH_ENABLED: "true" } // + GOOGLE_API_PROXY_BASE per the sibling

describe("posts approval reject — per-location authorisation (SEC-1)", () => {
  it("a member assigned elsewhere cannot reject a post on another location", async () => {
    const server = await startAppServer({ env })
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const conn = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const locA = await seedLinkedLocation(admin, { organisationId: tenant.organisationId, connectionId: conn.connectionId, googleAccountName: conn.googleAccountName })
    const locB = await seedLinkedLocation(admin, { organisationId: tenant.organisationId, connectionId: conn.connectionId, googleAccountName: conn.googleAccountName })
    const member = await seedMemberUser(admin, { organisationId: tenant.organisationId, role: "member", assignLocationId: locA.locationId })
    const post = await seedAwaitingApprovalPost(admin, { organisationId: tenant.organisationId, locationId: locB.locationId, requestedBy: member.userId })

    const res = await fetch(`${server.baseUrl}/api/locations/${locB.locationId}/posts/${post.id}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ decision: "reject" }),
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe("review_not_found")

    const [row] = await admin<{ status: string }[]>`select status from gbp_local_post where id = ${post.id}`
    expect(row.status).toBe("awaiting_approval") // untouched
  })

  it("an owner may reject the same post (200 -> draft)", async () => {
    const server = await startAppServer({ env })
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const conn = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const locB = await seedLinkedLocation(admin, { organisationId: tenant.organisationId, connectionId: conn.connectionId, googleAccountName: conn.googleAccountName })
    const post = await seedAwaitingApprovalPost(admin, { organisationId: tenant.organisationId, locationId: locB.locationId, requestedBy: tenant.userId })

    const res = await fetch(`${server.baseUrl}/api/locations/${locB.locationId}/posts/${post.id}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: tenant.cookie },
      body: JSON.stringify({ decision: "reject" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "draft" })
  })
})
```

> **Note:** `RUN_DB_TESTS=true` + Postgres via `naba_test_runtime` (the standing integration convention). Confirm `startAppServer`'s exact signature/import path and the admin-handle accessor against `tests/integration/routes/local-posts.test.ts` before copying — the names above follow that file.

- [ ] **Step 2: Run to verify it fails** — `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/post-approval-access.test.ts`. Expected: the first test FAILS (today the reject succeeds with 200 `{status:"draft"}` and the post flips to `draft`).

- [ ] **Step 3: Add the guard.** In `app/api/locations/[id]/posts/[postId]/approval/route.ts`, import `requireLocationAccess` and call it as the first statement inside the reject branch's `withTenant` callback, before the UPDATE:

```ts
import { requireLocationAccess } from "@/lib/server/permissions"
// …
    if (decision === "reject") {
      await withTenant(session.organisationId, async (sql) => {
        await requireLocationAccess(sql, session, id)   // SEC-1: match the approve branch + the reviews approval route
        const [post] = await sql<{ id: string }[]>`
          update gbp_local_post
          set status = 'draft', approval_requested_by = null
          where id = ${postId}
            and location_id = ${id}
            and status = 'awaiting_approval'
          returning id::text as id
        `
        if (!post) throw new ApiError(409, "approval_not_pending", "This post is not awaiting approval.")
        // …unchanged audit + return…
      })
      return NextResponse.json({ status: "draft" })
    }
```

Everything else in the file stays byte-identical. (The approve branch already reaches `requireLocationAccess` via `requestOrPublishLocalPost → loadPostContext`; this makes the reject branch consistent with both it and the reviews approval route.)

- [ ] **Step 4: Run the test to green + re-run the affected integration slice** — `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/post-approval-access.test.ts`, then the posts + approval integration files. Expected: PASS; no other integration test regresses.

- [ ] **Step 5: Commit** — `fix(security): require location access before rejecting a post approval (SEC-1)`.

---

### Task 2: D3 — normalise the sign-in enumeration channels [PROTECTED]

> **Sanctioned protected edit #2.** `lib/server/password-auth.ts` (login path only) + the non-protected client sign-in surface. Keeps the real auth behaviour; changes only the user-facing code/status/message.

**Files:**
- Modify: `lib/server/password-auth.ts` (`mapLoginFailure` + the direct throw in `signInWithPassword`)
- Modify: `components/auth/sign-in-form.tsx` and/or `lib/api/auth-errors.ts` (client surface — see Step 5)
- Test: `tests/server/login-enumeration-normalization.test.ts` (NEW, `unit` project), `tests/components/sign-in-form.test.tsx` (NEW/MODIFY)

**Interfaces:**
- `signInWithPassword(email, password): Promise<PasswordIdentity>` — unchanged signature; on an unverified account **or** a provider 429 it now throws the **same** `ApiError(401, "invalid_credentials", …)` it already throws for a wrong password, so the three login-failure causes are indistinguishable to the caller.
- `authErrorMessage(error)` (`@/lib/api/auth-errors`) — unchanged signature; the login path now only ever yields the generic `invalid_credentials` message (no `email_not_verified` / `auth_rate_limited` branch reached from sign-in).

- [ ] **Step 1: Write the failing server test.** In the `unit` (node) project, stub global `fetch` to emulate Supabase GoTrue and assert `signInWithPassword` maps **both** the unverified case (GoTrue 403 `email_not_confirmed`) **and** the throttled case (GoTrue 429) to the identical generic `invalid_credentials` (401) — indistinguishable from a wrong password.

`tests/server/login-enumeration-normalization.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/server/http"
import { signInWithPassword } from "@/lib/server/password-auth"

function gotrue(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("signInWithPassword — enumeration normalisation (D3)", () => {
  it("maps an unverified account to the generic invalid_credentials, not email_not_verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(403, { error_code: "email_not_confirmed" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("maps a token success whose user is unverified to invalid_credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(200, {
      access_token: "a", refresh_token: "r",
      user: { id: "u1", email: "real@x.test", email_confirmed_at: null, confirmed_at: null },
    })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("maps a provider 429 to invalid_credentials (no 429 timing channel on login)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(429, { error_code: "over_request_rate_limit" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("still surfaces genuine availability failures (503) — not an enumeration channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(503, { error_code: "auth_provider_down" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(503)
  })
})
```

> This exercises `providerConfiguration()`, which requires `PASSWORD_AUTH_ENABLED` + `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`. Set them in the test via `vi.stubEnv` (or a `beforeAll`) to non-empty values so `providerConfiguration()` reaches the stubbed `fetch`; the `server-only` import resolves through the configured `vitest.config.ts` alias.

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run tests/server/login-enumeration-normalization.test.ts --project unit`. Expected FAIL: today the unverified cases throw `403 email_not_verified` and the 429 throws `429 auth_rate_limited`.

- [ ] **Step 3: Normalise the login path** in `lib/server/password-auth.ts`. Introduce a single generic login error and route the two enumeration channels through it. In `mapLoginFailure`, collapse the `email_not_confirmed`/`email_not_verified` branch **and** the 429 sub-branch into `invalid_credentials`; in `signInWithPassword`, replace the direct `email_not_verified` throw likewise:

```ts
// D3: the login surface must not reveal whether an email is registered. An
// unverified account and a throttled attempt are made indistinguishable from a
// wrong password — the real provider behaviour is unchanged; only the
// user-facing code/status/message is normalised. (Sign-up / reset / resend keep
// their own documented 429 handling.)
function genericLoginFailure(): ApiError {
  return new ApiError(401, "invalid_credentials", "The email or password is incorrect.")
}

function mapLoginFailure(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof AuthProviderError) {
    if (
      error.code === "email_not_confirmed" ||
      error.code === "email_not_verified" ||
      error.status === 400 ||
      error.status === 401 ||
      error.status === 429            // 429 timing channel folded into the generic failure
    ) {
      throw genericLoginFailure()
    }
    throw new ApiError(
      503,
      error.code,
      "Email and password sign-in is temporarily unavailable."
    )
  }
  throw error
}
```

And in `signInWithPassword`, the post-token unverified guard:

```ts
    const identity = identityFromUser(payload.user)
    if (!identity.emailVerified) {
      throw genericLoginFailure()          // was: ApiError(403, "email_not_verified", …)
    }
    return identity
```

Leave `signUpWithPassword`, `requestPasswordReset`, `resendConfirmationEmail`, `verifyEmailToken`, `updatePasswordWithToken`, `providerConfiguration`, `identityFromUser`, and `providerRequest` **byte-identical** — D3 is login-only.

- [ ] **Step 4: Run the server test to green** — `pnpm exec vitest run tests/server/login-enumeration-normalization.test.ts --project unit`. Expected PASS.

- [ ] **Step 5: Reconcile the client sign-in surface — restore §8 with a GENERIC, enumeration-safe resend affordance** (ambiguity resolution, baked in). Because the login path no longer emits `email_not_verified`, the client's resend-from-unconfirmed-login affordance (`lib/api/auth-errors.ts` maps `email_not_verified` → `action: "resend-confirmation"`, rendered by `AuthErrorAlert`) is no longer reachable from sign-in. **Rather than drop spec §8's "resend from the unconfirmed-login state", restore it as an ALWAYS-VISIBLE, un-conditioned affordance** — strictly better than dropping it, and enumeration-safe because `resendConfirmationEmail` swallows every provider error and surfaces only a generic 429 (`lib/server/password-auth.ts:317-350` — it never discloses whether the address belongs to an account):
  - The sign-in error renders the generic `invalid_credentials` message (`auth-errors.ts` `BY_CODE.invalid_credentials`, unchanged copy) — it does not confirm registration.
  - **Render a small, always-visible "Didn't receive a confirmation email? Resend" affordance beneath the sign-in form** (reuse `ResendConfirmationButton` with the entered `email`), **not conditioned on any error code** — so no error branch reveals registration state, yet the resend path exists from the sign-in surface (§8). Keep the existing post-registration `confirm-sent` resend (`sign-in-form.tsx` line 175) as well.
  - **Do not** attach `action: "resend-confirmation"` to `invalid_credentials` (that would tie the button to a wrong-password attempt). Leave the `email_not_verified` / `auth_rate_limited` `BY_CODE` entries in place (harmless; still valid copy if a non-login flow emits them) but confirm no sign-in error path reaches them.

Write a component test pinning both properties (generic error surface + always-present, error-independent resend):

`tests/components/sign-in-form.test.tsx` (add):

```tsx
it("shows a generic sign-in error and never reveals whether the email is registered", async () => {
  vi.spyOn(authApi, "signIn").mockRejectedValue(
    new ApiClientError(401, "invalid_credentials", "The email or password is incorrect.")
  )
  render(<SignInForm />)
  fireEvent.change(screen.getByRole("textbox", { name: /email/i }), { target: { value: "real@x.test" } })
  // …fill password, submit…
  expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument()
  expect(screen.queryByText(/confirm your email/i)).not.toBeInTheDocument()
})

it("offers a generic, always-visible resend affordance not tied to any error", () => {
  render(<SignInForm />)
  // Present on the sign-in surface before any submit — so it can never leak registration state.
  expect(screen.getByRole("button", { name: /resend confirmation/i })).toBeInTheDocument()
})
```

- [ ] **Step 6: Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected PASS.

- [ ] **Step 7: Commit** — `fix(security): normalise sign-in enumeration channels (D3)`.

---

### Task 3: Security response headers [PROTECTED]

> **Sanctioned protected edit #3.** `next.config.ts` gains an `async headers()` block. Conservative CSP — must NOT break the app (verified against the build + the e2e zero-console-error guard).

**Files:**
- Modify: `next.config.ts`
- Test: `tests/e2e/foundation.spec.ts` (assert the headers) + `tests/e2e/inbox.spec.ts` **or** `tests/e2e/locations.spec.ts` (the remote-thumbnail render assertion — Step 1b)

**Interfaces:**
- `headers()` returns one source (`/(.*)`) with `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and `Content-Security-Policy`. No route/component change.

- [ ] **Step 1a: Add the failing header assertion.** In `tests/e2e/foundation.spec.ts`, capture the main-document response and assert the four headers **including the Google media origins in `img-src`** (R1):

```ts
test("responses carry conservative security headers", async ({ page }) => {
  const response = await page.goto("/home")
  const headers = response!.headers()
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["x-frame-options"]).toBe("DENY")
  const csp = headers["content-security-policy"]
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  // R1: Google-hosted thumbnails must be allowed, or client-rendered <img> break.
  expect(csp).toContain("googleusercontent.com")
})
```

- [ ] **Step 1b: Add the remote-thumbnail render assertion (R1 — the guard that a `media: []` fixture cannot provide).** Seed/stub a review (or photos) surface with a **NON-EMPTY remote `thumbnailUrl`** on a `googleusercontent.com` host, load it under the CSP, and assert the image actually loads (non-zero `naturalWidth`) **and** no console error / no CSP violation fired. Add it to whichever spec already owns a review-detail-with-media fixture (`inbox.spec.ts`) or the photos tab (`locations.spec.ts`) via `stub-bridge`/`page.route`:

```ts
test("a review thumbnail on a Google media host renders under the CSP", async ({ page }) => {
  const cspViolations: string[] = []
  page.on("console", (m) => { if (/content security policy/i.test(m.text())) cspViolations.push(m.text()) })
  // …navigate to a review-detail (or photos) surface whose fixture has a
  // thumbnailUrl like "https://lh3.googleusercontent.com/…" (a 1x1 PNG the stub serves)…
  const img = page.getByRole("img").first()
  await expect(img).toBeVisible()
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  expect(cspViolations).toEqual([])
})
```

> If the stub cannot serve a real `googleusercontent.com` asset offline, point the fixture `thumbnailUrl` at the local stub origin **and** add that stub origin to `img-src` in the e2e config only if the production hosts differ — but the production CSP MUST list the real Google hosts; the test's job is to prove a remote host on the allow-list loads clean, so prefer serving a tiny asset the CSP allows.

- [ ] **Step 2: Run to verify failure** — `node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/foundation.spec.ts`. Expected FAIL (headers absent).

- [ ] **Step 3: Add the `headers()` block** to `next.config.ts`:

```ts
import type { NextConfig } from "next"

// A conservative CSP that locks down framing, object embedding, base-uri and
// form-action without breaking Next 16's inline bootstrap script or Tailwind's
// injected styles. `'unsafe-inline'` is retained deliberately for script/style
// (Next injects an inline runtime bootstrap and Tailwind injects inline style)
// — a nonce-based tightening is a documented follow-up. connect/font stay
// same-origin; img additionally allows data:/blob: (the privacy-export object
// URL + inlined assets) AND the Google media origins that serve review/photo
// thumbnails CLIENT-SIDE (thumbnail_url is stored verbatim from Google — see
// lib/server/media.ts:114, reviews.ts:241 — and rendered as `<img src>` in
// review-detail.tsx:80-81 and photos-tab.tsx:187; there is NO image proxy and
// no next.config images.remotePatterns). Omitting these origins ships broken
// thumbnails, and the a11y/other e2e fixtures use `media: []` so the CSP
// violation would NOT fire and the zero-console-error guard would go a FALSE
// green — hence the dedicated remote-thumbnail render test in Step 1b.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Google-hosted review/photo thumbnails: lh3-6.googleusercontent.com, *.ggpht.com.
  // Confirm against the actual stored thumbnailUrl values and add any other hosts they use.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ")

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 4: Build + run the FULL e2e suite** — `pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`. Expected: clean build; **all** e2e specs green, including the zero-console-error / zero-pageerror guard on every route in both themes **and the Step 1b remote-thumbnail render test** (the guard alone cannot catch a bad `img-src` because the other fixtures carry `media: []`). If a directive breaks a surface, relax only the offending directive (record which) and re-run — never weaken the guard to accommodate a bad CSP.

- [ ] **Step 5: Commit** — `feat(security): add conservative security response headers (S3)`.

---

### Task 4: Privacy export via POST (no PII in the URL) [PROTECTED]

> **Sanctioned protected edit #4.** Replace the export `GET` (subject in query string) with a `POST` (subject in JSON body). The client repoints; the export card is unchanged (it delegates to the client fn).

**Files:**
- Modify: `app/api/privacy/export/route.ts` (GET → POST)
- Modify: `lib/api/privacy.ts` (`exportPrivacyData` → POST + JSON body)
- Test: `tests/integration/routes/privacy-fulfilment.test.ts` (the export call at ~line 295), `tests/components/privacy-api.test.ts` (NEW)

**Interfaces:**
- `POST /api/privacy/export` — body `{ subject: string }` (`z.string().trim().min(3).max(240)`), `requireRole(["owner"])`, same review query, same `private, no-store` + `attachment` headers, same 404 `privacy_subject_not_found`. **GET is removed** (no lingering PII-in-URL path).
- `exportPrivacyData(subject): Promise<void>` — unchanged signature; now POSTs the subject in the body. The card (`privacy-export-card.tsx`) is **unchanged**.

- [ ] **Step 1: Update the failing integration test.** In `tests/integration/routes/privacy-fulfilment.test.ts` (~line 295) change the export call from `GET …/export?subject=…` to `POST …/export` with a JSON body, and add an assertion that the request URL carries **no** `subject` query param:

```ts
const exportRes = await fetch(`${server.baseUrl}/api/privacy/export`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: ownerCookie },
  body: JSON.stringify({ subject: fixture.reviewerName }),
})
expect(exportRes.status).toBe(200)
expect(exportRes.headers.get("content-disposition")).toContain("attachment")
expect(exportRes.headers.get("cache-control")).toBe("private, no-store")
// A GET with a subject query string is gone.
const legacy = await fetch(`${server.baseUrl}/api/privacy/export?subject=${encodeURIComponent(fixture.reviewerName)}`, {
  headers: { cookie: ownerCookie },
})
expect(legacy.status).toBe(405)
```

- [ ] **Step 2: Run to verify failure** — `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/privacy-fulfilment.test.ts`. Expected FAIL (POST 405 today; GET still 200).

- [ ] **Step 3: Convert the route** in `app/api/privacy/export/route.ts` — rename `GET` to `POST`, read `subject` from the JSON body, keep everything else byte-identical:

```ts
export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner"])
    const query = querySchema.parse(await request.json())   // { subject } — no more URL parsing
    // …identical withTenant(...) block, headers, 404, audit…
```

(`querySchema` stays `z.object({ subject: z.string().trim().min(3).max(240) })`; only its source changes from `searchParams` to the body. Removing `GET` makes a stray `?subject=` request a 405 — the audit's "no PII in GET query strings" is closed with no legacy surface.)

- [ ] **Step 4: Repoint the client + add a client test.** In `lib/api/privacy.ts`, change `exportPrivacyData` to POST:

```ts
export async function exportPrivacyData(subject: string): Promise<void> {
  const response = await fetch("/api/privacy/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject }),
  })
  // …unchanged: !response.ok -> ApiClientError; blob -> <a download> …
}
```

`tests/components/privacy-api.test.ts` (NEW — asserts POST + body, and that the subject never appears in the URL):

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { exportPrivacyData } from "@/lib/api/privacy"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it("exportPrivacyData POSTs the subject in the body, never the URL", async () => {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() }
  vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLAnchorElement)
  vi.spyOn(document.body, "appendChild").mockImplementation((n) => n as never)
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() } as unknown as typeof URL)
  const fetchMock = vi.fn(async () => new Response(new Blob(["{}"]), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)

  await exportPrivacyData("guest-4821")
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe("/api/privacy/export")
  expect(url).not.toContain("guest-4821")
  expect(init.method).toBe("POST")
  expect(JSON.parse(init.body as string)).toEqual({ subject: "guest-4821" })
})
```

The existing `tests/components/privacy-export-card.test.tsx` stays green (it mocks `exportPrivacyData` and the card's contract is unchanged).

- [ ] **Step 5: Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the privacy integration slice. Expected PASS.

- [ ] **Step 6: Commit** — `fix(privacy): export via POST so the subject never appears in a URL`.

---

### Task 5: `canRequestApproval` capability + inbox "Submit for approval" [PROTECTED + frontend] (D2)

> **Sanctioned protected edit #5.** `lib/server/capabilities.ts` gains an additive `canRequestApproval`. The field ripples (non-protected) to the client zod schema and the inbox action bar; it reuses the existing publish mutation (no new endpoint).

**Files:**
- Modify: `lib/server/capabilities.ts` (add `canRequestApproval` to `ReviewCapabilities` + compute in both `reviewCapabilitiesForLocations` branches)
- Modify: `lib/api/reviews.ts` (`capabilitiesSchema` + `canRequestApproval`)
- Modify: `lib/inbox/actions.ts` (add `evaluateRequestApproval`)
- Modify: `components/inbox/action-bar.tsx` (render the "Submit for approval" button)
- Test: `tests/integration/routes/review-capabilities.test.ts` (add `canRequestApproval` expectations), `tests/components/action-bar.test.tsx`

**Interfaces:**
- `ReviewCapabilities = { canPublish: boolean; canEdit: boolean; canRequestApproval: boolean }` — identical shape across `lib/server/capabilities.ts`, the client `capabilitiesSchema` (`lib/api/reviews.ts`), and every consumer.
- `evaluateRequestApproval({ status, canRequestApproval, hasVerifiedDraft, isDirty }): ActionAvailability` (`@/lib/inbox/actions`) — enabled only when `canRequestApproval` is true, the status passes the **same `isAllowedReviewTransition(state, "publish_requested")` guard as `evaluatePublish`**, a verified draft exists, and the composer is clean.
- Predicate (D2): `canRequestApproval = canEdit && !canPublish && orgApprovalRequired`, where `orgApprovalRequired` is the org's `approval_required` flag.

- [ ] **Step 1: Extend the failing capability integration test.** In `tests/integration/routes/review-capabilities.test.ts`, add `canRequestApproval` to the exact-shape expectations for the existing role×membership cases, and add a case that toggles the org `approval_required` flag:
  - owner/admin: `{ canPublish: true, canEdit: true, canRequestApproval: false }` (publishers never "request").
  - viewer: `{ …, canRequestApproval: false }`.
  - member-assigned-without-publish, **org `approval_required = true`**: `canRequestApproval: true`.
  - the same member, **org `approval_required = false`**: `canRequestApproval: false`.

```ts
it("a non-publishing member can request approval only when the org requires approval", async () => {
  // seed org with approval_required = true, a member assigned with can_publish = false
  const caps = await fetchReviewCapabilities(memberCookie, reviewId)
  expect(caps).toEqual({ canPublish: false, canEdit: true, canRequestApproval: true })
})
```

Also update **every** existing `toEqual`/`toMatchObject` on the review-capabilities shape in this file (and any sibling that asserts the shape) to include the new key — the shape is widely asserted.

- [ ] **Step 2: Run to verify failure** — `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/review-capabilities.test.ts`. Expected FAIL (key missing / shape mismatch).

- [ ] **Step 3: Compute `canRequestApproval`** in `lib/server/capabilities.ts`. Read the org `approval_required` flag once (it is org-scoped), and set the field in each role branch of `reviewCapabilitiesForLocations`:

```ts
export type ReviewCapabilities = {
  canPublish: boolean
  canEdit: boolean
  canRequestApproval: boolean
}
// …inside reviewCapabilitiesForLocations, after the early-return guards for the
// empty case but computed for all roles:
const [org] = await sql<{ approvalRequired: boolean }[]>`
  select approval_required as "approvalRequired"
  from organisation where id = ${session.organisationId}
`
const approvalRequired = org?.approvalRequired ?? false
// owner/admin branch:  { canPublish: true,  canEdit: true,  canRequestApproval: false }
// viewer branch:       { canPublish: false, canEdit: false, canRequestApproval: false }
// member branch (per location):
//   const canRequestApproval = canEdit && !canPublish && approvalRequired
//   result.set(id, { canPublish, canEdit, canRequestApproval })
```

`reviewCapabilities` (the single-location wrapper) and its `?? { … }` fallback gain `canRequestApproval: false`. Leave `LocationCapabilities`, `SettingsCapabilities`, and `locationCapabilities*` byte-identical.

> **Parity-oracle note:** `ReviewCapabilities` is returned whole by `app/api/reviews/route.ts` and `app/api/reviews/[id]/route.ts` (spread into the payload) — those routes need **no** edit; the new field flows through automatically. Only `capabilities.ts` (protected, sanctioned) changes on the server. Re-run the full integration suite after Step 3 and fix any other exact-shape assertion in test files (non-protected) that now needs the key.
>
> **R5 — leave `app/api/reviews/route.ts:139-142` BYTE-IDENTICAL.** After widening `ReviewCapabilities`, the inline fallback there (`… ?? { canPublish: false, canEdit: false }`) becomes shape-inconsistent with the new type, **but it typechecks** (it is an unannotated union feeding `NextResponse.json`, not a `ReviewCapabilities`-annotated slot) **and is unreachable** (every queried id is present in the capabilities map). It is a protected, NON-sanctioned file — do **NOT** "complete" the literal with `canRequestApproval: false`; doing so would make it a 6th protected edit and break the five-file footprint. Only `capabilities.ts:74`'s own wrapper fallback is updated (it is inside the sanctioned file). State this to the whole-branch reviewer so they don't tidy the literal.

- [ ] **Step 4: Add the client schema key + the actions helper.** `lib/api/reviews.ts`:

```ts
const capabilitiesSchema = z.object({
  canPublish: z.boolean(),
  canEdit: z.boolean(),
  canRequestApproval: z.boolean(),
})
```

`lib/inbox/actions.ts` — mirror `evaluatePublish` **including its transition guard** (R6). Because the affordance reuses the publish mutation, it must gate on the SAME `asState` + `isAllowedReviewTransition(state, "publish_requested")` check `evaluatePublish` uses (`lib/inbox/actions.ts:27-33`); without it, a non-publishable status (e.g. an already-published review with a lingering verified draft, `!canPublish` in an approval-required org) would enable the button and the reused publish mutation would 409 server-side:

```ts
export function evaluateRequestApproval(input: {
  status: string
  canRequestApproval: boolean
  hasVerifiedDraft: boolean
  isDirty: boolean
}): ActionAvailability {
  if (!input.canRequestApproval) return { enabled: false }
  // Same transition guard as evaluatePublish — the reused publish mutation
  // only accepts a publish-requestable status.
  const state = asState(input.status)
  if (!state || !isAllowedReviewTransition(state, "publish_requested")) {
    return { enabled: false, reason: "This reply cannot be submitted for approval from its current status." }
  }
  if (input.isDirty) return { enabled: false, reason: "Save your draft before submitting it for approval." }
  if (!input.hasVerifiedDraft) return { enabled: false, reason: "Verify a draft before submitting it for approval." }
  return { enabled: true }
}
```

(`ActionAvailability`, `asState`, and `isAllowedReviewTransition` are already in scope in `lib/inbox/actions.ts` — reuse them, do not re-import differently.)

- [ ] **Step 5: Render the affordance** in `components/inbox/action-bar.tsx`. When `!canPublish && canRequestApproval` and the review is not awaiting approval, render a **"Submit for approval"** button in place of the (disabled-for-non-publisher) Publish button; it calls the **existing** `publish.mutateAsync({ draftId, expectedReviewUpdateTime })` — the server routes a non-publisher's publish to `awaiting_approval` — and toasts via `describeOutcomeToast(result.status)` (which already maps `awaiting_approval` → a "Sent for approval" style toast). Pin the behaviour:

```tsx
it("offers Submit for approval to a non-publisher in an approval-required org and routes to approval", async () => {
  const review = makeReview({
    workflowStatus: "ready",
    capabilities: { canPublish: false, canEdit: true, canRequestApproval: true },
    drafts: [verifiedDraft()],
  })
  const publish = mockPublishReturning({ status: "awaiting_approval" })
  render(<ActionBar review={review} />)
  const button = screen.getByRole("button", { name: /submit for approval/i })
  expect(button).toBeEnabled()
  await userEvent.click(button)
  await waitFor(() => expect(publish).toHaveBeenCalled())
  expect(await screen.findByText(/sent for approval|awaiting approval/i)).toBeInTheDocument()
})

it("does not offer Submit for approval when the org does not require approval", () => {
  const review = makeReview({ capabilities: { canPublish: false, canEdit: true, canRequestApproval: false } })
  render(<ActionBar review={review} />)
  expect(screen.queryByRole("button", { name: /submit for approval/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 6: Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the review-capabilities integration slice. Expected PASS.

- [ ] **Step 7: Commit** — `feat(inbox): let non-publishers submit a reply for approval (D2, canRequestApproval)`.

---

### Task 6: Accessibility nits + destructive-primitive hardening + token nits

> **No protected-path edit.** All under `components/**` + `app/(dashboard)/error.tsx` + `app/not-found.tsx`. These land **before** the accessibility.spec revival (Task 9), because that repo-wide axe sweep will otherwise fail on the pre-existing hits fixed here.

**Files:**
- Modify: `components/inbox/reply-composer.tsx`, `components/inbox/review-detail.tsx`, `app/(dashboard)/error.tsx`, `app/not-found.tsx`, `components/locations/overwrite-confirm-dialog.tsx`, `components/ui/alert.tsx`, `components/locations/menu-editor.tsx`, `components/locations/hours-editor.tsx`, `components/locations/danger-zone-dialog.tsx`, `lib/locations/console-labels.ts` (dead-kind removal), `components/ui/toast.tsx`, `components/ui/chart.tsx`, `components/ui/checkbox.tsx` (token nits)
- Test: the relevant component tests (`tests/components/danger-zone-dialog.test.tsx`, `tests/components/alert.test.tsx` or NEW, `tests/components/review-detail.test.tsx`, etc.)

**Interfaces:** no exported-signature changes; these are internal a11y/token corrections.

- [ ] **Step 1: Label-in-Name — reply composer.** In `components/inbox/reply-composer.tsx`, remove the `aria-label="Reply draft"` on the textarea (line ~159): the `<label htmlFor="reply-draft">Your reply</label>` already names it, and the `aria-label` both duplicates and mismatches the visible name (WCAG 2.5.3 label-content-name-mismatch). Delete the `aria-label` prop only.

- [ ] **Step 2: Rating grammar — review detail.** In `components/inbox/review-detail.tsx` (line ~58), replace `` `${review.rating} stars` `` with the singular/plural helper already used in `review-list.tsx`:

```tsx
aria-label={review.rating === null ? "No rating" : `${review.rating} star${review.rating === 1 ? "" : "s"}`}
```

Add a test asserting a one-star review reads "1 star" (not "1 stars").

- [ ] **Step 3: Landmark regions — error + not-found.** Wrap the content of `app/(dashboard)/error.tsx` and `app/not-found.tsx` in a `<main>` so each has a landmark region (both currently render a bare top-level `<div>`). For `error.tsx`, which has no heading, add a visually-appropriate `<h1>` (or keep the `AlertTitle` and ensure the `<main>` is present) — at minimum the `<main>` landmark. Example (`not-found.tsx`):

```tsx
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6 text-center">
      {/* …existing h1 + copy + link… */}
    </main>
  )
}
```

> These are standalone route trees (not inside the dashboard `PageFrame`), so adding one `<main>` here does not create a second `<main>` on any page.

- [ ] **Step 4: Duplicate accessible name — overwrite-confirm dialog.** In `components/locations/overwrite-confirm-dialog.tsx` (line ~51), drop the redundant `aria-label={acknowledgementLabel}` on the `Checkbox` — it is already inside a `<label>` whose `<span>` holds `acknowledgementLabel` (mirror `typed-attribute-control.tsx`, which deliberately omits it).

- [ ] **Step 5: Variant-aware role — alert.** In `components/ui/alert.tsx`, make the ARIA role depend on the variant instead of the hardcoded `role="alert"` (which is wrong for neutral `default` / `success` / `info`):

```tsx
const role = variant === "destructive" || variant === "warning" ? "alert" : "status"
// …<div data-slot="alert" role={role} …>
```

Add a test: `destructive` → `role="alert"`; `info`/`success`/`default` → `role="status"`. **Then run the full component suite** — several call sites rely on `getByRole("alert")`; update those queries where the variant is now neutral (test files only).

- [ ] **Step 6: Stable keys + unique aria-labels — menu/hours editors.** In `components/locations/menu-editor.tsx`, key sections/items by a stable id (or a composed key like `` `${sectionIndex}-${item.name}` `` only if no id exists — prefer a real id field on the model) and make item aria-labels unique per row (include the section/item position or name, e.g. `` `Item name — section ${sectionIndex + 1}, item ${itemIndex + 1}` ``). In `components/locations/hours-editor.tsx`, key special-hours rows and periods by a stable field where available; the index-based aria-labels ("Special date N …") are acceptable if unique, but prefer keying rows by the row's `effectiveDate` when set. Keep the regular-hours `day.dayOfWeek` key (already stable).

> These edits preserve behaviour; the goal is unique accessible names + non-index React keys where a stable field exists. Where the Google/menu model genuinely has no stable id, a composed key is acceptable — note it inline.

- [ ] **Step 7: Empty-name guard — DangerZoneDialog.** In `components/locations/danger-zone-dialog.tsx` (line ~30), harden the match so an empty `expectedName` can never enable the destructive button (defence-in-depth; unreachable today because all call sites disable when `locationName` is empty):

```tsx
const matches =
  expectedName.trim().length > 0 &&
  typed.trim().toLowerCase() === expectedName.trim().toLowerCase()
```

Add a test: with `expectedName=""`, typing nothing keeps the destructive button disabled.

- [ ] **Step 8: Dead-kind removal — console-labels.** In `lib/locations/console-labels.ts`, drop `"repeated_enum"` from `attributeControlKind`'s return union and the `case "REPEATED_ENUM"` (no caller handles the kind; `REPEATED_ENUM` already falls to the read-only note via `default → "unsupported"` in `typed-attribute-control.tsx`). Update `tests/components/console-labels.test.ts`'s `attributeControlKind("REPEATED_ENUM")` expectation from `"repeated_enum"` to `"unsupported"`.

- [ ] **Step 9: Token nits (optional, cosmetic — apply where a matching token exists).** Confirm the token values in `app/globals.css` first, then:
  - `components/ui/checkbox.tsx` (line ~13): replace `rounded-[4px]` with the defined control-radius token (`rounded-(--nr-radius-…)`) **if** a 4px step exists; otherwise leave with an inline note.
  - `components/ui/chart.tsx` (lines ~83/115/162): replace `fontSize: 11` / `fontSize: "0.8125rem"` with the caption type token where one maps; otherwise leave with a note.
  - `components/ui/toast.tsx` (line ~40): the `500ms`/`150ms` swipe/transition literals may be tokenised to `--nr-duration-*` if a matching value exists, **or left with an inline note** that the global reduced-motion rule already covers them (the brief permits leaving these).

- [ ] **Step 10: Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected PASS (component suites green, including the alert-role call-site updates).

- [ ] **Step 11: Commit** — `fix(a11y): landmark regions, label-in-name, variant-aware alert role, editor keys, danger-zone empty-name guard, token nits`.

---

### Task 7: UX-polish — the two visibly-wrong ones first, then the copy/guard fixes

> **No protected-path edit.** All under `components/**` + `lib/format/**` + `lib/inbox/**` + `lib/locations/**`.

**Files:**
- Modify: `lib/locations/console-labels.ts` (U4), `components/locations/photos-tab.tsx` (U5), `lib/format/delta.ts` (U6), `lib/inbox/action-errors.ts` (U1), `components/inbox/action-bar.tsx` (U2), `components/settings/backfill-card.tsx` (U3)
- Test: the relevant component/unit tests

**Interfaces:** no exported-signature changes.

- [ ] **Step 1: U4 — neutral empty fallback (`titleCaseTail`).** In `lib/locations/console-labels.ts`, change the empty-words fallback (line ~7) from the literal `"Category"` to a neutral empty result so an empty verification field never renders "Category". `categoryLabel` always passes a non-empty `name`, so returning `""` for a truly empty tail is safe; the verification labels then render nothing rather than a wrong word:

```ts
if (words.length === 0) return ""   // was: return "Category"
```

Add a test: `verificationMethodLabel("")` / an empty verification value renders no "Category" text; `categoryLabel({ name: "categories/gcid:hotel" })` still returns "Hotel"-style output.

- [ ] **Step 2: U5 — restrict the photos `accept` to images.** In `components/locations/photos-tab.tsx`, the upload always sends `mediaFormat: "PHOTO"` (URL path line ~81 and file-upload line ~95), but the file input `accept` (line ~161) allows video. Restrict it so the picker can't offer an unsupported video:

```tsx
accept="image/jpeg,image/png"
```

(Leaves the two `mediaFormat: "PHOTO"` literals — they are correct for a photo-only editor. Video upload is out of scope; a future editor that supports video would set `mediaFormat` from the chosen file.) Add a test asserting the input's `accept` is image-only.

- [ ] **Step 3: U6 — finite/negative guard on `formatDelta`.** In `lib/format/delta.ts`, mirror `formatDuration`'s guard (`lib/format/duration.ts` line 2: `if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—"`) so a non-finite or negative-from-clock-skew input renders the em-dash, not a bogus signed value:

```ts
export function formatDelta(current, previous, opts = {}) {
  if (current === null || previous === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "—"
  const unit = opts.unit ?? "count"
  const diff = current - previous
  // Duration deltas: a negative underlying value is clock skew, not a real change.
  if (unit === "duration" && (current < 0 || previous < 0)) return "—"
  // …unchanged: ±0, sign, magnitude, unit branches…
}
```

Add unit tests: `formatDelta(NaN, 3)` → `"—"`; `formatDelta(-1, 5, { unit: "duration" })` → `"—"`; the existing happy-path cases unchanged.

- [ ] **Step 4: U1 — missing inbox action-error codes (confirmed set).** In `lib/inbox/action-errors.ts`, add copy for the publish-path codes the inbox can surface that currently fall through to the generic message. The **confirmed** set the publish path emits (grep-verified in `lib/server/publishing.ts`) — add copy for exactly these:

```ts
  review_changed: "The review changed after this draft was prepared. Re-verify the draft and try again.",       // publishing.ts:664
  location_not_verified: "Google has not verified this location yet, so replies cannot be published.",           // publishing.ts:640
  verification_failed: "We could not confirm this reply on Google. Try again shortly.",                          // publishing.ts:647
  verification_required: "This reply needs re-verifying before it can be published. Re-verify and try again.",   // publishing.ts:654
  stale_draft_evidence: "The review changed since this draft was verified. Re-verify the draft.",                // publishing.ts:682
```

**Do NOT add `publish_in_progress`** — it is **not** emitted to the inbox publish path (confirmed absent). Keep the grep-and-add-only-confirmed discipline: if the grep surfaces a code not listed here, add it only with server evidence; never invent copy for a code the client cannot receive.

Add a test in the inbox action-errors unit/component test asserting each of the five codes above maps to plain copy and never renders the raw code (`not.toContain(code)`), mirroring the M8 `console-action-errors` pattern.

- [ ] **Step 5: U2 — honest delete toast.** In `components/inbox/action-bar.tsx`, `onDelete` (lines 115-118) ignores the mutation result and hardcodes `toasts.add({ title: "Published reply deleted", type: "success" })`. The delete mutation (`executeReplyDelete`) returns **two** distinct statuses — `"deleted"` when a live reply was removed, and `"cancelled"` when the reply was never live (`lib/server/publishing.ts:1180`, emitted at `:1293`). So the hardcoded "deleted" copy is dishonest for the `cancelled` case. **First add explicit branches to `describeOutcomeToast`** (`lib/inbox/actions.ts:92`) — which today has NO `deleted`/`cancelled` case, so both currently fall to the default "Reply submitted. Its status will update shortly." (a worse regression than the hardcode):

```ts
// add to describeOutcomeToast's switch:
    case "deleted":
      return { title: "Reply deleted", type: "success" }
    case "cancelled":
      return { title: "Draft reply removed", type: "success" }
```

**Then** route `onDelete` through it:

```tsx
const onDelete = async () => {
  try {
    const result = await remove.mutateAsync()
    toasts.add(describeOutcomeToast(result.status))   // "Reply deleted" (was live) / "Draft reply removed" (never live)
    setDeleteOpen(false)
  } catch (error) {
    toasts.add({ title: describeActionError(error), type: "error" })
  }
}
```

Add a component test: a delete resolving `deleted` → "Reply deleted"; a delete resolving `cancelled` → "Draft reply removed" (never the default "status will update shortly" copy).

> **CODE-WINS note (corrected):** the brief's U2 framing was right — the delete path DOES return `"cancelled"` (never-live) as well as `"deleted"` (`publishing.ts:1180/1293`), and today's `onDelete` hardcodes "Published reply deleted" for both. Routing through `describeOutcomeToast(result.status)` requires **adding** the `deleted`/`cancelled` branches (the map lacks them, so a bare route-through would regress to the non-committal default). Both branches land in `lib/inbox/actions.ts`.

- [ ] **Step 6: U3 — render `lastErrorCode` on the backfill card.** In `components/settings/backfill-card.tsx`, the `failed` status shows only a badge; `BackfillItem` carries `lastErrorCode` (`lib/api/backfill.ts:21`, `z.string().nullable()`). Surface a humanised reason for failed rows (never the raw code — map through the settings/backfill copy layer, or a small inline map; no env-flag/enum text). Example:

```tsx
{item.status === "failed" && item.lastErrorCode ? (
  <span className="text-caption text-destructive">{describeBackfillError(item.lastErrorCode)}</span>
) : null}
```

Add a `describeBackfillError` mapping (or reuse an existing settings copy layer) and a test asserting a failed row shows humanised copy and not the raw `lastErrorCode`.

- [ ] **Step 7: Gate** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected PASS.

- [ ] **Step 8: Commit** — `fix(ux): neutral console fallback, image-only photo accept, delta clock-skew guard, honest inbox error/delete copy, backfill error reason`.

---

### Task 8: Release-bar test wiring — pin `workers: 1`, revive `routing.spec`, retire `review-provider-races`

> **No protected-path edit.** `playwright.config.ts` + `tests/e2e/routing.spec.ts` (revive) + delete `tests/e2e/review-provider-races.spec.ts`.

**Files:**
- Modify: `playwright.config.ts` (`workers: 1`; remove `routing.spec.ts` and `review-provider-races.spec.ts` from `testIgnore`)
- Revive: `tests/e2e/routing.spec.ts` (un-ignore; adapt seeding if needed)
- Delete: `tests/e2e/review-provider-races.spec.ts`

- [ ] **Step 1: Pin `workers: 1`** (§9) in `playwright.config.ts` — add `workers: 1,` alongside `fullyParallel: false` (the config currently sets no `workers` key, leaving Playwright's default; §9 requires the single-worker pin that fixes the `journeys` 8/9-worker CPU-contention flake):

```ts
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/helpers/stub-bridge.ts",
  workers: 1,                 // §9: pin to one worker (deterministic; no cross-spec CPU contention)
  fullyParallel: false,
  // testIgnore updated below…
})
```

- [ ] **Step 2: Retire `review-provider-races.spec.ts`.** It tests the epoch/scope-token state machine that spec §6 explicitly removed ("no bespoke status state machine, no epochs, no queue-scope tokens") — the behaviour it guards no longer exists, so it is deleted, not revived: `git rm tests/e2e/review-provider-races.spec.ts`, and remove `"**/review-provider-races.spec.ts"` from `testIgnore`.

- [ ] **Step 3: Revive `routing.spec.ts`.** Remove `"**/routing.spec.ts"` from `testIgnore`. The spec guards the four legacy redirects (`/overview→/home`, `/reviews→/inbox`, `/analytics→/performance`, `/connections→/settings/connections`) — all already implemented as `redirect()` server pages, `/reviews` and `/connections` forwarding the query string — plus root `/`→`/home` and the sidebar `aria-current`/history assertions. Run it and adapt only if a seeding/session gap surfaces: the dashboard-heading + `aria-current` tests need the shell to render (a resolvable session or local bootstrap); the redirect-only tests just assert the final URL. If the shell tests fail for lack of a session, apply the seeded-owner cookie the DB-backed specs use (`readJourneyState()` + `applyCookie` from `stub-bridge.ts`), matching how `home.spec.ts`/`inbox.spec.ts` authenticate.

- [ ] **Step 4: Run both** — `node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/routing.spec.ts`. Expected: all four routing tests green; the deleted races spec no longer collected.

- [ ] **Step 5: Commit** — `test(e2e): pin workers to 1, revive routing redirects spec, retire the removed provider-races spec`.

---

### Task 9: Revive & adapt `accessibility.spec` + stub-bridge tenant fix + parity-oracle hardening

> **No protected-path edit.** `tests/e2e/accessibility.spec.ts` (revive + adapt) + `tests/e2e/helpers/stub-bridge.ts` (tenant scoping) + `tests/integration/routes/invitation-revoke.test.ts` + `tests/components/console-clients.test.ts` + `playwright.config.ts` (un-ignore accessibility). Depends on Tasks 6/7 (a clean axe).

**Files:**
- Modify: `playwright.config.ts` (remove `accessibility.spec.ts` from `testIgnore`)
- Revive/adapt: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/helpers/stub-bridge.ts` (scope the `/accounts` matcher per tenant)
- Modify: `tests/integration/routes/invitation-revoke.test.ts` (cross-org 404 + non-uuid 400)
- Modify: `tests/components/console-clients.test.ts` (accept_invitation confirmation literal)
- Verify: `tests/components/api-client.test.tsx` (malformed_response — already present)

- [ ] **Step 1: Un-ignore + adapt `accessibility.spec.ts`, ENUMERATING the known drifts** (R7 — adapt to current copy/structure; do not "discover-and-weaken"). Remove `"**/accessibility.spec.ts"` from `testIgnore`. The spec already sweeps the rebuilt routes (`/design-system`, `/inbox`, `/sign-in`, `/forgot-password`, `/reset-password`, `/invite/[token]`, `/home`, `/performance`, `/locations`, `/locations/[id]`, `/settings` + sub-routes) with the WCAG `wcag2a/2aa/21a/21aa/22aa` tag set and **dialogs open** (the delete-published-reply `alertdialog`, the mobile sidebar dialog, the expanded registration form). Apply exactly these adaptations:
  - **Drift (a) — delete-dialog copy.** The spec's assertion for the delete `alertdialog` expects "This removes the reply on Google. The review returns to the inbox as unreplied." but the **current** copy is "This removes your reply from Google. You can write a new one afterwards." (`components/inbox/action-bar.tsx:178-180`). Update the assertion to the current copy (and the title "Delete published reply?").
  - **Drift (b) — pre-auth theming.** The pre-auth surfaces (`/sign-in`, `/forgot-password`, `/reset-password`, `/invite/[token]`) have **no** "Toggle theme" control, so the both-themes sweep cannot click a toggle there. Set the theme via `page.addInitScript` before navigation, writing the `next-themes` persisted value (default `localStorage` key `"theme"`; **confirm the `storageKey`/`attribute` in `components/theme-provider.tsx`** and match it), then run axe. On the authenticated dashboard surfaces the existing "Toggle theme" control is fine.
  - **Both themes:** with (b) in place, run the axe sweep in dark as well as light across all listed surfaces (today only `/design-system` runs dark) — parametrise the describe over `["light","dark"]`. This is the §9 "dark-mode product scan" obligation.
  - **Label-in-Name:** `label-content-name-mismatch` is already active via the `wcag21a` tag (no rule pin needed) — reviving the sweep is what enforces it. Task 6 Step 1 (the composer `aria-label`) is exactly such a hit; confirm the sweep passes now that Task 6 landed.
  - **Any further surfaced hit:** fix inline (preferred, if small) or record a scoped exclusion with a one-line justification + a carry-forward — **NEVER silently `.disableRules` a WCAG A/AA rule** to make the sweep pass.

- [ ] **Step 2: Fix the stub-bridge `/accounts` tenant bug.** In `tests/e2e/helpers/stub-bridge.ts`, two handlers register the identical matcher `{ method: "GET", pathIncludes: "/accounts" }` — the approval-tenant handler (registered second) shadows the primary via last-registered-wins, so a primary-org `/accounts` list returns the approval account name. Scope each matcher to its tenant the way the sibling `locations` matchers already are (`pathIncludes: \`/${connection.googleAccountName}/…\``). Because the raw Google `accounts.list` path is `/accounts` (no account segment), discriminate on the connection instead — e.g. register the primary `/accounts` handler to return the primary account and the approval one to return the approval account, keyed by a per-connection request signal the stub can see, or (simplest) register a single `/accounts` handler that returns **both** accounts so either org resolves its own. Add/extend a bridge assertion that a primary-org accounts call resolves the primary account name.

- [ ] **Step 3: Harden invitation-revoke (cross-org 404 + non-uuid 400).** In `tests/integration/routes/invitation-revoke.test.ts`, add two cases against `DELETE /api/invitations/[token]` (which already enforces both — `withTenant`-scoped delete → 404 for another org's id; `z.uuid().parse(token)` → 400 `invalid_request` for a non-uuid):

```ts
it("cannot revoke an invitation from another organisation (404)", async () => {
  const orgA = await createTestTenant(admin, { role: "owner" }); organisations.push(orgA.organisationId)
  const orgB = await createTestTenant(admin, { role: "owner" }); organisations.push(orgB.organisationId)
  const inviteB = await createInvitation(orgB.cookie, "cross@nabapresence.test")
  const res = await revoke(orgA.cookie, inviteB.id)   // orgA tries to revoke orgB's invite
  expect(res.status).toBe(404)
  expect(((await res.json()) as { error: string }).error).toBe("invitation_not_found")
})

it("rejects a non-uuid invitation id (400 invalid_request)", async () => {
  const tenant = await createTestTenant(admin, { role: "owner" }); organisations.push(tenant.organisationId)
  const res = await revoke(tenant.cookie, "not-a-uuid")
  expect(res.status).toBe(400)
  expect(((await res.json()) as { error: string }).error).toBe("invalid_request")
})
```

- [ ] **Step 4: `accept_invitation` confirmation-literal regression test.** In `tests/components/console-clients.test.ts` (which currently pins `delete_admin`/`delete_location` but not this), add an assertion that the administration confirmation map is byte-identical to the server for `accept_invitation`:

```ts
expect(ADMINISTRATION_CONFIRMATIONS.accept_invitation).toBe("accept_google_invitation")
```

- [ ] **Step 5: Verify `malformed_response` coverage.** Confirm `tests/components/api-client.test.tsx` still asserts a schema-mismatched 200 → `ApiClientError { code: "malformed_response" }` and a non-JSON error body → `http_error` (both present today). Add a case only if a gap is found; otherwise no change.

- [ ] **Step 6: Run the affected suites** — the revived accessibility spec (`node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/accessibility.spec.ts`), the invitation-revoke integration file, and the `console-clients` component test. Expected: all green; the accessibility sweep passes in both themes with dialogs open.

- [ ] **Step 7: Commit** — `test: revive+adapt the a11y sweep (both themes), fix the stub-bridge accounts tenant scoping, harden invitation-revoke and console confirmation coverage`.

---

### Task 10: Release-bar gate

> **No protected-path edit.** The terminal verification. The whole-branch review is the controller's, not a task step.

**Files:** none (verification only).

- [ ] **Step 1: Full local gate.**
  ```
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  node scripts/run-test-command.mjs e2e pnpm exec playwright test
  node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
  ```
  Expected: typecheck/lint clean; unit + component green; clean production build; **every** e2e spec green — `auth`, `connections-oauth`, `foundation`, `gbp-management-tabs`, `home`, `inbox`, `journeys`, `locations`, `performance`, `settings`, plus the **revived** `routing` and `accessibility` (12 specs; `review-provider-races` retired); integration parity oracle green.

- [ ] **Step 2: Confirm the protected footprint is exactly the five sanctioned files.**
  ```
  git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts
  ```
  Expected: exactly `app/api/locations/[id]/posts/[postId]/approval/route.ts`, `lib/server/password-auth.ts`, `next.config.ts`, `app/api/privacy/export/route.ts`, `lib/server/capabilities.ts` — and **nothing** under `lib/domain`, `supabase`, `scripts`, or `instrumentation.ts`.

- [ ] **Step 3: Audit Critical/High closure checklist.** Confirm each closed and reproducible-free:
  - **SEC-1** — posts reject branch now `requireLocationAccess`-guarded (Task 1; integration test proves the cross-location member gets 404).
  - **D3 auth enumeration** — login `email_not_verified` + 429 normalised to generic `invalid_credentials` (Task 2; unit + component tests).
  - **S3 security headers** — Referrer-Policy / X-Frame-Options / X-Content-Type-Options / conservative CSP present on every response, build clean, e2e console-clean (Task 3).
  - **Privacy PII-in-URL** — export is POST-only; no `?subject=` path remains (Task 4).
  - **canRequestApproval / no reachable dead-end** — non-publishers in approval-required orgs can submit for approval (Task 5, D2).
  - **Legacy redirects** — guarded by the revived `routing.spec` (Task 8).
  - **A11y** — the repo-wide axe sweep (both themes, dialogs open, Label-in-Name) is green (Tasks 6 + 9).
  - **Quarantined tests** — `routing.spec` + `accessibility.spec` revived; `review-provider-races.spec` retired with recorded reason (Tasks 8/9).

- [ ] **Step 4: Confirm the standing e2e guard is intact and unweakened** — the zero-console-error / zero-pageerror + axe (incl. heading-order) guard still runs on every route in both themes; no guard was relaxed to pass (any CSP-driven relaxation from Task 3 is a *directive* relaxation, not a guard relaxation, and is recorded).

- [ ] **Step 5: Hand off to the controller** for the whole-branch review + merge. Record the single documented exception (D1, §5 server-hydration) as the sole tracked fast-follow (see exit criteria). Do NOT self-merge.

---

## Milestone 9 exit criteria

The §10 release bar, item by item:

- **All suites green:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + component), `pnpm build` clean; the integration parity oracle green (with the five sanctioned edits landed — no existing integration test regressed; `review-capabilities`, `invitation-revoke`, `privacy-fulfilment`, and the new `post-approval-access` tests updated/added); and **every enabled e2e spec** green — the 10 already-enabled specs **plus the revived `routing.spec` and `accessibility.spec`** (12 total). `review-provider-races.spec` is deliberately **retired** (it guards the epoch/scope-token machine §6 removed), recorded here as the one quarantined spec that is retired rather than revived.
- **Zero reproducible Critical/High audit findings:** SEC-1 (per-location authorisation on the posts reject branch), D3 (sign-in enumeration normalised), S3 (security headers), privacy PII-in-URL (export POST-only), and D2/canRequestApproval — each closed with a pinned test and confirmed reproducible-free (Task 10 Step 3).
- **Legacy redirects restored/guarded:** the four redirects (`/overview→/home`, `/reviews→/inbox`, `/analytics→/performance`, `/connections→/settings/connections`, the last two forwarding the query string) exist as `redirect()` server pages and are now guarded by the live `routing.spec`.
- **The standing e2e guard is intact and unweakened:** zero-console-error / zero-pageerror + axe (incl. heading-order) on every route in both themes.
- **Protected footprint is exactly five files:** `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` lists only the sanctioned SEC-1 route, `password-auth.ts`, `next.config.ts`, privacy `export/route.ts`, and `capabilities.ts`. `lib/domain`, `supabase`, `scripts`, `instrumentation.ts` untouched. No new npm dependency; M1 tokens only.
- **§5 server-hydration is DEFERRED as a documented, tracked post-release fast-follow (D1)** — the ONE thing M9 intentionally ships without. The retrofit (extract ~10 inline-SQL read-services from analytics/counts/members/invitations/privacy/legal-holds; wire ~18 pages; connections/inbox-list/location-tabs services already exist) seeds the same Query keys additively and is guarded by the subset-matching integration oracle. It is NOT a release-bar blocker; it is recorded here and handed to the controller as the sole carry-forward.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Whole-branch review** with findings fixed — the controller's, performed after Task 10 hands off (not a task step).

## Self-review

- **Spec coverage.** §10 release bar → Tasks 1–10 (every clause mapped in the exit criteria). §9 testing/a11y → `workers: 1` (Task 8), the per-role no-reachable-403 walk and publish/danger-zone journeys (already in `locations.spec`; SEC-1 adds the reject-authorisation integration test), the repo-wide axe sweep in both themes with dialogs open + Label-in-Name (Task 9), the parity oracle staying green (Tasks 1/4/5 re-run it). §8 auth "resend from the unconfirmed-login state" was in tension with D3 — **resolved** in Task 2 Step 5 by restoring it as a generic, always-visible, enumeration-safe resend affordance (not tied to any error code). §3 capability additions → `canRequestApproval` (Task 5, the only new capability). §5 rendering model → **deferred (D1)**, recorded as the single tracked fast-follow, not built.
- **Placeholder scan.** No "TBD"/"similar to Task N"/bare "add error handling". Each protected edit carries the exact reference implementation grounded in the real file (SEC-1 guard placement, the `mapLoginFailure`/`signInWithPassword` normalisation, the `headers()` block + CSP, the GET→POST route + client, the `canRequestApproval` computation). The a11y/token/UX nits each name the exact file + line + the exact change. Two step families are deliberately conditional and say so honestly: U1 (add inbox codes **only** for codes the grep confirms the server emits) and the Task 6 token nits (tokenise **only** where a matching `--nr-*` value exists, else leave with a note) — these are honest guards, not placeholders.
- **Type consistency.** `ReviewCapabilities { canPublish, canEdit, canRequestApproval }` is identical across `lib/server/capabilities.ts`, the client `capabilitiesSchema` (`lib/api/reviews.ts`), `evaluateRequestApproval` (`lib/inbox/actions.ts`), and `ActionBar`. `requireLocationAccess(sql, session, locationId)` matches its definition. `exportPrivacyData(subject)` keeps its signature (only the transport changes). The genericLoginFailure error is `ApiError(401, "invalid_credentials", …)` — the same shape the wrong-password path already throws.
- **Parity-oracle safety.** Task 1 adds a guard call (no schema/shape change); Task 4 moves a method (integration test updated); Task 5 adds a field to `ReviewCapabilities` returned whole by two routes (no route edit; the client schema + the `review-capabilities` integration expectations updated — test files, non-protected). **`app/api/reviews/route.ts:139-142`'s inline `?? { canPublish, canEdit }` fallback stays BYTE-IDENTICAL** (R5 — it typechecks as an unannotated union and is unreachable; completing it would make a 6th protected edit). Every other integration test is byte-identical. Re-run the full integration suite after Tasks 1/4/5.

- **Where CODE CONTRADICTED THE BRIEF (recorded for the controller):**
  1. **SEC-1 semantics.** `requireLocationAccess` throws **404 `review_not_found`** (not 403), and a member with **zero** assignments *passes*; only a member assigned **elsewhere** is blocked. The live gap is a **cross-location, same-org** reject (RLS scopes the org, not the member's location grants), so the pinned test is "member-assigned-elsewhere → 404" (today it succeeds), not "unassigned member". Owner/admin/assigned-member proceed unchanged.
  2. **D3 ↔ spec §8 conflict — RESOLVED.** Spec §8 asks for "resend-confirmation from the unconfirmed-login state", and the client maps `email_not_verified` → `action: "resend-confirmation"`. D3 normalises `email_not_verified` away from the login path, which removes the error-tied resend. **Resolution (baked into Task 2 Step 5):** restore §8 with a GENERIC, always-visible "Resend confirmation email" affordance on the sign-in surface, not conditioned on any error code — enumeration-safe because `resendConfirmationEmail` swallows all provider errors and surfaces only a generic 429 (`password-auth.ts:317-350`). Satisfies both §8 and D3, strictly better than dropping.
  3. **D3 429 collapse.** Truly closing the timing channel means folding the login **429 into the generic 401** (losing explicit "too many attempts" feedback on sign-in). Sign-up / reset / resend 429s are **not** touched (they carry their own documented enumeration rationale in `password-auth.ts`). Flagged as a deliberate UX trade.
  4. **Redirects are not in `next.config`.** The four legacy redirects are `redirect()` server pages (already implemented; `/reviews` + `/connections` forward the query). So T3's `headers()` is purely additive and T8's `routing.spec` revival needs **no** redirect code — likely only seeded-session wiring for the shell assertions.
  5. **Privacy export card needs no change.** The brief says "the client (`lib/api/privacy.ts` + the compliance export card) repoints". Only `lib/api/privacy.ts` changes; `privacy-export-card.tsx` delegates to `exportPrivacyData(subject)` (unchanged signature) and is untouched. Also `tests/integration/routes/privacy-fulfilment.test.ts:295` **must** be updated (it currently hits `GET …?subject=`).
  6. **`canRequestApproval` needs a NEW org read.** `capabilities.ts` has **no** approval concept today; the real predicate lives in `lib/server/publishing.ts:687-696` and reads the org `approval_required` column. Encoded as `canEdit && !canPublish && approval_required`. Adding the field ripples to the client zod schema and the `review-capabilities` integration expectations (both non-protected) — a wider test touch than a pure server-only additive.
  7. **U2 — brief was RIGHT.** The delete path DOES return `"cancelled"` (never-live) as well as `"deleted"` (`publishing.ts:1180/1293`); `onDelete` hardcodes "Published reply deleted" for both. But `describeOutcomeToast` (`lib/inbox/actions.ts:92`) has **no** `deleted`/`cancelled` case, so a bare route-through would regress both to the non-committal default. The fix (Task 7 Step 5) **adds** `deleted` → "Reply deleted" and `cancelled` → "Draft reply removed" branches, then routes `onDelete` through `describeOutcomeToast(result.status)`.
  8. **Label-in-Name already active.** `label-content-name-mismatch` is enabled via the `wcag21a` tag in `accessibility.spec` (no rule pin to "add"); reviving the sweep is what enforces it. Fixing the composer `aria-label` (Task 6) removes the one obvious hit.
  9. **`repeated_enum` dead code** lives in `console-labels.ts` (the returned kind), not a branch in `typed-attribute-control.tsx` (which has no such branch). The fix + its test edit are in `console-labels.ts` / `console-labels.test.ts`.

- **Ambiguity resolutions (baked in by the plan-review — recorded for the executor):**
  1. **§8-vs-D3 resend — RESOLVED:** add a generic, always-visible, enumeration-safe "Resend confirmation email" affordance on the sign-in surface (Task 2 Step 5), not tied to any error code. Restores §8 and satisfies D3.
  2. **CSP — RESOLVED:** conservative-with-`'unsafe-inline'` is the right release-bar call (nonce-tightening is a documented follow-up), **with R1's `img-src` fix** — the Google media origins (`*.googleusercontent.com`, `*.ggpht.com`) MUST be on the allow-list or client-rendered thumbnails break, and the `media: []` e2e fixtures would NOT catch it (Task 3 adds a dedicated remote-thumbnail render test).
  3. **`approval_required` — CONFIRMED canonical:** the plan reads `organisation.approval_required` (the column the publish path reads at `publishing.ts:602/693`); `require_two_person_approval` is a distinct, separately-read column and is not the `canRequestApproval` predicate.
  4. **U1 code set — RESOLVED:** the confirmed inbox publish-path codes are `review_changed`, `location_not_verified`, `verification_failed`, `verification_required`, `stale_draft_evidence` (Task 7 Step 4). `publish_in_progress` is NOT emitted → omitted. Grep-and-add-only-confirmed discipline retained.
  5. **`review-provider-races.spec` deletion — CONFIRMED correct** (guards the epoch/scope-token machine §6 removed).
- **Residual judgement for the executor (not blockers):**
  - **Accessibility sweep pre-existing hits (Task 9).** Beyond the two enumerated drifts (delete-dialog copy; pre-auth `addInitScript` theming), the both-themes sweep may surface further pre-existing WCAG A/AA violations. Policy: fix-inline (preferred) or a scoped exclusion + one-line justification + carry-forward — NEVER silently disable a WCAG A/AA rule.
  - **CSP host confirmation (Task 3).** Verify the exact Google media hosts in the stored `thumbnailUrl` values and add any beyond `*.googleusercontent.com` / `*.ggpht.com`.
