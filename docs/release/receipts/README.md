# Release receipts

One JSON file per production promotion (the build, migration and
configuration receipts together, as field groups; decision D-38), written by `pnpm release:promote`
(`scripts/release/promote.mjs`, procedure in `docs/ci.md` §7) and committed
through a docs-only PR. File name: `<UTC time>-<first 12 of the SHA>.json`.

| Field | Meaning |
|---|---|
| `sha` | The `origin/main` commit deployed, also stamped as `NABA_RELEASE_SHA` |
| `deploymentId`, `url` | The Vercel production deployment |
| `ciRunUrl` or `exceptionRef` | The successful `CI result` run, or the recorded local-evidence exception used instead |
| `checks` | State of `CI result` and both CodeQL analyses at promotion |
| `migrations` | Every migration version the commit ships, with the file's sha256; the database had none pending |
| `configNames` | Production environment variable names only, never values |
| `operator`, `timestamp` | GitHub login of the operator, and when |

The script refuses to write a receipt containing anything
`lib/domain/redaction.ts` would redact. Never edit a receipt by hand.
