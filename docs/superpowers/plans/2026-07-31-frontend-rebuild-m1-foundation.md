# Frontend Rebuild — Milestone 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the old frontend app layer and stand up the new foundation — fonts, tokens, error spine, typed API client, Query layer, formatters, foundation primitives, app shell, component-test harness — leaving the app booting to a placeholder Home with all unit/contract suites green.

**Architecture:** Server-first hybrid per `docs/superpowers/specs/2026-07-31-frontend-rebuild-design.md`: RSC pages call `lib/server` services directly and hydrate a TanStack Query cache; the client owns interactivity through typed mutations against `/api/*`. This milestone builds the skeleton of that pattern end to end (dashboard layout prefetches session + connections; the shell derives its status chip from the hydrated query).

**Tech Stack:** Next.js 16.2.6 (webpack), React 19.2.4, TypeScript strict, Tailwind v4, @base-ui/react (base-rhea idiom), TanStack Query v5, zod 4, Vitest 4 (+ jsdom + Testing Library), Playwright.

## Global Constraints

- Package manager: `pnpm`. Dev/build always `--webpack` (Turbopack is known-broken here — do not change `package.json` scripts).
- Work on branch `frontend-rebuild`. Never touch `app/api/**`, `app/auth/confirm/route.ts`, `lib/server/**` (except the explicit extraction in Task 9), `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`.
- New runtime deps allowed in this milestone: `geist`, `@tanstack/react-query`. New dev deps: `jsdom`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Nothing else.
- Styling: design tokens only — no raw hex, no `text-[NNpx]`, no arbitrary durations in components. Class merging via `cn()` from `lib/utils.ts` (kept).
- Every interactive primitive uses the single focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Copy: GB English ("organisation"), no internal jargon, no env-flag names.
- After every task: `pnpm typecheck && pnpm test` green before committing. `pnpm lint` before each commit.
- Commit messages: conventional commits, ending with the trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The e2e suite is temporarily ignored via `testIgnore` (Task 1) and re-enabled per milestone; do not delete e2e specs.
- `git show main:<path>` is the reference for any deleted file you are re-admitting; adapt, don't invent.

---

### Task 1: Deletion commit + minimal booting app

**Files:**
- Delete: `components/naba-presence/` (entire dir), `components/ui/` (entire dir), `components/theme-provider.tsx`, `hooks/` (entire dir), `lib/naba-presence-api.ts`, `lib/naba-presence-data.ts`, `app/(dashboard)/` page trees, `app/sign-in/`, `app/forgot-password/`, `app/reset-password/`, `app/invite/`
- Modify: `app/layout.tsx`, `app/page.tsx`, `app/design-system/page.tsx`, `tests/design-system-contract.test.ts`, `playwright.config.ts`, `package.json` (add `geist`)
- Create: `app/(dashboard)/layout.tsx`, `app/(dashboard)/home/page.tsx`, `components/theme-provider.tsx` (new minimal)
- Test: existing `pnpm test` suite must stay green; `pnpm build` must pass

**Interfaces:**
- Consumes: `getSession`, `isLocalBootstrapEnabled` from `@/lib/server/session` (unchanged); `cn` from `@/lib/utils` (kept).
- Produces: a booting app with route group `(dashboard)` and placeholder `/home`; `ThemeProvider` (next-themes wrapper, **no keyboard hotkey**) used by the root layout. Later tasks replace the placeholder page and extend the layout.

- [ ] **Step 1: Install geist and delete the old app layer**

```bash
pnpm add geist
git rm -r components/naba-presence components/ui components/theme-provider.tsx hooks lib/naba-presence-api.ts lib/naba-presence-data.ts
git rm -r "app/(dashboard)" app/sign-in app/forgot-password app/reset-password app/invite
```

- [ ] **Step 2: Rewrite `app/layout.tsx` on the geist package**

```tsx
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

export const metadata = {
  title: "NabaPresence · Google review operations",
  description:
    "Nab a Presence. Review, verify and publish trusted Google Business Profile responses.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased font-sans",
        GeistSans.variable,
        GeistMono.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
```

Note: `geist/font` exposes `--font-geist-sans` / `--font-geist-mono`. Update the two `@theme` lines in `app/globals.css` from `var(--font-sans)` / `var(--font-mono)` to `var(--font-geist-sans)` / `var(--font-geist-mono)` (lines 29-30; keep the explanatory comment, shortened).

- [ ] **Step 3: New minimal `components/theme-provider.tsx` (no "d" hotkey)**

```tsx
"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  )
}
```

The old provider (see `git show main:components/theme-provider.tsx`) registered a window keydown listener for the bare "d" key — a WCAG 2.1.4 violation. It is deliberately gone; do not reintroduce it.

- [ ] **Step 4: Root redirect page and dashboard gate**

`app/page.tsx` (unchanged logic, verify it still compiles as-is — it only imports from `lib/server/session`):

```tsx
import { redirect } from "next/navigation"

import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"

export default async function Page() {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  redirect(session || allowAnonymous ? "/home" : "/sign-in")
}
```

`app/(dashboard)/layout.tsx` (minimal for now; Task 9 adds prefetch + shell):

```tsx
import { redirect } from "next/navigation"

import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) redirect("/sign-in")
  return <>{children}</>
}
```

`app/(dashboard)/home/page.tsx` placeholder:

```tsx
export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Rebuild in progress</h1>
      <p className="text-sm text-muted-foreground">
        The NabaPresence frontend is being rebuilt on this branch. This
        placeholder is replaced in Milestone 3.
      </p>
    </main>
  )
}
```

- [ ] **Step 5: Reduce `app/design-system/page.tsx` to a token-only proof page**

Replace the file with a server component that renders ONLY the sections that need no deleted primitives: the light/dark contrast-pair tables and the radius/shadow specimens, using plain `div`s styled by tokens. Preserve the two `data-theme-probe` specimen blocks' text content from `git show main:app/design-system/page.tsx` (the contrast-pair evidence tables) so the a11y contract keeps meaning. Primitives re-admitted in Tasks 7–8 add their specimen sections back here.

- [ ] **Step 6: Scope the design-system contract test to what still exists**

In `tests/design-system-contract.test.ts`: keep every assertion that greps `app/globals.css`; delete or comment assertions that grep `components/ui/*` files, each with `// re-enabled as the primitive is re-admitted (rebuild M1 T7/T8)`.

- [ ] **Step 7: Ignore legacy e2e specs**

In `playwright.config.ts` add to `defineConfig`:

```ts
  // Legacy specs target the deleted frontend; re-enabled per rebuild milestone.
  testIgnore: [
    "**/accessibility.spec.ts",
    "**/capability-tabs.spec.ts",
    "**/gbp-management-tabs.spec.ts",
    "**/home.spec.ts",
    "**/inbox.spec.ts",
    "**/journeys.spec.ts",
    "**/locations.spec.ts",
    "**/performance.spec.ts",
    "**/review-provider-races.spec.ts",
    "**/routing.spec.ts",
    "**/settings.spec.ts",
  ],
```

- [ ] **Step 8: Verify green and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A
git commit -m "feat!: delete legacy frontend app layer, boot minimal shell

