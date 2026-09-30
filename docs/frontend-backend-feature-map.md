# Backend, API, and frontend feature map

Current programme acceptance is tracked in [GBP operations acceptance](gbp-operations-acceptance.md).
The older completion labels below describe historical implementation, not current
deployment or live-provider verification. Retired Google capabilities are excluded
from further development; the support catalogue overrides historical promises.

This document is the implementation handoff for replacing the current
NabaPresence interface. It separates provider capability from API readiness and
frontend usability so a polished screen is never mistaken for a missing backend
feature, and a working backend is never mistaken for a finished product.

## Executive finding

The Google integration, persistence, authorization, mutation safety, and most
feature APIs are implemented. The frontend is uneven:

- Hours, reviews, posts, media, menus, booking links, team settings, and
  compliance have task-specific controls.
- Business Information, location administration, verification, permissions,
  lodging and general service workflows still need complete typed
  editors or raw JSON panels.
- Connection setup is functional but concentrated in a 1,400-line component.
- The location workspace presents eleven equally weighted tabs, even though
  several belong to the same user journey.
- Provider errors are safe and honest, but often collapse into a generic
  full-screen error instead of explaining reconnect, permission, eligibility,
  or per-resource failure states.

The next release should therefore begin with form-friendly API contracts and a
capability manifest, then rebuild the frontend around user jobs.

### Where the foundations moved (September 2026 core-hardening sprints)

Several rows below were overtaken by the `core-hardening` branch; the table
cells note the new home, and `docs/architecture.md` describes each piece.

- Every API handler runs through `lib/server/route.ts` (`route()`), which owns
  the request id, auth mode, role gate, zod parsing and the error envelope.
- Request/response schemas live once in `lib/contracts/*` and are imported by
  both the route and `lib/api/*`; there is no OpenAPI document.
- The capability manifest (`GET /api/locations/[id]/capabilities`) and the
  location activity endpoint (`GET /api/locations/[id]/activity`) exist with
  contracts in `lib/contracts/location-capabilities.ts` and
  `lib/contracts/location-activity.ts`.
- Provider writes run through `lib/server/gbp-write.ts`; reply publishing is
  decomposed into `lib/server/publishing/`.
- The listing workspace is nine areas under `/listings/[id]`
  (`lib/listings/areas.ts`: business profile, opening hours, booking links,
  photos, posts, food menu, people with access, verification and suggested
  updates); the overview lists them as cards from
  `components/listings/area-cards.tsx`, each area editor sits inside
  `components/listings/area-frame.tsx`, and the older per-tab shell
  `components/locations/location-tab.tsx` still wraps the editors themselves;
  mutations use `lib/queries/use-resource-mutation.ts`; error copy comes from
  `lib/errors/action-errors.ts`; query states from `components/ui/query-states.tsx`;
  each dashboard segment has an `error.tsx` boundary.

## Backend and API work required before the redesign

