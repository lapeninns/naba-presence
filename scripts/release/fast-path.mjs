// The release gate's docs-only fast path (owner decision 2026-11-20).
//
// A pull request whose every changed file is documentation that nothing in
// the gate, the tests or promotion reads runs only the steps that can fail
// on such a change: install, format, secret scan and workflow lint. The run
// says "docs-only fast path" wherever it reports, and its receipt is never
// a release receipt (`ok` stays false; promotion refuses it).
//
// Fail safe: anything this file does not recognise as inert documentation
// runs the full gate, and so does a run that is not a pull request's
// (`verify:release` without --base-ref, which is how releases are gated),
// --full, NABA_GATE_FULL=1, an empty diff or a diff git cannot list.

import { execFileSync } from "node:child_process"

import { isDocsOnlyFile } from "../vercel-ignore-build.mjs"

export const DOCS_ONLY = "docs-only"

/** The steps a docs-only change runs; every other step is skipped. */
export const FAST_PATH_STEPS = Object.freeze([
  "frozen-install",
  "format",
  "workflow-lint",
  "secret-scan",
])

export const FAST_PATH_NOTE = "docs-only fast path: not run"

/**
 * Inert file types under docs/: text and images. A script, config or data
 * file under docs/ (docs/redesign/2026-11/check-inventory.mjs, receipts'
 * JSON) is code to this gate.
 */
const INERT_DOCS = /\.(md|mdx|txt|png|jpe?g|webp|gif|svg|pdf)$/i

/**
 * Whether one changed file is documentation the gate may skip testing:
 * vercel-ignore-build's docs-only rule (docs/** and *.md, but not AGENTS.md,
 * the docs tests read, docs/release/, .github/, scripts/ or supabase/), no
 * dot-folder anywhere in the path (.design-sync/, .githooks/), and an inert
 * file type.
 * @param {string} file repository-relative path
 */
export function isFastPathFile(file) {
  if (typeof file !== "string" || file === "") return false
  if (file.split("/").some((part) => part.startsWith("."))) return false
  if (!isDocsOnlyFile(file)) return false
  return file.endsWith(".md") || INERT_DOCS.test(file)
}

/**
 * Which gate a run takes.
 * @param {{
 *   baseRefGiven: boolean,
 *   full: boolean,
 *   files: string[] | null,
 * }} input `files`: every path the diff from the merge base touches, both
 *   names of a rename (git diff --no-renames), or null when git cannot tell
 * @returns {{ path: "full" | typeof DOCS_ONLY, reason: string }}
 */
export function chooseGatePath({ baseRefGiven, full, files }) {
  if (full) return { path: "full", reason: "the full gate was asked for" }
  if (!baseRefGiven) {
    return {
      path: "full",
      reason:
        "not a pull request run (no --base-ref): releases take the full gate",
    }
  }
  if (files === null) {
    return { path: "full", reason: "git could not list the changed files" }
  }
  if (files.length === 0) {
    return { path: "full", reason: "the diff from the merge base is empty" }
  }
  const other = files.filter((file) => !isFastPathFile(file))
  if (other.length > 0) {
    const shown = other.slice(0, 5).join(", ")
    return {
      path: "full",
      reason: `${other.length} changed file(s) are not inert documentation: ${shown}${other.length > 5 ? ", …" : ""}`,
    }
  }
  return {
    path: DOCS_ONLY,
    reason: `all ${files.length} changed file(s) are documentation nothing in the gate reads`,
  }
}

/**
 * Why a docs-only run did not pass, or an empty list: each fast-path step
 * passed (workflow-lint may be skipped where its tools are missing, as in
 * the full gate), and every other step is recorded as skipped by the fast
 * path, nothing else.
 * @param {{ id: string, status: string, note?: string }[]} steps
 * @param {string[]} allStepIds
 */
export function fastPathProblems(steps, allStepIds) {
  const problems = []
  const byId = new Map(steps.map((step) => [step.id, step]))
  for (const id of allStepIds) {
    const step = byId.get(id)
    if (!step) {
      problems.push(`step "${id}" is missing`)
    } else if (FAST_PATH_STEPS.includes(id)) {
      const ok =
        step.status === "passed" ||
        (id === "workflow-lint" && step.status === "skipped")
      if (!ok) problems.push(`fast-path step "${id}" ${step.status}`)
    } else if (step.status !== "skipped" || step.note !== FAST_PATH_NOTE) {
      problems.push(
        `step "${id}" should have been skipped by the fast path, but is ${step.status}`
      )
    }
  }
  return problems
}

/**
 * Every path the diff between two commits touches, both names of a rename
 * (moving code into docs/ is a code change), or null when git cannot tell.
 * @param {string} cwd
 * @param {string} from
 * @param {string} to
 * @returns {string[] | null}
 */
export function changedFilesBetween(cwd, from, to) {
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", from, to],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    )
      .split("\0")
      .filter(Boolean)
  } catch {
    return null
  }
}
