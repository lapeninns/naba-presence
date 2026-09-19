# Dashboard Routes Implementation Plan

> **For Hermes:** Use test-driven development to implement this plan task-by-task without committing unless the user explicitly asks.

**Goal:** Replace NabaPresence’s in-memory dashboard view switching with bookmarkable Next.js routes for overview, reviews, analytics, connections, and settings.

**Architecture:** Put the five product pages in an `app/(dashboard)` route group with a shared nested layout. Keep session and review bootstrap state in a client dashboard provider mounted by that layout so Next.js preserves it during client-side route transitions. Render sidebar navigation with `next/link`, derive active state from `usePathname()`, and redirect `/` to `/reviews` on the server.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Base UI/shadcn sidebar primitives, Playwright, Vitest.

---

### Task 1: Lock the route contract with an end-to-end test

**Objective:** Prove that direct dashboard URLs, the root redirect, and sidebar URL transitions are required before changing production code.

**Files:**
- Create: `tests/e2e/routing.spec.ts`

**Step 1: Write the failing test**

Add Playwright coverage that:
- visits `/` and expects the final URL to be `/reviews`;
- directly opens `/overview`, `/reviews`, `/analytics`, `/connections`, and `/settings` and finds each page’s heading;
- clicks the Overview and Settings sidebar links and verifies URL changes;
- checks `aria-current="page"` on the active sidebar link.

**Step 2: Run the test to verify failure**

Run: `pnpm exec playwright test tests/e2e/routing.spec.ts`

Expected: FAIL because all dashboard paths currently return 404 and `/` does not redirect.

### Task 2: Create a route-preserving dashboard provider

**Objective:** Move shared session/review bootstrap state out of the old view switcher and into the shared dashboard layout boundary.

**Files:**
- Modify: `components/naba-presence/review-app.tsx`
- Modify: `components/naba-presence/app-shell.tsx`

**Step 1: Replace the view switcher with a provider**

Export `NabaPresenceDashboard`, which keeps the existing review/session loading logic and provides reviews, selection, refresh, API status, and session through context. Render `AppShell` around `children` from this provider.

**Step 2: Convert shell navigation to links**

Give every nav item an explicit path. Use `usePathname()` to determine active state and render each `SidebarMenuButton` as a `Link`. Set `aria-current="page"` on the active link and continue closing the mobile sidebar after navigation.

**Step 3: Run static checks**

Run: `pnpm run typecheck && pnpm run lint`

Expected: PASS.

### Task 3: Add the dashboard layout and route pages

**Objective:** Expose each existing view through its own App Router page while preserving shared dashboard state.

**Files:**
- Create: `app/(dashboard)/layout.tsx`
- Create: `app/(dashboard)/overview/page.tsx`
- Create: `app/(dashboard)/reviews/page.tsx`
- Create: `app/(dashboard)/analytics/page.tsx`
- Create: `app/(dashboard)/connections/page.tsx`
- Create: `app/(dashboard)/settings/page.tsx`
- Create: `components/naba-presence/route-views.tsx`
- Modify: `app/page.tsx`

**Step 1: Mount the shared layout**

Wrap route-group children in `NabaPresenceDashboard` from the nested layout.

**Step 2: Build client route adapters**

Use the dashboard context to supply the existing views with their current props. Use `router.push()` only for action buttons embedded inside Overview and Connections; sidebar navigation remains semantic links.

**Step 3: Add thin server pages**

Each page exports route-specific metadata and renders the matching client adapter.

**Step 4: Redirect the root**

Replace the old root mount with `redirect("/reviews")`.

**Step 5: Run the focused route test**

Run: `pnpm exec playwright test tests/e2e/routing.spec.ts`

Expected: PASS.

### Task 4: Align accessibility coverage with the route contract

**Objective:** Make the existing accessibility suite test direct URLs and semantic link navigation.

**Files:**
- Modify: `tests/e2e/accessibility.spec.ts`

**Step 1: Update navigation helpers**

Change dashboard navigation lookup from button role to link role.

**Step 2: Open each surface directly**

Use `/reviews`, `/overview`, `/analytics`, `/connections`, and `/settings` in the relevant tests. Keep navigation clicks where they provide explicit link-transition coverage.

**Step 3: Run focused accessibility checks**

Run: `pnpm exec playwright test tests/e2e/accessibility.spec.ts`

Expected: PASS on desktop and mobile.

### Task 5: Verify the migration

**Objective:** Confirm routing works without regressions and review only the intended diff.

**Files:**
- Verify all files changed above.

**Step 1: Run quality gates**

Run:
- `pnpm run test`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm exec playwright test tests/e2e/routing.spec.ts tests/e2e/accessibility.spec.ts`

Expected: all commands PASS.

**Step 2: Verify HTTP behavior**

Check that `/` redirects and each dashboard route returns 200 from the built application.

**Step 3: Inspect the diff**

Run: `git diff --check` and inspect `git diff` for the route files, provider, shell, and tests. Do not commit or alter unrelated pre-existing worktree changes.
