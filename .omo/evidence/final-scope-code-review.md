# Queue Token Readiness Code Quality Review

## Decision

- `codeQualityStatus`: `CLEAR`
- `recommendation`: `APPROVE`
- `blockers`: none

## Scope and review basis

This is a read-only review of exact HEAD
`19061076e8e74bc34c3b5c9d6159601b4caf59b0`, focusing on:

- `components/naba-presence/review-app.tsx`
- `components/naba-presence/reviews/review-queue.tsx`
- `components/naba-presence/route-views.tsx`
- `tests/e2e/review-provider-races.spec.ts`

The current source, full commit diff, tests, and gate behavior were inspected
directly. No notepad path was supplied. `omo ulw-loop status --json` remains
unavailable because its installed runtime target is missing, so this report
uses the required fallback evidence path.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Correctness assessment

The prior stale-owner blocker is resolved:

- Each queue exposes a stable pathname token and passes that origin through
  count refresh, readiness reporting, failure reporting, and manual
  revalidation.
- Review completion reports reject null, non-current, and unvalidated tokens
  before changing success ownership, timestamps, or API status.
- Count requests validate their token before starting and validate token plus
  request ID again before applying counts or failure state.
- Retry invalidates the count request generation as well as queue validation
  and scoped review success.
- Queue-bootstrap retains its token, request-ID, and route-epoch guards.

Consequently, a delayed queue A success or failure cannot be recorded as queue
B readiness after navigation. Direct entry, non-queue-to-queue,
queue-to-queue, leave/revisit, connection failure/retry, disconnected recovery,
data-first focus recovery, and stale route epochs remain coherent.

The changes are typed and localized to the queue/provider boundary. No
unrelated API, database, provider-write, or UI-primitive scope was introduced.

## Test quality assessment

The seven focused browser tests assert observable request gating and UI state
across controlled completion orders. The new test holds both old scoped
requests across a location-queue-to-Inbox navigation, verifies stale totals do
not appear, keeps the new queue Connecting after its count arrives, and only
permits Live after the new list also completes.

The suite is not deletion-only, tautological, constant-mirroring, or coupled to
private implementation values. No unnecessary production extraction,
normalization, parsing, untyped escape hatch, or needless abstraction was
introduced for the tests.

## Independent gate evidence

The reviewer ran the following against exact HEAD:

- scoped ESLint: pass
- `pnpm typecheck`: pass
- `git diff --check HEAD^ HEAD`: pass
- `pnpm test`: 192 passed
- `pnpm build`: pass
- `PLAYWRIGHT_PORT=3200 PLAYWRIGHT_GOOGLE_STUB_PORT=3201 pnpm test:e2e tests/e2e/review-provider-races.spec.ts`:
  7/7 passed

Port 3200 was used because another shared process already occupied the default
Playwright port 3100.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills are not present in the
available-skills catalog, and no matching `SKILL.md` was found in the
configured skill roots. Their documented criteria were applied directly.

- `remove-ai-slops`: no overfit/slop violations found.
- `programming`: no brittle prompt tests, implementation-mirroring tests,
  untyped escape hatches, needless abstractions, or unnecessary production
  validation/parsing found.

The diff violates neither skill perspective.
