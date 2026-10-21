#!/usr/bin/env node
// Local release gate: the whole CI graph, run on this machine.
//
//   pnpm verify:release [--skip <id,...>] [--fail-fast] [--base-ref <ref>]
//                       [--receipts-dir <dir>] [--keep-worktree] [--list]
//                       [--serial] [--integration-shards <n>] [--cpus <n>]
//
// Hosted CI is not a release gate (docs/ci.md §5); this run is the evidence.
// It checks HEAD out into a fresh detached git worktree under the OS temp
// directory, so no .env file, untracked file or local build output takes
// part, then runs every step of local-receipt.mjs GATE_STEPS:
//
//   frozen install, typecheck, lint, unit and component tests, formatting
//   of the files the change touches, the design ratchet, build, first-load JS ceilings, migration policy against the
//   base, migrate from scratch + no-op + runtime role + db:status, upgrade
//   from the merge base (schema diff), concurrent migrate, integration, e2e
//   (port 3100 when free), actionlint and zizmor over .github/ (optional:
//   skipped with a note where they are not installed), pnpm audit --prod
//   --audit-level high, and
//   gitleaks over HEAD's full history (required: without gitleaks installed
//   the step is skipped with a note and the gate fails). The integration and
//   e2e steps pass only when their output shows tests ran
//   (local-receipt.mjs `testCountProblem`).
//
// Each step starts as soon as the steps it `needs` have passed, so the
// static checks run side by side and, once the build is done, the
// integration shards and e2e run at the same time. Every step that needs a
// database gets its own throwaway PostgreSQL 17 cluster
// (scripts/ci/postgres.mjs), stopped afterwards. Integration is split into
// --integration-shards (default 4, or NABA_GATE_INTEGRATION_SHARDS) vitest
// shards, each on its own cluster; their counts are added up for the
// receipt. The CPU-heavy steps (build, e2e, integration, unit, typecheck,
// lint) share a budget of three quarters of the cores (--cpus or
// NABA_GATE_CPUS), served in that order, so the machine is not
// oversubscribed. --serial runs one step at a time, in receipt order, for a
// busy or small machine.
//
// It writes a receipt (scripts/release/local-receipt.mjs) to
// docs/release/receipts/local/ in the invoking checkout (gitignored), with
// the SHA, base, toolchain versions and each step's result, and exits 0
// only when the gate passed. `pnpm release:promote --local-receipt <file>`
// accepts only a passing receipt for the commit it deploys. Each step's full
// output goes to logs/<step>.log in the run directory, and all of it to
// verify.log there, whose path is printed; a failed step's tail is printed.
//
// The base is the release the committed receipts say production serves
// (docs/release/receipts/, local-receipt.mjs servingRelease), or --base-ref <production SHA>
// before the first promotion. Promotion refuses a receipt whose base is not
// the last promoted commit, or whose merge base is HEAD itself (the policy
// and upgrade steps would compare HEAD with itself). Without either, the
// base falls back to origin/main, which suits a branch but not a release.
//
// --skip and --fail-fast are for iterating: a receipt with a requested skip
// or a step that did not run never passes promotion. Nor does one written
// while the invoking checkout has uncommitted edits to the gate's own code
// (GATE_SOURCE_PATHS), since that code, not the commit's, ran the gate.

import { execFileSync, spawn, spawnSync } from "node:child_process"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  BUNDLE_BUDGET_ARGS,
  GATE_STEPS,
  LOCAL_RECEIPTS_DIR,
  PROMOTION_RECEIPTS_DIR,
  buildLocalReceipt,
  gateProblems,
  gateSourceChanges,
  latestPromotedRelease,
  localReceiptFileName,
} from "./local-receipt.mjs"

/**
 * The placeholder values from ci.yml's top-level `env:`. CI needs no real
 * secrets; the e2e server's instrumentation refuses to boot without these.
 * tests/server/release-verify-local.test.ts keeps them equal to ci.yml.
 */
export const CI_PLACEHOLDER_ENV = {
  NEXTAUTH_SECRET: "ci-only-secret-value-with-at-least-32-characters",
  TOKEN_ENCRYPTION_KEY: "ci-only-token-key-with-at-least-32-characters",
  CRON_SECRET: "ci-only-cron-secret",
  NEXT_TELEMETRY_DISABLED: "1",
}

/**
 * The only inherited variables the steps see: what finds the toolchain, the
 * home and temp directories, and network settings for pnpm. Everything else
 * is dropped, so provider credentials, database URLs or CI variables sourced
 * into the operator's shell (a production env file before promoting, say)
 * never reach integration or e2e; the run sees what ci.yml's jobs see. The
 * throwaway cluster's URLs and CI_PLACEHOLDER_ENV are added on top.
 */
export const INHERITED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TERM",
  // scripts/ci/postgres.mjs: where PostgreSQL lives, native or docker.
  "NABA_PG_BIN",
  "NABA_PG_MODE",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "PLAYWRIGHT_BROWSERS_PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
]

