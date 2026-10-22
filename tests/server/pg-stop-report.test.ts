import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import { stopFailureReport } from "../../scripts/ci/pg-stop-report.mjs"
import { readRepoText } from "../helpers/repo-text"

const cluster = {
  pgDir: "/tmp/naba-verify-0123456789ab-Xy12Zq/pg-integration-1",
  shard: "naba-verify-0123456789ab-Xy12Zq-integration-1",
  script: "/repo/scripts/ci/postgres.mjs",
}

describe("the report of a failed postgres.mjs stop", () => {
  it("says nothing when the stop succeeded", () => {
    expect(stopFailureReport({ status: 0, stderr: "" }, cluster)).toBeNull()
  })

  it("gives the reason and a command that repeats the stop", () => {
    const report = stopFailureReport(
      {
        status: 1,
        stderr:
          "postgres.mjs stop: Docker cleanup failed (exit 1); preserving state in /tmp/x\n",
      },
      cluster
    )
    expect(report).toBe(
      `PostgreSQL cleanup failed for ${cluster.shard}: postgres.mjs stop: Docker cleanup failed (exit 1); preserving state in /tmp/x\n` +
        `  retry: NABA_PG_DIR='${cluster.pgDir}' SHARD='${cluster.shard}' node '${cluster.script}' stop\n`
    )
  })

  it("names the signal or the spawn error when there is no stderr", () => {
    expect(
      stopFailureReport(
        { status: null, signal: "SIGTERM", stderr: "" },
        cluster
      )
    ).toContain(`failed for ${cluster.shard}: killed by SIGTERM\n`)
    expect(
      stopFailureReport(
        { status: null, error: new Error("spawnSync node ENOENT") },
        cluster
      )
    ).toContain(": spawnSync node ENOENT\n")
    expect(stopFailureReport({ status: 2, stderr: "" }, cluster)).toContain(
      ": exit 2\n"
    )
  })

  it("quotes paths so the retry runs as printed", () => {
    const pgDir = "/Users/o'neil/My Gates/pg-e2e"
    const report = stopFailureReport(
      { status: 1, stderr: "x" },
      { ...cluster, pgDir }
    )
    const retry = report?.split("retry: ")[1]?.trim() ?? ""
    // The shell turns the printed assignment back into the exact path.
    const assignment = retry.slice(0, retry.indexOf(" SHARD="))
    const decoded = execFileSync(
      "sh",
      ["-c", `${assignment}; printf '%s' "$NABA_PG_DIR"`],
      { encoding: "utf8" }
    )
    expect(decoded).toBe(pgDir)
  })

  it("is what the release gate and the test harness print", () => {
    for (const file of [
      "scripts/release/verify-local.mjs",
      "scripts/run-test-command.mjs",
    ]) {
      expect(readRepoText(file), file).toContain("stopFailureReport(stopped, {")
    }
  })
})
