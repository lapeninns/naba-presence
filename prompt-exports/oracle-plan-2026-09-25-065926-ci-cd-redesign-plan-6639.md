# Oracle Plan



# CI/CD redesign plan for naba-presence

## 1. Summary

`ci.yml` is currently one 18–21 minute serial job. The plan replaces it with a graph of parallel jobs that:

- run behind a single stable required check, **`CI result`**
- build once and share the standalone artifact
- use caches for the pnpm store, `.next/cache` and Playwright browsers
- skip code jobs on docs-only changes without the required check going missing
- run all third-party actions pinned to a full commit SHA, with least-privilege permissions

A small `plan` job decides the runner **lane**: GitHub-hosted, or the owner's Mac for trusted runs only. The whole build → integration → e2e chain moves together, because the standalone artifact contains platform-native binaries. `services:` is replaced by one Postgres script that works on both platforms. It uses Docker on Linux and a throwaway Homebrew `postgresql@17` cluster on macOS.

The plan also covers:

- **Migrations:** `scripts/db-migrate.mjs` gets hardened (lock, one transaction per file, a check that each file records itself), and a Migrations job validates from-scratch, re-run and main→head upgrades.
- **Claude review:** runs once when a PR opens, plus on demand.
- **Security and dependencies:** Dependabot, CodeQL and dependency-review are added.
- **Local checks:** a `pnpm verify` script and an opt-in pre-push hook.
- **Branch protection:** a ruleset on `main`, applied only after the new check names exist.

This is a rebuild, not a patch: the current single job can't express parallel jobs, lanes or path skipping.

## 2. Current state and audit

| Item | Verdict | Reason |
|---|---|---|
| Single `quality` job (install → typecheck → lint → test → migrate → role → build → integration → e2e) | **Rebuild** | Serial steps, no caching, one database shared by integration and e2e, no stable check name for protection. |
| `services: postgres:17-alpine` | **Replace** with `scripts/ci/postgres.mjs` | `services:` only works on Linux, so the same job couldn't run on macOS. Plain PG17 is known to be enough: today's CI passes on it without Supabase roles. |
| Literal CI secrets (`NEXTAUTH_SECRET`, etc.) | **Keep** | No real secrets are needed, so fork and Dependabot PRs can run everything. |
| DB name `nabareview_test` | **Keep** | Keeps the doc changes in `docs/architecture.md` small. |
| `gitleaks/gitleaks-action@v2` | **Replace** with the pinned gitleaks CLI | The action needs `GITLEAKS_LICENSE` for org-owned repos (unverified whether `lapeninns` is an org) and a token. The CLI needs neither. |
| Mixed `actions/checkout@v4`/`@v6`, tags not SHAs | **Consolidate** | Pin every action to a full SHA with a `# vX.Y.Z` comment; Dependabot bumps them. |
| Workflow-wide `pull-requests: read` | **Remove** | Set `permissions: {}` at the top of each workflow and grant permissions per job. |
| `claude-review.yml` on `synchronize` | **Rework** | Per requirement 1. |
| `pnpm test` also matches `tests/integration/**` | **Keep** | Those tests are skipped unless `RUN_DB_TESTS` is set, so it's harmless. |
| `tsconfig.json` `exclude: ["node_modules"]` only | **Fix** | Local `tsc` also typechecks `.claude/worktrees/*/**` (seven copies of the repo), which makes local verify slow. Add `.claude`, `.worktrees`, `.design-sync` to `exclude`. |

**Migrations: repo evidence.**

- `build` is `next build --webpack`. There is no `vercel-build` script, and `vercel.json` has no `buildCommand`.
- `docs/runbook.md` says `pnpm db:migrate` is run by hand, with snapshot and rollback as one unit.
- **Conclusion: the repo does not show migrations running in the Vercel build. This is unverified** (see §3.5).

**Constraints the design relies on:**

- **Integration and e2e both need `.next/standalone`.** `app-server.ts` and `pnpm start` run it, so both jobs depend on the build.
- **The standalone build is tied to its platform.** Its traced `node_modules` includes the native `sharp`/`@img` binary, so a macOS build can't be run on Linux.
- **Advisory locks are per database, but roles are shared across a Postgres cluster.** Giving each job its own cluster avoids both kinds of collision.
- **Hosted minutes are free for a public repo.** The Mac buys speed, not savings, so the hosted lane must stay fully working.

## 3. Design

### 3.1 Workflows

**`.github/workflows/ci.yml`**

- **Triggers:** `pull_request`, `push: [main]`, `workflow_dispatch`, `workflow_call` (inputs: `full: boolean`).
- **Concurrency:** group `ci-${{ github.event.pull_request.number || github.sha }}`, with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. On `main` each SHA gets its own group, so nothing is cancelled.