/** Prefixes of inherited toolchain variables (pnpm, corepack, nvm). */
export const INHERITED_ENV_PREFIXES = [
  "PNPM_",
  "npm_config_",
  "NPM_CONFIG_",
  "COREPACK_",
  "NVM_",
  "XDG_",
]

/** Preferred e2e port: the harness origin the same-origin guard expects. */
export const E2E_PORT = 3100

/** Integration shards when neither the flag nor the variable sets them. */
export const DEFAULT_INTEGRATION_SHARDS = 4

/**
 * The CPU-heavy steps, in the order they get CPU when several are ready:
 * the build first (everything after it waits for it), then e2e (the longest
 * step, one Playwright worker), integration, unit, typecheck and lint. The
 * other steps are light and start whenever their needs have passed.
 */
export const HEAVY_STEP_PRIORITY = [
  "build",
  "e2e",
  "integration",
  "unit",
  "typecheck",
  "lint",
]

/**
 * How many cores' worth of heavy steps run at once: three quarters of the
 * machine, so a Mac shared with other work is not oversubscribed (running
 * unit, build, typecheck and lint all at once tripled each one's time and
 * timed out component tests in the 2026-10-22 trial run).
 * @param {number} cores
 */
export function defaultCpuBudget(cores) {
  return Math.max(4, Math.floor(cores * 0.75))
}

/**
 * Each heavy step's share of the CPU budget. The unit step also gets its
 * share as VITEST_MAX_WORKERS, so vitest does not start more workers than
 * the budget allows it.
 * @param {number} budget
 * @param {number} integrationShards
 * @returns {Record<string, number>}
 */
export function heavyStepWeights(budget, integrationShards) {
  return {
    build: 4,
    e2e: 2,
    integration: integrationShards + 2,
    unit: Math.min(8, Math.max(2, Math.floor(budget / 2))),
    typecheck: 2,
    lint: 2,
  }
}

/**
 * A budget of CPU shares that steps acquire before they start. Waiters are
 * served strictly in priority order: when the first does not fit, later ones
 * wait too, so a stream of small steps cannot hold back the build. A step
 * bigger than the whole budget runs alone.
 */
export class CpuBudget {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity
    this.used = 0
    this.order = 0
    /** @type {{ weight: number, priority: number, order: number, grant: () => void }[]} */
    this.waiting = []
  }

  /**
   * Resolves to a release function once `weight` shares are free.
   * @param {number} weight
   * @param {number} priority lower runs first
   * @returns {Promise<() => void>}
   */
  acquire(weight, priority) {
    return new Promise((resolve) => {
      this.waiting.push({
        weight,
        priority,
        order: this.order++,
        grant: () => {
          this.used += weight
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.used -= weight
            this.pump()
          })
        },
      })
      this.pump()
    })
  }

  pump() {
    this.waiting.sort((a, b) => a.priority - b.priority || a.order - b.order)
    while (this.waiting.length > 0) {
      const next = this.waiting[0]
      if (this.used > 0 && this.used + next.weight > this.capacity) return
      this.waiting.shift()
      next.grant()
    }
  }
}

/**
 * gitleaks arguments for the `secret-scan` step. The worktree shares the
 * checkout's refs, and gitleaks' default log is `--all`: other branches'
 * commits would decide this commit's receipt. `--log-opts=HEAD` scans the
 * full history of HEAD, which is what is being released.
 */
export const SECRET_SCAN_ARGS = Object.freeze([
  "git",
  "--no-banner",
  "--redact",
  "--log-opts=HEAD",
  ".",
])

/**
 * @param {Record<string, string | undefined>} base
 * @returns {Record<string, string>}
 */
export function childEnv(base) {
  const env = /** @type {Record<string, string>} */ ({})
  for (const [key, value] of Object.entries(base)) {
    if (
      value !== undefined &&
      (INHERITED_ENV.includes(key) ||
        INHERITED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)))
    ) {
      env[key] = value
    }
  }
  return {
    ...env,
    ...CI_PLACEHOLDER_ENV,
    // Homebrew postgresql@17 dies with "postmaster became multithreaded
    // during startup" without a UTF-8 locale.
    LC_ALL: "en_US.UTF-8",
    LANG: "en_US.UTF-8",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgs(argv, env = {}) {
  const options = {
    skip: /** @type {string[]} */ ([]),
    failFast: false,
    baseRef: /** @type {string | null} */ (null),
    receiptsDir: /** @type {string | null} */ (null),
    keepWorktree: false,
    list: false,
    serial: false,
    integrationShards: /** @type {number | string} */ (
      env.NABA_GATE_INTEGRATION_SHARDS ?? DEFAULT_INTEGRATION_SHARDS
    ),
    cpus: /** @type {number | string | null} */ (env.NABA_GATE_CPUS ?? null),
  }
  let shardsGiven = env.NABA_GATE_INTEGRATION_SHARDS !== undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--skip") {
      options.skip.push(
        ...(argv[++index] ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      )
    } else if (arg === "--fail-fast") options.failFast = true
    else if (arg === "--base-ref") options.baseRef = argv[++index] ?? ""
    else if (arg === "--receipts-dir") options.receiptsDir = argv[++index] ?? ""
    else if (arg === "--keep-worktree") options.keepWorktree = true
    else if (arg === "--list") options.list = true
    else if (arg === "--serial") options.serial = true
    else if (arg === "--integration-shards") {
      options.integrationShards = argv[++index] ?? ""
      shardsGiven = true
    } else if (arg === "--cpus") options.cpus = argv[++index] ?? ""
    else throw new Error(`Unknown argument: ${arg}`)
  }
  const unknown = options.skip.filter(
    (id) => !GATE_STEPS.some((step) => step.id === id)
  )
  if (unknown.length > 0) {
    throw new Error(`Unknown step(s) for --skip: ${unknown.join(", ")}`)
  }
  if (options.baseRef === "") throw new Error("--base-ref needs a ref")
  if (options.receiptsDir === "") throw new Error("--receipts-dir needs a path")
  const shards = Number(options.integrationShards)
  if (!Number.isInteger(shards) || shards < 1 || shards > 16) {
    throw new Error("--integration-shards needs a whole number from 1 to 16")
  }
  if (options.cpus !== null) {
    const cpus = Number(options.cpus)
    if (!Number.isInteger(cpus) || cpus < 1 || cpus > 256) {
      throw new Error("--cpus needs a whole number from 1 to 256")
    }
    options.cpus = cpus
  }
  // --serial is for a busy machine: one integration shard unless asked.
  options.integrationShards = options.serial && !shardsGiven ? 1 : shards
  options.skip = [...new Set(options.skip)]
  return options
}

