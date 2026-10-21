#!/usr/bin/env node
// Controlled production promotion (ledger CI-06, decision D-38).
//
// Usage, from a clean worktree of origin/main with dependencies installed:
//   DIRECT_DATABASE_URL='<admin url>' pnpm release:promote
//     --local-receipt <file> [--dry-run] [--receipts-dir <dir>]
//
// Production ships by `vercel deploy --prod` from the operator's machine, not
// by a Git-triggered promote, so this script is the gate. Hosted CI is not a
// gate (docs/ci.md §5): the evidence is the local release gate's receipt from
// `pnpm verify:release` (scripts/release/verify-local.mjs). It refuses unless:
//   - the worktree has no changes, untracked files or ignored env files
//     (`vercel deploy` uploads the directory, not the commit),
//   - HEAD is exactly origin/main after a fetch,
//   - the local receipt is for that SHA, ran in a fresh worktree on the
//     .nvmrc Node major with no requested skips and no uncommitted edits to
//     the gate's own code, its base is the commit the newest committed
//     promotion receipt shipped (and not HEAD itself), and every required
//     step passed (re-judged from its steps, scripts/release/local-receipt.mjs),
//   - `pnpm db:status --expect-current` against the operator's admin URL
//     reports no pending migration.
// Then it promotes in three phases (audit W7-2): `vercel deploy --prod
// --skip-domain` builds a production deployment with NABA_RELEASE_SHA stamped
// into the build and runtime environment but leaves the production domains on
// the current deployment; the readiness probe (scripts/ops/readiness-probe.mjs)
// must pass against the new deployment's own URL and report that SHA; only
// then does `vercel promote` move the domains. A failed probe leaves the old
// deployment serving and exits non-zero, with nothing to roll back. After the
// promotion the same probe runs against the production origin
// (`--production-url`, or READINESS_URL) with bounded retries, because only
// that proves the domains moved to the promoted SHA. It then writes a receipt
// to docs/release/receipts/, the probe's result included: the build (SHA,
// deployment ID and URL, the local gate's receipt file, sha256, base and step
// results), the migrations the commit ships (version and sha256), and the
// production configuration NAMES. Never values. The local receipt's exact
// bytes are copied beside it as `<receipt>.local.json`, to commit with it, so
// the pinned sha256 stays checkable. If production does not report the
// promoted SHA the receipt is still written (production has changed, and
// `pnpm release:rollback` reads it) and the script exits 3 with the next step.
//
// The probe authenticates with READINESS_PROBE_TOKEN (production's
// CRON_SECRET, or CRON_SECRET) and, when the project uses Deployment
// Protection, VERCEL_AUTOMATION_BYPASS_SECRET; the script refuses before
// deploying without a token or a production URL.
//
// The decision is the pure `checkCandidate`, in the style of
// scripts/vercel-ignore-build.mjs `decide()`; the three phases are
// `stagedPromotion` and the production check `verifyProduction`, with the
// Vercel CLI and the probe injected (unit-tested with both mocked); rollback.mjs
// reuses the production check. Everything else that talks to git, Vercel or the
// database lives in `main()`.

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { listMigrationVersions } from "../migration-rules.mjs"
import {
  PROMOTION_RECEIPTS_DIR,
  latestPromotedRelease,
  localReceiptProblems,
} from "./local-receipt.mjs"
import { secretLikePaths, timestampedFileName } from "./receipt-safety.mjs"

export { secretLikePaths }

const SHA_PATTERN = /^[0-9a-f]{40}$/
const CONFIG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * @typedef {"current" | "pending" | "unknown"} SchemaStatus
 * @typedef {{ file: string, sha256: string, content: unknown }} LocalReceiptInput
 * @typedef {{ file: string, sha256: string, finishedAt: string,
 *   base: { ref: string, sha: string, mergeBase: string, source?: string },
 *   steps: { id: string, status: string }[] }} LocalGateEvidence
 */

