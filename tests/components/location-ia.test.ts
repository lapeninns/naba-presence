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
  it("opens on Profile rather than a section holding one Profile tab", () => {
    // The old "Overview" section contained a single tab labelled Profile, so
    // the first thing a user saw was a section heading duplicating the tab
    // under it. The profile IS a location's overview.
    const sections = visibleLocationSections(true)
    expect(sections.map((s) => s.id)).toEqual([
      "profile",
      "content",
      "customers",
      "access",
      "insights",
    ])
    expect(sections[0].tabs[0]).toMatchObject({ segment: "", label: "Profile" })
  })

  it("hides the console tabs from members, section and all", () => {
    const member = visibleLocationSections(false)
    // Access holds only console-gated tabs, so the whole section disappears
    // rather than rendering an empty heading.
    expect(member.map((s) => s.id)).toEqual([
      "profile",
      "content",
      "customers",
      "insights",
    ])
    const labels = member.flatMap((s) => s.tabs.map((t) => t.label))
    expect(labels).not.toContain("Industry")
    expect(labels).not.toContain("Access")
  })
})
