# M5 Locations wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Locations surface — the per-location Google Business Profile workspace — as a nested-route workspace (index + shell + six capability-gated tabs: profile, hours, photos, posts, booking, menu), on the M1 foundation and M4's Query/typed-client/dirty-guard machinery, closing the audit-flagged flows in spec §8 while treating the backend as consume-only except the one sanctioned per-location capability addition.

**Architecture:** `app/(dashboard)/locations/page.tsx` renders a role-aware index (`?view=management` for owner/admin, the plain `{id,name}` list for member/viewer). `app/(dashboard)/locations/[id]/layout.tsx` renders a client workspace shell (`h1` = location name, status badges, a scroll-affordanced tab nav with active-tab scroll-into-view, and a "Switch location" combobox when the org has more than one location; unknown id → `notFound()`). Each tab is a server page rendering one client feature component that reads through TanStack Query over the M1 typed client (`apiFetch` + zod). Every tab consumes a single per-location capability signal — `{ canEditCanonical, canPublish }` from the ONE sanctioned backend addition (`lib/server/capabilities.ts` + a dedicated `GET /api/locations/[id]/capabilities`) — and gates edit-vs-publish with disabled-state reasons. The three interaction patterns from spec §8 are realised as shared building blocks: (a) canonical-vs-Google field diff + revision/hash-pinned publish + overwrite-confirm (profile, hours, menu); (b) direct live-Google per-item hash-pinned CRUD (photos, booking); (c) a local draft→approval→publish state machine reusing M4's reply lifecycle (posts). All mutations are server-confirmed with per-action pending; no optimistic publish. No server prefetch/dehydration this milestone (deferred carry-forward, D3).

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives (1.6.0), TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m5-locations` (cut from `main` @ `d5bbbc7`). Delivery model is **per-milestone merge to `main`** (spec §10). `main` serves a partially-rebuilt product: `/performance` and `/settings` sidebar links still 404 until their milestones land; the three M8 location consoles (business-info/industry/administration) do not exist yet.
- **No new dependencies.** Every primitive Locations needs already exists in `@base-ui/react` (`checkbox`, `switch`, `radio`, `select`, `combobox`, `alert-dialog`, `field`, `input`, `separator`, `scroll-area`) or is a styled native element (`Table`). `Combobox`, `Select`, `Textarea`, `AlertDialog`, `Empty`, `Avatar`, `DropdownMenu` were admitted in M4 — reuse them. NEW primitives this milestone: `Table` (styled native), `Checkbox` (base-ui). Each newly-admitted primitive is restyled once on entry per the M1 policy (one control chrome, one focus ring, a11y-by-construction).
- **Protected paths — do NOT touch except the ONE sanctioned edit-set enumerated in Task 1**: `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. **Consume only.** Task 1's sanctioned edits are exactly two files there: `lib/server/capabilities.ts` (extend with per-location capabilities), `app/api/locations/[id]/capabilities/route.ts` (NEW read-only route). **Every other file under those paths stays byte-identical.** The parity oracle (the untouched backend integration suite) must stay green (spec §9).
- **Client-safe form schemas live in `lib/locations/` (NOT `lib/domain`).** `lib/domain` is a protected path; the server route schemas (`hoursSchema` in `hours/route.ts`, `saveSchema.values` in `profile/route.ts`, the food-menus/localPost schemas) stay embedded server-side and byte-identical. M5 adds **mirrored** client-safe schemas under the non-protected `lib/locations/forms/` and pins parity with tests (spec §6 "client and server validate identically" — achieved by construction + test, since importing the protected server schema is not permitted). This mirrors M4's `lib/inbox/` pattern.
- Styling: M1 tokens only. No raw hex, no `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N`. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`).
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`, mirroring `lib/api/connections.ts`). TanStack Query hooks carry `staleTime: 30s` (spec §6). Mutations invalidate their keys — the tab re-reads within one round trip. All writes go through the typed client via `ApiClientError { status, code, details }`; server codes map to user copy through one mapping layer (`lib/locations/action-errors.ts`) — no component invents its own error text.
- Copy: GB English, sentence case, no internal jargon, no env-flag names, **no error codes shown to users**.
- Every page renders exactly one `<h1>` and exactly one `<main>` (both owned by `PageFrame`/`PageHeader`; feature components add only `<h2>` and below).
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Reference-only history: `git show 33e06a1:<path>` retrieves the deleted legacy location components. Reference the look and the information architecture; **do not re-admit the code** (it used `lib/naba-presence-api.ts`, `useState`/`useEffect` fetch loops, and the deleted primitive set — all replaced here).
- The gate command (Task 11): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`.

## Design decisions (LOCKED — encode exactly)

- **D1 — Scope.** Wave-1 = index + workspace shell + six tabs (profile / hours / photos / posts / booking / menu). **DEFERRED:** business-info / industry / administration → M8 ("consoles"); per-location performance tab → M7; per-location reviews tab → NOT wave-1 (Home and `/inbox?locationId=` already cover per-location reviews); Q&A → dead. Task 1 Step 0 DELETES the stray untracked empty dir `app/(dashboard)/locations/[id]/qa/` **if it exists in the worktree** (it is untracked and absent from a fresh worktree cut from `main`; delete only if present).
- **D2 — Routing.** NESTED routes. `app/(dashboard)/locations/page.tsx` (index) + `[id]/layout.tsx` (workspace shell: `h1` = location name, address + status badges, a tab nav with `overflow-x-auto` scroll affordance and active-tab `scrollIntoView`, and a "Switch location" `Combobox` when the directory has >1 location) + `[id]/page.tsx` (profile) + `[id]/{hours,photos,posts,booking,menu}/page.tsx`. **The active tab is the route segment** (not a searchParam). Unknown location id → `notFound()` (client-side after the directory loads, consistent with D3; server-side notFound is a carry-forward with D3's server-hydration).
- **D3 — Rendering.** CLIENT-FETCH via TanStack Query (consistent with M3/M4). Server-hydration per spec §5 is **DEFERRED** — RECORDED as a prominent carry-forward. Unlike M4's inbox, the Locations `lib/server` services (`getProfileState`, `getHoursState`, `loadMedia`, `loadPlaceActions`, `getFoodMenusState`, `listLocalPosts`, `locationCapabilities`) DO already exist and are reusable, so a later dedicated effort can retrofit RSC prefetch + dehydrate **additively** — seeding the same Query keys this plan defines — without reshaping the client. Data hooks inherit `staleTime: 30s`.
- **D4 — Capabilities (the ONE sanctioned protected-path edit — spec §3).** Add an additive `locationCapabilities`/`locationCapabilitiesForIds` to `lib/server/capabilities.ts` computing per-location `{ canEditCanonical: role ∈ {owner,admin}, canPublish: <exactly mirrors canPublishLocation> }`, mirroring `lib/server/permissions.ts` EXACTLY (like M4's `reviewCapabilities`). **Mechanism (my call within D4): a dedicated read-only route** `GET /api/locations/[id]/capabilities` → `{ capabilities: { canEditCanonical, canPublish } }`, consumed by ONE capabilities client + `useLocationCapabilities(id)` hook reused across all six tabs and the workspace shell. This is the minimal-footprint sanctioned edit (two protected files) versus embedding `canEditCanonical` into ~12 per-tab route/service files. Unit-test EVERY role×membership combination EXECUTABLY (owner / admin / viewer / member-assigned-with-can_publish / member-assigned-no-can_publish / member-assigned-elsewhere / member-no-assignments) as an integration test hitting the real route — do NOT ship member coverage that is not executed. The client gates edit-canonical vs publish with disabled-state reasons.
- **D5 — Index data-shape.** Do NOT modify the protected `location-links` route. Owner/admin fetch `?view=management` (full: `locationId, name, address, timezone, linkId, externalLocationId, googleLocationName, googleTitle, verified`); member/viewer get the existing non-management `{ id, name }` list. The index renders what each role can see — a thinner honest list for member/viewer (a single "Location" column), the fuller Location / Address / Status table for owner/admin. Rating / needs-reply columns are NOT wave-1 (they came from the analytics endpoint → M7 Performance). A role-aware locations-directory client (management vs plain) is fine.
- **D6 — Forms + dirty guard.** profile / hours / menu / posts edit forms use the shared `useDirtyGuard` (M4, `lib/hooks/use-dirty-guard.ts`) + client-safe zod schemas in `lib/locations/forms/`; dialog dirty-confirms per spec §8. Photos and booking are per-item live CRUD (no long-lived draft) and use per-dialog confirmation instead of the dirty guard.
- **D7 — Interaction patterns.** (a) profile / hours / menu: canonical-vs-Google diff + revision/hash-pinned publish carrying the expected revision/hash + update mask + an overwrite-confirm checkbox when the other side drifted (`google_dirty`/`conflict`). (b) photos / booking: direct live-Google per-item hash-pinned CRUD with confirm dialogs. (c) posts: local draft → approval → publish reusing M4's `lib/inbox/action-errors.ts` copy pattern, an action bar, capability-gating and the second-approver rule. **All mutations server-confirmed, per-action pending on the initiating button, NO optimistic publish** (an `ambiguous`/`failed` outcome must never render as published).
- **D8 — Feature flags.** Render honest disabled/paused states per `GBP_*_ENABLED` flag. Canonical edit (profile/hours/menu PUT) stays available with write-flags off; only PUBLISH is blocked (the GET responses carry `writesEnabled`/`googleWritesEnabled` — the client reads that, never a flag name). Posts drafting **and** editing show a paused state when `GBP_POSTS_ENABLED` is off (the posts routes 503 `posts_paused` on POST/PATCH/DELETE, so even composing is blocked — the composer is disabled with a paused notice; the GET list still renders). No error codes shown.
- **D9 — Nav prefetch.** Flip `/locations` → `prefetch: true` in `components/app-shell/nav.tsx` (M1 carry-forward, now that `/locations` ships). M5 owns no legacy redirect (there was no legacy `/locations`-alias route).
- **D10 — Milestone e2e.** Revive + extend `tests/e2e/locations.spec.ts` to all six tabs; extract the photos assertions from `gbp-management-tabs.spec.ts` (leave the business-info/industry/administration assertions quarantined for M8); DELETE `capability-tabs.spec.ts` (stale "not enabled" placeholder scaffold — record why). Build a `seedLinkedLocation` integration helper (extend `tests/integration/helpers/tenant.ts`) + Google-stub matchers for the wave-1 GET/mutation calls; a zero-console-error + zero-pageerror guard on EVERY Locations route in BOTH themes (non-negotiable); a per-role permission walk (owner / admin / member-assigned / member-unassigned / viewer) across tabs; a publish journey per tab where publish is meaningful. Full gate + parity-oracle integration.
- **D11 — tz-fallback (M4 carry).** The timezone-fallback carry-forward is the **Inbox** review-list formatter, NOT Locations-scoped — note it at the gate, do not force it into M5.
- **D12 — Standard constraints** (copied into Global Constraints above): M1 tokens only; one h1/one main; GB English / no error codes shown; protected paths consume-only except D4; no new deps unless a primitive is genuinely absent from `@base-ui/react` (admit `Table`/`Checkbox` via the M1 restyle-once/a11y-at-type-level policy); gate green before each commit + `pnpm build` for page tasks; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; `git show 33e06a1:<path>` reference-only.

## File structure

```
lib/server/
  capabilities.ts                 MODIFY (SANCTIONED, protected, additive): locationCapabilities + locationCapabilitiesForIds
app/api/locations/[id]/
  capabilities/route.ts           NEW (SANCTIONED, protected): GET -> { capabilities: { canEditCanonical, canPublish } }
tests/integration/helpers/
  tenant.ts                       MODIFY (Task 1): add seedLinkedLocation
tests/integration/routes/
  location-capabilities.test.ts   NEW (Task 1): all 7 role×membership combinations, executable
lib/api/
  locations.ts                    MODIFY (Task 2): fetchManagementLocations, fetchLocationCapabilities
  location-profile.ts             NEW (Task 2)
  location-hours.ts               NEW (Task 2)
  location-media.ts               NEW (Task 2)
  location-booking.ts             NEW (Task 2)
  location-menu.ts                NEW (Task 2)
  location-posts.ts               NEW (Task 2)
lib/locations/
  forms/profile.ts                NEW (Task 2): profileFormSchema (mirror)
  forms/hours.ts                  NEW (Task 2): hoursFormSchema (mirror), emptyHours, DAY_LABELS
  forms/food-menus.ts             NEW (Task 2): foodMenusFormSchema (mirror), countFoodMenus
  forms/local-post.ts             NEW (Task 2): localPostFormSchema (mirror)
  action-errors.ts                NEW (Task 2): ApiClientError.code -> user copy (all wave-1 codes)
  gating.ts                       NEW (Task 2): describeEditGate / describePublishGate (disabled reasons)
lib/queries/
  keys.ts                         MODIFY (Task 2): per-location + capabilities keys
  use-locations.ts                NEW (Task 2): role-aware directory
  use-location-capabilities.ts    NEW (Task 2)
  use-location-profile.ts         NEW (Task 2)
  use-location-hours.ts           NEW (Task 2)
  use-location-media.ts           NEW (Task 2)
  use-location-booking.ts         NEW (Task 2)
  use-location-menu.ts            NEW (Task 2)
  use-location-posts.ts           NEW (Task 2)
components/ui/
  table.tsx                       NEW (Task 3): styled native table
  checkbox.tsx                    NEW (Task 5): base-ui checkbox
components/locations/
  locations-index.tsx             NEW (Task 3): role-aware directory table
  location-workspace.tsx          NEW (Task 4): shell (badges, combobox, tab nav, notFound)
  location-tab-nav.tsx            NEW (Task 4): scroll-affordanced nav + active scrollIntoView
  publish-gate.tsx                NEW (Task 4): disabled-reason wrapper for edit/publish controls
  canonical-diff.tsx              NEW (Task 5): canonical-vs-Google field rows + status chips
  overwrite-confirm-dialog.tsx    NEW (Task 5): overwrite-confirm checkbox dialog
  profile-tab.tsx                 NEW (Task 5)
  hours-tab.tsx                    NEW (Task 6)
  hours-editor.tsx                 NEW (Task 6): regular/special nested editor
  photos-tab.tsx                   NEW (Task 7)
  booking-tab.tsx                  NEW (Task 8)
  menu-tab.tsx                     NEW (Task 9)
  menu-editor.tsx                  NEW (Task 9): sections/items/options nested editor
  posts-tab.tsx                    NEW (Task 10)
  post-composer.tsx                NEW (Task 10)
  posts-action-bar.tsx             NEW (Task 10)
app/(dashboard)/locations/
  page.tsx                         NEW (Task 3): index server page
  loading.tsx                      NEW (Task 3): index skeleton
  [id]/layout.tsx                  NEW (Task 4): workspace shell server layout
  [id]/loading.tsx                 NEW (Task 4): tab skeleton
  [id]/page.tsx                    NEW (Task 5): profile
  [id]/hours/page.tsx              NEW (Task 6)
  [id]/photos/page.tsx             NEW (Task 7)
  [id]/booking/page.tsx            NEW (Task 8)
  [id]/menu/page.tsx               NEW (Task 9)
  [id]/posts/page.tsx              NEW (Task 10)
