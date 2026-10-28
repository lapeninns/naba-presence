import { describe, expect, it } from "vitest"

import {
  formatWallDateTime,
  zoneName,
} from "@/components/locations/posts/schedule-dates"
import { COMMON_TIMEZONES } from "@/lib/settings/timezones"

describe("schedule zone names (LST-19)", () => {
  it("names the venue's zone in words, never by its database id", () => {
    expect(zoneName("Europe/London")).toBe("UK time")
    expect(zoneName("America/New_York")).toBe("Eastern time")
  })

  it("falls back to the spaced id for a zone Intl cannot name", () => {
    expect(zoneName("Mars/Olympus")).toBe("Mars / Olympus")
  })

  it("never shows a raw id for the zones the sheet offers", () => {
    for (const zone of COMMON_TIMEZONES) {
      expect(zoneName(zone)).not.toContain("/")
    }
  })
})

describe("schedule list dates", () => {
  it("reads a wall date and time as a day, not an ISO date", () => {
    expect(formatWallDateTime("2026-10-20", "09:00")).toBe("Tue 20 Oct, 09:00")
  })
})
