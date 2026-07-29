# NabaPresence Full Design-System Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every shipping NabaPresence surface with the approved floating-depth design language while preserving shadcn/ui, Base UI, product behavior, and API contracts.

**Architecture:** Keep `components/ui/*` as the generic accessible primitive layer and carry the replacement primarily through semantic CSS variables and shared variants. Compose business-specific presentation in `components/naba-presence/*`, then migrate the shell and six views in reviewable stages without importing the reference package's prototype runtime.

**Tech Stack:** Next.js 16.2, React 19.2, TypeScript 5, Tailwind CSS 4, shadcn/ui base-rhea, Base UI, Vitest 4, Playwright 1.62, axe-core.

## Global Constraints

- Read relevant guides under `node_modules/next/dist/docs/` before editing Next.js CSS or font integration.
- Preserve the current Google/GBP semantic color values and `next/font/local` ownership of Geist and Geist Mono.
- Keep every existing `components/ui/*` component available; do not import `.nr-*`, `injectCss`, or the incoming `styles.css`.
- Preserve all API contracts, product state, permissions, verification, publishing, retries, and recovery behavior.
- Use Base UI for focus, keyboard behavior, overlays, dismissal, and focus restoration.
- Use semantic variables only; do not add raw product hex values or Tailwind palette utilities.
- Strong glass is limited to navigation and floating chrome. Prose, forms, tables, popovers, dialogs, sheets, and publishing surfaces remain opaque.
- Preserve light/dark modes, reduced motion, no-blur fallback, 200% zoom, and 44px mobile targets.
- Do not modify or revert unrelated worktree changes. Stage only files named by the active task.
- Keep the application functional after every task.
- Before a focused Playwright command, run `pnpm dev` in a separate terminal so Playwright reuses the live development server; the repository has no named Playwright projects.

## File Ownership

- `app/globals.css`: color, typography, spacing, radius, elevation, glass, motion, layout, and shell atmosphere tokens.
- `app/design-system/page.tsx`: production proof sheet.
- `components/ui/{button,card,input,textarea,badge,item,sidebar}.tsx`: generic primitive appearance only.
- `components/naba-presence/app-shell.tsx`: global shell and responsive navigation.
- `components/naba-presence/shared.tsx`: shared page, business context, metric, status, empty, and error compositions.
- `components/naba-presence/*-view.tsx`: view-specific composition without API changes.
- `tests/design-system-contract.test.ts`: static foundation/runtime contract.
- `tests/e2e/accessibility.spec.ts`: semantic, responsive, keyboard, and axe coverage.

---

### Task 1: Foundation Tokens and Static Contract

**Files:**
- Create: `tests/design-system-contract.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: current semantic colors and Tailwind mappings.
- Produces: `--nr-*` layout, surface, radius, elevation, glass, and motion tokens consumed by every later task.

- [ ] **Step 1: Read repository-specific Next.js guidance**

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md
```

Expected: global CSS remains owned by the root layout and fonts remain owned by `next/font/local`.

- [ ] **Step 2: Write the failing token contract**

Create `tests/design-system-contract.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const tokens = [
  "--nr-space-1", "--nr-space-14", "--nr-sidebar-width",
  "--nr-page-pad-x", "--nr-page-max-width", "--nr-radius-control",
  "--nr-radius-card", "--nr-radius-panel", "--nr-radius-modal",
  "--nr-shadow-card", "--nr-shadow-float", "--nr-shadow-modal",
  "--nr-surface-glass", "--nr-surface-glass-strong",
  "--nr-surface-card-translucent", "--nr-duration-fast",
  "--nr-duration-overlay", "--nr-ease-standard",
]

describe("NabaPresence design system", () => {
  it.each(tokens)("defines %s", (token) => expect(globals).toContain(`${token}:`))
  it("provides motion and blur fallbacks", () => {
    expect(globals).toContain("prefers-reduced-motion: reduce")
    expect(globals).toContain("@supports not ((backdrop-filter: blur(1px))")
  })
  it("does not import the prototype runtime", () => {
    expect(globals).not.toContain(".nr-btn")
    expect(globals).not.toContain("injectCss")
  })
})
```

- [ ] **Step 3: Prove the contract fails**

