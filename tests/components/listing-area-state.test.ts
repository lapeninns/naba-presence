import { describe, expect, it } from "vitest"

import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import {
  areaState,
  suggestionCount,
  uncheckedAreas,
} from "@/lib/listings/area-state"

function summary(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    ...emptyListingSummary({ locationId: "l1", linked: true, verified: true }),
    ...overrides,
  }
}

describe("areaState", () => {
  it("counts local edits on a canonical area in the pill", () => {
    const state = areaState(
      "profile",
      summary({
        profile: { status: "core_dirty", dirtyCount: 3, observedAt: null },
      })
    )
    expect(state).toMatchObject({
      tone: "pending",
      label: "3 changes not on Google",
      line: "3 fields not yet on Google",
    })
  })

  it("never claims a Google-direct area is live without evidence", () => {
    for (const key of ["booking", "photos", "people"] as const) {
      expect(areaState(key, summary()).label).not.toMatch(/live/i)
    }
    expect(areaState("posts", summary()).label).toBe("Nothing waiting")
  })

  it("puts the real suggestion count on the suggestions area", () => {
    const withTwo = summary({ suggestions: { profile: 1, foodMenus: 1 } })
    expect(suggestionCount(withTwo)).toBe(2)
    expect(areaState("suggestions", withTwo)).toMatchObject({
      tone: "attention",
      label: "2 waiting",
    })
    expect(suggestionCount(undefined)).toBe(0)
    expect(areaState("suggestions", summary()).label).toBe("Nothing waiting")
  })

  it("reports verification from the summary only", () => {
    expect(areaState("verification", summary()).label).toBe("Verified")
    expect(areaState("verification", summary({ verified: false })).label).toBe(
      "Not verified"
    )
  })
})

describe("uncheckedAreas", () => {
  it("names canonical areas never compared with Google", () => {
    const checked = {
      status: "in_sync" as const,
      dirtyCount: 0,
      observedAt: "2026-09-01T00:00:00Z",
    }
    const unknown = {
      status: "unknown" as const,
      dirtyCount: 0,
      observedAt: null,
    }
    expect(
      uncheckedAreas(
        summary({
          profile: checked,
          hours: unknown,
          menu: { ...checked, eligible: true },
        })
      )
    ).toEqual(["opening hours"])
    // A menu Google doesn't offer is never "unchecked".
    expect(
      uncheckedAreas(
        summary({
          profile: checked,
          hours: checked,
          menu: { ...unknown, eligible: false },
        })
      )
    ).toEqual([])
  })
})
