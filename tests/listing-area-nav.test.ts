import { describe, expect, it } from "vitest"

import { listingAreaNavItems } from "@/lib/listings/area-nav"
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
