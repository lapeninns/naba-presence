# GBP UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the NabaPresence interface around location as the primary noun so reviews become one capability among several rather than the whole product.

**Architecture:** Five-item sidebar (Home, Inbox, Locations, Performance, Settings) over a nested location workspace whose tab routes map one-to-one onto the GBP expansion master plan's workstreams. `/overview` is deleted as derived from `/analytics`. The 1750-line reviews view splits into four focused components shared by a cross-location inbox and a per-location review history. No provider writes are added.

**Tech Stack:** Next.js 16.2.6 App Router (webpack, not Turbopack), React 19.2.4, TypeScript, Tailwind v4 with `--nr-*` design tokens, Base UI + shadcn primitives in `components/ui/`, Vitest, Playwright, PostgreSQL via `postgres` with forced RLS.

**Spec:** `docs/archive/2026-07-frontend-rebuild/specs/2026-07-30-gbp-ux-redesign-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing Next.js code.** Per `AGENTS.md`, this Next.js version has breaking changes from training data. Do not assume App Router conventions.
- **Never substitute preview, mock, or placeholder data values.** The interface displays only tenant-scoped, API-backed records. A missing value renders `—` or an empty state, never a fabricated number. This is an existing product rule stated in `README.md`.
- **No new provider writes.** This plan adds no Google mutations.
- **No `/api/*` contract changes.** Route handlers are untouched except one deletion (Task 6). The `readMask` change is deferred to the gated Phase 4 plan.
- **No database migration.** Phases 1–3 add no columns and no tables.
- **`components/ui/*` primitives are not modified.** Composition happens in `components/naba-presence/`.
- **Design tokens may be retuned but must remain defined.** `tests/design-system-contract.test.ts` asserts token *existence*; deleting a token breaks it.
- **`BusinessContext` must keep** its `export function BusinessContext` declaration, its `status?: { label: string; value: string }` prop shape, its `{status.label}</span>` and `{status.value}</span>` renders, and its `--nr-surface-card-translucent` surface. Three tests in `tests/design-system-contract.test.ts` assert these.
- **Exactly two occurrences of `--nr-surface-card-translucent`** may exist in `shared.tsx` (in `BusinessContext` and `MetricCard`). `design-system-contract.test.ts:99` asserts the count.
- **Validation gates:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. E2E (`pnpm test:e2e`) requires Docker and the local Supabase stack; it builds and starts a production server on port 3100.
- **Commit after every task.** Never batch tasks into one commit.

## Test Loop Guidance

E2E is the real behavioural gate for route work but is slow: it runs `pnpm build` then `pnpm start`, and `globalSetup` provisions a PostgreSQL tenant.

- **Fast inner loop:** `pnpm typecheck` then `pnpm test`. Catches route wiring, prop mismatches, and contract regressions in seconds.
- **Task gate:** the e2e command named in that task's steps.
- **Prerequisite for any e2e run:** `pnpm supabase:start` must have been run and Docker must be running.

Run a single e2e test with:

```bash
pnpm exec playwright test tests/e2e/routing.spec.ts -g "test name"
```

Note this bypasses `scripts/run-test-command.mjs`, so it requires the env vars that wrapper sets. Prefer `pnpm test:e2e` when unsure.

## File Structure

**Deleted**

| Path | Reason |
| --- | --- |
| `app/(dashboard)/overview/page.tsx` | Becomes a redirect, not removed |
| `components/naba-presence/overview-view.tsx` | Route derived from `/analytics` |
| `components/naba-presence/settings-view.tsx` | Split into three route views |
| `components/naba-presence/reviews-view.tsx` | Split into `reviews/` |
| `app/api/analytics/locations/[id]/route.ts` | No caller in `app`, `components`, `lib`, or `hooks` |

`components/naba-presence/route-views.tsx` is **kept**. It is the context-to-props
bridge for views that read dashboard state, and it gains the new route wrappers
(`InboxRoute`, `LocationReviewsRoute`, `ConnectionsSettingsRoute`) while losing
the ones whose routes are gone.

**Created — routes**

```
app/(dashboard)/home/page.tsx
app/(dashboard)/inbox/page.tsx
app/(dashboard)/performance/page.tsx
app/(dashboard)/locations/page.tsx
app/(dashboard)/locations/[id]/layout.tsx
app/(dashboard)/locations/[id]/page.tsx
app/(dashboard)/locations/[id]/reviews/page.tsx
app/(dashboard)/locations/[id]/hours/page.tsx
app/(dashboard)/locations/[id]/photos/page.tsx
app/(dashboard)/locations/[id]/posts/page.tsx
app/(dashboard)/locations/[id]/menu/page.tsx
app/(dashboard)/locations/[id]/qa/page.tsx
app/(dashboard)/locations/[id]/booking/page.tsx
app/(dashboard)/locations/[id]/performance/page.tsx
app/(dashboard)/settings/connections/page.tsx
app/(dashboard)/settings/team/page.tsx
app/(dashboard)/settings/compliance/page.tsx
```

**Created — components**

| Path | Responsibility |
| --- | --- |
| `components/naba-presence/home-view.tsx` | Organisation roll-up |
| `components/naba-presence/locations-index-view.tsx` | Location table |
| `components/naba-presence/location-workspace.tsx` | Workspace header + tab bar |
| `components/naba-presence/location-profile-view.tsx` | Profile tab, identity fields |
| `components/naba-presence/capability-placeholder.tsx` | Flag-aware notice for six tabs |
| `components/naba-presence/performance-view.tsx` | Tab shell wrapping reply analytics |
| `components/naba-presence/reviews/review-filters.tsx` | Filter bar |
| `components/naba-presence/reviews/review-list.tsx` | List and rows |
| `components/naba-presence/reviews/review-detail.tsx` | Detail pane, reply editor |
| `components/naba-presence/reviews/review-queue.tsx` | Split-pane composition |
| `components/naba-presence/settings/use-organisation-settings.ts` | Shared settings load/save hook |
| `components/naba-presence/settings/settings-nav.tsx` | Settings sub-navigation |

**Modified**

| Path | Change |
| --- | --- |
| `app/globals.css` | Retune six spacing tokens |
| `components/naba-presence/shared.tsx` | `PageHeader` and `MetricCard` density; `BusinessContext` prop rename |
| `components/naba-presence/app-shell.tsx` | Five nav items, `Store` mark, post-switch destination |
| `components/naba-presence/review-app.tsx` | Polling pathname predicate |
| `components/naba-presence/reviews-view.tsx` | Emptied into `reviews/`, then deleted |
| `components/naba-presence/settings-view.tsx` | Split into three route views |
| `components/naba-presence/connections-view.tsx` | Moved under settings |
| `components/naba-presence/analytics-view.tsx` | Becomes a tab body |
| `app/page.tsx` | Redirect to `/home` |
| `lib/server/env.ts` | Six `GBP_*_ENABLED` flags |
| `.env.example` | Document the six flags |
| `tests/e2e/routing.spec.ts` | Rewrite |
| `tests/e2e/journeys.spec.ts` | Update six `page.goto` targets |
| `tests/e2e/accessibility.spec.ts` | Update targets, add new routes |
| `README.md` | Route list and product framing |

---

# Phase 1 — Shell and route tree

## Task 1: Retune density tokens

**Files:**
- Modify: `app/globals.css:164-170`
- Modify: `components/naba-presence/shared.tsx:71-76` and `246-249`
- Test: `tests/design-system-contract.test.ts` (must pass unchanged)

**Interfaces:**
- Consumes: nothing
- Produces: no API change. Token names and `PageHeader`/`MetricCard` signatures are unchanged; only values and classes change.

- [ ] **Step 1: Run the design-system contract test to confirm the baseline passes**

```bash
pnpm test -- tests/design-system-contract.test.ts
```

Expected: PASS. This test asserts tokens are *defined*, not their values, so it must keep passing after the retune. If it fails now, stop and investigate before changing anything.

- [ ] **Step 2: Retune the six spacing tokens**

In `app/globals.css`, replace lines 164-170:

```css
  --nr-page-pad-x: 24px;
  --nr-page-pad-y: 20px;
  --nr-page-max-width: 1180px;
  --nr-gap-card: 12px;
  --nr-gap-section: 16px;
  --nr-card-pad: 14px;
  --nr-panel-pad: 20px;
```

Also change line 162:

```css
  --nr-sidebar-width: 232px;
```

Leave `--nr-sidebar-margin`, every `--nr-space-*`, every `--nr-radius-*`, and every `--nr-shadow-*` untouched.

- [ ] **Step 3: Tighten `PageHeader`**

In `components/naba-presence/shared.tsx`, change the `h1` class on line 71-73 from `text-[22px]` to `text-[18px]`, and change the `header` class on line 68 so the title and actions share a row from `sm` upward:

```tsx
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
```

- [ ] **Step 4: Tighten `MetricCard`**

In the same file, change the value paragraph on lines 246-248 from `text-2xl` to `text-xl`:

```tsx
        <p className="font-mono text-xl font-medium tracking-tight">
          {value}
        </p>
```

- [ ] **Step 5: Verify the contract test and types still pass**

```bash
pnpm test -- tests/design-system-contract.test.ts && pnpm typecheck
```

Expected: PASS both. In particular the `--nr-surface-card-translucent` occurrence count is still 2 and `BusinessContext` is untouched.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css components/naba-presence/shared.tsx
git commit -m "style: tighten spacing tokens and metric density"
```

---

## Task 2: Add `/home` and delete `/overview`

**Files:**
- Create: `components/naba-presence/home-view.tsx`
- Create: `app/(dashboard)/home/page.tsx`
- Delete: `app/(dashboard)/overview/page.tsx`, `components/naba-presence/overview-view.tsx`
- Modify: `components/naba-presence/route-views.tsx` (remove `OverviewRoute`)

**Interfaces:**
- Consumes: `useNabaPresenceDashboard()` from `review-app.tsx`, returning `{ reviews, session, connectionState }` among other fields; `loadAnalytics({ from, to, granularity })` returning `AnalyticsOverview`; `MetricCard`, `PageFrame`, `PageHeader`, `LiveDataError`, `EmptyData`, `chartConfig`, `formatDuration` from `shared.tsx`.
- Produces: `export function HomeView()` — takes no props, reads dashboard context internally.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/home.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("home renders the organisation roll-up", async ({ page }) => {
  await page.goto("/home")

  await expect(page).toHaveURL("/home")
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 })
  ).toBeVisible()
  await expect(page.getByText("Average rating")).toBeVisible()
  await expect(page.getByText("Response rate")).toBeVisible()
})

test("overview redirects to home", async ({ page }) => {
  await page.goto("/overview")

  await expect(page).toHaveURL("/home")
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/home.spec.ts
```

Expected: FAIL. `/home` returns 404 and no `Home` heading exists.

- [ ] **Step 3: Create `home-view.tsx`**

```tsx
"use client"

import { Activity, ArrowRight, Clock3, Star, TrendingUp } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { type AnalyticsOverview, loadAnalytics } from "@/lib/naba-presence-api"
import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import {
  chartConfig,
  EmptyData,
  formatDuration,
  LiveDataError,
  MetricCard,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"

export function HomeView() {
  const { reviews, connectionState } = useNabaPresenceDashboard()
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86400000)
    void loadAnalytics({
      from: from.toISOString(),
      to: to.toISOString(),
      granularity: "day",
    })
      .then((result) => {
        if (!active) return
        setAnalytics(result)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const summary = analytics?.summary
  const needsAttention = reviews.filter(
    (review) =>
      review.status === "needs_reply" || review.status === "escalated"
  ).length
  const chartData =
    analytics?.series.map((point) => ({
      label: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: analytics.timezone,
      }).format(new Date(point.period)),
      reviews: point.reviews,
      replies: point.replies,
    })) ?? []
  const attention = [...(analytics?.locations ?? [])]
    .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
    .filter((location) => location.unresolvedComplaints > 0)
    .slice(0, 5)

  function retry() {
    setAnalytics(null)
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Home"
        description="Google presence across every connected location, for the last 30 days."
        actions={
          <Button render={<Link href="/inbox" />}>
            Open inbox
            <ArrowRight data-icon="inline-end" />
          </Button>
        }
      />

      {connectionState === "disconnected" ? (
        <Alert variant="destructive">
          <Activity />
          <AlertTitle>Google is not connected</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              No active Google connection exists, so no location data can be
              synchronised.
            </span>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/settings/connections" />}
            >
              Manage connection
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "error" ? <LiveDataError onRetry={retry} /> : null}

      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Average rating"
          value={
            !summary || summary.averageRating === null
              ? "—"
              : summary.averageRating.toFixed(1)
          }
          detail="Google reviews · last 30 days"
          icon={Star}
        />
        <MetricCard
          title="Response rate"
          value={
            !summary || summary.responseRate === null
              ? "—"
              : `${summary.responseRate}%`
          }
          detail="Published or accepted replies"
          icon={TrendingUp}
        />
        <MetricCard
          title="Median first response"
          value={summary ? formatDuration(summary.medianFirstResponseSeconds) : "—"}
          detail="From review to first reply"
          icon={Clock3}
        />
        <MetricCard
          title="Needs attention"
          value={`${needsAttention}`}
          detail="Loaded inbox page"
          icon={Activity}
        />
      </div>

      <div className="grid gap-(--nr-gap-card) xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Reviews and replies</CardTitle>
            <CardDescription>
              Thirty-day volume across all locations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === "loading" ? (
              <Skeleton className="h-[260px] w-full" />
            ) : chartData.length ? (
              <ChartContainer
                config={chartConfig}
                className="h-[260px] w-full"
                initialDimension={{ width: 760, height: 260 }}
              >
                <AreaChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ left: -18, right: 10, top: 10 }}
                >
                  <defs>
                    <linearGradient id="home-reviews-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-reviews)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--color-reviews)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Area
                    dataKey="reviews"
                    type="monotone"
                    fill="url(#home-reviews-fill)"
                    stroke="var(--color-reviews)"
                    strokeWidth={2}
                  />
                  <Area
                    dataKey="replies"
                    type="monotone"
                    fill="transparent"
                    stroke="var(--color-replies)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyData message="No review activity was recorded in the last 30 days." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Locations with unresolved one- and two-star reviews
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {status === "loading" ? (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </>
            ) : attention.length ? (
              attention.map((location) => (
                <div
                  key={location.name}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {location.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {location.unresolvedComplaints}
                  </span>
                </div>
              ))
            ) : (
              <EmptyData message="No location has unresolved low-rated reviews." />
            )}
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  )
}
```

- [ ] **Step 4: Create the page**

`app/(dashboard)/home/page.tsx`:

```tsx
import { HomeView } from "@/components/naba-presence/home-view"

export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return <HomeView />
}
```

- [ ] **Step 5: Replace `/overview` with a redirect**

Replace the whole of `app/(dashboard)/overview/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

export default function OverviewPage() {
  redirect("/home")
}
```

Then delete `components/naba-presence/overview-view.tsx` and remove the `OverviewRoute` export and its `OverviewView` import from `components/naba-presence/route-views.tsx`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/home.spec.ts
```

Expected: PASS both tests.

- [ ] **Step 7: Commit**

```bash
git add app components/naba-presence tests/e2e/home.spec.ts
git commit -m "feat: add /home roll-up and redirect /overview to it"
```

---

## Task 3: Add `/inbox` and redirect `/reviews`

**Files:**
- Create: `app/(dashboard)/inbox/page.tsx`
- Modify: `app/(dashboard)/reviews/page.tsx` (becomes a redirect)
- Modify: `components/naba-presence/route-views.tsx` (rename `ReviewsRoute` to `InboxRoute`)
- Modify: `components/naba-presence/review-app.tsx:185`

**Interfaces:**
- Consumes: `ReviewsWorkspace` from `reviews-view.tsx` with its existing ten-prop signature (unchanged in this task).
- Produces: `export function InboxRoute()` in `route-views.tsx`.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/inbox.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("inbox is the cross-location review queue", async ({ page }) => {
  await page.goto("/inbox")

  await expect(page).toHaveURL("/inbox")
  await expect(
    page.getByRole("heading", { name: "Inbox", level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Filter by location" })
  ).toBeVisible()
})

test("reviews redirects to inbox", async ({ page }) => {
  await page.goto("/reviews")

  await expect(page).toHaveURL("/inbox")
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/inbox.spec.ts
```

Expected: FAIL. `/inbox` returns 404.

- [ ] **Step 3: Rename the route wrapper**

In `components/naba-presence/route-views.tsx`, rename `export function ReviewsRoute()` to `export function InboxRoute()`. Its body is unchanged.

- [ ] **Step 4: Change the workspace heading**

In `components/naba-presence/reviews-view.tsx`, find the `PageHeader` inside `ReviewsWorkspace` and change its `title` from `"Reviews"` to `"Inbox"`. Change its `description` to:

```tsx
        description="Google reviews awaiting a reply, approval, or publication across every linked location."
```

- [ ] **Step 5: Create the inbox page and convert `/reviews` to a redirect**

`app/(dashboard)/inbox/page.tsx`:

```tsx
import { InboxRoute } from "@/components/naba-presence/route-views"

export const metadata = { title: "Inbox · NabaPresence" }

export default function InboxPage() {
  return <InboxRoute />
}
```

Replace the whole of `app/(dashboard)/reviews/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

export default function ReviewsPage() {
  redirect("/inbox")
}
```

- [ ] **Step 6: Fix the polling predicate**

`components/naba-presence/review-app.tsx:185` currently reads:

```tsx
      void refreshDashboard(pathname === "/reviews")
```

Reviews are no longer served from `/reviews`. Replace it with:

```tsx
      void refreshDashboard(
        pathname === "/inbox" || pathname.endsWith("/reviews")
      )
```

This keeps the sixty-second review refresh active on the inbox and on any location's review tab, and off on every other route, matching the previous behaviour.

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/inbox.spec.ts
```

Expected: PASS both tests.

- [ ] **Step 8: Commit**

```bash
git add app components/naba-presence tests/e2e/inbox.spec.ts
git commit -m "feat: serve the review queue from /inbox"
```

---

## Task 4: Add `/performance` wrapping reply analytics

**Files:**
- Create: `components/naba-presence/performance-view.tsx`
- Create: `app/(dashboard)/performance/page.tsx`
- Modify: `app/(dashboard)/analytics/page.tsx` (becomes a redirect)
- Modify: `components/naba-presence/analytics-view.tsx` (drop its own `PageFrame`/`PageHeader`)
- Modify: `components/naba-presence/route-views.tsx` (remove `AnalyticsRoute`)

**Interfaces:**
- Consumes: `AnalyticsView` from `analytics-view.tsx`.
- Produces: `export function PerformanceView()`. `AnalyticsView` gains no props but must no longer render its own page frame or heading, because `PerformanceView` owns those now.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/performance.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("performance exposes reply and Google tabs", async ({ page }) => {
  await page.goto("/performance")

  await expect(page).toHaveURL("/performance")
  await expect(
    page.getByRole("heading", { name: "Performance", level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole("tab", { name: "Reply performance" })
  ).toBeVisible()
  await expect(
    page.getByRole("tab", { name: "Google performance" })
  ).toBeVisible()
})

test("analytics redirects to performance", async ({ page }) => {
  await page.goto("/analytics")

  await expect(page).toHaveURL("/performance")
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/performance.spec.ts
```

Expected: FAIL. `/performance` returns 404.

- [ ] **Step 3: Strip the page frame from `AnalyticsView`**

In `components/naba-presence/analytics-view.tsx`:

- change the outermost `<PageFrame width="wide">` and its closing tag to a fragment `<>` / `</>`;
- delete the entire `<PageHeader ... />` element (lines 134-170), but **keep** the two `NativeSelect` controls by moving them into a new wrapper placed where the header was:

```tsx
      <div className="flex flex-wrap justify-end gap-2">
        <NativeSelect
          size="sm"
          value={dateRange}
          onValueChange={(value) => {
            beginAnalyticsLoad()
            setDateRange(value as "7d" | "30d" | "90d" | "365d")
          }}
          aria-label="Analytics date range"
        >
          <NativeSelectOption value="7d">Last 7 days</NativeSelectOption>
          <NativeSelectOption value="30d">Last 30 days</NativeSelectOption>
          <NativeSelectOption value="90d">Last 90 days</NativeSelectOption>
          <NativeSelectOption value="365d">Last 12 months</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          size="sm"
          value={granularity}
          onValueChange={(value) => {
            beginAnalyticsLoad()
            setGranularity(value as "day" | "week" | "month")
          }}
          aria-label="Analytics granularity"
        >
          <NativeSelectOption value="day">Daily</NativeSelectOption>
          <NativeSelectOption value="week">Weekly</NativeSelectOption>
          <NativeSelectOption value="month">Monthly</NativeSelectOption>
        </NativeSelect>
      </div>
```

- add `className="flex flex-col gap-(--nr-gap-section)"` to a wrapping `<div>` replacing the fragment, so section spacing is preserved now that `PageFrame` no longer provides it;
- remove the now-unused `PageFrame` and `PageHeader` imports.

- [ ] **Step 4: Create `performance-view.tsx`**

```tsx
"use client"

import { AnalyticsView } from "@/components/naba-presence/analytics-view"
import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageFrame, PageHeader } from "@/components/naba-presence/shared"

export function PerformanceView({
  googlePerformanceEnabled,
}: {
  googlePerformanceEnabled: boolean
}) {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Performance"
        description="Reply operations today, and Google presence metrics once ingestion is enabled."
      />
      <Tabs defaultValue="reply">
        <TabsList>
          <TabsTrigger value="reply">Reply performance</TabsTrigger>
          <TabsTrigger value="google">Google performance</TabsTrigger>
        </TabsList>
        <TabsContent value="reply">
          <AnalyticsView />
        </TabsContent>
        <TabsContent value="google">
          <CapabilityPlaceholder
            capability="Google performance"
            flag="GBP_PERFORMANCE_ENABLED"
            enabled={googlePerformanceEnabled}
            description="Impressions, searches, calls, direction requests, and website clicks from the Business Profile Performance API."
          />
        </TabsContent>
      </Tabs>
    </PageFrame>
  )
}
```

This depends on `CapabilityPlaceholder`, created in Task 12. Until then, temporarily replace the `TabsContent value="google"` body with:

```tsx
          <EmptyData message="Google performance ingestion is not enabled yet." />
```

importing `EmptyData` from `shared.tsx`, and revisit in Task 12.

- [ ] **Step 5: Create the page and redirect**

`app/(dashboard)/performance/page.tsx`:

```tsx
import { PerformanceView } from "@/components/naba-presence/performance-view"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return <PerformanceView googlePerformanceEnabled={false} />
}
```

The literal `false` is replaced by the real flag read in Task 12.

Replace the whole of `app/(dashboard)/analytics/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

export default function AnalyticsPage() {
  redirect("/performance")
}
```

Remove `AnalyticsRoute` from `route-views.tsx`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/performance.spec.ts
```

Expected: PASS both tests.

- [ ] **Step 7: Commit**

```bash
git add app components/naba-presence tests/e2e/performance.spec.ts
git commit -m "feat: add /performance with reply and Google tabs"
```

---

## Task 5: Split settings into four routes

**Files:**
- Create: `components/naba-presence/settings/use-organisation-settings.ts`
- Create: `components/naba-presence/settings/settings-nav.tsx`
- Create: `components/naba-presence/settings-policy-view.tsx`
- Create: `components/naba-presence/settings-team-view.tsx`
- Create: `components/naba-presence/settings-compliance-view.tsx`
- Create: `app/(dashboard)/settings/team/page.tsx`, `app/(dashboard)/settings/compliance/page.tsx`
- Modify: `app/(dashboard)/settings/page.tsx`
- Delete: `components/naba-presence/settings-view.tsx`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings`, `loadMembers`, `loadInternalLocations`, `loadInvitations`, `createInvitation`, `updateMember`, `saveLocationAssignments`, `createPrivacyRequest`, and the `OrganisationSettings`, `OrganisationMember`, `Invitation`, `InternalLocation` types from `lib/naba-presence-api.ts`.
- Produces:
  - `useOrganisationSettings()` returning `{ settings, setSettings, status, save, isSaving, reload }` where `settings: OrganisationSettings | null` and `save: () => Promise<void>`.
  - `SettingsNav()` taking no props.
  - `SettingsPolicyView()`, `SettingsTeamView()`, `SettingsComplianceView()`, all taking no props.

`components/naba-presence/settings-view.tsx` card boundaries, for reference when moving:

| Lines | Card | Destination |
| --- | --- | --- |
| 333-427 | Publishing safeguards | `settings-policy-view.tsx` |
| 429-637 | Team access | `settings-team-view.tsx` |
| 639-685 | Language and timezone | `settings-policy-view.tsx` |
| 687-748 | Data retention | `settings-compliance-view.tsx` |
| 750-856 | Compliance tools | `settings-compliance-view.tsx` |

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/settings.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const routes = [
  { path: "/settings", heading: /^Reply policy$/ },
  { path: "/settings/team", heading: /^Team access$/ },
  { path: "/settings/compliance", heading: /^Data and compliance$/ },
  { path: "/settings/connections", heading: /Google Business Profile$/ },
]

test("each settings area has its own URL", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path)
    await expect(page).toHaveURL(route.path)
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible()
  }
})

test("connections redirects under settings", async ({ page }) => {
  await page.goto("/connections")

  await expect(page).toHaveURL("/settings/connections")
})
```

`/settings/connections` is created in Task 6; this test will not fully pass until then. That is expected and is called out in Task 6's steps.

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/settings.spec.ts
```

Expected: FAIL on `/settings/team`.

- [ ] **Step 3: Create the shared settings hook**

`components/naba-presence/settings/use-organisation-settings.ts`:

```ts
"use client"

import { useCallback, useEffect, useState, useTransition } from "react"

import {
  loadSettings,
  type OrganisationSettings,
  saveSettings,
} from "@/lib/naba-presence-api"

export type SettingsStatus = "loading" | "ready" | "error"

export function useOrganisationSettings() {
  const [settings, setSettings] = useState<OrganisationSettings | null>(null)
  const [status, setStatus] = useState<SettingsStatus>("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    let active = true
    void loadSettings()
      .then(({ settings: loaded }) => {
        if (!active) return
        setSettings(loaded)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setSettings(null)
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }, [])

  const save = useCallback(async () => {
    if (!settings) return
    await new Promise<void>((resolve) => {
      startSaving(() => {
        void saveSettings(settings).then(
          () => resolve(),
          () => resolve()
        )
      })
    })
  }, [settings])

  return { settings, setSettings, status, save, isSaving, reload }
}
```

- [ ] **Step 4: Create the settings sub-navigation**

`components/naba-presence/settings/settings-nav.tsx`:

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/settings", label: "Reply policy" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/compliance", label: "Data and compliance" },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Settings sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex items-center rounded-(--nr-radius-chip) px-3 py-1.5 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60"
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 5: Create the three view files by moving card blocks**

For each of `settings-policy-view.tsx`, `settings-team-view.tsx`, and `settings-compliance-view.tsx`:

1. Start from the header of `settings-view.tsx` (its `"use client"` line and imports), keeping only the imports that file actually uses.
2. Move the card blocks named in the table above verbatim.
3. Move only the state declarations and handlers those cards reference. `settings-view.tsx:83-112` lists every state variable; assign each to the file whose cards read it.
4. Replace the settings-derived state (`approvalRequired`, `requireTwoPersonApproval`, `retentionDays`, `defaultLanguage`, `defaultTimezone`, `directPublishConsent`) with reads and writes through `useOrganisationSettings()`.
5. Wrap each in `<PageFrame>` with a `<PageHeader>` whose `title` matches the e2e expectation: `"Reply policy"`, `"Team access"`, `"Data and compliance"`.
6. Render `<SettingsNav />` immediately after the `PageHeader` in all three.

Keep the loading and error branches from `settings-view.tsx:167` onward in each file, scoped to that file's own status.

- [ ] **Step 6: Create the pages**

`app/(dashboard)/settings/page.tsx`:

```tsx
import { SettingsPolicyView } from "@/components/naba-presence/settings-policy-view"

export const metadata = { title: "Reply policy · NabaPresence" }

export default function SettingsPage() {
  return <SettingsPolicyView />
}
```

`app/(dashboard)/settings/team/page.tsx`:

```tsx
import { SettingsTeamView } from "@/components/naba-presence/settings-team-view"

export const metadata = { title: "Team · NabaPresence" }

export default function SettingsTeamPage() {
  return <SettingsTeamView />
}
```

`app/(dashboard)/settings/compliance/page.tsx`:

```tsx
import { SettingsComplianceView } from "@/components/naba-presence/settings-compliance-view"

export const metadata = { title: "Data and compliance · NabaPresence" }

export default function SettingsCompliancePage() {
  return <SettingsComplianceView />
}
```

Delete `components/naba-presence/settings-view.tsx` and remove `SettingsRoute` from `route-views.tsx`.

- [ ] **Step 7: Verify types and the settings journey**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/journeys.spec.ts -g "settings"
```

Expected: `pnpm typecheck` PASS. The journeys settings test navigates to `/settings` and saves; it must still pass because `PATCH /api/settings` is unchanged.

- [ ] **Step 8: Commit**

```bash
git add app components/naba-presence tests/e2e/settings.spec.ts
git commit -m "refactor: split settings into policy, team, and compliance routes"
```

---

## Task 6: Move connections under settings

**Files:**
- Create: `app/(dashboard)/settings/connections/page.tsx`
- Modify: `app/(dashboard)/connections/page.tsx` (becomes a redirect)
- Modify: `components/naba-presence/connections-view.tsx`
- Modify: `components/naba-presence/route-views.tsx` (remove `ConnectionsRoute`)
- Delete: `app/api/analytics/locations/[id]/route.ts`

**Interfaces:**
- Consumes: `ConnectionsView` from `connections-view.tsx`, currently `({ onNavigate }: { onNavigate?: () => void })`.
- Produces: `ConnectionsView` keeps its signature. It gains a `<SettingsNav />` render and an operations-health card moved from the deleted overview.

- [ ] **Step 1: Write the failing test**

The `/settings/connections` cases already exist in `tests/e2e/settings.spec.ts` from Task 5.

```bash
pnpm test:e2e -- tests/e2e/settings.spec.ts
```

Expected: FAIL on `/settings/connections`.

- [ ] **Step 2: Add the settings navigation and health card to `ConnectionsView`**

In `components/naba-presence/connections-view.tsx`, render `<SettingsNav />` immediately after the existing `PageHeader` near line 567, importing it from `@/components/naba-presence/settings/settings-nav`.

Then add the operations-health card that used to live in `overview-view.tsx:291-348`. Recreate it here as a `Card` titled `"Operations health"` with three rows built from the connection already loaded in this view:

```tsx
              <HealthRow
                label="Google connection"
                detail={
                  connection
                    ? connection.status === "active" &&
                      !connection.reconnectRequired
                      ? `Active${connection.lastRefreshAt ? ` · refreshed ${formatTimestamp(connection.lastRefreshAt)}` : ""}`
                      : connection.reconnectRequired
                        ? "Reconnect required"
                        : connection.status
                    : "Not connected"
                }
                healthy={
                  connection?.status === "active" &&
                  !connection.reconnectRequired
                }
              />
              <HealthRow
                label="Google notifications"
                detail={
                  connection?.notificationsEnabled
                    ? "Configured"
                    : "Not configured · scheduled sync remains available"
                }
                healthy={Boolean(connection?.notificationsEnabled)}
              />
```

Copy the `HealthRow` function verbatim from `overview-view.tsx:354-378` into `connections-view.tsx`. Drop the third row (raw-content retention), which now belongs to `/settings/compliance`.

- [ ] **Step 3: Create the page and redirect**

`app/(dashboard)/settings/connections/page.tsx`:

```tsx
import { ConnectionsSettingsRoute } from "@/components/naba-presence/route-views"

export const metadata = { title: "Connections · NabaPresence" }

export default function SettingsConnectionsPage() {
  return <ConnectionsSettingsRoute />
}
```

In `route-views.tsx`, replace `ConnectionsRoute` with:

```tsx
export function ConnectionsSettingsRoute() {
  const router = useRouter()
  return <ConnectionsView onNavigate={() => router.push("/settings")} />
}
```

Replace the whole of `app/(dashboard)/connections/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

export default function ConnectionsPage() {
  redirect("/settings/connections")
}
```

- [ ] **Step 4: Delete the orphaned API route**

```bash
git rm -r "app/api/analytics/locations"
```

Confirm nothing referenced it:

```bash
grep -rn "analytics/locations" app components lib hooks tests || echo "no references"
```

Expected: `no references`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/settings.spec.ts
```

Expected: PASS both tests.

- [ ] **Step 6: Commit**

```bash
git add -A app components/naba-presence
git commit -m "refactor: move connections under settings and drop orphaned analytics route"
```

---

## Task 7: Add the `/locations` index

**Files:**
- Create: `components/naba-presence/locations-index-view.tsx`
- Create: `app/(dashboard)/locations/page.tsx`

**Interfaces:**
- Consumes: `loadInternalLocations()` returning `{ locations: InternalLocation[] }` where `InternalLocation` is `{ locationId, name, timezone, address, linkId, externalLocationId, googleLocationName, googleTitle, verified }`; `loadAnalytics()` for per-location rating and unresolved counts.
- Produces: `export function LocationsIndexView()`, no props. Also `export function formatStorefrontAddress(address: StorefrontAddress | null): string`, reused by Task 8.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/locations.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("locations index lists linked locations", async ({ page }) => {
  await page.goto("/locations")

  await expect(
    page.getByRole("heading", { name: "Locations", level: 1 })
  ).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible()
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/locations.spec.ts
```

Expected: FAIL. `/locations` returns 404.

- [ ] **Step 3: Create `locations-index-view.tsx`**

```tsx
"use client"

import { Store } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  type AnalyticsOverview,
  type InternalLocation,
  loadAnalytics,
  loadInternalLocations,
  type StorefrontAddress,
} from "@/lib/naba-presence-api"
import {
  EmptyData,
  LiveDataError,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"

export function formatStorefrontAddress(
  address: StorefrontAddress | null
): string {
  if (!address) return "—"
  const parts = [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ].filter((part): part is string => Boolean(part && part.trim()))
  return parts.length ? parts.join(", ") : "—"
}

export function LocationsIndexView() {
  const [locations, setLocations] = useState<InternalLocation[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86400000)
    void Promise.all([
      loadInternalLocations(),
      loadAnalytics({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: "day",
      }),
    ])
      .then(([locationResult, analyticsResult]) => {
        if (!active) return
        setLocations(locationResult.locations)
        setAnalytics(analyticsResult)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  function retry() {
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }

  const metricsByName = new Map(
    (analytics?.locations ?? []).map((entry) => [entry.name, entry])
  )

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Locations"
        description="Every location in this organisation and the state of its Google link."
      />

      {status === "error" ? <LiveDataError onRetry={retry} /> : null}

      <Card>
        <CardContent className="overflow-x-auto">
          {status === "loading" ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : locations.length ? (
            <Table className="min-w-[720px]" tabIndex={0}>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead className="text-right">Needs reply</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((location) => {
                  const metrics = metricsByName.get(location.name)
                  return (
                    <TableRow key={location.locationId}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/locations/${location.locationId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {location.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatStorefrontAddress(location.address)}
                      </TableCell>
                      <TableCell>
                        {location.linkId ? (
                          location.verified ? (
                            <Badge variant="secondary">Linked</Badge>
                          ) : (
                            <Badge variant="outline">Unverified</Badge>
                          )
                        ) : (
                          <Badge variant="outline">Not linked</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {metrics?.averageRating === null ||
                        metrics === undefined
                          ? "—"
                          : metrics.averageRating.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {metrics ? metrics.unresolvedComplaints : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyData message="No locations exist yet. Connect Google and link a verified location to begin." />
          )}
        </CardContent>
      </Card>
    </PageFrame>
  )
}
```

Note the `Store` import is used by Task 8's header; remove it here if lint flags it as unused.

- [ ] **Step 4: Create the page**

`app/(dashboard)/locations/page.tsx`:

```tsx
import { LocationsIndexView } from "@/components/naba-presence/locations-index-view"

export const metadata = { title: "Locations · NabaPresence" }

export default function LocationsPage() {
  return <LocationsIndexView />
}
```

The single-location redirect is deliberately **not** implemented here. Doing it server-side would require a session-scoped database read in a page that currently has none. It is added in Task 9 once the workspace exists to redirect into.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/locations.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app components/naba-presence tests/e2e/locations.spec.ts
git commit -m "feat: add the locations index"
```

---

## Task 8: Add the location workspace shell

**Files:**
- Create: `components/naba-presence/location-workspace.tsx`
- Create: `components/naba-presence/location-profile-view.tsx`
- Create: `app/(dashboard)/locations/[id]/layout.tsx`, `app/(dashboard)/locations/[id]/page.tsx`
- Create: `app/(dashboard)/locations/[id]/reviews/page.tsx`
- Modify: `components/naba-presence/shared.tsx` (`BusinessContext` prop rename)

**Interfaces:**
- Consumes: `loadInternalLocations()`, `loadConnections()`, `formatStorefrontAddress` from `locations-index-view.tsx`, `BusinessContext` from `shared.tsx`, `Combobox` from `components/ui/combobox`.
- Produces:
  - `export function LocationWorkspace({ locationId, children }: { locationId: string; children: React.ReactNode })`
  - `export function LocationProfileView({ locationId }: { locationId: string })`
  - `BusinessContext` prop `organisationName` is renamed to `name`. Its `detail` and `status` props are unchanged.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/locations.spec.ts`:

```ts
test("location workspace exposes capability tabs", async ({ page }) => {
  await page.goto("/locations")
  await page.getByRole("link", { name: /.+/ }).first().click()

  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/)
  await expect(page.getByRole("link", { name: "Profile" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Reviews" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Hours" })).toBeVisible()
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/locations.spec.ts -g "capability tabs"
```

Expected: FAIL. The workspace route does not exist.

- [ ] **Step 3: Rename the `BusinessContext` prop**

In `components/naba-presence/shared.tsx`, change `BusinessContext`'s first prop from `organisationName` to `name` in both the destructuring and the type, and update the `<p>` that renders it:

```tsx
export function BusinessContext({
  name,
  detail,
  status,
}: {
  name: string
  detail?: React.ReactNode
  status?: { label: string; value: string }
}) {
```

```tsx
          <p className="truncate font-medium">{name}</p>
```

Do not touch the `status` block, the `--nr-surface-card-translucent` class, or the function's export form — `tests/design-system-contract.test.ts` asserts all three.

Its only current caller was `overview-view.tsx`, already deleted in Task 2, so no other call site needs updating.

- [ ] **Step 4: Create `location-workspace.tsx`**

```tsx
"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type GoogleConnection,
  type InternalLocation,
  loadConnections,
  loadInternalLocations,
} from "@/lib/naba-presence-api"
import { formatStorefrontAddress } from "@/components/naba-presence/locations-index-view"
import { BusinessContext, PageFrame } from "@/components/naba-presence/shared"
import { cn } from "@/lib/utils"

const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "reviews", label: "Reviews" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "menu", label: "Menu" },
  { segment: "qa", label: "Q&A" },
  { segment: "booking", label: "Booking" },
  { segment: "performance", label: "Performance" },
]

export function LocationWorkspace({
  locationId,
  children,
}: {
  locationId: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [locations, setLocations] = useState<InternalLocation[]>([])
  const [connections, setConnections] = useState<GoogleConnection[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )

  useEffect(() => {
    let active = true
    void Promise.all([loadInternalLocations(), loadConnections()])
      .then(([locationResult, connectionResult]) => {
        if (!active) return
        setLocations(locationResult.locations)
        setConnections(connectionResult.connections)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [])

  const current = locations.find(
    (location) => location.locationId === locationId
  )
  const connection =
    connections.find((item) => item.status === "active") ?? connections[0]
  const base = `/locations/${locationId}`
  const activeSegment = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "")
    : ""

  return (
    <PageFrame width="wide">
      {status === "loading" ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <BusinessContext
          name={current?.name ?? "Location"}
          detail={
            <span className="flex flex-col gap-1">
              <span>{formatStorefrontAddress(current?.address ?? null)}</span>
              <span className="flex flex-wrap gap-1.5">
                {current?.linkId ? (
                  <Badge variant="secondary">Linked</Badge>
                ) : (
                  <Badge variant="outline">Not linked</Badge>
                )}
                {current?.verified ? (
                  <Badge variant="secondary">Verified</Badge>
                ) : null}
                {connection?.reconnectRequired ? (
                  <Badge variant="destructive">Reconnect required</Badge>
                ) : null}
              </span>
            </span>
          }
          status={
            locations.length > 1
              ? { label: "Location", value: `${locations.length} total` }
              : undefined
          }
        />
      )}

      {locations.length > 1 ? (
        <Combobox
          items={locations.map((location) => location.name)}
          value={current?.name ?? ""}
          onValueChange={(value) => {
            const next = locations.find((location) => location.name === value)
            if (next) {
              router.push(
                `/locations/${next.locationId}${activeSegment ? `/${activeSegment}` : ""}`
              )
            }
          }}
        >
          <ComboboxInput
            placeholder="Switch location"
            aria-label="Switch location"
            className="max-w-sm"
          />
          <ComboboxContent>
            <ComboboxEmpty>No locations found.</ComboboxEmpty>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : null}

      <nav aria-label="Location sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base
            const isActive = activeSegment === tab.segment
            return (
              <li key={tab.label}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center rounded-(--nr-radius-chip) px-3 py-1.5 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60"
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {children}
    </PageFrame>
  )
}
```

Check the real `Combobox` export names and render-prop shape against `components/ui/combobox.tsx` and the existing usage at `components/naba-presence/reviews-view.tsx:580-600` before finalising — match that call site exactly rather than the sketch above.

- [ ] **Step 5: Create `location-profile-view.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type InternalLocation,
  loadInternalLocations,
} from "@/lib/naba-presence-api"
import { formatStorefrontAddress } from "@/components/naba-presence/locations-index-view"
import { LiveDataError } from "@/components/naba-presence/shared"

export function LocationProfileView({ locationId }: { locationId: string }) {
  const [location, setLocation] = useState<InternalLocation | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void loadInternalLocations()
      .then(({ locations }) => {
        if (!active) return
        setLocation(
          locations.find((item) => item.locationId === locationId) ?? null
        )
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [locationId, reloadKey])

  if (status === "error") {
    return (
      <LiveDataError
        onRetry={() => {
          setStatus("loading")
          setReloadKey((value) => value + 1)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Identity NabaPresence currently stores for this location
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {status === "loading" ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : (
            <>
              <Field label="Name" value={location?.name ?? "—"} />
              <Field
                label="Google title"
                value={location?.googleTitle ?? "—"}
              />
              <Field
                label="Address"
                value={formatStorefrontAddress(location?.address ?? null)}
              />
              <Field label="Timezone" value={location?.timezone ?? "—"} />
              <Field
                label="Google resource"
                value={location?.googleLocationName ?? "Not linked"}
              />
              <Field
                label="Verified"
                value={
                  location?.verified === null || location === null
                    ? "—"
                    : location.verified
                      ? "Yes"
                      : "No"
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Editing is not available yet</AlertTitle>
        <AlertDescription>
          Description, website, phone, categories, and hours are not stored
          durably yet. Editing this location&apos;s Google profile from
          NabaPresence arrives with the profile dual-sync workstream; until
          then, change these in Google Business Profile.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  )
}
```

- [ ] **Step 6: Create the layout and the two real tab pages**

`app/(dashboard)/locations/[id]/layout.tsx`:

```tsx
import { LocationWorkspace } from "@/components/naba-presence/location-workspace"

export default async function LocationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationWorkspace locationId={id}>{children}</LocationWorkspace>
}
```

Confirm the `params` promise convention against `node_modules/next/dist/docs/` before relying on it.

`app/(dashboard)/locations/[id]/page.tsx`:

```tsx
import { LocationProfileView } from "@/components/naba-presence/location-profile-view"

export const metadata = { title: "Location profile · NabaPresence" }

export default async function LocationProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationProfileView locationId={id} />
}
```

`app/(dashboard)/locations/[id]/reviews/page.tsx`:

```tsx
import { LocationReviewsRoute } from "@/components/naba-presence/route-views"

export const metadata = { title: "Location reviews · NabaPresence" }

export default async function LocationReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationReviewsRoute locationId={id} />
}
```

Add to `route-views.tsx`, reusing the existing workspace until Task 11 splits it:

```tsx
export function LocationReviewsRoute({ locationId }: { locationId: string }) {
  const {
    reviews,
    setReviews,
    selectedId,
    setSelectedId,
    apiStatus,
    counts,
    refreshCounts,
    connectionState,
    lastRefreshedAt,
    refreshReviews,
  } = useNabaPresenceDashboard()

  return (
    <ReviewsWorkspace
      reviews={reviews.filter((review) => review.locationId === locationId)}
      setReviews={setReviews}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      apiStatus={apiStatus}
      counts={counts}
      refreshCounts={refreshCounts}
      connectionState={connectionState}
      lastRefreshedAt={lastRefreshedAt}
      onRefresh={refreshReviews}
    />
  )
}
```

This client-side filter is a deliberate placeholder. Task 11 replaces it with server-side location scoping.

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/locations.spec.ts
```

Expected: PASS all three location tests.

- [ ] **Step 8: Commit**

```bash
git add app components/naba-presence
git commit -m "feat: add the location workspace shell and profile tab"
```

---

## Task 9: Redirect a single-location organisation into its workspace

**Files:**
- Modify: `app/(dashboard)/locations/page.tsx`
- Create: `lib/server/locations.ts`

**Interfaces:**
- Consumes: `getSession()` from `lib/server/session.ts`; the tenant-scoped database helper in `lib/server/db.ts`.
- Produces: `export async function listLinkedLocationIds(): Promise<string[]>` in `lib/server/locations.ts`.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/locations.spec.ts`:

```ts
test("a single-location organisation lands in the workspace", async ({
  page,
}) => {
  await page.goto("/locations")

  // The journey tenant seeds exactly one linked location.
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/)
})
```

Before writing this, confirm how many locations `tests/e2e/helpers/stub-bridge.ts` seeds via `createTestTenant` and `seedLinkedReview`. If it seeds more than one, invert the assertion to expect the index and drop this test, recording why in the commit message. Do not assume.

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/locations.spec.ts -g "single-location"
```

Expected: FAIL. `/locations` renders the index.

- [ ] **Step 3: Add the server helper**

`lib/server/locations.ts`:

```ts
import "server-only"

import { withTenant } from "@/lib/server/db"
import { getSession } from "@/lib/server/session"

export async function listLinkedLocationIds(): Promise<string[]> {
  const session = await getSession()
  if (!session) return []
  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql<{ location_id: string }[]>`
      select l.id as location_id
      from location l
      join location_link ll
        on ll.location_id = l.id
       and ll.is_active = true
      order by l.name asc
    `
    return rows.map((row) => row.location_id)
  })
}
```

Match `withTenant`'s real name and signature to whatever `lib/server/db.ts` exports — read that file first. The query must run through the tenant-scoped helper so forced RLS applies; never use an admin connection here.

- [ ] **Step 4: Redirect in the page**

Replace `app/(dashboard)/locations/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

import { LocationsIndexView } from "@/components/naba-presence/locations-index-view"
import { listLinkedLocationIds } from "@/lib/server/locations"

export const metadata = { title: "Locations · NabaPresence" }

export default async function LocationsPage() {
  const ids = await listLinkedLocationIds()
  if (ids.length === 1) redirect(`/locations/${ids[0]}`)
  return <LocationsIndexView />
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm typecheck && pnpm test:e2e -- tests/e2e/locations.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app lib/server/locations.ts tests/e2e/locations.spec.ts
git commit -m "feat: send single-location organisations straight to their workspace"
```

---

## Task 10: Switch the sidebar and root redirect

**Files:**
- Modify: `components/naba-presence/app-shell.tsx:1-60`, `:107`, `:112-125`
- Modify: `app/page.tsx`
- Modify: `tests/e2e/routing.spec.ts` (rewrite)
- Modify: `tests/e2e/journeys.spec.ts`, `tests/e2e/accessibility.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NAV_ITEMS` becomes the five-item array below. `AppShell`'s props are unchanged.

- [ ] **Step 1: Rewrite the routing spec**

Replace the whole of `tests/e2e/routing.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const dashboardRoutes = [
  { path: "/home", label: "Home", heading: /^Home$/ },
  { path: "/inbox", label: "Inbox", heading: /^Inbox$/ },
  { path: "/performance", label: "Performance", heading: /^Performance$/ },
  { path: "/settings", label: "Settings", heading: /^Reply policy$/ },
]

test("dashboard pages have direct URLs", async ({ page }) => {
  for (const route of dashboardRoutes) {
    await page.goto(route.path)
    await expect(page).toHaveURL(route.path)
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: route.label, exact: true })
    ).toHaveAttribute("aria-current", "page")
  }
})

test("root redirects to home", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL("/home")
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 })
  ).toBeVisible()
})

test("legacy routes redirect to their replacements", async ({ page }) => {
  for (const [from, to] of [
    ["/overview", "/home"],
    ["/reviews", "/inbox"],
    ["/analytics", "/performance"],
    ["/connections", "/settings/connections"],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
})

test("sidebar links update browser history", async ({ page }) => {
  await page.goto("/inbox")

  await page.getByRole("link", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL("/home")

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page).toHaveURL("/settings")

  await page.goBack()
  await expect(page).toHaveURL("/home")
})
```

`Locations` is excluded from `dashboardRoutes` because Task 9 makes its URL depend on the tenant's location count; it is covered by `locations.spec.ts`.

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/routing.spec.ts
```

Expected: FAIL. The sidebar still shows the old five labels and `/` still lands on `/reviews`.

- [ ] **Step 3: Replace `NAV_ITEMS` and the sidebar mark**

In `components/naba-presence/app-shell.tsx`, replace lines 54-60:

```tsx
const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/locations", label: "Locations", icon: Store },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
]
```

Update the `lucide-react` import block on lines 3-14 to import `Inbox`, `Store`, and `TrendingUp`, and to drop `BarChart3`, `Link2`, and `MessageSquareText` if nothing else uses them.

Replace the sidebar mark on line 115:

```tsx
              <Store className="size-4" aria-hidden />
```

- [ ] **Step 4: Fix the post-switch destination**

`components/naba-presence/app-shell.tsx:107` currently reads:

```tsx
    window.location.assign("/reviews")
```

Change it to:

```tsx
    window.location.assign("/home")
```

- [ ] **Step 5: Fix the root redirect**

In `app/page.tsx`, change the final line from:

```tsx
  redirect(session || allowAnonymous ? "/reviews" : "/sign-in")
```

to:

```tsx
  redirect(session || allowAnonymous ? "/home" : "/sign-in")
```

- [ ] **Step 6: Update the other two e2e specs**

In `tests/e2e/journeys.spec.ts`, change the `page.goto` targets: line 19 `/reviews` to `/inbox`, line 53 `/analytics` to `/performance`, line 99 `/reviews` to `/inbox`, line 116 `/reviews` to `/inbox`, line 143 `/connections` to `/settings/connections`. Line 65 `/settings` is unchanged. Leave every `/api/*` interception alone.

In `tests/e2e/accessibility.spec.ts`, change line 208 `/reviews` to `/inbox`, line 366 `/overview` to `/home`, line 441 `/analytics` to `/performance`, and the connections target near line 501 to `/settings/connections`. Add two further passes covering `/locations` and a location workspace tab, following the existing pattern in that file.

- [ ] **Step 7: Update the README**

In `README.md`, change the "What is implemented" first bullet from:

```
- Responsive review inbox, detail/editor, overview, analytics, connections, and
  policy settings
```

to:

```
- Location-centred workspace covering profile identity and reviews, plus a
  cross-location review inbox, organisation roll-up, reply performance
  reporting, Google connection management, team access, and compliance tools
```

Change the opening description from "NabaPresence is a reputation operations SaaS" to "NabaPresence is a Google Business Profile management platform", and leave the rest of that paragraph — which accurately describes the review workflow — intact.

- [ ] **Step 8: Run the full e2e suite**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected: PASS. This is the first point at which the whole suite should be green against the new IA.

- [ ] **Step 9: Commit**

```bash
git add components/naba-presence/app-shell.tsx app/page.tsx tests/e2e README.md
git commit -m "feat: switch navigation to the location-centred information architecture"
```

---

# Phase 2 — Reviews decomposition

Phase 2 is a **pure move with no behaviour change.** The gate for every task is that these four suites pass unchanged:

```bash
pnpm test:integration -- tests/integration/routes/publish-lifecycle.test.ts tests/integration/routes/approval.test.ts tests/integration/routes/delete-lifecycle.test.ts tests/integration/routes/reply-harness.test.ts
```

Run that command **before starting Task 11** and record the result. If any of it is already failing, stop: you cannot distinguish a pre-existing failure from one you introduced.

## Task 11: Extract the review detail pane

**Files:**
- Create: `components/naba-presence/reviews/review-detail.tsx`
- Modify: `components/naba-presence/reviews-view.tsx`

**Interfaces:**
- Consumes: everything `ReviewDetail` already imports in `reviews-view.tsx`.
- Produces: `export function ReviewDetail(...)` with its **existing** prop signature copied verbatim from `reviews-view.tsx:1046`, plus `export function VerificationPanel({ review }: { review: Review })` and the `ActivityTimeline` component. Read the exact signatures from the source before moving; do not retype them from memory.

- [ ] **Step 1: Record the green baseline**

```bash
pnpm test:integration -- tests/integration/routes/publish-lifecycle.test.ts tests/integration/routes/approval.test.ts tests/integration/routes/delete-lifecycle.test.ts tests/integration/routes/reply-harness.test.ts
```

Expected: PASS. Note the output. If it fails, stop and resolve that first.

- [ ] **Step 2: Move the three components verbatim**

Create `components/naba-presence/reviews/review-detail.tsx` and move these ranges from `reviews-view.tsx` without editing their bodies. **Cut and paste the real source; do not retype it** — these components carry the verification, approval, and publication logic, and a transcription slip here is a production defect.

- `1046-1658` — `ReviewDetail`
- `1659-1698` — `VerificationPanel`
- `1699-1750` — `ActivityTimeline`

Add `"use client"` as the first line. Copy across only the imports those three components use. Export `ReviewDetail`; keep `VerificationPanel` and `ActivityTimeline` module-private unless `ReviewsWorkspace` also references them, in which case export those too.

- [ ] **Step 3: Import it back**

In `reviews-view.tsx`, delete lines 1046-1750 and add:

```tsx
import { ReviewDetail } from "@/components/naba-presence/reviews/review-detail"
```

Remove any import in `reviews-view.tsx` that is now unused. `pnpm lint` will name them.

- [ ] **Step 4: Verify no behaviour changed**

```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/routes/publish-lifecycle.test.ts tests/integration/routes/approval.test.ts tests/integration/routes/delete-lifecycle.test.ts tests/integration/routes/reply-harness.test.ts
```

Expected: identical PASS output to Step 1.

- [ ] **Step 5: Commit**

```bash
git add components/naba-presence
git commit -m "refactor: extract review detail pane into its own module"
```

---

## Task 12: Extract the review list and filters

**Files:**
- Create: `components/naba-presence/reviews/review-list.tsx`
- Create: `components/naba-presence/reviews/review-filters.tsx`
- Modify: `components/naba-presence/reviews-view.tsx`

**Interfaces:**
- Produces:
  - `export function ReviewList({ reviews, selectedId, onSelect, selectedRowRef }: { reviews: Review[]; selectedId: string; onSelect: (id: string) => void; selectedRowRef: React.RefObject<HTMLButtonElement | null> })` wrapping the moved `ReviewRow`.
  - `export function ReviewFilters(props: ReviewFiltersProps)` with exactly this shape, one value/setter pair per filter state declared at `reviews-view.tsx:224-238`:

```tsx
export type ReviewFiltersProps = {
  queue: Queue
  onQueueChange: (value: Queue) => void
  counts: ReviewCounts
  rating: string
  onRatingChange: (value: string) => void
  query: string
  onQueryChange: (value: string) => void
  dateRange: string
  onDateRangeChange: (value: string) => void
  replyState: string
  onReplyStateChange: (value: string) => void
  verification: string
  onVerificationChange: (value: string) => void
  publishState: string
  onPublishStateChange: (value: string) => void
  syncState: string
  onSyncStateChange: (value: string) => void
  sort: "updated_desc" | "rating_desc" | "rating_asc"
  onSortChange: (value: "updated_desc" | "rating_desc" | "rating_asc") => void
  filtersOpen: boolean
  onFiltersOpenChange: (value: boolean) => void
  onReset: () => void
  showLocationFilter: boolean
  location: string
  onLocationChange: (value: string) => void
  locationItems: string[]
}
```

`Queue` and `ReviewCounts` must be imported by `review-filters.tsx` — `Queue` from `review-queue.tsx` (export it there) and `ReviewCounts` from `lib/naba-presence-api.ts`. `onReset` is the existing reset handler at `reviews-view.tsx:413`.

- [ ] **Step 1: Move `ReviewRow` into `review-list.tsx`**

Move `reviews-view.tsx:983-1045` verbatim. Add `"use client"`. Add a `ReviewList` wrapper that renders the list container currently inline in `ReviewsWorkspace` and maps rows through `ReviewRow`.

- [ ] **Step 2: Move the filter controls into `review-filters.tsx`**

Move the filter bar JSX out of `ReviewsWorkspace`. Add the `showLocationFilter` prop, and render the location `Combobox` — currently at `reviews-view.tsx:580-600` — only when it is `true`.

- [ ] **Step 3: Wire both back into `ReviewsWorkspace`**

`ReviewsWorkspace` keeps all its `useState` declarations and passes them down. State does not move; only JSX moves.

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test:e2e -- tests/e2e/inbox.spec.ts tests/e2e/journeys.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/naba-presence
git commit -m "refactor: extract review list and filter bar"
```

---

## Task 13: Introduce `review-queue.tsx` with location scoping

**Files:**
- Create: `components/naba-presence/reviews/review-queue.tsx`
- Delete: `components/naba-presence/reviews-view.tsx`
- Modify: `components/naba-presence/route-views.tsx`

**Interfaces:**
- Produces: `export function ReviewQueue(props)` — the former `ReviewsWorkspace` ten-prop signature plus `locationId?: string` and `heading: { title: string; description: string }`.
- When `locationId` is set: it is passed into `loadReviewsPage`'s server filters, `showLocationFilter` is `false`, and `refreshCounts(locationId)` is called instead of `refreshCounts()`.
- When `locationId` is absent: behaviour is identical to today's `ReviewsWorkspace`.

- [ ] **Step 1: Rename and extend**

Rename `reviews-view.tsx` to `reviews/review-queue.tsx` and rename `ReviewsWorkspace` to `ReviewQueue`. Add the two new props.

- [ ] **Step 2: Replace the client-side filter with server scoping**

In `ReviewQueue`, where `serverFilters` is built at `reviews-view.tsx:269`, force the location when `locationId` is present so the server filters rather than the client:

```tsx
      locationId: locationId ?? selectedLocationId,
```

Then delete the client-side `reviews.filter(...)` placeholder that Task 8 added to `LocationReviewsRoute`.

- [ ] **Step 3: Update both route wrappers**

`InboxRoute` passes no `locationId` and `heading={{ title: "Inbox", description: "Google reviews awaiting a reply, approval, or publication across every linked location." }}`.

`LocationReviewsRoute` passes `locationId` and `heading={{ title: "Reviews", description: "Every Google review for this location." }}`, and passes the unfiltered `reviews` array.

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected: PASS. Confirm `/locations/{id}/reviews` shows no location filter and `/inbox` still does.

- [ ] **Step 5: Commit**

```bash
git add -A components/naba-presence
git commit -m "refactor: unify inbox and location reviews behind ReviewQueue"
```

---

# Phase 3 — Placeholders and flags

## Task 14: Add the six GBP feature flags

**Files:**
- Modify: `lib/server/env.ts:101-106`
- Modify: `.env.example`
- Test: `tests/env-flags.test.ts`

**Interfaces:**
- Produces: `getServerEnv()` gains six boolean fields, all defaulting to `false`: `GBP_PERFORMANCE_ENABLED`, `GBP_POSTS_ENABLED`, `GBP_MEDIA_ENABLED`, `GBP_FOOD_MENUS_ENABLED`, `GBP_PLACE_ACTIONS_ENABLED`, `GBP_QA_ENABLED`.

- [ ] **Step 1: Write the failing test**

Append to `tests/env-flags.test.ts`:

```ts
it("defaults every GBP capability flag to false", () => {
  const env = serverEnvSchema.parse(baseEnv())

  expect(env.GBP_PERFORMANCE_ENABLED).toBe(false)
  expect(env.GBP_POSTS_ENABLED).toBe(false)
  expect(env.GBP_MEDIA_ENABLED).toBe(false)
  expect(env.GBP_FOOD_MENUS_ENABLED).toBe(false)
  expect(env.GBP_PLACE_ACTIONS_ENABLED).toBe(false)
  expect(env.GBP_QA_ENABLED).toBe(false)
})
```

Read `tests/env-flags.test.ts` first to match how it currently builds a valid environment; reuse that helper rather than inventing `baseEnv()`.

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test -- tests/env-flags.test.ts
```

Expected: FAIL. The properties do not exist.

- [ ] **Step 3: Add the flags**

After `lib/server/env.ts:106`, inside the schema object:

```ts
  GBP_PERFORMANCE_ENABLED: featureFlag(false),
  GBP_POSTS_ENABLED: featureFlag(false),
  GBP_MEDIA_ENABLED: featureFlag(false),
  GBP_FOOD_MENUS_ENABLED: featureFlag(false),
  GBP_PLACE_ACTIONS_ENABLED: featureFlag(false),
  GBP_QA_ENABLED: featureFlag(false),
```

- [ ] **Step 4: Document them**

Add to `.env.example`, matching the file's existing comment style:

```
# Google Business Profile capability flags. All default to false; each is
# enabled only when its workstream has passed live certification.
GBP_PERFORMANCE_ENABLED=false
GBP_POSTS_ENABLED=false
GBP_MEDIA_ENABLED=false
GBP_FOOD_MENUS_ENABLED=false
GBP_PLACE_ACTIONS_ENABLED=false
GBP_QA_ENABLED=false
```

- [ ] **Step 5: Verify**

```bash
pnpm test -- tests/env-flags.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/env.ts .env.example tests/env-flags.test.ts
git commit -m "feat: add GBP capability feature flags defaulting to off"
```

---

## Task 15: Add the capability placeholder and six tab routes

**Files:**
- Create: `components/naba-presence/capability-placeholder.tsx`
- Create: `app/(dashboard)/locations/[id]/{hours,photos,posts,menu,qa,booking,performance}/page.tsx`
- Modify: `app/(dashboard)/performance/page.tsx`
- Modify: `components/naba-presence/performance-view.tsx`

**Interfaces:**
- Consumes: `getServerEnv()` from `lib/server/env.ts`, read in each server page and passed down as a boolean. **Never import `lib/server/env.ts` into a client component** — it is `server-only` and will fail the build.
- Produces: `export function CapabilityPlaceholder({ capability, flag, enabled, description }: { capability: string; flag: string; enabled: boolean; description: string })`.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/capability-tabs.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const tabs = [
  { segment: "hours", capability: "Hours" },
  { segment: "photos", capability: "Photos" },
  { segment: "posts", capability: "Posts" },
  { segment: "menu", capability: "Menu" },
  { segment: "qa", capability: "Q&A" },
  { segment: "booking", capability: "Booking" },
  { segment: "performance", capability: "Performance" },
]

test("each unbuilt capability tab states its status", async ({ page }) => {
  await page.goto("/locations")
  await page.waitForURL(/\/locations\/[0-9a-f-]+/)
  const base = new URL(page.url()).pathname

  for (const tab of tabs) {
    await page.goto(`${base}/${tab.segment}`)
    await expect(
      page.getByRole("heading", { name: tab.capability })
    ).toBeVisible()
    await expect(page.getByText("not enabled")).toBeVisible()
  }
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm test:e2e -- tests/e2e/capability-tabs.spec.ts
```

Expected: FAIL. All seven segments return 404.

- [ ] **Step 3: Create the placeholder component**

```tsx
"use client"

import { Lock } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"

export function CapabilityPlaceholder({
  capability,
  flag,
  enabled,
  description,
}: {
  capability: string
  flag: string
  enabled: boolean
  description: string
}) {
  return (
    <Empty className="min-h-[320px]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{capability}</EmptyTitle>
        <EmptyDescription className="flex flex-col items-center gap-3">
          <span>{description}</span>
          <span>
            {enabled
              ? "This capability is enabled but its implementation has not shipped yet."
              : "This capability is not enabled."}{" "}
            It is controlled by <Kbd>{flag}</Kbd>.
          </span>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
```

`EmptyTitle` must render as a heading for the e2e test's `getByRole("heading")` to match. Check `components/ui/empty.tsx`; if `EmptyTitle` is not a heading element, pass the appropriate `render` prop or use an explicit `<h2>`, following the convention used elsewhere in `components/naba-presence/`.

- [ ] **Step 4: Create the seven tab pages**

Each follows this shape. For `hours`:

```tsx
import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Hours · NabaPresence" }

export default function LocationHoursPage() {
  return (
    <CapabilityPlaceholder
      capability="Hours"
      flag="GBP_PROFILE_WRITES_ENABLED"
      enabled={false}
      description="Regular, special, and additional opening hours, compared against the canonical schedule and published to Google."
    />
  )
}
```

Hours has no flag of its own in Task 14 — it belongs to the profile dual-sync workstream, whose flag is not added by this plan. Pass `enabled={false}` and the flag name as a string only.

The other six read their real flag:

| Segment | `capability` | `flag` | `enabled` |
| --- | --- | --- | --- |
| `photos` | `Photos` | `GBP_MEDIA_ENABLED` | `getServerEnv().GBP_MEDIA_ENABLED` |
| `posts` | `Posts` | `GBP_POSTS_ENABLED` | `getServerEnv().GBP_POSTS_ENABLED` |
| `menu` | `Menu` | `GBP_FOOD_MENUS_ENABLED` | `getServerEnv().GBP_FOOD_MENUS_ENABLED` |
| `qa` | `Q&A` | `GBP_QA_ENABLED` | `getServerEnv().GBP_QA_ENABLED` |
| `booking` | `Booking` | `GBP_PLACE_ACTIONS_ENABLED` | `getServerEnv().GBP_PLACE_ACTIONS_ENABLED` |
| `performance` | `Performance` | `GBP_PERFORMANCE_ENABLED` | `getServerEnv().GBP_PERFORMANCE_ENABLED` |

Descriptions, one per tab:

- Photos — "Owner and customer media for this location, published to and reconciled with Google."
- Posts — "Standard updates, events, and offers, drafted and approved before publication to Google."
- Menu — "Canonical food and drink menus projected into Google FoodMenus."
- Q&A — "Questions and owner answers, drafted from verified venue facts and approved before publication."
- Booking — "The reservation link Google shows for this location, managed through Place Actions."
- Performance — "Impressions, searches, calls, direction requests, and website clicks for this location."

- [ ] **Step 5: Wire the real flag into `/performance`**

Replace `app/(dashboard)/performance/page.tsx`:

```tsx
import { PerformanceView } from "@/components/naba-presence/performance-view"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return (
    <PerformanceView
      googlePerformanceEnabled={getServerEnv().GBP_PERFORMANCE_ENABLED}
    />
  )
}
```

In `performance-view.tsx`, restore the real `CapabilityPlaceholder` in the `google` tab as written in Task 4 Step 4, removing the temporary `EmptyData`.

- [ ] **Step 6: Run the full suite**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e && pnpm test:a11y
```

Expected: PASS. `pnpm build` matters here: it catches any accidental `server-only` import reaching a client component.

- [ ] **Step 7: Commit**

```bash
git add app components/naba-presence tests/e2e/capability-tabs.spec.ts
git commit -m "feat: add flag-aware capability placeholders for unbuilt GBP tabs"
```

---

# Phase 4 — Gated, not planned here

Phase 4 makes the Profile tab fully real and adds the Hours tab, requiring:

1. the `readMask` extension and a `googleLocationsRequest` builder extracted into `lib/domain/google-contract.ts` with a contract test;
2. durable columns on `external_location` plus a migration with forced RLS and runtime-role grants;
3. **a documented data classification** for public business profile data, which the current retention policy does not name.

Item 3 is a policy decision, not an implementation detail. **Do not begin Phase 4 from this plan.** Resolve §9.2 of the spec, then write a new `gbp-profile-read-only` plan. (Archive note: this directory is a historical record — that plan belongs wherever current plans live, not here.)

Phases 1–3 deliver the complete information architecture, the identity change, and the reviews decomposition without it.

## Definition of done for Phases 1–3

- [ ] Sidebar reads Home, Inbox, Locations, Performance, Settings; "Reviews" appears in no top-level nav item.
- [ ] `/` lands on `/home`; all four legacy routes redirect.
- [ ] A single-location organisation reaches its workspace without seeing a one-row index.
- [ ] `/inbox` retains cross-location filtering; `/locations/{id}/reviews` scopes server-side and hides the location filter.
- [ ] All nine location tabs resolve; six state their flag.
- [ ] `reviews-view.tsx` no longer exists; no file in `components/naba-presence/reviews/` exceeds 700 lines.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e && pnpm test:a11y` all pass.
- [ ] The four reply-lifecycle integration suites pass with output identical to the Phase 2 baseline.