Rebuild M1 T1 per docs/superpowers/specs/2026-07-31-frontend-rebuild-design.md.
Fonts move to the geist package; theme hotkey removed; legacy e2e specs
testIgnored pending per-milestone re-enablement.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: all four commands pass. `pnpm dev` then loads `/home` showing the placeholder.

---

### Task 2: Token housekeeping in `app/globals.css`

**Files:**
- Modify: `app/globals.css`, `tests/design-system-contract.test.ts`, `app/design-system/page.tsx` (type-scale specimen row)

**Interfaces:**
- Produces: Tailwind utilities `text-caption`, `text-ui`, `text-body`, `text-title`, `text-page-title` (used by every later component task); dark-mode `--info` pair; a global reduced-motion rule. Removes `--nr-space-1`…`--nr-space-14`.

- [ ] **Step 1: Extend the contract test first (it will fail)**

Append to `tests/design-system-contract.test.ts`:

```ts
describe("rebuild token contract", () => {
  const css = readFileSync("app/globals.css", "utf8")

  it("defines the named type roles", () => {
    for (const role of [
      "--text-caption: 0.6875rem",   // 11px
      "--text-ui: 0.8125rem",        // 13px
      "--text-body: 0.84375rem",     // 13.5px
      "--text-title: 0.9375rem",     // 15px
      "--text-page-title: 1.375rem", // 22px
    ]) {
      expect(css).toContain(role)
    }
  })

  it("has no dead spacing scale", () => {
    expect(css).not.toMatch(/--nr-space-\d/)
  })

  it("defines --info for dark mode", () => {
    const dark = css.slice(css.indexOf(".dark {"))
    expect(dark).toContain("--info:")
    expect(dark).toContain("--info-foreground:")
  })

  it("collapses all animation under prefers-reduced-motion", () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/
    )
  })
})
```

Run: `pnpm test tests/design-system-contract.test.ts` — expect the four new tests FAIL.

- [ ] **Step 2: Apply the token edits**

In `app/globals.css`:

1. Inside `@theme inline` add (after the radius block):

```css
  /* Named type roles — the only sanctioned font sizes in feature code. */
  --text-caption: 0.6875rem;
  --text-caption--line-height: 1rem;
  --text-ui: 0.8125rem;
  --text-ui--line-height: 1.25rem;
  --text-body: 0.84375rem;
  --text-body--line-height: 1.3125rem;
  --text-title: 0.9375rem;
  --text-title--line-height: 1.375rem;
  --text-page-title: 1.375rem;
  --text-page-title--line-height: 1.75rem;
```

2. Delete the fourteen `--nr-space-*` lines (`:root`, lines 148–161) and replace with the comment:

```css
  /* Spacing uses Tailwind's default scale by decision — see
     docs/superpowers/specs/2026-07-31-frontend-rebuild-design.md §7. */
```

3. In the `.dark` block, after `--destructive`, add:

```css
  /* Info: lightened for dark surfaces, dark text on fills (like --primary).
     Verify ≥4.5:1 on #1F1F1F via the /design-system contrast table. */
  --info: oklch(0.78 0.1 230);
  --info-foreground: oklch(0.248 0.006 271.2); /* #202124 */
```

4. Append at the end of the file:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 3: Add a type-scale specimen row to `app/design-system/page.tsx`**

One section rendering each role: `<p className="text-caption">caption 11</p>` … `<p className="text-page-title">page title 22</p>`, plus a light + dark `bg-info text-info-foreground` swatch in the contrast table.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test tests/design-system-contract.test.ts && pnpm typecheck && pnpm build
git add -A
git commit -m "feat: named type roles, dark info pair, reduced-motion rule; drop dead spacing scale

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Component test harness (Vitest projects + Testing Library)

**Files:**
- Modify: `vitest.config.ts`, `package.json` (dev deps)
- Create: `tests/components/setup.ts`, `tests/components/harness.smoke.test.tsx`

**Interfaces:**
- Produces: a `components` Vitest project running `tests/components/**/*.test.tsx` under jsdom with Testing Library matchers. All later primitive/shell tasks put their tests there. Node-side tests stay untouched in the `unit` project.

- [ ] **Step 1: Install dev deps**

```bash
pnpm add -D jsdom @vitejs/plugin-react @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Write the smoke test (fails: no config/setup yet)**

`tests/components/harness.smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("component harness", () => {
  it("renders into jsdom with jest-dom matchers", () => {
    render(<button type="button">Probe</button>)
    expect(screen.getByRole("button", { name: "Probe" })).toBeInTheDocument()
  })
})
```

Run: `pnpm exec vitest run tests/components` — expect FAIL (jsx/environment not configured).

- [ ] **Step 3: Split vitest config into projects**

Replace `vitest.config.ts` `test` block (keep the existing `resolve.alias` exactly as-is at the top level):

```ts
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const alias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
  "server-only": fileURLToPath(
    new URL("./tests/helpers/server-only-stub.ts", import.meta.url)
  ),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          fileParallelism: false,
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
    coverage: { include: ["lib/domain/**/*.ts"] },
  },
})
```

`tests/components/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
```

Note: `plugins` belongs inside the project object for project-scoped plugins (Vitest 4). If `vitest run` errors on that placement, hoist `plugins: [react()]` to the top-level `defineConfig` instead — the react plugin is inert for the node project.

- [ ] **Step 4: Verify both projects and commit**

```bash
pnpm test        # runs both projects; unit suite must remain green
```

Expected: `unit` all pass (same counts as before), `components` 1 pass.

```bash
git add -A
git commit -m "test: add jsdom component-test project with Testing Library

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: `lib/format` — the single formatter set

**Files:**
- Create: `lib/format/date.ts`, `lib/format/number.ts`, `lib/format/duration.ts`, `lib/format/index.ts`
- Test: `tests/format.test.ts` (unit project)

**Interfaces:**
- Produces (exact signatures — every later view uses these; no other date/number formatting is permitted in feature code):
  - `formatDateTime(iso: string, timeZone: string): string` → `"29 Jul, 19:27"`; adds the year when it differs from the current year in that zone: `"4 Sep 2025, 21:25"`.
  - `formatDate(iso: string, timeZone: string): string` → `"29 Jul"` / `"4 Sep 2025"`.
  - `formatNumber(value: number): string` → en-GB grouping (`"1,234"`).
  - `formatPercent(value: number): string` → `"38%"` (input 0–100, rounded).
  - `formatDuration(seconds: number | null): string` → `"—"` for null/non-finite; `"45m"`, `"1h 5m"`, `"2d 3h"`; never `"60m"`/`"1h 60m"`.
- Locale policy (spec §7): en-GB pinned for dates AND numbers.

- [ ] **Step 1: Write the failing tests**

