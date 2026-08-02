# M8 Consoles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three deleted raw-JSON "consoles" with purpose-built editors on their existing per-location backend routes — **Business info**, **Industry**, and **Administration** — closing the audit-flagged spec §8 "Consoles → real editors" clause. Each console edits **Google directly** (there is no NabaPresence canonical storage for these three — unlike the M5 Profile tab), so every write is hash-pinned where the route supports it, humanised (no raw enum/code/mask/JSON reaches a user), and gated so no role can reach a 403 from a primary control. This milestone reuses the M5 `useLocationCapabilities().canEditCanonical` signal as the exact functional mirror of all three routes' `requireRole(["owner","admin"])` mutation guard, so **M8 adds ZERO protected footprint** — no new server capability, route, service, or domain edit. The one genuinely new interaction — Administration's danger zone (remove admin / transfer location / delete location) — is protected by a two-layer confirm: the backend's exact confirmation literal **and** a UI typed-location-name gate.

**Architecture:** Three new route segments join the M5 location workspace: `app/(dashboard)/locations/[id]/{business-information,industry,administration}/page.tsx`, each a sync server page rendering one `"use client"` feature component that reads through TanStack Query over the M1 typed client (`apiFetch` + zod). Every console consumes the same per-location signal M5 established — `useLocationCapabilities(id) → { canEditCanonical, canPublish }` — plus each GET's own `writesEnabled` flag, to gate edit-vs-publish through the shared `lib/locations/gating.ts` disabled-reason helpers and `GateNote`. The three consoles share the M5 building blocks (`OverwriteConfirmDialog` precedent, `TabError`/`TabLoading`, `describeActionError`, `useToastManager`) and add four M8 primitives: a `DangerZoneDialog` (typed-name confirm), a `GoogleDiff` touched-fields preview (distinct from M5's 4-status `CanonicalDiff`), a `SectionPanel` wrapper for the industry/administration `{ data, error }` per-sub-resource envelopes (a failing sub-resource shows its own honest panel, never a whole-tab error), and typed attribute/enum controls. Business info is the Google-direct full-field structured editor (identity / contact / categories via the metadata-search combobox / typed attributes) with a diff-vs-Google preview and an update-mask silently computed from touched fields; industry is lodging / business-calls / healthcare typed editors with per-op masks; administration is read (voice / verification / admins / invitations) + non-destructive actions + the danger zone. Where Google's model exceeds an editor, the field renders **read-only with a "not editable here yet" note** (§12) — never a JSON textarea (§8 forbids escape hatches). Client-fetch only; §5 server-hydration stays deferred to M9, consistent with M3–M7.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives (1.6.0), TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m8-consoles` (cut from `main` @ `e3cd6fb`). Delivery model is **per-milestone merge to `main`** (spec §10). `main` serves a partially-rebuilt product; the three M8 consoles do not exist yet and this milestone lands them.
- **No new dependencies.** Every primitive the consoles need already exists in `@base-ui/react` (`select`, `combobox`, `checkbox`, `alert-dialog`, `dialog`, `field`) or was admitted in M4/M5 (`Table`, `Badge`, `Input`, `Textarea`, `Empty`, `Alert`). M8 admits **no new primitive** — its four new components (`DangerZoneDialog`, `GoogleDiff`, `SectionPanel`, `TypedAttributeControl`) are compositions of existing primitives.
- **Protected paths — do NOT touch, CONSUME ONLY:** `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. **M8 expects ZERO protected-path edits.** If any task appears to need one, STOP and flag it. `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` must be **empty** at merge. `lib/domain/business-information.ts` (`businessInformationPayloadSchema`, `googleAttributeSchema`, `BUSINESS_INFORMATION_UPDATE_MASKS`, `assertBusinessInformationMask`) is pure zod (no `node:crypto`, no `server-only`) and is **imported (consumed), never edited** — direct reuse gives spec §6 client/server validation parity by construction. Everything M8 creates lives under `lib/api/**`, `lib/locations/**`, `lib/queries/**`, `components/**`, `app/(dashboard)/**`, and `tests/**` — all non-protected.
- Styling: M1 tokens only. No raw hex, no `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N` (use `--nr-duration-*`), only defined `--nr-radius-*`/`--nr-gap-*` tokens. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`; icon sizes are `icon|icon-xs|icon-sm|icon-lg`).
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`). TanStack Query hooks carry `staleTime: 30s` (spec §6). Mutations invalidate their keys — the tab re-reads within one round trip. All writes go through the typed client via `ApiClientError { status, code, details }`; server codes map to user copy through the ONE mapping layer `lib/locations/action-errors.ts` (extended with the new codes) — no component invents its own error text or shows a raw code.
- Copy: GB English, sentence case. **No error codes / env-flag names / update masks / raw Google enums (gcid categories, `PRIMARY_OWNER`/`OWNER`/`MANAGER`, attribute `valueType`s, `serviceArea.businessType`, `openInfo.status`, `callsState`, verification methods) / JSON shown to users** — one humanisation/mapping layer (`lib/locations/console-labels.ts`); humanised enums everywhere.
- Client-safe form schemas live in `lib/locations/forms/` (NOT `lib/domain`). Business info reuses the client-safe `lib/domain/business-information.ts` directly; industry/administration add mirrored client-safe schemas under `lib/locations/forms/`.
- Hand-rolled `useState` + zod forms (no react-hook-form — not installed).
- Every page renders exactly one `<h1>` and exactly one `<main>` (both owned by the M5 `PageFrame`/`PageHeader` in the location layout, which also owns the location-name `<h1>`). Each console tab renders `<h2>`/`<h3>` only — **NO second `<h1>` or `<main>`**.
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The gate command (Task 8): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`.

## Design decisions (LOCKED — encode exactly)

- **D1 — ZERO protected footprint; reuse `canEditCanonical`, add no capability.** All three routes gate mutations with `requireRole(["owner","admin"])` (verified: `business-information/route.ts` PATCH, `industry/route.ts` GET+PATCH, `administration/route.ts` GET+POST+PATCH), and their services additionally require `linked.canPublish` (which is unconditionally `true` for owner/admin per `lib/server/capabilities.ts`). So `useLocationCapabilities().canEditCanonical` (`role ∈ {owner,admin}`, from the M5-sanctioned route) is the **exact functional mirror** of the console mutation guard. Use it for edit-gating and tab-visibility; use `canPublish` + each GET's `writesEnabled` for the publish/Google-writes gate. **Do NOT add a new server capability** — it would be byte-identical enforcement to `canEditCanonical`, a redundant protected edit. Every task's Files list must touch NO protected path. `lib/domain/business-information.ts` is imported, not edited. (A purpose-named `consoleCapabilities` was considered and rejected as redundant — recorded in Self-review.)
- **D2 — Client-fetch; §5 server-hydration DEFERRED to M9** (consistent with M3–M7). NOTE: these GETs fan out to many slow Google calls (business-info: 3 parallel; industry: 7; administration: 7), so every console uses the M5 `TabLoading` skeleton and per-section pending states. Server-prefetch would improve perceived latency but is deferred with the rest of §5 as a carry-forward.
- **D3 — Three new location tabs.** Append `business-information` / `industry` / `administration` to `components/locations/location-tab-nav.tsx` (7 → 10 tabs) with human labels **"Business info" / "Industry" / "Administration"** (matching the exact strings the nav test's not-present set already uses), plus `app/(dashboard)/locations/[id]/{business-information,industry,administration}/page.tsx`. **EDIT `tests/components/location-tab-nav.test.tsx` IN PLACE** — move those three labels from the "gone" set into the present set, update the count 7 → 10, and add a `canManageConsoles={false}` case asserting Industry + Administration are hidden while Business info stays. Do NOT append a second test file.
- **D4 — Tab visibility (no reachable 403, §9).** Industry and Administration GET are `requireRole(["owner","admin"])` → they 403 (`permission_denied`) for members/viewers. Their tabs are therefore **hidden** for non-owner/admin, gated on `canEditCanonical` (which the workspace derives from `role`). Belt-and-braces: the industry/administration tab components also short-circuit to a gated `Empty` and set `enabled: caps?.canEditCanonical === true` on their query (caps is `undefined` while the capability query is pending, so the optional-chain + explicit `=== true` keeps the GET disabled until caps resolve rather than throwing), so even a direct URL never fires the 403 GET. Business info GET is `requireSession` (any role reads) → its tab shows for **all** roles, read-only, with edit gated on `canEditCanonical`.
- **D5 — Business info = the Google-direct full-field editor** (§8: identity / contact / categories / typed attributes + diff-vs-Google preview + update-mask-from-TOUCHED-fields, silently — "users never see masks or JSON"). It **coexists** with the M5 Profile tab (the NabaPresence canonical bidirectional editor). They overlap on name / description / phone / website / address but are different mechanisms (Profile = canonical revision-pinned two-way sync; Business info = Google-direct hash-pinned one-way push of the full field set). This presentation overlap is FLAGGED for the owner in Self-review; proceed presenting Business info as the Google-direct editor with clear section framing. The PATCH payload is `businessInformationPayloadSchema.strict()` — so the payload is **built fresh from touched known fields** (only masked fields present, per `assertBusinessInformationMask`), NOT a spread of the raw Google record. Hash-pin every write with `expectedGoogleHash` (`locationHash` for `update_location`, `attributesHash` for `update_attributes`); on `409 business_information_stale` / `attributes_stale` → invalidate + refetch + re-diff.
- **D6 — Industry: typed editors** for lodging / business-calls / healthcare. Render each sub-resource's `{ data, error }` independently through `SectionPanel` (a failing sub-resource shows its own honest panel, not a whole-tab error). The PATCH payload is a **freeform `z.record`** (unlike business-info's strict payload), so follow the menu-editor precedent — spread-and-preserve unknown keys, edit only known leaves. Mask auto-computed from touched top-level keys; per-op confirmation `"publish_industry_data_to_google"`; `update_business_calls` may mask **only** `callsState` (else `422 business_calls_mask_invalid`). Categories do NOT live here (they are a Business-info mask) — industry is lodging / business-calls / healthcare only.
- **D7 — Administration: read + non-destructive + danger zone.** Read: voice-of-merchant / verification state / location+account admins / invitations. Non-destructive: start/complete verification, accept/decline invitation, create/update admin, accept Google's suggested update. **DANGER ZONE** = `delete_admin`, `transfer_location` (with an explicit access-LOSS warning — it moves the Google location to another Google account and the app may lose management access; there is no app-side last-owner guard), `delete_location` (permanent Google deletion). Every danger-zone action requires BOTH the backend's exact confirmation literal (from `CONFIRMATIONS[operation]`) AND a UI typed-name confirmation (type the location's name to enable the destructive button) via the new `DangerZoneDialog`. All danger-zone actions gate on `canEditCanonical` (owner/admin — matching the backend; NOT owner-only, per §11 no-backend-change). The "ownership transfer semantics" ambiguity (Google `transfer_location` moves the whole location to another account vs. promoting an admin to `PRIMARY_OWNER`) is FLAGGED for the owner; proceed with `transfer_location` (the `/administration` op).
- **D8 — Freeform Google JSON follows the menu-editor precedent** for the record-payload consoles (industry, administration): spread-and-PRESERVE unknown keys, edit only known leaves. Business info's payload is strict, so it does NOT spread — it rebuilds masked fields cleanly. HUMANISE raw enums (gcid categories, admin roles, attribute `valueType`s, `serviceArea.businessType`, `openInfo.status`, relation types, `callsState`, verification methods) via one mapping layer `lib/locations/console-labels.ts` (§7). Where Google's model exceeds the editor, render **READ-ONLY with a "not editable here yet" note** (§12) — NEVER a JSON textarea/escape hatch (§8 forbids it).
- **D9 — Delete vs unlink.** The danger-zone "delete location" is the Google **permanent** `delete_location`. The app-side soft unlink (`DELETE /api/location-links`) is a separate Connections/import concern (M6) — do NOT wire the danger zone to unlink. The danger-zone copy names the Google deletion explicitly; a one-line note points to Connections for unlinking without deleting.
- **D10 — Revive `tests/e2e/gbp-management-tabs.spec.ts`.** REWRITE its assertions to the new field editors (its old raw-JSON `Approved payload` / `Operation` / `Resource` assertions and its old `/details|/industry|/administration` page routes are dead; its `page.route`-fulfil bodies for `/business-information`, `/industry`, `/administration` are **accurate GET-shape fixtures** — reuse them verbatim). Un-ignore it in `playwright.config.ts` (`testIgnore` glob). The **per-role no-reachable-403 walk, the danger-zone typed-name journey, and the publish-journey-per-console** belong in the DB-backed `tests/e2e/locations.spec.ts` (which owns the real role cookies via `stub-bridge.ts`) — extend `stub-bridge.ts` with Google matchers for the three consoles and extend the `TABS`/role-walk there. **CODE-WINS CORRECTION:** `gbp-management-tabs.spec.ts` uses client-side `page.route` mocks (never boots the DB/Google stub), so its rewrite is the render/interaction spec; the role/journey obligations layer onto the stub-bridge journey. No new env flag is needed: `playwright.config.ts` already sets `GBP_PROFILE_WRITES_ENABLED: "true"` and `PUBLISH_ENABLED` defaults `true`, so business-info/industry/administration writes are enabled under e2e.

## Backend response shapes consumed (READ-ONLY — M8 sanctions NO edit)

All three routes resolve the Google location via `resolveGbpLocationContext` (`requireLocationAccess` → `409 google_location_not_linked` when unlinked) and expose a per-GET `writesEnabled` flag + a `canPublish`/`canManage` flag equal to `linked.canPublish`.

- **`GET /api/locations/[id]/business-information`** (`requireSession`; **any role reads**) → `{ businessInformation: { location: RawGoogleLocation, attributes: RawGoogleAttributes, attributeMetadata: AttributeMetadata[], locationHash: string(64), attributesHash: string(64), canPublish: boolean, writesEnabled: boolean } }`. `location` is Google's raw resource over READ_MASK (`title, phoneNumbers, profile, storefrontAddress, websiteUri, categories, metadata, serviceArea, storeCode, openInfo, relationshipData, serviceItems, labels`). `attributes` = `{ name, attributes: [{ name, values?, uriValues?, repeatedEnumValue? }] }`. Each `attributeMetadata` entry = `{ parent, displayName, groupDisplayName, valueType, valueMetadata? }`. `writesEnabled = PUBLISH_ENABLED && GBP_PROFILE_WRITES_ENABLED` (`GBP_PROFILE_WRITES_ENABLED` default OFF).
  - **Metadata sub-mode:** `GET ?type=categories|chains&query=<q>&regionCode=GB&languageCode=en` → `{ result }`. Empty `query` → `400 search_query_required`. `result` for categories is Google's `categories.list` shape (`{ categories: [{ name, displayName, ... }] }`); for chains, `searchGoogleChains` (`{ chains: [...] }`).
  - **`PATCH`** (`requireRole(["owner","admin"])`) — discriminated on `operation`:
    - `update_location`: `{ operation:"update_location", confirmation:"publish_business_information_to_google", expectedGoogleHash: string(64), updateMask: BusinessMask[] (min 1), payload: businessInformationPayloadSchema.strict() }`. `updateMask ⊆ BUSINESS_INFORMATION_UPDATE_MASKS = ["title","profile","phoneNumbers","websiteUri","storefrontAddress","categories","serviceArea","serviceItems","labels","storeCode","openInfo","relationshipData"]`; each masked field MUST be present in `payload` (`assertBusinessInformationMask`).
    - `update_attributes`: `{ operation:"update_attributes", confirmation:"publish_business_attributes_to_google", expectedGoogleHash: string(64), attributeMask: string[] (min 1), attributes: googleAttributeSchema[] }`.
  - Success `{ id, status:"succeeded", idempotent }`. Errors: `403 publish_not_allowed`; `503 business_information_paused`; `409 business_information_stale` / `attributes_stale`; `502 business_information_readback_mismatch`; `business_information_update_failed` / `attributes_update_failed`.
- **`GET /api/locations/[id]/industry`** (`requireRole(["owner","admin"])` — members/viewers `403 permission_denied`) → `{ industry: { lodging, lodgingUpdated, calls, callInsights, healthcareServices, providerAttributes, insuranceNetworks, canManage: boolean, writesEnabled: boolean } }`. Each of the seven sub-resources is a `{ data: unknown|null, error: string|null }` envelope (partial-failure isolation). `writesEnabled = PUBLISH_ENABLED` (default ON).
  - **`PATCH`** (`requireRole(["owner","admin"])`): `{ operation: "update_lodging"|"update_business_calls"|"update_healthcare_services"|"update_healthcare_provider_attributes", confirmation:"publish_industry_data_to_google", updateMask: string[] (min 1), payload: Record<string,unknown> }`. `update_business_calls` may mask ONLY `callsState` → else `422 business_calls_mask_invalid`. Errors: `403 publish_not_allowed`; `503 google_writes_paused`; `<operation>_failed`.
- **`GET /api/locations/[id]/administration`** (`requireRole(["owner","admin"])`) → `{ administration: { voice, verifications, verificationOptions, googleUpdated, locationAdmins, accountAdmins, invitations, accountName: string, googleLocationName: string, canManage: boolean, writesEnabled: boolean } }`. Each of the first seven is a `{ data, error }` envelope. `writesEnabled = PUBLISH_ENABLED`.
  - **`POST`** (`requireRole(["owner","admin"])`): `{ operation:"match_location", location: Record<string,unknown> }` → `{ matches }`.
  - **`PATCH`** (`requireRole(["owner","admin"])`): `{ operation: AdminOp, confirmation: string, payload: Record<string,unknown> (default {}) }`. `confirmation` MUST equal `CONFIRMATIONS[operation]` → else `400 administration_confirmation_invalid`. **`CONFIRMATIONS` (transcribe EXACTLY):**
    | operation | confirmation literal | destructive |
    |---|---|---|
    | `start_verification` | `start_google_location_verification` | |
    | `complete_verification` | `complete_google_location_verification` | |
    | `create_admin` | `invite_google_administrator` | |
    | `update_admin` | `change_google_administrator_role` | |
    | `delete_admin` | `remove_google_administrator` | **yes** |
    | `accept_invitation` | `accept_google_invitation` | |
    | `decline_invitation` | `decline_google_invitation` | |
    | `transfer_location` | `transfer_google_location` | **yes** |
    | `create_location` | `create_google_location` | |
    | `delete_location` | `delete_google_location_permanently` | **yes (irreversible)** |
    | `accept_google_update` | `accept_google_suggested_update` | |
  - Payloads: `create_admin { scope?:"account"|location, admin, role, account? }`; `update_admin { name, role }`; `delete_admin { name }`; `accept/decline_invitation { name }`; `transfer_location { destinationAccount }`; `delete_location {}`; `start_verification {...}`; `complete_verification { name, pin }`; `accept_google_update { updateMask, location }`. Errors: `403 publish_not_allowed`; `503 google_writes_paused`; `<operation>_failed`.

**Client-safe imports (consumption, not edits):** `businessInformationPayloadSchema`, `googleAttributeSchema`, `BUSINESS_INFORMATION_UPDATE_MASKS`, `assertBusinessInformationMask` from `@/lib/domain/business-information` (pure zod). `useLocationCapabilities` from `@/lib/queries/use-location-capabilities`; `describeActionError`, `isNotLinkedError` from `@/lib/locations/action-errors`; `editDisabledReason`, `publishDisabledReason` from `@/lib/locations/gating`; `GateNote` from `@/components/locations/publish-gate` (prop `{ reason: string | null }`); `CanonicalDiff`, `TabError`, `TabLoading` from `components/locations/*`; `OverwriteConfirmDialog` (`@/components/locations/overwrite-confirm-dialog`) is available as the string-description confirm **precedent** but is NOT used to host a diff table (it has no children slot — see Task 3).

**Cross-cutting error envelope:** every non-2xx returns `{ error: string (code), message: string, details?: unknown }`; `apiFetch` rethrows it as `ApiClientError { status, code, message, details }`. `describeActionError(code)` maps to copy; the raw `code`/`message` is never rendered. `apiError` emits `invalid_request` (400) with `details = ZodError.issues` for malformed bodies.

## File structure

```
lib/api/
  location-business-information.ts    NEW (Task 1): zod mirror + fetch/publish/metadata clients (reuses lib/domain/business-information)
  location-industry.ts                NEW (Task 1): zod mirror + fetch/publish clients
  location-administration.ts          NEW (Task 1): zod mirror + fetch/match/operation clients + ADMINISTRATION_CONFIRMATIONS + DANGER_ZONE_OPERATIONS
lib/locations/
  forms/industry.ts                   NEW (Task 1): client-safe lodging/business-calls typed leaves + touched-mask helper
  forms/administration.ts             NEW (Task 1): client-safe create/update-admin + transfer payload schemas
  console-labels.ts                   NEW (Task 1): humanisation maps (gcid categories, admin roles, valueTypes, serviceArea/openInfo/relation/callsState/verification enums)
  action-errors.ts                    MODIFY (Task 1): add all M8 codes (no code branch)
lib/queries/
  keys.ts                             MODIFY (Task 1): locationBusinessInformation/Industry/Administration + businessInformationMetadata keys
  use-location-business-information.ts NEW (Task 1): useBusinessInformation(id) + useBusinessInformationMetadata(id,type,query)
  use-location-industry.ts            NEW (Task 1): useIndustry(id, { enabled })
  use-location-administration.ts      NEW (Task 1): useAdministration(id, { enabled })
components/locations/
  section-panel.tsx                   NEW (Task 2): { data, error } sub-resource wrapper (honest per-section states)
  google-diff.tsx                     NEW (Task 2): touched-fields Google-vs-your-edit preview (distinct from CanonicalDiff)
  danger-zone-dialog.tsx              NEW (Task 2): typed-location-name confirm (composes AlertDialog)
  admins-table.tsx                    NEW (Task 2): admins + invitations Table renderer (humanised roles)
  typed-attribute-control.tsx         NEW (Task 2): BOOL/ENUM/URL attribute controls; else read-only "not editable here yet"
  business-information-tab.tsx        NEW (Task 3): structured editor + GoogleDiff + touched→mask + hash-pinned publish + 409-refetch
  industry-tab.tsx                    NEW (Task 4): lodging/business-calls/healthcare typed editors + per-section {data,error} + mask
  administration-tab.tsx              NEW (Task 5+6): read + non-destructive (Task 5) + danger zone (Task 6)
  location-tab-nav.tsx                MODIFY (Task 7): append 3 tabs + canManageConsoles gating
app/(dashboard)/locations/[id]/
  business-information/page.tsx        NEW (Task 3)
  industry/page.tsx                    NEW (Task 4)
  administration/page.tsx              NEW (Task 5)
tests/components/
  console-clients.test.ts              NEW (Task 1)
  console-labels.test.ts               NEW (Task 1)
  console-action-errors.test.ts        NEW (Task 1)
  section-panel.test.tsx               NEW (Task 2)
  google-diff.test.tsx                 NEW (Task 2)
  danger-zone-dialog.test.tsx          NEW (Task 2)
  typed-attribute-control.test.tsx     NEW (Task 2)
  business-information-tab.test.tsx     NEW (Task 3)
  industry-tab.test.tsx                NEW (Task 4)
  administration-tab.test.tsx          NEW (Task 5+6)
  location-tab-nav.test.tsx            MODIFY (Task 7): 7→10 tabs + canManageConsoles hidden case
tests/e2e/
  gbp-management-tabs.spec.ts          REWRITE (Task 8): new editors via page.route fixtures
  locations.spec.ts                    MODIFY (Task 8): 3 console tabs into clean-load loop + role walk + publish + danger-zone journeys
  helpers/stub-bridge.ts               MODIFY (Task 8): Google matchers for the three consoles
playwright.config.ts                   MODIFY (Task 8): un-ignore gbp-management-tabs.spec.ts
```

**Dependency chain:** Tasks **1 → 2** are a hard sequential chain (clients / hooks / humanisers / forms → the primitives that consume their types). After Task 2, Tasks **3** (Business info), **4** (Industry), and **5** (Administration read) can run substantially in parallel — each consumes only Task 1's per-console client + hook and Task 2's shared primitives. **Task 6** (Administration danger zone) extends Task 5's `administration-tab.tsx` (same file) and must land after it. **Task 7** (tab nav + visibility + the nav test edit) needs Tasks 3–6 (it reveals all three pages). **Task 8** is the terminal e2e gate. **No task edits a protected path — M8's footprint under `app/api/**`/`lib/server/**`/`lib/domain/**`/`supabase/**`/`scripts/**`/`instrumentation.ts` is EMPTY** (a hard exit criterion, verified by `git diff --stat`).

---

### Task 1: Console clients + zod mirrors + hooks + humanisation + form schemas + action-error codes

> **No protected-path edit.** Every file is under `lib/api/`, `lib/locations/`, `lib/queries/`, or `tests/`. `lib/domain/business-information.ts` is imported const/schema-only (consumption). `lib/queries/keys.ts` gains four keys.

**Files:**
- Create: `lib/api/location-business-information.ts`, `lib/api/location-industry.ts`, `lib/api/location-administration.ts`, `lib/locations/forms/industry.ts`, `lib/locations/forms/administration.ts`, `lib/locations/console-labels.ts`, `lib/queries/use-location-business-information.ts`, `lib/queries/use-location-industry.ts`, `lib/queries/use-location-administration.ts`
- Modify: `lib/locations/action-errors.ts` (add M8 codes), `lib/queries/keys.ts` (four keys)
- Test: `tests/components/console-clients.test.ts`, `tests/components/console-labels.test.ts`, `tests/components/console-action-errors.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` (`@/lib/api/client`); `z` (`zod`); `businessInformationPayloadSchema`, `googleAttributeSchema`, `BUSINESS_INFORMATION_UPDATE_MASKS` (`@/lib/domain/business-information`); `useQuery` (`@tanstack/react-query`); `queryKeys` (`@/lib/queries/keys`).
- Produces (Tasks 2–8 consume these EXACT signatures):
  - `lib/api/location-business-information.ts`: `type SectionResult` — n/a here; `type AttributeMetadata`, `type GoogleAttribute`, `type BusinessInformationState`; `fetchBusinessInformation(id): Promise<BusinessInformationState>`; `publishBusinessInformation(id, { updateMask, payload, expectedGoogleHash }): Promise<{ id: string; status: string; idempotent: boolean }>`; `publishBusinessAttributes(id, { attributeMask, attributes, expectedGoogleHash }): Promise<{ id: string; status: string; idempotent: boolean }>`; `fetchBusinessInformationMetadata(id, { type, query, regionCode?, languageCode? }): Promise<{ result: unknown }>`.
  - `lib/api/location-industry.ts`: `type SectionResult = { data: unknown; error: string | null }`; `type IndustryState`; `type IndustryOperation`; `fetchIndustry(id): Promise<IndustryState>`; `publishIndustry(id, { operation, updateMask, payload }): Promise<{ id: string; status: string; idempotent: boolean }>`.
  - `lib/api/location-administration.ts`: `type AdministrationState`; `type AdministrationOperation`; `ADMINISTRATION_CONFIRMATIONS: Record<AdministrationOperation, string>`; `DANGER_ZONE_OPERATIONS: ReadonlySet<AdministrationOperation>`; `fetchAdministration(id): Promise<AdministrationState>`; `matchGoogleLocation(id, location): Promise<{ matches: unknown }>`; `runAdministrationOperation(id, { operation, payload? }): Promise<{ id: string; status: string; idempotent: boolean }>` (looks up the confirmation literal internally from `ADMINISTRATION_CONFIRMATIONS`).
  - `lib/locations/forms/industry.ts`: `lodgingLeafSchema`, `businessCallsLeafSchema`; `touchedMask(before, after): string[]` (top-level changed keys).
  - `lib/locations/forms/administration.ts`: `createAdminSchema`/`CreateAdminValues`; `updateAdminSchema`; `transferLocationSchema`.
  - `lib/locations/console-labels.ts`: `categoryLabel(category): string`; `adminRoleLabel(role): string`; `attributeControlKind(valueType): "bool"|"enum"|"repeated_enum"|"url"|"unsupported"`; `serviceAreaLabel`, `openStatusLabel`, `relationTypeLabel`, `callsStateLabel`, `verificationMethodLabel`.
  - `lib/queries/use-location-business-information.ts`: `useBusinessInformation(id)`; `useBusinessInformationMetadata(id, type: "categories"|"chains", query: string)`.
  - `lib/queries/use-location-industry.ts`: `useIndustry(id, options?: { enabled?: boolean })`.
  - `lib/queries/use-location-administration.ts`: `useAdministration(id, options?: { enabled?: boolean })`.
  - `lib/locations/action-errors.ts`: unchanged signature `describeActionError(error): string` — now covers the M8 codes (the existing `status >= 500` fallback handles real 5xx failures).
  - `lib/queries/keys.ts`: `locationBusinessInformation(id)`, `locationIndustry(id)`, `locationAdministration(id)`, `businessInformationMetadata(id, type, query)`.

- [ ] **Step 1: Add the query keys**

Append to `lib/queries/keys.ts` (inside the object, after `locationPosts`):

```ts
  locationBusinessInformation: (id: string) =>
    ["locations", id, "business-information"] as const,
  locationIndustry: (id: string) => ["locations", id, "industry"] as const,
  locationAdministration: (id: string) =>
    ["locations", id, "administration"] as const,
  businessInformationMetadata: (id: string, type: string, query: string) =>
    ["locations", id, "business-information", "metadata", type, query] as const,
```

- [ ] **Step 2: Write the failing humanise + action-error tests**

`tests/components/console-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  adminRoleLabel,
  attributeControlKind,
  callsStateLabel,
  categoryLabel,
  openStatusLabel,
  serviceAreaLabel,
  verificationMethodLabel,
} from "@/lib/locations/console-labels"

describe("console-labels humanisation (§7 — no raw enums to users)", () => {
  it("prefers a category's displayName and never leaks a raw gcid", () => {
    expect(categoryLabel({ name: "categories/gcid:hotel", displayName: "Hotel" })).toBe("Hotel")
    // No displayName -> a humanised gcid tail, never the raw "gcid:" string.
    const fallback = categoryLabel({ name: "categories/gcid:bed_and_breakfast" })
    expect(fallback).not.toMatch(/gcid|_|categories\//)
    expect(fallback.length).toBeGreaterThan(0)
  })
  it("humanises admin roles", () => {
    expect(adminRoleLabel("PRIMARY_OWNER")).toBe("Primary owner")
    expect(adminRoleLabel("OWNER")).toBe("Owner")
    expect(adminRoleLabel("MANAGER")).toBe("Manager")
    expect(adminRoleLabel("SOMETHING_NEW")).not.toMatch(/_/)
  })
  it("maps attribute value types to a control kind", () => {
    expect(attributeControlKind("BOOL")).toBe("bool")
    expect(attributeControlKind("ENUM")).toBe("enum")
    expect(attributeControlKind("REPEATED_ENUM")).toBe("repeated_enum")
    expect(attributeControlKind("URL")).toBe("url")
    expect(attributeControlKind("PHOTOS_LIST")).toBe("unsupported")
  })
  it("humanises the remaining console enums without underscores", () => {
    expect(openStatusLabel("CLOSED_PERMANENTLY")).toBe("Permanently closed")
    expect(serviceAreaLabel("CUSTOMER_LOCATION_ONLY")).not.toMatch(/_/)
    expect(callsStateLabel("ENABLED")).toBe("On")
    expect(verificationMethodLabel("PHONE_CALL")).not.toMatch(/_/)
  })
})
```

`tests/components/console-action-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/locations/action-errors"

describe("describeActionError — M8 console codes", () => {
  it("maps every new console code to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["business_information_paused", 503, /unavailable/i],
      ["business_information_stale", 409, /changed on google/i],
      ["attributes_stale", 409, /changed on google/i],
      ["business_information_readback_mismatch", 502, /did not confirm/i],
      ["google_writes_paused", 503, /unavailable/i],
      ["business_calls_mask_invalid", 422, /calls setting/i],
      ["publish_not_allowed", 403, /permission/i],
      ["permission_denied", 403, /permission/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
})
```

> **Why no `<op>_failed` test (plan-review REV-2):** the services record `${operation}_failed` only as the audit/settle `errorCode`; the re-thrown error reaches the client as its ORIGINAL code (or `internal_error`/500), so the client never receives a `<op>_failed` code. The pre-existing `status >= 500` fallback (see below) already returns honest "…Try again shortly." copy for those real 5xx failures — no dedicated branch or test is warranted.

- [ ] **Step 3: Run to verify failure** — `pnpm exec vitest run tests/components/console-labels.test.ts tests/components/console-action-errors.test.ts --project components`. Expected FAIL (modules/codes missing).

- [ ] **Step 4: Implement `lib/locations/console-labels.ts`**

```ts
// One humanisation layer for the console editors (spec §7). No raw Google enum,
// gcid, valueType, or status code is ever shown to a user.

function titleCaseTail(raw: string): string {
  const tail = raw.split(":").pop() ?? raw
  const words = tail.replace(/^categories\//, "").split(/[_\s]+/).filter(Boolean)
  if (words.length === 0) return "Category"
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ")
}

export function categoryLabel(category: { name?: string; displayName?: string | null }): string {
  if (category.displayName) return category.displayName
  return titleCaseTail(category.name ?? "")
}

const ADMIN_ROLES: Record<string, string> = {
  PRIMARY_OWNER: "Primary owner",
  OWNER: "Owner",
  MANAGER: "Manager",
  SITE_MANAGER: "Site manager",
  COMMUNITY_MANAGER: "Community manager",
}
export function adminRoleLabel(role: string): string {
  return ADMIN_ROLES[role] ?? titleCaseTail(role)
}

export function attributeControlKind(
  valueType: string | undefined
): "bool" | "enum" | "repeated_enum" | "url" | "unsupported" {
  switch (valueType) {
    case "BOOL": return "bool"
    case "ENUM": return "enum"
    case "REPEATED_ENUM": return "repeated_enum"
    case "URL": return "url"
    default: return "unsupported"
  }
}

const OPEN_STATUS: Record<string, string> = {
  OPEN: "Open",
  CLOSED_PERMANENTLY: "Permanently closed",
  CLOSED_TEMPORARILY: "Temporarily closed",
}
export function openStatusLabel(status: string): string {
  return OPEN_STATUS[status] ?? titleCaseTail(status)
}

const SERVICE_AREA: Record<string, string> = {
  CUSTOMER_LOCATION_ONLY: "At the customer's location only",
  CUSTOMER_AND_BUSINESS_LOCATION: "At the business and the customer's location",
}
export function serviceAreaLabel(businessType: string): string {
  return SERVICE_AREA[businessType] ?? titleCaseTail(businessType)
}

const RELATION: Record<string, string> = {
  DEPARTMENT_OF: "Department of",
  INDEPENDENT_ESTABLISHMENT_IN: "Independent establishment in",
}
export function relationTypeLabel(relation: string): string {
  return RELATION[relation] ?? titleCaseTail(relation)
}

export function callsStateLabel(state: string): string {
  if (state === "ENABLED") return "On"
  if (state === "DISABLED") return "Off"
  return titleCaseTail(state)
}

const VERIFICATION_METHOD: Record<string, string> = {
  EMAIL: "Email",
  PHONE_CALL: "Phone call",
  SMS: "Text message",
  ADDRESS: "Postcard by mail",
  VETTED_PARTNER: "Vetted partner",
  AUTO: "Automatic",
}
export function verificationMethodLabel(method: string): string {
  return VERIFICATION_METHOD[method] ?? titleCaseTail(method)
}
```

- [ ] **Step 5: Extend `lib/locations/action-errors.ts`**

Add ONLY the M8 entries to the `COPY` map (no code branch). The existing `describeActionError` body is unchanged — its `status >= 500` fallback already covers the real 5xx failures the industry/administration routes surface (the `${operation}_failed` string is a server-side audit `errorCode` that never reaches the client — plan-review REV-2). Append inside `COPY`:

```ts
  // M8 consoles — business information (Google-direct)
  business_information_paused: "Publishing business information to Google is currently unavailable.",
  business_information_stale: "These details changed on Google since you loaded them. Refresh and try again.",
  attributes_stale: "These attributes changed on Google since you loaded them. Refresh and try again.",
  business_information_readback_mismatch: "Google did not confirm the change. Refresh and try again.",
  // M8 consoles — industry + administration (Google-direct)
  google_writes_paused: "Publishing to Google is currently unavailable.",
  business_calls_mask_invalid: "Only the calls setting can be changed here.",
  search_query_required: "Enter a search term.",
  administration_confirmation_invalid: "We couldn't confirm that action. Refresh and try again.",
```

- [ ] **Step 6: Run humanise + action-error tests to green** — `pnpm exec vitest run tests/components/console-labels.test.ts tests/components/console-action-errors.test.ts --project components`. Expected PASS.

- [ ] **Step 7: Write the failing client tests**

`tests/components/console-clients.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import {
  fetchBusinessInformation,
  fetchBusinessInformationMetadata,
  publishBusinessInformation,
} from "@/lib/api/location-business-information"
import { fetchIndustry, publishIndustry } from "@/lib/api/location-industry"
import {
  ADMINISTRATION_CONFIRMATIONS,
  DANGER_ZONE_OPERATIONS,
  runAdministrationOperation,
} from "@/lib/api/location-administration"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const BUSINESS = {
  businessInformation: {
    location: { title: "Camden Hotel", storeCode: "CAMDEN-1", labels: ["hotel"], openInfo: { status: "OPEN" }, categories: { primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" } } },
    attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [true] }] },
    attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }],
    locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  },
}

describe("fetchBusinessInformation", () => {
  it("parses the envelope, preserves the raw Google location, and keeps both hashes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(BUSINESS)))
    const state = await fetchBusinessInformation("loc-1")
    expect(state.location.title).toBe("Camden Hotel")
    expect(state.attributeMetadata[0].valueType).toBe("BOOL")
    expect(state.locationHash).toHaveLength(64)
    expect(state.writesEnabled).toBe(true)
  })
})

describe("publishBusinessInformation", () => {
  it("PATCHes update_location with the confirmation literal, mask, payload, and hash", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "m1", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await publishBusinessInformation("loc-1", {
      updateMask: ["title"],
      payload: { title: "New name" },
      expectedGoogleHash: "a".repeat(64),
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/locations/loc-1/business-information")
    expect(init.method).toBe("PATCH")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      expectedGoogleHash: "a".repeat(64),
      updateMask: ["title"],
      payload: { title: "New name" },
    })
  })
  it("rethrows a 409 business_information_stale as ApiClientError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "business_information_stale", message: "stale" }, 409)))
    await expect(publishBusinessInformation("loc-1", { updateMask: ["title"], payload: { title: "x" }, expectedGoogleHash: "a".repeat(64) }))
      .rejects.toMatchObject({ constructor: ApiClientError, status: 409, code: "business_information_stale" })
  })
})

describe("fetchBusinessInformationMetadata", () => {
  it("forwards type/query/region/language and returns the raw result", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ result: { categories: [{ name: "categories/gcid:hotel", displayName: "Hotel" }] } }))
    vi.stubGlobal("fetch", fetchMock)
    const out = await fetchBusinessInformationMetadata("loc-1", { type: "categories", query: "hot" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.get("type")).toBe("categories")
    expect(url.searchParams.get("query")).toBe("hot")
    expect(url.searchParams.get("regionCode")).toBe("GB")
    expect(out.result).toMatchObject({ categories: [{ displayName: "Hotel" }] })
  })
})

describe("fetchIndustry / publishIndustry", () => {
  it("parses each sub-resource {data,error} envelope", async () => {
    const available = (data: unknown) => ({ data, error: null })
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ industry: {
      lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({}), calls: available({ callsState: "ENABLED" }),
      callInsights: available({}), healthcareServices: available({}), providerAttributes: available({}), insuranceNetworks: available({}),
      canManage: true, writesEnabled: true,
    } })))
    const state = await fetchIndustry("loc-1")
    expect((state.calls.data as { callsState: string }).callsState).toBe("ENABLED")
    expect(state.calls.error).toBeNull()
    expect(state.canManage).toBe(true)
  })
  it("publishIndustry sends the industry confirmation literal and mask", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "m2", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await publishIndustry("loc-1", { operation: "update_business_calls", updateMask: ["callsState"], payload: { callsState: "DISABLED" } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.confirmation).toBe("publish_industry_data_to_google")
    expect(body.updateMask).toEqual(["callsState"])
  })
})

describe("runAdministrationOperation", () => {
  it("looks up the exact confirmation literal per operation", async () => {
    expect(ADMINISTRATION_CONFIRMATIONS.delete_location).toBe("delete_google_location_permanently")
    expect(DANGER_ZONE_OPERATIONS.has("transfer_location")).toBe(true)
    expect(DANGER_ZONE_OPERATIONS.has("create_admin")).toBe(false)
    const fetchMock = vi.fn(async () => jsonResponse({ id: "m3", status: "succeeded", idempotent: false }))
    vi.stubGlobal("fetch", fetchMock)
    await runAdministrationOperation("loc-1", { operation: "delete_admin", payload: { name: "accounts/1/admins/9" } })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ operation: "delete_admin", confirmation: "remove_google_administrator", payload: { name: "accounts/1/admins/9" } })
  })
})
```

- [ ] **Step 8: Run to verify failure** — `pnpm exec vitest run tests/components/console-clients.test.ts --project components`. Expected FAIL (client modules missing).

- [ ] **Step 9: Implement `lib/api/location-business-information.ts`**

```ts
import { z } from "zod"

import { BUSINESS_INFORMATION_UPDATE_MASKS, businessInformationPayloadSchema, googleAttributeSchema } from "@/lib/domain/business-information"
import { apiFetch } from "./client"

// The Google location + attributes are freeform (they vary by category and by
// what the merchant has set), so keep them as passthrough records — the editor
// reads known leaves and preserves the rest. Only the envelope is pinned.
const attributeMetadataSchema = z.looseObject({
  parent: z.string(),
  displayName: z.string().optional(),
  groupDisplayName: z.string().optional(),
  valueType: z.string().optional(),
})

const businessInformationStateSchema = z.object({
  location: z.record(z.string(), z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  attributeMetadata: z.array(attributeMetadataSchema),
  locationHash: z.string().length(64),
  attributesHash: z.string().length(64),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
})

export type AttributeMetadata = z.infer<typeof attributeMetadataSchema>
export type GoogleAttribute = z.infer<typeof googleAttributeSchema>
export type BusinessInformationState = z.infer<typeof businessInformationStateSchema>
export type BusinessMask = (typeof BUSINESS_INFORMATION_UPDATE_MASKS)[number]

export function fetchBusinessInformation(id: string): Promise<BusinessInformationState> {
  return apiFetch(`/api/locations/${id}/business-information`, {
    schema: z.object({ businessInformation: businessInformationStateSchema }),
  }).then((r) => r.businessInformation)
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function publishBusinessInformation(
  id: string,
  input: { updateMask: BusinessMask[]; payload: z.infer<typeof businessInformationPayloadSchema>; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body: {
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      expectedGoogleHash: input.expectedGoogleHash,
      updateMask: input.updateMask,
      payload: input.payload,
    },
    schema: mutationResultSchema,
  })
}

export function publishBusinessAttributes(
  id: string,
  input: { attributeMask: string[]; attributes: GoogleAttribute[]; expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${id}/business-information`, {
    method: "PATCH",
    body: {
      operation: "update_attributes",
      confirmation: "publish_business_attributes_to_google",
      expectedGoogleHash: input.expectedGoogleHash,
      attributeMask: input.attributeMask,
      attributes: input.attributes,
    },
    schema: mutationResultSchema,
  })
}

export function fetchBusinessInformationMetadata(
  id: string,
  params: { type: "categories" | "chains"; query: string; regionCode?: string; languageCode?: string }
): Promise<{ result: unknown }> {
  const query = new URLSearchParams({ type: params.type, query: params.query, regionCode: params.regionCode ?? "GB", languageCode: params.languageCode ?? "en" })
  return apiFetch(`/api/locations/${id}/business-information?${query}`, { schema: z.object({ result: z.unknown() }) })
}
```

> Note: `z.looseObject`/`z.record` keep unknown Google keys (zod 4). The strict payload validation is enforced server-side by `businessInformationPayloadSchema.strict()`; the client builds that payload in Task 3 and may optionally `.parse()` it with the reused domain schema before sending.

- [ ] **Step 10: Implement `lib/api/location-industry.ts`**

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const sectionResultSchema = z.object({ data: z.unknown(), error: z.string().nullable() })
export type SectionResult<T = unknown> = { data: T; error: string | null }

const industryStateSchema = z.object({
  lodging: sectionResultSchema,
  lodgingUpdated: sectionResultSchema,
  calls: sectionResultSchema,
  callInsights: sectionResultSchema,
  healthcareServices: sectionResultSchema,
  providerAttributes: sectionResultSchema,
  insuranceNetworks: sectionResultSchema,
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
})
export type IndustryState = z.infer<typeof industryStateSchema>
export type IndustryOperation =
  | "update_lodging" | "update_business_calls" | "update_healthcare_services" | "update_healthcare_provider_attributes"

export function fetchIndustry(id: string): Promise<IndustryState> {
  return apiFetch(`/api/locations/${id}/industry`, { schema: z.object({ industry: industryStateSchema }) }).then((r) => r.industry)
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function publishIndustry(
  id: string,
  input: { operation: IndustryOperation; updateMask: string[]; payload: Record<string, unknown> }
) {
  return apiFetch(`/api/locations/${id}/industry`, {
    method: "PATCH",
    body: { operation: input.operation, confirmation: "publish_industry_data_to_google", updateMask: input.updateMask, payload: input.payload },
    schema: mutationResultSchema,
  })
}
```

- [ ] **Step 11: Implement `lib/api/location-administration.ts`**

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const sectionResultSchema = z.object({ data: z.unknown(), error: z.string().nullable() })
export type SectionResult<T = unknown> = { data: T; error: string | null }

const administrationStateSchema = z.object({
  voice: sectionResultSchema,
  verifications: sectionResultSchema,
  verificationOptions: sectionResultSchema,
  googleUpdated: sectionResultSchema,
  locationAdmins: sectionResultSchema,
  accountAdmins: sectionResultSchema,
  invitations: sectionResultSchema,
  accountName: z.string(),
  googleLocationName: z.string(),
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
})
export type AdministrationState = z.infer<typeof administrationStateSchema>

export type AdministrationOperation =
  | "start_verification" | "complete_verification" | "create_admin" | "update_admin" | "delete_admin"
  | "accept_invitation" | "decline_invitation" | "transfer_location" | "create_location" | "delete_location"
  | "accept_google_update"

// Transcribed EXACTLY from app/api/locations/[id]/administration/route.ts CONFIRMATIONS.
export const ADMINISTRATION_CONFIRMATIONS: Record<AdministrationOperation, string> = {
  start_verification: "start_google_location_verification",
  complete_verification: "complete_google_location_verification",
  create_admin: "invite_google_administrator",
  update_admin: "change_google_administrator_role",
  delete_admin: "remove_google_administrator",
  accept_invitation: "accept_google_invitation",
  decline_invitation: "decline_google_invitation",
  transfer_location: "transfer_google_location",
  create_location: "create_google_location",
  delete_location: "delete_google_location_permanently",
  accept_google_update: "accept_google_suggested_update",
}

export const DANGER_ZONE_OPERATIONS: ReadonlySet<AdministrationOperation> = new Set([
  "delete_admin", "transfer_location", "delete_location",
])

export function fetchAdministration(id: string): Promise<AdministrationState> {
  return apiFetch(`/api/locations/${id}/administration`, { schema: z.object({ administration: administrationStateSchema }) }).then((r) => r.administration)
}

export function matchGoogleLocation(id: string, location: Record<string, unknown>): Promise<{ matches: unknown }> {
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "POST",
    body: { operation: "match_location", location },
    schema: z.object({ matches: z.unknown() }),
  })
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function runAdministrationOperation(
  id: string,
  input: { operation: AdministrationOperation; payload?: Record<string, unknown> }
) {
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "PATCH",
    body: { operation: input.operation, confirmation: ADMINISTRATION_CONFIRMATIONS[input.operation], payload: input.payload ?? {} },
    schema: mutationResultSchema,
  })
}
```

- [ ] **Step 12: Implement the form schemas + hooks**

`lib/locations/forms/industry.ts`:

```ts
import { z } from "zod"

// Client-safe leaves for the fields the industry editor actually touches. The
// server payload is a freeform record (z.record) so these mirror only the leaves
// the UI writes — everything else on the Google resource is preserved (D8).
export const businessCallsLeafSchema = z.object({ callsState: z.enum(["ENABLED", "DISABLED"]) })
export const lodgingLeafSchema = z.object({
  policies: z.object({ checkinTime: z.string().optional(), checkoutTime: z.string().optional() }).partial().optional(),
})

// Top-level keys whose value changed between the loaded resource and the draft.
export function touchedMask(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
}
```

`lib/locations/forms/administration.ts`:

```ts
import { z } from "zod"

export const createAdminSchema = z.object({
  scope: z.enum(["account", "location"]),
  admin: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["OWNER", "MANAGER"]),
})
export type CreateAdminValues = z.infer<typeof createAdminSchema>

export const updateAdminSchema = z.object({ name: z.string().min(1), role: z.enum(["OWNER", "MANAGER"]) })
export const transferLocationSchema = z.object({ destinationAccount: z.string().trim().min(1, "Enter the destination Google account.") })
```

`lib/queries/use-location-business-information.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchBusinessInformation, fetchBusinessInformationMetadata } from "@/lib/api/location-business-information"
import { queryKeys } from "./keys"

export function useBusinessInformation(id: string) {
  return useQuery({ queryKey: queryKeys.locationBusinessInformation(id), queryFn: () => fetchBusinessInformation(id), staleTime: 30_000 })
}

export function useBusinessInformationMetadata(id: string, type: "categories" | "chains", query: string) {
  return useQuery({
    queryKey: queryKeys.businessInformationMetadata(id, type, query),
    queryFn: () => fetchBusinessInformationMetadata(id, { type, query }),
    enabled: query.trim().length > 0, // the route 400s on an empty query
    staleTime: 30_000,
  })
}
```

`lib/queries/use-location-industry.ts` and `use-location-administration.ts` (identical shape; administration shown):

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAdministration } from "@/lib/api/location-administration"
import { queryKeys } from "./keys"

export function useAdministration(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.locationAdministration(id),
    queryFn: () => fetchAdministration(id),
    enabled: options?.enabled ?? true, // D4: pass canEditCanonical so a non-owner never fires the 403 GET
    staleTime: 30_000,
  })
}
```

- [ ] **Step 13: Run all Task 1 tests + typecheck/lint** — `pnpm exec vitest run tests/components/console-clients.test.ts tests/components/console-labels.test.ts tests/components/console-action-errors.test.ts --project components && pnpm typecheck && pnpm lint`. Expected PASS.

- [ ] **Step 14: Commit** — `feat(consoles): typed clients, humanisation, and hooks for the three consoles`.

---

### Task 2: Shared M8 primitives (SectionPanel, GoogleDiff, DangerZoneDialog, AdminsTable, TypedAttributeControl)

> **No protected-path edit.** All files under `components/locations/` and `tests/`.

**Files:**
- Create: `tests/components/helpers/render.tsx` (the shared `renderWithProviders` harness Tasks 3–6 import), `components/locations/section-panel.tsx`, `components/locations/google-diff.tsx`, `components/locations/danger-zone-dialog.tsx`, `components/locations/admins-table.tsx`, `components/locations/typed-attribute-control.tsx`
- Test: `tests/components/section-panel.test.tsx`, `tests/components/google-diff.test.tsx`, `tests/components/danger-zone-dialog.test.tsx`, `tests/components/typed-attribute-control.test.tsx`

**Interfaces:**
- Consumes: `AlertDialog*` (`@/components/ui/alert-dialog`), `Button`, `Checkbox`, `Input`, `Select*`, `Table*`, `Badge`, `Alert`/`AlertDescription`, `Empty` (all `@/components/ui/*`); `adminRoleLabel`, `attributeControlKind` (`@/lib/locations/console-labels`); `AttributeMetadata`, `GoogleAttribute` (`@/lib/api/location-business-information`).
- Produces (Tasks 3–6 consume these EXACT signatures):
  - `SectionPanel({ title, result, children }: { title: string; result: { data: unknown; error: string | null }; children: (data: unknown) => React.ReactNode })` — renders the honest per-sub-resource state: `result.error` → a warning `Alert` with generic copy (never the raw Google message); `result.data == null` → an `Empty` "nothing set" state; else `children(result.data)`.
  - `GoogleDiff({ rows }: { rows: Array<{ key: string; label: string; currentValue: string | null; nextValue: string | null }> }))` — a table of the touched fields showing Google's current value vs the value about to be published; distinct from the 4-status `CanonicalDiff`.
  - `DangerZoneDialog({ open, onOpenChange, title, description, expectedName, confirmLabel, pending, onConfirm }: { ...; expectedName: string; ... })` — an `AlertDialog` whose destructive button stays disabled until the typed name === `expectedName` (case-insensitive, trimmed).
  - `AdminsTable({ admins, invitations }: { admins: Array<{ name?: string; admin?: string; role?: string; pendingInvitation?: boolean }>; invitations: Array<{ name?: string; role?: string; targetType?: string }>; renderActions?: (admin) => React.ReactNode })` — humanised-role table.
  - `TypedAttributeControl({ metadata, attribute, disabled, onChange }: { metadata: AttributeMetadata; attribute: GoogleAttribute | undefined; disabled: boolean; onChange: (next: GoogleAttribute) => void })` — BOOL → `Checkbox`, ENUM → `Select`, URL → `Input`; anything else → read-only "not editable here yet".
  - `tests/components/helpers/render.tsx`: `renderWithProviders(ui: React.ReactElement)` — the console-tab test harness.

- [ ] **Step 0: Create the shared render harness (plan-review REV-1)**

`renderWithProviders` does NOT exist yet — the M4/M5 tab tests each declare a per-file local `renderTab()` and `vi.mock` their query hooks. The console tab tests (Tasks 3–6) instead drive the **real** hooks — including `useLocationCapabilities` — through the **global `fetch` stub**, so they need one shared harness. Create `tests/components/helpers/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"

import { Toaster } from "@/components/ui/toast"

// Shared harness for the M8 console tab tests. Unlike the M4/M5 tab tests
// (which vi.mock the query hooks), these tests exercise the REAL hooks —
// useLocationCapabilities, useBusinessInformation/useIndustry/useAdministration —
// via the GLOBAL fetch stub, so the stubbed URL + response shape MUST match the
// typed client. Retries MUST stay off (retry: false) so an error path resolves
// promptly instead of leaving the query pending. Mirrors the existing
// components/locations/menu-tab.test.tsx renderTab() provider stack.
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>{ui}</Toaster>
    </QueryClientProvider>
  )
}
```

> Tasks 3–6 import `renderWithProviders` from `../helpers/render` and each own `stub(...)`/`stubRoutes(...)` a global `fetch` whose `/capabilities` + console-GET URLs and shapes match the clients from Task 1. This "real hook + global stub" pattern (new vs M5's `vi.mock`) works ONLY because the stubbed URL/shape match and retries are disabled.

- [ ] **Step 1: Write the failing tests**

`tests/components/danger-zone-dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DangerZoneDialog } from "@/components/locations/danger-zone-dialog"

describe("DangerZoneDialog (typed-name confirm)", () => {
  it("keeps the destructive button disabled until the exact name is typed", async () => {
    const onConfirm = vi.fn()
    render(
      <DangerZoneDialog
        open
        onOpenChange={() => {}}
        title="Delete this location from Google?"
        description="This permanently deletes the Google listing. It cannot be undone."
        expectedName="Camden Hotel"
        confirmLabel="Delete location"
        pending={false}
        onConfirm={onConfirm}
      />
    )
    const button = screen.getByRole("button", { name: "Delete location" })
    expect(button).toBeDisabled()
    const input = screen.getByLabelText(/type the location's name/i)
    await userEvent.type(input, "camden hotel") // case-insensitive + trimmed match
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
  it("stays disabled for a wrong name", async () => {
    render(
      <DangerZoneDialog open onOpenChange={() => {}} title="t" description="d" expectedName="Camden Hotel" confirmLabel="Delete location" pending={false} onConfirm={() => {}} />
    )
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden")
    expect(screen.getByRole("button", { name: "Delete location" })).toBeDisabled()
  })
})
```

`tests/components/section-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SectionPanel } from "@/components/locations/section-panel"

describe("SectionPanel ({ data, error } honesty)", () => {
  it("shows honest generic copy on error and never the raw Google message", () => {
    render(
      <SectionPanel title="Business calls" result={{ data: null, error: "Google 500: quota exceeded on projects/123" }}>
        {() => <div>should not render</div>}
      </SectionPanel>
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText(/quota exceeded|projects\/123|Google 500/)).not.toBeInTheDocument()
    expect(screen.queryByText("should not render")).not.toBeInTheDocument()
  })
  it("renders children with the data when present", () => {
    render(
      <SectionPanel title="Business calls" result={{ data: { callsState: "ENABLED" }, error: null }}>
        {(data) => <div>calls: {(data as { callsState: string }).callsState}</div>}
      </SectionPanel>
    )
    expect(screen.getByText("calls: ENABLED")).toBeInTheDocument()
  })
})
```

`tests/components/typed-attribute-control.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"

describe("TypedAttributeControl", () => {
  it("renders a BOOL attribute as a checkbox and emits the toggled value", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [false] }}
        disabled={false}
        onChange={onChange}
      />
    )
    await userEvent.click(screen.getByRole("checkbox", { name: "Wi-Fi" }))
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/wifi", values: [true] })
  })
  it("renders an unsupported valueType read-only with the pressure-valve note (§12)", () => {
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/menu", displayName: "Menu", valueType: "PHOTOS_LIST" }}
        attribute={undefined}
        disabled={false}
        onChange={() => {}}
      />
    )
    expect(screen.getByText(/not editable here yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })
})
```

`tests/components/google-diff.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GoogleDiff } from "@/components/locations/google-diff"

describe("GoogleDiff", () => {
  it("shows current-Google vs your-edit for each touched field, em dash for null", () => {
    render(<GoogleDiff rows={[{ key: "title", label: "Business name", currentValue: "Old", nextValue: "New" }, { key: "website", label: "Website", currentValue: null, nextValue: "https://x.test" }]} />)
    expect(screen.getByText("Old")).toBeInTheDocument()
    expect(screen.getByText("New")).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run tests/components/section-panel.test.tsx tests/components/google-diff.test.tsx tests/components/danger-zone-dialog.test.tsx tests/components/typed-attribute-control.test.tsx --project components`. Expected FAIL (components missing).

- [ ] **Step 3: Implement `components/locations/danger-zone-dialog.tsx`**

```tsx
"use client"

import { useState } from "react"

import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// A destructive Google action (remove admin / transfer / delete location) needs
// TWO gates: the route's exact confirmation literal (sent by the client) AND this
// UI typed-name confirmation. The confirm button is inert until the typed name
// matches the location name (trimmed, case-insensitive).
export function DangerZoneDialog({
  open, onOpenChange, title, description, expectedName, confirmLabel, pending, onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  expectedName: string
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  const matches = typed.trim().toLowerCase() === expectedName.trim().toLowerCase()
  return (
    <AlertDialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setTyped("") }}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <Field>
          <FieldLabel>Type the location's name to confirm</FieldLabel>
          <Input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Type the location's name to confirm" placeholder={expectedName} autoComplete="off" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button variant="destructive" onClick={onConfirm} disabled={!matches || pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 4: Implement `section-panel.tsx`, `google-diff.tsx`, `admins-table.tsx`, `typed-attribute-control.tsx`**

`components/locations/section-panel.tsx`:

```tsx
"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"

// One sub-resource of the industry/administration GET is a { data, error } pair.
// A failing sub-resource shows its own honest panel (never the raw Google error
// string, per §7); an empty one shows a "nothing set" note; otherwise its editor.
export function SectionPanel({
  title, result, children,
}: {
  title: string
  result: { data: unknown; error: string | null }
  children: (data: unknown) => React.ReactNode
}) {
  if (result.error) {
    return (
      <Alert variant="warning">
        <AlertDescription>We couldn't load {title.toLowerCase()} from Google right now. Try refreshing in a moment.</AlertDescription>
      </Alert>
    )
  }
  if (result.data == null) {
    return <Empty title={`No ${title.toLowerCase()} set`} description="There is nothing to manage here yet." />
  }
  return <>{children(result.data)}</>
}
```

`components/locations/google-diff.tsx`:

```tsx
"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// A preview of exactly what a Google-direct publish will change: the field, its
// current Google value, and the value about to replace it. Distinct from the M5
// CanonicalDiff (which shows a 4-status canonical/Google reconciliation).
export function GoogleDiff({ rows }: { rows: Array<{ key: string; label: string; currentValue: string | null; nextValue: string | null }> }) {
  if (rows.length === 0) return null
  return (
    <Table className="min-w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Currently on Google</TableHead>
          <TableHead>Will change to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-muted-foreground">{row.currentValue ?? "—"}</TableCell>
            <TableCell>{row.nextValue ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

`components/locations/admins-table.tsx`:

```tsx
"use client"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { adminRoleLabel } from "@/lib/locations/console-labels"

type AdminRow = { name?: string; admin?: string; role?: string; pendingInvitation?: boolean }

export function AdminsTable({
  admins, invitations, renderActions,
}: {
  admins: AdminRow[]
  invitations: Array<{ name?: string; role?: string; targetType?: string }>
  renderActions?: (admin: AdminRow) => React.ReactNode
}) {
  return (
    <Table className="min-w-[520px]">
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          {renderActions ? <TableHead>Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {admins.map((admin, index) => (
          <TableRow key={admin.name ?? index}>
            <TableCell className="font-medium">{admin.admin ?? admin.name ?? "—"}</TableCell>
            <TableCell>{admin.role ? adminRoleLabel(admin.role) : "—"}</TableCell>
            <TableCell><Badge variant="secondary">Active</Badge></TableCell>
            {renderActions ? <TableCell>{renderActions(admin)}</TableCell> : null}
          </TableRow>
        ))}
        {invitations.map((invitation, index) => (
          <TableRow key={invitation.name ?? `inv-${index}`}>
            <TableCell className="font-medium">{invitation.name ?? "—"}</TableCell>
            <TableCell>{invitation.role ? adminRoleLabel(invitation.role) : "—"}</TableCell>
            <TableCell><Badge variant="info">Invited</Badge></TableCell>
            {renderActions ? <TableCell /> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

`components/locations/typed-attribute-control.tsx`:

```tsx
"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AttributeMetadata, GoogleAttribute } from "@/lib/api/location-business-information"
import { attributeControlKind } from "@/lib/locations/console-labels"

// Renders a single typed Google attribute control from its metadata. Only the
// well-understood value types get an editor; anything else is read-only with the
// §12 pressure-valve note — never a JSON escape hatch (§8).
export function TypedAttributeControl({
  metadata, attribute, disabled, onChange,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
}) {
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = attributeControlKind(metadata.valueType)
  const enumOptions = extractEnumOptions(metadata)

  if (kind === "bool") {
    const checked = attribute?.values?.[0] === true
    return (
      <label className="flex items-center gap-2 text-ui">
        <Checkbox checked={checked} disabled={disabled} aria-label={label} onCheckedChange={(next) => onChange({ name, values: [next === true] })} />
        <span>{label}</span>
      </label>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const current = attribute?.repeatedEnumValue?.setValues?.[0] ?? ""
    return (
      <label className="flex flex-col gap-1 text-ui">
        <span>{label}</span>
        <Select value={current} onValueChange={(value: string) => onChange({ name, repeatedEnumValue: { setValues: value ? [value] : [] } })} disabled={disabled}>
          <SelectTrigger aria-label={label}><SelectValue placeholder="Not set" /></SelectTrigger>
          <SelectContent>
            {enumOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    )
  }
  if (kind === "url") {
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <label className="flex flex-col gap-1 text-ui">
        <span>{label}</span>
        <Input value={uri} disabled={disabled} inputMode="url" aria-label={label} onChange={(event) => onChange({ name, uriValues: event.target.value ? [{ uri: event.target.value }] : [] })} />
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 text-ui">
      <span className="font-medium">{label}</span>
      <span className="text-caption text-muted-foreground">Not editable here yet.</span>
    </div>
  )
}

function extractEnumOptions(metadata: AttributeMetadata): Array<{ value: string; label: string }> {
  const meta = metadata as unknown as { valueMetadata?: Array<{ value?: string; displayName?: string }> }
  return (meta.valueMetadata ?? [])
    .filter((entry): entry is { value: string; displayName?: string } => typeof entry.value === "string")
    .map((entry) => ({ value: entry.value, label: entry.displayName ?? entry.value }))
}
```

- [ ] **Step 5: Run the primitive tests to green + typecheck/lint** — `pnpm exec vitest run tests/components/section-panel.test.tsx tests/components/google-diff.test.tsx tests/components/danger-zone-dialog.test.tsx tests/components/typed-attribute-control.test.tsx --project components && pnpm typecheck && pnpm lint`. Expected PASS.

- [ ] **Step 6: Commit** — `feat(consoles): shared danger-zone, google-diff, section-panel, and attribute primitives`.

---

### Task 3: Business info tab (Google-direct structured editor)

> **No protected-path edit.** `components/locations/business-information-tab.tsx` + `app/(dashboard)/locations/[id]/business-information/page.tsx` + a component test.

**Files:**
- Create: `components/locations/business-information-tab.tsx`, `app/(dashboard)/locations/[id]/business-information/page.tsx`
- Test: `tests/components/business-information-tab.test.tsx`

**Interfaces:**
- Consumes: `useBusinessInformation`, `useBusinessInformationMetadata` (`@/lib/queries/use-location-business-information`); `publishBusinessInformation`, `publishBusinessAttributes`, `type BusinessInformationState` (`@/lib/api/location-business-information`); `businessInformationPayloadSchema` (`@/lib/domain/business-information`); `useLocationCapabilities`; `GoogleDiff`, `TypedAttributeControl`, `TabError`, `TabLoading`; `GateNote` (from `@/components/locations/publish-gate`, prop `{ reason: string | null }`); `AlertDialog`, `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogClose` (from `@/components/ui/alert-dialog` — the publish-confirm dialog is a BESPOKE composition that embeds `<GoogleDiff/>`; `OverwriteConfirmDialog` cannot host it because it takes a string `description` and has no children slot); `editDisabledReason`, `publishDisabledReason`; `describeActionError`; `useToastManager`; `categoryLabel`, `openStatusLabel` (`@/lib/locations/console-labels`); `Combobox`, `ComboboxInput`, `ComboboxContent`, `ComboboxItem` (the ONLY four exports of `@/components/ui/combobox` — the category picker composes its own empty/loading; there is NO `ComboboxEmpty`/`ComboboxTrigger`/`ComboboxList`), `Field`/`FieldLabel`/`FieldError`, `Input`, `Textarea`, `Select` (`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`), `Button`, `Badge`.
- Behaviour (LOCKED):
  - Read-open: renders for all roles; edit controls disabled when `!caps.canEditCanonical` (`editDisabledReason`).
  - Structured sections built from the raw Google `location`: **Identity** (title, description via `profile.description`, primary + additional categories via the metadata-search `Combobox`, labels, storeCode, `openInfo.status` via `Select`), **Contact** (`phoneNumbers.primaryPhone`, `websiteUri`, `storefrontAddress.addressLines`/locality/postalCode/regionCode), **Attributes** (typed controls driven by `attributeMetadata`, grouped by `groupDisplayName`).
  - Update mask computed **silently** from touched fields; the PATCH `payload` is built fresh (strict) containing ONLY the touched masked fields (never a spread of the raw record) so `assertBusinessInformationMask` passes; optionally `.parse()` the payload with the reused `businessInformationPayloadSchema` before send.
  - Two publish paths: `update_location` (identity/contact/categories/etc. via `locationHash`) and `update_attributes` (typed attributes via `attributesHash`), each hash-pinned; the `GoogleDiff` preview lists the touched fields before confirm.
  - On `409 business_information_stale`/`attributes_stale` → invalidate + refetch (the tab re-diffs against fresh Google); toast the mapped copy.
  - Complex/unsupported leaves (`serviceItems`, `relationshipData`, `serviceArea` beyond `businessType`, `moreHours`) render **read-only "not editable here yet"** (§12).
  - **Business-info / Profile overlap cross-link (plan-review adjudication — keep both, don't de-dup):** because name / description / phone / website / address are ALSO editable on the M5 Profile tab (via the NabaPresence canonical two-way sync), render a light in-UI note near the identity/contact sections — e.g. a muted caption "These details also sync via the Profile tab, which keeps them in step with NabaPresence." (link to `/locations/[id]`) — so users aren't confused by two name-editing surfaces. This is a note, not a gate. (The owner flag on whether to keep the dual surface remains in Self-review.)
  - `<h2>`/`<h3>` only.

- [ ] **Step 1: Write the failing component test**

`tests/components/business-information-tab.test.tsx` (pins: read-open renders identity; a member sees no editable controls; touched title → publish sends the right mask/payload/hash; unsupported field shows the pressure valve). Uses `renderWithProviders` from `../helpers/render` (Task 2 Step 0) and drives the REAL `useLocationCapabilities` + `useBusinessInformation` hooks through the global `fetch` stub (`stubRoutes`) — the `/capabilities` and `/business-information` URLs + shapes match the Task 1 clients, and retries are disabled so error paths resolve promptly.

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BusinessInformationTab } from "@/components/locations/business-information-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const STATE = {
  businessInformation: {
    location: { title: "Camden Hotel", profile: { description: "A calm stay" }, websiteUri: "https://camden.test", storeCode: "CAMDEN-1", openInfo: { status: "OPEN" }, labels: ["hotel"], serviceItems: [{ foo: 1 }], categories: { primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" } } },
    attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [false] }] },
    attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }],
    locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  },
}

function stubRoutes(overrides?: { caps?: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: overrides?.caps ?? { canEditCanonical: true, canPublish: true } })
    if (url.includes("/business-information")) return jsonResponse(STATE)
    return jsonResponse({})
  }))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("BusinessInformationTab", () => {
  it("renders humanised identity fields and the §12 pressure valve for unsupported data", async () => {
    stubRoutes()
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    expect(await screen.findByDisplayValue("Camden Hotel")).toBeInTheDocument()
    expect(screen.getByText("Hotel")).toBeInTheDocument() // humanised category, not the gcid
    expect(screen.queryByText(/gcid:/)).not.toBeInTheDocument()
    // serviceItems has no editor -> read-only pressure valve.
    expect(screen.getAllByText(/not editable here yet/i).length).toBeGreaterThan(0)
  })

  it("hides editing for a member (read-open, edit-gated)", async () => {
    stubRoutes({ caps: { canEditCanonical: false, canPublish: false } })
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    expect(await screen.findByDisplayValue("Camden Hotel")).toBeDisabled()
    expect(screen.getByText("Only owners and admins can edit this location.")).toBeInTheDocument()
  })

  it("publishes only the touched field with its mask, strict payload, and locationHash", async () => {
    stubRoutes()
    const fetchSpy = vi.mocked(fetch)
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    const title = await screen.findByDisplayValue("Camden Hotel")
    await userEvent.clear(title)
    await userEvent.type(title, "Camden Boutique Hotel")
    await userEvent.click(screen.getByRole("button", { name: /publish/i }))
    // confirm in the GoogleDiff dialog
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }))
    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      expect(patch).toBeTruthy()
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_location")
      expect(body.confirmation).toBe("publish_business_information_to_google")
      expect(body.updateMask).toEqual(["title"])
      expect(body.payload).toEqual({ title: "Camden Boutique Hotel" })
      expect(body.expectedGoogleHash).toBe("a".repeat(64))
    })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run tests/components/business-information-tab.test.tsx --project components`. Expected FAIL (component missing).

- [ ] **Step 3: Implement the tab** — `components/locations/business-information-tab.tsx` (structure below; follows the M5 `ProfileTab` load/loaded split + revision-ref reset pattern, adapted to Google-hash pinning instead of a canonical revision).

Key load-bearing logic:

```tsx
// --- touched → mask + strict payload (silent; users never see masks/JSON) ---
// Build the update_location payload from ONLY the fields the user changed. Each
// entry maps a form leaf to its Google shape; the mask is exactly the keys present.
function buildLocationUpdate(initial: Draft, draft: Draft): { updateMask: BusinessMask[]; payload: Record<string, unknown> } {
  const payload: Record<string, unknown> = {}
  const mask: BusinessMask[] = []
  if (draft.title !== initial.title) { payload.title = draft.title; mask.push("title") }
  if (draft.description !== initial.description) { payload.profile = { description: draft.description }; mask.push("profile") }
  if (draft.primaryPhone !== initial.primaryPhone) { payload.phoneNumbers = { primaryPhone: draft.primaryPhone }; mask.push("phoneNumbers") }
  if (draft.websiteUri !== initial.websiteUri) { payload.websiteUri = draft.websiteUri; mask.push("websiteUri") }
  if (draft.openStatus !== initial.openStatus) { payload.openInfo = { status: draft.openStatus }; mask.push("openInfo") }
  if (draft.storeCode !== initial.storeCode) { payload.storeCode = draft.storeCode; mask.push("storeCode") }
  if (JSON.stringify(draft.labels) !== JSON.stringify(initial.labels)) { payload.labels = draft.labels; mask.push("labels") }
  if (draft.primaryCategory?.name !== initial.primaryCategory?.name || JSON.stringify(draft.additionalCategories) !== JSON.stringify(initial.additionalCategories)) {
    payload.categories = { primaryCategory: { name: draft.primaryCategory!.name }, additionalCategories: draft.additionalCategories.map((c) => ({ name: c.name })) }
    mask.push("categories")
  }
  if (draft.addressLines.join("\n") !== initial.addressLines.join("\n") || draft.locality !== initial.locality || draft.postalCode !== initial.postalCode) {
    payload.storefrontAddress = { regionCode: draft.regionCode, addressLines: draft.addressLines, locality: draft.locality, postalCode: draft.postalCode }
    mask.push("storefrontAddress")
  }
  return { updateMask: mask, payload }
}
```

- Publish flow: on "Publish to Google", compute `{ updateMask, payload }`; if `mask.length === 0` disable/short-circuit; open a **bespoke `AlertDialog`** (NOT `OverwriteConfirmDialog`, which has no children slot) that embeds `<GoogleDiff rows={…}/>` listing each touched field's current-Google vs will-change-to value, with a "Cancel" (`AlertDialogClose`) and a "Publish" confirm button; on confirm, `publishBusinessInformation(id, { updateMask, payload, expectedGoogleHash: state.locationHash })`; `onSuccess` → close the dialog + invalidate `queryKeys.locationBusinessInformation(id)` + toast "Published to Google"; `onError` → toast `describeActionError` (a 409 stale toast plus the auto-refetch re-diffs). Reference shape of the confirm dialog:

  ```tsx
  <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
    <AlertDialogContent>
      <AlertDialogTitle>Publish these details to Google?</AlertDialogTitle>
      <AlertDialogDescription>Review the changes before they replace what is on your Google Business Profile.</AlertDialogDescription>
      <GoogleDiff rows={diffRows} />
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
        <Button onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending ? "Working…" : "Publish"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  ```
- Attributes publish is a parallel section: touched attributes → `attributeMask` (names) + `attributes` array; `publishBusinessAttributes(id, { attributeMask, attributes, expectedGoogleHash: state.attributesHash })`.
- Optional strict validation before send: `businessInformationPayloadSchema.parse(payload)` — surfaces a client-side field error using the same `serverFieldErrors` mapping the M5 ProfileTab uses (path-based), keeping copy honest.
- `editReason = editDisabledReason(caps)`; disable every control + Save/Publish when set; `publishReason = editDisabledReason(caps) ?? publishDisabledReason(caps, state.writesEnabled)` for the Google-writes gate (writes off → "currently unavailable", never a flag name).
- Reset local draft only when `state.locationHash`/`attributesHash` advances (ref-guard, mirroring ProfileTab's revision ref) so a refetch after publish repopulates cleanly.

`app/(dashboard)/locations/[id]/business-information/page.tsx`:

```tsx
import { BusinessInformationTab } from "@/components/locations/business-information-tab"

export default async function BusinessInformationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BusinessInformationTab locationId={id} />
}
```

- [ ] **Step 4: Run the test + gate** — `pnpm exec vitest run tests/components/business-information-tab.test.tsx --project components && pnpm typecheck && pnpm lint && pnpm build`. Expected PASS.

- [ ] **Step 5: Commit** — `feat(consoles): business info Google-direct structured editor`.

---

### Task 4: Industry tab (lodging / business-calls / healthcare typed editors)

> **No protected-path edit.** `components/locations/industry-tab.tsx` + page + test.

**Files:**
- Create: `components/locations/industry-tab.tsx`, `app/(dashboard)/locations/[id]/industry/page.tsx`
- Test: `tests/components/industry-tab.test.tsx`

**Interfaces:**
- Consumes: `useIndustry` (with `enabled: caps?.canEditCanonical === true`), `publishIndustry`, `type IndustryState` (`@/lib/api/location-industry`); `useLocationCapabilities`; `SectionPanel`, `TabError`, `TabLoading`, `GateNote` (from `@/components/locations/publish-gate`); `touchedMask` (`@/lib/locations/forms/industry`); `callsStateLabel` (`@/lib/locations/console-labels`); `describeActionError`; `Select` (`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`), `Input`, `Button`, `Badge`, `Empty`. Industry saves apply directly (Google-direct, no canonical drift), so NO `OverwriteConfirmDialog` gate is used.
- Behaviour (LOCKED):
  - **Tab hidden for non-owner/admin** (D4). The component also guards: if `caps?.canEditCanonical !== true`, render an `Empty` "This section is available to owners and admins" and do NOT fire the GET (`enabled: caps?.canEditCanonical === true`) — so a direct URL never hits the 403.
  - Three sections through `SectionPanel` (each `{ data, error }`): **Lodging** (edit known leaves e.g. `policies.checkinTime`/`checkoutTime`; spread-and-preserve the rest, D8; mask = touched top-level keys; op `update_lodging`), **Business calls** (a `Select` on `callsState` ENABLED/DISABLED, humanised On/Off; mask is EXACTLY `["callsState"]` — the only allowed mask, else `422 business_calls_mask_invalid`; op `update_business_calls`), **Healthcare** (services/provider attributes — render read-only summaries with the §12 note where no typed editor exists; op `update_healthcare_services`/`update_healthcare_provider_attributes` reserved).
  - Each publish sends `confirmation: "publish_industry_data_to_google"`; on success invalidate `queryKeys.locationIndustry(id)`.
  - Publish gate: `publishDisabledReason(caps, state.writesEnabled)`.

- [ ] **Step 1: Write the failing test** — pins: (a) a member sees the gated Empty and NO industry GET is issued; (b) owner toggling business-calls sends mask `["callsState"]` + the industry confirmation; (c) a failed sub-resource renders `SectionPanel`'s honest warning, not the raw error.

```tsx
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { IndustryTab } from "@/components/locations/industry-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const INDUSTRY = { industry: {
  lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({}),
  calls: available({ callsState: "ENABLED" }), callInsights: available({}),
  healthcareServices: { data: null, error: "Google 500 boom" }, providerAttributes: available({}), insuranceNetworks: available({}),
  canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stub(caps: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/industry")) return jsonResponse(INDUSTRY)
    return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("IndustryTab", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/industry"))).toBe(false)
  })

  it("shows the honest section error, never the raw Google message", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    expect(await screen.findByText(/couldn't load healthcare/i)).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it("business-calls publish sets callsState, masks only callsState, and sends the industry confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<IndustryTab locationId="loc-1" />)
    // The calls control is a base-ui Select (NOT a native <select>), so drive it
    // for real: open the trigger, then click the humanised "Off" option (value
    // DISABLED). No `?.`/`.catch()` — the interaction must actually change state.
    await userEvent.click(await screen.findByRole("combobox", { name: "Calls" }))
    await userEvent.click(await screen.findByRole("option", { name: "Off" }))
    await userEvent.click(screen.getByRole("button", { name: /save calls/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_business_calls")
      expect(body.payload.callsState).toBe("DISABLED") // the interaction actually changed the value
      expect(body.updateMask).toEqual(["callsState"])
      expect(body.confirmation).toBe("publish_industry_data_to_google")
    })
  })
})
```

> **Base-ui Select roles (REV-3 note):** the styled `SelectTrigger` exposes `role="combobox"` and its accessible name comes from `aria-label="Calls"`; each `SelectItem` is `role="option"` with its humanised child text ("On"/"Off" via `callsStateLabel`). The industry business-calls editor must render `<SelectTrigger aria-label="Calls">` and options `On` (ENABLED) / `Off` (DISABLED) for these queries to resolve.

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement** `industry-tab.tsx` + page (mirroring the business-info structure; sections via `SectionPanel`; the calls editor hard-codes `updateMask: ["callsState"]` and sends `payload: { callsState }`; lodging uses `touchedMask(loadedLodging, draftLodging)` over the spread-preserved record). **Step 4: gate. Step 5: Commit** — `feat(consoles): industry lodging/business-calls/healthcare editors`.

---

### Task 5: Administration tab — read + non-destructive actions

> **No protected-path edit.** `components/locations/administration-tab.tsx` + page + test. Task 6 extends the SAME component with the danger zone.

**Files:**
- Create: `components/locations/administration-tab.tsx`, `app/(dashboard)/locations/[id]/administration/page.tsx`
- Test: `tests/components/administration-tab.test.tsx`

**Interfaces:**
- Consumes: `useAdministration` (with `enabled: caps?.canEditCanonical === true`), `runAdministrationOperation`, `matchGoogleLocation`, `type AdministrationState` (`@/lib/api/location-administration`); `useLocationCapabilities`; `SectionPanel`, `AdminsTable`, `TabError`, `TabLoading`, `GateNote` (from `@/components/locations/publish-gate`); `createAdminSchema`, `updateAdminSchema` (`@/lib/locations/forms/administration`); `verificationMethodLabel`, `adminRoleLabel` (`@/lib/locations/console-labels`); `describeActionError`; `Dialog*`/`Field*`/`Select*`/`Input`/`Button`/`Badge`.
- Behaviour (LOCKED):
  - Tab hidden for non-owner/admin (D4); component guards + `enabled: caps?.canEditCanonical === true`.
  - **Read sections** through `SectionPanel`: voice-of-merchant summary (verified / not verified — humanised, no raw flag), verification state + options (`verificationMethodLabel`), location admins + account admins + invitations via `AdminsTable`.
  - **Non-destructive actions:** start verification (choose a humanised method → `runAdministrationOperation({ operation: "start_verification", payload })`), complete verification (`{ name, pin }`), accept/decline invitation (`{ name }`), create admin (a `Dialog` form: scope account/location, email, role OWNER/MANAGER — validated by `createAdminSchema`; `operation: "create_admin"`), update admin role (`operation: "update_admin"`, `{ name, role }`), accept Google's suggested update (`operation: "accept_google_update"`, `{ updateMask, location }` from `googleUpdated.data`).
  - Every action invalidates `queryKeys.locationAdministration(id)`; per-action pending on its own button; publish gate via `publishDisabledReason(caps, state.writesEnabled)`.
  - `<h2>`/`<h3>` only.

- [ ] **Step 1: Write the failing test** — pins: (a) member → gated Empty, no GET; (b) admins render with humanised roles ("Primary owner", not `PRIMARY_OWNER`); (c) create-admin sends `operation:"create_admin"` + `confirmation:"invite_google_administrator"`; (d) accept-invitation sends `confirmation:"accept_google_invitation"`.

```tsx
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { AdministrationTab } from "@/components/locations/administration-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const ADMIN = { administration: {
  voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }),
  verificationOptions: available({ options: [{ verificationMethod: "PHONE_CALL" }] }), googleUpdated: available(null),
  locationAdmins: available({ admins: [{ admin: "owner@camden.test", role: "PRIMARY_OWNER" }] }),
  accountAdmins: available({ admins: [] }), invitations: available({ invitations: [] }),
  accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function stub(caps: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/administration")) return jsonResponse(ADMIN)
    return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
  })
  vi.stubGlobal("fetch", fetchMock); return fetchMock
}

describe("AdministrationTab (read + non-destructive)", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/administration"))).toBe(false)
  })
  it("humanises admin roles", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("Primary owner")).toBeInTheDocument()
    expect(screen.queryByText("PRIMARY_OWNER")).not.toBeInTheDocument()
  })
  it("create-admin sends the create_admin operation + confirmation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /add administrator/i }))
    await userEvent.type(screen.getByLabelText(/email/i), "new@camden.test")
    await userEvent.click(screen.getByRole("button", { name: /send invitation/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("create_admin")
      expect(body.confirmation).toBe("invite_google_administrator")
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement** the read + non-destructive component (the page passes `locationName` from the directory for the Task 6 danger-zone typed-name; obtain it via the workspace directory or a light `fetchManagementLocations` — reuse the M5 `useLocationDirectory`). **Step 4: gate. Step 5: Commit** — `feat(consoles): administration read + non-destructive actions`.

`app/(dashboard)/locations/[id]/administration/page.tsx` passes the id; the tab reads the location name from `useLocationDirectory(role)` (role from a light `useSession`, or accept `locationName` prop wired by the workspace). Simplest: the tab fetches the directory itself and looks up `locationName` for the danger zone.

---

### Task 6: Administration danger zone (remove admin / transfer / delete location)

> **No protected-path edit.** Extends `components/locations/administration-tab.tsx`; extends `tests/components/administration-tab.test.tsx`.

**Files:**
- Modify: `components/locations/administration-tab.tsx` (add the danger-zone section), `tests/components/administration-tab.test.tsx` (add danger-zone cases)

**Interfaces:**
- Consumes: `DangerZoneDialog` (`@/components/locations/danger-zone-dialog`); `runAdministrationOperation`, `DANGER_ZONE_OPERATIONS` (`@/lib/api/location-administration`); `transferLocationSchema` (`@/lib/locations/forms/administration`).
- Behaviour (LOCKED — the one genuinely new interaction):
  - A visually distinct **"Danger zone"** section (`<h3>`), owner/admin-gated (already the whole tab), containing three actions, each opening the `DangerZoneDialog` (typed-location-name gate) AND sending the backend confirmation literal via `runAdministrationOperation`:
    - **Remove an administrator** (`delete_admin`, `{ name }`, confirmation `remove_google_administrator`) — row-level action in `AdminsTable`'s `renderActions`.
    - **Transfer this location** (`transfer_location`, `{ destinationAccount }`, confirmation `transfer_google_location`) — with an explicit access-LOSS warning: "This moves the Google location to another Google account. NabaPresence may lose the ability to manage it, and this cannot be undone from here." Collect `destinationAccount` (validated by `transferLocationSchema`) THEN require the typed name.
    - **Delete this location** (`delete_location`, `{}`, confirmation `delete_google_location_permanently`) — copy: "This permanently deletes the Google listing. It cannot be undone." A one-line note: "To stop managing a location without deleting it from Google, unlink it under Connections." (D9 — never wires to the unlink route.)
  - Each danger action invalidates `queryKeys.locationAdministration(id)` on success; toast the mapped copy on error (`describeActionError`).

- [ ] **Step 1: Add the failing danger-zone tests** — pins: (a) delete button stays disabled until the exact location name is typed; (b) confirming delete sends `operation:"delete_location"` + `confirmation:"delete_google_location_permanently"` + empty payload; (c) transfer requires both `destinationAccount` and the typed name and sends `transfer_google_location`.

```tsx
it("delete-location requires the typed name and sends the permanent-delete confirmation", async () => {
  const fetchMock = stub({ canEditCanonical: true, canPublish: true })
  renderWithProviders(<AdministrationTab locationId="loc-1" locationName="Camden Hotel" />)
  await userEvent.click(await screen.findByRole("button", { name: /delete this location/i }))
  const confirm = screen.getByRole("button", { name: "Delete location" })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
  expect(confirm).toBeEnabled()
  await userEvent.click(confirm)
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
    const body = JSON.parse((patch![1] as RequestInit).body as string)
    expect(body).toEqual({ operation: "delete_location", confirmation: "delete_google_location_permanently", payload: {} })
  })
})
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement** the danger-zone section, **Step 4: gate, Step 5: Commit** — `feat(consoles): administration danger zone with typed-name confirmation`.

---

### Task 7: Tab nav wiring + console visibility + nav test edit

> **No protected-path edit.** `components/locations/location-tab-nav.tsx` + `tests/components/location-tab-nav.test.tsx` + a small wiring change in `components/locations/location-workspace.tsx`.

**Files:**
- Modify: `components/locations/location-tab-nav.tsx` (append 3 tabs + `canManageConsoles` gating), `components/locations/location-workspace.tsx` (pass `canManageConsoles` derived from role), `tests/components/location-tab-nav.test.tsx` (7 → 10 + hidden case)

**Interfaces:**
- `LocationTabNav({ locationId, canManageConsoles }: { locationId: string; canManageConsoles: boolean })` — Business info always shown; Industry + Administration shown only when `canManageConsoles` (≡ `canEditCanonical`, i.e. `role ∈ {owner,admin}`).

- [ ] **Step 1: Edit the nav test IN PLACE** (per D3). Replace the single test with two, updating the present set to 10 and adding the hidden case:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1/administration" }))

describe("LocationTabNav", () => {
  it("renders all ten tabs for an owner/admin and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles />)
    for (const label of ["Profile", "Hours", "Photos", "Posts", "Booking", "Menu", "Performance", "Business info", "Industry", "Administration"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    const active = screen.getByRole("link", { name: "Administration" })
    expect(active).toHaveAttribute("href", "/locations/loc-1/administration")
    expect(active).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument()
  })

  it("hides the owner/admin-only consoles for a member (no reachable 403)", () => {
    render(<LocationTabNav locationId="loc-1" canManageConsoles={false} />)
    expect(screen.getByRole("link", { name: "Business info" })).toBeInTheDocument() // read-open
    for (const gone of ["Industry", "Administration"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run tests/components/location-tab-nav.test.tsx --project components`. Expected FAIL (prop + tabs missing).

- [ ] **Step 3: Edit `location-tab-nav.tsx`** — extend `TABS` with a `consoleGated` flag and filter:

```tsx
const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
  { segment: "performance", label: "Performance" },
  { segment: "business-information", label: "Business info" },
  { segment: "industry", label: "Industry", consoleGated: true },
  { segment: "administration", label: "Administration", consoleGated: true },
] as const

export function LocationTabNav({ locationId, canManageConsoles }: { locationId: string; canManageConsoles: boolean }) {
  // ...existing pathname/activeRef logic...
  const tabs = TABS.filter((tab) => !("consoleGated" in tab && tab.consoleGated) || canManageConsoles)
  // render `tabs` instead of `TABS`
}
```

- [ ] **Step 4: Wire the workspace** — in `location-workspace.tsx`, compute `const canManageConsoles = role === "owner" || role === "admin"` (the exact definition of `canEditCanonical`) and pass `<LocationTabNav locationId={locationId} canManageConsoles={canManageConsoles} />`. (No new fetch; the shell already has `role`.)

- [ ] **Step 5: Run the test + full unit suite + build** — `pnpm exec vitest run tests/components/location-tab-nav.test.tsx --project components && pnpm test && pnpm typecheck && pnpm lint && pnpm build`. Expected PASS.

- [ ] **Step 6: Commit** — `feat(consoles): reveal the three console tabs with owner/admin visibility gating`.

---

### Task 8: E2e revival + stub-bridge Google matchers + full gate

> **No protected-path edit.** `tests/e2e/*` + `playwright.config.ts` (non-protected). Leave the whole-branch review to the controller.

**Files:**
- Rewrite: `tests/e2e/gbp-management-tabs.spec.ts` (new-editor assertions on the reused GET fixtures)
- Modify: `tests/e2e/locations.spec.ts` (3 console tabs into the clean-load + a11y loop; role walk; publish + danger-zone journeys), `tests/e2e/helpers/stub-bridge.ts` (Google matchers for the three consoles), `playwright.config.ts` (remove the `gbp-management-tabs.spec.ts` `testIgnore` glob)

- [ ] **Step 1: Un-ignore + rewrite `gbp-management-tabs.spec.ts`.** Remove `"**/gbp-management-tabs.spec.ts"` from `playwright.config.ts` `testIgnore`. Keep the three `page.route` fixture bodies **verbatim** — the plan-reviewer verified they match the real GET shapes (each sub-resource `{ data, error }` envelope, 64-char `locationHash`/`attributesHash`, `canManage`/`canPublish`/`writesEnabled` booleans) — but point the page at the NEW routes and rewrite the assertions to the field editors:
  - Business info: `page.goto("/locations/location-management/business-information")`; assert `getByDisplayValue("Camden Hotel")`, the humanised category "Hotel" is visible, NO `/gcid:/` text, the "Publish to Google" button exists, and at least one "not editable here yet" note (from `serviceItems`/unsupported data).
  - Industry: `page.goto("/locations/location-management/industry")`; assert the business-calls control shows the humanised On/Off (not `ENABLED`), and a failing sub-resource (if seeded) shows the honest section warning.
  - Administration: `page.goto("/locations/location-management/administration")`; assert the admins table shows "Primary owner" (not `PRIMARY_OWNER`), the "Danger zone" heading is present, and the delete button is disabled until the typed name.
  - Delete the dead `Approved payload` / `Operation` / `Resource` / raw-JSON assertions entirely.

