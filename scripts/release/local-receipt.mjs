// The local release gate's receipt: what `pnpm verify:release`
// (scripts/release/verify-local.mjs) writes and what `pnpm release:promote`
// (scripts/release/promote.mjs) requires in place of hosted checks. Pure, so
// both the writer and the reader are unit-tested
// (tests/server/release-verify-local.test.ts).

import { secretLikePaths, timestampedFileName } from "./receipt-safety.mjs"

export const LOCAL_RECEIPT_KIND = "naba-local-release-gate"
// 3: steps run concurrently by their `needs`; adds the format, design,
// bundle-budget and workflow-lint steps.
export const LOCAL_RECEIPT_VERSION = 3

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
 * Every step of the CI-equivalent run, in receipt order. `needs` lists the
 * steps that must pass first: verify-local.mjs starts each step as soon as
 * its needs have passed, so independent steps run at the same time, and
 * `--serial` runs them one by one in this order (every need comes earlier).
 * `required: false` steps may be skipped only because their tool is not
 * installed (the receipt says so); a failure in any step still fails the
 * gate.
 */
export const GATE_STEPS = [
  {
    id: "frozen-install",
    title: "Frozen install (pnpm install --frozen-lockfile)",
    required: true,
    needs: [],
  },
  {
    id: "typecheck",
    title: "Typecheck (pnpm typecheck)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "lint",
    title: "Lint, zero warnings (pnpm lint)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "unit",
    title: "Unit and component tests (pnpm test)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    // The files this change touches must be Prettier-formatted (a ratchet:
    // about 775 older files are not). Compared with origin/main, the scope
    // of a pull request; on main itself there is nothing new to check.
    id: "format",
    title: "Formatting of changed files (scripts/format-changed.mjs)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "design",
    title:
      "Design ratchet and contrast (check:design --ratchet, check:contrast)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "build",
    title: "Standalone build (pnpm build, webpack)",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "bundle-budget",
    title: "First-load JS ceilings (tests/perf/route-js.mjs)",
    required: true,
    needs: ["build"],
  },
  {
    id: "migration-policy",
    title: "Migration policy against the base (append-only history)",
    required: true,
    needs: [],
  },
  {
    id: "migrate-fresh",
    title: "Migrate from scratch, no-op re-run, runtime role, db:status",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "migrate-upgrade",
    title: "Upgrade from the merge base matches from scratch",
    required: true,
    needs: ["migrate-fresh"],
  },
  {
    id: "migrate-concurrent",
    title: "Concurrent migrate runs serialise on the lock",
    required: true,
    needs: ["frozen-install"],
  },
  {
    id: "integration",
    title: "Integration tests (pnpm test:integration), sharded",
    required: true,
    needs: ["frozen-install", "build"],
  },
  {
    id: "e2e",
    title: "Browser journeys (pnpm test:e2e --forbid-only)",
    required: true,
    needs: ["frozen-install", "build"],
  },
  {
    id: "audit",
    title: "Production dependency audit (pnpm audit --prod --audit-level high)",
    required: true,
    needs: [],
  },
  {
    // Workflow injection, permissions and pinning, while CodeQL's `actions`
    // analysis cannot run (code scanning is unavailable on this private
    // repository). Optional: skipped, with a note, where the tools are not
    // installed (brew install actionlint zizmor); a finding still fails.
    id: "workflow-lint",
    title: "Workflow lint (actionlint, zizmor --offline)",
    required: false,
    needs: [],
  },
  {
    // Required since the SEC-13 follow-up: a receipt with no secret scan
    // (gitleaks not installed) no longer stands as promotion evidence.
    id: "secret-scan",
    title: "Secret scan (gitleaks, full history)",
    required: true,
    needs: [],
  },
]

/** route-js.mjs ceilings in gzip KB (tests/perf/budgets-baseline.json). */
export const BUNDLE_BUDGET_ARGS = Object.freeze([
  "--max-chunk",
  "70",
  "--max-shared",
  "400",
  "--max-route",
  "560",
])

/**
 * Test-running steps and what their receipt summary (verify-local.mjs
 * `summarizeOutput`) must show for a pass to count: an exit code of 0 with
 * nothing run (every integration file `describe.skip`s without RUN_DB_TESTS)
 * is not evidence. Integration may not skip anything either.
 */
export const TEST_COUNT_STEPS = {
  integration: { pattern: /^Tests (\d+) passed\b/, noSkips: true },
  e2e: { pattern: /^(\d+) passed\b/, noSkips: false },
}

