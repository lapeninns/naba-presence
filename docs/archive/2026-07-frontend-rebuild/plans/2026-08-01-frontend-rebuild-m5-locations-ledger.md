# M5 Locations (wave 1) — SDD ledger & carry-forward register

Preserved from the gitignored SDD progress ledger at merge time. Plan:
`docs/archive/2026-07-frontend-rebuild/plans/2026-08-01-frontend-rebuild-m5-locations.md` (commit
`b4170e8` + plan-review revisions `393218c`). Merged to `main` as a clean
fast-forward from `d5bbbc7` (M4). Milestone HEAD at merge: `5bc2e62`.

## What shipped (11 tasks, 75 files, +9.6k)

A per-location **Locations workspace** rebuilt from scratch:

- **T1 (the ONE sanctioned protected-path edit):** additive
  `locationCapabilities`/`locationCapabilitiesForIds` in
  `lib/server/capabilities.ts` + new `GET /api/locations/[id]/capabilities`
  route + `seedLinkedLocation` integration helper +
  `tests/integration/routes/location-capabilities.test.ts` (7 role×membership
  cases). The capability model is an **exact mirror** of
  `lib/server/permissions.ts` `canPublishLocation` (verified by the
  whole-branch capability/tenant-security pass — the M4 T1 missing-member-branch
  bug does **not** recur).
- **T2** typed per-tab API clients (incl. XHR upload with progress),
  client-safe zod form schemas in `lib/locations/forms/` (mirrors of the server
  route schemas, parity-tested — placed here because `lib/domain/` is protected
  and imports `node:crypto`), query hooks, `lib/locations/gating.ts`,
  `lib/locations/action-errors.ts`.
- **T3** role-aware `/locations` index (owner/admin management table via
  `?view=management`; member/viewer plain `{id,name}`) + `Table` primitive.
- **T4** workspace shell: `h1` = location name, address/status badges, tab nav
  with scroll affordance + active-tab `scrollIntoView`, "Switch location"
  Combobox, `notFound()` on unknown id, exactly the six wave-1 tabs; flipped
  `/locations` nav `prefetch: true`.
- **T5–T10** the six tabs: **Profile** (canonical diff + save + publish/import),
  **Hours** (weekly regular+special editor), **Photos** (live-Google media
  CRUD), **Booking** (place-action links CRUD), **Menu** (nested freeform-JSON
  editor + full-replacement publish), **Posts** (draft→approval→publish
  lifecycle). Shared blocks (`Checkbox`, `CanonicalDiff`,
  `OverwriteConfirmDialog`, `TabLoading`/`TabError`) built once in T5.
- **T11** milestone e2e: revived + rewrote `locations.spec.ts` (6 tabs
  clean-load × light+dark with zero-console-error/zero-pageerror guards + axe
  WCAG + best-practice structure rules, 5-role permission walk, canonical-save
  and booking-create write journeys); extended the stub bridge with wave-1
  Google matchers + admin/2-member seeds; deleted the superseded
  `capability-tabs.spec.ts`.

## Gate at merge (independently re-run on `5bc2e62`, GATE GREEN)

- `pnpm typecheck` clean; `pnpm lint` 0 errors / 2 pre-existing warnings
  (untouched `tests/components/app-shell.test.tsx`).
- Unit + component: **487 passed** / 178 skipped.
- `pnpm build` (webpack): Compiled successfully, 56 routes.
- E2e: **50 passed / 0 failed**, incl. `locations.spec.ts` **17/17** (Profile
  and Hours clean-load confirmed in both themes — the four that the e2e axe pass
  caught and the fix wave resolved).
- Integration: **178 passed / 0 failed**, incl. `location-capabilities.test.ts`
  (7 role×membership, `RUN_DB_TESTS=true` via `naba_test_runtime`).
