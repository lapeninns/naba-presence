#!/usr/bin/env node
// Local release gate: the whole CI graph, run on this machine.
//
//   pnpm verify:release [--skip <id,...>] [--fail-fast] [--base-ref <ref>]
//                       [--receipts-dir <dir>] [--keep-worktree] [--list]
//
// Hosted CI is not a release gate (docs/ci.md §5); this run is the evidence.
// It checks HEAD out into a fresh detached git worktree under the OS temp
// directory, so no .env file, untracked file or local build output takes
// part, then runs every step of .github/workflows/ci.yml plus the nightly
// production audit, in order, against a throwaway PostgreSQL 17 cluster
// (scripts/ci/postgres.mjs) that it stops afterwards:
//
//   frozen install, typecheck, lint, unit, build, migration policy against
//   the base, migrate from scratch + no-op + runtime role + db:status,
//   upgrade from the merge base (schema diff), concurrent migrate, integration,
//   e2e (port 3100 when free), pnpm audit --prod --audit-level high, and
//   gitleaks over HEAD's full history when gitleaks is installed (skipped with a
//   note otherwise).
//
// It writes a receipt (scripts/release/local-receipt.mjs) to
// docs/release/receipts/local/ in the invoking checkout (gitignored), with
// the SHA, base, Node/pnpm/PostgreSQL versions and each step's result, and
// exits 0 only when the gate passed. `pnpm release:promote --local-receipt
// <file>` accepts only a passing receipt for the commit it deploys. The full
// output goes to verify.log in the run directory, whose path is printed.
//
// The base is what production runs: the SHA in the newest committed
// promotion receipt (docs/release/receipts/), or --base-ref <production SHA>
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
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
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
 */
