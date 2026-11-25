# CI and deployment

The authoritative merge check is `local-ci/release-gate` on the final, up-to-date
PR head. The GitHub Actions permissions API reported `enabled=false` and no repo
runners on 25 November 2026. The [infrastructure pilot](engineering/pilot.md)
records the installed setup, inventory and proposal.

## 1. What runs when

| Event | Verification |
| --- | --- |
| Edit and push | Run a focused check while iterating. The opt-in pre-push hook scans pushed commits for secrets. |
| Final branch head | Rebase onto current `origin/main`, open a draft and run `pnpm verify` before one `lci run naba-presence --pr <N> --post --comment --wait`. |
| Merge | GitHub requires the strict local gate. `lci merge` also checks the reviewed head and other applicable gates. |
| Production release | Run the full gate for the exact main SHA against the serving release, then follow §6–7. |
| Hosted recovery | When explicitly enabled, one GitHub-hosted candidate job runs on PR open, synchronize and reopen. CodeQL is a separate advisory workflow. |

No persistent Mac runner should execute fork or Dependabot code. See the
[trust boundary and cutover steps](engineering/operations.md).

## 2. The job graph

The installed local profile uses an outer install, the native release gate, a
second secret scan and two status aggregations. All mandatory results feed
`local-ci/release-gate`. The native gate runs independent static and
security checks in parallel, builds once, and starts isolated PostgreSQL
shards and browser lanes after their prerequisites pass. Required steps and
their dependencies live in `scripts/release/local-receipt.mjs`.

The hosted recovery workflow has one unconditional job that verifies both
parents of the GitHub test-merge commit, sets up pinned tools, and invokes the
same native gate. It has no push or deployment trigger.

## 3. Required checks

Main ruleset `23895031` requires an up-to-date PR head and
`local-ci/release-gate`. The installed profile also issues
`local-ci/summary`; `lci merge` checks the PR head's Codex review.
Use the exact current base and the squash path. If the base advances,
qualify the updated head. Check the live rules with:

```bash
gh api repos/lapeninns/naba-presence/rules/branches/main
```

## 4. Caching and artifacts

Use the local pnpm store and matching Chromium version. Each gate performs a
frozen install in its own worktree and uses its standalone build for integration
and browser tests in that run. Hosted recovery uses a disposable VM and uploads
only revision-labelled receipts for seven days. The production deployment is
built by Vercel and identified by its staged provider deployment ID.

## 5. Local workflow

```bash
pnpm check             # while iterating: typecheck, lint (cached), changed-files format, tests affected since origin/main
pnpm verify            # before handoff: the gate's quick steps exactly (typecheck, lint, format, unit + component, design ratchet, contrast); no database
pnpm test:integration  # integration suite on its own throwaway PostgreSQL 17 (needs pnpm build)
pnpm build && pnpm test:e2e   # browser journeys (pnpm test:a11y: accessibility only)
pnpm format:changed    # Prettier-format the files your branch changed
pnpm lint:workflows    # actionlint + zizmor over .github/
pnpm verify:release    # the whole gate on a fresh worktree; writes the receipt
```

The testing policy (which lane when, and when to run the browser suites) is
in `AGENTS.md`. In short: `check` while iterating, `verify` before handing a
branch to local-ci, the integration and
browser suites only for the files a change affects, and local-ci once on the
rebased final head. local-ci's `gate` job *is* `verify:release`, so do not
also run it locally before a merge; run it yourself only for a release
receipt (§7) or to reproduce a gate failure. How the suites are organised and
the rules they follow: [docs/testing.md](testing.md).

### Local release gate (`pnpm verify:release`)

The release evidence is `pnpm verify:release`
(`scripts/release/verify-local.mjs`), and `ci.yml` runs the same script.
Each step starts as soon as the steps it needs (`GATE_STEPS` in
`scripts/release/local-receipt.mjs`) have passed, so independent steps run
side by side; every step that needs a database gets its own throwaway
PostgreSQL 17 cluster, started one at a time:

