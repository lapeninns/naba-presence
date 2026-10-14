#!/usr/bin/env node
// Run the integration or e2e suite split across N shards on this machine,
// each against its own throwaway PostgreSQL cluster (scripts/ci/postgres.mjs).
//
//   node scripts/ci/sharded.mjs <integration|e2e> [--shards N] [-- args...]
//
// N comes from --shards, then NABA_TEST_SHARDS, then a quarter of the CPU
// count capped at 4. N=1 runs exactly what `pnpm test:integration` /
// `pnpm test:e2e` run today, against whatever database the environment
// names, with no cluster of its own.
//
// For N > 1, shard i of N gets, in parallel:
//   - a cluster in its own NABA_PG_DIR with SHARD set, migrated
//     (db:migrate, db:runtime-role), whose URLs replace every database URL
//     the harness reads (run-test-command.mjs GUARDED_DATABASE_URL_VARS);
//   - integration: `vitest run tests/integration --shard=i/N` (its app
//     servers and stubs already bind free ports);
//   - e2e: `playwright test --shard=i/N` on its own PLAYWRIGHT_PORT (+1 for
//     the Google stub) and its own PLAYWRIGHT_OUTPUT_DIR, which also holds
//     the journey state file (tests/e2e/helpers/stub-bridge.ts).
// Output is prefixed per shard and copied to shard-i.log in the run
// directory. The exit code is 0 only when every shard exits 0, and the
// totals are printed unprefixed in vitest's / Playwright's own formats, so
// verify-local.mjs `summarizeOutput` reads them like an unsharded run.
//
// Every cluster and child process group this runner starts is stopped on
// exit, failure or SIGINT/SIGTERM/SIGHUP. Nothing it did not start is
// touched.

import { spawn, spawnSync } from "node:child_process"
import { createWriteStream, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MAX_DEFAULT_SHARDS = 4
/** E2E ports are even numbers in [20000, 30000), below any ephemeral range. */
const E2E_PORT_MIN = 20_000

/**
 * @param {{ flag?: string | null, env?: string, cpus?: number }} input
 */
export function shardCount({ flag, env, cpus = availableParallelism() }) {
  const raw = flag ?? env
  if (raw !== undefined && raw !== null && raw !== "") {
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1 || value > 32) {
      throw new Error(
        `shard count must be an integer from 1 to 32, got "${raw}"`
      )
    }
    return value
  }
  return Math.max(1, Math.min(MAX_DEFAULT_SHARDS, Math.floor(cpus / 4)))
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (mode !== "integration" && mode !== "e2e") {
    throw new Error(
      "usage: sharded.mjs <integration|e2e> [--shards N] [-- args...]"
    )
  }
  let shards = /** @type {string | null} */ (null)
  /** @type {string[]} */
  const extra = []
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === "--") {
      extra.push(...rest.slice(index + 1))
      break
    }
    if (arg === "--shards") shards = rest[++index] ?? ""
    else if (arg.startsWith("--shards=")) shards = arg.slice(9)
    // Anything else is the test runner's, e.g. --forbid-only.
    else extra.push(arg)
  }
  return { mode, shards, extra }
}

/** The command the package.json script runs today, plus the shard flag. */
export function testCommand(mode, extra, shard) {
  const shardArgs = shard ? [`--shard=${shard.index}/${shard.total}`] : []
  return mode === "integration"
    ? [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "tests/integration",
        ...shardArgs,
        ...extra,
      ]
    : ["pnpm", "exec", "playwright", "test", ...shardArgs, ...extra]
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g

/**
 * Counts from a vitest run's `Test Files` / `Tests` lines (last wins).
 * @param {string} output
 */
export function vitestCounts(output) {
  /** @type {Record<string, Record<string, number>>} */
  const found = {}
  for (const raw of output.replace(ANSI_PATTERN, "").split(/\r?\n/)) {
    const match = /^(Test Files|Tests)\s{2,}(.+)$/.exec(raw.trim())
    if (!match) continue
    /** @type {Record<string, number>} */
    const counts = {}
    const body = match[2].replace(/\(\d+\)\s*$/, "")
    for (const part of body.matchAll(/(\d+) ([a-z]+)/g)) {
      counts[part[2]] = Number(part[1])
    }
    found[match[1]] = counts
  }
  return found
}

/**
 * Counts from Playwright's list/github reporter summary lines.
 * @param {string} output
 */
export function playwrightCounts(output) {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const raw of output.replace(ANSI_PATTERN, "").split(/\r?\n/)) {
    const match =
      /^(\d+) (passed|failed|skipped|flaky|interrupted|did not run)\b/.exec(
        raw.trim()
      )
    if (match) counts[match[2]] = Number(match[1])
  }
  return counts
}