| Priority | Work                                   | Current evidence                                                                                                                                                                                                                                                                                                                                                                        | Required result                                                                                                                                                                                      |
| -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Strict administration commands         | `lib/contracts/location-administration.ts` declares the operation enum, confirmation token and response shape; the section payloads are still Google-shaped (`z.looseObject`)                                                                                                                                                                                                           | A discriminated schema for every operation, with documented request and response DTOs and field-specific validation errors                                                                           |
| P0 | Strict industry DTOs | Compatibility contracts reject retired writes; lodging and general service contracts still need completion | Typed supported lodging and general service contracts |
| P0       | Form-friendly Business Information DTO | The server validates Google resources, but the browser edits the provider-shaped object                                                                                                                                                                                                                                                                                                 | A normalized editable model for identity, address, phones, categories, service areas, services, attributes, open state, labels, store code, and chain data; the server translates it to Google masks |
| P0       | Location capability manifest           | Done: `GET /api/locations/[id]/capabilities` (`lib/server/capabilities.ts`, contract in `lib/contracts/location-capabilities.ts`) returns `resources.<key>.state` in `available`/`readOnly`/`blocked`/`unavailable` with a `reasonCode`; grants come from `lib/server/permissions.ts` and kill switches from `lib/server/env.ts`; `lib/locations/gating.ts` evaluates it in the browser | Keep the reason-code vocabulary stable; add per-field eligibility as the editors need it                                                                                                             |
| P0       | Mutation history and recovery API      | Done for management mutations: `GET /api/locations/[id]/activity` (`lib/server/location-activity.ts`, `lib/contracts/location-activity.ts`) pages `gbp_management_mutation`; rendered by `components/locations/activity-panel.tsx`                                                                                                                                                      | Fold the per-module attempt tables (hours, profile, media, place actions, food menus, posts) into the same timeline                                                                                  |
| P0       | Standard API error envelope            | Done: `route()` maps every error through `apiError(error, requestId)` to `{ error, message, requestId, fieldErrors?, retryable?, reconnectRequired?, details? }` and sets `x-request-id`; `lib/errors/action-errors.ts` turns codes into copy                                                                                                                                           | Use `fieldErrors` from the complex editors                                                                                                                                                           |
| P1       | Long-running operation model           | Backfill has progress, while other provider mutations are synchronous                                                                                                                                                                                                                                                                                                                   | A shared operation resource for uploads, bulk actions, imports, reconciliation, and lifecycle commands when completion may outlive one request                                                       |
| P1       | Pagination and filtering contracts     | Reviews are paginated; some media, administration, and activity surfaces are not                                                                                                                                                                                                                                                                                                        | Cursor-based list contracts with stable sorting for every potentially large collection                                                                                                               |
| P1       | OpenAPI and generated client types     | Done without OpenAPI: `lib/contracts/*` is the one zod declaration per endpoint; routes parse requests and `satisfies` responses with it, `lib/api/*` parses responses with it, and `tests/contracts-client-safe.test.ts` keeps it browser-safe                                                                                                                                         | Generate an OpenAPI document from the contracts only if an external consumer needs one                                                                                                               |
| P1       | Field metadata                         | Category and attribute metadata are available, but consumers receive provider-shaped records                                                                                                                                                                                                                                                                                            | Labels, descriptions, value types, enum options, limits, dependencies, and eligibility in a UI-safe metadata contract                                                                                |
| P1       | Notification diagnostics               | Notification preferences exist, but delivery health is not a first-class customer surface                                                                                                                                                                                                                                                                                               | Subscription state, last delivery, last reconciliation, provider errors, and reconnect action in one API response                                                                                    |
| P2       | Bulk management APIs                   | Most writes are location-by-location                                                                                                                                                                                                                                                                                                                                                    | Preview, validation, approval, partial-failure, and retry contracts for selected-location bulk updates                                                                                               |

## Frontend feature inventory

Status meanings:

- **Usable**: task-specific UI exists and can be refined without replacing the
  API contract.
- **Prototype**: backend is available, but the current screen is an engineering
  console rather than a customer interface.
- **Missing**: backend data exists but no complete customer-facing workflow is
  exposed.

