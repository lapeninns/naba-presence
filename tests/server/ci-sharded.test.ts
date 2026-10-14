import { describe, expect, it } from "vitest"

import {
  parseArgs,
  playwrightCounts,
  playwrightTotals,
  shardCount,
  testCommand,
  vitestCounts,
  vitestTotals,
} from "../../scripts/ci/sharded.mjs"
import { summarizeOutput } from "../../scripts/release/verify-local.mjs"

describe("scripts/ci/sharded.mjs", () => {
  it("chooses the shard count from the flag, then the env, then the CPUs", () => {
    expect(shardCount({ flag: "3", env: "2", cpus: 18 })).toBe(3)
    expect(shardCount({ flag: null, env: "2", cpus: 18 })).toBe(2)
    expect(shardCount({ flag: null, env: "", cpus: 18 })).toBe(4)
    expect(shardCount({ flag: null, cpus: 8 })).toBe(2)
    expect(shardCount({ flag: null, cpus: 2 })).toBe(1)
    expect(() => shardCount({ flag: "0", cpus: 18 })).toThrow()
    expect(() => shardCount({ flag: "two", cpus: 18 })).toThrow()
  })

  it("passes runner arguments through and keeps --shards for itself", () => {
    expect(parseArgs(["e2e", "--shards", "3", "--forbid-only"])).toEqual({
      mode: "e2e",
      shards: "3",
      extra: ["--forbid-only"],
    })
    expect(parseArgs(["integration", "--shards=2", "--", "--shards"])).toEqual({
      mode: "integration",
      shards: "2",
      extra: ["--shards"],
    })
    expect(() => parseArgs(["unit"])).toThrow()
  })

  it("runs the package.json commands, plus the shard flag", () => {
    expect(testCommand("integration", [], null)).toEqual([
      "pnpm",
      "exec",
      "vitest",
      "run",
      "tests/integration",
    ])
    expect(
      testCommand("e2e", ["--forbid-only"], { index: 2, total: 4 })
    ).toEqual([
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--shard=2/4",
      "--forbid-only",
    ])
  })

  it("sums vitest totals in a form the release gate reads", () => {
    const shards = [
      " Test Files  40 passed (40)\n      Tests  318 passed (318)\n",
      " Test Files  1 failed | 38 passed (39)\n      Tests  2 failed | 300 passed | 1 skipped (303)\n",
    ].map(vitestCounts)
    const totals = vitestTotals(shards)
    expect(totals).toEqual([
      "Test Files  1 failed | 78 passed (79)",
      "Tests       2 failed | 618 passed | 1 skipped (621)",
    ])
    expect(summarizeOutput(totals.join("\n"))).toEqual([
      "Test Files 1 failed | 78 passed (79)",
      "Tests 2 failed | 618 passed | 1 skipped (621)",
    ])
  })

  it("sums Playwright totals and ignores prefixed shard lines", () => {
    const shards = [
      "  140 passed (4.0m)\n",
      "  1 failed\n  2 flaky\n  130 passed (4.5m)\n",
    ].map(playwrightCounts)
    const totals = playwrightTotals(shards, "5m02s")
    expect(totals).toEqual(["1 failed", "2 flaky", "270 passed (5m02s)"])
    expect(
      summarizeOutput(
        ["[e2e 1/2]   140 passed (4.0m)", ...totals.map((l) => ` ${l}`)].join(
          "\n"
        )
      )
    ).toEqual(["1 failed", "2 flaky", "270 passed (5m02s)"])
  })
})
