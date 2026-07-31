# Task 15 Code Quality Review

## Review decision

- `codeQualityStatus`: `CLEAR`
- `recommendation`: `APPROVE`
- `blockers`: none

## Scope and review basis

Goal: add the shared, flag-aware capability placeholder; add the seven
location capability routes; and restore the real GBP performance flag on the
global Performance page without crossing the server/client environment
boundary.

Success criteria were read directly from Task 15 in:

- `/Users/amankumarshrestha/.codex/attachments/37a77970-88fd-411c-83c2-a785f7ef325b/pasted-text-1.txt`

The complete working-tree diff was inspected for:

- `app/(dashboard)/locations/[id]/hours/page.tsx`
- `app/(dashboard)/locations/[id]/photos/page.tsx`
- `app/(dashboard)/locations/[id]/posts/page.tsx`
- `app/(dashboard)/locations/[id]/menu/page.tsx`
- `app/(dashboard)/locations/[id]/qa/page.tsx`
- `app/(dashboard)/locations/[id]/booking/page.tsx`
- `app/(dashboard)/locations/[id]/performance/page.tsx`
- `app/(dashboard)/performance/page.tsx`
- `components/naba-presence/capability-placeholder.tsx`
- `components/naba-presence/performance-view.tsx`
- `tests/e2e/capability-tabs.spec.ts`

No notepad path was supplied. `omo ulw-loop status --json` could not run
because its installed runtime target is missing, so this report uses the
required fallback path.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Correctness and regression assessment

- All seven routes use the required metadata, capability label, feature-flag
  label, and description.
- Hours is deliberately hard-disabled and does not import the server
  environment module.
- Photos, Posts, Menu, Q&A, Booking, location Performance, and global
  Performance read their exact flag through `getServerEnv()` in server page
  modules.
- No client component imports `lib/server/env.ts`; only serializable booleans
  cross into client components.
- The shared title is exposed as an accessible level-two heading through
  `role="heading"` plus `aria-level={2}`, matching the existing `EmptyTitle`
  primitive, which otherwise renders a `div`.
- The enabled and disabled status copy, flag label, and global Google
  Performance description match the implementation plan.
- The E2E test covers all seven routes, semantic headings, and the default-off
  status. Its index-or-single-location branch is consistent with both supported
  `/locations` behaviors and does not mirror private implementation data.
- The production additions are small and direct. There is no needless parsing,
  normalization, data extraction, untyped escape hatch, or speculative
  abstraction.

## Independent verification

The reviewer ran and observed exit status 0 for:

- scoped ESLint over every Task 15 file
- `git diff --check` over every Task 15 file
- `pnpm typecheck`
- `pnpm test:e2e tests/e2e/capability-tabs.spec.ts` — 1 passed

The root task additionally reported the final full gates as 192 unit tests, a
successful production build, 46 E2E tests, and 30 dedicated accessibility
tests. That report was not used as a substitute for the independent scoped
checks above.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not present in
the available-skills catalog, and no matching `SKILL.md` was found in the
configured skill roots. Their required review criteria were therefore applied
directly:

- `remove-ai-slops`: no deletion-only or tautological test, constant-mirroring
  test, needless production transformation, or overfit prompt artifact was
  found.
- `programming`: no brittle prompt test, implementation-mirroring test,
  untyped escape hatch, needless abstraction, or unnecessary boundary
  validation/parsing was found.

The diff violates neither perspective.
