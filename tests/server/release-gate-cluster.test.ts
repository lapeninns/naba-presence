import { describe, expect, it, vi } from "vitest"

import {
  gateClusterEnv,
  releaseGateCluster,
} from "../../scripts/release/verify-local.mjs"
import { readRepoText } from "../helpers/repo-text"

const run = "/cache/naba-verify/naba-verify-0123456789ab-Xy12Zq"
const script = "/repo/scripts/ci/postgres.mjs"
const names = ["migrations", "concurrent", "integration-1", "e2e"]

// The run's tracked clusters, as startCluster records them.
const tracked = () => names.map((name) => gateClusterEnv(run, name))
// What a step holds for its cluster: postgres.mjs's exports and the env.
const held = (name: string, dir = run) => ({
  DIRECT_DATABASE_URL: "postgresql://naba@127.0.0.1:55001/nabareview_test",
  ...gateClusterEnv(dir, name),
})
const shards = (clusters: { SHARD: string }[]) =>
  clusters.map((cluster) => cluster.SHARD.split("-").pop())

describe("releasing a gate cluster after its last use", () => {
  it("stops exactly that cluster once it is idle, and untracks only it", async () => {
    const clusters = tracked()
    const order: string[] = []
    const result = await releaseGateCluster(clusters, held("concurrent"), {
      isIdle: async () => {
        order.push("idle?")
        return true
      },
      stop: async (cluster) => {
        order.push("stop")
        // The tracked entry itself, not the step's env with its URLs.
        expect(cluster).toEqual(gateClusterEnv(run, "concurrent"))
        return { status: 0, stderr: "Stopped" }
      },
      script,
    })
    expect(result.released).toBe(true)
    expect(order).toEqual(["idle?", "stop"])
    expect(shards(clusters)).toEqual(["migrations", "1", "e2e"])
  })

  it("refuses a cluster this run does not track, touching nothing", async () => {
    const clusters = tracked()
    const isIdle = vi.fn(async () => true)
    const stop = vi.fn(async () => ({ status: 0 }))
    // Another run's cluster of the same step name.
    const other = held(
      "concurrent",
      "/cache/naba-verify/naba-verify-0123456789ab-Other1"
    )
    const result = await releaseGateCluster(clusters, other, {
      isIdle,
      stop,
      script,
    })
    expect(result).toEqual({
      released: false,
      reason: expect.stringContaining("not one tracked cluster"),
    })
    expect(isIdle).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(clusters).toEqual(tracked())
  })

  it("refuses an identity tracked twice", async () => {
    const clusters = [...tracked(), gateClusterEnv(run, "concurrent")]
    const stop = vi.fn(async () => ({ status: 0 }))
    const result = await releaseGateCluster(clusters, held("concurrent"), {
      isIdle: async () => true,
      stop,
      script,
    })
    expect(result.released).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(clusters).toHaveLength(5)
  })

  it("leaves a cluster with other sessions to final cleanup", async () => {
    const clusters = tracked()
    const stop = vi.fn(async () => ({ status: 0 }))
    const result = await releaseGateCluster(clusters, held("integration-1"), {
      isIdle: async () => false,
      stop,
      script,
    })
    expect(result.reason).toContain("still has other sessions")
    expect(stop).not.toHaveBeenCalled()
    expect(clusters).toEqual(tracked())
  })

  it("leaves the cluster when the session check itself fails", async () => {
    const clusters = tracked()
    const stop = vi.fn(async () => ({ status: 0 }))
    const result = await releaseGateCluster(clusters, held("migrations"), {
      isIdle: async () => {
        throw new Error("psql exited 2")
      },
      stop,
      script,
    })
    expect(result.reason).toContain("psql exited 2")
    expect(stop).not.toHaveBeenCalled()
    expect(clusters).toEqual(tracked())
  })

  it("keeps a cluster whose stop fails, with the command that retries it", async () => {
    const clusters = tracked()
    const target = gateClusterEnv(run, "migrations")
    const result = await releaseGateCluster(clusters, held("migrations"), {
      isIdle: async () => true,
      stop: async () => ({
        status: 1,
        stderr: `postgres.mjs stop: PostgreSQL cleanup failed (pg_ctl stop exit 1, status exit 0); preserving state in ${target.NABA_PG_DIR}\n`,
      }),
      script,
    })
    expect(result.released).toBe(false)
    expect(result.reason).toContain(
      `retry: NABA_PG_DIR='${target.NABA_PG_DIR}' SHARD='${target.SHARD}' node '${script}' stop`
    )
    expect(result.reason).toContain("left to final cleanup")
    // Still tracked, so final cleanup stops it.
    expect(clusters).toEqual(tracked())
  })

  it("keeps a cluster whose stop throws or is killed", async () => {
    for (const stop of [
      async () => {
        throw new Error("spawn node ENOENT")
      },
      async () => ({ status: null, signal: "SIGTERM" }),
    ]) {
      const clusters = tracked()
      const result = await releaseGateCluster(clusters, held("e2e"), {
        isIdle: async () => true,
        stop,
        script,
      })
      expect(result.released).toBe(false)
      expect(clusters).toEqual(tracked())
    }
  })

  it("untracks nothing else when final cleanup took the cluster meanwhile", async () => {
    const clusters = tracked()
    const result = await releaseGateCluster(clusters, held("concurrent"), {
      isIdle: async () => true,
      stop: async () => {
        // An interrupt ran final cleanup during the stop.
        clusters.splice(0)
        return { status: 0 }
      },
      script,
    })
    expect(result.released).toBe(true)
    expect(clusters).toEqual([])
  })
})

describe("where the gate releases its clusters", () => {
  const source = readRepoText("scripts/release/verify-local.mjs")
  const step = (from: string, to: string) =>
    source.slice(source.indexOf(from), source.indexOf(to))

  it("releases each finished cluster after its step's last check", () => {
    const upgrade = step(
      '"migrate-upgrade": async',
      '"migrate-concurrent": async'
    )
    expect(upgrade).toMatch(
      /\} finally \{\s*await releaseCluster\(sink, dbEnv\)/
    )
    expect(
      upgrade.indexOf("await releaseCluster(sink, dbEnv)")
    ).toBeGreaterThan(upgrade.indexOf("Schema after upgrading"))

    const concurrent = step('"migrate-concurrent": async', "integration: async")
    expect(concurrent).toMatch(
      /\} finally \{\s*await releaseCluster\(sink, dbEnv\)/
    )
    expect(
      concurrent.indexOf("await releaseCluster(sink, dbEnv)")
    ).toBeGreaterThan(concurrent.indexOf("Expected each of"))

    // A shard's cluster only once its suite has exited.
    const integration = step("integration: async", "e2e: async")
    expect(
      integration.indexOf("if (dbEnv) await releaseCluster(shardSink, dbEnv)")
    ).toBeGreaterThan(
      integration.indexOf('await exec(shardSink, "pnpm", args, { dbEnv })')
    )
  })

  it("keeps e2e's cluster through both suites, and final cleanup for the rest", () => {
    expect(step("e2e: async", '"workflow-lint": async')).not.toContain(
      "releaseCluster"
    )
    expect(source).toMatch(/const cleanup = \(\) => \{\s*stopClusters\(\)/)
    // Idle means no client session on the cluster but the check's own.
    expect(source).toContain(
      "backend_type = 'client backend' and pid <> pg_backend_pid()"
    )
  })
})
