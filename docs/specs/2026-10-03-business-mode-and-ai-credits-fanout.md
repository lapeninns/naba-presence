# Business mode and AI credits — fan-out implementation plan

> Historical record, archived during consolidation on 2026-10-09. The credits
> and business-mode work is now on `main` through PR #56 (merge `efceaf46`).
> Status statements, branch instructions and QA receipts below describe the
> original 2026-10-03 work; they are not current project rules or fresh QA evidence.

Written 2026-10-03. Companion to `2026-10-03-business-mode-and-ai-credits.md`
(the "spec"). This plan explains how the six pull requests in the spec get
built by a workflow of parallel agents, and what each agent must deliver.
Status: **proposed**. Nothing has run yet.

## Goal

> Ship metered AI reply credits and a single-business workspace mode to
> NabaPresence as six reviewed, green, stacked branches ready for PRs. The
> project instructions must hold throughout:
>
> - no migration is applied to staging or production;
> - nothing lands on `main`;
> - the human approval boundary for publishing is unchanged;
> - a business-mode owner never sees the words "client" or "agency".

**Done means:**

1. Six local branches exist, stacked as below, each with Conventional Commits.
2. On every branch, `pnpm typecheck`, `pnpm lint` and the unit tests pass,
   and real output is captured in the run report.
3. On the two tip branches, the integration and E2E suites pass when run
   serially against the local stack.
4. Two adversarial reviewers have read each branch, and every confirmed
   finding is fixed or explicitly waived.
5. A final report lists, per branch, what changed, the check output, review
   findings and their outcomes, and anything skipped.

Pushing, opening PRs and applying migrations stay manual and happen after you
read the report.

## Shape: two lanes, three stacked stages each

The credits work (A) and the business-mode work (B) touch different code,
except for one shared file each, so they run as two parallel lanes. Within a
lane each PR builds on the previous branch, so a lane runs in order.

```
main ─┬─ A1 feat/ai-usage-ledger ── A2 feat/ai-credit-reservation ── A3 feat/ai-credits-ui
      └─ B1 feat/workspace-mode-schema ── B2 feat/business-mode-shell ── B3 feat/business-setup-flow
```

| Stage | Branch                       | Builds on | Spec sections              | Goal for the agent                                                                                    |
| ----- | ---------------------------- | --------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| A1    | `feat/ai-usage-ledger`       | `main`    | A1, part of A2             | Every OpenAI call records model and tokens in `ai_usage`; no limits                                   |
| A2    | `feat/ai-credit-reservation` | A1        | A2, A3                     | Draft generation reserves, settles or releases a credit; 402 when exhausted; reaper; concurrency test |
| A3    | `feat/ai-credits-ui`         | A2        | A4                         | Composer credit count and exhausted state, Settings usage card, 80%/100% notifications                |
| B1    | `feat/workspace-mode-schema` | `main`    | B1, B2, session part of B3 | `workspace_mode`, home client, backfill, invariant kept on create and link; no UI change              |
| B2    | `feat/business-mode-shell`   | B1        | B3, B4 except the wizard   | Nav, palette, switcher, redirects, wording, Team, Reports and Listings per mode                       |
| B3    | `feat/business-setup-flow`   | B2        | B4 wizard row, B5          | Business setup steps; the "no client/agency words" E2E scan                                           |

### Migration numbering

The two lanes must not collide on numbers. A takes `0059_ai_credits.sql`;
B takes `0060_workspace_mode.sql`. Each lane's prompt names its number.

### Shared files

- `lib/contracts/session.ts` is touched only by B1.
- `lib/server/env.ts` is touched only by A2.
- Settings: A3 adds a Usage card and B2 renames the agency form. They touch
  different components, but `app/(dashboard)/settings/page.tsx` may conflict.
  The final integration stage merges both tips and resolves that file.

## Per-stage pipeline

Each stage runs the same four steps.

1. **Implement** (worktree isolation, so the two lanes never share a working
   tree).
   - Check out the parent branch and create the stage branch.
   - Read the spec sections named for the stage.
   - Implement, write tests, and run `pnpm typecheck`, `pnpm lint` and the
     unit tests.
   - Commit.
   - Return the branch, commits, changed files and the check output.