Run `pnpm vitest run tests/design-system-contract.test.ts`.

Expected: FAIL because the `--nr-*` tokens are absent.

- [ ] **Step 4: Add the exact approved token families**

In `:root`, add the reference values for:

```css
--info: oklch(0.57 0.12 230);
--info-foreground: oklch(1 0 0);
--nr-space-1: 2px;  --nr-space-2: 4px;  --nr-space-3: 6px;
--nr-space-4: 8px;  --nr-space-5: 10px; --nr-space-6: 12px;
--nr-space-7: 14px; --nr-space-8: 16px; --nr-space-9: 20px;
--nr-space-10: 24px; --nr-space-11: 28px; --nr-space-12: 32px;
--nr-space-13: 40px; --nr-space-14: 48px;
--nr-sidebar-width: 256px; --nr-sidebar-margin: 14px;
--nr-page-pad-x: 30px; --nr-page-pad-y: 26px; --nr-page-max-width: 1180px;
--nr-gap-card: 14px; --nr-gap-section: 22px;
--nr-card-pad: 18px; --nr-panel-pad: 20px;
--nr-radius-tag: 6px; --nr-radius-chip: 8px; --nr-radius-control: 12px;
--nr-radius-field: 14px; --nr-radius-card: 18px; --nr-radius-panel: 20px;
--nr-radius-shell: 22px; --nr-radius-modal: 24px; --nr-radius-pill: 999px;
--nr-shadow-card: 0 6px 20px rgb(0 0 0 / 0.05);
--nr-shadow-panel: 0 8px 28px rgb(0 0 0 / 0.06);
--nr-shadow-float: 0 12px 32px rgb(0 0 0 / 0.07);
--nr-shadow-hover: 0 12px 28px rgb(0 0 0 / 0.09);
--nr-shadow-pop: 0 16px 48px rgb(0 0 0 / 0.14);
--nr-shadow-modal: 0 24px 80px rgb(0 0 0 / 0.22);
--nr-shadow-primary: 0 4px 14px color-mix(in srgb, var(--primary) 35%, transparent);
--nr-glass-filter: blur(12px) saturate(1.35);
--nr-surface-glass: color-mix(in srgb, var(--card) 62%, transparent);
--nr-surface-glass-strong: color-mix(in srgb, var(--card) 70%, transparent);
--nr-surface-card-translucent: color-mix(in srgb, var(--card) 66%, transparent);
--nr-surface-glass-border: color-mix(in srgb, var(--border) 55%, transparent);
--nr-duration-fast: 150ms; --nr-duration-standard: 200ms;
--nr-duration-deliberate: 250ms; --nr-duration-overlay: 320ms;
--nr-ease-standard: cubic-bezier(0.2, 0, 0, 1);
--nr-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

Add dark shadow overrides, a no-backdrop-filter opacity fallback, reduced-motion duration/lift overrides, and two low-opacity shell radial gradients on `body`. Do not change existing tested palette values.

- [ ] **Step 5: Map stable additions into Tailwind**

Add `--color-info`, `--color-info-foreground`, and `--shadow-nr-*` mappings under `@theme inline`. Do not redefine shadcn's existing radius scale; use `rounded-(--nr-radius-card)` utilities.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run tests/design-system-contract.test.ts
pnpm typecheck
git add app/globals.css tests/design-system-contract.test.ts
git commit -m "feat: add NabaPresence design foundations"
```

Expected: tests and typecheck pass; only the two named files are committed.

---

### Task 2: Shared Primitive Appearance

**Files:**
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/badge.tsx`
- Modify: `components/ui/item.tsx`
- Modify: `tests/design-system-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: generic controls with replacement density, radius, fields, cards, statuses, and interactions.

- [ ] **Step 1: Add a failing primitive-ownership assertion**

```ts
const primitiveSource = ["button", "card", "input", "textarea", "badge", "item"]
  .map((name) => readFileSync(new URL(`../components/ui/${name}.tsx`, import.meta.url), "utf8"))
  .join("\n")

it("uses purpose-specific tokens in primitives", () => {
  expect(primitiveSource).toContain("--nr-radius-control")
  expect(primitiveSource).toContain("--nr-radius-card")
  expect(primitiveSource).toContain("--nr-radius-field")
  expect(primitiveSource).toContain("--nr-duration-fast")
})
```