`tests/format.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest"

import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"

afterEach(() => vi.useRealTimers())

describe("formatDateTime", () => {
  it("omits the year for the current year, in the org timezone", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2026-07-29T18:27:00Z", "Europe/London")).toBe(
      "29 Jul, 19:27"
    )
  })
  it("includes the year for other years", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2025-09-04T20:25:00Z", "Europe/London")).toBe(
      "4 Sept 2025, 21:25"
    )
  })
  it("respects non-UK zones", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2026-01-15T23:30:00Z", "Australia/Sydney")).toBe(
      "16 Jan, 10:30"
    )
  })
})

describe("formatDate", () => {
  it("matches formatDateTime's date part", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDate("2025-09-04T20:25:00Z", "Europe/London")).toBe(
      "4 Sept 2025"
    )
  })
})

describe("formatDuration", () => {
  it("handles null and NaN", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(Number.NaN)).toBe("—")
  })
  it("never emits 60 minutes", () => {
    expect(formatDuration(3599)).toBe("1h 0m")
    expect(formatDuration(7199)).toBe("2h 0m")
  })
  it("rolls up to days", () => {
    expect(formatDuration(195_000)).toBe("2d 6h")
  })
  it("formats sub-hour", () => {
    expect(formatDuration(2700)).toBe("45m")
  })
})

describe("numbers", () => {
  it("groups thousands en-GB", () => {
    expect(formatNumber(1234567)).toBe("1,234,567")
  })
  it("rounds percentages", () => {
    expect(formatPercent(38.4)).toBe("38%")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/format.test.ts --project unit`
Expected: FAIL — module `@/lib/format` not found.

- [ ] **Step 3: Implement**

`lib/format/date.ts`:

```ts
const LOCALE = "en-GB" // Locale policy: en-GB pinned (spec §7).

function yearIn(timeZone: string, date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(date)
  )
}

function datePart(date: Date, timeZone: string): string {
  const withYear = yearIn(timeZone, date) !== yearIn(timeZone, new Date())
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date)
}

export function formatDate(iso: string, timeZone: string): string {
  return datePart(new Date(iso), timeZone)
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
  return `${datePart(date, timeZone)}, ${time}`
}
```

`lib/format/duration.ts`:

```ts
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—"
  const totalMinutes = Math.round(seconds / 60) // round FIRST: no "1h 60m"
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`
}
```

`lib/format/number.ts`:

```ts
const LOCALE = "en-GB"

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value)
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
```

`lib/format/index.ts`:

```ts
export { formatDate, formatDateTime } from "./date"
export { formatDuration } from "./duration"
export { formatNumber, formatPercent } from "./number"
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/format.test.ts --project unit`
Expected: PASS (note: if the ICU short month for September renders `"Sep"` rather than `"Sept"` on your Node build, fix the TEST expectation to the observed en-GB output — the invariant under test is the year rule, not ICU's abbreviation).

- [ ] **Step 5: Commit**

```bash
git add lib/format tests/format.test.ts
git commit -m "feat: single formatter set (dates with year rule, safe durations, en-GB numbers)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Typed API client + draft stash

**Files:**
- Create: `lib/api/client.ts`, `lib/api/draft-stash.ts`
- Test: `tests/components/api-client.test.tsx` (components project — needs jsdom for `sessionStorage`/`location`)

**Interfaces:**
- Produces (exact — all later mutation hooks consume these):
  - `class ApiClientError extends Error { readonly status: number; readonly code: string; readonly details?: unknown }`
  - `apiFetch<T>(path: string, options?: { method?: "GET"|"POST"|"PATCH"|"PUT"|"DELETE"; body?: unknown; schema?: ZodType<T>; signal?: AbortSignal }): Promise<T>` — JSON in/out against same-origin `/api/*`; throws `ApiClientError` on `!ok`; safe on non-JSON bodies; parses with `schema` when given (throws `ApiClientError` with `code: "malformed_response"`, `status: 500` on parse failure).
  - 401 with server code `authentication_required` → calls `stashAllDrafts()` then `window.location.assign('/sign-in?next=' + encodeURIComponent(location.pathname + location.search))` and throws.
  - Draft stash: `registerDraftSource(key: string, snapshot: () => string | null): () => void` (returns unregister), `stashAllDrafts(): void`, `takeStashedDraft(key: string): string | null` (reads AND clears), sessionStorage keys `naba:draft:<key>`.
- Consumes: server error envelope `{ error: string; message: string; details?: unknown }` (from `lib/server/http.ts` `apiError` — do not change the server).

- [ ] **Step 1: Write the failing tests**

`tests/components/api-client.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { ApiClientError, apiFetch } from "@/lib/api/client"
import {
  registerDraftSource,
  stashAllDrafts,
  takeStashedDraft,
} from "@/lib/api/draft-stash"

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("apiFetch", () => {
  it("returns parsed JSON on ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true })))
    await expect(apiFetch("/api/probe")).resolves.toEqual({ ok: true })
  })

  it("throws ApiClientError carrying status, code, details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          error: "validation_failed",
          message: "The request did not pass validation.",
          details: [{ path: ["name"], message: "Required" }],
        })
      )
    )
    const error = await apiFetch("/api/probe").catch((e) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(422)
    expect(error.code).toBe("validation_failed")
    expect(error.details).toEqual([{ path: ["name"], message: "Required" }])
  })

  it("survives non-JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }))
    )
    const error = await apiFetch("/api/probe").catch((e) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(502)
    expect(error.code).toBe("http_error")
  })

  it("validates with a schema and flags malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { count: "x" })))
    const error = await apiFetch("/api/probe", {
      schema: z.object({ count: z.number() }),
    }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.code).toBe("malformed_response")
  })

  it("stashes drafts and redirects on authentication_required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          error: "authentication_required",
          message: "Please sign in.",
        })
      )
    )
    const assign = vi.fn()
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/inbox",
      search: "?queue=needs_reply",
      assign,
    })
    registerDraftSource("review:42", () => "half-written reply")
    await expect(apiFetch("/api/probe")).rejects.toBeInstanceOf(ApiClientError)
    expect(sessionStorage.getItem("naba:draft:review:42")).toBe(
      "half-written reply"
    )
    expect(assign).toHaveBeenCalledWith(
      "/sign-in?next=" + encodeURIComponent("/inbox?queue=needs_reply")
    )
  })
})

describe("draft stash", () => {
  it("takeStashedDraft reads once and clears", () => {
    registerDraftSource("k", () => "v")
    stashAllDrafts()
    expect(takeStashedDraft("k")).toBe("v")
    expect(takeStashedDraft("k")).toBeNull()
  })

  it("unregister stops stashing; null snapshots are skipped", () => {
    const un = registerDraftSource("gone", () => "x")
    un()
    registerDraftSource("empty", () => null)
    stashAllDrafts()
    expect(sessionStorage.getItem("naba:draft:gone")).toBeNull()
    expect(sessionStorage.getItem("naba:draft:empty")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/api-client.test.tsx --project components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/api/draft-stash.ts`:

```ts
const PREFIX = "naba:draft:"
const sources = new Map<string, () => string | null>()

export function registerDraftSource(
  key: string,
  snapshot: () => string | null
): () => void {
  sources.set(key, snapshot)
  return () => {
    if (sources.get(key) === snapshot) sources.delete(key)
  }
}

export function stashAllDrafts(): void {
  for (const [key, snapshot] of sources) {
    const value = snapshot()
    if (value !== null && value !== "") {
      sessionStorage.setItem(PREFIX + key, value)
    }
  }
}

export function takeStashedDraft(key: string): string | null {
  const value = sessionStorage.getItem(PREFIX + key)
  if (value !== null) sessionStorage.removeItem(PREFIX + key)
  return value
}
```

