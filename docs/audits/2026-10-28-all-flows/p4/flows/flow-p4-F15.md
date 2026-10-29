# p4-F15: Follow an old flat link (/photos, /posts, /profile, /profile/<section>, /settings/listing)

Worktree `/tmp/naba-presence-p4` @ `e4123d25`. Read-only. `pnpm exec vitest run tests/flat-route-redirect.test.ts tests/next-config.test.ts`: 2 files, 19 tests passed.

## 1 Start / end

- **Start:** a bookmark or old link to one of five retired single-business paths. All five are server pages at the app root, outside `(dashboard)`, so the redirect fires before any shell HTML streams (`app/profile/page.tsx:8-17`).
- **Decision:** `flatRouteTarget(segment, {searchParams, moved})` (`lib/server/flat-route-redirect.ts:28-40`) calls `resolvePrimaryLocation()` (`lib/server/primary-location.ts:34-56`). Exactly 1 visible location goes to `/listings/<id>[/<segment>]`. 0 or 2+ go to `/clients?…&moved=<section>`.
- **End:** a listing area, or the Clients index with an info banner. Business-mode sessions are then bounced from `/clients` to `/listings` (see 3).
- These are not in `next.config.ts` `RETIRED_ROUTES`, by design (`next.config.ts:62-65`, asserted in `tests/next-config.test.ts:127-138`). `proxy.ts` only stamps `x-naba-request-path` and does no redirects or auth.

## 2 Roles and gates

- **Visibility** (`lib/server/permissions.ts:170-190`): owner/admin see every location. Member/viewer see all when `location_scope='all'`, otherwise only locations with a `location_member` grant. A client-share scope sees its client's locations.
- **Count:** `locationCount = rows.length` from `listLocationDirectoryRows` (`lib/server/location-directory.ts:17-48`). This includes unlinked locations. Unverified: whether locations under archived clients are excluded (the query has no archived filter).
- **Member/viewer with 1 granted location:** goes straight to `/listings/<id>/<seg>`. For `/settings/listing` that is `/people`, which renders for every visible role. `AccessTab` shows `AccessNotice` with the edit and publish reasons, so the page is read-only for those roles (`components/locations/administration/administration-tab.tsx:391-412`).
- **Signed out:** `getSession()` is null, so the helper returns `EMPTY` (count 0) → `/clients?moved=<x>`. Then the `(dashboard)` layout redirects to `/sign-in?next=%2Fclients%3Fmoved%3D<x>` (`app/(dashboard)/layout.tsx:38-46`, `lib/api/next-path.ts:35-39`). The return URL is **Clients, not the original path**. In dev/local bootstrap, anonymous visitors are allowed through to Clients.
- **Business mode:** `/clients` runs `redirectOutOfClientLayer(session, "/clients")` → `businessModeRedirect` → bare `/listings` (`app/(dashboard)/clients/page.tsx:15`, `lib/workspace/terms.ts:117-126`). The query and `moved` are dropped.

## 3 Behaviour table per path

| Old path            | segment / `moved`                                                                    | 1 visible location                                      | 0 or many (agency)           | 0 or many (business)         |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------- | ---------------------------- |
| `/photos`           | `photos` / `photos` (`app/photos/page.tsx:15-18`)                                    | `/listings/<id>/photos?<q>`                             | `/clients?<q>&moved=photos`  | `/listings` (q + moved lost) |
| `/posts`            | `posts` / `posts` (`app/posts/page.tsx:15-18`)                                       | `/listings/<id>/posts?<q>`                              | `/clients?<q>&moved=posts`   | `/listings`                  |
| `/profile`          | `""` / `profile` (`app/profile/page.tsx:24-27`)                                      | `/listings/<id>?<q>` (overview, not the profile editor) | `/clients?<q>&moved=profile` | `/listings`                  |
| `/profile/<s>[/…]`  | `flatSegmentFor(section[0])` / `profile` (`app/profile/[...section]/page.tsx:19-22`) | `/listings/<id>/<mapped>?<q>`                           | `/clients?<q>&moved=profile` | `/listings`                  |
| `/settings/listing` | `people` / `listing` (`app/settings/listing/page.tsx:16-19`)                         | `/listings/<id>/people?<q>`                             | `/clients?<q>&moved=listing` | `/listings`                  |