/**
 * `export KEY='value'` lines from `postgres.mjs start` / `ports`.
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

/**
 * pg_dump output reduced to comparable lines, as ci.yml does: comments and
 * pg_dump 17's random `\restrict` keys dropped, blank lines dropped, sorted.
 * @param {string} dump
 */
export function normalizeSchemaDump(dump) {
  return dump
    .split("\n")
    .filter((line) => !/^(--|\\restrict|\\unrestrict)/.test(line))
    .filter((line) => line.trim() !== "")
    .sort()
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g

/**
 * The count lines worth keeping in the receipt from a step's output: vitest's
 * `Test Files` / `Tests` totals and Playwright's `N passed|failed|skipped|
 * flaky` lines. Last occurrence of each kind wins.
 * @param {string} output
 * @returns {string[]}
 */
export function summarizeOutput(output) {
  const lines = output
    .replace(ANSI_PATTERN, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
  /** @type {Map<string, string>} */
  const found = new Map()
  for (const line of lines) {
    const vitest = /^(Test Files|Tests)\s{2,}(.+)$/.exec(line)
    if (vitest) {
      found.set(vitest[1], `${vitest[1]} ${vitest[2].replace(/\s+/g, " ")}`)
      continue
    }
    const playwright =
      /^(\d+) (passed|failed|skipped|flaky|did not run)\b/.exec(line)
    if (playwright) found.set(`pw:${playwright[2]}`, line.replace(/\s+/g, " "))
  }
  return [...found.values()]
}

const VITEST_COUNT_KINDS = ["failed", "passed", "skipped", "todo"]

/**
 * One vitest summary from the summaries of several shards: `Test Files` and
 * `Tests` lines with each count added up, in vitest's own wording, so
 * testCountProblem judges the whole suite. A shard that reported no line
 * makes the merged line missing too.
 * @param {string[][]} summaries
 * @returns {string[]}
 */
export function mergeVitestSummaries(summaries) {
  const merged = []
  for (const label of ["Test Files", "Tests"]) {
    const totals = { failed: 0, passed: 0, skipped: 0, todo: 0, all: 0 }
    let complete = summaries.length > 0
    for (const summary of summaries) {
      const line = summary.find((entry) => entry.startsWith(`${label} `))
      if (!line) {
        complete = false
        break
      }
      for (const kind of VITEST_COUNT_KINDS) {
        const match = new RegExp(`(\\d+) ${kind}\\b`).exec(line)
        if (match) totals[kind] += Number(match[1])
      }
      const all = /\((\d+)\)\s*$/.exec(line)
      if (all) totals.all += Number(all[1])
    }
    if (!complete) continue
    const parts = VITEST_COUNT_KINDS.filter((kind) => totals[kind] > 0).map(
      (kind) => `${totals[kind]} ${kind}`
    )
    merged.push(`${label} ${parts.join(" | ") || "0 passed"} (${totals.all})`)
  }
  return merged
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DATABASE = "nabareview_test"
const TAIL_LIMIT = 256 * 1024

/**
 * A child process's collected output: the last `limit` characters (enough
 * for test counts and a failure's context), or everything when `limit` is
 * null. Schema dumps need everything: the migrated schema's dump is about
 * 500 KB, so a tail compared only its last half (fixed 2026-10-22).
 * @param {number | null} limit
 */
export function outputCollector(limit) {
  let text = ""
  return {
    /** @param {string} chunk */
    add(chunk) {
      text = limit === null ? text + chunk : (text + chunk).slice(-limit)
    },
    get value() {
      return text
    },
  }
}
const FAILED_TAIL_LINES = 80

/** Raised by a step that cannot run because something it needs failed. */
class NotRun extends Error {}

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

/** Committed promotion receipts at `sha`, as `{ name, content }`. */
function promotionReceiptsAt(root, sha) {
  return git(root, "ls-tree", "--name-only", sha, `${PROMOTION_RECEIPTS_DIR}/`)
    .split("\n")
    .filter((path) => path.endsWith(".json"))
    .map((path) => ({
      name: path,
      content: git(root, "show", `${sha}:${path}`),
    }))
}

function toolVersion(command, args, env, cwd) {
  const result = spawnSync(command, args, { encoding: "utf8", env, cwd })
  if (result.error || result.status !== 0) return null
  return result.stdout.trim().split("\n")[0] || null
}

function isFree(port) {
  return new Promise((done) => {
    const server = createServer()
    server.unref()
    server.once("error", () => done(false))
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)))
  })
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const options = parseArgs(process.argv.slice(2), process.env)
  if (options.list) {
    for (const step of GATE_STEPS) {
      const needs = step.needs.length
        ? `  (after ${step.needs.join(", ")})`
        : ""
      console.log(
        `${step.id.padEnd(20)} ${step.title}${step.required ? "" : " (optional)"}${needs}`
      )
    }
    return 0
  }

  const nodeMajor = Number(readFileSync(join(root, ".nvmrc"), "utf8").trim())
  const runningMajor = Number(process.versions.node.split(".")[0])
  if (runningMajor !== nodeMajor) {
    console.error(
      `verify:release needs Node ${nodeMajor} (.nvmrc); this is Node ${process.versions.node}. Run nvm use.`
    )
    return 2
  }

  const sha = git(root, "rev-parse", "HEAD")
  let baseRef = options.baseRef
  let baseSource = "flag"
  if (!baseRef) {
    let previous
    try {
      previous = latestPromotedRelease(promotionReceiptsAt(root, sha))
    } catch (error) {
      console.error(`verify:release: ${error.message}`)
      return 2
    }
    if (previous) {
      baseRef = previous.sha
      baseSource = "promotion-receipt"
    } else {
      baseRef = "origin/main"
      baseSource = "default"
      console.warn(
        "verify:release: no promotion receipt is committed, so the base is origin/main. For a release, pass --base-ref <the SHA production runs>."
      )
    }
  }
  let baseSha
  let mergeBase
  try {
    baseSha = git(root, "rev-parse", "--verify", `${baseRef}^{commit}`)
    mergeBase = git(root, "merge-base", baseSha, sha)
  } catch {
    console.error(
      `verify:release: ${baseRef} is not a commit with a merge base with HEAD; fetch it first.`
    )
    return 2
  }
  if (mergeBase === sha) {
    console.warn(
      `verify:release: the merge base with ${baseRef} is HEAD itself, so migration-policy and migrate-upgrade compare HEAD with itself; promotion refuses this receipt.`
    )
  }
  const uncommitted = git(root, "status", "--porcelain")
    .split("\n")
    .filter(Boolean)
  const gateChanges = gateSourceChanges(uncommitted)
  if (gateChanges.length > 0) {
    console.warn(
      `verify:release: uncommitted changes to the gate's own code (${gateChanges.join(", ")}) run this gate; promotion refuses its receipt.`
    )
  } else if (uncommitted.length > 0) {
    console.warn(
      `verify:release tests commit ${sha.slice(0, 12)}; ${uncommitted.length} uncommitted change(s) in this checkout are not part of the run.`
    )
  }

  const runDir = mkdtempSync(join(tmpdir(), `naba-verify-${sha.slice(0, 12)}-`))
  const worktree = join(runDir, "src")
  const logDir = join(runDir, "logs")
  const logPath = join(runDir, "verify.log")
  mkdirSync(logDir, { recursive: true })
  const log = createWriteStream(logPath)
  const env = childEnv(process.env)
  const cpuBudget = options.cpus ?? defaultCpuBudget(availableParallelism())
  const weights = heavyStepWeights(cpuBudget, options.integrationShards)
  let worktreeAdded = false

  /** Progress lines: the terminal and verify.log. */
  const say = (text) => {
    process.stdout.write(text)
    log.write(text)
  }

  /**
   * A step's output sink: its own log file, and verify.log with every line
   * prefixed by the step id, so concurrent steps stay readable.
   * @param {string} id
   */
  function stepLog(id) {
    const file = createWriteStream(join(logDir, `${id}.log`))
    let partial = ""
    return {
      path: join(logDir, `${id}.log`),
      write(text) {
        file.write(text)
        const lines = (partial + text).split("\n")
        partial = lines.pop() ?? ""
        for (const line of lines) log.write(`[${id}] ${line}\n`)
      },
      close() {
        if (partial) log.write(`[${id}] ${partial}\n`)
        partial = ""
        return new Promise((done) => file.end(done))
      },
    }
  }

  /**
   * Runs a command in the worktree, writing its output to `sink`, and
   * resolves to its exit code and output tail. Never rejects on a non-zero
   * exit.
   */
  function exec(
    sink,
    command,
    args,
    { extraEnv = {}, dbEnv = {}, input, stdoutOnly = false } = {}
  ) {
    return new Promise((done) => {
      const child = spawn(command, args, {
        cwd: worktreeAdded ? worktree : root,
        env: { ...env, ...dbEnv, ...extraEnv },
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      })
      // stdoutOnly: the whole of stdout, nothing from stderr (a schema dump
      // must be complete and must not have warnings mixed into it).
      const output = outputCollector(stdoutOnly ? null : TAIL_LIMIT)
      const collect = (chunk, keep = true) => {
        const text = chunk.toString()
        if (keep) output.add(text)
        sink.write(text)
      }
      child.stdout.on("data", (chunk) => collect(chunk))
      child.stderr.on("data", (chunk) => collect(chunk, !stdoutOnly))
      if (input !== undefined) child.stdin.end(input)
      child.on("error", (error) => {
        collect(`${command}: ${error.message}\n`)
        done({ code: 127, output: output.value })
      })
      child.on("close", (code, signal) =>
        done({ code: code ?? (signal ? 128 : 1), output: output.value })
      )
    })
  }

  async function must(sink, command, args, opts) {
    const result = await exec(sink, command, args, opts)
    if (result.code !== 0) {
      const error = new Error(
        `${command} ${args.join(" ")} exited ${result.code}`
      )
      error.exitCode = result.code
      error.output = result.output
      throw error
    }
    return result
  }

  // One throwaway cluster per database step (or integration shard), each in
  // its own directory. They start one at a time: postgres.mjs picks a free
  // port before the server binds it, so two concurrent starts could pick
  // the same one.
  /** @type {{ dir: string, name: string }[]} */
  const clusters = []
  let clusterQueue = Promise.resolve()

  /**
   * @param {ReturnType<typeof stepLog>} sink
   * @param {string} name
   * @returns {Promise<Record<string, string>>}
   */
  function startCluster(sink, name) {
    const started = clusterQueue.then(async () => {
      const dir = join(runDir, `pg-${name}`)
      // SHARD names the docker container on the docker path.
      const extraEnv = { NABA_PG_DIR: dir, SHARD: name }
      // Tracked before it starts, so an interrupt mid-start still stops it
      // (postgres.mjs stop is idempotent).
      clusters.push({ dir, name })
      const result = await exec(
        sink,
        "node",
        ["scripts/ci/postgres.mjs", "start"],
        { extraEnv }
      )
      if (result.code !== 0) {
        throw new Error(
          `PostgreSQL did not start for ${name} (scripts/ci/postgres.mjs start)`
        )
      }
      const dbEnv = parseExports(result.output)
      if (!dbEnv.DIRECT_DATABASE_URL) {
        throw new Error("postgres.mjs start exported no DIRECT_DATABASE_URL")
      }
      sink.write(`PostgreSQL for ${name} on 127.0.0.1:${dbEnv.NABA_PG_PORT}\n`)
      return { ...dbEnv, NABA_PG_DIR: dir, SHARD: name }
    })
    clusterQueue = started.then(
      () => undefined,
      () => undefined
    )
    return started
  }

  function stopClusters() {
    for (const { dir, name } of clusters.splice(0)) {
      spawnSync("node", ["scripts/ci/postgres.mjs", "stop"], {
        cwd: worktreeAdded ? worktree : root,
        env: { ...env, NABA_PG_DIR: dir, SHARD: name },
        stdio: "ignore",
      })
    }
  }

  async function psql(sink, dbEnv, ...args) {
    return must(
      sink,
      "scripts/ci/pg-client.sh",
      ["psql", "-v", "ON_ERROR_STOP=1", ...args],
      { dbEnv }
    )
  }

  async function recreateDatabase(sink, dbEnv) {
    const admin = dbEnv.DIRECT_DATABASE_URL.replace(/\/[^/]*$/, "/postgres")
    await psql(
      sink,
      dbEnv,
      admin,
      "-c",
      `drop database ${DATABASE} with (force)`,
      "-c",
      `create database ${DATABASE}`
    )
  }

  /** A new cluster with the schema migrated and the runtime role created. */
  async function migratedCluster(sink, name) {
    const dbEnv = await startCluster(sink, name)
    await must(sink, "pnpm", ["db:migrate"], { dbEnv })
    await must(sink, "pnpm", ["db:runtime-role"], { dbEnv })
    return dbEnv
  }

  async function schemaDump(dbEnv) {
    const result = await must(
      { write() {} },
      "scripts/ci/pg-client.sh",
      ["pg_dump", "--schema-only", "--no-owner", dbEnv.DIRECT_DATABASE_URL],
      { dbEnv, stdoutOnly: true }
    )
    return result.output
  }

  let scratchSchema = /** @type {string[] | null} */ (null)
  /** @type {Record<string, string> | null} */
  let migrationsCluster = null

  /**
   * @type {Record<string, (sink: ReturnType<typeof stepLog>) =>
   *   Promise<{ output?: string, summary?: string[], note?: string,
   *   skipped?: boolean } | void>>}
   */
  const steps = {
    "frozen-install": (sink) =>
      must(sink, "pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]),
    typecheck: (sink) => must(sink, "pnpm", ["typecheck"]),
    lint: (sink) => must(sink, "pnpm", ["lint"]),
    unit: (sink) =>
      must(sink, "pnpm", ["test"], {
        extraEnv: { VITEST_MAX_WORKERS: String(weights.unit) },
      }),
    format: (sink) =>
      must(sink, "node", [
        "scripts/format-changed.mjs",
        "--check",
        "--base",
        "origin/main",
      ]),
    design: async (sink) => {
      await must(sink, "pnpm", ["check:design", "--ratchet"])
      await must(sink, "pnpm", ["check:contrast"])
    },
    build: (sink) => must(sink, "pnpm", ["build"]),
    "bundle-budget": (sink) =>
      must(sink, "node", ["tests/perf/route-js.mjs", ...BUNDLE_BUDGET_ARGS]),
    "migration-policy": (sink) =>
      must(sink, "node", ["scripts/ci/migration-policy.mjs", baseSha]),
    "migrate-fresh": async (sink) => {
      const dbEnv = await startCluster(sink, "migrations")
      migrationsCluster = dbEnv
      await must(sink, "pnpm", ["db:migrate"], { dbEnv })
      await must(sink, "pnpm", ["db:migrate"], {
        dbEnv,
        extraEnv: { DB_MIGRATE_EXPECT_NOOP: "1" },
      })
      await must(sink, "pnpm", ["db:runtime-role"], { dbEnv })
      await must(sink, "pnpm", ["db:runtime-role"], { dbEnv })
      await must(sink, "pnpm", ["db:status", "--expect-current"], { dbEnv })
      scratchSchema = normalizeSchemaDump(await schemaDump(dbEnv))
    },
    "migrate-upgrade": async (sink) => {
      const dbEnv = /** @type {Record<string, string>} */ (migrationsCluster)
      await recreateDatabase(sink, dbEnv)
      const baseDir = join(runDir, "base")
      rmSync(baseDir, { recursive: true, force: true })
      mkdirSync(baseDir, { recursive: true })
      const archive = execFileSync(
        "git",
        ["archive", "--format=tar", mergeBase, "supabase/migrations"],
        { cwd: worktree, maxBuffer: 256 * 1024 * 1024 }
      )
      execFileSync("tar", ["-x", "-C", baseDir], { input: archive })
      sink.write(`Migrate to the merge base ${mergeBase.slice(0, 12)}\n`)
      await must(sink, "pnpm", ["db:migrate"], {
        dbEnv,
        extraEnv: { MIGRATIONS_DIR: join(baseDir, "supabase/migrations") },
      })
      await must(sink, "pnpm", ["db:migrate"], { dbEnv })
      await must(sink, "pnpm", ["db:runtime-role"], { dbEnv })
      const forward = normalizeSchemaDump(await schemaDump(dbEnv))
      const scratch = scratchSchema ?? []
      if (forward.join("\n") !== scratch.join("\n")) {
        const onlyScratch = scratch.filter((line) => !forward.includes(line))
        const onlyForward = forward.filter((line) => !scratch.includes(line))
        sink.write(
          [
            "--- from scratch only",
            ...onlyScratch.map((line) => `- ${line}`),
            "+++ upgrade only",
            ...onlyForward.map((line) => `+ ${line}`),
            "",
          ].join("\n")
        )
        throw new Error(
          "Schema after upgrading from the merge base differs from a from-scratch migrate"
        )
      }
      return { note: `upgraded from ${mergeBase.slice(0, 12)}` }
    },
    "migrate-concurrent": async (sink) => {
      const dbEnv = await startCluster(sink, "concurrent")
      const [a, b] = await Promise.all([
        exec(sink, "pnpm", ["db:migrate"], { dbEnv }),
        exec(sink, "pnpm", ["db:migrate"], { dbEnv }),
      ])
      if (a.code !== 0 || b.code !== 0) {
        throw new Error("A concurrent db:migrate failed")
      }
      const expected = readdirSync(
        join(worktree, "supabase/migrations")
      ).filter((name) => name.endsWith(".sql")).length
      const counts = await must(
        { write() {} },
        "scripts/ci/pg-client.sh",
        [
          "psql",
          "-At",
          "-F",
          " ",
          dbEnv.DIRECT_DATABASE_URL,
          "-c",
          "select count(*), count(distinct version) from schema_migration",
        ],
        { dbEnv }
      )
      const [total, distinct] = counts.output.trim().split(/\s+/).map(Number)
      const note = `files=${expected} rows=${total} distinct=${distinct}`
      sink.write(`${note}\n`)
      if (total !== expected || distinct !== expected) {
        throw new Error(`Expected each of ${expected} versions exactly once`)
      }
      return { note }
    },
    integration: async (sink) => {
      // The suite starts the standalone build (.next/standalone/server.js).
      // Each shard gets its own cluster: the files of one shard share a
      // database and the global fleet leases, so they stay serial inside it.
      const count = options.integrationShards
      const shards = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const shard = `${index + 1}/${count}`
          const shardSink = {
            write: (text) =>
              sink.write(
                count === 1
                  ? text
                  : text.replace(/^(?=.)/gm, `[shard ${shard}] `)
              ),
          }
          try {
            const dbEnv = await migratedCluster(
              shardSink,
              `integration-${index + 1}`
            )
            const args =
              count === 1
                ? ["test:integration"]
                : ["test:integration", `--shard=${shard}`]
            const result = await exec(shardSink, "pnpm", args, { dbEnv })
            return { shard, code: result.code, output: result.output }
          } catch (error) {
            return {
              shard,
              code: error.exitCode ?? 1,
              output: String(error.output ?? error.message),
            }
          }
        })
      )
      const summary = mergeVitestSummaries(
        shards.map((result) => summarizeOutput(result.output))
      )
      const failed = shards.filter((result) => result.code !== 0)
      const note = count === 1 ? undefined : `${count} shards, one cluster each`
      if (failed.length > 0) {
        const error = new Error(
          `integration shard(s) ${failed.map((result) => result.shard).join(", ")} failed`
        )
        error.exitCode = failed[0].code
        error.summary = summary
        throw error
      }
      return { summary, note }
    },
    e2e: async (sink) => {
      // The pinned browser for this Playwright version; a no-op when present.
      await must(sink, "pnpm", ["exec", "playwright", "install", "chromium"])
      const dbEnv = await migratedCluster(sink, "e2e")
      let port = E2E_PORT
      if (!((await isFree(port)) && (await isFree(port + 1)))) {
        const ports = await must(sink, "node", [
          "scripts/ci/postgres.mjs",
          "ports",
        ])
        port = Number(parseExports(ports.output).PLAYWRIGHT_PORT)
        if (!port) throw new Error("could not choose an e2e port")
        sink.write(`Port ${E2E_PORT} is busy; e2e uses ${port}\n`)
      }
      const result = await must(sink, "pnpm", ["test:e2e", "--forbid-only"], {
        dbEnv,
        extraEnv: { PLAYWRIGHT_PORT: String(port) },
      })
      return { output: result.output, note: `port ${port}` }
    },
    "workflow-lint": async (sink) => {
      const missing = ["actionlint", "zizmor"].filter(
        (tool) => !toolVersion(tool, ["--version"], env)
      )
      if (missing.length > 0) {
        return {
          skipped: true,
          note: `${missing.join(" and ")} not installed (brew install actionlint zizmor); workflows not linted`,
        }
      }
      await must(sink, "actionlint", [])
      await must(sink, "zizmor", ["--offline", ".github/"])
    },
    audit: (sink) =>
      must(sink, "pnpm", ["audit", "--prod", "--audit-level", "high"]),
    "secret-scan": async (sink) => {
      if (!toolVersion("gitleaks", ["version"], env)) {
        return {
          skipped: true,
          note: "gitleaks is not installed (brew install gitleaks); not scanned, so the gate fails",
        }
      }
      // .gitleaksignore at the repository root lists historical findings.
      return must(sink, "gitleaks", [...SECRET_SCAN_ARGS])
    },
  }

  const cleanup = () => {
    stopClusters()
    if (worktreeAdded && !options.keepWorktree) {
      spawnSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: root,
        stdio: "ignore",
      })
      spawnSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" })
      rmSync(worktree, { recursive: true, force: true })
      rmSync(join(runDir, "base"), { recursive: true, force: true })
      worktreeAdded = false
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      cleanup()
      console.error(`verify:release interrupted (${signal}); log: ${logPath}`)
      process.exit(130)
    })
  }

  const startedAt = new Date().toISOString()
  const budget = new CpuBudget(cpuBudget)
  /** @type {Map<string, import("./local-receipt.mjs").StepResult>} */
  const results = new Map()
  /** @type {Map<string, Promise<import("./local-receipt.mjs").StepResult>>} */
  const running = new Map()
  let stop = false

  /** @param {typeof GATE_STEPS[number]} step */
  async function runStep(step) {
    for (const need of step.needs) await running.get(need)
    if (options.skip.includes(step.id)) {
      return {
        id: step.id,
        status: "skipped",
        durationMs: 0,
        note: "skipped by --skip",
      }
    }
    if (stop) {
      return {
        id: step.id,
        status: "not-run",
        durationMs: 0,
        note: "stopped by --fail-fast",
      }
    }
    const missing = step.needs.filter(
      (need) => results.get(need)?.status !== "passed"
    )
    if (missing.length > 0) {
      return {
        id: step.id,
        status: "not-run",
        durationMs: 0,
        note: `needs ${missing.join(", ")}, which did not pass`,
      }
    }
    const priority = HEAVY_STEP_PRIORITY.indexOf(step.id)
    const release =
      options.serial || priority === -1
        ? () => {}
        : await budget.acquire(weights[step.id], priority)
    say(`=== ${step.id}: started (${step.title})\n`)
    const sink = stepLog(step.id)
    const started = performance.now()
    /** @type {import("./local-receipt.mjs").StepResult} */
    let result
    try {
      const outcome = (await steps[step.id](sink)) ?? {}
      result = {
        id: step.id,
        status: outcome.skipped ? "skipped" : "passed",
        durationMs: performance.now() - started,
        summary: outcome.summary ?? summarizeOutput(outcome.output ?? ""),
        note: outcome.note,
      }
    } catch (error) {
      const notRun = error instanceof NotRun
      result = {
        id: step.id,
        status: notRun ? "not-run" : "failed",
        durationMs: performance.now() - started,
        exitCode: error.exitCode ?? null,
        summary: error.summary ?? summarizeOutput(error.output ?? ""),
        note: String(error.message).slice(0, 300),
      }
    }
    release()
    await sink.close()
    say(
      `=== ${step.id}: ${result.status} in ${(result.durationMs / 1000).toFixed(1)}s${result.note ? ` (${result.note})` : ""}\n`
    )
    for (const line of result.summary ?? []) say(`    ${line}\n`)
    if (result.status === "failed") {
      const lines = readFileSync(sink.path, "utf8").trimEnd().split("\n")
      say(
        `--- last ${Math.min(lines.length, FAILED_TAIL_LINES)} lines of ${sink.path}\n${lines.slice(-FAILED_TAIL_LINES).join("\n")}\n---\n`
      )
    }
    if (
      options.failFast &&
      result.status !== "passed" &&
      result.status !== "skipped"
    ) {
      stop = true
    }
    return result
  }

  try {
    git(root, "worktree", "add", "--detach", worktree, sha)
    worktreeAdded = true
    say(
      `verify:release ${sha} (base ${baseRef} ${baseSha.slice(0, 12)} from ${baseSource}, merge base ${mergeBase.slice(0, 12)})\nworktree: ${worktree}\nlogs: ${logDir}\n${options.serial ? "serial" : `concurrent, CPU budget ${cpuBudget} (${availableParallelism()} cores), integration in ${options.integrationShards} shard(s)`}\n\n`
    )
    if (options.serial) {
      for (const step of GATE_STEPS) {
        const promise = runStep(step)
        running.set(step.id, promise)
        results.set(step.id, await promise)
      }
    } else {
      for (const step of GATE_STEPS) {
        running.set(
          step.id,
          runStep(step).then((result) => {
            results.set(step.id, result)
            return result
          })
        )
      }
      await Promise.all(running.values())
    }
  } finally {
    cleanup()
  }

  const toolchain = {
    node: process.version,
    pnpm: toolVersion("pnpm", ["--version"], env),
    postgres: toolVersion(
      join(root, "scripts/ci/pg-client.sh"),
      ["psql", "--version"],
      env
    ),
    gitleaks: toolVersion("gitleaks", ["version"], env),
    actionlint: toolVersion("actionlint", ["--version"], env),
    zizmor: toolVersion("zizmor", ["--version"], env),
    playwright: toolVersion(
      join(root, "node_modules/.bin/playwright"),
      ["--version"],
      env,
      root
    ),
    platform: `${process.platform}-${process.arch}`,
  }
  const receipt = buildLocalReceipt({
    sha,
    base: { ref: baseRef, sha: baseSha, mergeBase, source: baseSource },
    gateSource: { clean: gateChanges.length === 0, changed: gateChanges },
    toolchain,
    steps: [...results.values()],
    options: {
      skip: options.skip,
      failFast: options.failFast,
      serial: options.serial,
      integrationShards: options.integrationShards,
      cpuBudget: options.serial ? null : cpuBudget,
    },
    startedAt,
    finishedAt: new Date().toISOString(),
  })
  const receiptsDir = resolve(root, options.receiptsDir ?? LOCAL_RECEIPTS_DIR)
  mkdirSync(receiptsDir, { recursive: true })
  const receiptPath = join(receiptsDir, localReceiptFileName(receipt))
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  await new Promise((done) => log.end(done))

  const wallMs = Date.parse(receipt.finishedAt) - Date.parse(startedAt)
  console.log(`\nLocal release gate (${(wallMs / 60000).toFixed(1)} min)`)
  for (const step of receipt.steps) {
    console.log(
      `  ${step.status.padEnd(8)} ${step.id.padEnd(20)} ${(step.durationMs / 1000).toFixed(1).padStart(7)}s${step.summary ? `  ${step.summary.join("; ")}` : ""}${step.note ? `  (${step.note})` : ""}`
    )
  }
  const problems = gateProblems(receipt.steps)
  console.log(`\nReceipt: ${relative(root, receiptPath) || receiptPath}`)
  console.log(`Log: ${logPath}`)
  if (options.keepWorktree && existsSync(worktree)) {
    console.log(`Worktree kept: ${worktree} (git worktree remove --force it)`)
  }
  if (!receipt.ok) {
    for (const problem of problems) console.error(`gate: ${problem}`)
    console.error(`verify:release FAILED for ${sha.slice(0, 12)}`)
    return 1
  }
  console.log(`verify:release passed for ${sha.slice(0, 12)}`)
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`verify:release failed: ${error?.message ?? error}`)
      process.exit(1)
    }
  )
}
