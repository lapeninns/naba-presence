# M4 Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Inbox — the core cross-location review journey — as a URL-driven, capability-gated, dirty-guarded split-pane (queue tabs + filters + list + detail + verification-transparent reply composer + publish/approve/reject action bar), on the M1 foundation, closing the audit-flagged flow defects in spec §8.

**Architecture:** A single `app/(dashboard)/inbox/page.tsx` server page renders one client feature root (`InboxView`) that reads all state from `searchParams` (queue, filters, search, selected review). Reads go through TanStack Query over the M1 typed client (`apiFetch` + zod); the list uses `useInfiniteQuery` with `keepPreviousData`, detail uses a per-id query. All writes are server-confirmed mutations that invalidate `reviewCounts`/`reviews`/`reviewDetail`. Per-review capabilities (`canPublish`/`canEdit`) are computed server-side by the one sanctioned backend addition (`lib/server/capabilities.ts`) and embedded additively in the list/detail responses; the client gates Publish/Approve/Regenerate on them with disabled-state reasons. A React error boundary isolates the detail pane. No server prefetch/dehydration this milestone (deferred carry-forward).

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives (1.6.0), TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m4-inbox` (cut from `main` @ `bca471e`). Delivery model is **per-milestone merge to `main`** (spec §10, amended after M1). `main` therefore serves a partially-rebuilt product: the three non-`/home`/`/inbox` sidebar links still 404 until their milestones land.
- **No new dependencies** in this milestone. Every primitive Inbox needs already exists in `@base-ui/react` (`tabs`, `select`, `combobox`, `menu`, `alert-dialog`, `avatar`, `separator`, `scroll-area`, `input`, `field`); `date-fns` and `react-day-picker` are already dependencies.
- **Protected paths — do NOT touch except the ONE sanctioned edit-set enumerated in Task 1**: `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. **Consume only.** Task 1's sanctioned edits are exactly three files: `lib/server/capabilities.ts` (NEW), `app/api/reviews/route.ts` (additive `capabilities` field per row), `app/api/reviews/[id]/route.ts` (additive `capabilities` + `latestVerification` fields on the review). **Every other file under those paths — including `app/api/reviews/counts/route.ts`, `app/api/reviews/[id]/drafts/route.ts`, `.../publish/route.ts`, `.../approval/route.ts`, `.../reply/route.ts`, `app/api/drafts/[id]/verify/route.ts`, `lib/server/permissions.ts`, `lib/server/reviews-query.ts`, `lib/domain/workflow.ts`, `lib/domain/verification.ts` — stays byte-identical.** The parity oracle (the untouched backend integration suite) must stay green (spec §9).
- Styling: M1 tokens only. No raw hex, no `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N`. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`). Every newly-admitted primitive is restyled once on entry per the M1 policy (one control chrome, one focus ring, a11y-by-construction).
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`, mirroring `lib/api/connections.ts`). TanStack Query hooks carry `staleTime: 30s` (spec §6); the **list** query adds `keepPreviousData` (`placeholderData: keepPreviousData`). Mutations invalidate their keys — counts/rows/detail update within one round trip. All writes go through the typed client via `ApiClientError { status, code, details }`; server codes map to user copy through one mapping layer (`lib/inbox/action-errors.ts`) — no component invents its own error text.
- Copy: GB English, sentence case, no internal jargon, no env-flag names, **no error codes shown to users**.
- Every page renders exactly one `<h1>` and exactly one `<main>` (both owned by `PageFrame`/`PageHeader`; feature components add only `<h2>` and below).
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Reference-only history: `git show 4391dcb:<path>` retrieves any pre-rebuild file (last commit before the rebuild deletion); `git show 33e06a1:<path>` retrieves the deleted legacy inbox components (the parent of deletion commit `77dcfee`). Reference the look and the information architecture; **do not re-admit the code** (it used the deleted epoch/scope-token machinery, `toast.add`, and React `useState` for filters — all replaced here).
- The gate command (Task 10): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`.

## Design decisions (LOCKED — encode exactly)

- **D1 — Rendering model.** CLIENT-FETCH via TanStack Query (same as M3 Home). No server-prefetch/dehydrate for the inbox list/detail: no reusable `lib/server` review read-service exists (the routes embed inline SQL through `withTenant`; `buildInboxQuery` is the closest but is coupled to the list route), and extracting one is out of M4 scope. Server-side hydration per spec §5 is **DEFERRED** (carry-forward, closed by whichever later milestone extracts the review read-services). Data hooks inherit `staleTime: 30s`; the list query adds `keepPreviousData`.
- **D2 — Routing.** A SINGLE `app/(dashboard)/inbox/page.tsx` route (client split-pane, list + detail). The selected review AND all filters live in **searchParams** (spec §6) — NOT a nested `/inbox/[reviewId]` route. Selection uses `router.push` (Back returns to the previous selection / the list on mobile); filters use `router.replace`. The spec §5 "isolation boundary around the review detail pane" is a **React error boundary component** wrapping the detail pane (one route ⇒ not a route-segment `error.tsx`); M4 builds it as `components/inbox/detail-error-boundary.tsx`. Cold load streams skeleton rows via `app/(dashboard)/inbox/loading.tsx`.
- **D3 — Capabilities (the ONE sanctioned protected-path edit — spec §3).** Build `lib/server/capabilities.ts` computing a per-resource capability object (`canPublish`, `canEdit`) that MIRRORS `lib/server/permissions.ts` (`canPublishLocation`, `requireLocationAccess`) EXACTLY. Embed **per-review** capability fields into the reviews LIST rows and the DETAIL response as an ADDITIVE `capabilities: { canPublish, canEdit }` object, and additionally embed an ADDITIVE `latestVerification: { verdict, reasons } | null` on the DETAIL response (the latest draft's latest `verification_result`, so the composer shows reasons on load — D9). Both must not break the backend integration suite (the parity oracle). Sanctioned edits: `lib/server/capabilities.ts` (new), and additive wiring in `app/api/reviews/route.ts` (capabilities) + `app/api/reviews/[id]/route.ts` (capabilities + latestVerification). Counts route is NOT touched. Every other protected file stays byte-identical. The client gates Publish/Approve/Regenerate on these per-review fields with disabled-state reasons. **This task is flagged explicitly for whole-branch-review scrutiny (M4's analog of M2 Task 2).**
- **D4 — URL vocabulary.** Client URL params are **camelCase** (honouring Home's `?locationId=` contract): `queue`, `locationId`, `rating`, `search`, `sort`, `selected`, `replyState`, `verification`, `publishStatus`, `syncStatus`, `dateFrom`, `dateTo`. A mapping helper (`lib/inbox/url-state.ts`) parses/serialises these and translates to the backend's snake_case wire names (`location_id`, `reply_state`, `publish_status`, `sync_status`, `date_from`, `date_to`, `status`) at the `apiFetch` boundary (in `lib/api/reviews.ts`). `queue` is a first-class param (`all|needs_reply|awaiting_approval|escalated|published`) mapped to backend `status` filters via `QUEUE_STATUS_MAP` (reproducing the legacy queue→statuses mapping). On load, `?locationId=` from Home is consumed as the initial location filter. The counts endpoint takes `locationId` camelCase directly (it already does).
- **D5 — Pagination.** Cursor "Load more" via `useInfiniteQuery` (its `pageParam` IS component state: it resets whenever the query key — i.e. any filter — changes, and does not live in the URL). Selection is a URL searchParam. `placeholderData: keepPreviousData` on the list query.
- **D6 — Dirty guard.** M4 BUILDS the shared generic `useDirtyGuard` hook (`lib/hooks/use-dirty-guard.ts`, spec §6; shared with future hours/menu/post editors). It suppresses list-driven selection changes while dirty (confirm-before-navigate), arms `beforeunload`, and mirrors content to the sessionStorage stash via the EXISTING `lib/api/draft-stash.ts` (`registerDraftSource`/`stashAllDrafts`/`takeStashedDraft` — reuse, do not reinvent). Dedicated unit tests (spec §9).
- **D7 — Mutations.** ALL server-confirmed with per-action pending on the initiating button. NO optimistic publish (an `ambiguous`/`failed` provider outcome must never render as published). On success invalidate `reviewCounts` + `reviews` + `reviewDetail`. Surface exact server outcomes/errors through `lib/inbox/action-errors.ts`: 202 awaiting_approval → "Reply submitted for approval."; 200 published → "Reply published"; 403 `second_approver_required` → the exact copy **"A different authorised user must approve this reply."**; 409 `stale_draft_evidence` → force re-verify; 502 `google_mutation_ambiguous` → "Google may have applied the reply. Check its status before retrying."; `verified_draft_required`, `approval_not_pending`, `publish_permission_required`, 503 `drafts_paused`/`publishing_paused` each get plain-English copy. No error code is ever shown.
- **D8 — Draft lifecycle.** ONE endpoint `POST /api/reviews/[id]/drafts` is Generate/Regenerate/Save — the client differentiates by presence of `body` (human edit) vs omitted (AI/template). Label "Generate draft" vs "Regenerate" by workflow status. Regenerate-over-edits CONFIRMS (`AlertDialog`) when the composer is dirty. Re-verify without regenerating via `POST /api/drafts/[id]/verify`.
- **D9 — Verification reasons.** Render the actual `VerificationReason[]` (`code`/`severity`/`message`) as a list near the composer AND in the verification/lifecycle panel (spec §8), on load as well as after a mutation — the detail response carries an additive `latestVerification: { verdict, reasons }` (D3) that seeds the panel so a pre-existing Failed/Review-needed review shows its reasons without forcing a re-verify. Verdict badge: pass→"Passed", warn→"Review needed", fail→"Failed", pending→"Pending". NO text-span annotation (backend gives no offsets).
- **D10 — States.** Cold load = skeleton rows (never empty). Empty copy distinguishes no-data (counts `total === 0`, no filters active) / filtered-out (items empty, filters active or counts `total > 0`) / disconnected (`useConnectionHealth()` → `disconnected`). loading/empty/error/mutation-failure each tested.
- **D11 — Action enablement.** Derive "action applies given state" from `lib/domain/workflow.ts`'s transition table (client-safe import) in `lib/inbox/actions.ts`, combined with the D3 per-review capability fields — a single source of truth for "action applies given state" × "user may do it".
- **D12 — Details.** Roving tabindex + arrow-key nav on the list; dates include the year when needed (`lib/format` `formatDate`/`formatDateTime`, org timezone); GB English; one h1/one main; M1 tokens.
- **D13 — Primitives.** Admit only what Inbox uses, each folded into first use: `Tabs`, `Select`, `Combobox`, `Avatar`, `Empty` (Task 4); `Textarea` (Task 6); `DropdownMenu` (base-ui `menu`), `AlertDialog` (Task 7). `Sheet` (Task 8) is already admitted — reuse. `Separator`/`ScrollArea` are deliberately NOT admitted (native borders + `overflow-y-auto` cover the list/detail scroll, keeping the primitive surface minimal). Use the CURRENT `components/ui/toast.tsx` API (`useToastManager().add(...)`), NOT the legacy `toast.add`.
- **D14 — Carry-forwards to close.** Re-enable the two `it.skip` integration tests in `tests/integration/routes/sign-in.test.ts` (now `/inbox` exists); add `app/reviews/page.tsx` redirect `/reviews → /inbox` FORWARDING the query string; flip `components/app-shell/nav.tsx` `/inbox` to `prefetch: true`; harden `components/app-shell/app-shell.tsx` `useSessionReady`'s `fetch("/api/session")` with a timeout/abort; un-quarantine `inbox.spec.ts` + `journeys.spec.ts` from `playwright.config.ts` (adapt). LEAVE `review-provider-races.spec.ts` quarantined (it tests the deleted epoch/scope-token mechanism) — note it for M9 (re-author vs delete).
- **D15 — Milestone e2e (spec §9).** Adapt `inbox.spec.ts` + `journeys.spec.ts` to the URL-driven capability-gated UI; ADD a zero-console-error + zero-pageerror guard on `/inbox` in BOTH themes; a per-role permission walk; a publish journey and an approver journey; dirty-draft survival. Reuse/extend the existing `tests/e2e/helpers/stub-bridge.ts` fixture for seeded review data.
- **D16 — Out of scope for M4 (explicit).** No `/locations/[id]/reviews` sub-view (M5+ — the legacy `journeys.spec.ts`'s `verifyLocationScopedQueue` walk is deferred, not ported). Server-hydration/dehydrate for inbox (deferred carry-forward). Re-authoring `review-provider-races` race coverage (M9). The Settings/Performance/Connections legs of the legacy `journeys.spec.ts` belong to M6/M7 and are re-assembled into a single cross-surface journey at M9.

## File structure

```
lib/server/
  capabilities.ts                 NEW (SANCTIONED, protected): per-review canPublish/canEdit, mirrors permissions.ts
app/api/reviews/
  route.ts                        MODIFY (SANCTIONED, additive): capabilities per row
  [id]/route.ts                   MODIFY (SANCTIONED, additive): capabilities on review
lib/api/
  reviews.ts                      NEW: list + detail zod schemas (incl. capabilities), fetchReviews/fetchReviewDetail, wire mapping
  drafts.ts                       NEW: generateOrSaveDraft, verifyDraft
  publish.ts                      NEW: publishReview
  approval.ts                     NEW: decideApproval
  reply.ts                        NEW: deletePublishedReply
  locations.ts                    NEW: fetchLocations (GET /api/location-links)
  review-counts.ts                MODIFY: accept optional locationId
lib/inbox/
  url-state.ts                    NEW: parse/serialise camelCase URL state; QUEUE_STATUS_MAP; queueToStatuses
  actions.ts                      NEW: workflow+capability-derived action availability (D11)
  action-errors.ts               NEW: ApiClientError.code -> user copy (D7)
lib/queries/
  use-reviews.ts                  NEW: useInfiniteQuery, keepPreviousData
  use-review-detail.ts            NEW: useQuery per id
  use-review-counts.ts            MODIFY: accept locationId, scope the key
  use-draft-mutations.ts          NEW: generate/save + verify mutations (Task 6)
  use-publish-review.ts           NEW (Task 7)
  use-approval-decision.ts        NEW (Task 7)
  use-delete-reply.ts             NEW (Task 7)
lib/hooks/
  use-dirty-guard.ts              NEW (Task 6): shared dirty guard
components/ui/
  tabs.tsx avatar.tsx select.tsx combobox.tsx empty.tsx   NEW (Task 4)
  textarea.tsx                    NEW (Task 6)
  alert-dialog.tsx dropdown-menu.tsx  NEW (Task 7)
components/inbox/
  inbox-view.tsx                  NEW (Task 4): client root; searchParams; split-pane; auto-select; dirty-suppress
  queue-tabs.tsx                  NEW (Task 4)
  review-filters.tsx              NEW (Task 4): queue tabs + search + location + rating + sort
  review-list.tsx                 NEW (Task 4): roving tabindex + arrow keys; region "Review list"
  empty-states.tsx               NEW (Task 4): no-data / filtered-out / disconnected
  review-detail.tsx               NEW (Task 5): conversation + media; region "Selected review"
  verification-panel.tsx          NEW (Task 5): verdict badge + VerificationReason[] list
  activity-timeline.tsx           NEW (Task 5): actorName timeline
  detail-error-boundary.tsx       NEW (Task 5): React error boundary around the detail pane
  reply-composer.tsx              NEW (Task 6): tone/language, byte counter, Generate/Regenerate, dirty guard
  more-filters-sheet.tsx          NEW (Task 8): date range + reply/verification/publish/sync + chips
app/(dashboard)/inbox/
  page.tsx                        NEW (Task 4): server page -> <InboxView/>
  loading.tsx                     NEW (Task 4): skeleton rows
