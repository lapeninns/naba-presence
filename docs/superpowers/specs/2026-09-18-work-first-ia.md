# Work-first IA — amendment to the agency UX spec

Written 2026-09-18. Amends `docs/superpowers/specs/2026-09-03-agency-ux.md`
§2 (information architecture) and the Home row of §5. Everything else in that
spec, and the whole of the Apple identity spec
(`docs/specs/2026-09-04-apple-identity.md`), stands. This is a change to what
is where, not to how it looks: no new tokens, type or primitives.

> **Amended 2026-09-19** by
> `docs/superpowers/specs/2026-09-19-listings.md`: §1 (Listings is a fifth
> nav item, active for `/listings/*`), §3 (the location workspace is now a
> listing overview with focused area pages at `/listings/[id]/…`) and §4
> (`/locations/*` redirects to `/listings/*`). Where the two disagree, the
> amendment wins.

## Why

Operators live in `/inbox`. Home existed to say "go to Inbox" with numbers
beside the link, so the first click of every session was a detour. The
location workspace offered ten peer tabs under four captions, which is a list
to scan, not three jobs to pick between. And the app tree carried sixteen
one-line `page.tsx` shims whose only job was to `redirect()`.

## 1. Primary navigation: four destinations

| Item    | Route      | Notes                                                                                                                        |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Inbox   | `/inbox`   | The landing page after sign-in. `/`, `/home` and `/overview` redirect here                                                   |
| Clients | `/clients` | Unchanged; still active for `/locations/*`                                                                                   |
| Reports | `/reports` | Org, client (`?clientId=`) and location (`?locationId=`) scope                                                               |
| More    | —          | A disclosure row holding Team `/team` and Settings `/settings`. Open when either is the current page; remembered per session |

Group labels are gone with the groups. The sidebar is one list: three links,
then the More disclosure with its two links indented beneath. The mobile sheet
renders the same list. The command palette's "Go to" group lists Inbox,
Clients, Reports, Team, Settings.

`Home` no longer exists as a destination, a nav label, a breadcrumb or a
palette entry. Every "Back to Home" becomes "Back to Inbox".

## 2. Inbox as home

`/inbox` keeps its title `Inbox` (the h1 now matches the nav label), its
queues, filters, chips, hotkeys, bulk bar, dirty guard, URL state and the
list-then-detail layout. It gains a **Today strip** between the header and
the queue tabs, which is where Home's useful parts land:

| Home block                  | Where it goes      | Shape in the strip                                                                                                                                                                                           |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup checklist             | Today strip, first | Unchanged card, only while the first client's setup is unfinished                                                                                                                                            |
| Work by client              | Today strip        | A row of client chips: health dot, name, open count. Busiest first. Pressing a chip scopes the inbox to that client (`clientId`); pressing again clears it. Hidden when the agency has one client            |
| Locations needing attention | Today strip        | One chip, "N locations need attention", opening a popover that lists the worst five with their unresolved low ratings, each linking to `/inbox?locationId=…&rating=1,2`. Hidden when nothing needs attention |
| Your work (queue list)      | Retired            | The queue tabs already show the same server counts                                                                                                                                                           |
| Health KPIs, Pulse chart    | Retired from Inbox | Reports › Reply performance carries the same figures with ranges and deltas                                                                                                                                  |
| Google-disconnected banner  | Retired from Inbox | The client hub and the reconnect banner already say so inside the affected client; the toolbar chip says so everywhere                                                                                       |

The strip is a `section` labelled "Today". It is one row tall on desktop and
scrolls horizontally on a phone. It renders nothing at all when it has
nothing to say, so a caught-up single-client agency sees the inbox exactly as
before.

## 3. Location workspace: three jobs

`/locations/[id]` keeps its URL, breadcrumb, sibling switcher and activity
drawer. The section switcher becomes a three-segment control:

| Job     | Route                                         | Content                                                                                                                                                                                                                         |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing | `/locations/[id]`                             | One scroll: Business profile, Opening hours, Booking links, Suggested updates. An in-page anchor row under the switcher jumps between them. Each editor keeps its own footer; a footer pins only while its section is on screen |
| Content | `/locations/[id]/photos` · `/posts` · `/menu` | A segmented control (three real links) under the switcher. `/locations/[id]/content` is not a route                                                                                                                             |
| Access  | `/locations/[id]/access` · `/verification`    | Same shape, two links. Owner/admin only, as today                                                                                                                                                                               |

Performance leaves the workspace. `/locations/[id]/performance` redirects to
`/reports?locationId=[id]`, and Reports renders the location's own report
under a scope bar naming the location and its client, with "All clients" to
clear. The client hub's per-location quick links become Listing · Photos ·
Posts · Reports.

`/locations/[id]/hours`, `/booking` and `/suggestions` redirect to the
Listing job's anchor (`#hours`, `#booking`, `#suggestions`).

## 4. Redirects

Every hop whose target is fixed moves to `next.config.ts` `redirects()`.
Query strings are forwarded by default, which is what `/login`, `/reviews`,
`/performance` and `/connections` relied on.

| From                                               | To                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `/home`, `/overview`                               | `/inbox`                                                                 |
| `/reviews`                                         | `/inbox`                                                                 |
| `/analytics`, `/performance`                       | `/reports` (one hop; `/analytics` used to bounce through `/performance`) |
| `/login`                                           | `/sign-in`                                                               |
| `/connections`                                     | `/settings/connections`                                                  |
| `/settings/team`                                   | `/team`                                                                  |
| `/locations/:id/administration`                    | `/locations/:id/access`                                                  |
| `/locations/:id/business-information`, `/industry` | `/locations/:id`                                                         |
| `/locations/:id/hours`, `/booking`, `/suggestions` | `/locations/:id#<segment>`                                               |
| `/locations/:id/performance`                       | `/reports?locationId=:id`                                                |

Five hops depend on the session — `/profile`, `/profile/*`, `/photos`,
`/posts`, `/settings/listing` resolve to the one visible location or to
Clients — so they stay as server pages at the app root, unchanged.

`/` stays a server page: it sends a signed-in visitor to `/inbox` and an
anonymous one to `/sign-in`.

## 5. Auth and setup

Same steps, same APIs, same components. Sign-in, password reset and the
email-confirm route land on `/inbox` instead of `/home`. Access-denied and
error pages point back to Inbox. No layout change is made to the auth card or
the setup wizard in this amendment; they were rebuilt on the Apple system two
weeks ago and nothing in the IA change touches their flow.

## 6. States

| Surface                 | State                    | What shows                                                        |
| ----------------------- | ------------------------ | ----------------------------------------------------------------- |
| Today strip             | nothing to say           | Not rendered                                                      |
| Today strip             | clients loading          | Skeleton chips, `aria-busy`                                       |
| Today strip             | one client               | Setup card and attention chip only                                |
| Client chips            | pressed                  | Solid accent, `aria-pressed`, the inbox filtered to that client   |
| Attention popover       | analytics failed         | "We couldn't check which locations need attention" with Try again |
| Listing job             | an editor fails          | That editor's own retry; the others render                        |
| Reports, `?locationId=` | unknown id               | "This location isn't in your directory" with "All clients"        |
| More disclosure         | Team or Settings current | Open, the current link marked `aria-current="page"`               |

## 7. Tests

Unit: `nav`, `location-ia`, `location-tab-nav`, `breadcrumb-trail`,
`next-config` (redirect table), Today-strip components.
End-to-end: `foundation`, `home` (renamed `inbox-home`), `routing`, `inbox`,
`journeys`, `accessibility`, `locations`, `gbp-management-tabs`, `reports`.
Gates unchanged: `pnpm check:contrast`, the design-system contract test, and
the pinned axe structure rules.
