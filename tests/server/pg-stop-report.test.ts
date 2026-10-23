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

  it("quotes every value so the retry runs as printed", () => {
    const values = {
      pgDir: "/Users/o'neil/My Gates/pg-e2e",
      shard: "o'neil gate-1",
      script: "/Users/o'neil/My Gates/scripts/ci/postgres.mjs",
    }
    const report = stopFailureReport(
      { status: 1, stderr: "x" },
      { ...values, env: { DOCKER_CONTEXT: "lima 'dev'", PATH: "/bin" } }
    )
    const retry = report?.split("  retry: ")[1]?.trim() ?? ""
    expect(retry.startsWith("DOCKER_CONTEXT=")).toBe(true)
    expect(retry).not.toContain("PATH=")
    // A stand-in `node` prints what the shell hands it.
    const seen = execFileSync(
      "sh",
      [
        "-c",
        `node() { printf '%s\\n' "$DOCKER_CONTEXT" "$NABA_PG_DIR" "$SHARD" "$@"; }; ${retry}`,
      ],
      { encoding: "utf8" }
    )
    expect(seen.split("\n").slice(0, 5)).toEqual([
      "lima 'dev'",
      values.pgDir,
      values.shard,
      values.script,
      "stop",
    ])
  })

  it("names only the Docker daemon settings the stop had", () => {
    const report = stopFailureReport(
      { status: 1, stderr: "x" },
      { ...cluster, env: { DOCKER_HOST: "unix:///run/user/docker.sock" } }
    )
    expect(report).toContain(
      "retry: DOCKER_HOST='unix:///run/user/docker.sock' NABA_PG_DIR="
    )
    expect(stopFailureReport({ status: 1, stderr: "x" }, cluster)).toContain(
      "retry: NABA_PG_DIR="
    )
  })

  it("is what the release gate and the test harness print", () => {
    // Each passes the stop's own directory, SHARD, environment and an
    // absolute script path, and prints the report.
    expect(readRepoText("scripts/release/verify-local.mjs")).toMatch(
      /stopFailureReport\(stopped, \{\s*pgDir: clusterEnv\.NABA_PG_DIR,\s*shard: clusterEnv\.SHARD,\s*script: join\(root, "scripts\/ci\/postgres\.mjs"\),\s*env,\s*\}\)\s*if \(report\) say\(report\)/
    )
    expect(readRepoText("scripts/run-test-command.mjs")).toMatch(
      /stopFailureReport\(stopped, \{\s*pgDir,\s*shard: basename\(pgDir\),\s*script: join\(root, "scripts\/ci\/postgres\.mjs"\),\s*env: clusterEnv,\s*\}\)\s*if \(report\) log\(report\.trimEnd\(\)\)/
    )
  })
})