| Product surface                                | Backend/API status                                                                                                                                                                                   | Frontend status                                                                                                                                                                                       | Frontend work                                                                                                                                                                                                                              | Priority                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Registration, sign-in, recovery, invitations   | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Create one coherent onboarding journey; improve password guidance, confirmation states, and invitation context                                                                                                                             | P1                                   |
| Organisation switching                         | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Make current organisation and role clearer; add recent organisations and safer switch feedback                                                                                                                                             | P2                                   |
| Google connection                              | Complete                                                                                                                                                                                             | Usable but overloaded                                                                                                                                                                                 | Replace the overloaded settings screen (now split across `components/settings/*` cards; `useSettings` is not server-prefetched) with a step-by-step connect, account selection, location discovery, linking, sync, and notification wizard | P0                                   |
| Reconnect and disconnected states              | Complete                                                                                                                                                                                             | Partial                                                                                                                                                                                               | Persistent reconnect banner with cause, affected features, last successful sync, and one clear action                                                                                                                                      | P0                                   |
| Location directory                             | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Add health/status columns, saved filters, search, bulk selection, and a clear create/link location action                                                                                                                                  | P1                                   |
| Location onboarding and matching               | Complete                                                                                                                                                                                             | Prototype                                                                                                                                                                                             | Guided create-or-match wizard with address preview, duplicate warnings, verification state, and explicit final confirmation                                                                                                                | P0                                   |
| Home dashboard                                 | Complete                                                                                                                                                                                             | Rebuilt for the agency (September 2026): setup card, work by client, attention list, pulse                                                                                                            | Per-client trend sparklines                                                                                                                                                                                                                | P2                                   |
| Cross-location inbox                           | Complete (`lib/contracts/reviews.ts` is the vocabulary and wire codec; filters, queue and selection live in the URL via `lib/inbox/url-state.ts`, so the page is deliberately not server-prefetched) | Usable                                                                                                                                                                                                | Improve density, keyboard workflow, bulk selection, saved filters, and responsive detail navigation                                                                                                                                        | P1                                   |
| Review detail and reply approval               | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Clarify reply lifecycle, verification findings, activity timeline, publish state, retry state, and destructive actions                                                                                                                     | P1                                   |
| Location overview/profile                      | Complete                                                                                                                                                                                             | Done (September 2026): `components/locations/profile/profile-editor.tsx` is one editor over both halves of the listing; `business-information` and `industry` are redirects                           | Services, service areas and chain relationships are still read-only                                                                                                                                                                        | P1                                   |
| Complete Business Information                  | Complete                                                                                                                                                                                             | Done (September 2026): identity, categories, contact, address, attributes and the capability-gated industry sections are sections of the profile editor; adapters in `lib/locations/google-values.ts` | Finish services, service areas and chain relationships as sections                                                                                                                                                                         | P1                                   |
| Category and chain lookup                      | Complete                                                                                                                                                                                             | Prototype                                                                                                                                                                                             | Searchable comboboxes with result descriptions, selected chips, primary/secondary category rules, and chain preview                                                                                                                        | P0                                   |
| Attributes                                     | Complete                                                                                                                                                                                             | Prototype                                                                                                                                                                                             | Metadata-driven boolean, enum, repeated-enum, URL, and text controls grouped by Google category                                                                                                                                            | P0                                   |
| Hours                                          | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Improve weekly grid, split periods, copy-to-days, holiday calendar, diff visualization, validation, and timezone messaging                                                                                                                 | P1                                   |
| Google-suggested updates                       | Complete                                                                                                                                                                                             | Its own segment (September 2026): `/listings/[id]/suggestions`, with the pending count on the tab                                                                                                     | Impact summary across both resource types                                                                                                                                                                                                  | P1                                   |
| Verification | Partial: typed eligibility, immutable approval, start/PIN execution and independent recovery implemented; legacy bypass retired and cleanup tested | Independent workspace, reviewed start/PIN and disconnected saved recovery implemented; see dated acceptance evidence | Full real-backend PIN and combined browser journeys, broader accessibility/performance, production cleanup/deployment and eligible live acceptance | P1 |
| Owners, managers, and invitations              | Complete                                                                                                                                                                                             | Its own segment (September 2026): `/listings/[id]/people`, `components/locations/administration/{admins,invitations}.tsx`                                                                             | Role-change confirmation and richer pending-invitation actions                                                                                                                                                                             | P1                                   |
| Location transfer and deletion                 | Complete                                                                                                                                                                                             | Partial (`components/locations/administration/danger-zone.tsx`)                                                                                                                                       | Dedicated high-risk dialogs with destination lookup, typed confirmation, consequences, and operation status                                                                                                                                | P0                                   |
| Posts                                          | Complete                                                                                                                                                                                             | Composer sheet with live preview (September 2026)                                                                                                                                                     | Media picker and approval timeline. Scheduling stays out until a due-posts claim exists: the column was written and sent, but nothing ever published on time (see `lib/contracts/location-posts.ts`)                                       | P1                                   |
| Photos and videos                              | Complete                                                                                                                                                                                             | Usable (`components/locations/photos/*`; page and owner/category filters live in the URL via `lib/locations/photos-url-state.ts`)                                                                     | Responsive gallery, drag-and-drop upload, progress, validation before upload, cover/profile affordances, and lightbox                                                                                                                      | P1                                   |
| Food menus                                     | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Improve nested editor with drag ordering, reusable items, option groups, currency handling, validation summary, and mobile editing                                                                                                         | P1                                   |
| Booking and place-action links                 | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Show consumer-facing preview, provider ownership, preferred link, validation status, and clearer immutable-link handling                                                                                                                   | P1                                   |
| Lodging amenities and policies | Partial: pinned typed schema, exact persisted review/approval, independent confirmation and guarded recovery | Partial controls with before/after review and saved reviews | Complete writable-field controls, unknown/false/exception handling and suggestion draft workflow; see programme acceptance register | P0 for eligible lodging locations |
| Business Calls | Retired by Google | Active controls removed | Historical records only; call-click performance remains separate | Excluded |
| Healthcare services | General service-management API supported subject to metadata | General services editor pending | Retired provider attributes and insurance networks are excluded | P1 for eligible healthcare locations |
| Location performance                           | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Consolidate metrics, impressions, actions, search terms, period comparison, annotations, and export                                                                                                                                        | P1                                   |
| Organisation performance                       | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Improve comparison table, filters, exception highlighting, chart legibility, and drill-down to location                                                                                                                                    | P1                                   |
| Search-keyword performance                     | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Better query discovery, period comparison, threshold explanation, and export                                                                                                                                                               | P2                                   |
| Notification preferences                       | Complete                                                                                                                                                                                             | Partial                                                                                                                                                                                               | Move out of connection setup into a dedicated preferences surface with event descriptions and delivery health                                                                                                                              | P1                                   |
| Team and location access                       | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Simplify invite/role workflows, add permission explanations and member activity                                                                                                                                                            | P1                                   |
| Publishing policy                              | Complete                                                                                                                                                                                             | Usable                                                                                                                                                                                                | Rewrite configuration into understandable policy cards with safe defaults and consequences                                                                                                                                                 | P1                                   |
| Compliance, privacy, legal holds, audit export | Complete                                                                                                                                                                                             | Usable but operational                                                                                                                                                                                | Separate privacy requests, retention, legal holds, and audit history; add status tables and request detail views                                                                                                                           | P1                                   |
| Location activity and reconciliation history   | `GET /api/locations/[id]/activity` covers `gbp_management_mutation`                                                                                                                                  | Partial (`components/locations/activity-panel.tsx` in every location workspace)                                                                                                                       | Extend the timeline to the hours, profile, media, place-action, food-menu and post attempt tables, with validation, readback, failure, and retry detail                                                                                    | P0                                   |
| Operations health and notification failures    | APIs exist                                                                                                                                                                                           | Missing                                                                                                                                                                                               | Owner/admin diagnostics page for sync freshness, queues, webhook failures, retries, and request IDs                                                                                                                                        | P1                                   |
| Bulk location management                       | Partial backend                                                                                                                                                                                      | Missing                                                                                                                                                                                               | Selection model, preview/diff, validation, approval, progress, partial-failure review, and retry                                                                                                                                           | P2                                   |
| Support impersonation                          | Complete internal API                                                                                                                                                                                | Intentionally absent                                                                                                                                                                                  | Keep out of customer navigation; build a separately authorized internal support surface only if operationally required                                                                                                                     | P2                                   |

