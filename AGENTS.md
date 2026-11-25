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
| One test file                    | `pnpm exec vitest run tests/env-flags.test.ts`                                                                      | seconds    |
| Before handoff                   | `pnpm verify`: the gate's quick steps exactly (adds the full unit and component suite, design ratchet, contrast)    | 4–8 min    |
| Server, database or route change | `pnpm build`, then `pnpm test:integration <files>` for the affected files                                           | minutes    |
| Change to what users see         | `pnpm build`, then `pnpm test:e2e <specs>` (`pnpm test:a11y`, `pnpm test:e2e:touch`) for the affected journeys      | minutes    |
| Final head                       | local-ci, once (below)                                                                                              | ~10 min    |

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
- `pnpm check:quality` runs the same source-quality ratchets as the release
  gate. Use camelCase for functions, PascalCase for components and types,
  and attach `TODO(#123)` or `FIXME(#123)` to an open GitHub issue.
- When a route's path, HTTP method or wrapper contract changes, regenerate
  the [OpenAPI inventory](docs/openapi.json) with `pnpm docs:openapi`.
  `pnpm check:agents` verifies this guide's commands and local references.
- The opt-in pre-push hook (`pnpm hooks:install`) scans the exact pushed refs
  for secrets. Set `NABA_PRE_PUSH_VERIFY=1` to also run `pnpm verify` on code pushes.

Test-writing rules (no fixed sleeps, forced races with the stub's `hold()`,
own tenants per file, no retries to hide flakes) are in `docs/testing.md`.

## local-ci

- Profile `naba-presence`. Jobs: `gate` (`pnpm verify:release`: install,
  typecheck, lint, unit, format, design, build, bundle budget, migrations,
  integration in 4 shards, e2e in 6 lanes, audit, workflow lint, gitleaks), `secret-scan`,
  and the aggregates `quick-verify` and `release-gate`.
- A pull request that changes only documentation nothing reads (`docs/**`
  and `*.md`, not `AGENTS.md`, `docs/release/` or the docs tests read) takes
  the gate's docs-only fast path: install, format, secret scan and workflow
  lint, marked "docs-only fast path" and never a release receipt
  (`docs/ci.md` §5).
- naba-presence is not on the release train. One PR per piece of work, then:
  `pnpm verify` passes; rebase on the latest `origin/main`; run local-ci once
  on the final head with
  `lci run naba-presence --pr <N> --post --comment --wait` (`--wait` queues
  for the shared runner; not on intermediate pushes; a commit with an
  already-passing tree reuses its result); then merge with `lci merge`
  (profile `naba-presence`, `--pr <N>`). Use `--force` only when prior proof
  has become invalid. Never qualify using `--only`.
- No human review or approval is required (solo developer, owner decision
  2026-11-25). The Codex review that `lci merge` enforces is the reviewer.
  `lci merge` is the only merge path: no admin merges, `--no-codex`, skipped
  checks or forged statuses. It posts `local-ci/merge-admission`.
- Merging does not deploy production here (`docs/ci.md` §7). GitHub Actions
  is disabled; `.github/workflows/ci.yml` ("Candidate verification") is a
  dormant recovery job, and no `CI result` check exists. Keep forks and
  Dependabot branches off this Mac.
- Run `gh auth switch --user lapeninns` before any push or `gh` write. One
  agent session per PR at a time.

## Releases and production (solo-developer policy, 2026-11-25)

Full procedure: `docs/ci.md` §6–7 and `docs/runbook.md` "Deployment gate".

- **Migrations go to production before the code that needs them.** An agent
  may apply an expand-only migration itself: plan with `pnpm db:status`, put
  the plan (files, what each adds, why it is expand-only) in the PR, wait for
  `local-ci/release-gate` to pass on the PR head, then run `pnpm db:migrate`
  and `pnpm db:status --expect-current` against production and add the
  `migrations-applied` label. For this repo `lci merge`'s migration check is
  label-only: it refuses a PR with new `supabase/migrations` files without
  that label, and cannot read production itself, so add it only after
  `db:status --expect-current` passed. A file with `-- migrate:contract`,
  any destructive or data-rewriting change, or a restore waits for the owner.
- Agents run `pnpm release:promote` and `pnpm release:rollback` when the
  owner asks for a release (or a failed release needs rolling back). There
  are no release windows for this repo and no multi-signature sign-off.
- Credentials come from the macOS keychain inside the command, never
  printed, echoed, logged or written to a file: items
  `naba-presence-prod-db-url` (`DIRECT_DATABASE_URL`) and
  `naba-presence-readiness-token` (`READINESS_PROBE_TOKEN`). The exact
  command forms are in `docs/ci.md` §6. If an item is missing, stop and ask
  the owner; never fall back to `.env*`.
- Quiet hours: no production migration or promotion 22:30–08:00 London
  unless the owner starts it. A `hotfix` label means release as soon as the
  checks pass; quiet hours still apply.
- Staging first only for database changes, payments, sign-in/auth and
  email/SMS sending; other changes go local-ci, merge, promotion.
- After every promotion: confirm production serves the SHA, run the smoke
  (`docs/ci.md` §7), watch error logs for about 10 minutes, and on failure
  roll back at once and report.

## Safety

- Never read or print `.env*`. Tests never touch the dev database: the test
  wrappers start throwaway PostgreSQL 17 clusters (Homebrew `postgresql@17`)
  and refuse port 54322.
- Production migrations, `pnpm release:promote` and `pnpm release:rollback`
  follow "Releases and production" above: expand-only migrations when a PR
  needs them, promotion and rollback when the owner asks for a release.
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
