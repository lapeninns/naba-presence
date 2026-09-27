import { describe, expect, it } from "vitest"
import { emptyListingSummary } from "@/lib/contracts/location-summary"
import { listingHealth, summariseListingHealth } from "@/lib/listings/health"
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
