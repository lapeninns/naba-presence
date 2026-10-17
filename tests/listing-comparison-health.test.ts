import { describe, expect, it } from "vitest"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import {
  listingHealth,
  listingHealthLabel,
  summariseListingHealth,
} from "@/lib/listings/health"
import { clientHealth } from "@/lib/clients/health"

const now = new Date().toISOString()
function checked() {
  const summary = emptyListingSummary({
    locationId: "l1",
    linked: true,
    verified: true,
  })
  summary.connection = {
    status: "active",
    reconnectRequired: false,
    googleEmail: null,
  }
  summary.profile = { status: "in_sync", dirtyCount: 0, observedAt: now }
  summary.hours = { ...summary.profile }
  summary.menu = { ...summary.profile, eligible: false }
  return summary
}

describe("evidence-based listing and client health", () => {
  it("words a partly compared listing the way the clients list does", () => {
    expect(listingHealthLabel("partially_checked")).toBe(
      "Some areas not checked yet"
    )
  })

  it("never confirms missing summaries or unobserved hours", () => {
    expect(listingHealth({ linked: true })).toBe("unchecked")
    const summary = checked()
    summary.hours = { status: "unknown", dirtyCount: 0, observedAt: null }
    expect(listingHealth({ linked: true, summary })).toBe("partially_checked")
    expect(summariseListingHealth(["partially_checked"])).not.toContain(
      "in sync"
    )
  })
  it("requires timestamps for every applicable area but excludes unavailable menus", () => {
    const summary = checked()
    expect(listingHealth({ linked: true, summary })).toBe("healthy")
    summary.hours.observedAt = null
    expect(listingHealth({ linked: true, summary })).toBe("partially_checked")
    summary.hours.observedAt = "2000-01-01T00:00:00Z"
    expect(listingHealth({ linked: true, summary })).toBe("partially_checked")
  })
  it("counts a listing with no hours on Google under client attention", () => {
    // lib/server/clients.ts maps each listing through `listingHealth` and
    // counts "attention" under `canonicalChecks.attention`; clientHealth then
    // reads that count. There is no pure seam around the SQL read itself.
    const summary = checked()
    summary.hours.googleEmpty = true
    expect(listingHealth({ linked: true, summary })).toBe("attention")
    expect(
      clientHealth({
        connections: [
          {
            status: "active" as const,
            reconnectRequired: false,
            lastRefreshAt: now,
          },
        ],
        linkedLocationCount: 1,
        backfill: { running: 0, failed: 0 },
        canonicalChecks: {
          total: 1,
          checked: 0,
          partial: 0,
          attention: 1,
          unpublished: 0,
        },
      })
    ).toBe("attention")
  })
  it("does not call review-only client freshness fully checked", () => {
    const input = {
      connections: [
        {
          status: "active" as const,
          reconnectRequired: false,
          lastRefreshAt: now,
        },
      ],
      linkedLocationCount: 1,
      backfill: { running: 0, failed: 0 },
      checks: {
        stalestCheckAt: now,
        lastSuccessfulCheckAt: now,
        accessLost: 0,
      },
    }
    expect(clientHealth(input)).toBe("unchecked")
  })
})
