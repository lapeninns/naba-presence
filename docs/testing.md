# Testing

How NabaPresence is tested: what each layer owns, where a new test goes, how
to run each layer, and the rules that keep the suites fast and deterministic.
The gate that runs all of it is in [docs/ci.md](ci.md); the 2026-10-21 audit
that shaped this is in
[docs/audits/2026-10-21-test-ci-modernization/](audits/2026-10-21-test-ci-modernization/AUDIT_REPORT.md).

## Layers

| Layer            | Where                                                                                                            | Runs with                                                                                                                                | Owns                                                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit             | `tests/*.test.ts`, `tests/server/`, `tests/harness/`, `tests/lib/`, `tests/perf/`, `tests/visual/` (`*.test.ts`) | Vitest project `unit`, Node, files in parallel                                                                                           | Pure logic in `lib/`, contracts and vocabularies, static scans of the route tree (authorisation, entitlements, MFA step-up, max duration, the public and cron handler set), mocked route handlers for validation order and injected failures, migration SQL that needs executing (PGlite), gate and release scripts |
| Component        | `tests/components/`                                                                                              | Vitest project `components`, jsdom, in parallel                                                                                          | What a user sees and does in one component or page: roles, labels, focus, form validation and the payload a form sends, pending and error states. The network is the only thing stubbed                                                                                                                             |
| Integration      | `tests/integration/`                                                                                             | Vitest project `integration`, one file at a time, through `pnpm test:integration`                                                        | The real boundary: the standalone server over HTTP against PostgreSQL 17 through the non-superuser runtime role. Row-level security and tenant isolation, concurrency, transactions, Google and Stripe adapters against in-repo stubs, scheduler leases, retention and deletion                                     |
| Browser (e2e)    | `tests/e2e/`                                                                                                     | Playwright, pinned Chromium, through `pnpm test:e2e` (`PLAYWRIGHT_SUITE=shared` or `isolated` runs one half; the gate runs both at once) | Critical journeys end to end, accessibility (axe) on every surface in both themes, touch journeys at 390 px (`touch-390` project). Each journey runs once at 1280 px, with one layout check per screen at 375 and 768 px                                                                                            |
| Outside the gate | `tests/agentic/` (`e2e.config.ts`), `tests/visual/` tools, `tests/perf/` lab, `pnpm audit:mobile`                | by hand                                                                                                                                  | Exploratory agent journeys (need a model login), screenshots and the performance lab (need a quiet machine). Their pure logic is unit-tested                                                                                                                                                                        |

Checks that are not test files but gate every change: `pnpm typecheck`,
`pnpm lint` (zero warnings), `pnpm format:check` (the files a change touches
must be Prettier-formatted), `pnpm check:design --ratchet`, the first-load JS
ceilings (`tests/perf/route-js.mjs`), migration policy and upgrade checks,
`pnpm audit --prod`, gitleaks, and actionlint plus zizmor over `.github/`.

## Where a new test goes

1. Pure function, constant or schema: **unit**. Inject the clock, the
   environment and collaborators; do not mock the unit under test.
2. A component's behaviour: **component**, with `renderWithProviders` and a
   stubbed `fetch`. Assert accessible output and the request a form sends,
   not class names, unless the class is the behaviour (a breakpoint that hides
   something).
3. Anything that depends on the database, row-level security, a transaction,
   a lease, the runtime role's grants or a real route over HTTP:
   **integration**. Create your own tenants (`tests/integration/helpers`), and
   never rely on another file's data.
4. A journey a person takes across pages, or anything only a browser shows
   (focus order across navigation, axe, touch, a real redirect):
   **browser**. Keep one width per journey unless the layout is what differs.
5. A fixed production bug: a regression test at the lowest layer that would
   have caught it, named for the behaviour.

Do not test the same behaviour at three layers. Security, tenant isolation,
billing and data-loss behaviour keep their real-boundary integration test
whatever else covers them.

