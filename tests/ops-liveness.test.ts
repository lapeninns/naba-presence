import { describe, expect, it } from "vitest"

import { schedulerTickSchema } from "@/lib/contracts/operations"
import {
  TICK_CYCLE_STALE_AFTER_SECONDS,
  TICK_LOCK_WEDGED_AFTER_SKIPS,
  TICK_STALE_AFTER_SECONDS,
  tickFindings,
  tickLiveness,
  type TickRow,
} from "@/lib/server/ops-liveness"

const NOW = new Date("2026-10-10T12:00:00.000Z")

const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000)

function row(name: string, overrides: Partial<TickRow> = {}): TickRow {
  return {
    name,
    beatAt: ago(10),
    registeredAt: ago(30 * 86_400),
    lastStartedAt: ago(11),
    lastSkippedAt: null,
    consecutiveSkips: 0,
    lastFailedAt: null,
    lastErrorCode: null,
    lastManualCompletedAt: null,
    lastCycleCompletedAt: name === "retention" ? ago(3_600) : null,
    ...overrides,
  }
}

const HEALTHY = [
  "jobs",
  "reconcile",
  "retention",
  "performance",
  "keywords",
  "presence-resources",
  "sweep",
  "health",
].map((name) => row(name))

function findingsWith(...rows: TickRow[]) {
  const names = new Set(rows.map((entry) => entry.name))
  return tickFindings(
    tickLiveness(
      [...HEALTHY.filter((entry) => !names.has(entry.name)), ...rows],
      NOW
    ),
    NOW
  )
}

describe("tick liveness", () => {
  it("reports no findings for a fleet of healthy ticks", () => {
    expect(tickFindings(tickLiveness(HEALTHY, NOW), NOW)).toEqual([])
  })

  it("alerts a tick that never completed once its grace from registration has passed", () => {
    const stale = TICK_STALE_AFTER_SECONDS.keywords
    expect(
      findingsWith(
        row("keywords", { beatAt: null, registeredAt: ago(stale + 60) })
      )
    ).toEqual([
      expect.objectContaining({
        kind: "tick_never_completed",
        subject: "keywords",
      }),
    ])
  })

  it("does not alert a never-completed tick inside its grace", () => {
    const stale = TICK_STALE_AFTER_SECONDS.keywords
    expect(
      findingsWith(
        row("keywords", { beatAt: null, registeredAt: ago(stale - 60) })
      )
    ).toEqual([])
  })

  it("does not let a manual run stand in for a cron that never completed", () => {
    const stale = TICK_STALE_AFTER_SECONDS.performance
    const [finding] = findingsWith(
      row("performance", {
        beatAt: null,
        registeredAt: ago(stale + 60),
        lastManualCompletedAt: ago(30),
      })
    )
    expect(finding).toMatchObject({
      kind: "tick_never_completed",
      details: { lastManualCompletedAt: ago(30).toISOString() },
    })
  })

  it("has no grace anchor, and so no alert, for a tick without a row", () => {
    const ticks = tickLiveness(
      HEALTHY.filter((entry) => entry.name !== "sweep"),
      NOW
    )
    expect(ticks.find((tick) => tick.name === "sweep")).toMatchObject({
      stale: true,
      neverCompleted: true,
      registeredAt: null,
    })
    expect(tickFindings(ticks, NOW)).toEqual([])
  })

  it("keeps alerting a tick that used to run and stopped, with its last failure", () => {
    const stale = TICK_STALE_AFTER_SECONDS.reconcile
    expect(
      findingsWith(
        row("reconcile", {
          beatAt: ago(stale + 60),
          lastFailedAt: ago(30),
          lastErrorCode: "internal_error",
        })
      )
    ).toEqual([
      {
        kind: "stale_heartbeat",
        subject: "reconcile",
        details: expect.objectContaining({
          staleAfterSeconds: stale,
          lastFailedAt: ago(30).toISOString(),
          lastErrorCode: "internal_error",
        }),
      },
    ])
  })

  it("treats a long enough run of lock skips as a wedged lease", () => {
    expect(
      findingsWith(
        row("jobs", { consecutiveSkips: TICK_LOCK_WEDGED_AFTER_SKIPS - 1 })
      )
    ).toEqual([])
    expect(
      findingsWith(
        row("jobs", {
          consecutiveSkips: TICK_LOCK_WEDGED_AFTER_SKIPS,
          lastSkippedAt: ago(5),
        })
      )
    ).toEqual([
      expect.objectContaining({ kind: "tick_lock_wedged", subject: "jobs" }),
    ])
  })

  it("alerts a retention cycle that has not completed within its window", () => {
    const window = TICK_CYCLE_STALE_AFTER_SECONDS.retention
    expect(
      findingsWith(row("retention", { lastCycleCompletedAt: ago(window + 60) }))
    ).toEqual([
      expect.objectContaining({
        kind: "tick_cycle_overdue",
        subject: "retention",
      }),
    ])
    // Never completed a cycle: measured from registration, like a tick.
    expect(
      findingsWith(
        row("retention", {
          lastCycleCompletedAt: null,
          registeredAt: ago(window - 60),
        })
      )
    ).toEqual([])
    expect(
      findingsWith(
        row("retention", {
          lastCycleCompletedAt: null,
          registeredAt: ago(window + 60),
        })
      )
    ).toEqual([expect.objectContaining({ kind: "tick_cycle_overdue" })])
  })

  it("has no cycle window for ticks that do not report cycles", () => {
    const ticks = tickLiveness(HEALTHY, NOW)
    expect(ticks.find((tick) => tick.name === "jobs")).toMatchObject({
      cycleStaleAfterSeconds: null,
      cycleStale: false,
    })
  })

  it("never alerts the evaluating health tick", () => {
    expect(
      findingsWith(
        row("health", {
          beatAt: null,
          registeredAt: ago(30 * 86_400),
          consecutiveSkips: 10,
        })
      )
    ).toEqual([])
  })

  it("emits ticks the wire contract accepts, and the contract defaults old payloads", () => {
    for (const tick of tickLiveness(HEALTHY, NOW)) {
      expect(schedulerTickSchema.parse(tick)).toEqual(tick)
    }
    expect(
      schedulerTickSchema.parse({
        name: "jobs",
        lastCompletedAt: null,
        staleAfterSeconds: 300,
        stale: true,
      })
    ).toMatchObject({
      neverCompleted: false,
      lastStartedAt: null,
      lastSkippedAt: null,
      consecutiveSkips: 0,
      lockWedged: false,
      cycleStale: false,
    })
  })
})