## Recommended information architecture

Keep the five primary navigation items. The eleven flat location tabs have
been replaced by the nine listing areas of `lib/listings/areas.ts`, listed as
cards by `components/listings/area-cards.tsx`, framed per area by
`components/listings/area-frame.tsx`, and moved between by
`components/listings/sibling-switcher.tsx`; People with access and Verification
are console-gated to owners/admins.

The six user-oriented sections below are the recommendation that work grew
from. They are kept as the reasoning, not as a description of the shipped
navigation:

1. **Overview** — profile health, Google connection, pending changes, recent
   activity, and highest-priority actions.
2. **Profile** — Business Information, hours, services, attributes, and
   Google-suggested updates.
3. **Content** — posts, photos/videos, and food menus.
4. **Customers** — reviews, replies and booking links where
   eligible.
5. **Access & verification** — verification, owners/managers, invitations,
   lifecycle, and transfers.
6. **Insights** — location performance, search terms, and industry insights.

Industry-only sections should appear within the relevant job, not as a generic
JSON-oriented “Industry” tab. Lodging belongs in Profile, call-click metrics in
Customers/Insights, and healthcare services in Profile.

## Delivery sequence

### Slice 0 — API contracts and UI foundations

- Capability manifest, error envelope, activity history, shared contracts
  and the reusable async/loading/error patterns shipped in the September 2026
  core-hardening sprints (see above).
- Replace the remaining Google-shaped administration and industry payloads
  with strict DTOs.
- Create a responsive shell, page header, form layout, status banner, diff,
  activity timeline, destructive confirmation, and command-progress patterns.

### Slice 1 — Setup and navigation

- Rebuild Google connection and location onboarding as a wizard.
- Replace the flat location tab bar with the grouped information architecture.
- Add persistent connection and location-health status.
- Redesign Home and Locations around actions and exceptions.

### Slice 2 — Core profile management

- Build structured Business Information, attributes, categories, services,
  service areas, hours, and suggested-update workflows.
- Build verification and owner/manager experiences.
- Add location activity and reconciliation history to every write surface.

### Slice 3 — Content and customer operations

- Refine reviews and reply approval.
- Rebuild Posts composer and Media gallery.
- Refine menus and booking links.

### Slice 4 — Insights, verticals, and governance

