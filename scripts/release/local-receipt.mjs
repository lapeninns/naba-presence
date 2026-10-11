// The local release gate's receipt: what `pnpm verify:release`
// (scripts/release/verify-local.mjs) writes and what `pnpm release:promote`
// (scripts/release/promote.mjs) requires in place of hosted checks. Pure, so
// both the writer and the reader are unit-tested
// (tests/server/release-verify-local.test.ts).

import { secretLikePaths, timestampedFileName } from "./receipt-safety.mjs"

export const LOCAL_RECEIPT_KIND = "naba-local-release-gate"
export const LOCAL_RECEIPT_VERSION = 2

/**
 * Gitignored: running the gate must not dirty the checkout that promotion
 * later requires to be clean. Promotion copies the receipt's digest and step
 * results into the committed promotion receipt.
 */
export const LOCAL_RECEIPTS_DIR = "docs/release/receipts/local"

/** Committed promotion receipts, `<UTC time>-<sha12>.json` (promote.mjs). */
export const PROMOTION_RECEIPTS_DIR = "docs/release/receipts"
const PROMOTION_RECEIPT_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{12}\.json$/

/**
 * Files whose uncommitted edits would change the gate's own behaviour: the
 * gate runs its logic (this module, verify-local.mjs, the redaction it
 * imports) from the invoking checkout, not from the worktree it tests.
 */
export const GATE_SOURCE_PATHS = [
  "scripts/release/",
  "scripts/ci/",
  "lib/domain/redaction.ts",
  "package.json",
  ".nvmrc",
]

/**
 * Every step of the CI-equivalent run, in the order it runs. `required:
 * false` steps may be skipped only because their tool is not installed (the
 * receipt says so); a failure in any step still fails the gate.
 */
export const GATE_STEPS = [
  {
    id: "frozen-install",
    title: "Frozen install (pnpm install --frozen-lockfile)",
    required: true,
  },
  { id: "typecheck", title: "Typecheck (pnpm typecheck)", required: true },
  { id: "lint", title: "Lint, zero warnings (pnpm lint)", required: true },
  { id: "unit", title: "Unit tests (pnpm test)", required: true },
  {
    id: "build",
    title: "Standalone build (pnpm build, webpack)",
    required: true,
  },
  {
    id: "migration-policy",
    title: "Migration policy against the base (append-only history)",
    required: true,
  },
  {
    id: "migrate-fresh",
    title: "Migrate from scratch, no-op re-run, runtime role, db:status",
    required: true,
  },
  {
    id: "migrate-upgrade",
    title: "Upgrade from the merge base matches from scratch",
    required: true,
  },
  {
    id: "migrate-concurrent",
    title: "Concurrent migrate runs serialise on the lock",
    required: true,
  },
  {
    id: "integration",
    title: "Integration tests (pnpm test:integration)",
    required: true,
  },
  {
    id: "e2e",
    title: "Browser journeys (pnpm test:e2e --forbid-only)",
    required: true,
  },
  {
    id: "audit",
    title: "Production dependency audit (pnpm audit --prod --audit-level high)",
    required: true,
  },
  {
    id: "secret-scan",
    title: "Secret scan (gitleaks, full history)",
    required: false,
  },
]

export const STEP_STATUSES = ["passed", "failed", "skipped", "not-run"]

const SHA_PATTERN = /^[0-9a-f]{40}$/

/**
 * The release production last received: the `sha` of the newest committed
 * promotion receipt (by file name, which sorts by time). Both the gate (its
 * default upgrade base) and promotion (the base it requires) read it, so a
 * receipt's migration policy and upgrade steps start from what production
 * runs. `null` before the first promotion. Throws on an unreadable newest
 * receipt rather than silently fall back to an older one.
 *
 * @param {{ name: string, content: string }[]} files
 * @returns {{ file: string, sha: string } | null}
 */
