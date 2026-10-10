#!/usr/bin/env node
// Controlled production promotion (ledger CI-06, decision D-38).
//
// Usage, from a clean worktree of origin/main with dependencies installed:
//   DIRECT_DATABASE_URL='<admin url>' pnpm release:promote [--dry-run]
//     [--exception <reference>] [--receipts-dir <dir>]
//
// Production ships by `vercel deploy --prod` from the operator's machine, not
// by a Git-triggered promote, so this script is the gate. It refuses unless:
//   - the worktree has no changes, untracked files or ignored env files
//     (`vercel deploy` uploads the directory, not the commit),
//   - HEAD is exactly origin/main after a fetch,
//   - GitHub Actions reports `CI result` and both CodeQL analyses as
//     completed and successful on that SHA, or, when hosted CI could not
//     produce a verdict (missing, queued, in progress, cancelled or failed
//     to start), the operator passes `--exception` with a reference to the
//     recorded local-evidence exception (docs/ci.md §3). A completed red
//     verdict is never excused,
//   - `pnpm db:status --expect-current` against the operator's admin URL
//     reports no pending migration.
// Then it deploys with NABA_RELEASE_SHA stamped into the build and runtime
// environment and writes a receipt to docs/release/receipts/: the build (SHA,
// deployment ID and URL, CI run or exception), the migrations the commit
// ships (version and sha256), and the production configuration NAMES. Never
// values. The receipt is committed through a docs-only PR afterwards.
//
// The decision is the pure `checkCandidate`, in the style of
// scripts/vercel-ignore-build.mjs `decide()`; everything that talks to git,
// GitHub, Vercel or the database lives in `main()`.

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { redactForLog } from "../../lib/domain/redaction.ts"
import { listMigrationVersions } from "../migration-rules.mjs"

export const REPOSITORY = "lapeninns/naba-presence"

/**
 * GitHub check runs that must have succeeded on the candidate SHA. The names
 * are the job names in ci.yml (`result`) and codeql.yml (`analyze` matrix).
 */
export const REQUIRED_CHECKS = [
  "CI result",
  "Analyze (javascript-typescript)",
  "Analyze (actions)",
]

/**
 * GitHub Actions' app id. Only its check runs count: any app with
 * checks:write could otherwise post a "CI result" success on the SHA. The
 * branch ruleset pins the same `integration_id`.
 */
export const GITHUB_ACTIONS_APP_ID = 15368

/**
 * Completed conclusions that mean hosted CI produced no verdict, so a
 * recorded exception may stand in for them. Everything else that is not
 * `success` (failure, timed_out, action_required, skipped, neutral, stale)
 * is a verdict or an unexplained state, and always refuses.
 */
const NO_VERDICT_CONCLUSIONS = new Set(["cancelled", "startup_failure"])

const SHA_PATTERN = /^[0-9a-f]{40}$/
const CONFIG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * @typedef {{ id?: number, name: string, status: string,
 *   conclusion: string | null, html_url?: string | null,
 *   app?: number | null }} CheckRun
 * @typedef {"current" | "pending" | "unknown"} SchemaStatus
 */

/**
 * The latest GitHub Actions run of each check name: a re-run is a new check
 * run with a higher id, and only the latest attempt counts. Runs from any
 * other app are ignored.
 * @param {CheckRun[]} checkRuns
 * @param {string} name
 * @returns {CheckRun | undefined}
 */
export function latestCheckRun(checkRuns, name) {
  return checkRuns
    .filter((run) => run.name === name && run.app === GITHUB_ACTIONS_APP_ID)
    .reduce(
      (latest, run) =>
        latest === undefined || (run.id ?? 0) > (latest.id ?? 0) ? run : latest,
      /** @type {CheckRun | undefined} */ (undefined)
    )
}

/**
 * Problems with the required checks, in REQUIRED_CHECKS order. `waivable`
 * problems are ones where hosted CI gave no verdict (missing, not completed,
 * cancelled, failed to start); a recorded exception may stand in for those
 * and nothing else.
 * @param {CheckRun[]} checkRuns
 * @returns {{ message: string, waivable: boolean }[]}
 */
export function checkProblems(checkRuns) {
  const problems = []
  for (const name of REQUIRED_CHECKS) {
    const run = latestCheckRun(checkRuns, name)
    if (!run) {
      problems.push({
        message: `check "${name}" has not run on this commit`,
        waivable: true,
      })
    } else if (run.status !== "completed") {
      problems.push({
        message: `check "${name}" is ${run.status}, not completed`,
        waivable: true,
      })
    } else if (run.conclusion !== "success") {
      problems.push({
        message: `check "${name}" concluded ${run.conclusion ?? "nothing"}`,
        waivable: NO_VERDICT_CONCLUSIONS.has(run.conclusion ?? ""),
      })
    }
  }
  return problems
}

