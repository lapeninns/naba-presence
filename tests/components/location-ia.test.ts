import { describe, expect, it } from "vitest"

import {
  inputToTimeOfDay,
  lodgingUpdatedPaths,
  timeOfDayToInput,
} from "@/lib/locations/forms/industry"
import { visibleLocationSections } from "@/lib/locations/location-ia"

describe("lodging form helpers", () => {
  it("round-trips TimeOfDay for policy inputs", () => {
    expect(timeOfDayToInput({ hours: 15, minutes: 30 })).toBe("15:30")
    expect(timeOfDayToInput("9:05")).toBe("09:05")
    expect(inputToTimeOfDay("14:00")).toEqual({
      hours: 14,
      minutes: 0,
      seconds: 0,
      nanos: 0,
    })
  })

  it("reads lodgingUpdated diff masks in both shapes", () => {
    expect(lodgingUpdatedPaths({ diffMask: "policies,pets" })).toEqual([
      "policies",
      "pets",
    ])
    expect(
      lodgingUpdatedPaths({ diffMask: { paths: ["connectivity"] } })
    ).toEqual(["connectivity"])
  })
})

describe("location IA", () => {
  it("exposes six job sections and hides console tabs for members", () => {
    expect(visibleLocationSections(true)).toHaveLength(6)
    const member = visibleLocationSections(false)
    expect(member.map((s) => s.id)).toEqual([
      "overview",
      "profile",
      "content",
      "customers",
      "insights",
    ])
    expect(member.flatMap((s) => s.tabs.map((t) => t.label))).not.toContain(
      "Industry"
    )
  })
})