Run the contract and expect FAIL.

- [ ] **Step 2: Restyle Button and Badge without API changes**

Use `rounded-(--nr-radius-control)`, 13px semibold type, and `duration-(--nr-duration-fast)` in Button. Keep every variant, size, focus, invalid, disabled, icon, and contrast-safe hover contract. Add `shadow-(--nr-shadow-primary)` only to the default variant. Use `rounded-(--nr-radius-pill)` in Badge and retain all existing variants.

- [ ] **Step 3: Restyle generic Card as opaque**

Use this base shape:

```ts
"group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-(--nr-radius-card) border border-[var(--nr-surface-glass-border)] bg-card py-(--card-spacing) text-[13.5px] text-card-foreground shadow-(--nr-shadow-card) [--card-spacing:var(--nr-card-pad)]"
```

Keep Card opaque; translucency belongs to KPI/business compositions. Set CardTitle to `text-sm font-semibold` and update nested header/footer radii.

- [ ] **Step 4: Restyle fields and Item**

Input and Textarea use `rounded-(--nr-radius-field) border-border/80 bg-card text-[13.5px]` while retaining focus and invalid rings. Item uses `rounded-(--nr-radius-field)` and the fast duration without a default shadow.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/design-system-contract.test.ts
pnpm typecheck
pnpm lint components/ui/button.tsx components/ui/card.tsx components/ui/input.tsx components/ui/textarea.tsx components/ui/badge.tsx components/ui/item.tsx
git add tests/design-system-contract.test.ts components/ui/button.tsx components/ui/card.tsx components/ui/input.tsx components/ui/textarea.tsx components/ui/badge.tsx components/ui/item.tsx
git commit -m "feat: restyle shared UI primitives"
```

Expected: all checks pass.

---

### Task 3: Floating Application Shell

**Files:**
- Modify: `components/ui/sidebar.tsx`
- Modify: `components/naba-presence/app-shell.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: Base UI Sheet behavior, Task 1 shell tokens, Task 2 controls.
- Produces: floating desktop shell and unchanged accessible mobile navigation.

- [ ] **Step 1: Add a failing shell test**

Inside each viewport suite:

```ts
test("application shell", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible()
  if (viewport.name === "desktop") {
    await expect(page.locator('[data-variant="floating"]')).toBeVisible()
  } else {
    await page.getByRole("button", { name: "Toggle navigation" }).click()
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible()
  }
  await expectAccessible(page, `${viewport.name} application shell`)
})
```

Run the focused test and expect desktop FAIL.

- [ ] **Step 2: Adapt only Sidebar's floating variant**

Keep all state, cookie, shortcut, and mobile Sheet code. For the floating desktop variant use `p-(--nr-sidebar-margin)`, `rounded-(--nr-radius-shell)`, glass border/surface, `backdrop-blur-xl`, and `shadow-(--nr-shadow-float)`. Set the provider's desktop width to `var(--nr-sidebar-width)` while retaining mobile and icon widths.

- [ ] **Step 3: Recompose AppShell**

Use:

```tsx
<Sidebar variant="floating" collapsible="icon">
```

Give navigation `aria-label="Primary"`. Preserve exactly Overview, Reviews, Menu assistant, Analytics, Connections, and Settings. Put organisation context below the brand in SidebarHeader, account identity in SidebarFooter, and live status/theme controls in a transparent reduced content header. Do not add unimplemented location-switching behavior.

