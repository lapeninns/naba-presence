# Google Business Profile UX redesign — design

Date: 2026-07-30

Status: ready for review

Scope: NabaPresence web interface only. No provider-write capability is added.

## 1. Problem

NabaPresence reads as a review-management tool, not a Google Business Profile
management tool. The signals are structural, not cosmetic:

- the sidebar is `Overview / Reviews / Analytics / Connections / Settings`;
- `/` redirects to `/reviews`, and organisation switching also lands on
  `/reviews`;
- the sidebar mark is a speech bubble (`MessageSquareText`);
- `reviews-view.tsx` is 1750 lines; every other view combined is smaller;
- location exists only as a filter dropdown inside the review list, never as a
  navigable object.

The
[GBP expansion master plan](../plans/2026-07-30-google-business-profile-expansion-master-plan.md)
adds nine capability workstreams — Performance, Posts, Profile/hours, Place
Actions, FoodMenus, Media, Keywords, Q&A, Lodging. Every one of them is
per-location. Adding them to a flat organisation-level sidebar produces twelve
flat navigation items and no home for per-location work.

## 2. Goal

Reorganise the interface around **location** as the primary noun, so that
reviews become one capability among several rather than the whole product.

Success criteria:

- the word "Reviews" does not appear in top-level navigation;
- every GBP capability in the master plan has an existing route to land in;
- a single-location organisation never navigates through a list of one;
- a 100-location organisation can find one venue without scrolling;
- cross-location reply triage — the workflow the product is currently best at —
  is preserved without regression.

### Non-goals

- No new Google write capability. This redesign adds no provider mutations.
- No change to authentication, tenancy, RLS, retention, or audit behaviour.
- No change to any `/api/*` contract except one `readMask` extension (§9).
- No redesign of the reply editor's internals. It moves; it does not change.
- No component-library replacement. The committed design system stays.

## 3. Decisions

**D1 — The organising noun is location.** Capability surfaces live beneath a
location, not beside each other at organisation level.

**D2 — Hybrid information architecture.** An organisation-level roll-up plus a
per-location workspace. Pure location-first was rejected because cross-location
reply triage would have nowhere to live, which is a regression for multi-site
operators. Capability-first was rejected because it produces nine flat
navigation items and preserves the review-tool identity.

**D3 — Build the full information architecture now.** Routes for unbuilt
capabilities ship immediately so that each workstream lands in a slot that
already exists and no future workstream reopens the navigation question.

**D4 — Unbuilt surfaces show real read-only state, not "coming soon".** Where
the Google API already returns data under the existing `business.manage` scope,
the tab renders it read-only and deep-links to Google's own manager. This is
what makes a partially built workspace read as "manage here, edit on Google for
now" rather than "we have not built this".

**D5 — Compactness is a means, not the goal.** Spacing is retuned so a
nine-tab workspace does not feel sparse. There is no component-system rewrite.

## 4. Route map

### 4.1 Sidebar — five items

```
Home          /home
Inbox         /inbox
Locations     /locations
Performance   /performance
Settings      /settings
```

### 4.2 Location workspace

Nested layout under `app/(dashboard)/locations/[id]/`. Tabs are real routes:
deep-linkable, independently code-split, each loading its own data.

| Route | Tab | Day-one state | Workstream |
| --- | --- | --- | --- |
| `/locations/[id]` | Profile | Real, read-only | C |
| `/locations/[id]/hours` | Hours | Real, read-only | C |
| `/locations/[id]/reviews` | Reviews | Real, full | shipped |
| `/locations/[id]/photos` | Photos | Maps link | F |
| `/locations/[id]/posts` | Posts | Maps link | B |
| `/locations/[id]/menu` | Menu | Flag notice | E |
| `/locations/[id]/qa` | Q&A | Flag notice | H |
| `/locations/[id]/booking` | Booking | Flag notice | D |
| `/locations/[id]/performance` | Performance | Flag notice | A |

`/locations` redirects to `/locations/{onlyId}` when the organisation has
exactly one linked location.

### 4.3 Settings

The 879-line settings page splits by concern:

| Route | Content |
| --- | --- |
| `/settings` | Reply policy, publishing safeguards, language, timezone |
| `/settings/connections` | Google connection, account/location linking, backfill, connection health |
| `/settings/team` | Members, invitations, roles, location assignments |
| `/settings/compliance` | Retention, legal holds, privacy requests, audit export |

### 4.4 Organisation-level surfaces