- **`FLAT_SEGMENT_MAP`** (`flat-route-redirect.ts:65-81`): profile, hours, menu, booking, photos, posts, people, verification, suggestions and changes map to themselves. `details` and `industry` map to `profile`.
- **Unknown or inherited sections:** `/profile/nonsense`, `/profile/constructor` and `/profile/__proto__` go to `""`, the listing overview, through an `Object.hasOwn` guard (`:89-92`). Extra path parts after the first are ignored.
- **Query forwarding** (`withForwardedQuery`, `:47-62`): every key is forwarded and repeated keys stay repeated. A stale `moved` in the old query is replaced, not duplicated, on the Clients branch. On the 1-location branch it passes through untouched, which is harmless.
- **Status codes:** `redirect()` gives a 307. The config redirects are `permanent: false`.

## 4 States: landing banner copy (Clients thread p2 owns this)

- **Copy:** `movedNotice()` (`components/clients/clients-index.tsx:89-95`), using the `MOVED_SECTIONS` map (`:75-86`):
  - mapped value: **"`<Name>` moved — pick a client, then its listing."**
  - any other value: **"That page moved — pick a client, then its listing."**
- **Coverage per `moved` value:**
  - `photos`: "Photos moved — pick a client, then its listing."
  - `posts`: "Posts moved — pick a client, then its listing."
  - `profile`: "Profile moved — pick a client, then its listing."
  - `listing`: **no entry.** The map has `listings`, not `listing`, so `/settings/listing` gets the generic "That page moved — …".
  - Dead entries: `hours`, `menu`, `menus`, `reviews`, `locations`, `listings` and `performance` are never sent. `/profile/hours` sends `moved=profile`, so it reads "Profile moved".
- **Render** (`:182-191`): `<Alert variant="info">` with `AlertTitle` and a secondary "Got it" button that `router.replace`s `moved` out of the URL (`:180`).
- **Where it shows:** the archived view (`:196`), the empty state (`:252`) and the list (`:307`).
- **Where it doesn't:** not while `clients.isPending` (skeleton, `:207`) and not on `clients.isError` (`:209-235`). On a failed load the user has no explanation.
- **Empty-state pairing** (`:250-288`):
  - Owner/admin with 0 clients: banner "Photos moved — pick a client…" above "Set up your first client".
  - Member with 0 grants: banner above "No clients shared with you yet", which tells them to pick something that doesn't exist.

## 5 Protected rules (deep links must not break)

1. None of the five paths may 404. Each must resolve to a listing area or to Clients/Listings (`flat-route-redirect.ts:14-18`).
2. Keep these off the static `RETIRED_ROUTES` table. They depend on the session (`tests/next-config.test.ts:127`).
3. Keep the shims at the app root, outside `(dashboard)`, so no streamed shell shows at the old URL (`app/profile/page.tsx:8-17`).
4. The query is forwarded verbatim, repeated keys included. `moved` is set once.
5. `/profile/<inherited-prop>` must never interpolate a function body (the `Object.hasOwn` guard).
6. Every hop stays temporary (`tests/next-config.test.ts:120`).
7. Signed-out deep links must survive sign-in via a sanitised `?next=` (`lib/api/next-path.ts:9-39`).

## 6 15 Oct audit status (`docs/audits/2026-10-15-ux-flows`)

- `findings.md`, `plan.md` and `results.md` have **no finding** on flat routes, `?moved=` or the banner. This flow was not audited.
- The only hits are bundle measurements that list `/settings/listing` as a route. It is 473.5 KB gzip, flagged over the 400 KB budget in `followups-f11/2026-10-18/summary.json:233`, and also appears in `baseline/route-js.md:26` and `after/route-js.md:29`.
- That page has only been a redirect since 4 Sep (`88edbd18`, `1fe24aab` 24 Sep), so the JS figure is shared layout weight on a page nobody sees. It is measurement noise, not UX.

## 7 Friction

