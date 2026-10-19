// Budget check for tests/perf/perf-lab.mjs results.
//
//   node tests/perf/budgets.mjs <perf-mobile.json> [--budgets tests/perf/budgets.json]
//
// Also used by perf-lab.mjs --budgets. A budget file holds, per profile, a
// `default` limit set and `routes` overrides keyed by the route template
// (e.g. "/listings/{loc}/hours"). Limits are maxima on the run medians:
// times in ms, `cls` unitless, `*Transfer`/`*Decoded` keys in KB (1024 B),
// counts as counts. Keys starting with "_" are comments. Exits 1 on any
// breach, missing required metric or invalid saved measurement.
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { measurementProblems } from "./lab-results.mjs"

const isBytes = (key) => /transfer$|decoded$/i.test(key)

export function checkBudgets(summary, budgets, profile) {
  const limits = budgets[profile]
  if (!limits?.default || typeof limits.default !== "object")
    return [`No default budgets configured for ${profile}`]
  if (!Array.isArray(summary) || !summary.length)
    return ["No route measurements to check"]
  const breaches = []
  for (const row of summary) {
    if (row.valid === false)
      breaches.push(`${row.route}: measurement qualification failed`)
    const own = { ...limits.default, ...(limits.routes?.[row.route] ?? {}) }
    for (const [key, max] of Object.entries(own)) {
      if (key.startsWith("_") || max === null) continue
      if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
        breaches.push(`${row.route}: invalid budget for ${key}`)
        continue
      }
      const raw = row[key]
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
        breaches.push(`${row.route}: required metric ${key} unavailable`)
        continue
      }
      const value = isBytes(key) ? raw / 1024 : raw
      if (value > max) {
        const shown = key === "cls" ? value.toFixed(3) : Math.round(value)
        breaches.push(
          `${row.route}: ${key} ${shown}${isBytes(key) ? " KB" : ""} > ${max}`
        )
      }
    }
  }
  return breaches
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2)
  const index = argv.indexOf("--budgets")
  const budgetsPath = index === -1 ? "tests/perf/budgets.json" : argv[index + 1]
  const resultPath = argv.find(
    (a, i) => !a.startsWith("--") && argv[i - 1] !== "--budgets"
  )
  if (!resultPath)
    throw new Error(
      "Usage: node tests/perf/budgets.mjs <perf-<profile>.json> [--budgets file]"
    )
  const result = JSON.parse(await readFile(resolve(resultPath), "utf8"))
  const budgets = JSON.parse(await readFile(resolve(budgetsPath), "utf8"))
  const invalid = measurementProblems(result)
  const breaches = checkBudgets(result.summary, budgets, result.profile)
  if (invalid.length)
    console.error(
      `Invalid measurement (${invalid.length}):\n${invalid.map((problem) => `- ${problem}`).join("\n")}`
    )
  console.log(
    breaches.length
      ? `${breaches.length} budget breach(es) for ${result.profile} against ${budgetsPath}:\n${breaches.map((b) => `- ${b}`).join("\n")}`
      : invalid.length
        ? "Numeric medians are within budget, but the measurement is invalid."
        : `All ${result.profile} budgets in ${budgetsPath} met.`
  )
  if (breaches.length || invalid.length) process.exitCode = 1
}
