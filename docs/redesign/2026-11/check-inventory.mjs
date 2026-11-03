// Proves INVENTORY.md is the complete coverage contract for app/:
//
//   node docs/redesign/2026-11/check-inventory.mjs [--manifest <dir>/manifest.json]
//
// 1. Every route file under app/ outside app/api (page, layout, template,
//    default, loading, error, global-error, not-found, forbidden,
//    unauthorized, route) must appear in INVENTORY.md as a backticked
//    repo-relative path.
// 2. Every app/api group (first segment) must appear as `app/api/<group>/`
//    in the API summary.
// 3. Every INVENTORY row id (R01..) is unique and numbered without gaps.
// 4. With --manifest (an nm-capture manifest), every page route row whose
//    `capture` cell names shots has an `ok` (or `state-not-reached` for a
//    state) shot at phone, tablet and desktop in light.
//
// Exits 1 and lists what is missing; 0 when complete. Reads only.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")
const inventory = readFileSync(join(here, "INVENTORY.md"), "utf8")

const ROUTE_FILE =
  /^(page|layout|template|default|loading|error|global-error|not-found|forbidden|unauthorized)\.(tsx|ts|jsx|js)$|^route\.(ts|js)$/

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [relative(root, path)]
  })
}

const files = walk(join(root, "app"))
const routeFiles = files
  .filter((file) => !file.startsWith("app/api/"))
  .filter((file) => ROUTE_FILE.test(file.split("/").pop()))
  .sort()
const apiGroups = [
  ...new Set(
    files
      .filter(
        (file) => file.startsWith("app/api/") && file.endsWith("route.ts")
      )
      .map((file) => file.split("/")[2])
  ),
].sort()

const mentioned = new Set(
  [...inventory.matchAll(/`([^`\s]+)`/g)].map((match) => match[1])
)
const missingRoutes = routeFiles.filter((file) => !mentioned.has(file))
const missingApi = apiGroups.filter(
  (group) => !inventory.includes(`app/api/${group}/`)
)

const ids = [...inventory.matchAll(/^\|\s*(R\d{2,3})\s*\|/gm)].map(
  (match) => match[1]
)
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
const gaps = ids
  .map((id) => Number(id.slice(1)))
  .filter((n, index, all) => index > 0 && n !== all[index - 1] + 1)
  .map((n) => `R${String(n).padStart(2, "0")}`)

const problems = []
if (missingRoutes.length)
  problems.push(
    `Route files not in INVENTORY.md (${missingRoutes.length}):\n  ${missingRoutes.join("\n  ")}`
  )
if (missingApi.length)
  problems.push(
    `app/api groups not summarised (${missingApi.length}): ${missingApi.join(", ")}`
  )
if (duplicateIds.length)
  problems.push(`Duplicate row ids: ${[...new Set(duplicateIds)].join(", ")}`)
if (gaps.length) problems.push(`Row numbering jumps before: ${gaps.join(", ")}`)

const argv = process.argv.slice(2)
const manifestAt = argv.indexOf("--manifest")
let captureSummary = ""
if (manifestAt !== -1) {
  const manifest = JSON.parse(
    readFileSync(resolve(argv[manifestAt + 1]), "utf8")
  )
  // Capture cells look like: capture: `inbox`, `state--inbox-selected`.
  const shots = new Map()
  for (const entry of manifest.entries) {
    if (entry.theme !== "light") continue
    const good =
      entry.status === "ok" ||
      (entry.state && entry.status === "state-not-reached")
    if (!good) continue
    if (!shots.has(entry.name)) shots.set(entry.name, new Set())
    shots.get(entry.name).add(entry.viewport)
  }
  const wanted = [
    ...inventory.matchAll(/^\|\s*(R\d{2,3})\s*\|.*\|\s*page\s*\|.*$/gm),
  ].flatMap((match) =>
    [...match[0].matchAll(/shot:`([^`]+)`/g)].map((shot) => [match[1], shot[1]])
  )
  const short = []
  for (const [id, name] of wanted) {
    const have = shots.get(name) ?? new Set()
    const lacking = ["phone", "tablet", "desktop"].filter((v) => !have.has(v))
    if (lacking.length) short.push(`${id} ${name}: ${lacking.join(", ")}`)
  }
  if (short.length)
    problems.push(
      `Page shots missing at phone/tablet/desktop (${short.length}):\n  ${short.join("\n  ")}`
    )
  captureSummary = `, ${wanted.length} page shots checked against ${manifestAt === -1 ? "-" : argv[manifestAt + 1]}`
}

console.log(
  `check-inventory: ${routeFiles.length} route files, ${apiGroups.length} api groups, ${ids.length} rows${captureSummary}`
)
if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log("check-inventory: complete")
