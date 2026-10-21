# Release receipts

One JSON file per production promotion (the build, migration and
configuration receipts together, as field groups; decision D-38), written by `pnpm release:promote`
(`scripts/release/promote.mjs`, procedure in `docs/ci.md` §7) and committed
afterwards. File name: `<UTC time>-<first 12 of the SHA>.json`.

| Field | Meaning |
|---|---|
| `sha` | The `origin/main` commit deployed, also stamped as `NABA_RELEASE_SHA` |
| `deploymentId`, `url` | The Vercel production deployment |
| `localGate` | The local release gate's receipt (`pnpm verify:release`): file name, sha256 of its bytes, finish time, base (ref, SHA, merge base, source), each step's status, and `copy`, the committed `<receipt>.local.json` holding its exact bytes. Hosted CI is not a gate |
| `migrations` | Every migration version the commit ships, with the file's sha256; the database had none pending |
| `configNames` | Production environment variable names only, never values |
| `productionProbe` | The production origin probed after `vercel promote`: `url`, expected and served SHA, `ok`, `status`, every attempt. `ok: false` means production did not serve the SHA when the release finished (the script exited 3); receipts before 2026-10-22 have no such field |
| `operator`, `timestamp` | `git config user.name` of the operator, and when |

The script refuses to write a receipt containing anything
`lib/domain/redaction.ts` would redact. Never edit a receipt by hand. Commit
each receipt with its `.local.json` copy: the newest receipt's `sha` is the
base the next `verify:release` upgrades from, and the base promotion
requires.

## Local release-gate receipts (`local/`)

`pnpm verify:release` (`scripts/release/verify-local.mjs`, `docs/ci.md` §5)
writes one JSON file per run to `local/` (gitignored, so running the gate
never dirties the checkout promotion needs clean). Fields: `sha`, `mode`
(`worktree`), `base` (ref, SHA, merge base, and `source`: `promotion-receipt`,
`flag` or `default`), `gateSource` (`clean`, and the gate files changed in
the invoking checkout), `toolchain` (Node, pnpm,
PostgreSQL, gitleaks, actionlint, zizmor, Playwright, platform), `options`
(`skip`, `failFast`, `serial`, `integrationShards`), `ok`, and
`steps` (id, title, `required`, `status` of `passed`, `failed`, `skipped` or
`not-run`, duration, test-count `summary`, `note`), plus `startedAt` and
`finishedAt`. Promotion copies the cited file's exact bytes beside its own
receipt as `<promotion receipt>.local.json`, which is committed, so the pinned
sha256 can be checked after `local/` is cleaned.

## Rollback receipts (`*.rollback.json`)

`pnpm release:rollback --yes` (`scripts/release/rollback.mjs`, `docs/ci.md`
§7) writes `<UTC time>-<first 12 of the SHA>.rollback.json` here: `kind`
(`naba-rollback`), `version`, `sha`, `deploymentId` and `url` of the
deployment production serves after the rollback, `to` and `from` (the
receipts rolled back to and from), `migrations` (`databaseRestored` and any
drift between the two releases' migrations), `productionProbe`, `operator`
and `timestamp`. Commit it like a promotion receipt. The gate's default base
still comes from the newest promotion receipt.