const VITEST_ORDER = ["failed", "passed", "skipped", "todo"]
const PLAYWRIGHT_ORDER = [
  "failed",
  "flaky",
  "interrupted",
  "skipped",
  "did not run",
  "passed",
]

/**
 * Summed vitest totals, formatted as vitest prints them.
 * @param {Record<string, Record<string, number>>[]} shards
 */
export function vitestTotals(shards) {
  const lines = []
  for (const kind of ["Test Files", "Tests"]) {
    /** @type {Record<string, number>} */
    const sum = {}
    for (const shard of shards) {
      for (const [key, value] of Object.entries(shard[kind] ?? {})) {
        sum[key] = (sum[key] ?? 0) + value
      }
    }
    const keys = [
      ...VITEST_ORDER.filter((key) => sum[key]),
      ...Object.keys(sum).filter(
        (key) => !VITEST_ORDER.includes(key) && sum[key]
      ),
    ]
    if (keys.length === 0) continue
    const total = Object.values(sum).reduce((a, b) => a + b, 0)
    lines.push(
      `${kind.padEnd(10)}  ${keys.map((key) => `${sum[key]} ${key}`).join(" | ")} (${total})`
    )
  }
  return lines
}

/**
 * Summed Playwright totals, one line per kind like its list reporter, with
 * the wall time on the `passed` line.
 * @param {Record<string, number>[]} shards
 * @param {string} wall
 */
export function playwrightTotals(shards, wall) {
  /** @type {Record<string, number>} */
  const sum = {}
  for (const shard of shards) {
    for (const [key, value] of Object.entries(shard)) {
      sum[key] = (sum[key] ?? 0) + value
    }
  }
  return PLAYWRIGHT_ORDER.filter((key) => sum[key]).map((key) =>
    key === "passed" ? `${sum[key]} passed (${wall})` : `${sum[key]} ${key}`
  )
}

/** `export KEY='value'` lines from `postgres.mjs start` / `ports`. */
function parseExports(stdout) {
  /** @type {Record<string, string>} */
  const vars = {}
  for (const line of stdout.split("\n")) {
    const match = /^export ([A-Z_][A-Z0-9_]*)='([^']*)'$/.exec(line.trim())
    if (match) vars[match[1]] = match[2]
  }
  return vars
}

