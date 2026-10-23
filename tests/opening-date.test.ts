import { describe, expect, it } from "vitest"

import {
  openingDateDraft,
  openingDateLabel,
  openingDatePayload,
} from "@/lib/locations/forms/opening-date"

/** The profile editor's opening date (lib/locations/forms/opening-date.ts). */

describe("opening date", () => {
  it("round-trips Google's date through the form, with or without a day", () => {
    const full = { year: 2019, month: 6, day: 14 }
    expect(openingDatePayload(openingDateDraft(full)!)).toEqual(full)
    const monthOnly = { year: 2019, month: 6 }
    expect(openingDateDraft(monthOnly)).toEqual({
      year: "2019",
      month: "6",
      day: "",
    })
    expect(openingDatePayload(openingDateDraft(monthOnly)!)).toEqual(monthOnly)
  })

  it("has no draft for a missing date, and blanks parts that are not numbers", () => {
    expect(openingDateDraft(undefined)).toBeUndefined()
    expect(openingDateDraft("2019-06-14")).toBeUndefined()
    expect(openingDateDraft({ year: "2019", month: 6 })).toEqual({
      year: "",
      month: "6",
      day: "",
    })
  })

  it("sends no day for a blank one", () => {
    expect(openingDatePayload({ year: "2019", month: "6", day: "  " })).toEqual(
      {
        year: 2019,
        month: 6,
      }
    )
  })

  it("reads as a day, a month name and a year", () => {
    expect(openingDateLabel({ year: "2019", month: "6", day: "14" })).toBe(
      "14 June 2019"
    )
    expect(openingDateLabel({ year: "2019", month: "12", day: "" })).toBe(
      "December 2019"
    )
    // Google's "no day" is 0.
    expect(openingDateLabel({ year: "2019", month: "1", day: "0" })).toBe(
      "January 2019"
    )
    expect(openingDateLabel(null)).toBe("Not set")
    expect(openingDateLabel(undefined)).toBe("Not set")
  })
})