/**
 * A usable exception reference: one token naming where the exception is
 * recorded (a ledger row, decision ID or URL), that redaction leaves
 * unchanged, so it cannot smuggle a credential into the receipt.
 * @param {unknown} reference
 */
export function isExceptionReference(reference) {
  if (typeof reference !== "string") return false
  const trimmed = reference.trim()
  return (
    trimmed.length >= 3 &&
    trimmed.length <= 300 &&
    /^\S+$/.test(trimmed) &&
    redactForLog(trimmed) === trimmed
  )
}

/**
 * Whether `sha` may be promoted. Pure: the caller gathers the facts.
 *
 * The exception only stands in for GitHub checks that gave no verdict
 * (hosted CI unavailable, docs/ci.md §3). It never excuses a check that
 * completed red, a dirty worktree, a commit that is not origin/main, or
 * pending migrations.
 *
 * @param {{
 *   sha: string,
 *   checkRuns: CheckRun[],
 *   worktreeClean: boolean,
 *   headIsOriginMain: boolean,
 *   schemaStatus: SchemaStatus,
 *   exception?: { ref: string } | null,
 * }} input
 * @returns {{ ok: boolean, problems: string[],
 *   evidence: { ciRunUrl: string } | { exceptionRef: string } | null,
 *   checks: { name: string, status: string, conclusion: string | null }[] }}
 */
export function checkCandidate({
  sha,
  checkRuns,
  worktreeClean,
  headIsOriginMain,
  schemaStatus,
  exception,
}) {
  const problems = []
  if (!SHA_PATTERN.test(sha ?? "")) {
    problems.push(`"${sha}" is not a full commit SHA`)
  }
  if (!worktreeClean) {
    problems.push("the worktree is not clean")
  }
  if (!headIsOriginMain) {
    problems.push("HEAD is not origin/main")
  }
  if (schemaStatus === "pending") {
    problems.push("the production database has pending migrations")
  } else if (schemaStatus !== "current") {
    problems.push("the production schema status could not be confirmed")
  }

  const checks = REQUIRED_CHECKS.map((name) => {
    const run = latestCheckRun(checkRuns, name)
    return {
      name,
      status: run?.status ?? "missing",
      conclusion: run?.conclusion ?? null,
    }
  })
  const failedChecks = checkProblems(checkRuns)
  /** @type {{ ciRunUrl: string } | { exceptionRef: string } | null} */
  let evidence = null
  if (failedChecks.length === 0) {
    const ciRunUrl = latestCheckRun(checkRuns, "CI result")?.html_url
    if (ciRunUrl) {
      evidence = { ciRunUrl }
    } else {
      problems.push('check "CI result" has no run URL')
    }
  } else if (exception != null) {
    const verdicts = failedChecks.filter((problem) => !problem.waivable)
    if (verdicts.length > 0) {
      problems.push(
        "--exception covers only checks hosted CI could not run, not a completed red check"
      )
      problems.push(...verdicts.map((problem) => problem.message))
    } else if (isExceptionReference(exception.ref)) {
      evidence = { exceptionRef: exception.ref.trim() }
    } else {
      problems.push(
        "--exception needs a reference to where the exception is recorded"
      )
      problems.push(...failedChecks.map((problem) => problem.message))
    }
  } else {
    problems.push(...failedChecks.map((problem) => problem.message))
  }

  return { ok: problems.length === 0, problems, evidence, checks }
}

/**
 * Version and content hash of every migration file the commit ships.
 * @param {{ name: string, content: string | Buffer }[]} files
 */
export function migrationReceipt(files) {
  const byVersion = new Map(
    files.map((file) => [file.name.replace(/\.sql$/, ""), file.content])
  )
  return listMigrationVersions(files.map((file) => file.name)).map(
    (version) => ({
      version,
      sha256: createHash("sha256")
        .update(byVersion.get(version) ?? "")
        .digest("hex"),
    })
  )
}

