<!-- BEGIN:nextjs-agent-rules -->

# Next.js documentation

Before changing Next.js APIs, routing, rendering, caching, or configuration,
consult the relevant guide in `node_modules/next/dist/docs/`. Read only the
sections needed for the change and heed deprecation notices. If the bundled
guide is unavailable, use official documentation for the project's installed
Next.js version.
<!-- END:nextjs-agent-rules -->

# NabaPresence operating guide

Next.js 16 (App Router) on PostgreSQL 17, deployed on Vercel. Node 24
(`.nvmrc`), pnpm 10 (`packageManager`); install with
`pnpm install --frozen-lockfile`. Reference: `docs/ci.md` (gate, migrations,
deploys), `docs/testing.md` (test layers and rules), `docs/runbook.md`.

## Commands and testing policy

This is the one place for testing policy.

| When                             | Command                                                                                                             | Time       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| While iterating                  | `pnpm check`: typecheck, lint (cached), changed-files format, unit and component tests affected since `origin/main` | ~30 s warm |
| One test file                    | `pnpm exec vitest run tests/foo.test.ts`                                                                            | seconds    |
| Before handoff                   | `pnpm verify`: the gate's quick steps exactly (adds the full unit and component suite, design ratchet, contrast)    | 4–8 min    |
| Server, database or route change | `pnpm build`, then `pnpm test:integration <files>` for the affected files                                           | minutes    |
| Change to what users see         | `pnpm build`, then `pnpm test:e2e <specs>` (`pnpm test:a11y`, `pnpm test:e2e:touch`) for the affected journeys      | minutes    |
| Final head                       | local-ci, once (below)                                                                                              | ~16 min    |

- Run `pnpm verify` and see it pass before starting local-ci. local-ci's
  `quick-verify` is not a separate run: it fails whenever the gate fails, so
  a lint or unit failure found there has cost a whole gate slot.
- Browser suites run only when a change affects what users see. Pure server,
  library, script or docs changes do not need them locally; the gate runs
  everything on the final head.
- Do not run `pnpm verify:release` before a merge: local-ci's `gate` job is
  that command. Run it yourself only for a release receipt (`docs/ci.md` §7)
  or to reproduce a gate failure. It stops at the first failing step;
  `--keep-going` runs every step to show all failures.
- `pnpm format:changed` formats what your branch changed; the format check
  covers changed files only.
- The opt-in pre-push hook (`pnpm hooks:install`) runs `pnpm verify` and a
  gitleaks scan of the pushed commits.

Test-writing rules (no fixed sleeps, forced races with the stub's `hold()`,
own tenants per file, no retries to hide flakes) are in `docs/testing.md`.

## local-ci

- Profile `naba-presence`. Jobs: `gate` (`pnpm verify:release`: install,
  typecheck, lint, unit, format, design, build, bundle budget, migrations,
  integration in 4 shards, e2e, audit, workflow lint, gitleaks), `secret-scan`,
  and the aggregates `quick-verify` and `release-gate`.
- Rebase on the latest `origin/main`, then run once on the final head:
  `lci run naba-presence --pr <N> --post --comment`. Not on intermediate
  pushes. A commit with an already-passing tree reuses its result.
- The runner is shared and holds one global lock; another repository's run
  may hold it for up to ~2 h. Wait in the foreground; never `--force` or
  `--only`.
- Merge only through `lci merge`. No admin merges, `--no-codex`, skipped
  checks or forged statuses. GitHub Actions is disabled; `.github/workflows/`
  is reference for the same gate script.
- One PR per piece of work. Run `gh auth switch --user lapeninns` before any
  push or `gh` write.

## Safety

- Never read or print `.env*`. Tests never touch the dev database: the test
  wrappers start throwaway PostgreSQL 17 clusters (Homebrew `postgresql@17`)
  and refuse port 54322.
- Production migrations, `pnpm release:promote` and `pnpm release:rollback`
  are operator steps (`docs/ci.md` §6–7). Run them only when asked.
- Migrations are append-only and expand-only; the gate checks both
  (`migration-policy`, `migrate-upgrade`).
- Uncommitted edits to the gate's own code (`scripts/release/`,
  `scripts/ci/`, `package.json`, `.nvmrc`) are recorded in its receipt and
  block promotion of that receipt.

## Repo facts

- Bundler: `pnpm dev` runs Turbopack; `pnpm build` runs webpack
  (`--webpack`). Keep `build` on webpack: CI validates that path through
  `scripts/prepare-standalone.mjs` and the standalone server, which the
  integration and e2e suites run against.
- Tailwind: `app/globals.css` disables automatic source detection and
  registers `app/`, `components/` and `lib/`. Register any new source
  location there, and keep saved HTML, test artifacts and archived source out
  of the scan (escaped arbitrary variants produce invalid CSS).
- `docs/archive/2026-07-frontend-rebuild/` is a historical record. Its branch,
  protected-path, workflow, testing and commit instructions are not active
  rules. Attribute commits only to actual contributors.
- The app uses TanStack Query. Dependency-bundled skills and `AGENTS.md`
  files (in `node_modules/`, `.ds-sync/`) describe those dependencies, not
  NabaPresence policy, and do not justify an architecture change. The
  Storybook guide in `.ds-sync/` is staged design-sync material; missing sync
  material does not block application work.
- Environment loading follows Next.js / `@next/env` conventions.
