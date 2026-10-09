# NabaPresence frontend rebuild — session handoff

Written 2026-08-01. Read this top to bottom before touching anything; it is
written for someone with zero context on this work.

## 0. Standing authorisation from the product owner

> "This is an explicit user request to use subagents and workflows."

That is the owner's own wording and it is standing for this rebuild: you may
dispatch subagents freely and you may use multi-agent workflow orchestration
without asking again. The owner has also said, verbatim, *"I want all
milestones to be completed, don't stop until you complete everything"* — so
do not pause for check-ins between tasks or milestones. Surface progress at
milestone gates; interrupt only for a decision that is genuinely theirs
(one where proceeding on an assumption would be unsafe or would waste real
work). Everything a careful engineer can decide, decide, and record it in the
milestone ledger.

## 1. What this project is

NabaPresence is a Google Business Profile management SaaS: ingest Google
reviews, AI-draft replies, verify them, keep a human approval boundary,
publish to Google, and report on it. Next.js 16 App Router (webpack — never
Turbopack, it spawns runaway PostCSS workers here), React 19, TypeScript
strict, Tailwind v4, @base-ui/react primitives, TanStack Query v5, zod 4,
Vitest + Playwright + axe, PostgreSQL with forced row-level tenant isolation.

The **frontend is being rebuilt from scratch**. The backend, the database and
the visual identity are anchors and survive; every line of the frontend app
layer is replaced. Two documents govern the work and both are committed:

- **Spec:** `docs/archive/2026-07-frontend-rebuild/specs/2026-07-31-frontend-rebuild-design.md` —
  the approved blueprint. §10 was amended on 2026-08-01 to record the owner's
  decision to merge **each milestone** to `main` rather than swapping once at
  full parity. Full parity (Milestone 9) remains the release bar; intermediate
  `main` is not shippable.
- **Audit:** the 2026-07-31 comprehensive frontend audit that drove all of
  this. Its findings are referenced by id throughout the plans (J-5, J-14,
  A-2, etc.). The remediation obligations that survived Milestone 1 are in
  `docs/archive/2026-07-frontend-rebuild/plans/2026-07-31-frontend-rebuild-m1-foundation-ledger.md`.

## 2. Exactly where things stand

| Milestone | State |
|---|---|
| M1 Foundation | **Merged to `main`** at `85d8a05`. Worktree deleted, branch deleted. |
| M2 Auth | **In progress** on branch `frontend-rebuild-m2-auth`, worktree `.worktrees/m2-auth`. T1–T6 committed; T7, T8 remain. |
| M3–M9 | Not started. Plans not yet written. |

`main` currently serves a **foundation-only product**: the app shell, a
placeholder `/home`, `/design-system`, and the full backend. Sidebar links to
not-yet-rebuilt surfaces 404 by design. This is expected between milestones.

### M2 commits so far (branch `frontend-rebuild-m2-auth`)

```
e267e6c  T6 invitation acceptance (accepted/expired/session states)
662032e  cross-cutting fix: FieldDescription <p> -> <div> (hydration)
e139408  T5 forgot-password and reset-password with dead-token recovery
89716cf  T2 fix round: 429 stub coverage + recorded enumeration risk
2ac2eeb  T4 sign-in and create-account
550ec0b  T3 auth api client, error mapping, 204 handling, next-path guard
505b37d  T2 sanctioned backend additions
9e8bf7d  T1 fix round: caps-lock + 128-char cap
1f1ba5f  T1 shared auth ui kit
abf58b3  docs: spec amendment + M2 plan
```

Suite state at `e267e6c`: **331 passed / 167 skipped** (unit + components),
typecheck/lint/build clean, integration **165 passed / 2 skipped, exit 0**
(the 2 skips are M4-gated inbox tests). T6's task review was dispatched and
had not returned when this handoff was written — check for its findings before
declaring T6 done.

## 3. The immediate next actions, in order

