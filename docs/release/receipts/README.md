# Release receipts

One JSON file per production promotion (the build, migration and
configuration receipts together, as field groups; decision D-38), written by `pnpm release:promote`
(`scripts/release/promote.mjs`, procedure in `docs/ci.md` §7) and committed
afterwards. File name: `<UTC time>-<first 12 of the SHA>.json`.

| Field | Meaning |
|---|---|
| `sha` | The `origin/main` commit deployed, also stamped as `NABA_RELEASE_SHA` |
| `deploymentId`, `url` | The Vercel production deployment |
| `localGate` | The local release gate's receipt (`pnpm verify:release`): file name, sha256 of its bytes, finish time and each step's status. Hosted CI is not a gate |
| `migrations` | Every migration version the commit ships, with the file's sha256; the database had none pending |
| `configNames` | Production environment variable names only, never values |
| `operator`, `timestamp` | `git config user.name` of the operator, and when |

The script refuses to write a receipt containing anything
`lib/domain/redaction.ts` would redact. Never edit a receipt by hand.

## Local release-gate receipts (`local/`)

`pnpm verify:release` (`scripts/release/verify-local.mjs`, `docs/ci.md` §5)
writes one JSON file per run to `local/` (gitignored, so running the gate
never dirties the checkout promotion needs clean). Fields: `sha`, `mode`
(`worktree`), `base` (ref, SHA, merge base), `toolchain` (Node, pnpm,
PostgreSQL, gitleaks, platform), `options` (`skip`, `failFast`), `ok`, and
`steps` (id, title, `required`, `status` of `passed`, `failed`, `skipped` or
`not-run`, duration, test-count `summary`, `note`), plus `startedAt` and
`finishedAt`. The promotion receipt pins the local receipt by sha256; keep
the file alongside any promotion that cites it.