export function latestPromotedRelease(files) {
  const newest = files
    .map((file) => ({ ...file, name: file.name.split("/").pop() ?? "" }))
    .filter((file) => PROMOTION_RECEIPT_NAME.test(file.name))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))[0]
  if (!newest) return null
  let sha
  try {
    sha = JSON.parse(newest.content)?.sha
  } catch {
    sha = undefined
  }
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    throw new Error(
      `promotion receipt ${newest.name} has no readable commit SHA`
    )
  }
  return { file: newest.name, sha }
}

/**
 * Paths from `git status --porcelain` lines that fall under
 * GATE_SOURCE_PATHS (either side of a rename).
 * @param {string[]} lines
 */
export function gateSourceChanges(lines) {
  const changed = new Set()
  for (const line of lines) {
    for (const raw of line.slice(3).split(" -> ")) {
      const path = raw.trim().replace(/^"(.*)"$/, "$1")
      if (
        GATE_SOURCE_PATHS.some((prefix) =>
          prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix
        )
      ) {
        changed.add(path)
      }
    }
  }
  return [...changed].sort()
}

/**
 * @typedef {"passed" | "failed" | "skipped" | "not-run"} StepStatus
 * @typedef {{ id: string, status: StepStatus, durationMs: number,
 *   exitCode?: number | null, summary?: string[], note?: string }} StepResult
 */

/**
 * Whether a set of step results passes the gate: every step present once,
 * every required step passed, nothing failed, and optional steps either
 * passed or skipped.
 * @param {StepResult[]} steps
 */
export function gateProblems(steps) {
  const problems = []
  const byId = new Map()
  for (const step of steps ?? []) {
    if (!GATE_STEPS.some((known) => known.id === step?.id)) {
      problems.push(`unknown step "${step?.id}"`)
    } else if (byId.has(step.id)) {
      problems.push(`step "${step.id}" appears twice`)
    } else {
      byId.set(step.id, step)
    }
  }
  for (const { id, required } of GATE_STEPS) {
    const step = byId.get(id)
    if (!step) {
      problems.push(`step "${id}" is missing`)
    } else if (!STEP_STATUSES.includes(step.status)) {
      problems.push(`step "${id}" has status "${step.status}"`)
    } else if (step.status === "failed") {
      problems.push(`step "${id}" failed`)
    } else if (required && step.status !== "passed") {
      problems.push(`required step "${id}" ${step.status}`)
    } else if (!required && step.status === "not-run") {
      problems.push(`step "${id}" did not run`)
    }
  }
  return problems
}

/**
 * The receipt `verify:release` writes. Throws rather than return one that
 * carries anything redaction would touch.
 *
 * @param {{
 *   sha: string,
 *   base: { ref: string, sha: string, mergeBase: string, source: string },
 *   gateSource: { clean: boolean, changed: string[] },
 *   toolchain: Record<string, string | null>,
 *   steps: StepResult[],
 *   options: { skip: string[], failFast: boolean },
 *   startedAt: string,
 *   finishedAt: string,
 * }} input
 */
export function buildLocalReceipt({
  sha,
  base,
  gateSource,
  toolchain,
  steps,
  options,
  startedAt,
  finishedAt,
}) {
  const ordered = GATE_STEPS.map(({ id, title, required }) => {
    const step = steps.find((candidate) => candidate.id === id)
    return {
      id,
      title,
      required,
      status: step?.status ?? "not-run",
      durationMs: Math.round(step?.durationMs ?? 0),
      ...(step?.exitCode != null ? { exitCode: step.exitCode } : {}),
      ...(step?.summary?.length ? { summary: step.summary } : {}),
      ...(step?.note ? { note: step.note } : {}),
    }
  })
  const receipt = {
    kind: LOCAL_RECEIPT_KIND,
    version: LOCAL_RECEIPT_VERSION,
    sha,
    // The gate checks out the commit into a fresh git worktree: no .env
    // files, untracked files or local build output take part.
    mode: "worktree",
    base,
    // Uncommitted edits to the gate's own code in the invoking checkout:
    // the evidence would come from code that is not in the commit.
    gateSource,
    toolchain,
    options,
    ok: gateProblems(ordered).length === 0,
    steps: ordered,
    startedAt,
    finishedAt,
  }
  const leaks = secretLikePaths(receipt)
  if (leaks.length > 0) {
    throw new Error(
      `Refusing to write a local receipt with secret-like values at ${leaks.join(", ")}`
    )
  }
  return receipt
}

