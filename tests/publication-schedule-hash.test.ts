import { describe, expect, it } from "vitest"

import { schedulePayloadHash } from "@/lib/server/publication-schedules"

const base = {
  locationId: "00000000-0000-4000-8000-0000000000b1",
  template: { topicType: "STANDARD", summary: "Sunday roast is back" },
  timezone: "Europe/London",
  eventOffsets: null,
}

describe("schedulePayloadHash and the one-time slot offset (P08-R2)", () => {
  it("leaves the offset out where the time happens once, so a pre-0241 hash still holds", () => {
    const rule = {
      frequency: "once" as const,
      startDate: "2026-10-20",
      localTime: "09:00",
    }
    const legacy = schedulePayloadHash({ ...base, rule })
    expect(schedulePayloadHash({ ...base, rule, offsetMinutes: 60 })).toBe(
      legacy
    )
    expect(schedulePayloadHash({ ...base, rule, offsetMinutes: null })).toBe(
      legacy
    )
  })

  it("covers the chosen offset where the time happens twice", () => {
    const rule = {
      frequency: "once" as const,
      startDate: "2026-10-25",
      localTime: "01:30",
    }
    const earlier = schedulePayloadHash({ ...base, rule, offsetMinutes: 60 })
    const later = schedulePayloadHash({ ...base, rule, offsetMinutes: 0 })
    expect(earlier).not.toBe(later)
    expect(earlier).not.toBe(schedulePayloadHash({ ...base, rule }))
  })
})