export function parseArgs(argv) {
  const options = {
    skip: /** @type {string[]} */ ([]),
    failFast: false,
    baseRef: /** @type {string | null} */ (null),
    receiptsDir: /** @type {string | null} */ (null),
    keepWorktree: false,
    list: false,
  }
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DATABASE = "nabareview_test"
const TAIL_LIMIT = 256 * 1024

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

function toolVersion(command, args, env) {
  const result = spawnSync(command, args, { encoding: "utf8", env })
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
  const options = parseArgs(process.argv.slice(2))
  if (options.list) {
    for (const step of GATE_STEPS) {
      console.log(
        `${step.id.padEnd(20)} ${step.title}${step.required ? "" : " (optional)"}`
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
  const pgDir = join(runDir, "pg")
  const logPath = join(runDir, "verify.log")
  const log = createWriteStream(logPath)
  const env = childEnv(process.env)
  /** @type {Record<string, string>} */
  let dbEnv = {}
  let pgState = /** @type {"down" | "up" | "broken"} */ ("down")
  let worktreeAdded = false

  const write = (text) => {
    process.stdout.write(text)
    log.write(text)
  }

  /**
   * Runs a command in the worktree, streaming its output, and resolves to
   * its exit code and output tail. Never rejects on a non-zero exit.
   */
  function exec(command, args, { extraEnv = {}, input, quiet = false } = {}) {
    return new Promise((done) => {
      const child = spawn(command, args, {
        cwd: worktreeAdded ? worktree : root,
        env: { ...env, ...dbEnv, ...extraEnv },
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      })
      let tail = ""
      const collect = (chunk) => {
        const text = chunk.toString()
        tail = (tail + text).slice(-TAIL_LIMIT)
        if (quiet) log.write(text)
        else write(text)
      }
      child.stdout.on("data", collect)
      child.stderr.on("data", collect)
      if (input !== undefined) child.stdin.end(input)
      child.on("error", (error) => {
        collect(`${command}: ${error.message}\n`)
        done({ code: 127, output: tail })
      })
      child.on("close", (code, signal) =>
        done({ code: code ?? (signal ? 128 : 1), output: tail })
      )
    })
  }

  async function must(command, args, opts) {
    const result = await exec(command, args, opts)
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

  async function ensurePostgres() {
    if (pgState === "up") return
    if (pgState === "broken") throw new NotRun("PostgreSQL did not start")
    const result = await exec("node", ["scripts/ci/postgres.mjs", "start"], {
      extraEnv: { NABA_PG_DIR: pgDir },
      quiet: true,
    })
    if (result.code !== 0) {
      pgState = "broken"
      write(result.output)
      throw new Error(
        "PostgreSQL did not start (scripts/ci/postgres.mjs start)"
      )
    }
    dbEnv = parseExports(result.output)
    if (!dbEnv.DIRECT_DATABASE_URL) {
      pgState = "broken"
      throw new Error("postgres.mjs start exported no DIRECT_DATABASE_URL")
    }
    pgState = "up"
    write(`PostgreSQL ready on 127.0.0.1:${dbEnv.NABA_PG_PORT}\n`)
  }

  async function psql(...args) {
    return must("scripts/ci/pg-client.sh", [
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      ...args,
    ])
  }

  async function recreateDatabase() {
    await ensurePostgres()
    const admin = dbEnv.DIRECT_DATABASE_URL.replace(/\/[^/]*$/, "/postgres")
    await psql(
      admin,
      "-c",
      `drop database ${DATABASE} with (force)`,
      "-c",
      `create database ${DATABASE}`
    )
  }

  async function freshMigratedDatabase() {
    await recreateDatabase()
    await must("pnpm", ["db:migrate"])
    await must("pnpm", ["db:runtime-role"])
  }

  async function schemaDump() {
    const result = await must(
      "scripts/ci/pg-client.sh",
      ["pg_dump", "--schema-only", "--no-owner", dbEnv.DIRECT_DATABASE_URL],
      { quiet: true }
    )
    return result.output
  }

  let scratchSchema = /** @type {string[] | null} */ (null)
  const passed = new Set()
  const requires = (...ids) => {
    const missing = ids.filter((id) => !passed.has(id))
    if (missing.length > 0) {
      throw new NotRun(`needs ${missing.join(", ")}, which did not pass`)
    }
  }

  /** @type {Record<string, () => Promise<{ output?: string, note?: string } | void>>} */
  const steps = {
    "frozen-install": () =>
      must("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]),
    typecheck: async () => {
      requires("frozen-install")
      return must("pnpm", ["typecheck"])
    },
    lint: async () => {
      requires("frozen-install")
      return must("pnpm", ["lint"])
    },
    unit: async () => {
      requires("frozen-install")
      return must("pnpm", ["test"])
    },
    build: async () => {
      requires("frozen-install")
      return must("pnpm", ["build"])
    },
    "migration-policy": () =>
      must("node", ["scripts/ci/migration-policy.mjs", baseSha]),
    "migrate-fresh": async () => {
      requires("frozen-install")
      await ensurePostgres()
      await must("pnpm", ["db:migrate"])
      await must("pnpm", ["db:migrate"], {
        extraEnv: { DB_MIGRATE_EXPECT_NOOP: "1" },
      })
      await must("pnpm", ["db:runtime-role"])
      await must("pnpm", ["db:runtime-role"])
      await must("pnpm", ["db:status", "--expect-current"])
      scratchSchema = normalizeSchemaDump(await schemaDump())
    },
    "migrate-upgrade": async () => {
      requires("migrate-fresh")
      await recreateDatabase()
      const baseDir = join(runDir, "base")
      rmSync(baseDir, { recursive: true, force: true })
      mkdirSync(baseDir, { recursive: true })
      const archive = execFileSync(
        "git",
        ["archive", "--format=tar", mergeBase, "supabase/migrations"],
        { cwd: worktree, maxBuffer: 256 * 1024 * 1024 }
      )
      execFileSync("tar", ["-x", "-C", baseDir], { input: archive })
      write(`Migrate to the merge base ${mergeBase.slice(0, 12)}\n`)
      await must("pnpm", ["db:migrate"], {
        extraEnv: { MIGRATIONS_DIR: join(baseDir, "supabase/migrations") },
      })
      await must("pnpm", ["db:migrate"])
      await must("pnpm", ["db:runtime-role"])
      const forward = normalizeSchemaDump(await schemaDump())
      const scratch = scratchSchema ?? []
      if (forward.join("\n") !== scratch.join("\n")) {
        const onlyScratch = scratch.filter((line) => !forward.includes(line))
        const onlyForward = forward.filter((line) => !scratch.includes(line))
        write(
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
    "migrate-concurrent": async () => {
      requires("frozen-install")
      await recreateDatabase()
      const [a, b] = await Promise.all([
        exec("pnpm", ["db:migrate"]),
        exec("pnpm", ["db:migrate"]),
      ])
      if (a.code !== 0 || b.code !== 0) {
        throw new Error("A concurrent db:migrate failed")
      }
      const expected = readdirSync(
        join(worktree, "supabase/migrations")
      ).filter((name) => name.endsWith(".sql")).length
      const counts = await must(
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
        { quiet: true }
      )
      const [total, distinct] = counts.output.trim().split(/\s+/).map(Number)
      const note = `files=${expected} rows=${total} distinct=${distinct}`
      write(`${note}\n`)
      if (total !== expected || distinct !== expected) {
        throw new Error(`Expected each of ${expected} versions exactly once`)
      }
      return { note }
    },
    integration: async () => {
      // The suite starts the standalone build (.next/standalone/server.js).
      requires("frozen-install", "build")
      await freshMigratedDatabase()
      return must("pnpm", ["test:integration"])
    },
    e2e: async () => {
      requires("build")
      await freshMigratedDatabase()
      let port = E2E_PORT
      if (!((await isFree(port)) && (await isFree(port + 1)))) {
        const ports = await must("node", ["scripts/ci/postgres.mjs", "ports"], {
          quiet: true,
        })
        port = Number(parseExports(ports.output).PLAYWRIGHT_PORT)
        if (!port) throw new Error("could not choose an e2e port")
        write(`Port ${E2E_PORT} is busy; e2e uses ${port}\n`)
      }
      const result = await must("pnpm", ["test:e2e", "--forbid-only"], {
        extraEnv: { PLAYWRIGHT_PORT: String(port) },
      })
      return { output: result.output, note: `port ${port}` }
    },
    audit: () => must("pnpm", ["audit", "--prod", "--audit-level", "high"]),
    "secret-scan": async () => {
      if (!toolVersion("gitleaks", ["version"], env)) {
        return {
          skipped: true,
          note: "gitleaks is not installed (brew install gitleaks); not scanned",
        }
      }
      // .gitleaksignore at the repository root lists historical findings.
      // The worktree shares the checkout's refs, and gitleaks' default log is
      // `--all`: other branches' commits would decide this commit's receipt.
      // Scan the full history of HEAD, which is what is being released.
      return must("gitleaks", [
        "git",
        "--no-banner",
        "--redact",
        "--log-opts=HEAD",
        ".",
      ])
    },
  }

  const cleanup = () => {
    if (pgState !== "down") {
      spawnSync("node", ["scripts/ci/postgres.mjs", "stop"], {
        cwd: worktreeAdded ? worktree : root,
        env: { ...env, NABA_PG_DIR: pgDir },
        stdio: "ignore",
      })
      pgState = "down"
    }
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
  /** @type {import("./local-receipt.mjs").StepResult[]} */
  const results = []
  try {
    git(root, "worktree", "add", "--detach", worktree, sha)
    worktreeAdded = true
    write(
      `verify:release ${sha} (base ${baseRef} ${baseSha.slice(0, 12)} from ${baseSource}, merge base ${mergeBase.slice(0, 12)})\nworktree: ${worktree}\n`
    )

    let stop = false
    for (const step of GATE_STEPS) {
      if (options.skip.includes(step.id)) {
        results.push({
          id: step.id,
          status: "skipped",
          durationMs: 0,
          note: "skipped by --skip",
        })
        continue
      }
      if (stop) {
        results.push({
          id: step.id,
          status: "not-run",
          durationMs: 0,
          note: "stopped by --fail-fast",
        })
        continue
      }
      write(`\n=== ${step.id}: ${step.title}\n`)
      const started = performance.now()
      /** @type {import("./local-receipt.mjs").StepResult} */
      let result
      try {
        const outcome = (await steps[step.id]()) ?? {}
        result = {
          id: step.id,
          status: outcome.skipped ? "skipped" : "passed",
          durationMs: performance.now() - started,
          summary: summarizeOutput(outcome.output ?? ""),
          note: outcome.note,
        }
      } catch (error) {
        const notRun = error instanceof NotRun
        result = {
          id: step.id,
          status: notRun ? "not-run" : "failed",
          durationMs: performance.now() - started,
          exitCode: error.exitCode ?? null,
          summary: summarizeOutput(error.output ?? ""),
          note: String(error.message).slice(0, 300),
        }
      }
      if (result.status === "passed") passed.add(step.id)
      write(
        `=== ${step.id}: ${result.status} in ${(result.durationMs / 1000).toFixed(1)}s${result.note ? ` (${result.note})` : ""}\n`
      )
      for (const line of result.summary ?? []) write(`    ${line}\n`)
      results.push(result)
      if (
        options.failFast &&
        result.status !== "passed" &&
        result.status !== "skipped"
      ) {
        stop = true
      }
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
    platform: `${process.platform}-${process.arch}`,
  }
  const receipt = buildLocalReceipt({
    sha,
    base: { ref: baseRef, sha: baseSha, mergeBase, source: baseSource },
    gateSource: { clean: gateChanges.length === 0, changed: gateChanges },
    toolchain,
    steps: results,
    options: { skip: options.skip, failFast: options.failFast },
    startedAt,
    finishedAt: new Date().toISOString(),
  })
  const receiptsDir = resolve(root, options.receiptsDir ?? LOCAL_RECEIPTS_DIR)
  mkdirSync(receiptsDir, { recursive: true })
  const receiptPath = join(receiptsDir, localReceiptFileName(receipt))
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  await new Promise((done) => log.end(done))

  console.log("\nLocal release gate")
  for (const step of receipt.steps) {
    console.log(
      `  ${step.status.padEnd(8)} ${step.id}${step.summary ? `  ${step.summary.join("; ")}` : ""}${step.note ? `  (${step.note})` : ""}`
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
