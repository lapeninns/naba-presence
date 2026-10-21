import { describe, expect, it } from "vitest"

import { formatAddressLine } from "@/lib/locations/address"

/** The one-line address the directory shows (lib/locations/address.ts). */

describe("formatAddressLine", () => {
  it("reads the lines, the locality, the area and the postcode, in order", () => {
    expect(
      formatAddressLine({
        regionCode: "GB",
        postalCode: "CB3 0QE",
        administrativeArea: "Cambridgeshire",
        locality: "Girton",
        addressLines: ["1 High Street", "Old Crown Yard"],
      })
    ).toBe("1 High Street, Old Crown Yard, Girton, Cambridgeshire, CB3 0QE")
  })

  it("leaves out blank and non-text parts", () => {
    expect(
      formatAddressLine({
        addressLines: ["1 High Street", 7, ""],
        locality: "  ",
        administrativeArea: null,
        postalCode: "CB3 0QE",
      })
    ).toBe("1 High Street, CB3 0QE")
  })

  it("has no line when there is nothing to read", () => {
    expect(formatAddressLine(null)).toBeNull()
    expect(formatAddressLine("1 High Street")).toBeNull()
    expect(formatAddressLine({ regionCode: "GB" })).toBeNull()
    expect(formatAddressLine({ addressLines: "1 High Street" })).toBeNull()
  })
})