| Job id | `name:` (check name, stable) | Needs | Runs on | Timeout | Permissions |
|---|---|---|---|---|---|
| `plan` | Plan | – | `ubuntu-24.04` always | 5 | `contents: read`, `pull-requests: read` |
| `gate` | Gate | plan | lane | 10 | `contents: read` |
| `build` | Build | plan | lane | 15 | `contents: read` |
| `migrations` | Migrations | plan | lane | 10 | `contents: read` |
| `integration` | Integration | plan, build | lane | 20 | `contents: read` |
| `e2e` | E2E (shard N/2) | plan, build | lane | 20 | `contents: read` |
| `secret-scan` | Secret scan | – | hosted | 5 | `contents: read` |
| `dependency-review` | Dependency review | – (PR only) | hosted | 5 | `contents: read` |
| `result` | **CI result** | all of the above | hosted | 5 | none |

**`plan` job outputs:**

- `runner`: a JSON string, either `"ubuntu-24.04"` or `["self-hosted","macOS","ARM64","naba-trusted"]`. Lane jobs use `runs-on: ${{ fromJSON(needs.plan.outputs.runner) }}`, so their `name:` is the same on either lane.
- `code`: `true` or `false`.

`code` is decided as follows:

- Always `true` on push, schedule, dispatch and `workflow_call`.
- On PRs, list the changed files with `gh api repos/{repo}/pulls/{n}/files --paginate` (no third-party action). `code` is `false` only if **every** file matches `docs/**` or `*.md`, excluding `AGENTS.md`.
- Any change under `.github/**`, `scripts/**` or `supabase/**` counts as code.

Lane selection, as pseudocode:

```text
trusted = vars.SELF_HOSTED_ENABLED == 'true' && github.repository == 'lapeninns/naba-presence' && (
    (event in [push, schedule, workflow_dispatch, workflow_call] && ref == refs/heads/main)
 || (event == pull_request
     && pull_request.head.repo.full_name == github.repository
     && pull_request.user.login != 'dependabot[bot]'
     && github.actor != 'dependabot[bot]'))
runner = trusted ? SELF_HOSTED_LABELS : "ubuntu-24.04"
```

**`result` job:** `if: always()`. It fails if any entry in `needs.*.result` is `failure` or `cancelled`; `skipped` counts as a pass. This is the skip-aware pattern: docs-only PRs skip gate/build/etc., and `CI result` still reports green. Sharding or splitting jobs later never changes the required check name.