- **Protected-path discipline:** `git diff --stat main..HEAD -- app/api
  lib/server lib/domain supabase scripts instrumentation.ts` lists **exactly**
  the two Task-1 sanctioned files. Everything else lives under
  `components/**`, `app/(dashboard)/locations/**`, `lib/api`,
  `lib/locations`, `lib/queries`, `tests/**`, `playwright.config.ts`.

## Whole-branch review (three parallel agents on `5bc2e62`)

- **General (opus): clean.** Tokens/one-h1-one-main/GB-English/no-dep/test
  hygiene all pass. Verified the fix-wave Textarea-context change is
  side-effect-free (only the Profile Description Textarea sits inside a
  `<Field>`; the other three Textarea sites resolve `fieldControlProps(null)`
  → `{}`, explicit props win).
- **Capability/tenant-security (opus): clean.** Exact mirror confirmed for all
  role×membership; no cross-tenant/existence-oracle leak from the
  deliberately-`requireLocationAccess`-free capabilities route (all values
  derive from the requester's own RLS-scoped rows + session role); client
  gating ≥ server guard on every tab; confirmation literals + hash-pinning
  exact.

Notable **jsdom-blindness** confirmation this milestone: the four Profile/Hours
failures were **invisible** to the component (jsdom) tests and were caught only
by the e2e axe pass — the standing lesson held. Both were real product a11y
defects (Textarea had no accessible name inside `<Field>`; Hours skipped
`<h1>`→`<h3>`), fixed in `5bc2e62` **without weakening any guard**.

---

## Carry-forward register

### New security findings (from the capability/tenant-security pass)

- **SEC-1 (M9 / security ticket, PROTECTED file — out of M5 footprint):**
  `app/api/locations/[id]/posts/[postId]/approval/route.ts` `reject` branch runs
  its `gbp_local_post` UPDATE **without `requireLocationAccess`**, so an in-org
  member *not* assigned to a location could send an `awaiting_approval` post
  back to `draft` for that location. Pre-existing (file unchanged on this
  branch), RLS-contained to the same org (no cross-tenant reach), and
  UI-unreachable (`listLocalPosts` 404s that role at `lib/server/posts.ts:223`);
  impact is only a status downgrade. Fix belongs to a protected-path change →
  **M9 hardening / dedicated security ticket.**
- **SEC-2 (minor, defer):** a `canPublish` user who requested their own approval
  hits `403 second_approver_required` on Approve (two-person duty separation).
  Not derivable client-side (`approvalRequestedBy`/`requireTwoPersonApproval`
  aren't in the posts list payload) but surfaces as friendly copy via
  `describeActionError` (not a raw code). Separation-of-duties integrity check,
  not a role escalation — not a spec §9 primary-control violation. Related to
  the M4 **T7-#2 owner decision** (approval-flow affordances).

### Recorded minors from task reviews (all triaged **defer** by the whole-branch review)

1. **T3** `app/(dashboard)/locations/loading.tsx` uses `PageFrame`/`PageHeader`
   (own h1/main) diverging from the sibling `loading.tsx` house style —
   brief-transcribed; innermost Suspense fallback so it never coexists with
   another `<main>`; title/desc match the real page (no flicker).
2. **T4** `location-workspace.tsx` has no `directory.isError` branch (persistent
   directory-query failure → shell renders a placeholder "Location" title with
   no retry; per-tab `TabError` still covers tab loads); Combobox uses
   `itemToStringLabel`+`.map` vs the reference's `itemToStringValue`+render-prop
   (untested — fixtures are single-location, Combobox never mounts).
3. **T5** `profile-tab.tsx` caps-loading race (if the caps query resolves slower
   than the profile query, a viewer's inputs render briefly enabled until caps
   arrive — server routes independently enforce `requireRole`; cosmetic);
   `useDirtyGuard` `confirmDiscard`/`restore` not captured (only `beforeunload`,
   no in-app tab-switch confirm — `LocationTabNav` has no dirty-guard context).
4. **T6** `hours-editor.tsx` special-hours list keyed by array index;
   `useDirtyGuard` `confirmDiscard` copy still reply-specific (unused by Hours).
5. **T7** `photos-tab.tsx` file-input `accept` includes `video/mp4`+
   `video/quicktime` but the tab **always** sends `mediaFormat:"PHOTO"`, so
   picking a video is always rejected server-side with a self-contradicting
   message. **Both reviewers singled this out as "worth doing" — the trivial fix
   is to restrict `accept` to `image/jpeg,image/png`.** `updateMediaCategory`
   (client fn + PATCH route exist) is **not wired** — existing merchant photos
   get Delete only; category is settable only on new adds.
6. **T8** `booking-tab.tsx` `updatePlaceAction` (client fn + PATCH route exist)
   **not wired** — existing links get Remove only, no edit affordance.
7. **T9** `menu-editor.tsx` item name/description inputs share a fixed
   non-indexed `aria-label` across rows (duplicate accessible names — not an axe
   failure); `menu-tab.tsx` renders no section `<h2>` (sibling tabs have one —
   heading tree still passes `heading-order`); `withPrice`'s `Number.parseInt`
   collapses malformed/negative price input to `0` with no client validation
   feedback.
8. **T10** `post-composer.tsx` `topicType` Select not disabled when composing is
   paused (harmless — Save draft stays disabled).
9. **Token nit:** `components/ui/checkbox.tsx` uses `rounded-[4px]` vs the
   `rounded-(--nr-radius-control)` token house style (outside the three named
   prohibitions — cosmetic).

### Larger deferrals to later milestones (from the plan's exit criteria)

- **Server-hydrated/dehydrated Locations (spec §5 prefetch):** the `lib/server`
  read-services already exist, so a later dedicated effort retrofits RSC
  prefetch + dehydrate additively into the same Query keys (D3). Server-side
  `notFound()` for unknown ids (currently client-side after the directory
  loads) folds into this.
- **Business-info / industry / administration consoles → M8** (the quarantined
  `gbp-management-tabs.spec.ts` business-info/industry/administration tests are
  revived then; its photos assertions were extracted into `locations.spec.ts`).
- **Per-location performance tab → M7.** Per-location reviews sub-view → not
  planned (Home + `/inbox?locationId=` cover it).
- **Per-field server-error mapping within the nested Hours/Menu editors**
  (wave-1 surfaces server validation in a form-level alert; the client-safe zod
  mirrors the server rules pre-submit, so server 400s on those bodies are rare;
  the flat Profile form *does* map server `details` paths to fields) → a later
  editors polish.
- **Menu rich per-item attributes** (wave-1 edits names/descriptions/prices,
  preserving unknown keys and each item's own currency) → later menu polish.
- **`moreHours` (kitchen hours) editing** (wave-1 preserves it unchanged) →
  later hours polish.

### Decisions made beyond the locked D1–D12 (flagged, all accepted by review)

(a) capabilities mechanism = a dedicated `GET /api/locations/[id]/capabilities`
route + one `useLocationCapabilities` hook reused across tabs (minimal
two-file protected footprint) over embedding `canEditCanonical` in ~12 files;
(b) client-safe schemas in non-protected `lib/locations/forms/` with parity
tests (because `lib/domain` is protected/consume-only); (c) hand-rolled
`useState`+zod forms, no `react-hook-form` (not installed; D12 forbids new
deps; matches M4); (d) menu prices as string drafts preserving each item's own
`currencyCode` (GBP only as the default for a brand-new price — no edit rewrites
a non-GBP currency); (e) per-tab publish-gate nuance derived from the real
route/service guards: profile publish/import → `canEditCanonical`
(route `requireRole(owner/admin)`); hours/menu/photos/booking publish →
`canPublish` (service `canPublishLocation`); posts compose → `writesEnabled`
with approve/live-delete → `canPublish`; (f) e2e enables the `GBP_*_ENABLED`
flags so write controls are exercisable, with the deterministic write journeys
(canonical save + booking create) driven and the publish-happy-path left to the
integration oracle.
