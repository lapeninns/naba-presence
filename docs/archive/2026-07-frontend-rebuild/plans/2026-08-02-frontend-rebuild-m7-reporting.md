# M7 Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Reporting milestone — polish the already-shipped Home surface and build the `/performance` surface (three tabs: reply performance, Google performance, keyword impressions) plus a per-location performance tab — on the M1 foundation and the M3–M6 Query/typed-client/token machinery, closing the audit-flagged spec §8 "Home / Performance" clauses. Every reporting read is `requireSession` (role-open, location-scoped server-side), so **this milestone touches ZERO protected paths** — the first milestone with no sanctioned backend edit at all. The only privileged reporting action ("Refresh Google data") gates client-side on owner/admin and POSTs the existing sync routes.

**Architecture:** Each route is a synchronous server component rendering a `"use client"` feature component that reads through TanStack Query over the M1 typed client (`apiFetch` + zod), with a route-level `loading.tsx` Suspense fallback — consistent with M3–M6. `app/(dashboard)/home/page.tsx` gains chart cards (server counts + analytics summary widened to the full endpoint shape, a `providerTotals.divergence` trust banner, and an attention list that links each location's low-rated reviews). `app/(dashboard)/performance/page.tsx` renders a client `PerformanceView` whose active tab lives in the URL (`?tab=reply|google|keywords`) via a Base UI `Tabs` synced to `useSearchParams`; each tab owns its own range vocabulary (reply: `from`/`to`+`granularity`; Google: `28d/90d/12m/18m`; keywords: `1m/6m/12m/18m`) because the three endpoints speak three different range dialects. Charts are a new `components/ui/chart.tsx` recharts wrapper themed only with the pre-existing `--chart-1..5` M1 tokens (no raw hex), with integer-tick, zero-filled axes and explicit loading/empty/error states. The five presence/keyword `state` values, the env-flag booleans, and the keywords `503 keywords_paused` all map through one humanisation layer to visually-distinct honest panels; response-time figures pass through a `formatDuration` hardened against clock-skew negatives; missing metrics render nulls-last with honest null styling (missing ≠ 0); prior-window deltas carry a non-colour arrow/sign cue. The per-location tab (a 7th location-workspace tab) assembles its review metrics by filtering the org-wide `overview.locations[]` by id client-side (the overview endpoint has no `locationId` param) and pulls Google metrics/keywords via `presence?locationId=` / `keywords?locationId=`.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives (1.6.0), TanStack Query v5, zod 4, recharts 3.8.0 (already installed), Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m7-reporting` (cut from `main` @ `86ebf5e`). Delivery model is **per-milestone merge to `main`** (spec §10). `main` serves a partially-rebuilt product: the `/performance` sidebar link 404s until this milestone lands; the three M8 location consoles do not exist yet.
- **No new dependencies.** recharts@3.8.0 is already in `package.json` (pre-rebuild scaffold), so the M1 no-new-deps rule is satisfied. Every other primitive already exists in `@base-ui/react` (`tabs`, `select`) or is a styled element admitted in M4/M5 (`Table`, `Card`, `Alert`, `Badge`, `Empty`, `Skeleton`, `Spinner`). NEW primitive this milestone: `Chart` (recharts wrapper, restyled once on entry per the M1 policy — one theme, token-only colours, a11y-by-construction).
- **Protected paths — do NOT touch, CONSUME ONLY:** `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. **M7 expects ZERO protected-path edits.** If any task appears to need one, STOP and flag it — the reporting reads are `requireSession` (role-open, location-scoped server-side) and the sync POSTs already exist, so no capability or route needs to change. `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` must be **empty** at merge. Type-only / const-only imports from the client-safe `lib/domain/google-contract.ts` and `lib/domain/workflow.ts` are consumption, not edits, and are fine. Everything M7 creates lives under `lib/format/**`, `lib/api/**`, `lib/reporting/**`, `lib/queries/**`, `components/**`, `app/(dashboard)/**`, and `tests/**` — all non-protected.
- Styling: M1 tokens only. No raw hex — **chart series colours come from the existing `--chart-1..5` CSS vars** (via Tailwind `stroke-chart-N`/`fill-chart-N` or `var(--chart-N)`), never a literal colour. No `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N` (use `--nr-duration-*`), only defined `--nr-radius-*`/`--nr-gap-*` tokens. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`).
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`). TanStack Query hooks carry `staleTime: 30s` (spec §6) and reuse the existing `queryKeys.analytics(kind, params)` and `queryKeys.reviewCounts(scope)` — the spec's `['analytics', kind, range]` and `['review-counts', scope]` (they already exist in `lib/queries/keys.ts`; no key edit needed). All writes (the sync trigger) go through the typed client via `ApiClientError { status, code, details }`; server codes map to user copy through one humanisation layer — no component invents its own error text or shows a raw code/enum/env-flag name/byte count.
- Copy: GB English, sentence case, no internal jargon, no env-flag names, **no error codes / raw metric enums / raw `last_error_code` values shown to users**. One mapping layer (`lib/reporting/**`).
- Every page renders exactly one `<h1>` and exactly one `<main>` (both owned by `PageFrame`/`PageHeader`; feature components add only `<h2>` and below).
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The gate command (Task 8): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`.

## Design decisions (LOCKED — encode exactly)

- **D1 — Rendering = client-fetch; §5 server-hydration DEFERRED to M9.** Every route is a sync server component rendering a `"use client"` feature component that fetches via Query, with route-level `loading.tsx` Suspense — consistent with M3–M6. Spec §5's "prefetch initial data by calling `lib/server` services directly … seeded via Query dehydration" is **DEFERRED** and recorded as a carry-forward. Unlike Locations, **no `lib/server` analytics service exists** — the four analytics routes compute inline in the route handler; extracting them into `lib/server/analytics.*` for byte-parity RSC prefetch is net-new *protected* work best consolidated into M9's full-parity hydration pass (the client contract "the client only ever reads through Query", spec §6, is already met — reads flow through the named Query keys). **Consequence: M7 has ZERO sanctioned protected-path edits.** Every task's Files list must touch NO protected path.
- **D2 — Charts = recharts@3.8.0 (already installed, NOT a new dep).** Build the first chart primitive `components/ui/chart.tsx`: a thin recharts wrapper themed with the **pre-existing** `--chart-1..5` M1 CSS-var tokens (verified present in `app/globals.css`, identical light/dark, decorative-exempt) — no raw hex; a default `ChartLegend` for multi-series (§7); zero-filled axes with **integer ticks** (§8, `allowDecimals={false}`). Charts are `"use client"`. The wrapper provides `ChartLoading`/`ChartEmpty`/`ChartError` slots so every chart card has loading/empty/error states.
- **D3 — `formatDuration` negative guard (the M1→M7 carry-forward).** `lib/format/duration.ts` currently guards only `null`/non-finite; a negative response-time (clock-skew: a reply/edit whose stored time precedes the review `create_time`) renders "-2m". Add a `< 0 → "—"` guard BEFORE any response-time KPI/table cell renders. `lib/format` is non-protected.
- **D4 — Divergence trust banner.** Render ONLY when `providerTotals.divergence === true`. Copy explains the displayed figures may be incomplete or stale versus what Google itself reports — no jargon, no raw numbers-as-code, no env-flag names. Requires widening the analytics client schema to stop stripping `providerTotals` (D8). Shared component reused by Home (D8) and the reply-performance tab.
- **D5 — Per-location performance tab.** Add a 7th tab to `components/locations/location-tab-nav.tsx` (+ `app/(dashboard)/locations/[id]/performance/page.tsx`). The overview endpoint has **no `locationId` param** → assemble the per-location review metrics by **filtering `overview.locations[]` by id client-side**; pull Google metrics/keywords via `presence?locationId=` / `keywords?locationId=`. There is no per-location summary object — derive every review figure from that one `locations[]` row. Because `overview.locations` inner-joins `review`, a location with zero in-window reviews is simply absent from the array → render an honest "no review activity in this window" panel, never an error.
- **D6 — Three date-range vocabularies → per-tab range selectors.** overview speaks `from`/`to`+`granularity` (day/week/month); presence speaks `28d/90d/12m/18m`; keywords speaks `1m/6m/12m/18m`. Do NOT force one shared control — each tab owns its own `RangeSelect` bound to its endpoint's dialect. Presets live in `lib/reporting/ranges.ts`.
- **D7 — Humanise (§7).** `lib/reporting/metric-labels.ts` maps the 11 `GOOGLE_PERFORMANCE_METRICS` enum values to human labels; `lib/reporting/unavailable-reasons.ts` maps raw `sync_checkpoint.last_error_code` strings to human copy with a safe generic fallback (the code universe is open — it is whatever `error.code` a thrown sync error carries, defaulting to `performance_sync_failed`/`keyword_sync_failed` — so the fallback is load-bearing); `lib/reporting/keyword-impressions.ts` presents `thresholded` keyword volumes honestly as "N+" (Google gave a lower-bounded range, not an exact count). NEVER show a raw enum, code, or `last_error_code`.
- **D8 — Home polish.** Widen `lib/api/analytics.ts` from its current 3-field slice to the full endpoint shape, then: widen the KPI row to the full summary (keeping the existing "Total reviews" / "Needs attention" / "Average rating" / "Response rate" labels the e2e asserts, adding median first-response time, unresolved complaints, verification rejection rate); add chart cards (review volume + average rating over the series) that cross-link to `/performance`; add the divergence trust banner (D4); refine the attention list to link the location's LOW-RATED reviews (`/inbox?locationId=<id>&rating=1,2`, the real inbox URL contract) rather than the bare `?locationId=`; fix the attention-list loading skeleton from 3 rows to 5 (`MAX_ROWS`); add fetched-at captions. Keep `tests/e2e/home.spec.ts` green (its KPI labels + `/overview→/home` redirect + light/dark axe) and EXTEND it.
- **D9 — States.** presence/keywords return a `state` enum (`no_link|ready|unavailable|pending|empty`) + env flags (`ingestionEnabled`/`keywordsEnabled`) and keywords additionally `503 keywords_paused` → map ALL to visually-distinct honest panels (§8 "loading / null / error visually distinct"). presence does NOT 503 when ingestion is off — it returns `ingestionEnabled: false` in the body, which the tab reads to show an "off" panel (never a flag name). Location tables render **nulls-last with honest null styling** (a muted "—", missing ≠ 0). Prior-window deltas carry a **non-colour cue** (arrow + sign, not red/green alone). Fetched-at captions derive from `freshThrough` / `from`–`to` / keyword `latestMonth`.
- **D10 — Housekeeping.** Add the `/analytics → /performance` redirect (§4) as a 3-line server page mirroring the existing `/overview → /home` precedent (`app/(dashboard)/overview/page.tsx` is `redirect("/home")`), so the new file is `app/(dashboard)/analytics/page.tsx` (CODE precedent overrides the brief's `app/analytics/page.tsx`). Flip `components/app-shell/nav.tsx` `/performance` `prefetch:false → true` (now that the route ships) and update the nav test. The `attention-list`/`disconnected-banner` `prefetch={false}` comments that reference now-existing routes are noted but their targets (`/inbox`, `/settings/connections`) already ship from M4/M6, so those two are already `prefetch`-safe and out of M7 scope.
- **D11 — Zero protected-path footprint (the M7 highlight).** Unlike M4/M5/M6 (each had one sanctioned protected edit), M7 has **none**. `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` must be empty at merge — this is a hard exit criterion, not a nice-to-have.
- **D12 — Performance tabs are in-page URL-synced tabs, not route segments.** `/performance` is ONE page rendering a Base UI `Tabs` whose active value is driven by `?tab=reply|google|keywords` (`useSearchParams` + `router.replace`), so all three tab controls render as `role="tab"` on one page and the active tab is shareable/deep-linkable ("Performance tab in the URL", §8). This matches the pre-existing (quarantined) `tests/e2e/performance.spec.ts`, which asserts both "Reply performance" and "Google performance" tabs visible simultaneously on `/performance`. (The per-location performance tab in D5 IS a route segment, consistent with the Locations workspace's route-segment tab model.)
- **D13 — Standard constraints** (copied into Global Constraints above): M1 tokens only (chart colours from `--chart-1..5`); one h1/one main; GB English / no error codes / no raw enums / no env-flag names shown; protected paths consume-only with a ZERO footprint; no new deps (recharts pre-installed); client-fetched (§5 deferred, D1); hand-rolled `useState` + zod where any control state appears (no react-hook-form — not installed); gate green before each commit + `pnpm build` for page tasks; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Backend response shapes consumed (READ-ONLY — M7 sanctions NO edit)

- `GET /api/analytics/overview` (`requireSession`; location-scoped for non-owner/admin via an inline visibility subquery; **NO `locationId` param — org-wide**) query `{ from?: isoDateTime, to?: isoDateTime, granularity: "day"|"week"|"month" = "day" }` (default window = last 30 days) → `{ from: string, to: string, timezone: string, summary: { reviewVolume: number, averageRating: number|null, responseRate: number|null, unresolvedComplaints: number, verificationFailures: number, verificationRejectionRate: number|null, medianFirstResponseSeconds: number|null, p95FirstResponseSeconds: number|null, medianLatestEditSeconds: number|null }, series: Array<{ period: string, reviewCount: number, reviews: number, replies: number, averageRating: number|null }> (zero-filled in org tz), locations: Array<{ id: string, name: string, reviews: number, averageRating: number|null, responseRate: number|null, medianFirstResponseSeconds: number|null, p95FirstResponseSeconds: number|null, medianLatestEditSeconds: number|null, unresolvedComplaints: number, verificationRejectionRate: number|null }> (ordered rating desc; inner-joined on review — locations with 0 in-window reviews are ABSENT), providerTotals: { averageRating: number|null, totalReviewCount: number|null, localReviewCount: number, divergence: boolean } }`. The current `lib/api/analytics.ts` schema STRIPS `from`/`to`/`series`/`providerTotals`/most-of-`summary`/the per-location rate+response fields — **T1 widens it.**
- `GET /api/analytics/presence` (`requireSession` + location visibility; **no role gate; no 503 when ingestion is off**) query `{ range: "28d"|"90d"|"12m"|"18m" = "28d", locationId?: uuid }` → `{ range: string, from: string, to: string, state: "no_link"|"ready"|"unavailable"|"pending"|"empty", freshThrough: string|null, locations: Array<{ id: string, name: string }>, totals: Record<GooglePerformanceMetric, number> (zero-filled, all 11 keys), series: Array<{ date: string, metrics: Partial<Record<GooglePerformanceMetric, number>> }>, unavailableReasons: string[] (raw `last_error_code` — HUMANISE), keywordsEnabled: boolean, ingestionEnabled: boolean }`.
- `GET /api/analytics/presence/keywords` (`requireSession` + visibility; **throws `503 keywords_paused` BEFORE parsing when `!GBP_KEYWORDS_ENABLED`**) query `{ range: "1m"|"6m"|"12m"|"18m" = "6m", locationId?: uuid }` → `{ range: string, from: string, state: "no_link"|"ready"|"unavailable"|"pending"|"empty", locations: Array<{ id: string, name: string }>, keywords: Array<{ rank: number, keyword: string, impressions: number, upperBound: number, thresholded: boolean, firstMonth: "YYYY-MM", latestMonth: "YYYY-MM" }> (top 100), unavailableReasons: string[] }`. Note: NO `to`, NO `freshThrough`, NO env flags in the body. `thresholded` = Google returned a lower-bounded range, `upperBound = impressions + threshold`; present honestly as "N+".
- `GET /api/reviews/counts` (`requireSession`; `requireLocationAccess` when `locationId` present) query `{ locationId?: uuid }` → `{ total: number, byStatus: Record<ReviewWorkflowState, number> }`. `ReviewWorkflowState ∈ new|drafted|verified|awaiting_approval|publish_requested|published|rejected|failed|escalated`. Already consumed adequately by `lib/api/review-counts.ts` (`z.record(z.string(), z.number())`) — **reused as-is, no widening.**
- `POST /api/sync/performance` and `POST /api/sync/keywords` (a session caller must pass `requireRole(["owner","admin"])`; else a cron `Authorization: Bearer <CRON_SECRET>`) → `{ organisations, skipped, nextCursor }`. `503 performance_paused` / `503 keywords_paused` when the respective env flag is off. The ONLY privileged reporting action — the "Refresh Google data" button gates client-side on owner/admin and POSTs an empty body `{}` (the session branch syncs only the caller's org). GET reads never call Google; these POSTs do (stubbed in e2e via `GOOGLE_API_PROXY_BASE`).

**Client-safe constants import (already client-safe — `lib/domain/google-contract.ts` is pure consts/functions, no `server-only`, no node builtins):** `GOOGLE_PERFORMANCE_METRICS` (the 11 enum values, in order) and `type GooglePerformanceMetric`. `lib/domain/workflow.ts` (`REVIEW_WORKFLOW_STATES`, `type ReviewWorkflowState`) is likewise client-safe for type-only use. Importing these is consumption, not a protected edit.

**Cross-cutting error envelope:** every non-2xx returns `{ error: string (code), message: string, details?: unknown }`; `apiFetch` rethrows it as `ApiClientError { status, code, message, details }`. The reporting humanisers map `code` (and the presence/keywords `state`) to copy; the raw `code`/`message` is never rendered.

## File structure

```
lib/format/
  duration.ts                         MODIFY (Task 1): negative → "—" guard (D3)
  delta.ts                            NEW (Task 1): formatDelta + deltaDirection (non-colour cue source)
  index.ts                            MODIFY (Task 1): re-export formatDelta / deltaDirection
lib/reporting/
  ranges.ts                           NEW (Task 1): REPLY_RANGES / PRESENCE_RANGES / KEYWORD_RANGES presets + resolvers
  metric-labels.ts                    NEW (Task 1): GooglePerformanceMetric -> human label + ordered list
  unavailable-reasons.ts              NEW (Task 1): last_error_code[] -> human copy (safe fallback)
  keyword-impressions.ts              NEW (Task 1): honest "N+" / exact formatter
  sync-permission.ts                  NEW (Task 1): canTriggerSync(role)
lib/api/
  analytics.ts                        MODIFY (Task 1): WIDEN to full overview schema (series/providerTotals/full summary/per-location fields)
  presence.ts                         NEW (Task 1): presence zod mirror + fetchPresence
  keywords.ts                         NEW (Task 1): keywords zod mirror + fetchKeywords
  sync.ts                             NEW (Task 1): triggerPerformanceSync / triggerKeywordsSync
lib/queries/
  use-analytics-overview.ts           MODIFY (Task 1): parameterised by a reply-range preset (Home passes the default)
  use-analytics-presence.ts           NEW (Task 1): useAnalyticsPresence({ range, locationId? })
  use-analytics-keywords.ts           NEW (Task 1): useAnalyticsKeywords({ range, locationId? })
  keys.ts                             (UNCHANGED — analytics(kind,params) + reviewCounts(scope) already exist)
components/ui/
  chart.tsx                           NEW (Task 2): recharts wrapper (token colours, integer ticks, ChartLegend, states)
components/reporting/
  stat-tile.tsx                       NEW (Task 2): generalised KPI tile (label/value/hint/delta)
  delta-badge.tsx                     NEW (Task 2): non-colour prior-window delta cue
  fetched-at-caption.tsx              NEW (Task 2): "As at <date>" caption
  reporting-states.tsx                NEW (Task 2): ReportingPanel (loading/empty/error/paused) + nullCell honest-null helper
components/home/
  divergence-banner.tsx               NEW (Task 3): shared providerTotals.divergence trust banner
  kpi-cards.tsx                       MODIFY (Task 3): widen to full summary via StatTile; keep asserted labels
  attention-list.tsx                  MODIFY (Task 3): low-rated inbox link + skeleton 3->5
  home-charts.tsx                     NEW (Task 3): review-volume + rating chart cards cross-linking /performance
app/(dashboard)/home/
  page.tsx                            MODIFY (Task 3): render DivergenceBanner + HomeCharts
components/performance/
  performance-view.tsx                NEW (Task 4): URL-synced Base UI Tabs shell (?tab=)
  range-select.tsx                    NEW (Task 4): per-tab range selector (Base UI Select)
  reply-performance-tab.tsx           NEW (Task 4): overview series charts + deltas + divergence + nulls-last table
  reply-locations-table.tsx           NEW (Task 4): nulls-last per-location review table
  google-performance-tab.tsx          NEW (Task 5): presence metrics + 5-state + env-off + refresh
  refresh-google-button.tsx           NEW (Task 5): owner/admin sync trigger
  keywords-tab.tsx                    NEW (Task 6): gated keyword impressions ("N+", 503 paused)
  location-performance.tsx            NEW (Task 7): per-location assembly (overview filter + presence/keywords by id)
app/(dashboard)/performance/
  page.tsx                            NEW (Task 4): server page -> PerformanceView
  loading.tsx                         NEW (Task 4): tab skeleton
app/(dashboard)/analytics/
  page.tsx                            NEW (Task 4): redirect /analytics -> /performance (D10)
components/app-shell/nav.tsx          MODIFY (Task 4): /performance prefetch:false -> true (D10)
components/locations/location-tab-nav.tsx  MODIFY (Task 7): append 7th "Performance" tab
app/(dashboard)/locations/[id]/performance/
  page.tsx                            NEW (Task 7): per-location performance server page
tests/components/*.test.ts(x)         NEW per task
tests/e2e/performance.spec.ts         REWRITE (Task 8): URL tab sync, deltas, divergence, nulls-last, /analytics redirect
tests/e2e/home.spec.ts                MODIFY (Task 8): extend (charts, divergence, low-rated link)
tests/e2e/locations.spec.ts           MODIFY (Task 8): per-location performance tab
tests/e2e/helpers/stub-bridge.ts      MODIFY (Task 8): seed performance_metric_daily + keyword rows
playwright.config.ts                  MODIFY (Task 8): un-ignore performance.spec.ts; enable GBP_PERFORMANCE/KEYWORDS flags
```

**Dependency chain:** Tasks **1 → 2** are a hard sequential chain (widened clients / hooks / humanisers → the primitives that consume their types). **Task 3** (Home polish) needs Task 1's widened analytics client + Task 2's `StatTile`/`DeltaBadge`/`DivergenceBanner`/`ChartCard`. **Task 4** (the `/performance` shell + reply tab + redirect + nav flip) needs Task 1 + Task 2. After Task 4, Tasks **5** (Google-performance tab) and **6** (keywords tab) can run in parallel — each mounts into Task 4's `PerformanceView` and consumes only Task 1's presence/keywords client+hook + Task 2's primitives. **Task 7** (per-location tab) needs Task 1's clients, Task 2's primitives, and reuses the reply/presence/keywords view fragments from Tasks 4–6. **Task 8** is the terminal gate. **No task edits a protected path — M7's footprint under `app/api/**`/`lib/server/**`/`lib/domain/**`/`supabase/**`/`scripts/**`/`instrumentation.ts` is EMPTY.**

---

### Task 1: Widen the analytics client + presence/keywords/sync clients + range/humanise/format layer + hooks

> **No protected-path edit.** Every file here is under `lib/format/`, `lib/reporting/`, `lib/api/`, `lib/queries/`, or `tests/` — all non-protected. `lib/api/analytics.ts` is WIDENED (its schema currently strips most of the endpoint); `lib/domain/google-contract.ts` / `lib/domain/workflow.ts` are imported const/type-only (consumption, not edits). `lib/queries/keys.ts` is NOT edited — `analytics(kind, params)` and `reviewCounts(scope)` already exist.

**Files:**
- Create: `lib/format/delta.ts`, `lib/reporting/ranges.ts`, `lib/reporting/metric-labels.ts`, `lib/reporting/unavailable-reasons.ts`, `lib/reporting/keyword-impressions.ts`, `lib/reporting/sync-permission.ts`, `lib/api/presence.ts`, `lib/api/keywords.ts`, `lib/api/sync.ts`, `lib/api/session.ts`, `lib/queries/use-analytics-presence.ts`, `lib/queries/use-analytics-keywords.ts`, `lib/queries/use-session.ts`
- Modify: `lib/format/duration.ts` (negative guard), `lib/format/index.ts` (re-export delta helpers), `lib/api/analytics.ts` (widen schema + parameterise `fetchAnalyticsOverview`), `lib/queries/use-analytics-overview.ts` (parameterise by reply-range preset)
- Test: `tests/components/format-duration-delta.test.ts`, `tests/components/reporting-humanise.test.ts`, `tests/components/analytics-clients.test.ts`

> **Client session hook (REV-1).** The app currently threads `session.role` as a SERVER PROP (`app-shell.tsx`, `LocationWorkspace`) — there is NO client session hook or React context. The "Refresh Google data" gate in Tasks 5/6 is client-side, so this task adds a small NON-protected client accessor: `lib/api/session.ts` + `lib/queries/use-session.ts`, reading `GET /api/session` → `{ session }` (verified: returns the session incl. `role`, or `null`). `queryKeys.session` already exists in `lib/queries/keys.ts` (`["session"]`) — no keys edit needed.

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` (`@/lib/api/client`); `z` (`zod`); `GOOGLE_PERFORMANCE_METRICS`, `type GooglePerformanceMetric` (`@/lib/domain/google-contract`); `useQuery` (`@tanstack/react-query`); `queryKeys` (`@/lib/queries/keys`).
- Produces (Tasks 2–7 consume these EXACT signatures):
  - `lib/format/duration.ts`: `formatDuration(seconds: number | null): string` — now returns `"—"` for `null`, non-finite, AND `< 0`.
  - `lib/format/delta.ts`: `type DeltaDirection = "up" | "down" | "flat"`; `deltaDirection(current: number | null, previous: number | null): DeltaDirection | null` (`null` when either side is null → "no comparison"); `formatDelta(current: number | null, previous: number | null, opts?: { unit?: "count" | "percent" | "rating" | "duration" }): string | null` — signed magnitude like `"+12"`, `"−3.4%"`, `"+0.2★"`, `"−20m"` (duration → via `formatDuration`, never raw seconds), `null` when incomparable.
  - `lib/reporting/ranges.ts`: `type ReplyRangeId = "30d" | "90d" | "12m" | "18m"`; `REPLY_RANGES: Array<{ id: ReplyRangeId; label: string; granularity: "day"|"week"|"month"; days: number }>`; `resolveReplyRange(id: ReplyRangeId, now?: Date): { current: { from: string; to: string; granularity: "day"|"week"|"month" }; previous: { from: string; to: string; granularity: "day"|"week"|"month" } }`; `PRESENCE_RANGES: Array<{ id: "28d"|"90d"|"12m"|"18m"; label: string }>`; `KEYWORD_RANGES: Array<{ id: "1m"|"6m"|"12m"|"18m"; label: string }>`.
  - `lib/reporting/metric-labels.ts`: `metricLabel(metric: GooglePerformanceMetric): string`; `ORDERED_METRICS: readonly GooglePerformanceMetric[]` (= `GOOGLE_PERFORMANCE_METRICS`); `IMPRESSION_METRICS: readonly GooglePerformanceMetric[]` (the four `BUSINESS_IMPRESSIONS_*`).
  - `lib/reporting/unavailable-reasons.ts`: `humaniseUnavailableReasons(codes: string[]): string[]` (deduped human copy; unknown code → one generic line, never the raw code).
  - `lib/reporting/keyword-impressions.ts`: `formatKeywordImpressions(kw: { impressions: number; upperBound: number; thresholded: boolean }): string` (`thresholded` → `"1,000+"`; else exact `formatNumber`).
  - `lib/reporting/sync-permission.ts`: `canTriggerSync(role: string | null | undefined): boolean` (owner/admin only).
  - `lib/api/analytics.ts`: `type AnalyticsSummary`, `type AnalyticsSeriesPoint`, `type AnalyticsLocation`, `type ProviderTotals`, `type AnalyticsOverview`; `fetchAnalyticsOverview(params?: { from?: string; to?: string; granularity?: "day"|"week"|"month" }): Promise<AnalyticsOverview>`.
  - `lib/api/presence.ts`: `type PresenceState`, `type PresenceStatus`, `type PresenceResponse`; `fetchPresence(params: { range: string; locationId?: string }): Promise<PresenceResponse>`.
  - `lib/api/keywords.ts`: `type KeywordRow`, `type KeywordsResponse`; `fetchKeywords(params: { range: string; locationId?: string }): Promise<KeywordsResponse>`.
  - `lib/api/sync.ts`: `triggerPerformanceSync(): Promise<void>`; `triggerKeywordsSync(): Promise<void>`.
  - `lib/api/session.ts`: `type SessionUser`, `type SessionResponse`; `fetchSession(): Promise<SessionResponse>` (`{ session: SessionUser | null }`).
  - `lib/queries/use-analytics-overview.ts`: `useAnalyticsOverview(params?: { from?: string; to?: string; granularity?: "day"|"week"|"month" })`.
  - `lib/queries/use-analytics-presence.ts`: `useAnalyticsPresence(params: { range: string; locationId?: string })`.
  - `lib/queries/use-analytics-keywords.ts`: `useAnalyticsKeywords(params: { range: string; locationId?: string })`.
  - `lib/queries/use-session.ts`: `useSession()`; `useSessionRole(): string | null` (`= data?.session?.role ?? null`). Tasks 5/6 gate the refresh trigger on `canTriggerSync(useSessionRole())`.

- [ ] **Step 1: Write the failing format + humanise tests**

`tests/components/format-duration-delta.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { deltaDirection, formatDelta } from "@/lib/format/delta"
import { formatDuration } from "@/lib/format/duration"

describe("formatDuration negative guard (D3)", () => {
  it("returns an em dash for null, non-finite, and negative seconds", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(Number.NaN)).toBe("—")
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—")
    // Clock-skew: a reply stored before the review create_time.
    expect(formatDuration(-120)).toBe("—")
  })
  it("still formats non-negative durations", () => {
    expect(formatDuration(0)).toBe("0m")
    expect(formatDuration(90)).toBe("2m") // rounds first
    expect(formatDuration(3600)).toBe("1h 0m")
    expect(formatDuration(90000)).toBe("1d 1h")
  })
})

describe("delta direction + formatting (non-colour cue source)", () => {
  it("classifies direction and returns null when incomparable", () => {
    expect(deltaDirection(10, 4)).toBe("up")
    expect(deltaDirection(4, 10)).toBe("down")
    expect(deltaDirection(5, 5)).toBe("flat")
    expect(deltaDirection(5, null)).toBeNull()
    expect(deltaDirection(null, 5)).toBeNull()
  })
  it("formats signed magnitude with a unit and a minus glyph, null when incomparable", () => {
    expect(formatDelta(120, 100, { unit: "count" })).toBe("+20")
    expect(formatDelta(96.2, 100, { unit: "percent" })).toBe("−3.8%")
    expect(formatDelta(4.6, 4.4, { unit: "rating" })).toBe("+0.2★")
    // Duration: a faster median response renders as a signed duration, not raw seconds.
    expect(formatDelta(5400, 6600, { unit: "duration" })).toBe("−20m")
    expect(formatDelta(5, 5, { unit: "count" })).toBe("±0")
    expect(formatDelta(5, null)).toBeNull()
  })
})
```

`tests/components/reporting-humanise.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import { IMPRESSION_METRICS, metricLabel, ORDERED_METRICS } from "@/lib/reporting/metric-labels"
import { resolveReplyRange } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"

describe("metricLabel", () => {
  it("humanises every one of the 11 metrics and never returns the raw enum", () => {
    expect(ORDERED_METRICS).toHaveLength(11)
    for (const metric of ORDERED_METRICS) {
      const label = metricLabel(metric)
      expect(label).not.toContain("_")
      expect(label).not.toBe(metric)
      expect(label.length).toBeGreaterThan(0)
    }
    expect(metricLabel("CALL_CLICKS")).toBe("Calls")
    expect(metricLabel("WEBSITE_CLICKS")).toBe("Website clicks")
    expect(IMPRESSION_METRICS).toHaveLength(4)
  })
})

describe("humaniseUnavailableReasons", () => {
  it("maps known codes, dedupes, and never leaks a raw code", () => {
    const out = humaniseUnavailableReasons([
      "google_rate_limited",
      "google_rate_limited",
      "performance_sync_failed",
      "some_unmapped_future_code",
    ])
    expect(out).toHaveLength(3) // rate-limited deduped
    expect(out.join(" ")).not.toMatch(/google_rate_limited|performance_sync_failed|some_unmapped_future_code/)
    expect(out.some((line) => /rate|busy|again/i.test(line))).toBe(true)
    expect(out.some((line) => /could not|couldn.t|unavailable|try again/i.test(line))).toBe(true)
  })
  it("returns [] for no codes", () => {
    expect(humaniseUnavailableReasons([])).toEqual([])
  })
})

describe("formatKeywordImpressions honesty", () => {
  it("shows an exact count when not thresholded", () => {
    expect(formatKeywordImpressions({ impressions: 1234, upperBound: 1234, thresholded: false })).toBe("1,234")
  })
  it("shows a lower-bounded '+' when Google gave a range", () => {
    expect(formatKeywordImpressions({ impressions: 1000, upperBound: 9999, thresholded: true })).toBe("1,000+")
  })
})

describe("resolveReplyRange", () => {
  it("produces adjacent, equal-length current + previous windows", () => {
    const now = new Date("2026-08-02T00:00:00.000Z")
    const { current, previous } = resolveReplyRange("30d", now)
    expect(current.granularity).toBe("day")
    expect(new Date(current.to).getTime()).toBeGreaterThan(new Date(current.from).getTime())
    // previous window ends exactly where the current window begins.
    expect(new Date(previous.to).getTime()).toBe(new Date(current.from).getTime())
    const currentLen = new Date(current.to).getTime() - new Date(current.from).getTime()
    const previousLen = new Date(previous.to).getTime() - new Date(previous.from).getTime()
    expect(previousLen).toBe(currentLen)
  })
})

describe("canTriggerSync", () => {
  it("is true only for owner and admin", () => {
    expect(canTriggerSync("owner")).toBe(true)
    expect(canTriggerSync("admin")).toBe(true)
    expect(canTriggerSync("member")).toBe(false)
    expect(canTriggerSync("viewer")).toBe(false)
    expect(canTriggerSync(null)).toBe(false)
    expect(canTriggerSync(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/format-duration-delta.test.ts tests/components/reporting-humanise.test.ts --project components`
Expected: FAIL — `lib/format/delta.ts` and the `lib/reporting/*` modules do not exist; `formatDuration(-120)` currently returns `"-2m"`.

- [ ] **Step 3: Add the `formatDuration` negative guard (D3)**

`lib/format/duration.ts` — one changed line:

```ts
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—"
  const totalMinutes = Math.round(seconds / 60) // round FIRST: no "1h 60m"
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`
}
```

- [ ] **Step 4: Add `lib/format/delta.ts` + re-export**

```ts
import { formatDuration } from "./duration"
import { formatNumber } from "./number"

export type DeltaDirection = "up" | "down" | "flat"

export function deltaDirection(
  current: number | null,
  previous: number | null
): DeltaDirection | null {
  if (current === null || previous === null) return null
  if (current > previous) return "up"
  if (current < previous) return "down"
  return "flat"
}

// Signed magnitude for a prior-window comparison. Uses a real minus glyph
// (never a hyphen) and an explicit "±0" so the change is legible without
// relying on colour. Duration deltas render via formatDuration so a
// response-time change never leaks raw seconds (spec §7). Returns null when
// the comparison is undefined.
export function formatDelta(
  current: number | null,
  previous: number | null,
  opts: { unit?: "count" | "percent" | "rating" | "duration" } = {}
): string | null {
  if (current === null || previous === null) return null
  const diff = current - previous
  const unit = opts.unit ?? "count"
  if (diff === 0) return "±0"
  const sign = diff > 0 ? "+" : "−"
  const magnitude = Math.abs(diff)
  if (unit === "percent") return `${sign}${magnitude.toFixed(1)}%`
  if (unit === "rating") return `${sign}${magnitude.toFixed(1)}★`
  if (unit === "duration") return `${sign}${formatDuration(magnitude)}`
  return `${sign}${formatNumber(magnitude)}`
}
```

Append to `lib/format/index.ts`:

```ts
export { formatDate, formatDateTime } from "./date"
export { formatDuration } from "./duration"
export { formatNumber, formatPercent } from "./number"
export { formatDelta, deltaDirection, type DeltaDirection } from "./delta"
```

- [ ] **Step 5: Add the `lib/reporting/*` humanise + range + permission modules**

`lib/reporting/metric-labels.ts`:

```ts
import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"

const LABELS: Record<GooglePerformanceMetric, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Maps views (desktop)",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Search views (desktop)",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Maps views (mobile)",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Search views (mobile)",
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Directions requests",
  BUSINESS_CONVERSATIONS: "Messages",
  BUSINESS_BOOKINGS: "Bookings",
  BUSINESS_FOOD_ORDERS: "Food orders",
  BUSINESS_FOOD_MENU_CLICKS: "Menu views",
}

export const ORDERED_METRICS = GOOGLE_PERFORMANCE_METRICS

export const IMPRESSION_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
] as const satisfies readonly GooglePerformanceMetric[]

export function metricLabel(metric: GooglePerformanceMetric): string {
  return LABELS[metric]
}
```

`lib/reporting/unavailable-reasons.ts`:

```ts
// Raw sync_checkpoint.last_error_code -> plain copy. The code universe is
// open (it is whatever error.code a thrown sync error carries, defaulting to
// performance_sync_failed / keyword_sync_failed), so the generic fallback is
// load-bearing: an unmapped code must still yield honest copy, never the code.
const KNOWN: Record<string, string> = {
  performance_sync_failed: "Google did not return performance data on the last attempt. We will retry automatically.",
  keyword_sync_failed: "Google did not return search-keyword data on the last attempt. We will retry automatically.",
  google_rate_limited: "Google is rate-limiting requests, so the latest figures may be delayed. We will retry shortly.",
  google_location_not_linked: "This location is no longer linked to Google, so its figures cannot be refreshed.",
  location_not_linked: "This location is no longer linked to Google, so its figures cannot be refreshed.",
  permission_denied: "We no longer have permission to read this location's Google data. Reconnect Google to restore it.",
}

const FALLBACK =
  "Some figures could not be refreshed from Google on the last attempt. We will retry automatically."

export function humaniseUnavailableReasons(codes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let usedFallback = false
  for (const code of codes) {
    const copy = KNOWN[code]
    if (copy) {
      if (!seen.has(copy)) {
        seen.add(copy)
        out.push(copy)
      }
    } else if (!usedFallback) {
      usedFallback = true
      out.push(FALLBACK)
    }
  }
  return out
}
```

`lib/reporting/keyword-impressions.ts`:

```ts
import { formatNumber } from "@/lib/format"

// Google returns exact impressions for high-volume keywords and a lower-bounded
// range for low-volume ones (thresholded). Present the range honestly as "N+"
// (at least N) rather than inventing a precise-looking number.
export function formatKeywordImpressions(kw: {
  impressions: number
  upperBound: number
  thresholded: boolean
}): string {
  if (kw.thresholded) return `${formatNumber(kw.impressions)}+`
  return formatNumber(kw.impressions)
}
```

`lib/reporting/sync-permission.ts`:

```ts
export function canTriggerSync(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin"
}
```

`lib/reporting/ranges.ts`:

```ts
export type ReplyRangeId = "30d" | "90d" | "12m" | "18m"

export const REPLY_RANGES: Array<{
  id: ReplyRangeId
  label: string
  granularity: "day" | "week" | "month"
  days: number
}> = [
  { id: "30d", label: "Last 30 days", granularity: "day", days: 30 },
  { id: "90d", label: "Last 90 days", granularity: "week", days: 90 },
  { id: "12m", label: "Last 12 months", granularity: "month", days: 365 },
  { id: "18m", label: "Last 18 months", granularity: "month", days: 548 },
]

function isoAt(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
}

// Current window [from, to) and the immediately-preceding equal-length window,
// so a prior-window delta compares like with like. `previous.to === current.from`.
export function resolveReplyRange(id: ReplyRangeId, now: Date = new Date()) {
  const preset = REPLY_RANGES.find((range) => range.id === id) ?? REPLY_RANGES[0]
  const to = now.toISOString()
  const from = isoAt(now, preset.days)
  const previousTo = from
  const previousFrom = isoAt(now, preset.days * 2)
  return {
    current: { from, to, granularity: preset.granularity },
    previous: { from: previousFrom, to: previousTo, granularity: preset.granularity },
  }
}

export const PRESENCE_RANGES: Array<{ id: "28d" | "90d" | "12m" | "18m"; label: string }> = [
  { id: "28d", label: "Last 28 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]

export const KEYWORD_RANGES: Array<{ id: "1m" | "6m" | "12m" | "18m"; label: string }> = [
  { id: "1m", label: "Last month" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]
```

- [ ] **Step 6: Run the format + humanise tests to verify pass**

Run: `pnpm exec vitest run tests/components/format-duration-delta.test.ts tests/components/reporting-humanise.test.ts --project components`
Expected: PASS.

- [ ] **Step 7: Write the failing analytics-client tests**

`tests/components/analytics-clients.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { fetchKeywords } from "@/lib/api/keywords"
import { fetchPresence } from "@/lib/api/presence"
import { fetchSession } from "@/lib/api/session"
import { triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const OVERVIEW = {
  from: "2026-07-03T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
  timezone: "Europe/London",
  summary: {
    reviewVolume: 42,
    averageRating: 4.36,
    responseRate: 88.5,
    unresolvedComplaints: 3,
    verificationFailures: 1,
    verificationRejectionRate: 12.5,
    medianFirstResponseSeconds: 5400,
    p95FirstResponseSeconds: 86400,
    medianLatestEditSeconds: null,
  },
  series: [
    { period: "2026-07-03T00:00:00.000Z", reviewCount: 2, reviews: 2, replies: 1, averageRating: 4.5 },
    { period: "2026-07-04T00:00:00.000Z", reviewCount: 0, reviews: 0, replies: 0, averageRating: null },
  ],
  locations: [
    {
      id: "loc-1", name: "Riverside", reviews: 20, averageRating: 4.6, responseRate: 90,
      medianFirstResponseSeconds: 4200, p95FirstResponseSeconds: 80000, medianLatestEditSeconds: null,
      unresolvedComplaints: 1, verificationRejectionRate: null,
    },
  ],
  providerTotals: { averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: true },
}

describe("fetchAnalyticsOverview (widened)", () => {
  it("preserves series, providerTotals, and every summary + per-location field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(OVERVIEW)))
    const result = await fetchAnalyticsOverview()
    expect(result.series).toHaveLength(2)
    expect(result.series[1].averageRating).toBeNull()
    expect(result.providerTotals.divergence).toBe(true)
    expect(result.summary.medianFirstResponseSeconds).toBe(5400)
    expect(result.summary.medianLatestEditSeconds).toBeNull()
    expect(result.locations[0].responseRate).toBe(90)
    expect(result.locations[0].verificationRejectionRate).toBeNull()
  })
  it("passes from/to/granularity through the query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OVERVIEW))
    vi.stubGlobal("fetch", fetchMock)
    await fetchAnalyticsOverview({ from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z", granularity: "week" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/analytics/overview")
    expect(url.searchParams.get("granularity")).toBe("week")
    expect(url.searchParams.get("from")).toBe("2026-06-01T00:00:00.000Z")
  })
})

describe("fetchPresence", () => {
  it("parses the state envelope, zero-filled totals, and partial series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          range: "28d", from: "2026-07-05", to: "2026-08-02", state: "ready", freshThrough: "2026-08-01",
          locations: [{ id: "loc-1", name: "Riverside" }],
          totals: { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 10, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 5, WEBSITE_CLICKS: 7, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 },
          series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 5 } }],
          unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true,
        })
      )
    )
    const result = await fetchPresence({ range: "28d" })
    expect(result.state).toBe("ready")
    expect(result.totals.CALL_CLICKS).toBe(5)
    expect(result.series[0].metrics.CALL_CLICKS).toBe(5)
    expect(result.ingestionEnabled).toBe(true)
  })
  it("forwards locationId when given", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ range: "28d", from: "2026-07-05", to: "2026-08-02", state: "no_link", freshThrough: null, locations: [], totals: { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    await fetchPresence({ range: "90d", locationId: "loc-9" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.get("range")).toBe("90d")
    expect(url.searchParams.get("locationId")).toBe("loc-9")
  })
})

describe("fetchKeywords", () => {
  it("parses keyword rows including the thresholded flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          range: "6m", from: "2026-03-01", state: "ready", locations: [{ id: "loc-1", name: "Riverside" }],
          keywords: [{ rank: 1, keyword: "riverside hotel", impressions: 1000, upperBound: 9999, thresholded: true, firstMonth: "2026-03", latestMonth: "2026-08" }],
          unavailableReasons: [],
        })
      )
    )
    const result = await fetchKeywords({ range: "6m" })
    expect(result.keywords[0].thresholded).toBe(true)
    expect(result.keywords[0].latestMonth).toBe("2026-08")
  })
  it("rethrows the 503 keywords_paused code without inventing copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "keywords_paused", message: "paused" }, 503)))
    await expect(fetchKeywords({ range: "6m" })).rejects.toMatchObject({
      constructor: ApiClientError, status: 503, code: "keywords_paused",
    })
  })
})

describe("triggerPerformanceSync", () => {
  it("POSTs an empty body to the sync route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ organisations: [], skipped: false, nextCursor: null }))
    vi.stubGlobal("fetch", fetchMock)
    await triggerPerformanceSync()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })
})

describe("fetchSession", () => {
  it("parses the nullable session envelope including role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ session: { userId: "u1", organisationId: "o1", organisationName: "Org", displayName: "Ada", email: "ada@example.test", role: "admin", canPublish: true } })))
    const result = await fetchSession()
    expect(result.session?.role).toBe("admin")
  })
  it("accepts a null session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ session: null })))
    expect((await fetchSession()).session).toBeNull()
  })
})
```

- [ ] **Step 8: Run to verify failure**

Run: `pnpm exec vitest run tests/components/analytics-clients.test.ts --project components`
Expected: FAIL — the widened `fetchAnalyticsOverview` strips `series`/`providerTotals`; `lib/api/presence.ts`/`keywords.ts`/`sync.ts` do not exist.

- [ ] **Step 9: Widen `lib/api/analytics.ts`**

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const analyticsSummarySchema = z.object({
  reviewVolume: z.number(),
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
  unresolvedComplaints: z.number(),
  verificationFailures: z.number(),
  verificationRejectionRate: z.number().nullable(),
  medianFirstResponseSeconds: z.number().nullable(),
  p95FirstResponseSeconds: z.number().nullable(),
  medianLatestEditSeconds: z.number().nullable(),
})

export const analyticsSeriesPointSchema = z.object({
  period: z.string(),
  reviewCount: z.number(),
  reviews: z.number(),
  replies: z.number(),
  averageRating: z.number().nullable(),
})

export const analyticsLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  reviews: z.number(),
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
  medianFirstResponseSeconds: z.number().nullable(),
  p95FirstResponseSeconds: z.number().nullable(),
  medianLatestEditSeconds: z.number().nullable(),
  unresolvedComplaints: z.number(),
  verificationRejectionRate: z.number().nullable(),
})

export const providerTotalsSchema = z.object({
  averageRating: z.number().nullable(),
  totalReviewCount: z.number().nullable(),
  localReviewCount: z.number(),
  divergence: z.boolean(),
})

export const analyticsOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  summary: analyticsSummarySchema,
  series: z.array(analyticsSeriesPointSchema),
  locations: z.array(analyticsLocationSchema),
  providerTotals: providerTotalsSchema,
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPointSchema>
export type AnalyticsLocation = z.infer<typeof analyticsLocationSchema>
export type ProviderTotals = z.infer<typeof providerTotalsSchema>
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

export function fetchAnalyticsOverview(params?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  const query = new URLSearchParams()
  if (params?.from) query.set("from", params.from)
  if (params?.to) query.set("to", params.to)
  if (params?.granularity) query.set("granularity", params.granularity)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/analytics/overview${suffix}`, {
    schema: analyticsOverviewSchema,
  })
}
```

> **Note for the Home KPI consumer (Task 3):** `summary.averageRating` and `summary.responseRate` are still present under the same names, so `KpiCards` keeps compiling; the widening only ADDS keys. The existing `analyticsSummarySchema` gained `reviewVolume`/`unresolvedComplaints`/… — no consumer breaks because zod parses a superset.

- [ ] **Step 10: Add `lib/api/presence.ts`, `keywords.ts`, `sync.ts`**

`lib/api/presence.ts`:

```ts
import { z } from "zod"

import { GOOGLE_PERFORMANCE_METRICS } from "@/lib/domain/google-contract"
import { apiFetch } from "./client"

const metricTotalsSchema = z.object(
  Object.fromEntries(GOOGLE_PERFORMANCE_METRICS.map((m) => [m, z.number()]))
) as z.ZodType<Record<(typeof GOOGLE_PERFORMANCE_METRICS)[number], number>>

const metricPartialSchema = z.record(z.string(), z.number())

export const presenceStateSchema = z.enum(["no_link", "ready", "unavailable", "pending", "empty"])

export const presenceResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  to: z.string(),
  state: presenceStateSchema,
  freshThrough: z.string().nullable(),
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  totals: metricTotalsSchema,
  series: z.array(z.object({ date: z.string(), metrics: metricPartialSchema })),
  unavailableReasons: z.array(z.string()),
  keywordsEnabled: z.boolean(),
  ingestionEnabled: z.boolean(),
})

export type PresenceStatus = z.infer<typeof presenceStateSchema>
export type PresenceResponse = z.infer<typeof presenceResponseSchema>

export function fetchPresence(params: { range: string; locationId?: string }) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  return apiFetch(`/api/analytics/presence?${query}`, {
    schema: presenceResponseSchema,
  })
}
```

`lib/api/keywords.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const keywordRowSchema = z.object({
  rank: z.number(),
  keyword: z.string(),
  impressions: z.number(),
  upperBound: z.number(),
  thresholded: z.boolean(),
  firstMonth: z.string(),
  latestMonth: z.string(),
})

export const keywordsResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  state: z.enum(["no_link", "ready", "unavailable", "pending", "empty"]),
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  keywords: z.array(keywordRowSchema),
  unavailableReasons: z.array(z.string()),
})

export type KeywordRow = z.infer<typeof keywordRowSchema>
export type KeywordsResponse = z.infer<typeof keywordsResponseSchema>

export function fetchKeywords(params: { range: string; locationId?: string }) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  return apiFetch(`/api/analytics/presence/keywords?${query}`, {
    schema: keywordsResponseSchema,
  })
}
```

`lib/api/sync.ts`:

```ts
import { apiFetch } from "./client"

// The session branch of these routes syncs only the caller's org. We send an
// empty body and ignore the batch envelope — the surface only needs success
// vs an ApiClientError (which the trigger button maps to copy).
export async function triggerPerformanceSync(): Promise<void> {
  await apiFetch("/api/sync/performance", { method: "POST", body: {} })
}

export async function triggerKeywordsSync(): Promise<void> {
  await apiFetch("/api/sync/keywords", { method: "POST", body: {} })
}
```

`lib/api/session.ts` (REV-1 — the client accessor for the refresh gate; mirrors the `GET /api/session` `{ session }` shape, session nullable):

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const sessionSchema = z.object({
  userId: z.string(),
  organisationId: z.string(),
  organisationName: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  canPublish: z.boolean(),
})

export const sessionResponseSchema = z.object({
  session: sessionSchema.nullable(),
})

export type SessionUser = z.infer<typeof sessionSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export function fetchSession() {
  return apiFetch("/api/session", { schema: sessionResponseSchema })
}
```

- [ ] **Step 11: Parameterise the overview hook + add the presence/keywords hooks**

`lib/queries/use-analytics-overview.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { queryKeys } from "./keys"

export function useAnalyticsOverview(params?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  const keyParams = params ?? { window: "last-30-days" }
  return useQuery({
    queryKey: queryKeys.analytics("overview", keyParams),
    queryFn: () => fetchAnalyticsOverview(params),
    staleTime: 30_000,
  })
}
```

`lib/queries/use-analytics-presence.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPresence } from "@/lib/api/presence"
import { queryKeys } from "./keys"

export function useAnalyticsPresence(params: { range: string; locationId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("presence", params),
    queryFn: () => fetchPresence(params),
    staleTime: 30_000,
  })
}
```

`lib/queries/use-analytics-keywords.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchKeywords } from "@/lib/api/keywords"
import { queryKeys } from "./keys"

export function useAnalyticsKeywords(params: { range: string; locationId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("keywords", params),
    queryFn: () => fetchKeywords(params),
    staleTime: 30_000,
  })
}
```

`lib/queries/use-session.ts` (REV-1 — `queryKeys.session` already exists in `keys.ts`, so no keys edit):

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSession } from "@/lib/api/session"
import { queryKeys } from "./keys"

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 30_000,
  })
}

export function useSessionRole(): string | null {
  const { data } = useSession()
  return data?.session?.role ?? null
}
```

- [ ] **Step 12: Run to verify pass, then the gate**

```bash
pnpm exec vitest run tests/components/analytics-clients.test.ts tests/components/format-duration-delta.test.ts tests/components/reporting-humanise.test.ts --project components
pnpm typecheck && pnpm lint && pnpm test
```

Expected: PASS; `pnpm test` green (the widened `analyticsSummarySchema` still parses Home's data — `KpiCards` reads `summary.averageRating`/`summary.responseRate` which remain).

- [ ] **Step 13: Commit**

```bash
git add lib/format/duration.ts lib/format/delta.ts lib/format/index.ts lib/reporting lib/api/analytics.ts lib/api/presence.ts lib/api/keywords.ts lib/api/sync.ts lib/api/session.ts lib/queries/use-analytics-overview.ts lib/queries/use-analytics-presence.ts lib/queries/use-analytics-keywords.ts lib/queries/use-session.ts tests/components/format-duration-delta.test.ts tests/components/reporting-humanise.test.ts tests/components/analytics-clients.test.ts
git commit -m "feat(reporting): widen analytics client + presence/keywords/sync clients + humanise layer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Reporting primitives — `Chart` (recharts), `StatTile`, `DeltaBadge`, `FetchedAtCaption`, reporting states

> **The chart primitive (D2).** `components/ui/chart.tsx` is the first recharts wrapper — restyled once on entry per the M1 policy: series colours come ONLY from `--chart-1..5` (no raw hex), axes are `allowDecimals={false}` (integer ticks) over the server's zero-filled data, and a `ChartLegend` labels multi-series. It exports `ChartCard` (a titled `Card` shell with `loading`/`empty`/`error` slots) plus thin `LineChart`/`BarChart` renderers so no feature component imports `recharts` directly (one theming choke-point). All non-protected: `components/ui/`, `components/reporting/`, `tests/`.

**Files:**
- Create: `components/ui/chart.tsx`, `components/reporting/stat-tile.tsx`, `components/reporting/delta-badge.tsx`, `components/reporting/fetched-at-caption.tsx`, `components/reporting/reporting-states.tsx`
- Test: `tests/components/chart.test.tsx`, `tests/components/reporting-primitives.test.tsx`
- Consumes: `recharts` (only inside `chart.tsx`); `Card`/`CardHeader`/`CardTitle`/`CardContent` (`@/components/ui/card`); `Badge` (`@/components/ui/badge`); `Alert`/`AlertTitle`/`AlertDescription` (`@/components/ui/alert`); `Button` (`@/components/ui/button`); `Empty` (`@/components/ui/empty`); `Skeleton` (`@/components/ui/skeleton`); `formatDate` (`@/lib/format`); `deltaDirection`, `formatDelta`, `type DeltaDirection` (`@/lib/format`).
- Produces (Tasks 3–7 consume):
  - `ChartCard` (props `{ title: string; description?: React.ReactNode; action?: React.ReactNode; state: "ready"|"loading"|"empty"|"error"; onRetry?: () => void; emptyLabel?: string; children: React.ReactNode }`), `ReportingLineChart` (props `{ data; xKey: string; xTickFormatter?: (v: string) => string; series: Array<{ key: string; label: string; colorVar: 1|2|3|4|5 }> }`), `ReportingBarChart` (same series shape), `ChartLegend`.
  - `StatTile` (props `{ label: string; value: string; hint?: string; delta?: React.ReactNode }`).
  - `DeltaBadge` (props `{ current: number | null; previous: number | null; unit?: "count"|"percent"|"rating"|"duration" }`) — non-colour arrow+sign; `duration` renders via `formatDuration` (never raw seconds) and reads "faster/slower" to screen readers; returns `null` when incomparable. (No `invertGood` prop — the duration wording carries the good/bad direction on its own; REV-6.)
  - `FetchedAtCaption` (props `{ iso: string | null; timezone: string; prefix?: string }`).
  - `ReportingPanel` (props `{ variant: "loading"|"empty"|"error"|"paused"|"off"; title?: string; description?: string; onRetry?: () => void }`), `nullableCell(value: number | null, render: (v: number) => string): { text: string; isNull: boolean }` (nulls-last honest-null helper).

- [ ] **Step 1: Write the failing primitives test**

`tests/components/reporting-primitives.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DeltaBadge } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { nullableCell, ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"

describe("StatTile", () => {
  it("renders label, value, and an optional hint", () => {
    render(<StatTile label="Average rating" value="4.4" hint="Across 42 reviews" />)
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("4.4")).toBeInTheDocument()
    expect(screen.getByText("Across 42 reviews")).toBeInTheDocument()
  })
})

describe("DeltaBadge (non-colour cue)", () => {
  it("shows a signed magnitude with a direction glyph, and an accessible label", () => {
    render(<DeltaBadge current={120} previous={100} unit="count" />)
    const badge = screen.getByText(/\+20/)
    expect(badge).toBeInTheDocument()
    // Direction is conveyed by an arrow glyph in the text, not colour alone.
    expect(badge.textContent).toMatch(/[▲▼]|↑|↓/)
    expect(screen.getByLabelText(/up|increase|higher/i)).toBeInTheDocument()
  })
  it("renders a duration delta as faster/slower, never raw seconds", () => {
    render(<DeltaBadge current={5400} previous={6600} unit="duration" />)
    expect(screen.getByText(/−20m/)).toBeInTheDocument()
    expect(screen.getByLabelText(/faster/i)).toBeInTheDocument()
  })
  it("renders nothing when the comparison is undefined", () => {
    const { container } = render(<DeltaBadge current={5} previous={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("FetchedAtCaption", () => {
  it("captions with a formatted date, and a fallback when null", () => {
    render(<FetchedAtCaption iso="2026-08-01T00:00:00.000Z" timezone="Europe/London" />)
    expect(screen.getByText(/As at/i)).toBeInTheDocument()
    render(<FetchedAtCaption iso={null} timezone="Europe/London" />)
    expect(screen.getByText(/not yet|no data|—/i)).toBeInTheDocument()
  })
})

describe("nullableCell honest-null helper", () => {
  it("marks null as null and formats non-null", () => {
    expect(nullableCell(null, (v) => String(v))).toEqual({ text: "—", isNull: true })
    expect(nullableCell(3, (v) => `${v} pts`)).toEqual({ text: "3 pts", isNull: false })
  })
})

describe("ReportingPanel", () => {
  it("renders a distinct, honest message per variant with a retry only on error", () => {
    const { rerender } = render(<ReportingPanel variant="empty" description="No data yet." />)
    expect(screen.getByText("No data yet.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument()
    rerender(<ReportingPanel variant="error" onRetry={() => {}} />)
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
    rerender(<ReportingPanel variant="paused" />)
    expect(screen.getByText(/paused/i)).toBeInTheDocument()
    rerender(<ReportingPanel variant="off" />)
    expect(screen.getByText(/not switched on|turned on|not enabled|off/i)).toBeInTheDocument()
  })
})
```

`tests/components/chart.test.tsx` (jsdom — assert the token-driven contract, not pixel output; recharts renders an SVG in jsdom):

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChartCard, ChartLegend } from "@/components/ui/chart"

describe("ChartCard states", () => {
  it("shows a skeleton while loading and the empty label when empty", () => {
    const { rerender } = render(
      <ChartCard title="Review volume" state="loading">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("Review volume")).toBeInTheDocument()
    expect(screen.queryByText("chart")).not.toBeInTheDocument()
    rerender(
      <ChartCard title="Review volume" state="empty" emptyLabel="No reviews in this window.">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("No reviews in this window.")).toBeInTheDocument()
    rerender(
      <ChartCard title="Review volume" state="ready">
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText("chart")).toBeInTheDocument()
  })
})

describe("ChartLegend", () => {
  it("labels each series and marks swatches decorative", () => {
    render(
      <ChartLegend
        items={[
          { label: "Reviews", colorVar: 1 },
          { label: "Replies", colorVar: 4 },
        ]}
      />
    )
    expect(screen.getByText("Reviews")).toBeInTheDocument()
    expect(screen.getByText("Replies")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/reporting-primitives.test.tsx tests/components/chart.test.tsx --project components`
Expected: FAIL — none of the components exist.

- [ ] **Step 3: Implement `components/reporting/reporting-states.tsx`**

```tsx
"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

type PanelVariant = "loading" | "empty" | "error" | "paused" | "off"

const COPY: Record<Exclude<PanelVariant, "loading">, { title: string; description: string }> = {
  empty: { title: "Nothing to show yet", description: "There is no data for this window." },
  error: { title: "We could not load this", description: "Check your connection, then try again." },
  paused: { title: "Reporting is paused", description: "This report is temporarily paused. Please check back soon." },
  off: { title: "Not switched on", description: "This report is not switched on for your account yet." },
}

export function ReportingPanel({
  variant,
  title,
  description,
  onRetry,
}: {
  variant: PanelVariant
  title?: string
  description?: string
  onRetry?: () => void
}) {
  if (variant === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-(--nr-radius-card)" />
        ))}
      </div>
    )
  }
  if (variant === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{title ?? COPY.error.title}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{description ?? COPY.error.description}</span>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }
  const copy = COPY[variant]
  return <Empty title={title ?? copy.title} description={description ?? copy.description} />
}

// Honest-null helper: a missing metric is "—" flagged isNull (so tables can
// style it muted and sort it last), never coerced to 0.
export function nullableCell(
  value: number | null,
  render: (v: number) => string
): { text: string; isNull: boolean } {
  if (value === null) return { text: "—", isNull: true }
  return { text: render(value), isNull: false }
}
```

- [ ] **Step 4: Implement `stat-tile.tsx`, `delta-badge.tsx`, `fetched-at-caption.tsx`**

`components/reporting/stat-tile.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card"

export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string
  value: string
  hint?: string
  delta?: React.ReactNode
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <p className="text-ui text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-page-title font-semibold tracking-tight tabular-nums">{value}</p>
          {delta}
        </div>
        {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
```

`components/reporting/delta-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import { deltaDirection, formatDelta, type DeltaDirection } from "@/lib/format"

type DeltaUnit = "count" | "percent" | "rating" | "duration"

const GLYPH: Record<DeltaDirection, string> = { up: "▲", down: "▼", flat: "▬" }

// Screen-reader wording. A duration that went "down" is a shorter (faster)
// response time, so durations read faster/slower; everything else reads as a
// plain increase/decrease. No red/green anywhere — the arrow glyph + signed
// magnitude carry the direction (spec §8 "non-colour cues").
function directionWord(direction: DeltaDirection, unit: DeltaUnit): string {
  if (direction === "flat") return "no change"
  if (unit === "duration") return direction === "down" ? "faster" : "slower"
  return direction === "up" ? "increase" : "decrease"
}

export function DeltaBadge({
  current,
  previous,
  unit = "count",
}: {
  current: number | null
  previous: number | null
  unit?: DeltaUnit
}) {
  const direction = deltaDirection(current, previous)
  const text = formatDelta(current, previous, { unit })
  if (!direction || text === null) return null
  return (
    <Badge variant="outline" aria-label={`${directionWord(direction, unit)} ${text} versus the previous window`}>
      <span aria-hidden className="tabular-nums">
        {GLYPH[direction]} {text}
      </span>
    </Badge>
  )
}
```

`components/reporting/fetched-at-caption.tsx`:

```tsx
import { formatDate } from "@/lib/format"

export function FetchedAtCaption({
  iso,
  timezone,
  prefix = "As at",
}: {
  iso: string | null
  timezone: string
  prefix?: string
}) {
  return (
    <p className="text-caption text-muted-foreground">
      {iso ? `${prefix} ${formatDate(iso, timezone)}` : "No data yet — nothing to show"}
    </p>
  )
}
```

- [ ] **Step 5: Implement `components/ui/chart.tsx` (the recharts wrapper)**

```tsx
"use client"

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReportingPanel } from "@/components/reporting/reporting-states"

type ColorVar = 1 | 2 | 3 | 4 | 5
type Series = { key: string; label: string; colorVar: ColorVar }

function chartColor(colorVar: ColorVar): string {
  return `var(--chart-${colorVar})`
}

export function ChartLegend({ items }: { items: Array<{ label: string; colorVar: ColorVar }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span
            aria-hidden
            className="size-2.5 rounded-(--nr-radius-tag)"
            style={{ backgroundColor: chartColor(item.colorVar) }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({
  title,
  description,
  action,
  state,
  onRetry,
  emptyLabel,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  state: "ready" | "loading" | "empty" | "error"
  onRetry?: () => void
  emptyLabel?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">{title}</CardTitle>
          {description ? <div className="text-caption text-muted-foreground">{description}</div> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <ReportingPanel variant="loading" />
        ) : state === "error" ? (
          <ReportingPanel variant="error" onRetry={onRetry} />
        ) : state === "empty" ? (
          <ReportingPanel variant="empty" description={emptyLabel} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

const AXIS_PROPS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

export function ReportingLineChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  xTickFormatter?: (value: string) => string
  series: Series[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--nr-radius-control)",
            color: "var(--popover-foreground)",
            fontSize: "0.8125rem",
          }}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={chartColor(s.colorVar)}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  )
}

export function ReportingBarChart({
  data,
  xKey,
  xTickFormatter,
  series,
  height = 240,
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  xTickFormatter?: (value: string) => string
  series: Series[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={xTickFormatter} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--nr-radius-control)",
            color: "var(--popover-foreground)",
            fontSize: "0.8125rem",
          }}
          labelFormatter={(value) => (xTickFormatter ? xTickFormatter(String(value)) : String(value))}
        />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={chartColor(s.colorVar)} radius={[4, 4, 0, 0]} />
        ))}
      </RBarChart>
    </ResponsiveContainer>
  )
}
```

> **Note:** recharts renders inside `ResponsiveContainer`, which reports width 0 in jsdom — the chart test asserts the `ChartCard` state slots and `ChartLegend`, not the SVG geometry. Real rendering is covered by the e2e product scan (Task 8). The tooltip/axis colours use `var(--…)` M1 tokens (no raw hex), satisfying D2.

- [ ] **Step 6: Run to verify pass, then the gate**

```bash
pnpm exec vitest run tests/components/reporting-primitives.test.tsx tests/components/chart.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/ui/chart.tsx components/reporting tests/components/reporting-primitives.test.tsx tests/components/chart.test.tsx
git commit -m "feat(reporting): chart primitive (recharts + M1 tokens) + stat tile / delta badge / states

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Home polish — widened KPIs, divergence banner, chart cards, low-rated attention link

> **Home already exists (M3).** M7 POLISHES it (spec §10 "Home polish + Performance"). The e2e `home.spec.ts` asserts the labels **"Total reviews"**, **"Average rating"**, **"Response rate"** and the `/overview→/home` redirect + light/dark axe — those MUST stay green. All files non-protected: `components/home/`, `app/(dashboard)/home/`.

**Files:**
- Create: `components/home/divergence-banner.tsx`, `components/home/home-charts.tsx`
- Modify: `components/home/kpi-cards.tsx` (widen to the full summary via `StatTile`; keep asserted labels), `components/home/attention-list.tsx` (low-rated inbox link + skeleton 3→5), `app/(dashboard)/home/page.tsx` (render `DivergenceBanner` + `HomeCharts`)
- Test: `tests/components/home-kpi-cards.test.tsx`, `tests/components/home-attention-list.test.tsx`, `tests/components/home-charts.test.tsx`
- Consumes: `useAnalyticsOverview` (`@/lib/queries/use-analytics-overview`), `useReviewCounts` (`@/lib/queries/use-review-counts`); `StatTile`, `DeltaBadge`, `ChartCard`, `ReportingBarChart`, `ReportingLineChart`, `ChartLegend`, `FetchedAtCaption` (Task 2); `formatNumber`, `formatPercent`, `formatDuration`, `formatDate` (`@/lib/format`); `NEEDS_ATTENTION_STATES` (kept from the existing `kpi-cards.tsx`).
- Produces: `DivergenceBanner` (props `{ providerTotals: ProviderTotals }` — renders only when `divergence`), `HomeCharts`.

- [ ] **Step 1: Write the failing Home tests**

`tests/components/home-kpi-cards.test.tsx` (mount with a `QueryClientProvider`; stub the two hooks via a `fetch` mock returning the widened overview + counts):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiCards } from "@/components/home/kpi-cards"

function jsonFor(url: string) {
  if (url.startsWith("/api/reviews/counts")) {
    return { total: 42, byStatus: { new: 2, escalated: 1, failed: 0, published: 30 } }
  }
  return {
    from: "2026-07-03T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z", timezone: "Europe/London",
    summary: {
      reviewVolume: 42, averageRating: 4.36, responseRate: 88.5, unresolvedComplaints: 3,
      verificationFailures: 1, verificationRejectionRate: 12.5,
      medianFirstResponseSeconds: 5400, p95FirstResponseSeconds: 86400, medianLatestEditSeconds: null,
    },
    series: [], locations: [],
    providerTotals: { averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: false },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe("KpiCards widened to the full summary", () => {
  it("keeps the e2e-asserted labels and adds response-time + complaints", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(jsonFor(url)), { headers: { "content-type": "application/json" } })))
    renderWithClient(<KpiCards />)
    expect(await screen.findByText("Total reviews")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("Needs attention")).toBeInTheDocument()
    // Widened tiles:
    expect(screen.getByText("Median response time")).toBeInTheDocument()
    expect(screen.getByText("1h 30m")).toBeInTheDocument() // 5400s
    expect(screen.getByText("Unresolved complaints")).toBeInTheDocument()
  })
})
```

`tests/components/home-attention-list.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttentionList } from "@/components/home/attention-list"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe("AttentionList low-rated link (spec §8)", () => {
  it("links each row to the location's low-rated reviews in the inbox", async () => {
    const overview = {
      from: "x", to: "y", timezone: "Europe/London",
      summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null },
      series: [],
      locations: [{ id: "loc-9", name: "Harbour View", reviews: 5, averageRating: 2.1, responseRate: 50, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 4, verificationRejectionRate: null }],
      providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(overview), { headers: { "content-type": "application/json" } })))
    renderWithClient(<AttentionList />)
    const link = await screen.findByRole("link", { name: /Harbour View/ })
    expect(link).toHaveAttribute("href", "/inbox?locationId=loc-9&rating=1,2")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/home-kpi-cards.test.tsx tests/components/home-attention-list.test.tsx --project components`
Expected: FAIL — the widened tiles / low-rated `href` do not exist yet.

- [ ] **Step 3: Widen `components/home/kpi-cards.tsx`**

Replace the `KpiCard` local component with `StatTile` (Task 2) and expand the populated grid. Keep `NEEDS_ATTENTION_STATES` and the loading/error blocks; only the populated return changes:

```tsx
"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatTile } from "@/components/reporting/stat-tile"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

const NEEDS_ATTENTION_STATES = ["new", "escalated", "failed"] as const

function KpiCards() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()

  if (counts.isPending || analytics.isPending) {
    return (
      <div aria-busy="true" className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-28 rounded-(--nr-radius-card)" />
        ))}
      </div>
    )
  }

  if (counts.isError || analytics.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We could not load your Home summary.</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>Check your connection, then try again.</span>
          <Button variant="outline" size="sm" onClick={() => { void counts.refetch(); void analytics.refetch() }}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const needsAttention = NEEDS_ATTENTION_STATES.reduce(
    (total, state) => total + (counts.data.byStatus[state] ?? 0),
    0
  )
  const s = analytics.data.summary

  return (
    <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Total reviews" value={formatNumber(counts.data.total)} />
      <StatTile label="Needs attention" value={formatNumber(needsAttention)} />
      <StatTile label="Average rating" value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)} />
      <StatTile label="Response rate" value={s.responseRate === null ? "—" : formatPercent(s.responseRate)} />
      <StatTile label="Median response time" value={formatDuration(s.medianFirstResponseSeconds)} hint="First reply, last 30 days" />
      <StatTile label="Unresolved complaints" value={formatNumber(s.unresolvedComplaints)} hint="1–2 star, no published reply" />
      <StatTile
        label="Verification rejections"
        value={s.verificationRejectionRate === null ? "—" : formatPercent(s.verificationRejectionRate)}
        hint={`${formatNumber(s.verificationFailures)} rejected`}
      />
    </div>
  )
}

export { KpiCards, NEEDS_ATTENTION_STATES }
```

> **Label discipline:** "Total reviews", "Average rating", "Response rate" are byte-identical to the e2e assertions; "Needs attention" too. `formatDuration(5400)` → "1h 30m" pins the widened tile.

- [ ] **Step 4: Refine `components/home/attention-list.tsx` (low-rated link + skeleton 3→5)**

Change the skeleton loop to five rows and the link `href` to carry the low-rated filter (the real inbox URL contract `locationId` + `rating` csv):

```tsx
// loading skeleton — now MAX_ROWS rows:
{[0, 1, 2, 3, 4].map((index) => (
  <Skeleton key={index} className="h-12 rounded-(--nr-radius-card)" />
))}
```

```tsx
// row link — low-rated reviews for this location (spec §8):
<Link
  href={`/inbox?locationId=${location.id}&rating=1,2`}
  prefetch={false}
  className="flex items-center justify-between gap-3 px-4 py-3 text-ui transition-colors duration-(--nr-duration-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
>
```

Keep the `prefetch={false}` (viewport-prefetch stability, mirroring the existing comment) and the existing sort/filter on `unresolvedComplaints`. The count caption copy is unchanged.

- [ ] **Step 5: Add `components/home/divergence-banner.tsx`**

```tsx
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ProviderTotals } from "@/lib/api/analytics"

// Renders only when Google's own totals diverge from what we have ingested, so
// the figures may be incomplete or stale. No raw numbers-as-code, no jargon.
export function DivergenceBanner({ providerTotals }: { providerTotals: ProviderTotals }) {
  if (!providerTotals.divergence) return null
  return (
    <Alert variant="warning">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>These figures may be incomplete</AlertTitle>
      <AlertDescription>
        Google reports a different review total or rating than we have collected so far, so the numbers
        below may be behind or missing some reviews. They will settle as syncing catches up.
      </AlertDescription>
    </Alert>
  )
}
```

- [ ] **Step 6: Add `components/home/home-charts.tsx` (chart cards cross-linking /performance)**

```tsx
"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { ChartCard, ChartLegend, ReportingBarChart, ReportingLineChart } from "@/components/ui/chart"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { formatDate } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"

function HomeCharts() {
  const analytics = useAnalyticsOverview()
  const state = analytics.isPending
    ? "loading"
    : analytics.isError
      ? "error"
      : (analytics.data.series.some((p) => p.reviewCount > 0) ? "ready" : "empty")
  const timezone = analytics.data?.timezone ?? "UTC"
  const tick = (iso: string) => formatDate(iso, timezone)
  const seeMore = (
    <Link href="/performance" className={buttonVariants({ variant: "outline", size: "sm" })}>
      See Performance
    </Link>
  )

  return (
    <section aria-labelledby="home-trends-heading" className="flex flex-col gap-3">
      <h2 id="home-trends-heading" className="text-title font-semibold tracking-tight">
        Trends
      </h2>
      {analytics.data ? <DivergenceBanner providerTotals={analytics.data.providerTotals} /> : null}
      <div className="grid gap-(--nr-gap-card) lg:grid-cols-2">
        <ChartCard
          title="Review volume"
          description={<FetchedAtCaption iso={analytics.data?.to ?? null} timezone={timezone} />}
          action={seeMore}
          state={state}
          onRetry={() => void analytics.refetch()}
          emptyLabel="No reviews in the last 30 days."
        >
          <ReportingBarChart
            data={analytics.data?.series ?? []}
            xKey="period"
            xTickFormatter={tick}
            series={[{ key: "reviewCount", label: "Reviews", colorVar: 1 }]}
          />
        </ChartCard>
        <ChartCard
          title="Average rating"
          description={<ChartLegend items={[{ label: "Daily average", colorVar: 3 }]} />}
          action={seeMore}
          state={state}
          onRetry={() => void analytics.refetch()}
          emptyLabel="No rated reviews in the last 30 days."
        >
          <ReportingLineChart
            data={analytics.data?.series ?? []}
            xKey="period"
            xTickFormatter={tick}
            series={[{ key: "averageRating", label: "Daily average", colorVar: 3 }]}
          />
        </ChartCard>
      </div>
    </section>
  )
}

export { HomeCharts }
```

- [ ] **Step 7: Render the new sections in `app/(dashboard)/home/page.tsx`**

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import { HomeCharts } from "@/components/home/home-charts"
import { KpiCards } from "@/components/home/kpi-cards"

export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Home"
        description="Your Google presence across every connected location, for the last 30 days."
      />
      <DisconnectedBanner />
      <KpiCards />
      <HomeCharts />
      <AttentionList />
    </PageFrame>
  )
}
```

- [ ] **Step 8: Write `tests/components/home-charts.test.tsx`** (divergence banner appears only on divergence; the "See Performance" link points at `/performance`)

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DivergenceBanner } from "@/components/home/divergence-banner"

describe("DivergenceBanner", () => {
  it("renders only when divergence is true", () => {
    const { rerender, container } = render(
      <DivergenceBanner providerTotals={{ averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: false }} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(
      <DivergenceBanner providerTotals={{ averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: true }} />
    )
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Run to verify pass, then the gate + build**

```bash
pnpm exec vitest run tests/components/home-kpi-cards.test.tsx tests/components/home-attention-list.test.tsx tests/components/home-charts.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/home` compiles). The existing `home.spec.ts` KPI-label + redirect assertions still hold (labels unchanged; new sections are additive).

- [ ] **Step 10: Commit**

```bash
git add components/home/kpi-cards.tsx components/home/attention-list.tsx components/home/divergence-banner.tsx components/home/home-charts.tsx "app/(dashboard)/home/page.tsx" tests/components/home-kpi-cards.test.tsx tests/components/home-attention-list.test.tsx tests/components/home-charts.test.tsx
git commit -m "feat(home): widen KPIs, divergence banner, trend charts, low-rated attention link

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `/performance` shell (URL-synced tabs) + reply-performance tab + `/analytics` redirect + nav prefetch flip

> **URL-synced tabs (D12).** `/performance` is ONE page. `PerformanceView` renders a Base UI `Tabs` whose value comes from `?tab=` and writes back via `router.replace` (shallow, no scroll jump). The reply tab is the default (`tab` absent → "reply"). This matches the pre-existing `performance.spec.ts` (both tabs visible as `role="tab"`). Files non-protected: `components/performance/`, `app/(dashboard)/performance/`, `app/(dashboard)/analytics/`, `components/app-shell/nav.tsx`.

**Files:**
- Create: `components/performance/performance-view.tsx`, `components/performance/range-select.tsx`, `components/performance/reply-performance-tab.tsx`, `components/performance/reply-locations-table.tsx`, `app/(dashboard)/performance/page.tsx`, `app/(dashboard)/performance/loading.tsx`, `app/(dashboard)/analytics/page.tsx`
- Modify: `components/app-shell/nav.tsx` (`/performance` `prefetch: false → true`)
- Test: `tests/components/performance-view.test.tsx`, `tests/components/reply-performance-tab.test.tsx`, `tests/components/nav.test.tsx` (**EDIT the EXISTING test** — it currently asserts `/performance` `data-prefetch === "false"` in two places; both must be replaced, not appended to)
- Consumes: `Tabs`, `TabsList`, `TabsTab`, `TabsPanel` (`@/components/ui/tabs`); `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` (`@/components/ui/select`); `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` (`@/components/ui/table`); `useRouter`, `useSearchParams`, `usePathname` (`next/navigation`); `useAnalyticsOverview` (Task 1); `ChartCard`/`ReportingBarChart`/`ReportingLineChart`/`ChartLegend`, `StatTile`, `DeltaBadge`, `DivergenceBanner`, `FetchedAtCaption`, `ReportingPanel`, `nullableCell` (Tasks 2–3); `REPLY_RANGES`, `resolveReplyRange`, `type ReplyRangeId` (Task 1); `formatNumber`, `formatPercent`, `formatDuration`, `formatDate` (`@/lib/format`).
- Produces: `PerformanceView` (client shell), `RangeSelect<T>` (props `{ value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }>; label: string }`), `ReplyPerformanceTab`, `ReplyLocationsTable` (props `{ locations: AnalyticsLocation[] }`).

- [ ] **Step 1: Write the failing `PerformanceView` + reply-table tests**

`tests/components/performance-view.test.tsx` (drive the URL sync through a mocked `next/navigation`):

```tsx
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/performance",
  useSearchParams: () => new URLSearchParams(search),
}))

import { PerformanceView } from "@/components/performance/performance-view"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  replace.mockReset()
  search = ""
})

function renderView() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ from: "x", to: "y", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }), { headers: { "content-type": "application/json" } })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><PerformanceView /></QueryClientProvider>)
}

describe("PerformanceView", () => {
  it("exposes all three tabs and defaults to reply when tab is absent", () => {
    renderView()
    expect(screen.getByRole("tab", { name: "Reply performance" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Google performance" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Keywords" })).toBeInTheDocument()
  })
  it("reflects ?tab=keywords as the active tab", () => {
    search = "tab=keywords"
    renderView()
    expect(screen.getByRole("tab", { name: "Keywords" })).toHaveAttribute("aria-selected", "true")
  })
})
```

`tests/components/reply-performance-tab.test.tsx` (nulls-last table):

```tsx
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"

describe("ReplyLocationsTable nulls-last honest-null (spec §8)", () => {
  it("sorts rows with null response rate last and renders — for nulls", () => {
    render(
      <ReplyLocationsTable
        timezone="Europe/London"
        locations={[
          { id: "a", name: "Alpha", reviews: 3, averageRating: 4.2, responseRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 0, verificationRejectionRate: null },
          { id: "b", name: "Bravo", reviews: 9, averageRating: 4.8, responseRate: 91, medianFirstResponseSeconds: 3600, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 1, verificationRejectionRate: null },
        ]}
      />
    )
    const rows = screen.getAllByRole("row").slice(1) // drop header
    expect(within(rows[0]).getByText("Bravo")).toBeInTheDocument() // non-null response rate first
    expect(within(rows[1]).getByText("Alpha")).toBeInTheDocument() // null last
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/performance-view.test.tsx tests/components/reply-performance-tab.test.tsx --project components`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Implement `components/performance/range-select.tsx`**

```tsx
"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function RangeSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ id: T; label: string }>
  label: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={label} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 4: Implement `components/performance/reply-locations-table.tsx` (nulls-last)**

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { nullableCell } from "@/components/reporting/reporting-states"
import type { AnalyticsLocation } from "@/lib/api/analytics"
import { cn } from "@/lib/utils"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

// Order by response rate desc, nulls last (missing ≠ 0), then by name.
function orderLocations(locations: AnalyticsLocation[]): AnalyticsLocation[] {
  return [...locations].sort((a, b) => {
    if (a.responseRate === null && b.responseRate === null) return a.name.localeCompare(b.name)
    if (a.responseRate === null) return 1
    if (b.responseRate === null) return -1
    return b.responseRate - a.responseRate || a.name.localeCompare(b.name)
  })
}

export function ReplyLocationsTable({ locations }: { locations: AnalyticsLocation[]; timezone?: string }) {
  const rows = orderLocations(locations)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Reviews</TableHead>
          <TableHead className="text-right">Avg rating</TableHead>
          <TableHead className="text-right">Response rate</TableHead>
          <TableHead className="text-right">Median response</TableHead>
          <TableHead className="text-right">Unresolved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((location) => {
          const rating = nullableCell(location.averageRating, (v) => v.toFixed(1))
          const rate = nullableCell(location.responseRate, (v) => formatPercent(v))
          const median = nullableCell(location.medianFirstResponseSeconds, (v) => formatDuration(v))
          return (
            <TableRow key={location.id}>
              <TableCell className="font-medium">{location.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(location.reviews)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", rating.isNull && "text-muted-foreground")}>{rating.text}</TableCell>
              <TableCell className={cn("text-right tabular-nums", rate.isNull && "text-muted-foreground")}>{rate.text}</TableCell>
              <TableCell className={cn("text-right tabular-nums", median.isNull && "text-muted-foreground")}>{median.text}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(location.unresolvedComplaints)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 5: Implement `components/performance/reply-performance-tab.tsx`**

```tsx
"use client"

import { useState } from "react"

import { ChartCard, ReportingBarChart, ReportingLineChart } from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { DeltaBadge } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"
import { RangeSelect } from "@/components/performance/range-select"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { REPLY_RANGES, resolveReplyRange, type ReplyRangeId } from "@/lib/reporting/ranges"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format"

export function ReplyPerformanceTab() {
  const [rangeId, setRangeId] = useState<ReplyRangeId>("30d")
  const { current, previous } = resolveReplyRange(rangeId)
  const now = useAnalyticsOverview(current)
  const prior = useAnalyticsOverview(previous)

  if (now.isPending) return <ReportingPanel variant="loading" />
  if (now.isError) return <ReportingPanel variant="error" onRetry={() => void now.refetch()} />

  const s = now.data.summary
  const p = prior.data?.summary ?? null
  const timezone = now.data.timezone
  const tick = (iso: string) => formatDate(iso, timezone)
  const hasSeries = now.data.series.some((point) => point.reviewCount > 0)

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      {/* Leading h2 keeps the heading order valid: page h1 -> tab h2 -> card h3 (REV-2). */}
      <h2 className="sr-only">Reply performance</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FetchedAtCaption iso={now.data.to} timezone={timezone} />
        <RangeSelect value={rangeId} onChange={setRangeId} options={REPLY_RANGES} label="Reply performance range" />
      </div>

      <DivergenceBanner providerTotals={now.data.providerTotals} />

      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Reviews" value={formatNumber(s.reviewVolume)} delta={<DeltaBadge current={s.reviewVolume} previous={p?.reviewVolume ?? null} unit="count" />} />
        <StatTile label="Average rating" value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)} delta={<DeltaBadge current={s.averageRating} previous={p?.averageRating ?? null} unit="rating" />} />
        <StatTile label="Response rate" value={s.responseRate === null ? "—" : formatPercent(s.responseRate)} delta={<DeltaBadge current={s.responseRate} previous={p?.responseRate ?? null} unit="percent" />} />
        {/* Duration-typed delta (REV-4): renders "▼ −20m" (faster), never raw seconds. */}
        <StatTile label="Median response time" value={formatDuration(s.medianFirstResponseSeconds)} delta={<DeltaBadge current={s.medianFirstResponseSeconds} previous={p?.medianFirstResponseSeconds ?? null} unit="duration" />} />
      </div>

      <div className="grid gap-(--nr-gap-card) lg:grid-cols-2">
        <ChartCard title="Review volume" state={hasSeries ? "ready" : "empty"} emptyLabel="No reviews in this window.">
          <ReportingBarChart data={now.data.series} xKey="period" xTickFormatter={tick} series={[{ key: "reviewCount", label: "Reviews", colorVar: 1 }, { key: "replies", label: "Replies", colorVar: 4 }]} />
        </ChartCard>
        <ChartCard title="Average rating over time" state={hasSeries ? "ready" : "empty"} emptyLabel="No rated reviews in this window.">
          <ReportingLineChart data={now.data.series} xKey="period" xTickFormatter={tick} series={[{ key: "averageRating", label: "Daily average", colorVar: 3 }]} />
        </ChartCard>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-title font-semibold tracking-tight">By location</h3>
          {now.data.locations.length === 0 ? (
            <ReportingPanel variant="empty" description="No location has reviews in this window." />
          ) : (
            <ReplyLocationsTable locations={now.data.locations} timezone={timezone} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Implement `components/performance/performance-view.tsx` (URL-synced tabs)**

```tsx
"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"

const TABS = [
  { value: "reply", label: "Reply performance" },
  { value: "google", label: "Google performance" },
  { value: "keywords", label: "Keywords" },
] as const

type TabValue = (typeof TABS)[number]["value"]

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value)
}

export function PerformanceView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "reply") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Tabs value={active} onValueChange={selectTab}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTab key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value="reply">
        <ReplyPerformanceTab />
      </TabsPanel>
      <TabsPanel value="google">
        <GooglePerformanceTab />
      </TabsPanel>
      <TabsPanel value="keywords">
        <KeywordsTab />
      </TabsPanel>
    </Tabs>
  )
}
```

> **Executor note:** `GooglePerformanceTab` (Task 5) and `KeywordsTab` (Task 6) do not exist yet. Land Task 4 with **temporary one-line stub components** (`export function GooglePerformanceTab() { return <ReportingPanel variant="loading" /> }` in their own files) so `PerformanceView` compiles and the `performance-view.test.tsx` tab assertions pass; Tasks 5 and 6 replace those stubs with the real tabs. Note the stub files in the commit body. (This keeps each task independently gate-green without a forward-reference build break.)

- [ ] **Step 7: Add the page, loading, and `/analytics` redirect**

`app/(dashboard)/performance/page.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Performance"
        description="How your locations are performing on Google — replies, visibility, and search keywords."
      />
      <PerformanceView />
    </PageFrame>
  )
}
```

`app/(dashboard)/performance/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function PerformanceLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-(--nr-gap-section)">
      <Skeleton className="h-9 w-72 rounded-(--nr-radius-control)" />
      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-(--nr-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-(--nr-radius-card)" />
    </div>
  )
}
```

`app/(dashboard)/analytics/page.tsx` (mirrors the existing `/overview` redirect precedent):

```tsx
import { redirect } from "next/navigation"

export default function AnalyticsPage(): never {
  redirect("/performance")
}
```

- [ ] **Step 8: Flip the nav prefetch + update the nav test**

`components/app-shell/nav.tsx` — change only the `/performance` item and drop the now-stale prefetch caveat from its comment:

```tsx
{ href: "/performance", label: "Performance", icon: TrendingUp, prefetch: true },
```

`tests/components/nav.test.tsx` — **this file already exists and asserts the OLD policy** (`/performance` `data-prefetch === "false"`, and "every non-home/inbox/locations/settings item is prefetch:false"). Flipping `/performance` to `prefetch:true` breaks both existing assertions, so **EDIT them in place** (do NOT append a second `describe`). Replace the two `it(...)` bodies with:

```tsx
describe("primary nav prefetch policy", () => {
  it("prefetches every primary route, including /performance", () => {
    render(<Nav />)
    for (const label of ["Home", "Inbox", "Locations", "Performance", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("data-prefetch", "true")
    }
  })

  it("encodes prefetch:true for every NAV_ITEMS entry", () => {
    for (const item of NAV_ITEMS) {
      expect(item.prefetch, `${item.href} prefetch`).toBe(true)
    }
  })
})
```

Keep the file's existing imports and the two `vi.mock` blocks (`next/navigation` → `usePathname: () => "/home"`, and the `next/link` shim that maps `prefetch` → `data-prefetch={String(prefetch)}`) — only the two assertion bodies change. The former "Performance is false" loop and the "all others are false" filter are DELETED.

- [ ] **Step 9: Run to verify pass, then the gate + build**

```bash
pnpm exec vitest run tests/components/performance-view.test.tsx tests/components/reply-performance-tab.test.tsx tests/components/nav.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/performance`, `/analytics` compile; the redirect resolves). The reply tab renders with real data; the two other tabs show the temporary loading stub until Tasks 5–6.

- [ ] **Step 10: Commit**

```bash
git add components/performance "app/(dashboard)/performance" "app/(dashboard)/analytics" components/app-shell/nav.tsx tests/components/performance-view.test.tsx tests/components/reply-performance-tab.test.tsx tests/components/nav.test.tsx
git commit -m "feat(performance): URL-synced tabs shell + reply-performance tab + /analytics redirect + nav flip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Google-performance tab — presence metrics, 5-state handling, env-off, humanised reasons, refresh trigger

> **Replaces the Task 4 stub `GooglePerformanceTab`.** presence NEVER 503s for an off flag — it returns `ingestionEnabled: false` in the body, which this tab reads to render an honest "off" panel (never a flag name). The five `state` values each map to a distinct panel; `unavailableReasons` pass through `humaniseUnavailableReasons`. The "Refresh Google data" button (owner/admin only, via `canTriggerSync`) POSTs `/api/sync/performance` and invalidates the presence key. Files non-protected: `components/performance/`.

**Files:**
- Create: `components/performance/refresh-google-button.tsx`
- Modify: `components/performance/google-performance-tab.tsx` (replace the Task 4 stub with the real tab)
- Test: `tests/components/google-performance-tab.test.tsx`, `tests/components/refresh-google-button.test.tsx`
- Consumes: `useAnalyticsPresence` (Task 1); `useSessionRole` (`@/lib/queries/use-session` — the client session hook ADDED in Task 1, REV-1), `useQueryClient` (`@tanstack/react-query`); `triggerPerformanceSync` (Task 1); `canTriggerSync` (Task 1); `metricLabel`, `ORDERED_METRICS`, `IMPRESSION_METRICS` (Task 1); `humaniseUnavailableReasons` (Task 1); `PRESENCE_RANGES` (Task 1); `queryKeys` (`@/lib/queries/keys`); `StatTile`, `ChartCard`/`ReportingLineChart`/`ChartLegend`, `RangeSelect`, `FetchedAtCaption`, `ReportingPanel` (Tasks 2–4); `formatNumber`, `formatDate` (`@/lib/format`).
- Produces: `GooglePerformanceTab`, `RefreshGoogleButton` (props `{ kind: "performance" | "keywords"; canTrigger: boolean; onDone?: () => void }`).

> **Session-role note (REV-1 resolved):** the "Refresh" gate reads the caller's role via `useSessionRole()` from `@/lib/queries/use-session`, added in Task 1 (`GET /api/session` → `{ session }.role`). There is no client session context today — this hook is the accessor. `canTriggerSync(useSessionRole())` restricts the button to owner/admin; the server (`requireRole(["owner","admin"])`) remains the authority.

- [ ] **Step 1: Write the failing tests**

`tests/components/refresh-google-button.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderButton(canTrigger: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RefreshGoogleButton kind="performance" canTrigger={canTrigger} />
    </QueryClientProvider>
  )
}

