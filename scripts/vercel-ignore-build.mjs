#!/usr/bin/env node
// Vercel "Ignored Build Step" (vercel.json `ignoreCommand`). No dependencies:
// it runs after the clone and before `pnpm install`.
//
// Vercel's contract is inverted: exit 0 SKIPS the build, exit 1 BUILDS.
// Anything uncertain builds. Production is never skipped.
//
// Skips a preview build only when:
//   - the branch is a Dependabot branch (`dependabot/...`); CI covers those
//     and nobody opens their previews, or
//   - every file changed since the branch's last deployment
//     (VERCEL_GIT_PREVIOUS_SHA..VERCEL_GIT_COMMIT_SHA) is documentation:
//     `docs/**` or `*.md`, but not AGENTS.md. This matches ci.yml's `plan` job.

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const BUILD = 1
export const SKIP = 0

export function isDocsOnlyFile(file) {
  if (file === "AGENTS.md" || file.endsWith("/AGENTS.md")) return false
  if (file.startsWith(".github/") || file.startsWith("scripts/")) return false
  if (file.startsWith("supabase/")) return false
  return file.startsWith("docs/") || file.endsWith(".md")
}

/**
 * @param {Record<string, string | undefined>} env Vercel system environment variables
 * @param {(from: string, to: string) => string[] | null} changedFiles
 *   files changed between two commits, or null when git cannot tell
 * @returns {{ exitCode: 0 | 1, reason: string }}
 */
export function decide(env, changedFiles) {
  if (env.VERCEL_ENV === "production") {
    return { exitCode: BUILD, reason: "production is never skipped" }
  }
  if (env.VERCEL_ENV !== "preview") {
    return {
      exitCode: BUILD,
      reason: `unknown VERCEL_ENV "${env.VERCEL_ENV ?? ""}"`,
    }
  }
  const branch = env.VERCEL_GIT_COMMIT_REF ?? ""
  if (branch.startsWith("dependabot/")) {
    return { exitCode: SKIP, reason: `Dependabot branch ${branch}` }
  }
  const from = env.VERCEL_GIT_PREVIOUS_SHA
  const to = env.VERCEL_GIT_COMMIT_SHA
  if (!from || !to) {
    return { exitCode: BUILD, reason: "no previous deployment to compare with" }
  }
  const files = changedFiles(from, to)
  if (files === null) {
    return {
      exitCode: BUILD,
      reason: "could not diff against the previous deployment",
    }
  }
  if (files.length === 0) {
    return { exitCode: BUILD, reason: "no changed files (redeploy)" }
  }
  const code = files.find((file) => !isDocsOnlyFile(file))
  if (code) return { exitCode: BUILD, reason: `code change: ${code}` }
  return { exitCode: SKIP, reason: `docs-only change (${files.length} files)` }
}

function gitChangedFiles(from, to) {
  try {
    // Vercel clones shallowly; a previous SHA outside the clone makes this
    // throw, and the caller then builds.
    const output = execFileSync(
      "git",
      ["diff", "--name-only", `${from}..${to}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    )
    return output.split("\n").filter(Boolean)
  } catch {
    return null
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let result
  try {
    result = decide(process.env, gitChangedFiles)
  } catch (error) {
    result = { exitCode: BUILD, reason: `error: ${error?.message ?? error}` }
  }
  console.log(
    `vercel-ignore-build: ${result.exitCode === SKIP ? "skip" : "build"} (${result.reason})`
  )
  process.exit(result.exitCode)
}
