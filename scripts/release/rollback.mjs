#!/usr/bin/env node
// Production rollback to an earlier promotion (NP4 G02; docs/runbook.md,
// "Database migrations are roll-forward-only").
//
// Usage, from a checkout whose docs/release/receipts/ holds every committed
// promotion receipt (and any receipt not yet committed), with the Vercel
// project linked:
//   READINESS_PROBE_TOKEN=... pnpm release:rollback \
//     --production-url https://<production origin> \
//     [--to <receipt file | deploymentId>] [--database-restored] [--yes] \
//     [--receipts-dir <dir>]
//
// A dry run is the default: it prints what production serves according to
// the receipts, the deployment it would return to and every command, and
// executes nothing. Only `--yes` acts:
//   1. `vercel promote <deploymentId> --yes --timeout 5m` for the target's
//      deployment (built from its own commit, with its own NABA_RELEASE_SHA),
//   2. the production probe promote.mjs runs after a promotion
//      (`verifyProduction`), expecting the target's SHA,
//   3. a rollback receipt beside the promotion receipts,
//      `<UTC time>-<target sha12>.rollback.json`, written whatever the probe
//      said, since production has changed. Exit 3 when production does not
//      serve the target's SHA.
//
// What production serves is the last event in the receipts, sorted by time:
// a promotion receipt's deployment, or a rollback receipt's target. The
// default target is the promotion before the one serving. `--to` picks any
// other promotion receipt by file name or deploymentId.
//
// Migrations are roll-forward-only, and a deployment rollback cannot undo
// one. Each promotion receipt lists every migration its commit ships, and
// promotion refused unless production had none pending, so the newest
// promotion's list is the production schema (unless a later rollback
// recorded `--database-restored`). When the target ships a different set,
// this script refuses: restoring the database is a manual runbook step
// (restore the snapshot taken before the migration). Rerun with
// `--database-restored` once the database matches the target; the flag is
// recorded in the rollback receipt.
//
// The decision is the pure `planRollback`; `runRollback` is the whole CLI
// with the file system, Vercel CLI, probe and clock injected (unit-tested in
// tests/server/release-rollback.test.ts with all of them mocked). `main()`
// only wires the real ones.

import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { PROMOTION_RECEIPTS_DIR } from "./local-receipt.mjs"
import {
  PRODUCTION_PROBE_ATTEMPTS,
  describeProbeAttempt,
  productionProbeArgs,
  productionProbeReport,
  promoteArgs,
  resolveProductionUrl,
  spawnReadinessProbe,
  verifyProduction,
} from "./promote.mjs"
import { secretLikePaths, timestampedFileName } from "./receipt-safety.mjs"

export const ROLLBACK_RECEIPT_KIND = "naba-rollback"
export const ROLLBACK_RECEIPT_VERSION = 1

export const EXIT = { ok: 0, refused: 1, usage: 64 }

const SHA_PATTERN = /^[0-9a-f]{40}$/
const PROMOTION_RECEIPT_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{12}\.json$/
const ROLLBACK_RECEIPT_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{12}\.rollback\.json$/

/**
 * @typedef {{ version: string, sha256: string }} Migration
 * @typedef {{ file: string, sha: string, deploymentId: string, url: string,
 *   migrations: Migration[] | null }} Promotion
 * @typedef {{ file: string, to: { receipt: string, deploymentId: string },
 *   databaseRestored: boolean }} Rollback
 * @typedef {{ notInTarget: string[], notInProduction: string[],
 *   changed: string[] }} MigrationDrift
 */

export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {{ yes: boolean, to: string | null, productionUrl: string | null,
 *   receiptsDir: string | null, databaseRestored: boolean }}
 */