- Consolidate performance and search insights.
- Build eligible lodging and general service experiences, including healthcare.
- Rebuild notification preferences, team, policy, privacy, audit, and
  operations health.

### Slice 5 — Bulk workflows and final quality

- Add selected-location bulk management.
- Complete mobile, keyboard, screen-reader, slow-network, disconnected,
  stale-data, and partial-failure scenarios.
- Run visual regression and real-account acceptance testing for every eligible
  Google surface.

## Account onboarding backend increment (29 September 2026)

Account-scoped matching, persisted drafts, provider validation, exact creation
review/approval, durable submission, independent readback and local-link recovery
now have backend routes and isolated standalone regression coverage. These routes
work without a pre-existing linked location. Setup now supports account selection,
saved draft restore/basic details/category selection, description, store code,
private labels, website/business phone and Google Ads phone inputs,
opening state and full/partial opening dates, exact regular and special opening
hours including overnight days/dates and explicit closed dates, category-supported
additional service-hour selection with exact IDs and separate schedules, structured/custom services with
descriptions and prices, revision-bound Google chain discovery and exact chain
selection, parent/child place IDs with explicit relationship types,
structured storefront address components, customer-only/hybrid service-area details
and explicit place-ID entry,
match searching, ownership handoff and creation
status/local-link recovery, explicit creation decisions, exact review, approval and
submission. Thirty-three focused onboarding browser scenarios passed, with
matching layouts and scoped accessibility checks at 375, 768 and 1280 pixels.
The frontend remains partial: complete creation details and verification still
need integration. Unknown create outcomes without a
resource identity need an explicit reconciliation flow. Deployment and eligible
live-provider acceptance remain pending in the operations acceptance register.

The saved-draft accessible-matches backend now freshly proves selected-account
membership through complete pagination and exact resource/place identities.
It rejects stale searches, changed drafts, revoked access and creation already
started, with separate inaccessible, ambiguous and unconfirmed identity results.
Shared contracts and client adapters are available. Separate persisted match-link
review and approval routes now bind the exact provider snapshot, local name,
account/client assignment and collision state; two-person approval and fresh
membership/resource checks apply. Durable execution now claims the same draft
lock as creation, refreshes the provider baseline and saves the mapping, routing,
client grants, sync checkpoint and result atomically. Failed/interrupted attempts
support guarded retry; duplicate submissions restore one operation/result.
Setup now exposes saved-match discovery, exact review/collision explanations,
two-person approval, separate execution confirmation, URL reload and recorded
status/recovery. Pending/unavailable status blocks new actions. A lost response
restores the recorded result before another submission is offered. Local linking
does not imply verified or synchronised Google state. Direct-link browser
verification is recorded separately in the operations acceptance register;
deployment and eligible live outcomes remain pending.

Saved onboarding drafts also have revision-bound service metadata discovery,
using all proposed categories and the draft language/country. Fresh service
eligibility is checked before review validation and creation. Setup now supports
structured/custom service entry, sibling preservation, optional value clearing,
price precision, save/reload and exact service review. Chain search rejects
malformed or duplicate provider choices and rechecks account access and saved
revision after discovery. Empty or failed searches preserve the proposed chain;
removing a chain or relationship preserves its siblings. Independent creation
readback compares exact child IDs and types without depending on array order.
Other creation details,
matching/linking, verification and recovery closure remain open.

## Frontend definition of done

Verification credential handling now excludes submitted PINs and partner tokens
from ordinary attempt/audit records and arbitrary provider echoes. Completion
targets are scoped to the selected linked listing. This boundary has focused
unit/component and standalone database coverage. Typed eligibility/context
discovery, immutable start/PIN reviews and approval, single-send execution and
independent confirmation/recovery are now implemented and automatically verified
through the standalone app. Completion confirms the exact reviewed request phase,
separately from merchant standing; saved outcomes survive expiry/policy/paused
writes and disconnect without resubmission. Start and PIN controls now use
reviewed approval/execution and
saved recovery. Start controls collect distinct destinations and private context;
PIN controls clear credentials after preview, require re-entry, and recover via
read-only status. Their complete browser acceptance matrix remains pending;
the dated acceptance register distinguishes start backend coverage from the
workspace/PIN fixture evidence described below.
The whole-screen verification workspace now uses typed independent observation,
separate merchant standing/request history and fail-closed session/capability
gates. Saved reviews/outcomes remain accessible during failed Google reads or
disconnection. The legacy DB verification badge is suppressed on this page so
it cannot contradict an unknown current observation. Approved PIN sends use
the shared action bar.
A credential-free paginated
backend index now discovers both review families and recorded outcomes, including
while disconnected or publishing is paused; both reviewed UI families use it.
Six API-fixture browser journeys through the built standalone app cover reviewed
PIN completion and disconnected/lost-response recovery at 375/768/1280, with
50 fresh captures passed by two independent visual reviewers. This
does not establish real-backend PIN or combined start/PIN acceptance.
The subsequent START increment passes 39 real-backend browser scenarios for all
five API-supported start methods and eight recovery/gating/handoff cases at
375/768/1280. All 156 final captures passed both independent reviewers after
correcting visible busy/disabled-action explanations. This does not establish
complete PIN, combined-workflow or broader accessibility/performance acceptance.
Historical credential cleanup is implemented in additive migration 0069 and
tested against fresh and retained isolated schemas. The legacy administration
write bypass is retired. Production cleanup activation, remaining browser
acceptance, deployment and eligible live checks remain pending. See the
dated acceptance register and
`.omo/evidence/verification-completion-execution-2026-09-30/review.md`.

