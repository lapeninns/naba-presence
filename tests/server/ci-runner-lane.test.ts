import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { resolveGateBase } from "../../scripts/release/gate-base.mjs"
import { parseArgs } from "../../scripts/release/verify-local.mjs"
import { readRepoText } from "../helpers/repo-text"

describe("hosted runner and candidate identity", () => {
  const workflow = readRepoText(".github/workflows/ci.yml")
  const checkoutCheck = workflow
    .split("- name: Validate PR merge commit")[1]
    .split("- uses:")[0]
    .split("run: |\n")[1]
    .replace(/^ {10}/gm, "")

  it("only routes to a disposable hosted runner with read-only permissions", () => {
    expect(workflow.match(/^\s+runs-on:.*$/gm)).toEqual([
      "    runs-on: ubuntu-24.04",
    ])
    expect(workflow).toContain("permissions:\n  contents: read")
    expect(workflow).not.toMatch(/secrets\.|environment:|self-hosted/)
  })

  it("requires the exact target SHA for locally or remotely supplied PRs", () => {
    const head = "a".repeat(40)
    const base = "b".repeat(40)
    const localCI = { GITHUB_EVENT_NAME: "pull_request", CI_BASE_SHA: base }
    expect(() => parseArgs(["--merge-candidate"])).toThrow(/target SHA/)
    expect(() => parseArgs(["--base-ref", head], localCI)).toThrow(/must match/)
    expect(parseArgs(["--base-ref", base], localCI).mergeCandidate).toBe(true)
  })

  it("rejects a changed base, changed head, or a non-merge checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "candidate-parents-"))
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
    const verify = (base: string, head: string, event = "pull_request") =>
      spawnSync("bash", ["-e", "-c", checkoutCheck], {
        cwd: dir,
        env: { ...process.env, EVENT: event, BASE_SHA: base, HEAD_SHA: head },
      }).status

    try {
      git("init", "-q", "-b", "main")
      git("config", "user.name", "CI test")
      git("config", "user.email", "ci@example.test")
      git("config", "commit.gpgsign", "false")
      git("commit", "-q", "--allow-empty", "-m", "base")
      const base = git("rev-parse", "HEAD")
      git("switch", "-qc", "feature")
      git("commit", "-q", "--allow-empty", "-m", "feature")
      const head = git("rev-parse", "HEAD")
      git("switch", "-q", "main")
      git("merge", "-q", "--no-ff", "feature", "-m", "test merge")
      expect(verify(base, head)).toBe(0)
      expect(verify(head, head)).toBe(1)
      expect(verify(base, base)).toBe(1)
      git("switch", "-q", "feature")
      expect(verify(base, head)).toBe(1)
      expect(verify("", "", "workflow_dispatch")).toBe(0)

      const options = { baseRef: base, mergeCandidate: true }
      expect(resolveGateBase(dir, head, options).mergeBase).toBe(base)
      expect(() => resolveGateBase(dir, base, options)).toThrow(
        /strict ancestor/
      )
      git("switch", "-q", "main")
      git("commit", "-q", "--allow-empty", "-m", "advance target")
      const advanced = git("rev-parse", "HEAD")
      expect(() =>
        resolveGateBase(dir, head, { ...options, baseRef: advanced })
      ).toThrow(/strict ancestor/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