`lib/api/client.ts`:

```ts
import type { ZodType } from "zod"

import { stashAllDrafts } from "./draft-stash"

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.name = "ApiClientError"
    this.status = status
    this.code = code
    this.details = details
  }
}

type ApiFetchOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  schema?: ZodType<T>
  signal?: AbortSignal
}

async function readPayload(response: Response): Promise<{
  error?: string
  message?: string
  details?: unknown
  raw: unknown
}> {
  const text = await response.text()
  try {
    const parsed: unknown = JSON.parse(text)
    const record = (parsed ?? {}) as Record<string, unknown>
    return {
      error: typeof record.error === "string" ? record.error : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
      details: record.details,
      raw: parsed,
    }
  } catch {
    return { raw: text }
  }
}

function handleUnauthorized(): void {
  stashAllDrafts()
  const next = encodeURIComponent(location.pathname + location.search)
  window.location.assign(`/sign-in?next=${next}`)
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, schema, signal } = options
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    const code = payload.error ?? "http_error"
    if (response.status === 401 && code === "authentication_required") {
      handleUnauthorized()
    }
    throw new ApiClientError(
      response.status,
      code,
      payload.message ?? `Request failed (${response.status}).`,
      payload.details
    )
  }

  if (!schema) return payload.raw as T
  const parsed = schema.safeParse(payload.raw)
  if (!parsed.success) {
    throw new ApiClientError(
      500,
      "malformed_response",
      "The server response did not match the expected shape.",
      parsed.error.issues
    )
  }
  return parsed.data
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/api-client.test.tsx --project components`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/api tests/components/api-client.test.tsx
git commit -m "feat: typed api client with 401 draft-stash redirect and zod response validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Query foundation (keys, client factory, provider)

**Files:**
- Create: `lib/queries/keys.ts`, `lib/queries/query-client.ts`, `lib/queries/provider.tsx`
- Test: `tests/components/query-foundation.test.tsx`

**Interfaces:**
- Produces (exact — every later data hook consumes these):
  - `queryKeys.session` → `["session"] as const`; `queryKeys.connections` → `["connections"]`; `queryKeys.settings` → `["settings"]`; `queryKeys.locations` → `["locations"]`; `queryKeys.reviewCounts(scope: string)` → `["review-counts", scope]`; `queryKeys.reviews(scope: string, filters: unknown)` → `["reviews", scope, filters]`; `queryKeys.reviewDetail(id: string)` → `["review-detail", id]`; `queryKeys.analytics(kind: string, params: unknown)` → `["analytics", kind, params]`.
  - `makeQueryClient(): QueryClient` — `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: true`; mutations `retry: 0`.
  - `QueryProvider({ children })` — client component; creates the client once via `useState`.
- Consumes: `@tanstack/react-query` (installed this task).

- [ ] **Step 1: Install**

```bash
pnpm add @tanstack/react-query
```

- [ ] **Step 2: Write the failing test**

`tests/components/query-foundation.test.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { QueryProvider } from "@/lib/queries/provider"

describe("query keys", () => {
  it("scopes list keys by their inputs", () => {
    expect(queryKeys.reviews("all", { rating: 1 })).toEqual([
      "reviews",
      "all",
      { rating: 1 },
    ])
    expect(queryKeys.reviewDetail("42")).toEqual(["review-detail", "42"])
  })
})

describe("makeQueryClient", () => {
  it("applies the shared defaults", () => {
    const defaults = makeQueryClient().getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(30_000)
    expect(defaults.queries?.retry).toBe(1)
    expect(defaults.mutations?.retry).toBe(0)
  })
})

function Probe() {
  const { data } = useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => ({ displayName: "Probe user" }),
  })
  return <p>{data?.displayName ?? "loading"}</p>
}

describe("QueryProvider", () => {
  it("provides a working client", async () => {
    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>
    )
    expect(await screen.findByText("Probe user")).toBeInTheDocument()
  })
})
```

Run: `pnpm exec vitest run tests/components/query-foundation.test.tsx --project components` — expect FAIL.

- [ ] **Step 3: Implement**

`lib/queries/keys.ts`:

```ts
export const queryKeys = {
  session: ["session"] as const,
  connections: ["connections"] as const,
  settings: ["settings"] as const,
  locations: ["locations"] as const,
  reviewCounts: (scope: string) => ["review-counts", scope] as const,
  reviews: (scope: string, filters: unknown) =>
    ["reviews", scope, filters] as const,
  reviewDetail: (id: string) => ["review-detail", id] as const,
  analytics: (kind: string, params: unknown) =>
    ["analytics", kind, params] as const,
}
```

`lib/queries/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query"

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  })
}
```

`lib/queries/provider.tsx`:

```tsx
"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { makeQueryClient } from "./query-client"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

- [ ] **Step 4: Run to verify pass, then full suite**

Run: `pnpm exec vitest run tests/components/query-foundation.test.tsx --project components` → PASS, then `pnpm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/queries tests/components/query-foundation.test.tsx package.json pnpm-lock.yaml
git commit -m "feat: query foundation (key registry, client defaults, provider)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: Foundation primitives, batch 1 (Button, Card, Badge, Alert, Skeleton, Spinner)

**Files:**
- Create: `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`, `components/ui/alert.tsx`, `components/ui/skeleton.tsx`, `components/ui/spinner.tsx`
- Modify: `app/design-system/page.tsx` (specimen sections), `tests/design-system-contract.test.ts` (re-enable the primitive greps for these six files)
- Test: `tests/components/primitives-batch1.test.tsx`

**Interfaces:**
- Produces: `Button` (variants `default|outline|ghost|destructive|link`, sizes `default|sm|lg|icon|icon-sm|icon-xs`; icon sizes require `aria-label` at the type level), `Card`+`CardHeader`+`CardTitle` (renders a real heading, default `h3`, `as` prop)+`CardDescription`+`CardContent`+`CardFooter`, `Badge` (variants `default|secondary|outline|destructive|success|warning|info`), `Alert`+`AlertTitle`+`AlertDescription` (same seven variants; `role="alert"`), `Skeleton` (`aria-hidden`, paired busy-region contract), `Spinner` (`role="status"`, `aria-label="Loading"`).
- Consumes: `cn` from `@/lib/utils`; `class-variance-authority`; `@base-ui/react` `useRender` idiom where the source file used it.

- [ ] **Step 1: Write the failing tests**

