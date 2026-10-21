// Which database the integration and e2e harnesses may write to, and the
// guard every harness entry point shares (scripts/run-test-command.mjs,
// tests/integration/helpers/env-defaults.ts, scripts/cleanup-harness-data.mjs,
// tests/visual/nm-serve.mjs). No dependencies, so the TypeScript helpers can
// import it as well as the scripts.
//
// The harness seeds and deletes tenants, unpauses operator pauses and expires
// fleet leases in whichever database these URLs reach. So by default it never
// uses a database it was handed: it starts a throwaway cluster
// (scripts/ci/postgres.mjs) and stops it afterwards. The exceptions:
//
//   provided   a cluster from `postgres.mjs start`, which exports
//              NABA_PG_DISPOSABLE=<host:port> beside the URLs (the local gate
//              and ci.yml run the suites this way). Every URL must reach that
//              host and port, and the cluster must carry the
//              naba.disposable_cluster setting postgres.mjs writes.
//   existing   NABA_TEST_DB=existing: the URLs as given, after the guard.
//
// The guard refuses non-local hosts (ALLOW_REMOTE_TEST_DB=1 overrides) and
// the local Supabase database port 54322, where the owner's dev tenant lives
// (NABA_ALLOW_DEV_DB=1 overrides, for a deliberately separate database on
// that cluster such as tests/visual/with-visual-db.sh's naba_visual).

/**
 * Every variable a harness process may connect through. DATABASE_SESSION_URL
 * carries the lease and session-pool connections (lib/server/db.ts), so it
 * is checked alongside the runtime and admin URLs.
 */
export const GUARDED_DATABASE_URL_VARS = [
  "TEST_RUNTIME_DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "DATABASE_SESSION_URL",
  "DATABASE_URL",
]

/** `supabase start`'s database port: the owner's dev data lives there. */
export const SUPABASE_DEV_DB_PORT = 54322

/** Exported by `postgres.mjs start`: the host:port of the cluster it made. */
export const DISPOSABLE_MARKER = "NABA_PG_DISPOSABLE"

/** The cluster-level setting `postgres.mjs start` writes into its config. */
export const DISPOSABLE_SETTING = "naba.disposable_cluster"

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

/** @param {string} name @param {string} value */
function parse(name, value) {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${name} is not a parseable URL.`)
  }
}

/** @param {URL} url */
function hostOf(url) {
  return url.hostname.replace(/^\[|\]$/g, "")
}

/** @param {URL} url */
function portOf(url) {
  return Number(url.port || 5432)
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function assertLocalDatabaseUrl(name, env = process.env) {
  const value = env[name]
  if (!value) return
  const url = parse(name, value)
  const hostname = hostOf(url)
  const local = LOCAL_DB_HOSTS.has(hostname) || hostname.endsWith(".localhost")
  if (!local && env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `${name} points at non-local host "${hostname}". The test harness ` +
        "writes and deletes data in this database. Point it at a local " +
        "database, or set ALLOW_REMOTE_TEST_DB=1 to override deliberately."
    )
  }
  if (
    local &&
    portOf(url) === SUPABASE_DEV_DB_PORT &&
    env.NABA_ALLOW_DEV_DB !== "1"
  ) {
    throw new Error(
      `${name} points at port ${SUPABASE_DEV_DB_PORT}, the local Supabase ` +
        "database that holds the dev tenant. The test harness writes and " +
        "deletes data there. Leave the URLs unset to get a throwaway " +
        "cluster, or set NABA_ALLOW_DEV_DB=1 for a deliberately separate " +
        "database on that cluster."
    )
  }
}

/** @param {Record<string, string | undefined>} [env] */
export function assertLocalTestDatabases(env = process.env) {
  for (const name of GUARDED_DATABASE_URL_VARS) {
    assertLocalDatabaseUrl(name, env)
  }
}

/**
 * Whether every URL that is set reaches the cluster the marker names. The
 * admin URL must be set; the others may be unset (the harness derives them).
 * @param {Record<string, string | undefined>} env
 */
export function urlsMatchDisposableMarker(env) {
  const marker = env[DISPOSABLE_MARKER]
  if (!marker || !env.DIRECT_DATABASE_URL) return false
  return GUARDED_DATABASE_URL_VARS.every((name) => {
    const value = env[name]
    if (!value) return true
    let url
    try {
      url = new URL(value)
    } catch {
      return false
    }
    return `${hostOf(url)}:${portOf(url)}` === marker
  })
}

/**
 * @typedef {{ mode: "start", ignored: string[] }
 *   | { mode: "provided" }
 *   | { mode: "existing" }} TestDatabaseChoice
 */

/**
 * Decides from the caller's own environment (before any .env file is
 * merged in) where the harness runs.
 * @param {Record<string, string | undefined>} env
 * @returns {TestDatabaseChoice}
 */
export function chooseTestDatabase(env) {
  const requested = env.NABA_TEST_DB
  if (requested === "existing") return { mode: "existing" }
  if (requested && requested !== "throwaway") {
    throw new Error(
      `NABA_TEST_DB must be "existing" or "throwaway" (the default), got "${requested}".`
    )
  }
  if (urlsMatchDisposableMarker(env)) return { mode: "provided" }
  return {
    mode: "start",
    ignored: GUARDED_DATABASE_URL_VARS.filter((name) => Boolean(env[name])),
  }
}

/**
 * The connection variables for a throwaway cluster, so nothing a .env file
 * names (a session-pooler URL on the dev database, say) is left pointing
 * elsewhere. The session URL is the runtime URL: locally both are direct.
 * @param {{ adminUrl: string, runtimeUrl: string }} urls
 */
export function disposableDatabaseEnv({ adminUrl, runtimeUrl }) {
  return {
    DIRECT_DATABASE_URL: adminUrl,
    TEST_RUNTIME_DATABASE_URL: runtimeUrl,
    DATABASE_URL: runtimeUrl,
    DATABASE_SESSION_URL: runtimeUrl,
  }
}

/**
 * The runtime-role URL on the admin URL's cluster, as db:runtime-role
 * creates it.
 * @param {string} adminUrl
 * @param {Record<string, string | undefined>} [env]
 */
export function runtimeUrlFor(adminUrl, env = process.env) {
  const url = new URL(adminUrl)
  url.username = env.RUNTIME_ROLE_NAME ?? "naba_test_runtime"
  url.password = env.RUNTIME_ROLE_PASSWORD ?? "naba_test_runtime"
  return url.toString()
}