/**
 * Paths (`a.b[2]`) whose value redaction would change: anything shaped like
 * a credential, a bearer token, a JWT or a URL with userinfo or a secret
 * query parameter.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function secretLikePaths(value, path = "$") {
  if (typeof value === "string") {
    return redactForLog(value) === value ? [] : [path]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      secretLikePaths(item, `${path}[${index}]`)
    )
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      secretLikePaths(item, `${path}.${key}`)
    )
  }
  return []
}

/**
 * The release receipt. Throws rather than return a receipt that names a
 * configuration value instead of a variable name, or that carries anything
 * redaction would touch.
 *
 * @param {{
 *   sha: string,
 *   deployment: { id: string, url: string },
 *   evidence: { ciRunUrl: string } | { exceptionRef: string },
 *   checks: { name: string, status: string, conclusion: string | null }[],
 *   migrations: { version: string, sha256: string }[],
 *   configNames: string[],
 *   operator: string,
 *   timestamp: string,
 * }} input
 */
export function buildReceipt({
  sha,
  deployment,
  evidence,
  checks,
  migrations,
  configNames,
  operator,
  timestamp,
}) {
  const invalidNames = configNames.filter(
    (name) => !CONFIG_NAME_PATTERN.test(name)
  )
  if (invalidNames.length > 0) {
    throw new Error(
      `configNames must be environment variable names; ${invalidNames.length} entr${invalidNames.length === 1 ? "y is" : "ies are"} not`
    )
  }
  const receipt = {
    sha,
    deploymentId: deployment.id,
    url: deployment.url,
    ...("ciRunUrl" in evidence
      ? { ciRunUrl: evidence.ciRunUrl }
      : { exceptionRef: evidence.exceptionRef }),
    checks,
    migrations,
    configNames: [...new Set(configNames)].sort(),
    operator,
    timestamp,
  }
  const leaks = secretLikePaths(receipt)
  if (leaks.length > 0) {
    throw new Error(
      `Refusing to write a receipt with secret-like values at ${leaks.join(", ")}`
    )
  }
  return receipt
}

/** `20261010T120000Z-<sha12>.json`: sorts by time, names the commit. */
export function receiptFileName(receipt) {
  const stamp = receipt.timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  return `${stamp}-${receipt.sha.slice(0, 12)}.json`
}

/**
 * Deployment ID and URL from `vercel deploy --format json`. The CLI's shape
 * has moved between versions, so accept the fields at the top level or under
 * `deployment`.
 * @param {string} stdout
 * @returns {{ id: string, url: string }}
 */
