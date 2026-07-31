process.env.NEXTAUTH_SECRET ??= "route-harness-secret-value-32-characters!"
process.env.TOKEN_ENCRYPTION_KEY ??= "route-harness-token-key-32-characters!!"
process.env.CRON_SECRET ??= "route-harness-cron-secret"
process.env.DATABASE_URL ??= process.env.TEST_RUNTIME_DATABASE_URL ?? ""

// Second layer of the non-local guard in scripts/run-test-command.mjs, for
// anything that reaches the seed helpers without going through that wrapper.
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

function assertLocalDatabaseUrl(name: string) {
  const value = process.env[name]
  if (!value) return
  let hostname: string
  try {
    hostname = new URL(value).hostname.replace(/^\[|\]$/g, "")
  } catch {
    throw new Error(`${name} is not a parseable URL.`)
  }
  if (LOCAL_DB_HOSTS.has(hostname) || hostname.endsWith(".localhost")) return
  if (process.env.ALLOW_REMOTE_TEST_DB === "1") return
  throw new Error(
    `${name} points at non-local host "${hostname}". The test harness ` +
      "writes and deletes data in this database. Point it at a local " +
      "database, or set ALLOW_REMOTE_TEST_DB=1 to override deliberately."
  )
}

assertLocalDatabaseUrl("DATABASE_URL")
assertLocalDatabaseUrl("TEST_RUNTIME_DATABASE_URL")
assertLocalDatabaseUrl("DIRECT_DATABASE_URL")
