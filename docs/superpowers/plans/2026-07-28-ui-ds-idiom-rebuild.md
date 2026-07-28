# NabaReview UI/UX DS-Idiom Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all five NabaReview views onto the design system's components and conventions (spec: `docs/superpowers/specs/2026-07-28-ui-ds-idiom-rebuild-design.md`) with zero behaviour or API change.

**Architecture:** The two UI monoliths (`components/naba-review/review-app.tsx`, `components/naba-review/dashboard-views.tsx`) are progressively split into per-view files, each rebuilt on DS idioms as it moves: `Sidebar` family shell, `Tabs` queues, `Item` rows, `Empty` states, Toast success feedback, `AlertDialog` destructive confirms, `Combobox` location picker, filter `Sheet`, `Progress` bars. State management, handlers, and `lib/naba-review-api.ts` calls move verbatim.

**Tech Stack:** Next.js 16 (webpack path), React 19, Tailwind v4, shadcn/ui base-rhea on **Base UI** primitives (`render` prop — `asChild` does not exist), lucide-react, next-themes, Playwright + axe.

## Global Constraints

- Only `components/ui/*` components and semantic token utilities (`bg-card`, `text-muted-foreground`, `fill-rating`, …). Never raw hex, never palette utilities like `bg-blue-600`. No new dependencies.
- Base UI, not Radix: pass custom elements via `render={<Button …/>}`, never `asChild`. `Avatar` is sized with its `size` prop (`"sm" | "default" | "lg"`), never a `size-*` class. `AlertDialog` (not `Dialog`) for destructive confirmation. Every form control gets a `Label`/`aria-label`. `font-mono` for numerals, IDs, timestamps.
- Behaviour and API contracts unchanged. The uncommitted working-tree fixes (session route, analytics/overview retry + loading states) must be preserved — build on the working tree as it stands, never `git checkout --` these files.
- Success feedback → `toast.add(…)` from `@/components/ui/toast`. Errors the user must act on stay inline (`Alert` / field text). Transient sync failures may toast with a retry `actionProps`.
- The a11y suite pins accessible names. Keep: region `aria-label="Review list"`, region `aria-label="Selected review"`, review rows as `<button>`s, nav items as buttons named exactly "Overview"/"Reviews"/"Analytics"/"Connections"/"Settings", the Connections h1 ("Google connection"), the Settings h1 ("Reply policy"). Task 2 intentionally renames the nav trigger + mobile dialog in both UI and test.
- `app/design-system/page.tsx` and `app/page.tsx` route contract stay untouched.
- Work on branch `redesign/ds-idiom-rebuild`. Commit after every task step marked "Commit".
- Gates: `pnpm typecheck && pnpm lint` after every task; `pnpm build` + `pnpm test:a11y` for tasks marked with **[a11y gate]** (a11y runs against a production server — stop any dev server on :3000 first, or let Playwright reuse it; build must be current). `pnpm test` (vitest, needs embedded Postgres) only in the final task — the suite is lib-level and untouched by UI work.
- Browser verification uses the dev server from `.claude/launch.json` at `http://localhost:3000`; check light + dark (header toggle or "d" key) and 390px width for mobile checks.

---

### Task 1: Shared primitives module (verbatim moves, no visual change)

**Files:**
- Create: `components/naba-review/shared.tsx`
- Modify: `components/naba-review/review-app.tsx` (delete moved decls, import from shared)
- Modify: `components/naba-review/dashboard-views.tsx` (delete moved decls, import from shared)

**Interfaces:**
- Consumes: nothing new.
- Produces (exact exports of `shared.tsx`, all moved verbatim from their current definitions):
  - `export type View = "overview" | "reviews" | "analytics" | "connections" | "settings"` (currently a private type in review-app.tsx)
  - `export function readControlValue(event: { currentTarget: unknown }): string` (from review-app.tsx:100)
  - `export function Stars({ value, compact }: { value: number; compact?: boolean })` (review-app.tsx:1387)
  - `export function StatusBadge({ status }: { status: ReviewStatus })` (review-app.tsx:1416)
  - `export function formatTimestamp(value: string): string` (dashboard-views.tsx:412)
  - `export function formatDuration(seconds: number | null): string` (dashboard-views.tsx:820)
  - `export function LiveDataError({ onRetry }: { onRetry: () => void })` (dashboard-views.tsx:388)
  - `export function EmptyData({ message }: { message: string })` (dashboard-views.tsx:404)
  - `export const chartConfig` + its `satisfies ChartConfig` (dashboard-views.tsx:89)

- [ ] **Step 1: Create `components/naba-review/shared.tsx`**

Move each declaration listed under Produces verbatim (body unchanged). File header:

```tsx
"use client"

import { Activity, CheckCircle2, FileCheck2, Inbox, RefreshCw, Star } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { ReviewStatus } from "@/lib/naba-review-data"
```