`tests/components/primitives-batch1.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

describe("Button", () => {
  it("renders an accessible icon-only button", () => {
    render(<Button size="icon-sm" aria-label="Remove period" />)
    expect(
      screen.getByRole("button", { name: "Remove period" })
    ).toBeInTheDocument()
  })
  it("defaults type=button", () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button"
    )
  })
})

describe("CardTitle", () => {
  it("renders a real heading, h3 by default", () => {
    render(
      <Card>
        <CardTitle>Reply performance</CardTitle>
      </Card>
    )
    expect(
      screen.getByRole("heading", { level: 3, name: "Reply performance" })
    ).toBeInTheDocument()
  })
  it("supports the as prop", () => {
    render(<CardTitle as="h2">Section</CardTitle>)
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument()
  })
})

describe("status variants", () => {
  it("Badge exposes success/warning/info variants", () => {
    render(
      <>
        <Badge variant="success">Published</Badge>
        <Badge variant="warning">Stale</Badge>
        <Badge variant="info">Syncing</Badge>
      </>
    )
    expect(screen.getByText("Published")).toBeInTheDocument()
  })
  it("Alert announces and carries a title", () => {
    render(
      <Alert variant="warning">
        <AlertTitle>Data may be out of date</AlertTitle>
        <AlertDescription>Retry to refresh.</AlertDescription>
      </Alert>
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Data may be out of date"
    )
  })
})

describe("loading primitives", () => {
  it("Spinner is a named status", () => {
    render(<Spinner />)
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })
  it("Skeleton is hidden from AT", () => {
    render(<Skeleton data-testid="sk" className="h-4 w-24" />)
    expect(screen.getByTestId("sk")).toHaveAttribute("aria-hidden", "true")
  })
})
```

Run: `pnpm exec vitest run tests/components/primitives-batch1.test.tsx --project components` — expect FAIL (modules missing).

- [ ] **Step 2: Re-admit Button/Card/Badge/Alert from git history with these exact deltas**

Start each file from `git show main:components/ui/<name>.tsx`, then apply:

**button.tsx**
1. Keep the CVA variants/hover color-mix work verbatim (it is contrast-engineered; see its comments).
2. Normalise the focus ring to the house recipe (Global Constraints) if it differs.
3. Replace the base font utility `text-[13px]` with `text-ui`.
4. Add `type="button"` default: in the render, `type={props.type ?? "button"}` when rendering a native `button`.
5. Enforce labelled icon buttons at the type level — replace the exported props type with:

```tsx
type IconSize = "icon" | "icon-sm" | "icon-xs"
type AnySize = NonNullable<VariantProps<typeof buttonVariants>["size"]>
type ButtonBaseProps = Omit<React.ComponentProps<"button">, "size"> &
  Omit<VariantProps<typeof buttonVariants>, "size"> & {
    render?: useRender.RenderProp
  }
export type ButtonProps =
  | (ButtonBaseProps & { size?: Exclude<AnySize, IconSize> })
  | (ButtonBaseProps & { size: IconSize; "aria-label": string })
```

