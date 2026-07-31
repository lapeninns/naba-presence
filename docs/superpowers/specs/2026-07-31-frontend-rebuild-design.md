# Frontend rebuild — design

Date: 2026-07-31
Status: approved in discussion; awaiting written-spec review
Driver: the 2026-07-31 comprehensive frontend audit (nine specialist passes + live inspection)

## 1. Summary

Rebuild the NabaPresence frontend from scratch on a new blueprint. The backend
(API routes, services, domain logic, database, RLS) and the visual identity
(Google-palette tokens, design-system spec, `/design-system` proof surface)
are anchors and survive. Every line of the frontend app layer — pages, views,
client data layer, primitives usage — is replaced. Delivery is a single
big-bang branch: the old app layer is deleted at the start, the new frontend
is built to full feature parity, and nothing merges to `main` until the whole
bar is met.

## 2. Decisions (settled with the product owner)

| Question | Decision |
|---|---|
| Rebuild scope | New frontend blueprint. Backend APIs kept; visual identity kept; small backend additions only where the audit found full-stack gaps (capability flags, invitation revoke). |
| UX freedom | Same IA and screen inventory; every audit-flagged flow defect redesigned. |
| Feature parity | Full parity, including replacing the three raw-JSON consoles (Business info, Industry, Administration) with purpose-built field-level editors. |
| Delivery | Parallel big-bang on one branch; swap to `main` in one reviewed PR at full parity. |
| Architecture | Server-first hybrid: RSC first paint via direct service-layer calls + streaming; TanStack Query on the client for polling, mutations, invalidation; URL-driven state. Mutations keep using the existing `/api/*` routes. |

## 3. What is kept, what is deleted

**Kept (anchors):**
- `app/api/**`, `app/auth/confirm/route.ts` — the backend HTTP surface.
- `lib/server/**`, `lib/domain/**` — services and domain logic. RSC pages call
  these directly for reads; behaviour parity with the API by construction.
- `app/globals.css` tokens, `docs/specs/2026-07-28-design-system.md`,
  `app/design-system/page.tsx` (updated as primitives are re-admitted).
- `tests/integration/**` (backend unchanged → must stay green throughout),
  `tests/e2e/**` (adapted spec-by-spec as surfaces land), design-system
  contract tests, unit/domain tests.
- `supabase/`, `scripts/`, `instrumentation.ts`, CI pipeline.

**Deleted in the branch's first commit (the old blueprint):**
- `components/naba-presence/**`, `components/ui/**` (primitives re-enter
  one by one), `lib/naba-presence-api.ts`, `lib/naba-presence-data.ts`,
  `hooks/`, and all non-API page trees under `app/`.
- The fonts hack: `next/font/local` pointing into
  `node_modules/next/dist/next-devtools/` is replaced by the `geist` package
  immediately.

**Small backend additions (in scope, audit-mandated):**
- `lib/server/capabilities.ts`: one server-computed capability object per
  resource (`canEdit`, `canPublish`, `canManageTeam`, …) that mirrors the
  route guards exactly; exposed on session/resource payloads.
- `DELETE /api/invitations/:id` (revoke), plus surfacing existing-but-unused
  server data: verification `reasons`, activity `actorName`,
  `providerTotals.divergence`, privacy-request list/PATCH, legal-holds list.
- Locations linking stops hardcoding `timezone: "Europe/London"` (derive from
  Google data or prompt at import).

## 4. Repository layout

```
app/
  (auth)/          sign-in, forgot-password, reset-password, invite/[token]
  (dashboard)/     home, inbox, locations/[id]/<tab>, performance, settings/…
  api/**           unchanged (backend)
  error.tsx, global-error.tsx, not-found.tsx, layout.tsx
lib/
  server/          unchanged services + capabilities.ts
  api/             typed HTTP client for mutations (client.ts + per-domain modules)
  queries/         TanStack Query keys + hooks, one file per domain
  format/          single date/number/duration formatter set
components/
  ui/              curated primitives (one chrome, one focus ring)
  app-shell/       sidebar, header, skip link, live status region
  auth/ inbox/ locations/ settings/ reporting/   feature components
```

