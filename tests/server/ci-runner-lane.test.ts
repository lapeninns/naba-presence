import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { readRepoText } from "../helpers/repo-text"

const workflow = readRepoText(".github/workflows/ci.yml")
const step = workflow
  .split("- name: Choose runner lane")[1]
  .split("- name: Detect code changes")[0]
const script = step.split("run: |\n")[1].replace(/^ {10}/gm, "")

function lane(overrides: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), "naba-runner-lane-"))
  const output = join(root, "output")
  try {
    execFileSync("bash", ["-e", "-c", script], {
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        SELF_HOSTED_ENABLED: "",
        REPO: "lapeninns/naba-presence",
        EVENT: "pull_request",
        REF: "refs/pull/1/merge",
        ACTOR: "maintainer",
        HEAD_REPO: "lapeninns/naba-presence",
        PR_AUTHOR: "maintainer",
        ...overrides,
        GITHUB_OUTPUT: output,
      },
      stdio: "pipe",
    })
    const entries = readFileSync(output, "utf8").trim().split("\n")
    return Object.fromEntries(
      entries.map((line) => {
        const equal = line.indexOf("=")
        return [line.slice(0, equal), line.slice(equal + 1)]
      })
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("dormant Actions runner lane safeguards", () => {
  it("uses self-hosted only for explicitly opted-in trusted PRs and main pushes/dispatches", () => {
    for (const event of ["pull_request", "push", "workflow_dispatch"]) {
      const result = lane({
        SELF_HOSTED_ENABLED: "true",
        EVENT: event,
        REF: event === "pull_request" ? "refs/pull/1/merge" : "refs/heads/main",
      })
      expect(result.lane).toBe("self-hosted")
      expect(JSON.parse(result.runner)).toEqual([
        "self-hosted",
        "macOS",
        "ARM64",
        "naba-trusted",
      ])
    }
  })

  it("keeps unset, explicit opt-out and invalid switches hosted", () => {
    for (const enabled of ["", "false", "typo"])
      expect(lane({ SELF_HOSTED_ENABLED: enabled }).lane).toBe("hosted")
  })

  it("never broadens the persistent Mac runner's trust boundary", () => {
    for (const overrides of [
      { REPO: "other/repo" },
      { HEAD_REPO: "fork/naba-presence" },
      { PR_AUTHOR: "dependabot[bot]" },
      { ACTOR: "dependabot[bot]" },
      { EVENT: "push", REF: "refs/heads/feature" },
      { EVENT: "workflow_dispatch", REF: "refs/heads/feature" },
      { EVENT: "workflow_run" },
      { EVENT: "pull_request_target" },
      { EVENT: "schedule" },
    ]) {
      const result = lane({ SELF_HOSTED_ENABLED: "true", ...overrides })
      expect(result.lane).toBe("hosted")
      expect(JSON.parse(result.runner)).toBe("ubuntu-24.04")
    }
  })
})