1. **Finish T6's review loop.** If it returned findings, run a fix round
   (resume the implementer with the findings verbatim), then a scoped
   re-review of the fix diff only.
2. **T7 — sign-out and return path.** Brief at
   `.superpowers/sdd/2026-08-01-frontend-rebuild-m2-auth/task-7-brief.md`.
   **Fold in one extra item** recorded in the ledger: a truncated or corrupted
   `token_hash` fails the server's zod `min(20)` as `invalid_request` rather
   than `invalid_email_link`, so `reset-password-form.tsx` keeps the form with
   "Check the highlighted fields." and *no* highlighted field and *no*
   recovery CTA. That is a dead end in exactly the behaviour this milestone
   exists to fix. Treat a token that fails the client-side length check as
   missing, so the user gets the "request another link" route out.
3. **T8 — auth e2e and the milestone gate.** Brief at `.../task-8-brief.md`.
   **Add a guard the plan does not contain:** assert **zero console errors**
   on every auth page, in both modes and both themes. See §5 for why this is
   non-negotiable.
4. **Whole-branch review** on the most capable model, using
   `superpowers:requesting-code-review`'s `code-reviewer.md`. Point it at the
   ledger's deferred-minor lines so it can triage them.
5. **One fix wave** for its findings, one scoped re-review, adjudicate
   residuals, then **merge to `main`** via
   `superpowers:finishing-a-development-branch`.
6. **Then M3 → M9.** For each: write the plan with
   `superpowers:writing-plans` (use the M1 and M2 plans as templates — they
   work), then execute with `superpowers:subagent-driven-development`, gate,
   review, merge.

Remaining milestones, in spec order: **M3** Shell + Home · **M4** Inbox (the
core review journey — biggest and highest value: dirty-draft protection, URL
state, capability-aware controls, verification reasons) · **M5** Locations
wave 1 · **M6** Connections + Settings (decomposing a 1,459-line god
component) · **M7** Reporting · **M8** the three JSON consoles rebuilt as real
editors · **M9** Hardening (full e2e adaptation, a11y sweep, every quarantined
test re-enabled, legacy redirects restored, audit checklist swept).

## 4. How the work is executed

Follow `superpowers:subagent-driven-development` exactly. Per task: extract a
brief with the skill's `task-brief` script → dispatch one implementer → run
`review-package` → dispatch a task reviewer → fix rounds until clean (cap 5,
then adjudicate) → append a completion line to the ledger. The ledger is at
`.superpowers/sdd/<plan-basename>/progress.md` inside the worktree and is
**your recovery map after a context compaction** — trust it and `git log` over
memory. Copy it into `docs/archive/2026-07-frontend-rebuild/plans/` before
deleting the workspace, as M1 did, so carry-forwards survive.

Conventions that are enforced by review:
- Commit messages are conventional and end with the trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Gate before every commit: `pnpm typecheck && pnpm lint && pnpm test`, plus
  `pnpm build` for anything touching pages.
- Never dispatch two implementers at once in the same worktree (git index
  contention). A reviewer is read-only, so **reviewer + next implementer in
  parallel is safe and is the main speed-up available**.
- Model selection: cheapest tier when the brief carries complete code;
  standard for integration/judgment; most capable for whole-branch reviews.

## 5. Hard-won lessons — do not relearn these

1. **jsdom cannot see hydration or HTML-nesting errors, and neither can
   `pnpm build`.** A green 324-test gate shipped invalid HTML (`<ul>` inside
   `<p>`) that threw a hydration error on every create-account view. It was
   found only because a reviewer started a real browser. Every milestone's
   e2e must assert a clean console, and reviewers of any task that composes
   shared primitives in a new way should do a live check.
2. **Run test suites in the FOREGROUND inside subagents.** Three implementers
   stalled indefinitely waiting on their own backgrounded runs, one burning
   ~215k tokens without committing. Instruct every implementer explicitly.