- [ ] **Step 4: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/ui/sidebar.tsx components/naba-presence/app-shell.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "application shell|connections|settings"
git add components/ui/sidebar.tsx components/naba-presence/app-shell.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace the application shell"
```

Expected: desktop and mobile tests pass; mobile navigation still closes after selection.

---

### Task 4: Shared Product Compositions

**Files:**
- Modify: `components/naba-presence/shared.tsx`
- Modify: `tests/design-system-contract.test.ts`

**Interfaces:**
- Produces `PageFrame`, `PageHeader`, `BusinessContext`, and updated `MetricCard` while retaining all existing shared exports.

- [ ] **Step 1: Add a failing export contract**

```ts
const shared = readFileSync(new URL("../components/naba-presence/shared.tsx", import.meta.url), "utf8")
it("owns shared product compositions", () => {
  expect(shared).toContain("export function PageFrame")
  expect(shared).toContain("export function PageHeader")
  expect(shared).toContain("export function BusinessContext")
})
```

Run the contract and expect FAIL.

- [ ] **Step 2: Implement PageFrame and PageHeader**

```tsx
export function PageFrame({ width = "standard", className, children }: {
  width?: "standard" | "wide" | "workspace"
  className?: string
  children: React.ReactNode
}) {
  return <main className={cn(
    "mx-auto flex w-full flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)",
    width === "standard" && "max-w-(--nr-page-max-width)",
    width === "wide" && "max-w-7xl",
    width === "workspace" && "max-w-none", className
  )}>{children}</main>
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: React.ReactNode; title: string; description: React.ReactNode; actions?: React.ReactNode
}) {
  return <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div className="flex min-w-0 flex-col gap-1">{eyebrow}<h1 className="font-heading text-[22px] font-semibold tracking-[-0.01em]">{title}</h1><p className="max-w-2xl text-[13px] text-muted-foreground">{description}</p></div>
    {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
  </header>
}
```

- [ ] **Step 3: Implement BusinessContext and update MetricCard**

BusinessContext accepts `organisationName`, optional `detail`, and optional labelled `status`. Compose it from Card with `bg-[var(--nr-surface-card-translucent)] backdrop-blur-xl`. Apply the same KPI-only surface to MetricCard while keeping its existing API.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/design-system-contract.test.ts
pnpm typecheck
pnpm lint components/naba-presence/shared.tsx
git add components/naba-presence/shared.tsx tests/design-system-contract.test.ts
git commit -m "feat: add shared NabaPresence compositions"
```

---

### Task 5: Overview Replacement

**Files:**
- Modify: `components/naba-presence/overview-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: Task 4 compositions and current overview data.
- Produces: replacement Overview with unchanged loading, errors, metrics, chart, health, and navigation.

- [ ] **Step 1: Add overview axe coverage**

```ts
test("overview", async ({ page }) => {
  await page.goto("/")
  await openNavigationSurface(page, "Overview", viewport.name === "mobile")
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
  await expectAccessible(page, `${viewport.name} overview`)
})
```

Run as a baseline and expect PASS.

- [ ] **Step 2: Replace presentation only**

Use `PageFrame width="wide"`, PageHeader, and BusinessContext. Keep the computed greeting and current data. Use shared card/section gaps, translucent MetricCards, and opaque chart/Operations health Cards. Remove view-local radii and shadows now owned by primitives. Do not add unsupported GBP metrics or completeness data.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/overview-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "overview"
git add components/naba-presence/overview-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace the overview design"
```

---

### Task 6: Reviews Queue and Filters

**Files:**
- Modify: `components/naba-presence/reviews-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: existing filters, queue tabs, pagination, selection, and mobile state.
- Produces: replacement queue chrome without workflow changes.

- [ ] **Step 1: Strengthen existing review assertions**

Assert the Reviews heading, Review list region, Filters button, selected-review region, and current mobile queue/detail transition. Run the focused test and expect PASS.

- [ ] **Step 2: Replace top chrome and filter hierarchy**

Keep the fixed-height workspace, queue Tabs, search, location, rating, sort, advanced filter Sheet, removable active filters, and debounce behavior. Use transparent page chrome with shared padding and gaps. Do not move controls between inline and Sheet locations.

- [ ] **Step 3: Replace queue rows**

Keep Item semantics and `aria-current`. Interactive rows use card radius, glass-border, lightly translucent surface, card shadow, and a one-pixel hover lift. Selected rows use a primary-tinted border and more opaque background. Preserve reviewer, timestamp, snippet, stars, and status labels.

- [ ] **Step 4: Preserve responsive behavior**

Keep one visible mobile pane, back action, ScrollArea, cursor pagination, Empty state, and desktop columns. Add local queue padding if shadows need room; do not disable overflow globally.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/reviews-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "inbox, review detail"
git add components/naba-presence/reviews-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace review queue design"
```

---

### Task 7: Review Conversation and Publication Lifecycle

**Files:**
- Modify: `components/naba-presence/reviews-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: selected review, media, draft, tone, verification, activity, and all existing handlers.
- Produces: opaque conversation, attached composer, verification, and activity lifecycle.

- [ ] **Step 1: Add reply lifecycle assertions**

Assert an explicitly labelled reply textbox, public-reply consequence text, Verification heading, and Activity heading. Run the current test first; if the accessible editor name differs, use its explicit existing Label rather than an unlabeled selector.

- [ ] **Step 2: Create the conversation hierarchy**

Keep header, metadata, menu, media, policy alerts, and handlers. Render customer prose in an opaque muted asymmetric message surface. Render an existing published business reply right-aligned in a contrast-safe primary-tonal surface. Keep metadata outside bubbles.

- [ ] **Step 3: Attach composer and lifecycle**

Keep tone Label/Select, textarea Label/count, policy hints/errors, Regenerate, Save draft, Publish/Update, pending states, and toasts in one opaque panel. Place the public consequence adjacent to the singular primary action. Keep Verification and Activity in one connected side rail on wide screens and below the composer on smaller screens.

- [ ] **Step 4: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/reviews-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "inbox, review detail"
pnpm test
git add components/naba-presence/reviews-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace review reply workspace design"
```

Expected: UI, domain, reply-policy, and workflow tests pass.

---

### Task 8: Menu Assistant Replacement

**Files:**
- Modify: `components/naba-presence/menu-assistant-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: current uncommitted location, upload, parsing, public menu, and assistant behavior.
- Produces: replacement menu workspace without overwriting product work.

- [ ] **Step 1: Add Menu assistant coverage**

```ts
test("menu assistant", async ({ page }) => {
  await page.goto("/")
  await openNavigationSurface(page, "Menu assistant", viewport.name === "mobile")
  await expect(page.getByRole("heading", { name: "Menu assistant" })).toBeVisible()
  await expectAccessible(page, `${viewport.name} menu assistant`)
})
```

Run as a baseline and expect PASS.

- [ ] **Step 2: Replace presentation only**

Use PageFrame/PageHeader, preserve location and connect behavior, keep a 360px source column at large widths, and use opaque Cards for upload controls and menu reading. Apply shared spacing/radii, keep prices monospaced, and retain every loading, empty, upload, error, and public-menu state.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/menu-assistant-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "menu assistant"
git add components/naba-presence/menu-assistant-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace menu assistant design"
```

---

### Task 9: Analytics Replacement

**Files:**
- Modify: `components/naba-presence/analytics-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: current range/granularity, API, metrics, chart, table, and progress behavior.
- Produces: replacement analytics hierarchy.

- [ ] **Step 1: Add Analytics axe coverage**

Navigate to Analytics, assert the Analytics h1, and call `expectAccessible` in desktop and mobile suites. Run as baseline and expect PASS.

- [ ] **Step 2: Replace presentation only**

Use PageFrame/PageHeader; keep range/granularity in header actions. Use translucent shared MetricCards and opaque chart/table Cards. Preserve API calls, loading/errors, Progress labels, horizontal table scrolling, and monospaced numeric columns. Do not add hover-only chart information.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/analytics-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "analytics"
git add components/naba-presence/analytics-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace analytics design"
```

---

### Task 10: Connections Replacement

**Files:**
- Modify: `components/naba-presence/connections-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: existing connect/account/location/backfill/disconnect state machine.
- Produces: guided replacement flow with opaque account and technical surfaces.

- [ ] **Step 1: Preserve the existing semantic baseline**

Keep the Google Business Profile heading and axe assertions. Run the Connections test first and expect PASS.

- [ ] **Step 2: Replace presentation only**

Use PageFrame/PageHeader and preserve the current heading. Use opaque major panels for account choice, location import, backfill, and management; one raised opaque status rail on large screens; shared Items for rows. Preserve Checkbox, Progress, AlertDialog, retry, toast, and navigation behavior. Keep identifiers monospaced.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/connections-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "connections"
git add components/naba-presence/connections-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace connections design"
```

---

### Task 11: Settings Replacement

**Files:**
- Modify: `components/naba-presence/settings-view.tsx`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: reply policy, team, locale, retention, compliance, confirmation, and toast behavior.
- Produces: replacement settings hierarchy with opaque forms.

- [ ] **Step 1: Preserve Settings semantics**

Keep the Reply policy assertion, add Team access, and run the Settings test as a passing baseline.

- [ ] **Step 2: Replace presentation only**

Use PageFrame/PageHeader; keep one opaque Card per responsibility; use shared section gaps; preserve Field, Label, Select, Switch, Item, Badge, and AlertDialog semantics. Remove decorative local radius/shadow overrides. Keep enforced states explicit through text and retain all save, member, privacy, export, loading, and error paths.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck
pnpm lint components/naba-presence/settings-view.tsx tests/e2e/accessibility.spec.ts
pnpm playwright test tests/e2e/accessibility.spec.ts --grep "settings"
git add components/naba-presence/settings-view.tsx tests/e2e/accessibility.spec.ts
git commit -m "feat: replace settings design"
```

---

### Task 12: Proof Sheet, Documentation, and Full Verification

**Files:**
- Modify: `app/design-system/page.tsx`
- Modify: `docs/specs/2026-07-28-design-system.md`
- Modify: `README.md`
- Modify: `tests/design-system-contract.test.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: all completed replacement work.
- Produces: live proof, current docs, and release-quality verification evidence.

- [ ] **Step 1: Add a failing proof-page contract**

```ts
const proof = readFileSync(new URL("../app/design-system/page.tsx", import.meta.url), "utf8")
it("documents production foundations", () => {
  for (const section of ["Foundations", "Typography", "Spacing and radius", "Elevation and glass", "Controls", "Status and feedback", "Product compositions"]) {
    expect(proof).toContain(section)
  }
})
```

Run the contract and expect FAIL.

- [ ] **Step 2: Replace the proof sheet**

Build the seven exact sections above from shipping components. Show semantic colors, Geist roles, Mono numerals, spacing/radii, card/panel/glass surfaces, controls, alerts/skeleton/progress/empty, and representative BusinessContext, MetricCard, Stars, StatusBadge, and review/reply compositions. Preserve the existing theme toggle behavior and contrast evidence.

- [ ] **Step 3: Update documentation ownership**

Add a note to `docs/specs/2026-07-28-design-system.md` that its palette rationale remains authoritative while the full system lives in `docs/superpowers/specs/2026-07-29-full-design-system-replacement-design.md`. Update README links to the specification, plan, and `/design-system` proof surface.

- [ ] **Step 4: Add proof-page accessibility coverage**

Visit `/design-system` in desktop and mobile suites, assert the h1 and seven section headings, and run `expectAccessible`.

- [ ] **Step 5: Run all automated checks**

```bash
pnpm vitest run tests/design-system-contract.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:a11y
```

Expected: every command exits 0. Report any pre-existing unrelated failure exactly; do not change unrelated code to manufacture green output.

- [ ] **Step 6: Run browser verification**

Start `pnpm dev` and inspect all six views plus `/design-system` at 1440×1000, 1024×768, and 390×844 in light and dark. Check Reviews and Settings at 200% zoom; Overview and Reviews with reduced motion; and a no-backdrop-filter fallback. Verify no horizontal overflow, clipped focus, nested glass, translucent forms/tables/overlays, broken mobile navigation, inaccessible queue/detail transitions, or console errors.

- [ ] **Step 7: Run React quality review**

Load and follow `react-best-practices` because multiple TSX files changed. Fix only regressions introduced by this replacement.

- [ ] **Step 8: Commit proof and docs**

```bash
git add app/design-system/page.tsx docs/specs/2026-07-28-design-system.md README.md tests/design-system-contract.test.ts tests/e2e/accessibility.spec.ts
git commit -m "docs: publish the NabaPresence design system"
git status --short
git log --oneline -12
```

Expected: replacement commits are reviewable stages and unrelated pre-existing changes remain untouched.

## Completion Definition

The replacement is complete only when every shipping view uses the new foundations, no prototype runtime has entered production, shadcn/Base UI remain the generic foundation, all automated checks pass, and browser review confirms the responsive, accessibility, motion, and glass hierarchy.