/**
 * Why a passed test step's summary does not show tests ran; null when it
 * does.
 * @param {string} id
 * @param {unknown} summary
 */
export function testCountProblem(id, summary) {
  const rule =
    TEST_COUNT_STEPS[/** @type {keyof typeof TEST_COUNT_STEPS} */ (id)]
  if (!rule) return null
  const lines = Array.isArray(summary)
    ? summary.filter((line) => typeof line === "string")
    : []
  const counted = lines
    .map((line) => rule.pattern.exec(line))
    .find((match) => match !== null)
  if (!counted) return `step "${id}" passed but reported no test count`
  if (Number(counted[1]) === 0) return `step "${id}" passed with 0 tests run`
  if (rule.noSkips && /\bskipped\b/.test(counted.input)) {
    return `step "${id}" skipped tests (${counted.input})`
  }
  return null
}

export const STEP_STATUSES = ["passed", "failed", "skipped", "not-run"]

const SHA_PATTERN = /^[0-9a-f]{40}$/
const ROLLBACK_RECEIPT_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{12}\.rollback\.json$/

/**
 * The release production serves according to the receipts: the one rule the
 * gate (its default upgrade base), promotion (the base it requires), the
 * readiness probe's `--expect-promoted` and rollback (scripts/release/
 * rollback.mjs `planRollback`) share. Replays the promotion receipts
 * (`<UTC time>-<sha12>.json`) and rollback receipts (`….rollback.json`) in
 * file-name order, which is time order:
 *   - a promotion serves its release once written. `vercel promote` has
 *     succeeded by then, and its migrations were applied before it, so this
 *     holds whatever its `productionProbe` says (`pending` after an
 *     interrupted promotion, or `ok: false`).
 *   - a rollback serves its target only when its production probe confirmed
 *     the target's SHA (`productionProbe.ok` and `servedSha`). A rollback
 *     whose probe failed stays on record but changes nothing: production may
 *     still serve the release it tried to leave, and the next rollback retries.
 * Returns the promotion receipt of the serving release (`file`) and its
 * `sha`; `null` before the first promotion. Pure. Throws, rather than fall
 * back to an older release, on any receipt it cannot read and on a rollback
 * that names no earlier promotion receipt.
 *
 * @param {{ name: string, content: string }[]} files
 * @returns {{ file: string, sha: string } | null}
 */
export function servingRelease(files) {
  const receipts = files
    .map((file) => ({ ...file, name: file.name.split("/").pop() ?? "" }))
    .filter(
      (file) =>
        PROMOTION_RECEIPT_NAME.test(file.name) ||
        ROLLBACK_RECEIPT_NAME.test(file.name)
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  /** @type {Map<string, string>} promotion receipt file -> sha */
  const promoted = new Map()
  /** @type {{ file: string, sha: string } | null} */
  let serving = null
  for (const receipt of receipts) {
    let parsed
    try {
      parsed = JSON.parse(receipt.content)
    } catch {
      parsed = undefined
    }
    if (PROMOTION_RECEIPT_NAME.test(receipt.name)) {
      const sha = parsed?.sha
      if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
        throw new Error(
          `promotion receipt ${receipt.name} has no readable commit SHA`
        )
      }
      promoted.set(receipt.name, sha)
      serving = { file: receipt.name, sha }
      continue
    }
    const target = parsed?.to?.receipt
    const sha = typeof target === "string" ? promoted.get(target) : undefined
    if (parsed?.kind !== "naba-rollback" || sha === undefined) {
      throw new Error(
        `rollback receipt ${receipt.name} names no earlier promotion receipt`
      )
    }
    const probe = parsed.productionProbe
    if (probe?.ok === true && probe.servedSha === sha) {
      serving = { file: /** @type {string} */ (target), sha }
    }
  }
  return serving
}

/**
 * The release production last received, for the gate's default base and
 * promotion's required base: `servingRelease`, under the name the gate
 * (verify-local.mjs) imports.
 *
 * @param {{ name: string, content: string }[]} files
 * @returns {{ file: string, sha: string } | null}
 */
export function latestPromotedRelease(files) {
  return servingRelease(files)
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
 * every required step passed, nothing failed, optional steps either passed
 * or skipped, and the test steps show that tests actually ran
 * (testCountProblem).
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
    } else if (
      step.status === "passed" &&
      testCountProblem(id, step.summary) !== null
    ) {
      problems.push(/** @type {string} */ (testCountProblem(id, step.summary)))
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
