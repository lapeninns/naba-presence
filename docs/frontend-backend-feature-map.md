# Backend, API, and frontend feature map

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
  lodging, Business Calls, and healthcare still expose developer-oriented JSON
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
- The location workspace groups its tabs into six sections
  (`lib/locations/location-ia.ts`: Overview, Profile, Content, Customers,
  Access, Insights); every tab renders inside `components/locations/location-tab.tsx`;
  mutations use `lib/queries/use-resource-mutation.ts`; error copy comes from
  `lib/errors/action-errors.ts`; query states from `components/ui/query-states.tsx`;
  each dashboard segment has an `error.tsx` boundary.

## Backend and API work required before the redesign

| Priority | Work | Current evidence | Required result |
|---|---|---|---|
| P0 | Strict administration commands | `lib/contracts/location-administration.ts` declares the operation enum, confirmation token and response shape; the section payloads are still Google-shaped (`z.looseObject`) | A discriminated schema for every operation, with documented request and response DTOs and field-specific validation errors |
| P0 | Strict industry DTOs | `lib/contracts/location-industry.ts` declares `INDUSTRY_OPERATIONS`, the pinned Business Calls leaf and the response shape; lodging and healthcare payloads are still provider-shaped | Typed lodging, Business Calls, healthcare-service, and provider-attribute request/response contracts |
| P0 | Form-friendly Business Information DTO | The server validates Google resources, but the browser edits the provider-shaped object | A normalized editable model for identity, address, phones, categories, service areas, services, attributes, open state, labels, store code, and chain data; the server translates it to Google masks |
| P0 | Location capability manifest | Done: `GET /api/locations/[id]/capabilities` (`lib/server/capabilities.ts`, contract in `lib/contracts/location-capabilities.ts`) returns `resources.<key>.state` in `available`/`readOnly`/`blocked`/`unavailable` with a `reasonCode`; grants come from `lib/server/permissions.ts` and kill switches from `lib/server/env.ts`; `lib/locations/gating.ts` evaluates it in the browser | Keep the reason-code vocabulary stable; add per-field eligibility as the editors need it |
| P0 | Mutation history and recovery API | Done for management mutations: `GET /api/locations/[id]/activity` (`lib/server/location-activity.ts`, `lib/contracts/location-activity.ts`) pages `gbp_management_mutation`; rendered by `components/locations/activity-panel.tsx` | Fold the per-module attempt tables (hours, profile, media, place actions, food menus, posts) into the same timeline |
| P0 | Standard API error envelope | Done: `route()` maps every error through `apiError(error, requestId)` to `{ error, message, requestId, fieldErrors?, retryable?, reconnectRequired?, details? }` and sets `x-request-id`; `lib/errors/action-errors.ts` turns codes into copy | Use `fieldErrors` from the complex editors |
| P1 | Long-running operation model | Backfill has progress, while other provider mutations are synchronous | A shared operation resource for uploads, bulk actions, imports, reconciliation, and lifecycle commands when completion may outlive one request |
| P1 | Pagination and filtering contracts | Reviews are paginated; some media, administration, and activity surfaces are not | Cursor-based list contracts with stable sorting for every potentially large collection |
| P1 | OpenAPI and generated client types | Done without OpenAPI: `lib/contracts/*` is the one zod declaration per endpoint; routes parse requests and `satisfies` responses with it, `lib/api/*` parses responses with it, and `tests/contracts-client-safe.test.ts` keeps it browser-safe | Generate an OpenAPI document from the contracts only if an external consumer needs one |
| P1 | Field metadata | Category and attribute metadata are available, but consumers receive provider-shaped records | Labels, descriptions, value types, enum options, limits, dependencies, and eligibility in a UI-safe metadata contract |
| P1 | Notification diagnostics | Notification preferences exist, but delivery health is not a first-class customer surface | Subscription state, last delivery, last reconciliation, provider errors, and reconnect action in one API response |
| P2 | Bulk management APIs | Most writes are location-by-location | Preview, validation, approval, partial-failure, and retry contracts for selected-location bulk updates |

