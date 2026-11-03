import { describe, expect, it } from "vitest"

import {
  listingAreaNavItems,
  PRIMARY_LISTING_PAGES,
} from "@/lib/listings/area-nav"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"

const caps = (over: Partial<LocationCapabilities>): LocationCapabilities =>
  ({
    canEditCanonical: false,
    canPublish: false,
    ...over,
  }) as LocationCapabilities

const keys = (
  capabilities: LocationCapabilities | undefined,
  current: "overview" | "changes" = "overview"
) =>
  listingAreaNavItems({
    locationId: "l1",
    current,
    canManageConsoles: false,
    summary: undefined,
    caps: capabilities,
    linked: true,
  }).map((item) => item.key)

describe("Review & publish in the listing navigation", () => {
  it("is offered to roles that can edit, publish or ask for approval", () => {
    expect(keys(caps({ canEditCanonical: true }))).toContain("changes")
    expect(keys(caps({ canPublish: true }))).toContain("changes")
    expect(keys(caps({ canRequestApproval: true }))).toContain("changes")
  })
  it("is offered while the capabilities are still loading", () => {
    expect(keys(undefined)).toContain("changes")
  })
  it("is left out for a role that can neither edit nor publish", () => {
    expect(keys(caps({}))).not.toContain("changes")
  })
  it("stays, and stays current, on a direct link to the page", () => {
    expect(keys(caps({}), "changes")).toContain("changes")
  })
})

describe("the listing's area order and counts", () => {
  const items = (summary?: ListingSummary) =>
    listingAreaNavItems({
      locationId: "l1",
      current: "overview",
      canManageConsoles: true,
      summary,
      caps: caps({ canEditCanonical: true, canPublish: true }),
      linked: true,
    })

  it("leads with the six primary pages, the rest after them", () => {
    const keys = items().map((item) => item.key)
    expect(keys.slice(0, 6)).toEqual([...PRIMARY_LISTING_PAGES])
    expect(keys.slice(6)).toEqual([
      "booking",
      "people",
      "verification",
      "suggestions",
      "reviewLink",
      "changes",
    ])
  })

  it("counts each area's changes saved here, not on Google", () => {
    const summary = emptyListingSummary({
      locationId: "l1",
      linked: true,
      verified: true,
    })
    const edited = items({
      ...summary,
      hours: { status: "core_dirty", dirtyCount: 2, observedAt: null },
      menu: { ...summary.menu, status: "conflict", dirtyCount: 0 },
    })
    const count = (key: string) =>
      edited.find((item) => item.key === key)?.count
    expect(count("hours")).toBe(2)
    expect(count("menu")).toBe(1)
    expect(count("profile")).toBe(0)
    expect(edited.find((item) => item.key === "hours")?.countNoun).toBe(
      "to publish"
    )
    // The listing total is the sum of the areas.
    expect(count("changes")).toBe(3)
  })
})
