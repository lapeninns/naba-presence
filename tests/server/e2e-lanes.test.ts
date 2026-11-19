import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  countTestsByFile,
  laneCountProblem,
  planLanes,
  settleLanes,
  weightsFromLog,
} from "../../scripts/ci/e2e-lanes.mjs"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

describe("e2e lanes", () => {
  it("counts listed tests per file, nested suites included", () => {
    const report = {
      suites: [
        {
          file: "a.spec.ts",
          specs: [{ file: "a.spec.ts", tests: [{}, {}] }],
          suites: [{ specs: [{ file: "a.spec.ts", tests: [{}] }] }],
        },
        { file: "b.spec.ts", specs: [], suites: [] },
        { file: "c.spec.ts", specs: [{ tests: [{}] }] },
      ],
    }
    expect([...countTestsByFile(report)]).toEqual([
      ["a.spec.ts", 3],
      ["c.spec.ts", 1],
    ])
  })

  it("puts every file in exactly one lane, balanced by weight", () => {
    const counts = new Map([
      ["a.spec.ts", 10],
      ["b.spec.ts", 5],
      ["c.spec.ts", 5],
      ["d.spec.ts", 1],
      ["new.spec.ts", 4],
    ])
    const weights = {
      "a.spec.ts": 100,
      "b.spec.ts": 60,
      "c.spec.ts": 50,
      "d.spec.ts": 30,
    }
    const lanes = planLanes(counts, weights, 2)
    expect(lanes.flatMap((lane) => lane.files).sort()).toEqual(
      [...counts.keys()].sort()
    )
    expect(lanes.reduce((sum, lane) => sum + lane.tests, 0)).toBe(25)
    // Longest first onto the lighter lane: a (100) | b (60) + c (50), then
    // d (30) beside a, and the unknown file (4 tests x 2 s) beside b and c.
    expect(lanes.map((lane) => lane.seconds)).toEqual([130, 118])
    expect(lanes.map((lane) => lane.files)).toEqual([
      ["a.spec.ts", "d.spec.ts"],
      ["b.spec.ts", "c.spec.ts", "new.spec.ts"],
    ])
    // The same input gives the same plan.
    expect(planLanes(counts, weights, 2)).toEqual(lanes)
    // More lanes than files: no empty lanes.
    expect(planLanes(counts, weights, 12)).toHaveLength(5)
    expect(() => planLanes(counts, weights, 0)).toThrow()
  })

  it("has a weight for every browser spec file", () => {
    const weights = JSON.parse(
      readFileSync(join(repoRoot, "tests/e2e/lane-weights.json"), "utf8")
    )
    const specs = readdirSync(join(repoRoot, "tests/e2e")).filter((name) =>
      name.endsWith(".spec.ts")
    )
    // A missing weight only unbalances the lanes (2 s per test is assumed);
    // regenerate with `node scripts/ci/e2e-lanes.mjs weights <gate e2e.log>`.
    expect(specs.filter((file) => !(file in weights))).toEqual([])
    expect(
      Object.keys(weights).filter((file) => !specs.includes(file))
    ).toEqual([])
  })

  it("fails a lane that did not account for exactly its planned tests", () => {
    const lane = { index: 2, files: ["a.spec.ts"], tests: 5, seconds: 1 }
    expect(laneCountProblem(lane, ["4 passed (1.0m)", "1 flaky"])).toBeNull()
    expect(
      laneCountProblem(lane, ["3 passed (1.0m)", "1 failed", "1 did not run"])
    ).toBeNull()
    expect(laneCountProblem(lane, ["4 passed (1.0m)"])).toBe(
      "lane 2 accounted for 4 tests, planned 5"
    )
    expect(laneCountProblem(lane, ["6 passed (1.0m)"])).toMatch(/6 tests/)
    expect(laneCountProblem(lane, [])).toMatch(/0 tests/)
  })

  it("stops waiting at the first failed lane only when failing fast", async () => {
    let finishSlow: (value: { code: number }) => void = () => {}
    const slow = new Promise<{ code: number }>((done) => {
      finishSlow = done
    })
    const failed = Promise.resolve({ code: 1 })
    expect(await settleLanes([slow, failed], true)).toEqual([{ code: 1 }])
    const all = settleLanes([slow, Promise.resolve({ code: 0 })], false)
    finishSlow({ code: 0 })
    expect(await all).toEqual([{ code: 0 }, { code: 0 }])
    expect(
      await settleLanes(
        [Promise.resolve({ code: 0 }), Promise.resolve({ code: 0 })],
        true
      )
    ).toHaveLength(2)
    expect(await settleLanes([], true)).toEqual([])
  })

  it("reads per-file seconds from gate e2e logs", () => {
    const log = [
      "[lane 1]   ✓  1 › tests/e2e/a.spec.ts:3:1 › one (1.5s)",
      "[lane 1]   ✓  2 › tests/e2e/a.spec.ts:9:1 › two (600ms)",
      "[lane 2]   ✘  3 [touch-390] › tests/e2e/b.spec.ts:1:1 › three (1.2m)",
      "[lane 2]   493 passed (12.7m)",
    ].join("\n")
    expect(weightsFromLog(log)).toEqual({ "a.spec.ts": 2, "b.spec.ts": 72 })
  })
})