**`gate` job:** checkout (the default `clean: true` matters on the Mac) → `pnpm/action-setup` → `setup-node` with `node-version-file: .nvmrc` (new file containing `22`) and `cache: pnpm` on the hosted lane only (the Mac keeps its store on disk) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`.

- Target is under 3 minutes. If measured runs take longer, split it into three jobs. The aggregator means no ruleset change is needed.

**`build` job:**

- Restore the `.next/cache` cache. Key: `next-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('app/**','components/**','lib/**','next.config.ts') }}`. Restore key: the lockfile prefix.
- `pnpm build` with the same literal env block as today.
- `tar -czf standalone.tgz .next/standalone`. Tar is required because upload-artifact doesn't keep pnpm's symlinks. The postbuild step has already copied `static/` and `public/` inside.
- Upload artifact `standalone-${{ runner.os }}-${{ runner.arch }}` with `retention-days: 1`.
- **Unknown to check:** whether `next build` touches the DB (prerendering). Today it ran after migrate. First step: run the build job with no DB. If it fails, add a Postgres start to the build job.

**`integration` job:** install → download and untar the artifact → `node scripts/ci/postgres.mjs start` → `pnpm db:migrate` → `pnpm db:runtime-role` → `pnpm test:integration` → `postgres.mjs stop` (`if: always()`).

**`e2e` job:** matrix `shard: [1, 2]` with `fail-fast: false`.

- Setup: install, artifact, Postgres, migrate and role as in integration. Then `postgres.mjs ports` exports a free `PLAYWRIGHT_PORT` (the stub uses port+1).
- Playwright cache: key `ms-playwright-${os}-${arch}-${playwright version}` (version from `pnpm exec playwright --version`). The path is `~/.cache/ms-playwright` on Linux and `~/Library/Caches/ms-playwright` on the Mac.
  - On a cache hit, Linux runs `playwright install-deps chromium`.
  - On a miss, run `playwright install --with-deps chromium`.
- Run `pnpm test:e2e -- --shard=${{ matrix.shard }}/2`. Each shard runs its own `globalSetup` against its own database, so sharding is safe.
- On failure only: upload `test-results/` (traces, screenshots) with `retention-days: 7`.
- **Why 2 shards:** e2e is roughly half of the current 18 minutes. Two shards cut that about in half and cost one extra install. Revisit once timings are measured.

**`migrations` job:** see §3.5.

**`secret-scan` job:** download the pinned gitleaks release and verify its SHA256.

- PRs: `gitleaks git --log-opts="${base}..${head}"` with `fetch-depth: 0`.
- Push: scan the pushed range.
- Nightly: full history.

**`dependency-review` job:** `actions/dependency-review-action` with `fail-on-severity: high`. It runs only when `github.event_name == 'pull_request'`.

**`.github/workflows/nightly.yml`**

- Triggers: `schedule: '17 4 * * *'` and `workflow_dispatch`, on main.
- Job 1: `uses: ./.github/workflows/ci.yml` with `full: true`. This gives a full e2e run including `accessibility.spec.ts` (a11y is a subset of e2e, so no separate job), migrate-from-scratch, and URLs from `main` for `release-checklist.md`.
- Additional jobs:
  - `pnpm audit --prod --audit-level high`
  - a full-history gitleaks scan
  - **visual**, report-only: `continue-on-error: true`. It runs the fixture server plus the app, runs `shoot.mjs` over a fixed route list, uploads the screenshots, and fails the job only on `horizontalOverflow` or console errors. It depends on `tests/visual/with-visual-db.sh` working in CI. If it doesn't, leave this job out and record it as a follow-up in `docs/ci.md`.
- GitHub's default email on a failed scheduled run is enough notification.

**`.github/workflows/codeql.yml`:** languages `javascript-typescript` and `actions` (the latter catches workflow injection, which matters on a public repo), with `build-mode: none`. Runs on PR, push to main and weekly. Permissions: `security-events: write`, `actions: read`, `contents: read`. It is **not** a required check at first.

**`.github/dependabot.yml`:**

- `github-actions`: weekly, one group containing everything; this keeps the SHA pins current.
- `npm` (pnpm lockfile supported): weekly, `open-pull-requests-limit: 5`, with groups:
  - `next` (`next`, `eslint-config-next`, `@next/*`)
  - `react`
  - `test-tooling` (`vitest`, `@playwright/test`, `@testing-library/*`, `jsdom`)
  - `types` (`@types/*`)
  - `dev-minor-patch`
- Dependabot rather than Renovate because it's built in and needs no app install.

### 3.2 Postgres on both lanes: `scripts/ci/postgres.mjs`

A dependency-free Node script with subcommands `start`, `stop` and `ports`.

- **Linux:** `docker run -d --rm --name pg-$GITHUB_RUN_ID-$GITHUB_JOB-$SHARD -p $PORT:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=nabareview_test postgres:17-alpine`, then poll `docker exec … pg_isready`.
- **macOS:**
  - Resolve `$(brew --prefix postgresql@17)/bin`.
  - `initdb -D $RUNNER_TEMP/pg -U postgres --auth=scram-sha-256 --pwfile=<postgres> -E UTF8 --locale=en_US.UTF-8`.
  - `pg_ctl -D … -o "-p $PORT -k $RUNNER_TEMP" -l $RUNNER_TEMP/pg.log -w start`, then `createdb nabareview_test`.
- **Both:** pick a free port (listen on `:0`). Write `DIRECT_DATABASE_URL`, `DATABASE_URL` and `TEST_RUNTIME_DATABASE_URL` to `$GITHUB_ENV`, using the same URL shapes as today but with the chosen port. `stop` is idempotent. On failure, `start` prints the PG log.
- **Options considered for the Mac:**
  - Colima or Docker Desktop: rejected. It's a VM, heavy, and often not running.
  - `supabase start`: rejected. It takes minutes, starts about ten containers, and its fixed port 54322 collides with the owner's own dev stack on the same Mac.
  - A shared Homebrew service: rejected, because role names like `naba_app_runtime` are shared across a cluster.
  - A throwaway cluster per job: chosen. It starts in about 2 seconds and is fully isolated.

### 3.3 Self-hosted runner (trusted runs only)

**Which jobs run where:**

- Lane-selected (can run on the Mac): gate, build, migrations, integration, e2e.
- Always hosted: plan, secret-scan, dependency-review, result, CodeQL and claude-review. They are cheap and Linux-oriented, and claude-review is the only job that uses secrets.

**Fork safety, layered.** A fork PR's `pull_request` run uses the fork's *own* workflow file, so a fork could hard-code `runs-on: self-hosted`. Nothing inside the repo can stop that. The controls are:

1. **Fork approval.** Actions setting "Require approval for all external contributors", via `gh api -X PUT repos/lapeninns/naba-presence/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`. Confirm the endpoint exists, or set it in the UI. The runbook rule: never approve a fork run that touches `.github/**`.
2. **A pre-job hook that lives on the Mac** (`ACTIONS_RUNNER_HOOK_JOB_STARTED`), so a fork cannot edit it. It reads `$GITHUB_EVENT_PATH` and exits non-zero unless all of the following hold:
   - the repository is `lapeninns/naba-presence`
   - the event is `push`, `schedule`, `workflow_dispatch`, or a `pull_request` where `head.repo.full_name == base`
   - the PR author is not Dependabot
   - the event is never `pull_request_target`, `issue_comment` or `workflow_run`

   A reference copy lives in the repo at `scripts/ci/runner-hooks/` as documentation only.
3. **Least privilege on the machine.** A runner-scoped `naba-trusted` label, registered at repo level only. The runner uses a dedicated non-admin macOS user `gh-runner` with no SSH keys, no `gh` auth, no keychain items and no access to the owner's home folder. Default workflow token set to read-only: `PUT /repos/…/actions/permissions/workflow` with `default_workflow_permissions=read`.

**Fallback when the Mac is offline.** The toggle is repo variable `SELF_HOSTED_ENABLED`. It is unset by default, which means hosted.

- Flip it with `gh variable set SELF_HOSTED_ENABLED --body false|true -R lapeninns/naba-presence`, then re-run the queued runs.
- Optional extra: a fine-grained PAT secret `RUNNER_PROBE_TOKEN` (Administration: read). If present, `plan` checks `GET /repos/…/actions/runners` and falls back to hosted when no `naba-trusted` runner is online. If absent, only the variable is used.
- This is needed because `timeout-minutes` doesn't count queue time, and queued jobs otherwise wait up to 24 hours.

**Runbook for the Mac** (recorded in `docs/ci.md`):

- **Install:** `brew install postgresql@17 gitleaks jq`.
- **Two runner instances,** `mac-1` and `mac-2`, in separate folders so integration and e2e run in parallel. Register each with `./config.sh --url https://github.com/lapeninns/naba-presence --labels naba-trusted --name mac-N --work _work --unattended`. The default labels `self-hosted`, `macOS` and `ARM64` are added automatically.
- **Service:** run as a LaunchDaemon with `UserName=gh-runner` (not `svc.sh`'s LaunchAgent, so it doesn't depend on someone being logged in). Disable sleep on AC power with `pmset`. Keep the runner's auto-update on.
- **Cleanup between jobs (near-ephemeral):**
  - Post-job hook: `pg_ctl stop` any cluster under `_work/_temp`, `pkill -u gh-runner -f 'standalone/server.js|postgres -D|playwright'`, delete `_work/_temp`, and `git clean -ffdx` the workspace.
  - The pre-job hook runs the same kill as a backstop.
  - The pnpm store and Playwright browser cache persist between jobs.
- **Why not `--ephemeral`:** true one-job registration needs an admin token stored on the Mac to mint registration tokens. That is a bigger credential risk than the persistent runner plus cleanup hooks.
- **Before switching the Mac lane on:** run the full graph on both lanes. `CI` is set by the runner, so Playwright uses bundled Chromium on both. Collation differs between macOS and musl `en_US.UTF-8`, so any ORDER BY assertion that fails on only one lane must be fixed or noted before enabling.

### 3.4 claude-review.yml

- **Triggers:**
  - `pull_request: types [opened, ready_for_review, reopened, labeled]`
  - `issue_comment: types [created]`
- **Job condition:**
  - For `pull_request`: action ≠ `labeled`, or `label.name == 'claude-review'`. Also require `draft == false`, same-repo head, and `pull_request.user.login != 'dependabot[bot]'`.
  - For `issue_comment`: `github.event.issue.pull_request` is set, `startsWith(github.event.comment.body, '@claude review')`, `comment.author_association` is one of `OWNER`/`MEMBER`/`COLLABORATOR`, and `comment.user.type != 'Bot'`.
- **First step (comment trigger only):** comment-triggered runs have secrets even when the PR comes from a fork. So the first step runs `gh pr view $N --json isCrossRepository,isDraft,author` and exits the job early if the PR is cross-repo, a draft, or authored by Dependabot.
- **Last step (label trigger only):** `gh pr edit --remove-label claude-review` with `if: always()`, so re-adding the label triggers a new review.
- **Concurrency:** group `claude-review-${{ github.event.pull_request.number || github.event.issue.number }}`, keeping `cancel-in-progress: true`.
- **Other:** runner, permissions, prompt and allowedTools are unchanged. Pin to SHAs.
- If the Claude GitHub App is ever installed, change the phrase to `/claude-review` to avoid double-triggering.

### 3.5 Migration safeguards

**A. Harden `scripts/db-migrate.mjs`.** This is additive; files and the version table are unchanged.

1. Take `pg_advisory_lock(hashtext('naba:db-migrate'))` once on the single connection (`max: 1`) and release it in `finally`. This blocks concurrent runs, for example two Vercel builds. It needs a direct or session-pooler URL, which `DIRECT_DATABASE_URL` already is. The script must refuse a URL on port 6543.
2. Wrap each file in `sql.begin`, unless the file's first line is `-- migrate:no-transaction`. Inside the same transaction, after executing the file, check `select 1 from schema_migration where version = $1`. If the row is missing, throw `migration <v> did not record itself`, which rolls the file back.
   - **Check during implementation:** grep all 51 files for `begin;`/`commit;`/`concurrently`/`alter type … add value`. Mark any such files `no-transaction`. The from-scratch CI run proves the rest.
3. Add `MIGRATIONS_DIR` (default `supabase/migrations`) and `DB_MIGRATE_EXPECT_NOOP=1`. With the latter, the script exits non-zero if any file would be applied.
4. Log `Applied`/`Already applied` exactly as today.

**B. Migrations CI job**, run against a fresh cluster:

1. **Policy check** with `scripts/ci/migration-policy.mjs`, using `fetch-depth: 0` and the merge base with `origin/main`. It fails if:
   - a file that exists on main was modified, deleted or renamed
   - a new file's name doesn't match `^\d{4}_[a-z0-9_]+\.sql$`
   - a new version sorts at or below main's highest version

   The `0021` gap is on a known-gaps allowlist.
2. `db:migrate` from scratch, then again with `EXPECT_NOOP=1`. Run `db:runtime-role` twice, then `db:status`.
3. `pg_dump --schema-only` → `scratch.sql`.
4. Drop and recreate the DB. Run `git archive <merge-base> supabase/migrations | tar -x -C $RUNNER_TEMP/base`, then `MIGRATIONS_DIR=$RUNNER_TEMP/base/supabase/migrations pnpm db:migrate`, then `pnpm db:migrate` with head's files. Dump → `forward.sql`, and `diff` it against `scratch.sql` after sorting and stripping comments. If this proves too noisy, downgrade the diff to an uploaded artifact.
5. On a fresh DB, start two `db:migrate` processes at once. Both must succeed and each version must appear exactly once. This proves the lock works.

**C. Contract test.** Extend `tests/migration-contract.test.ts`: every filename is 4-digit and zero-padded, and the only gaps are the ones on the allowlist.

**D. Confirm where production migrations actually run.** The repo does not answer this. To verify:

1. Check the Vercel dashboard at Project → Settings → Build and Deployment → Build Command override. Alternatively call the API: `vercel api`, or `curl -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v9/projects/<project>` and read `buildCommand` and `installCommand`.
2. Check `vercel env ls production` and `vercel env ls preview` to see which scopes have `DIRECT_DATABASE_URL`.
3. Look for `Applied 00`/`Already applied` in a recent production build log (`vercel inspect <url> --logs`).

**Outcomes:**

- **If migrations do run in the build:**
  - Replace the dashboard override with a repo-owned `vercel-build` script (Vercel prefers it over `build`) that runs `node scripts/db-migrate.mjs` only when `VERCEL_ENV === 'production'`, then `pnpm build`. The advisory lock handles concurrent builds.
  - Flag that a preview build would fall back to `DATABASE_URL` (runtime role), which is wrong.
  - Flag that the migration runs **before** the deployment is promoted, while the old deployment is still serving the new schema. Migrations must stay backward compatible (expand, then contract), which becomes a PR review rule.
  - Record that this conflicts with the runbook's "snapshot, then migrate" unit. The owner decides; the plan recommends moving migrations out of the build.
- **If migrations are manual:** keep them manual and state it in the runbook. Don't add build-time migrations.

### 3.6 Vercel gating

- **Recommendation:**
  - **Production:** enable **Vercel Deployment Checks** requiring the GitHub check `CI result`. This is a dashboard change: Settings → Deployment Checks. The production domain is then only assigned after CI passes.
  - **Previews:** not gated.
- **Caveat:** Deployment Checks block promotion, not the build. If build-time migrations are confirmed, they run anyway, which is one more reason for moving migrations out of the build.
- **In the repo:** add `ignoreCommand: "node scripts/vercel-ignore-build.mjs"` to `vercel.json`. The script skips preview builds for `dependabot/*` branches and docs-only diffs (`VERCEL_GIT_PREVIOUS_SHA..VERCEL_GIT_COMMIT_SHA`). It **never skips production** (`VERCEL_ENV === 'production'`, so exit 1 means build).
  - `tests/server/vercel-cron.test.ts` only pins `crons`, so it stays green.
- GitHub environment protection rules don't apply, because Vercel deploys through its own GitHub integration.

### 3.7 Push to main vs. merge queue

The ruleset requires branches to be up to date, and merges are squash merges. So the tree on `main` equals the tested merge ref. The full graph still runs on push to main because:

- it's free for a public repo
- it gives run URLs on `main` for the release checklist
- it writes the main-branch caches, which are the only caches PRs can read

Pushes to main are never cancelled. A merge queue is not used: with a single maintainer, the up-to-date rule is enough.

### 3.8 Local workflow

**`package.json` scripts:**

- `"verify": "pnpm typecheck && pnpm lint && pnpm test"`: the fast gate, no DB.
- `"verify:full": "pnpm verify && pnpm build && pnpm test:integration"`: the README gate. It needs the local Supabase stack.
- `"hooks:install": "git config core.hooksPath .githooks"`: opt-in. There is deliberately no `prepare` script, so CI and Vercel installs are untouched.

**`.githooks/pre-push`:** a POSIX shell script.

- Skips if `SKIP_VERIFY=1`; otherwise runs `pnpm verify`.
- Runs `gitleaks git --log-opts="@{u}..HEAD"` only if `gitleaks` is on PATH.
- Can be bypassed with `git push --no-verify`.

**Where each check runs:**

- **Local:** `verify` before pushing; `verify:full`, `test:e2e` and `test:a11y` when touching server, DB or UI flows.
- **CI:** everything, plus migrations, secret scanning, dependency review and CodeQL.

### 3.9 Branch ruleset (applied last)

Store the ruleset JSON at `.github/rulesets/main.json` so it can be reviewed. Apply it with `gh auth switch --user lapeninns && gh api -X POST repos/lapeninns/naba-presence/rulesets --input .github/rulesets/main.json`. Contents:

- **Target:** `~DEFAULT_BRANCH`, enforcement `active`.
- **Rules:**
  - `deletion`
  - `non_fast_forward`
  - `pull_request` (0 required approvals, since there is a single maintainer)
  - `required_status_checks`: `strict_required_status_checks_policy: true`, context `CI result`, `integration_id: 15368` (GitHub Actions)
- **Bypass:** the repository admin role in `pull_request` mode, which allows an emergency merge through a PR but no direct push.
- **Precondition:** `gh api repos/lapeninns/naba-presence/commits/<main sha>/check-runs --jq '.check_runs[].name'` lists `CI result`.

### 3.10 `docs/ci.md` contents

1. **Trigger matrix:** rows are local / PR (same-repo, fork, Dependabot, draft) / push main / nightly / deploy; columns are each job and the lane it uses.
2. **Job graph** as a mermaid diagram, with timeouts and target durations.
3. **Required checks and the ruleset:** why there is one aggregator, and how to add a job without touching the ruleset.
4. **Caching and artifacts:** keys and retention periods.
5. **Local workflow:** §3.8.
6. **Migrations:** policy, CI stages, the Vercel verification result, and the expand/contract rule.
7. **Self-hosted runner runbook:** §3.3, including flipping the variable and the fork-approval rule.
8. **Debugging:**
   - downloading traces (`gh run download`)
   - re-running one shard
   - reproducing a CI DB locally (`node scripts/ci/postgres.mjs start`, which also works for developers)
   - reading `pg.log`
   - lane mismatches
   - stuck queued jobs

**Other doc updates:**

- README "Validation": point to `pnpm verify`/`verify:full` and `docs/ci.md`.
- `docs/runbook.md` "Deployment gate": CI covers lint/typecheck/test/build/migrations/integration. Add the confirmed production migration path.
- `docs/architecture.md` (~line 606): the DB name `nabareview_test` stays; update the reference to "the per-job Postgres from `scripts/ci/postgres.mjs` in ci.yml's Integration job".
- `docs/requirements-matrix.md` (~71, ~118): change "ci.yml `pnpm test:integration`" to "ci.yml job `Integration`".

## 4. File-by-file impact

| File | Change | Depends on |
|---|---|---|
| `scripts/db-migrate.mjs` | Lock, per-file transaction, self-record check, `MIGRATIONS_DIR`, `EXPECT_NOOP`, refuse port 6543 | – |
| `scripts/ci/migration-policy.mjs` (new) | Policy check | – |
| `tests/migration-contract.test.ts` | Filename and gap allowlist test | – |
| `scripts/ci/postgres.mjs` (new) | Cross-platform throwaway Postgres and free ports | – |
| `.github/workflows/ci.yml` | Full rewrite (§3.1) | the scripts above |
| `.github/workflows/nightly.yml`, `codeql.yml`, `.github/dependabot.yml` (new) | §3.1 | ci.yml `workflow_call` |
| `.github/workflows/claude-review.yml` | §3.4 | – |
| `.nvmrc` (new), `tsconfig.json` (exclude list), `package.json` (verify, hooks:install), `.githooks/pre-push` (new) | §3.8 | – |
| `vercel.json` (`ignoreCommand`), `scripts/vercel-ignore-build.mjs` (new) | §3.6 | – |
| `scripts/ci/runner-hooks/{pre,post}-job.sh` (new, reference copies) | §3.3 | – |
| `.github/rulesets/main.json` (new) | §3.9 | – |
| `docs/ci.md` (new), `README.md`, `docs/runbook.md`, `docs/architecture.md`, `docs/requirements-matrix.md` | §3.10 | final job names |

## 5. Risks and unknowns

- **Where production migrations run** (§3.5D). If a `vercel-build` script is added, both a normal and a failing production deploy must be tested before relying on it.
- **Wrapping migrations in transactions** may break a file that manages its own transaction. The from-scratch run in CI catches this before merge.
- **Whether `next build` needs a DB.** Validate in the first run of the build job.
- **gitleaks CLI false positives on history.** Add a `.gitleaks.toml` allowlist if needed, noting the history note in `.gitignore` about `.superpowers/` (a key was committed there once).
- **Fork-approval API endpoint** and **the lapeninns org vs. user account**: check both before relying on them. They affect runner-group options and the gitleaks licence.
- **Lane drift (collation, timing).** Mitigated by running both lanes before `SELF_HOSTED_ENABLED=true`.
- **Rollback:** everything is in the repo except the ruleset, repo settings and the variable. Remove those with `gh api -X DELETE …/rulesets/<id>` and `gh variable delete`.

## 6. Work items

Work happens on branch `ci/redesign` off `origin/main`, created with `git fetch origin && git switch -c ci/redesign origin/main`. Items 1–3 are Conventional Commits on that branch, merged in one PR. Item 4 is post-merge operations.

> **Orchestrator progress log (authoritative over the text above where they differ)**
> - Item 1 DONE on `ci/redesign` (not pushed): commits `326dfb4 fix(db): lock and verify migrations`, `d144b6a ci: add throwaway postgres and migration policy scripts`.
> - Vercel finding: production migrations are **manual** (no buildCommand override, prod logs show plain `next build --webpack`, Production env has no `DIRECT_DATABASE_URL`; Preview does). So: NO `vercel-build` script, keep manual migrations and document them; §3.6 Deployment Checks still recommended.
> - Deviations from the plan: 57 migration files (not 51), including legacy `20260729000400_remove_local_demo_data.sql` on an allowlist; the policy compares 4-digit numbers, not strings; all files had their own `begin;/commit;` → the runner strips the outer wrapper and runs each file in its own transaction; no-transaction list is empty; the advisory lock uses the two-int key space with `DB_MIGRATE_LOCK_TIMEOUT` (default 600s).
> - New helpers: `scripts/migration-rules.mjs`; env vars `MIGRATIONS_DIR`, `DB_MIGRATE_EXPECT_NOOP`, `DB_MIGRATE_LOCK_TIMEOUT`, `NABA_PG_MODE` (native|docker), `NABA_PG_BIN`, `NABA_PG_DIR`. `migration-policy.mjs` writes `MIGRATION_BASE_SHA` to `$GITHUB_ENV`.
> - Notes for Item 2: strip pg_dump 17's random `\restrict`/`\unrestrict` lines in the scratch-vs-forward diff; the Docker readiness check must use TCP (`pg_isready -h 127.0.0.1`).
> - Side issues (report, don't fix): `.env.example` claims Production needs `DIRECT_DATABASE_URL`; a failed prod deploy died on `ENOENT /vercel/path0/.codegraph`.

> - Item 2 DONE: draft PR https://github.com/lapeninns/naba-presence/pull/36, head 885f05b, green run https://github.com/lapeninns/naba-presence/actions/runs/36105562256 (critical path ~6m52s vs old 18–21.5 min).
>   - Graph: Plan → Gate (typecheck + lint) · Gate (unit 1/2, 2/2) · Migrations · Build → Integration (shard 1/2, 2/2) · E2E (shard 1/2, 2/2); Secret scan; Dependency review (PR only); → `CI result` (the only required check).
>   - Timings: Plan 3s, Gate tc+lint 1m10, unit 1m38/1m56, Migrations 33s, Build 1m36, Integration 3m41/4m50, E2E 4m13/5m00.
>   - Proofs: docs-only probe (#37, run 36104885372) skipped the code jobs with `CI result` green; e2e-failure probe (#38, run 36104940656) uploaded traces only from the failing shard. actionlint + zizmor (online) clean.
>   - Extra files: `.github/actions/setup` (composite install), `scripts/ci/pg-client.sh` (PG17 client via docker on Linux), `.github/zizmor.yml`, `.gitleaksignore` (17 historical findings; the `.superpowers` token needs rotation confirmed by the owner).
>   - Nightly: calls ci.yml with `full: true` (full-history gitleaks inside); visual job omitted (needs `.env.local` + local Supabase) → follow-up; `pnpm audit --prod --audit-level high` will be red (2 critical / 17 high) until deps are updated.
>   - Repo setting changed: Dependabot alerts on (enables the dependency graph); 48 alerts on main (4 critical, 21 high). Automated security fixes off.
>   - Test fix commit: `tests/publishing-phases.test.ts` clock-tick tolerance.
>   - Not yet exercised: the push-to-main run, nightly `workflow_call`, the Mac lane.

> - Item 3 DONE: head 76f892e, run https://github.com/lapeninns/naba-presence/actions/runs/36107108093 (green, 6m56s). Commits: `ci: on-demand claude review`, `ci: skip docs-only and dependabot vercel previews`, `chore: verify script and pre-push hook`, `docs: ci guide`. PR #36 is still a draft.
>   - Deferred until after merge: the `@claude review` comment path, the label on a ready PR, the push-to-main run, nightly, and Vercel ignoreCommand on real deploys.
>   - Shared git config `core.hooksPath` still points at the missing `.husky/_`; `pnpm hooks:install` will replace it (owner's choice).

- [x] **Item 1: Harden migrations.** `fix(db): lock and verify migrations` (plus the Vercel check).
  - **Goal:** §3.5A and C, `scripts/ci/postgres.mjs`, `scripts/ci/migration-policy.mjs`, and the Vercel Build Command check (§3.5D) with its result recorded.
  - **Key files:** `scripts/db-migrate.mjs`, `scripts/ci/postgres.mjs`, `scripts/ci/migration-policy.mjs`, `tests/migration-contract.test.ts`.
  - **Dependencies:** none.
  - **Done when:**
    - On a fresh `postgres.mjs` DB, the 51 files apply, a second run with `EXPECT_NOOP=1` exits 0, and two concurrent runs both succeed with no duplicate versions.
    - A deliberately bad migration (no `schema_migration` insert) fails and rolls back.
    - The Vercel Build Command / env-scope finding is written into the PR description.
    - `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, with their output reported.

- [x] **Item 2: Rebuild the CI workflows.** `ci: parallel graph with lanes and aggregator`.
  - **Goal:** §3.1, §3.2, §3.3 (lane plumbing) and §3.7, i.e. the new `ci.yml`, `nightly.yml`, `codeql.yml` and `dependabot.yml`, all SHA-pinned.
  - **Key files:** `.github/workflows/*.yml`, `.github/dependabot.yml`, `.nvmrc`.
  - **Dependencies:** Item 1.
  - **Done when:**
    - `actionlint` (and `zizmor`, if available) is clean.
    - On the PR, with the variable unset (hosted), every job is green and `CI result` appears.
    - A docs-only test commit skips gate/build/etc. and `CI result` is still green.
    - A test failure in e2e uploads traces; a green run uploads none.
    - Measured times are recorded in `docs/ci.md`: target Gate under 3 minutes and a critical path well under the current ~20 minutes.

- [x] **Item 3: Claude review, local workflow and docs.** `ci: on-demand claude review`, `chore: verify script and pre-push hook`, `docs: ci guide`.
  - **Goal:** §3.4, §3.6 (repo part), §3.8 and §3.10.
  - **Key files:** `claude-review.yml`, `package.json`, `.githooks/pre-push`, `tsconfig.json`, `vercel.json`, `scripts/vercel-ignore-build.mjs`, `docs/ci.md`, `README.md`, `docs/runbook.md`, `docs/architecture.md`, `docs/requirements-matrix.md`, `scripts/ci/runner-hooks/*`.
  - **Dependencies:** Item 2, for the final job names.
  - **Done when:**
    - Pushing a commit to the PR does *not* trigger a review.
    - Adding the `claude-review` label triggers one review and the label is removed.
    - An `@claude review` comment from the owner triggers a review; a non-collaborator comment is skipped.
    - `pnpm hooks:install` followed by a push runs `verify`.
    - `pnpm typecheck` no longer scans `.claude/worktrees`.
    - `vercel-cron.test.ts` passes.
    - The PR is merged to `main` and `CI result` is green on the `main` push.

- [ ] **Item 4: Runner, repo settings and ruleset** (post-merge operations).
  - **Goal:** §3.3 runbook executed on the Mac, §3.6 dashboard changes, §3.9 ruleset.
  - **Key files:** `.github/rulesets/main.json`, plus a small `docs/ci.md` follow-up PR if anything changes.
  - **Dependencies:** Item 3 merged, and `CI result` seen on a `main` commit.
  - **Done when:**
    - With `SELF_HOSTED_ENABLED=true`, a same-repo PR runs gate/build/migrations/integration/e2e on `mac-1`/`mac-2` with identical check names.
    - A fork PR (or a simulated fork event through the hook) runs hosted and needs approval.
    - With the Mac stopped and the variable flipped to `false`, a re-run finishes on hosted runners.
    - `gh api repos/lapeninns/naba-presence/rulesets` shows the active ruleset (applied as `lapeninns`), and a PR without `CI result` cannot merge.
    - Deployment Checks is on, or the choice not to enable it is recorded in `docs/ci.md`.