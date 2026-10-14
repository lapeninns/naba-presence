import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  ALL_JOBS,
  CODE_JOBS,
  PR_ONLY,
  REQUIRED_ALWAYS,
  evaluate,
} from "../../scripts/ci/aggregate-results.mjs"
import { readRepoText } from "../helpers/repo-text"

type Result = "success" | "failure" | "cancelled" | "skipped"

function needsWith(
  overrides: Record<string, Result | undefined> = {},
  base: Result = "success"
): Record<string, { result: Result }> {
  const needs: Record<string, { result: Result }> = {}
  for (const job of ALL_JOBS) {
    const result = job in overrides ? overrides[job] : base
    if (result) needs[job] = { result }
  }
  return needs
}

const skippedCode = Object.fromEntries(
  CODE_JOBS.map((job) => [job, "skipped" as const])
)

describe("CI result aggregation", () => {
  it("passes a code pull request where every job succeeded", () => {
    expect(
      evaluate({ needs: needsWith(), code: "true", event: "pull_request" })
    ).toEqual({ ok: true, problems: [] })
  })

  it("passes a docs-only pull request with every code job skipped", () => {
    const result = evaluate({
      needs: needsWith(skippedCode),
      code: "false",
      event: "pull_request",
    })
    expect(result).toEqual({ ok: true, problems: [] })
  })

  it("fails a code pull request when integration was skipped", () => {
    const result = evaluate({
      needs: needsWith({ integration: "skipped" }),
      code: "true",
      event: "pull_request",
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(["integration: skipped (code changed)"])
  })

  it("fails when build succeeded but e2e was skipped", () => {
    const result = evaluate({
      needs: needsWith({ build: "success", e2e: "skipped" }),
      code: "true",
      event: "push",
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(["e2e: skipped (code changed)"])
  })

  it("fails when plan failed, even if everything else was skipped", () => {
    const result = evaluate({
      needs: needsWith({ plan: "failure" }, "skipped"),
      code: undefined,
      event: "pull_request",
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain("plan: failure (always required)")
    expect(result.problems).toContain(
      "plan output code: missing on pull_request"
    )
    expect(result.problems).toContain("gate: skipped (plan output unusable)")
  })

  it("fails closed when plan succeeded but its code output is missing or odd", () => {
    for (const code of [undefined, "", "yes"]) {
      const result = evaluate({
        needs: needsWith(skippedCode),
        code,
        event: "pull_request",
      })
      expect(result.ok).toBe(false)
      expect(result.problems[0]).toMatch(/^plan output code: /)
    }
  })

  it("fails code=false outside a pull request (plan never skips there)", () => {
    const result = evaluate({
      needs: needsWith({ ...skippedCode, "dependency-review": "skipped" }),
      code: "false",
      event: "push",
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('plan output code: "false" on push')
  })

  it("allows dependency-review to skip on push but not on a pull request", () => {
    expect(
      evaluate({
        needs: needsWith({ "dependency-review": "skipped" }),
        code: "true",
        event: "push",
      }).ok
    ).toBe(true)
    expect(
      evaluate({
        needs: needsWith({ "dependency-review": "skipped" }),
        code: "true",
        event: "pull_request",
      })
    ).toEqual({
      ok: false,
      problems: ["dependency-review: skipped (pull request)"],
    })
  })

  it("fails cancelled and failed jobs, including on a docs-only PR", () => {
    expect(
      evaluate({
        needs: needsWith({ gate: "cancelled" }),
        code: "true",
        event: "pull_request",
      }).problems
    ).toEqual(["gate: cancelled (code changed)"])
    expect(
      evaluate({
        needs: needsWith({ ...skippedCode, migrations: "failure" }),
        code: "false",
        event: "pull_request",
      }).problems
    ).toEqual(["migrations: failure (docs-only pull request)"])
    expect(
      evaluate({
        needs: needsWith({ "secret-scan": "cancelled" }),
        code: "true",
        event: "push",
      }).ok
    ).toBe(false)
  })

  it("fails a job missing from needs and a job it does not classify", () => {
    expect(
      evaluate({
        needs: needsWith({ "secret-scan": undefined }),
        code: "true",
        event: "push",
      }).problems
    ).toEqual(["secret-scan: missing (always required)"])
    expect(
      evaluate({
        needs: { ...needsWith(), audit: { result: "success" } },
        code: "true",
        event: "push",
      }).problems
    ).toEqual(["audit: not classified in aggregate-results.mjs"])
  })

  it("fails when the event is missing", () => {
    expect(
      evaluate({ needs: needsWith(), code: "true", event: undefined }).ok
    ).toBe(false)
  })

  it("exits non-zero from the CLI on bad input and zero on a clean run", () => {
    const script = fileURLToPath(
      new URL("../../scripts/ci/aggregate-results.mjs", import.meta.url)
    )
    const run = (env: Record<string, string>) => {
      try {
        execFileSync(process.execPath, [script], {
          env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
          stdio: "pipe",
        })
        return 0
      } catch (error) {
        return (error as { status: number }).status
      }
    }
    expect(
      run({
        NEEDS: JSON.stringify(needsWith()),
        PLAN_CODE: "true",
        EVENT: "pull_request",
      })
    ).toBe(0)
    expect(run({ NEEDS: "not json", PLAN_CODE: "true", EVENT: "push" })).toBe(1)
    expect(run({ PLAN_CODE: "true", EVENT: "push" })).toBe(1)
  })
})

describe("ci.yml wiring", () => {
  const workflow = readRepoText(".github/workflows/ci.yml")
  // Only the `jobs:` map: `on:` also has two-space keys.
  const ci = workflow.slice(workflow.indexOf("\njobs:\n"))

  function jobBlock(job: string): string {
    const start = ci.indexOf(`\n  ${job}:\n`)
    expect(start, `job ${job}`).toBeGreaterThan(-1)
    const rest = ci.slice(start + 1)
    const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
    return next === -1 ? rest : rest.slice(0, next + 2)
  }

  it("aggregates exactly the jobs the script classifies", () => {
    const needs = /\n {4}needs: \[([^\]]+)\]/.exec(jobBlock("result"))
    expect(needs).not.toBeNull()
    const listed = needs![1].split(",").map((job) => job.trim())
    expect([...listed].sort()).toEqual([...ALL_JOBS].sort())
    expect(new Set(ALL_JOBS).size).toBe(
      REQUIRED_ALWAYS.length + CODE_JOBS.length + PR_ONLY.length
    )
  })

  it("lists every job in the workflow in the result's needs", () => {
    const jobs = [...ci.matchAll(/\n {2}([a-z][\w-]*):\n {4}/g)]
      .map((match) => match[1])
      .filter((job) => job !== "result")
    expect(jobs.sort()).toEqual([...ALL_JOBS].sort())
  })

  it("runs the aggregation script with the plan output and event", () => {
    const result = jobBlock("result")
    expect(result).toContain("if: always()")
    expect(result).toContain("run: node scripts/ci/aggregate-results.mjs")
    expect(result).toContain("NEEDS: ${{ toJSON(needs) }}")
    expect(result).toContain("PLAN_CODE: ${{ needs.plan.outputs.code }}")
    expect(result).toContain("EVENT: ${{ github.event_name }}")
    expect(result).toContain("persist-credentials: false")
    expect(result).toContain("sparse-checkout: scripts/ci")
  })

  it("runs every job on plan's lane, so the Mac lane needs no hosted minutes", () => {
    const lane = "runs-on: ${{ fromJSON(needs.plan.outputs.runner) }}"
    for (const job of [...CODE_JOBS, "secret-scan", "dependency-review"]) {
      expect(jobBlock(job), job).toContain(lane)
      expect(jobBlock(job), job).toMatch(/\n {4}needs: (plan|\[plan\b)/)
    }
    expect(jobBlock("result")).toContain(
      `runs-on: \${{ fromJSON(needs.plan.outputs.runner || '"ubuntu-24.04"') }}`
    )
    expect(ci).not.toMatch(/\n {4}runs-on: ubuntu-24\.04\n/)
  })

  it("chooses Plan's own runner with the same trust rule as its lane step", () => {
    const plan = jobBlock("plan")
    const label = '["self-hosted","macOS","ARM64","naba-trusted"]'
    // Both the expression and the step name the same Mac labels.
    expect(plan).toContain(`fromJSON('${label}')`)
    expect(plan).toContain(`runner=${label}`)
    for (const condition of [
      "vars.SELF_HOSTED_ENABLED == 'true'",
      "github.repository == 'lapeninns/naba-presence'",
      "github.ref == 'refs/heads/main'",
      "github.event.pull_request.head.repo.full_name == github.repository",
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "github.actor != 'dependabot[bot]'",
    ]) {
      expect(plan, condition).toContain(condition)
    }
    expect(plan).toContain("|| 'ubuntu-24.04' }}")
  })

  it("gates every code job on plan's code output", () => {
    for (const job of CODE_JOBS) {
      expect(jobBlock(job), job).toContain(
        "if: needs.plan.outputs.code == 'true'"
      )
    }
    expect(jobBlock("dependency-review")).toContain(
      "if: github.event_name == 'pull_request'"
    )
  })
})
