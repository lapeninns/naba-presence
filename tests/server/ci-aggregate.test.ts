import { describe, expect, it } from "vitest"

import { readRepoText } from "../helpers/repo-text"

describe("hosted candidate workflow", () => {
  const workflow = readRepoText(".github/workflows/ci.yml")

  it("runs one ungated job without path filters, push or privileged events", () => {
    expect(workflow).toContain("  pull_request:\n    branches: [main]")
    expect(workflow).toContain("types: [opened, synchronize, reopened]")
    expect(workflow).not.toMatch(
      /^  (push|pull_request_target|workflow_run):|^\s*paths(-ignore)?:/m
    )
    expect(workflow.split("\njobs:\n")[1]?.match(/^ {2}\w+:$/gm)).toEqual([
      "  candidate:",
    ])
    expect(workflow).not.toMatch(/^ {4}(needs|if):|continue-on-error:/m)
    expect(workflow).toContain("name: Candidate verification")
    expect(workflow).toContain("timeout-minutes: 90")
    expect(workflow).toContain(
      "github.event.pull_request.number || github.run_id"
    )
    expect(workflow).toContain("cancel-in-progress: true")
  })

  it("keeps the exact candidate, history and a single gate invocation", () => {
    expect(workflow).toContain("ref: ${{ github.sha }}")
    expect(workflow).toContain("fetch-depth: 0")
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain('--merge-candidate --base-ref "$BASE_SHA"')
    expect(
      workflow.match(/node scripts\/release\/verify-local\.mjs/g)
    ).toHaveLength(1)
    expect(workflow).not.toMatch(/pnpm (install|test|build)|--skip/)
  })

  it("authenticates provisioned tools and requires receipt upload on success", () => {
    for (const tool of ["actionlint", "zizmor", "gitleaks"]) {
      expect(workflow).toMatch(
        new RegExp(`install_tool ${tool} .* [a-f0-9]{64}`)
      )
    }
    expect(workflow).toContain("sha256sum --check --strict")
    expect(workflow).toContain("retention-days: 7")
    expect(workflow).toContain("job.status == 'success' && 'error'")
  })
})
