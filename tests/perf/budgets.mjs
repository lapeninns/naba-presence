// Budget check for tests/perf/perf-lab.mjs results.
//
//   node tests/perf/budgets.mjs <perf-mobile.json> [--budgets tests/perf/budgets.json]
//
// Also used by perf-lab.mjs --budgets. A budget file holds, per profile, a
// `default` limit set and `routes` overrides keyed by the route template
// (e.g. "/listings/{loc}/hours"). Limits are maxima on the run medians:
// times in ms, `cls` unitless, `*Transfer`/`*Decoded` keys in KB (1024 B),
// counts as counts. Keys starting with "_" are comments. Exits 1 on any
// breach.
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const isBytes = (key) => /transfer$|decoded$/i.test(key)

export function checkBudgets(summary, budgets, profile) {
  const limits = budgets[profile] ?? {}
  const breaches = []
  for (const row of summary) {
    const own = { ...limits.default, ...(limits.routes?.[row.route] ?? {}) }
    for (const [key, max] of Object.entries(own)) {
      if (key.startsWith("_") || max === null) continue
      const raw = row[key]
      if (raw === null || raw === undefined) continue
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
  const breaches = checkBudgets(result.summary, budgets, result.profile)
  console.log(
    breaches.length
      ? `${breaches.length} budget breach(es) for ${result.profile} against ${budgetsPath}:\n${breaches.map((b) => `- ${b}`).join("\n")}`
      : `All ${result.profile} budgets in ${budgetsPath} met.`
  )
  if (breaches.length) process.exitCode = 1
}