Adjust the icon import list to exactly what the moved bodies use (Stars uses `Star`; StatusBadge uses `CheckCircle2`, `FileCheck2`, `Inbox`; LiveDataError uses `Activity` and `RefreshCw` — check its body when moving). Add `export` to every moved declaration.

- [ ] **Step 2: Update both source files**

In `review-app.tsx`: delete the moved declarations and the now-local `type View`; add
`import { readControlValue, Stars, StatusBadge, type View } from "@/components/naba-review/shared"`.
In `dashboard-views.tsx`: delete moved declarations; add
`import { chartConfig, EmptyData, formatDuration, formatTimestamp, LiveDataError } from "@/components/naba-review/shared"`.
Replace the private `type Navigate = (view: …) => void` (dashboard-views.tsx:100) usage as-is (it stays local). Remove icon/component imports that became unused in both files (lint will flag them).

- [ ] **Step 3: Gates**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. If lint flags unused imports, remove them.

- [ ] **Step 4: Commit**

```bash
git add components/naba-review/shared.tsx components/naba-review/review-app.tsx components/naba-review/dashboard-views.tsx
git commit -m "refactor: extract shared naba-review primitives module"
```

---

### Task 2: Root Toaster + DS Sidebar app shell + theme toggle **[a11y gate]**

**Files:**
- Modify: `tests/e2e/accessibility.spec.ts:27-35` (nav helper)
- Modify: `app/layout.tsx` (mount Toaster)
- Create: `components/naba-review/app-shell.tsx`
- Modify: `components/naba-review/review-app.tsx` (use AppShell; delete hand-rolled shell)

**Interfaces:**
- Consumes: `type View` from `shared.tsx`; `type AppSession` from `@/lib/naba-review-api`.
- Produces: `export function AppShell({ activeView, onNavigate, apiStatus, session, children }: { activeView: View; onNavigate: (view: View) => void; apiStatus: "loading" | "connected" | "error"; session: AppSession | null; children: React.ReactNode })`.

- [ ] **Step 1: Update the a11y nav helper first (this is the failing test)**

Replace `openNavigationSurface` (tests/e2e/accessibility.spec.ts:27-35) and its two call sites:

```ts
async function openNavigationSurface(page: Page, name: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "Toggle navigation" }).click()
  }
  await page.getByRole("button", { name, exact: true }).click()
  if (mobile) {
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden()
  }
}
```

Call sites become `await openNavigationSurface(page, "Connections", viewport.name === "mobile")` and `await openNavigationSurface(page, "Settings", viewport.name === "mobile")`.
Rationale: the DS `Sidebar` renders its mobile sheet with sr-only title "Sidebar", and its trigger is a toggle; on desktop the nav buttons are always visible so the helper only opens the sheet on mobile.

- [ ] **Step 2: Run the a11y suite to verify it fails against the old shell**

Run: `pnpm build && pnpm test:a11y`
Expected: FAIL — mobile connections/settings tests cannot find button "Toggle navigation" (old trigger is "Open navigation").

- [ ] **Step 3: Mount the Toaster in `app/layout.tsx`**

```tsx
import { Toaster } from "@/components/ui/toast"
```

and change the body to:

```tsx
<ThemeProvider>
  <TooltipProvider>
    <Toaster>{children}</Toaster>
  </TooltipProvider>
</ThemeProvider>
```

(`Toaster` wraps the Base UI `ToastProvider` bound to the module-global `toast` manager plus portal/viewport/list; any component may call `toast.add(...)`.)

- [ ] **Step 4: Create `components/naba-review/app-shell.tsx`**