Legacy redirects survive as 3-line server pages: `/reviews→/inbox`,
`/overview→/home`, `/analytics→/performance`, `/connections→/settings/connections`
(the last one forwards its query string — the audit's C-2 bug).

## 5. Rendering model

Every route is a server component page that:
1. auth-gates (redirect before render; no flash),
2. prefetches initial data by calling `lib/server` services directly
   (no HTTP to ourselves),
3. streams with `Suspense` + `loading.tsx`,
4. renders a client feature component seeded via Query dehydration.

The `"use client"` boundary sits at feature-component level, never page level.
The error spine — `global-error.tsx`, `(dashboard)/error.tsx`,
`not-found.tsx`, per-route `loading.tsx`, and an isolation boundary around the
review detail pane — is built in the foundation milestone, first.

## 6. Data layer

**Query cache.** One `QueryClient`. Keys: `['session']` (seeded, never
refetched), `['connections']`, `['settings']`, `['review-counts', scope]`,
`['reviews', scope, filters, cursor]` (`keepPreviousData`),
`['review-detail', id]`, `['analytics', kind, range]`, `['locations']`, and
per-tab location resources. Defaults `staleTime: 30s`; queue + health carry
`refetchInterval: 60s` and `refetchOnWindowFocus` (replaces both hand-rolled
poll loops). Mutations invalidate their keys — counts/rows/badges update
within one round trip. The shell freshness chip (`connected / loading /
stale / disconnected / error`) is derived from query states; there is no
bespoke status state machine, no epochs, no queue-scope tokens.

**Typed mutation client.** All writes go through `/api/*` via
`ApiClientError { status, code, details }` with non-JSON-safe parsing and
zod-validated response shapes. One global 401 handler: stash dirty drafts
(sessionStorage, keyed by entity id), redirect to `/sign-in?next=…`, restore
on return. Server zod `details` map to form fields by path.

**URL as state.** Queue tab, filters, search, selected review, performance
tab, and workspace location live in searchParams. `router.replace` for
filters; `push` for selection on mobile so Back returns to the list.
Auto-selection of the first row happens only when the URL carries no
selection and nothing is dirty.

**Forms.** Shared zod schemas (client-safe, in `lib/domain`) +
react-hook-form resolvers; client and server validate identically; server
field errors render inline via the same path mapping.

**Dirty-draft invariant.** One `useDirtyGuard` hook — used by the reply
composer, hours/menu editors, and post composer — suppresses list-driven
selection changes and remounts while dirty, arms `beforeunload` and
dialog-dismiss confirms, and mirrors content to the sessionStorage stash.

## 7. Component system

**Primitive policy.** Only primitives a surface needs are admitted, restyled
once on entry: one control chrome (Input treatment: 14px radius, `bg-card`,
13.5px), one focus-ring recipe, `success | warning | info` variants on
Alert/Badge, coloured toast status icons. Accessibility by construction:
`CardTitle` renders a real heading (`as` prop); `SidebarInset` renders a
`div` (one `main` per page, owned by the page frame); icon-only buttons
require `aria-label` at the type level; `Skeleton` carries an `aria-busy`
contract; `Field` auto-wires ids / `aria-invalid` / `aria-describedby`;
multi-series charts render `ChartLegend` by default.

**Tokens.** Palette untouched. Named type roles (`--text-caption/-ui/-body/
-title/-page-title`; page titles 22px) replace every `text-[NNpx]`. The
`--nr-*` motion/radius/shadow tokens are wired into primitives as they are
admitted; the unused 14-step `--nr-space-*` scale is deleted and Tailwind's
default scale is documented as the spacing system. A dark `--info` pair is
added with measured ratios. One global reduced-motion rule covers overlay and
toast animations.

**Shell.** Skip link as first tab stop; polite live region announcing status
transitions; freshness indicator visible at all widths (compact dot +
sr-only text on mobile); no single-character hotkeys (the "d" theme toggle is
removed).

**Content standards.** One formatter set (dates show the year when not the
current year; org timezone; one casing). Humanised enums; no env-flag names,
byte counts, or internal jargon in copy — one mapping layer. Activity
timelines show actor names. Review content and the composer carry
`lang`/`dir="auto"`.

## 8. Route contracts (same IA, fixed flows)

**Auth.** Resend-confirmation from the unconfirmed-login state.
Status-specific messages for every `/auth/confirm` outcome. Show-password
toggles. Invalid reset token swaps the form for a request-another-link CTA.
Invitations distinguish accepted vs expired, handle an existing session
("accept as X" / "sign out to continue"), and every terminal state has an
exit. One post-auth landing (`/home`); `?next=` honoured. Rate-limited reset
requests say so.

**Inbox.** URL-driven everything. Cold load shows skeleton rows, never the
empty state; empty copy distinguishes no-data / filtered-out / disconnected.
Verification reasons listed inline and in the lifecycle panel. "Generate
draft" vs "Regenerate" by state; regenerate-over-edits confirms. Per-action
pending on the initiating button. Counts invalidate on mutation. Roving
tabindex + arrow keys on the list. Dates include the year when needed.
Dirty guard active. Publish/approve/regenerate gated by capabilities with
disabled-state reasons; approver flow includes the second-approver rule
in copy.

**Locations.** Workspace `h1` (location name) + tab nav with scroll
affordance and active-tab scroll-into-view. Hours, menu, photos, posts,
booking rebuilt as Field-based forms: per-field server errors, price
string-drafts with location-derived currency, photo size pre-check +
upload progress + input reset, dialog dirty-confirms, unknown location id →
`notFound()`.

**Consoles → real editors.**
- *Business info:* structured sections (identity, contact, categories, typed
  attribute controls) with a diff-vs-Google preview; update mask computed
  from touched fields; users never see masks or JSON.
- *Industry:* category pickers backed by the existing metadata search; typed
  attribute editors; mask auto-computed.
- *Administration:* admins list with add/remove flows; ownership transfer as
  its own guarded flow; delete-location isolated in a danger zone requiring
  the location's typed name. No JSON textareas or placeholder templates
  anywhere. All on existing API routes with UI-constructed payloads.

**Connections.** Decomposed cards (connection, account picker, import,
backfill, notifications, management) over three hooks
(`use-connection-workspace`, `use-google-accounts`, `use-location-import`)
and a single `derive-auto-selection` rule. OAuth return rendered: success
toast, mapped error + "Try again". Reconnect alert at the top when a token is
revoked. Import resolves re-link conflicts upfront in one dialog and reports
per-item results; per-action pending. Honest stepper (step 4 has a real
signal). Backfill polls lightly while anything is `running`.

**Settings.** Team: remove member, revoke invitation, role-select gating
(no "Owner" option for admins; last-owner demotion blocked with a hint),
"you" badge, expired-invite badges, viewer `canPublish` normalised. Policy:
one save path; timezone validated against `Intl.supportedValuesOf`.
Compliance: privacy-request list with status + resolution, legal-holds card
(owner-gated), exports via fetch-and-download with error handling, no PII in
GET query strings.

**Home / Performance.** Home KPIs derive from the counts endpoint (never a
page of reviews); attention list rows link to the location's low-rated
reviews; chart cards cross-link to Performance. Performance tab in the URL;
prior-window deltas with non-colour cues; the `providerTotals.divergence`
trust banner; zero-filled axes with integer ticks; `nulls last` location
table with honest null styling; fetched-at captions; loading / null / error
visually distinct.

## 9. Testing and parity

- **Component layer (new):** vitest + jsdom + Testing Library, landing with
  the first primitive. Every feature ships with loading / error / empty /
  mutation-failure tests. The connections hooks and dirty guard get dedicated
  unit tests.
- **E2e:** existing specs adapted as each surface lands. New specs:
  dirty-draft survival; OAuth callback outcomes (stub-driven);
  per-role permission walk (no reachable 403 from primary controls);
  one publish journey per location surface; approver journey; dark-mode
  product scan; axe best-practice pass with dialogs open; seeded bootstrap
  org for fresh-database determinism; `workers: 1` pinned.
- **Parity oracle:** the untouched backend integration suite must stay green
  at every milestone; the audit's §9 quality checklist is applied per route
  before that route counts as done.

## 10. Milestones and swap criteria

Milestones (branch stays demoable after each):
1. Foundation: deletion commit; fonts; error spine; Query + typed client +
   formatters; shell with skip link/live region; foundation primitives
   (Button, Field/Input/Label, Card, Alert, Badge, Skeleton, Spinner, Toast,
   Dialog); component test harness.
2. Auth (all four views + unhappy paths).
3. Shell + Home.
4. Inbox (the core journey, dirty guard, capabilities).
5. Locations wave 1 (workspace, profile, hours, photos, posts, booking, menu).
6. Connections + Settings (team, policy, compliance).
7. Reporting (Home polish + Performance).
8. Consoles (three purpose-built editors).
9. Hardening: full e2e adaptation, a11y passes, production build, audit
   checklist sweep.

**Swap to `main` requires:** all suites green (unit, integration, adapted
e2e, a11y including new passes); clean production build; zero reproducible
Critical/High findings from the 2026-07-31 audit; one reviewed PR; a tagged
rollback point on the pre-merge `main`.

## 11. Out of scope

- Backend behaviour changes beyond §3's listed additions.
- New visual identity, IA restructuring, or new product features.
- Virtualization of the review list (revisit only if persistent pagination
  shows >200-row pages in practice).
- Replacing webpack with Turbopack (known PostCSS worker issue).

## 12. Risks and mitigations

- **Big-bang integration risk** (accepted by decision): mitigated by
  milestone demos on the branch, the always-green backend integration suite,
  per-milestone e2e adaptation instead of end-loaded testing, and the
  deletion commit making scope unambiguous.
- **Two data paths (RSC prefetch + client cache):** mitigated by one rule —
  reads prefetch on the server into Query keys; the client only ever reads
  through Query; mutations only through the typed client.
- **Console redesign unknowns** (Google payload variety): the editors are
  built against the existing route schemas and the metadata search endpoint;
  where Google's model exceeds the editor, the field is read-only with an
  explicit "not editable here yet" note rather than a JSON escape hatch.
- **Timeline** (full parity before merge): milestone order front-loads the
  core journey so the highest-value surfaces are review-ready earliest.
