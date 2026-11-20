import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { ESLint } from "eslint"
import ts from "typescript"

const baselineFile = "scripts/ci/quality-baseline.json"
const envFile = "lib/server/env.ts"
const options = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
const git = (...args) => execFileSync("git", args, options)
const pnpm = (...args) => execFileSync("pnpm", args, options)
const files = [
  ...new Set(
    git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split(
      "\0"
    )
  ),
]
  .filter(
    (f) =>
      /^(?:app|components|lib|scripts|tests)\//.test(f) &&
      /\.(?:[cm]?[jt]s|[jt]sx)$/.test(f) &&
      existsSync(f)
  )
  .sort()

function source(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visit(child, callback))
}

function isDefinition(node) {
  return (
    ts.isPropertyAssignment(node) &&
    ts.isCallExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.text === "featureFlag"
  )
}

function checkSources(add) {
  const flags = new Set()
  const used = new Set()
  visit(source(envFile), (node) => {
    if (isDefinition(node)) flags.add(node.name.getText())
  })
  if (!flags.size) throw new Error("No featureFlag definitions found")

  for (const path of files) {
    const tree = source(path)
    const excess = tree.text.replace(/\n$/, "").split(/\r?\n/).length - 500
    if (excess > 0) add("large-file/excess-lines", path, excess)
    const debt = tree.text.match(
      /^\s*(?:\/\/|\/\*+|\*)\s*(?:TODO|FIXME)\b(?!\s*\(#\d+\))/gm
    )
    if (debt?.length) add("debt/unlinked-marker", path, debt.length)

    const production = /^(app|components|lib)\//.test(path)
    const flagConsumer = !path.startsWith("tests/")
    visit(tree, (node) => {
      if (
        flagConsumer &&
        (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
        !(
          node.parent &&
          isDefinition(node.parent) &&
          node.parent.name === node
        ) &&
        flags.has(node.text)
      )
        used.add(node.text)

      if (
        production &&
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      ) {
        const pattern = ts.isFunctionDeclaration(node)
          ? /^[A-Za-z][A-Za-z0-9]*$/
          : /^[A-Z][A-Za-z0-9]*$/
        if (!pattern.test(node.name.text)) add("naming/declaration", path)
      }

      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const target = node.moduleSpecifier.text
        const resolved = target.startsWith("@/")
          ? target.slice(2)
          : target.startsWith(".")
            ? relative(".", join(path, "..", target))
            : target
        if (
          path.startsWith("lib/server/") &&
          /^(app|components)(\/|$)/.test(resolved)
        ) {
          add("boundaries/server-imports-ui", path)
        }
      }
    })
  }
  for (const flag of flags) if (!used.has(flag)) add("flags/no-consumer", flag)
  console.log(
    `Feature flag references: ${used.size}/${flags.size} have live consumers.`
  )
}

async function checkComplexity(add) {
  // Independent of the standard lint config and any inline rule overrides.
  const eslint = new ESLint({
    overrideConfigFile: true,
    allowInlineConfig: false,
    cache: true,
    cacheLocation: "node_modules/.cache/readiness-complexity/",
    overrideConfig: [
      {
        files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
        rules: { complexity: ["error", 15] },
      },
      {
        files: ["**/*.{ts,tsx,mts,cts,jsx}"],
        languageOptions: {
          parser: (await import("eslint-config-next/typescript")).default.find(
            (config) => config.languageOptions?.parser
          ).languageOptions.parser,
        },
        rules: { complexity: ["error", 15] },
      },
    ],
  })
  for (const result of await eslint.lintFiles(files)) {
    const path = relative(".", result.filePath)
    for (const message of result.messages) {
      if (message.ruleId !== "complexity")
        throw new Error(`${path}: ${message.message}`)
      const value = /has a complexity of (\d+)\./.exec(message.message)
      if (!value)
        throw new Error(`Unknown complexity message: ${message.message}`)
      add("complexity/excess-over-15", path, Number(value[1]) - 15)
    }
  }
}

function checkKnip(add) {
  const { files, issues } = JSON.parse(
    pnpm(
      "exec",
      "knip",
      "--reporter",
      "json",
      "--no-progress",
      "--no-exit-code",
      "--no-config-hints"
    )
  )
  for (const file of files) add("knip/files", file)
  for (const issue of issues) {
    for (const [kind, items] of Object.entries(issue)) {
      if (kind === "file" || kind === "owners") continue
      for (const item of Array.isArray(items)
        ? items
        : Object.values(items).flat()) {
        add(`knip/${kind}`, `${issue.file}: ${item.name}`)
      }
    }
  }
}

function checkDuplication(add) {
  const folder = mkdtempSync(join(tmpdir(), "naba-jscpd-"))
  try {
    pnpm("run", "quality:duplicates", "--output", folder)
    const {
      statistics: { total },
    } = JSON.parse(readFileSync(join(folder, "jscpd-report.json"), "utf8"))
    if (!(total.lines > 0)) throw new Error("jscpd checked no source")
    // Bound the absolute count as well as the percentage (basis points,
    // rounded up) so adding unrelated code cannot hide growth.
    if (total.duplicatedLines)
      add("jscpd/duplicate-lines", "repository", total.duplicatedLines)
    if (total.percentage)
      add(
        "jscpd/duplicate-percentage-bps",
        "repository",
        Math.ceil(total.percentage * 100)
      )
    console.log(
      `jscpd: ${total.duplicatedLines}/${total.lines} duplicate lines (${total.percentage}%).`
    )
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

function compare(before, after) {
  return Object.entries(after).flatMap(([key, amount]) =>
    amount > (before[key] ?? 0)
      ? [`${key}: ${before[key] ?? 0} → ${amount}`]
      : []
  )
}

const hits = new Map()
function add(rule, location, amount = 1) {
  const key = `${rule} | ${location}`
  hits.set(key, (hits.get(key) ?? 0) + amount)
}

checkSources(add)
console.log("Checking ESLint complexity.")
await checkComplexity(add)
console.log("Checking Knip's import and dependency graph.")
checkKnip(add)
console.log("Checking jscpd duplication.")
checkDuplication(add)
const current = Object.fromEntries(
  [...hits].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
)
const previous =
  existsSync(baselineFile) && JSON.parse(readFileSync(baselineFile, "utf8"))
const base = git("merge-base", "HEAD", "origin/main").trim()
const onMain = git("ls-tree", "--name-only", base, "--", baselineFile).trim()
const committed = onMain && JSON.parse(git("show", `${base}:${baselineFile}`))

const problems = [
  ...(committed ? compare(committed, previous || current) : []),
  ...(previous ? compare(previous, current) : []),
]
if (problems.length) {
  console.error(`Quality findings may only decrease:\n${problems.join("\n")}`)
  process.exitCode = 1
} else if (process.argv.includes("--record")) {
  writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Recorded ${hits.size} quality finding buckets.`)
} else if (!previous || compare(current, previous).length) {
  console.error(
    "Baseline missing or higher than current findings. Run pnpm check:quality --record."
  )
  process.exitCode = 1
} else {
  console.log(`Quality ratchet passed (${hits.size} existing finding buckets).`)
}