**Docs-only fast path** (owner decision 2026-11-20,
`scripts/release/fast-path.mjs`). A pull-request run (local-ci passes
`--base-ref`) whose every changed file, both names of a rename, is inert
documentation runs only `frozen-install`, `format`, `secret-scan` and
`workflow-lint`; every other step is recorded as `skipped` with the note
`docs-only fast path: not run`. Inert documentation is `docs/**` or `*.md`
by the docs-only rule of `scripts/vercel-ignore-build.mjs` (so not
`AGENTS.md`, the docs tests read, `docs/release/`, `.github/`, `scripts/` or
`supabase/`), with no dot-folder in the path and a text or image file type.
Anything else, an empty diff, a diff git cannot list, a run without
`--base-ref` (a release), `--full` or `NABA_GATE_FULL=1` runs the full gate.
The run prints `DOCS-ONLY FAST PATH, not a full pass`; its receipt records
`gatePath: "docs-only"`, is never `ok`, and promotion refuses it.
`tests/server/release-fast-path.test.ts` holds the controlled cases (a code
file among docs, a receipt, a rename out of code, all on real commits) and
checks that no tracked doc a source file names in quotes can take the fast
path.

| Step                 | Needs          | What runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frozen-install`     |                | `pnpm install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `typecheck`, `lint`  | install        | `pnpm typecheck`, `pnpm lint` (zero warnings)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `unit`               | install        | `pnpm test`: the unit and component projects, files in parallel                                                                                                                                                                                                                                                                                                                                                                                                              |
| `format`             | install        | `scripts/format-changed.mjs --check --base origin/main`: the files the change touches are Prettier-formatted (a ratchet: about 775 older files are not; on `main` itself nothing is new)                                                                                                                                                                                                                                                                                     |
| `design`             | install        | `pnpm check:design --ratchet` and `pnpm check:contrast`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `build`              | install        | `pnpm build` (webpack standalone)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bundle-budget`      | build          | `tests/perf/route-js.mjs` with the ceilings from `tests/perf/budgets-baseline.json` (gzip KB: chunk 70, shared 400, route 560)                                                                                                                                                                                                                                                                                                                                               |
| `migration-policy`   |                | `node scripts/ci/migration-policy.mjs` against the base (see below)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `migrate-fresh`      | install        | migrate from scratch, a no-op re-run, `db:runtime-role` twice, `db:status --expect-current`                                                                                                                                                                                                                                                                                                                                                                                  |
| `migrate-upgrade`    | migrate-fresh  | migrate to the merge base, then to HEAD; the schema must equal the from-scratch one                                                                                                                                                                                                                                                                                                                                                                                          |
| `migrate-concurrent` | install        | two `db:migrate` runs at once on a fresh cluster; each version recorded exactly once                                                                                                                                                                                                                                                                                                                                                                                         |
| `integration`        | install, build | `pnpm test:integration` in `--integration-shards` vitest shards (default 4, `NABA_GATE_INTEGRATION_SHARDS`), each on its own migrated cluster; the shards' counts are added up, and the step passes only if more than 0 passed and none skipped                                                                                                                                                                                                                              |
| `e2e`                | install, build | installs Playwright's pinned Chromium (a no-op when present), lists the suite (`playwright test --list`) and splits it by spec file into `--e2e-lanes` lanes (default 6, `NABA_GATE_E2E_LANES`; 1 with `--serial`), balanced by `tests/e2e/lane-weights.json` (`scripts/ci/e2e-lanes.mjs`). Each lane is one `pnpm test:e2e --forbid-only <files>` run with its own migrated cluster, app server and Google stub (3100/3101, 3110/3111, … or a free pair), journey tenant and output folder. A lane must account for exactly the tests planned for it; the counts are added up, and the step passes only if more than 0 passed and none skipped. Failing fast, the first red lane stops the others |
| `audit`              |                | `pnpm audit --prod --audit-level high`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `workflow-lint`      |                | `actionlint` and `zizmor --offline .github/`. Optional: skipped with a note where the tools are not installed (`brew install actionlint zizmor`); a finding fails the gate                                                                                                                                                                                                                                                                                                   |
| `secret-scan`        |                | `gitleaks git --redact --log-opts=HEAD`: the full history of the commit under test (not other branches the worktree's refs can see). **Required**: without gitleaks installed the step is skipped with a note and the gate fails (SEC-13 follow-up)                                                                                                                                                                                                                          |

On an M-series Mac the integration shards and e2e dominate: before this
change the same steps ran one after another in 54-74 minutes, integration
alone 34-38 and e2e 17-31 (receipts of five promotions). `--serial` runs one
step at a time in the table's order, with integration in one shard and e2e
in one lane, for a busy or small machine.

E2e lanes (2026-11-19, 18-core Mac at load average ~24 from other work): the
e2e step went from 766 s (shared suite 12.7 min and isolated suite 8.0 min,
one worker each) to 289 s in six lanes of 4.0-4.7 min, and the whole gate
from 15.0 to 9.5 min. The critical path is now unit (~280 s), then
integration (~275 s), which waits for unit's CPU share. Refresh
`tests/e2e/lane-weights.json` with `node scripts/ci/e2e-lanes.mjs weights
<run dir>/logs/e2e.log` when the lanes drift apart; a stale or missing
weight only unbalances them.

The base is the release production serves according to the committed
receipts in `docs/release/receipts/`, read at `HEAD` (`servingRelease` in
`scripts/release/local-receipt.mjs`): the newest promotion, or the target of
a later rollback whose production probe confirmed it. Before the
first promotion there is none: pass `--base-ref <the SHA production runs>`
(`release.sha` from the platform health check). Without either it falls back
to `origin/main`, which suits a branch; on the `origin/main` commit itself the
merge base is `HEAD`, so `migration-policy` and `migrate-upgrade` would
compare `HEAD` with itself, and promotion refuses that receipt. The receipt
records the base and where it came from (`base.source`).

It checks `HEAD` out into a fresh detached worktree (under
`~/Library/Caches/naba-verify` on macOS, not the per-user temp folder that
macOS empties every day at 03:35; `NABA_GATE_DIR` overrides; in CI the
runner's temp folder), so no `.env*` file, untracked file or local build
output takes part (uncommitted changes in your checkout are not tested; it warns). The
gate's own code runs from your checkout, so uncommitted changes under
`scripts/release/`, `scripts/ci/`, `lib/domain/redaction.ts`, `package.json`
or `.nvmrc` are recorded in the receipt (`gateSource`) and promotion refuses
it. It starts its own PostgreSQL 17 clusters with `scripts/ci/postgres.mjs` and
stops them at the end, even on failure or Ctrl-C. The steps inherit only an allowlist
of your shell's variables (`PATH`, `HOME`, temp and terminal variables, the
pnpm, npm config, corepack and nvm ones, `NABA_PG_BIN`/`NABA_PG_MODE`, Docker,
proxy and Playwright browser locations; `INHERITED_ENV` in
`scripts/release/verify-local.mjs`), so database URLs, CI variables and any
provider credentials you have sourced never reach integration or e2e, and it
never reaches the shared dev database on 54322. It sets `ci.yml`'s
placeholder `env:` values and `LC_ALL`/`LANG` (Homebrew Postgres needs a
UTF-8 locale). It must run on the `.nvmrc` Node major.

Starting a gate never prunes sibling run directories automatically: age does
not establish that a run is finished or that its files are no longer needed.
The gate still cleans up its own worktree and clusters through its existing
cleanup path; retained logs and failed or kept artifacts can consume disk space.
Review them manually and confirm a run is inactive and its evidence is no longer
needed before removing it. This also applies to directories under `NABA_GATE_DIR`.

The first step that fails stops the run: steps still running are terminated
(their whole process tree, SIGTERM then SIGKILL after 40 s; the gate waits
for the tree to exit before removing the worktree) and recorded as
`not-run` with the note `stopped: <step> failed`, and steps not yet started
are `not-run` too. A red unit test therefore ends the run in minutes instead
of holding the shared runner through integration and e2e. `--keep-going`
runs every step anyway, to see all the failures in one run (`--fail-fast` is
the default and still accepted). A passing run is the same either way. A
step whose need failed is `not-run`. Each
step's output goes to `logs/<step>.log` in the printed run directory, all of
it to `verify.log` there with each line prefixed by its step, and a failed
step's last 80 lines are printed. The receipt (version 3) is written to
`docs/release/receipts/local/<UTC time>-<sha12>.json` (gitignored, so the
checkout stays clean for promotion): SHA, base ref, base and merge-base SHAs,
Node, pnpm, PostgreSQL, gitleaks, actionlint, zizmor and Playwright versions,
the options (skips, `--serial`, shard count), and each step's status,
duration, test counts and note. The exit code is 0 only when the gate passed.
`--skip <id,...>` is for iterating; such a receipt never passes promotion. `--list` prints the steps; `--keep-worktree` keeps the
worktree for debugging. Rules are unit-tested in
`tests/server/release-verify-local.test.ts`.

`test:integration`, `test:e2e`, `test:e2e:touch` and `test:a11y` go through
`scripts/run-test-command.mjs`. It never runs them against a database it was
merely handed. By default it starts a throwaway PostgreSQL 17 for the run
(`scripts/ci/postgres.mjs`, its own temp `NABA_PG_DIR`; about 1-3 s with the
migrations and runtime role), points `DIRECT_DATABASE_URL`,
`TEST_RUNTIME_DATABASE_URL`, `DATABASE_URL` and `DATABASE_SESSION_URL` at it,
and stops it when the command exits or on Ctrl-C/SIGTERM. A cluster from
`postgres.mjs start` (the local gate, ci.yml, or the recipe in "Reproduce a CI
database locally") is reused instead: `start` exports
`NABA_PG_DISPOSABLE=<host:port>`, and the wrapper checks that every URL
reaches that port and that the cluster carries `naba.disposable_cluster = on`.
`NABA_TEST_DB=existing` runs against the configured URLs. The guard
(`scripts/test-database.mjs`, shared with the integration helpers and
`scripts/cleanup-harness-data.mjs`) refuses a non-local host in any of those
four variables unless `ALLOW_REMOTE_TEST_DB=1`, and the local Supabase
database port 54322 (the dev tenant) unless `NABA_ALLOW_DEV_DB=1`, even with
`NABA_TEST_DB=existing`. The default needs Homebrew `postgresql@17` on macOS,
or Docker with `NABA_PG_MODE=docker`. Before the first integration file and
after the last, `tests/integration/helpers/global-setup.ts` lifts pauses,
ends `naba:%` fleet leases and drops unused test billing plans, only on such
a throwaway cluster.

**Pre-push hook (opt-in):** `pnpm hooks:install` sets
`core.hooksPath=.githooks` in the shared clone configuration. The hook scans
each pushed ref using the supplied commit IDs, including new branches,
force-pushes and tags. An unknown remote base falls back to that ref's complete
reachable history. Set `NABA_PRE_PUSH_VERIFY=1` to also run `pnpm verify` for
one push affecting code. The hook does not run on dependency installation.


`tsconfig.json` excludes `.claude`, `.design-sync`, `.ds-sync`, `ds-bundle`
and `.worktrees`, matching ESLint's ignores. TypeScript already skips
dot-directories under `**` wildcards, but the gitignored `ds-bundle/` output
(60 generated files) was being typechecked wherever it existed.
Locally generated receipts (`<repo>/docs/release/receipts/local/`, absent from
clean checkouts) are also excluded: retained QA copies and temporary harnesses
are evidence, not application or test sources.
This leaves all maintained source and test directories in the typecheck.

`pnpm lint` runs `eslint --max-warnings 0`, so a warning fails the gate the
same way an error does. ESLint also ignores the gitignored local evidence and
report directories (`.omo`, `.superpowers`, `test-results`,
`playwright-report`, `coverage`, `.pnpm-store`), and `tsconfig.json` excludes
`.omo` and `.superpowers`. `.omo` holds QA evidence with copied source trees
that would otherwise be linted as app code. Ignoring these directories does
not delete them. For a full-document navigation inside the app, use
`hardNavigate` from `lib/client/hard-navigate.ts`, not a relative
`location.assign`, which Next's lint rule flags.

## 6. Migrations

### Rules

- `supabase/migrations` is **append-only**. A migration that exists on `main`
  is never edited, renamed or deleted. Fix forward with a new file.
- New files are named `NNNN_snake_case.sql` and their 4-digit number must be
  higher than `main`'s highest. Numbers are compared as numbers, not strings.
  Allowlisted exceptions, in `scripts/migration-rules.mjs`: the `0021` gap,
  and the legacy `20260729000400_remove_local_demo_data.sql`.
- Each file records itself in `schema_migration`. The runner fails and rolls
  back a file that does not.
- **Expand, then contract.** Production migrations are run by hand and are not
  tied to a deploy (see below), so the deployed code and the schema are
  briefly out of step. Every migration must work with the code that is live
  when it runs, and the new code must work before it runs:
  - Expand (safe in one PR): add tables, nullable columns or columns with
    defaults, new indexes, new functions, and widen constraints.
  - Contract (a later PR, once no deployed code uses the object): drop or
    rename columns and tables, add `NOT NULL` without a default, and tighten
    constraints or RLS.
  - Reviewers hold PRs to this rule. A PR that needs both halves is split.
- **Migration safety** (`scripts/migration-rules.mjs`, enforced on new files
  by `migration-policy.mjs`, so in the gate's `migration-policy` step and the
  Migrations job):
  - A new file containing contract-type or table-locking DDL fails the
    policy unless its leading comment block has
    `-- migrate:contract <reason>`: `drop table`, `drop column`, any
    `rename`, and, on a table the same file did not create,
    `alter column ... type`, `set not null`, `drop default`,
    `add column ... not null` without a default, and `create index` without
    `concurrently`. The marker is the author saying the contract half is
    intended and that the deployed code no longer needs the old shape; ship
    such a file in its own PR. New indexes on existing tables belong in a
    `-- migrate:no-transaction` file with `create index concurrently`, one
    per file.
  - Every transactional migration runs with `lock_timeout` `5s`, so DDL
    queued behind a long transaction fails and rolls back instead of
    queueing every request behind it. Re-run `db:migrate` when the database
    is quieter. A file can set its own with
    `-- migrate:lock-timeout <value>` in its leading comments (`0` for none);
    `MIGRATION_LOCK_TIMEOUT` changes the default for a run. A
    `-- migrate:no-transaction` file gets none unless its header asks: a
    `create index concurrently` that times out leaves an invalid index.

### How the runner behaves (`pnpm db:migrate`)

- Takes a session advisory lock on one connection, so concurrent runs queue.
  The two-int key `("naba", 1)` cannot collide with the app's own
  `hashtext()` locks. Waits up to `DB_MIGRATE_LOCK_TIMEOUT` seconds
  (default 600).
- Refuses a port-6543 (transaction pooler) URL, where a session lock would
  protect nothing. Use the direct URL or the session pooler (5432).
- Runs each file in its own transaction. Every file carries its own
  `begin;`/`commit;`, which the runner strips so its transaction owns the
  file. A file whose first line is `-- migrate:no-transaction` runs as-is;
  none currently do.
- Environment variables:

| Variable                                             | Default               | Purpose                                                                                                              |
| ---------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DIRECT_DATABASE_URL` (falls back to `DATABASE_URL`) | –                     | Admin connection                                                                                                     |
| `MIGRATIONS_DIR`                                     | `supabase/migrations` | Apply another tree, for example the merge base's                                                                     |
| `DB_MIGRATE_EXPECT_NOOP=1`                           | off                   | Exit non-zero if any file would be applied                                                                           |
| `DB_MIGRATE_LOCK_TIMEOUT`                            | `600`                 | Seconds to wait for the lock                                                                                         |
| `MIGRATION_LOCK_TIMEOUT`                             | `5s`                  | PostgreSQL `lock_timeout` for each transactional file (`0` for none); a file's `-- migrate:lock-timeout` header wins |

