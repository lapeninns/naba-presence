import { assertLocalTestDatabases } from "../../../scripts/test-database.mjs"

process.env.NEXTAUTH_SECRET ??= "route-harness-secret-value-32-characters!"
process.env.TOKEN_ENCRYPTION_KEY ??= "route-harness-token-key-32-characters!!"
process.env.CRON_SECRET ??= "route-harness-cron-secret"
process.env.DATABASE_URL ??= process.env.TEST_RUNTIME_DATABASE_URL ?? ""

// Second layer of scripts/run-test-command.mjs's guard, for anything that
// reaches the seed helpers without going through that wrapper (the visual
// fixture server, a bare `vitest run`). The same check, so every URL the
// harness may connect through, DATABASE_SESSION_URL included, is refused
// when it is remote or the local Supabase dev database.
assertLocalTestDatabases(process.env)