export function parseRollbackArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv
  const options = {
    yes: false,
    dryRun: false,
    to: null,
    productionUrl: null,
    receiptsDir: null,
    databaseRestored: false,
  }
  const value = (index, flag) => {
    const next = args[index + 1]
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`)
    }
    return next
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--yes") options.yes = true
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--database-restored") options.databaseRestored = true
    else if (arg === "--to") options.to = value(index++, arg)
    else if (arg === "--production-url")
      options.productionUrl = value(index++, arg)
    else if (arg === "--receipts-dir") options.receiptsDir = value(index++, arg)
    else throw new UsageError(`unknown argument: ${arg}`)
  }
  if (options.yes && options.dryRun) {
    throw new UsageError("use --yes or --dry-run, not both")
  }
  return {
    yes: options.yes,
    to: options.to,
    productionUrl: options.productionUrl,
    receiptsDir: options.receiptsDir,
    databaseRestored: options.databaseRestored,
  }
}

/**
 * The promotion and rollback receipts in a receipts directory listing.
 * Other files (the `.local.json` copies, README.md) are ignored. A receipt
 * that cannot be read is a problem, never silently skipped: it could be the
 * one production serves.
 *
 * @param {{ name: string, content: string }[]} files
 * @returns {{ promotions: Promotion[], rollbacks: Rollback[], problems: string[] }}
 */
export function readReceiptHistory(files) {
  /** @type {Promotion[]} */
  const promotions = []
  /** @type {Rollback[]} */
  const rollbacks = []
  const problems = []
  for (const { name, content } of files) {
    const file = name.split("/").pop() ?? ""
    const isPromotion = PROMOTION_RECEIPT_NAME.test(file)
    const isRollback = ROLLBACK_RECEIPT_NAME.test(file)
    if (!isPromotion && !isRollback) continue
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      problems.push(`${file} is not valid JSON`)
      continue
    }
    if (isPromotion) {
      if (
        typeof parsed?.sha !== "string" ||
        !SHA_PATTERN.test(parsed.sha) ||
        typeof parsed.deploymentId !== "string" ||
        parsed.deploymentId.length === 0
      ) {
        problems.push(`${file} has no readable sha and deploymentId`)
        continue
      }
      promotions.push({
        file,
        sha: parsed.sha,
        deploymentId: parsed.deploymentId,
        url: typeof parsed.url === "string" ? parsed.url : "",
        migrations: Array.isArray(parsed.migrations)
          ? parsed.migrations.map((migration) => ({
              version: String(migration?.version),
              sha256: String(migration?.sha256),
            }))
          : null,
      })
    } else {
      if (
        parsed?.kind !== ROLLBACK_RECEIPT_KIND ||
        typeof parsed.to?.receipt !== "string" ||
        typeof parsed.to?.deploymentId !== "string"
      ) {
        problems.push(`${file} is not a readable rollback receipt`)
        continue
      }
      rollbacks.push({
        file,
        to: {
          receipt: parsed.to.receipt,
          deploymentId: parsed.to.deploymentId,
        },
        databaseRestored: parsed.migrations?.databaseRestored === true,
      })
    }
  }
  const byName = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
  promotions.sort(byName)
  rollbacks.sort(byName)
  return { promotions, rollbacks, problems }
}

/**
 * Migrations production has applied that the target does not ship, ones the
 * target ships that production has not applied, and versions whose file
 * changed between the two. Any of them means the deployment alone cannot
 * return production to the target's state.
 * @param {Migration[]} production
 * @param {Migration[]} target
 * @returns {MigrationDrift}
 */
export function migrationDrift(production, target) {
  const productionByVersion = new Map(
    production.map((migration) => [migration.version, migration.sha256])
  )
  const targetByVersion = new Map(
    target.map((migration) => [migration.version, migration.sha256])
  )
  return {
    notInTarget: [...productionByVersion.keys()].filter(
      (version) => !targetByVersion.has(version)
    ),
    notInProduction: [...targetByVersion.keys()].filter(
      (version) => !productionByVersion.has(version)
    ),
    changed: [...targetByVersion].flatMap(([version, sha256]) =>
      productionByVersion.has(version) &&
      productionByVersion.get(version) !== sha256
        ? [version]
        : []
    ),
  }
}

/** @param {MigrationDrift} drift */
function hasDrift(drift) {
  return (
    drift.notInTarget.length > 0 ||
    drift.notInProduction.length > 0 ||
    drift.changed.length > 0
  )
}

/** @param {string[]} versions */
function listVersions(versions) {
  const shown = versions.slice(0, 5).join(", ")
  return versions.length > 5
    ? `${shown} and ${versions.length - 5} more`
    : shown
}

/**
 * What to roll back to, and whether that is safe. Pure: the caller reads the
 * receipts.
 *
 * @param {{
 *   promotions: Promotion[],
 *   rollbacks: Rollback[],
 *   to?: string | null,
 *   databaseRestored?: boolean,
 * }} input
 * @returns {{ ok: boolean, problems: string[], current: Promotion | null,
 *   target: Promotion | null, drift: MigrationDrift | null }}
 */
export function planRollback({
  promotions,
  rollbacks,
  to = null,
  databaseRestored = false,
}) {
  const problems = []
  const refuse = (current = null, target = null, drift = null) => ({
    ok: false,
    problems,
    current,
    target,
    drift,
  })
  if (promotions.length === 0) {
    problems.push(
      "no promotion receipts: nothing records what production serves or what to return to"
    )
    return refuse()
  }

  // Replay the history: each promotion, and each rollback to a promotion.
  const byFile = new Map(
    promotions.map((promotion) => [promotion.file, promotion])
  )
  const events = [
    ...promotions.map((promotion) => ({ file: promotion.file, promotion })),
    ...rollbacks.map((rollback) => ({ file: rollback.file, rollback })),
  ].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  /** @type {Promotion | null} */
  let current = null
  /** @type {Migration[] | null} */
  let schema = null
  for (const event of events) {
    if ("promotion" in event) {
      current = event.promotion
      schema = event.promotion.migrations
      continue
    }
    const rolledTo = byFile.get(event.rollback.to.receipt)
    if (!rolledTo || rolledTo.deploymentId !== event.rollback.to.deploymentId) {
      problems.push(
        `${event.rollback.file} rolls back to ${event.rollback.to.receipt} (${event.rollback.to.deploymentId}), which no promotion receipt here matches`
      )
      return refuse()
    }
    current = rolledTo
    if (event.rollback.databaseRestored) schema = rolledTo.migrations
  }
  current = /** @type {Promotion} */ (current)

  /** @type {Promotion | null} */
  let target = null
  if (to) {
    const wanted = to.split("/").pop() ?? to
    target =
      promotions.find(
        (promotion) =>
          promotion.file === wanted ||
          promotion.file === `${wanted}.json` ||
          promotion.deploymentId === to
      ) ?? null
    if (!target) {
      problems.push(`--to ${to} matches no promotion receipt or deploymentId`)
      return refuse(current)
    }
  } else {
    const index = promotions.indexOf(current)
    target = index > 0 ? promotions[index - 1] : null
    if (!target) {
      problems.push(
        `${current.file} is the earliest promotion receipt: there is no earlier promotion to return to`
      )
      return refuse(current)
    }
  }
  if (target.deploymentId === current.deploymentId) {
    problems.push(
      `production already serves ${target.deploymentId} (${target.file})`
    )
    return refuse(current, target)
  }

  // Without both lists there is nothing to compare, and --database-restored
  // cannot stand in for the comparison.
  if (!schema || !target.migrations) {
    problems.push(
      `cannot compare migrations: ${!schema ? "the receipt production's schema comes from" : target.file} records none`
    )
    return refuse(current, target)
  }
  const drift = migrationDrift(schema, target.migrations)
  if (hasDrift(drift) && !databaseRestored) {
    if (drift.notInTarget.length > 0) {
      problems.push(
        `production's database has ${drift.notInTarget.length} migration(s) ${target.file} does not ship (${listVersions(drift.notInTarget)}); a deployment rollback cannot undo a migration`
      )
    }
    if (drift.notInProduction.length > 0) {
      problems.push(
        `${target.file} ships ${drift.notInProduction.length} migration(s) production has not applied (${listVersions(drift.notInProduction)})`
      )
    }
    if (drift.changed.length > 0) {
      problems.push(
        `${drift.changed.length} migration file(s) differ between production and ${target.file} (${listVersions(drift.changed)})`
      )
    }
    problems.push(
      "database rollback is a manual runbook step (docs/runbook.md: restore the snapshot taken before the migration); once the database matches the target, rerun with --database-restored"
    )
  }
  return {
    ok: problems.length === 0,
    problems,
    current,
    target,
    drift,
  }
}

