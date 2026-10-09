import { describe, expect, it } from "vitest"

import {
  areaForSegment,
  LISTING_AREAS,
  listingArea,
  listingHref,
  modelNote,
  visibleListingAreas,
} from "@/lib/listings/areas"

describe("listing areas", () => {
  it("has no Performance area: that is a report, on Reports", () => {
    expect(LISTING_AREAS.map((area) => area.key)).not.toContain("performance")
    expect(areaForSegment("performance")).toBeUndefined()
  })

  it("names where each area's changes go", () => {
    expect(listingArea("profile").model).toBe("canonical")
    expect(listingArea("photos").model).toBe("google_direct")
    expect(listingArea("posts").model).toBe("lifecycle")
    expect(listingArea("suggestions").model).toBe("inbound")
    expect(modelNote("google_direct")).toMatch(/straight away/)
  })

  it("hides the consoles from members", () => {
    const keys = visibleListingAreas(false).map((area) => area.key)
    expect(keys).not.toContain("people")
    expect(keys).not.toContain("verification")
    expect(visibleListingAreas(true).map((area) => area.key)).toContain(
      "people"
    )
  })

  it("builds listing paths", () => {
    expect(listingHref("l1")).toBe("/listings/l1")
    expect(listingHref("l1", "hours")).toBe("/listings/l1/hours")
    expect(areaForSegment("people")?.label).toBe("People with access")
  })
})