## Frontend feature inventory

Status meanings:

- **Usable**: task-specific UI exists and can be refined without replacing the
  API contract.
- **Prototype**: backend is available, but the current screen is an engineering
  console rather than a customer interface.
- **Missing**: backend data exists but no complete customer-facing workflow is
  exposed.

| Product surface | Backend/API status | Frontend status | Frontend work | Priority |
|---|---|---|---|---|
| Registration, sign-in, recovery, invitations | Complete | Usable | Create one coherent onboarding journey; improve password guidance, confirmation states, and invitation context | P1 |
| Organisation switching | Complete | Usable | Make current organisation and role clearer; add recent organisations and safer switch feedback | P2 |
| Google connection | Complete | Usable but overloaded | Replace the overloaded settings screen (now split across `components/settings/*` cards; `useSettings` is not server-prefetched) with a step-by-step connect, account selection, location discovery, linking, sync, and notification wizard | P0 |
| Reconnect and disconnected states | Complete | Partial | Persistent reconnect banner with cause, affected features, last successful sync, and one clear action | P0 |
| Location directory | Complete | Usable | Add health/status columns, saved filters, search, bulk selection, and a clear create/link location action | P1 |
| Location onboarding and matching | Complete | Prototype | Guided create-or-match wizard with address preview, duplicate warnings, verification state, and explicit final confirmation | P0 |
| Home dashboard | Complete | Usable | Redesign hierarchy, actionable exception cards, location health, and setup progress; remove empty decorative space | P1 |
| Cross-location inbox | Complete (`lib/contracts/reviews.ts` is the vocabulary and wire codec; filters, queue and selection live in the URL via `lib/inbox/url-state.ts`, so the page is deliberately not server-prefetched) | Usable | Improve density, keyboard workflow, bulk selection, saved filters, and responsive detail navigation | P1 |
| Review detail and reply approval | Complete | Usable | Clarify reply lifecycle, verification findings, activity timeline, publish state, retry state, and destructive actions | P1 |
| Location overview/profile | Complete | Partial and duplicated | Merge the lightweight Profile surface with structured Business Information; remove competing ownership concepts from the UI | P0 |
| Complete Business Information | Complete | Partial (`components/locations/business-information/` has identity, contact, attributes and category-search sections plus a publish-confirm dialog; adapters in `lib/locations/google-values.ts`) | Finish address, services, service areas, labels, open state, and chain relationships as sections | P0 |
| Category and chain lookup | Complete | Prototype | Searchable comboboxes with result descriptions, selected chips, primary/secondary category rules, and chain preview | P0 |
| Attributes | Complete | Prototype | Metadata-driven boolean, enum, repeated-enum, URL, and text controls grouped by Google category | P0 |
| Hours | Complete | Usable | Improve weekly grid, split periods, copy-to-days, holiday calendar, diff visualization, validation, and timezone messaging | P1 |
| Google-suggested updates | Complete | Prototype | Field-level before/after review with accept/reject selection and impact summary | P0 |
| Verification | Complete | Partial (`components/locations/administration/verification.tsx`) | Method cards, destination masking, PIN entry, progress states, retry guidance, and verification history timeline | P0 |
| Owners, managers, and invitations | Complete | Partial (`components/locations/administration/admins.tsx`, `invitations.tsx`) | People table, role badges, invite dialog, role-change confirmation, removal confirmation, and pending invitation actions | P0 |
| Location transfer and deletion | Complete | Partial (`components/locations/administration/danger-zone.tsx`) | Dedicated high-risk dialogs with destination lookup, typed confirmation, consequences, and operation status | P0 |
| Posts | Complete | Usable | Visual composer, post-type guidance, media picker, live Google-style preview, scheduling calendar, drafts, and approval timeline | P1 |
| Photos and videos | Complete | Usable (`components/locations/photos/*`; page and owner/category filters live in the URL via `lib/locations/photos-url-state.ts`) | Responsive gallery, drag-and-drop upload, progress, validation before upload, cover/profile affordances, and lightbox | P1 |
| Food menus | Complete | Usable | Improve nested editor with drag ordering, reusable items, option groups, currency handling, validation summary, and mobile editing | P1 |
| Booking and place-action links | Complete | Usable | Show consumer-facing preview, provider ownership, preferred link, validation status, and clearer immutable-link handling | P1 |
| Lodging amenities and policies | Complete | Prototype | Grouped amenity controls, policy time pickers, accessibility/pets/parking sections, completeness score, and Google-update comparison | P0 for eligible lodging locations |
| Business Calls | Complete | Prototype | Simple enabled/disabled settings card, eligibility explanation, insight charts, calls trend, and unavailable state | P1 for eligible locations |
| Healthcare services and provider attributes | Complete | Prototype | Service-list editor, provider details, insurance-network search and selection, eligibility-aware empty states | P1 for eligible healthcare locations |
| Location performance | Complete | Usable | Consolidate metrics, impressions, actions, search terms, period comparison, annotations, and export | P1 |
| Organisation performance | Complete | Usable | Improve comparison table, filters, exception highlighting, chart legibility, and drill-down to location | P1 |
| Search-keyword performance | Complete | Usable | Better query discovery, period comparison, threshold explanation, and export | P2 |
| Notification preferences | Complete | Partial | Move out of connection setup into a dedicated preferences surface with event descriptions and delivery health | P1 |
| Team and location access | Complete | Usable | Simplify invite/role workflows, add permission explanations and member activity | P1 |
| Publishing policy | Complete | Usable | Rewrite configuration into understandable policy cards with safe defaults and consequences | P1 |
| Compliance, privacy, legal holds, audit export | Complete | Usable but operational | Separate privacy requests, retention, legal holds, and audit history; add status tables and request detail views | P1 |
| Location activity and reconciliation history | `GET /api/locations/[id]/activity` covers `gbp_management_mutation` | Partial (`components/locations/activity-panel.tsx` in every location workspace) | Extend the timeline to the hours, profile, media, place-action, food-menu and post attempt tables, with validation, readback, failure, and retry detail | P0 |
| Operations health and notification failures | APIs exist | Missing | Owner/admin diagnostics page for sync freshness, queues, webhook failures, retries, and request IDs | P1 |
| Bulk location management | Partial backend | Missing | Selection model, preview/diff, validation, approval, progress, partial-failure review, and retry | P2 |
| Support impersonation | Complete internal API | Intentionally absent | Keep out of customer navigation; build a separately authorized internal support surface only if operationally required | P2 |