/**
 * The rollback receipt, refusing anything redaction would touch.
 * @param {{
 *   current: Promotion,
 *   target: Promotion,
 *   drift: MigrationDrift | null,
 *   databaseRestored: boolean,
 *   productionProbe: import("./promote.mjs").ProductionVerification,
 *   operator: string,
 *   timestamp: string,
 * }} input
 */
export function buildRollbackReceipt({
  current,
  target,
  drift,
  databaseRestored,
  productionProbe,
  operator,
  timestamp,
}) {
  const receipt = {
    kind: ROLLBACK_RECEIPT_KIND,
    version: ROLLBACK_RECEIPT_VERSION,
    // What production serves after the rollback.
    sha: target.sha,
    deploymentId: target.deploymentId,
    url: target.url,
    to: {
      receipt: target.file,
      sha: target.sha,
      deploymentId: target.deploymentId,
    },
    from: {
      receipt: current.file,
      sha: current.sha,
      deploymentId: current.deploymentId,
    },
    migrations: {
      databaseRestored,
      drift: drift ?? { notInTarget: [], notInProduction: [], changed: [] },
    },
    productionProbe,
    operator,
    timestamp,
  }
  const leaks = secretLikePaths(receipt)
  if (leaks.length > 0) {
    throw new Error(
      `Refusing to write a rollback receipt with secret-like values at ${leaks.join(", ")}`
    )
  }
  return receipt
}