2. **Review**: two read-only reviewers in parallel, each with a different
   lens, prompted to _find faults_. Each returns findings with file, line and
   a failure scenario.
   - **Lane A lenses:** concurrency and money correctness (double spend, lost
     release, settle-after-failure), and API contract/UX (402 shape, manual
     reply still possible).
   - **Lane B lenses:** tenant safety (RLS, `permissions.ts`, the home-client
     invariant, backfill on many-client organisations), and copy and route
     coverage (every place "client" or "agency" can still render, redirects,
     deep links).
3. **Fix**, only when a reviewer reported something. One agent in the same
   branch fixes or waives each finding with a reason, re-runs the checks and
   commits.
4. **Gate.** If checks are still red after one fix round, the lane stops at
   that stage and the report says so. Later stages in that lane do not build
   on a red branch.

## Final stage: integrate and verify (serial)

This runs after both lanes finish, as one agent, deliberately not in parallel.
The integration and E2E suites share the local database and are flaky under
contention, and `pnpm test:e2e` wipes the dev tenant.

1. In a scratch worktree, merge `feat/ai-credits-ui` and
   `feat/business-setup-flow` onto `main`. Resolve conflicts and record them.
   This is a check only; the stacked branches stay as they are.
2. Apply both migrations to the **local** Supabase only, then run the
   integration tests once, then the E2E suite on the port 3100 harness.
3. Restore the dev tenant afterwards: re-run migrations and recreate the
   runtime role.
4. Write the run report.

## Agent count and cost

| Step      | Agents           |
| --------- | ---------------- |
| Implement | 6                |
| Review    | 12 (2 per stage) |
| Fix       | up to 6          |
| Integrate | 1                |
| **Total** | **19 to 25**     |

Lanes run two at a time, so wall-clock is roughly three stages deep, not six.
This is above the session's default workflow size guideline (under 10
agents). Running it as written means opting in. The smaller option is one
lane per run (A first, then B), at 10 to 13 agents each.

## Before running: decisions to lock

These are baked into the agents' prompts, so settle them first.

1. **`AI_MONTHLY_DRAFT_CREDITS` default.** A placeholder of `100` is fine;
   the real number comes after A1 measures cost.
2. **Organisations with more than one client** stay in agency mode in the B1
   backfill. This is the spec's safe default.
3. **Regenerate costs a credit.**
4. **Base commit.** `main` has uncommitted edits (`.gitignore`, `AGENTS.md`,
   `app/globals.css`, `tests/design-system-contract.test.ts`). Worktrees start
   from the last commit, so those edits are not included. Commit them on
   their own branch first, or confirm they are unrelated.

## Workflow script (draft)

