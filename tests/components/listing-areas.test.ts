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
    expect(listingArea("verification").model).toBe("reviewed")
    expect(listingArea("people").model).toBe("reviewed")
    expect(modelNote("reviewed", "people")).toMatch(
      /Administrator and invitation changes are reviewed and approved/
    )
    expect(modelNote("reviewed")).toMatch(/approve it, then send/)
    expect(modelNote("reviewed")).toMatch(/confirmation is checked separately/)
  })

  it("never tells the booking tab its changes go to Google straight away", () => {
    const area = listingArea("booking")
    const note = modelNote(area.model, area.key)
    expect(note).not.toMatch(/straight away/)
    expect(note).toMatch(
      /review each link change, approve it, then send it to Google as a separate step/
    )
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
