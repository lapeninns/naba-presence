# M3 Shell + Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Home with a baseline organisation roll-up — a Google-disconnected banner, a four-KPI row derived from the counts and analytics endpoints, and a needs-attention location list — and finish the shell's per-route prefetch plus the `/overview → /home` legacy redirect, all on the M1 foundation with loading / empty(zero) / error states each visually distinct and tested.

**Architecture:** Home is a client-fetched dashboard: a synchronous server page renders the shared `PageFrame`/`PageHeader` and three self-contained client components (disconnected banner, KPI row, attention list). Each reads a TanStack Query hook over the M1 typed API client (`apiFetch` + zod) and owns its own loading/empty/error rendering (spec §8). There is no server-side prefetch/dehydration this milestone: the counts and analytics logic live in route handlers and extracting `lib/server` services would touch protected paths, so route-level Suspense stays the existing `app/(dashboard)/loading.tsx` and per-source loading is handled in-component.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives, TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m3-shell-home` (cut from `main`). Delivery model is **per-milestone merge to `main`** (spec §10, amended after M1). `main` therefore serves a partially-rebuilt product: the four non-`/home` sidebar links still 404 until their milestones land.
- **No new dependencies** in this milestone. `recharts` is already a dependency (3.8.0) but stays **UNUSED** this milestone — M3 builds no chart.
- Protected paths — do NOT touch: `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. **Consume only, never modify.** M3 makes **zero** sanctioned protected-path edits (unlike M2's Task 2); every file under those paths stays byte-identical.
- Styling: M1 tokens only. No raw hex, no `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N`. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`).
- Data layer: all reads go through the M1 typed client (`apiFetch` + a zod `schema`, mirroring `lib/api/connections.ts`). TanStack Query hooks carry `staleTime: 30s` (spec §6) and reuse the reserved `queryKeys.reviewCounts`/`queryKeys.analytics` factories.
- Copy: GB English, sentence case, no internal jargon, no env-flag names, no error codes shown to users.
- Every page renders exactly one `<h1>` and exactly one `<main>` (both owned by `PageFrame`/`PageHeader`; feature components add only `<h2>` and below).
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `git show 4391dcb:<path>` retrieves any pre-rebuild file for visual reference (that commit is the last before the rebuild deletion). Reference the look; do not re-admit the code. The pre-rebuild Home lived at `git show 9e70fee:components/naba-presence/home-view.tsx` (use for information architecture only).
- **M3 ships BASELINE Home only — no charts, no recharts, no prior-window deltas, no non-colour delta cues, no `providerTotals.divergence` trust banner, no zero-filled/integer-tick axes, no nulls-last table styling, no fetched-at caption polish (all deferred to M7). M3 builds NO chart primitive.**
- **How the two data-driven components are specified:** `KpiCards` and `AttentionList`/`DisconnectedBanner` ship with a numbered behavioural contract **plus** a complete test file that pins every label, state, and transition verbatim, **plus** a concrete reference implementation. Where the contract names a string, use it exactly; where it names a state, model it explicitly. If the reference implementation and a pinned test ever disagree, the test wins.

## Design decisions (LOCKED — encode exactly)

- **D1 — Scope line.** M3 = baseline Home + minor shell. DEFERRED TO M7: all charting/recharts, prior-window deltas, non-colour delta cues, the `providerTotals.divergence` trust banner, zero-filled/integer-tick axes, nulls-last table styling, fetched-at caption polish. M3 builds no chart primitive.
- **D2 — Home content.** `PageHeader` + Google-disconnected banner + a 4-card KPI row + a needs-attention location list. Nothing else. No charts, no Performance cross-link (the spec §8 "chart cards cross-link to Performance" clause is entirely M7 because there are no chart cards in M3).
- **D3 — KPI cards (4), exact labels.** "Total reviews" (`reviews/counts` `.total`, via `formatNumber`); "Needs attention" (see D4); "Average rating" (`analytics/overview` `.summary.averageRating`, 1-dp, `—` when null); "Response rate" (`.summary.responseRate`, via `formatPercent`, `—` when null). The legacy `home.spec.ts` pins the exact strings "Average rating" and "Response rate" — render those verbatim.
- **D4 — Needs-attention count** = sum of `reviews/counts` `.byStatus` for the states `{ new, escalated, failed }`. This set lives in a named constant `NEEDS_ATTENTION_STATES` with a comment noting it is a defensible baseline the owner/M4 may refine. Per spec §8 this count derives from the counts endpoint, never a page of reviews.
- **D5 — Attention list.** From `analytics/overview` `.locations[]`, sorted by `unresolvedComplaints` desc, top 5, each row shows the location name + its unresolved count and LINKS to `/inbox?locationId=<id>`. This establishes a contract **M4 must honour**: the inbox route accepts `?locationId=<id>` (and later a low-rating filter). The link 404s until M4 — the accepted per-milestone precedent. **Extension flagged for controller review:** rows are filtered to `unresolvedComplaints > 0` before the top-5 slice, so a "Needs attention" list never shows a location that has nothing to attend to (matches the pre-rebuild behaviour and the section's meaning); when none qualify the honest empty state renders. D5 as locked said "top 5 by desc" without a filter — the `> 0` filter is the one deliberate refinement here.
- **D6 — Disconnected banner.** When connection health resolves to `disconnected` (reuse `useConnectionHealth()` / `queryKeys.connections`), render `Alert variant="destructive"` with GB-English copy stating Google is not connected + guidance, and a "Manage connection" link → `/settings/connections`. The target 404s until M6 (accepted).
- **D7 — Shell prefetch.** Add a per-item `prefetch: boolean` field to `NAV_ITEMS` in `components/app-shell/nav.tsx`; enable prefetch for the `/home` item only; the other four stay `prefetch={false}`. Closes the M1 carry-forward "nav prefetch re-enable per route" for `/home`.
- **D8 — Legacy redirect.** Add `app/(dashboard)/overview/page.tsx` as a short server redirect `/overview → /home`; revive the `home.spec.ts` redirect assertion.
- **D9 — States.** Loading (Skeleton + `aria-busy`), populated, honest empty/zero (distinct copy: `—` for null metrics, "No locations need attention right now." for an empty list), and error (retry affordance) are all VISUALLY DISTINCT (spec §8) and each covered by a component test.
- **D10 — Data hooks.** New `lib/queries/use-analytics-overview.ts` and `lib/queries/use-review-counts.ts` reuse the reserved `queryKeys.analytics`/`queryKeys.reviewCounts` factories, set `staleTime: 30s`, and mirror `use-connection-health.ts`.
- **D11 — Milestone e2e.** Revive `tests/e2e/home.spec.ts` (remove from `playwright.config.ts` `testIgnore`), adapt it to the real Home; ADD a zero-console-error + zero-pageerror guard on `/home` in BOTH light and dark (the project's hard-won hydration lesson — jsdom and `pnpm build` cannot see hydration/nesting errors); run the axe WCAG + best-practice structural rules already scaffolded in `foundation.spec.ts`. `foundation.spec.ts` needs no edit — none of its assertions reference the placeholder body (verified); its `/home` axe + structure checks now simply cover the real Home.
- **D12 — Out of scope for M3 (stated explicitly).** The T6 triple-duplicated "Go to sign in" link in `invitation-view.tsx` is DEFERRED to M9 (unrelated to Shell/Home). `formatDuration`'s negative-input guard stays M7 — and Home's baseline does **not** reuse `formatDuration` (no response-time KPI this milestone), so the guard is not exercised here. The `ShellSession` capabilities extension stays open (first needed in M4).

## File structure

```
components/app-shell/
  nav.tsx                          MODIFY: per-item prefetch on NAV_ITEMS; enable /home only
components/home/                   NEW feature folder
  kpi-cards.tsx                    client: 4-KPI row (counts + analytics), loading/empty/error
  attention-list.tsx              client: needs-attention locations, loading/empty/error
  disconnected-banner.tsx         client: destructive Alert when Google is disconnected
lib/api/
  review-counts.ts                NEW: zod schema + fetchReviewCounts() over apiFetch
  analytics.ts                    NEW: zod schema + fetchAnalyticsOverview() over apiFetch
lib/queries/
  use-review-counts.ts            NEW: useQuery on queryKeys.reviewCounts, staleTime 30s
  use-analytics-overview.ts       NEW: useQuery on queryKeys.analytics, staleTime 30s
app/(dashboard)/
  home/page.tsx                   MODIFY: assemble banner + KPIs + attention list
  overview/page.tsx               NEW: 3-line server redirect /overview -> /home
playwright.config.ts              MODIFY: remove home.spec.ts from testIgnore
tests/components/
  nav.test.tsx                    NEW (T1)
  home-api.test.tsx               NEW (T2)
  home-queries.test.tsx           NEW (T3)
  kpi-cards.test.tsx              NEW (T4)
  attention-list.test.tsx         NEW (T5)
  disconnected-banner.test.tsx    NEW (T5)
  overview-redirect.test.tsx      NEW (T6)
tests/e2e/
  home.spec.ts                    REVIVE + adapt (T7)
```

Backend response shapes consumed (READ-ONLY — never modify):
- `GET /api/reviews/counts` → `{ total: number, byStatus: Record<ReviewWorkflowState, number> }` where states are `new|drafted|verified|awaiting_approval|publish_requested|published|rejected|failed|escalated` (`lib/domain/workflow.ts`). Role-scoped server-side.
- `GET /api/analytics/overview` → `{ from, to, timezone, summary:{ averageRating: number|null, responseRate: number|null, ... }, series:[...], locations:[{ id, name, unresolvedComplaints, ... }], providerTotals:{ divergence, ... } }`. Role-scoped; a member with no locations gets an honest empty result (nulls + `[]`), which Home must render honestly.

---

### Task 1: Shell — per-route prefetch on NAV_ITEMS

**Files:**
- Modify: `components/app-shell/nav.tsx`
- Test: `tests/components/nav.test.tsx`

**Interfaces:**
- Consumes: `usePathname` (`next/navigation`), `Link` (`next/link`), `cn` from `@/lib/utils`.
- Produces (later tasks / shell rely on this): each `NAV_ITEMS` entry gains `prefetch: boolean`; `<Link prefetch={item.prefetch}>`. `/home` prefetches (`true`); `/inbox`, `/locations`, `/performance`, `/settings` stay `false`. `NAV_ITEMS` and `Nav` exports unchanged in name.

- [ ] **Step 1: Write the failing test**

`tests/components/nav.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { Nav, NAV_ITEMS } from "@/components/app-shell/nav"

describe("primary nav prefetch policy", () => {
  it("prefetches only the Home route", () => {
    render(<Nav />)
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "data-prefetch",
      "true"
    )
    for (const label of ["Inbox", "Locations", "Performance", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "data-prefetch",
        "false"
      )
    }
  })

  it("encodes the per-item prefetch flag in NAV_ITEMS", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/home")?.prefetch).toBe(true)
    for (const item of NAV_ITEMS.filter((item) => item.href !== "/home")) {
      expect(item.prefetch).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/nav.test.tsx --project components`
Expected: FAIL — `item.prefetch` is `undefined`, so `data-prefetch="undefined"` and the `NAV_ITEMS` assertions fail.

- [ ] **Step 3: Implement**

In `components/app-shell/nav.tsx`, add `prefetch` to every item and read it on the `<Link>`. Replace the `NAV_ITEMS` array and the current `prefetch={false}` line:

```tsx
const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: LayoutDashboard, prefetch: true },
  { href: "/inbox", label: "Inbox", icon: Inbox, prefetch: false },
  { href: "/locations", label: "Locations", icon: Store, prefetch: false },
  { href: "/performance", label: "Performance", icon: TrendingUp, prefetch: false },
  { href: "/settings", label: "Settings", icon: Settings, prefetch: false },
] as const
```

Replace the block comment above the `<Link>` and the `prefetch={false}` prop with:

```tsx
              {/* /home ships this milestone and is prefetched. The other four
                  routes 404 until their milestones land; Next's default
                  viewport prefetch would fire a background RSC request for
                  each on every dashboard load, and Chrome's real channel
                  (local test/dev) never reports network-idle while a 404
                  prefetch is outstanding - so they stay prefetch={false}
                  until their pages exist. */}
              <Link
                href={item.href}
                prefetch={item.prefetch}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-(--nr-radius-control) px-3 py-2 text-ui font-medium text-sidebar-foreground/75 transition-colors duration-(--nr-duration-fast)",
                  "focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
```

Leave everything else in the file (imports, `isActivePath`, the `<Icon>` + label, exports) untouched.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/nav.test.tsx tests/components/app-shell.test.tsx --project components`
Expected: PASS. `app-shell.test.tsx` must stay green — it renders `Nav` through the real `next/link` (prefetch is a runtime-only prop, invisible in jsdom) and asserts `aria-current` only.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/app-shell/nav.tsx tests/components/nav.test.tsx
git commit -m "feat: per-route nav prefetch, enabled for /home only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Typed API clients for review counts and analytics overview

**Files:**
- Create: `lib/api/review-counts.ts`, `lib/api/analytics.ts`
- Test: `tests/components/home-api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` from `@/lib/api/client`; `z` from `zod`.
- Produces (Task 3 consumes these EXACT signatures):
  - `reviewCountsSchema`; `type ReviewCounts = { total: number; byStatus: Record<string, number> }`; `fetchReviewCounts(): Promise<ReviewCounts>` → `GET /api/reviews/counts`.
  - `analyticsSummarySchema`, `analyticsLocationSchema`, `analyticsOverviewSchema`; `type AnalyticsOverview = { timezone: string; summary: { averageRating: number | null; responseRate: number | null }; locations: { id: string; name: string; unresolvedComplaints: number }[] }`; `type AnalyticsLocation`; `fetchAnalyticsOverview(): Promise<AnalyticsOverview>` → `GET /api/analytics/overview`.
  - The overview schema deliberately validates only the fields Home consumes; zod's default object strip drops the endpoint's other fields (`series`, `providerTotals`, `from`, `to`, `reviewVolume`, per-location rates) without error.

- [ ] **Step 1: Write the failing tests**

`tests/components/home-api.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { fetchReviewCounts } from "@/lib/api/review-counts"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("fetchReviewCounts", () => {
  it("returns total and byStatus from the counts endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        total: 5,
        byStatus: { new: 2, drafted: 1, escalated: 1, failed: 1 },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const counts = await fetchReviewCounts()
    expect(counts.total).toBe(5)
    expect(counts.byStatus.new).toBe(2)
    expect(counts.byStatus.escalated).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts",
      expect.anything()
    )
  })

  it("throws malformed_response when the shape is wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ total: "five", byStatus: {} }))
    )
    await expect(fetchReviewCounts()).rejects.toMatchObject({
      code: "malformed_response",
    })
  })
})

describe("fetchAnalyticsOverview", () => {
  it("keeps the fields Home consumes and tolerates the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-07-31T00:00:00.000Z",
          timezone: "Europe/London",
          summary: {
            reviewVolume: 12,
            averageRating: 4.27,
            responseRate: 83.3,
            unresolvedComplaints: 4,
            medianFirstResponseSeconds: 3600,
          },
          series: [
            { period: "2026-07-01", reviewCount: 1, reviews: 1, replies: 0, averageRating: 5 },
          ],
          locations: [
            { id: "loc-1", name: "Riverside", reviews: 8, averageRating: 4.1, responseRate: 75, unresolvedComplaints: 3 },
            { id: "loc-2", name: "Old Town", reviews: 4, averageRating: 4.6, responseRate: 100, unresolvedComplaints: 0 },
          ],
          providerTotals: { averageRating: 4.3, totalReviewCount: 20, localReviewCount: 12, divergence: false },
        })
      )
    )
    const overview = await fetchAnalyticsOverview()
    expect(overview.timezone).toBe("Europe/London")
    expect(overview.summary.averageRating).toBe(4.27)
    expect(overview.summary.responseRate).toBe(83.3)
    expect(overview.locations).toHaveLength(2)
    expect(overview.locations[0]).toEqual({
      id: "loc-1",
      name: "Riverside",
      unresolvedComplaints: 3,
    })
  })

  it("accepts null summary metrics for an org with no reviews", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          timezone: "UTC",
          summary: { averageRating: null, responseRate: null },
          locations: [],
        })
      )
    )
    const overview = await fetchAnalyticsOverview()
    expect(overview.summary.averageRating).toBeNull()
    expect(overview.summary.responseRate).toBeNull()
    expect(overview.locations).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/home-api.test.tsx --project components`
Expected: FAIL — `@/lib/api/review-counts` and `@/lib/api/analytics` not found.

- [ ] **Step 3: Implement the two clients**

`lib/api/review-counts.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
})

export type ReviewCounts = z.infer<typeof reviewCountsSchema>

export function fetchReviewCounts() {
  return apiFetch("/api/reviews/counts", { schema: reviewCountsSchema })
}
```

`lib/api/analytics.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const analyticsSummarySchema = z.object({
  averageRating: z.number().nullable(),
  responseRate: z.number().nullable(),
})

export const analyticsLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  unresolvedComplaints: z.number(),
})

// Only the fields Home reads are validated; zod strips the endpoint's other
// keys (series, providerTotals, from/to, per-location rates) without error.
export const analyticsOverviewSchema = z.object({
  timezone: z.string(),
  summary: analyticsSummarySchema,
  locations: z.array(analyticsLocationSchema),
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type AnalyticsLocation = z.infer<typeof analyticsLocationSchema>
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

export function fetchAnalyticsOverview() {
  return apiFetch("/api/analytics/overview", {
    schema: analyticsOverviewSchema,
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/home-api.test.tsx --project components`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/api/review-counts.ts lib/api/analytics.ts tests/components/home-api.test.tsx
git commit -m "feat: typed clients for review counts and analytics overview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Query hooks for review counts and analytics overview

**Files:**
- Create: `lib/queries/use-review-counts.ts`, `lib/queries/use-analytics-overview.ts`
- Test: `tests/components/home-queries.test.tsx`

**Interfaces:**
- Consumes: `useQuery` (`@tanstack/react-query`); `fetchReviewCounts`/`ReviewCounts`, `fetchAnalyticsOverview`/`AnalyticsOverview` (Task 2); `queryKeys` from `@/lib/queries/keys`.
- Produces (Tasks 4–5 consume):
  - `useReviewCounts(): UseQueryResult<ReviewCounts>` — key `queryKeys.reviewCounts("organisation")`, `staleTime: 30_000`.
  - `useAnalyticsOverview(): UseQueryResult<AnalyticsOverview>` — key `queryKeys.analytics("overview", { window: "last-30-days" })`, `staleTime: 30_000`.

- [ ] **Step 1: Write the failing tests**

`tests/components/home-queries.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useReviewCounts", () => {
  it("fetches the counts endpoint and caches under the reserved key", async () => {
    const body = { total: 7, byStatus: { new: 3, escalated: 1, failed: 1, published: 2 } }
    const fetchMock = vi.fn(async () => jsonResponse(body))
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useReviewCounts(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts",
      expect.anything()
    )
    expect(client.getQueryData(queryKeys.reviewCounts("organisation"))).toEqual(
      body
    )
  })
})

describe("useAnalyticsOverview", () => {
  it("fetches the overview endpoint and caches under the reserved analytics key", async () => {
    const body = {
      timezone: "Europe/London",
      summary: { averageRating: 4.2, responseRate: 80 },
      locations: [{ id: "loc-1", name: "Riverside", unresolvedComplaints: 2 }],
    }
    const fetchMock = vi.fn(async () => jsonResponse(body))
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/overview",
      expect.anything()
    )
    expect(
      client.getQueryData(
        queryKeys.analytics("overview", { window: "last-30-days" })
      )
    ).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/home-queries.test.tsx --project components`
Expected: FAIL — the two hook modules do not exist yet.

- [ ] **Step 3: Implement the two hooks**

`lib/queries/use-review-counts.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"

export function useReviewCounts() {
  return useQuery({
    queryKey: queryKeys.reviewCounts("organisation"),
    queryFn: () => fetchReviewCounts(),
    staleTime: 30_000,
  })
}
```

`lib/queries/use-analytics-overview.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { queryKeys } from "./keys"

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: queryKeys.analytics("overview", { window: "last-30-days" }),
    queryFn: () => fetchAnalyticsOverview(),
    staleTime: 30_000,
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/home-queries.test.tsx --project components`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/queries/use-review-counts.ts lib/queries/use-analytics-overview.ts tests/components/home-queries.test.tsx
git commit -m "feat: review-counts and analytics-overview query hooks (staleTime 30s)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Home KPI cards

**Files:**
- Create: `components/home/kpi-cards.tsx`
- Test: `tests/components/kpi-cards.test.tsx`

**Interfaces:**
- Consumes: `useReviewCounts`/`ReviewCounts` (Task 3/2), `useAnalyticsOverview`/`AnalyticsOverview` (Task 3/2); `Card`/`CardContent` from `@/components/ui/card`; `Alert`/`AlertTitle`/`AlertDescription` from `@/components/ui/alert`; `Button` from `@/components/ui/button`; `Skeleton` from `@/components/ui/skeleton`; `formatNumber`, `formatPercent` from `@/lib/format`.
- Produces (Task 7 consumes): `KpiCards()` component; exported constant `NEEDS_ATTENTION_STATES`.

**Behavioural contract (the pinned test below is the specification):**
1. Reads `useReviewCounts()` and `useAnalyticsOverview()`.
2. `NEEDS_ATTENTION_STATES = ["new", "escalated", "failed"] as const`, carrying the D4 comment that it is a defensible baseline the owner/M4 may refine.
3. **Loading** — if either query `isPending`: a single `<div aria-busy="true">` grid of four `Skeleton` cards. No KPI labels are rendered.
4. **Error** — else if either query `isError`: an `Alert variant="destructive"` titled `We could not load your Home summary.` with a `Button` `Try again` that calls BOTH `refetch()`s.
5. **Populated / zero** — else four `Card`s, each a label `<p>` + a value `<p>`:
   - `Total reviews` → `formatNumber(counts.data.total)`.
   - `Needs attention` → `formatNumber(sum of counts.data.byStatus[state] for state in NEEDS_ATTENTION_STATES, missing = 0)`.
   - `Average rating` → `summary.averageRating === null ? "—" : summary.averageRating.toFixed(1)`.
   - `Response rate` → `summary.responseRate === null ? "—" : formatPercent(summary.responseRate)`.
   The zero/empty case is this same branch with `total` 0 and null metrics → renders `0`, `0`, `—`, `—` (visually distinct from real numbers; no fabricated values).

- [ ] **Step 1: Write the failing test**

`tests/components/kpi-cards.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiCards } from "@/components/home/kpi-cards"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import type { ReviewCounts } from "@/lib/api/review-counts"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"
import * as countsHook from "@/lib/queries/use-review-counts"

function fakeCounts(value: Partial<UseQueryResult<ReviewCounts>>) {
  vi.spyOn(countsHook, "useReviewCounts").mockReturnValue(
    value as UseQueryResult<ReviewCounts>
  )
}
function fakeAnalytics(value: Partial<UseQueryResult<AnalyticsOverview>>) {
  vi.spyOn(analyticsHook, "useAnalyticsOverview").mockReturnValue(
    value as UseQueryResult<AnalyticsOverview>
  )
}

const fullByStatus = {
  new: 3,
  drafted: 2,
  verified: 1,
  awaiting_approval: 0,
  publish_requested: 0,
  published: 5,
  rejected: 0,
  failed: 2,
  escalated: 4,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("KpiCards", () => {
  it("shows a busy skeleton row while either query is pending", () => {
    fakeCounts({ isPending: true, isError: false })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "UTC", summary: { averageRating: 4, responseRate: 80 }, locations: [] },
    })
    const { container } = render(<KpiCards />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText("Average rating")).not.toBeInTheDocument()
  })

  it("renders the four KPIs from counts and analytics", () => {
    fakeCounts({
      isPending: false,
      isError: false,
      data: { total: 1234, byStatus: fullByStatus },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "Europe/London", summary: { averageRating: 4.27, responseRate: 83.3 }, locations: [] },
    })
    render(<KpiCards />)
    expect(screen.getByText("Total reviews")).toBeInTheDocument()
    expect(screen.getByText("1,234")).toBeInTheDocument()
    expect(screen.getByText("Needs attention")).toBeInTheDocument()
    // new(3) + escalated(4) + failed(2) = 9
    expect(screen.getByText("9")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("4.3")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("83%")).toBeInTheDocument()
  })

  it("renders an honest zero/empty state without inventing data", () => {
    fakeCounts({
      isPending: false,
      isError: false,
      data: {
        total: 0,
        byStatus: {
          new: 0, drafted: 0, verified: 0, awaiting_approval: 0,
          publish_requested: 0, published: 0, rejected: 0, failed: 0, escalated: 0,
        },
      },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "UTC", summary: { averageRating: null, responseRate: null }, locations: [] },
    })
    render(<KpiCards />)
    expect(screen.getByText("Total reviews")).toBeInTheDocument()
    expect(screen.getAllByText("0")).toHaveLength(2)
    expect(screen.getAllByText("—")).toHaveLength(2)
  })

  it("offers a retry that refetches both sources when either errors", async () => {
    const user = userEvent.setup()
    const countsRefetch = vi.fn()
    const analyticsRefetch = vi.fn()
    fakeCounts({
      isPending: false,
      isError: true,
      refetch: countsRefetch as UseQueryResult<ReviewCounts>["refetch"],
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      refetch: analyticsRefetch as UseQueryResult<AnalyticsOverview>["refetch"],
      data: { timezone: "UTC", summary: { averageRating: 4, responseRate: 80 }, locations: [] },
    })
    render(<KpiCards />)
    expect(
      screen.getByText("We could not load your Home summary.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(countsRefetch).toHaveBeenCalledTimes(1)
    expect(analyticsRefetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/kpi-cards.test.tsx --project components`
Expected: FAIL — `@/components/home/kpi-cards` not found.

- [ ] **Step 3: Implement `components/home/kpi-cards.tsx`**

```tsx
"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber, formatPercent } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

// Baseline definition of "needs attention": reviews still awaiting a human.
// Deliberately conservative; the owner or the Inbox milestone (M4) may refine
// which workflow states belong here.
const NEEDS_ATTENTION_STATES = ["new", "escalated", "failed"] as const

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <p className="text-ui text-muted-foreground">{label}</p>
        <p className="text-page-title font-semibold tracking-tight tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function KpiCards() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()

  if (counts.isPending || analytics.isPending) {
    return (
      <div
        aria-busy="true"
        className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4"
      >
        {[0, 1, 2, 3].map((index) => (
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void counts.refetch()
              void analytics.refetch()
            }}
          >
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
  const { averageRating, responseRate } = analytics.data.summary

  return (
    <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Total reviews" value={formatNumber(counts.data.total)} />
      <KpiCard label="Needs attention" value={formatNumber(needsAttention)} />
      <KpiCard
        label="Average rating"
        value={averageRating === null ? "—" : averageRating.toFixed(1)}
      />
      <KpiCard
        label="Response rate"
        value={responseRate === null ? "—" : formatPercent(responseRate)}
      />
    </div>
  )
}

export { KpiCards, NEEDS_ATTENTION_STATES }
```

Note on narrowing: after the two guards, react-query's result union narrows to `status: "success"` for both, so `counts.data` and `analytics.data` are non-optional. If `tsc` disagrees on your version, add `if (!counts.data || !analytics.data) return null` before the derivations — never widen the types.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/kpi-cards.test.tsx --project components`
Expected: PASS (4 tests). `4.27.toFixed(1) === "4.3"`, `formatPercent(83.3) === "83%"`, `formatNumber(1234) === "1,234"`.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/home/kpi-cards.tsx tests/components/kpi-cards.test.tsx
git commit -m "feat: home KPI row (counts + analytics) with loading, zero, and error states

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Home attention list and disconnected banner

**Files:**
- Create: `components/home/attention-list.tsx`, `components/home/disconnected-banner.tsx`
- Test: `tests/components/attention-list.test.tsx`, `tests/components/disconnected-banner.test.tsx`

**Interfaces:**
- Consumes: `useAnalyticsOverview`/`AnalyticsOverview` (Task 3/2); `useConnectionHealth` from `@/lib/queries/use-connection-health`; `Alert`/`AlertTitle`/`AlertDescription` from `@/components/ui/alert`; `Button` from `@/components/ui/button` (AttentionList's retry); `buttonVariants` from `@/components/ui/button` (DisconnectedBanner's link); `Skeleton` from `@/components/ui/skeleton`; `formatNumber` from `@/lib/format`; `Link` (`next/link`).
- Produces (Task 7 consumes): `AttentionList()`; `DisconnectedBanner()`.

**`AttentionList` behavioural contract (the pinned test is the specification):**
1. Reads `useAnalyticsOverview()`.
2. Always renders a `<section aria-labelledby>` with an `<h2>` `Locations needing attention` (a distinct string from the KPI "Needs attention" label so the two never collide on the assembled page).
3. **Loading** — `isPending`: a `<div aria-busy="true">` of skeleton rows.
4. **Error** — `isError`: `Alert variant="destructive"` titled `We could not load locations that need attention.` with a `Button` `Try again` → `refetch()`.
5. **Populated** — rows = `locations` filtered to `unresolvedComplaints > 0`, sorted by `unresolvedComplaints` desc, first 5. Each row is a `Link` to `/inbox?locationId=<id>` showing the name and `` `${formatNumber(n)} unresolved ${n === 1 ? "complaint" : "complaints"}` `` in one text node.
6. **Empty** — no qualifying rows: `<p>No locations need attention right now.</p>` and no links.

**`DisconnectedBanner` behavioural contract:**
- Reads `useConnectionHealth()`; renders `null` unless `status === "disconnected"`.
- When disconnected: `Alert variant="destructive"`, `AlertTitle` `Google is not connected`, GB-English guidance, and a `Manage connection` link (`buttonVariants` outline sm) → `/settings/connections`.

- [ ] **Step 1: Write the failing tests**

`tests/components/attention-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttentionList } from "@/components/home/attention-list"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"

function fakeAnalytics(value: Partial<UseQueryResult<AnalyticsOverview>>) {
  vi.spyOn(analyticsHook, "useAnalyticsOverview").mockReturnValue(
    value as UseQueryResult<AnalyticsOverview>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AttentionList", () => {
  it("is busy while the query is pending", () => {
    fakeAnalytics({ isPending: true, isError: false })
    const { container } = render(<AttentionList />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("lists the worst five locations, most complaints first, each linking to its inbox", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: {
        timezone: "UTC",
        summary: { averageRating: 4, responseRate: 80 },
        locations: [
          { id: "a", name: "Airport", unresolvedComplaints: 1 },
          { id: "b", name: "Bridge", unresolvedComplaints: 9 },
          { id: "c", name: "Central", unresolvedComplaints: 0 },
          { id: "d", name: "Dockside", unresolvedComplaints: 4 },
          { id: "e", name: "Eastgate", unresolvedComplaints: 7 },
          { id: "f", name: "Ferry", unresolvedComplaints: 2 },
          { id: "g", name: "Garden", unresolvedComplaints: 3 },
        ],
      },
    })
    render(<AttentionList />)
    const links = screen.getAllByRole("link")
    // Central (0) excluded; top five by desc: Bridge9, Eastgate7, Dockside4, Garden3, Ferry2
    expect(links).toHaveLength(5)
    expect(links[0]).toHaveAccessibleName(/Bridge/)
    expect(links[0]).toHaveAttribute("href", "/inbox?locationId=b")
    expect(links[4]).toHaveAccessibleName(/Ferry/)
    expect(screen.queryByText(/Central/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Airport/)).not.toBeInTheDocument()
  })

  it("uses singular copy for a single complaint", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: {
        timezone: "UTC",
        summary: { averageRating: 4, responseRate: 80 },
        locations: [{ id: "a", name: "Airport", unresolvedComplaints: 1 }],
      },
    })
    render(<AttentionList />)
    expect(screen.getByText("1 unresolved complaint")).toBeInTheDocument()
  })

  it("shows an honest empty state when nothing needs attention", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: {
        timezone: "UTC",
        summary: { averageRating: 5, responseRate: 100 },
        locations: [{ id: "a", name: "Airport", unresolvedComplaints: 0 }],
      },
    })
    render(<AttentionList />)
    expect(
      screen.getByText("No locations need attention right now.")
    ).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("offers a retry when the query errors", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    fakeAnalytics({
      isPending: false,
      isError: true,
      refetch: refetch as UseQueryResult<AnalyticsOverview>["refetch"],
    })
    render(<AttentionList />)
    expect(
      screen.getByText("We could not load locations that need attention.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
```

`tests/components/disconnected-banner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import * as healthHook from "@/lib/queries/use-connection-health"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DisconnectedBanner", () => {
  it("warns and links to connections when Google is disconnected", () => {
    vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
      status: "disconnected",
      label: "Google disconnected",
    })
    render(<DisconnectedBanner />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google is not connected"
    )
    expect(
      screen.getByRole("link", { name: "Manage connection" })
    ).toHaveAttribute("href", "/settings/connections")
  })

  it("renders nothing while a connection is live", () => {
    vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
      status: "connected",
      label: "Live data",
    })
    const { container } = render(<DisconnectedBanner />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/attention-list.test.tsx tests/components/disconnected-banner.test.tsx --project components`
Expected: FAIL — neither `@/components/home/attention-list` nor `@/components/home/disconnected-banner` exists.

- [ ] **Step 3: Implement both components**

`components/home/attention-list.tsx`:

```tsx
"use client"

import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"

const HEADING_ID = "needs-attention-heading"
const MAX_ROWS = 5

function AttentionList() {
  const analytics = useAnalyticsOverview()

  function renderBody() {
    if (analytics.isPending) {
      return (
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 rounded-(--nr-radius-card)" />
          ))}
        </div>
      )
    }

    if (analytics.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>
            We could not load locations that need attention.
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Check your connection, then try again.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void analytics.refetch()
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )
    }

    const rows = [...analytics.data.locations]
      .filter((location) => location.unresolvedComplaints > 0)
      .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
      .slice(0, MAX_ROWS)

    if (rows.length === 0) {
      return (
        <p className="text-ui text-muted-foreground">
          No locations need attention right now.
        </p>
      )
    }

    return (
      <ul className="flex flex-col overflow-hidden rounded-(--nr-radius-card) border border-[var(--nr-surface-glass-border)] bg-card">
        {rows.map((location) => (
          <li
            key={location.id}
            className="border-b border-border/60 last:border-b-0"
          >
            {/* /inbox 404s until M4; viewport-prefetch of a 404 route keeps
                Chrome from reaching networkidle and destabilises Task 7's
                console/axe guards - mirror nav.tsx and stay prefetch={false}. */}
            <Link
              href={`/inbox?locationId=${location.id}`}
              prefetch={false}
              className="flex items-center justify-between gap-3 px-4 py-3 text-ui transition-colors duration-(--nr-duration-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <span className="min-w-0 truncate font-medium">
                {location.name}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                {`${formatNumber(location.unresolvedComplaints)} unresolved ${
                  location.unresolvedComplaints === 1
                    ? "complaint"
                    : "complaints"
                }`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
        Locations needing attention
      </h2>
      {renderBody()}
    </section>
  )
}

export { AttentionList }
```

`components/home/disconnected-banner.tsx`:

```tsx
"use client"

import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

function DisconnectedBanner() {
  const { status } = useConnectionHealth()
  if (status !== "disconnected") return null
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>Google is not connected</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          No active Google connection exists, so the figures below cannot be
          kept up to date. Reconnect Google to resume syncing your locations.
        </span>
        {/* /settings/connections 404s until M6; viewport-prefetch of a 404
            route destabilises Task 7's networkidle-based e2e guards - stay
            prefetch={false} (mirrors nav.tsx). */}
        <Link
          href="/settings/connections"
          prefetch={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Manage connection
        </Link>
      </AlertDescription>
    </Alert>
  )
}

export { DisconnectedBanner }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/attention-list.test.tsx tests/components/disconnected-banner.test.tsx --project components`
Expected: PASS (5 + 2 tests). If `getByText("1 unresolved complaint")` misses, confirm the whole phrase is one template-literal text node (not split across elements).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/home/attention-list.tsx components/home/disconnected-banner.tsx tests/components/attention-list.test.tsx tests/components/disconnected-banner.test.tsx
git commit -m "feat: home attention list and Google-disconnected banner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `/overview → /home` legacy redirect

**Files:**
- Create: `app/(dashboard)/overview/page.tsx`
- Test: `tests/components/overview-redirect.test.tsx`

**Interfaces:**
- Consumes: `redirect` from `next/navigation`.
- Produces: a server page whose default export redirects `/overview` to `/home` (spec §4 legacy redirect; the e2e assertion is revived in Task 7).

- [ ] **Step 1: Write the failing test**

`tests/components/overview-redirect.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

import OverviewPage from "@/app/(dashboard)/overview/page"
import { redirect } from "next/navigation"

describe("overview redirect page", () => {
  it("redirects to /home", () => {
    expect(() => OverviewPage()).toThrow()
    expect(redirect).toHaveBeenCalledWith("/home")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/overview-redirect.test.tsx --project components`
Expected: FAIL — `@/app/(dashboard)/overview/page` not found.

- [ ] **Step 3: Implement `app/(dashboard)/overview/page.tsx`**

```tsx
import { redirect } from "next/navigation"

export default function OverviewPage(): never {
  redirect("/home")
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/overview-redirect.test.tsx --project components`
Expected: PASS (1 test). Then confirm the page builds:
Run: `pnpm build`
Expected: `/overview` appears in the route manifest; build exits 0.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add app/\(dashboard\)/overview/page.tsx tests/components/overview-redirect.test.tsx
git commit -m "feat: /overview -> /home legacy redirect

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Home page assembly, milestone e2e, and gate

**Files:**
- Modify: `app/(dashboard)/home/page.tsx`, `playwright.config.ts` (remove `**/home.spec.ts` from `testIgnore`)
- Test: `tests/e2e/home.spec.ts` (revive + adapt) + the full milestone gate

**Interfaces:**
- Consumes: `PageFrame`/`PageHeader` from `@/components/app-shell/page-frame`; `KpiCards` (Task 4); `AttentionList`, `DisconnectedBanner` (Task 5).
- Produces: the assembled `/home` page and the revived, adapted milestone e2e.

Rendering-model note (spec §5): the page is a synchronous server component. Route-level Suspense/streaming is provided by the existing `app/(dashboard)/loading.tsx` (Next wraps the segment in a Suspense boundary with that fallback during navigation). Per-source loading during the client fetches is owned by each component's own skeleton (D9). We deliberately do NOT server-prefetch/dehydrate counts+analytics this milestone — that would need either an HTTP self-call (spec §5 forbids) or new `lib/server` services (protected paths, out of scope). Recorded as an M7 carry-forward: when reporting extracts analytics/counts services, Home can move to dehydrated server hydration for a flash-free first paint.

- [ ] **Step 1: Assemble the page**

Replace `app/(dashboard)/home/page.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
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
      <AttentionList />
    </PageFrame>
  )
}
```

Heading order stays h1 (`Home`) → h2 (`Locations needing attention`); the KPI labels and the Alert titles are not headings, so `page-has-heading-one` and `heading-order` hold.

- [ ] **Step 2: Un-ignore and revive the e2e**

In `playwright.config.ts`, delete the `"**/home.spec.ts",` line from the `testIgnore` array. Leave the other ignored specs untouched.

Replace `tests/e2e/home.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

test.describe("home", () => {
  test("renders the organisation roll-up", async ({ page }) => {
    await page.goto("/home")
    await expect(page).toHaveURL("/home")
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 })
    ).toBeVisible()
    // The KPI labels only render once the counts + analytics queries resolve,
    // so asserting them also proves the populated (non-loading, non-error)
    // state was reached.
    await expect(page.getByText("Total reviews")).toBeVisible()
    await expect(page.getByText("Average rating")).toBeVisible()
    await expect(page.getByText("Response rate")).toBeVisible()
  })

  test("overview redirects to home", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).toHaveURL("/home")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`is free of console and page errors (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })
      page.on("pageerror", (error) => {
        pageErrors.push(error.message)
      })
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/home")
      await expect(page.getByText("Average rating")).toBeVisible()
      await page.waitForLoadState("networkidle")
      expect(consoleErrors, `${theme} console`).toEqual([])
      expect(pageErrors, `${theme} pageerror`).toEqual([])
    })

    test(`is axe-clean including structure (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/home")
      await expect(page.getByText("Average rating")).toBeVisible()
      await page.waitForLoadState("networkidle")
      const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(wcag.violations, `${theme} wcag`).toEqual([])
      const best = await new AxeBuilder({ page })
        .withTags(["best-practice"])
        .analyze()
      expect(
        best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
        `${theme} structure`
      ).toEqual([])
    })
  }
})
```

Harness note: `foundation.spec.ts` already proves the harness session bootstrap and a `requireSession` endpoint (`/api/google/connections`) return 200 on `/home`, so `/api/reviews/counts` and `/api/analytics/overview` (same guard, same tenant) also return 200 — with zero data on a fresh DB, which renders the KPI labels with `0`/`—` values, still satisfying the label assertions. If, and only if, either endpoint cannot return 200 in the harness, fall back to deterministic `page.route("**/api/reviews/counts", …)` / `page.route("**/api/analytics/overview", …)` stubs returning representative bodies (the auth-spec pattern from M2) — the Home UI behaviour is what this spec verifies, not the DB.

- [ ] **Step 3: Build, then run the revived spec**

```bash
pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/home.spec.ts
```

Expected: PASS (roll-up, redirect, console guard ×2 themes, axe ×2 themes). Fix any failure in the components, never by weakening an assertion. The console guard must be clean in prod (`pnpm start`) — the dev-only "script tag" artifact recorded in the M2 ledger does not appear on `/home` in a production build.

- [ ] **Step 4: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: unit + components green; e2e runs `foundation.spec.ts` AND the revived `home.spec.ts`, both green in both themes; integration exits 0 unchanged (M3 touches no backend). Paste every summary line into the report.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/home/page.tsx tests/e2e/home.spec.ts playwright.config.ts
git commit -m "feat: assemble baseline Home; revive home e2e with console guard and axe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 3 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- `foundation.spec.ts` and the revived `home.spec.ts` green, including the zero-console-error + zero-pageerror guard on `/home` and the best-practice structural axe rules, in both light and dark.
- The legacy `/overview → /home` redirect works (covered by a unit test in Task 6 and the e2e in Task 7); `home.spec.ts` removed from `playwright.config.ts`'s `testIgnore`.
- The integration suite stays green (parity oracle). M3 changes no backend, so no integration test should move.
- Every M3-scoped spec obligation closed: shell per-route prefetch (closes the M1 carry-forward "nav prefetch re-enable per route" for `/home`); Home KPIs derived from the counts endpoint, never a page of reviews (spec §8, D3/D4); attention list rows link to a location via `?locationId=` (M4 contract, D5); Google-disconnected banner (D6); loading / empty(zero) / error visually distinct and each tested (spec §8/§9, D9).
- No protected path changed — `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts` all byte-identical (M3 has no sanctioned edits).
- No new dependency added; `recharts` remains unused.
- Carry-forwards recorded for later milestones: all Home charting / prior-window deltas / non-colour delta cues / `providerTotals.divergence` banner / zero-filled axes / nulls-last table / fetched-at captions → **M7**; the `?locationId=` (and later low-rating) inbox filter → **M4**; the `/settings/connections` target → **M6**; server-hydrated Home (dehydration + §5 prefetch, once analytics/counts `lib/server` services exist) → **M7**; the triple-duplicated "Go to sign in" link in `invitation-view.tsx` → **M9**; `formatDuration` negative-input guard → **M7** (Home baseline does not use `formatDuration`); `ShellSession` capabilities extension → **M4**.
- Acceptance-bar note: no committed audit-findings document exists for M3, so its bar is spec §7/§8 prose plus the M1/M2 carry-forward register — not an audit-ID checklist.

## Self-review (run before merge; fix inline)

- **Spec coverage.** §4 legacy `/overview→/home` (T6/T7); §5 rendering model — client-fetched Home with route-level `loading.tsx` Suspense, deviation from server-prefetch documented (T7); §6 typed client + `staleTime:30s` + reserved keys (T2/T3); §7 shell prefetch (T1); §8 Home — KPIs from counts, attention list links, loading/null/error distinct (T4/T5), with chart/delta/divergence/axes/table/caption clauses explicitly deferred to M7 (D1/D2); §9 component tests for loading/error/empty/mutation-retry per feature + e2e adaptation + axe best-practice (T4/T5/T7). No M3-scoped requirement is left without a task.
- **Placeholder scan.** No "TBD"/"similar to Task N"/"add error handling"/bare "write tests". Every code step carries real code; the two data-driven components carry a contract + a complete pinned test + a reference implementation.
- **Type consistency.** `ReviewCounts` / `AnalyticsOverview` / `AnalyticsLocation` (T2) are the exact names imported by T3's hooks and T4/T5's tests. `useReviewCounts` / `useAnalyticsOverview` (T3) are the exact names T4/T5 consume. `NEEDS_ATTENTION_STATES` (T4) is exported and used only inside T4. Query keys `queryKeys.reviewCounts("organisation")` and `queryKeys.analytics("overview", { window: "last-30-days" })` are identical between hook (T3) and hook-test assertions. `formatNumber`/`formatPercent` signatures match `lib/format` (percent input is a whole-number percentage, e.g. `83.3 → "83%"`).
