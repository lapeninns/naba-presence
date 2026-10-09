#!/usr/bin/env node
// The `CI result` job (ci.yml). No dependencies: the job checks out only
// scripts/ci and runs this with the runner's preinstalled Node.
//
// Every job that applies to the change must be `success`. A job may be
// `skipped` only when the plan says it does not apply:
//   - CODE_JOBS when Plan reported `code=false` (a docs-only pull request),
//   - PR_ONLY jobs on any event other than pull_request.
// Anything uncertain fails: a Plan that did not succeed, a missing or
// unexpected `code` output, a job absent from `needs`, or a job in `needs`
// this script does not classify.

import { pathToFileURL } from "node:url"

export const REQUIRED_ALWAYS = ["plan", "secret-scan"]
export const CODE_JOBS = ["gate", "build", "migrations", "integration", "e2e"]
export const PR_ONLY = ["dependency-review"]
export const ALL_JOBS = [...REQUIRED_ALWAYS, ...CODE_JOBS, ...PR_ONLY]

/**
 * @param {{
 *   needs: Record<string, { result?: string } | undefined>,
 *   code: string | undefined,
 *   event: string | undefined,
 * }} input `needs` is ci.yml's `toJSON(needs)`; `code` is plan's output
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function evaluate({ needs, code, event }) {
  const problems = []
  const resultOf = (job) => needs?.[job]?.result

  for (const job of Object.keys(needs ?? {})) {
    if (!ALL_JOBS.includes(job)) {
      problems.push(`${job}: not classified in aggregate-results.mjs`)
    }
  }
  if (!event) problems.push("event: missing")

  const requireSuccess = (job, why) => {
    const result = resultOf(job)
    if (result !== "success") {
      problems.push(`${job}: ${result ?? "missing"} (${why})`)
    }
  }
  const allowSkip = (job, why) => {
    const result = resultOf(job)
    if (result !== "success" && result !== "skipped") {
      problems.push(`${job}: ${result ?? "missing"} (${why})`)
    }
  }

  for (const job of REQUIRED_ALWAYS) requireSuccess(job, "always required")

  if (code === "true") {
    for (const job of CODE_JOBS) requireSuccess(job, "code changed")
  } else if (code === "false" && event === "pull_request") {
    for (const job of CODE_JOBS) allowSkip(job, "docs-only pull request")
  } else {
    // Plan only reports code=false for pull requests; anything else means
    // the plan cannot be trusted, so every code job is required.
    problems.push(
      `plan output code: ${code === undefined || code === "" ? "missing" : JSON.stringify(code)} on ${event || "unknown event"}`
    )
    for (const job of CODE_JOBS) requireSuccess(job, "plan output unusable")
  }

  for (const job of PR_ONLY) {
    if (event === "pull_request") requireSuccess(job, "pull request")
    else allowSkip(job, `not a pull request (${event || "unknown event"})`)
  }

  return { ok: problems.length === 0, problems }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let result
  try {
    const needs = JSON.parse(process.env.NEEDS ?? "")
    for (const [job, value] of Object.entries(needs)) {
      console.log(`${job}: ${value?.result ?? "missing"}`)
    }
    result = evaluate({
      needs,
      code: process.env.PLAN_CODE,
      event: process.env.EVENT,
    })
  } catch (error) {
    result = { ok: false, problems: [`error: ${error?.message ?? error}`] }
  }
  for (const problem of result.problems) console.log(`::error::${problem}`)
  console.log(`CI result: ${result.ok ? "pass" : "fail"}`)
  process.exit(result.ok ? 0 : 1)
}
