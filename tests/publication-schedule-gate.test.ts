import type { TransactionSql } from "postgres"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OrgFeature } from "@/lib/contracts/org-features"
import { ORG_FEATURES } from "@/lib/contracts/org-features"
import type { ScheduleRule } from "@/lib/domain/publication-schedule"

const enabled = new Set<OrgFeature>()
vi.mock("@/lib/server/org-features", () => ({
  isOrgFeatureEnabled: vi.fn(
    async (_sql: unknown, _organisationId: string, feature: OrgFeature) =>
      enabled.has(feature)
  ),
}))

const { schedulingAvailability } =
  await import("@/lib/server/publication-schedules")

const sql = {} as TransactionSql
const ORG = "00000000-0000-4000-8000-00000000000a"
const once: ScheduleRule = {
  frequency: "once",
  startDate: "2026-11-01",
  localTime: "09:00",
}
const weekly: ScheduleRule = {
  frequency: "weekly",
  startDate: "2026-11-01",
  localTime: "09:00",
  end: { type: "count", count: 4 },
  weekdays: [1],
}

describe("post scheduling availability (P08-R1)", () => {
  beforeEach(() => enabled.clear())

  it("declares both features", () => {
    expect(ORG_FEATURES).toContain("post_scheduling")
    expect(ORG_FEATURES).toContain("post_scheduling_recurring")
  })

  it("is off without post_scheduling, whatever the rule", async () => {
    expect(await schedulingAvailability(sql, ORG)).toBe("feature_disabled")
    expect(await schedulingAvailability(sql, ORG, once)).toBe(
      "feature_disabled"
    )
    enabled.add("post_scheduling_recurring")
    expect(await schedulingAvailability(sql, ORG, weekly)).toBe(
      "feature_disabled"
    )
  })

  it("allows one-time publication with post_scheduling alone", async () => {
    enabled.add("post_scheduling")
    expect(await schedulingAvailability(sql, ORG)).toBe("ok")
    expect(await schedulingAvailability(sql, ORG, once)).toBe("ok")
  })

  it("needs post_scheduling_recurring for a repeating rule", async () => {
    enabled.add("post_scheduling")
    expect(await schedulingAvailability(sql, ORG, weekly)).toBe(
      "recurring_disabled"
    )
    enabled.add("post_scheduling_recurring")
    expect(await schedulingAvailability(sql, ORG, weekly)).toBe("ok")
  })
})
