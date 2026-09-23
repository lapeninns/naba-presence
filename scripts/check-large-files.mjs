#!/usr/bin/env node
/**
 * Hard ceiling on tracked source-file size.
 *
 * ESLint's max-lines (800) caps NEW TypeScript files, but a file recorded in
 * eslint-suppressions.json can keep growing forever without tripping lint —
 * the suppression silences the report, it does not pin the size. This script
 * is the backstop: every tracked source file answers to HARD_MAX, and the
 * legacy exceptions are pinned to their current size, so grandfathered files
 * cannot grow silently either. Shrink an exception and lower its pin.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const HARD_MAX = 1200

/** file → pinned line count. Only entries over HARD_MAX belong here. */
const EXCEPTIONS = new Map([
  // Internal evidence page rendering every contrast pair and component tier.
  ["app/design-system/page.tsx", 1600],
  // The axe sweep walks every area in one spec; splitting it would scatter
  // the shared fixture setup.
  ["tests/e2e/accessibility.spec.ts", 1520],
])

const SOURCE = /\.(ts|tsx|mts|cts|mjs|js|css|sql)$/
const SKIP = /(^|\/)(docs\/archive)\//

const files = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((file) => SOURCE.test(file) && !SKIP.test(file))

const failures = []
for (const file of files) {
  // Deleted-but-unstaged files still appear in the index; they are gone.
  if (!existsSync(file)) continue
  const text = readFileSync(file, "utf8")
  const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
  const max = EXCEPTIONS.get(file) ?? HARD_MAX
  if (lines > max) failures.push(`${file}: ${lines} lines (cap ${max})`)
}

if (failures.length > 0) {
  console.error("Source files over their size cap:")
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(
    "\nSplit the module. Widening a cap needs the same review as writing the file."
  )
  process.exit(1)
}

console.log(`check-large-files: ${files.length} tracked source files within caps`)