- **P2: signed-out deep link loses its target.** `resolvePrimaryLocation` returns count 0 without a session, so `/photos` goes to `/clients?moved=photos` and then `/sign-in?next=/clients?moved=photos`. After sign-in, a 1-location user lands on Clients (agency) or bare `/listings` (business) instead of their Photos tab. Evidence: `primary-location.ts:37`, `flat-route-redirect.ts:33-39`, `layout.tsx:41-45`. Hypothesis: most old bookmarks are opened from a cold or expired session, so this is the common path, not the edge.
- **P2: business mode drops the explanation and the query.** A business with 2+ locations following `/photos?tab=cover` ends at `/listings` with no banner and no query (`clients/page.tsx:15`, `terms.ts:119`). Hypothesis: users read the silent jump as a broken bookmark. No test covers this.
- **P3: `/settings/listing` banner is generic.** "That page moved — …" instead of naming it (`clients-index.tsx:75-86`, there is no `listing` key). The copy also doesn't say where the thing went (People on the listing).
- **P3: the banner contradicts the empty states.** "Pick a client" sits above "Set up your first client" or "No clients shared with you yet" (`:250-288`). There is no banner on the error state (`:209`).
- **P3: `/profile` with 1 location lands on the overview, not the profile editor.** `/profile/<unknown>` does the same. That is defensible, since `/profile` was the whole single-business area, but it differs from `/profile/profile`. Hypothesis: low impact.
- **P3: the banner names the parent, not the bookmarked section.** `/profile/hours` reads "Profile moved" because the section is not carried in `moved`.

## 8 Proposed changes (max 3)

1. **p4 owns this.** In `flatRouteTarget`, when there is no session, return `/sign-in?next=<original flat path + query>` (via `signInPathFor`) rather than `/clients`, so the decision is made after auth. The shims need the requested path, so pass it in from each page or read `x-naba-request-path`. Add a unit case with `primary-location` mocked to `getSession() = null`, and an e2e case that a signed-out `/photos` ends at `/listings/<id>/photos` for the 1-location member after sign-in.
2. **p4 owns this; it touches `lib/workspace/terms.ts` and `clients/page.tsx`, so coordinate with p2.** For business mode with 0 or many locations, send the flat routes straight to `/listings?<q>&moved=<x>` from `flatRouteTarget`. The session already gives `workspaceMode`, so `/clients` never has to strip it. The `/listings` page would need its own `moved` banner, which is a Listings-thread change. Flag it; don't plan the edit here.
3. **Flag to p2; don't edit.** Add `listing: "Listing access and verification"` (or similar) to `MOVED_SECTIONS` and name the destination ("now under People on each listing"). Suppress the "pick a client" line when the list is empty, and show the banner on the error state too.

## 9 Tests that cover it

- `tests/flat-route-redirect.test.ts` (unit, passing):
  - many → Clients with the query and `moved`; 1 → listing with the query; bare `/clients`
  - `moved` replaced
  - segment map, unknown → overview, inherited props → overview
- `tests/next-config.test.ts:120-138`: the flat routes are absent from the static table, and every hop is temporary.
- `tests/components/clients-index.test.tsx:405-416`: "Photos moved — …" renders; unknown → generic; null → none.
- `tests/e2e/routing.spec.ts:387-411`:
  - owner cookie, paths `/profile`, `/profile/hours|menu|booking`, `/photos`, `/posts`
  - asserts only "landed ≠ path and is `/clients` or `/listings/*`"
  - doesn't assert the banner, query forwarding or `/settings/listing`
- **Gaps:** signed-out flat link; business mode with 2+ locations; member/viewer with 1 grant; `moved=listing` copy; banner on empty and error states.

## 10 Screenshot states

- **Fixture:** `tests/e2e/helpers/stub-bridge.ts:112-135` seeds an **agency** tenant (`tests/integration/helpers/tenant.ts:49` default) with **two locations**, since each `seedLinkedReview` call inserts its own `location` (`tenant.ts:240,266`). All of them sit under one client (`clientId`). An owner cookie therefore always takes the many → Clients branch.
- **States to capture:**
  - (a) owner `/photos?tab=cover` → `/clients?tab=cover&moved=photos`, list with the "Photos moved" banner, at 390 and 1280
  - (b) owner `/settings/listing` → generic "That page moved" banner
  - (c) `memberAssignedCookie` (one `location_member` grant, scope `assigned`, `stub-bridge.ts:329-334`) `/settings/listing` → `/listings/<primary>/people`, read-only
  - (d) `memberUnassignedCookie` `/posts` → banner above "No clients shared with you yet"
  - (e) signed-out `/photos` → `/sign-in?next=%2Fclients%3Fmoved%3Dphotos`, a production-mode build only, because dev lets anonymous through
  - (f) after "Got it" → banner gone, `moved` stripped from the URL
- Business-mode 2+ locations has no seeded fixture, so it needs a `createTestTenant({workspaceMode:"business"})` with two linked reviews.
