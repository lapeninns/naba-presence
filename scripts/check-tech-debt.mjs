#!/usr/bin/env node
/**
 * Work is tracked in the issue tracker, not in comments.
 *
 * Any TODO / FIXME / XXX / HACK marker must carry its GitHub issue on the
 * same line — `TODO(#123): ...` — so the marker is a pointer to tracked
 * work, never a silent graveyard. ESLint's no-warning-comments rule covers
 * TypeScript; this script covers everything else (SQL, shell, YAML, docs)
 * and enforces the issue-link requirement ESLint cannot express.
 *
 * Matching is case-sensitive on purpose: the lowercase word "todo" appears
 * in prose here as a sync lifecycle STATUS value, which is not a marker.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const MARKER = /\b(TODO|FIXME|XXX|HACK)\b/
const ISSUE_REF = /\(#\d+\)/

const SCAN = /\.(ts|tsx|mts|cts|mjs|js|cjs|css|sql|md|ya?ml|toml|sh)$/
const SKIP = /(^|\/)(docs\/archive)\//

const files = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((file) => SCAN.test(file) && !SKIP.test(file))

const violations = []
for (const file of files) {
  // Deleted-but-unstaged files still appear in the index; they are gone.
  if (!existsSync(file)) continue
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, index) => {
    if (MARKER.test(line) && !ISSUE_REF.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`)
    }
  })
}

if (violations.length > 0) {
  console.error("Tech-debt markers without an issue reference:")
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(
    "\nFile an issue and reference it as TODO(#123), or resolve the marker."
  )
  process.exit(1)
}

console.log(`check-tech-debt: no untracked markers in ${files.length} files`)