## Running tests

```bash
pnpm test                    # unit + component, in parallel (VITEST_MAX_WORKERS caps the pool)
pnpm exec vitest run tests/foo.test.ts          # one file
pnpm test:integration        # starts its own throwaway PostgreSQL 17, migrates, runs, stops it
pnpm build && pnpm test:e2e  # the browser suite needs the standalone build of this commit
pnpm verify                  # typecheck, lint, format check, unit + component, design ratchet
pnpm verify:release          # everything, on a fresh worktree, writing the release receipt
```

`pnpm test:integration` and `pnpm test:e2e` never touch the developer's
Supabase database: they start a throwaway cluster (Homebrew
`postgresql@17`, or Docker with `NABA_PG_MODE=docker`), reuse one the gate
provides, or, with `NABA_TEST_DB=existing`, use the configured URLs, still
refusing port 54322 unless `NABA_ALLOW_DEV_DB=1`. Details in
[docs/ci.md](ci.md) §5. Pass vitest arguments after the script, for
example `pnpm test:integration tests/integration/routes/leases.test.ts`.

## Reliability rules

- **No fixed sleeps.** Wait for the state you need (a web-first assertion, a
  database row, a stub's `entered()`), or make the time configurable: the
  pause cache (`PAUSE_CACHE_TTL_MS`), Google timeouts and the scheduler's
  first delays have bounded, test-only knobs that only shorten them and are
  ignored in production.
- **Clocks are injected or faked.** Real-clock limits fail on a loaded
  machine. Restore fake timers and stubbed environment variables after each
  case (`vi.useRealTimers()`, `vi.unstubAllEnvs()`).
- **Force races; do not hope for them.** The Google stub's `hold()` latch
  holds one request inside its provider call while another runs.
- **Timeouts are sized from measurements.** Integration tests default to
  30 s per test and 60 s per hook; a test that needs more says so with a
  bound a few times its observed duration.
- **Isolation.** Unit and component files run in parallel, so a file may not
  depend on another's state, a fixed port or a shared temp path (use
  `listen(0)` and `mkdtemp`). Integration files run one at a time per
  database because they share the global fleet leases; the release gate runs
  four such databases at once.
- **Nothing is skipped in the gate.** An integration run that skips a test,
  or an integration or e2e run that reports no tests, fails the receipt. No
  `.only`: Playwright runs with `--forbid-only`. Retries are 0 locally, so a
  flaky test fails rather than hides.

## Mocking

Stub at the process boundary, not inside the code under test:

- Google APIs: `tests/integration/helpers/google-stub.ts` (integration) and
  the Playwright stub bridge (`tests/e2e/helpers/stub-bridge.ts`), selected
  with `GOOGLE_API_PROXY_BASE`.
- Stripe, email and OpenAI: unset or pointed at local stubs; billing actions
  fail closed without a Stripe key.
- In unit tests, `vi.mock` only collaborators (`lib/server/env`, `db`,
  `google`), never the module being tested. In component tests, mock only
  `fetch`, `next/navigation` and `next/link`.

## Fixtures

- Integration tenants come from `createTestTenant` and are destroyed in
  `afterAll`; `tests/integration/helpers/global-setup.ts` also resets pauses,
  fleet leases and test billing plans before and after a run, on throwaway
  clusters only.
- The browser suite seeds its journey tenants in the global setup
  (`tests/e2e/helpers/stub-bridge.ts`); the isolated backend specs start their
  own server, stub and tenant.
- PGlite is for executing migration SQL in unit tests. Schema invariants of
  the fully migrated database (row-level security forced on every tenant
  table, policies, grants) are asserted against real PostgreSQL in the
  integration suite.

## Coverage

There is no global coverage target. Gaps are tracked by behaviour: the
critical behaviours, the layers that protect each and the open gaps are in
the audit's coverage map (`AUDIT_REPORT.md` §4) and the release ledger
(`docs/release/ledger.md`).