function isFree(port) {
  return new Promise((done) => {
    const server = createServer()
    server.unref()
    server.once("error", () => done(false))
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)))
  })
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`
    : `${seconds}s`
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

async function main() {
  const { mode, shards: flag, extra } = parseArgs(process.argv.slice(2))
  const total = shardCount({ flag, env: process.env.NABA_TEST_SHARDS })
  const runTests = (env, shard, stdio) =>
    spawn(
      "node",
      [
        "scripts/run-test-command.mjs",
        mode,
        ...testCommand(mode, extra, shard),
      ],
      { cwd: root, env, stdio, detached: stdio !== "inherit" }
    )

  if (total === 1) {
    // Today's behaviour, unchanged: the environment's database, inherited
    // output, the child's exit code.
    const child = runTests(process.env, null, "inherit")
    return new Promise((done) => {
      child.on("error", () => done(127))
      child.on("exit", (code, signal) => done(code ?? (signal ? 128 : 1)))
    })
  }

  const runDir = mkdtempSync(join(tmpdir(), `naba-shards-${mode}-`))
  const label = (index) => `[${mode} ${index}/${total}]`
  /** @type {Set<import("node:child_process").ChildProcess>} */
  const children = new Set()
  /** @type {{ index: number, pgDir: string, shardId: string, started: boolean }[]} */
  const clusters = []
  let cleaned = false

  // Env every child shares. NABA_TEST_SHARDS is dropped so a nested run
  // stays unsharded; GOOGLE_STUB_PORT so no shard inherits a fixed stub.
  const baseEnv = { ...process.env }
  delete baseEnv.NABA_TEST_SHARDS
  delete baseEnv.GOOGLE_STUB_PORT
  delete baseEnv.PLAYWRIGHT_GOOGLE_STUB_PORT

  const stopCluster = (cluster) => {
    if (!cluster.started) return
    spawnSync("node", ["scripts/ci/postgres.mjs", "stop"], {
      cwd: root,
      env: { ...baseEnv, NABA_PG_DIR: cluster.pgDir, SHARD: cluster.shardId },
      stdio: "ignore",
    })
    cluster.started = false
  }

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const child of children) {
      // Detached: the negative pid is the shard's whole process group
      // (pnpm, vitest/playwright, app servers, browsers).
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (children.size > 0) {
      spawnSync("sleep", ["2"])
      for (const child of children) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {
          /* already gone */
        }
      }
    }
    for (const cluster of clusters) stopCluster(cluster)
    rmSync(join(runDir, "pg"), { recursive: true, force: true })
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      console.error(`\nsharded.mjs: ${signal}, stopping shards`)
      cleanup()
      process.exit(130)
    })
  }
  process.once("exit", cleanup)

  /** Runs a command for a shard, prefixing and logging its output. */
  function run(index, log, command, args, env, { quiet = false } = {}) {
    return new Promise((done) => {
      const child = spawn(command, args, {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      })
      children.add(child)
      let output = ""
      const prefix = `${label(index)} `
      for (const stream of [child.stdout, child.stderr]) {
        let pending = ""
        stream.on("data", (chunk) => {
          const text = chunk.toString()
          output += text
          log.write(text)
          if (quiet) return
          pending += text
          const lines = pending.split("\n")
          pending = lines.pop() ?? ""
          for (const line of lines) process.stdout.write(`${prefix}${line}\n`)
        })
        stream.on("end", () => {
          if (pending && !quiet) process.stdout.write(`${prefix}${pending}\n`)
        })
      }
      child.on("error", (error) => {
        children.delete(child)
        done({ code: 127, output: `${output}${command}: ${error.message}\n` })
      })
      child.on("close", (code, signal) => {
        children.delete(child)
        done({ code: code ?? (signal ? 128 : 1), output })
      })
    })
  }

  // Each e2e shard needs a free app port and the stub port above it. They
  // are drawn from below the OS ephemeral range (49152+ on macOS, 32768+ on
  // Linux), so no cluster, app server or outbound socket started meanwhile
  // can take them, and chosen just before the shard's tests start. The
  // reserved set stops two shards choosing the same pair.
  const reserved = new Set()
  async function choosePort(index) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const port = E2E_PORT_MIN + 2 * Math.floor(Math.random() * 5000)
      if (reserved.has(port)) continue
      reserved.add(port)
      reserved.add(port + 1)
      if ((await isFree(port)) && (await isFree(port + 1))) return port
      reserved.delete(port)
      reserved.delete(port + 1)
    }
    throw new Error(`${label(index)} could not choose an e2e port`)
  }

  const shardPlans = []
  for (let index = 1; index <= total; index += 1) {
    const pgDir = join(runDir, "pg", `shard-${index}`)
    const shardId = `shards-${process.pid}-${index}`
    clusters.push({ index, pgDir, shardId, started: false })
    shardPlans.push({ index, pgDir, shardId })
  }

  console.log(
    `sharded.mjs: ${mode} across ${total} shards, each with its own PostgreSQL cluster. Logs: ${runDir}`
  )
  const started = performance.now()

  const results = await Promise.all(
    shardPlans.map(async (plan) => {
      const shardStarted = performance.now()
      const log = createWriteStream(join(runDir, `shard-${plan.index}.log`))
      const cluster = clusters[plan.index - 1]
      const finish = async (result, phase) => {
        await new Promise((done) => log.end(done))
        return {
          index: plan.index,
          phase,
          code: result.code,
          output: result.output,
          durationMs: performance.now() - shardStarted,
        }
      }
      const pgEnv = {
        ...baseEnv,
        NABA_PG_DIR: plan.pgDir,
        SHARD: plan.shardId,
        GITHUB_ENV: "",
      }
      cluster.started = true
      const pg = await run(
        plan.index,
        log,
        "node",
        ["scripts/ci/postgres.mjs", "start"],
        pgEnv,
        { quiet: true }
      )
      const db = parseExports(pg.output)
      if (pg.code !== 0 || !db.DIRECT_DATABASE_URL) {
        process.stdout.write(pg.output.replace(/^/gm, `${label(plan.index)} `))
        return finish({ code: pg.code || 1, output: pg.output }, "postgres")
      }
      // Every URL the harness or the app reads points at this shard's
      // cluster, whatever a local .env sets (@next/env never overrides).
      const shardEnv = {
        ...pgEnv,
        DIRECT_DATABASE_URL: db.DIRECT_DATABASE_URL,
        DATABASE_URL: db.TEST_RUNTIME_DATABASE_URL,
        TEST_RUNTIME_DATABASE_URL: db.TEST_RUNTIME_DATABASE_URL,
        DATABASE_SESSION_URL: db.TEST_RUNTIME_DATABASE_URL,
      }
      for (const script of ["db:migrate", "db:runtime-role"]) {
        const step = await run(plan.index, log, "pnpm", [script], shardEnv, {
          quiet: true,
        })
        if (step.code !== 0) {
          process.stdout.write(
            step.output.replace(/^/gm, `${label(plan.index)} `)
          )
          return finish(step, script)
        }
      }
      if (mode === "e2e") {
        let port
        try {
          port = await choosePort(plan.index)
        } catch (error) {
          return finish({ code: 1, output: `${error.message}\n` }, "ports")
        }
        shardEnv.PLAYWRIGHT_PORT = String(port)
        shardEnv.PLAYWRIGHT_OUTPUT_DIR = join(
          "test-results",
          `shard-${plan.index}`
        )
      }
      const args = [
        "scripts/run-test-command.mjs",
        mode,
        ...testCommand(mode, extra, { index: plan.index, total }),
      ]
      const tests = await run(plan.index, log, "node", args, shardEnv)
      return finish(tests, "tests")
    })
  )
  const wallMs = performance.now() - started

  cleanup()

  console.log(`\nsharded.mjs: ${mode} shards`)
  for (const result of results) {
    const counts =
      mode === "integration"
        ? (vitestTotals([vitestCounts(result.output)]).at(-1) ?? "no counts")
        : playwrightTotals([playwrightCounts(result.output)], "-").join(", ") ||
          "no counts"
    console.log(
      `  ${label(result.index)} exit ${result.code}${result.phase === "tests" ? "" : ` in ${result.phase}`} after ${formatDuration(result.durationMs)}: ${counts.trim()}`
    )
  }
  console.log(`  wall ${formatDuration(wallMs)}; logs in ${runDir}\n`)
  const totals =
    mode === "integration"
      ? vitestTotals(results.map((result) => vitestCounts(result.output)))
      : playwrightTotals(
          results.map((result) => playwrightCounts(result.output)),
          formatDuration(wallMs)
        )
  for (const line of totals) console.log(` ${line}`)

  const failed = results.filter((result) => result.code !== 0)
  if (failed.length > 0) {
    console.error(
      `\nsharded.mjs: ${failed.length} of ${total} shard(s) failed: ${failed.map((result) => result.index).join(", ")}`
    )
    return failed[0].code || 1
  }
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`sharded.mjs: ${error?.message ?? error}`)
      process.exit(1)
    }
  )
}