/**
 * Whether `sha` may be promoted. Pure: the caller gathers the facts.
 *
 * Nothing stands in for the local receipt: a missing, failed, skipped or
 * other-commit receipt refuses, as do a dirty worktree, a commit that is not
 * origin/main and pending migrations.
 *
 * @param {{
 *   sha: string,
 *   worktreeClean: boolean,
 *   headIsOriginMain: boolean,
 *   schemaStatus: SchemaStatus,
 *   localReceipt: LocalReceiptInput | null,
 *   nodeMajor: number,
 *   previousSha?: string | null,
 * }} input
 * @returns {{ ok: boolean, problems: string[],
 *   evidence: { localGate: LocalGateEvidence } | null }}
 */
export function checkCandidate({
  sha,
  worktreeClean,
  headIsOriginMain,
  schemaStatus,
  localReceipt,
  nodeMajor,
  previousSha = null,
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

  /** @type {{ localGate: LocalGateEvidence } | null} */
  let evidence = null
  if (localReceipt == null) {
    problems.push(
      "no local release-gate receipt: run pnpm verify:release and pass --local-receipt <file>"
    )
  } else {
    const receiptProblems = localReceiptProblems(localReceipt.content, {
      sha: sha ?? "",
      nodeMajor,
      previousSha,
    })
    if (receiptProblems.length > 0) {
      problems.push(
        ...receiptProblems.map((problem) => `local gate: ${problem}`)
      )
    } else {
      const content = /** @type {Record<string, any>} */ (localReceipt.content)
      evidence = {
        localGate: {
          file: localReceipt.file,
          sha256: localReceipt.sha256,
          finishedAt: content.finishedAt,
          base: {
            ref: content.base.ref,
            sha: content.base.sha,
            mergeBase: content.base.mergeBase,
            ...(content.base.source ? { source: content.base.source } : {}),
          },
          steps: content.steps.map((step) => ({
            id: step.id,
            status: step.status,
          })),
        },
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    evidence: problems.length === 0 ? evidence : null,
  }
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
 * The release receipt. Throws rather than return a receipt that names a
 * configuration value instead of a variable name, or that carries anything
 * redaction would touch.
 *
 * @param {{
 *   sha: string,
 *   deployment: { id: string, url: string },
 *   evidence: { localGate: LocalGateEvidence },
 *   migrations: { version: string, sha256: string }[],
 *   configNames: string[],
 *   operator: string,
 *   timestamp: string,
 *   productionProbe?: ProductionVerification | null,
 * }} input
 */
export function buildReceipt({
  sha,
  deployment,
  evidence,
  migrations,
  configNames,
  operator,
  timestamp,
  productionProbe = null,
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
    localGate: {
      ...evidence.localGate,
      // The local receipt's exact bytes, committed beside this receipt.
      copy: localReceiptCopyName({ timestamp, sha }),
    },
    migrations,
    configNames: [...new Set(configNames)].sort(),
    operator,
    timestamp,
    // Whether the production origin served `sha` after `vercel promote`.
    ...(productionProbe ? { productionProbe } : {}),
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
  return timestampedFileName(receipt.timestamp, receipt.sha)
}

/** `20261010T120000Z-<sha12>.local.json`, beside the promotion receipt. */
export function localReceiptCopyName(receipt) {
  return receiptFileName(receipt).replace(/\.json$/, ".local.json")
}

/**
 * The local receipt as promotion reads it: the file name, the sha256 of its
 * exact bytes (so the promotion receipt pins the file) and its parsed JSON.
 * Unparseable content becomes `null`, which checkCandidate refuses.
 * @param {string} path
 * @param {Buffer} bytes
 * @returns {LocalReceiptInput}
 */
export function readLocalReceipt(path, bytes) {
  let content = null
  try {
    content = JSON.parse(bytes.toString("utf8"))
  } catch {
    content = null
  }
  return {
    file: basename(path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    content,
  }
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

/**
 * `vercel deploy` arguments: a production build that does not take the
 * production domains (`--skip-domain`); `vercel promote` assigns them once
 * the probe passed.
 * @param {string} sha
 */
export function deployArgs(sha) {
  return [
    "deploy",
    "--prod",
    "--skip-domain",
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
}

/** @param {string} deploymentId */
export function promoteArgs(deploymentId) {
  return ["promote", deploymentId, "--yes", "--timeout", "5m"]
}

/**
 * readiness-probe.mjs arguments for the staged deployment: its own URL, and
 * the SHA it must report. Degraded passes (production may be degraded for
 * reasons the deployment does not change, such as telemetry not configured);
 * not ready, unreachable, unauthorised and a SHA mismatch fail.
 * @param {string} url
 * @param {string} sha
 */
export function probeArgs(url, sha) {
  return ["--url", url, "--expect-sha", sha]
}

/** Probe attempts and the wait between them: a fresh deployment cold-starts. */
export const PROBE_ATTEMPTS = 3
export const PROBE_RETRY_MS = 10_000

/**
 * Production probe attempts after `vercel promote`, and the wait between
 * them: the domains can take a moment to reach the new deployment. Bounded,
 * with each attempt's process killed after PROBE_PROCESS_TIMEOUT_MS, so the
 * check ends within about four minutes.
 */
export const PRODUCTION_PROBE_ATTEMPTS = 5
export const PRODUCTION_PROBE_RETRY_MS = 15_000
export const PROBE_PROCESS_TIMEOUT_MS = 30_000
/** The exit code recorded for a probe process killed at the timeout. */
export const PROBE_TIMEOUT_EXIT = 124
/** The exit code when production does not serve the SHA after a promotion. */
export const PRODUCTION_MISMATCH_EXIT = 3

/**
 * @typedef {{ exitCode: number, status: string, servedSha: string | null }} ProbeResult
 * @typedef {{ url: string, expectSha: string, ok: boolean, status: string,
 *   servedSha: string | null, exitCode: number,
 *   attempts: { attempt: number, exitCode: number, status: string,
 *     servedSha: string | null }[],
 *   checkedAt: string }} ProductionVerification
 */

/**
 * readiness-probe.mjs arguments for the production origin: as for the staged
 * deployment, plus `--json`, so the verdict and the SHA production serves can
 * be recorded.
 * @param {string} url
 * @param {string} sha
 */
export function productionProbeArgs(url, sha) {
  return [...probeArgs(url, sha), "--json"]
}

/**
 * The production origin to probe after a promotion: `--production-url`, or
 * else READINESS_URL. https only, since the probe sends the cron bearer, and
 * an origin rather than a path.
 * @param {string | null | undefined} flag
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, problem: null } | { url: null, problem: string }}
 */
export function resolveProductionUrl(flag, env) {
  const raw = flag || env.READINESS_URL
  if (!raw) {
    return {
      url: null,
      problem:
        "pass --production-url https://<production origin> (or set READINESS_URL), so production can be probed after the promotion",
    }
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    return { url: null, problem: "--production-url is not a valid URL" }
  }
  if (url.protocol !== "https:") {
    return { url: null, problem: "--production-url must be https" }
  }
  return { url: url.origin, problem: null }
}

/**
 * One probe run, from `spawnSync` of readiness-probe.mjs with `--json`: the
 * exit code, the verdict and the SHA the deployment reported. A process
 * killed at the timeout is `timeout`; output that is not the probe's JSON is
 * `unreadable` and never passes.
 * @param {{ status: number | null, signal?: string | null,
 *   error?: { code?: string } | null, stdout?: string | null }} result
 * @returns {ProbeResult}
 */
export function probeResultFromSpawn(result) {
  if (
    result.error?.code === "ETIMEDOUT" ||
    (result.status === null && result.signal)
  ) {
    return { exitCode: PROBE_TIMEOUT_EXIT, status: "timeout", servedSha: null }
  }
  const exitCode = result.status ?? 2
  const line = String(result.stdout ?? "")
    .trim()
    .split("\n")
    .pop()
  let parsed = null
  try {
    parsed = line ? JSON.parse(line) : null
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed.status !== "string") {
    return {
      exitCode: exitCode === 0 ? 2 : exitCode,
      status: "unreadable",
      servedSha: null,
    }
  }
  const served = parsed.body?.release?.sha
  return {
    exitCode,
    status: parsed.status,
    servedSha:
      typeof served === "string" && SHA_PATTERN.test(served) ? served : null,
  }
}

/**
 * Probe the production origin until it reports `sha`, up to `attempts`
 * times. Passes only on exit 0 with the expected SHA served; a usage error
 * (64) stops at once, since retrying cannot fix it. Never throws for a
 * failed probe: the caller records the result.
 *
 * @param {{
 *   url: string,
 *   sha: string,
 *   probe: (url: string, sha: string) => Promise<ProbeResult> | ProbeResult,
 *   onAttempt?: (attempt: number, result: ProbeResult) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   retryMs?: number,
 *   now?: () => Date,
 * }} input
 * @returns {Promise<ProductionVerification>}
 */
export async function verifyProduction({
  url,
  sha,
  probe,
  onAttempt = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = PRODUCTION_PROBE_ATTEMPTS,
  retryMs = PRODUCTION_PROBE_RETRY_MS,
  now = () => new Date(),
}) {
  /** @type {ProductionVerification["attempts"]} */
  const results = []
  let last = { exitCode: 2, status: "not-run", servedSha: null }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(retryMs)
    last = await probe(url, sha)
    results.push({ attempt, ...last })
    onAttempt(attempt, last)
    if (last.exitCode === 0 && last.servedSha === sha) break
    if (last.exitCode === 64) break
  }
  return {
    url,
    expectSha: sha,
    ok: last.exitCode === 0 && last.servedSha === sha,
    status: last.status,
    servedSha: last.servedSha,
    exitCode: last.exitCode,
    attempts: results,
    checkedAt: now().toISOString(),
  }
}

/**
 * What to tell the operator once production was probed, and the exit code.
 * A failure is loud: it names what production serves instead and the next
 * steps (`nextSteps`, which differ between promotion and rollback).
 * @param {ProductionVerification} verification
 * @param {{ nextSteps: string[] }} options
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function productionProbeReport(verification, { nextSteps }) {
  const { url, expectSha, attempts } = verification
  if (verification.ok) {
    return {
      exitCode: 0,
      lines: [
        `production: ${url} serves ${expectSha} (${verification.status}, attempt ${attempts.length})`,
      ],
    }
  }
  const served = verification.servedSha
    ? `, it serves ${verification.servedSha}`
    : ""
  const reason =
    verification.status === "timeout"
      ? "the probe timed out"
      : verification.status === "release_mismatch"
        ? "it reports another release"
        : `the probe said ${verification.status}`
  return {
    exitCode: PRODUCTION_MISMATCH_EXIT,
    lines: [
      `FAILED: production ${url} does not serve ${expectSha} after ${attempts.length} probe attempt(s): ${reason} (exit ${verification.exitCode})${served}.`,
      ...nextSteps.map((step) => `Next: ${step}`),
    ],
  }
}

/**
 * Deploy without the domains, probe the new deployment, and promote it only
 * when the probe passed. Returns `promoted: false` (the old deployment still
 * serves production) when every probe attempt failed. A deploy or promote
 * error propagates; the caller has already been told the deployment through
 * `onDeployed`.
 *
 * @param {{
 *   deploy: () => Promise<{ id: string, url: string }> | { id: string, url: string },
 *   probe: (url: string) => Promise<number> | number,
 *   promote: (deploymentId: string) => Promise<void> | void,
 *   onDeployed?: (deployment: { id: string, url: string }) => void,
 *   onProbe?: (attempt: number, exitCode: number) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   retryMs?: number,
 * }} steps
 * @returns {Promise<{ promoted: boolean, deployment: { id: string, url: string }, probeExitCode: number }>}
 */
export async function stagedPromotion({
  deploy,
  probe,
  promote,
  onDeployed = () => {},
  onProbe = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = PROBE_ATTEMPTS,
  retryMs = PROBE_RETRY_MS,
}) {
  const deployment = await deploy()
  onDeployed(deployment)
  let probeExitCode = -1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(retryMs)
    probeExitCode = await probe(deployment.url)
    onProbe(attempt, probeExitCode)
    if (probeExitCode === 0) break
  }
  if (probeExitCode !== 0) {
    return { promoted: false, deployment, probeExitCode }
  }
  await promote(deployment.id)
  return { promoted: true, deployment, probeExitCode }
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

/**
 * A `verifyProduction` probe that runs readiness-probe.mjs with `--json`,
 * killed after PROBE_PROCESS_TIMEOUT_MS. The probe reads its token from the
 * environment; stderr is inherited, stdout (the JSON) is parsed, not shown.
 * @param {string} root
 * @returns {(url: string, sha: string) => ProbeResult}
 */
export function spawnReadinessProbe(root) {
  return (url, sha) =>
    probeResultFromSpawn(
      spawnSync(
        process.execPath,
        [
          join(root, "scripts/ops/readiness-probe.mjs"),
          ...productionProbeArgs(url, sha),
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          env: process.env,
          timeout: PROBE_PROCESS_TIMEOUT_MS,
        }
      )
    )
}

/** @param {number} attempt @param {ProbeResult} result */
export function describeProbeAttempt(attempt, result) {
  return `production probe ${attempt}/${PRODUCTION_PROBE_ATTEMPTS}: ${result.status} (exit ${result.exitCode})${result.servedSha ? `, serving ${result.servedSha}` : ""}`
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    localReceipt: null,
    receiptsDir: null,
    productionUrl: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--local-receipt") options.localReceipt = argv[++index]
    else if (arg === "--receipts-dir") options.receiptsDir = argv[++index]
    else if (arg === "--production-url") options.productionUrl = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
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

  let localReceipt = null
  let localReceiptBytes = null
  if (options.localReceipt) {
    const path = resolve(options.localReceipt)
    try {
      localReceiptBytes = readFileSync(path)
      localReceipt = readLocalReceipt(path, localReceiptBytes)
    } catch (error) {
      console.error(`local receipt: cannot read ${path}: ${error.message}`)
    }
  }
  // The committed history in this clean worktree of origin/main; the gate
  // read the same files at the same commit for its default base.
  let previousSha = null
  let previousDeploymentId = null
  let previousUnreadable = false
  try {
    const dir = join(root, PROMOTION_RECEIPTS_DIR)
    const previous = latestPromotedRelease(
      readdirSync(dir).map((name) => ({
        name,
        content: name.endsWith(".json")
          ? readFileSync(join(dir, name), "utf8")
          : "",
      }))
    )
    previousSha = previous?.sha ?? null
    if (previous) {
      try {
        previousDeploymentId =
          JSON.parse(readFileSync(join(dir, previous.file), "utf8"))
            .deploymentId ?? null
      } catch {
        previousDeploymentId = null
      }
    }
    if (previous)
      console.log(`last promoted: ${previous.sha} (${previous.file})`)
  } catch (error) {
    previousUnreadable = true
    console.error(`refused: ${error.message}`)
  }
  // The probe needs the deployment's cron bearer; check before deploying.
  const probeTokenMissing =
    !process.env.READINESS_PROBE_TOKEN && !process.env.CRON_SECRET
  if (probeTokenMissing) {
    console.error(
      "refused: set READINESS_PROBE_TOKEN to production's CRON_SECRET, so the readiness probe can check the new deployment before it is promoted"
    )
  }
  // So is the production origin, probed after `vercel promote`.
  const production = resolveProductionUrl(options.productionUrl, process.env)
  if (production.problem) console.error(`refused: ${production.problem}`)
  const schemaStatus = readSchemaStatus(root)
  const evaluation = checkCandidate({
    sha,
    worktreeClean: issues.length === 0,
    headIsOriginMain: sha === originMain,
    schemaStatus,
    localReceipt,
    nodeMajor: Number(readFileSync(join(root, ".nvmrc"), "utf8").trim()),
    previousSha,
  })
  if (
    previousUnreadable ||
    probeTokenMissing ||
    !production.url ||
    !evaluation.ok ||
    !evaluation.evidence
  ) {
    for (const problem of evaluation.problems) {
      console.error(`refused: ${problem}`)
    }
    process.exit(1)
  }
  const { localGate } = evaluation.evidence
  console.log(
    `local gate: ${localGate.file} (sha256 ${localGate.sha256.slice(0, 12)}, finished ${localGate.finishedAt})`
  )

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
  const operator = run("git", ["config", "user.name"], { cwd: root })

  // Validate the receipt before deploying, with placeholder deployment
  // fields, so a configuration name or operator that would make buildReceipt
  // throw refuses here rather than after production has changed.
  const receiptInput = {
    sha,
    evidence: evaluation.evidence,
    migrations,
    configNames,
    operator,
  }
  buildReceipt({
    ...receiptInput,
    deployment: { id: "dpl_pending", url: "https://pending.invalid" },
    timestamp: new Date().toISOString(),
  })

  const vercelDeploy = deployArgs(sha)
  if (options.dryRun) {
    console.log(`Dry run: would run vercel ${vercelDeploy.join(" ")}`)
    console.log(
      `Dry run: then node scripts/ops/readiness-probe.mjs ${probeArgs("<deployment url>", sha).join(" ")}, up to ${PROBE_ATTEMPTS} attempts`
    )
    console.log(
      `Dry run: then, only if the probe passed, vercel ${promoteArgs("<deployment id>").join(" ")}`
    )
    console.log(
      `Dry run: then node scripts/ops/readiness-probe.mjs ${productionProbeArgs(production.url, sha).join(" ")}, up to ${PRODUCTION_PROBE_ATTEMPTS} attempts, recorded in the receipt; exit ${PRODUCTION_MISMATCH_EXIT} if production does not serve ${sha}`
    )
    console.log(
      `Dry run: ${migrations.length} migration(s), ${configNames.length} configuration name(s), operator ${operator}`
    )
    return
  }

  const outcome = await stagedPromotion({
    deploy: () => parseDeployOutput(run("vercel", vercelDeploy, { cwd: root })),
    onDeployed: (staged) => {
      // Not live yet: the production domains still point at the previous
      // deployment until `vercel promote`.
      console.log(
        `Staged ${staged.url} (${staged.id}) at ${sha}; production domains unchanged`
      )
    },
    probe: (url) => {
      const result = spawnSync(
        process.execPath,
        [join(root, "scripts/ops/readiness-probe.mjs"), ...probeArgs(url, sha)],
        { cwd: root, stdio: "inherit", env: process.env }
      )
      return result.status ?? 2
    },
    onProbe: (attempt, exitCode) => {
      if (exitCode !== 0) {
        console.error(
          `readiness probe attempt ${attempt}/${PROBE_ATTEMPTS} exited ${exitCode}`
        )
      }
    },
    promote: (deploymentId) => {
      run("vercel", promoteArgs(deploymentId), { cwd: root })
    },
  }).catch((error) => {
    console.error(
      "If a deployment was staged above, production still serves the previous one unless `vercel promote` started; check with `vercel promote status`."
    )
    throw error
  })
  const { deployment } = outcome
  if (!outcome.promoted) {
    console.error(
      `refused: the readiness probe failed against ${deployment.url} (exit ${outcome.probeExitCode}); it was not promoted and production still serves the previous deployment. No receipt written.`
    )
    process.exit(1)
  }
  // Production has changed: print what the operator needs to roll back or
  // write the receipt by hand before anything else can fail.
  console.log(`Promoted ${deployment.url} (${deployment.id}) at ${sha}`)
  const productionUrl = /** @type {string} */ (production.url)
  const productionProbe = await verifyProduction({
    url: productionUrl,
    sha,
    probe: spawnReadinessProbe(root),
    onAttempt: (attempt, result) => {
      const write = result.exitCode === 0 ? console.log : console.error
      write(describeProbeAttempt(attempt, result))
    },
  })
  const receipt = buildReceipt({
    ...receiptInput,
    deployment,
    timestamp: new Date().toISOString(),
    productionProbe,
  })
  const receiptsDir = resolve(
    root,
    options.receiptsDir ?? "docs/release/receipts"
  )
  mkdirSync(receiptsDir, { recursive: true })
  // The copy first, so a written receipt never names a missing copy.
  const copyPath = join(receiptsDir, receipt.localGate.copy)
  writeFileSync(copyPath, /** @type {Buffer} */ (localReceiptBytes))
  const receiptPath = join(receiptsDir, receiptFileName(receipt))
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`Receipt: ${relative(root, receiptPath)}`)
  console.log(`Local gate receipt copy: ${relative(root, copyPath)}`)
  const report = productionProbeReport(productionProbe, {
    nextSteps: [
      "the promotion happened and the receipt records the failed probe; commit both files whatever you decide next.",
      `check vercel promote status, the production domains and ${deployment.url}'s logs.`,
      `to return production to the previous deployment${previousDeploymentId ? ` (${previousDeploymentId}, ${previousSha})` : ""}: pnpm release:rollback --production-url ${productionUrl} (a dry run), then again with --yes.`,
    ],
  })
  for (const line of report.lines) {
    ;(report.exitCode === 0 ? console.log : console.error)(line)
  }
  if (report.exitCode !== 0) process.exit(report.exitCode)
  console.log("Next: commit both files.")
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