(Adjust generics to the file's existing shape; the observable requirement is: `<Button size="icon-sm" />` is a TYPE ERROR without `aria-label`, and compiles with it.)

**card.tsx**
1. Keep the token-routed padding/radius/shadow/glass-border styling verbatim.
2. Replace `CardTitle` (currently a `div`) with:

```tsx
function CardTitle({
  as: Heading = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("text-title font-semibold leading-none", className)}
      {...props}
    />
  )
}
```

**badge.tsx** — add to the CVA `variant` map (tokens exist; light-mode `--info` already defined, dark added in Task 2):

```ts
success:
  "border-transparent bg-success/10 text-success [a&]:hover:bg-success/20",
warning:
  "border-transparent bg-warning/15 text-foreground [a&]:hover:bg-warning/25",
info: "border-transparent bg-info/10 text-info [a&]:hover:bg-info/20",
```

Note dark mode: `text-success`/`text-info` resolve to the dark token values, which are fills carrying dark foregrounds — for the tinted badge treatment they act as TEXT. Verify on `/design-system` in dark; if `--warning` text on `bg-warning/15` reads poorly in dark, use `text-foreground` (as specified above) — already the safe choice.

**alert.tsx** — extend the CVA `variant` map with the same three treatments (keep `role="alert"` on the root exactly as in the source):

```ts
success: "bg-success/8 text-foreground [&>svg]:text-success",
warning: "bg-warning/10 text-foreground [&>svg]:text-warning",
info: "bg-info/8 text-foreground [&>svg]:text-info",
```

- [ ] **Step 3: Write Skeleton and Spinner fresh (full files)**

`components/ui/skeleton.tsx`:

```tsx
import { cn } from "@/lib/utils"

/**
 * Purely decorative. The busy-region contract: the CONTAINER swapping
 * between skeletons and content sets aria-busy while loading — Skeleton
 * itself is always aria-hidden.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

`components/ui/spinner.tsx`:

```tsx
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({
  className,
  label = "Loading",
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span role="status" aria-label={label} data-slot="spinner" {...props}>
      <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
    </span>
  )
}

export { Spinner }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run tests/components/primitives-batch1.test.tsx --project components`
Expected: PASS (8 tests). Also confirm the icon-button type gate manually: add `const bad = <Button size="icon" />` in a scratch file → `pnpm typecheck` must error; remove it.

- [ ] **Step 5: Add specimens + re-enable contract greps; verify; commit**

Add a "Primitives" section to `app/design-system/page.tsx` rendering: all Button variants/sizes (icon ones labelled), all seven Badge and Alert variants, a Card with `CardTitle as="h2"`, Skeleton row, Spinner. Re-enable the six files' assertions in `tests/design-system-contract.test.ts`.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A
git commit -m "feat: foundation primitives batch 1 with status variants and a11y contracts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Foundation primitives, batch 2 (Field system, Input, Dialog+Sheet, Toast)

**Files:**
- Create: `components/ui/field.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `components/ui/toast.tsx`
- Modify: `app/design-system/page.tsx`, `app/layout.tsx` (mount `Toaster`), `tests/design-system-contract.test.ts`
- Test: `tests/components/field-system.test.tsx`, `tests/components/overlays.test.tsx`

**Interfaces:**
- Produces:
  - Field system with automatic wiring: `Field({ error?: string, children })` provides context `{ id, errorId, invalid }` via `useId`; `FieldLabel` (renders `<Label htmlFor={id}>`), `FieldDescription` (auto `aria-describedby` member), `FieldError` (renders `role="alert"`, id = `errorId`, only when `error` set), and `Input`/(later `Textarea`, `NativeSelect`) consume the context: `id={id}`, `aria-invalid={invalid || undefined}`, `aria-describedby` combining description+error ids. Exported hook: `useFieldContext(): { id: string; errorId: string; descriptionId: string; invalid: boolean } | null`.
  - `Input` — restyled chrome (below), context-aware.
  - `Dialog` family and `Sheet` (side panel variant) from Base UI with reduced-motion-safe classes; `Toast`/`Toaster` with status-coloured icons.
- Chrome (the ONE control treatment, from the spec): `rounded-(--nr-radius-field) border border-border/80 bg-card text-body` + house focus ring + `aria-invalid:border-destructive aria-invalid:ring-destructive/20`.

- [ ] **Step 1: Write the failing field-system tests**

`tests/components/field-system.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

describe("Field auto-wiring", () => {
  it("associates label, description and control without explicit ids", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input defaultValue="Old Crown" />
        <FieldDescription>Shown on your Google profile.</FieldDescription>
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAccessibleDescription("Shown on your Google profile.")
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("wires errors as an alert and marks the control invalid", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a business name."
    )
    expect(input).toHaveAccessibleDescription("Enter a business name.")
  })

  it("Input works standalone with an explicit aria-label", () => {
    render(<Input aria-label="Search reviews" />)
    expect(
      screen.getByRole("textbox", { name: "Search reviews" })
    ).toBeInTheDocument()
  })
})
```

Run: `pnpm exec vitest run tests/components/field-system.test.tsx --project components` — expect FAIL.

- [ ] **Step 2: Implement the field system (full file)**

`components/ui/label.tsx`: re-admit from `git show main:components/ui/label.tsx` unchanged except the base text utility → `text-ui`.

`components/ui/field.tsx`:

```tsx
"use client"

import { createContext, useContext, useId } from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldContextValue = {
  id: string
  errorId: string
  descriptionId: string
  invalid: boolean
  error?: string
}

const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(FieldContext)
}

function Field({
  error,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { error?: string }) {
  const id = useId()
  return (
    <FieldContext.Provider
      value={{
        id,
        errorId: `${id}-error`,
        descriptionId: `${id}-description`,
        invalid: Boolean(error),
        error,
      }}
    >
      <div
        data-slot="field"
        className={cn("flex flex-col gap-1.5", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  )
}

function FieldLabel(props: React.ComponentProps<typeof Label>) {
  const field = useFieldContext()
  return <Label htmlFor={field?.id} {...props} />
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const field = useFieldContext()
  return (
    <p
      id={field?.descriptionId}
      data-slot="field-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  const field = useFieldContext()
  if (!field?.error) return null
  return (
    <p
      id={field.errorId}
      role="alert"
      data-slot="field-error"
      className={cn("text-caption text-destructive", className)}
      {...props}
    >
      {field.error}
    </p>
  )
}

/** Combines description/error ids for a control inside a Field. */
export function fieldControlProps(field: FieldContextValue | null) {
  if (!field) return {}
  const describedBy = [
    field.error ? field.errorId : null,
    field.descriptionId,
  ].filter(Boolean)
  return {
    id: field.id,
    "aria-invalid": field.invalid || undefined,
    "aria-describedby": describedBy.length ? describedBy.join(" ") : undefined,
  }
}

export { Field, FieldDescription, FieldError, FieldLabel }
```

Caveat: `FieldDescription` renders with a stable id; when both error and description render, order errorId-first in `aria-describedby` (already handled above). When a Field has a description that is NOT rendered, `aria-describedby` pointing at a missing id is invalid — therefore `fieldControlProps` must only be given ids that render. Simplest correct rule (implement exactly): `Input` computes `aria-describedby` at render time from the DOM-independent context — include `descriptionId` always; a `FieldDescription` must therefore be present whenever a description is expected. Document this in a comment; the jsdom test asserting `toHaveAccessibleDescription` will catch violations in each form's own tests.

`components/ui/input.tsx`:

```tsx
"use client"

import { cn } from "@/lib/utils"
import { fieldControlProps, useFieldContext } from "@/components/ui/field"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const field = useFieldContext()
  return (
    <input
      type={type ?? "text"}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-(--nr-radius-field) border border-border/80 bg-card px-3 py-1 text-body shadow-xs transition-[color,box-shadow] outline-none",
        "placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:ring-3 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

export { Input }
```

(Explicit `id`/`aria-*` props passed by callers win because `{...props}` spreads last.)

- [ ] **Step 3: Run field tests to verify pass**

Run: `pnpm exec vitest run tests/components/field-system.test.tsx --project components` → PASS.

- [ ] **Step 4: Re-admit Dialog, Sheet, Toast with deltas; write overlay tests**

From `git show main:components/ui/dialog.tsx`, `sheet.tsx`, `toast.tsx`:
1. Dialog/Sheet: keep Base UI structure and Title/Description exports verbatim; replace hard-coded `duration-100`/`duration-150`/`duration-200` with `duration-(--nr-duration-fast)` (dialog) and `duration-(--nr-duration-standard)` (sheet); dialog content radius → `rounded-(--nr-radius-modal)`... wait, `--nr-radius-modal` was NOT deleted in Task 2 (only `--nr-space-*` was) — confirm it exists at `globals.css` and use it; shadow → `shadow-(--nr-shadow-modal)`.
2. Toast: keep the Base UI viewport/live-region machinery verbatim (it provides the polite region + alert announcer). Colour the status icons: in the icon block, apply `text-success` to the success icon, `text-warning` to warning, `text-info` to info, keep `text-destructive` for error.
3. Mount `<Toaster>` inside `ThemeProvider` in `app/layout.tsx` (children nested as the old layout did — see `git show main:app/layout.tsx`).

`tests/components/overlays.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

describe("Dialog", () => {
  it("opens with correct semantics and closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Edit hours</DialogTrigger>
        <DialogContent>
          <DialogTitle>Edit hours</DialogTitle>
          <DialogDescription>Weekly schedule for this location.</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByRole("button", { name: "Edit hours" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit hours" })
    expect(dialog).toHaveAccessibleDescription(
      "Weekly schedule for this location."
    )
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
```

Run: `pnpm exec vitest run tests/components/overlays.test.tsx --project components` → PASS (if Base UI portals defer, use `await screen.findByRole` as shown).

- [ ] **Step 5: Specimens, contract greps, gate, commit**

Add Field/Input/Dialog/Sheet/Toast specimens to `/design-system`; re-enable their contract-test greps.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A
git commit -m "feat: field system with auto a11y wiring, restyled input, dialog/sheet/toast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Error spine, connections service extraction, app shell, hydrated dashboard layout

**Files:**
- Create: `app/global-error.tsx`, `app/(dashboard)/error.tsx`, `app/not-found.tsx`, `app/(dashboard)/loading.tsx`, `lib/server/connections.ts`, `lib/api/connections.ts`, `lib/queries/use-connection-health.ts`, `components/app-shell/app-shell.tsx`, `components/app-shell/nav.tsx`, `components/app-shell/status-chip.tsx`, `components/app-shell/theme-toggle.tsx`, `components/app-shell/page-frame.tsx`
- Modify: `app/api/google/connections/route.ts` (delegate to the service), `app/(dashboard)/layout.tsx` (prefetch + hydrate + shell), `app/(dashboard)/home/page.tsx` (use PageFrame)
- Test: `tests/components/app-shell.test.tsx`; existing integration suite (route behaviour unchanged)

**Interfaces:**
- Consumes: `Session` type from `@/lib/server/session` (fields: `sessionId, userId, organisationId, organisationName, displayName, email, role: "owner"|"admin"|"member"|"viewer", canPublish`); `queryKeys`, `QueryProvider`, `makeQueryClient` (Task 6); `apiFetch` (Task 5); primitives (Tasks 7–8).
- Produces:
  - `listConnections(session: Session): Promise<ConnectionSummary[]>` in `lib/server/connections.ts`, where `ConnectionSummary = { id: string; googleEmail: string | null; status: string; scope?: string; notificationsEnabled: boolean; lastRefreshAt: string | null; lastErrorCode: string | null; reconnectRequired: boolean; createdAt: string }` — behaviour identical to today's route (role-based masking included).
  - Client: `connectionsResponseSchema` (zod) and `fetchConnections(): Promise<{ connections: ConnectionSummary[] }>` in `lib/api/connections.ts`.
  - `useConnectionHealth(): { status: "loading"|"connected"|"disconnected"|"stale"|"error"; label: string }` — from `useQuery({ queryKey: queryKeys.connections, queryFn: fetchConnections, refetchInterval: 60_000 })`; mapping: pending & no data → `loading`; error with cached data → `stale`; error without data → `error`; data & some `status === "active"` → `connected`; else `disconnected`. Labels: `connected → "Live data"`, `loading → "Checking live data"`, `stale → "Live data may be stale"`, `disconnected → "Google disconnected"`, `error → "Live data unavailable"`.
  - `AppShell({ session, children })` — skip link (first tab stop, `href="#main"`), sidebar `nav aria-label="Primary"` (Home `/home`, Inbox `/inbox`, Locations `/locations`, Performance `/performance`, Settings `/settings` — lucide icons LayoutDashboard, Inbox, Store, TrendingUp, Settings), `aria-current="page"` on the active item (pathname prefix match), mobile Sheet nav, header with StatusChip + ThemeToggle, org/user identity from the `session` prop (no client fetch), a visually-hidden `<div aria-live="polite">` announcing status-label CHANGES (announce only on transition, not initial value).
  - `PageFrame({ width?: "standard"|"wide"|"workspace", children })` renders THE single `<main id="main">` (max-widths per `git show main:components/naba-presence/shared.tsx` PageFrame); `PageHeader({ title, description?, actions? })` renders `h1` with `text-page-title`.
  - `ThemeToggle` — one button cycling light → dark → system, `aria-label` = "Theme: <current>, switch to <next>". No keyboard shortcut.
- Constraint: `SidebarInset`-style wrappers must be `div`s — `PageFrame` owns the only `main`.

- [ ] **Step 1: Extract the connections service (behaviour-preserving)**

Create `lib/server/connections.ts`: move the SQL + masking logic verbatim from `app/api/google/connections/route.ts` into:

```ts
import "server-only"

import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

export type ConnectionSummary = {
  id: string
  googleEmail: string | null
  status: string
  scope?: string
  notificationsEnabled: boolean
  lastRefreshAt: string | null
  lastErrorCode: string | null
  reconnectRequired: boolean
  createdAt: string
}

export async function listConnections(
  session: Session
): Promise<ConnectionSummary[]> {
  // <the exact SQL from the route, unchanged>
  // <the exact role-based masking branch from the route, unchanged,
  //  returning the masked/unmasked array instead of NextResponse>
}
```

Rewrite the route's `GET` to:

```ts
const session = await requireSession()
return NextResponse.json({ connections: await listConnections(session) })
```

Serialisation note: the route previously JSON-serialised `Date` columns implicitly; keep parity by converting in the service — `created_at::text as "createdAt"` style casts in the SQL, or `JSON.parse(JSON.stringify(...))` is NOT acceptable; prefer explicit `::text` casts for `last_refresh_at` and `created_at` so the RSC and HTTP paths produce identical strings.

Run: `pnpm test` (unit green) — then, if the local stack is up, `pnpm test:integration` filtered to connections: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration --project unit -t connection` (if no such filter matches, run the full integration suite). Expected: green, proving parity.

- [ ] **Step 2: Error spine (four small files)**

`app/global-error.tsx`:

```tsx
"use client"

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm">
            NabaPresence hit an unexpected error. Your data is unaffected.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
```

`app/(dashboard)/error.tsx` (same shape, no `<html>`, uses `Button` and `Alert` primitives, copy: title "This page hit an error", body "The rest of NabaPresence is still working. Try again, or go back to Home.", actions: `Try again` (reset) + `Go to Home` link).

`app/not-found.tsx`: title "Page not found", body "The page you're looking for doesn't exist or has moved.", link "Go to Home" → `/home`.

`app/(dashboard)/loading.tsx`: a `PageFrame`-shaped block of Skeletons wrapped in `<div aria-busy="true">` — header bar skeleton + two card skeletons (no `main` element here — `loading.tsx` renders INSIDE the layout, and PageFrame is not used to avoid a second main when streaming completes; use a plain `div` with the same paddings).

- [ ] **Step 3: Client connections module + health hook**

`lib/api/connections.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

export const connectionSummarySchema = z.object({
  id: z.string(),
  googleEmail: z.string().nullable(),
  status: z.string(),
  scope: z.string().optional(),
  notificationsEnabled: z.boolean(),
  lastRefreshAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  reconnectRequired: z.boolean(),
  createdAt: z.string(),
})

export const connectionsResponseSchema = z.object({
  connections: z.array(connectionSummarySchema),
})

export type ConnectionSummary = z.infer<typeof connectionSummarySchema>

export function fetchConnections() {
  return apiFetch("/api/google/connections", {
    schema: connectionsResponseSchema,
  })
}
```

`lib/queries/use-connection-health.ts`:

```ts
"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchConnections } from "@/lib/api/connections"
import { queryKeys } from "./keys"

export type ConnectionHealth =
  | "loading"
  | "connected"
  | "disconnected"
  | "stale"
  | "error"

const LABELS: Record<ConnectionHealth, string> = {
  connected: "Live data",
  loading: "Checking live data",
  stale: "Live data may be stale",
  disconnected: "Google disconnected",
  error: "Live data unavailable",
}

export function useConnectionHealth() {
  const query = useQuery({
    queryKey: queryKeys.connections,
    queryFn: fetchConnections,
    refetchInterval: 60_000,
  })
  const status: ConnectionHealth = query.data
    ? query.data.connections.some((c) => c.status === "active")
      ? "connected"
      : "disconnected"
    : query.isError
      ? "error"
      : "loading"
  const finalStatus: ConnectionHealth =
    query.isError && query.data ? "stale" : status
  return { status: finalStatus, label: LABELS[finalStatus] }
}
```

(Note: with TanStack Query, `isError && data` means a background refetch failed over cached data → `stale`.)

- [ ] **Step 4: Shell components + failing tests first**

`tests/components/app-shell.test.tsx` (write BEFORE the components; wrap renders in `QueryProvider`; mock `next/navigation`'s `usePathname` via `vi.mock` returning `"/inbox"`; stub `fetch` for the connections call):

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { QueryProvider } from "@/lib/queries/provider"

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}))

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns",
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

function renderShell() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ connections: [{ id: "c1", googleEmail: null, status: "active", notificationsEnabled: false, lastRefreshAt: null, lastErrorCode: null, reconnectRequired: false, createdAt: "2026-01-01" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  )
  return render(
    <QueryProvider>
      <AppShell session={session}>
        <PageFrame>
          <PageHeader title="Inbox" description="Queue" />
        </PageFrame>
      </AppShell>
    </QueryProvider>
  )
}

describe("AppShell", () => {
  it("has a skip link as the first focusable, targeting main", () => {
    renderShell()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
  })

  it("marks the active nav item", () => {
    renderShell()
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("renders identity from the session prop without fetching it", () => {
    renderShell()
    expect(screen.getByText("Lapen Inns")).toBeInTheDocument()
    expect(screen.getByText("Aman Shrestha")).toBeInTheDocument()
  })

  it("shows the live-data status once connections resolve", async () => {
    renderShell()
    expect(await screen.findByText("Live data")).toBeInTheDocument()
  })

  it("renders exactly one main and one h1", () => {
    renderShell()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })
})
```

Run to FAIL, then implement the five shell files per the Interfaces block. Layout skeleton for `app-shell.tsx` (fill in with primitives; sidebar styling reuses the sidebar tokens — `bg-sidebar text-sidebar-foreground border-sidebar-border`, floating treatment `rounded-(--nr-radius-shell) shadow-(--nr-shadow-float)` per the old shell's look):

Visual reference for the sidebar/header treatment: `git show main:components/naba-presence/app-shell.tsx` (brand block, identity footer, status-chip styling) — reproduce the look with the new structure below; do NOT reintroduce its `SidebarInset` `<main>` or its client-side organisation fetching.

```tsx
"use client"
// Structure (desktop): grid-cols-[232px_1fr]; aside(nav) | div(header + children)
// - <a href="#main" className="sr-only focus:not-sr-only focus:absolute …">Skip to content</a> FIRST
// - aside: brand block, org name, <Nav/>, footer identity (initials avatar span, name, role)
// - header: mobile Sheet trigger (aria-label "Open navigation"), StatusChip (always visible;
//   compact dot + sr-only label below sm), ThemeToggle
// - status live region: <div aria-live="polite" className="sr-only">{announcement}</div>
//   where announcement updates via useEffect ONLY when label changes from a previous non-null label
// - children render below the header; PageFrame inside children owns <main>
```

`page-frame.tsx`:

```tsx
import { cn } from "@/lib/utils"

function PageFrame({
  width = "standard",
  className,
  children,
}: {
  width?: "standard" | "wide" | "workspace"
  className?: string
  children: React.ReactNode
}) {
  return (
    <main
      id="main"
      className={cn(
        "mx-auto flex w-full flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)",
        width === "standard" && "max-w-(--nr-page-max-width)",
        width === "wide" && "max-w-7xl",
        width === "workspace" && "max-w-none",
        className
      )}
    >
      {children}
    </main>
  )
}

function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-page-title font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-ui text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export { PageFrame, PageHeader }
```

Run: `pnpm exec vitest run tests/components/app-shell.test.tsx --project components` → PASS.

- [ ] **Step 5: Hydrated dashboard layout + home placeholder on the frame**

`app/(dashboard)/layout.tsx`:

```tsx
import {
  dehydrate,
  HydrationBoundary,
} from "@tanstack/react-query"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell/app-shell"
import { listConnections } from "@/lib/server/connections"
import { getSession, isLocalBootstrapEnabled } from "@/lib/server/session"
import { makeQueryClient } from "@/lib/queries/query-client"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) redirect("/sign-in")

  const queryClient = makeQueryClient()
  if (session) {
    queryClient.setQueryData(queryKeys.connections, {
      connections: await listConnections(session),
    })
  }

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AppShell session={session}>{children}</AppShell>
      </HydrationBoundary>
    </QueryProvider>
  )
}
```

(`AppShell`'s `session` prop type: `Session | null`; render placeholder identity "Your organisation"/"Account" ONLY when null — dev-anonymous mode.) Note `Session` is exported from a `server-only` module — define a serialisable `ShellSession` type in `components/app-shell/app-shell.tsx` with the same fields and type the prop with it; the layout passes the server session object directly.

Rewrite `app/(dashboard)/home/page.tsx`:

```tsx
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"

export const metadata = { title: "Home · NabaPresence" }

export default function HomePage() {
  return (
    <PageFrame>
      <PageHeader
        title="Home"
        description="Google presence across every connected location."
      />
      <p className="text-ui text-muted-foreground">
        The Home roll-up returns in Milestone 3 of the rebuild.
      </p>
    </PageFrame>
  )
}
```

- [ ] **Step 6: Verify in the browser, gate, commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `pnpm dev`: `/home` shows the shell (sidebar, header, status chip reaching "Live data" against the local stack), one `main`, one `h1`; Tab reveals the skip link first; theme toggle cycles; mobile width opens the Sheet nav.

```bash
git add -A
git commit -m "feat: error spine, connections service extraction, app shell with hydrated status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Foundation e2e spec + milestone gate

**Files:**
- Create: `tests/e2e/foundation.spec.ts`
- Modify: none (spec must pass against the Task 9 app)

**Interfaces:**
- Consumes: the shell/routes from Task 9; `AxeBuilder` from `@axe-core/playwright` (installed); dev-session bootstrap (e2e harness sets `LOCAL_BOOTSTRAP_ENABLED=true` via `scripts/run-test-command.mjs`).

- [ ] **Step 1: Write the spec**

`tests/e2e/foundation.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

test.describe("rebuild foundation", () => {
  test("boots to the shell with sound structure", async ({ page }) => {
    await page.goto("/home")
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
    expect(await page.getByRole("main").count()).toBe(1)
    // Skip link is the first tab stop and works
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to content" })
    await expect(skip).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#main")).toBeFocused()
  })

  test("status chip reaches a live state", async ({ page }) => {
    await page.goto("/home")
    await expect(
      page.getByText(/Live data|Google disconnected/)
    ).toBeVisible({ timeout: 10_000 })
  })

  test("mobile nav opens as a dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/home")
    await page.getByRole("button", { name: "Open navigation" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "Inbox" })
    ).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean on /home and /design-system (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const path of ["/home", "/design-system"]) {
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${path} ${theme} wcag`).toEqual([])
        const bestPractice = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          bestPractice.violations.filter((v) =>
            ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"].includes(v.id)
          ),
          `${path} ${theme} structure`
        ).toEqual([])
      }
    })
  }
})
```

- [ ] **Step 2: Build and run the spec**

```bash
pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/foundation.spec.ts
```

Expected: PASS. Fix any violations in the components (not by weakening assertions); the likely first offender is a skip-link focus quirk — give `#main` `tabIndex={-1}` if focus doesn't land.

- [ ] **Step 3: Milestone gate — run everything**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
```

Expected: unit + components green; e2e runs ONLY `foundation.spec.ts` (legacy ignored) and passes. If the local Supabase stack is running, also: `pnpm test:integration` → green (proves the Task 9 extraction changed nothing).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/foundation.spec.ts
git commit -m "test: foundation e2e (structure, skip link, mobile nav, axe incl. best-practice)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 1 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + components), `pnpm build` all green.
- `foundation.spec.ts` green including the best-practice structural axe rules.
- Integration suite green when run against the local stack (connections extraction is behaviour-identical).
- `pnpm dev` boots to the shell with live status, one `main`, one `h1`, working skip link, no console errors.
- No file under `components/` or `lib/` (client side) predates the rebuild.