### What the gate checks (the migration steps)

1. **Policy (`migration-policy`):** `node scripts/ci/migration-policy.mjs
   <base>` checks the rules above against the merge base with the gate's base
   (the last promotion, or the PR's base in CI).
2. **From scratch (`migrate-fresh`):** `db:migrate`, then again with
   `DB_MIGRATE_EXPECT_NOOP=1`, `db:runtime-role` twice, then `db:status
--expect-current`. The schema is dumped.
3. **Upgrade (`migrate-upgrade`):** the database is recreated, the merge
   base's migrations are applied (`git archive` → `MIGRATIONS_DIR`), then
   head's migrations. The schema must match step 2's dump exactly. The diff
   ignores comments, blank lines and pg_dump 17's random `\restrict` lines.
4. **Lock (`migrate-concurrent`):** two `db:migrate` runs start at once on a
   fresh cluster. Both must succeed, and each version must appear exactly
   once.

The integration shards and e2e then migrate their own clusters and create the
runtime role, and every test runs through that non-superuser role.

### Required-migrations manifest

`lib/server/schema-manifest.ts` lists every migration version the code may
rely on. **Every PR that adds a migration appends its version there.**
`tests/schema-compat.test.ts` fails until the manifest holds exactly the
versions in `supabase/migrations` (it uses `listMigrationVersions` from
`scripts/migration-rules.mjs`, the same rule `db:migrate` and `db:status`
use). In production, `assertProductionSafety` refuses to start when a listed
version is missing from `schema_migration`; extra applied versions are
allowed, so expand-only migrations can run ahead of the code.
`tests/integration/startup-assertion.test.ts` checks both directions against
the migrated CI database through the runtime role.

### Production: manual, from the operator's machine

Vercel does **not** run migrations. The project has no Build Command
override, production build logs show a plain `next build --webpack`, and
Production has no `DIRECT_DATABASE_URL` (Preview does). Checked on
2026-09-25 while building this pipeline; there is no `vercel-build` script on
purpose.

For a PR that adds a migration:

1. `pnpm verify:release` has passed for the commit whose migrations you are
   applying (the branch head when migrating before merge), and the migration
   is expand-only. Never run `db:migrate` against production before the gate
   has passed: it is the only check that the migrations apply from scratch
   and from production's schema.
2. Take a restorable database snapshot, and note the current production
   deployment (the rollback unit in `docs/runbook.md`).
3. From your machine, with the admin URL (direct, or session pooler on 5432):
   `DIRECT_DATABASE_URL='<admin url>' pnpm db:migrate`, then
   `DIRECT_DATABASE_URL='<admin url>' pnpm db:status --expect-current`
   (exits 1 while anything is pending; check that the printed `target` is the
   production host).
   Run this **before merging** when the new code depends on the new schema:
   the live code tolerates an expand-only migration, but the new code would
   fail against the old schema.
4. Merge, then promote with `pnpm release:promote` (§7). Merging does not
   deploy production; the promotion script runs `db:status --expect-current`
   again and refuses while anything is pending.
5. On failure, restore the snapshot and promote the noted deployment
   together. Never run ad-hoc down migrations.

## 7. Deploys (Vercel)

Dependabot waits at least seven days before proposing a newly published npm
dependency or GitHub Action version (`.github/dependabot.yml`).

The static gate generates Markdown release notes for each candidate commit
range. To print the complete notes since a promotion, run `pnpm release:notes
<previous-release-sha>` from the qualified checkout. This does not tag, push,
create a GitHub release or promote the site.

**Production ships from the operator's machine.** The Vercel project
reported no connected Git repository on 25 November 2026. Merging does not
deploy. Follow the staged promotion below from a clean worktree of
`origin/main`. If project linking is proposed, revalidate the trigger and
approval setup in the [cutover plan](engineering/operations.md).

### Promotion (`pnpm release:promote`)

First run the local release gate (§5) on the `origin/main` commit and keep
the receipt path it prints; production migrations (§6) come after it has
passed, never before. Then, from a fresh worktree of `origin/main`
(`git worktree add`), with `pnpm install --frozen-lockfile` run, the project
linked (`vercel link`) and the production admin URL in the environment:

```bash
DIRECT_DATABASE_URL='<admin url>' pnpm release:promote --local-receipt <receipt> --production-url https://<production origin> --dry-run
DIRECT_DATABASE_URL='<admin url>' pnpm release:promote --local-receipt <receipt> --production-url https://<production origin>
```

The script refuses, before deploying anything, unless every gate holds
(`checkCandidate`, unit-tested in `tests/server/release-promote.test.ts`):

- The worktree has no changed, staged or untracked files, and no ignored
  `.env*` or `.dev.vars` file that `vercel deploy` would upload.
- `HEAD` equals `origin/main` after a fetch.
- `--local-receipt` names a `verify:release` receipt for exactly that SHA,
  produced in a fresh worktree on the `.nvmrc` Node major, with no
  `--skip`, and every step `passed` (`secret-scan` included; the
  integration and e2e steps must show tests ran), no uncommitted edits to the gate's own
  code, and a base equal to the release production serves according to the
  committed receipts (the newest promotion, or a later confirmed rollback's
  target; with no promotion receipt yet, any base whose merge base is not
  the commit itself). The gate re-judges the steps
  (`scripts/release/local-receipt.mjs`), so a receipt edited to say `ok`
  over a failed step still refuses. Hosted check runs are not consulted.
- `db:status --expect-current` against `DIRECT_DATABASE_URL` reports no
  pending migration (it prints the target; confirm it is production).
  `DIRECT_DATABASE_URL` must be set explicitly, so a local `.env` can never
  stand in for production.

It also refuses unless `READINESS_PROBE_TOKEN` (production's `CRON_SECRET`)
is set for the probes below, and a production origin is given with
`--production-url https://<production origin>` (or `READINESS_URL`). It then
promotes in four phases (`stagedPromotion` and `verifyProduction`,
unit-tested with the Vercel CLI and the probe mocked):

1. **Stage:** `vercel deploy --prod --skip-domain --yes --format json
--build-env NABA_RELEASE_SHA=<sha> --env NABA_RELEASE_SHA=<sha>
--meta releaseSha=<sha>`. A production build with production
   environment, but the production domains stay on the current deployment.
2. **Probe:** `scripts/ops/readiness-probe.mjs --url <staged deployment URL>
--expect-sha <sha>`, up to 3 attempts 10 s apart (a cold start). Ready or
   degraded passes; not ready, unreachable, 401 or another SHA fails. If the
   project uses Vercel Deployment Protection, set
   `VERCEL_AUTOMATION_BYPASS_SECRET` (Project → Settings → Deployment
   Protection → Protection Bypass for Automation) so the probe can reach the
   deployment URL; it is sent as `x-vercel-protection-bypass`.
3. **Promote:** only after the probe passed, `vercel promote <deploymentId>
--yes`. If every probe attempt failed the script exits 1, writes no
   receipt and production still serves the previous deployment: there is
   nothing to roll back. Inspect the staged deployment's logs from its URL.
4. **Verify production:** `readiness-probe.mjs --url <production origin>
--expect-sha <sha> --json`, up to 5 attempts 15 s apart (each killed after
   30 s); it passes only when production answers with the promoted SHA. The
   result is recorded in the receipt as `productionProbe`. The receipt is
   written as soon as `vercel promote` succeeds, with `productionProbe:
{ status: "pending", ok: false, url, expectSha, startedAt }`, and
   rewritten with the probe's result; a committed receipt still `pending`
   means the script stopped before the probe finished (production promoted
   but not verified: check it with `pnpm ops:readiness --url <production
origin> --expect-sha <sha>`). If production does not serve the SHA the
   script exits 3: commit the receipt, check `vercel promote status`, and
   roll back with `pnpm release:rollback` (below).

After the promotion it writes `docs/release/receipts/<UTC time>-<sha12>.json`:

- build: `sha`, `deploymentId`, `url`, and `localGate`: the local receipt's
  file name, the sha256 of its bytes, its finish time, base and each step's
  status, and `copy`, the `<receipt>.local.json` file beside it holding the
  local receipt's exact bytes, so the sha256 stays checkable;
- migrations: every `supabase/migrations` version the commit ships, with the
  file's sha256;
- configuration: the production variable **names** from
  `vercel env ls production` (values are never read into the receipt), plus
  `operator` (`git config user.name`) and `timestamp`.

The script refuses to write a receipt in which any value would be changed by
`lib/domain/redaction.ts`, or a configuration entry that is not a variable
name. It validates a provisional receipt before deploying, so those refusals
happen before production changes, and prints the deployment ID and URL as soon
as the deploy returns. If the first receipt write fails, roll back or write
the receipt by hand from the printed values. Commit the receipt and
its `.local.json` copy; the next release's gate takes its base from it.

Smoke check after the receipt: its `productionProbe.ok` is `true`, and
`GET /api/operations/health?scope=platform` with the cron bearer returns
`release.sha` (equal to the receipt's `sha`, with `source`
`naba_release_sha`) and `schema.compatible: true`. Only the platform scope
reports these; the session scope does not.

### Rollback (`pnpm release:rollback`)

From a checkout holding every promotion receipt (fetch `origin/main`; include
an uncommitted receipt if the release just failed), with the project linked
and `READINESS_PROBE_TOKEN` set:

```bash
pnpm release:rollback --production-url https://<production origin>          # dry run: prints the plan, runs nothing
pnpm release:rollback --production-url https://<production origin> --yes    # acts
```

The dry run prints what production serves according to the receipts, the
deployment it would return to (the release production served before the
current one, skipping any it was rolled back from, or `--to <receipt |
deploymentId>`, which can name any recorded promotion, including a roll
forward) and the exact commands. The operator (`git config user.name`) and a
provisional receipt are checked before `vercel promote`. `--yes` runs `vercel promote
<deploymentId>`, probes production for the target's SHA (as phase 4 above)
and writes `docs/release/receipts/<UTC time>-<sha12>.rollback.json`; commit
it. Exit 3 means production does not serve the target: check `vercel promote
status`. A rollback whose probe did not confirm the target is recorded but
does not count: the receipts still name the release it tried to leave, so
rerun the rollback to retry.

It refuses when the target ships different migrations from production:
migrations are roll-forward-only and a deployment rollback cannot undo one.
Restore the snapshot taken before the migration (`docs/runbook.md`), confirm
`db:status`, then rerun with `--database-restored`, which the receipt
records. Afterwards read the deployed cron list back against the target's
`vercel.json` (ledger OPS-09). The script trusts the receipts for what
production serves; compare its dry run with `vercel promote status`. It has
not been drilled on a staging project yet (owner, OPS-09). After a
confirmed rollback, the gate's default base, promotion's required base and
`--expect-promoted` are the rollback target.

### Ignored build step

- `vercel.json` `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`. Exit 0
  means **skip**; exit 1 means build.
  - **Production is never skipped.**
  - Previews are skipped for `dependabot/*` branches, and when every file
    changed since the branch's last deployment
    (`VERCEL_GIT_PREVIOUS_SHA..VERCEL_GIT_COMMIT_SHA`) is docs-only.
  - Anything uncertain builds: an unknown `VERCEL_ENV`, no previous SHA, or a
    SHA outside Vercel's shallow clone.
- GitHub environment protection rules do not apply to Vercel deploys.

## 8. Runner operations

The installed local-ci Mac executes reviewed same-repository heads. GitHub
runners are dormant. See the [operations guide](engineering/operations.md)
for queues, cleanup, trust boundaries, and the hosted recovery design.
Legacy Mac Actions setup files remain reference material for reverting to
the old workflow after separate authorization.

## 9. Security workflows

Dependabot continues to propose updates. The native gate enforces production
advisory and secret checks and reports workflow-lint results. With repository
Actions disabled, CodeQL has no current PR or scheduled execution. The hosted
recovery configuration retains separate PR and weekly analyses of TypeScript,
JavaScript, and Actions. See the [pilot](engineering/pilot.md) for version
choices and source references.

## 10. Gate maintenance

- A new check goes in `GATE_STEPS` (`scripts/release/local-receipt.mjs`) with
  the steps it `needs`, and in the `steps` map of
  `scripts/release/verify-local.mjs`; `tests/server/release-verify-local.test.ts`
  pins the list and the order. Changing the steps changes the receipt
  version, and promotion accepts only the current version.
- Prefer a step to a new workflow job: it then runs on the Mac and in CI
  alike, and in every receipt.
- A step that needs a tool which may be missing is `required: false` and
  returns `skipped` with a note when the tool is absent; a finding still
  fails the gate.

## 11. Debugging a red run

Start with `lci status` and the run directory printed by `lci`. The gate
summary identifies each step's outcome, runtime and test counts. For a hosted
rehearsal, inspect `Candidate verification` and its revision-labelled receipt.
The gate is the same entry point in either case.

Use `pnpm verify:release --keep-going --keep-worktree` to diagnose a release
gate failure and retain the isolated checkout. `--skip` is for diagnosis.
For a targeted check, use `pnpm test:integration <files>` after the build or
`pnpm test:e2e -g "<test name>"` with the disposable harness.

**Reproduce a CI database locally:** this uses the same script as CI.

```bash
eval "$(node scripts/ci/postgres.mjs start)"   # exports DIRECT_DATABASE_URL, DATABASE_URL, TEST_RUNTIME_DATABASE_URL, NABA_PG_DISPOSABLE
pnpm db:migrate && pnpm db:runtime-role
pnpm test:integration
node scripts/ci/postgres.mjs stop
```

Plain `pnpm test:integration` does this on its own; start a cluster by hand
only to keep it between runs or inspect it. On macOS it uses Homebrew
`postgresql@17` (`NABA_PG_BIN` overrides the bin folder);
`NABA_PG_MODE=docker` uses `postgres:17-alpine`. It picks a free port and
never one in 54320-54329, so it never collides with the Supabase stack.
Start one cluster per `NABA_PG_DIR` at a time.

On the docker path `start` records the container's full ID (`docker run
--cidfile` into its state directory) and labels the container
`naba.throwaway-pg=1`; `stop` removes only that ID (`docker rm -f -v`), never
a container found by name or label. When the removal fails, `stop` exits 1
and keeps the state; run it again once Docker answers. The gate and
`pnpm test:integration`/`test:e2e` print that retry command. State without a
full ID is refused. An older script recorded the container's name
(`state.json`) and set no label: once that container is finished, remove it
with `docker rm -f -v <name>`, then delete the directory. An empty
`container.id` means a CLI was killed before it wrote the ID: find the
container with the filter below. A run killed before it could stop (kill -9,
a crash, a reboot) leaves its container and data volume behind: list them
with `docker ps -a --filter label=naba.throwaway-pg=1` and remove each one
you know is finished with `docker rm -f -v <id>`, then delete its state
directory.

The Docker CLI writes the ID file itself, so it must be able to write the
state directory. A confined CLI such as the Ubuntu `docker` snap cannot see
`/tmp`: put the directory in a non-hidden folder under `$HOME` with
`NABA_PG_DIR` for a cluster started by hand, `TMPDIR` for
`pnpm test:integration`/`test:e2e` (they make their own directory there), or
`NABA_GATE_DIR` for the gate.

**Postgres logs:** when `start` fails, it prints the log itself: `pg.log`
under `NABA_PG_DIR` in native mode, and `docker logs` in docker mode. In the
gate each cluster's directory is `pg-<step or shard>` in the run directory.

**Migration steps:** _policy_ failures name the file and the rule; _upgrade_
failures print the lines only in the from-scratch or only in the upgraded
schema; for _lock_ failures both `db:migrate` logs are in the step's log.

If the docs-only fast path applies, the log names the checks that ran and
identifies the skipped steps. A full release still requires the full gate.
See the [operations guide](engineering/operations.md) for runner failures.