components/inbox/action-bar.tsx   NEW (Task 7): Publish/Approve/Reject/Delete, capability-gated
app/reviews/page.tsx              NEW (Task 9): /reviews -> /inbox redirect (forwards query string)
components/app-shell/nav.tsx      MODIFY (Task 9): /inbox prefetch: true
components/app-shell/app-shell.tsx MODIFY (Task 9): harden useSessionReady fetch with timeout/abort
tests/integration/routes/review-capabilities.test.ts  NEW (Task 1)
tests/integration/routes/sign-in.test.ts              MODIFY (Task 9): un-skip the two /inbox tests
playwright.config.ts                                  MODIFY (Task 9/10): un-ignore inbox + journeys specs
tests/e2e/helpers/stub-bridge.ts                      MODIFY (Task 10): seed approval-required tenant + member/viewer
tests/e2e/inbox.spec.ts, tests/e2e/journeys.spec.ts   REVIVE + adapt (Task 10)
tests/components/*.test.tsx                            NEW per task
```

Backend response shapes consumed (READ-ONLY unless Task 1 sanctions the edit):
- `GET /api/reviews?…` → `{ items: Row[], nextCursor: string|null }`. Row (from `buildInboxQuery`, plus Task 1's additive `capabilities`): `id, location:{id,name}, reviewer:{displayName,isAnonymous}, rating|null, text|null, detectedLanguageCode|null, languageConfidence|null, createTime, updateTime, hasMedia, workflowStatus, draftId|null, draftBody|null, verificationStatus|null, replyStatus|null, googleReplyState|null, googlePolicyViolation|null, replyBody|null, syncStatus|null, capabilities:{canPublish,canEdit}`. Wire params: `location_id, rating(csv), status(csv), reply_state, verification(csv), publish_status(csv), sync_status(csv), date_from, date_to, search, sort, page_size, cursor`.
- `GET /api/reviews/counts?locationId=<id>` → `{ total, byStatus: Record<9 states, number> }` (zero-filled).
- `GET /api/reviews/[id]` → `{ review: { id, reviewerDisplayName, reviewerIsAnonymous, rating|null, text|null, detectedLanguageCode|null, languageConfidence|null, createTime, updateTime, hasMedia, workflowStatus, locationId, locationName, timezone, verified, media:[{id,thumbnailUrl,thumbnailLabel,videoUrl}], drafts:[{id,source,body,bodyBytes,evidenceHash,modelName,verificationStatus,createdAt}], reply:{id,body,publishStatus,googleReplyState,googlePolicyViolation,googleReplyUpdatedAt}|null, timeline:[{action,createdAt,actorName,metadataSummary}], capabilities:{canPublish,canEdit}, latestVerification:{verdict,reasons}|null } }` (the last two additive — Task 1).
- `POST /api/reviews/[id]/drafts` → 201 `{ draftId, body, bodyBytes, evidenceHash, verification:{id,verdict,reasons} }`. `verdict∈'pass'|'warn'|'fail'`; `reasons:VerificationReason[]={code,severity:'warn'|'fail',message}`.
- `POST /api/drafts/[id]/verify` → `{ verification:{id,verdict,reasons} }`.
- `POST /api/reviews/[id]/publish` (body `{draftId,expectedReviewUpdateTime}`) → 202 `{reviewReplyId,publishAttemptId,status,googleReplyState}` | 200 `{…,idempotent}`. 502 `google_mutation_ambiguous`; 429/409 `google_publish_failed`; 503 `publishing_paused`; 409 `stale_draft_evidence`.
- `POST /api/reviews/[id]/approval` (body `{decision,note?}`) → reject 200 `{status:'returned_to_draft'}`; approve 200 `{status,googleReplyState,publishAttemptId,reviewReplyId,idempotent}`. 409 `approval_not_pending`; 403 `publish_permission_required`; 403 `second_approver_required`; 409 `verified_draft_required`.
- `DELETE /api/reviews/[id]/reply` → `{status:'deleted'|'cancelled',publishAttemptId}`. 502 `google_mutation_ambiguous`.
- `GET /api/location-links` → `{ locations:[{id,name,googleLocationName?}] }` (default view, name-ordered, role-scoped).

**Dependency chain:** Tasks **1 → 2 → 3** are a hard sequential chain (capabilities shape → clients → hooks). After Task 3 lands, Tasks **4, 5, 8, 9** can run substantially in parallel. Task **6** depends on Task 4's `InboxView`/list and Task 5's detail scaffolding. Task **7** depends on Tasks 5 and 6. Task **10** is the terminal gate. **Task 1 is the only protected-path task.**

---

### Task 1: Capabilities backend — `lib/server/capabilities.ts` + additive wiring (SANCTIONED protected-path edit)

> **⚠ Protected-path task — flag for whole-branch-review scrutiny (M4's analog of M2 Task 2).** This is the ONLY task that edits `app/api/**` / `lib/server/**`. It touches exactly three files there: `lib/server/capabilities.ts` (new), `app/api/reviews/route.ts` (additive `capabilities` per row), `app/api/reviews/[id]/route.ts` (**two** additive fields — `capabilities` and `latestVerification`, the latter a read-only join to `verification_result` for the latest draft's latest verification). Every other protected file — including the counts, drafts, verify, publish, approval, reply routes, `permissions.ts`, `reviews-query.ts`, `workflow.ts`, `verification.ts` — stays **byte-identical**. The reviewer must confirm that with `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` (exactly those three paths, no more), that both additions are strictly additive (existing fields unchanged), and that the untouched backend integration suite (the parity oracle) stays green.

**Files:**
- Create: `lib/server/capabilities.ts`
- Modify: `app/api/reviews/route.ts` (add `capabilities` per row), `app/api/reviews/[id]/route.ts` (add `capabilities` + `latestVerification` on the review)
- Test: `tests/integration/routes/review-capabilities.test.ts`

**Interfaces:**
- Consumes: `TransactionSql` (`postgres`), `Session` (`@/lib/server/session`).
- Produces (Task 2 consumes these EXACT shapes):
  - `type ReviewCapabilities = { canPublish: boolean; canEdit: boolean }`.
  - `reviewCapabilitiesForLocations(sql, session, locationIds: string[]): Promise<Map<string, ReviewCapabilities>>` — mirrors `canPublishLocation`/`requireLocationAccess` exactly.
  - `reviewCapabilities(sql, session, locationId: string): Promise<ReviewCapabilities>` — single-location convenience over the batch.
  - `GET /api/reviews` items each gain `capabilities: { canPublish, canEdit }`.
  - `GET /api/reviews/[id]` review gains `capabilities: { canPublish, canEdit }` and `latestVerification: { verdict, reasons } | null` (verdict + reasons of the latest draft's latest `verification_result`).

**Capability definition (mirrors `lib/server/permissions.ts` exactly):**
- `canPublish(loc)` = `owner|admin` → `true`; `viewer` → `false`; else (member) `hasAnyAssignment ? (assigned-to-loc-with-can_publish) : session.canPublish` — identical to `canPublishLocation`.
- `canEdit(loc)` = `role !== 'viewer'` AND has location access (identical to what `requireLocationAccess` permits: `hasAnyAssignment ? assigned-to-loc : true`). Owner/admin always have access.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/routes/review-capabilities.test.ts`:

```ts
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedLinkedReview,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("review capabilities on inbox responses", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("owner sees canPublish and canEdit true on list and detail", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Capabilities owner review",
      rating: 5,
    })

    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      items: { id: string; capabilities: { canPublish: boolean; canEdit: boolean } }[]
    }
    const listed = listBody.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({ canPublish: true, canEdit: true })

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: { capabilities: { canPublish: boolean; canEdit: boolean } }
    }
    expect(detailBody.review.capabilities).toEqual({
      canPublish: true,
      canEdit: true,
    })
  })

  it("viewer sees canPublish and canEdit false", async () => {
    const tenant = await createTestTenant(admin, {
      role: "viewer",
      canPublish: false,
    })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Capabilities viewer review",
      rating: 3,
    })
    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    const body = (await list.json()) as {
      items: { id: string; capabilities: { canPublish: boolean; canEdit: boolean } }[]
    }
    const listed = body.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({ canPublish: false, canEdit: false })
  })

  it("detail carries latestVerification with reasons for a drafted review", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Reasons detail review",
      rating: 4,
    })
    // A human draft containing an email deterministically fails verification
    // (personal_contact_data), so latestVerification carries a reason.
    const drafted = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: tenant.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Please email us at team@example.com." }),
      }
    )
    expect([201, 503]).toContain(drafted.status)
    if (drafted.status === 503) return // DRAFTS_ENABLED off in this harness

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: {
        latestVerification: {
          verdict: string
          reasons: { code: string; severity: string; message: string }[]
        } | null
      }
    }
    expect(detailBody.review.latestVerification?.verdict).toBe("fail")
    expect(
      detailBody.review.latestVerification?.reasons.some(
        (reason) => reason.code === "personal_contact_data"
      )
    ).toBe(true)
  })
})
```

Before running: open `tests/integration/helpers/tenant.ts` and confirm `seedGoogleConnection` returns `{ connectionId, googleAccountName }` and `seedLinkedReview` returns `{ reviewId, locationId, externalLocationId }` (they do at lines 158/206). If a member/`can_publish=false` per-location case is wanted later, `createTestTenant(admin, { role, canPublish })` plus a manual `location_member` insert is the mechanism — not needed for these cases.

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/review-capabilities.test.ts`
Expected: FAIL — `item.capabilities` and `review.capabilities` are `undefined`.

- [ ] **Step 3: Implement `lib/server/capabilities.ts`**

```ts
import "server-only"

import type { TransactionSql } from "postgres"

import type { Session } from "@/lib/server/session"

// One capability object per review, mirroring lib/server/permissions.ts
// exactly:
//   canPublish  === canPublishLocation(sql, session, locationId)
//   canEdit     === (role !== 'viewer') && requireLocationAccess would pass
export type ReviewCapabilities = { canPublish: boolean; canEdit: boolean }

export async function reviewCapabilitiesForLocations(
  sql: TransactionSql,
  session: Session,
  locationIds: string[]
): Promise<Map<string, ReviewCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, ReviewCapabilities>()
  if (unique.length === 0) return result

  if (session.role === "owner" || session.role === "admin") {
    for (const id of unique) {
      result.set(id, { canPublish: true, canEdit: true })
    }
    return result
  }
  if (session.role === "viewer") {
    for (const id of unique) {
      result.set(id, { canPublish: false, canEdit: false })
    }
    return result
  }

  // member: mirror locationGrant/canPublishLocation/requireLocationAccess.
  const [assignmentScope] = await sql<{ hasAssignments: boolean }[]>`
    select exists (
      select 1 from location_member where user_id = ${session.userId}
    ) as "hasAssignments"
  `
  const hasAssignments = assignmentScope.hasAssignments
  const grants = hasAssignments
    ? await sql<{ locationId: string; canPublish: boolean }[]>`
        select
          location_id::text as "locationId",
          can_publish as "canPublish"
        from location_member
        where user_id = ${session.userId}
          and location_id in ${sql(unique)}
      `
    : []
  const grantByLocation = new Map(
    grants.map((grant) => [grant.locationId, grant.canPublish])
  )
  for (const id of unique) {
    const assigned = grantByLocation.has(id)
    const canPublish = hasAssignments
      ? assigned
        ? (grantByLocation.get(id) ?? false)
        : false
      : session.canPublish
    const canEdit = hasAssignments ? assigned : true
    result.set(id, { canPublish, canEdit })
  }
  return result
}

export async function reviewCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<ReviewCapabilities> {
  const map = await reviewCapabilitiesForLocations(sql, session, [locationId])
  return map.get(locationId) ?? { canPublish: false, canEdit: false }
}
```

- [ ] **Step 4: Wire it into the list route (additive)**

In `app/api/reviews/route.ts`, add the import at the top with the other `@/lib/server` imports:

```ts
import { reviewCapabilitiesForLocations } from "@/lib/server/capabilities"
```

Then replace the `withTenant(...)` read + the `const rows = rawRows` line. The current code is:

```ts
    const rawRows = await withTenant(
      session.organisationId,
      (sql) =>
        buildInboxQuery(sql, {
          ...query,
          role: session.role,
          userId: session.userId,
        })
    )
    const rows = rawRows
```

Replace with (compute capabilities INSIDE the same tenant transaction so RLS is set, then attach additively):

```ts
    const rawRows = await withTenant(session.organisationId, async (sql) => {
      const queried = (await buildInboxQuery(sql, {
        ...query,
        role: session.role,
        userId: session.userId,
      })) as (Record<string, unknown> & { location: { id: string } })[]
      const capabilities = await reviewCapabilitiesForLocations(
        sql,
        session,
        queried.map((row) => row.location.id)
      )
      return queried.map((row) => ({
        ...row,
        capabilities: capabilities.get(row.location.id) ?? {
          canPublish: false,
          canEdit: false,
        },
      }))
    })
    const rows = rawRows
```

Everything else in the route — the `hasMore`/`items`/`nextCursor` slicing, the `last` cursor read (`id`/`updateTime`/`rating` are still present on each row) — is unchanged. The `capabilities` object rides along on each item and on the last item too (harmless; the cursor only reads three named fields).

- [ ] **Step 5: Wire it into the detail route (additive)**

In `app/api/reviews/[id]/route.ts`, add the import:

```ts
import { reviewCapabilities } from "@/lib/server/capabilities"
```

**5a — additive `latestVerification` in the SELECT.** In the main review query, immediately after the `reply` sub-select (the block ending `) as reply`) and before `from review r`, add a comma and this sub-select (the latest verification of the review's latest draft — verdict + reasons — so the client shows reasons on load without a re-verify). `verification_result` has columns `draft_id, verdict, reasons (jsonb), created_at` (`supabase/migrations/0001_initial.sql:235`):

```sql
          ,
          (
            select json_build_object('verdict', vr.verdict, 'reasons', vr.reasons)
            from verification_result vr
            where vr.draft_id = (
              select d2.id
              from draft d2
              where d2.review_id = r.id
              order by d2.created_at desc
              limit 1
            )
            order by vr.created_at desc
            limit 1
          ) as "latestVerification"
```

`json_build_object` returns SQL `null` (→ JSON `null`) when the review has no draft/verification yet, matching the schema's `.nullable()`. The `reasons` jsonb rides along as a nested JSON array.

**5b — capabilities.** Inside the existing `withTenant(session.organisationId, async (sql) => { … })` callback, after the `timeline` query and before `return { ...row, timeline }`, compute capabilities and include them. Replace:

```ts
      return {
        ...row,
        timeline,
      }
```

with:

```ts
      const capabilities = await reviewCapabilities(
        sql,
        session,
        row.locationId as string
      )
      return {
        ...row,
        timeline,
        capabilities,
      }
```

`row.locationId` is already selected (`l.id::text as "locationId"`), and `row.latestVerification` now rides along via 5a's sub-select and is spread by `...row`. No other change.

- [ ] **Step 6: Run to verify pass**

Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/review-capabilities.test.ts`
Expected: PASS (2 tests).

Then run the FULL parity oracle and prove nothing else moved:

```bash
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
pnpm typecheck && pnpm lint
git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts
```

Expected: every existing integration test (`inbox-cursor`, `approval`, `publish-lifecycle`, `language-drafts`, `review-counts`, …) stays green — they read named fields (`inbox-cursor` reads only `items[].id`), so the additive `capabilities` cannot break them. The `git diff --stat` lists **exactly** `lib/server/capabilities.ts`, `app/api/reviews/route.ts`, `app/api/reviews/[id]/route.ts` — nothing else.

- [ ] **Step 7: Commit**

```bash
git add lib/server/capabilities.ts app/api/reviews/route.ts app/api/reviews/\[id\]/route.ts tests/integration/routes/review-capabilities.test.ts
git commit -m "feat(inbox): per-review capabilities on reviews list and detail (sanctioned)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Typed API clients + wire mapping

**Files:**
- Create: `lib/api/reviews.ts`, `lib/api/drafts.ts`, `lib/api/publish.ts`, `lib/api/approval.ts`, `lib/api/reply.ts`, `lib/api/locations.ts`
- Test: `tests/components/inbox-api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` (`@/lib/api/client`); `z` (`zod`).
- Produces (Task 3 + Tasks 6/7 consume these EXACT signatures):
  - `lib/api/reviews.ts`: `type ReviewsFilters = { locationId?: string; ratings?: number[]; statuses?: string[]; replyState?: "replied"|"unreplied"; verification?: string[]; publishStatus?: string[]; syncStatus?: string[]; dateFrom?: string; dateTo?: string; search?: string; sort?: "updated_desc"|"rating_desc"|"rating_asc" }`; `reviewRowSchema`, `type ReviewRow`; `reviewsPageSchema`, `type ReviewsPage = { items: ReviewRow[]; nextCursor: string|null }`; `fetchReviews(filters: ReviewsFilters, cursor: string|null): Promise<ReviewsPage>` → `GET /api/reviews`. `reviewDetailSchema`, `type ReviewDetail`; `fetchReviewDetail(id: string): Promise<ReviewDetail>` → `GET /api/reviews/[id]`. `verificationReasonSchema`, `type VerificationReason`, `verificationSchema`, `type Verification`.
  - `lib/api/drafts.ts`: `generateOrSaveDraft(reviewId, input): Promise<DraftResult>` (`input: { tone?; languageOverride?; body? }`; omit `body` → generate/regenerate, include `body` → save edit); `verifyDraft(draftId): Promise<{ verification: Verification }>`.
  - `lib/api/publish.ts`: `publishReview(reviewId, { draftId, expectedReviewUpdateTime }): Promise<PublishResult>`.
  - `lib/api/approval.ts`: `decideApproval(reviewId, { decision, note? }): Promise<ApprovalResult>`.
  - `lib/api/reply.ts`: `deletePublishedReply(reviewId): Promise<{ status: string; publishAttemptId: string }>`.
  - `lib/api/locations.ts`: `fetchLocations(): Promise<{ locations: { id: string; name: string }[] }>` → `GET /api/location-links`.

- [ ] **Step 1: Write the failing tests**

`tests/components/inbox-api.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"

import { decideApproval } from "@/lib/api/approval"
import { generateOrSaveDraft, verifyDraft } from "@/lib/api/drafts"
import { fetchLocations } from "@/lib/api/locations"
import { publishReview } from "@/lib/api/publish"
import { deletePublishedReply } from "@/lib/api/reply"
import { fetchReviewDetail, fetchReviews } from "@/lib/api/reviews"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const rowFixture = {
  id: "rev-1",
  location: { id: "loc-1", name: "Riverside" },
  reviewer: { displayName: "Sam", isAnonymous: false },
  rating: 5,
  text: "Lovely stay",
  detectedLanguageCode: "en",
  languageConfidence: 0.99,
  createTime: "2026-07-30T10:00:00.000Z",
  updateTime: "2026-07-30T10:00:00.000Z",
  hasMedia: false,
  workflowStatus: "new",
  draftId: null,
  draftBody: null,
  verificationStatus: null,
  replyStatus: null,
  googleReplyState: null,
  googlePolicyViolation: null,
  replyBody: null,
  syncStatus: "succeeded",
  capabilities: { canPublish: true, canEdit: true },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("fetchReviews", () => {
  it("maps camelCase filters to snake_case wire params and expands the cursor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [rowFixture], nextCursor: "abc" })
    )
    vi.stubGlobal("fetch", fetchMock)
    const page = await fetchReviews(
      {
        locationId: "loc-1",
        ratings: [4, 5],
        statuses: ["new", "drafted"],
        replyState: "unreplied",
        verification: ["pass", "warn"],
        publishStatus: ["published"],
        syncStatus: ["succeeded"],
        dateFrom: "2026-07-01T00:00:00.000Z",
        dateTo: "2026-07-31T00:00:00.000Z",
        search: "lovely",
        sort: "rating_desc",
      },
      "cursor-xyz"
    )
    expect(page.items[0].capabilities.canPublish).toBe(true)
    expect(page.nextCursor).toBe("abc")
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/reviews")
    expect(url.searchParams.get("location_id")).toBe("loc-1")
    expect(url.searchParams.get("rating")).toBe("4,5")
    expect(url.searchParams.get("status")).toBe("new,drafted")
    expect(url.searchParams.get("reply_state")).toBe("unreplied")
    expect(url.searchParams.get("verification")).toBe("pass,warn")
    expect(url.searchParams.get("publish_status")).toBe("published")
    expect(url.searchParams.get("sync_status")).toBe("succeeded")
    expect(url.searchParams.get("date_from")).toBe("2026-07-01T00:00:00.000Z")
    expect(url.searchParams.get("date_to")).toBe("2026-07-31T00:00:00.000Z")
    expect(url.searchParams.get("search")).toBe("lovely")
    expect(url.searchParams.get("sort")).toBe("rating_desc")
    expect(url.searchParams.get("cursor")).toBe("cursor-xyz")
  })

  it("omits empty filters and the cursor when null", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [], nextCursor: null })
    )
    vi.stubGlobal("fetch", fetchMock)
    await fetchReviews({}, null)
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.has("location_id")).toBe(false)
    expect(url.searchParams.has("status")).toBe(false)
    expect(url.searchParams.has("cursor")).toBe(false)
  })
})

describe("fetchReviewDetail", () => {
  it("parses the detail envelope including capabilities and reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          review: {
            id: "rev-1",
            reviewerDisplayName: "Sam",
            reviewerIsAnonymous: false,
            rating: 2,
            text: "Slow service",
            detectedLanguageCode: "en",
            languageConfidence: 0.9,
            createTime: "2026-07-30T10:00:00.000Z",
            updateTime: "2026-07-30T10:00:00.000Z",
            hasMedia: true,
            workflowStatus: "drafted",
            locationId: "loc-1",
            locationName: "Riverside",
            timezone: "Europe/London",
            verified: true,
            media: [
              {
                id: "m1",
                thumbnailUrl: "https://x/t.jpg",
                thumbnailLabel: "Photo",
                videoUrl: null,
              },
            ],
            drafts: [
              {
                id: "d1",
                source: "ai",
                body: "Sorry to hear that.",
                bodyBytes: 19,
                evidenceHash: "h",
                modelName: "gpt",
                verificationStatus: "warn",
                createdAt: "2026-07-30T10:05:00.000Z",
              },
            ],
            reply: null,
            timeline: [
              {
                action: "review.draft.generated",
                createdAt: "2026-07-30T10:05:00.000Z",
                actorName: "Alex Owner",
                metadataSummary: null,
              },
            ],
            capabilities: { canPublish: false, canEdit: true },
            latestVerification: {
              verdict: "warn",
              reasons: [
                {
                  code: "tone_length",
                  severity: "warn",
                  message: "The reply may be too long for the selected tone.",
                },
              ],
            },
          },
        })
      )
    )
    const detail = await fetchReviewDetail("rev-1")
    expect(detail.review.locationName).toBe("Riverside")
    expect(detail.review.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
    })
    expect(detail.review.drafts[0].verificationStatus).toBe("warn")
    expect(detail.review.timeline[0].actorName).toBe("Alex Owner")
  })
})

describe("draft, publish, approval, reply, locations clients", () => {
  it("generateOrSaveDraft omits body for a regenerate and posts it for an edit", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          draftId: "d2",
          body: "Regenerated",
          bodyBytes: 11,
          evidenceHash: "h2",
          verification: { id: "v2", verdict: "pass", reasons: [] },
        },
        201
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    await generateOrSaveDraft("rev-1", { tone: "concise" })
    let init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ tone: "concise" })

    fetchMock.mockClear()
    await generateOrSaveDraft("rev-1", { body: "Edited reply" })
    init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ body: "Edited reply" })
  })

  it("verifyDraft posts to the verify endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ verification: { id: "v3", verdict: "warn", reasons: [] } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await verifyDraft("d1")
    expect(result.verification.verdict).toBe("warn")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drafts/d1/verify")
  })

  it("publishReview posts draftId and expected update time", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        reviewReplyId: "rr1",
        publishAttemptId: "pa1",
        status: "published",
        googleReplyState: "PUBLISHED",
        idempotent: false,
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await publishReview("rev-1", {
      draftId: "d1",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
    expect(result.status).toBe("published")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reviews/rev-1/publish")
  })

  it("decideApproval posts the decision and surfaces the second-approver code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: "second_approver_required",
            message: "A different authorised user must approve this reply.",
          },
          403
        )
      )
    )
    await expect(
      decideApproval("rev-1", { decision: "approve" })
    ).rejects.toMatchObject({ code: "second_approver_required", status: 403 })
  })

  it("deletePublishedReply DELETEs and returns the status", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "deleted", publishAttemptId: "pa2" })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await deletePublishedReply("rev-1")
    expect(result.status).toBe("deleted")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })

  it("fetchLocations reads the location directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          locations: [
            { id: "loc-1", name: "Riverside", googleLocationName: "locations/1" },
            { id: "loc-2", name: "Old Town" },
          ],
        })
      )
    )
    const result = await fetchLocations()
    expect(result.locations).toEqual([
      { id: "loc-1", name: "Riverside" },
      { id: "loc-2", name: "Old Town" },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/inbox-api.test.tsx --project components`
Expected: FAIL — none of the `@/lib/api/*` inbox modules exist.

- [ ] **Step 3: Implement `lib/api/reviews.ts`**

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const verificationReasonSchema = z.object({
  code: z.string(),
  severity: z.enum(["warn", "fail"]),
  message: z.string(),
})
export type VerificationReason = z.infer<typeof verificationReasonSchema>

export const verificationSchema = z.object({
  id: z.string(),
  verdict: z.enum(["pass", "warn", "fail"]),
  reasons: z.array(verificationReasonSchema),
})
export type Verification = z.infer<typeof verificationSchema>

// The detail route exposes the latest verification of the review's latest
// draft (verdict + reasons) so the composer can show reasons on load without
// forcing a re-verify. No `id` — this is a read-only projection.
export const latestVerificationSchema = z.object({
  verdict: z.enum(["pass", "warn", "fail"]),
  reasons: z.array(verificationReasonSchema),
})
export type LatestVerification = z.infer<typeof latestVerificationSchema>

const capabilitiesSchema = z.object({
  canPublish: z.boolean(),
  canEdit: z.boolean(),
})
export type ReviewCapabilities = z.infer<typeof capabilitiesSchema>

export const reviewRowSchema = z.object({
  id: z.string(),
  location: z.object({ id: z.string(), name: z.string() }),
  reviewer: z.object({
    displayName: z.string().nullable(),
    isAnonymous: z.boolean(),
  }),
  rating: z.number().nullable(),
  text: z.string().nullable(),
  detectedLanguageCode: z.string().nullable(),
  languageConfidence: z.number().nullable(),
  createTime: z.string(),
  updateTime: z.string(),
  hasMedia: z.boolean(),
  workflowStatus: z.string(),
  draftId: z.string().nullable(),
  draftBody: z.string().nullable(),
  verificationStatus: z.string().nullable(),
  replyStatus: z.string().nullable(),
  googleReplyState: z.string().nullable(),
  googlePolicyViolation: z.string().nullable(),
  replyBody: z.string().nullable(),
  syncStatus: z.string().nullable(),
  capabilities: capabilitiesSchema,
})
export type ReviewRow = z.infer<typeof reviewRowSchema>

export const reviewsPageSchema = z.object({
  items: z.array(reviewRowSchema),
  nextCursor: z.string().nullable(),
})
export type ReviewsPage = z.infer<typeof reviewsPageSchema>

export const reviewDetailSchema = z.object({
  review: z.object({
    id: z.string(),
    reviewerDisplayName: z.string().nullable(),
    reviewerIsAnonymous: z.boolean(),
    rating: z.number().nullable(),
    text: z.string().nullable(),
    detectedLanguageCode: z.string().nullable(),
    languageConfidence: z.number().nullable(),
    createTime: z.string(),
    updateTime: z.string(),
    hasMedia: z.boolean(),
    workflowStatus: z.string(),
    locationId: z.string(),
    locationName: z.string(),
    timezone: z.string(),
    verified: z.boolean().nullable(),
    media: z.array(
      z.object({
        id: z.string(),
        thumbnailUrl: z.string().nullable(),
        thumbnailLabel: z.string().nullable(),
        videoUrl: z.string().nullable(),
      })
    ),
    drafts: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        body: z.string(),
        bodyBytes: z.number(),
        evidenceHash: z.string().nullable(),
        modelName: z.string().nullable(),
        verificationStatus: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    reply: z
      .object({
        id: z.string(),
        body: z.string().nullable(),
        publishStatus: z.string().nullable(),
        googleReplyState: z.string().nullable(),
        googlePolicyViolation: z.string().nullable(),
        googleReplyUpdatedAt: z.string().nullable(),
      })
      .nullable(),
    timeline: z.array(
      z.object({
        action: z.string(),
        createdAt: z.string(),
        actorName: z.string().nullable(),
        metadataSummary: z.string().nullable(),
      })
    ),
    capabilities: capabilitiesSchema,
    latestVerification: latestVerificationSchema.nullable(),
  }),
})
export type ReviewDetail = z.infer<typeof reviewDetailSchema>

export type ReviewsFilters = {
  locationId?: string
  ratings?: number[]
  statuses?: string[]
  replyState?: "replied" | "unreplied"
  verification?: string[]
  publishStatus?: string[]
  syncStatus?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  sort?: "updated_desc" | "rating_desc" | "rating_asc"
}

// Serialise camelCase filters to the backend's snake_case wire vocabulary.
function toWireParams(filters: ReviewsFilters, cursor: string | null) {
  const params = new URLSearchParams()
  const csv = (key: string, values?: (string | number)[]) => {
    if (values && values.length > 0) params.set(key, values.join(","))
  }
  if (filters.locationId) params.set("location_id", filters.locationId)
  csv("rating", filters.ratings)
  csv("status", filters.statuses)
  if (filters.replyState) params.set("reply_state", filters.replyState)
  csv("verification", filters.verification)
  csv("publish_status", filters.publishStatus)
  csv("sync_status", filters.syncStatus)
  if (filters.dateFrom) params.set("date_from", filters.dateFrom)
  if (filters.dateTo) params.set("date_to", filters.dateTo)
  if (filters.search) params.set("search", filters.search)
  if (filters.sort) params.set("sort", filters.sort)
  if (cursor) params.set("cursor", cursor)
  return params
}

export function fetchReviews(filters: ReviewsFilters, cursor: string | null) {
  const query = toWireParams(filters, cursor).toString()
  return apiFetch(query ? `/api/reviews?${query}` : "/api/reviews", {
    schema: reviewsPageSchema,
  })
}

export function fetchReviewDetail(id: string) {
  return apiFetch(`/api/reviews/${id}`, { schema: reviewDetailSchema })
}
```

- [ ] **Step 4: Implement `lib/api/drafts.ts`, `publish.ts`, `approval.ts`, `reply.ts`, `locations.ts`**

`lib/api/drafts.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"
import { verificationSchema } from "./reviews"

const draftResultSchema = z.object({
  draftId: z.string(),
  body: z.string(),
  bodyBytes: z.number(),
  evidenceHash: z.string().nullable(),
  verification: verificationSchema,
})
export type DraftResult = z.infer<typeof draftResultSchema>

// One endpoint is Generate/Regenerate/Save. Omit `body` -> the server
// generates (AI) or templates (rating-only); include `body` -> human edit.
export type DraftInput = {
  tone?: "warm_professional" | "concise" | "empathetic"
  languageOverride?: string | null
  body?: string
}

export function generateOrSaveDraft(reviewId: string, input: DraftInput) {
  return apiFetch(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: input,
    schema: draftResultSchema,
  })
}

const verifyResultSchema = z.object({ verification: verificationSchema })
export type VerifyResult = z.infer<typeof verifyResultSchema>

export function verifyDraft(draftId: string) {
  return apiFetch(`/api/drafts/${draftId}/verify`, {
    method: "POST",
    schema: verifyResultSchema,
  })
}
```

`lib/api/publish.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const publishResultSchema = z.object({
  reviewReplyId: z.string(),
  publishAttemptId: z.string(),
  status: z.string(),
  googleReplyState: z.string().nullable(),
  idempotent: z.boolean().optional(),
})
export type PublishResult = z.infer<typeof publishResultSchema>

export function publishReview(
  reviewId: string,
  input: { draftId: string; expectedReviewUpdateTime: string }
) {
  return apiFetch(`/api/reviews/${reviewId}/publish`, {
    method: "POST",
    body: input,
    schema: publishResultSchema,
  })
}
```

`lib/api/approval.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

// The reject and approve responses differ in shape; validate the union of the
// fields either can carry (status is always present).
const approvalResultSchema = z.object({
  status: z.string(),
  googleReplyState: z.string().nullable().optional(),
  publishAttemptId: z.string().optional(),
  reviewReplyId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type ApprovalResult = z.infer<typeof approvalResultSchema>

export function decideApproval(
  reviewId: string,
  input: { decision: "approve" | "reject"; note?: string }
) {
  return apiFetch(`/api/reviews/${reviewId}/approval`, {
    method: "POST",
    body: input,
    schema: approvalResultSchema,
  })
}
```

`lib/api/reply.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const deleteReplyResultSchema = z.object({
  status: z.string(),
  // executeReplyDelete returns attemptId: string | null (a "cancelled" outcome
  // can omit it), so this is nullable.
  publishAttemptId: z.string().nullable(),
})
export type DeleteReplyResult = z.infer<typeof deleteReplyResultSchema>

export function deletePublishedReply(reviewId: string) {
  return apiFetch(`/api/reviews/${reviewId}/reply`, {
    method: "DELETE",
    schema: deleteReplyResultSchema,
  })
}
```

`lib/api/locations.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

// GET /api/location-links returns the role-scoped location directory
// (default view), name-ordered. We only need {id, name} for the filter, so
// the schema strips googleLocationName even when present.
const locationEntrySchema = z.object({ id: z.string(), name: z.string() })
export type LocationEntry = z.infer<typeof locationEntrySchema>

const locationsResponseSchema = z.object({
  locations: z.array(locationEntrySchema),
})
export type LocationsResponse = z.infer<typeof locationsResponseSchema>

export function fetchLocations() {
  return apiFetch("/api/location-links", { schema: locationsResponseSchema })
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm exec vitest run tests/components/inbox-api.test.tsx --project components`
Expected: PASS. Note `locationEntrySchema` strips `googleLocationName` (zod default strip), which is why `fetchLocations` returns exactly `{id,name}`.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/api/reviews.ts lib/api/drafts.ts lib/api/publish.ts lib/api/approval.ts lib/api/reply.ts lib/api/locations.ts tests/components/inbox-api.test.tsx
git commit -m "feat(inbox): typed clients for reviews, drafts, publish, approval, reply, locations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: URL-state helper + query hooks

**Files:**
- Create: `lib/inbox/url-state.ts`, `lib/queries/use-reviews.ts`, `lib/queries/use-review-detail.ts`
- Modify: `lib/queries/use-review-counts.ts`, `lib/api/review-counts.ts`
- Test: `tests/components/inbox-url-state.test.ts`, `tests/components/inbox-queries.test.tsx`

**Interfaces:**
- Consumes: `useInfiniteQuery`, `useQuery`, `keepPreviousData` (`@tanstack/react-query`); `fetchReviews`/`ReviewsFilters`/`ReviewsPage`, `fetchReviewDetail`/`ReviewDetail` (Task 2); `fetchReviewCounts`/`ReviewCounts` (existing, extended); `queryKeys` (`@/lib/queries/keys`).
- Produces (Tasks 4–8 consume):
  - `lib/inbox/url-state.ts`: `type Queue = "all"|"needs_reply"|"awaiting_approval"|"escalated"|"published"`; `QUEUES: readonly Queue[]`; `QUEUE_STATUS_MAP: Record<Queue, readonly string[] | null>`; `queueToStatuses(queue): string[] | undefined`; `type InboxState = { queue: Queue; locationId?: string; ratings: number[]; search: string; sort: ReviewsFilters["sort"]; replyState?: "replied"|"unreplied"; verification: string[]; publishStatus: string[]; syncStatus: string[]; dateFrom?: string; dateTo?: string; selected?: string }`; `parseInboxState(params: URLSearchParams): InboxState`; `serializeInboxState(state: InboxState): URLSearchParams`; `toReviewsFilters(state): ReviewsFilters`; `hasActiveFilters(state): boolean`; `mobilePaneFor(selected): "list"|"detail"`; `autoSelectId({ selected, reviews, isDirty, isDesktop }): string | null`.
  - `useReviews(filters: ReviewsFilters)` — `useInfiniteQuery`, key `queryKeys.reviews("organisation", filters)`, `placeholderData: keepPreviousData`, `staleTime: 30_000`; helper `flattenReviews(data)`.
  - `useReviewDetail(id: string | undefined)` — `useQuery`, key `queryKeys.reviewDetail(id ?? "")`, `enabled: Boolean(id)`, `staleTime: 30_000`.
  - `useReviewCounts(locationId?: string)` — key `queryKeys.reviewCounts(locationId ?? "organisation")`, `staleTime: 30_000`.
  - `fetchReviewCounts(locationId?: string)` — `GET /api/reviews/counts?locationId=<id>`.

- [ ] **Step 1: Write the failing tests**

`tests/components/inbox-url-state.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  autoSelectId,
  mobilePaneFor,
  parseInboxState,
  queueToStatuses,
  serializeInboxState,
  toReviewsFilters,
  hasActiveFilters,
  type InboxState,
} from "@/lib/inbox/url-state"

describe("inbox url state", () => {
  it("defaults to the all queue and updated_desc sort", () => {
    const state = parseInboxState(new URLSearchParams())
    expect(state.queue).toBe("all")
    expect(state.sort).toBe("updated_desc")
    expect(state.ratings).toEqual([])
    expect(hasActiveFilters(state)).toBe(false)
  })

  it("reads Home's ?locationId= contract as the initial location filter", () => {
    const state = parseInboxState(new URLSearchParams("locationId=loc-9"))
    expect(state.locationId).toBe("loc-9")
    expect(hasActiveFilters(state)).toBe(true)
  })

  it("parses every param including comma lists", () => {
    const state = parseInboxState(
      new URLSearchParams(
        "queue=needs_reply&rating=4,5&search=slow&sort=rating_asc&verification=pass,warn&publishStatus=published&syncStatus=failed&replyState=unreplied&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z&selected=rev-1"
      )
    )
    expect(state.queue).toBe("needs_reply")
    expect(state.ratings).toEqual([4, 5])
    expect(state.search).toBe("slow")
    expect(state.sort).toBe("rating_asc")
    expect(state.verification).toEqual(["pass", "warn"])
    expect(state.publishStatus).toEqual(["published"])
    expect(state.syncStatus).toEqual(["failed"])
    expect(state.replyState).toBe("unreplied")
    expect(state.selected).toBe("rev-1")
  })

  it("ignores an unknown queue and falls back to all", () => {
    const state = parseInboxState(new URLSearchParams("queue=nonsense"))
    expect(state.queue).toBe("all")
  })

  it("round-trips through serialize omitting defaults and empties", () => {
    const state: InboxState = {
      queue: "published",
      locationId: "loc-1",
      ratings: [5],
      search: "",
      sort: "updated_desc",
      verification: [],
      publishStatus: [],
      syncStatus: [],
      selected: "rev-2",
    }
    const params = serializeInboxState(state)
    expect(params.get("queue")).toBe("published")
    expect(params.get("locationId")).toBe("loc-1")
    expect(params.get("rating")).toBe("5")
    expect(params.get("selected")).toBe("rev-2")
    expect(params.has("search")).toBe(false)
    expect(params.has("sort")).toBe(false)
    expect(params.has("verification")).toBe(false)
  })

  it("expands the queue into backend statuses and drops it from filters", () => {
    expect(queueToStatuses("all")).toBeUndefined()
    expect(queueToStatuses("awaiting_approval")).toEqual(["awaiting_approval"])
    expect(queueToStatuses("escalated")).toEqual(["escalated"])
    expect(queueToStatuses("published")).toEqual(["published"])
    expect(queueToStatuses("needs_reply")).toContain("new")

    const filters = toReviewsFilters(
      parseInboxState(new URLSearchParams("queue=escalated&locationId=loc-1"))
    )
    expect(filters.statuses).toEqual(["escalated"])
    expect(filters.locationId).toBe("loc-1")
  })

  it("shows the detail pane on mobile only when a review is selected", () => {
    expect(mobilePaneFor(undefined)).toBe("list")
    expect(mobilePaneFor("rev-1")).toBe("detail")
  })

  it("auto-selects the first row only on desktop, unselected, and clean", () => {
    const reviews = [{ id: "a" }, { id: "b" }]
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: false, isDesktop: true })
    ).toBe("a")
    // Already selected -> no auto-select.
    expect(
      autoSelectId({ selected: "b", reviews, isDirty: false, isDesktop: true })
    ).toBeNull()
    // Dirty composer -> never steal the selection.
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: true, isDesktop: true })
    ).toBeNull()
    // Mobile -> the list is shown first; no auto-select.
    expect(
      autoSelectId({ selected: undefined, reviews, isDirty: false, isDesktop: false })
    ).toBeNull()
    // Empty list -> nothing to select.
    expect(
      autoSelectId({ selected: undefined, reviews: [], isDirty: false, isDesktop: true })
    ).toBeNull()
  })
})
```

`tests/components/inbox-queries.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const row = {
  id: "rev-1",
  location: { id: "loc-1", name: "Riverside" },
  reviewer: { displayName: "Sam", isAnonymous: false },
  rating: 5,
  text: "Lovely",
  detectedLanguageCode: "en",
  languageConfidence: 0.9,
  createTime: "2026-07-30T10:00:00.000Z",
  updateTime: "2026-07-30T10:00:00.000Z",
  hasMedia: false,
  workflowStatus: "new",
  draftId: null,
  draftBody: null,
  verificationStatus: null,
  replyStatus: null,
  googleReplyState: null,
  googlePolicyViolation: null,
  replyBody: null,
  syncStatus: "succeeded",
  capabilities: { canPublish: true, canEdit: true },
}

describe("useReviews", () => {
  it("fetches the first page and flattens items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [row], nextCursor: null }))
    )
    const client = newClient()
    const { result } = renderHook(() => useReviews({ locationId: "loc-1" }), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(flattenReviews(result.current.data)).toHaveLength(1)
    expect(
      client.getQueryData(queryKeys.reviews("organisation", { locationId: "loc-1" }))
    ).toBeDefined()
  })
})

describe("useReviewCounts", () => {
  it("scopes the key and the query to a locationId", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ total: 1, byStatus: { new: 1 } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { result } = renderHook(() => useReviewCounts("loc-1"), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.get("locationId")).toBe("loc-1")
    expect(client.getQueryData(queryKeys.reviewCounts("loc-1"))).toBeDefined()
  })

  it("uses the organisation scope when no location is given", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ total: 0, byStatus: {} })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    renderHook(() => useReviewCounts(), { wrapper: wrapperWith(client) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.has("locationId")).toBe(false)
  })
})

describe("useReviewDetail", () => {
  it("is disabled without an id and enabled with one", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ review: { id: "rev-1" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { rerender } = renderHook(
      ({ id }: { id?: string }) => useReviewDetail(id),
      { wrapper: wrapperWith(client), initialProps: {} }
    )
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ id: "rev-1" })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reviews/rev-1")
  })
})
```

Note: `useReviewDetail`'s test stubs a minimal `{ review: { id } }`; because the detail schema in Task 2 validates the full shape, this test uses `useReviewDetail` only to assert the fetch is gated by `enabled` and hits the right URL — it awaits the fetch call, not `result.current.data` (which would reject the thin body). Keep the assertion on `fetchMock`, exactly as written.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/inbox-url-state.test.ts tests/components/inbox-queries.test.tsx --project components`
Expected: FAIL — the modules do not exist / `useReviewCounts` takes no argument yet.

- [ ] **Step 3: Implement `lib/inbox/url-state.ts`**

```ts
import type { ReviewsFilters } from "@/lib/api/reviews"

export type Queue =
  | "all"
  | "needs_reply"
  | "awaiting_approval"
  | "escalated"
  | "published"

export const QUEUES: readonly Queue[] = [
  "all",
  "needs_reply",
  "awaiting_approval",
  "escalated",
  "published",
]

// Reproduces the legacy queue->statuses mapping. "needs_reply" is the states
// that still require a human toward a reply (excluding the states that own
// their own tab: awaiting_approval, escalated, published). `publish_requested`
// is a transient pipeline state (a publish is in flight) and belongs to no
// actionable tab — it appears only under the All queue, by design. This is a
// defensible baseline the owner may refine; the per-tab count in queue-tabs
// derives from exactly this map so the count and the list always agree.
export const QUEUE_STATUS_MAP: Record<Queue, readonly string[] | null> = {
  all: null,
  needs_reply: ["new", "drafted", "verified", "failed", "rejected"],
  awaiting_approval: ["awaiting_approval"],
  escalated: ["escalated"],
  published: ["published"],
}

export function queueToStatuses(queue: Queue): string[] | undefined {
  const statuses = QUEUE_STATUS_MAP[queue]
  return statuses ? [...statuses] : undefined
}

const SORTS = ["updated_desc", "rating_desc", "rating_asc"] as const
type Sort = (typeof SORTS)[number]

export type InboxState = {
  queue: Queue
  locationId?: string
  ratings: number[]
  search: string
  sort: Sort
  replyState?: "replied" | "unreplied"
  verification: string[]
  publishStatus: string[]
  syncStatus: string[]
  dateFrom?: string
  dateTo?: string
  selected?: string
}

function csv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : []
}

export function parseInboxState(params: URLSearchParams): InboxState {
  const rawQueue = params.get("queue")
  const queue = (QUEUES as readonly string[]).includes(rawQueue ?? "")
    ? (rawQueue as Queue)
    : "all"
  const rawSort = params.get("sort")
  const sort = (SORTS as readonly string[]).includes(rawSort ?? "")
    ? (rawSort as Sort)
    : "updated_desc"
  const rawReply = params.get("replyState")
  return {
    queue,
    locationId: params.get("locationId") ?? undefined,
    ratings: csv(params.get("rating"))
      .map(Number)
      .filter((n) => Number.isInteger(n)),
    search: params.get("search") ?? "",
    sort,
    replyState:
      rawReply === "replied" || rawReply === "unreplied" ? rawReply : undefined,
    verification: csv(params.get("verification")),
    publishStatus: csv(params.get("publishStatus")),
    syncStatus: csv(params.get("syncStatus")),
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    selected: params.get("selected") ?? undefined,
  }
}

export function serializeInboxState(state: InboxState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.queue !== "all") params.set("queue", state.queue)
  if (state.locationId) params.set("locationId", state.locationId)
  if (state.ratings.length) params.set("rating", state.ratings.join(","))
  if (state.search) params.set("search", state.search)
  if (state.sort !== "updated_desc") params.set("sort", state.sort)
  if (state.replyState) params.set("replyState", state.replyState)
  if (state.verification.length)
    params.set("verification", state.verification.join(","))
  if (state.publishStatus.length)
    params.set("publishStatus", state.publishStatus.join(","))
  if (state.syncStatus.length)
    params.set("syncStatus", state.syncStatus.join(","))
  if (state.dateFrom) params.set("dateFrom", state.dateFrom)
  if (state.dateTo) params.set("dateTo", state.dateTo)
  if (state.selected) params.set("selected", state.selected)
  return params
}

// Everything except queue/sort/selected counts as an "active filter" for the
// three-way empty-state distinction (D10).
export function hasActiveFilters(state: InboxState): boolean {
  return Boolean(
    state.locationId ||
      state.ratings.length ||
      state.search ||
      state.replyState ||
      state.verification.length ||
      state.publishStatus.length ||
      state.syncStatus.length ||
      state.dateFrom ||
      state.dateTo
  )
}

export function toReviewsFilters(state: InboxState): ReviewsFilters {
  return {
    locationId: state.locationId,
    ratings: state.ratings.length ? state.ratings : undefined,
    statuses: queueToStatuses(state.queue),
    replyState: state.replyState,
    verification: state.verification.length ? state.verification : undefined,
    publishStatus: state.publishStatus.length ? state.publishStatus : undefined,
    syncStatus: state.syncStatus.length ? state.syncStatus : undefined,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    search: state.search || undefined,
    sort: state.sort,
  }
}

// Which pane the mobile (<xl) layout shows: the detail when a review is
// selected, otherwise the list (spec §6). Desktop always shows both panes.
export function mobilePaneFor(selected: string | undefined): "list" | "detail" {
  return selected ? "detail" : "list"
}

// Spec §6 auto-selection: pick the first row ONLY when the URL carries no
// selection, nothing is dirty, and we are on desktop (where a detail pane is
// always visible). Returns the id to select via router.replace, or null.
export function autoSelectId(input: {
  selected: string | undefined
  reviews: { id: string }[]
  isDirty: boolean
  isDesktop: boolean
}): string | null {
  if (input.selected) return null
  if (input.isDirty) return null
  if (!input.isDesktop) return null
  return input.reviews[0]?.id ?? null
}
```

- [ ] **Step 4: Implement the hooks and extend counts**

`lib/api/review-counts.ts` — replace the whole file:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
})

export type ReviewCounts = z.infer<typeof reviewCountsSchema>

export function fetchReviewCounts(locationId?: string) {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""
  return apiFetch(`/api/reviews/counts${query}`, { schema: reviewCountsSchema })
}
```

`lib/queries/use-review-counts.ts` — replace the whole file (M3's Home calls `useReviewCounts()` with no argument, which still resolves to the `"organisation"` scope, so Home is unaffected):

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"

export function useReviewCounts(locationId?: string) {
  return useQuery({
    queryKey: queryKeys.reviewCounts(locationId ?? "organisation"),
    queryFn: () => fetchReviewCounts(locationId),
    staleTime: 30_000,
  })
}
```

`lib/queries/use-reviews.ts`:

```ts
"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { fetchReviews, type ReviewRow, type ReviewsFilters } from "@/lib/api/reviews"
import { queryKeys } from "./keys"

export function useReviews(filters: ReviewsFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.reviews("organisation", filters),
    queryFn: ({ pageParam }) => fetchReviews(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function flattenReviews(
  data: { pages: { items: ReviewRow[] }[] } | undefined
): ReviewRow[] {
  return data ? data.pages.flatMap((page) => page.items) : []
}
```

`lib/queries/use-review-detail.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewDetail } from "@/lib/api/reviews"
import { queryKeys } from "./keys"

export function useReviewDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewDetail(id ?? ""),
    queryFn: () => fetchReviewDetail(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm exec vitest run tests/components/inbox-url-state.test.ts tests/components/inbox-queries.test.tsx tests/components/home-queries.test.tsx --project components`
Expected: PASS. `home-queries.test.tsx` (M3) still passes — `useReviewCounts()` with no argument keys `reviewCounts("organisation")` exactly as before.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/inbox/url-state.ts lib/queries/use-reviews.ts lib/queries/use-review-detail.ts lib/queries/use-review-counts.ts lib/api/review-counts.ts tests/components/inbox-url-state.test.ts tests/components/inbox-queries.test.tsx
git commit -m "feat(inbox): URL-state helper and reviews/detail/counts query hooks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Inbox route shell + list + list primitives

**Files:**
- Create primitives: `components/ui/tabs.tsx`, `components/ui/select.tsx`, `components/ui/combobox.tsx`, `components/ui/avatar.tsx`, `components/ui/empty.tsx`
- Create: `app/(dashboard)/inbox/page.tsx`, `app/(dashboard)/inbox/loading.tsx`, `components/inbox/inbox-view.tsx`, `components/inbox/queue-tabs.tsx`, `components/inbox/review-filters.tsx`, `components/inbox/review-list.tsx`, `components/inbox/empty-states.tsx`
- Test: `tests/components/review-list.test.tsx`, `tests/components/queue-tabs.test.tsx`, `tests/components/review-filters.test.tsx`, `tests/components/empty-states.test.tsx`

**Interfaces:**
- Consumes: `useReviews`/`flattenReviews` (Task 3), `useReviewCounts` (Task 3), `parseInboxState`/`serializeInboxState`/`toReviewsFilters`/`hasActiveFilters`/`autoSelectId`/`mobilePaneFor`/`QUEUES`/`QUEUE_STATUS_MAP` (Task 3), `fetchLocations` (Task 2), `useConnectionHealth` (existing), `formatDate` (`@/lib/format`), `Skeleton`/`Button` (existing), `cn` (`@/lib/utils`), `PageFrame`/`PageHeader` (existing). Auto-selection reads the flattened list + `window.matchMedia` (desktop) and, from Task 6 on, `useReadIsDirty()`.
- Produces (Tasks 5–8 consume): `InboxView`; primitives `Tabs`/`TabsList`/`TabsTab`, `Select`/`SelectItem`, `Combobox`/`ComboboxItem`, `Avatar`, `Empty`; `ReviewList` (props `{ reviews, selectedId, onSelect }`); `QueueTabs`; `ReviewFilters`; `EmptyState` (props `{ kind: "no-data"|"filtered"|"disconnected", onClear? }`).

**Rendering-model note (spec §5, D1):** `app/(dashboard)/inbox/page.tsx` is a synchronous server component that renders `<PageFrame width="workspace"><PageHeader …/><InboxView/></PageFrame>`. Route-level Suspense/streaming is `app/(dashboard)/inbox/loading.tsx` (skeleton rows). Per-source loading during client fetches is owned in-component (D10). No server prefetch/dehydration this milestone (D1).

- [ ] **Step 1: Admit the primitives**

`components/ui/tabs.tsx` (base-ui `tabs`; a11y roles by construction):

```tsx
"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-(--nr-radius-control) bg-muted p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-(--nr-radius-control) px-3 py-1.5 text-ui font-medium text-muted-foreground transition-colors duration-(--nr-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none data-selected:bg-background data-selected:text-foreground data-selected:shadow-(--nr-shadow-float)",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={className} {...props} />
}

export { Tabs, TabsList, TabsTab, TabsPanel }
```

`components/ui/select.tsx` (base-ui `select`):

```tsx
"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {children}
      <ChevronsUpDownIcon className="size-4 shrink-0 opacity-60" aria-hidden />
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={6} className="z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-(--nr-radius-modal) border bg-popover p-1 text-popover-foreground shadow-(--nr-shadow-modal) outline-none",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-(--nr-radius-control) py-1.5 pr-2 pl-8 text-ui outline-none data-highlighted:bg-muted",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
        <CheckIcon className="size-4" aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
```

`components/ui/combobox.tsx` (base-ui `combobox` — the `Combobox.Input` renders `role="combobox"`):

```tsx
"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"

import { cn } from "@/lib/utils"

function Combobox<Value>(props: ComboboxPrimitive.Root.Props<Value>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-8 w-full min-w-0 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        className
      )}
      {...props}
    />
  )
}

function ComboboxContent({ className, children, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner sideOffset={6} className="z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-(--nr-radius-modal) border bg-popover p-1 text-popover-foreground shadow-(--nr-shadow-modal) outline-none",
            className
          )}
          {...props}
        >
          <ComboboxPrimitive.Empty className="px-3 py-2 text-ui text-muted-foreground">
            No matches.
          </ComboboxPrimitive.Empty>
          <ComboboxPrimitive.List>{children}</ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex cursor-default items-center rounded-(--nr-radius-control) px-3 py-1.5 text-ui outline-none data-highlighted:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxItem }
```

`components/ui/avatar.tsx` (base-ui `avatar`):

```tsx
"use client"

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-caption font-semibold text-muted-foreground select-none",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={className} {...props} />
}

export { Avatar, AvatarFallback }
```

`components/ui/empty.tsx` (plain composition — base-ui has no Empty):

```tsx
import { cn } from "@/lib/utils"

function Empty({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-(--nr-radius-card) border border-dashed border-border p-10 text-center",
        className
      )}
    >
      <p className="text-title font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-ui text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}

export { Empty }
```

Implementation note: base-ui 1.6.0 exports `@base-ui/react/{tabs,select,combobox,avatar}`. If any sub-component name differs from the wiring above (e.g. `Positioner`/`ItemIndicator`), reconcile against the installed types — the **exported surface** (`Tabs`/`TabsList`/`TabsTab`/`TabsPanel`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`, `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxItem`, `Avatar`/`AvatarFallback`, `Empty`) is the contract every inbox component below imports and must stay exactly these names. Then add each to `app/design-system/page.tsx`'s inventory per the M1 admission policy.

- [ ] **Step 2: Write the failing list/tabs/filters/empty tests**

`tests/components/review-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewList } from "@/components/inbox/review-list"
import type { ReviewRow } from "@/lib/api/reviews"

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "rev-1",
    location: { id: "loc-1", name: "Riverside" },
    reviewer: { displayName: "Sam Traveller", isAnonymous: false },
    rating: 4,
    text: "Great stay, would return.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-07-30T10:00:00.000Z",
    updateTime: "2026-07-30T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: { canPublish: true, canEdit: true },
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("ReviewList", () => {
  it("renders a labelled region with one selectable button per review", () => {
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First review", reviewer: { displayName: "Ann", isAnonymous: false } }),
          row({ id: "b", text: "Second review", reviewer: { displayName: "Ben", isAnonymous: false } }),
        ]}
        selectedId={undefined}
        onSelect={() => {}}
      />
    )
    expect(screen.getByRole("region", { name: "Review list" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /First review/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Second review/ })).toBeInTheDocument()
  })

  it("marks the selected row with aria-current and makes it the only tab stop", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="b"
        onSelect={() => {}}
      />
    )
    const second = screen.getByRole("button", { name: /Second/ })
    expect(second).toHaveAttribute("aria-current", "true")
    expect(second).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("button", { name: /First/ })).toHaveAttribute("tabindex", "-1")
  })

  it("moves selection with ArrowDown/ArrowUp (roving tabindex)", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="a"
        onSelect={onSelect}
      />
    )
    screen.getByRole("button", { name: /First/ }).focus()
    await user.keyboard("{ArrowDown}")
    expect(onSelect).toHaveBeenCalledWith("b")
  })

  it("shows the year only when a review is not from the current year", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "Old", updateTime: "2024-03-04T10:00:00.000Z" })]}
        selectedId={undefined}
        onSelect={() => {}}
        timezone="Europe/London"
      />
    )
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })
})
```

`tests/components/queue-tabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QueueTabs } from "@/components/inbox/queue-tabs"

const byStatus = {
  new: 2,
  drafted: 1,
  verified: 0,
  awaiting_approval: 3,
  publish_requested: 0,
  published: 5,
  rejected: 1,
  failed: 0,
  escalated: 4,
}

afterEach(() => vi.restoreAllMocks())

describe("QueueTabs", () => {
  it("labels each tab with its derived count and marks the active queue selected", () => {
    render(<QueueTabs queue="all" total={16} byStatus={byStatus} onQueueChange={() => {}} />)
    // All reviews = total; needs_reply = new+drafted+verified+failed+rejected = 4
    expect(screen.getByRole("tab", { name: /All reviews,\s+16/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Needs reply,\s+4/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Awaiting approval,\s+3/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Escalated,\s+4/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Published,\s+5/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /All reviews,\s+16/ })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("calls onQueueChange when a tab is chosen", async () => {
    const user = userEvent.setup()
    const onQueueChange = vi.fn()
    render(
      <QueueTabs queue="all" total={16} byStatus={byStatus} onQueueChange={onQueueChange} />
    )
    await user.click(screen.getByRole("tab", { name: /Published/ }))
    expect(onQueueChange).toHaveBeenCalledWith("published")
  })
})
```

`tests/components/empty-states.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EmptyState } from "@/components/inbox/empty-states"

afterEach(() => vi.restoreAllMocks())

describe("EmptyState", () => {
  it("distinguishes no-data from filtered-out from disconnected", () => {
    const { rerender } = render(<EmptyState kind="no-data" />)
    expect(screen.getByText("No reviews yet")).toBeInTheDocument()

    rerender(<EmptyState kind="filtered" onClear={() => {}} />)
    expect(screen.getByText("No reviews match these filters")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()

    rerender(<EmptyState kind="disconnected" />)
    expect(screen.getByText("Google is not connected")).toBeInTheDocument()
  })

  it("clears filters on request", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<EmptyState kind="filtered" onClear={onClear} />)
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
```

`tests/components/review-filters.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewFilters } from "@/components/inbox/review-filters"

afterEach(() => vi.restoreAllMocks())

describe("ReviewFilters", () => {
  it("exposes a labelled location combobox and a search box", () => {
    render(
      <ReviewFilters
        state={{
          queue: "all",
          ratings: [],
          search: "",
          sort: "updated_desc",
          verification: [],
          publishStatus: [],
          syncStatus: [],
        }}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={() => {}}
      />
    )
    expect(
      screen.getByRole("combobox", { name: "Filter by location" })
    ).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search reviews" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/review-list.test.tsx tests/components/queue-tabs.test.tsx tests/components/empty-states.test.tsx tests/components/review-filters.test.tsx --project components`
Expected: FAIL — the inbox components do not exist.

- [ ] **Step 4: Implement the list, tabs, empty states, filters**

`components/inbox/review-list.tsx` (behavioural contract: region "Review list"; each row is a `<button>`; roving tabindex — selected row `tabIndex=0`, others `-1`; ArrowDown/ArrowUp call `onSelect` with the neighbour id and focus it; `aria-current="true"` on the selected row; year shown only when not current year via `formatDate`):

```tsx
"use client"

import { useRef } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { formatDate } from "@/lib/format"
import type { ReviewRow } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function stars(rating: number | null): string {
  return rating === null ? "No rating" : `${rating} star${rating === 1 ? "" : "s"}`
}

function ReviewList({
  reviews,
  selectedId,
  onSelect,
  timezone = "Europe/London",
}: {
  reviews: ReviewRow[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  timezone?: string
}) {
  const containerRef = useRef<HTMLUListElement>(null)

  function focusRow(index: number) {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    buttons?.[index]?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowDown" && index < reviews.length - 1) {
      event.preventDefault()
      onSelect(reviews[index + 1].id)
      focusRow(index + 1)
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault()
      onSelect(reviews[index - 1].id)
      focusRow(index - 1)
    }
  }

  const activeIndex = reviews.findIndex((review) => review.id === selectedId)

  return (
    <section
      aria-label="Review list"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {/* Native <ul>/<li> give the list/listitem roles; the row stays a real
          <button> (role button) so getByRole("button", { name }) works and the
          list satisfies aria-required-children. Roving tabindex lives on the
          buttons. */}
      <ul ref={containerRef} className="flex flex-col">
        {reviews.map((review, index) => {
          const selected = review.id === selectedId
          // Roving tabindex: the selected row is the tab stop; if nothing is
          // selected the first row is, so the list is reachable by keyboard.
          const isTabStop = selected || (activeIndex === -1 && index === 0)
          return (
            <li key={review.id}>
              <button
                type="button"
                data-slot="review-row"
                aria-current={selected ? "true" : undefined}
                tabIndex={isTabStop ? 0 : -1}
                onClick={() => onSelect(review.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors duration-(--nr-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  selected ? "bg-muted" : "hover:bg-muted/60"
                )}
              >
                <Avatar>
                  <AvatarFallback>
                    {initials(review.reviewer.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-ui font-medium">
                      {review.reviewer.isAnonymous
                        ? "Anonymous"
                        : (review.reviewer.displayName ?? "Anonymous")}
                    </span>
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {formatDate(review.updateTime, timezone)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-caption text-muted-foreground">
                    <span aria-label={stars(review.rating)}>
                      {review.rating === null ? "—" : "★".repeat(review.rating)}
                    </span>
                    <span className="truncate">{review.location.name}</span>
                  </span>
                  <span
                    lang={review.detectedLanguageCode ?? undefined}
                    dir="auto"
                    className="line-clamp-2 text-caption text-muted-foreground"
                  >
                    {review.text ?? "No review text"}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export { ReviewList }
```

`components/inbox/queue-tabs.tsx` (contract: one `role="tab"` per queue; accessible name `"<Label>, <count>"`; count derived from `QUEUE_STATUS_MAP` — `all` uses `total`; active queue `aria-selected`; `onQueueChange(queue)` on select):

```tsx
"use client"

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { QUEUES, QUEUE_STATUS_MAP, type Queue } from "@/lib/inbox/url-state"
import { formatNumber } from "@/lib/format"

const QUEUE_LABELS: Record<Queue, string> = {
  all: "All reviews",
  needs_reply: "Needs reply",
  awaiting_approval: "Awaiting approval",
  escalated: "Escalated",
  published: "Published",
}

function countFor(
  queue: Queue,
  total: number,
  byStatus: Record<string, number>
): number {
  const statuses = QUEUE_STATUS_MAP[queue]
  if (!statuses) return total
  return statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0)
}

function QueueTabs({
  queue,
  total,
  byStatus,
  onQueueChange,
}: {
  queue: Queue
  total: number
  byStatus: Record<string, number>
  onQueueChange: (queue: Queue) => void
}) {
  return (
    <Tabs
      value={queue}
      onValueChange={(value) => onQueueChange(value as Queue)}
    >
      <TabsList>
        {QUEUES.map((item) => (
          <TabsTab
            key={item}
            value={item}
            aria-label={`${QUEUE_LABELS[item]}, ${countFor(item, total, byStatus)}`}
          >
            <span>{QUEUE_LABELS[item]}</span>
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-caption tabular-nums">
              {formatNumber(countFor(item, total, byStatus))}
            </span>
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}

export { QueueTabs }
```

`components/inbox/empty-states.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"

function EmptyState({
  kind,
  onClear,
}: {
  kind: "no-data" | "filtered" | "disconnected"
  onClear?: () => void
}) {
  if (kind === "disconnected") {
    return (
      <Empty
        title="Google is not connected"
        description="Reconnect Google to sync and reply to your reviews."
      />
    )
  }
  if (kind === "filtered") {
    return (
      <Empty
        title="No reviews match these filters"
        description="Try widening or clearing your filters."
        action={
          onClear ? (
            <Button variant="outline" size="sm" onClick={onClear}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <Empty
      title="No reviews yet"
      description="New Google reviews will appear here as they arrive."
    />
  )
}

export { EmptyState }
```

`components/inbox/review-filters.tsx` (basic bar; the full "more filters" set is Task 8). Location filter is a `Combobox` labelled "Filter by location"; search is a `role="searchbox"` that is **controlled and debounced** (~300ms) so it does not fire a `router.replace` + server search-scan per keystroke, and resets its visible text when filters are cleared externally; rating and sort are `Select`s. All changes call `onChange(partialState)`:

```tsx
"use client"

import { useEffect, useId, useState } from "react"

import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { LocationEntry } from "@/lib/api/locations"
import type { InboxState } from "@/lib/inbox/url-state"

type FiltersState = Omit<InboxState, "queue" | "selected">

function ReviewFilters({
  state,
  locations,
  onChange,
}: {
  state: FiltersState
  locations: LocationEntry[]
  onChange: (partial: Partial<InboxState>) => void
}) {
  const searchId = useId()
  const locationId = useId()
  const selectedLocation =
    locations.find((location) => location.id === state.locationId) ?? null

  // Controlled + debounced search: local draft mirrors the URL's search, syncs
  // back when it is cleared externally ("Clear filters"/chip-clear), and writes
  // to the URL only after the user pauses typing.
  const [searchDraft, setSearchDraft] = useState(state.search)
  useEffect(() => {
    setSearchDraft(state.search)
  }, [state.search])
  useEffect(() => {
    if (searchDraft === state.search) return
    const timer = setTimeout(() => onChange({ search: searchDraft }), 300)
    return () => clearTimeout(timer)
  }, [searchDraft, state.search, onChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-48 flex-1">
        <label htmlFor={locationId} className="sr-only">
          Filter by location
        </label>
        <Combobox
          items={locations}
          value={selectedLocation}
          onValueChange={(location: LocationEntry | null) =>
            onChange({ locationId: location?.id })
          }
          itemToStringLabel={(location: LocationEntry) => location.name}
        >
          <ComboboxInput id={locationId} placeholder="All locations" aria-label="Filter by location" />
          <ComboboxContent>
            {locations.map((location) => (
              <ComboboxItem key={location.id} value={location}>
                {location.name}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </Combobox>
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search reviews
        </label>
        <input
          id={searchId}
          type="search"
          role="searchbox"
          aria-label="Search reviews"
          value={searchDraft}
          placeholder="Search reviews"
          onChange={(event) => setSearchDraft(event.target.value)}
          className="h-8 w-full rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
        />
      </div>

      <Select
        value={state.ratings.length === 1 ? String(state.ratings[0]) : "all"}
        onValueChange={(value: string) =>
          onChange({ ratings: value === "all" ? [] : [Number(value)] })
        }
      >
        <SelectTrigger aria-label="Filter by rating" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All ratings</SelectItem>
          {[5, 4, 3, 2, 1].map((rating) => (
            <SelectItem key={rating} value={String(rating)}>
              {rating} star{rating === 1 ? "" : "s"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.sort}
        onValueChange={(value: string) =>
          onChange({ sort: value as InboxState["sort"] })
        }
      >
        <SelectTrigger aria-label="Sort reviews" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated_desc">Most recent</SelectItem>
          <SelectItem value="rating_desc">Highest rated</SelectItem>
          <SelectItem value="rating_asc">Lowest rated</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export { ReviewFilters }
```

Note: the exact base-ui `Combobox.Root` prop names (`items`/`value`/`onValueChange`/`itemToStringLabel`) must be reconciled against the installed 1.6.0 types; the labelled `role="combobox"` input and `role="option"` items (which the e2e in Task 10 drives via `getByLabel("Filter by location")` + `getByRole("option")`) are the invariants that must hold.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm exec vitest run tests/components/review-list.test.tsx tests/components/queue-tabs.test.tsx tests/components/empty-states.test.tsx tests/components/review-filters.test.tsx --project components`
Expected: PASS.

- [ ] **Step 6: Implement `InboxView`, the route page, and `loading.tsx`**

`components/inbox/inbox-view.tsx` (client root: reads `searchParams` via `useSearchParams`; `router.replace` for filters, `router.push` for selection; auto-selects the first row on desktop only when `!selected` and nothing dirty (dirty wiring lands in Task 6 — here it always allows); assembles filters + queue tabs + list + a placeholder "Selected review" region that Task 5 replaces):

```tsx
"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo } from "react"

import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewFilters } from "@/components/inbox/review-filters"
import { ReviewList } from "@/components/inbox/review-list"
import { EmptyState } from "@/components/inbox/empty-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchLocations } from "@/lib/api/locations"
import {
  autoSelectId,
  hasActiveFilters,
  mobilePaneFor,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/queries/keys"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

function InboxView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = useMemo(
    () => parseInboxState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )
  const filters = useMemo(() => toReviewsFilters(state), [state])

  const reviewsQuery = useReviews(filters)
  const countsQuery = useReviewCounts(state.locationId)
  const health = useConnectionHealth()
  const locationsQuery = useQuery({
    queryKey: queryKeys.locations,
    queryFn: fetchLocations,
    staleTime: 30_000,
  })

  const reviews = flattenReviews(reviewsQuery.data)

  const updateState = useCallback(
    (partial: Partial<InboxState>, mode: "replace" | "push") => {
      const next = serializeInboxState({ ...state, ...partial })
      const query = next.toString()
      const href = query ? `/inbox?${query}` : "/inbox"
      if (mode === "push") router.push(href)
      else router.replace(href)
    },
    [router, state]
  )

  // Filters use replace (no history spam) and drop any stale selection.
  const onFilterChange = useCallback(
    (partial: Partial<InboxState>) =>
      updateState({ ...partial, selected: undefined }, "replace"),
    [updateState]
  )
  const onQueueChange = useCallback(
    (queue: Queue) => updateState({ queue, selected: undefined }, "replace"),
    [updateState]
  )
  // Selection uses push so Back returns to the list on mobile (spec §6).
  const onSelect = useCallback(
    (id: string) => updateState({ selected: id }, "push"),
    [updateState]
  )
  const onClearFilters = useCallback(
    () =>
      router.replace(
        `/inbox?${serializeInboxState({
          queue: state.queue,
          ratings: [],
          search: "",
          sort: "updated_desc",
          verification: [],
          publishStatus: [],
          syncStatus: [],
        }).toString()}`
      ),
    [router, state.queue]
  )

  // Spec §6 auto-selection: on desktop, when the URL carries no selection, pick
  // the first row (replace, so it adds no history). Nothing is selected here, so
  // no composer is mounted and dirtiness is false; Task 6 Step 9 threads the
  // real `useReadIsDirty()` for the (rare) cleared-while-dirty edge.
  const reviewsReady = !reviewsQuery.isPending && !reviewsQuery.isError
  useEffect(() => {
    if (!reviewsReady) return
    const id = autoSelectId({
      selected: state.selected,
      reviews,
      isDirty: false,
      isDesktop:
        typeof window !== "undefined" &&
        window.matchMedia("(min-width: 1280px)").matches,
    })
    if (id) {
      router.replace(
        `/inbox?${serializeInboxState({ ...state, selected: id }).toString()}`
      )
    }
  }, [reviewsReady, reviews, state, router])

  function renderList() {
    if (reviewsQuery.isPending) {
      return (
        <div aria-busy="true" className="flex flex-col">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="mx-4 my-3 h-16 rounded-(--nr-radius-card)" />
          ))}
        </div>
      )
    }
    if (reviewsQuery.isError) {
      return (
        <div className="p-6">
          <EmptyState kind="no-data" />
        </div>
      )
    }
    if (reviews.length === 0) {
      const total = countsQuery.data?.total ?? 0
      const kind =
        health.status === "disconnected"
          ? "disconnected"
          : hasActiveFilters(state) || total > 0
            ? "filtered"
            : "no-data"
      return (
        <div className="p-6">
          <EmptyState kind={kind} onClear={onClearFilters} />
        </div>
      )
    }
    return (
      <ReviewList reviews={reviews} selectedId={state.selected} onSelect={onSelect} />
    )
  }

  // Below xl, show one pane: the list, or the detail when a review is selected
  // (spec §6). At xl both panes are always visible (two-pane split).
  const mobilePane = mobilePaneFor(state.selected)

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
      <div
        className={cn(
          "min-h-0 flex-col gap-3 overflow-hidden rounded-(--nr-radius-card) border border-border bg-card",
          mobilePane === "detail" ? "hidden xl:flex" : "flex"
        )}
      >
        <div className="flex flex-col gap-3 border-b border-border/60 p-4">
          <QueueTabs
            queue={state.queue}
            total={countsQuery.data?.total ?? 0}
            byStatus={countsQuery.data?.byStatus ?? {}}
            onQueueChange={onQueueChange}
          />
          <ReviewFilters
            state={state}
            locations={locationsQuery.data?.locations ?? []}
            onChange={onFilterChange}
          />
        </div>
        {renderList()}
        {reviewsQuery.hasNextPage ? (
          <div className="border-t border-border/60 p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={reviewsQuery.isFetchingNextPage}
              onClick={() => void reviewsQuery.fetchNextPage()}
            >
              {reviewsQuery.isFetchingNextPage ? "Loading…" : "Load more reviews"}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Detail pane placeholder — Task 5 replaces this region's INNER content
          (keeping the mobile-pane classes + back button) with the real
          review-detail wrapped in the isolation error boundary. */}
      <section
        aria-label="Selected review"
        className={cn(
          "min-h-0 rounded-(--nr-radius-card) border border-border bg-card xl:flex xl:flex-col",
          mobilePane === "detail" ? "flex flex-col" : "hidden xl:flex"
        )}
      >
        {state.selected ? (
          <>
            {/* Mobile-only return-to-list affordance; Back also works because
                selection was pushed (spec §6). */}
            <div className="border-b border-border/60 p-3 xl:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateState({ selected: undefined }, "replace")}
              >
                Back to reviews
              </Button>
            </div>
            <p className="p-6 text-ui text-muted-foreground">
              Review {state.selected} selected.
            </p>
          </>
        ) : (
          <p className="p-6 text-ui text-muted-foreground">
            Select a review to see the full conversation.
          </p>
        )}
      </section>
    </div>
  )
}

export { InboxView }
```

`app/(dashboard)/inbox/page.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"

export const metadata = { title: "Inbox · NabaPresence" }

export default function InboxPage() {
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader
        title="Inbox"
        description="Every Google review across your connected locations, in one queue."
      />
      <InboxView />
    </PageFrame>
  )
}
```

`app/(dashboard)/inbox/loading.tsx` (skeleton rows — cold load never shows the empty state, spec §8):

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function InboxLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 p-6">
      <Skeleton className="h-9 w-full max-w-md rounded-(--nr-radius-control)" />
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-16 w-full rounded-(--nr-radius-card)" />
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Build and verify the route renders**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green; `/inbox` appears in the route manifest. (E2e for `/inbox` lands in Task 10; here the build proving the page compiles + all component tests passing is the gate.)

- [ ] **Step 8: Commit**

```bash
git add components/ui/tabs.tsx components/ui/select.tsx components/ui/combobox.tsx components/ui/avatar.tsx components/ui/empty.tsx components/inbox/inbox-view.tsx components/inbox/queue-tabs.tsx components/inbox/review-filters.tsx components/inbox/review-list.tsx components/inbox/empty-states.tsx app/\(dashboard\)/inbox/page.tsx app/\(dashboard\)/inbox/loading.tsx app/design-system/page.tsx tests/components/review-list.test.tsx tests/components/queue-tabs.test.tsx tests/components/review-filters.test.tsx tests/components/empty-states.test.tsx
git commit -m "feat(inbox): route shell, queue tabs, filters, and roving-tabindex review list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Review-detail pane + verification/activity panels + detail error boundary

**Files:**
- Create: `components/inbox/review-detail.tsx`, `components/inbox/verification-panel.tsx`, `components/inbox/activity-timeline.tsx`, `components/inbox/detail-error-boundary.tsx`
- Modify: `components/inbox/inbox-view.tsx` (replace the placeholder "Selected review" region with the real detail pane, wrapped in the error boundary)
- Test: `tests/components/verification-panel.test.tsx`, `tests/components/activity-timeline.test.tsx`, `tests/components/review-detail.test.tsx`, `tests/components/detail-error-boundary.test.tsx`

**Interfaces:**
- Consumes: `useReviewDetail`/`ReviewDetail` (Task 3/2), `Verification`/`VerificationReason` (Task 2), `Badge` (existing), `Alert` (existing), `Skeleton` (existing), `formatDateTime` (`@/lib/format`).
- Produces (Task 6/7 consume): `ReviewDetail` component (props `{ reviewId }`); `VerificationPanel` (props `{ verification, status }`); `ActivityTimeline` (props `{ timeline }`); `DetailErrorBoundary`; `verdictBadge(verdict): { label, variant }`.

**Verdict label map (D9):** `pass → "Passed"` (variant `success`), `warn → "Review needed"` (variant `warning`), `fail → "Failed"` (variant `destructive`), `pending/null → "Pending"` (variant `secondary`). The legacy `journeys.spec.ts` pins the visible text `"Passed"`.

- [ ] **Step 1: Write the failing tests**

`tests/components/verification-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VerificationPanel } from "@/components/inbox/verification-panel"

afterEach(() => vi.restoreAllMocks())

describe("VerificationPanel", () => {
  it("shows the Passed verdict and no reasons when clean", () => {
    render(
      <VerificationPanel
        status="verified"
        verification={{ verdict: "pass", reasons: [] }}
      />
    )
    expect(screen.getByText("Passed")).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("lists every verification reason with its message for a failed verdict", () => {
    render(
      <VerificationPanel
        status="drafted"
        verification={{
          verdict: "fail",
          reasons: [
            { code: "personal_contact_data", severity: "fail", message: "The reply contains an email address or phone number." },
            { code: "tone_length", severity: "warn", message: "The reply may be too long for the selected tone." },
          ],
        }}
      />
    )
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(
      screen.getByText("The reply contains an email address or phone number.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("The reply may be too long for the selected tone.")
    ).toBeInTheDocument()
  })

  it("renders a Pending verdict when there is no verification yet", () => {
    render(<VerificationPanel status="new" verification={null} />)
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })
})
```

`tests/components/activity-timeline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActivityTimeline } from "@/components/inbox/activity-timeline"

afterEach(() => vi.restoreAllMocks())

describe("ActivityTimeline", () => {
  it("humanises actions and shows the actor name", () => {
    render(
      <ActivityTimeline
        timezone="Europe/London"
        timeline={[
          {
            action: "review.draft.generated",
            createdAt: "2026-07-30T10:05:00.000Z",
            actorName: "Alex Owner",
            metadataSummary: null,
          },
          {
            action: "review.approval.approved",
            createdAt: "2026-07-30T11:00:00.000Z",
            actorName: null,
            metadataSummary: "Additional audit details recorded",
          },
        ]}
      />
    )
    expect(screen.getByText("Draft generated")).toBeInTheDocument()
    expect(screen.getByText(/Alex Owner/)).toBeInTheDocument()
    expect(screen.getByText("Approval approved")).toBeInTheDocument()
  })

  it("shows an empty note when nothing has happened", () => {
    render(<ActivityTimeline timezone="Europe/London" timeline={[]} />)
    expect(screen.getByText("No activity yet.")).toBeInTheDocument()
  })
})
```

`tests/components/detail-error-boundary.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"

function Boom(): never {
  throw new Error("detail exploded")
}

afterEach(() => vi.restoreAllMocks())

describe("DetailErrorBoundary", () => {
  it("isolates a thrown detail pane and offers a retry without crashing the list", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <DetailErrorBoundary>
        <Boom />
      </DetailErrorBoundary>
    )
    expect(screen.getByText("This review could not be shown.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("renders children when nothing throws", () => {
    render(
      <DetailErrorBoundary>
        <p>All good</p>
      </DetailErrorBoundary>
    )
    expect(screen.getByText("All good")).toBeInTheDocument()
  })
})
```

`tests/components/review-detail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewDetail } from "@/components/inbox/review-detail"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"

function fakeDetail(value: Partial<UseQueryResult<ReviewDetailData>>) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue(
    value as UseQueryResult<ReviewDetailData>
  )
}

const detail: ReviewDetailData = {
  review: {
    id: "rev-1",
    reviewerDisplayName: "Sam Traveller",
    reviewerIsAnonymous: false,
    rating: 2,
    text: "Slow service at breakfast.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-07-30T10:00:00.000Z",
    updateTime: "2026-07-30T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "drafted",
    locationId: "loc-1",
    locationName: "Riverside",
    timezone: "Europe/London",
    verified: true,
    media: [],
    drafts: [
      {
        id: "d1",
        source: "ai",
        body: "We are sorry to hear that.",
        bodyBytes: 26,
        evidenceHash: "h",
        modelName: "gpt",
        verificationStatus: "warn",
        createdAt: "2026-07-30T10:05:00.000Z",
      },
    ],
    reply: null,
    timeline: [],
    capabilities: { canPublish: true, canEdit: true },
    latestVerification: null,
  },
}

afterEach(() => vi.restoreAllMocks())

describe("ReviewDetail", () => {
  it("renders a busy state while the detail query is pending", () => {
    fakeDetail({ isPending: true, isError: false })
    const { container } = render(<ReviewDetail reviewId="rev-1" />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("renders the conversation and the reviewer's words", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByText("Slow service at breakfast.")).toBeInTheDocument()
    expect(screen.getByText("Riverside")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/verification-panel.test.tsx tests/components/activity-timeline.test.tsx tests/components/detail-error-boundary.test.tsx tests/components/review-detail.test.tsx --project components`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement the panels and boundary**

`components/inbox/verification-panel.tsx`:

```tsx
"use client"

import { useId } from "react"

import { Badge } from "@/components/ui/badge"
import type { LatestVerification } from "@/lib/api/reviews"

function verdictBadge(verdict: string | null | undefined): {
  label: string
  variant: "success" | "warning" | "destructive" | "secondary"
} {
  if (verdict === "pass") return { label: "Passed", variant: "success" }
  if (verdict === "warn") return { label: "Review needed", variant: "warning" }
  if (verdict === "fail") return { label: "Failed", variant: "destructive" }
  return { label: "Pending", variant: "secondary" }
}

function VerificationPanel({
  verification,
  status,
}: {
  verification: LatestVerification | null
  status: string
}) {
  const badge = verdictBadge(verification?.verdict)
  const reasons = verification?.reasons ?? []
  // Unique per instance so the panel is safe to render more than once on a
  // page without a duplicate-id axe violation.
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-ui font-semibold">
          Verification
        </h3>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {reasons.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {verification
            ? "No issues were found in this reply."
            : "Generate a draft to run verification."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {reasons.map((reason, index) => (
            <li
              key={`${reason.code}-${index}`}
              className="flex items-start gap-2 text-caption"
            >
              <Badge
                variant={reason.severity === "fail" ? "destructive" : "warning"}
                className="shrink-0"
              >
                {reason.severity === "fail" ? "Blocking" : "Warning"}
              </Badge>
              <span className="text-muted-foreground">{reason.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only">Workflow status: {status}.</p>
    </section>
  )
}

export { VerificationPanel, verdictBadge }
```

Note: `Badge`'s `success`/`warning` variants were admitted in M1 (spec §7 "`success | warning | info` variants on Alert/Badge"). Use them; if `Badge` lacks a variant, admit it there per the M1 policy rather than inventing a colour here.

`components/inbox/activity-timeline.tsx`:

```tsx
"use client"

import { formatDateTime } from "@/lib/format"

// Humanise the audit action enum into GB-English sentence case (spec §7 "no
// internal jargon"): "review.draft.generated" -> "Draft generated".
function humaniseAction(action: string): string {
  const trimmed = action.replace(/^review\./, "").replace(/_/g, " ")
  const words = trimmed.split(".").join(" ")
  const sentence = words.charAt(0).toUpperCase() + words.slice(1)
  return sentence
}

function ActivityTimeline({
  timeline,
  timezone,
}: {
  timeline: {
    action: string
    createdAt: string
    actorName: string | null
    metadataSummary: string | null
  }[]
  timezone: string
}) {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      <h3 id="activity-heading" className="text-ui font-semibold">
        Activity
      </h3>
      {timeline.length === 0 ? (
        <p className="text-caption text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {timeline.map((event, index) => (
            <li key={index} className="flex flex-col gap-0.5 text-caption">
              <span className="font-medium">{humaniseAction(event.action)}</span>
              <span className="text-muted-foreground">
                {event.actorName ? `${event.actorName} · ` : ""}
                {formatDateTime(event.createdAt, timezone)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export { ActivityTimeline, humaniseAction }
```

`components/inbox/detail-error-boundary.tsx` (a real React class error boundary — the spec §5 "isolation boundary around the review detail pane", as a component because the pane is inside one route, D2):

```tsx
"use client"

import { Component, type ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type Props = { children: ReactNode }
type State = { error: Error | null }

class DetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>This review could not be shown.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                The rest of your inbox is unaffected. Try again, or pick another
                review.
              </span>
              <Button variant="outline" size="sm" onClick={this.reset}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}

export { DetailErrorBoundary }
```

- [ ] **Step 4: Implement `review-detail.tsx`**

Contract: reads `useReviewDetail(reviewId)`; loading → `aria-busy` skeleton; error → renders an inline `Alert` with a retry (the `DetailErrorBoundary` still wraps this for *unexpected* render errors); populated → conversation (review bubble with `lang`/`dir="auto"`, rating, location, timestamp), media thumbnails if any, published-reply bubble if `reply`, then `ActivityTimeline`. The `VerificationPanel` is NOT rendered here: the detail endpoint returns only a per-draft verdict (no `reasons` array), so the panel is rendered by the reply composer (Task 6) where the live `verification.reasons` from the last generate/verify mutation are available (D9). The reply composer and action bar are injected by Tasks 6/7 via a `footer` slot so this task stays independently testable.

```tsx
"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { formatDateTime } from "@/lib/format"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import type { ReactNode } from "react"

function ReviewDetail({
  reviewId,
  footer,
}: {
  reviewId: string
  footer?: ReactNode
}) {
  const query = useReviewDetail(reviewId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-40 rounded-(--nr-radius-control)" />
        <Skeleton className="h-24 w-full rounded-(--nr-radius-card)" />
        <Skeleton className="h-40 w-full rounded-(--nr-radius-card)" />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>We could not load this review.</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Check your connection, then try again.</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const review = query.data.review

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-title font-semibold">
            {review.reviewerIsAnonymous
              ? "Anonymous"
              : (review.reviewerDisplayName ?? "Anonymous")}
          </h2>
          <p className="text-caption text-muted-foreground">
            <span aria-label={review.rating === null ? "No rating" : `${review.rating} stars`}>
              {review.rating === null ? "—" : "★".repeat(review.rating)}
            </span>{" "}
            · {review.locationName} · {formatDateTime(review.createTime, review.timezone)}
          </p>
        </header>

        <blockquote
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          className="rounded-(--nr-radius-card) bg-muted p-4 text-body"
        >
          {review.text ?? "This review has no written text."}
        </blockquote>

        {review.media.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {review.media.map((item) => (
              <li key={item.id}>
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt={item.thumbnailLabel ?? "Review photo"}
                    className="size-20 rounded-(--nr-radius-control) object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {review.reply?.body ? (
          <div className="rounded-(--nr-radius-card) border border-border bg-card p-4">
            <p className="mb-1 text-caption font-medium text-muted-foreground">
              Your published reply
            </p>
            <p dir="auto" className="text-body">
              {review.reply.body}
            </p>
          </div>
        ) : null}

        <ActivityTimeline timeline={review.timeline} timezone={review.timezone} />
      </div>

      {footer ? (
        <div className="mt-auto border-t border-border/60 p-6">{footer}</div>
      ) : null}
    </div>
  )
}

export { ReviewDetail }
```

- [ ] **Step 5: Wire the detail pane into `InboxView`**

In `components/inbox/inbox-view.tsx`, add imports:

```tsx
import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import { ReviewDetail } from "@/components/inbox/review-detail"
```

Replace the placeholder `<section aria-label="Selected review" …>…</section>` block with the version below — **keeping Task 4's mobile-pane className and the mobile "Back to reviews" button**, and swapping only the inner content placeholder for the real detail:

```tsx
      <section
        aria-label="Selected review"
        className={cn(
          "min-h-0 rounded-(--nr-radius-card) border border-border bg-card xl:flex xl:flex-col",
          mobilePane === "detail" ? "flex flex-col" : "hidden xl:flex"
        )}
      >
        {state.selected ? (
          <>
            <div className="border-b border-border/60 p-3 xl:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateState({ selected: undefined }, "replace")}
              >
                Back to reviews
              </Button>
            </div>
            <DetailErrorBoundary key={state.selected}>
              <ReviewDetail reviewId={state.selected} />
            </DetailErrorBoundary>
          </>
        ) : (
          <p className="p-6 text-ui text-muted-foreground">
            Select a review to see the full conversation.
          </p>
        )}
      </section>
```

The `key={state.selected}` remounts the boundary (and clears any prior error) when the selection changes. The mobile-pane classes (`mobilePane === "detail" ? … : …`) and the `xl:hidden` back button are unchanged from Task 4.

- [ ] **Step 6: Run to verify pass, then build**

```bash
pnpm exec vitest run tests/components/verification-panel.test.tsx tests/components/activity-timeline.test.tsx tests/components/detail-error-boundary.test.tsx tests/components/review-detail.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS + green build.

- [ ] **Step 7: Commit**

```bash
git add components/inbox/review-detail.tsx components/inbox/verification-panel.tsx components/inbox/activity-timeline.tsx components/inbox/detail-error-boundary.tsx components/inbox/inbox-view.tsx tests/components/verification-panel.test.tsx tests/components/activity-timeline.test.tsx tests/components/detail-error-boundary.test.tsx tests/components/review-detail.test.tsx
git commit -m "feat(inbox): review detail pane, verification-reason panel, activity timeline, isolation boundary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Reply composer + shared `useDirtyGuard` + draft mutations + regenerate-confirm

> **Highest-risk task of the milestone — assign a dedicated implementer and a dedicated reviewer pass** (M4's analog of M2's highest-risk auth surface). The dirty guard is a shared foundation for M5+ editors; get its unit tests right.

**Files:**
- Create primitives: `components/ui/textarea.tsx`, `components/ui/alert-dialog.tsx`
- Create: `lib/hooks/use-dirty-guard.ts`, `components/inbox/dirty-context.tsx`, `components/inbox/reply-composer.tsx`, `lib/queries/use-draft-mutations.ts`
- Modify: `components/inbox/inbox-view.tsx` (wrap in `DirtyGuardProvider`, gate `onSelect` behind the dirty gate, pass the composer as `ReviewDetail`'s `footer`)
- Test: `tests/components/use-dirty-guard.test.tsx`, `tests/components/reply-composer.test.tsx`

**Interfaces:**
- Consumes: `registerDraftSource`/`takeStashedDraft` (`@/lib/api/draft-stash`), `generateOrSaveDraft`/`verifyDraft` (Task 2), `useReviewDetail` (Task 3), `useToastManager` (existing toast), `VerificationPanel` (Task 5), `Verification` (Task 2).
- Produces (Task 7 consumes): `useDirtyGuard({ key, isDirty, snapshot }): { confirmDiscard, restore }`; `DirtyGuardProvider`, `useRegisterDirtyGuard(isDirty, confirmDiscard)`, `useDirtyGate(): () => boolean`, `useReadIsDirty(): () => boolean`, `useIsDirty(): boolean`; `ReplyComposer` (props `{ reviewId }`); `useGenerateOrSaveDraft(reviewId)`, `useVerifyDraft(reviewId)`; `Textarea`; `AlertDialog`/`AlertDialogContent`/… primitives.

- [ ] **Step 1: Write the failing dirty-guard tests**

`tests/components/use-dirty-guard.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { __resetDraftSources, stashAllDrafts, takeStashedDraft } from "@/lib/api/draft-stash"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe("useDirtyGuard", () => {
  it("stashes the snapshot only while dirty", () => {
    const { rerender } = renderHook(
      ({ dirty, text }: { dirty: boolean; text: string }) =>
        useDirtyGuard({ key: "inbox:reply:rev-1", isDirty: dirty, snapshot: () => text }),
      { initialProps: { dirty: false, text: "hello" } }
    )
    stashAllDrafts()
    expect(takeStashedDraft("inbox:reply:rev-1")).toBeNull()

    rerender({ dirty: true, text: "hello" })
    stashAllDrafts()
    expect(takeStashedDraft("inbox:reply:rev-1")).toBe("hello")
  })

  it("confirmDiscard is true when clean and defers to window.confirm when dirty", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    const clean = renderHook(() =>
      useDirtyGuard({ key: "k", isDirty: false, snapshot: () => "x" })
    )
    expect(clean.result.current.confirmDiscard()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()

    const dirty = renderHook(() =>
      useDirtyGuard({ key: "k2", isDirty: true, snapshot: () => "x" })
    )
    expect(dirty.result.current.confirmDiscard()).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
  })

  it("arms beforeunload while dirty and disarms when clean", () => {
    const { rerender, unmount } = renderHook(
      ({ dirty }: { dirty: boolean }) =>
        useDirtyGuard({ key: "k3", isDirty: dirty, snapshot: () => "x" }),
      { initialProps: { dirty: true } }
    )
    const dirtyEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)

    rerender({ dirty: false })
    const cleanEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)
    unmount()
  })

  it("restore returns and clears the stashed draft", () => {
    sessionStorage.setItem("naba:draft:inbox:reply:rev-9", "recovered")
    const { result } = renderHook(() =>
      useDirtyGuard({ key: "inbox:reply:rev-9", isDirty: false, snapshot: () => "" })
    )
    expect(result.current.restore()).toBe("recovered")
    expect(result.current.restore()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/use-dirty-guard.test.tsx --project components`
Expected: FAIL — `@/lib/hooks/use-dirty-guard` does not exist.

- [ ] **Step 3: Implement `lib/hooks/use-dirty-guard.ts`**

```ts
"use client"

import { useCallback, useEffect, useRef } from "react"

import { registerDraftSource, takeStashedDraft } from "@/lib/api/draft-stash"

// The one shared dirty guard (spec §6). Used by the reply composer now and the
// hours/menu/post editors later. Responsibilities:
//   1. Mirror the current content to the sessionStorage stash (via the
//      existing draft-stash registry) so a forced 401 sign-out preserves it.
//   2. Arm `beforeunload` while dirty so a tab close/reload warns.
//   3. Provide `confirmDiscard()` for in-app navigation / dialog dismissal.
//   4. Provide `restore()` to recover a stashed draft on mount.
export function useDirtyGuard({
  key,
  isDirty,
  snapshot,
}: {
  key: string
  isDirty: boolean
  snapshot: () => string
}): { confirmDiscard: () => boolean; restore: () => string | null } {
  // Keep the latest dirtiness/snapshot in a ref so the registered source
  // function is stable but always reads current values.
  const latest = useRef({ isDirty, snapshot })
  latest.current = { isDirty, snapshot }

  useEffect(() => {
    return registerDraftSource(key, () =>
      latest.current.isDirty ? latest.current.snapshot() : null
    )
  }, [key])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const confirmDiscard = useCallback(() => {
    if (!latest.current.isDirty) return true
    return window.confirm(
      "You have unsaved changes to this reply. Discard them?"
    )
  }, [])

  const restore = useCallback(() => takeStashedDraft(key), [key])

  return { confirmDiscard, restore }
}
```

- [ ] **Step 4: Implement the selection-suppression context**

`components/inbox/dirty-context.tsx` (a subscribable store: the list and the auto-select effect read dirtiness *imperatively* — no re-render per keystroke — while the action bar *subscribes* via `useSyncExternalStore` so only IT re-renders to disable Publish while dirty):

```tsx
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"

type Gate = { isDirty: boolean; confirmDiscard: () => boolean }

class DirtyStore {
  private gate: Gate = { isDirty: false, confirmDiscard: () => true }
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getIsDirty = () => this.gate.isDirty
  confirmDiscard = () => this.gate.confirmDiscard()
  set = (gate: Gate) => {
    this.gate = gate
    this.listeners.forEach((listener) => listener())
  }
}

const DirtyStoreContext = createContext<DirtyStore | null>(null)
const NOOP_SUBSCRIBE = () => () => {}

function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<DirtyStore>()
  if (!storeRef.current) storeRef.current = new DirtyStore()
  return (
    <DirtyStoreContext.Provider value={storeRef.current}>
      {children}
    </DirtyStoreContext.Provider>
  )
}

// The composer publishes its live dirtiness + confirm into the shared store.
function useRegisterDirtyGuard(isDirty: boolean, confirmDiscard: () => boolean) {
  const store = useContext(DirtyStoreContext)
  useEffect(() => {
    store?.set({ isDirty, confirmDiscard })
    return () => store?.set({ isDirty: false, confirmDiscard: () => true })
  }, [store, isDirty, confirmDiscard])
}

// The list uses this before a selection change: true if it is safe to navigate
// (clean, or the user confirmed discarding). Imperative — does NOT subscribe.
function useDirtyGate(): () => boolean {
  const store = useContext(DirtyStoreContext)
  return useCallback(() => {
    if (!store) return true
    if (!store.getIsDirty()) return true
    return store.confirmDiscard()
  }, [store])
}

// The auto-select effect uses this to read dirtiness at decision time without
// subscribing (no re-render churn on the list).
function useReadIsDirty(): () => boolean {
  const store = useContext(DirtyStoreContext)
  return useCallback(() => (store ? store.getIsDirty() : false), [store])
}

// The action bar subscribes reactively so Publish disables the moment the
// composer becomes dirty; only this consumer re-renders (not the list).
function useIsDirty(): boolean {
  const store = useContext(DirtyStoreContext)
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    () => (store ? store.getIsDirty() : false),
    () => false
  )
}

export {
  DirtyGuardProvider,
  useRegisterDirtyGuard,
  useDirtyGate,
  useReadIsDirty,
  useIsDirty,
}
```

- [ ] **Step 5: Admit the `Textarea` and `AlertDialog` primitives**

`components/ui/textarea.tsx` (base-ui has no textarea component; a styled native `<textarea>` matching the Input chrome):

```tsx
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-32 w-full resize-y rounded-(--nr-radius-control) border border-border bg-card px-3 py-2 text-body focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

`components/ui/alert-dialog.tsx` (base-ui `alert-dialog`; mirrors the Dialog wrapper):

```tsx
"use client"

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}
function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}
function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
}

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 supports-backdrop-filter:backdrop-blur-sm" />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-(--nr-radius-modal) bg-popover p-6 text-sm text-popover-foreground shadow-(--nr-shadow-modal) ring-1 ring-foreground/5 outline-none sm:max-w-md",
          className
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}
function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}
function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
}
```

- [ ] **Step 6: Implement the draft mutation hooks**

`lib/queries/use-draft-mutations.ts` (server-confirmed; on success invalidate `reviewDetail` + `reviews` + `reviewCounts`):

```ts
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { generateOrSaveDraft, verifyDraft, type DraftInput } from "@/lib/api/drafts"
import { queryKeys } from "./keys"

function useInvalidateReviewWrites(reviewId: string) {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
    void client.invalidateQueries({ queryKey: ["reviews"] })
    void client.invalidateQueries({ queryKey: ["review-counts"] })
  }
}

export function useGenerateOrSaveDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (input: DraftInput) => generateOrSaveDraft(reviewId, input),
    onSuccess: invalidate,
  })
}

export function useVerifyDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (draftId: string) => verifyDraft(draftId),
    onSuccess: invalidate,
  })
}
```

- [ ] **Step 7: Write the failing composer tests**

`tests/components/reply-composer.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReplyComposer } from "@/components/inbox/reply-composer"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"

function reviewWith(overrides: Partial<ReviewDetail["review"]> = {}): ReviewDetail {
  return {
    review: {
      id: "rev-1",
      reviewerDisplayName: "Sam",
      reviewerIsAnonymous: false,
      rating: 4,
      text: "Nice",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z",
      updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false,
      workflowStatus: "new",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [],
      reply: null,
      timeline: [],
      capabilities: { canPublish: true, canEdit: true },
      latestVerification: null,
      ...overrides,
    },
  }
}

// Resolve a realistic DraftResult so runGenerate/onSave can read result.body /
// result.verification without throwing.
const DRAFT_RESULT = {
  draftId: "d-new",
  body: "Generated reply body",
  bodyBytes: 20,
  evidenceHash: "h",
  verification: { id: "v-new", verdict: "pass" as const, reasons: [] },
}

function mockMutation(mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    isError: false,
  } as unknown as UseMutationResult<never, Error, never>
}

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe("ReplyComposer", () => {
  it("labels the generate button 'Generate draft' when there is no draft yet", () => {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeInTheDocument()
  })

  it("labels it 'Regenerate' once a draft exists and seeds the textbox", () => {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "ai",
            body: "Existing draft body",
            bodyBytes: 19,
            evidenceHash: "h",
            modelName: "gpt",
            verificationStatus: "warn",
            createdAt: "2026-07-30T10:05:00.000Z",
          },
        ],
      }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Reply draft" })).toHaveValue(
      "Existing draft body"
    )
  })

  it("enables Save draft only after an edit and posts the edited body", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "ai", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ] }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation(mutateAsync))
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
    const textbox = screen.getByRole("textbox", { name: "Reply draft" })
    await user.clear(textbox)
    await user.type(textbox, "Edited reply body")
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "Save draft" }))
    expect(mutateAsync).toHaveBeenCalledWith({ body: "Edited reply body" })
  })

  it("confirms before regenerating over unsaved edits", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "ai", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ] }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation(mutateAsync))
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    await user.type(screen.getByRole("textbox", { name: "Reply draft" }), " extra")
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    // A confirm dialog appears; the regenerate has NOT fired yet.
    expect(
      screen.getByRole("alertdialog", { name: /Discard your edits/ })
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Discard and regenerate" }))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    )
  })
})
```

- [ ] **Step 8: Implement `components/inbox/reply-composer.tsx`**

Contract: seeds the textbox from the latest draft body (or the stashed draft, if any); `isDirty` = current value differs from the seeded/last-saved value; **Generate/Regenerate** posts with NO `body` (label "Generate draft" when `drafts.length === 0`, else "Regenerate"); regenerate over a dirty composer opens the confirm `AlertDialog` first; **Save draft** posts with `body` (enabled only when dirty and non-empty); **Re-verify** calls `verifyDraft(latestDraftId)`; a byte counter shows `bodyBytes`/4096; registers with the dirty gate + `useDirtyGuard`; renders `<VerificationPanel>` (Task 5) fed by `mutationVerification ?? review.latestVerification` — so on load it shows the persisted verdict AND reasons (D3/D9), and a fresh generate/verify mutation supersedes it. Toasts use `useToastManager().add`.

```tsx
"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { useRegisterDirtyGuard } from "@/components/inbox/dirty-context"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/inbox/action-errors"
import { useGenerateOrSaveDraft, useVerifyDraft } from "@/lib/queries/use-draft-mutations"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { VerificationPanel } from "@/components/inbox/verification-panel"
import type { LatestVerification } from "@/lib/api/reviews"

const TONES = [
  { value: "warm_professional", label: "Warm and professional" },
  { value: "concise", label: "Concise" },
  { value: "empathetic", label: "Empathetic" },
] as const

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function ReplyComposer({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const review = detail.data?.review
  const latestDraft = review?.drafts[0]
  const seededBody = latestDraft?.body ?? ""

  const guardKey = `inbox:reply:${reviewId}`
  const [body, setBody] = useState("")
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("warm_professional")
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Verification produced by THIS session's latest generate/verify mutation;
  // null until the user acts, then the persisted review.latestVerification (D3)
  // shows verdict AND reasons on load.
  const [mutationVerification, setMutationVerification] =
    useState<LatestVerification | null>(null)

  const isDirty = body !== seededBody
  const { confirmDiscard, restore } = useDirtyGuard({
    key: guardKey,
    isDirty,
    snapshot: () => body,
  })
  useRegisterDirtyGuard(isDirty, confirmDiscard)

  // Seed the textbox once per review, when its detail data is available; a ref
  // guard stops a post-mutation refetch (same reviewId) from clobbering unsaved
  // edits. A stashed draft from a forced sign-out wins over the server body.
  const seededReviewRef = useRef<string | null>(null)
  useEffect(() => {
    if (!review) return
    if (seededReviewRef.current === reviewId) return
    seededReviewRef.current = reviewId
    const stashed = restore()
    setBody(stashed ?? review.drafts[0]?.body ?? "")
    setMutationVerification(null)
  }, [review, reviewId, restore])

  const generateOrSave = useGenerateOrSaveDraft(reviewId)
  const verify = useVerifyDraft(reviewId)
  const toasts = useToastManager()

  const generateLabel = useMemo(
    () => (review && review.drafts.length > 0 ? "Regenerate" : "Generate draft"),
    [review]
  )

  async function runGenerate() {
    try {
      const result = await generateOrSave.mutateAsync({ tone })
      setBody(result.body)
      setMutationVerification(result.verification)
      toasts.add({
        title: "Draft ready",
        description: "A fresh reply was generated and verified.",
        type: "success",
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  function onGenerateClick() {
    if (isDirty) {
      setConfirmOpen(true)
      return
    }
    void runGenerate()
  }

  async function onSave() {
    try {
      const result = await generateOrSave.mutateAsync({ body })
      setMutationVerification(result.verification)
      toasts.add({ title: "Draft saved", type: "success" })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  async function onReverify() {
    if (!latestDraft) return
    try {
      const result = await verify.mutateAsync(latestDraft.id)
      setMutationVerification(result.verification)
      toasts.add({ title: "Reply re-verified", type: "success" })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  if (!review) return null
  const canEdit = review.capabilities.canEdit
  const bytes = byteLength(body)
  const overLimit = bytes > 4096
  // On load the persisted verdict+reasons show; a fresh mutation supersedes it.
  const displayedVerification = mutationVerification ?? review.latestVerification

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="reply-draft" className="text-ui font-semibold">
          Your reply
        </label>
        <Select value={tone} onValueChange={(value: string) => setTone(value as typeof tone)}>
          <SelectTrigger aria-label="Reply tone" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        id="reply-draft"
        aria-label="Reply draft"
        lang={review.detectedLanguageCode ?? undefined}
        dir="auto"
        value={body}
        disabled={!canEdit}
        aria-invalid={overLimit || undefined}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a reply, or generate one to start."
      />
      <p className={overLimit ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>
        {bytes.toLocaleString("en-GB")} / 4,096 bytes
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canEdit || generateOrSave.isPending}
          onClick={onGenerateClick}
        >
          {generateOrSave.isPending ? "Working…" : generateLabel}
        </Button>
        <Button
          size="sm"
          disabled={!canEdit || !isDirty || body.trim() === "" || generateOrSave.isPending}
          onClick={() => void onSave()}
        >
          Save draft
        </Button>
        {latestDraft ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!canEdit || verify.isPending}
            onClick={() => void onReverify()}
          >
            Re-verify
          </Button>
        ) : null}
      </div>

      {/* Verification reasons rendered inline near the composer AND acting as
          the lifecycle panel (D9); the reasons come from the latest draft/
          verify mutation, which the detail endpoint does not carry. */}
      <VerificationPanel verification={displayedVerification} status={review.workflowStatus} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-label="Discard your edits?">
          <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
          <AlertDialogDescription>
            Regenerating replaces your unsaved changes with a new draft. This
            cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" size="sm" />}
            >
              Keep editing
            </AlertDialogClose>
            <Button
              size="sm"
              onClick={() => {
                setConfirmOpen(false)
                void runGenerate()
              }}
            >
              Discard and regenerate
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ReplyComposer }
```

Note: this imports `describeActionError` from `lib/inbox/action-errors.ts`, which is created in Task 7. **To keep Task 6 self-contained, create `lib/inbox/action-errors.ts` here** with the full implementation given in Task 7 Step 3 (it is pure and has its own test there); Task 7 then only *consumes* it. Add `lib/inbox/action-errors.ts` to this task's `git add`. (The alternative — a temporary inline mapper — would violate the no-duplication rule; build the real one now.)

- [ ] **Step 9: Wire the composer + dirty gate into `InboxView`**

**Important — the dirty store must sit ABOVE `InboxView`'s hooks.** `useDirtyGate`/`useReadIsDirty`/`useIsDirty` all read `DirtyStoreContext`, so the provider must be an ANCESTOR of the component that calls them. Since `InboxView` itself calls `useDirtyGate`/`useReadIsDirty`, split it: keep the current body as an inner `InboxViewInner`, and export a new `InboxView` that renders `<DirtyGuardProvider><InboxViewInner/></DirtyGuardProvider>`. Then, in `InboxViewInner`:

1. Import `DirtyGuardProvider`, `useDirtyGate`, `useReadIsDirty` from `@/components/inbox/dirty-context`, and `ReplyComposer`.
2. Add `const dirtyGate = useDirtyGate()` and `const readIsDirty = useReadIsDirty()`.
3. Guard selection: change `onSelect` to

```tsx
  const onSelect = useCallback(
    (id: string) => {
      if (!dirtyGate()) return
      updateState({ selected: id }, "push")
    },
    [dirtyGate, updateState]
  )
```

4. Thread real dirtiness into the auto-select effect — replace `isDirty: false` with `readIsDirty()` and add `readIsDirty` to the deps:

```tsx
    const id = autoSelectId({
      selected: state.selected,
      reviews,
      isDirty: readIsDirty(),
      isDesktop:
        typeof window !== "undefined" &&
        window.matchMedia("(min-width: 1280px)").matches,
    })
```
```tsx
  }, [reviewsReady, reviews, state, router, readIsDirty])
```

5. Pass the composer as the detail footer (Task 7 Step 7 adds the action bar alongside it):

```tsx
            <DetailErrorBoundary key={state.selected}>
              <ReviewDetail
                reviewId={state.selected}
                footer={<ReplyComposer reviewId={state.selected} />}
              />
            </DetailErrorBoundary>
```

6. Export the wrapper:

```tsx
function InboxView() {
  return (
    <DirtyGuardProvider>
      <InboxViewInner />
    </DirtyGuardProvider>
  )
}

export { InboxView }
```

- [ ] **Step 10: Run to verify pass, then build**

```bash
pnpm exec vitest run tests/components/use-dirty-guard.test.tsx tests/components/reply-composer.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS + green build.

- [ ] **Step 11: Commit**

```bash
git add components/ui/textarea.tsx components/ui/alert-dialog.tsx lib/hooks/use-dirty-guard.ts components/inbox/dirty-context.tsx components/inbox/reply-composer.tsx lib/queries/use-draft-mutations.ts lib/inbox/action-errors.ts components/inbox/inbox-view.tsx app/design-system/page.tsx tests/components/use-dirty-guard.test.tsx tests/components/reply-composer.test.tsx
git commit -m "feat(inbox): reply composer, shared dirty guard, draft mutations, regenerate confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Publish / approve / reject / delete action bar + capability gating + mutation hooks

**Files:**
- Create primitive: `components/ui/dropdown-menu.tsx` (base-ui `menu`)
- Create: `lib/inbox/actions.ts`, `lib/inbox/action-errors.ts` (physically created in Task 6 using the code below; its dedicated test lands here), `lib/queries/use-publish-review.ts`, `lib/queries/use-approval-decision.ts`, `lib/queries/use-delete-reply.ts`, `components/inbox/action-bar.tsx`
- Modify: `components/inbox/inbox-view.tsx` (add the action bar under the composer in the detail footer)
- Test: `tests/components/inbox-actions.test.ts`, `tests/components/action-errors.test.ts`, `tests/components/action-bar.test.tsx`

**Interfaces:**
- Consumes: `isAllowedReviewTransition`/`ReviewWorkflowState` (`@/lib/domain/workflow`), `ApiClientError` (`@/lib/api/client`), `publishReview` (Task 2), `decideApproval` (Task 2), `deletePublishedReply` (Task 2), `useReviewDetail` (Task 3), `useToastManager` (existing toast), `ReviewCapabilities` (Task 2).
- Produces: `evaluatePublish`/`evaluateApproval`/`evaluateDelete` (each → `{ enabled: boolean; reason?: string }`); `describeActionError(error): string`; `usePublishReview(reviewId)`, `useApprovalDecision(reviewId)`, `useDeleteReply(reviewId)`; `ActionBar` (props `{ reviewId }`).

- [ ] **Step 1: Implement + test `lib/inbox/action-errors.ts`** (the one copy shared with Task 6)

`lib/inbox/action-errors.ts`:

```ts
import { ApiClientError } from "@/lib/api/client"

// The single mapping layer from server error codes to GB-English user copy
// (spec §6/§8). No error code is ever shown. The exact second-approver string
// is mandated by spec §8.
const MESSAGES: Record<string, string> = {
  second_approver_required:
    "A different authorised user must approve this reply.",
  publish_permission_required:
    "You do not have permission to publish for this location.",
  approval_not_pending: "This review is no longer awaiting approval.",
  verified_draft_required: "Verify a draft before publishing this reply.",
  stale_draft_evidence:
    "This review changed since the draft was verified. Re-verify before publishing.",
  google_mutation_ambiguous:
    "Google may have applied the change. Check its status before retrying.",
  google_publish_failed: "Google rejected the reply. Please try again.",
  drafts_paused: "Draft generation is temporarily paused. Try again shortly.",
  publishing_paused: "Publishing is temporarily paused. Try again shortly.",
  review_restricted: "This review is restricted from replies.",
  authentication_required: "Your session has expired. Please sign in again.",
}

export function describeActionError(error: unknown): string {
  if (error instanceof ApiClientError && MESSAGES[error.code]) {
    return MESSAGES[error.code]
  }
  return "Something went wrong. Please try again."
}
```

`tests/components/action-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/inbox/action-errors"

describe("describeActionError", () => {
  it("uses the mandated second-approver copy", () => {
    expect(
      describeActionError(new ApiClientError(403, "second_approver_required", "x"))
    ).toBe("A different authorised user must approve this reply.")
  })

  it("maps ambiguous provider outcomes without leaking the code", () => {
    const copy = describeActionError(
      new ApiClientError(502, "google_mutation_ambiguous", "x")
    )
    expect(copy).toContain("Check its status")
    expect(copy).not.toContain("google_mutation_ambiguous")
  })

  it("falls back generically for unknown or non-API errors", () => {
    expect(describeActionError(new Error("boom"))).toBe(
      "Something went wrong. Please try again."
    )
    expect(
      describeActionError(new ApiClientError(500, "unheard_of", "x"))
    ).toBe("Something went wrong. Please try again.")
  })
})
```

- [ ] **Step 2: Implement + test `lib/inbox/actions.ts`** (workflow × capability, single source of truth — D11)

`lib/inbox/actions.ts`:

```ts
import {
  isAllowedReviewTransition,
  REVIEW_WORKFLOW_STATES,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"

export type ActionAvailability = { enabled: boolean; reason?: string }

function asState(status: string): ReviewWorkflowState | null {
  return (REVIEW_WORKFLOW_STATES as readonly string[]).includes(status)
    ? (status as ReviewWorkflowState)
    : null
}

export function evaluatePublish(input: {
  status: string
  canPublish: boolean
  hasVerifiedDraft: boolean
  isDirty: boolean
}): ActionAvailability {
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to publish for this location.",
    }
  }
  const state = asState(input.status)
  if (!state || !isAllowedReviewTransition(state, "publish_requested")) {
    return {
      enabled: false,
      reason: "This reply cannot be published from its current status.",
    }
  }
  if (!input.hasVerifiedDraft) {
    return {
      enabled: false,
      reason: "Generate and verify a draft before publishing.",
    }
  }
  if (input.isDirty) {
    return { enabled: false, reason: "Save your draft before publishing." }
  }
  return { enabled: true }
}

export function evaluateApproval(input: {
  status: string
  canPublish: boolean
}): ActionAvailability {
  if (input.status !== "awaiting_approval") {
    return { enabled: false, reason: "This reply is not awaiting approval." }
  }
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to approve for this location.",
    }
  }
  return { enabled: true }
}

export function evaluateDelete(input: {
  hasPublishedReply: boolean
  canPublish: boolean
}): ActionAvailability {
  if (!input.hasPublishedReply) {
    return { enabled: false, reason: "There is no published reply to delete." }
  }
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to change this reply.",
    }
  }
  return { enabled: true }
}
```

`tests/components/inbox-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { evaluateApproval, evaluateDelete, evaluatePublish } from "@/lib/inbox/actions"

describe("evaluatePublish", () => {
  it("is enabled for a verified, clean, publishable review", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: true, hasVerifiedDraft: true, isDirty: false })
    ).toEqual({ enabled: true })
  })
  it("blocks with a permission reason when the user cannot publish", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: false, hasVerifiedDraft: true, isDirty: false }).reason
    ).toMatch(/permission to publish/)
  })
  it("blocks a dirty composer with a save-first reason", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: true, hasVerifiedDraft: true, isDirty: true }).reason
    ).toMatch(/Save your draft/)
  })
  it("blocks when no verified draft exists", () => {
    expect(
      evaluatePublish({ status: "new", canPublish: true, hasVerifiedDraft: false, isDirty: false }).enabled
    ).toBe(false)
  })
})

describe("evaluateApproval", () => {
  it("is enabled only when awaiting approval and the user can publish", () => {
    expect(evaluateApproval({ status: "awaiting_approval", canPublish: true })).toEqual({ enabled: true })
    expect(evaluateApproval({ status: "verified", canPublish: true }).enabled).toBe(false)
    expect(evaluateApproval({ status: "awaiting_approval", canPublish: false }).enabled).toBe(false)
  })
})

describe("evaluateDelete", () => {
  it("requires a published reply and publish rights", () => {
    expect(evaluateDelete({ hasPublishedReply: true, canPublish: true })).toEqual({ enabled: true })
    expect(evaluateDelete({ hasPublishedReply: false, canPublish: true }).enabled).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify (actions + errors) fail then pass**

Run: `pnpm exec vitest run tests/components/action-errors.test.ts tests/components/inbox-actions.test.ts --project components`
Expected: FAIL first (if Task 6 has not yet landed `action-errors.ts`, create it now from Step 1), then PASS after Steps 1–2.

- [ ] **Step 4: Admit `DropdownMenu` and implement the mutation hooks**

`components/ui/dropdown-menu.tsx` (base-ui `menu`):

```tsx
"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}
function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={6} align="end" className="z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-48 rounded-(--nr-radius-modal) border bg-popover p-1 text-popover-foreground shadow-(--nr-shadow-modal) outline-none",
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-(--nr-radius-control) px-3 py-1.5 text-ui outline-none data-highlighted:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
```

`lib/queries/use-publish-review.ts`:

```ts
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { publishReview } from "@/lib/api/publish"
import { queryKeys } from "./keys"

export function usePublishReview(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { draftId: string; expectedReviewUpdateTime: string }) =>
      publishReview(reviewId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
```

`lib/queries/use-approval-decision.ts`:

```ts
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { queryKeys } from "./keys"

export function useApprovalDecision(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { decision: "approve" | "reject"; note?: string }) =>
      decideApproval(reviewId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
```

`lib/queries/use-delete-reply.ts`:

```ts
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { deletePublishedReply } from "@/lib/api/reply"
import { queryKeys } from "./keys"

export function useDeleteReply(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => deletePublishedReply(reviewId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
```

- [ ] **Step 5: Write the failing action-bar tests**

`tests/components/action-bar.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar } from "@/components/inbox/action-bar"
import {
  DirtyGuardProvider,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { ReviewDetail } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as publishHook from "@/lib/queries/use-publish-review"
import * as approvalHook from "@/lib/queries/use-approval-decision"
import * as deleteHook from "@/lib/queries/use-delete-reply"

function detailWith(overrides: Partial<ReviewDetail["review"]>): ReviewDetail {
  return {
    review: {
      id: "rev-1", reviewerDisplayName: "Sam", reviewerIsAnonymous: false,
      rating: 4, text: "Nice", detectedLanguageCode: "en", languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z", updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false, workflowStatus: "verified", locationId: "loc-1",
      locationName: "Riverside", timezone: "Europe/London", verified: true,
      media: [],
      drafts: [
        { id: "d1", source: "ai", body: "Reply", bodyBytes: 5, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ],
      reply: null, timeline: [], capabilities: { canPublish: true, canEdit: true },
      latestVerification: null,
      ...overrides,
    },
  }
}

function mutation(mutateAsync = vi.fn().mockResolvedValue({ status: "published" })) {
  return { mutate: vi.fn(), mutateAsync, isPending: false } as unknown as UseMutationResult<never, Error, never>
}

afterEach(() => vi.restoreAllMocks())

function stubHooks(detail: ReviewDetail, publish = mutation(), approval = mutation(), del = mutation()) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({ data: detail } as UseQueryResult<ReviewDetail>)
  vi.spyOn(publishHook, "usePublishReview").mockReturnValue(publish)
  vi.spyOn(approvalHook, "useApprovalDecision").mockReturnValue(approval)
  vi.spyOn(deleteHook, "useDeleteReply").mockReturnValue(del)
}

// ActionBar calls useToastManager() (needs a <Toaster> ancestor) and useIsDirty()
// (needs a DirtyGuardProvider). This host supplies both; `dirty` marks the
// composer dirty so Publish must disable with the save-first reason.
function DirtyStamp({ dirty }: { dirty: boolean }) {
  useRegisterDirtyGuard(dirty, () => true)
  return null
}
function renderActionBar(dirty = false) {
  return render(
    <Toaster>
      <DirtyGuardProvider>
        <DirtyStamp dirty={dirty} />
        <ActionBar reviewId="rev-1" />
      </DirtyGuardProvider>
    </Toaster>
  )
}

describe("ActionBar", () => {
  it("enables Publish for a verified, publishable, clean review and posts the draft id", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    stubHooks(detailWith({}), publish)
    renderActionBar()
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(publish.mutateAsync).toHaveBeenCalledWith({
      draftId: "d1",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
  })

  it("disables Publish with a reason when the user cannot publish", () => {
    stubHooks(detailWith({ capabilities: { canPublish: false, canEdit: true } }))
    renderActionBar()
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringContaining("permission to publish"))
  })

  it("disables Publish with a save-first reason while the composer is dirty", () => {
    stubHooks(detailWith({}))
    renderActionBar(true)
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringContaining("Save your draft"))
  })

  it("shows Approve and Reject when awaiting approval", () => {
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }))
    renderActionBar()
    expect(screen.getByRole("button", { name: "Approve reply" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject reply" })).toBeInTheDocument()
  })

  it("surfaces the second-approver copy on a 403", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi.fn().mockRejectedValue(new ApiClientError(403, "second_approver_required", "x"))
    )
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }), mutation(), approval)
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Approve reply" }))
    await waitFor(() =>
      expect(
        screen.getByText("A different authorised user must approve this reply.")
      ).toBeInTheDocument()
    )
  })
})
```

Note: `useToastManager()` needs a `<ToastProvider>` ancestor and `useIsDirty()` needs a `DirtyGuardProvider`; the `renderActionBar` host above supplies both (see it wrap `<Toaster><DirtyGuardProvider>…`). **App wiring is already in place — do NOT add a second `<Toaster>`:** `app/layout.tsx:30` already renders `<Toaster>{children}</Toaster>`, so every route (inbox included) is inside the toast provider, and `InboxView`'s `<DirtyGuardProvider>` (Task 6 Step 9) supplies the dirty store for the composer and action bar.

- [ ] **Step 6: Implement `components/inbox/action-bar.tsx`**

```tsx
"use client"

import { useState } from "react"
import { MoreHorizontalIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToastManager } from "@/components/ui/toast"
import { useIsDirty } from "@/components/inbox/dirty-context"
import { evaluateApproval, evaluateDelete, evaluatePublish } from "@/lib/inbox/actions"
import { describeActionError } from "@/lib/inbox/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

const VERIFIED = new Set(["pass", "warn"])

function ActionBar({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const publish = usePublishReview(reviewId)
  const approval = useApprovalDecision(reviewId)
  const remove = useDeleteReply(reviewId)
  const toasts = useToastManager()
  // Live composer dirtiness (reactive; only this sibling re-renders on it), so
  // Publish disables with "Save your draft before publishing" while the
  // on-screen text differs from the persisted verified draft (LOCKED #4).
  const isDirty = useIsDirty()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const review = detail.data?.review
  if (!review) return null

  const verifiedDraft = review.drafts.find(
    (draft) => draft.verificationStatus && VERIFIED.has(draft.verificationStatus)
  )
  const publishState = evaluatePublish({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
    hasVerifiedDraft: Boolean(verifiedDraft),
    isDirty,
  })
  const approvalState = evaluateApproval({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
  })
  const deleteState = evaluateDelete({
    hasPublishedReply: Boolean(review.reply?.body),
    canPublish: review.capabilities.canPublish,
  })

  async function onPublish() {
    if (!verifiedDraft) return
    try {
      const result = await publish.mutateAsync({
        draftId: verifiedDraft.id,
        expectedReviewUpdateTime: review.updateTime,
      })
      toasts.add({
        title:
          result.status === "awaiting_approval"
            ? "Reply submitted for approval."
            : "Reply published",
        type: result.status === "awaiting_approval" ? "info" : "success",
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  async function onDecision(decision: "approve" | "reject") {
    try {
      await approval.mutateAsync({ decision })
      toasts.add({
        title: decision === "approve" ? "Reply published" : "Reply returned to draft.",
        type: "success",
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  async function onDelete() {
    try {
      await remove.mutateAsync()
      toasts.add({ title: "Published reply deleted", type: "success" })
      setDeleteOpen(false)
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const awaitingApproval = review.workflowStatus === "awaiting_approval"

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {awaitingApproval ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!approvalState.enabled || approval.isPending}
            title={approvalState.reason}
            onClick={() => void onDecision("reject")}
          >
            Reject reply
          </Button>
          <Button
            size="sm"
            disabled={!approvalState.enabled || approval.isPending}
            title={approvalState.reason}
            onClick={() => void onDecision("approve")}
          >
            {approval.isPending ? "Working…" : "Approve reply"}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={!publishState.enabled || publish.isPending}
          title={publishState.reason}
          onClick={() => void onPublish()}
        >
          {publish.isPending ? "Publishing…" : "Publish reply"}
        </Button>
      )}

      {deleteState.enabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Review actions" />}
          >
            <MoreHorizontalIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
              Delete published reply
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent aria-label="Delete published reply?">
          <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your reply from Google. You can write a new one
            afterwards.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Keep reply
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => void onDelete()}
            >
              Delete reply
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ActionBar }
```

Note on `isDirty` and Publish (LOCKED #4): the composer publishes its live dirtiness into the shared `dirty-context` store; the action bar reads it via `useIsDirty()` (a `useSyncExternalStore` subscription, so only the action bar re-renders on keystroke — not the list) and passes it to `evaluatePublish`. Publish therefore disables with the existing "Save your draft before publishing" reason while the on-screen text differs from the persisted draft, and publishing always uses the persisted verified draft id, never unsaved textarea text (D7, no optimistic publish; published text can never diverge from what the user sees). Saving invalidates `reviewDetail`, so a freshly-saved verified draft appears here within one round trip.

- [ ] **Step 7: Wire the action bar into the detail footer**

In `components/inbox/inbox-view.tsx`, import `ActionBar` and change the footer to render both the composer and the action bar:

```tsx
            <ReviewDetail
              reviewId={state.selected}
              footer={
                <div className="flex flex-col gap-4">
                  <ReplyComposer reviewId={state.selected} />
                  <ActionBar reviewId={state.selected} />
                </div>
              }
            />
```

- [ ] **Step 8: Run to verify pass, then build**

```bash
pnpm exec vitest run tests/components/action-errors.test.ts tests/components/inbox-actions.test.ts tests/components/action-bar.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS + green build.

- [ ] **Step 9: Commit**

```bash
git add components/ui/dropdown-menu.tsx lib/inbox/actions.ts lib/queries/use-publish-review.ts lib/queries/use-approval-decision.ts lib/queries/use-delete-reply.ts components/inbox/action-bar.tsx components/inbox/inbox-view.tsx app/design-system/page.tsx tests/components/inbox-actions.test.ts tests/components/action-errors.test.ts tests/components/action-bar.test.tsx
git commit -m "feat(inbox): capability-gated publish/approve/reject/delete action bar with server-confirmed mutations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full filter set + mobile filter sheet + active-filter chips

> Parallelizable with Tasks 4/5/6/7 after Task 3 (it only depends on the URL-state helper and the `Sheet`/`Select` primitives). It writes exclusively to the URL via `router.replace` — no local filter state (closing the legacy `useState`-filters defect, spec §8).

**Files:**
- Create: `components/inbox/more-filters-sheet.tsx`, `components/inbox/active-filter-chips.tsx`
- Modify: `components/inbox/review-filters.tsx` (add a "More filters" trigger + render chips)
- Test: `tests/components/more-filters-sheet.test.tsx`, `tests/components/active-filter-chips.test.tsx`

**Interfaces:**
- Consumes: `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetTrigger` (existing), `Select`/`SelectItem` (Task 4), `Button` (existing), `Badge` (existing), `InboxState` (Task 3), `hasActiveFilters` (Task 3).
- Produces: `MoreFiltersSheet` (props `{ state, onChange }`); `ActiveFilterChips` (props `{ state, locations, onChange, onClear }`).

The five extra filters (all multi-value except reply state and dates), with their backend wire vocabulary: `verification` (`pass|warn|fail|pending`), `publishStatus` (`not_published|awaiting_approval|accepted|published|rejected|failed|deleted`), `syncStatus` (`pending|running|succeeded|failed|cancelled`), `replyState` (`replied|unreplied`), `dateFrom`/`dateTo` (ISO datetimes). Multi-value filters use native checkboxes inside the sheet (no new primitive).

- [ ] **Step 1: Write the failing tests**

`tests/components/more-filters-sheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MoreFiltersSheet } from "@/components/inbox/more-filters-sheet"
import type { InboxState } from "@/lib/inbox/url-state"

const baseState: InboxState = {
  queue: "all",
  ratings: [],
  search: "",
  sort: "updated_desc",
  verification: [],
  publishStatus: [],
  syncStatus: [],
}

afterEach(() => vi.restoreAllMocks())

describe("MoreFiltersSheet", () => {
  it("shows a count of active advanced filters on the trigger", () => {
    render(
      <MoreFiltersSheet
        state={{ ...baseState, verification: ["fail"], syncStatus: ["failed"] }}
        onChange={() => {}}
      />
    )
    // 2 active advanced filters (verification + syncStatus)
    expect(screen.getByRole("button", { name: /More filters/ })).toHaveTextContent("2")
  })

  it("toggles a verification value into the URL state", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MoreFiltersSheet state={baseState} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    await user.click(screen.getByRole("checkbox", { name: "Failed" }))
    expect(onChange).toHaveBeenCalledWith({ verification: ["fail"] })
  })

  it("sets a date range", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MoreFiltersSheet state={baseState} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    const from = screen.getByLabelText("From date")
    await user.type(from, "2026-07-01")
    expect(onChange).toHaveBeenCalledWith({
      dateFrom: "2026-07-01T00:00:00.000Z",
    })
  })
})
```

`tests/components/active-filter-chips.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import type { InboxState } from "@/lib/inbox/url-state"

const state: InboxState = {
  queue: "all",
  locationId: "loc-1",
  ratings: [5],
  search: "slow",
  sort: "updated_desc",
  verification: ["fail"],
  publishStatus: [],
  syncStatus: [],
}

afterEach(() => vi.restoreAllMocks())

describe("ActiveFilterChips", () => {
  it("renders a chip per active filter and clears one on request", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ActiveFilterChips
        state={state}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={onChange}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Location: Riverside")).toBeInTheDocument()
    expect(screen.getByText("Rating: 5")).toBeInTheDocument()
    expect(screen.getByText('Search: "slow"')).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove location filter" }))
    expect(onChange).toHaveBeenCalledWith({ locationId: undefined })
  })

  it("offers Clear all when any filter is active", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <ActiveFilterChips
        state={state}
        locations={[]}
        onChange={() => {}}
        onClear={onClear}
      />
    )
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("renders nothing when no filters are active", () => {
    const { container } = render(
      <ActiveFilterChips
        state={{ ...state, locationId: undefined, ratings: [], search: "", verification: [] }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/more-filters-sheet.test.tsx tests/components/active-filter-chips.test.tsx --project components`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement `components/inbox/more-filters-sheet.tsx`**

```tsx
"use client"

import { useState } from "react"
import { SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { InboxState } from "@/lib/inbox/url-state"

const VERIFICATION = [
  { value: "pass", label: "Passed" },
  { value: "warn", label: "Review needed" },
  { value: "fail", label: "Failed" },
  { value: "pending", label: "Pending" },
]
const PUBLISH_STATUS = [
  { value: "not_published", label: "Not published" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "accepted", label: "Accepted" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
  { value: "deleted", label: "Deleted" },
]
const SYNC_STATUS = [
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
]

function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function CheckboxGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ui font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-ui">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            aria-label={option.label}
            onChange={() => onToggle(option.value)}
            className="size-4 accent-primary"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

function MoreFiltersSheet({
  state,
  onChange,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
}) {
  const [open, setOpen] = useState(false)
  const activeCount =
    (state.verification.length ? 1 : 0) +
    (state.publishStatus.length ? 1 : 0) +
    (state.syncStatus.length ? 1 : 0) +
    (state.replyState ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)

  function toIso(dateValue: string): string | undefined {
    if (!dateValue) return undefined
    return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon aria-hidden />
        More filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </SheetTrigger>
      <SheetContent side="right" className="data-[side=right]:w-80">
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto p-6">
          <CheckboxGroup
            legend="Verification"
            options={VERIFICATION}
            selected={state.verification}
            onToggle={(value) =>
              onChange({ verification: toggle(state.verification, value) })
            }
          />
          <CheckboxGroup
            legend="Publish status"
            options={PUBLISH_STATUS}
            selected={state.publishStatus}
            onToggle={(value) =>
              onChange({ publishStatus: toggle(state.publishStatus, value) })
            }
          />
          <CheckboxGroup
            legend="Sync status"
            options={SYNC_STATUS}
            selected={state.syncStatus}
            onToggle={(value) =>
              onChange({ syncStatus: toggle(state.syncStatus, value) })
            }
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ui font-medium">Reply state</legend>
            {[
              { value: "", label: "Any" },
              { value: "unreplied", label: "Not replied" },
              { value: "replied", label: "Replied" },
            ].map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-ui">
                <input
                  type="radio"
                  name="replyState"
                  checked={(state.replyState ?? "") === option.value}
                  aria-label={option.label}
                  onChange={() =>
                    onChange({
                      replyState:
                        option.value === ""
                          ? undefined
                          : (option.value as "replied" | "unreplied"),
                    })
                  }
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor="date-from" className="text-ui font-medium">
              From date
            </label>
            <input
              id="date-from"
              type="date"
              aria-label="From date"
              onChange={(event) => onChange({ dateFrom: toIso(event.target.value) })}
              className="h-8 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui"
            />
            <label htmlFor="date-to" className="text-ui font-medium">
              To date
            </label>
            <input
              id="date-to"
              type="date"
              aria-label="To date"
              onChange={(event) => onChange({ dateTo: toIso(event.target.value) })}
              className="h-8 rounded-(--nr-radius-control) border border-border bg-card px-3 text-ui"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { MoreFiltersSheet }
```

- [ ] **Step 4: Implement `components/inbox/active-filter-chips.tsx`**

```tsx
"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LocationEntry } from "@/lib/api/locations"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"

type Chip = { label: string; removeLabel: string; clear: Partial<InboxState> }

function buildChips(state: InboxState, locations: LocationEntry[]): Chip[] {
  const chips: Chip[] = []
  if (state.locationId) {
    const name =
      locations.find((location) => location.id === state.locationId)?.name ??
      "location"
    chips.push({
      label: `Location: ${name}`,
      removeLabel: "Remove location filter",
      clear: { locationId: undefined },
    })
  }
  if (state.ratings.length) {
    chips.push({
      label: `Rating: ${state.ratings.join(", ")}`,
      removeLabel: "Remove rating filter",
      clear: { ratings: [] },
    })
  }
  if (state.search) {
    chips.push({
      label: `Search: "${state.search}"`,
      removeLabel: "Remove search filter",
      clear: { search: "" },
    })
  }
  if (state.replyState) {
    chips.push({
      label: `Reply: ${state.replyState === "replied" ? "Replied" : "Not replied"}`,
      removeLabel: "Remove reply-state filter",
      clear: { replyState: undefined },
    })
  }
  if (state.verification.length) {
    chips.push({
      label: `Verification: ${state.verification.join(", ")}`,
      removeLabel: "Remove verification filter",
      clear: { verification: [] },
    })
  }
  if (state.publishStatus.length) {
    chips.push({
      label: `Publish: ${state.publishStatus.join(", ")}`,
      removeLabel: "Remove publish-status filter",
      clear: { publishStatus: [] },
    })
  }
  if (state.syncStatus.length) {
    chips.push({
      label: `Sync: ${state.syncStatus.join(", ")}`,
      removeLabel: "Remove sync-status filter",
      clear: { syncStatus: [] },
    })
  }
  if (state.dateFrom || state.dateTo) {
    chips.push({
      label: "Date range",
      removeLabel: "Remove date filter",
      clear: { dateFrom: undefined, dateTo: undefined },
    })
  }
  return chips
}

function ActiveFilterChips({
  state,
  locations,
  onChange,
  onClear,
}: {
  state: InboxState
  locations: LocationEntry[]
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  if (!hasActiveFilters(state)) return null
  const chips = buildChips(state, locations)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.removeLabel}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption"
        >
          {chip.label}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={chip.removeLabel}
            onClick={() => onChange(chip.clear)}
          >
            <XIcon aria-hidden />
          </Button>
        </span>
      ))}
      <Button variant="link" size="sm" onClick={onClear}>
        Clear all filters
      </Button>
    </div>
  )
}

export { ActiveFilterChips }
```

- [ ] **Step 5: Wire the sheet + chips into `ReviewFilters`**

In `components/inbox/review-filters.tsx`:
1. Import `MoreFiltersSheet` and `ActiveFilterChips`, plus `InboxState`/`hasActiveFilters`.
2. Change the props to also receive the full `state: InboxState` and an `onClear: () => void` (the `InboxView` already has `onClearFilters`). Update `InboxView` to pass `state={state}` and `onClear={onClearFilters}` to `ReviewFilters`.
3. After the sort `Select`, add `<MoreFiltersSheet state={state} onChange={onChange} />`.
4. Below the filter row, render `<ActiveFilterChips state={state} locations={locations} onChange={onChange} onClear={onClear} />`.

Because `ReviewFilters` already receives a `FiltersState` (`Omit<InboxState,"queue"|"selected">`), widen its `state` prop to the full `InboxState` (the chips and sheet need `queue`/`selected` never, but a single `InboxState` prop is simplest). Update the `ReviewFilters` test's `state` object to a full `InboxState` (add `queue: "all"`), keeping the two existing assertions (`getByRole("combobox", { name: "Filter by location" })`, `getByRole("searchbox", { name: "Search reviews" })`).

- [ ] **Step 6: Run to verify pass, then build**

```bash
pnpm exec vitest run tests/components/more-filters-sheet.test.tsx tests/components/active-filter-chips.test.tsx tests/components/review-filters.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS + green build.

- [ ] **Step 7: Commit**

```bash
git add components/inbox/more-filters-sheet.tsx components/inbox/active-filter-chips.tsx components/inbox/review-filters.tsx components/inbox/inbox-view.tsx tests/components/more-filters-sheet.test.tsx tests/components/active-filter-chips.test.tsx tests/components/review-filters.test.tsx
git commit -m "feat(inbox): full filter set, mobile filter sheet, and active-filter chips (URL-driven)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Legacy `/reviews` redirect + nav prefetch + carry-forward closures

**Files:**
- Create: `app/reviews/page.tsx`
- Modify: `components/app-shell/nav.tsx` (`/inbox` → `prefetch: true`), `components/app-shell/app-shell.tsx` (harden `useSessionReady` fetch with timeout/abort), `tests/integration/routes/sign-in.test.ts` (un-skip both `/inbox` tests), `tests/components/nav.test.tsx` (expect `/inbox` prefetch)
- Test: `tests/components/reviews-redirect.test.tsx`, plus the modified `nav.test.tsx` and the re-enabled `sign-in.test.ts`

**Interfaces:**
- Consumes: `redirect` (`next/navigation`).
- Produces: `/reviews` → `/inbox` server redirect forwarding the query string; `/inbox` prefetched in the sidebar; a timeout-guarded session bootstrap.

**Note on the e2e un-quarantine (D14):** removing `inbox.spec.ts`/`journeys.spec.ts` from `playwright.config.ts` `testIgnore` is deliberately done in **Task 10**, paired with the adapted spec content, so CI never runs the legacy (deleted-frontend) versions. `review-provider-races.spec.ts` STAYS quarantined (M9 — it tests the removed epoch/scope-token mechanism; note it in the ledger).

- [ ] **Step 1: Write the failing redirect + nav tests**

`tests/components/reviews-redirect.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import ReviewsPage from "@/app/reviews/page"
import { redirect } from "next/navigation"

describe("reviews redirect page", () => {
  it("redirects a bare /reviews to /inbox", async () => {
    await expect(
      ReviewsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow()
    expect(redirect).toHaveBeenCalledWith("/inbox")
  })

  it("forwards the query string (a bookmarked /reviews?queue=needs_reply)", async () => {
    vi.mocked(redirect).mockClear()
    await expect(
      ReviewsPage({ searchParams: Promise.resolve({ queue: "needs_reply", rating: "5" }) })
    ).rejects.toThrow()
    expect(redirect).toHaveBeenCalledWith("/inbox?queue=needs_reply&rating=5")
  })
})
```

In `tests/components/nav.test.tsx`, update the prefetch expectations so `/inbox` is now prefetched too. Replace the two assertions blocks with:

```tsx
  it("prefetches the Home and Inbox routes", () => {
    render(<Nav />)
    for (const label of ["Home", "Inbox"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "data-prefetch",
        "true"
      )
    }
    for (const label of ["Locations", "Performance", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "data-prefetch",
        "false"
      )
    }
  })

  it("encodes the per-item prefetch flag in NAV_ITEMS", () => {
    for (const href of ["/home", "/inbox"]) {
      expect(NAV_ITEMS.find((item) => item.href === href)?.prefetch).toBe(true)
    }
    for (const item of NAV_ITEMS.filter(
      (item) => item.href !== "/home" && item.href !== "/inbox"
    )) {
      expect(item.prefetch).toBe(false)
    }
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/reviews-redirect.test.tsx tests/components/nav.test.tsx --project components`
Expected: FAIL — `@/app/reviews/page` does not exist; `/inbox` is still `prefetch: false`.

- [ ] **Step 3: Implement the redirect and flip the nav flag**

`app/reviews/page.tsx`:

```tsx
import { redirect } from "next/navigation"

// Legacy redirect (spec §4): /reviews -> /inbox, forwarding the query string so
// a bookmarked /reviews?queue=… lands on the same inbox view.
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined)
      query.set(key, value[0])
  }
  const suffix = query.toString()
  redirect(suffix ? `/inbox?${suffix}` : "/inbox")
}
```

In `components/app-shell/nav.tsx`, change the `/inbox` item from `prefetch: false` to `prefetch: true`, and update the block comment above the `<Link>` to reflect that `/home` and `/inbox` now ship (the other three stay `prefetch: false`):

```tsx
  { href: "/inbox", label: "Inbox", icon: Inbox, prefetch: true },
```

Replace the comment's first sentence with: `/* /home and /inbox ship and are prefetched. The other three routes 404 until their milestones land; … (unchanged rest) */`.

- [ ] **Step 4: Harden `useSessionReady` (M3 carry-forward)**

In `components/app-shell/app-shell.tsx`, replace the `fetch("/api/session", …)` effect body inside `useSessionReady` with a timeout/abort-guarded version:

```tsx
  useEffect(() => {
    if (session) return
    let cancelled = false
    const controller = new AbortController()
    // Guard against a hung bootstrap request stranding the shell on a blank
    // gate: abort after 5s and let the gated queries mount (they surface the
    // real error state rather than hanging).
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch("/api/session", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .catch(() => {
        // Swallow: abort or network failure both fall through to ready=true.
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [session])
```

Add a focused assertion to `tests/components/app-shell.test.tsx` (the M3 session-ready test) that the bootstrap fetch is issued with an `AbortSignal`:

```tsx
  it("bootstraps the session with an abortable request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<AppShell session={null}>content</AppShell>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
```

(Import `waitFor`/`vi` if not already imported in that file; keep the existing gate tests unchanged.)

- [ ] **Step 5: Re-enable the two skipped integration tests**

In `tests/integration/routes/sign-in.test.ts`, remove both `.skip`s and their `// re-enable: rebuild M4 (inbox route lands)` comments — change `it.skip("redirects anonymous dashboard traffic to /sign-in", …)` to `it(…)` and `it.skip("keeps signed-in users on the dashboard", …)` to `it(…)`. The assertions are already correct now that `/inbox` exists (anonymous → 303/307 to `/sign-in`; a seeded session → 200). No assertion changes.

- [ ] **Step 6: Run to verify pass**

```bash
pnpm exec vitest run tests/components/reviews-redirect.test.tsx tests/components/nav.test.tsx tests/components/app-shell.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS + green build. The re-enabled `sign-in.test.ts` runs under the DB-gated integration suite (`RUN_DB_TESTS=true`); it is exercised in Task 10's gate. Locally without a DB it stays `describe.skip` by design (`describeDatabase`).

- [ ] **Step 7: Commit**

```bash
git add app/reviews/page.tsx components/app-shell/nav.tsx components/app-shell/app-shell.tsx tests/integration/routes/sign-in.test.ts tests/components/reviews-redirect.test.tsx tests/components/nav.test.tsx tests/components/app-shell.test.tsx
git commit -m "feat(inbox): /reviews redirect, /inbox nav prefetch, session-bootstrap timeout, re-enabled /inbox tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Milestone e2e adaptation + gate

**Files:**
- Modify: `tests/e2e/helpers/stub-bridge.ts` (seed an approval-required scenario + a viewer, for the approver journey and per-role walk), `playwright.config.ts` (un-ignore `inbox.spec.ts` + `journeys.spec.ts`)
- Rewrite: `tests/e2e/inbox.spec.ts`, `tests/e2e/journeys.spec.ts`
- Gate: full unit + component + integration + e2e suite green, clean production build, whole-branch review.

**Interfaces:** consumes `readJourneyState` (extended), the URL-driven capability-gated UI built in Tasks 4–8, the `/reviews` redirect (Task 9).

Selectors/copy the specs drive (all are invariants established in Tasks 4–8, reproducing the a11y contract the deleted `journeys.spec.ts` pinned): `h1` "Inbox"; `role="region"` name "Review list"; `role="region"` name "Selected review"; `role="tab"` names "All reviews, N" / "Needs reply, N" / "Published, N"; `getByLabel("Filter by location")` + `role="option"`; `role="textbox"` name "Reply draft"; buttons "Save draft" / "Publish reply" / "Approve reply" / "Review actions"; `role="menuitem"` "Delete published reply"; `role="alertdialog"` button "Delete reply"; verdict text "Passed"; status text "Published" / "Awaiting approval"; toasts "Reply published" / "Reply submitted for approval." / "Published reply deleted".

- [ ] **Step 1: Extend the stub bridge with an approval scenario + a viewer**

In `tests/e2e/helpers/stub-bridge.ts`, extend the `JourneyState` type and the seeding. Add these fields to `JourneyState`:

```ts
  viewerCookie: string
  approval: {
    requesterCookie: string
    approverCookie: string
    reviewId: string
    locationId: string
    locationName: string
    text: string
  }
```

Import `randomBytes`/`randomUUID` and `sha256` helpers already used by the tenant helpers (add at the top): `import { randomBytes, randomUUID } from "node:crypto"` and `import { sha256 } from "../../integration/helpers/tenant-crypto"` — OR reuse the exported `sha256` the tenant helper uses. Since `createTestTenant` already hashes session tokens with `sha256`, expose a tiny local helper in the bridge:

```ts
import { createHash } from "node:crypto"
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
```

After the existing primary-tenant seeding (right before building `state`), seed a viewer in the primary org and a full approval scenario:

```ts
    // A viewer in the primary org, for the per-role permission walk: viewers
    // see disabled Publish with a reason and a read-only composer.
    const viewerUserId = randomUUID()
    const viewerToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (${viewerUserId}, ${`viewer-${viewerUserId.slice(0, 8)}@nabapresence.test`}, 'Journey viewer', ${organisationId})
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${viewerUserId}, 'viewer', false)
    `
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (${hashToken(viewerToken)}, ${viewerUserId}, ${organisationId}, now() + interval '1 hour')
    `

    // A separate approval-required org: a member requester (no publish) whose
    // publish routes to approval (202), and an owner approver who approves (200).
    const approvalTenant = await createTestTenant(admin, { role: "owner" })
    const approvalConnection = await seedGoogleConnection(admin, {
      organisationId: approvalTenant.organisationId,
    })
    const approvalReviewSeed = await seedLinkedReview(admin, {
      organisationId: approvalTenant.organisationId,
      connectionId: approvalConnection.connectionId,
      googleAccountName: approvalConnection.googleAccountName,
      text: "Sprint 5 approver journey review",
      rating: 5,
    })
    await admin`
      update organisation
      set approval_required = true, require_two_person_approval = false,
          default_timezone = ${timezone}
      where id = ${approvalTenant.organisationId}
    `
    const requesterUserId = randomUUID()
    const requesterToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (${requesterUserId}, ${`requester-${requesterUserId.slice(0, 8)}@nabapresence.test`}, 'Journey requester', ${approvalTenant.organisationId})
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${approvalTenant.organisationId}, ${requesterUserId}, 'member', false)
    `
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (${hashToken(requesterToken)}, ${requesterUserId}, ${approvalTenant.organisationId}, now() + interval '1 hour')
    `
    const approvalLocations = await admin<{ id: string; name: string }[]>`
      select id::text as id, name from location
      where organisation_id = ${approvalTenant.organisationId}
      order by id
    `
    const approvalLocationName =
      approvalLocations.find((l) => l.id === approvalReviewSeed.locationId)?.name ??
      "Approval location"
```

The stub's Google `respond` handlers already answer `/accounts` and `/{account}/locations` for the primary org's account; add matching handlers for `approvalConnection.googleAccountName` mirroring the existing two blocks (same JSON shape, `approvalReviewSeed.externalLocationId`'s `google_location_name` and `approvalLocationName`). Then add to the built `state`:

```ts
      viewerCookie: `naba_session=${viewerToken}`,
      approval: {
        requesterCookie: `naba_session=${requesterToken}`,
        approverCookie: approvalTenant.cookie,
        reviewId: approvalReviewSeed.reviewId,
        locationId: approvalReviewSeed.locationId,
        locationName: approvalLocationName,
        text: "Sprint 5 approver journey review",
      },
```

Finally, add `approvalTenant.organisationId` to the teardown `destroyTenants(admin, [organisationId, approvalTenant.organisationId])` (hoist `approvalTenant` so the `catch`/return teardown can see it).

- [ ] **Step 2: Rewrite `tests/e2e/inbox.spec.ts`** (lightweight; local-bootstrap session; guards in both themes)

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

test.describe("inbox", () => {
  test("renders the cross-location review queue", async ({ page }) => {
    await page.goto("/inbox")
    await expect(page).toHaveURL("/inbox")
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("combobox", { name: "Filter by location" })
    ).toBeVisible()
  })

  test("reviews redirects to inbox and forwards the query string", async ({ page }) => {
    await page.goto("/reviews")
    await expect(page).toHaveURL("/inbox")
    await page.goto("/reviews?queue=needs_reply")
    await expect(page).toHaveURL("/inbox?queue=needs_reply")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      page.on("pageerror", (error) => pageErrors.push(error.message))
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      await expect(
        page.getByRole("combobox", { name: "Filter by location" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/inbox")
      await expect(
        page.getByRole("combobox", { name: "Filter by location" })
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${theme} structure`
      ).toEqual([])
    })
  }
})
```

- [ ] **Step 3: Rewrite `tests/e2e/journeys.spec.ts`** (M4-scoped: publish journey + approver journey + per-role walk + dirty-navigation confirm; the location-sub-view / Settings / Performance / Connections legs are DEFERRED to M5/M6/M7 and re-assembled at M9, D16)

```ts
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

async function useCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

async function openReview(page: Page, text: string) {
  await page.getByRole("button").filter({ hasText: text }).first().click()
  await expect(
    page.getByRole("region", { name: "Selected review" }).getByText(text, { exact: true })
  ).toBeVisible()
}

async function saveVerifiedDraft(page: Page, reviewId: string, body: string) {
  await page.getByRole("textbox", { name: "Reply draft" }).fill(body)
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/reviews/${reviewId}/drafts`
  )
  await page.getByRole("button", { name: "Save draft" }).click()
  expect((await saved).status()).toBe(201)
  await expect(page.getByText("Passed", { exact: true })).toBeVisible()
}

test.describe("inbox critical journeys", () => {
  test("publish journey: filter, open, draft, publish", async ({ baseURL, page }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)

    await page.goto("/inbox")
    const list = page.getByRole("region", { name: "Review list" })
    await expect(list.getByText(state.directReview.text, { exact: true })).toBeVisible()
    await expect(list.getByText(state.approvalReview.text, { exact: true })).toBeVisible()
    await expect(page.getByRole("tab", { name: /All reviews,\s+2/ })).toBeVisible()

    // Location filter narrows the queue and scopes counts.
    await page.getByLabel("Filter by location").fill(state.directReview.locationName)
    await page
      .getByRole("option", { name: state.directReview.locationName, exact: true })
      .click()
    await expect(page.getByRole("tab", { name: /All reviews,\s+1/ })).toBeVisible()

    await openReview(page, state.directReview.text)
    await saveVerifiedDraft(
      page,
      state.directReview.id,
      "Thank you for your thoughtful review. We are delighted you enjoyed your stay."
    )
    const published = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.directReview.id}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await published).status()).toBe(200)
    await expect(page.getByText("Reply published", { exact: true })).toBeVisible()
  })

  test("approver journey: request routes to approval, approver publishes", async ({
    baseURL,
    browser,
    page,
  }) => {
    test.setTimeout(120_000)
    const state = await readJourneyState()

    // Requester (member, no publish) — publish routes to approval (202).
    await useCookie(page, baseURL, state.approval.requesterCookie)
    await page.goto("/inbox")
    await openReview(page, state.approval.text)
    await saveVerifiedDraft(
      page,
      state.approval.reviewId,
      "Thank you for sharing your experience. Our team appreciates your kind feedback."
    )
    const requested = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.approval.reviewId}/publish`
    )
    await page.getByRole("button", { name: "Publish reply" }).click()
    expect((await requested).status()).toBe(202)
    await expect(
      page.getByText("Reply submitted for approval.", { exact: true })
    ).toBeVisible()

    // Approver (owner) — a fresh context; the awaiting-approval tab shows it.
    const approverContext = await browser.newContext()
    const approver = await approverContext.newPage()
    await useCookie(approver, baseURL, state.approval.approverCookie)
    await approver.goto("/inbox?queue=awaiting_approval")
    await openReview(approver, state.approval.text)
    const approved = approver.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/reviews/${state.approval.reviewId}/approval`
    )
    await approver.getByRole("button", { name: "Approve reply" }).click()
    expect((await approved).status()).toBe(200)
    await expect(approver.getByText("Reply published", { exact: true })).toBeVisible()
    await approverContext.close()
  })

  test("permission walk: a viewer cannot reach a publish control", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.viewerCookie)
    await page.goto("/inbox")
    await openReview(page, state.directReview.text)
    const publish = page.getByRole("button", { name: "Publish reply" })
    await expect(publish).toBeDisabled()
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toBeDisabled()
  })

  test("dirty draft: switching reviews confirms before discarding edits", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/inbox")
    await openReview(page, state.directReview.text)
    await page.getByRole("textbox", { name: "Reply draft" }).fill("Unsaved edit in progress")

    // Cancelling the confirm keeps us on the same review with the text intact.
    page.once("dialog", (dialog) => dialog.dismiss())
    await page.getByRole("button").filter({ hasText: state.approvalReview.text }).first().click()
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toHaveValue(
      "Unsaved edit in progress"
    )
  })
})
```

- [ ] **Step 4: Un-quarantine the two specs**

In `playwright.config.ts`, delete these two lines from the `testIgnore` array (leave the other seven, especially `review-provider-races.spec.ts`, untouched):

```
    "**/inbox.spec.ts",
    "**/journeys.spec.ts",
```

- [ ] **Step 5: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: unit + components green; production build green; e2e runs `foundation.spec.ts` + `home.spec.ts` + the revived `inbox.spec.ts` + `journeys.spec.ts`, all green (including the `/inbox` console/pageerror guard and axe in both themes); integration green including the two re-enabled `sign-in.test.ts` tests and the new `review-capabilities.test.ts` (`RUN_DB_TESTS=true`, real Postgres via `naba_test_runtime` per the local-DB rules). Fix any failure in the product/spec, never by weakening an assertion. Paste every summary line into the report.

- [ ] **Step 6: Whole-branch review (two passes) + one fix wave**

Per spec §10, request a whole-branch review before merge:
1. A general review of the entire M4 diff.
2. A dedicated **capability/tenant-scoping** pass focused on Task 1 (the sanctioned protected-path edit) — confirm `capabilities.ts` mirrors `permissions.ts` exactly for every role × membership case, that `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` lists exactly the three sanctioned files, and that a member/viewer can never reach an enabled publish/approve/regenerate control server-side or client-side (spec §9 "no reachable 403 from primary controls").

Apply one fix wave for the findings, re-run the gate, then commit.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/helpers/stub-bridge.ts tests/e2e/inbox.spec.ts tests/e2e/journeys.spec.ts playwright.config.ts
git commit -m "test(inbox): revive and adapt inbox + journeys e2e; seed approval scenario; milestone gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 4 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- E2e green: `foundation.spec.ts`, `home.spec.ts`, the revived `inbox.spec.ts` and `journeys.spec.ts` — including the zero-console-error + zero-pageerror guard on `/inbox` and the best-practice structural axe rules in both light and dark, the publish journey, the approver journey, the per-role permission walk, and the dirty-draft navigation-confirm.
- Integration suite green (the parity oracle), including the two re-enabled `sign-in.test.ts` `/inbox` tests and the new `review-capabilities.test.ts` (`RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`). No pre-existing integration test moved.
- **Protected-path discipline:** the ONLY changes under `app/api/**`/`lib/server/**`/`lib/domain/**`/`supabase/**`/`scripts/**`/`instrumentation.ts` are Task 1's three sanctioned files (`lib/server/capabilities.ts` new; `app/api/reviews/route.ts` and `app/api/reviews/[id]/route.ts` additive). `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` lists exactly those three. Everything else there is byte-identical.
- Every M4-scoped spec obligation closed (spec §8 Inbox): URL-driven everything (queue, filters, search, selection in searchParams; `?locationId=` from Home consumed); cold load = skeleton rows, never the empty state; empty copy distinguishes no-data / filtered-out / disconnected; verification reasons listed inline and in the lifecycle panel; "Generate draft" vs "Regenerate" by state with regenerate-over-edits confirm; per-action pending on the initiating button; counts invalidate on mutation; roving tabindex + arrow keys on the list; dates include the year when needed; dirty guard active; Publish/Approve/Regenerate gated by capabilities with disabled-state reasons; the approver flow carries the exact second-approver copy.
- No new dependency added. All primitives came from the already-installed `@base-ui/react`; `date-fns`/`react-day-picker` were already present.
- Whole-branch review complete with a dedicated capability/tenant-scoping pass; its findings fixed in one wave.
- Carry-forwards recorded for later milestones: **server-hydrated/dehydrated inbox** (spec §5 prefetch, once a `lib/server` review read-service is extracted) → a later milestone (M5 or M7, whichever first extracts it); the **`/locations/[id]/reviews` sub-view** → M5; the **Settings/Performance/Connections legs of the full cross-surface journey** → re-assembled at M9; **`review-provider-races.spec.ts`** stays quarantined → M9 (re-author against TanStack Query's dedup/staleness semantics, or delete); the **`react-day-picker` calendar** for the date range (M4 uses native `type="date"` inputs) → optional polish, M7.
- Acceptance-bar note: no committed audit-findings document exists for M4; its bar is spec §8's Inbox paragraph (the audit-finding proxy) plus the M1/M3 carry-forward register.
- Decisions made BEYOND the locked D1–D16 list (flagged for controller review): (a) `QUEUE_STATUS_MAP.needs_reply = [new, drafted, verified, failed, rejected]` — a defensible baseline (excludes the states that own their own tab), analogous to M3's `NEEDS_ATTENTION_STATES`; (b) capabilities embedded as a nested `capabilities: { canPublish, canEdit }` object (not flat top-level fields) to minimise any collision risk with existing row fields under the parity oracle; (c) the counts route was NOT edited (D3 permitted "if needed") — capabilities gate actions, not counts, so counts stayed byte-identical, reducing the protected-path surface; (d) Publish is gated to a persisted verified draft with the composer clean — the action bar reads the live composer dirtiness via the shared `dirty-context` store (`useIsDirty`, a `useSyncExternalStore` subscription so only the action bar re-renders) and disables Publish with "Save your draft before publishing" while dirty, rather than auto-saving on publish — safer than the legacy conditional re-save and consistent with D7's "no optimistic publish" (published text can never diverge from the on-screen text); (e) the location directory for the filter uses `GET /api/location-links` (its default view already returns `{id,name}`, role-scoped) rather than a new endpoint; (f) `latestVerification` added to the detail route (additive, Task 1) so verification reasons show on load, not only after a re-verify (closing a §8 gap).

## Self-review (run before merge; fix inline)

- **Spec coverage.** §3 capabilities addition → Task 1 (`lib/server/capabilities.ts` + additive wiring). §4 legacy `/reviews→/inbox` redirect (query-string forwarding) → Task 9. §5 rendering model — client-fetched inbox with route-level `loading.tsx` Suspense; the "isolation boundary around the review detail pane" is the React `DetailErrorBoundary` (Task 5); server-prefetch deviation documented (D1) and carried forward. §6 data layer — one QueryClient; keys `reviews`/`reviewDetail`/`reviewCounts` with `keepPreviousData` on the list (Tasks 2/3/6/7); typed mutation client via `apiFetch`/`ApiClientError`; 401→stash reused; URL-as-state with `replace` for filters and `push` for selection (Task 4); auto-selection of the first row only when unselected + not dirty + desktop (`autoSelectId`, Task 4/6); the mobile single-pane toggle with `push`-so-Back-returns and a "Back to reviews" button (`mobilePaneFor`, Task 4/5); shared client-safe zod (the verification/reason schemas); `useDirtyGuard` (Task 6). §8 Inbox paragraph — every clause mapped, including verification reasons **on load** via the additive `latestVerification` detail field (D3/D9, Task 1/2/6) and Publish disabling while the composer is dirty via the reactive `dirty-context` store (LOCKED #4, Task 7). §9 testing — loading/error/empty/mutation-failure component tests per feature; `useDirtyGuard` dedicated unit tests; e2e dirty-draft survival, per-role permission walk, publish journey, approver journey, dark-mode scan, axe (Task 10); parity oracle stays green (Task 1). No M4-scoped requirement is left without a task.
- **Placeholder scan.** No "TBD"/"similar to Task N"/"add error handling"/bare "write tests". Every code step carries real code; each complex component (list, detail, verification panel, composer, action bar, filters) ships a numbered behavioural contract + a complete pinned test file + a reference implementation. The one deliberate cross-task file (`lib/inbox/action-errors.ts`, created in Task 6, consumed + tested in Task 7) carries its full implementation once (Task 7 Step 1) and both tasks reference the same code — not a re-implementation.
- **Type consistency.** `ReviewCapabilities { canPublish, canEdit }` is identical across `lib/server/capabilities.ts` (Task 1), the API `capabilitiesSchema` (Task 2), and every consumer. `ReviewRow`/`ReviewDetail`/`ReviewsFilters`/`Verification`/`LatestVerification`/`VerificationReason` (Task 2) are the exact names Tasks 3–7 import; `LatestVerification` (verdict+reasons, no id) is the type of the detail's additive `latestVerification`, the composer's `mutationVerification` state, and the `VerificationPanel` prop (its test literals carry no `id`). `useReviews`/`flattenReviews`/`useReviewDetail`/`useReviewCounts(locationId?)` (Task 3) match their call sites. `InboxState`/`parseInboxState`/`serializeInboxState`/`toReviewsFilters`/`hasActiveFilters`/`queueToStatuses`/`QUEUE_STATUS_MAP`/`QUEUES`/`Queue`/`autoSelectId`/`mobilePaneFor` (Task 3) are consumed unchanged in Tasks 4/8 and the `inbox-view`. `useDirtyGuard({ key, isDirty, snapshot })` (Task 6) matches its composer call and its test; the `dirty-context` store exports `DirtyGuardProvider`/`useRegisterDirtyGuard`/`useDirtyGate`/`useReadIsDirty`/`useIsDirty` — the composer registers, the list/auto-select read imperatively, the action bar subscribes reactively. `evaluatePublish`/`evaluateApproval`/`evaluateDelete` and `describeActionError` (Task 7) match the action bar and composer. `usePublishReview`/`useApprovalDecision`/`useDeleteReply`/`useGenerateOrSaveDraft`/`useVerifyDraft` names match producer and consumer. Primitive export surfaces (`Tabs`/`TabsList`/`TabsTab`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`, `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxItem`, `Avatar`/`AvatarFallback`, `Empty`, `Textarea`, `AlertDialog…`, `DropdownMenu…`) are imported by exactly those names in every component and admission task. Query keys: list `queryKeys.reviews("organisation", filters)`, detail `queryKeys.reviewDetail(id)`, counts `queryKeys.reviewCounts(locationId ?? "organisation")`, locations `queryKeys.locations` — identical between hook and test.
- **Parity-oracle safety.** `inbox-cursor.test.ts` reads only `items[].id`; the additive `capabilities` object cannot break it. The detail route's additive `capabilities` + `latestVerification` fields change no existing field and are read only by the new `review-capabilities.test.ts`, so `approval.test.ts`/`publish-lifecycle.test.ts`/`language-drafts.test.ts` (which read named detail fields) stay green. The counts route is untouched (M3's `useReviewCounts()` with no argument still keys `reviewCounts("organisation")` and hits `/api/reviews/counts` with no `locationId`, exactly as before), so `home-queries.test.tsx` and Home stay green.

## Execution handoff

Plan complete and saved to `docs/archive/2026-07-frontend-rebuild/plans/2026-08-01-frontend-rebuild-m4-inbox.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with a two-stage review between tasks. The hard chain is 1 → 2 → 3; after Task 3, Tasks 4/5/8/9 can run in parallel worktree passes, then 6 (needs 4+5), then 7 (needs 5+6), then 10 (gate). Task 1 (protected path) and Task 6 (dirty guard) each warrant a dedicated reviewer.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batching with checkpoints for review.

Which approach?
