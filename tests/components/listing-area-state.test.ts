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

describe("areaState hours with no hours on Google", () => {
  const now = new Date().toISOString()
  const hoursSummary = (hours: Partial<ListingSummary["hours"]>) =>
    summary({
      connection: {
        status: "active",
        reconnectRequired: false,
        googleEmail: null,
      },
      hours: {
        status: "in_sync",
        dirtyCount: 0,
        observedAt: now,
        checkStatus: "checked",
        googleEmpty: true,
        ...hours,
      },
    })

  it("is attention rather than In sync", () => {
    expect(areaState("hours", hoursSummary({}))).toEqual({
      tone: "attention",
      label: "No hours on Google",
      line: "Customers see no opening hours",
    })
  })

  it("leaves dirty, conflict and unreachable states as they are", () => {
    expect(
      areaState("hours", hoursSummary({ status: "core_dirty", dirtyCount: 1 }))
        .label
    ).toBe("Not on Google yet")
    expect(
      areaState("hours", hoursSummary({ status: "conflict", dirtyCount: 1 }))
        .label
    ).toBe("Conflict")
    expect(
      areaState("hours", {
        ...hoursSummary({}),
        connection: {
          status: "revoked",
          reconnectRequired: true,
          googleEmail: null,
        },
      }).label
    ).toBe("Unknown — can’t reach Google")
  })

  it("is In sync when googleEmpty is false or absent, and Couldn’t check when failed", () => {
    expect(areaState("hours", hoursSummary({ googleEmpty: false })).label).toBe(
      "In sync"
    )
    expect(
      areaState("hours", hoursSummary({ googleEmpty: undefined })).label
    ).toBe("In sync")
    expect(
      areaState("hours", hoursSummary({ checkStatus: "failed" })).label
    ).toBe("Couldn’t check")
  })
})

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

  it("says Unknown instead of In sync while the Google login is broken", () => {
    const broken = summary({
      connection: {
        status: "revoked",
        reconnectRequired: true,
        googleEmail: null,
      },
      hours: {
        status: "in_sync",
        dirtyCount: 0,
        observedAt: new Date().toISOString(),
      },
      profile: { status: "core_dirty", dirtyCount: 1, observedAt: null },
    })
    expect(areaState("hours", broken)).toMatchObject({
      tone: "neutral",
      label: "Unknown — can’t reach Google",
    })
    expect(areaState("hours", broken).line).not.toMatch(/Checked/)
    // Edits saved here are still known to be off Google.
    expect(areaState("profile", broken).label).toBe("Not on Google yet")
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
      observedAt: new Date().toISOString(),
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