/** `20261010T120000Z-<sha12>.json`, by finish time. */
export function localReceiptFileName(receipt) {
  return timestampedFileName(receipt.finishedAt, receipt.sha)
}

/**
 * Why a local receipt cannot stand as promotion evidence for `sha`; empty
 * when it can. The receipt is re-judged from its steps, so a hand-edited
 * `ok: true` over a failed step does not pass. `previousSha` is the commit
 * the newest committed promotion receipt shipped (latestPromotedRelease), or
 * null before the first promotion; the receipt's base must be it, and in any
 * case must not be the commit itself, or the migration policy and upgrade
 * steps compared HEAD with itself.
 *
 * @param {unknown} receipt
 * @param {{ sha: string, nodeMajor: number, previousSha?: string | null }} expected
 * @returns {string[]}
 */
export function localReceiptProblems(
  receipt,
  { sha, nodeMajor, previousSha = null }
) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["the local receipt is not a JSON object"]
  }
  const value = /** @type {Record<string, any>} */ (receipt)
  if (
    value.kind !== LOCAL_RECEIPT_KIND ||
    value.version !== LOCAL_RECEIPT_VERSION
  ) {
    return [
      `the local receipt is not a ${LOCAL_RECEIPT_KIND} v${LOCAL_RECEIPT_VERSION} receipt`,
    ]
  }
  const problems = []
  if (!SHA_PATTERN.test(value.sha ?? "") || value.sha !== sha) {
    problems.push(
      `the local receipt is for ${String(value.sha).slice(0, 12)}, not ${sha.slice(0, 12)}`
    )
  }
  if (value.mode !== "worktree") {
    problems.push("the local receipt was not produced in a fresh worktree")
  }
  const base = value.base ?? {}
  if (
    !SHA_PATTERN.test(base.sha ?? "") ||
    !SHA_PATTERN.test(base.mergeBase ?? "")
  ) {
    problems.push("the local receipt records no base commit")
  } else {
    if (base.mergeBase === value.sha) {
      problems.push(
        "the local gate's merge base is the commit itself, so the migration policy and upgrade steps tested nothing: run verify:release with --base-ref <production SHA>"
      )
    }
    if (previousSha && base.sha !== previousSha) {
      problems.push(
        `the local gate's base is ${base.sha.slice(0, 12)}, not ${previousSha.slice(0, 12)}, the commit the newest promotion receipt shipped`
      )
    }
  }
  if (value.gateSource?.clean !== true) {
    const changed = Array.isArray(value.gateSource?.changed)
      ? value.gateSource.changed.join(", ")
      : "unknown"
    problems.push(
      `the local gate ran with uncommitted changes to its own sources (${changed})`
    )
  }
  const receiptNode = /^v?(\d+)\./.exec(value.toolchain?.node ?? "")
  if (!receiptNode || Number(receiptNode[1]) !== nodeMajor) {
    problems.push(
      `the local gate ran on Node ${value.toolchain?.node ?? "unknown"}, not Node ${nodeMajor}`
    )
  }
  if (Array.isArray(value.options?.skip) && value.options.skip.length > 0) {
    problems.push(
      `the local gate skipped steps on request: ${value.options.skip.join(", ")}`
    )
  }
  problems.push(...gateProblems(value.steps))
  if (value.ok !== true && problems.length === 0) {
    problems.push("the local receipt is not marked ok")
  }
  const leaks = secretLikePaths(value)
  if (leaks.length > 0) {
    problems.push(
      `the local receipt has secret-like values at ${leaks.join(", ")}`
    )
  }
  return problems
}