export function parseDeployOutput(stdout) {
  const parsed = JSON.parse(stdout)
  const source =
    parsed && typeof parsed.deployment === "object" ? parsed.deployment : parsed
  const id = source?.id ?? source?.uid
  const rawUrl = source?.url
  if (typeof id !== "string" || typeof rawUrl !== "string") {
    throw new Error("vercel deploy did not report a deployment id and url")
  }
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`
  return { id, url }
}

/**
 * Variable names from `vercel env ls production --format json`. Only `key`
 * is read; any value the CLI returns is dropped here.
 * @param {string} stdout
 */
export function parseEnvNames(stdout) {
  const parsed = JSON.parse(stdout)
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.envs)
      ? parsed.envs
      : []
  return [
    ...new Set(
      entries
        .map((entry) => entry?.key)
        .filter((key) => typeof key === "string" && key.length > 0)
    ),
  ].sort()
}

/**
 * Untracked, modified or staged files, and ignored env files that
 * `vercel deploy` would upload alongside the commit.
 * @param {string} porcelain `git status --porcelain --untracked-files=all`
 * @param {string[]} ignored `git ls-files --others --ignored --exclude-standard --directory`
 */
export function worktreeIssues(porcelain, ignored) {
  const changed = porcelain.split("\n").filter(Boolean)
  const secrets = ignored.filter((path) =>
    /(^|\/)(\.env(\..*)?|\.dev\.vars)$/.test(path.replace(/\/$/, ""))
  )
  return [
    ...changed.map((line) => `changed: ${line.slice(3)}`),
    ...secrets.map((path) => `ignored env file present: ${path}`),
  ]
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim()
}

function parseArgs(argv) {
  const options = { dryRun: false, exception: null, receiptsDir: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--exception") options.exception = argv[++index] ?? ""
    else if (arg === "--receipts-dir") options.receiptsDir = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function readCheckRuns(sha) {
  const output = run("gh", [
    "api",
    "--paginate",
    `repos/${REPOSITORY}/commits/${sha}/check-runs`,
    "--jq",
    ".check_runs[] | {id, name, status, conclusion, html_url, app: .app.id}",
  ])
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/** @returns {SchemaStatus} */
function readSchemaStatus(root) {
  // Inherit output so the operator sees the printed `target` and confirms it
  // is the production database.
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/db-status.mjs"), "--expect-current"],
    { cwd: root, stdio: "inherit", env: process.env }
  )
  if (result.status === 0) return "current"
  if (result.status === 1) return "pending"
  return "unknown"
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const options = parseArgs(process.argv.slice(2))

  // Required explicitly: db-status would otherwise fall back to a local
  // .env DATABASE_URL and report a development database as current.
  if (!process.env.DIRECT_DATABASE_URL) {
    console.error(
      "release:promote needs DIRECT_DATABASE_URL set to the production admin URL (direct or session pooler, 5432)."
    )
    process.exit(2)
  }

  run("git", ["fetch", "--quiet", "origin", "main"], { cwd: root })
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: root })
  const originMain = run("git", ["rev-parse", "origin/main"], { cwd: root })
  const issues = worktreeIssues(
    run("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root,
    }),
    run(
      "git",
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
      ],
      { cwd: root }
    )
      .split("\n")
      .filter(Boolean)
  )
  for (const issue of issues) console.error(`worktree: ${issue}`)

  const checkRuns = readCheckRuns(sha)
  const schemaStatus = readSchemaStatus(root)
  const evaluation = checkCandidate({
    sha,
    checkRuns,
    worktreeClean: issues.length === 0,
    headIsOriginMain: sha === originMain,
    schemaStatus,
    exception: options.exception === null ? null : { ref: options.exception },
  })
  for (const check of evaluation.checks) {
    console.log(
      `check ${check.name}: ${check.status}${check.conclusion ? ` (${check.conclusion})` : ""}`
    )
  }
  if (!evaluation.ok || !evaluation.evidence) {
    for (const problem of evaluation.problems) {
      console.error(`refused: ${problem}`)
    }
    process.exit(1)
  }
  if ("exceptionRef" in evaluation.evidence) {
    console.warn(
      `Promoting on a recorded exception (${evaluation.evidence.exceptionRef}); the receipt records it.`
    )
  }

  const migrationsDir = join(root, "supabase/migrations")
  const migrations = migrationReceipt(
    readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({
        name,
        content: readFileSync(join(migrationsDir, name)),
      }))
  )
  const configNames = parseEnvNames(
    run("vercel", ["env", "ls", "production", "--format", "json"], {
      cwd: root,
    })
  )
  const operator = run("gh", ["api", "user", "--jq", ".login"])

  // Validate the receipt before deploying, with placeholder deployment
  // fields, so a configuration name or operator that would make buildReceipt
  // throw refuses here rather than after production has changed.
  const receiptInput = {
    sha,
    evidence: evaluation.evidence,
    checks: evaluation.checks,
    migrations,
    configNames,
    operator,
  }
  buildReceipt({
    ...receiptInput,
    deployment: { id: "dpl_pending", url: "https://pending.invalid" },
    timestamp: new Date().toISOString(),
  })

  const deployArgs = [
    "deploy",
    "--prod",
    "--yes",
    "--format",
    "json",
    "--build-env",
    `NABA_RELEASE_SHA=${sha}`,
    "--env",
    `NABA_RELEASE_SHA=${sha}`,
    "--meta",
    `releaseSha=${sha}`,
  ]
  if (options.dryRun) {
    console.log(`Dry run: would run vercel ${deployArgs.join(" ")}`)
    console.log(
      `Dry run: ${migrations.length} migration(s), ${configNames.length} configuration name(s), operator ${operator}`
    )
    return
  }

  const deployment = parseDeployOutput(run("vercel", deployArgs, { cwd: root }))
  // Production has changed: print what the operator needs to roll back or
  // write the receipt by hand before anything else can fail.
  console.log(`Deployed ${deployment.url} (${deployment.id}) at ${sha}`)
  const receipt = buildReceipt({
    ...receiptInput,
    deployment,
    timestamp: new Date().toISOString(),
  })
  const receiptsDir = resolve(
    root,
    options.receiptsDir ?? "docs/release/receipts"
  )
  mkdirSync(receiptsDir, { recursive: true })
  const receiptPath = join(receiptsDir, receiptFileName(receipt))
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`Receipt: ${relative(root, receiptPath)}`)
  console.log(
    "Next: smoke-check GET /api/operations/health?scope=platform (release.sha must match), then commit the receipt through a docs-only PR."
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`release:promote failed: ${error?.message ?? error}`)
    process.exit(1)
  })
}