```js
export const meta = {
  name: "business-mode-ai-credits",
  description:
    "Build AI credits and business mode as six stacked, reviewed branches",
  phases: [
    { title: "Lane A", detail: "ai_usage → credit reservation → credits UI" },
    { title: "Lane B", detail: "workspace mode schema → shell → setup" },
    {
      title: "Integrate",
      detail: "merge tips, serial integration + E2E, report",
    },
  ],
}

const SPEC = "docs/specs/2026-10-03-business-mode-and-ai-credits.md"
const RULES = `Do NOT push, open PRs, apply migrations to staging/production, or touch main.
Local Supabase only. Do not run integration or E2E suites here; unit tests only.`

const LANES = [
  {
    key: "A",
    migration: "0059_ai_credits.sql",
    lenses: [
      "concurrency and money correctness",
      "API contract and composer UX",
    ],
    stages: [
      {
        branch: "feat/ai-usage-ledger",
        base: "main",
        goal: "Spec A1 plus usage capture: openAiStructured returns usage; every call inserts a settled ai_usage row. No limits.",
      },
      {
        branch: "feat/ai-credit-reservation",
        base: "feat/ai-usage-ledger",
        goal: "Spec A2+A3: reserve/settle/release, 402 ai_credits_exhausted, AI_MONTHLY_DRAFT_CREDITS default 100, token backstop, reaper, parallel-reservation test.",
      },
      {
        branch: "feat/ai-credits-ui",
        base: "feat/ai-credit-reservation",
        goal: "Spec A4: composer credits + exhausted state (manual reply stays open), Settings usage card, 80%/100% notifications.",
      },
    ],
  },
  {
    key: "B",
    migration: "0060_workspace_mode.sql",
    lenses: [
      "tenant safety and home-client invariant",
      "copy and route coverage for client/agency wording",
    ],
    stages: [
      {
        branch: "feat/workspace-mode-schema",
        base: "main",
        goal: "Spec B1+B2 and session.workspaceMode: home client, backfill (>1 client stays agency), invariant on provisioning and linking, POST /api/clients 409.",
      },
      {
        branch: "feat/business-mode-shell",
        base: "feat/workspace-mode-schema",
        goal: "Spec B3+B4 except the wizard: mode hook and term map, nav, palette, switcher, redirects, Settings, Team, Reports, Listings, Inbox filters.",
      },
      {
        branch: "feat/business-setup-flow",
        base: "feat/business-mode-shell",
        goal: "Spec B4 wizard row and B5 tests, including the E2E no-client/agency-words scan (written, not run).",
      },
    ],
  },
]

const BUILD = {
  type: "object",
  required: ["branch", "green", "checks", "summary"],
  properties: {
    branch: { type: "string" },
    green: { type: "boolean" },
    summary: { type: "string" },
    checks: {
      type: "string",
      description: "real output tail of typecheck, lint, unit tests",
    },
    files: { type: "array", items: { type: "string" } },
  },
}
const FINDINGS = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "summary", "scenario"],
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          summary: { type: "string" },
          scenario: { type: "string" },
        },
      },
    },
  },
}

async function runStage(lane, stage, i) {
  const ph = `Lane ${lane.key}`
  const built = await agent(
    `Goal: ${stage.goal}\nSpec: ${SPEC}. Migration file for this lane: ${lane.migration}.\n` +
      `git checkout ${stage.base} && git checkout -b ${stage.branch}. Implement with tests, run pnpm typecheck, pnpm lint, unit tests, ` +
      `commit with Conventional Commits.\n${RULES}`,
    {
      label: `${lane.key}${i + 1} build`,
      phase: ph,
      isolation: "worktree",
      schema: BUILD,
    }
  )
  if (!built) return null
  const reviews = await parallel(
    lane.lenses.map(
      (lens) => () =>
        agent(
          `Review branch ${stage.branch} against ${stage.base} (git diff ${stage.base}...${stage.branch}) through the lens: ${lens}. ` +
            `Goal it claims to meet: ${stage.goal}. Report only concrete faults with a failure scenario. Read-only.`,
          {
            label: `${lane.key}${i + 1} review: ${lens}`,
            phase: ph,
            schema: FINDINGS,
          }
        )
    )
  )
  const findings = reviews.filter(Boolean).flatMap((r) => r.findings)
  if (!findings.length && built.green) return { ...built, findings: [] }
  const fixed = await agent(
    `On branch ${stage.branch}: fix each finding or waive it with a reason, re-run typecheck/lint/unit tests, commit.\n` +
      `Findings: ${JSON.stringify(findings)}\nLast check output: ${built.checks}\n${RULES}`,
    {
      label: `${lane.key}${i + 1} fix`,
      phase: ph,
      isolation: "worktree",
      schema: BUILD,
    }
  )
  return { ...(fixed || built), findings }
}

async function runLane(lane) {
  const out = []
  for (let i = 0; i < lane.stages.length; i++) {
    const r = await runStage(lane, lane.stages[i], i)
    out.push(r)
    if (!r || !r.green) {
      log(`Lane ${lane.key} stopped at ${lane.stages[i].branch}`)
      break
    }
  }
  return out
}

const lanes = await parallel(LANES.map((l) => () => runLane(l)))

phase("Integrate")
const report = await agent(
  `Lane results: ${JSON.stringify(lanes)}\nIn a scratch worktree, merge the green tip branches of each lane onto main and record conflicts. ` +
    `Apply migrations to LOCAL Supabase only, run integration tests once, then E2E on the port 3100 harness, serially. ` +
    `Afterwards re-migrate and recreate the runtime role so the dev tenant works. Return a markdown run report: per branch ` +
    `changes, real check output, findings and outcomes, skipped checks. Do not push.`,
  { label: "integrate + verify", phase: "Integrate" }
)
return { lanes, report }
```

## After the run

1. Read the report and spot-check the diffs.
2. Commit the run report as `docs/sprints/2026-10-business-mode-run.md`.
3. Push and open the PRs one at a time with the `lapeninns` GitHub account.
   Open them as stacked PRs, or rebase each onto `main` as the one before it
   merges.
4. Apply `0059` and `0060` to staging, then production, by hand. Production
   needs the many-client check from spec open question 2 first.
5. Deploy manually as usual, once the user asks.
