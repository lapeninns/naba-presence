import { describe, expect, it } from "vitest"

import { formatTimeOfDay, formatTimeZoneLabel } from "@/lib/format"

describe("formatTimeOfDay", () => {
  it("renders 24-hour HH:mm, never am or pm", () => {
    expect(formatTimeOfDay("17:00")).toBe("17:00")
    expect(formatTimeOfDay("09:30")).toBe("09:30")
    expect(formatTimeOfDay("12:00")).toBe("12:00")
    expect(formatTimeOfDay("23:59")).toBe("23:59")
  })

  it("keeps midnight as 00:00", () => {
    expect(formatTimeOfDay("00:00")).toBe("00:00")
    expect(formatTimeOfDay({ hours: 0, minutes: 0 })).toBe("00:00")
  })

  it("keeps 24:00 for a period that closes at the end of the day", () => {
    expect(formatTimeOfDay("24:00")).toBe("24:00")
    expect(formatTimeOfDay({ hours: 24, minutes: 0 })).toBe("24:00")
  })

  it("pads single-digit hours and minutes", () => {
    expect(formatTimeOfDay("9:05")).toBe("09:05")
    expect(formatTimeOfDay({ hours: 9, minutes: 5 })).toBe("09:05")
    expect(formatTimeOfDay({ hours: 5, minutes: 0 })).toBe("05:00")
  })

  it("accepts seconds and surrounding space", () => {
    expect(formatTimeOfDay("17:00:00")).toBe("17:00")
    expect(formatTimeOfDay(" 08:15 ")).toBe("08:15")
  })

  it("returns an unreadable string as given and an unreadable object as empty", () => {
    expect(formatTimeOfDay("")).toBe("")
    expect(formatTimeOfDay("soon")).toBe("soon")
    expect(formatTimeOfDay("25:00")).toBe("25:00")
    expect(formatTimeOfDay("24:30")).toBe("24:30")
    expect(formatTimeOfDay("09:75")).toBe("09:75")
    expect(formatTimeOfDay({ hours: 9, minutes: 60 })).toBe("")
    expect(formatTimeOfDay({ hours: -1, minutes: 0 })).toBe("")
    expect(formatTimeOfDay({ hours: 9.5, minutes: 0 })).toBe("")
  })
})

describe("formatTimeZoneLabel", () => {
  it("names Europe/London as UK time", () => {
    expect(formatTimeZoneLabel("Europe/London", "Pacific/Auckland")).toBe(
      "UK time"
    )
  })

  it("falls back to the generic zone name for other zones", () => {
    expect(formatTimeZoneLabel("Pacific/Auckland", "Europe/London")).toBe(
      "New Zealand time"
    )
    expect(formatTimeZoneLabel("America/New_York", "Europe/London")).toBe(
      "Eastern time"
    )
  })

  it("never returns the raw IANA id", () => {
    for (const zone of ["Europe/London", "Pacific/Auckland", "Asia/Tokyo"]) {
      expect(formatTimeZoneLabel(zone, "America/Chicago")).not.toContain("/")
    }
  })

  it("is hidden when it equals the viewer's zone", () => {
    expect(formatTimeZoneLabel("Europe/London", "Europe/London")).toBeNull()
    expect(
      formatTimeZoneLabel("Pacific/Auckland", "Pacific/Auckland")
    ).toBeNull()
  })

  it("is hidden for an alias of the viewer's zone", () => {
    expect(formatTimeZoneLabel("Europe/London", "GB")).toBeNull()
  })

  it("is shown when no viewer zone is given", () => {
    expect(formatTimeZoneLabel("Europe/London")).toBe("UK time")
    expect(formatTimeZoneLabel("Europe/London", null)).toBe("UK time")
  })

  it("returns null for an empty or unknown zone", () => {
    expect(formatTimeZoneLabel("")).toBeNull()
    expect(formatTimeZoneLabel("Not/AZone", "Europe/London")).toBeNull()
  })
})

describe("UK aliases and Google's sparse time objects", () => {
  it("names every UK alias UK time and hides it for a UK viewer", () => {
    for (const zone of ["GB", "Europe/Belfast", "Europe/Jersey"]) {
      expect(formatTimeZoneLabel(zone)).toBe("UK time")
      expect(formatTimeZoneLabel(zone, "Europe/London")).toBeNull()
    }
  })

  it("treats missing fields as zero and rejects 24:00 with seconds", () => {
    expect(formatTimeOfDay({ hours: 9 })).toBe("09:00")
    expect(formatTimeOfDay({})).toBe("00:00")
    expect(formatTimeOfDay("24:00:30")).toBe("24:00:30")
    expect(formatTimeOfDay("24:00:00")).toBe("24:00")
  })
})