describe("RefreshGoogleButton", () => {
  it("is not rendered for a caller who cannot trigger a sync", () => {
    const { container } = renderButton(false)
    expect(container).toBeEmptyDOMElement()
  })
  it("POSTs the performance sync and shows a pending state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ organisations: [], skipped: false, nextCursor: null }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    renderButton(true)
    await userEvent.click(screen.getByRole("button", { name: /refresh google data/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })
})
```

`tests/components/google-performance-tab.test.tsx` (state mapping — off, no_link, unavailable, ready):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/performance", useSearchParams: () => new URLSearchParams("tab=google") }))

import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"

const ZERO_TOTALS = { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }

function stub(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GooglePerformanceTab /></QueryClientProvider>)
}

describe("GooglePerformanceTab state mapping (D9)", () => {
  it("shows an off panel when ingestion is disabled", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "empty", freshThrough: null, locations: [{ id: "l", name: "L" }], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: false })
    renderTab()
    expect(await screen.findByText(/not switched on|turned on|not enabled/i)).toBeInTheDocument()
  })
  it("shows a no-link panel when there is no linked location", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "no_link", freshThrough: null, locations: [], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    expect(await screen.findByText(/no.*link|not linked|connect/i)).toBeInTheDocument()
  })
  it("humanises unavailable reasons without leaking a raw code", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "unavailable", freshThrough: null, locations: [{ id: "l", name: "L" }], totals: ZERO_TOTALS, series: [], unavailableReasons: ["performance_sync_failed"], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    expect(await screen.findByText(/did not return|retry/i)).toBeInTheDocument()
    expect(screen.queryByText(/performance_sync_failed/)).not.toBeInTheDocument()
  })
  it("renders metric tiles when ready", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "ready", freshThrough: "2026-08-01", locations: [{ id: "l", name: "L" }], totals: { ...ZERO_TOTALS, CALL_CLICKS: 12, WEBSITE_CLICKS: 30 }, series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 12 } }], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    expect(await screen.findByText("Calls")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("Website clicks")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/google-performance-tab.test.tsx tests/components/refresh-google-button.test.tsx --project components`
Expected: FAIL — the real tab (Task 4 shipped a loading stub) and the refresh button do not exist.

- [ ] **Step 3: Implement `components/performance/refresh-google-button.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { triggerKeywordsSync, triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"

export function RefreshGoogleButton({
  kind,
  canTrigger,
  onDone,
}: {
  kind: "performance" | "keywords"
  canTrigger: boolean
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canTrigger) return null

  async function run() {
    setPending(true)
    setError(null)
    try {
      if (kind === "performance") await triggerPerformanceSync()
      else await triggerKeywordsSync()
      await queryClient.invalidateQueries({
        queryKey: queryKeys.analytics(kind === "performance" ? "presence" : "keywords", {}),
        exact: false,
      })
      onDone?.()
    } catch (caught) {
      const paused = caught instanceof ApiClientError && caught.status === 503
      setError(paused ? "Refreshing is paused right now. Please try again later." : "We could not refresh from Google. Please try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={pending}>
        {pending ? "Refreshing…" : "Refresh Google data"}
      </Button>
      {error ? <span className="text-caption text-destructive">{error}</span> : null}
    </div>
  )
}
```

> **Invalidation note:** `queryKeys.analytics("presence", {})` with `exact: false` matches every `["analytics", "presence", …]` entry regardless of range/locationId, so a refresh re-reads the current range. Confirm `invalidateQueries` prefix-matching against the 3-tuple key during implementation.

- [ ] **Step 4: Implement the real `components/performance/google-performance-tab.tsx`**

```tsx
"use client"

import { useState } from "react"

import { ChartCard, ChartLegend, ReportingLineChart } from "@/components/ui/chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"
import { IMPRESSION_METRICS, metricLabel, ORDERED_METRICS } from "@/lib/reporting/metric-labels"
import { PRESENCE_RANGES } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session" // client session hook (Task 1, REV-1)
import { formatDate, formatNumber } from "@/lib/format"

type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]

export function GooglePerformanceTab() {
  const [rangeId, setRangeId] = useState<PresenceRangeId>("28d")
  const role = useSessionRole()
  const presence = useAnalyticsPresence({ range: rangeId })

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FetchedAtCaption iso={presence.data?.freshThrough ?? null} timezone="UTC" />
      <div className="flex items-center gap-3">
        <RangeSelect value={rangeId} onChange={setRangeId} options={PRESENCE_RANGES} label="Google performance range" />
        <RefreshGoogleButton kind="performance" canTrigger={canTriggerSync(role)} onDone={() => void presence.refetch()} />
      </div>
    </div>
  )

  if (presence.isPending) return <div className="flex flex-col gap-(--nr-gap-section)">{header}<ReportingPanel variant="loading" /></div>
  if (presence.isError) return <div className="flex flex-col gap-(--nr-gap-section)">{header}<ReportingPanel variant="error" onRetry={() => void presence.refetch()} /></div>

  const data = presence.data
  const reasons = humaniseUnavailableReasons(data.unavailableReasons)

  // Off flag wins over state: ingestion is switched off for this account.
  const body =
    !data.ingestionEnabled ? (
      <ReportingPanel variant="off" title="Google performance is not switched on" description="Visibility metrics are not switched on for your account yet." />
    ) : data.state === "no_link" ? (
      <ReportingPanel variant="empty" title="No linked location" description="Connect a Google location to see how it is performing." />
    ) : data.state === "pending" ? (
      <ReportingPanel variant="loading" />
    ) : data.state === "unavailable" ? (
      <Alert variant="warning">
        <AlertTitle>Some figures could not be refreshed</AlertTitle>
        <AlertDescription>{reasons[0] ?? "We will retry automatically."}</AlertDescription>
      </Alert>
    ) : data.state === "empty" ? (
      <ReportingPanel variant="empty" title="No activity yet" description="Google has not reported any visibility data for this window." />
    ) : (
      <div className="flex flex-col gap-(--nr-gap-section)">
        <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
          {ORDERED_METRICS.map((metric) => (
            <StatTile key={metric} label={metricLabel(metric)} value={formatNumber(data.totals[metric])} />
          ))}
        </div>
        <ChartCard
          title="Views over time"
          description={<ChartLegend items={IMPRESSION_METRICS.map((m, i) => ({ label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))} />}
          state={data.series.length ? "ready" : "empty"}
          emptyLabel="No daily views in this window."
        >
          <ReportingLineChart
            data={data.series.map((point) => ({ date: point.date, ...point.metrics }))}
            xKey="date"
            xTickFormatter={(iso) => formatDate(iso, "UTC")}
            series={IMPRESSION_METRICS.map((m, i) => ({ key: m, label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))}
          />
        </ChartCard>
      </div>
    )

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      {/* Leading h2 keeps heading order valid before the ChartCard h3 (REV-2). */}
      <h2 className="sr-only">Google performance</h2>
      {header}
      {reasons.length && data.state === "ready" ? (
        <Alert variant="info"><AlertTitle>Heads up</AlertTitle><AlertDescription>{reasons[0]}</AlertDescription></Alert>
      ) : null}
      {body}
    </div>
  )
}
```

> **Timezone note:** presence dates are plain `YYYY-MM-DD` day keys in the org timezone already (server-bucketed), so `formatDate(iso, "UTC")` renders the day as-is without a tz shift. Keep "UTC" here to avoid re-shifting an already-local day string.
> **Heading-order note (REV-2):** the `sr-only` `<h2>` sits above the metric `StatTile`s and the "Views over time" ChartCard `<h3>`, so `heading-order` stays valid on this tab even when deep-linked via `?tab=google`.

- [ ] **Step 5: Run to verify pass, then the gate + build**

```bash
pnpm exec vitest run tests/components/google-performance-tab.test.tsx tests/components/refresh-google-button.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green.

- [ ] **Step 6: Commit**

```bash
git add components/performance/google-performance-tab.tsx components/performance/refresh-google-button.tsx tests/components/google-performance-tab.test.tsx tests/components/refresh-google-button.test.tsx
git commit -m "feat(performance): Google-performance tab (metrics, 5-state, off/unavailable, refresh trigger)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Keywords tab — gated keyword impressions with honest "N+" and the paused state

> **Replaces the Task 4 stub `KeywordsTab`.** Kept a separate task (not merged into Task 5) because keywords has distinct semantics worth pinning independently: the route throws `503 keywords_paused` BEFORE parsing when the flag is off (so the tab maps that specific code to a paused panel, NOT a generic error), the response has its own shape (no `to`/`freshThrough`/env flags), and volumes must render honestly as "N+". Files non-protected: `components/performance/`.

**Files:**
- Modify: `components/performance/keywords-tab.tsx` (replace the Task 4 stub)
- Test: `tests/components/keywords-tab.test.tsx`
- Consumes: `useAnalyticsKeywords` (Task 1); `formatKeywordImpressions` (Task 1); `humaniseUnavailableReasons` (Task 1); `KEYWORD_RANGES` (Task 1); `canTriggerSync` (Task 1) + `useSessionRole` (`@/lib/queries/use-session`, Task 1, REV-1); `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`; `RangeSelect`, `RefreshGoogleButton`, `FetchedAtCaption`, `ReportingPanel` (Tasks 2–5); `ApiClientError` (`@/lib/api/client`); `formatNumber` (`@/lib/format`).
- Produces: `KeywordsTab`.

- [ ] **Step 1: Write the failing test**

`tests/components/keywords-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/performance", useSearchParams: () => new URLSearchParams("tab=keywords") }))

import { KeywordsTab } from "@/components/performance/keywords-tab"

function stub(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><KeywordsTab /></QueryClientProvider>)
}

describe("KeywordsTab", () => {
  it("maps the 503 keywords_paused code to a paused panel, never a raw error", async () => {
    stub({ error: "keywords_paused", message: "paused" }, 503)
    renderTab()
    expect(await screen.findByText(/paused/i)).toBeInTheDocument()
    expect(screen.queryByText(/keywords_paused/)).not.toBeInTheDocument()
  })
  it("renders keyword rows with honest 'N+' for thresholded volumes", async () => {
    stub({
      range: "6m", from: "2026-03-01", state: "ready", locations: [{ id: "l", name: "L" }],
      keywords: [
        { rank: 1, keyword: "riverside hotel bath", impressions: 5200, upperBound: 5200, thresholded: false, firstMonth: "2026-03", latestMonth: "2026-08" },
        { rank: 2, keyword: "spa near me", impressions: 1000, upperBound: 9999, thresholded: true, firstMonth: "2026-05", latestMonth: "2026-08" },
      ],
      unavailableReasons: [],
    })
    renderTab()
    expect(await screen.findByText("riverside hotel bath")).toBeInTheDocument()
    expect(screen.getByText("5,200")).toBeInTheDocument()
    expect(screen.getByText("1,000+")).toBeInTheDocument()
  })
  it("shows an empty panel when there are no keywords", async () => {
    stub({ range: "6m", from: "2026-03-01", state: "empty", locations: [{ id: "l", name: "L" }], keywords: [], unavailableReasons: [] })
    renderTab()
    expect(await screen.findByText(/no.*keyword|nothing/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/keywords-tab.test.tsx --project components`
Expected: FAIL — the real tab (Task 4 shipped a loading stub) does not exist.

- [ ] **Step 3: Implement the real `components/performance/keywords-tab.tsx`**

```tsx
"use client"

import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { ApiClientError } from "@/lib/api/client"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"
import { KEYWORD_RANGES } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session"

type KeywordRangeId = (typeof KEYWORD_RANGES)[number]["id"]

export function KeywordsTab() {
  const [rangeId, setRangeId] = useState<KeywordRangeId>("6m")
  const role = useSessionRole()
  const keywords = useAnalyticsKeywords({ range: rangeId })

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FetchedAtCaption iso={keywords.data?.from ?? null} timezone="UTC" prefix="Impressions since" />
      <div className="flex items-center gap-3">
        <RangeSelect value={rangeId} onChange={setRangeId} options={KEYWORD_RANGES} label="Keyword range" />
        <RefreshGoogleButton kind="keywords" canTrigger={canTriggerSync(role)} onDone={() => void keywords.refetch()} />
      </div>
    </div>
  )

  // The route throws 503 keywords_paused before parsing when the flag is off.
  if (keywords.isError) {
    const paused = keywords.error instanceof ApiClientError && keywords.error.code === "keywords_paused"
    return (
      <div className="flex flex-col gap-(--nr-gap-section)">
        {header}
        {paused ? (
          <ReportingPanel variant="paused" title="Keyword reporting is paused" description="Google search-keyword reporting is temporarily paused. Please check back soon." />
        ) : (
          <ReportingPanel variant="error" onRetry={() => void keywords.refetch()} />
        )}
      </div>
    )
  }

  if (keywords.isPending) {
    return <div className="flex flex-col gap-(--nr-gap-section)">{header}<ReportingPanel variant="loading" /></div>
  }

  const data = keywords.data
  const reasons = humaniseUnavailableReasons(data.unavailableReasons)

  const body =
    data.state === "no_link" ? (
      <ReportingPanel variant="empty" title="No linked location" description="Connect a Google location to see the searches that surface it." />
    ) : data.state === "pending" ? (
      <ReportingPanel variant="loading" />
    ) : data.state === "unavailable" ? (
      <Alert variant="warning"><AlertTitle>Some keywords could not be refreshed</AlertTitle><AlertDescription>{reasons[0] ?? "We will retry automatically."}</AlertDescription></Alert>
    ) : data.keywords.length === 0 ? (
      <ReportingPanel variant="empty" title="No keywords yet" description="Google has not reported any search keywords for this window." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Search term</TableHead>
            <TableHead className="text-right">Impressions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.keywords.map((keyword) => (
            <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
              <TableCell className="text-right tabular-nums text-muted-foreground">{keyword.rank}</TableCell>
              <TableCell className="font-medium" lang="und" dir="auto">{keyword.keyword}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKeywordImpressions(keyword)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      {/* Leading h2 keeps heading order valid when deep-linked via ?tab=keywords (REV-2). */}
      <h2 className="sr-only">Search keywords</h2>
      {header}
      <p className="text-caption text-muted-foreground">A “+” means Google reports at least this many impressions (it gives a range for lower-volume terms).</p>
      {body}
    </div>
  )
}
```

> **Honesty caption:** the "+" is explained inline so a lower-bounded volume is never mistaken for an exact count (spec §7 honest presentation). Keyword text carries `dir="auto"` (spec §7 review/keyword content direction).
> **REV-5 caption fix:** the `FetchedAtCaption` reads `keywords.data?.from ?? null`, so once keywords load it honestly reads "Impressions since <first month>" instead of the static "No data yet". `header` is recomputed each render, so it picks up `from` when the query resolves.
> **REV-2 heading:** the `sr-only` `<h2>` precedes the table; the keywords body has no `<h3>`, so this keeps the tab consistent with the others (and valid if a card/heading is added later).

- [ ] **Step 4: Run to verify pass, then the gate + build**

```bash
pnpm exec vitest run tests/components/keywords-tab.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (all three tabs now real).

- [ ] **Step 5: Commit**

```bash
git add components/performance/keywords-tab.tsx tests/components/keywords-tab.test.tsx
git commit -m "feat(performance): keywords tab (honest N+, paused state, gated refresh)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Per-location performance tab (7th location-workspace tab)

> **Overview has no `locationId` param (D5).** The per-location review metrics are assembled by filtering the org-wide `overview.locations[]` by id **client-side**; Google metrics/keywords come from `presence?locationId=` / `keywords?locationId=`. Because `overview.locations` inner-joins `review`, a location with zero in-window reviews is ABSENT from the array → render an honest "no review activity" panel, never an error. Files non-protected: `components/locations/location-tab-nav.tsx`, `components/performance/`, `app/(dashboard)/locations/[id]/performance/`.

**Files:**
- Create: `components/performance/location-performance.tsx`, `app/(dashboard)/locations/[id]/performance/page.tsx`
- Modify: `components/locations/location-tab-nav.tsx` (append the 7th "Performance" tab)
- Test: `tests/components/location-performance.test.tsx`, `tests/components/location-tab-nav.test.tsx` (**EDIT the EXISTING test** — it currently asserts the "six wave-1 tabs" and that "Performance" is NOT in the document; both must change)
- Consumes: `useAnalyticsOverview` (Task 1, org-wide — filtered by id here), `useAnalyticsPresence`, `useAnalyticsKeywords` (Task 1, `{ locationId }`); `StatTile`, `DeltaBadge`, `ChartCard`/`ReportingLineChart`, `FetchedAtCaption`, `ReportingPanel`, `nullableCell` (Tasks 2–4); `metricLabel`, `ORDERED_METRICS`, `IMPRESSION_METRICS`, `formatKeywordImpressions`, `humaniseUnavailableReasons`, `PRESENCE_RANGES` (Task 1); `formatNumber`, `formatPercent`, `formatDuration`, `formatDate` (`@/lib/format`); `Table…` primitives.
- Produces: `LocationPerformance` (props `{ locationId: string }`).

- [ ] **Step 1: Write the failing tests**

`tests/components/location-tab-nav.test.tsx` — **this file already exists and asserts the pre-M7 state** ("renders the six wave-1 tabs", `Hours` active because it mocks `usePathname: () => "/locations/loc-1/hours"`, and a `gone` array that INCLUDES `"Performance"`). Adding the 7th tab breaks the six-tab loop and the `gone` array. **EDIT it in place** (not an append): remove `"Performance"` from the `gone` array, change six→seven, and add the active-Performance assertion. Concretely, replace the single `it(...)` and the pathname mock with:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LocationTabNav } from "@/components/locations/location-tab-nav"

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/loc-1/performance" }))

describe("LocationTabNav", () => {
  it("renders the seven tabs (incl. Performance) and marks the active one", () => {
    render(<LocationTabNav locationId="loc-1" />)
    const nav = screen.getByRole("navigation", { name: "Location sections" })
    for (const label of ["Profile", "Hours", "Photos", "Posts", "Booking", "Menu", "Performance"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    const performance = screen.getByRole("link", { name: "Performance" })
    expect(performance).toHaveAttribute("href", "/locations/loc-1/performance")
    expect(performance).toHaveAttribute("aria-current", "page")
    expect(nav).toBeInTheDocument()
    // The M8-deferred consoles still must not leak into the workspace tabs.
    for (const gone of ["Business info", "Industry", "Administration", "Reviews"]) {
      expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument()
    }
  })
})
```

> The pathname mock flips from `/hours` to `/performance` so the active-tab assertion now targets Performance; `"Performance"` is removed from `gone` (Business info / Industry / Administration / Reviews remain deferred). The `nav` accessible name is "Location sections" (unchanged from M5).

`tests/components/location-performance.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationPerformance } from "@/components/performance/location-performance"

const ZERO_TOTALS = { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }

function routeBody(url: string) {
  if (url.startsWith("/api/analytics/overview")) {
    return { from: "a", to: "b", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [{ id: "loc-1", name: "Riverside", reviews: 12, averageRating: 4.5, responseRate: 88, medianFirstResponseSeconds: 3600, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 1, verificationRejectionRate: null }], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }
  }
  if (url.startsWith("/api/analytics/presence/keywords")) {
    return { range: "6m", from: "2026-03-01", state: "empty", locations: [{ id: "loc-1", name: "Riverside" }], keywords: [], unavailableReasons: [] }
  }
  return { range: "28d", from: "a", to: "b", state: "empty", freshThrough: null, locations: [{ id: "loc-1", name: "Riverside" }], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderPerf() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(routeBody(url)), { headers: { "content-type": "application/json" } })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LocationPerformance locationId="loc-1" /></QueryClientProvider>)
}

describe("LocationPerformance", () => {
  it("derives the review tiles from the matching overview.locations row", async () => {
    renderPerf()
    expect(await screen.findByText("Reviews")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("4.5")).toBeInTheDocument()
  })
})
```

Also add a case proving the honest empty panel when the location is absent from `overview.locations`:

```tsx
  it("shows an honest no-activity panel when the location is absent from overview", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.startsWith("/api/analytics/overview")
        ? { from: "a", to: "b", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }
        : routeBody(url)
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><LocationPerformance locationId="loc-1" /></QueryClientProvider>)
    expect(await screen.findByText(/no review activity/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/location-tab-nav.test.tsx tests/components/location-performance.test.tsx --project components`
Expected: FAIL — the Performance tab and the component do not exist.

- [ ] **Step 3: Append the 7th tab in `components/locations/location-tab-nav.tsx`**

Add the entry to the `TABS` array (keep the existing mechanics):

```ts
const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
  { segment: "performance", label: "Performance" },
] as const
```

- [ ] **Step 4: Implement `components/performance/location-performance.tsx`**

```tsx
"use client"

import { useState } from "react"

import { ChartCard, ChartLegend, ReportingLineChart } from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"
import { RangeSelect } from "@/components/performance/range-select"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import { IMPRESSION_METRICS, metricLabel, ORDERED_METRICS } from "@/lib/reporting/metric-labels"
import { PRESENCE_RANGES } from "@/lib/reporting/ranges"
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format"

type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]

export function LocationPerformance({ locationId }: { locationId: string }) {
  const [rangeId, setRangeId] = useState<PresenceRangeId>("28d")
  const overview = useAnalyticsOverview()
  const presence = useAnalyticsPresence({ range: rangeId, locationId })
  const keywords = useAnalyticsKeywords({ range: "6m", locationId })

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      {/* Review metrics — filtered from the org-wide overview.locations[] */}
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold tracking-tight">Reviews</h2>
        {overview.isPending ? (
          <ReportingPanel variant="loading" />
        ) : overview.isError ? (
          <ReportingPanel variant="error" onRetry={() => void overview.refetch()} />
        ) : (() => {
          const row = overview.data.locations.find((location) => location.id === locationId)
          if (!row) {
            return <ReportingPanel variant="empty" title="No review activity" description="This location has no reviews in the last 30 days." />
          }
          return (
            <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Reviews" value={formatNumber(row.reviews)} />
              <StatTile label="Average rating" value={row.averageRating === null ? "—" : row.averageRating.toFixed(1)} />
              <StatTile label="Response rate" value={row.responseRate === null ? "—" : formatPercent(row.responseRate)} />
              <StatTile label="Median response time" value={formatDuration(row.medianFirstResponseSeconds)} />
            </div>
          )
        })()}
      </section>

      {/* Google visibility — presence scoped by locationId */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-title font-semibold tracking-tight">Visibility on Google</h2>
          <RangeSelect value={rangeId} onChange={setRangeId} options={PRESENCE_RANGES} label="Visibility range" />
        </div>
        {presence.isPending ? (
          <ReportingPanel variant="loading" />
        ) : presence.isError ? (
          <ReportingPanel variant="error" onRetry={() => void presence.refetch()} />
        ) : !presence.data.ingestionEnabled ? (
          <ReportingPanel variant="off" title="Not switched on" description="Visibility metrics are not switched on for your account yet." />
        ) : presence.data.state === "no_link" ? (
          <ReportingPanel variant="empty" title="Not linked" description="This location is not linked to Google." />
        ) : presence.data.state !== "ready" ? (
          <ReportingPanel variant="empty" title="No visibility data yet" description="Google has not reported visibility data for this window." />
        ) : (
          <>
            <FetchedAtCaption iso={presence.data.freshThrough} timezone="UTC" />
            <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
              {ORDERED_METRICS.map((metric) => (
                <StatTile key={metric} label={metricLabel(metric)} value={formatNumber(presence.data.totals[metric])} />
              ))}
            </div>
            <ChartCard
              title="Views over time"
              description={<ChartLegend items={IMPRESSION_METRICS.map((m, i) => ({ label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))} />}
              state={presence.data.series.length ? "ready" : "empty"}
              emptyLabel="No daily views in this window."
            >
              <ReportingLineChart
                data={presence.data.series.map((point) => ({ date: point.date, ...point.metrics }))}
                xKey="date"
                xTickFormatter={(iso) => formatDate(iso, "UTC")}
                series={IMPRESSION_METRICS.map((m, i) => ({ key: m, label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))}
              />
            </ChartCard>
          </>
        )}
      </section>

      {/* Search keywords — keywords scoped by locationId */}
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold tracking-tight">Search keywords</h2>
        {keywords.isPending ? (
          <ReportingPanel variant="loading" />
        ) : keywords.isError ? (
          <ReportingPanel variant="paused" title="Keyword reporting is paused" description="Google search-keyword reporting is temporarily paused." />
        ) : keywords.data.keywords.length === 0 ? (
          <ReportingPanel variant="empty" title="No keywords yet" description="Google has not reported any search keywords for this location." />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-right">#</TableHead>
                    <TableHead>Search term</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywords.data.keywords.slice(0, 20).map((keyword) => (
                    <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{keyword.rank}</TableCell>
                      <TableCell className="font-medium" dir="auto">{keyword.keyword}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKeywordImpressions(keyword)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
```

> **Keyword error handling:** `keywords.isError` on the per-location tab treats any error (incl. `503 keywords_paused`) as a paused panel — the location view keeps a calm single message rather than the full paused/error split of Task 6 (which owns the org-wide surface). If a finer split is wanted, reuse Task 6's `ApiClientError` code check.

- [ ] **Step 5: Add the per-location page**

`app/(dashboard)/locations/[id]/performance/page.tsx`:

```tsx
import { LocationPerformance } from "@/components/performance/location-performance"

export const metadata = { title: "Performance · Location · NabaPresence" }

export default async function LocationPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationPerformance locationId={id} />
}
```

> **Layout note:** the location workspace `[id]/layout.tsx` (M5) already owns the `<main>`, the location `<h1>`, and the tab nav; the tab page renders only the feature component (`<h2>` sections), preserving one-`<h1>`/one-`<main>`. Confirm the layout wraps `{children}` so this page inherits the workspace shell.

- [ ] **Step 6: Run to verify pass, then the gate + build**

```bash
pnpm exec vitest run tests/components/location-tab-nav.test.tsx tests/components/location-performance.test.tsx --project components
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: PASS; build green (`/locations/[id]/performance` compiles).

- [ ] **Step 7: Commit**

```bash
git add components/locations/location-tab-nav.tsx components/performance/location-performance.tsx "app/(dashboard)/locations/[id]/performance/page.tsx" tests/components/location-tab-nav.test.tsx tests/components/location-performance.test.tsx
git commit -m "feat(locations): per-location performance tab (overview filter + presence/keywords by id)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Milestone e2e adaptation + gate

> **Terminal gate.** Rewrite the quarantined `performance.spec.ts`, extend `home.spec.ts`, add the per-location performance assertion to `locations.spec.ts`, un-ignore `performance.spec.ts` and enable the two reporting flags in the Playwright web server, seed performance/keyword rows in the stub bridge, then run the full gate. **No protected-path edit anywhere in this task** — it touches only `tests/**` and `playwright.config.ts` (non-protected). Leave the whole-branch review to the controller after the gate is green.

**Files:**
- Rewrite: `tests/e2e/performance.spec.ts`
- Modify: `tests/e2e/home.spec.ts` (extend), `tests/e2e/locations.spec.ts` (per-location performance tab), `tests/e2e/helpers/stub-bridge.ts` (seed `performance_metric_daily` + `performance_search_keyword_monthly` rows for the journey org's linked location), `playwright.config.ts` (un-ignore `**/performance.spec.ts`; add `GBP_PERFORMANCE_ENABLED: "true"`, `GBP_KEYWORDS_ENABLED: "true"` to the web-server env)
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `node scripts/run-test-command.mjs e2e pnpm exec playwright test`, then `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`

> **Why enable the flags + seed:** the reporting GET routes never call Google (they read `performance_metric_daily` / `performance_search_keyword_monthly`), and the sync POSTs are stubbed via `GOOGLE_API_PROXY_BASE`, so enabling `GBP_PERFORMANCE_ENABLED`/`GBP_KEYWORDS_ENABLED` in the e2e web server is Google-call-safe. Enabling them (a) makes the Google-performance tab render `ingestionEnabled: true` and (b) lets keywords return `200` instead of `503`, so — with seeded rows — the "ready" charts/table path is exercised deterministically. The honest off/paused/empty states are already unit-covered in Tasks 5–6; e2e proves the populated product.

- [ ] **Step 1: Seed reporting rows in the stub bridge**

Extend `tests/e2e/helpers/stub-bridge.ts` where it seeds the journey org's linked location. After the linked-location rows exist, insert daily performance + monthly keyword rows against that `external_location_id` (the presence/keywords routes join `performance_metric_daily`/`performance_search_keyword_monthly` → `location_link` → `location`). Use the org's already-seeded `externalLocationId`:

```ts
// --- reporting seed (Task 8) ---------------------------------------------
// A recent day of performance metrics so /performance Google tab is "ready".
const perfDay = new Date().toISOString().slice(0, 10)
const PERF_METRICS: Array<[string, number]> = [
  ["CALL_CLICKS", 12],
  ["WEBSITE_CLICKS", 30],
  ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", 140],
  ["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 260],
]
for (const [metric, value] of PERF_METRICS) {
  await admin`
    insert into performance_metric_daily (external_location_id, metric, metric_date, value)
    values (${externalLocationId}, ${metric}, ${perfDay}::date, ${value})
    on conflict do nothing
  `
}
// A keyword month so the Keywords tab is "ready", incl. a thresholded row.
const perfMonth = `${new Date().toISOString().slice(0, 7)}-01`
await admin`
  insert into performance_search_keyword_monthly
    (external_location_id, keyword, metric_month, impressions, threshold)
  values
    (${externalLocationId}, 'riverside hotel bath', ${perfMonth}::date, 5200, 0),
    (${externalLocationId}, 'spa near me', ${perfMonth}::date, 1000, 8999)
  on conflict do nothing
`
// A performance sync_checkpoint so state resolves to "ready", not "pending".
await admin`
  insert into sync_checkpoint (external_location_id, sync_type, status, last_error_code)
  values
    (${externalLocationId}, 'performance', 'succeeded', null),
    (${externalLocationId}, 'keywords', 'succeeded', null)
  on conflict do nothing
`
```

> **Column/constraint check for the executor:** verify the exact column names + any NOT NULL/unique constraints on `performance_metric_daily`, `performance_search_keyword_monthly`, and `sync_checkpoint` from the migrations under `supabase/` (read-only) before running; adjust the insert column lists to match. Do NOT edit any migration — this is a `tests/**` seed only.

- [ ] **Step 2: Un-ignore the spec + enable the flags in `playwright.config.ts`**

Remove `"**/performance.spec.ts"` from the `testIgnore` array, and add to the web-server `env` block (next to the existing `GBP_*_ENABLED` flags):

```ts
GBP_PERFORMANCE_ENABLED: "true",
GBP_KEYWORDS_ENABLED: "true",
```

- [ ] **Step 3: Rewrite `tests/e2e/performance.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]

test.describe("performance", () => {
  test("exposes three tabs and defaults to reply performance", async ({ page }) => {
    await page.goto("/performance")
    await expect(page).toHaveURL("/performance")
    await expect(page.getByRole("heading", { name: "Performance", level: 1 })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Reply performance" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "Google performance" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Keywords" })).toBeVisible()
  })

  test("puts the active tab in the URL and restores it on reload", async ({ page }) => {
    await page.goto("/performance")
    await page.getByRole("tab", { name: "Keywords" }).click()
    await expect(page).toHaveURL(/[?&]tab=keywords/)
    await page.reload()
    await expect(page.getByRole("tab", { name: "Keywords" })).toHaveAttribute("aria-selected", "true")
  })

  test("reply performance shows KPI tiles, a prior-window delta, and the by-location table", async ({ page }) => {
    await page.goto("/performance")
    await expect(page.getByText("Reviews", { exact: true })).toBeVisible()
    await expect(page.getByText("Response rate")).toBeVisible()
    // Non-colour delta cue: an arrow glyph accompanies the magnitude.
    await expect(page.getByText(/[▲▼▬]\s*[+±−]/).first()).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
  })

  test("google performance renders humanised metric tiles (seeded ready)", async ({ page }) => {
    await page.goto("/performance?tab=google")
    await expect(page.getByText("Calls")).toBeVisible()
    await expect(page.getByText("Website clicks")).toBeVisible()
  })

  test("keywords tab shows honest 'N+' for a thresholded term (seeded ready)", async ({ page }) => {
    await page.goto("/performance?tab=keywords")
    await expect(page.getByText("riverside hotel bath")).toBeVisible()
    await expect(page.getByText("1,000+")).toBeVisible()
  })

  test("analytics redirects to performance", async ({ page }) => {
    await page.goto("/analytics")
    await expect(page).toHaveURL("/performance")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
      page.on("pageerror", (e) => pageErrors.push(e.message))
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/performance")
      await expect(page.getByRole("tab", { name: "Reply performance" })).toBeVisible()
      await page.getByRole("tab", { name: "Google performance" }).click()
      await page.getByRole("tab", { name: "Keywords" }).click()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/performance")
      await expect(page.getByRole("heading", { name: "Performance", level: 1 })).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
      expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} structure`).toEqual([])
    })
  }
})
```

> **Selector caution:** `getByText("Reviews", { exact: true })` may match both the KPI tile and a chart legend/table header — scope with a `getByRole`/`within` if Playwright reports strict-mode ambiguity. The delta-glyph regex assertion depends on a seeded prior window differing from the current one; if the seed yields `±0` for every KPI, assert the `±0` badge instead (still a non-colour cue). Tune against the real seed during implementation; never weaken to a bare visibility check that would pass with no delta rendered.

- [ ] **Step 4: Extend `tests/e2e/home.spec.ts`**

Add, inside the existing `test.describe("home", …)`:

```ts
test("renders the trends charts that cross-link to performance", async ({ page }) => {
  await page.goto("/home")
  await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible()
  const link = page.getByRole("link", { name: /See Performance/i }).first()
  await expect(link).toHaveAttribute("href", "/performance")
})

test("attention rows link to the location's low-rated reviews", async ({ page }) => {
  await page.goto("/home")
  const rows = page.getByRole("link", { name: /unresolved/ })
  if (await rows.count()) {
    await expect(rows.first()).toHaveAttribute("href", /\/inbox\?locationId=[^&]+&rating=1,2/)
  }
})
```

> The attention test is conditional because the seeded org may have zero unresolved complaints; when a row exists, its `href` must carry the low-rated filter. The existing KPI-label, `/overview→/home` redirect, and light/dark axe tests stay unchanged and must remain green.

- [ ] **Step 5: Add the per-location performance assertion to `tests/e2e/locations.spec.ts`**

```ts
test("location workspace exposes a Performance tab with review metrics", async ({ page, baseURL }) => {
  await page.goto("/locations")
  await page.getByRole("link", { name: /Linked location|Riverside|Stub/ }).first().click()
  await page.getByRole("link", { name: "Performance" }).click()
  await expect(page).toHaveURL(/\/locations\/[^/]+\/performance$/)
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Visibility on Google" })).toBeVisible()
})
```

> Match the location-link name to whatever `locations.spec.ts` / the stub bridge names the seeded location; reuse that spec's existing navigation helper if it has one.

- [ ] **Step 6: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: all unit + component suites green; production build green (`/home`, `/performance`, `/analytics`, `/locations/[id]/performance` all compile). E2e green: `foundation.spec.ts`, `home.spec.ts` (extended), `inbox.spec.ts`, `journeys.spec.ts`, `locations.spec.ts` (extended), `settings.spec.ts`, `connections-oauth.spec.ts`, and the newly un-ignored `performance.spec.ts` — including the zero-console-error + zero-pageerror guard and the best-practice structural axe rules on `/performance` in both light and dark. Integration (the parity oracle) green and **untouched** — M7 added no route/service/schema, so no integration test changes. Confirm `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` is EMPTY. Fix any failure in the product/spec, never by weakening an assertion. Paste every summary line into the report.

- [ ] **Step 7: Whole-branch review (two passes) + one fix wave**

Run a whole-branch review with a dedicated pass on (a) the ZERO-protected-footprint claim (the `git diff --stat` over the protected paths must be empty), and (b) honesty: no raw metric enum / `last_error_code` / env-flag name / error code reaches the DOM, nulls render as "—" (never 0), and every chart colour resolves to a `--chart-N` token (no raw hex in `components/**`). Fix findings in one wave; re-run the gate.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/performance.spec.ts tests/e2e/home.spec.ts tests/e2e/locations.spec.ts tests/e2e/helpers/stub-bridge.ts playwright.config.ts
git commit -m "test(reporting): milestone e2e (performance tabs, deltas, divergence, per-location) + gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 7 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- E2e green: `foundation.spec.ts`, `home.spec.ts` (extended), `inbox.spec.ts`, `journeys.spec.ts`, `locations.spec.ts` (extended with the per-location Performance tab), `settings.spec.ts`, `connections-oauth.spec.ts`, and the newly un-ignored `performance.spec.ts` — including the zero-console-error + zero-pageerror guard and the best-practice structural axe rules on `/performance` in **both** light and dark, the URL tab-sync + reload-restore, the reply-tab KPI + non-colour delta + by-location table, the seeded "ready" Google-performance + keywords tabs, and the `/analytics → /performance` redirect.
- Integration suite green (the parity oracle) and **byte-untouched** — M7 added no route, service, schema, or migration, so every existing integration test stays green with no edit. `RUN_DB_TESTS=true`, Postgres via `naba_test_runtime`. No integration test moved.
- **Protected-path discipline (the M7 headline — D11):** `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` is **EMPTY**. M7 is the first milestone with ZERO sanctioned protected-path edits — every reporting read is `requireSession` (role-open, location-scoped server-side) and the sync POSTs already exist, so no capability, route, or service needed to change. `lib/domain/google-contract.ts` / `lib/domain/workflow.ts` are imported const/type-only (consumption). Everything M7 created lives under `lib/format/**`, `lib/reporting/**`, `lib/api/**`, `lib/queries/**`, `components/**`, `app/(dashboard)/**`, and `tests/**`.
- Every M7-scoped spec obligation closed (spec §8 "Home / Performance"), clause by clause:
  - **Home KPIs derive from the counts endpoint (never a page of reviews)** — `KpiCards` reads `useReviewCounts` for totals/needs-attention and `useAnalyticsOverview.summary` for rating/response/response-time; no review page is fetched (Task 3).
  - **Attention list rows link to the location's low-rated reviews** — `/inbox?locationId=<id>&rating=1,2` (the real inbox URL contract), skeleton widened 3→5 (Task 3).
  - **Chart cards cross-link to Performance** — Home `HomeCharts` "See Performance" links + `/performance` reply-tab charts (Tasks 3–4).
  - **Performance tab in the URL** — Base UI `Tabs` synced to `?tab=` with reload-restore (Task 4, D12).
  - **Prior-window deltas with non-colour cues** — `DeltaBadge` (arrow glyph + signed magnitude + aria wording, no red/green) fed by a second, equal-length prior-window overview query (Tasks 2, 4).
  - **The `providerTotals.divergence` trust banner** — `DivergenceBanner` renders only when `divergence === true`, on Home and the reply tab (Tasks 3–4, D4).
  - **Zero-filled axes with integer ticks** — the server zero-fills the series; `ReportingLineChart`/`ReportingBarChart` set `allowDecimals={false}` (Task 2, D2).
  - **`nulls last` location table with honest null styling** — `ReplyLocationsTable` orders nulls last and renders muted "—" via `nullableCell` (Tasks 2, 4).
  - **Fetched-at captions** — `FetchedAtCaption` from `overview.to` / `presence.freshThrough` (Tasks 2, 4, 5).
  - **Loading / null / error visually distinct** — `ChartCard` state slots + `ReportingPanel` variants (loading / empty / error / paused / off), each a distinct honest surface (Tasks 2, 5, 6).
- The three range vocabularies are per-tab selectors (reply from/to+granularity; Google 28d/90d/12m/18m; keywords 1m/6m/12m/18m) — D6.
- Humanisation complete (§7, D7): the 11 metric enums → human labels; raw `last_error_code` → human copy with a safe fallback; thresholded keyword volumes → honest "N+". No raw enum / code / env-flag name / byte count reaches the DOM.
- The `formatDuration` negative (clock-skew) guard is in place before any response-time cell renders (D3).
- No new dependency added — recharts@3.8.0 was already in `package.json`; the only new primitive (`Chart`) wraps it with M1 `--chart-1..5` tokens.
- Whole-branch review complete with a dedicated ZERO-protected-footprint + honesty pass; findings fixed in one wave.

## Self-review (run before merge; fix inline)

- **Spec coverage.** §4 redirect → Task 4 (`/analytics → /performance`, mirroring the `/overview → /home` precedent). §5 rendering model — client-fetched pages with route-level `loading.tsx`; server-hydration deviation documented (D1) and carried forward, noting that (unlike Locations/Settings) NO `lib/server` analytics service exists yet, so the retrofit is net-new protected work for M9. §6 data layer — one QueryClient; the existing `queryKeys.analytics(kind, params)` (= `['analytics', kind, range]`) and `queryKeys.reviewCounts(scope)` (= `['review-counts', scope]`) reused WITHOUT a keys edit; typed client via `apiFetch`/`ApiClientError`; `staleTime: 30s` on every hook. §7 content — one formatter set (`lib/format`, incl. the new `formatDelta`/`formatDuration` guard); humanised enums + reasons + honest "N+" via one `lib/reporting` mapping layer; no env-flag names / codes / byte counts shown; keyword text carries `dir="auto"`. §8 Home/Performance paragraph — every clause mapped to a task (see exit criteria). §9 testing — loading/error/empty/paused/off + mutation-failure (refresh) component tests per surface; e2e per-tab clean-load in both themes, URL tab-sync, delta + divergence + nulls-last, seeded ready Google/keywords, redirect, and the per-location tab; parity oracle stays green untouched. No M7-scoped requirement is left without a task.
- **Placeholder scan.** No "TBD"/"similar to Task N"/"add error handling"/bare "write tests". Every code step carries real code; each non-trivial component (chart wrapper, stat tile, delta badge, reporting states, divergence banner, home charts, performance view, range select, reply tab + locations table, Google tab + refresh button, keywords tab, per-location assembly) ships a pinned test + a reference implementation. Shared blocks (`ChartCard`, `StatTile`, `DeltaBadge`, `ReportingPanel`, `nullableCell`, `DivergenceBanner`, `RangeSelect`, `RefreshGoogleButton`, the `lib/reporting` + `lib/format` helpers) are implemented once (Tasks 1–2/4/5) and imported by name thereafter. The two forward-reference stubs (`GooglePerformanceTab`/`KeywordsTab` land as one-line loading stubs in Task 4, replaced in Tasks 5/6) are called out explicitly with their intended resolution. The client session accessor (`useSession`/`useSessionRole`, `lib/api/session.ts` + `lib/queries/use-session.ts`) is a REAL, tested module added in Task 1 (REV-1) — there is no client session hook in the app today (role is server-prop-threaded), so this is a genuine new file, not a "wire it later" placeholder. No task imports a nonexistent module.
- **Type consistency.** `AnalyticsOverview`/`AnalyticsSummary`/`AnalyticsSeriesPoint`/`AnalyticsLocation`/`ProviderTotals` (Task 1) are the exact names Tasks 3/4/7 import. `PresenceResponse`/`PresenceStatus` and `KeywordsResponse`/`KeywordRow` (Task 1) match Tasks 5/6/7. `ReplyRangeId` + `resolveReplyRange` + `REPLY_RANGES`/`PRESENCE_RANGES`/`KEYWORD_RANGES` (Task 1) match every `RangeSelect` and tab consumer. `metricLabel`/`ORDERED_METRICS`/`IMPRESSION_METRICS` (Task 1) match Tasks 5/7. `humaniseUnavailableReasons` (Task 1) matches Tasks 5/6/7. `formatKeywordImpressions` (Task 1) matches Tasks 6/7. `canTriggerSync` (Task 1) matches `RefreshGoogleButton` (Task 5). `useAnalyticsOverview(params?)`/`useAnalyticsPresence({range,locationId})`/`useAnalyticsKeywords({range,locationId})` names match producer and consumer, and `useReviewCounts`/`useAnalyticsOverview` keep their M3 names. `ChartCard`/`ReportingLineChart`/`ReportingBarChart`/`ChartLegend` prop shapes (incl. the `colorVar: 1|2|3|4|5` → `var(--chart-N)` mapping) are identical across Home, reply, Google, and per-location consumers. `StatTile`/`DeltaBadge`/`FetchedAtCaption`/`ReportingPanel`/`nullableCell` props match all reuse sites. The three tab labels ("Reply performance" / "Google performance" / "Keywords") and the `<h1>` "Performance" match the `performance.spec.ts` assertions exactly; the Home KPI labels ("Total reviews" / "Needs attention" / "Average rating" / "Response rate") match `home.spec.ts` exactly.
- **Parity-oracle safety.** M7 adds NO route, service, schema, or migration — every file is a client-safe schema, client, hook, component, page, or test under `lib/format`/`lib/reporting`/`lib/api`/`lib/queries`/`components/**`/`app/(dashboard)/**`/`tests/**`. The widened `lib/api/analytics.ts` schema is a client-side superset (zod parses the endpoint's full body it previously stripped); the endpoint itself is unchanged. No integration test is touched or moved. The e2e stub-bridge seed and the two Playwright web-server flags live under `tests/**` / `playwright.config.ts` (non-protected).
- **Protected-path footprint.** `git diff --stat main -- app/api lib/server lib/domain supabase scripts instrumentation.ts` must be **EMPTY**. Confirm no accidental edit to any analytics/sync/counts route, and that the `lib/domain` imports are const/type-only. This zero-footprint result is a hard exit criterion (D11), not an aspiration.
- **Decisions made BEYOND the surface map / spec (flagged for controller review):**
  - (a) **Client-fetch for M7, server-hydration deferred to M9 (D1).** Unlike M5/M6 (whose `lib/server` services already existed, making a later additive RSC-prefetch retrofit cheap), the four analytics routes compute inline with no extractable service, so byte-parity server-hydration is net-new *protected* work. Consolidating it into M9's full-parity pass keeps M7's footprint at ZERO protected edits. **Controller decision to confirm:** accept client-fetch for M7, or pull the `lib/server/analytics.*` extraction (a protected edit-set) into M7 now.
  - (b) **Per-location review metrics via a client-side `overview.locations[]` filter (D5),** because the overview endpoint has no `locationId` param. This keeps M7 at zero protected edits; the one behavioural cost is that a location with zero in-window reviews is absent from `overview.locations` (inner join), rendered as an honest "no review activity" panel. **Controller decision to confirm:** accept the client filter, or add a `locationId` param to the overview route (a protected edit) for a dedicated per-location summary.
  - (c) **Performance tabs are in-page URL-synced Base UI `Tabs` (`?tab=`), not route segments (D12)** — matches the pre-existing `performance.spec.ts` (all tabs `role="tab"` on one page) and spec §8's "Performance tab in the URL". The per-location performance tab IS a route segment, consistent with the Locations workspace model.
  - (d) **Charts via recharts themed to `--chart-1..5` (D2)** rather than a table-only fallback — the chart tokens already exist in `app/globals.css` (identical light/dark, decorative-exempt), so token-only theming is straightforward and the charts-vs-table risk does not materialise.
  - (e) **The "Refresh Google data" gate reads the session role via a `useSessionRole` accessor ADDED in Task 1 (REV-1)** — the app has no client session hook today (role is server-prop-threaded), so Task 1 adds `lib/api/session.ts` + `lib/queries/use-session.ts` reading `GET /api/session`; `canTriggerSync` restricts to owner/admin, mirroring the sync routes' `requireRole(["owner","admin"])`. The button is a client convenience over an already-authorised route; the server remains the authority (a member who forged a POST still gets 403).
  - (f) **Keywords kept a separate task (T6), not merged into T5** — its `503 keywords_paused`-before-parse behaviour, distinct response shape, and honest "N+" presentation are worth an independent pinned test; the cost is one extra small task.
- **Carry-forwards recorded for later milestones:**
  - **Server-hydrated/dehydrated reporting** (spec §5 prefetch) — DEFERRED to M9; requires first extracting `lib/server/analytics.*` from the four inline route handlers (a protected edit-set), then seeding the SAME `analytics(kind, params)` / `reviewCounts(scope)` Query keys additively (D1).
  - **A per-location overview summary object** — today derived by filtering `overview.locations[]`; a future `GET /api/analytics/overview?locationId=` (protected) would give an exact per-location summary incl. the zero-review case. Flag to the controller (see decision (b)).
  - **Response-time p95 / latest-edit medians** — the widened schema carries `p95FirstResponseSeconds` / `medianLatestEditSeconds`; M7 surfaces the median first-response prominently and leaves p95/latest-edit for a later reporting-depth pass (they are available to any card that wants them).
  - **Presence day-key timezone** — presence returns already-org-local `YYYY-MM-DD` day keys; captions render them as-is (`formatDate(iso, "UTC")` to avoid re-shifting). If the org tz should be echoed in the caption text, thread `overview.timezone` through — a cosmetic later polish.
- **Discrepancies found vs the brief (CODE wins — encoded above):**
  - The overview route has **no `range` enum and no `locationId` param** — it speaks `from`/`to`/`granularity` and is org-wide. The reply-tab range selector therefore resolves presets to `from`/`to`/`granularity` (`lib/reporting/ranges.ts`), and the per-location tab filters `overview.locations[]` (D5). The spec's `['analytics', kind, range]` key is satisfied by the existing `queryKeys.analytics(kind, params)` with a range-descriptor `params`.
  - **presence does NOT 503 when ingestion is off** — it returns `ingestionEnabled: false` in the body (only keywords 503s, as `keywords_paused`, before parsing). So the Google tab reads `ingestionEnabled` for its "off" panel; only the keywords tab maps a 503 code (Tasks 5/6, D9).
  - **`providerTotals` returns `{ averageRating, totalReviewCount, localReviewCount, divergence }`** — `localAverageRating` is computed server-side for the divergence test but NOT returned; the banner keys only on `divergence` (D4), no raw numbers shown.
  - **`queryKeys.analytics(kind, params)` and `queryKeys.reviewCounts(scope)` already exist** in `lib/queries/keys.ts` — no keys edit is needed (the brief's "keys" work is a no-op beyond reuse).
  - **The `/analytics` redirect lives at `app/(dashboard)/analytics/page.tsx`** (mirroring the existing `/overview` redirect inside the dashboard group), not the brief's `app/analytics/page.tsx` — CODE precedent wins (D10).
  - **`review-counts.ts` needs no widening** — its `z.record(z.string(), z.number())` already parses the full `byStatus`; it is reused as-is (the brief listed it among "reusable patterns", not "widen").
  - **`performance.spec.ts` is currently in `playwright.config.ts` `testIgnore`** and the e2e web server does NOT set `GBP_PERFORMANCE_ENABLED`/`GBP_KEYWORDS_ENABLED` — Task 8 un-ignores the spec and enables both flags (Google-call-safe: the reads never call Google; the sync POSTs are stubbed).

## Execution handoff

Plan complete and saved to `docs/archive/2026-07-frontend-rebuild/plans/2026-08-02-frontend-rebuild-m7-reporting.md`. Two execution options:

1. **Subagent-Driven (recommended)** — use `superpowers:subagent-driven-development`: dispatch each task to a fresh implementer subagent in dependency order (1 → 2 → {3, 4} → {5, 6} → 7 → 8), review each task's diff + gate output before starting the next, and keep the whole-branch review for the end.
2. **Inline Execution** — use `superpowers:executing-plans`: work the tasks top-to-bottom in this session, gating green before each commit.

Which approach?


