import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

import { stopFailureReport } from "./ci/pg-stop-report.mjs"
import {
  DISPOSABLE_MARKER,
  DISPOSABLE_SETTING,
  assertLocalTestDatabases,
  chooseTestDatabase,
  disposableDatabaseEnv,
  runtimeUrlFor,
} from "./test-database.mjs"

// Runs an integration or e2e command against a database the harness may
// wipe. The decision and the guard live in scripts/test-database.mjs: by
// default a throwaway PostgreSQL 17 cluster is started for this run
// (scripts/ci/postgres.mjs, its own NABA_PG_DIR), migrated, given the
// runtime role, and stopped when the command exits or the run is
// interrupted. A cluster the caller started with `postgres.mjs start` (the
// local gate, ci.yml) is used as it is; NABA_TEST_DB=existing uses the
// configured URLs after the guard.
//
//   node scripts/run-test-command.mjs <integration|e2e> <command...>

export {
  GUARDED_DATABASE_URL_VARS,
  assertLocalDatabaseUrl,
  assertLocalTestDatabases,
  chooseTestDatabase,
} from "./test-database.mjs"

/** How long a command gets to exit after the signal is passed on. */
const CHILD_STOP_GRACE_MS = 30_000

/**
 * Signals that end the run (and stop its cluster), mapped to the status the
 * wrapper then exits with: 128 + the signal's number, as a shell reports it.
 * SIGHUP comes from a closed terminal or SSH session.
 */
export const SIGNAL_EXIT_CODES = Object.freeze({
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
})

/**
 * `export KEY='value'` lines from `postgres.mjs start`.
 * @param {string} stdout
 */
export function parseExports(stdout) {
  /** @type {Record<string, string>} */
  const vars = {}
  for (const line of stdout.split("\n")) {
    const match = /^export ([A-Z_][A-Z0-9_]*)='([^']*)'$/.exec(line.trim())
    if (match) vars[match[1]] = match[2]
  }
  return vars
}

/** @param {string} message */
function log(message) {
  console.error(`[run-test-command] ${message}`)
}

/**
 * The environment `postgres.mjs start` and `stop`, and the setup scripts
 * between them, run with for this run's cluster.
 * @param {Record<string, string | undefined>} env
 * @param {string} pgDir a directory made for this run alone (mkdtemp)
 */
export function throwawayClusterEnv(env, pgDir) {
  /** @type {Record<string, string | undefined>} */
  const clusterEnv = {
    ...env,
    NABA_PG_DIR: pgDir,
    // postgres.mjs names the docker container from GITHUB_RUN_ID, GITHUB_JOB
    // and SHARD, the same for every local run ("naba-pg-local"). A second
    // run's `docker run --name` would then fail on the name (its cleanup
    // removes only the container ID it created, never the first run's). The
    // directory is unique, so its name replaces any SHARD the caller exported.
    SHARD: basename(pgDir),
  }
  // Print the exports rather than append them to a CI job's environment.
  delete clusterEnv.GITHUB_ENV
  // The runtime URL postgres.mjs exports names its default role; a .env
  // override would create a role nothing connects as.
  delete clusterEnv.RUNTIME_ROLE_NAME
  delete clusterEnv.RUNTIME_ROLE_PASSWORD
  return clusterEnv
}

/**
 * Starts, migrates and prepares a throwaway cluster. Synchronous, so a
 * signal that arrives meanwhile is handled once it returns.
 * @param {string} root
 */
function startThrowawayCluster(root) {
  const pgDir = mkdtempSync(join(tmpdir(), "naba-pg-run-"))
  const clusterEnv = throwawayClusterEnv(process.env, pgDir)
  let running = false
  const stop = () => {
    if (!running) return
    running = false
    const stopped = spawnSync("node", ["scripts/ci/postgres.mjs", "stop"], {
      cwd: root,
      env: clusterEnv,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    })
    const report = stopFailureReport(stopped, {
      pgDir,
      shard: basename(pgDir),
      script: join(root, "scripts/ci/postgres.mjs"),
    })
    if (report) log(report.trimEnd())
  }
  const run = (/** @type {string[]} */ args, extraEnv = {}) => {
    const result = spawnSync("node", args, {
      cwd: root,
      env: { ...clusterEnv, ...extraEnv },
      encoding: "utf8",
    })
    if (result.status !== 0) {
      stop()
      throw new Error(
        `node ${args.join(" ")} exited ${result.status ?? result.signal}\n` +
          `${result.stderr ?? ""}${result.stdout ?? ""}`
      )
    }
    return result.stdout
  }

  const started = Date.now()
  running = true
  const vars = parseExports(run(["scripts/ci/postgres.mjs", "start"]))
  if (!vars.DIRECT_DATABASE_URL || !vars[DISPOSABLE_MARKER]) {
    stop()
    throw new Error("postgres.mjs start exported no cluster URLs")
  }
  const urls = {
    adminUrl: vars.DIRECT_DATABASE_URL,
    runtimeUrl: vars.TEST_RUNTIME_DATABASE_URL,
  }
  const dbEnv = disposableDatabaseEnv(urls)
  run(["scripts/db-migrate.mjs"], dbEnv)
  run(["scripts/db-create-runtime-role.mjs"], dbEnv)
  log(
    `throwaway PostgreSQL on ${vars[DISPOSABLE_MARKER]} migrated in ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s (${pgDir})`
  )
  return {
    env: { ...dbEnv, [DISPOSABLE_MARKER]: vars[DISPOSABLE_MARKER] },
    stop,
  }
}