```tsx
"use client"

import {
  BarChart3,
  Building2,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
} from "lucide-react"
import { useTheme } from "next-themes"

import { type View } from "@/components/naba-review/shared"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { type AppSession } from "@/lib/naba-review-api"

const NAV_ITEMS: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "reviews", label: "Reviews", icon: MessageSquareText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "settings", label: "Settings", icon: Settings },
]

export function AppShell({
  activeView,
  onNavigate,
  apiStatus,
  session,
  children,
}: {
  activeView: View
  onNavigate: (view: View) => void
  apiStatus: "loading" | "connected" | "error"
  session: AppSession | null
  children: React.ReactNode
}) {
  const organisationName = session?.organisationName ?? "Your organisation"
  const displayName = session?.displayName ?? "Account"
  const userInitials =
    displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AC"

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="h-16 shrink-0 justify-center border-b px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MessageSquareText className="size-4" aria-hidden />
            </span>
            <span className="font-heading text-base font-semibold tracking-tight">
              NabaReview
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <ShellNav activeView={activeView} onNavigate={onNavigate} />
        </SidebarContent>
        <SidebarFooter className="border-t">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <Avatar size="sm">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">
                {session?.role ?? "member"}
              </span>
            </div>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium">{organisationName}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground lg:flex">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  apiStatus === "connected"
                    ? "bg-success"
                    : apiStatus === "loading"
                      ? "bg-rating"
                      : "bg-muted-foreground"
                )}
              />
              {apiStatus === "connected"
                ? "Live data"
                : apiStatus === "loading"
                  ? "Checking live data"
                  : "Live data unavailable"}
            </div>
            <ThemeToggle />
            <Avatar size="sm">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ShellNav({
  activeView,
  onNavigate,
}: {
  activeView: View
  onNavigate: (view: View) => void
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeView === item.id}
                  onClick={() => {
                    onNavigate(item.id)
                    setOpenMobile(false)
                  }}
                >
                  <Icon aria-hidden />
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ThemeToggle() {
  const { setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Change theme" />
        }
      >
        <Sun className="dark:hidden" aria-hidden />
        <Moon className="hidden dark:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Notes for the implementer: the removed Bell button, org chevron, and mobile nav `Sheet` are deliberate (spec §1). `SidebarInset` renders the page `<main>`, so the content wrapper here is a `div` — do not nest another `main`. `SidebarMenuButton` renders a real `<button>` whose accessible name is the label text, which the a11y helper clicks by exact name.

- [ ] **Step 5: Rewire `components/naba-review/review-app.tsx`**

In `NabaReviewApp`, replace everything from `return (` down (the outer `div`, `aside`, mobile `Sheet`, header) with:

```tsx
return (
  <AppShell
    activeView={activeView}
    onNavigate={navigate}
    apiStatus={apiStatus}
    session={session}
  >
    {activeView === "overview" ? (
      <OverviewView
        reviews={reviews}
        onNavigate={navigate}
        displayName={displayName}
        organisationName={organisationName}
      />
    ) : null}
    {activeView === "reviews" ? (
      <ReviewsWorkspace
        reviews={reviews}
        setReviews={setReviews}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        apiStatus={apiStatus}
        onRefresh={refreshReviews}
      />
    ) : null}
    {activeView === "analytics" ? <AnalyticsView /> : null}
    {activeView === "connections" ? (
      <ConnectionsView onNavigate={() => navigate("settings")} />
    ) : null}
    {activeView === "settings" ? <SettingsView /> : null}
  </AppShell>
)
```

Keep `displayName`/`organisationName` derivations where OverviewView needs them; delete `mobileNavOpen` state, the `Brand`, `SidebarNavigation`, `SidebarFooter` functions, `NAV_ITEMS`, and all imports that became unused (Sheet parts, Menu, Bell, ChevronDown, Building2, Tooltip parts, Avatar if unused). `navigate()` no longer calls `setMobileNavOpen`.

- [ ] **Step 6: Gates + browser check**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:a11y`
Expected: all PASS (a11y now finds "Toggle navigation" and the "Sidebar" dialog).
Browser: sidebar collapses via trigger on desktop; at 390px the trigger opens the sheet and navigating closes it; theme menu switches light/dark/system; Reviews pane still fills the viewport (`h-[calc(100svh-4rem)]` in ReviewsWorkspace still holds inside `SidebarInset` — if the inbox no longer fills or double-scrolls, adjust that calc in ReviewsWorkspace, not the shell).

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/accessibility.spec.ts app/layout.tsx components/naba-review/app-shell.tsx components/naba-review/review-app.tsx
git commit -m "feat: DS Sidebar app shell, theme toggle, root Toaster"
```

---

### Task 3: Extract the Reviews workspace (verbatim move)

**Files:**
- Create: `components/naba-review/reviews-view.tsx`
- Modify: `components/naba-review/review-app.tsx`

**Interfaces:**
- Produces: `export function ReviewsWorkspace(props)` with the exact current prop type from review-app.tsx:401-415 (`reviews`, `setReviews`, `selectedId`, `setSelectedId`, `apiStatus`, `onRefresh`). Internal (unexported, moved along): `ReviewRow`, `ReviewDetail`, `VerificationPanel`, `ActivityTimeline`, `QUEUES`, `mergeLocationDirectory`, `type Queue`.

- [ ] **Step 1: Move**

Create `reviews-view.tsx` with `"use client"` and move from review-app.tsx, bodies unchanged: `mergeLocationDirectory`, `QUEUES`, `type Queue`, `ReviewsWorkspace`, `ReviewRow`, `ReviewDetail`, `VerificationPanel`, `ActivityTimeline`. Bring their imports (lucide icons, ui components, `cn`, `Review`/`ReviewStatus`, api functions `generateDraft`/`loadReviewDetail`/`loadReviewsPage`/`publishDraft`/`saveDraft as saveDraftToApi`, and `readControlValue`/`Stars`/`StatusBadge` from `./shared`). In review-app.tsx add `import { ReviewsWorkspace } from "@/components/naba-review/reviews-view"` and delete everything moved plus newly unused imports.

- [ ] **Step 2: Gates**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/naba-review/reviews-view.tsx components/naba-review/review-app.tsx
git commit -m "refactor: move reviews workspace into reviews-view module"
```

---

### Task 4: Reviews list UX — Tabs queues, filter Sheet, Combobox, Item rows, Empty states **[a11y gate]**

**Files:**
- Modify: `components/naba-review/reviews-view.tsx`

**Interfaces:**
- Consumes: `Tabs/TabsList/TabsTrigger/TabsContent` (`@/components/ui/tabs`), `Sheet` family, `Combobox` family, `Item` family, `Empty` family, `Badge`, `Field`/`FieldLabel` (for Sheet controls).
- Produces: no export changes. Adds internal `function clearFilters()` inside `ReviewsWorkspace` that later steps and the Empty state call.

- [ ] **Step 1: Queue chips → Tabs**

Wrap the workspace in a `Tabs` root and make the list/detail grid its single panel, so the tablist controls a real tabpanel (a11y-correct without duplicating content):

- Outer container `div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col"` becomes
  `<Tabs value={queue} onValueChange={(value) => setQueue(value as Queue)} className="flex h-[calc(100svh-4rem)] min-h-0 flex-col gap-0">`.
- The chip row (`QUEUES.map` of plain buttons) becomes:

```tsx
<TabsList
  variant="line"
  aria-label="Review queues"
  className="w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
  {QUEUES.map((item) => {
    const count =
      item.id === "all"
        ? reviews.length
        : reviews.filter((review) => review.status === item.id).length
    return (
      <TabsTrigger key={item.id} value={item.id} className="shrink-0 flex-none px-3">
        {item.label}
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      </TabsTrigger>
    )
  })}
</TabsList>
```

- The `grid min-h-0 flex-1 lg:grid-cols-[…]` div becomes
  `<TabsContent value={queue} className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,0.78fr)_minmax(520px,1.4fr)]">`
  (its `value` always equals the active tab, so the one panel stays mounted and correctly labelled).

- [ ] **Step 2: Split filters — inline four, Sheet for the rest**

Keep inline: search `InputGroup`, location, rating `Select`, sort `Select`. Replace the location `Select` with the DS Combobox:

```tsx
<Combobox
  items={locationItems}
  value={location}
  onValueChange={(value) => setLocation(value ?? "All locations")}
>
  <ComboboxInput
    placeholder="All locations"
    aria-label="Filter by location"
    className="w-44"
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
```

with `const locationItems = ["All locations", ...locationDirectory.keys()]` memoised alongside `locationDirectory`. (Base UI `Combobox.Root` filters `items` by the typed input; `ComboboxList` receives the render-function child.)

Move the five remaining `Select`s (date range, reply state, verification, publish status, sync status) unchanged into a `Sheet`, each wrapped in a labelled `Field`:

```tsx
<Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
  <SheetTrigger
    render={<Button variant="outline" size="sm" />}
  >
    <SlidersHorizontal data-icon="inline-start" />
    Filters
    {activeFilterCount > 0 ? (
      <Badge variant="secondary" className="font-mono">{activeFilterCount}</Badge>
    ) : null}
  </SheetTrigger>
  <SheetContent side="right" className="w-[320px]">
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Narrow the review inbox. Changes apply immediately.</SheetDescription>
    </SheetHeader>
    <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
      <Field>
        <FieldLabel htmlFor="filter-date">Date range</FieldLabel>
        {/* existing date-range Select, trigger id="filter-date", full width */}
      </Field>
      {/* … repeat Field wrapper for reply state, verification, publish status, sync status,
            moving each existing Select verbatim, SelectTrigger className="w-full" … */}
    </div>
    <SheetFooter>
      <Button variant="outline" onClick={clearFilters}>Clear all filters</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

New state `const [filtersOpen, setFiltersOpen] = useState(false)`. Add:

```tsx
const activeFilterCount = [
  dateRange !== "all",
  replyState !== "all",
  verification !== "all",
  publishState !== "all",
  syncState !== "all",
].filter(Boolean).length

function clearFilters() {
  setQuery("")
  setLocation("All locations")
  setRating("all")
  setDateRange("all")
  setReplyState("all")
  setVerification("all")
  setPublishState("all")
  setSyncState("all")
  setSort("updated_desc")
}
```

Import `SlidersHorizontal` from lucide-react.

- [ ] **Step 3: Active-filter chips beside the trigger**

Directly after the Sheet trigger render a chip per active Sheet filter:

```tsx
{activeFilters.map((filter) => (
  <Badge key={filter.key} variant="secondary" className="gap-1 pr-1">
    {filter.label}
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Remove ${filter.label} filter`}
      onClick={filter.clear}
      className="size-4 rounded-full"
    >
      <X />
    </Button>
  </Badge>
))}
```

built from:

```tsx
const activeFilters = [
  dateRange !== "all" && {
    key: "date",
    label: dateRange === "7d" ? "Last 7 days" : "Last 30 days",
    clear: () => setDateRange("all"),
  },
  replyState !== "all" && {
    key: "reply",
    label: replyState === "replied" ? "Replied" : "Unreplied",
    clear: () => setReplyState("all"),
  },
  verification !== "all" && {
    key: "verification",
    label: `Verification: ${verification}`,
    clear: () => setVerification("all"),
  },
  publishState !== "all" && {
    key: "publish",
    label: publishState.replaceAll("_", " "),
    clear: () => setPublishState("all"),
  },
  syncState !== "all" && {
    key: "sync",
    label: `Sync: ${syncState}`,
    clear: () => setSyncState("all"),
  },
].filter((filter): filter is Exclude<typeof filter, false> => Boolean(filter))
```

Import `X` from lucide-react. If `Button` has no `icon-xs` size (check `components/ui/button.tsx` variants), use `size="icon-sm"` with `className="size-4"`.

- [ ] **Step 4: List rows → Item**

Replace `ReviewRow`'s hand-rolled `<button>` with an `Item` rendered as a button (rows must stay buttons for the a11y suite), and wrap the list in `ItemGroup`:

```tsx
function ReviewRow({ review, selected, onSelect }: { review: Review; selected: boolean; onSelect: () => void }) {
  return (
    <Item
      render={
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
        />
      }
      size="sm"
      className={cn(
        "text-left transition-colors",
        selected ? "bg-accent/70" : "hover:bg-muted/60"
      )}
    >
      <ItemMedia>
        <Avatar size="sm">
          <AvatarFallback>{review.initials}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <div className="flex w-full items-start justify-between gap-3">
          <ItemTitle>{review.reviewer}</ItemTitle>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {review.postedAt.split(",")[0]}
          </span>
        </div>
        <ItemDescription className="line-clamp-1">{review.location}</ItemDescription>
        <Stars value={review.rating} compact />
        <ItemDescription>{review.excerpt}</ItemDescription>
        <div className="mt-1">
          <StatusBadge status={review.status} />
        </div>
      </ItemContent>
    </Item>
  )
}
```

List container (inside the ScrollArea) becomes `<ItemGroup className="gap-1 p-2">…</ItemGroup>`. Delete the old row markup and per-row `border-b`.

- [ ] **Step 5: Empty states → Empty family**

"No reviews found" block becomes:

```tsx
<Empty className="min-h-80 border-0">
  <EmptyHeader>
    <EmptyMedia variant="icon">
      <Search aria-hidden />
    </EmptyMedia>
    <EmptyTitle>No reviews found</EmptyTitle>
    <EmptyDescription>Try changing your filters or search.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button variant="outline" size="sm" onClick={clearFilters}>
      Clear filters
    </Button>
  </EmptyContent>
</Empty>
```

The no-selection detail placeholder ("Connect Google and link a verified location to begin.") becomes an `Empty` with `EmptyTitle` "No review selected" and that sentence as `EmptyDescription` (no action button).

- [ ] **Step 6: Gates + browser check**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:a11y`
Expected: PASS (rows are still buttons inside region "Review list"; tabs are keyboard-navigable).
Browser: queue tabs switch with arrow keys; filter Sheet opens right, changing a Select updates the list ~250 ms later; chips appear/remove; Combobox filters as you type; empty state shows on an impossible search and "Clear filters" restores; dark mode: menus/sheet legible.

- [ ] **Step 7: Commit**

```bash
git add components/naba-review/reviews-view.tsx
git commit -m "feat: rebuild review inbox on Tabs, filter Sheet, Combobox, Item and Empty"
```

---

### Task 5: Review detail — toasts, mono metadata, honest controls **[a11y gate]**

**Files:**
- Modify: `components/naba-review/reviews-view.tsx` (`ReviewDetail` only)

**Interfaces:**
- Consumes: `toast` from `@/components/ui/toast` (`toast.add({ type, title, description? })`).
- Produces: no export changes.

- [ ] **Step 1: Success feedback → toasts; errors stay inline**

In `ReviewDetail`, keep the `feedback` state but use it **only for errors**: delete `feedbackKind`; every success path replaces `setFeedback(…)`/`setFeedbackKind("success")` with a toast:

- `regenerate()` success → `toast.add({ type: "success", title: "A new verified draft is ready." })`
- `saveDraft()` success → `toast.add({ type: "success", title: "Draft saved", description: "Recorded in the review audit trail." })`
- `publish()` success → `toast.add({ type: "success", title: status === "awaiting_approval" ? "Reply submitted for approval." : "Reply sent to Google." })`

Error paths keep `setFeedback(message)`; the inline `<p role="status">` keeps rendering only when `feedback` is set, always with `text-destructive` (drop the success class branch).

- [ ] **Step 2: Honest controls** *(amended 2026-07-28, user-approved: tone stays)*

- KEEP the tone `Select`: adopted parallel reply-policy work wired it (`tone` state of type `DraftTone` from `@/lib/domain/reply-policy`, passed to `generateDraft`/`saveDraftToApi`; controlled `value={tone}`, `aria-label="Reply tone"`). Verify the wiring is intact and the trigger stays labelled; do not restyle it beyond the task's mono/toast changes.
- VERIFY the parked Task-4 finding is resolved in the committed file: the filter `SheetContent` must carry `className="w-[320px]!"` (with the `!`) so the 320px width beats the component's `data-[side=right]:w-3/4` — confirm in the browser that the sheet renders 320px wide.
- In the actions `DropdownMenu`: "Copy review ID" gets
  `onClick={() => { void navigator.clipboard.writeText(review.id); toast.add({ type: "success", title: "Review ID copied" }) }}`.
  Delete "Open audit trail" and the destructive "Report an issue" group (dead).

- [ ] **Step 3: Mono metadata**

- Byte counter span already `font-mono` — keep.
- "Original language", "Posted …", "Updated …" metadata spans get `font-mono` only on numeric/timestamp fragments where they are standalone spans (`Posted {review.postedAt…}` stays prose; the `{review.updatedAt…}` span in the review card gets `font-mono text-[11px]`).
- Timeline event timestamps (`event.detail` in `ActivityTimeline`) get `font-mono`.

- [ ] **Step 4: Gates + browser check**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:a11y`
Expected: PASS.
Browser: save a draft (with dev DB or preview data: expect a toast bottom-right); force an error (stop the API/dev DB) and confirm the message renders inline, not as toast; copy review ID puts the id on the clipboard.

- [ ] **Step 5: Commit**

```bash
git add components/naba-review/reviews-view.tsx
git commit -m "feat: toast success feedback and honest controls in review detail"
```

---

### Task 6: Overview view — extract + state polish

**Files:**
- Create: `components/naba-review/overview-view.tsx`
- Modify: `components/naba-review/dashboard-views.tsx`, `components/naba-review/review-app.tsx`, `components/naba-review/shared.tsx`

**Interfaces:**
- Produces: `export function OverviewView({ reviews, onNavigate, displayName, organisationName })` — exact current prop type (dashboard-views.tsx:106). Moves along (unexported): `MetricCard`, `HealthRow`, `type Navigate`.
- Modifies shared: `EmptyData({ message })` is rebuilt on the `Empty` family (same signature, used by Overview and Analytics).

- [ ] **Step 1: Move `OverviewView` + `MetricCard` + `HealthRow` + `type Navigate`**

Verbatim into `overview-view.tsx` (`"use client"`, imports incl. recharts `Area/AreaChart/CartesianGrid/XAxis/YAxis`, chart components, `chartConfig`/`EmptyData`/`formatTimestamp`/`LiveDataError`/`Stars` from `./shared` as needed). Update `review-app.tsx` import to `@/components/naba-review/overview-view`; delete moved code + unused imports from dashboard-views.tsx.

- [ ] **Step 2: Rebuild `EmptyData` in `shared.tsx` on the Empty family**

```tsx
export function EmptyData({ message }: { message: string }) {
  return (
    <Empty className="min-h-[220px] border-0 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base">Nothing to show yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
```

(Import the Empty family in shared.tsx; `Inbox` already imported for StatusBadge.)

- [ ] **Step 3: Mono numerals**

In `MetricCard`, the value element gets `font-mono` (keep size classes). In `HealthRow`, numeric value spans get `font-mono`. Chart axis ticks stay as-is (recharts defaults).

- [ ] **Step 4: Gates + browser check**

Run: `pnpm typecheck && pnpm lint`
Browser: Overview renders with metric values in mono; kill the API to see `LiveDataError` retry still working (the working-tree retry fix must remain: `retryOverview` resets data + status before bumping `reloadKey`).

- [ ] **Step 5: Commit**

```bash
git add components/naba-review/overview-view.tsx components/naba-review/dashboard-views.tsx components/naba-review/review-app.tsx components/naba-review/shared.tsx
git commit -m "feat: overview view on shared Empty states and mono numerals"
```

---

### Task 7: Analytics view — extract + Progress bars

**Files:**
- Create: `components/naba-review/analytics-view.tsx`
- Modify: `components/naba-review/dashboard-views.tsx`, `components/naba-review/review-app.tsx`

**Interfaces:**
- Produces: `export function AnalyticsView()` (no props, unchanged). Moves along: nothing else (uses shared `formatDuration`, `chartConfig`, `EmptyData`, `LiveDataError`).

- [ ] **Step 1: Move `AnalyticsView`**

Verbatim into `analytics-view.tsx`; preserve the working-tree fixes (`beginAnalyticsLoad`, `retryAnalytics`, the `onValueChange` that calls `beginAnalyticsLoad` before `setDateRange`). Update `review-app.tsx` import; clean dashboard-views.tsx.

- [ ] **Step 2: Response-rate table cells get Progress**

In the "Location performance" table, the response-rate cell becomes:

```tsx
<TableCell>
  <div className="flex min-w-32 flex-col gap-1.5">
    <span className="font-mono text-xs">{row.responseRate}</span>
    <Progress
      value={row.responseRateValue}
      aria-label={`Response rate for ${row.location}`}
    />
  </div>
</TableCell>
```

(`Progress` already renders its track + indicator internally; `row.responseRateValue` is 0-100.)

- [ ] **Step 3: Mono numerals**

Numeric table cells (`rating`, `reviews`, `median`, `p95`, `complaints`, `rejectionRate`) get `font-mono text-xs` (via a shared `className` on those `TableCell`s). The date-range/granularity `NativeSelect`s stay.

- [ ] **Step 4: Gates + browser check**

Run: `pnpm typecheck && pnpm lint`
Browser: table shows progress bars scaled to response rate; switching date range shows skeletons then data (working-tree loading fix intact); error → retry works.

- [ ] **Step 5: Commit**

```bash
git add components/naba-review/analytics-view.tsx components/naba-review/dashboard-views.tsx components/naba-review/review-app.tsx
git commit -m "feat: analytics view with response-rate progress and mono numerals"
```

---

### Task 8: Connections view — AlertDialog disconnect, Item rows, Progress backfill **[a11y gate]**

**Files:**
- Create: `components/naba-review/connections-view.tsx`
- Modify: `components/naba-review/dashboard-views.tsx`, `components/naba-review/review-app.tsx`

**Interfaces:**
- Consumes: `AlertDialog` family, `Item` family, `Progress`/`ProgressLabel`/`ProgressValue`, `toast`.
- Produces: `export function ConnectionsView({ onNavigate }: { onNavigate?: () => void })` (unchanged). Moves along: `SetupProgress`, `GuidanceItem`, `ConnectionSetupSkeleton`, `formatAddress`, `formatGoogleAddress`, `isLocationCandidate`.

- [ ] **Step 1: Move**

`ConnectionsView` + the five helpers verbatim into `connections-view.tsx`; keep the h1 text exactly as it is today (the a11y suite matches heading "Google connection"). Update `review-app.tsx` import; clean dashboard-views.tsx.

- [ ] **Step 2: Disconnect gets an AlertDialog**

Replace the bare `onClick={disconnect}` Button with:

```tsx
<AlertDialog>
  <AlertDialogTrigger
    render={<Button variant="outline" size="sm" disabled={isPending} />}
  >
    <Unplug data-icon="inline-start" />
    Disconnect
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
      <AlertDialogDescription>
        Review sync stops immediately, and the scheduled policy cleanup removes
        Google data within 7 days. You can reconnect at any time.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction variant="destructive" onClick={disconnect}>
        Disconnect
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

`AlertDialogAction` is a plain `Button` (it does not auto-close); `disconnect()` already flips state that re-renders the card, but ALSO wrap the dialog in controlled state if the dialog stays open after confirming: `const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)` + `open`/`onOpenChange` + `onClick={() => { setConfirmDisconnectOpen(false); disconnect() }}` — verify in the browser and use the controlled form if needed.
On disconnect success, keep the existing status message AND add `toast.add({ type: "success", title: "Google disconnected", description: "Policy cleanup is scheduled within 7 days." })`.

- [ ] **Step 3: Location import rows → Item + Checkbox**

Each Google-location row in "Choose locations to import" becomes an `Item` (`variant="outline"`, `size="sm"`) inside `ItemGroup`:
`ItemMedia` holds the existing `Checkbox` (keep its current `aria-label` and checked/onCheckedChange wiring verbatim), `ItemContent` holds `ItemTitle` (location title) + `ItemDescription` (formatted address + verification state), `ItemActions` holds the existing workspace-location `NativeSelect` (keep its `aria-label`). Layout only — no handler changes.

The "Search Google locations" field above the rows becomes an `InputGroup` with a `Search` icon `InputGroupAddon` + `InputGroupInput` (keep `aria-label="Search Google locations"` and the existing value/onChange). The `SetupProgress` and `GuidanceItem` helpers stay structurally as they are — just confirm every colour/border they use is a token utility (they should already be; fix any stray non-token class found).

- [ ] **Step 4: Backfill progress → Progress**

Where "Historical review import" renders its progress (percentage/status text driven by `BackfillProgress`), render:

```tsx
<Progress value={progressPct} aria-label="Historical import progress">
  <ProgressLabel>Importing reviews</ProgressLabel>
  <ProgressValue />
</Progress>
```

with `progressPct` computed from the existing `BackfillProgress` fields the current markup already displays (keep the current derivation; if the current UI shows counts rather than percent, compute `Math.round((done / total) * 100)` from those same fields and keep the counts as adjacent mono text). On backfill failure, add
`toast.add({ type: "error", title: "Import failed", description: message, actionProps: { children: "Retry", onClick: () => void runImport() } })`
where `runImport` is the existing backfill-start handler; keep the inline failure text too (errors stay actionable in place).

- [ ] **Step 5: Mono identifiers**

Pub/Sub topic value, connection IDs, and timestamps in this view get `font-mono` (the topic `Input` gets `className="font-mono"`).

- [ ] **Step 6: Gates + browser check**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:a11y`
Expected: PASS (connections heading unchanged).
Browser: Disconnect now confirms before acting; cancel does nothing; location rows render as bordered items with working checkboxes/selects.

- [ ] **Step 7: Commit**

```bash
git add components/naba-review/connections-view.tsx components/naba-review/dashboard-views.tsx components/naba-review/review-app.tsx
git commit -m "feat: connections view with confirmed disconnect, Item rows and Progress"
```

---

### Task 9: Settings view — Field completion, Item members, honest retention, confirmed privacy actions **[a11y gate]**

**Files:**
- Create: `components/naba-review/settings-view.tsx`
- Delete: `components/naba-review/dashboard-views.tsx` (empty after this move)
- Modify: `components/naba-review/review-app.tsx`

**Interfaces:**
- Produces: `export function SettingsView()` (no props, unchanged).

- [ ] **Step 1: Move `SettingsView`**

Verbatim into `settings-view.tsx`; keep the h1 "Reply policy" (a11y suite matches it). Update `review-app.tsx` import. `dashboard-views.tsx` should now export nothing — delete the file and remove any residual references.

- [ ] **Step 2: Complete the Field idiom**

Audit every card: any control not inside a `Field` with `FieldLabel` (or explicit `aria-label` where a visible label is wrong) gets wrapped; group related fields in `FieldGroup`; replace ad-hoc `Separator`s between field clusters with `FieldSeparator`. The "Team access" add-member inputs (display name, email, role) become three `Field`s in a `grid gap-3 sm:grid-cols-3`.

- [ ] **Step 3: Member rows → Item**

Each member row becomes:

```tsx
<Item variant="outline" size="sm">
  <ItemMedia>
    <Avatar size="sm">
      <AvatarFallback>{memberInitials}</AvatarFallback>
    </Avatar>
  </ItemMedia>
  <ItemContent>
    <ItemTitle>{member.displayName}</ItemTitle>
    <ItemDescription>{member.email}</ItemDescription>
  </ItemContent>
  <ItemActions>
    {/* existing role NativeSelect and publish Switch, moved verbatim with their aria-labels */}
  </ItemActions>
</Item>
```

inside `ItemGroup className="gap-2"`. Derive `memberInitials` the same way the current row does (keep existing logic).

- [ ] **Step 4: Honest retention rows**

In "Data retention", each `Switch checked disabled` row becomes:

```tsx
<Item variant="muted" size="sm">
  <ItemContent>
    <ItemTitle>{/* existing row title */}</ItemTitle>
    <ItemDescription>{/* existing row description */}</ItemDescription>
  </ItemContent>
  <ItemActions>
    <Badge variant="secondary">Enforced</Badge>
  </ItemActions>
</Item>
```

Only rows whose switches are decorative (`disabled` + hardwired `checked`) convert; a switch the user can actually change stays a labelled `Switch`.

- [ ] **Step 5: Confirmed privacy actions + toasts**

- Creating a privacy request (`createPrivacyRequest`) gets the AlertDialog pattern from Task 8 Step 2 verbatim (Title "Create privacy request?", Description explaining it starts a tracked erasure/export workflow, destructive action label "Create request").
- Settings save (`saveSettings`), member add (`addMember`), member update (`updateMember`), audit export success → `toast.add({ type: "success", title: … })` with the message text the inline status currently shows; failures keep inline text.

- [ ] **Step 6: Gates + browser check**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:a11y`
Expected: PASS ("Reply policy" heading intact; every control labelled).
Browser: save settings → toast; retention rows read as enforced facts; member role change works.

- [ ] **Step 7: Commit**

```bash
git add components/naba-review/settings-view.tsx components/naba-review/review-app.tsx
git rm components/naba-review/dashboard-views.tsx
git commit -m "feat: settings view on Field, Item and confirmed privacy actions"
```

---

### Task 10: Final validation sweep **[a11y gate]**

**Files:**
- Modify: `README.md` (operational references list)

- [ ] **Step 1: Full gate run**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:a11y`
Expected: all PASS. (`pnpm test` needs the embedded-Postgres runtime; it exercises lib code only.)

- [ ] **Step 2: Browser sweep**

With the dev server: every view in light AND dark; 390px pass over sidebar sheet, reviews list→detail→back, filter Sheet, connections wizard, settings forms; confirm no console errors; confirm `/design-system` proof sheet unchanged.

- [ ] **Step 3: Document**

Append to README's "Operational references" list:
`- [UI DS-idiom rebuild design](docs/superpowers/specs/2026-07-28-ui-ds-idiom-rebuild-design.md)`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link UI redesign spec from README"
```