- [ ] **Step 2: Extend `stub-bridge.ts`** with Google matchers for the three consoles' upstream calls (substring `pathIncludes`, most-recent-registered wins). Register inside the journey bridge, before `writeFile(journeyStatePath, …)`. Anchors (match the exact segments the services call): business-info `getGoogleLocation` (`readMask`) returns a location body; `/attributes` (GET) returns attributes; `attributes:getMetadata`/`attributeMetadata` returns metadata; `categories` and `chains` GET for the metadata search. Industry: `/lodging`, business-calls settings/insights, `healthcareServices`. Administration: `VoiceOfMerchantState`, `verifications`, `/admins`, `invitations`, `:transfer` (POST), DELETE on the location name, account `locations` (POST). Model each as a fixed `{ status: 200, json: {...} }` (or echo POST bodies) mirroring the shapes in the `gbp-management-tabs` fixtures.

- [ ] **Step 3: Extend `locations.spec.ts`.** The existing clean-load + a11y loop (6 tabs — it omits Performance — under the OWNER cookie `state.cookie`) gains the three console segments **as OWNER-scoped entries**: add `business-information`, `industry`, and `administration` to that loop. This MUST run under the owner because Industry + Administration hide/403 for non-owner/admin, so their clean-load + axe iterations are only meaningful (and only render) for the owner (`state.cookie`), in both `light`/`dark`, with the WCAG + structure rules already asserted. Keep the member/viewer gated-panel + no-reachable-403 checks in the SEPARATE per-role permission walk: for member/viewer, assert the Industry + Administration tab links are ABSENT and a direct `goto` of those routes shows the gated "available to owners and admins" panel with NO console error and NO 403 network response surfaced to a primary control; assert Business info renders read-only for all roles. Add a publish journey per console for the owner (edit → `PATCH` `200` on the console route → success toast) and the danger-zone journey (open delete dialog → type the location name → confirm → `PATCH` `200` with `delete_google_location_permanently`, against the stub). Reuse the `applyCookie` + `readJourneyState` helpers and the `waitForResponse(method === "PATCH" && pathname === /api/locations/<id>/<console>)` pattern.

  > **No env-flag change needed:** `playwright.config.ts` already sets `GBP_PROFILE_WRITES_ENABLED: "true"` and `PUBLISH_ENABLED` defaults `true`, so business-info (`PUBLISH_ENABLED && GBP_PROFILE_WRITES_ENABLED`), industry, and administration (`PUBLISH_ENABLED`) writes are all enabled under e2e. (This corrects the brief's T8 "enable flags" step — nothing to add.)

- [ ] **Step 4: Run the full gate** —
  ```
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  node scripts/run-test-command.mjs e2e pnpm exec playwright test
  node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
  git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts   # MUST be empty
  ```
  Expected: all green; the protected-path diff is empty.

- [ ] **Step 5: Commit** — `test(consoles): revive gbp-management e2e for the three editors + role/publish/danger-zone journeys`.

---

## Milestone 8 exit criteria

- **Three consoles shipped as real editors** on their existing routes with UI-constructed payloads (§8, §11 line 197): Business info (identity/contact/categories/typed attributes + diff-vs-Google preview + touched→mask, no masks/JSON shown), Industry (lodging/business-calls/healthcare typed editors, mask auto-computed), Administration (admins add/remove, ownership transfer as its own guarded flow, delete-location isolated in a danger zone requiring the typed location name). **No JSON textareas or placeholder templates anywhere.**
- **Read-only pressure valve (§12):** where Google's model exceeds an editor, the field renders read-only with an explicit "not editable here yet" note — never a JSON escape hatch. Covered by the `TypedAttributeControl` unsupported branch and business-info's complex-leaf sections.
- **Zero protected footprint:** `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` is empty. No new server capability/route/service/domain edit; `lib/domain/business-information.ts` consumed only.
- **No reachable 403 (§9):** Industry + Administration tabs hidden for non-owner/admin; their components short-circuit to a gated panel with `enabled: caps?.canEditCanonical === true` so a direct URL never fires the 403 GET; Business info read-open for all, edit gated.
- **Humanisation (§7):** no raw enum/code/mask/env-flag/JSON reaches a user; one mapping layer (`console-labels.ts` + `action-errors.ts`).
- **All suites green** (unit, components, integration parity oracle, every enabled e2e spec incl. the revived `gbp-management-tabs.spec.ts`); clean `pnpm build`; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Self-review

- **Spec §8 clause coverage (per console):**
  - *Business info* — "structured sections (identity, contact, categories, typed attribute controls) with a diff-vs-Google preview; update mask computed from touched fields; users never see masks or JSON": Task 3 (`buildLocationUpdate` silent mask, `GoogleDiff` preview, `TypedAttributeControl`, categories via metadata-search `Combobox`). ✓
  - *Industry* — "category pickers backed by the existing metadata search; typed attribute editors; mask auto-computed": **DISCREPANCY (code wins):** categories live in Business info's `categories` mask, NOT the industry route (industry = lodging/business-calls/healthcare). The metadata-search category picker is delivered in the **Business info** console (Task 3); industry delivers typed lodging/business-calls/healthcare editors with `touchedMask` auto-compute (Task 4). This split is faithful to the routes and is FLAGGED here for the reviewer.
  - *Administration* — "admins list with add/remove flows; ownership transfer as its own guarded flow; delete-location isolated in a danger zone requiring the location's typed name": Task 5 (`AdminsTable` + create/update admin) + Task 6 (`DangerZoneDialog` typed-name for delete_admin/transfer/delete_location). ✓
- **Zero-protected-footprint + capability-reuse decision:** a purpose-named `consoleCapabilities` server addition was considered and **rejected as redundant** — all three routes gate on `requireRole(["owner","admin"])`, which `canEditCanonical` already mirrors exactly, so a new capability would be byte-identical enforcement and a needless protected edit. Every task's Files list is non-protected; `lib/domain/business-information.ts` is imported, not edited.
- **Danger-zone two-layer confirm + no-reachable-403:** every destructive op sends the backend confirmation literal (`ADMINISTRATION_CONFIRMATIONS`) AND requires the UI typed-name (`DangerZoneDialog`); Industry/Administration tabs are hidden + query-disabled for non-owner/admin. ✓
- **Flags for the owner (decisions needing a human call):**
  1. **§5 server-hydration deferred to M9** — consistent with M3–M7; noted by the spec-extract as the plan's decision (the spec makes prefetch the standing contract and does not text-defer it). Carry-forward.
  2. **Business-info / Profile overlap** — the M5 Profile tab (canonical bidirectional) and the M8 Business info tab (Google-direct full-field) both edit name/description/phone/website/address by different mechanisms. Presented with clear section framing; the owner should confirm this is the intended dual surface (or decide to cross-link / de-duplicate in M9).
  3. **Ownership-transfer semantics** — the plan uses the `/administration` `transfer_location` op (moves the whole Google location to another account, with an access-loss warning). If the intent was "promote an admin to PRIMARY_OWNER", that is a different flow (`update_admin` to a new role) — owner to confirm which "ownership transfer" §8 means.
  4. **Does verification belong in the Administration console?** — the backend `/administration` GET returns `voice`/`verifications`/`verificationOptions` and the PATCH supports `start_verification`/`complete_verification`, so verification is placed in Administration (Task 5). If the owner would rather verification live on its own surface or in Connections, flag before build.
- **e2e §9 obligations:** revived `gbp-management-tabs.spec.ts` (render/interaction on the reused GET fixtures) + `locations.spec.ts` extensions (three tabs into the clean-load + a11y loop in both themes; per-role no-reachable-403 walk; one publish journey per console; danger-zone typed-name journey) + `stub-bridge.ts` Google matchers. **CODE-WINS corrections flagged:** (a) the brief's "per-role walk in gbp-management-tabs" is re-homed to the DB-backed `locations.spec.ts` because that spec owns the real role cookies (gbp-management-tabs uses `page.route` mocks with a single owner session); (b) no new e2e env flag is needed — `GBP_PROFILE_WRITES_ENABLED` is already `"true"` and `PUBLISH_ENABLED` defaults `true`.
- **Where code contradicted the brief (recorded):** (1) industry has NO categories (categories are a Business-info mask); (2) only Business info is hash-pinned (`expectedGoogleHash`); industry/administration PATCHes carry no optimistic-concurrency hash, so there is no `*_stale` path for them; (3) the Business-info PATCH payload is `.strict()`, so it is built fresh from touched fields (NOT spread-and-preserved like the freeform industry/administration records); (4) `requireRole` throws `permission_denied` (not a bespoke console code) — already mapped; (5) `PUBLISH_ENABLED` defaults **true** and is not present in the e2e config, so business-info writes are enabled under e2e without a config change.
- **Carry-forwards to M9:** server-hydration/prefetch for all consoles (perceived-latency win given the 3/7/7-call fan-out); the business-info/Profile de-duplication decision; any additional typed attribute value-types beyond BOOL/ENUM/URL; healthcare editors (currently read-only summaries).