/**
 * Proves the provided URLs reach a cluster `postgres.mjs start` made, not
 * merely something listening on the marker's port.
 * @param {string} adminUrl
 */
async function assertDisposableCluster(adminUrl) {
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 10, onnotice() {} })
  try {
    const [row] = await sql`
      select current_setting(${DISPOSABLE_SETTING}, true) as value
    `
    if (row?.value !== "on") {
      throw new Error(
        `${DISPOSABLE_MARKER} is set, but the cluster it names lacks ` +
          `${DISPOSABLE_SETTING}; it was not started by scripts/ci/postgres.mjs.`
      )
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const [mode, ...command] = process.argv.slice(2)
  if (!mode || command.length === 0) {
    throw new Error(
      "Usage: run-test-command.mjs <integration|e2e> <command...>"
    )
  }
  if (mode !== "integration" && mode !== "e2e") {
    throw new Error(`Unsupported test mode: ${mode}`)
  }

  /** @type {null | (() => void)} */
  let stopCluster = null
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null
  /** @type {keyof typeof SIGNAL_EXIT_CODES | null} */
  let interrupted = null
  const cleanup = () => {
    stopCluster?.()
    stopCluster = null
  }
  process.on("exit", cleanup)
  for (const signal of /** @type {(keyof typeof SIGNAL_EXIT_CODES)[]} */ (
    Object.keys(SIGNAL_EXIT_CODES)
  )) {
    process.on(signal, () => {
      interrupted ??= signal
      if (!child) {
        cleanup()
        process.exit(SIGNAL_EXIT_CODES[signal])
      }
      // A terminal ^C or hangup may reach the command too; `kill <pid>`
      // reaches only this process, so pass it on and stop the cluster once
      // the command exits.
      child.kill(signal)
      setTimeout(() => child?.kill("SIGKILL"), CHILD_STOP_GRACE_MS).unref()
    })
  }

  // Decided on the caller's own environment, before .env is merged in, so a
  // URL from a .env file can never be mistaken for a throwaway cluster.
  const caller = { ...process.env }
  const choice = chooseTestDatabase(caller)
  nextEnv.loadEnvConfig(root)

  if (choice.mode === "start") {
    if (choice.ignored.length > 0) {
      log(
        `not using ${choice.ignored.join(", ")} from the environment; ` +
          "set NABA_TEST_DB=existing to run against them"
      )
    }
    const cluster = startThrowawayCluster(root)
    stopCluster = cluster.stop
    Object.assign(process.env, cluster.env)
  } else if (choice.mode === "provided") {
    const adminUrl = /** @type {string} */ (caller.DIRECT_DATABASE_URL)
    Object.assign(
      process.env,
      disposableDatabaseEnv({
        adminUrl,
        runtimeUrl:
          caller.TEST_RUNTIME_DATABASE_URL ?? runtimeUrlFor(adminUrl, caller),
      })
    )
    await assertDisposableCluster(adminUrl)
    log(`using the throwaway cluster on ${caller[DISPOSABLE_MARKER]}`)
  } else {
    if (
      !process.env.TEST_RUNTIME_DATABASE_URL &&
      process.env.DIRECT_DATABASE_URL
    ) {
      process.env.TEST_RUNTIME_DATABASE_URL = runtimeUrlFor(
        process.env.DIRECT_DATABASE_URL
      )
    }
    if (!process.env.TEST_RUNTIME_DATABASE_URL) {
      throw new Error(
        "NABA_TEST_DB=existing needs TEST_RUNTIME_DATABASE_URL or DIRECT_DATABASE_URL."
      )
    }
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL
    log("NABA_TEST_DB=existing: using the configured database URLs")
  }

  assertLocalTestDatabases(process.env)

  process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL
  process.env.TOKEN_ENCRYPTION_KEY ??= "route-harness-token-key-32-characters!!"
  process.env.WEBHOOKS_ENABLED = "false"
  process.env.PASSWORD_AUTH_ENABLED = "false"
  if (mode === "integration") process.env.RUN_DB_TESTS = "true"
  else process.env.LOCAL_BOOTSTRAP_ENABLED = "true"

  child = spawn(command[0], command.slice(1), {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  })
  child.on("error", (error) => {
    log(`${command[0]}: ${error.message}`)
    cleanup()
    process.exit(127)
  })
  child.on("exit", (code, signal) => {
    cleanup()
    if (interrupted) process.exit(SIGNAL_EXIT_CODES[interrupted])
    process.exit(code ?? (signal ? 128 : 1))
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