2026-09-30 takeover: complete local verification acceptance subsequently passed
39 real-backend START and 57 PIN/combined/drift/recovery cases at all three widths,
with 332 accepted captures individually inspected by both independent reviewers.
Those dated captures belong to their recorded build and are preserved. They do
not establish deployment, live Google acceptance or broader accessibility and
performance. Fresh regressions are required after further shared-source changes.

Administration access now saves exact immutable reviews before approval and
explicit sending. Its typed controls distinguish Google acknowledgement,
independent observed access, pending administrator invitations and unresolved
outcomes. Keyset-paginated saved work restores reviews or recorded outcomes after
reload and resets consent; current PostgreSQL cursor precision has regression
coverage. Account admins use Google's `accountAdmins` response. Legacy direct
access writes are retired. Current local domain/route/component gates pass;
the full access browser and fresh independent visual gates are in progress.
Ownership/lifecycle and remaining full-programme acceptance remain open. See
`.omo/evidence/administration-access-backend-ui-2026-09-30/review.md` and the current
programme acceptance register.

A feature is frontend-complete only when it has:

- task-specific controls rather than provider JSON;
- loading, empty, disconnected, read-only, permission-denied, unsupported,
  stale, partial-failure, success, and retry states where applicable;
- field-level validation before a provider call;
- an explicit preview/diff and confirmation for Google writes;
- visible operation and reconciliation status after the request;
- responsive desktop and mobile layouts;
- keyboard and screen-reader coverage;
- API-mocked component/E2E coverage plus real-account acceptance evidence for
  provider-dependent behavior.

## GBP operations programme increment (30 September 2026)

Implemented in source with local automated evidence only (owned PostgreSQL,
loopback Google/email stubs). Deployment and live-provider acceptance are not
established; see `docs/gbp-operations-acceptance.md`.

| Surface | Frontend | Backend |
| --- | --- | --- |
| Reviewed action links | Booking tab: review sheet, separate approve / consent / send, saved work, "Managed in Google" for provider-owned and future-type links | `/api/locations/[id]/place-action-reviews/**` |
| Notifications | `/notifications` (per-person read state, manager resolve), toolbar unread badge, `/settings/notifications` preferences | `/api/notifications`, `/read`, `/[incidentId]/resolve`, `/preferences`; `/api/webhooks/email` |
| Operations | `/settings/operations` (owners/admins) | `/api/operations/health` (adds unresolved writes and email evidence), `/api/operations/notification-deliveries/retry` |
| Scheduled publication | Posts tab: Schedule sheet with exact preview, schedules list with approval, pause/resume/cancel/change; `/calendar` month, week and agenda | `/api/locations/[id]/post-schedules/**`, `/api/post-schedules/occurrences`; job tick |
| Bulk listing changes | Listings board selection (up to 100), `/listings/bulk` compose, `/listings/bulk/[id]` review, approval, progress, cancel, retry | `/api/listings/bulk/preview`, `/[id]`, `/[id]/approve`, `/[id]/execute` (202), `/[id]/cancel`, `/[id]/retry`; job tick |
| Report provenance | Google tab, location report and share page: "No data" for missing metrics, prior-window deltas, data-through vs last fetched, coverage, totals CSV, print styles | `/api/analytics/presence` optional `previous`, `fetchedAt`, `coverage`, `dateBasis` |

Wording rule applied: call clicks are "Call button taps", booking clicks are
"Booking button clicks", keyword positions are not search rankings.