components/app-shell/nav.tsx       MODIFY (Task 4): /locations prefetch: true
tests/components/*.test.tsx        NEW per task
tests/e2e/locations.spec.ts        REVIVE + extend (Task 11)
tests/e2e/gbp-management-tabs.spec.ts  MODIFY (Task 11): keep only the photos test un-quarantined path (extract)
tests/e2e/capability-tabs.spec.ts  DELETE (Task 11)
tests/e2e/helpers/stub-bridge.ts   MODIFY (Task 11): wave-1 Google stub matchers
playwright.config.ts               MODIFY (Task 11): un-ignore locations.spec.ts; delete capability-tabs entry
```

**Backend response shapes consumed (READ-ONLY unless Task 1 sanctions the edit):**
- `GET /api/location-links` → `{ locations: [{ id, name }] }` (member/viewer; owner/admin also get `googleLocationName`). `GET /api/location-links?view=management` (owner/admin) → `{ locations: [{ locationId, name, address, timezone, linkId, externalLocationId, googleLocationName, googleTitle, verified }] }`; `address` is `address_json` (a nullable object). Role-scoped; name-ordered.
- `GET /api/locations/[id]/capabilities` (NEW, Task 1) → `{ capabilities: { canEditCanonical, canPublish } }`.
- `GET /api/locations/[id]/profile` → `{ profile: ProfileState }` where `ProfileState = { location:{id,name,googleLocationName}, canonicalResource:{revision,updatedAt}, canonicalHash, googleHash, canPublish, googleWritesEnabled, fields: Array<{ key: ProfileFieldKey, policy: 'bidirectional'|'import_only'|'google_read_only', status: 'in_sync'|'core_dirty'|'google_dirty'|'conflict', canonicalValue: string|null, googleValue: string|null, canonicalHash, googleHash, lastReconciledAt: string|null }>, googleDetails:{primaryCategory:string|null, additionalCategories:string[]}, latestAttempt: {id,direction,status,selectedFields:string[],createdAt,finishedAt:string|null}|null }`. `ProfileFieldKey ∈ name|description|phone|address|mapsUrl|reviewUrl|website`.
  - `PUT` body `{ expectedCanonicalRevision: string, values: { name?, description?, phone?, website? } }` (owner/admin route-gated) → `{ saved: true, revision }`. `POST` body `operationSchema` → publish `{ status:'published', attemptId, idempotent }` | import `{ status:'imported', revision, idempotent }`. Codes: `profile_publishing_disabled`(409), `publish_permission_required`(403), `canonical_edit_permission_required`(403), `canonical_resource_stale`(409), `profile_snapshot_stale`(409), `profile_overwrite_confirmation_required`(409), `canonical_overwrite_confirmation_required`(409), `profile_patch_empty`(409), `permission_denied`(403), `google_location_not_linked`(409).
- `GET /api/locations/[id]/hours` → `{ hours: HoursState }` where `HoursState = { location:{id,name,googleLocationName,timezone}, canonicalResource:{revision,updatedAt}, status:'in_sync'|'core_dirty'|'google_dirty'|'conflict', canonical: NormalizedHours, google: NormalizedHours, canonicalHash, googleHash, updateMask: Array<'regularHours'|'specialHours'|'moreHours'>, warnings: string[], canPublish, writesEnabled, lastReconciledAt: string|null, latestAttempt:{id,status,createdAt,finishedAt}|null }`. `NormalizedHours = { regular: Array<{dayOfWeek:number,isClosed:boolean,periods:Array<{opensAt:string,closesAt:string}>}> (length 7), special: Array<{effectiveDate:string,isClosed:boolean,opensAt:string|null,closesAt:string|null}>, moreHours: Array<{hoursTypeId:string,periods:Array<{dayOfWeek:number,opensAt:string,closesAt:string}>}> }`.
  - `PUT` `{ expectedCanonicalRevision, hours: NormalizedHours }` (owner/admin) → `{ saved:true, revision }`. `POST` `{ confirmation:'publish_nabapresence_hours_to_google', expectedCanonicalRevision, expectedCanonicalHash, expectedGoogleHash, approvedUpdateMask: Array<'regularHours'|'specialHours'|'moreHours'> (min 1), confirmOverwriteGoogleChanges }` → `{ status:'published'|'in_sync', attemptId?, idempotent }`. Codes: `hours_publishing_disabled`(409), `publish_permission_required`(403), `canonical_edit_permission_required`(403), `hours_snapshot_stale`(409), `google_hours_overwrite_confirmation_required`(409).
- `GET /api/locations/[id]/media` → `{ media: { canPublish, writesEnabled, categories: readonly GoogleMediaCategory[], items: Array<MediaItem> } }` where `MediaItem = { id, googleMediaName, ownership:'merchant'|'customer', mediaFormat:'PHOTO'|'VIDEO', category: GoogleMediaCategory, sourceUrl:string|null, googleUrl:string|null, thumbnailUrl:string|null, description:string|null, attribution:unknown, dimensions:unknown, insights:unknown, googleHash:string, createTime:string|null }`.
  - `POST` JSON `{ mediaFormat, category, sourceUrl, description?, confirmation:'create_google_media' }` OR multipart (`file`, `mediaFormat`, `category`, `description?`, `confirmation`) → 201 `{ id, status, idempotent }`. `PATCH .../media/[mediaId]` `{ category, expectedGoogleHash, confirmation:'update_google_media' }`. `DELETE .../media/[mediaId]` `{ expectedGoogleHash, confirmation:'delete_google_media' }`. Codes: `media_paused`(503), `publish_not_allowed`(403), `media_stale`(409), `media_category_not_patchable`(422), `media_type_unsupported`(415), `media_file_too_small`(422), `media_file_too_large`(413), `customer_media_read_only`(409).
- `GET /api/locations/[id]/place-actions` → `{ placeActions: { locationId, canPublish, writesEnabled, supportedTypes: readonly GooglePlaceActionType[], links: Array<StoredLink>, latestMutation:{id,operation,status,createdAt,finishedAt:string|null}|null } }` where `StoredLink = { id, googleLinkName, providerType:string, isEditable:boolean, uri:string, placeActionType: GooglePlaceActionType, isPreferred:boolean, googleHash:string, observedAt:string }`.
  - `POST` `{ uri, placeActionType, isPreferred, confirmation:'create_google_place_action' }`. `PATCH .../place-actions/[linkId]` `{ uri, placeActionType, isPreferred, expectedGoogleHash, confirmation:'update_google_place_action' }`. `DELETE .../place-actions/[linkId]` `{ expectedGoogleHash, confirmation:'delete_google_place_action' }`. Codes: `place_actions_paused`(503), `publish_not_allowed`(403), `place_action_stale`(409), `place_action_not_editable`(409).
- `GET /api/locations/[id]/food-menus` → `{ foodMenus: FoodMenusState }` where `FoodMenusState = { location:{id,name,googleLocationName}, canonicalResource:{revision,updatedAt}, eligible:boolean, status:'in_sync'|'drift', canonicalMenus: FoodMenu[], googleMenus: FoodMenu[], canonicalHash, googleHash, canonicalCounts:{menus,sections,items,options}, googleCounts:{menus,sections,items,options}, canPublish, writesEnabled }`. `FoodMenu = Record<string, unknown>`.
  - `PUT` `{ expectedCanonicalRevision, menus: FoodMenu[] }` (owner/admin) → `{ saved:true, revision }`. `POST` `{ confirmation:'publish_nabapresence_food_menus_to_google', expectedCanonicalRevision, expectedCanonicalHash, expectedGoogleHash, confirmFullReplacement:true }` → `{ status:'published'|'in_sync', attemptId?, idempotent }`. Codes: `food_menus_paused`(503), `publish_not_allowed`(403), `food_menus_not_eligible`(409), `food_menus_confirmation_required`(409), `food_menus_stale`(409).
- `GET /api/locations/[id]/posts` → `{ posts: Array<Post>, writesEnabled, reconciliationError: string|null }` where `Post = { id, topicType:'STANDARD'|'EVENT'|'OFFER', languageCode, summary, callToAction:unknown, event:unknown, offer:unknown, media:unknown, scheduledTime:string|null, status:'draft'|'awaiting_approval'|'publishing'|'published'|'failed'|'ambiguous', googlePostName:string|null, googleState:string|null, googleSearchUrl:string|null, lastErrorCode:string|null, createdAt, updatedAt }`.
  - `POST` `localPostInputSchema` → 201 `{ post:{ id } }`. `PATCH .../posts/[postId]` → `{ post:{ id, status } }`. `POST .../posts/[postId]/publish` → `{ status:'awaiting_approval' }` (202) | `{ status:'published', postId, googlePostName }` (200). `POST .../posts/[postId]/approval` `{ decision:'approve'|'reject' }` → reject `{ status:'draft' }` | approve → publish outcome. `DELETE .../posts/[postId]` → `{ status:'deleted' }`. Codes: `posts_paused`(503), `publishing_paused`(503), `second_approver_required`(403), `approval_not_pending`(409), `publish_permission_required`(403), `post_not_found`(404), `location_not_linked`(409).

**Client-safe constants import (already client-safe, `lib/domain/google-contract.ts`):** `GOOGLE_MEDIA_CATEGORIES`, `GoogleMediaCategory`, `GOOGLE_PLACE_ACTION_TYPES`, `GooglePlaceActionType`. (This file is pure functions/consts — no `server-only`, no node builtins — so client imports are safe. Do NOT import from `lib/domain/hours.ts`/`profile.ts`/`food-menus.ts` at runtime; those pull `node:crypto`. Type-only imports from them are fine.)

**Dependency chain:** Tasks **1 → 2** are a hard sequential chain (capabilities shape → clients/schemas/hooks). **Task 3** (index) needs Task 2's directory client. **Task 4** (shell) needs Task 2's directory + capabilities hooks and Task 3's index (for the shell to reuse the directory). After Task 4, Tasks **5, 6, 7, 8, 9, 10** (the six tabs) can run substantially in parallel — each consumes only Task 2's per-tab client/hook + Task 4/5's shared building blocks (`PublishGate` from Task 4; `CanonicalDiff`/`OverwriteConfirmDialog` from Task 5, which Tasks 6 and 9 reuse). If Hours (Task 6) or Menu (Task 9) is too large for one implementer pass, land the read+diff+publish-view steps as commit A and the editor+save steps as commit B (each independently gate-green). **Task 11** is the terminal gate. **Task 1 is the only protected-path task.**

---

### Task 1: Location capabilities backend + `seedLinkedLocation` helper (SANCTIONED protected-path edit)

> **⚠ Protected-path task — flag for whole-branch-review scrutiny (M5's analog of M4 Task 1).** This is the ONLY task that edits `app/api/**` / `lib/server/**`. It touches exactly two files there: `lib/server/capabilities.ts` (additive `locationCapabilities`/`locationCapabilitiesForIds`) and `app/api/locations/[id]/capabilities/route.ts` (new read-only GET). Every other protected file — every wave-1 tab route and service, `permissions.ts` — stays **byte-identical**. The reviewer must confirm that with `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` (exactly those two paths, plus the untouched test-helper is under `tests/`), that the additions mirror `permissions.ts` for every role × membership case, and that the untouched backend integration suite (the parity oracle) stays green.

**Files:**
- Create: `app/api/locations/[id]/capabilities/route.ts`
- Modify: `lib/server/capabilities.ts` (add `LocationCapabilities`, `locationCapabilitiesForIds`, `locationCapabilities`), `tests/integration/helpers/tenant.ts` (add `seedLinkedLocation`)
- Test: `tests/integration/routes/location-capabilities.test.ts`

**Interfaces:**
- Consumes: `TransactionSql` (`postgres`), `Session` (`@/lib/server/session`), `withTenant` (`@/lib/server/db`), `requireSession` (`@/lib/server/session`), `apiError` (`@/lib/server/http`), `z` (`zod`).
- Produces (Task 2 consumes these EXACT shapes):
  - `type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }`.
  - `locationCapabilitiesForIds(sql, session, locationIds: string[]): Promise<Map<string, LocationCapabilities>>` — `canEditCanonical = role ∈ {owner,admin}`; `canPublish` mirrors `canPublishLocation` exactly.
  - `locationCapabilities(sql, session, locationId: string): Promise<LocationCapabilities>` — single-location convenience.
  - `GET /api/locations/[id]/capabilities` → `{ capabilities: { canEditCanonical, canPublish } }`.
  - `seedLinkedLocation(admin, { organisationId, connectionId, googleAccountName }): Promise<{ locationId, externalLocationId, googleLocationName }>` — an active `location_link` with NO review.

**Capability definition (mirrors `lib/server/permissions.ts` exactly):**
- `canEditCanonical(loc)` = `role === 'owner' || role === 'admin'` (matches the route-level `requireRole(["owner","admin"])` on the canonical PUTs; members/viewers get 403 `permission_denied` there).
- `canPublish(loc)` = identical to `canPublishLocation`: `owner|admin` → `true`; `viewer` → `false`; else (member) `hasAnyAssignment ? (assigned-to-loc-with-can_publish) : session.canPublish`.

- [ ] **Step 0: Delete the stray `qa/` dir if present (D1)**

```bash
rm -rf "app/(dashboard)/locations/[id]/qa"
```

This directory is untracked and absent from a fresh worktree cut from `main`; the command is a no-op if it does not exist. Do not commit anything for this step on its own.

- [ ] **Step 1: Add `seedLinkedLocation` to `tests/integration/helpers/tenant.ts`**

Place it after `seedLinkedReview`. It seeds rows 1–3 of `seedLinkedReview` (external_location + location + active location_link) but NO review, so the wave-1 sub-resource routes resolve the Google context (they join `external_location el on el.id = ll.external_location_id where ll.location_id = ? and ll.is_active = true`).

```ts
export async function seedLinkedLocation(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string; connectionId: string; googleAccountName: string }
): Promise<{
  locationId: string
  externalLocationId: string
  googleLocationName: string
}> {
  const marker = randomUUID()
  const externalLocationId = randomUUID()
  const locationId = randomUUID()
  const googleLocationName = `locations/stub-${marker}`
  await admin`
    insert into external_location (
      id, organisation_id, google_connection_id, google_account_name,
      google_location_name, title, verified
    ) values (
      ${externalLocationId}, ${input.organisationId}, ${input.connectionId},
      ${input.googleAccountName}, ${googleLocationName},
      ${`Stub linked location ${marker.slice(0, 8)}`}, true
    )
  `
  await admin`
    insert into location (id, organisation_id, name)
    values (${locationId}, ${input.organisationId}, ${`Linked location ${marker.slice(0, 8)}`})
  `
  await admin`
    insert into location_link (organisation_id, external_location_id, location_id, is_active)
    values (${input.organisationId}, ${externalLocationId}, ${locationId}, true)
  `
  return { locationId, externalLocationId, googleLocationName }
}
```

Confirm `randomUUID` is already imported at the top of `tenant.ts` (it is — `createTestTenant` uses it).

- [ ] **Step 2: Write the failing integration test**

`tests/integration/routes/location-capabilities.test.ts` — every role × membership combination, executed against the real route. The member cases seed `location_member` rows directly (`(organisation_id, location_id, user_id, can_publish)`, PK `(location_id, user_id)`), and a second linked location proves "assigned elsewhere". A helper seeds a member user + session in an existing org.

```ts
import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

// Seed an extra user with a given role in an existing org, returning a cookie.
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

describeDatabase("per-location capabilities route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function caps(cookie: string, locationId: string) {
    const response = await fetch(
      `${server.baseUrl}/api/locations/${locationId}/capabilities`,
      { headers: { cookie } }
    )
    expect(response.status).toBe(200)
    return (await response.json()) as {
      capabilities: { canEditCanonical: boolean; canPublish: boolean }
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

  it("owner and admin can edit canonical and publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const admin2 = await seedMemberUser(admin, tenant.organisationId, "admin", false)

    expect((await caps(tenant.cookie, location.locationId)).capabilities).toEqual({
      canEditCanonical: true,
      canPublish: true,
    })
    expect((await caps(admin2.cookie, location.locationId)).capabilities).toEqual({
      canEditCanonical: true,
      canPublish: true,
    })
  })

  it("viewer can neither edit canonical nor publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer", false)
    expect((await caps(viewer.cookie, location.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: false,
    })
  })

  it("member with no assignments falls back to session.canPublish, never edits canonical", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const canPub = await seedMemberUser(admin, tenant.organisationId, "member", true)
    const noPub = await seedMemberUser(admin, tenant.organisationId, "member", false)
    expect((await caps(canPub.cookie, location.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: true,
    })
    expect((await caps(noPub.cookie, location.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: false,
    })
  })

  it("member with assignments: only the assigned location with can_publish publishes", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const assignedPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const assignedNoPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const unassigned = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // session.canPublish = true, but assignments override it per-location.
    const member = await seedMemberUser(admin, tenant.organisationId, "member", true)
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedPublish.locationId}, ${member.userId}, true)
    `
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedNoPublish.locationId}, ${member.userId}, false)
    `
    // assigned + can_publish
    expect((await caps(member.cookie, assignedPublish.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: true,
    })
    // assigned, no can_publish
    expect((await caps(member.cookie, assignedNoPublish.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: false,
    })
    // has assignments but not to this location -> no publish
    expect((await caps(member.cookie, unassigned.locationId)).capabilities).toEqual({
      canEditCanonical: false,
      canPublish: false,
    })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/location-capabilities.test.ts`
Expected: FAIL — the `/capabilities` route 404s (route not created) / `locationCapabilities` undefined.

- [ ] **Step 4: Extend `lib/server/capabilities.ts` (additive)**

Append below the existing `reviewCapabilities` export. The member branch reuses the exact `location_member` grant logic already proven in `reviewCapabilitiesForLocations`.

```ts
// Per-location capabilities for the Locations workspace (spec §3):
//   canEditCanonical === role in {owner, admin}  (the canonical-PUT route gate)
//   canPublish        === canPublishLocation(sql, session, locationId)
export type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }

export async function locationCapabilitiesForIds(
  sql: TransactionSql,
  session: Session,
  locationIds: string[]
): Promise<Map<string, LocationCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, LocationCapabilities>()
  if (unique.length === 0) return result

  if (session.role === "owner" || session.role === "admin") {
    for (const id of unique) {
      result.set(id, { canEditCanonical: true, canPublish: true })
    }
    return result
  }
  if (session.role === "viewer") {
    for (const id of unique) {
      result.set(id, { canEditCanonical: false, canPublish: false })
    }
    return result
  }

  // member: mirror locationGrant/canPublishLocation exactly.
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
    result.set(id, { canEditCanonical: false, canPublish })
  }
  return result
}

export async function locationCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<LocationCapabilities> {
  const map = await locationCapabilitiesForIds(sql, session, [locationId])
  return map.get(locationId) ?? { canEditCanonical: false, canPublish: false }
}
```

- [ ] **Step 5: Create the capabilities route**

`app/api/locations/[id]/capabilities/route.ts`:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"

import { locationCapabilities } from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const capabilities = await withTenant(session.organisationId, (sql) =>
      locationCapabilities(sql, session, locationId)
    )
    return NextResponse.json({ capabilities })
  } catch (error) {
    return apiError(error)
  }
}
```

- [ ] **Step 6: Run to verify pass, then the full parity oracle**

```bash
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/location-capabilities.test.ts
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
pnpm typecheck && pnpm lint
git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts
```

Expected: the new test passes (4 tests, 7 assertions across the combinations); every existing integration test stays green (the additions are new symbols + a new route — nothing existing changed). The `git diff --stat` lists **exactly** `app/api/locations/[id]/capabilities/route.ts` and `lib/server/capabilities.ts` — nothing else under those paths (the helper edit is under `tests/`, outside the protected set).

- [ ] **Step 7: Commit**

```bash
git add lib/server/capabilities.ts "app/api/locations/[id]/capabilities/route.ts" tests/integration/helpers/tenant.ts tests/integration/routes/location-capabilities.test.ts
git commit -m "feat(locations): per-location capabilities route + seedLinkedLocation (sanctioned)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Typed API clients + client-safe form schemas + query keys/hooks

**Files:**
- Create: `lib/locations/forms/profile.ts`, `lib/locations/forms/hours.ts`, `lib/locations/forms/food-menus.ts`, `lib/locations/forms/local-post.ts`, `lib/locations/action-errors.ts`, `lib/locations/gating.ts`, `lib/api/location-profile.ts`, `lib/api/location-hours.ts`, `lib/api/location-media.ts`, `lib/api/location-booking.ts`, `lib/api/location-menu.ts`, `lib/api/location-posts.ts`, `lib/queries/use-locations.ts`, `lib/queries/use-location-capabilities.ts`, `lib/queries/use-location-profile.ts`, `lib/queries/use-location-hours.ts`, `lib/queries/use-location-media.ts`, `lib/queries/use-location-booking.ts`, `lib/queries/use-location-menu.ts`, `lib/queries/use-location-posts.ts`
- Modify: `lib/api/locations.ts` (add `fetchManagementLocations`, `fetchLocationCapabilities`), `lib/queries/keys.ts` (per-location + capabilities keys)
- Test: `tests/components/location-api.test.tsx`, `tests/components/location-forms.test.ts`, `tests/components/location-action-errors.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` (`@/lib/api/client`); `z` (`zod`); `GOOGLE_MEDIA_CATEGORIES`/`GoogleMediaCategory`/`GOOGLE_PLACE_ACTION_TYPES`/`GooglePlaceActionType` (`@/lib/domain/google-contract`); `useQuery` (`@tanstack/react-query`); `queryKeys` (`@/lib/queries/keys`).
- Produces (Tasks 3–10 consume these EXACT signatures):
  - `lib/api/locations.ts`: `fetchLocations(): Promise<{ locations: { id: string; name: string }[] }>` (existing); `type ManagementLocation`; `fetchManagementLocations(): Promise<{ locations: ManagementLocation[] }>`; `type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }`; `fetchLocationCapabilities(id: string): Promise<LocationCapabilities>`.
  - `lib/api/location-profile.ts`: `type ProfileState`, `type ProfileFieldKey`; `fetchProfile(id): Promise<ProfileState>`; `saveProfile(id, { expectedCanonicalRevision, values }): Promise<{ saved: true; revision: string }>`; `runProfileOperation(id, ProfileOperationInput): Promise<ProfileOperationResult>`.
  - `lib/api/location-hours.ts`: `type HoursState`, `type NormalizedHours`, `type HoursUpdateMask`; `fetchHours(id): Promise<HoursState>`; `saveHours(id, { expectedCanonicalRevision, hours }): Promise<{ saved: true; revision: string }>`; `publishHours(id, PublishHoursInput): Promise<PublishResult>`.
  - `lib/api/location-media.ts`: `type MediaItem`, `type MediaState`; `fetchMedia(id): Promise<MediaState>`; `createMediaFromUrl(id, input)`, `uploadMediaFile(id, FormData)`, `updateMediaCategory(id, mediaId, input)`, `deleteMediaItem(id, mediaId, input)` — each `Promise<MediaMutationResult>`.
  - `lib/api/location-booking.ts`: `type PlaceActionLink`, `type PlaceActionsState`; `fetchPlaceActions(id): Promise<PlaceActionsState>`; `createPlaceAction`, `updatePlaceAction`, `deletePlaceAction`.
  - `lib/api/location-menu.ts`: `type FoodMenu`, `type FoodMenusState`; `fetchFoodMenus(id): Promise<FoodMenusState>`; `saveFoodMenus(id, { expectedCanonicalRevision, menus })`; `publishFoodMenus(id, PublishMenusInput)`.
  - `lib/api/location-posts.ts`: `type Post`, `type PostsState`; `fetchPosts(id): Promise<PostsState>`; `createPost`, `updatePost`, `publishPost`, `decidePostApproval`, `deletePost`.
  - `lib/locations/forms/*`: `profileFormSchema`/`ProfileFormValues`; `hoursFormSchema`/`HoursFormValues`/`emptyHours`/`DAY_LABELS`; `foodMenusFormSchema`/`countFoodMenus`; `localPostFormSchema`/`LocalPostFormValues`.
  - `lib/locations/action-errors.ts`: `describeActionError(error: unknown): string`.
  - `lib/locations/gating.ts`: `type LocationCapabilities`; `editDisabledReason(caps)`, `publishDisabledReason(caps, writesEnabled)`, `composeDisabledReason(writesEnabled)`.
  - `lib/queries/use-locations.ts`: `type DirectoryEntry = { id: string; name: string; address?: unknown; verified?: boolean; linked?: boolean; timezone?: string }`; `useLocationDirectory(role): { data?: DirectoryEntry[]; isPending; isError; refetch }`.
  - `lib/queries/use-location-capabilities.ts`: `useLocationCapabilities(id)`.
  - `lib/queries/use-location-*.ts`: `useProfile(id)`, `useHours(id)`, `useMedia(id)`, `usePlaceActions(id)`, `useFoodMenus(id)`, `usePosts(id)`.

- [ ] **Step 1: Write the failing tests**

`tests/components/location-forms.test.ts` (schema parity with the server schemas — the mirrors accept/reject the same shapes):

```ts
import { describe, expect, it } from "vitest"

import { foodMenusFormSchema, countFoodMenus } from "@/lib/locations/forms/food-menus"
import { hoursFormSchema, emptyHours } from "@/lib/locations/forms/hours"
import { localPostFormSchema } from "@/lib/locations/forms/local-post"
import { profileFormSchema } from "@/lib/locations/forms/profile"

describe("profileFormSchema", () => {
  it("accepts trimmed strings and an empty website", () => {
    const parsed = profileFormSchema.parse({
      name: "  Riverside  ",
      description: "A calm riverside stay",
      phone: "+44 20 7946 0000",
      website: "",
    })
    expect(parsed.name).toBe("Riverside")
    expect(parsed.website).toBe("")
  })
  it("rejects a non-URL website and an over-long name", () => {
    expect(profileFormSchema.safeParse({ name: "x", description: "", phone: "", website: "not-a-url" }).success).toBe(false)
    expect(profileFormSchema.safeParse({ name: "x".repeat(256), description: "", phone: "", website: "" }).success).toBe(false)
  })
})

describe("hoursFormSchema (mirror of hours/route.ts hoursSchema)", () => {
  it("accepts a valid 7-day week with a special day", () => {
    const hours = emptyHours()
    hours.regular[1] = { dayOfWeek: 1, isClosed: false, periods: [{ opensAt: "09:00", closesAt: "17:00" }] }
    hours.special = [{ effectiveDate: "2026-12-25", isClosed: true, opensAt: null, closesAt: null }]
    expect(hoursFormSchema.safeParse(hours).success).toBe(true)
  })
  it("rejects an open day with no periods and a bad time", () => {
    const open = emptyHours()
    open.regular[0] = { dayOfWeek: 0, isClosed: false, periods: [] }
    expect(hoursFormSchema.safeParse(open).success).toBe(false)
    const badTime = emptyHours()
    badTime.regular[0] = { dayOfWeek: 0, isClosed: false, periods: [{ opensAt: "25:00", closesAt: "17:00" }] }
    expect(hoursFormSchema.safeParse(badTime).success).toBe(false)
  })
  it("rejects a week that is not exactly seven days", () => {
    const six = emptyHours()
    six.regular = six.regular.slice(0, 6)
    expect(hoursFormSchema.safeParse(six).success).toBe(false)
  })
})

describe("foodMenusFormSchema + countFoodMenus", () => {
  it("accepts up to 100 menu objects", () => {
    expect(foodMenusFormSchema.safeParse([{ sections: [] }]).success).toBe(true)
    expect(foodMenusFormSchema.safeParse(new Array(101).fill({})).success).toBe(false)
  })
  it("counts sections, items and options", () => {
    const counts = countFoodMenus([
      { sections: [{ items: [{ options: [{}, {}] }, { options: [] }] }] },
    ])
    expect(counts).toEqual({ menus: 1, sections: 1, items: 2, options: 2 })
  })
})

describe("localPostFormSchema (mirror of posts.ts localPostInputSchema)", () => {
  it("requires event details for EVENT posts", () => {
    expect(localPostFormSchema.safeParse({ topicType: "EVENT", summary: "x", media: [] }).success).toBe(false)
    expect(
      localPostFormSchema.safeParse({ topicType: "EVENT", summary: "x", media: [], event: { title: "Gig" } }).success
    ).toBe(true)
  })
  it("defaults languageCode and accepts STANDARD with just a summary", () => {
    const parsed = localPostFormSchema.parse({ topicType: "STANDARD", summary: "Open late tonight", media: [] })
    expect(parsed.languageCode).toBe("en-GB")
  })
})
```

`tests/components/location-action-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/locations/action-errors"

describe("describeActionError", () => {
  it("maps known wave-1 codes to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["profile_snapshot_stale", 409, /changed since you loaded/i],
      ["google_hours_overwrite_confirmation_required", 409, /google changed/i],
      ["media_stale", 409, /changed on google/i],
      ["place_action_not_editable", 409, /cannot be edited/i],
      ["food_menus_not_eligible", 409, /cannot have a food menu/i],
      ["second_approver_required", 403, /different/i],
      ["posts_paused", 503, /paused/i],
      ["media_file_too_large", 413, /75 ?mb/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw server message"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
  it("falls back to a generic message for unknown errors", () => {
    expect(describeActionError(new Error("boom"))).toMatch(/something went wrong/i)
  })
})
```

`tests/components/location-api.test.tsx` (wire mapping + parse; representative — management view, capabilities, hours save, media multipart, posts publish outcomes):

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchLocationCapabilities, fetchManagementLocations } from "@/lib/api/locations"
import { saveHours } from "@/lib/api/location-hours"
import { uploadMediaFile } from "@/lib/api/location-media"
import { publishPost } from "@/lib/api/location-posts"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("locations directory + capabilities clients", () => {
  it("fetchManagementLocations requests the management view and maps rows", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ locations: [{ locationId: "loc-1", name: "Riverside", address: { locality: "Bath" }, timezone: "Europe/London", linkId: "ll-1", externalLocationId: "e-1", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true }] })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await fetchManagementLocations()
    expect(result.locations[0].verified).toBe(true)
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/location-links")
    expect(url.searchParams.get("view")).toBe("management")
  })

  it("fetchLocationCapabilities parses the capability envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: { canEditCanonical: false, canPublish: true } })))
    expect(await fetchLocationCapabilities("loc-1")).toEqual({ canEditCanonical: false, canPublish: true })
  })
})

describe("tab mutation clients", () => {
  it("saveHours PUTs the revision and hours", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ saved: true, revision: "3" }))
    vi.stubGlobal("fetch", fetchMock)
    const hours = { regular: [], special: [], moreHours: [] }
    const result = await saveHours("loc-1", { expectedCanonicalRevision: "2", hours: hours as never })
    expect(result.revision).toBe("3")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/locations/loc-1/hours")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT")
  })

  it("uploadMediaFile POSTs multipart form data without a JSON content-type", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "m1", status: "succeeded", idempotent: false }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const form = new FormData()
    form.set("mediaFormat", "PHOTO")
    const result = await uploadMediaFile("loc-1", form)
    expect(result.status).toBe("succeeded")
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string> | undefined)?.["content-type"]).toBeUndefined()
  })

  it("publishPost surfaces the awaiting-approval status (202)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "awaiting_approval" }, 202)))
    expect((await publishPost("loc-1", "p1")).status).toBe("awaiting_approval")
  })

  it("publishPost surfaces the second-approver error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "second_approver_required", message: "A different authorised user must approve this post." }, 403)
    ))
    await expect(publishPost("loc-1", "p1")).rejects.toMatchObject({ code: "second_approver_required", status: 403 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/location-forms.test.ts tests/components/location-action-errors.test.ts tests/components/location-api.test.tsx --project components`
Expected: FAIL — none of the `@/lib/locations/*` or `@/lib/api/location-*` modules exist.

- [ ] **Step 3: Client-safe form schemas — `lib/locations/forms/`**

`lib/locations/forms/profile.ts`:

```ts
import { z } from "zod"

// Mirrors app/api/locations/[id]/profile/route.ts saveSchema.values, modelled as
// form strings ("" is submitted as null). Website allows "" or a valid URL.
export const profileFormSchema = z.object({
  name: z.string().trim().max(255),
  description: z.string().trim().max(750),
  phone: z.string().trim().max(50),
  website: z.union([z.literal(""), z.url().max(2048)]),
})
export type ProfileFormValues = z.infer<typeof profileFormSchema>

// Convert the four editable form fields to the PUT `values` payload ("" -> null).
export function toProfileValues(values: ProfileFormValues) {
  const nn = (v: string) => (v.trim() ? v.trim() : null)
  return { name: nn(values.name), description: nn(values.description), phone: nn(values.phone), website: nn(values.website) }
}
```

`lib/locations/forms/hours.ts` (a verbatim mirror of `hoursSchema` in `app/api/locations/[id]/hours/route.ts`):

```ts
import { z } from "zod"

import type { NormalizedHours } from "@/lib/api/location-hours"

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const hoursFormSchema = z
  .object({
    regular: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          isClosed: z.boolean(),
          periods: z.array(z.object({ opensAt: timeSchema, closesAt: timeSchema })).max(3),
        })
      )
      .length(7),
    special: z
      .array(
        z.object({
          effectiveDate: z.iso.date(),
          isClosed: z.boolean(),
          opensAt: timeSchema.nullable(),
          closesAt: timeSchema.nullable(),
        })
      )
      .max(366),
    moreHours: z
      .array(
        z.object({
          hoursTypeId: z.string().min(1).max(100),
          periods: z
            .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: timeSchema, closesAt: timeSchema }))
            .max(21),
        })
      )
      .max(20),
  })
  .superRefine((hours, context) => {
    if (new Set(hours.regular.map((day) => day.dayOfWeek)).size !== 7) {
      context.addIssue({ code: "custom", message: "Regular hours must contain each day exactly once." })
    }
    for (const [index, day] of hours.regular.entries()) {
      if (day.isClosed !== (day.periods.length === 0)) {
        context.addIssue({
          code: "custom",
          path: ["regular", index],
          message: "Closed days cannot contain periods and open days require a period.",
        })
      }
    }
    for (const [index, period] of hours.special.entries()) {
      if (!period.isClosed && (!period.opensAt || !period.closesAt)) {
        context.addIssue({
          code: "custom",
          path: ["special", index],
          message: "Open special hours require opening and closing times.",
        })
      }
    }
  })

export type HoursFormValues = z.infer<typeof hoursFormSchema>

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

export function emptyHours(): NormalizedHours {
  return {
    regular: DAY_LABELS.map((_, dayOfWeek) => ({ dayOfWeek, isClosed: true, periods: [] })),
    special: [],
    moreHours: [],
  }
}
```

`lib/locations/forms/food-menus.ts`:

```ts
import { z } from "zod"

// Mirrors app/api/locations/[id]/food-menus/route.ts saveSchema.menus.
export const foodMenusFormSchema = z.array(z.record(z.string(), z.unknown())).max(100)
export type FoodMenu = z.infer<typeof foodMenusFormSchema>[number]

// Client-safe re-implementation of lib/domain/food-menus.ts foodMenuCounts
// (that module imports node:crypto so cannot be bundled for the client).
export function countFoodMenus(menus: Array<Record<string, unknown>>) {
  let sections = 0
  let items = 0
  let options = 0
  for (const menu of menus) {
    const menuSections = Array.isArray(menu.sections) ? menu.sections : []
    sections += menuSections.length
    for (const section of menuSections) {
      if (!section || typeof section !== "object") continue
      const sectionItems = (section as Record<string, unknown>).items
      if (Array.isArray(sectionItems)) {
        items += sectionItems.length
        for (const item of sectionItems) {
          if (!item || typeof item !== "object") continue
          const itemOptions = (item as Record<string, unknown>).options
          if (Array.isArray(itemOptions)) options += itemOptions.length
        }
      }
    }
  }
  return { menus: menus.length, sections, items, options }
}
```

`lib/locations/forms/local-post.ts` (a verbatim mirror of `localPostInputSchema` in `lib/server/posts.ts`):

```ts
import { z } from "zod"

const callToActionSchema = z
  .object({ actionType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]), url: z.url().optional() })
  .optional()

export const localPostFormSchema = z
  .object({
    topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
    languageCode: z.string().trim().min(2).max(16).default("en-GB"),
    summary: z.string().trim().max(1500).default(""),
    callToAction: callToActionSchema,
    event: z.record(z.string(), z.unknown()).optional(),
    offer: z
      .object({
        couponCode: z.string().trim().max(100).optional(),
        redeemOnlineUrl: z.url().optional(),
        termsConditions: z.string().trim().max(5000).optional(),
      })
      .optional(),
    media: z.array(z.object({ sourceUrl: z.url() })).max(10).default([]),
    scheduledTime: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if ((value.topicType === "EVENT" || value.topicType === "OFFER") && !value.event) {
      context.addIssue({ code: "custom", path: ["event"], message: "Event details are required for event and offer posts." })
    }
    if (value.topicType === "OFFER" && !value.offer) {
      context.addIssue({ code: "custom", path: ["offer"], message: "Offer details are required for offer posts." })
    }
  })

export type LocalPostFormValues = z.infer<typeof localPostFormSchema>
```

- [ ] **Step 4: Action-error copy + gating — `lib/locations/`**

`lib/locations/action-errors.ts`:

```ts
import { ApiClientError } from "@/lib/api/client"

// Every wave-1 server code -> plain GB English. No code is ever shown (spec §7).
const COPY: Record<string, string> = {
  // profile / hours / menu — canonical + publish
  canonical_edit_permission_required: "Only owners and admins can edit this location.",
  publish_permission_required: "You do not have permission to publish this location to Google.",
  permission_denied: "You do not have permission to do that.",
  canonical_resource_stale: "This changed since you loaded it. Refresh and try again.",
  profile_snapshot_stale: "The profile changed since you loaded it. Refresh and try again.",
  hours_snapshot_stale: "The opening hours changed since you loaded them. Refresh and try again.",
  food_menus_stale: "The menu changed since you loaded it. Refresh and try again.",
  profile_overwrite_confirmation_required: "Google changed these details independently. Confirm the overwrite to continue.",
  canonical_overwrite_confirmation_required: "This location changed independently. Confirm the overwrite to continue.",
  google_hours_overwrite_confirmation_required: "Google changed the opening hours independently. Confirm the overwrite to continue.",
  profile_patch_empty: "The selected fields do not produce any change to publish.",
  profile_publishing_disabled: "Publishing to Google is currently unavailable.",
  hours_publishing_disabled: "Publishing to Google is currently unavailable.",
  food_menus_paused: "Menu publishing is currently paused.",
  food_menus_not_eligible: "Google reports that this location cannot have a food menu.",
  food_menus_confirmation_required: "Confirm the full menu replacement to continue.",
  google_location_not_linked: "Link this location to Google before managing it here.",
  location_not_linked: "Link this location to Google before managing it here.",
  // photos
  media_paused: "Photo and video changes are currently paused.",
  publish_not_allowed: "You do not have permission to publish this location to Google.",
  media_stale: "This item changed on Google since you loaded it. Refresh and try again.",
  media_category_not_patchable: "Google does not allow changing an existing item to a cover or profile photo.",
  media_type_unsupported: "That file type is not supported. Upload a JPEG or PNG photo, or an MP4 or QuickTime video.",
  media_file_too_small: "That photo is too small. Google requires photos of at least 10 KB.",
  media_file_too_large: "That file is too large. Uploads cannot exceed 75 MB.",
  customer_media_read_only: "Customer photos cannot be changed here.",
  // booking
  place_actions_paused: "Booking link changes are currently paused.",
  place_action_stale: "This link changed on Google since you loaded it. Refresh and try again.",
  place_action_not_editable: "Google reports that this provider link cannot be edited here.",
  // posts
  posts_paused: "Google posts are currently paused.",
  publishing_paused: "Publishing to Google is currently paused.",
  second_approver_required: "A different authorised user must approve this post.",
  approval_not_pending: "This post is no longer awaiting approval.",
  post_not_found: "That post could not be found. It may have been removed.",
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

// A wave-1 sub-resource returns 409 when the location has no active Google link;
// tabs render a distinct "link this location first" state rather than an error.
export function isNotLinkedError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === "google_location_not_linked" || error.code === "location_not_linked")
  )
}
```

`lib/locations/gating.ts`:

```ts
export type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }

// Returns a disabled-state reason string, or null when the control is enabled.
// A missing `caps` means the capability query is still loading -> null (the
// control stays disabled by the caller's own pending state, not a reason).
export function editDisabledReason(caps: LocationCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canEditCanonical ? null : "Only owners and admins can edit this location."
}

export function publishDisabledReason(
  caps: LocationCapabilities | undefined,
  writesEnabled: boolean
): string | null {
  if (!caps) return null
  if (!caps.canPublish) return "You do not have permission to publish this location to Google."
  if (!writesEnabled) return "Publishing to Google is currently unavailable."
  return null
}

// Posts drafting is blocked whenever posts writes are off (the routes 503
// posts_paused on POST/PATCH). Conservative but honest for the default all-off.
export function composeDisabledReason(writesEnabled: boolean): string | null {
  return writesEnabled ? null : "Google posts are currently paused, so new posts cannot be composed."
}
```

- [ ] **Step 5: Directory + capabilities clients — extend `lib/api/locations.ts`**

Append to the existing file (keep `fetchLocations` unchanged):

```ts
const managementLocationSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  address: z.unknown().nullable(),
  timezone: z.string(),
  linkId: z.string().nullable(),
  externalLocationId: z.string().nullable(),
  googleLocationName: z.string().nullable(),
  googleTitle: z.string().nullable(),
  verified: z.boolean().nullable(),
})
export type ManagementLocation = z.infer<typeof managementLocationSchema>

const managementResponseSchema = z.object({ locations: z.array(managementLocationSchema) })

export function fetchManagementLocations() {
  return apiFetch("/api/location-links?view=management", { schema: managementResponseSchema })
}

const locationCapabilitiesSchema = z.object({ canEditCanonical: z.boolean(), canPublish: z.boolean() })
export type LocationCapabilities = z.infer<typeof locationCapabilitiesSchema>

const capabilitiesResponseSchema = z.object({ capabilities: locationCapabilitiesSchema })

export function fetchLocationCapabilities(id: string): Promise<LocationCapabilities> {
  return apiFetch(`/api/locations/${id}/capabilities`, { schema: capabilitiesResponseSchema }).then((r) => r.capabilities)
}
```

- [ ] **Step 6: Per-tab clients — `lib/api/location-*.ts`**

`lib/api/location-profile.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const PROFILE_FIELD_KEYS = ["name", "description", "phone", "address", "mapsUrl", "reviewUrl", "website"] as const
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number]

const profileFieldSchema = z.object({
  key: z.enum(PROFILE_FIELD_KEYS),
  policy: z.enum(["bidirectional", "import_only", "google_read_only"]),
  status: z.enum(["in_sync", "core_dirty", "google_dirty", "conflict"]),
  canonicalValue: z.string().nullable(),
  googleValue: z.string().nullable(),
  canonicalHash: z.string(),
  googleHash: z.string(),
  lastReconciledAt: z.string().nullable(),
})

const profileStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canPublish: z.boolean(),
  googleWritesEnabled: z.boolean(),
  fields: z.array(profileFieldSchema),
  googleDetails: z.object({ primaryCategory: z.string().nullable(), additionalCategories: z.array(z.string()) }),
  latestAttempt: z
    .object({
      id: z.string(),
      direction: z.string(),
      status: z.string(),
      selectedFields: z.array(z.string()),
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
    })
    .nullable(),
})
export type ProfileState = z.infer<typeof profileStateSchema>
export type ProfileField = z.infer<typeof profileFieldSchema>

export function fetchProfile(id: string): Promise<ProfileState> {
  return apiFetch(`/api/locations/${id}/profile`, { schema: z.object({ profile: profileStateSchema }) }).then((r) => r.profile)
}

export function saveProfile(
  id: string,
  input: { expectedCanonicalRevision: string; values: { name: string | null; description: string | null; phone: string | null; website: string | null } }
) {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type ProfileOperationInput = {
  direction: "to_google" | "from_google"
  confirmation: "publish_nabapresence_profile_to_google" | "import_google_profile_to_nabapresence"
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteGoogleChanges?: boolean
  confirmOverwriteCanonicalChanges?: boolean
}
export type ProfileOperationResult = { status: string; revision?: string; attemptId?: string; idempotent?: boolean }

export function runProfileOperation(id: string, input: ProfileOperationInput): Promise<ProfileOperationResult> {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "POST",
    body: input,
    schema: z.object({ status: z.string(), revision: z.string().optional(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
```

`lib/api/location-hours.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export type HoursUpdateMask = "regularHours" | "specialHours" | "moreHours"

const normalizedHoursSchema = z.object({
  regular: z.array(
    z.object({
      dayOfWeek: z.number(),
      isClosed: z.boolean(),
      periods: z.array(z.object({ opensAt: z.string(), closesAt: z.string() })),
    })
  ),
  special: z.array(
    z.object({
      effectiveDate: z.string(),
      isClosed: z.boolean(),
      opensAt: z.string().nullable(),
      closesAt: z.string().nullable(),
    })
  ),
  moreHours: z.array(
    z.object({
      hoursTypeId: z.string(),
      periods: z.array(z.object({ dayOfWeek: z.number(), opensAt: z.string(), closesAt: z.string() })),
    })
  ),
})
export type NormalizedHours = z.infer<typeof normalizedHoursSchema>

const hoursStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string(), timezone: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  status: z.enum(["in_sync", "core_dirty", "google_dirty", "conflict"]),
  canonical: normalizedHoursSchema,
  google: normalizedHoursSchema,
  canonicalHash: z.string(),
  googleHash: z.string(),
  updateMask: z.array(z.enum(["regularHours", "specialHours", "moreHours"])),
  warnings: z.array(z.string()),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  lastReconciledAt: z.string().nullable(),
  latestAttempt: z.object({ id: z.string(), status: z.string(), createdAt: z.string(), finishedAt: z.string().nullable() }).nullable(),
})
export type HoursState = z.infer<typeof hoursStateSchema>

export function fetchHours(id: string): Promise<HoursState> {
  return apiFetch(`/api/locations/${id}/hours`, { schema: z.object({ hours: hoursStateSchema }) }).then((r) => r.hours)
}

export function saveHours(id: string, input: { expectedCanonicalRevision: string; hours: NormalizedHours }) {
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type PublishHoursInput = {
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  approvedUpdateMask: HoursUpdateMask[]
  confirmOverwriteGoogleChanges?: boolean
}
export type PublishResult = { status: string; attemptId?: string; idempotent?: boolean }

export function publishHours(id: string, input: PublishHoursInput): Promise<PublishResult> {
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "POST",
    body: { confirmation: "publish_nabapresence_hours_to_google", ...input },
    schema: z.object({ status: z.string(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
```

`lib/api/location-media.ts`:

```ts
import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES, type GoogleMediaCategory } from "@/lib/domain/google-contract"

import { apiFetch } from "./client"

const mediaItemSchema = z.object({
  id: z.string(),
  googleMediaName: z.string(),
  ownership: z.enum(["merchant", "customer"]),
  mediaFormat: z.string(),
  category: z.string(),
  sourceUrl: z.string().nullable(),
  googleUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  description: z.string().nullable(),
  attribution: z.unknown(),
  dimensions: z.unknown(),
  insights: z.unknown(),
  googleHash: z.string(),
  createTime: z.string().nullable(),
})
export type MediaItem = z.infer<typeof mediaItemSchema>

const mediaStateSchema = z.object({
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  categories: z.array(z.string()),
  items: z.array(mediaItemSchema),
})
export type MediaState = z.infer<typeof mediaStateSchema>

export const MEDIA_CATEGORIES = GOOGLE_MEDIA_CATEGORIES
export type MediaCategory = GoogleMediaCategory

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })
export type MediaMutationResult = z.infer<typeof mutationResultSchema>

export function fetchMedia(id: string): Promise<MediaState> {
  return apiFetch(`/api/locations/${id}/media`, { schema: z.object({ media: mediaStateSchema }) }).then((r) => r.media)
}

export function createMediaFromUrl(
  id: string,
  input: { mediaFormat: "PHOTO" | "VIDEO"; category: MediaCategory; sourceUrl: string; description?: string }
) {
  return apiFetch(`/api/locations/${id}/media`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_media" },
    schema: mutationResultSchema,
  })
}

// Multipart upload: apiFetch cannot serialise FormData, so post directly and
// reuse ApiClientError-shaped errors via a thin wrapper.
export async function uploadMediaFile(id: string, form: FormData): Promise<MediaMutationResult> {
  const { ApiClientError } = await import("./client")
  form.set("confirmation", "create_google_media")
  const response = await fetch(`/api/locations/${id}/media`, { method: "POST", body: form })
  const text = await response.text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = text
  }
  if (!response.ok) {
    const record = (raw ?? {}) as Record<string, unknown>
    const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : null
    const code = typeof record.error === "string" ? record.error : nested && typeof nested.code === "string" ? nested.code : "http_error"
    const message = typeof record.message === "string" ? record.message : nested && typeof nested.message === "string" ? nested.message : `Request failed (${response.status}).`
    throw new ApiClientError(response.status, code, message, record.details)
  }
  return mutationResultSchema.parse(raw)
}

export function updateMediaCategory(id: string, mediaId: string, input: { category: MediaCategory; expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_media" },
    schema: mutationResultSchema,
  })
}

export function deleteMediaItem(id: string, mediaId: string, input: { expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/media/${mediaId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_media" },
    schema: mutationResultSchema,
  })
}
```

`lib/api/location-booking.ts`:

```ts
import { z } from "zod"

import { GOOGLE_PLACE_ACTION_TYPES, type GooglePlaceActionType } from "@/lib/domain/google-contract"

import { apiFetch } from "./client"

const linkSchema = z.object({
  id: z.string(),
  googleLinkName: z.string(),
  providerType: z.string(),
  isEditable: z.boolean(),
  uri: z.string(),
  placeActionType: z.string(),
  isPreferred: z.boolean(),
  googleHash: z.string(),
  observedAt: z.string(),
})
export type PlaceActionLink = z.infer<typeof linkSchema>

const placeActionsStateSchema = z.object({
  locationId: z.string(),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  supportedTypes: z.array(z.string()),
  links: z.array(linkSchema),
  latestMutation: z
    .object({ id: z.string(), operation: z.string(), status: z.string(), createdAt: z.string(), finishedAt: z.string().nullable() })
    .nullable(),
})
export type PlaceActionsState = z.infer<typeof placeActionsStateSchema>

export const PLACE_ACTION_TYPES = GOOGLE_PLACE_ACTION_TYPES
export type PlaceActionType = GooglePlaceActionType

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function fetchPlaceActions(id: string): Promise<PlaceActionsState> {
  return apiFetch(`/api/locations/${id}/place-actions`, { schema: z.object({ placeActions: placeActionsStateSchema }) }).then(
    (r) => r.placeActions
  )
}

export function createPlaceAction(id: string, input: { uri: string; placeActionType: PlaceActionType; isPreferred: boolean }) {
  return apiFetch(`/api/locations/${id}/place-actions`, {
    method: "POST",
    body: { ...input, confirmation: "create_google_place_action" },
    schema: mutationResultSchema,
  })
}

export function updatePlaceAction(
  id: string,
  linkId: string,
  input: { uri: string; placeActionType: PlaceActionType; isPreferred: boolean; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "PATCH",
    body: { ...input, confirmation: "update_google_place_action" },
    schema: mutationResultSchema,
  })
}

export function deletePlaceAction(id: string, linkId: string, input: { expectedGoogleHash: string }) {
  return apiFetch(`/api/locations/${id}/place-actions/${linkId}`, {
    method: "DELETE",
    body: { ...input, confirmation: "delete_google_place_action" },
    schema: mutationResultSchema,
  })
}
```

`lib/api/location-menu.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export type FoodMenu = Record<string, unknown>

const countsSchema = z.object({ menus: z.number(), sections: z.number(), items: z.number(), options: z.number() })

const foodMenusStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  eligible: z.boolean(),
  status: z.enum(["in_sync", "drift"]),
  canonicalMenus: z.array(z.record(z.string(), z.unknown())),
  googleMenus: z.array(z.record(z.string(), z.unknown())),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canonicalCounts: countsSchema,
  googleCounts: countsSchema,
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
})
export type FoodMenusState = z.infer<typeof foodMenusStateSchema>

export function fetchFoodMenus(id: string): Promise<FoodMenusState> {
  return apiFetch(`/api/locations/${id}/food-menus`, { schema: z.object({ foodMenus: foodMenusStateSchema }) }).then((r) => r.foodMenus)
}

export function saveFoodMenus(id: string, input: { expectedCanonicalRevision: string; menus: FoodMenu[] }) {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type PublishMenusInput = { expectedCanonicalRevision: string; expectedCanonicalHash: string; expectedGoogleHash: string }

export function publishFoodMenus(id: string, input: PublishMenusInput) {
  return apiFetch(`/api/locations/${id}/food-menus`, {
    method: "POST",
    body: { confirmation: "publish_nabapresence_food_menus_to_google", ...input, confirmFullReplacement: true },
    schema: z.object({ status: z.string(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
```

`lib/api/location-posts.ts`:

```ts
import { z } from "zod"

import type { LocalPostFormValues } from "@/lib/locations/forms/local-post"

import { apiFetch } from "./client"

const postSchema = z.object({
  id: z.string(),
  topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
  languageCode: z.string(),
  summary: z.string(),
  callToAction: z.unknown(),
  event: z.unknown(),
  offer: z.unknown(),
  media: z.unknown(),
  scheduledTime: z.string().nullable(),
  status: z.enum(["draft", "awaiting_approval", "publishing", "published", "failed", "ambiguous"]),
  googlePostName: z.string().nullable(),
  googleState: z.string().nullable(),
  googleSearchUrl: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Post = z.infer<typeof postSchema>

const postsStateSchema = z.object({
  posts: z.array(postSchema),
  writesEnabled: z.boolean(),
  reconciliationError: z.string().nullable(),
})
export type PostsState = z.infer<typeof postsStateSchema>

export function fetchPosts(id: string): Promise<PostsState> {
  return apiFetch(`/api/locations/${id}/posts`, { schema: postsStateSchema })
}

export function createPost(id: string, input: LocalPostFormValues) {
  return apiFetch(`/api/locations/${id}/posts`, {
    method: "POST",
    body: input,
    schema: z.object({ post: z.object({ id: z.string() }) }),
  })
}

export function updatePost(id: string, postId: string, input: LocalPostFormValues) {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "PATCH",
    body: input,
    schema: z.object({ post: z.object({ id: z.string(), status: z.string() }) }),
  })
}

export type PublishPostResult = { status: "awaiting_approval" | "published"; postId?: string; googlePostName?: string | null }

export function publishPost(id: string, postId: string): Promise<PublishPostResult> {
  return apiFetch(`/api/locations/${id}/posts/${postId}/publish`, {
    method: "POST",
    schema: z.object({ status: z.enum(["awaiting_approval", "published"]), postId: z.string().optional(), googlePostName: z.string().nullable().optional() }),
  })
}

export function decidePostApproval(id: string, postId: string, decision: "approve" | "reject") {
  return apiFetch(`/api/locations/${id}/posts/${postId}/approval`, {
    method: "POST",
    body: { decision },
    schema: z.object({ status: z.string(), postId: z.string().optional(), googlePostName: z.string().nullable().optional() }),
  })
}

export function deletePost(id: string, postId: string) {
  return apiFetch(`/api/locations/${id}/posts/${postId}`, {
    method: "DELETE",
    schema: z.object({ status: z.string() }),
  })
}
```

- [ ] **Step 7: Query keys — extend `lib/queries/keys.ts`**

Add these entries to the `queryKeys` object (keep the existing ones, including `locations: ["locations"]`):

```ts
  locationsManagement: ["locations", "management"] as const,
  locationCapabilities: (id: string) => ["location-capabilities", id] as const,
  locationProfile: (id: string) => ["locations", id, "profile"] as const,
  locationHours: (id: string) => ["locations", id, "hours"] as const,
  locationMedia: (id: string) => ["locations", id, "media"] as const,
  locationBooking: (id: string) => ["locations", id, "booking"] as const,
  locationMenu: (id: string) => ["locations", id, "menu"] as const,
  locationPosts: (id: string) => ["locations", id, "posts"] as const,
```

- [ ] **Step 8: Query hooks — `lib/queries/`**

`lib/queries/use-locations.ts` (role-aware directory; owner/admin get the management shape, others the plain list — both projected to one `DirectoryEntry`):

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocations, fetchManagementLocations } from "@/lib/api/locations"
import { queryKeys } from "./keys"

export type DirectoryEntry = {
  id: string
  name: string
  address?: unknown
  verified?: boolean
  linked?: boolean
  timezone?: string
}

// `role` is passed from the server page's getSession(); it may be null under
// dev/test anonymous bootstrap, in which case we serve the plain list everyone
// can read (member/viewer never see the management columns). Always enabled.
export function useLocationDirectory(role: string | null | undefined) {
  const management = role === "owner" || role === "admin"
  return useQuery({
    queryKey: management ? queryKeys.locationsManagement : queryKeys.locations,
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (management) {
        const { locations } = await fetchManagementLocations()
        return locations.map((l) => ({
          id: l.locationId,
          name: l.name,
          address: l.address,
          verified: Boolean(l.verified),
          linked: Boolean(l.linkId),
          timezone: l.timezone,
        }))
      }
      const { locations } = await fetchLocations()
      return locations.map((l) => ({ id: l.id, name: l.name }))
    },
    staleTime: 30_000,
  })
}
```

`lib/queries/use-location-capabilities.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocationCapabilities } from "@/lib/api/locations"
import { queryKeys } from "./keys"

export function useLocationCapabilities(id: string) {
  return useQuery({
    queryKey: queryKeys.locationCapabilities(id),
    queryFn: () => fetchLocationCapabilities(id),
    staleTime: 30_000,
  })
}
```

The six per-tab read hooks follow one shape. Create each file with its client + key:

`lib/queries/use-location-profile.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchProfile } from "@/lib/api/location-profile"
import { queryKeys } from "./keys"

export function useProfile(id: string) {
  return useQuery({ queryKey: queryKeys.locationProfile(id), queryFn: () => fetchProfile(id), staleTime: 30_000 })
}
```

`lib/queries/use-location-hours.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchHours } from "@/lib/api/location-hours"
import { queryKeys } from "./keys"

export function useHours(id: string) {
  return useQuery({ queryKey: queryKeys.locationHours(id), queryFn: () => fetchHours(id), staleTime: 30_000 })
}
```

`lib/queries/use-location-media.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMedia } from "@/lib/api/location-media"
import { queryKeys } from "./keys"

export function useMedia(id: string) {
  return useQuery({ queryKey: queryKeys.locationMedia(id), queryFn: () => fetchMedia(id), staleTime: 30_000 })
}
```

`lib/queries/use-location-booking.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPlaceActions } from "@/lib/api/location-booking"
import { queryKeys } from "./keys"

export function usePlaceActions(id: string) {
  return useQuery({ queryKey: queryKeys.locationBooking(id), queryFn: () => fetchPlaceActions(id), staleTime: 30_000 })
}
```

`lib/queries/use-location-menu.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchFoodMenus } from "@/lib/api/location-menu"
import { queryKeys } from "./keys"

export function useFoodMenus(id: string) {
  return useQuery({ queryKey: queryKeys.locationMenu(id), queryFn: () => fetchFoodMenus(id), staleTime: 30_000 })
}
```

`lib/queries/use-location-posts.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPosts } from "@/lib/api/location-posts"
import { queryKeys } from "./keys"

export function usePosts(id: string) {
  return useQuery({ queryKey: queryKeys.locationPosts(id), queryFn: () => fetchPosts(id), staleTime: 30_000 })
}
```

- [ ] **Step 9: Run to verify pass**

Run: `pnpm exec vitest run tests/components/location-forms.test.ts tests/components/location-action-errors.test.ts tests/components/location-api.test.tsx --project components`
Expected: PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 10: Commit**

```bash
git add lib/api/locations.ts lib/api/location-*.ts lib/locations/ lib/queries/keys.ts lib/queries/use-locations.ts lib/queries/use-location-*.ts tests/components/location-api.test.tsx tests/components/location-forms.test.ts tests/components/location-action-errors.test.ts
git commit -m "feat(locations): typed tab clients, client-safe form schemas, query hooks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Locations index route + `Table` primitive

**Files:**
- Create: `components/ui/table.tsx`, `app/(dashboard)/locations/page.tsx`, `app/(dashboard)/locations/loading.tsx`, `components/locations/locations-index.tsx`
- Test: `tests/components/locations-index.test.tsx`

**Interfaces:**
- Consumes: `useLocationDirectory` (Task 2), `PageFrame`/`PageHeader` (`@/components/app-shell/page-frame`), `getSession` (`@/lib/server/session`), `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` (this task), `Badge`/`Skeleton`/`Button`/`Empty` (existing).
- Produces: `LocationsIndex` (props `{ role: string | null }`); primitives `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`.

- [ ] **Step 1: Admit the `Table` primitive**

`components/ui/table.tsx` (styled native table; `TableHead` is a real `<th scope="col">`, keeping semantics for axe):

```tsx
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-ui", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_th]:border-b [&_th]:border-border", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn("h-10 px-3 text-left align-middle text-caption font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-3 py-2.5 align-middle", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
```

- [ ] **Step 2: Write the failing component test**

`tests/components/locations-index.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationsIndex } from "@/components/locations/locations-index"
import * as locationsApi from "@/lib/api/locations"

function renderIndex(role: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationsIndex role={role} />
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe("LocationsIndex", () => {
  it("renders management columns for an owner", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({
      locations: [
        { locationId: "loc-1", name: "Riverside", address: { locality: "Bath" }, timezone: "Europe/London", linkId: "ll-1", externalLocationId: "e-1", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true },
      ],
    })
    renderIndex("owner")
    expect(await screen.findByRole("columnheader", { name: "Location" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Address" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument()
    const link = await screen.findByRole("link", { name: "Riverside" })
    expect(link).toHaveAttribute("href", "/locations/loc-1")
    expect(screen.getByText("Bath")).toBeInTheDocument()
    expect(screen.getByText("Linked")).toBeInTheDocument()
  })

  it("renders a plain single-column list for a member and no management columns", async () => {
    vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({ locations: [{ id: "loc-9", name: "Old Town" }] })
    renderIndex("member")
    expect(await screen.findByRole("link", { name: "Old Town" })).toHaveAttribute("href", "/locations/loc-9")
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument()
  })

  it("shows an empty state when there are no locations", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({ locations: [] })
    renderIndex("owner")
    expect(await screen.findByText("No locations yet")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/components/locations-index.test.tsx --project components`
Expected: FAIL — `LocationsIndex` does not exist.

- [ ] **Step 4: Implement the index component**

`components/locations/locations-index.tsx`:

```tsx
"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLocationDirectory } from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "—"
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines) ? (record.addressLines as unknown[]).filter((x) => typeof x === "string") : []
  const parts = [...lines, record.locality, record.administrativeArea, record.postalCode].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  )
  return parts.length ? parts.join(", ") : "—"
}

export function LocationsIndex({ role }: { role: string | null }) {
  const management = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)

  if (directory.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  if (directory.isError) {
    return (
      <Empty
        title="We couldn’t load your locations"
        description="Something went wrong reaching the server."
        action={<Button variant="outline" onClick={() => directory.refetch()}>Try again</Button>}
      />
    )
  }
  const locations = directory.data ?? []
  if (locations.length === 0) {
    return (
      <Empty
        title="No locations yet"
        description="Connect Google Business Profile and import your locations to manage them here."
      />
    )
  }

  if (!management) {
    return (
      <Table className="min-w-[360px]">
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.map((location) => (
            <TableRow key={location.id}>
              <TableCell className="font-medium">
                <Link href={`/locations/${location.id}`} className="underline-offset-4 hover:underline">
                  {location.name}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {locations.map((location) => (
          <TableRow key={location.id}>
            <TableCell className="font-medium">
              <Link href={`/locations/${location.id}`} className="underline-offset-4 hover:underline">
                {location.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatAddress(location.address)}</TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-1.5">
                {location.linked ? <Badge variant="secondary">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
                {location.verified ? <Badge variant="success">Verified</Badge> : null}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 5: Implement the route + loading**

`app/(dashboard)/locations/page.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { LocationsIndex } from "@/components/locations/locations-index"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Locations · NabaPresence" }

export default async function LocationsPage() {
  const session = await getSession()
  return (
    <PageFrame width="wide">
      <PageHeader title="Locations" description="Every location in this organisation and the state of its Google link." />
      <LocationsIndex role={session?.role ?? null} />
    </PageFrame>
  )
}
```

`app/(dashboard)/locations/loading.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"

export default function LocationsLoading() {
  return (
    <PageFrame width="wide">
      <PageHeader title="Locations" description="Every location in this organisation and the state of its Google link." />
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </PageFrame>
  )
}
```

- [ ] **Step 6: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/locations-index.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/locations` compiles).

- [ ] **Step 7: Commit**

```bash
git add components/ui/table.tsx "app/(dashboard)/locations/page.tsx" "app/(dashboard)/locations/loading.tsx" components/locations/locations-index.tsx tests/components/locations-index.test.tsx
git commit -m "feat(locations): role-aware index route + Table primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Workspace shell + tab nav + gating note + nav prefetch

**Files:**
- Create: `app/(dashboard)/locations/[id]/layout.tsx`, `app/(dashboard)/locations/[id]/loading.tsx`, `components/locations/location-workspace.tsx`, `components/locations/location-tab-nav.tsx`, `components/locations/publish-gate.tsx`
- Modify: `components/app-shell/nav.tsx` (`/locations` → `prefetch: true`)
- Test: `tests/components/location-tab-nav.test.tsx`, `tests/components/location-workspace.test.tsx`

**Interfaces:**
- Consumes: `useLocationDirectory` (Task 2), `getSession` (`@/lib/server/session`), `notFound`/`usePathname` (`next/navigation`), `PageFrame`/`PageHeader`, `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxItem` (existing), `Badge`/`Skeleton` (existing).
- Produces (Tasks 5–10 consume): `LocationWorkspace` (props `{ locationId, role, children }`); `LocationTabNav` (props `{ locationId }`); `GateNote` (props `{ reason: string | null }`); the shell renders the single `<h1>` (location name) so every tab page renders only `<h2>` and below; the tab route segments are `""` (profile) `/hours` `/photos` `/posts` `/booking` `/menu`.

- [ ] **Step 1: Write the failing tests**

`tests/components/location-tab-nav.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1/hours" }))

describe("LocationTabNav", () => {
  it("renders the six wave-1 tabs and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" />)
    const nav = screen.getByRole("navigation", { name: "Location sections" })
    for (const label of ["Profile", "Hours", "Photos", "Posts", "Booking", "Menu"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Hours" })).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
    // No deferred tabs leak into wave 1.
    for (const gone of ["Business info", "Industry", "Administration", "Reviews", "Performance"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
```

`tests/components/location-workspace.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationWorkspace } from "@/components/locations/location-workspace"
import * as locationsApi from "@/lib/api/locations"

const notFound = vi.fn()
vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1", notFound: () => notFound() }))

function renderWorkspace(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationWorkspace locationId="loc-1" role={role}>
        <p>tab body</p>
      </LocationWorkspace>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  notFound.mockReset()
})

describe("LocationWorkspace", () => {
  it("renders the location name as the h1 and the tab body", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({
      locations: [{ locationId: "loc-1", name: "Riverside", address: null, timezone: "Europe/London", linkId: "ll", externalLocationId: "e", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true }],
    })
    renderWorkspace("owner")
    expect(await screen.findByRole("heading", { level: 1, name: "Riverside" })).toBeInTheDocument()
    expect(screen.getByText("tab body")).toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("calls notFound() when the id is absent from the directory", async () => {
    vi.spyOn(locationsApi, "fetchManagementLocations").mockResolvedValue({ locations: [] })
    renderWorkspace("owner")
    await screen.findByText("tab body") // wait for the query to settle
    expect(notFound).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/location-tab-nav.test.tsx tests/components/location-workspace.test.tsx --project components`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement the tab nav**

`components/locations/location-tab-nav.tsx` (scroll affordance via `overflow-x-auto` + `min-w-max`; active-tab `scrollIntoView` on change):

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
] as const

export function LocationTabNav({ locationId }: { locationId: string }) {
  const pathname = usePathname()
  const base = `/locations/${locationId}`
  const activeSegment = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : ""
  const activeRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [activeSegment])

  return (
    <nav aria-label="Location sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base
          const isActive = activeSegment === tab.segment
          return (
            <li key={tab.label}>
              <Link
                ref={isActive ? activeRef : undefined}
                href={href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-ui font-medium transition-colors duration-(--nr-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 4: Implement the gating note**

`components/locations/publish-gate.tsx`:

```tsx
export function GateNote({ reason }: { reason: string | null }) {
  if (!reason) return null
  return (
    <p role="note" className="text-caption text-muted-foreground">
      {reason}
    </p>
  )
}
```

- [ ] **Step 5: Implement the workspace shell**

`components/locations/location-workspace.tsx`:

```tsx
"use client"

import { notFound, usePathname, useRouter } from "next/navigation"

import { LocationTabNav } from "@/components/locations/location-tab-nav"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Badge } from "@/components/ui/badge"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocationDirectory, type DirectoryEntry } from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines) ? (record.addressLines as unknown[]).filter((x) => typeof x === "string") : []
  const parts = [...lines, record.locality, record.administrativeArea, record.postalCode].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  )
  return parts.length ? parts.join(", ") : null
}

export function LocationWorkspace({
  locationId,
  role,
  children,
}: {
  locationId: string
  role: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const directory = useLocationDirectory(role)
  const current = directory.data?.find((entry) => entry.id === locationId)

  // Unknown id -> notFound (after the directory resolves; D2/D3).
  if (directory.data && !current) {
    notFound()
  }

  const base = `/locations/${locationId}`
  const activeSuffix = pathname.startsWith(base) ? pathname.slice(base.length) : ""
  const address = current ? formatAddress(current.address) : null

  return (
    <PageFrame width="workspace">
      {directory.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <PageHeader
          title={current?.name ?? "Location"}
          description={
            <span className="flex flex-col gap-1.5">
              {address ? <span className="text-ui text-muted-foreground">{address}</span> : null}
              <span className="flex flex-wrap gap-1.5">
                {current?.linked === false ? <Badge variant="outline">Not linked</Badge> : null}
                {current?.linked ? <Badge variant="secondary">Linked</Badge> : null}
                {current?.verified ? <Badge variant="success">Verified</Badge> : null}
              </span>
            </span>
          }
        />
      )}

      {directory.data && directory.data.length > 1 ? (
        <Combobox
          items={directory.data}
          itemToStringValue={(entry: DirectoryEntry) => entry.name}
          value={current ?? null}
          onValueChange={(next: DirectoryEntry | null) => {
            if (next) router.push(`/locations/${next.id}${activeSuffix}`)
          }}
        >
          <ComboboxInput placeholder="Switch location" aria-label="Switch location" className="max-w-sm" />
          <ComboboxContent>
            {(entry: DirectoryEntry) => (
              <ComboboxItem key={entry.id} value={entry}>
                {entry.name}
              </ComboboxItem>
            )}
          </ComboboxContent>
        </Combobox>
      ) : null}

      <LocationTabNav locationId={locationId} />
      {children}
    </PageFrame>
  )
}
```

- [ ] **Step 6: Implement the layout + loading**

`app/(dashboard)/locations/[id]/layout.tsx`:

```tsx
import { LocationWorkspace } from "@/components/locations/location-workspace"
import { getSession } from "@/lib/server/session"

export default async function LocationLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = await params
  const session = await getSession()
  return (
    <LocationWorkspace locationId={id} role={session?.role ?? null}>
      {children}
    </LocationWorkspace>
  )
}
```

`app/(dashboard)/locations/[id]/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function LocationTabLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
```

- [ ] **Step 7: Flip the nav prefetch (D9)**

In `components/app-shell/nav.tsx`, change the `/locations` item to `prefetch: true` and update the comment so it no longer lists `/locations` among the 404-until-milestone routes:

```tsx
  { href: "/locations", label: "Locations", icon: Store, prefetch: true },
```

Adjust the explanatory comment above the `<Link>` to read "`/home`, `/inbox` and `/locations` ship and are prefetched. The other two routes 404 until their milestones land …".

- [ ] **Step 8: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/location-tab-nav.test.tsx tests/components/location-workspace.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (the `[id]` route group compiles even though tab pages land in later tasks — add a temporary `app/(dashboard)/locations/[id]/page.tsx` stub ONLY if the build requires a leaf; it is provided for real in Task 5, so land Task 4 and Task 5 together if the build needs the profile leaf).

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/locations/[id]/layout.tsx" "app/(dashboard)/locations/[id]/loading.tsx" components/locations/location-workspace.tsx components/locations/location-tab-nav.tsx components/locations/publish-gate.tsx components/app-shell/nav.tsx tests/components/location-tab-nav.test.tsx tests/components/location-workspace.test.tsx
git commit -m "feat(locations): workspace shell, tab nav, gating note; prefetch /locations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Profile tab + shared canonical-diff / overwrite-confirm / `Checkbox`

> **Interaction pattern (a): canonical-vs-Google diff + revision/hash-pinned publish + overwrite-confirm.** This task builds the shared blocks (`CanonicalDiff`, `OverwriteConfirmDialog`, `Checkbox`, `tab-states`) that Hours (Task 6) and Menu (Task 9) reuse. **Profile gating nuance:** the profile POST (publish AND import) is route-gated `requireRole(["owner","admin"])`, so profile publish/import gate on `canEditCanonical` (owner/admin), unlike hours/menu which gate publish on `canPublish`. Canonical save (PUT) works with `googleWritesEnabled` off; only publish requires it.

**Files:**
- Create: `components/ui/checkbox.tsx`, `components/locations/canonical-diff.tsx`, `components/locations/overwrite-confirm-dialog.tsx`, `components/locations/tab-states.tsx`, `components/locations/profile-tab.tsx`, `app/(dashboard)/locations/[id]/page.tsx`
- Test: `tests/components/profile-tab.test.tsx`

**Interfaces:**
- Consumes: `useProfile` (Task 2), `useLocationCapabilities` (Task 2), `saveProfile`/`runProfileOperation`/`type ProfileState`/`type ProfileFieldKey` (Task 2), `profileFormSchema`/`toProfileValues` (Task 2), `editDisabledReason` (Task 2), `describeActionError`/`isNotLinkedError` (Task 2), `useDirtyGuard` (`@/lib/hooks/use-dirty-guard`), `useMutation`/`useQueryClient` (`@tanstack/react-query`), `useToastManager` (`@/components/ui/toast`), `Field`/`FieldError`/`FieldLabel`/`Input`/`Textarea`/`Button`/`GateNote` (existing/Task 4).
- Produces (Tasks 6, 9 consume): `Checkbox`; `CanonicalDiff` (props `{ rows: Array<{ key, label, canonicalValue, googleValue, status: DiffStatus }> }`), `type DiffStatus`, `statusBadge`; `OverwriteConfirmDialog` (props `{ open, onOpenChange, title, description, confirmLabel, requireAcknowledgement, acknowledgementLabel?, pending, onConfirm }`); `TabLoading`, `TabError` (props `{ error, onRetry }`).

- [ ] **Step 1: Admit the `Checkbox` primitive**

`components/ui/checkbox.tsx`:

```tsx
"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border bg-card transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <CheckIcon className="size-3" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
```

- [ ] **Step 2: Shared canonical-diff, overwrite-confirm, tab-states**

`components/locations/canonical-diff.tsx`:

```tsx
"use client"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type DiffStatus = "in_sync" | "core_dirty" | "google_dirty" | "conflict"

const STATUS: Record<DiffStatus, { label: string; variant: "secondary" | "warning" | "info" }> = {
  in_sync: { label: "In sync", variant: "secondary" },
  core_dirty: { label: "Edited here", variant: "info" },
  google_dirty: { label: "Changed on Google", variant: "warning" },
  conflict: { label: "Conflict", variant: "warning" },
}

export function statusBadge(status: DiffStatus) {
  const entry = STATUS[status]
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export function CanonicalDiff({
  rows,
}: {
  rows: Array<{ key: string; label: string; canonicalValue: string | null; googleValue: string | null; status: DiffStatus }>
}) {
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>NabaPresence</TableHead>
          <TableHead>Google</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-muted-foreground">{row.canonicalValue ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{row.googleValue ?? "—"}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

`components/locations/overwrite-confirm-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

export function OverwriteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  requireAcknowledgement,
  acknowledgementLabel,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  requireAcknowledgement: boolean
  acknowledgementLabel?: string
  pending: boolean
  onConfirm: () => void
}) {
  const [ack, setAck] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setAck(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {requireAcknowledgement ? (
          <label className="flex items-start gap-2 text-ui">
            <Checkbox checked={ack} onCheckedChange={(value) => setAck(value === true)} aria-label={acknowledgementLabel} />
            <span>{acknowledgementLabel}</span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={onConfirm} disabled={pending || (requireAcknowledgement && !ack)}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

`components/locations/tab-states.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { describeActionError, isNotLinkedError } from "@/lib/locations/action-errors"

export function TabLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function TabError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isNotLinkedError(error)) {
    return (
      <Empty
        title="This location isn’t linked to Google yet"
        description="Link it to Google Business Profile to manage its details, hours, photos and more here."
      />
    )
  }
  return (
    <Empty
      title="We couldn’t load this section"
      description={describeActionError(error)}
      action={
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
```

- [ ] **Step 3: Write the failing test**

`tests/components/profile-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProfileTab } from "@/components/locations/profile-tab"
import { Toaster } from "@/components/ui/toast"
import type { ProfileState } from "@/lib/api/location-profile"

const useProfileMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-profile", () => ({ useProfile: () => useProfileMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeProfile(overrides: Partial<ProfileState> = {}): ProfileState {
  const field = (key: string, status: ProfileState["fields"][number]["status"], canonicalValue: string | null, googleValue: string | null) => ({
    key: key as ProfileState["fields"][number]["key"],
    policy: "bidirectional" as const,
    status,
    canonicalValue,
    googleValue,
    canonicalHash: "c",
    googleHash: "g",
    lastReconciledAt: null,
  })
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1" },
    canonicalResource: { revision: "3", updatedAt: "2026-08-01T00:00:00.000Z" },
    canonicalHash: "ch",
    googleHash: "gh",
    canPublish: true,
    googleWritesEnabled: true,
    fields: [
      field("name", "core_dirty", "Riverside Rooms", "Riverside"),
      field("description", "in_sync", "A calm stay", "A calm stay"),
      field("phone", "in_sync", "+44 20 7946 0000", "+44 20 7946 0000"),
      field("website", "in_sync", "https://riverside.test", "https://riverside.test"),
      { ...field("address", "in_sync", "1 River Rd", "1 River Rd"), policy: "import_only" },
      { ...field("mapsUrl", "in_sync", null, null), policy: "import_only" },
      { ...field("reviewUrl", "in_sync", null, null), policy: "import_only" },
    ],
    googleDetails: { primaryCategory: "Hotel", additionalCategories: [] },
    latestAttempt: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ProfileTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ProfileTab", () => {
  it("renders the field diff and enables save once an owner edits a field", () => {
    useProfileMock.mockReturnValue({ data: makeProfile(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("columnheader", { name: "Google" })).toBeInTheDocument()
    // name is core_dirty in the fixture -> the diff shows the "Edited here" chip.
    expect(screen.getByText("Edited here")).toBeInTheDocument()
    const name = screen.getByRole("textbox", { name: "Business name" })
    expect(name).toHaveValue("Riverside Rooms")
    // Clean form -> save is disabled; editing makes it dirty -> enabled.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    fireEvent.change(name, { target: { value: "Riverside Rooms & Spa" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.queryByText("Only owners and admins can edit this location.")).not.toBeInTheDocument()
  })

  it("disables save and publish with reasons for a viewer and disables the inputs", () => {
    useProfileMock.mockReturnValue({ data: makeProfile(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("textbox", { name: "Business name" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Only owners and admins can edit this location.")).toBeInTheDocument()
  })

  it("keeps canonical save available but publish disabled when Google writes are unavailable", () => {
    useProfileMock.mockReturnValue({ data: makeProfile({ googleWritesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    // Editing is still allowed with Google writes off (canonical save works).
    fireEvent.change(screen.getByRole("textbox", { name: "Business name" }), { target: { value: "Riverside Rooms & Spa" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Publishing to Google is currently unavailable.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm exec vitest run tests/components/profile-tab.test.tsx --project components`
Expected: FAIL — `ProfileTab` does not exist.

- [ ] **Step 5: Implement the profile tab**

`components/locations/profile-tab.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { CanonicalDiff, type DiffStatus } from "@/components/locations/canonical-diff"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  runProfileOperation,
  saveProfile,
  type ProfileFieldKey,
  type ProfileState,
} from "@/lib/api/location-profile"
import { describeActionError } from "@/lib/locations/action-errors"
import { profileFormSchema, toProfileValues, type ProfileFormValues } from "@/lib/locations/forms/profile"
import { editDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useProfile } from "@/lib/queries/use-location-profile"

const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Google Maps link",
  reviewUrl: "Review link",
  website: "Website",
}
const EDITABLE: ProfileFieldKey[] = ["name", "description", "phone", "website"]

export function ProfileTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const profileQuery = useProfile(locationId)
  const capsQuery = useLocationCapabilities(locationId)
  const caps = capsQuery.data

  if (profileQuery.isPending) return <TabLoading />
  if (profileQuery.isError) return <TabError error={profileQuery.error} onRetry={() => profileQuery.refetch()} />

  return (
    <ProfileTabLoaded
      locationId={locationId}
      profile={profileQuery.data}
      caps={caps}
      invalidate={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.locationProfile(locationId) })
      }}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function ProfileTabLoaded({
  locationId,
  profile,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  profile: ProfileState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const byKey = useMemo(() => new Map(profile.fields.map((f) => [f.key, f])), [profile.fields])
  const initial: ProfileFormValues = useMemo(
    () => ({
      name: byKey.get("name")?.canonicalValue ?? "",
      description: byKey.get("description")?.canonicalValue ?? "",
      phone: byKey.get("phone")?.canonicalValue ?? "",
      website: byKey.get("website")?.canonicalValue ?? "",
    }),
    [byKey]
  )
  const [values, setValues] = useState<ProfileFormValues>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFormValues, string>>>({})
  const revision = profile.canonicalResource.revision
  useEffect(() => setValues(initial), [initial, revision])

  const isDirty = JSON.stringify(values) !== JSON.stringify(initial)
  useDirtyGuard({ key: `location-profile-${locationId}`, isDirty, snapshot: () => JSON.stringify(values) })

  const [publishOpen, setPublishOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Derived before the mutations that close over them (no use-before-define).
  const driftedEditable = profile.fields.filter((f) => EDITABLE.includes(f.key) && f.status !== "in_sync")
  const publishFields = driftedEditable.map((f) => f.key)
  const importFields = driftedEditable.map((f) => f.key)
  const publishNeedsAck = driftedEditable.some((f) => f.status === "google_dirty" || f.status === "conflict")
  const importNeedsAck = driftedEditable.some((f) => f.status === "core_dirty" || f.status === "conflict")

  const save = useMutation({
    mutationFn: (input: { expectedCanonicalRevision: string; values: ReturnType<typeof toProfileValues> }) => saveProfile(locationId, input),
    onSuccess: () => {
      invalidate()
      toast("Profile saved", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const publish = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      runProfileOperation(locationId, {
        direction: "to_google",
        confirmation: "publish_nabapresence_profile_to_google",
        selectedFields: publishFields,
        expectedCanonicalRevision: revision,
        expectedCanonicalHash: profile.canonicalHash,
        expectedGoogleHash: profile.googleHash,
        confirmOverwriteGoogleChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      invalidate()
      toast("Profile published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const importOp = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      runProfileOperation(locationId, {
        direction: "from_google",
        confirmation: "import_google_profile_to_nabapresence",
        selectedFields: importFields,
        expectedCanonicalRevision: revision,
        expectedCanonicalHash: profile.canonicalHash,
        expectedGoogleHash: profile.googleHash,
        confirmOverwriteCanonicalChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setImportOpen(false)
      invalidate()
      toast("Imported details from Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  function submit() {
    const parsed = profileFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: Partial<Record<keyof ProfileFormValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string") next[key as keyof ProfileFormValues] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    save.mutate({ expectedCanonicalRevision: revision, values: toProfileValues(parsed.data) })
  }

  const editReason = editDisabledReason(caps)
  // Profile publish/import are owner/admin-gated at the route, so they use the
  // edit gate rather than the publish gate; publish also needs Google writes on.
  const publishReason = editReason ?? (!profile.googleWritesEnabled ? "Publishing to Google is currently unavailable." : publishFields.length === 0 ? "Everything is already in sync with Google." : null)
  const importReason = editReason ?? (importFields.length === 0 ? "There are no Google changes to import." : null)

  const diffRows = profile.fields.map((f) => ({
    key: f.key,
    label: FIELD_LABELS[f.key],
    canonicalValue: f.canonicalValue,
    googleValue: f.googleValue,
    status: f.status as DiffStatus,
  }))

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">NabaPresence vs Google</h2>
        <CanonicalDiff rows={diffRows} />
      </section>

      <section className="flex max-w-xl flex-col gap-4">
        <h2 className="text-title font-semibold">Edit details</h2>
        <Field name="name">
          <FieldLabel>Business name</FieldLabel>
          <Input value={values.name} onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))} disabled={Boolean(editReason)} />
          {errors.name ? <FieldError>{errors.name}</FieldError> : null}
        </Field>
        <Field name="description">
          <FieldLabel>Description</FieldLabel>
          <Textarea value={values.description} onChange={(event) => setValues((v) => ({ ...v, description: event.target.value }))} disabled={Boolean(editReason)} rows={4} />
          {errors.description ? <FieldError>{errors.description}</FieldError> : null}
        </Field>
        <Field name="phone">
          <FieldLabel>Phone</FieldLabel>
          <Input value={values.phone} onChange={(event) => setValues((v) => ({ ...v, phone: event.target.value }))} disabled={Boolean(editReason)} />
          {errors.phone ? <FieldError>{errors.phone}</FieldError> : null}
        </Field>
        <Field name="website">
          <FieldLabel>Website</FieldLabel>
          <Input value={values.website} onChange={(event) => setValues((v) => ({ ...v, website: event.target.value }))} disabled={Boolean(editReason)} inputMode="url" />
          {errors.website ? <FieldError>{errors.website}</FieldError> : null}
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={Boolean(editReason) || !isDirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <GateNote reason={editReason} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Sync with Google</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setPublishOpen(true)} disabled={Boolean(publishReason) || publish.isPending}>
            Publish to Google
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={Boolean(importReason) || importOp.isPending}>
            Import from Google
          </Button>
        </div>
        <GateNote reason={publishReason} />
      </section>

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish these details to Google?"
        description={`This updates ${publishFields.map((k) => FIELD_LABELS[k]).join(", ")} on your Google Business Profile.`}
        confirmLabel="Publish"
        requireAcknowledgement={publishNeedsAck}
        acknowledgementLabel="Google changed some of these fields independently. Overwrite them with your NabaPresence details."
        pending={publish.isPending}
        onConfirm={() => publish.mutate(publishNeedsAck)}
      />
      <OverwriteConfirmDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import these details from Google?"
        description={`This replaces ${importFields.map((k) => FIELD_LABELS[k]).join(", ")} in NabaPresence with the values from Google.`}
        confirmLabel="Import"
        requireAcknowledgement={importNeedsAck}
        acknowledgementLabel="You have unsaved NabaPresence changes to some of these fields. Overwrite them with Google’s values."
        pending={importOp.isPending}
        onConfirm={() => importOp.mutate(importNeedsAck)}
      />
    </div>
  )
}
```

- [ ] **Step 6: Implement the profile page**

`app/(dashboard)/locations/[id]/page.tsx`:

```tsx
import { ProfileTab } from "@/components/locations/profile-tab"

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProfileTab locationId={id} />
}
```

- [ ] **Step 7: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/profile-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/locations/[id]` renders the profile leaf).

- [ ] **Step 8: Commit**

```bash
git add components/ui/checkbox.tsx components/locations/canonical-diff.tsx components/locations/overwrite-confirm-dialog.tsx components/locations/tab-states.tsx components/locations/profile-tab.tsx "app/(dashboard)/locations/[id]/page.tsx" tests/components/profile-tab.test.tsx
git commit -m "feat(locations): profile tab with canonical diff, save, publish/import

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Hours tab (nested weekly editor + publish)

> **Interaction pattern (a).** Reuses `OverwriteConfirmDialog`, `TabLoading`/`TabError`, `GateNote`. **Hours gating nuance:** the hours POST (publish) is `requireSession()` + a service `canPublishLocation` check, so hours publish gates on `canPublish` (a member with publish rights can publish hours); canonical save (PUT) is owner/admin. `moreHours` (kitchen hours) is preserved unchanged from the loaded canonical in wave 1 (not edited in the UI); the editor covers regular + special hours. If this task is too large for one pass, land the read/summary/publish view (Steps 3a–5a) as commit A and the editor + save (Steps 3b–5b) as commit B.

**Files:**
- Create: `components/locations/hours-editor.tsx`, `components/locations/hours-tab.tsx`, `app/(dashboard)/locations/[id]/hours/page.tsx`
- Test: `tests/components/hours-tab.test.tsx`

**Interfaces:**
- Consumes: `useHours` (Task 2), `useLocationCapabilities` (Task 2), `fetchHours`/`saveHours`/`publishHours`/`type HoursState`/`type NormalizedHours` (Task 2), `hoursFormSchema`/`emptyHours`/`DAY_LABELS` (Task 2), `publishDisabledReason`/`editDisabledReason` (Task 2), `describeActionError` (Task 2), `useDirtyGuard`, `OverwriteConfirmDialog`/`TabError`/`TabLoading`/`GateNote` (Task 4/5), `Checkbox`/`Input`/`Button`/`Alert`/`Badge`.
- Produces: `HoursEditor` (props `{ value: NormalizedHours; onChange: (next: NormalizedHours) => void; disabled: boolean }`), `HoursTab` (props `{ locationId }`).

- [ ] **Step 1: Write the failing test**

`tests/components/hours-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HoursTab } from "@/components/locations/hours-tab"
import { Toaster } from "@/components/ui/toast"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { HoursState } from "@/lib/api/location-hours"

const useHoursMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-hours", () => ({ useHours: () => useHoursMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeHours(overrides: Partial<HoursState> = {}): HoursState {
  const canonical = emptyHours()
  canonical.regular[1] = { dayOfWeek: 1, isClosed: false, periods: [{ opensAt: "09:00", closesAt: "17:00" }] }
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1", timezone: "Europe/London" },
    canonicalResource: { revision: "2", updatedAt: "2026-08-01T00:00:00.000Z" },
    status: "core_dirty",
    canonical,
    google: emptyHours(),
    canonicalHash: "ch",
    googleHash: "gh",
    updateMask: ["regularHours"],
    warnings: [],
    canPublish: true,
    writesEnabled: true,
    lastReconciledAt: null,
    latestAttempt: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <HoursTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("HoursTab", () => {
  it("renders each weekday and Monday's open time for an owner", () => {
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Monday")).toBeInTheDocument()
    expect(screen.getByText("Sunday")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("disables editing for a viewer and publish when writes are off", () => {
    useHoursMock.mockReturnValue({ data: makeHours({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Only owners and admins can edit this location.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/hours-tab.test.tsx --project components`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement the hours editor**

`components/locations/hours-editor.tsx` (regular + special editors; `moreHours` untouched, held by the parent):

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"

export function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: NormalizedHours
  onChange: (next: NormalizedHours) => void
  disabled: boolean
}) {
  function setRegular(index: number, day: NormalizedHours["regular"][number]) {
    const regular = value.regular.map((d, i) => (i === index ? day : d))
    onChange({ ...value, regular })
  }
  function setSpecial(next: NormalizedHours["special"]) {
    onChange({ ...value, special: next })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-ui font-semibold">Regular hours</h3>
        <ul className="flex flex-col gap-2">
          {value.regular.map((day, index) => (
            <li key={day.dayOfWeek} className="flex flex-wrap items-center gap-3 rounded-(--nr-radius-control) border border-border p-3">
              <span className="w-24 font-medium">{DAY_LABELS[day.dayOfWeek]}</span>
              <label className="flex items-center gap-2 text-ui">
                <Checkbox
                  checked={day.isClosed}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setRegular(index, checked === true ? { ...day, isClosed: true, periods: [] } : { ...day, isClosed: false, periods: [{ opensAt: "09:00", closesAt: "17:00" }] })
                  }
                  aria-label={`${DAY_LABELS[day.dayOfWeek]} closed`}
                />
                Closed
              </label>
              {!day.isClosed
                ? day.periods.map((period, periodIndex) => (
                    <span key={periodIndex} className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} opens`}
                        value={period.opensAt}
                        disabled={disabled}
                        onChange={(event) =>
                          setRegular(index, { ...day, periods: day.periods.map((p, pi) => (pi === periodIndex ? { ...p, opensAt: event.target.value } : p)) })
                        }
                        className="w-28"
                      />
                      <span aria-hidden>–</span>
                      <Input
                        type="time"
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} closes`}
                        value={period.closesAt}
                        disabled={disabled}
                        onChange={(event) =>
                          setRegular(index, { ...day, periods: day.periods.map((p, pi) => (pi === periodIndex ? { ...p, closesAt: event.target.value } : p)) })
                        }
                        className="w-28"
                      />
                      {!disabled ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove a period for ${DAY_LABELS[day.dayOfWeek]}`}
                          onClick={() => setRegular(index, { ...day, periods: day.periods.filter((_, pi) => pi !== periodIndex) })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </span>
                  ))
                : null}
              {!day.isClosed && !disabled && day.periods.length < 3 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRegular(index, { ...day, periods: [...day.periods, { opensAt: "09:00", closesAt: "17:00" }] })}>
                  Add hours
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-ui font-semibold">Special hours</h3>
        <ul className="flex flex-col gap-2">
          {value.special.map((entry, index) => (
            <li key={index} className="flex flex-wrap items-center gap-3 rounded-(--nr-radius-control) border border-border p-3">
              <Input
                type="date"
                aria-label={`Special date ${index + 1}`}
                value={entry.effectiveDate}
                disabled={disabled}
                onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, effectiveDate: event.target.value } : s)))}
                className="w-40"
              />
              <label className="flex items-center gap-2 text-ui">
                <Checkbox
                  checked={entry.isClosed}
                  disabled={disabled}
                  aria-label={`Special date ${index + 1} closed`}
                  onCheckedChange={(checked) =>
                    setSpecial(value.special.map((s, i) => (i === index ? (checked === true ? { ...s, isClosed: true, opensAt: null, closesAt: null } : { ...s, isClosed: false, opensAt: "09:00", closesAt: "17:00" }) : s)))
                  }
                />
                Closed
              </label>
              {!entry.isClosed ? (
                <>
                  <Input type="time" aria-label={`Special date ${index + 1} opens`} value={entry.opensAt ?? ""} disabled={disabled} onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, opensAt: event.target.value } : s)))} className="w-28" />
                  <span aria-hidden>–</span>
                  <Input type="time" aria-label={`Special date ${index + 1} closes`} value={entry.closesAt ?? ""} disabled={disabled} onChange={(event) => setSpecial(value.special.map((s, i) => (i === index ? { ...s, closesAt: event.target.value } : s)))} className="w-28" />
                </>
              ) : null}
              {!disabled ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSpecial(value.special.filter((_, i) => i !== index))}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setSpecial([...value.special, { effectiveDate: "", isClosed: true, opensAt: null, closesAt: null }])}>
            Add a special day
          </Button>
        ) : null}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Implement the hours tab**

`components/locations/hours-tab.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { HoursEditor } from "@/components/locations/hours-editor"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { publishHours, saveHours, type HoursState, type NormalizedHours } from "@/lib/api/location-hours"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { hoursFormSchema } from "@/lib/locations/forms/hours"
import { editDisabledReason, publishDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useHours } from "@/lib/queries/use-location-hours"

const STATUS_COPY: Record<HoursState["status"], string> = {
  in_sync: "In sync with Google",
  core_dirty: "You have unpublished changes",
  google_dirty: "Google changed independently",
  conflict: "Both sides changed — review before publishing",
}

export function HoursTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const hoursQuery = useHours(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (hoursQuery.isPending) return <TabLoading />
  if (hoursQuery.isError) return <TabError error={hoursQuery.error} onRetry={() => hoursQuery.refetch()} />

  const hours = hoursQuery.data
  return (
    <HoursTabLoaded
      key={hours.canonicalResource.revision}
      locationId={locationId}
      hours={hours}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationHours(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function HoursTabLoaded({
  locationId,
  hours,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  hours: HoursState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [draft, setDraft] = useState<NormalizedHours>(hours.canonical)
  useEffect(() => setDraft(hours.canonical), [hours.canonical])
  const [publishOpen, setPublishOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(hours.canonical)
  useDirtyGuard({ key: `location-hours-${locationId}`, isDirty, snapshot: () => JSON.stringify(draft) })

  const save = useMutation({
    mutationFn: () => saveHours(locationId, { expectedCanonicalRevision: hours.canonicalResource.revision, hours: draft }),
    onSuccess: () => {
      invalidate()
      toast("Opening hours saved", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const publish = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      publishHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        expectedCanonicalHash: hours.canonicalHash,
        expectedGoogleHash: hours.googleHash,
        approvedUpdateMask: hours.updateMask,
        confirmOverwriteGoogleChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      invalidate()
      toast("Opening hours published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  function submit() {
    const parsed = hoursFormSchema.safeParse(draft)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check the opening hours.")
      return
    }
    setFormError(null)
    save.mutate()
  }

  const editReason = editDisabledReason(caps)
  const needsAck = hours.status === "google_dirty" || hours.status === "conflict"
  const publishReason =
    publishDisabledReason(caps, hours.writesEnabled) ?? (hours.status === "in_sync" ? "Opening hours already match Google." : isDirty ? "Save your changes before publishing." : null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={hours.status === "in_sync" ? "secondary" : "warning"}>{STATUS_COPY[hours.status]}</Badge>
        <span className="text-caption text-muted-foreground">Times shown in {hours.location.timezone}.</span>
      </div>

      {hours.warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <HoursEditor value={draft} onChange={setDraft} disabled={Boolean(editReason)} />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={Boolean(editReason) || !isDirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" onClick={() => setPublishOpen(true)} disabled={Boolean(publishReason) || publish.isPending}>
          Publish to Google
        </Button>
      </div>
      <GateNote reason={editReason ?? publishReason} />

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish opening hours to Google?"
        description="This updates the opening hours on your Google Business Profile to match NabaPresence."
        confirmLabel="Publish"
        requireAcknowledgement={needsAck}
        acknowledgementLabel="Google changed the opening hours independently. Overwrite them with the NabaPresence schedule."
        pending={publish.isPending}
        onConfirm={() => publish.mutate(needsAck)}
      />
    </div>
  )
}
```

- [ ] **Step 5: Implement the hours page**

`app/(dashboard)/locations/[id]/hours/page.tsx`:

```tsx
import { HoursTab } from "@/components/locations/hours-tab"

export default async function HoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <HoursTab locationId={id} />
}
```

- [ ] **Step 6: Run to verify pass, then gate**

```bash
pnpm exec vitest run tests/components/hours-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green.

- [ ] **Step 7: Commit**

```bash
git add components/locations/hours-editor.tsx components/locations/hours-tab.tsx "app/(dashboard)/locations/[id]/hours/page.tsx" tests/components/hours-tab.test.tsx
git commit -m "feat(locations): hours tab with weekly editor, save and publish

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Photos tab (direct live-Google media CRUD)

> **Interaction pattern (b): direct live-Google per-item hash-pinned CRUD with confirm dialogs.** No canonical; every write is a publish gated on `canPublish` + `writesEnabled`. Merchant photos are editable (change category / delete, hash-pinned via `googleHash`); customer photos are read-only. Add supports a source URL and a direct file upload with a client-side size pre-check (≤ 75 MB), a confirm dialog, and an input reset. **The exact strings "Add media", the "Direct file upload" input label, and the "Review file upload" button are e2e contract selectors (extracted from `gbp-management-tabs.spec.ts`, D10) — keep them verbatim.**

**Files:**
- Create: `components/locations/photos-tab.tsx`, `app/(dashboard)/locations/[id]/photos/page.tsx`
- Test: `tests/components/photos-tab.test.tsx`

**Interfaces:**
- Consumes: `useMedia` (Task 2), `useLocationCapabilities` (Task 2), `fetchMedia`/`createMediaFromUrl`/`uploadMediaFile`/`updateMediaCategory`/`deleteMediaItem`/`MEDIA_CATEGORIES`/`type MediaState`/`type MediaItem`/`type MediaCategory` (Task 2), `publishDisabledReason` (Task 2), `describeActionError` (Task 2), `OverwriteConfirmDialog`/`TabError`/`TabLoading`/`GateNote`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`/`Input`/`Button`/`Badge`.
- Produces: `PhotosTab` (props `{ locationId }`); `humaniseCategory` (exported for reuse/tests).

- [ ] **Step 1: Write the failing test**

`tests/components/photos-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PhotosTab } from "@/components/locations/photos-tab"
import { Toaster } from "@/components/ui/toast"
import type { MediaState } from "@/lib/api/location-media"

const useMediaMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-media", () => ({ useMedia: () => useMediaMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeMedia(overrides: Partial<MediaState> = {}): MediaState {
  return {
    canPublish: true,
    writesEnabled: true,
    categories: ["COVER", "PROFILE", "ADDITIONAL", "INTERIOR"],
    items: [
      { id: "m1", googleMediaName: "accounts/a/locations/l/media/1", ownership: "merchant", mediaFormat: "PHOTO", category: "INTERIOR", sourceUrl: null, googleUrl: "https://g/1", thumbnailUrl: "https://g/1t", description: null, attribution: null, dimensions: null, insights: null, googleHash: "h1", createTime: "2026-07-01T00:00:00.000Z" },
      { id: "m2", googleMediaName: "accounts/a/locations/l/media/2", ownership: "customer", mediaFormat: "PHOTO", category: "ADDITIONAL", sourceUrl: null, googleUrl: "https://g/2", thumbnailUrl: "https://g/2t", description: null, attribution: null, dimensions: null, insights: null, googleHash: "h2", createTime: null },
    ],
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PhotosTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PhotosTab", () => {
  it("renders the add-media controls (e2e contract) for a publisher", () => {
    useMediaMock.mockReturnValue({ data: makeMedia(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Add media", { exact: true })).toBeInTheDocument()
    expect(screen.getByLabelText("Direct file upload")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review file upload" })).toBeDisabled()
    expect(screen.getByText("Customer photo")).toBeInTheDocument()
  })

  it("disables add controls with a reason when writes are paused", () => {
    useMediaMock.mockReturnValue({ data: makeMedia({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Add from URL" })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/photos-tab.test.tsx --project components`
Expected: FAIL — `PhotosTab` does not exist.

- [ ] **Step 3: Implement the photos tab**

`components/locations/photos-tab.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import {
  createMediaFromUrl,
  deleteMediaItem,
  uploadMediaFile,
  type MediaCategory,
  type MediaItem,
  type MediaState,
} from "@/lib/api/location-media"
import { describeActionError } from "@/lib/locations/action-errors"
import { publishDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useMedia } from "@/lib/queries/use-location-media"

const MAX_UPLOAD_BYTES = 75 * 1024 * 1024

export function humaniseCategory(category: string): string {
  const lower = category.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function PhotosTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const mediaQuery = useMedia(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (mediaQuery.isPending) return <TabLoading />
  if (mediaQuery.isError) return <TabError error={mediaQuery.error} onRetry={() => mediaQuery.refetch()} />

  return (
    <PhotosTabLoaded
      locationId={locationId}
      media={mediaQuery.data}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationMedia(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function PhotosTabLoaded({
  locationId,
  media,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  media: MediaState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState<MediaCategory>((media.categories[0] as MediaCategory) ?? "ADDITIONAL")
  const [url, setUrl] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)

  const writeReason = publishDisabledReason(caps, media.writesEnabled)
  const disabled = Boolean(writeReason)

  const addUrl = useMutation({
    mutationFn: () => createMediaFromUrl(locationId, { mediaFormat: "PHOTO", category, sourceUrl: url }),
    onSuccess: () => {
      setUrl("")
      invalidate()
      toast("Photo added", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.set("file", pendingFile as File)
      form.set("mediaFormat", "PHOTO")
      form.set("category", category)
      return uploadMediaFile(locationId, form)
    },
    onSuccess: () => {
      setUploadOpen(false)
      setPendingFile(null)
      if (fileRef.current) fileRef.current.value = ""
      invalidate()
      toast("Photo uploaded", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const remove = useMutation({
    mutationFn: (item: MediaItem) => deleteMediaItem(locationId, item.id, { expectedGoogleHash: item.googleHash }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
      toast("Photo deleted", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setSizeError("That file is too large. Uploads cannot exceed 75 MB.")
      setPendingFile(null)
      return
    }
    setSizeError(null)
    setPendingFile(file)
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Add media</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Category</span>
            <Select value={category} onValueChange={(next) => setCategory(next as MediaCategory)}>
              <SelectTrigger className="w-48" aria-label="Photo category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {media.categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {humaniseCategory(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Photo URL</span>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" className="w-72" disabled={disabled} />
          </label>
          <Button variant="outline" onClick={() => addUrl.mutate()} disabled={disabled || url.trim().length === 0 || addUrl.isPending}>
            Add from URL
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Direct file upload</span>
            <input ref={fileRef} type="file" aria-label="Direct file upload" accept="image/jpeg,image/png,video/mp4,video/quicktime" onChange={onFileChange} disabled={disabled} className="text-ui" />
          </label>
          <Button variant="outline" onClick={() => setUploadOpen(true)} disabled={disabled || !pendingFile || upload.isPending}>
            Review file upload
          </Button>
        </div>
        {sizeError ? <p className="text-caption text-destructive">{sizeError}</p> : null}
        <GateNote reason={writeReason} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Current media</h2>
        {media.items.length === 0 ? (
          <p className="text-ui text-muted-foreground">No photos or videos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {media.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border p-2">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt={`${humaniseCategory(item.category)} ${item.mediaFormat.toLowerCase()}`} className="aspect-square w-full rounded-(--nr-radius-control) object-cover" />
                ) : (
                  <div className="aspect-square w-full rounded-(--nr-radius-control) bg-muted" aria-hidden />
                )}
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{humaniseCategory(item.category)}</Badge>
                  {item.ownership === "customer" ? (
                    <Badge variant="outline">Customer photo</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)} disabled={disabled} aria-label={`Delete ${humaniseCategory(item.category)} photo`}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OverwriteConfirmDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Upload this file to Google?"
        description={pendingFile ? `“${pendingFile.name}” will be added as a ${humaniseCategory(category)} photo on your Google Business Profile.` : ""}
        confirmLabel="Upload"
        requireAcknowledgement={false}
        pending={upload.isPending}
        onConfirm={() => upload.mutate()}
      />
      <OverwriteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this photo from Google?"
        description="This removes the photo from your Google Business Profile. It cannot be undone."
        confirmLabel="Delete"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Implement the photos page**

`app/(dashboard)/locations/[id]/photos/page.tsx`:

```tsx
import { PhotosTab } from "@/components/locations/photos-tab"

export default async function PhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PhotosTab locationId={id} />
}
```

- [ ] **Step 5: Run to verify pass, then gate + commit**

```bash
pnpm exec vitest run tests/components/photos-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/locations/photos-tab.tsx "app/(dashboard)/locations/[id]/photos/page.tsx" tests/components/photos-tab.test.tsx
git commit -m "feat(locations): photos tab with URL + upload add, category, delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Booking tab (place-action links CRUD)

> **Interaction pattern (b).** Editable provider links (`isEditable`) get add / edit / delete, hash-pinned via `googleHash`; non-editable provider links are read-only. Gated on `canPublish` + `writesEnabled`.

**Files:**
- Create: `components/locations/booking-tab.tsx`, `app/(dashboard)/locations/[id]/booking/page.tsx`
- Test: `tests/components/booking-tab.test.tsx`

**Interfaces:**
- Consumes: `usePlaceActions` (Task 2), `useLocationCapabilities` (Task 2), `fetchPlaceActions`/`createPlaceAction`/`updatePlaceAction`/`deletePlaceAction`/`PLACE_ACTION_TYPES`/`type PlaceActionsState`/`type PlaceActionLink`/`type PlaceActionType` (Task 2), `publishDisabledReason` (Task 2), `describeActionError` (Task 2), `OverwriteConfirmDialog`/`TabError`/`TabLoading`/`GateNote`, `Select…`/`Input`/`Checkbox`/`Button`/`Badge`/`Table…`.
- Produces: `BookingTab` (props `{ locationId }`); `humaniseActionType` (exported).

- [ ] **Step 1: Write the failing test**

`tests/components/booking-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookingTab } from "@/components/locations/booking-tab"
import { Toaster } from "@/components/ui/toast"
import type { PlaceActionsState } from "@/lib/api/location-booking"

const useBookingMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-booking", () => ({ usePlaceActions: () => useBookingMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeState(overrides: Partial<PlaceActionsState> = {}): PlaceActionsState {
  return {
    locationId: "loc-1",
    canPublish: true,
    writesEnabled: true,
    supportedTypes: ["DINING_RESERVATION", "FOOD_ORDERING"],
    links: [
      { id: "l1", googleLinkName: "a/l/placeActionLinks/1", providerType: "MERCHANT", isEditable: true, uri: "https://book.test", placeActionType: "DINING_RESERVATION", isPreferred: true, googleHash: "h1", observedAt: "2026-07-01T00:00:00.000Z" },
      { id: "l2", googleLinkName: "a/l/placeActionLinks/2", providerType: "AGGREGATOR_3P", isEditable: false, uri: "https://third.test", placeActionType: "FOOD_ORDERING", isPreferred: false, googleHash: "h2", observedAt: "2026-07-01T00:00:00.000Z" },
    ],
    latestMutation: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BookingTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("BookingTab", () => {
  it("lists links, marks a non-editable provider link read-only, and shows no gate reason for a publisher", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Google")).toBeInTheDocument()
    // The add button exists; it is only disabled until a link is typed (dirty),
    // and a publisher sees no permission gate note.
    expect(screen.getByRole("button", { name: "Add booking link" })).toBeInTheDocument()
    expect(screen.queryByText("You do not have permission to publish this location to Google.")).not.toBeInTheDocument()
  })

  it("disables adding with a reason when the viewer cannot publish", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Add booking link" })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/booking-tab.test.tsx --project components`
Expected: FAIL.

- [ ] **Step 3: Implement the booking tab**

`components/locations/booking-tab.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import {
  createPlaceAction,
  deletePlaceAction,
  type PlaceActionLink,
  type PlaceActionType,
  type PlaceActionsState,
} from "@/lib/api/location-booking"
import { describeActionError } from "@/lib/locations/action-errors"
import { publishDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { usePlaceActions } from "@/lib/queries/use-location-booking"

export function humaniseActionType(type: string): string {
  const lower = type.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function BookingTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const bookingQuery = usePlaceActions(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (bookingQuery.isPending) return <TabLoading />
  if (bookingQuery.isError) return <TabError error={bookingQuery.error} onRetry={() => bookingQuery.refetch()} />

  return (
    <BookingTabLoaded
      locationId={locationId}
      state={bookingQuery.data}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationBooking(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function BookingTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: PlaceActionsState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [type, setType] = useState<PlaceActionType>((state.supportedTypes[0] as PlaceActionType) ?? "DINING_RESERVATION")
  const [uri, setUri] = useState("")
  const [preferred, setPreferred] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionLink | null>(null)

  const writeReason = publishDisabledReason(caps, state.writesEnabled)
  const disabled = Boolean(writeReason)

  const add = useMutation({
    mutationFn: () => createPlaceAction(locationId, { uri, placeActionType: type, isPreferred: preferred }),
    onSuccess: () => {
      setUri("")
      setPreferred(false)
      invalidate()
      toast("Booking link added", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const remove = useMutation({
    mutationFn: (link: PlaceActionLink) => deletePlaceAction(locationId, link.id, { expectedGoogleHash: link.googleHash }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
      toast("Booking link removed", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Booking and action links</h2>
        {state.links.length === 0 ? (
          <p className="text-ui text-muted-foreground">No booking links yet.</p>
        ) : (
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Preferred</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="font-medium">{humaniseActionType(link.placeActionType)}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">{link.uri}</TableCell>
                  <TableCell>{link.isPreferred ? <Badge variant="secondary">Preferred</Badge> : "—"}</TableCell>
                  <TableCell>
                    {link.isEditable ? (
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(link)} disabled={disabled} aria-label={`Remove the ${humaniseActionType(link.placeActionType)} link`}>
                        Remove
                      </Button>
                    ) : (
                      <Badge variant="outline">Managed by Google</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Add a booking link</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Type</span>
            <Select value={type} onValueChange={(next) => setType(next as PlaceActionType)}>
              <SelectTrigger className="w-56" aria-label="Booking link type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.supportedTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humaniseActionType(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Link</span>
            <Input value={uri} onChange={(event) => setUri(event.target.value)} placeholder="https://…" inputMode="url" className="w-72" disabled={disabled} />
          </label>
          <label className="flex items-center gap-2 text-ui">
            <Checkbox checked={preferred} onCheckedChange={(value) => setPreferred(value === true)} disabled={disabled} aria-label="Preferred link" />
            Preferred
          </label>
          <Button variant="outline" onClick={() => add.mutate()} disabled={disabled || uri.trim().length === 0 || add.isPending}>
            Add booking link
          </Button>
        </div>
        <GateNote reason={writeReason} />
      </section>

      <OverwriteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this booking link from Google?"
        description="This removes the link from your Google Business Profile."
        confirmLabel="Remove"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Implement the booking page**

`app/(dashboard)/locations/[id]/booking/page.tsx`:

```tsx
import { BookingTab } from "@/components/locations/booking-tab"

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BookingTab locationId={id} />
}
```

- [ ] **Step 5: Run to verify pass, then gate + commit**

```bash
pnpm exec vitest run tests/components/booking-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/locations/booking-tab.tsx "app/(dashboard)/locations/[id]/booking/page.tsx" tests/components/booking-tab.test.tsx
git commit -m "feat(locations): booking tab with place-action link add and remove

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Menu tab (nested food-menu editor + full-replacement publish)

> **Interaction pattern (a) over opaque JSON.** The food menu is freeform Google JSON (`menus[] → sections[] → items[]`). Wave-1 edits section names, item names/descriptions, and item **price as a string draft**, preserving every other key; add/remove sections and items. Publish is a **full replacement** (`confirmFullReplacement: true`), always confirmed. Ineligible locations (`eligible: false`) show a clear notice. Save gates on `canEditCanonical` (owner/admin PUT); publish gates on `canPublish` + `writesEnabled` + eligibility. **Flagged decision (beyond D1–D12):** the food-menus state carries no currency, so prices display the org default currency **GBP** and are written to Google's `attributes.price = { currencyCode: "GBP", units, nanos }`; richer per-item attributes and multi-currency are deferred. If too large for one pass, land view/counts/publish (Steps 3a/4a) then the editor (Step 3b).

**Files:**
- Create: `components/locations/menu-editor.tsx`, `components/locations/menu-tab.tsx`, `app/(dashboard)/locations/[id]/menu/page.tsx`
- Test: `tests/components/menu-tab.test.tsx`

**Interfaces:**
- Consumes: `useFoodMenus` (Task 2), `useLocationCapabilities` (Task 2), `fetchFoodMenus`/`saveFoodMenus`/`publishFoodMenus`/`type FoodMenusState`/`type FoodMenu` (Task 2), `countFoodMenus` (Task 2), `editDisabledReason`/`publishDisabledReason` (Task 2), `describeActionError` (Task 2), `useDirtyGuard`, `OverwriteConfirmDialog`/`TabError`/`TabLoading`/`GateNote`, `Input`/`Textarea`/`Button`/`Badge`/`Empty`.
- Produces: `MenuEditor` (props `{ menus: FoodMenu[]; onChange: (next: FoodMenu[]) => void; disabled: boolean }`), `MenuTab` (props `{ locationId }`).

- [ ] **Step 1: Write the failing test**

`tests/components/menu-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuTab } from "@/components/locations/menu-tab"
import { Toaster } from "@/components/ui/toast"
import type { FoodMenusState } from "@/lib/api/location-menu"

const useMenuMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-menu", () => ({ useFoodMenus: () => useMenuMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeMenus(overrides: Partial<FoodMenusState> = {}): FoodMenusState {
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1" },
    canonicalResource: { revision: "4", updatedAt: "2026-08-01T00:00:00.000Z" },
    eligible: true,
    status: "drift",
    canonicalMenus: [{ labels: [{ displayName: "Mains" }], sections: [{ labels: [{ displayName: "Starters" }], items: [{ labels: [{ displayName: "Soup" }], attributes: { price: { currencyCode: "GBP", units: "6", nanos: 500000000 } } }] }] }],
    googleMenus: [],
    canonicalHash: "ch",
    googleHash: "gh",
    canonicalCounts: { menus: 1, sections: 1, items: 1, options: 0 },
    googleCounts: { menus: 0, sections: 0, items: 0, options: 0 },
    canPublish: true,
    writesEnabled: true,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <MenuTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("MenuTab", () => {
  it("renders the section and item with its price for an owner", () => {
    useMenuMock.mockReturnValue({ data: makeMenus(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByDisplayValue("Starters")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("6.50")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("shows a clear notice when the location cannot have a food menu", () => {
    useMenuMock.mockReturnValue({ data: makeMenus({ eligible: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("This location can’t have a food menu", { exact: false })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/menu-tab.test.tsx --project components`
Expected: FAIL.

- [ ] **Step 3: Implement the menu editor**

`components/locations/menu-editor.tsx` (edits the first menu's sections/items, preserving unknown keys):

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { FoodMenu } from "@/lib/api/location-menu"

type Json = Record<string, unknown>

function label(node: Json): { displayName: string; description: string } {
  const labels = Array.isArray(node.labels) ? node.labels : []
  const first = (labels[0] ?? {}) as Json
  return {
    displayName: typeof first.displayName === "string" ? first.displayName : "",
    description: typeof first.description === "string" ? first.description : "",
  }
}

function withLabel(node: Json, displayName: string, description: string): Json {
  const labels = Array.isArray(node.labels) ? [...(node.labels as Json[])] : []
  const first = { ...((labels[0] as Json) ?? {}), displayName }
  if (description) first.description = description
  else delete first.description
  return { ...node, labels: [first, ...labels.slice(1)] }
}

export function readPrice(item: Json): string {
  const attributes = (item.attributes ?? {}) as Json
  const price = (attributes.price ?? {}) as Json
  if (price.units === undefined && price.nanos === undefined) return ""
  const units = String(price.units ?? "0")
  const nanos = typeof price.nanos === "number" ? price.nanos : 0
  const fraction = nanos ? (nanos / 1e9).toFixed(2).slice(1) : ""
  return `${units}${fraction}`
}

function withPrice(item: Json, value: string): Json {
  const attributes = { ...((item.attributes ?? {}) as Json) }
  const trimmed = value.trim()
  if (!trimmed) {
    delete (attributes as Json).price
    return { ...item, attributes }
  }
  const [unitsPart, fractionPart = ""] = trimmed.split(".")
  const units = String(Number.parseInt(unitsPart || "0", 10) || 0)
  const nanos = fractionPart ? Math.round(Number(`0.${fractionPart}`) * 1e9) : 0
  attributes.price = { currencyCode: "GBP", units, nanos }
  return { ...item, attributes }
}

export function MenuEditor({ menus, onChange, disabled }: { menus: FoodMenu[]; onChange: (next: FoodMenu[]) => void; disabled: boolean }) {
  const menu = (menus[0] ?? {}) as Json
  const sections = Array.isArray(menu.sections) ? (menu.sections as Json[]) : []

  function setSections(next: Json[]) {
    onChange([{ ...menu, sections: next }, ...menus.slice(1)])
  }
  function setSection(index: number, section: Json) {
    setSections(sections.map((s, i) => (i === index ? section : s)))
  }
  function setItems(sectionIndex: number, items: Json[]) {
    setSection(sectionIndex, { ...sections[sectionIndex], items })
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, sectionIndex) => {
        const items = Array.isArray(section.items) ? (section.items as Json[]) : []
        const sectionLabel = label(section)
        return (
          <section key={sectionIndex} className="flex flex-col gap-3 rounded-(--nr-radius-card) border border-border p-4">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Section ${sectionIndex + 1} name`}
                value={sectionLabel.displayName}
                disabled={disabled}
                onChange={(event) => setSection(sectionIndex, withLabel(section, event.target.value, sectionLabel.description))}
                className="max-w-xs font-medium"
              />
              {!disabled ? (
                <Button variant="ghost" size="sm" onClick={() => setSections(sections.filter((_, i) => i !== sectionIndex))}>
                  Remove section
                </Button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-3">
              {items.map((item, itemIndex) => {
                const itemLabel = label(item)
                return (
                  <li key={itemIndex} className="flex flex-wrap items-start gap-2">
                    <Input aria-label={`Item name`} value={itemLabel.displayName} disabled={disabled} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withLabel(it, event.target.value, itemLabel.description) : it)))} className="w-48" />
                    <Textarea aria-label={`Item description`} value={itemLabel.description} disabled={disabled} rows={1} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withLabel(it, itemLabel.displayName, event.target.value) : it)))} className="w-56" />
                    <span className="flex items-center gap-1">
                      <span className="text-caption text-muted-foreground">£</span>
                      <Input aria-label={`Item price`} inputMode="decimal" value={readPrice(item)} disabled={disabled} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withPrice(it, event.target.value) : it)))} className="w-24" />
                    </span>
                    {!disabled ? (
                      <Button variant="ghost" size="sm" onClick={() => setItems(sectionIndex, items.filter((_, i) => i !== itemIndex))}>
                        Remove
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {!disabled ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setItems(sectionIndex, [...items, { labels: [{ displayName: "" }] }])}>
                Add item
              </Button>
            ) : null}
          </section>
        )
      })}
      {!disabled ? (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setSections([...sections, { labels: [{ displayName: "" }], items: [] }])}>
          Add section
        </Button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Implement the menu tab**

`components/locations/menu-tab.tsx`:

```tsx
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { MenuEditor } from "@/components/locations/menu-editor"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { useToastManager } from "@/components/ui/toast"
import { publishFoodMenus, saveFoodMenus, type FoodMenu, type FoodMenusState } from "@/lib/api/location-menu"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import { editDisabledReason, publishDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useFoodMenus } from "@/lib/queries/use-location-menu"

export function MenuTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const menuQuery = useFoodMenus(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (menuQuery.isPending) return <TabLoading />
  if (menuQuery.isError) return <TabError error={menuQuery.error} onRetry={() => menuQuery.refetch()} />

  const state = menuQuery.data
  if (!state.eligible) {
    return (
      <Empty
        title="This location can’t have a food menu"
        description="Google reports that this location type is not eligible for a food menu, so there’s nothing to manage here."
      />
    )
  }

  return (
    <MenuTabLoaded
      key={state.canonicalResource.revision}
      locationId={locationId}
      state={state}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationMenu(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function MenuTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: FoodMenusState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [draft, setDraft] = useState<FoodMenu[]>(state.canonicalMenus)
  useEffect(() => setDraft(state.canonicalMenus), [state.canonicalMenus])
  const [publishOpen, setPublishOpen] = useState(false)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(state.canonicalMenus)
  useDirtyGuard({ key: `location-menu-${locationId}`, isDirty, snapshot: () => JSON.stringify(draft) })

  const save = useMutation({
    mutationFn: () => saveFoodMenus(locationId, { expectedCanonicalRevision: state.canonicalResource.revision, menus: draft }),
    onSuccess: () => {
      invalidate()
      toast("Menu saved", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const publish = useMutation({
    mutationFn: () =>
      publishFoodMenus(locationId, {
        expectedCanonicalRevision: state.canonicalResource.revision,
        expectedCanonicalHash: state.canonicalHash,
        expectedGoogleHash: state.googleHash,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      invalidate()
      toast("Menu published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const editReason = editDisabledReason(caps)
  const publishReason =
    publishDisabledReason(caps, state.writesEnabled) ?? (state.status === "in_sync" ? "Menu already matches Google." : isDirty ? "Save your changes before publishing." : null)
  const draftCounts = countFoodMenus(draft as Array<Record<string, unknown>>)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={state.status === "in_sync" ? "secondary" : "warning"}>
          {state.status === "in_sync" ? "In sync with Google" : "You have unpublished changes"}
        </Badge>
        <span className="text-caption text-muted-foreground">
          {draftCounts.sections} sections · {draftCounts.items} items
        </span>
      </div>

      <MenuEditor menus={draft} onChange={setDraft} disabled={Boolean(editReason)} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={Boolean(editReason) || !isDirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" onClick={() => setPublishOpen(true)} disabled={Boolean(publishReason) || publish.isPending}>
          Publish to Google
        </Button>
      </div>
      <GateNote reason={editReason ?? publishReason} />

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Replace the Google food menu?"
        description="Publishing replaces your entire Google food menu with the menu shown here."
        confirmLabel="Publish"
        requireAcknowledgement
        acknowledgementLabel="I understand this replaces the whole food menu on Google."
        pending={publish.isPending}
        onConfirm={() => publish.mutate()}
      />
    </div>
  )
}
```

- [ ] **Step 5: Implement the menu page**

`app/(dashboard)/locations/[id]/menu/page.tsx`:

```tsx
import { MenuTab } from "@/components/locations/menu-tab"

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MenuTab locationId={id} />
}
```

- [ ] **Step 6: Run to verify pass, then gate + commit**

```bash
pnpm exec vitest run tests/components/menu-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/locations/menu-editor.tsx components/locations/menu-tab.tsx "app/(dashboard)/locations/[id]/menu/page.tsx" tests/components/menu-tab.test.tsx
git commit -m "feat(locations): menu tab with nested editor and full-replacement publish

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Posts tab (draft → approval → publish lifecycle)

> **Interaction pattern (c): local draft → approval → publish, mirroring M4's reply lifecycle.** Composing is gated on `writesEnabled` (posts routes 503 `posts_paused` on POST/PATCH when the flag is off, so even drafting is blocked — D8); the create route is not role-gated, so any authenticated user can draft, and publishing routes to approval (202) for non-publishers. **Approve** and **deleting a live post** gate on `canPublish`; the second-approver rule surfaces the exact copy "A different authorised user must approve this post." (via `describeActionError`). Per-action pending; no optimistic publish.

**Files:**
- Create: `components/locations/post-composer.tsx`, `components/locations/posts-action-bar.tsx`, `components/locations/posts-tab.tsx`, `app/(dashboard)/locations/[id]/posts/page.tsx`
- Test: `tests/components/posts-tab.test.tsx`

**Interfaces:**
- Consumes: `usePosts` (Task 2), `useLocationCapabilities` (Task 2), `fetchPosts`/`createPost`/`publishPost`/`decidePostApproval`/`deletePost`/`type Post`/`type PostsState` (Task 2), `localPostFormSchema`/`type LocalPostFormValues` (Task 2), `composeDisabledReason`/`publishDisabledReason` (Task 2), `describeActionError` (Task 2), `useDirtyGuard`, `OverwriteConfirmDialog`/`TabError`/`TabLoading`/`GateNote`, `Select…`/`Textarea`/`Input`/`Button`/`Badge`/`Alert`.
- Produces: `PostComposer` (props `{ locationId; disabledReason: string | null; invalidate; toast }`), `PostsActionBar` (props `{ locationId; post; caps; writesEnabled; invalidate; toast }`), `PostsTab` (props `{ locationId }`).

- [ ] **Step 1: Write the failing test**

`tests/components/posts-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostsTab } from "@/components/locations/posts-tab"
import { Toaster } from "@/components/ui/toast"
import type { Post, PostsState } from "@/lib/api/location-posts"

const usePostsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-posts", () => ({ usePosts: () => usePostsMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1", topicType: "STANDARD", languageCode: "en-GB", summary: "Open late tonight", callToAction: null, event: null, offer: null, media: [],
    scheduledTime: null, status: "draft", googlePostName: null, googleState: null, googleSearchUrl: null, lastErrorCode: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides,
  }
}
function makeState(overrides: Partial<PostsState> = {}): PostsState {
  return { posts: [post()], writesEnabled: true, reconciliationError: null, ...overrides }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PostsTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PostsTab", () => {
  it("lists a draft post with a publish action and an enabled composer", () => {
    usePostsMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Open late tonight")).toBeInTheDocument()
    // The listed draft can be published; the empty composer's Save draft is
    // present but disabled until something is typed (dirty).
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
  })

  it("shows a paused notice and disables composing when posts are paused", () => {
    usePostsMock.mockReturnValue({ data: makeState({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
    expect(screen.getByText("Google posts are currently paused, so new posts cannot be composed.")).toBeInTheDocument()
  })

  it("shows the second-approver copy path via an awaiting-approval post for a publisher", () => {
    usePostsMock.mockReturnValue({ data: makeState({ posts: [post({ status: "awaiting_approval" })] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/posts-tab.test.tsx --project components`
Expected: FAIL.

- [ ] **Step 3: Implement the composer**

`components/locations/post-composer.tsx`:

```tsx
"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createPost } from "@/lib/api/location-posts"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { localPostFormSchema, type LocalPostFormValues } from "@/lib/locations/forms/local-post"

const TOPICS = [
  { value: "STANDARD", label: "Update" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
] as const

export function PostComposer({
  locationId,
  disabledReason,
  invalidate,
  toast,
}: {
  locationId: string
  disabledReason: string | null
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [topicType, setTopicType] = useState<"STANDARD" | "EVENT" | "OFFER">("STANDARD")
  const [summary, setSummary] = useState("")
  const [eventTitle, setEventTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const isDirty = summary.trim().length > 0 || eventTitle.trim().length > 0
  useDirtyGuard({ key: `location-posts-composer-${locationId}`, isDirty, snapshot: () => JSON.stringify({ topicType, summary, eventTitle }) })

  const create = useMutation({
    mutationFn: (input: LocalPostFormValues) => createPost(locationId, input),
    onSuccess: () => {
      setSummary("")
      setEventTitle("")
      invalidate()
      toast("Draft saved", "success")
    },
    onError: (err) => toast(describeActionError(err), "error"),
  })

  const disabled = Boolean(disabledReason)

  function submit() {
    const candidate: Record<string, unknown> = { topicType, summary, media: [] }
    if (topicType !== "STANDARD") candidate.event = { title: eventTitle }
    if (topicType === "OFFER") candidate.offer = {}
    const parsed = localPostFormSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please complete the post.")
      return
    }
    setError(null)
    create.mutate(parsed.data)
  }

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-title font-semibold">New post</h2>
      <label className="flex flex-col gap-1 text-ui">
        <span className="text-caption text-muted-foreground">Type</span>
        <Select value={topicType} onValueChange={(next) => setTopicType(next as "STANDARD" | "EVENT" | "OFFER")}>
          <SelectTrigger className="w-48" aria-label="Post type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOPICS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {topicType !== "STANDARD" ? (
        <label className="flex flex-col gap-1 text-ui">
          <span className="text-caption text-muted-foreground">Event title</span>
          <Textarea value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} rows={1} disabled={disabled} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-ui">
        <span className="text-caption text-muted-foreground">Summary</span>
        <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} disabled={disabled} aria-label="Post summary" />
      </label>
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={disabled || !isDirty || create.isPending}>
          {create.isPending ? "Saving…" : "Save draft"}
        </Button>
      </div>
      <GateNote reason={disabledReason} />
    </section>
  )
}
```

- [ ] **Step 4: Implement the action bar**

`components/locations/posts-action-bar.tsx`:

```tsx
"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { decidePostApproval, deletePost, publishPost, type Post } from "@/lib/api/location-posts"
import { describeActionError } from "@/lib/locations/action-errors"
import { publishDisabledReason } from "@/lib/locations/gating"

function describePublishOutcome(status: string) {
  return status === "awaiting_approval"
    ? { title: "Post submitted for approval.", type: "success" as const }
    : { title: "Post published to Google", type: "success" as const }
}

export function PostsActionBar({
  locationId,
  post,
  caps,
  writesEnabled,
  invalidate,
  toast,
}: {
  locationId: string
  post: Post
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  writesEnabled: boolean
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  const publish = useMutation({
    mutationFn: () => publishPost(locationId, post.id),
    onSuccess: (result) => {
      const outcome = describePublishOutcome(result.status)
      invalidate()
      toast(outcome.title, outcome.type)
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => decidePostApproval(locationId, post.id, decision),
    onSuccess: (result, decision) => {
      invalidate()
      toast(decision === "reject" ? "Sent back to draft" : describePublishOutcome(result.status).title, "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })
  const remove = useMutation({
    mutationFn: () => deletePost(locationId, post.id),
    onSuccess: () => {
      setDeleteOpen(false)
      invalidate()
      toast("Post deleted", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const publishReason = writesEnabled ? null : "Google posts are currently paused."
  const approveReason = publishDisabledReason(caps, writesEnabled)
  // Deleting a live (published) post needs publish permission; drafts do not.
  const deleteReason = post.googlePostName ? publishDisabledReason(caps, writesEnabled) : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(post.status === "draft" || post.status === "failed" || post.status === "ambiguous") ? (
        <Button size="sm" onClick={() => publish.mutate()} disabled={Boolean(publishReason) || publish.isPending}>
          Publish
        </Button>
      ) : null}
      {post.status === "awaiting_approval" ? (
        <>
          <Button size="sm" onClick={() => decide.mutate("approve")} disabled={Boolean(approveReason) || decide.isPending}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide.mutate("reject")} disabled={decide.isPending}>
            Reject
          </Button>
        </>
      ) : null}
      {post.status === "published" && post.googleSearchUrl ? (
        <a href={post.googleSearchUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          View on Google
        </a>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} disabled={Boolean(deleteReason) || remove.isPending}>
        Delete
      </Button>
      <OverwriteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this post?"
        description={post.googlePostName ? "This removes the post from your Google Business Profile." : "This deletes the draft."}
        confirmLabel="Delete"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
```

- [ ] **Step 5: Implement the posts tab**

`components/locations/posts-tab.tsx`:

```tsx
"use client"

import { useQueryClient } from "@tanstack/react-query"

import { PostComposer } from "@/components/locations/post-composer"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { useToastManager } from "@/components/ui/toast"
import type { Post } from "@/lib/api/location-posts"
import { composeDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { usePosts } from "@/lib/queries/use-location-posts"

const STATUS: Record<Post["status"], { label: string; variant: "secondary" | "info" | "warning" | "destructive" | "success" }> = {
  draft: { label: "Draft", variant: "secondary" },
  awaiting_approval: { label: "Awaiting approval", variant: "info" },
  publishing: { label: "Publishing", variant: "info" },
  published: { label: "Published", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  ambiguous: { label: "Needs checking", variant: "warning" },
}

export function PostsTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const postsQuery = usePosts(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (postsQuery.isPending) return <TabLoading />
  if (postsQuery.isError) return <TabError error={postsQuery.error} onRetry={() => postsQuery.refetch()} />

  const state = postsQuery.data
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.locationPosts(locationId) })
  const toast = (title: string, type: "success" | "error") => toasts.add({ title, type })

  return (
    <div className="flex flex-col gap-6">
      {state.reconciliationError ? (
        <Alert variant="warning">
          <AlertTitle>Some Google posts may be out of date</AlertTitle>
          <AlertDescription>We couldn’t reach Google to refresh this list just now. Your drafts are safe.</AlertDescription>
        </Alert>
      ) : null}

      <PostComposer locationId={locationId} disabledReason={composeDisabledReason(state.writesEnabled)} invalidate={invalidate} toast={toast} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Posts</h2>
        {state.posts.length === 0 ? (
          <p className="text-ui text-muted-foreground">No posts yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.posts.map((post) => (
              <li key={post.id} className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={STATUS[post.status].variant}>{STATUS[post.status].label}</Badge>
                  <span className="text-caption text-muted-foreground">{post.topicType === "STANDARD" ? "Update" : post.topicType === "EVENT" ? "Event" : "Offer"}</span>
                </div>
                <p className="text-ui" lang={post.languageCode} dir="auto">
                  {post.summary || "—"}
                </p>
                <PostsActionBar locationId={locationId} post={post} caps={caps} writesEnabled={state.writesEnabled} invalidate={invalidate} toast={toast} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Implement the posts page**

`app/(dashboard)/locations/[id]/posts/page.tsx`:

```tsx
import { PostsTab } from "@/components/locations/posts-tab"

export default async function PostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PostsTab locationId={id} />
}
```

- [ ] **Step 7: Run to verify pass, then gate + commit**

```bash
pnpm exec vitest run tests/components/posts-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/locations/post-composer.tsx components/locations/posts-action-bar.tsx components/locations/posts-tab.tsx "app/(dashboard)/locations/[id]/posts/page.tsx" tests/components/posts-tab.test.tsx
git commit -m "feat(locations): posts tab with composer, approval and publish lifecycle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Milestone e2e adaptation + gate

**Files:**
- Modify: `tests/e2e/helpers/stub-bridge.ts` (wave-1 Google stub matchers + admin/member cookies), `playwright.config.ts` (un-ignore `locations.spec.ts`, drop the `capability-tabs.spec.ts` entry, enable GBP write flags in the web server env)
- Rewrite: `tests/e2e/locations.spec.ts`
- Delete: `tests/e2e/capability-tabs.spec.ts`
- Gate: full unit + component + integration + e2e suite green, clean production build, whole-branch review.

**Interfaces:** consumes `readJourneyState` (extended), the wave-1 routes built in Tasks 3–10, and the `seedLinkedLocation`/capabilities work from Task 1.

Selectors/copy the spec drives (invariants from Tasks 3–10): `h1` "Locations" (index) and the location name (workspace); `role="columnheader"` "Location"/"Status"; `role="navigation"` name "Location sections" with links "Profile"/"Hours"/"Photos"/"Posts"/"Booking"/"Menu"; buttons "Save changes"/"Publish to Google"/"Add from URL"/"Add booking link"/"Add media"/"Review file upload"/"Save draft"/"Publish"/"Approve"; the "Direct file upload" input label; the gate copy "Only owners and admins can edit this location."

- [ ] **Step 1: Extend the stub bridge with wave-1 Google matchers + admin/member cookies**

`tests/e2e/helpers/stub-bridge.ts`. First, add these fields to `JourneyState`:

```ts
  primaryLocationId: string
  adminCookie: string
  memberAssignedCookie: string
  memberUnassignedCookie: string
```

After the existing viewer seeding in the primary org (reuse the local `hashToken` helper and `randomBytes`/`randomUUID` already imported), seed an admin and two members. `directReview.locationId` is the primary linked location; the assigned member gets a `location_member` grant to it.

```ts
    async function seedUser(role: "admin" | "member", canPublish: boolean) {
      const userId = randomUUID()
      const token = randomBytes(32).toString("base64url")
      await admin`
        insert into app_user (id, email, display_name, default_organisation_id)
        values (${userId}, ${`m5-${userId.slice(0, 8)}@nabapresence.test`}, 'M5 walk user', ${organisationId})
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
    const adminUser = await seedUser("admin", true)
    const memberAssigned = await seedUser("member", true)
    const memberUnassigned = await seedUser("member", false)
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${organisationId}, ${directReview.locationId}, ${memberAssigned.userId}, true)
    `
```

Then register the wave-1 Google GET matchers (order matters — the stub checks newest-first, so register the generic location read before the more specific `/foodMenus`, and `/media` before `/media/customers`). Add after the existing `/accounts` and `/{account}/locations` matchers:

```ts
    // Location read (profile + hours + food-menu eligibility) — one rich object
    // covering every readMask the wave-1 tabs request.
    stub.respond({ method: "GET", pathIncludes: "readMask" }, () => ({
      status: 200,
      json: {
        name: "locations/stub",
        title: "Riverside Rooms",
        phoneNumbers: { primaryPhone: "+44 20 7946 0000" },
        profile: { description: "A calm riverside stay." },
        storefrontAddress: { addressLines: ["1 River Road"], locality: "Bath", postalCode: "BA1 1AA", regionCode: "GB" },
        websiteUri: "https://riverside.example",
        categories: { primaryCategory: { displayName: "Hotel" } },
        regularHours: { periods: [] },
        specialHours: { specialHourPeriods: [] },
        moreHours: [],
        metadata: { canHaveFoodMenus: true, mapsUri: "https://maps.example/x", newReviewUri: "https://g.page/x/review" },
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/media" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/media/customers" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/localPosts" }, () => ({ status: 200, json: { localPosts: [], nextPageToken: null } }))
    stub.respond({ method: "GET", pathIncludes: "/placeActionLinks" }, () => ({ status: 200, json: { placeActionLinks: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({ status: 200, json: { name: "locations/stub/foodMenus", menus: [] } }))
    // Booking create journey: echo the posted link back (name + input fields) so
    // the readback hash matches the request.
    stub.respond({ method: "POST", pathIncludes: "/placeActionLinks" }, (call) => {
      const body = (call.body ?? {}) as Record<string, unknown>
      return { status: 200, json: { name: "locations/stub/placeActionLinks/created", uri: body.uri, placeActionType: body.placeActionType, isPreferred: body.isPreferred ?? false } }
    })
```

> **Executor note:** these GET response shapes are best-effort against the Google client parsers in `lib/server/google.ts`. If a tab logs a console error on load, inspect `stub.calls` and the failing parse, and adjust the matcher's JSON field names to what the client expects — do NOT weaken the console-error guard. Every tab must load clean.

Finally add the new cookies + `primaryLocationId` to the built `state`:

```ts
      primaryLocationId: directReview.locationId,
      adminCookie: adminUser.cookie,
      memberAssignedCookie: memberAssigned.cookie,
      memberUnassignedCookie: memberUnassigned.cookie,
```

- [ ] **Step 2: Enable GBP write flags in the Playwright web server**

In `playwright.config.ts`, add these to `webServer.env` (so publish/write controls are enabled for the write-journey and clean-load tests; `PUBLISH_ENABLED` already defaults true):

```ts
      GBP_PROFILE_WRITES_ENABLED: "true",
      GBP_MEDIA_ENABLED: "true",
      GBP_POSTS_ENABLED: "true",
      GBP_FOOD_MENUS_ENABLED: "true",
      GBP_PLACE_ACTIONS_ENABLED: "true",
```

And in the `testIgnore` array, delete the `"**/locations.spec.ts"` line (revive it) and the `"**/capability-tabs.spec.ts"` line (the file is deleted in Step 4). Leave `"**/gbp-management-tabs.spec.ts"` ignored (its business-info/industry/administration tests are M8; its photos assertions are extracted into `locations.spec.ts` below).

