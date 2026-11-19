// Browser-suite lanes for the release gate (scripts/release/verify-local.mjs
// e2e step). The suite runs on one Playwright worker per invocation
// (playwright.config.ts: journey state, no cross-spec CPU contention), so the
// gate splits it by spec file across several invocations instead. Each lane
// gets its own PostgreSQL cluster, app server, Google stub, journey tenant and
// output folder, so lanes share nothing but the build.
//
//   node scripts/ci/e2e-lanes.mjs weights <e2e.log> [...]
//     prints lane-weights.json from the per-test durations in gate e2e logs
//
// The plan comes from Playwright's own `--list`, so it covers exactly the
// tests a single `pnpm test:e2e` would run; the gate then checks that every
// lane ran exactly the tests planned for it (laneCountProblem).
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Lanes when neither --e2e-lanes nor NABA_GATE_E2E_LANES sets them. */
export const DEFAULT_E2E_LANES = 6

/** Seconds per test for a spec missing from lane-weights.json. */
export const UNKNOWN_SECONDS_PER_TEST = 2

/**
 * Tests per spec file from `playwright test --list --reporter=json`.
 * File names are relative to the test directory (tests/e2e).
 * @param {{ suites?: unknown[] }} report
 * @returns {Map<string, number>}
 */
export function countTestsByFile(report) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @param {any} suite @param {string | undefined} file */
  const walk = (suite, file) => {
    const own = suite.file ?? file
    for (const spec of suite.specs ?? []) {
      const specFile = spec.file ?? own
      if (!specFile) throw new Error("A listed test has no file")
      counts.set(specFile, (counts.get(specFile) ?? 0) + spec.tests.length)
    }
    for (const child of suite.suites ?? []) walk(child, own)
  }
  for (const suite of report.suites ?? []) walk(suite, undefined)
  return counts
}

/**
 * @typedef {{ index: number, files: string[], tests: number, seconds: number }} Lane
 */

/**
 * Spreads spec files over at most `laneCount` lanes so their expected
 * durations are as even as whole files allow: longest file first onto the
 * least-loaded lane (LPT). Files stay whole because the specs inside one file
 * run in order against shared fixtures. Deterministic for the same input;
 * empty lanes are dropped.
 * @param {Map<string, number>} counts tests per file
 * @param {Record<string, number>} weights seconds per file
 * @param {number} laneCount
 * @returns {Lane[]}
 */
export function planLanes(counts, weights, laneCount) {
  if (!Number.isInteger(laneCount) || laneCount < 1) {
    throw new Error("laneCount must be a whole number of at least 1")
  }
  const estimate = (file) =>
    weights[file] ?? (counts.get(file) ?? 0) * UNKNOWN_SECONDS_PER_TEST
  const files = [...counts.keys()].sort(
    (a, b) => estimate(b) - estimate(a) || a.localeCompare(b)
  )
  /** @type {Lane[]} */
  const lanes = Array.from({ length: laneCount }, (_, index) => ({
    index: index + 1,
    files: [],
    tests: 0,
    seconds: 0,
  }))
  for (const file of files) {
    const lane = lanes.reduce((best, next) =>
      next.seconds < best.seconds ? next : best
    )
    lane.files.push(file)
    lane.tests += counts.get(file) ?? 0
    lane.seconds += estimate(file)
  }
  return lanes
    .filter((lane) => lane.files.length > 0)
    .map((lane, index) => ({
      ...lane,
      index: index + 1,
      files: lane.files.sort(),
    }))
}

/**
 * Why a lane's Playwright summary does not account for exactly the tests
 * planned for it, or null. Catches a file filter that matched too much or
 * too little, and a run that stopped early.
 * @param {Lane} lane
 * @param {string[]} summary lines such as "40 passed (3.1m)", "1 flaky"
 */
export function laneCountProblem(lane, summary) {
  let ran = 0
  for (const line of summary) {
    const match = /^(\d+) (passed|failed|flaky|skipped|did not run)\b/.exec(
      line
    )
    if (match) ran += Number(match[1])
  }
  return ran === lane.tests
    ? null
    : `lane ${lane.index} accounted for ${ran} tests, planned ${lane.tests}`
}

/**
 * Waits for every lane, or, when failing fast, only until the first lane
 * that does not pass (the gate then stops the others with the rest of the
 * run). Resolves to the results that are in.
 * @template {{ code: number }} T
 * @param {Promise<T>[]} runs
 * @param {boolean} failFast
 * @returns {Promise<T[]>}
 */
export function settleLanes(runs, failFast) {
  if (!failFast) return Promise.all(runs)
  return new Promise((resolve, reject) => {
    /** @type {T[]} */
    const done = []
    for (const run of runs) {
      run.then((result) => {
        done.push(result)
        if (result.code !== 0 || done.length === runs.length) resolve(done)
      }, reject)
    }
    if (runs.length === 0) resolve(done)
  })
}

/**
 * Seconds per spec file from the per-test lines of gate e2e logs
 * (`✓  12 [project] › tests/e2e/foo.spec.ts:3:1 › title (1.2s)`).
 * @param {string} log
 * @returns {Record<string, number>}
 */
export function weightsFromLog(log) {
  /** @type {Record<string, number>} */
  const seconds = {}
  for (const line of log.split("\n")) {
    const match =
      /[✓✘]\s.*?tests\/e2e\/([\w.-]+\.spec\.ts):.*\(([\d.]+)(ms|s|m)\)\s*$/.exec(
        line
      )
    if (!match) continue
    const value =
      Number(match[2]) * (match[3] === "ms" ? 0.001 : match[3] === "m" ? 60 : 1)
    seconds[match[1]] = (seconds[match[1]] ?? 0) + value
  }
  return Object.fromEntries(
    Object.keys(seconds)
      .sort()
      .map((file) => [file, Math.max(1, Math.round(seconds[file]))])
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...logs] = process.argv.slice(2)
  if (command !== "weights" || logs.length === 0) {
    console.error("usage: e2e-lanes.mjs weights <e2e.log> [...]")
    process.exit(2)
  }
  const merged = {}
  for (const log of logs)
    Object.assign(merged, weightsFromLog(readFileSync(log, "utf8")))
  process.stdout.write(`${JSON.stringify(merged, null, 2)}\n`)
}