| Route | Content |
| --- | --- |
| `/home` | Metric strip, 30-day volume chart, attention list, connection alert when unhealthy |
| `/inbox` | Cross-location review queue: filters, list, detail pane, reply editor |
| `/performance` | Two tabs: "Reply performance" (real, today's analytics) and "Google performance" (Workstream A) |

## 5. Content migration

| Today | Destination | Note |
| --- | --- | --- |
| `/overview` | **deleted** | Metrics and chart to `/home`; health card to `/settings/connections`; greeting dropped |
| `/reviews` list + filters | `/inbox` | Cross-location triage preserved intact |
| `/reviews` detail + editor | shared component used by `/inbox` and `/locations/[id]/reviews` | Same editor, two entry points |
| `/analytics` | `/performance` → "Reply performance" tab | Content preserved verbatim |
| `/connections` | `/settings/connections` | Setup wizard becomes a flow inside the page, not a navigation slot |
| `/settings` | `/settings` + three siblings | Split by concern |
| `/design-system` | unchanged | Already outside navigation |

`/overview` is deleted rather than kept because it is derived from
`/analytics`: its chart calls `loadAnalytics` with a hardcoded seven-day window
and daily granularity, and three of its four metric cards are verbatim in
`/analytics`. Its fourth card, "Needs attention", counts only the currently
loaded inbox page rather than the organisation. Its sole unique content is a
three-row health card whose rows come from the connections and settings APIs.

Permanent redirects preserve bookmarks and any external links:

```
/overview     -> /home
/reviews      -> /inbox
/analytics    -> /performance
/connections  -> /settings/connections
```

`/` redirects to `/home` when a session exists, `/sign-in` otherwise. The
organisation-switch handler in `app-shell.tsx` changes its post-switch
destination from `/reviews` to `/home`.

## 6. Navigation shell

`components/naba-presence/app-shell.tsx` keeps its structure — floating
collapsible sidebar, organisation switcher in the header, user and sign-out in
the footer, status pill and theme toggle in the top bar. Changes:

- `NAV_ITEMS` becomes the five items in §4.1, with icons
  `LayoutDashboard`, `Inbox`, `Store`, `TrendingUp`, `Settings`;
- the sidebar mark changes from `MessageSquareText` to `Store`;
- the post-organisation-switch destination changes to `/home`;
- `--nr-sidebar-width` drops from 256px to 232px.

There is **no global location switcher in the shell.** `/home`, `/inbox`,
`/performance`, and `/settings` are organisation-scoped and have no current
location; a persistent switcher there would be misleading. The switcher belongs
to the location workspace header, where a current location exists.

No global breadcrumb is added. The workspace header and the settings sub-navigation
each carry their own context, and a breadcrumb would duplicate them.

## 7. Location workspace

### 7.1 Workspace header

`BusinessContext` is **repurposed** from an organisation banner into the
location identity header. Its shape — name, detail, labelled status — fits a
location exactly, and the duplication problem disappears: the organisation name
was already in the sidebar, whereas a location name is not shown anywhere else.

Its `organisationName` prop is renamed to `name`. The `status`,
`detail`, and translucent-surface behaviour are unchanged, so all three
`design-system-contract.test.ts` assertions covering it continue to hold.

The header renders:

- location title as `h1`, with a searchable switcher (`Combobox`, already used
  for location filtering in the current review list);
- storefront address and store code as detail;
- status chips: linked or unlinked, from the location link record, and
  reconnect-required, from `GoogleConnection.reconnectRequired`;
- a "View on Google Maps" link built from `metadata.mapsUri`;
- the tab row, horizontally scrollable below `sm`.

The switcher uses `Combobox` rather than a dropdown so that it works at both
ends of the scale requirement: type-to-filter for 100 locations, and it is not
rendered at all when the organisation has one.

### 7.2 Tab states

Three states, chosen per tab by what the API can already provide:

1. **Real** — Profile, Hours, Reviews. Renders live data.
2. **Maps link** — Photos, Posts. NabaPresence holds no data for these yet. The
   tab explains what the capability will do and offers the location's
   `metadata.mapsUri` link so the operator can see the current public state.
   That URI is the public Maps listing, not an editor: the tab must say
   plainly that editing these still happens in Google's own Business Profile
   manager. No editor deep-link pattern is asserted, because none has been
   verified against a live profile.
3. **Flag notice** — Menu, Q&A, Booking, Performance. States plainly that the
   capability is not enabled and names the `GBP_*_ENABLED` flag that turns it
   on, matching the flags already specified in the master plan §FND-007.

No tab renders a fabricated or placeholder value. This preserves the existing
product rule that the interface displays only tenant-scoped, API-backed
records.

## 8. Component decomposition

`reviews-view.tsx` (1750 lines) is the largest file in the project and is
currently a single component serving one route. Two routes now need its parts,
so it splits into focused units under
`components/naba-presence/reviews/`:

| File | Responsibility | Consumers |
| --- | --- | --- |
| `review-filters.tsx` | Queue tabs, rating, search, optional location filter | inbox, location reviews |
| `review-list.tsx` | List and row rendering | inbox, location reviews |
| `review-detail.tsx` | Detail pane, reply editor, draft/verify/approve/publish actions | inbox, location reviews |
| `review-queue.tsx` | Composition of the three above, split-pane layout | inbox, location reviews |

`review-queue.tsx` takes a `locationId?: string`. When present it scopes to one
location and hides the location filter; when absent it is the cross-location
inbox. This is the only behavioural difference between the two routes.

New view files:

| File | Route |
| --- | --- |
| `home-view.tsx` | `/home` |
| `locations-index-view.tsx` | `/locations` |
| `location-workspace-header.tsx` | `/locations/[id]/*` layout |
| `location-profile-view.tsx` | `/locations/[id]` |
| `location-hours-view.tsx` | `/locations/[id]/hours` |
| `capability-placeholder.tsx` | Photos, Posts, Menu, Q&A, Booking, Performance tabs |
| `performance-view.tsx` | `/performance`, wrapping today's analytics as one tab |
| `settings-policy-view.tsx` | `/settings` |
| `settings-team-view.tsx` | `/settings/team` |
| `settings-compliance-view.tsx` | `/settings/compliance` |

`overview-view.tsx` is deleted. `analytics-view.tsx` becomes the "Reply
performance" tab content. `connections-view.tsx` moves under settings; its
setup wizard and its ongoing-management sections separate so that the wizard is
not permanently mounted.

## 9. Data requirements

### 9.1 readMask extension

`lib/server/google.ts:660` currently requests:

```
name,title,storeCode,phoneNumbers,categories,storefrontAddress,metadata
```

It becomes:

```
name,title,storeCode,phoneNumbers,categories,storefrontAddress,metadata,
websiteUri,profile,regularHours,specialHours,moreHours,openInfo
```

Same endpoint, same call, same `business.manage` scope, no new API enablement.
All added names are valid Business Information API v1 `Location` fields. This
is what makes the Profile and Hours tabs real rather than empty.

The added set is exactly what the Profile and Hours tabs render, and nothing
more. `serviceArea`, `serviceItems`, and `latlng` are deliberately **not**
added: Workstream C will need them, but nothing in this design displays them,
and an unused field only inflates every location response.

`tests/google-contract.test.ts` asserts the request contract and must be
updated alongside it.

### 9.2 Surfacing existing metadata

`metadata.mapsUri` and `metadata.newReviewUri` are already inside the
`metadata` field being fetched. They must be persisted and exposed through
`GoogleLocation` in `lib/naba-presence-api.ts` so the workspace header and the
deep-link tabs can use them.

### 9.3 No new endpoints

`/home` and `/locations` are built from existing client functions:
`loadAnalytics` (whose `locations` array already carries per-location rating,
review count, response rate, and unresolved complaints), `loadInternalLocations`,
`loadConnections`, and `loadReviewCounts`. No new API route is required.

### 9.4 Route deletion

`/api/analytics/locations/[id]/route.ts` has no caller anywhere in `app`,
`components`, `lib`, or `hooks`, and is deleted. `/api/legal-holds` and
`/api/support/impersonation` also have no UI caller but gain one in
`/settings/compliance`; they are kept.

## 10. Density

Token values are retuned. `design-system-contract.test.ts` asserts only that
these tokens are *defined*, not their values, so retuning is contract-safe.

| Token | From | To |
| --- | --- | --- |
| `--nr-page-pad-x` | 30px | 24px |
| `--nr-page-pad-y` | 26px | 20px |
| `--nr-gap-section` | 22px | 16px |
| `--nr-gap-card` | 14px | 12px |
| `--nr-card-pad` | 18px | 14px |
| `--nr-sidebar-width` | 256px | 232px |

Two component adjustments in `shared.tsx`:

- `PageHeader` heading drops from 22px to 18px and sits on one row on desktop;
- `MetricCard` value drops from `text-2xl` to `text-xl`.

Radii, shadows, surfaces, motion tokens, and every `components/ui/*` primitive
are unchanged.

## 11. Feature flags

All six unimplemented tabs read their flag from the set already specified in the
master plan §FND-007:

| Tab | Flag |
| --- | --- |
| Photos | `GBP_MEDIA_ENABLED` |
| Posts | `GBP_POSTS_ENABLED` |
| Menu | `GBP_FOOD_MENUS_ENABLED` |
| Q&A | `GBP_QA_ENABLED` |
| Booking | `GBP_PLACE_ACTIONS_ENABLED` |
| Performance | `GBP_PERFORMANCE_ENABLED` |

The flag does not change which of the two placeholder styles a tab uses — that
is fixed by whether a `mapsUri` link is meaningful for the capability (§7.2).
The flag determines only whether the notice reads "not enabled" or "not yet
available". A tab whose flag is on but whose workstream has not landed still
renders a notice; the flag gates capability, not navigation.

Navigation entries are always present regardless of flag state, per D3.

## 12. Test migration

Integration tests are almost entirely unaffected: their `/reviews` occurrences
are Google API paths (`.../locations/{id}/reviews`), not application routes, and
every `/api/*` contract is unchanged.

| File | Change |
| --- | --- |
| `tests/e2e/routing.spec.ts` | Rewrite. New route table, root now redirects to `/home`, sidebar-history assertions use new labels. Add assertions for the four permanent redirects. |
| `tests/e2e/journeys.spec.ts` | Update six `page.goto` calls (lines 19, 53, 65, 99, 116, 143). API interception unchanged. |
| `tests/e2e/accessibility.spec.ts` | Update `page.goto` targets; add passes for `/home`, `/locations`, and a location workspace tab. |
| `tests/google-contract.test.ts` | Update the expected `readMask`. |
| `tests/design-system-contract.test.ts` | No change. Tokens are asserted by existence; `BusinessContext` continues to exist with its status shape and translucent surface intact. |
| `tests/integration/routing-tables.test.ts` | No change. Concerns database routing tables, not HTTP routes. |

New coverage required:

- `/locations` redirects to the workspace for a single-location organisation and
  renders an index for a multi-location organisation;
- a placeholder tab renders its notice and does not call an unimplemented
  endpoint;
- `/locations/[id]/reviews` scopes to its location and hides the location filter;
- `/inbox` retains cross-location behaviour;
- the four permanent redirects resolve;
- tenant isolation on `/locations/[id]` for a location belonging to another
  organisation.

## 13. Phasing

Each phase is independently shippable and leaves the application working.

**Phase 1 — Shell and route tree.** New routes, redirects, five-item sidebar,
`Store` mark, `/home`, `/locations` index, workspace layout with header and tab
bar, settings split, connections moved, `/overview` deleted, density tokens.
Reviews still functions throughout via `/inbox`.

**Phase 2 — Reviews decomposition.** Split `reviews-view.tsx` into the four
units in §8 and wire both `/inbox` and `/locations/[id]/reviews`. No behaviour
change; the reply editor is moved, not modified.

**Phase 3 — Real read-only profile.** Extend the `readMask`, surface
`mapsUri`/`newReviewUri`, build the Profile and Hours tabs, add deep-link tabs
for Photos and Posts.

**Phase 4 — Placeholders and flags.** Flag-aware notices for Menu, Q&A,
Booking, and Performance tabs, plus the "Google performance" tab shell on
`/performance`.

After Phase 4, each master-plan workstream replaces one placeholder without
touching navigation.

## 14. Risks

**A nine-tab workspace where six tabs have no implementation can read as an
unfinished product.** This is the central risk of D3. Only Reviews is editable
in NabaPresence on day one; Profile and Hours are real but read-only. Mitigation
is D4: those two show live Google state rather than nothing, and Photos and
Posts offer a working Maps link, so four of the six incomplete tabs are useful
before they are complete. Menu, Q&A, Booking, and Performance cannot do even
that and carry only a flag notice. If review feedback finds this unacceptable,
the fallback is to hide flag-notice tabs until their flag is on — a change to
one array in the workspace layout, not a redesign.

**Reviews appearing in two places could feel duplicated.** Mitigated by giving
them different jobs: `/inbox` is a cross-location work queue ordered by what
needs action; `/locations/[id]/reviews` is one venue's history. They share
components but not purpose.

**Splitting a 1750-line file carries regression risk in the reply workflow**,
which is the product's most safety-critical path — verification, approval, and
publication. Mitigation: Phase 2 is a pure move with no behaviour change, and
the existing `publish-lifecycle`, `approval`, `delete-lifecycle`, and
`reply-harness` integration tests must pass unchanged before and after.

## 15. Out of scope

Deferred to their own designs, per the master plan:

- any Google write capability beyond the existing reply workflow;
- the NabaTable cross-product projection, events, and proposals (FND-001–007);
- performance-metric ingestion and storage (Workstream A);
- Actions Center and Reserve with Google (Workstream J);
- lodging (Workstream I).