- [ ] **Step 3: Rewrite `tests/e2e/locations.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
] as const

async function useCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("locations", () => {
  test("index lists locations and the workspace exposes the six wave-1 tabs", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto("/locations")
    await expect(page.getByRole("heading", { name: "Locations", level: 1 })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible()

    await page.goto(`/locations/${state.primaryLocationId}`)
    const nav = page.getByRole("navigation", { name: "Location sections" })
    for (const tab of TABS) {
      await expect(nav.getByRole("link", { name: tab.label })).toBeVisible()
    }
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    for (const tab of TABS) {
      test(`${tab.label || "Profile"} tab loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await useCookie(page, baseURL, state.cookie)
        await page.goto(`/locations/${state.primaryLocationId}${tab.segment ? `/${tab.segment}` : ""}`)
        await expect(page.getByRole("navigation", { name: "Location sections" })).toBeVisible()
        await page.waitForLoadState("networkidle")
        expect(consoleErrors, `${theme} ${tab.label} console`).toEqual([])
        expect(pageErrors, `${theme} ${tab.label} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${theme} ${tab.label} wcag`).toEqual([])
        const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
        expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} ${tab.label} structure`).toEqual([])
      })
    }
  }

  test("photos tab exposes the add-media controls (extracted from gbp-management-tabs)", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/photos`)
    await expect(page.getByText("Add media", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Direct file upload")).toBeVisible()
    await expect(page.getByRole("button", { name: "Review file upload" })).toBeDisabled()
  })

  test("permission walk: owner/admin can edit canonical; member/viewer cannot", async ({ baseURL, browser }) => {
    const state = await readJourneyState()
    const cases: Array<[string, boolean]> = [
      [state.cookie, true],
      [state.adminCookie, true],
      [state.memberAssignedCookie, false],
      [state.memberUnassignedCookie, false],
      [state.viewerCookie, false],
    ]
    for (const [cookie, canEdit] of cases) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await useCookie(page, baseURL, cookie)
      await page.goto(`/locations/${state.primaryLocationId}`)
      const save = page.getByRole("button", { name: "Save changes" })
      await expect(save).toBeVisible()
      if (canEdit) {
        await expect(save).toBeEnabled().catch(async () => {
          // Enabled once dirty; assert the gate reason is absent instead.
          await expect(page.getByText("Only owners and admins can edit this location.")).toHaveCount(0)
        })
      } else {
        await expect(save).toBeDisabled()
        await expect(page.getByText("Only owners and admins can edit this location.")).toBeVisible()
      }
      await context.close()
    }
  })

  test("canonical save journey: an owner edits the business name and saves", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}`)
    const name = page.getByRole("textbox", { name: "Business name" })
    await expect(name).toBeVisible()
    await name.fill("Riverside Rooms & Spa")
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/profile`
    )
    await page.getByRole("button", { name: "Save changes" }).click()
    expect((await saved).status()).toBe(200)
    await expect(page.getByText("Profile saved", { exact: true })).toBeVisible()
  })

  test("booking create journey: an owner adds a booking link", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await useCookie(page, baseURL, state.cookie)
    await page.goto(`/locations/${state.primaryLocationId}/booking`)
    await page.getByLabel("Link").fill("https://book.e2e/reserve")
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/locations/${state.primaryLocationId}/place-actions`
    )
    await page.getByRole("button", { name: "Add booking link" }).click()
    expect((await created).status()).toBe(201)
    await expect(page.getByText("Booking link added", { exact: true })).toBeVisible()
  })
})
```

> **Executor note:** if the `Save changes` button is disabled-until-dirty in the walk causing flakiness, assert the presence/absence of the gate reason text (`"Only owners and admins can edit this location."`) as the authoritative signal rather than the button's enabled state, since owner/admin enablement additionally requires the form to be dirty.

- [ ] **Step 4: Delete the stale capability-tabs spec**

```bash
git rm tests/e2e/capability-tabs.spec.ts
```

Record in the commit body why: `capability-tabs.spec.ts` asserted every capability tab renders the literal text "not enabled" — a superseded "unbuilt tab" placeholder scaffold that directly contradicts the real wave-1 tabs (which render working editors), so it is deleted rather than adapted.

- [ ] **Step 5: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: unit + components green; production build green; e2e runs `foundation.spec.ts` + `home.spec.ts` + `inbox.spec.ts` + `journeys.spec.ts` + the revived `locations.spec.ts` (all six tabs clean in both themes, the permission walk, the canonical save journey, the booking create journey), all green; integration green including the new `location-capabilities.test.ts` (`RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`) and no pre-existing integration test moved. Fix any failure in the product/spec, never by weakening an assertion. Paste every summary line into the report.

- [ ] **Step 6: Whole-branch review (two passes) + one fix wave**

Per spec §10, request a whole-branch review before merge:
1. A general review of the entire M5 diff.
2. A dedicated **capability/tenant-scoping** pass focused on Task 1 (the sanctioned protected-path edit) — confirm `locationCapabilitiesForIds` mirrors `permissions.ts` (`canPublishLocation`) exactly for every role × membership case, that `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` lists exactly the two sanctioned files, and that a member/viewer can never reach an enabled edit-canonical or publish control server-side or client-side (spec §9 "no reachable 403 from primary controls").

Apply one fix wave for the findings, re-run the gate, then commit.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/helpers/stub-bridge.ts tests/e2e/locations.spec.ts playwright.config.ts
git commit -m "test(locations): revive and extend locations e2e across six tabs; wave-1 stub matchers; delete stale capability-tabs; milestone gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 5 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- E2e green: `foundation.spec.ts`, `home.spec.ts`, `inbox.spec.ts`, `journeys.spec.ts`, and the revived `locations.spec.ts` — including the zero-console-error + zero-pageerror guard and the best-practice structural axe rules on **every** wave-1 route (index + the six tabs) in both light and dark, the per-role permission walk (owner / admin / member-assigned / member-unassigned / viewer), the canonical save journey, and the booking create journey.
- Integration suite green (the parity oracle), including the new `location-capabilities.test.ts` (all seven role × membership combinations, `RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`). No pre-existing integration test moved.
- **Protected-path discipline:** the ONLY changes under `app/api/**`/`lib/server/**`/`lib/domain/**`/`supabase/**`/`scripts/**`/`instrumentation.ts` are Task 1's two sanctioned files (`lib/server/capabilities.ts` additive; `app/api/locations/[id]/capabilities/route.ts` new). `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` lists exactly those two. The `tenant.ts` helper edit is under `tests/`, outside the protected set. Everything else under the protected paths is byte-identical.
- Every M5-scoped spec obligation closed (spec §8 Locations): workspace `h1` = location name + tab nav with scroll affordance and active-tab scroll-into-view; profile / hours / photos / posts / booking / menu rebuilt as Field-based forms with per-field/inline errors, price string-drafts (menu), photo size pre-check + input reset (photos), dialog dirty-confirms (profile/hours/menu/posts via `useDirtyGuard`), unknown location id → `notFound()`; capability gating with disabled-state reasons across edit vs publish; honest per-flag paused states; no error codes shown.
- No new dependency added. All primitives came from the already-installed `@base-ui/react` (`Checkbox`) or a styled native element (`Table`); everything else was admitted in M1–M4.
- Whole-branch review complete with a dedicated capability/tenant-scoping pass; its findings fixed in one wave.
- Carry-forwards recorded for later milestones: **server-hydrated/dehydrated Locations** (spec §5 prefetch) — the `lib/server` services already exist, so a later dedicated effort retrofits RSC prefetch + dehydrate additively into the same Query keys (D3); **business-info / industry / administration consoles** → M8 (the quarantined `gbp-management-tabs.spec.ts` business-info/industry/administration tests are revived then); **per-location performance tab** → M7; **per-location reviews sub-view** → not planned (Home + `/inbox?locationId=` cover it); **server-side `notFound()` for unknown ids** (currently client-side after the directory loads) → folds into the server-hydration retrofit; **menu currency + rich attributes** (wave-1 approximates GBP and edits names/prices only) → a later menu polish; **`moreHours` (kitchen hours) editing** (wave-1 preserves it unchanged) → a later hours polish.
- Decisions made BEYOND the locked D1–D12 list (flagged for controller review): (a) **capabilities mechanism** — a dedicated `GET /api/locations/[id]/capabilities` route + one `useLocationCapabilities` hook reused across tabs, rather than embedding `canEditCanonical` into ~12 per-tab route/service files (D4 left the mechanism to my call; this is the minimal-protected-footprint option — two sanctioned files); (b) **client-safe form schemas placed in `lib/locations/forms/` (non-protected), mirroring the server route schemas with parity tests**, rather than in `lib/domain/` — because `lib/domain` is a protected consume-only path under D12, so the key-fact "extract to `lib/domain`" is superseded by the locked protected-path rule (the mirror + parity test achieves spec §6's "validate identically"); (c) **forms are hand-rolled `useState` + zod `safeParse`, not `react-hook-form`** — `react-hook-form` is not installed and D12 forbids new deps, matching M4's established composer pattern (spec §6's "react-hook-form resolvers" is met in spirit by the shared client-safe zod + inline error mapping); (d) **menu prices display/write GBP** since the food-menus state carries no currency, and richer attributes/`moreHours` editing are deferred (flagged above); (e) **per-tab publish-gate nuance** — profile publish/import gate on `canEditCanonical` (its POST is route-`requireRole(owner/admin)`) whereas hours/menu/photos/booking publish gate on `canPublish` (their writes authorise via the service's `canPublishLocation`), and posts composing gates on `writesEnabled` with approve/live-delete on `canPublish` — all derived from the real route/service guards, not invented; (f) **the e2e enables the `GBP_*_ENABLED` flags** in the Playwright web server so publish/write controls are exercisable, and the write journeys chosen (canonical save + booking create) are the deterministic ones (the canonical-publish readback-hash-match tabs are covered for gating/enablement, with their happy-path publish left to the integration oracle).

## Self-review (run before merge; fix inline)

- **Spec coverage.** §3 capabilities addition → Task 1 (`locationCapabilities`/`locationCapabilitiesForIds` + the dedicated route). §5 rendering model — client-fetched tabs with route-level `loading.tsx`; server-prefetch deviation documented (D3) and carried forward, noting the reusable `lib/server` services. §6 data layer — one QueryClient; per-location + capabilities keys; typed client via `apiFetch`/`ApiClientError`; client-safe zod (mirrored in `lib/locations/forms/`, parity-tested); `useDirtyGuard` on profile/hours/menu/posts; dialog dirty-confirms; server field errors mapped inline (profile) / surfaced (hours/menu). §8 Locations paragraph — every clause mapped: workspace `h1` + scroll-affordanced tab nav + active-tab scroll-into-view (Task 4); Field-based forms with per-field errors (Task 5); price string-drafts with currency (Task 9); photo size pre-check + upload progress note + input reset (Task 7); dialog dirty-confirms (Tasks 5/6/9/10); unknown location id → `notFound()` (Task 4). §9 testing — loading/error/empty/mutation-failure component tests per tab; the capability matrix as an executable integration test (Task 1); e2e per-role walk, per-tab clean-load in both themes, save + create journeys (Task 11); parity oracle stays green (Task 1). No M5-scoped requirement is left without a task.
- **Placeholder scan.** No "TBD"/"similar to Task N"/"add error handling"/bare "write tests". Every code step carries real code; each non-trivial component (index, workspace, canonical-diff, profile/hours/photos/booking/menu/posts tabs, the editors, the action bar) ships a numbered/described contract + a complete pinned test + a reference implementation. Shared blocks (`CanonicalDiff`, `OverwriteConfirmDialog`, `TabError`/`TabLoading`, `GateNote`, the gating/action-error/form modules) are implemented once (Task 2/4/5) and imported by name thereafter — not re-implemented.
- **Type consistency.** `LocationCapabilities { canEditCanonical, canPublish }` is identical across `lib/server/capabilities.ts` (Task 1), the API `locationCapabilitiesSchema` + `fetchLocationCapabilities` (Task 2), `lib/locations/gating.ts` (Task 2), and every tab's `useLocationCapabilities` consumer. `ProfileState`/`ProfileFieldKey`, `HoursState`/`NormalizedHours`/`HoursUpdateMask`, `MediaState`/`MediaItem`/`MediaCategory`, `PlaceActionsState`/`PlaceActionLink`/`PlaceActionType`, `FoodMenusState`/`FoodMenu`, `PostsState`/`Post`/`LocalPostFormValues` (Task 2) are the exact names Tasks 3–10 import. `DirectoryEntry` + `useLocationDirectory(role)` (Task 2) match the index (Task 3) and shell (Task 4). `useProfile`/`useHours`/`useMedia`/`usePlaceActions`/`useFoodMenus`/`usePosts` and `useLocationCapabilities` names match producer and consumer. `queryKeys.location{Profile,Hours,Media,Booking,Menu,Posts}(id)` + `locationCapabilities(id)` + `locationsManagement` are identical between hook and invalidation call. `CanonicalDiff` `DiffStatus` reuses the four canonical-resource statuses (`in_sync`/`core_dirty`/`google_dirty`/`conflict`) that `ProfileState.fields[].status` and `HoursState.status` carry. `OverwriteConfirmDialog` props (`open`/`onOpenChange`/`title`/`description`/`confirmLabel`/`requireAcknowledgement`/`acknowledgementLabel`/`pending`/`onConfirm`) match all reuse sites (profile ×2, hours, photos ×2, booking, menu, posts). `describeActionError`/`isNotLinkedError` (Task 2) match `TabError` and every mutation `onError`. Primitive export surfaces (`Table…`, `Checkbox`, `Select…`, `Combobox…`, `AlertDialog…`, `Badge`, `Empty`, `Field…`, `Input`, `Textarea`, `Button`) are imported by exactly those names. Confirmation literals (`create_google_media`/`update_google_media`/`delete_google_media`, `create_google_place_action`/`update_google_place_action`/`delete_google_place_action`, `publish_nabapresence_profile_to_google`/`import_google_profile_to_nabapresence`, `publish_nabapresence_hours_to_google`, `publish_nabapresence_food_menus_to_google`) match the server route schemas verbatim.
- **Parity-oracle safety.** Task 1 adds only new symbols to `lib/server/capabilities.ts` and a new route file; no existing route/service/query changes, so `reviewCapabilities` and every existing integration test stay byte-identical and green. The `location-links` route is not modified (D5 — owner/admin use its existing `?view=management` branch; member/viewer use its existing default branch), so its tests are untouched. The `seedLinkedLocation` helper is additive in `tests/integration/helpers/tenant.ts`; it inserts only new rows and shares no state with `seedLinkedReview`.
- **Protected-path footprint.** `git diff --stat main -- app lib/server lib/domain supabase scripts instrumentation.ts` must list exactly `lib/server/capabilities.ts` and `app/api/locations/[id]/capabilities/route.ts`. All client-safe schemas, clients, hooks, components, and pages live under `lib/api`, `lib/locations`, `lib/queries`, `components/**`, `app/(dashboard)/locations/**`, and `tests/**` — none protected. Confirm no accidental edit to any wave-1 tab route or service.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-01-frontend-rebuild-m5-locations.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with a two-stage review between tasks. The hard chain is 1 → 2 → 3 → 4; after Task 4, Tasks 5/6/7/8/9/10 (the six tabs) can run in parallel worktree passes, then Task 11 (gate). Task 1 (protected path) warrants a dedicated capability/tenant-scoping reviewer; Tasks 6 and 9 (the nested editors) each warrant a focused pass.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batching with checkpoints for review.

Which approach?








