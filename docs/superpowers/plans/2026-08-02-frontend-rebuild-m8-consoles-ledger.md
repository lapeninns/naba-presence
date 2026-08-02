# M8 Consoles (Business info / Industry / Administration) — SDD ledger & carry-forward register

Preserved from the gitignored SDD progress ledger at merge time. Plan:
`docs/superpowers/plans/2026-08-02-frontend-rebuild-m8-consoles.md` (commit
`cc62380` + plan-review revisions `3702b27`). Merged to `main` as a clean
fast-forward from `e3cd6fb` (M7). Milestone HEAD at merge: `789daa3`.

## What shipped (8 tasks, 42 files, +5.6k) — ZERO protected footprint

The three "raw-JSON consoles" replaced with purpose-built field editors, all as
per-location workspace tabs (nav 7→10), all editing Google directly:

- **Business info** (`/business-information`) — Google-direct structured editor
  (identity/contact/categories via metadata-search Combobox/typed attributes),
  a diff-vs-Google preview (`GoogleDiff`), the update mask computed **silently**
  from touched fields, hash-pinned publish (`expectedGoogleHash`, 409-stale →
  refetch+re-diff), a "not editable here yet" read-only pressure-valve, and a
  cross-link note to the Profile tab. Read-open to all roles; edit gated.
- **Industry** (`/industry`) — lodging / business-calls / healthcare typed
  editors with per-section `{data,error}` panels (`SectionPanel`);
  business-calls masks only `callsState`. Owner/admin-only tab.
- **Administration** (`/administration`) — verification, admins & invitations
  (`AdminsTable`), and the **danger zone**: `delete_admin` / `transfer_location`
  / `delete_location`, each behind a **two-layer confirm** (`DangerZoneDialog`
  typed-location-name gate + the exact backend confirmation literal), with a
  transfer access-loss warning; delete is the Google *permanent* delete, never
  the app-side unlink. Owner/admin-only tab.

**Shared primitives** (T2): `DangerZoneDialog`, `GoogleDiff`, `SectionPanel`,
`AdminsTable`, `TypedAttributeControl` (BOOL/ENUM/URL + read-only fallback), the
`renderWithProviders` test helper, and the `console-labels.ts` humanisation map.

## Key decision — zero protected footprint, client-fetch

Reused `useLocationCapabilities().canEditCanonical` (owner/admin — an *exact*
functional mirror of all three consoles' `requireRole(owner/admin)` mutation
guard) for edit-gating and client-derived tab-visibility (`canManageConsoles`);
`canPublish` + each GET's own `writesEnabled` for the publish gate. A new server
capability was considered and **rejected as redundant** (identical enforcement).
Client-fetched; §5 server-hydration deferred to M9 (consistent with M3–M7).
`lib/domain/business-information.ts` (client-safe zod) was consumed, never
edited. Result: `git diff --stat main..HEAD -- app/api lib/server lib/domain
supabase scripts instrumentation.ts` is **EMPTY**.

## Gate at merge (independently re-run on `789daa3`, GATE GREEN)

typecheck/lint clean; unit+component **627 passed**; build 64 routes; e2e
**92/92** (the revived `gbp-management-tabs.spec.ts` on the new field editors +
the per-role no-403 walk + the danger-zone typed-name journeys in the DB-backed
`locations.spec.ts`); integration **183/183** (untouched parity oracle). Zero
protected edits.

## Whole-branch review (three parallel agents on `789daa3`)

- **General (opus): clean** — zero-protected, tokens, single-h1/main +
  heading-order (test-enforced across all three consoles, both themes),
  humanisation complete (no raw Google enum/mask/code reaches the DOM;
  `describeActionError` never emits a code — test-enforced via
  `not.toContain(code)`), no JSON escape hatch, no new dep.
- **Capability/security (opus): clean** — confirmation literals byte-identical to
  the server for all ops (routed through helpers, no call-site drift); the
  danger-zone two-layer confirm verified for all three destructive ops (typed-name
  gate + empty-name trigger guard + backend literal); no reachable 403 (member/
  viewer never fire the owner/admin-only GET; gated `Empty` state); hash-pin/
  409-refetch solid.
- **Independent gate (sonnet): GATE GREEN.**

**jsdom-blindness lesson held a fifth time this rebuild** — the e2e caught a §7
raw-enum defect the component tests were blind to: Base UI `<SelectValue/>`
resolves its trigger label from `<Select.Item>`s that only register after the
popup is first opened, so on first paint **six** Select triggers across the three
consoles showed the raw Google enum ("ENABLED" instead of "On"). Fixed
(`789daa3`) with a children-render humaniser on every Select, without weakening a
guard; verified deterministic (the trigger reads "On" on first paint).

---

## Carry-forward register → M9

1. **`DangerZoneDialog` empty-`expectedName` defense-in-depth** (security review).
   The dialog's `matches` doesn't itself reject an empty `expectedName` — currently
   unreachable (all three call sites disable their trigger when `locationName` is
   empty), so no live risk; add `&& expectedName.trim().length > 0` to `matches`
   so a future call site can't silently lose the typed-name gate. First-class M9
   hardening item (destructive-action primitive).
2. **`console-labels.ts` "Category" empty-fallback** — `verificationMethodLabel`/
   `verificationStateLabel` fall through to a shared `titleCaseTail` whose
   empty-input fallback is the literal "Category" (carried from `categoryLabel`);
   an empty verification field would render "Category". The only *visibly-wrong*
   copy of the set — do this first in M9 (a neutral placeholder).
3. **Business-info ↔ Profile overlap** (owner decision) — both edit name/
   description/phone/website/address via different mechanisms (M5 Profile =
   canonical/bidirectional; M8 Business-info = Google-direct). Shipped as the
   Google-direct editor with a cross-link note; owner to confirm the dual surface
   vs de-duping.
4. **Industry sub-resources** — 3 of 7 (`lodgingUpdated`/`callInsights`/
   `insuranceNetworks`) are fetched but unrendered (no safe humanisation path);
   healthcare is read-only per §12. Owner to confirm the scope.
5. `administration-tab` InvitationRow Accept/Decline share one `useMutation` (no
   distinguishing pending label) — UX polish.
6. Coverage: no permanent regression test for `accept_invitation` →
   `accept_google_invitation` (mapping verified correct; `console-clients.test`
   guards delete-admin/delete-location but not this).
7. `typed-attribute-control` computes a `"repeated_enum"` kind with no editor
   branch (REPEATED_ENUM falls to the correct read-only note; the computed kind is
   dead) — trivial cleanup.
8. Enum-attribute Select trigger shows Google metadata's `displayName ?? value` —
   if Google omits `displayName`, the raw enum could surface (inherent to
   metadata-driven humanisation; acceptable last-resort, flagged for awareness).

## Accepted deviations (documented, non-blocking)

- **Server-hydration (§5) deferred to M9** — client-fetched, consistent with
  M3–M7; the three console `lib/server` services exist and each GET fans out to
  many slow Google calls, so an M9 RSC-prefetch retrofit would meaningfully help
  perceived latency.