3. **The browser preview tool anchors to the main checkout, not the
   worktree** (it resolves `.claude/launch.json` from the repo root). Start
   `pnpm dev` yourself with an explicit `cd` into the worktree and point the
   browser at the raw localhost URL, or you will debug a phantom 404.
4. **The integration harness runs the pre-built standalone server.** Always
   `pnpm build` before an integration run, and rebuild after any source
   change, or you will test stale code and misdiagnose it.
5. **Integration tests are load-sensitive.** Running the suite concurrently
   with a build produced two failures that vanished on a quiet machine. Before
   blaming your change, re-run alone, and stash-and-rebuild to test the
   baseline.
6. **Local DB rules** (also in the owner's memory): `DATABASE_URL` must use
   the `naba_test_runtime` login so RLS applies; the harness refuses non-local
   databases; hosted Supabase/Vercel are stale.
7. **Reviewers sometimes misattribute git blame.** One concluded a fix was
   already present at the branch base; `git show <base>:<file>` proved it was
   not. Verify attribution claims cheaply before acting on them.

## 6. Open items carried forward

- **Recorded residual security risk (in code, `lib/server/password-auth.ts`):**
  429 rate-limit surfacing branches on HTTP status only. If the deployed
  GoTrue has a recipient-scoped email-send-abuse bucket that only accrues for
  real mailboxes, a narrow account-enumeration channel remains. Follow-up is
  to branch on `error.code` once the deployed taxonomy is confirmed. Do not
  guess at the taxonomy.
- **Deferred minors from M2** (full list in the M2 ledger): `focusField`
  missing on one server-error path in `forgot-password-form`; a duplicated
  "Back to sign in" link in the missing-token state; no focus-to-banner for
  banner-only errors.
- **Unattributed dev-only console error:** "Encountered a script tag while
  rendering React component" appears on `/sign-in` but not `/home`; no auth
  file contains a script tag. Likely a Fast-Refresh artifact. Revisit in M9.
- **M1 carry-forwards still open:** Nav `prefetch={false}` must be re-enabled
  per route as each milestone ships its page; the legacy redirects
  (`/reviews`, `/overview`, `/analytics`, `/connections`) need milestone
  owners or must land in M9; `formatDuration` lacks a negative guard (M7);
  toast swipe transitions untokenised and error pages lack landmarks (M9).
- **Quarantined tests:** two `it.skip`s in
  `tests/integration/routes/sign-in.test.ts` marked `// re-enable: rebuild M4`
  must be re-enabled when the inbox route lands.

## 7. Map of what matters

```
docs/archive/2026-07-frontend-rebuild/specs/2026-07-31-frontend-rebuild-design.md                the blueprint
docs/archive/2026-07-frontend-rebuild/plans/2026-07-31-frontend-rebuild-m1-foundation.md
docs/archive/2026-07-frontend-rebuild/plans/2026-07-31-frontend-rebuild-m1-foundation-ledger.md
docs/archive/2026-07-frontend-rebuild/plans/2026-08-01-frontend-rebuild-m2-auth.md               current plan
.worktrees/m2-auth/.superpowers/sdd/2026-08-01-.../progress.md                                   current ledger

lib/api/client.ts        typed fetch: ApiClientError, zod validation, 401 ->
                         stash drafts + /sign-in?next=, 204 handling
lib/api/auth.ts          auth calls
lib/api/auth-errors.ts   THE single source of user-facing auth copy
lib/api/next-path.ts     open-redirect guard for ?next=
lib/queries/             Query keys, client defaults, provider
lib/format/              the one date/number/duration formatter set
components/ui/           curated primitives (one chrome, one focus ring,
                         a11y enforced at the type level)
components/app-shell/    sidebar, header, skip link, live status region
components/auth/         this milestone's surfaces
app/(auth)/              sign-in, forgot-password, reset-password, invite
app/(dashboard)/         home (placeholder until M3)
```

Backend, database, scripts and the design tokens are anchors: do not modify
`app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**` or
`instrumentation.ts` except where a plan explicitly sanctions it, and record
any such edit in the ledger.