/** `20261010T120000Z-<target sha12>.rollback.json`, beside the promotions. */
export function rollbackReceiptFileName(receipt) {
  return timestampedFileName(receipt.timestamp, receipt.sha).replace(
    /\.json$/,
    ".rollback.json"
  )
}

/**
 * The whole command, with everything that touches the world injected.
 * Returns the exit code: 0 done (or a dry run with nothing refused), 1
 * refused, 3 production does not serve the target after the rollback, 64
 * usage error.
 *
 * @param {{
 *   argv: string[],
 *   env: Record<string, string | undefined>,
 *   receiptsDir: string,
 *   listReceipts: (dir: string) => { name: string, content: string }[],
 *   promote: (deploymentId: string) => Promise<void> | void,
 *   probe: (url: string, sha: string) => Promise<import("./promote.mjs").ProbeResult> | import("./promote.mjs").ProbeResult,
 *   writeReceipt: (path: string, content: string) => void,
 *   operator: () => string,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => Date,
 *   retryMs?: number,
 * }} io
 * @returns {Promise<number>}
 */
export async function runRollback({
  argv,
  env,
  receiptsDir: defaultReceiptsDir,
  listReceipts,
  promote,
  probe,
  writeReceipt,
  operator,
  log = console.log,
  error = console.error,
  sleep,
  now = () => new Date(),
  retryMs,
}) {
  let options
  try {
    options = parseRollbackArgs(argv)
  } catch (failure) {
    if (failure instanceof UsageError) {
      error(`release:rollback: ${failure.message}`)
      return EXIT.usage
    }
    throw failure
  }
  const receiptsDir = options.receiptsDir ?? defaultReceiptsDir

  let files
  try {
    files = listReceipts(receiptsDir)
  } catch (failure) {
    error(
      `refused: cannot read ${receiptsDir}: ${failure instanceof Error ? failure.message : failure}`
    )
    return EXIT.refused
  }
  const history = readReceiptHistory(files)
  const plan = planRollback({
    promotions: history.promotions,
    rollbacks: history.rollbacks,
    to: options.to,
    databaseRestored: options.databaseRestored,
  })
  const production = resolveProductionUrl(options.productionUrl, env)
  const problems = [
    ...history.problems.map((problem) => `receipts: ${problem}`),
    ...plan.problems,
    ...(production.problem ? [production.problem] : []),
    ...(!env.READINESS_PROBE_TOKEN && !env.CRON_SECRET
      ? [
          "set READINESS_PROBE_TOKEN to production's CRON_SECRET, so the probe can confirm production serves the target",
        ]
      : []),
  ]

  const { current, target } = plan
  if (current) {
    log(
      `production serves (per the receipts): ${current.deploymentId} at ${current.sha} (${current.file})`
    )
  }
  if (target) {
    log(
      `roll back to: ${target.deploymentId} at ${target.sha} (${target.file})`
    )
  }
  if (plan.drift && options.databaseRestored) {
    log(
      "migrations: --database-restored given; the operator confirms the database matches the target (recorded in the receipt)"
    )
  } else if (plan.drift && !hasDrift(plan.drift)) {
    log("migrations: production's and the target's are identical")
  }
  if (target) {
    const url = production.url ?? "<production origin>"
    log(
      `${options.yes ? "Will" : "Dry run: would"} run vercel ${promoteArgs(target.deploymentId).join(" ")}`
    )
    log(
      `${options.yes ? "Then" : "Dry run: then"} node scripts/ops/readiness-probe.mjs ${productionProbeArgs(url, target.sha).join(" ")}, up to ${PRODUCTION_PROBE_ATTEMPTS} attempts`
    )
    log(
      `${options.yes ? "Then" : "Dry run: then"} write ${join(receiptsDir, `<UTC time>-${target.sha.slice(0, 12)}.rollback.json`)}`
    )
  }

  if (
    problems.length > 0 ||
    !plan.ok ||
    !current ||
    !target ||
    !production.url
  ) {
    for (const problem of problems) error(`refused: ${problem}`)
    return EXIT.refused
  }
  if (!options.yes) {
    log("Dry run: nothing executed. Rerun with --yes to roll back.")
    return EXIT.ok
  }

  try {
    await promote(target.deploymentId)
  } catch (failure) {
    error(
      `vercel promote ${target.deploymentId} failed: ${failure instanceof Error ? failure.message : failure}. Production may still serve ${current.deploymentId}; check vercel promote status. No receipt written.`
    )
    return EXIT.refused
  }
  log(`Promoted ${target.deploymentId} (${target.sha}) back to production`)
  const productionProbe = await verifyProduction({
    url: production.url,
    sha: target.sha,
    probe,
    onAttempt: (attempt, result) =>
      (result.exitCode === 0 ? log : error)(
        describeProbeAttempt(attempt, result)
      ),
    ...(sleep ? { sleep } : {}),
    ...(retryMs !== undefined ? { retryMs } : {}),
    now,
  })
  const receipt = buildRollbackReceipt({
    current,
    target,
    drift: plan.drift,
    databaseRestored: options.databaseRestored,
    productionProbe,
    operator: operator(),
    timestamp: now().toISOString(),
  })
  const receiptPath = join(receiptsDir, rollbackReceiptFileName(receipt))
  writeReceipt(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  log(`Rollback receipt: ${receiptPath}`)
  const report = productionProbeReport(productionProbe, {
    nextSteps: [
      "the rollback receipt records the failed probe; commit it whatever you decide next.",
      `check vercel promote status and the production domains; ${target.url || target.deploymentId} is the deployment they should reach.`,
    ],
  })
  for (const line of report.lines) (report.exitCode === 0 ? log : error)(line)
  if (report.exitCode !== 0) return report.exitCode
  log(
    `Next: commit the rollback receipt, and read the deployed cron list back against ${target.sha.slice(0, 12)}'s vercel.json (Instant Rollback is not known to restore crons, ledger OPS-09).`
  )
  return EXIT.ok
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim()
  return runRollback({
    argv: process.argv.slice(2),
    env: process.env,
    receiptsDir: join(root, PROMOTION_RECEIPTS_DIR),
    listReceipts: (dir) =>
      readdirSync(resolve(root, dir))
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({
          name,
          content: readFileSync(join(resolve(root, dir), name), "utf8"),
        })),
    promote: (deploymentId) => {
      run("vercel", promoteArgs(deploymentId))
    },
    probe: spawnReadinessProbe(root),
    writeReceipt: (path, content) => {
      mkdirSync(dirname(resolve(root, path)), { recursive: true })
      writeFileSync(resolve(root, path), content)
    },
    operator: () => run("git", ["config", "user.name"]),
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((failure) => {
      console.error(`release:rollback failed: ${failure?.message ?? failure}`)
      process.exitCode = 1
    })
}
