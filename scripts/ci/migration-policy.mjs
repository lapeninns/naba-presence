#!/usr/bin/env node
// Migration history policy: applied migrations are append-only.
//
//   node scripts/ci/migration-policy.mjs [base-ref]   (default: origin/main)
//
// Compares HEAD with its merge base with base-ref and fails when:
//   - a migration that exists at the merge base was modified, deleted or renamed
//   - a new migration's name does not match NNNN_snake_case.sql
//   - a new version is at or below the merge base's highest version, or two
//     new files share a version
// Needs full history (actions/checkout fetch-depth: 0). Writes
// MIGRATION_BASE_SHA to $GITHUB_ENV when set, for the upgrade test.

import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"

import {
  MIGRATION_FILE_PATTERN,
  highestVersion,
  versionNumber,
} from "../migration-rules.mjs"

const DIRECTORY = "supabase/migrations"
const baseRef = process.argv[2] ?? "origin/main"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const basename = (path) => path.slice(path.lastIndexOf("/") + 1)

let mergeBase
try {
  mergeBase = git("merge-base", baseRef, "HEAD")
} catch {
  console.error(
    `migration-policy: no merge base with ${baseRef}; fetch full history ` +
      `(fetch-depth: 0) and make sure ${baseRef} exists`
  )
  process.exit(2)
}

const baseFiles = git("ls-tree", "--name-only", `${mergeBase}:${DIRECTORY}`)
  .split("\n")
  .filter((file) => file.endsWith(".sql"))
const baseHighest = highestVersion(baseFiles)

const changes = git(
  "diff",
  "--name-status",
  "--find-renames",
  "--find-copies",
  mergeBase,
  "HEAD",
  "--",
  DIRECTORY
)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))

const failures = []
const added = []
for (const [status, path, renamedTo] of changes) {
  const kind = status[0]
  if (kind === "A" || kind === "C") {
    const file = basename(renamedTo ?? path)
    if (file.endsWith(".sql")) added.push(file)
  } else if (path.endsWith(".sql")) {
    const verb =
      { M: "modified", D: "deleted", R: "renamed", T: "changed type of" }[
        kind
      ] ?? `changed (${status})`
    failures.push(
      `${verb} ${path}${renamedTo ? ` -> ${renamedTo}` : ""}: migrations on ` +
        `${baseRef} are immutable; add a new migration instead`
    )
  }
}

const seen = new Map()
for (const file of added.sort()) {
  if (!MIGRATION_FILE_PATTERN.test(file)) {
    failures.push(`${file}: name must match ${MIGRATION_FILE_PATTERN}`)
    continue
  }
  const version = versionNumber(file)
  if (version <= baseHighest) {
    failures.push(
      `${file}: version ${file.slice(0, 4)} must be above ${baseRef}'s highest ` +
        `(${String(baseHighest).padStart(4, "0")}); renumber it`
    )
  }
  if (seen.has(version)) {
    failures.push(
      `${file}: version ${file.slice(0, 4)} is also used by ${seen.get(version)}`
    )
  }
  seen.set(version, file)
}

console.log(
  `migration-policy: merge base ${mergeBase.slice(0, 12)} with ${baseRef}, ` +
    `highest version ${String(baseHighest).padStart(4, "0")}, ` +
    `${added.length} new migration(s)${added.length ? `: ${added.join(", ")}` : ""}`
)
if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `MIGRATION_BASE_SHA=${mergeBase}\n`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log("migration-policy: ok")
