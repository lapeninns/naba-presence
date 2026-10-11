import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  TICK_CYCLE_STALE_AFTER_SECONDS,
  TICK_STALE_AFTER_SECONDS,
} from "@/lib/server/ops-liveness"
import {
  RETENTION_CYCLE_START_HOUR_UTC,
  RETENTION_ORG_MAX_ATTEMPTS,
  retentionCycleDate,
} from "@/lib/server/retention/cycle"

describe("retentionCycleDate", () => {
  it("opens no cycle before 03:00 UTC", () => {
    expect(RETENTION_CYCLE_START_HOUR_UTC).toBe(3)
    expect(retentionCycleDate(new Date("2026-10-11T00:00:00Z"))).toBeNull()
    expect(retentionCycleDate(new Date("2026-10-11T02:59:59.999Z"))).toBeNull()
  })

  it("names the UTC day at and after 03:00 UTC", () => {
    expect(retentionCycleDate(new Date("2026-10-11T03:00:00Z"))).toBe(
      "2026-10-11"
    )
    expect(retentionCycleDate(new Date("2026-10-11T23:59:59Z"))).toBe(
      "2026-10-11"
    )
  })

  it("uses the UTC day, not the server's local one", () => {
    // 01:30 in UTC+3 is 22:30 the previous day in UTC: that day's cycle.
    expect(retentionCycleDate(new Date("2026-10-12T01:30:00+03:00"))).toBe(
      "2026-10-11"
    )
    // 23:30 in UTC-5 is 04:30 the next day in UTC.
    expect(retentionCycleDate(new Date("2026-10-11T23:30:00-05:00"))).toBe(
      "2026-10-12"
    )
    // 04:00 in UTC+2 is 02:00 UTC: still before the start.
    expect(retentionCycleDate(new Date("2026-10-11T04:00:00+02:00"))).toBeNull()
  })

  it("gives each organisation a bounded number of runs per cycle", () => {
    expect(RETENTION_ORG_MAX_ATTEMPTS).toBeGreaterThan(1)
    expect(RETENTION_ORG_MAX_ATTEMPTS).toBeLessThanOrEqual(5)
  })
})

describe("retention dispatcher liveness", () => {
  it("expects a fire every few minutes and a finished cycle within 26 hours", () => {
    expect(TICK_STALE_AFTER_SECONDS.retention).toBe(900)
    expect(TICK_CYCLE_STALE_AFTER_SECONDS.retention).toBe(26 * 3600)
  })
})

describe("0097_retention_cycle migration", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/0097_retention_cycle.sql", import.meta.url),
    "utf8"
  )

  it("keeps one cycle per UTC day and one row per organisation in it", () => {
    expect(migration).toMatch(/cycle_date date not null unique/)
    expect(migration).toMatch(/primary key \(cycle_id, organisation_id\)/)
    expect(migration).toMatch(
      /check \(status in \('pending', 'succeeded', 'failed'\)\)/
    )
    expect(migration).toMatch(/check \(status in \('running', 'completed'\)\)/)
  })

  it("is platform-level and granted to the runtime role", () => {
    expect(migration).not.toMatch(/enable row level security/)
    expect(migration).toContain(
      "grant select, insert, update, delete on retention_cycle to naba_app_runtime;"
    )
    expect(migration).toContain(
      "grant select, insert, update, delete on retention_cycle_org to naba_app_runtime;"
    )
    expect(migration).toContain("'0097_retention_cycle'")
  })
})

describe("retention route", () => {
  const route = readFileSync(
    new URL("../app/api/cron/retention/route.ts", import.meta.url),
    "utf8"
  )

  it("dispatches the cycle unless a page cursor is given", () => {
    expect(route).toContain('searchParams.has("cursor")')
    expect(route).toContain("runRetentionCycle(")
    expect(route).toMatch(/retainPage\([\s\S]*trigger: "manual"/)
  })
})