## Recommended information architecture

Keep the five primary navigation items. The eleven flat location tabs have
been replaced by six user-oriented sections (`lib/locations/location-ia.ts`,
rendered by `components/locations/location-tab-nav.tsx`; Industry and
Administration are console-gated to owners/admins):

1. **Overview** — profile health, Google connection, pending changes, recent
   activity, and highest-priority actions.
2. **Profile** — Business Information, hours, services, attributes, and
   Google-suggested updates.
3. **Content** — posts, photos/videos, and food menus.
4. **Customers** — reviews, replies, booking links, and Business Calls where
   eligible.
5. **Access & verification** — verification, owners/managers, invitations,
   lifecycle, and transfers.
6. **Insights** — location performance, search terms, and industry insights.

Industry-only sections should appear within the relevant job, not as a generic
JSON-oriented “Industry” tab. Lodging belongs in Profile, call insights in
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
- Build eligible lodging, Business Calls, and healthcare experiences.
- Rebuild notification preferences, team, policy, privacy, audit, and
  operations health.

### Slice 5 — Bulk workflows and final quality

- Add selected-location bulk management.
- Complete mobile, keyboard, screen-reader, slow-network, disconnected,
  stale-data, and partial-failure scenarios.
- Run visual regression and real-account acceptance testing for every eligible
  Google surface.

## Frontend definition of done

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
