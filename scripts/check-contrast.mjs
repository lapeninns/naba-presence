#!/usr/bin/env node
/**
 * Measures every contrast pair in app/globals.css, in both themes.
 *
 *   node scripts/check-contrast.mjs          # table, exits 1 on failure
 *   node scripts/check-contrast.mjs --hint   # add the nearest passing L
 *   node scripts/check-contrast.mjs --json   # machine-readable
 *
 * The pair manifest and the maths live in lib/design/*.ts, so this script,
 * the vitest gate and the /design-system page can never disagree.
 */
import { readFileSync } from "node:fs"
import { register } from "node:module"
import { fileURLToPath } from "node:url"

register("./ts-extension-resolver.mjs", import.meta.url)

// Node >= 22.18 strips TypeScript syntax on import, so the CLI shares the
// exact modules the vitest gate and the /design-system page use. Those three
// measuring the same source is the whole point; a re-implementation here
// would be free to drift.
const root = new URL("../", import.meta.url)
const { parseTokens } = await import(new URL("lib/design/tokens.ts", root).href)
const { auditTokens } = await import(new URL("lib/design/contrast-pairs.ts", root).href)

const args = new Set(process.argv.slice(2))
const css = readFileSync(fileURLToPath(new URL("app/globals.css", root)), "utf8")
const report = auditTokens(parseTokens(css))

if (args.has("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  process.exit(report.failures.length || report.issues.length ? 1 : 0)
}

const pad = (value, width) => String(value).padEnd(width)
for (const theme of ["light", "dark"]) {
  const rows = report.results.filter((row) => row.theme === theme)
  process.stdout.write(`\n${theme.toUpperCase()}  (${rows.filter((r) => r.passes).length}/${rows.length} pass)\n`)
  for (const row of rows) {
    const mark = row.passes ? "  " : "！"
    const line = `${mark} ${pad(row.pair.fg, 24)} on ${pad(row.pair.bg, 24)} ${pad(row.ratio.toFixed(2), 7)} need ${row.minimum}`
    const hint =
      args.has("--hint") && row.hint !== null ? `   -> try lightness ${row.hint}` : ""
    const gamut = row.outOfGamut ? "   (outside sRGB; the browser clamps it)" : ""
    process.stdout.write(`${line}${hint}${gamut}   ${row.pair.note}\n`)
  }
}

for (const issue of report.issues) {
  process.stdout.write(`\n！ ${issue.theme}: ${issue.message}\n`)
}

const failed = report.failures.length + report.issues.length
process.stdout.write(
  failed
    ? `\n${report.failures.length} pair(s) below target, ${report.issues.length} structural issue(s).\n`
    : `\nAll ${report.results.length} pairs clear their target in both themes.\n`
)
process.exit(failed ? 1 : 0)
