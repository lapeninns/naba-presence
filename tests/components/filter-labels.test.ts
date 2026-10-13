import { describe, expect, it } from "vitest"

import {
  formatRatings,
  removeFilterLabel,
  resultsAnnouncement,
  showResultsLabel,
} from "@/lib/inbox/filter-labels"

describe("filter labels", () => {
  it("turns the list's count into the sheet's closing button", () => {
    expect(showResultsLabel("12 reviews")).toBe("Show 12 reviews")
    expect(showResultsLabel("1 review")).toBe("Show 1 review")
    expect(showResultsLabel("1,204 reviews")).toBe("Show 1,204 reviews")
    // More pages to come: the count is a floor, and says so.
    expect(showResultsLabel("50 reviews so far")).toBe("Show 50+ reviews")
    // Not known yet: say so rather than promise a number.
    expect(showResultsLabel("Loading reviews…")).toBe("Loading reviews…")
    expect(showResultsLabel("Queue unavailable")).toBe("Show results")
  })

  it("announces settled counts only", () => {
    expect(resultsAnnouncement("12 reviews")).toBe("12 reviews")
    expect(resultsAnnouncement("Loading reviews…")).toBe("")
  })

  it("words ratings as a range or a list", () => {
    expect(formatRatings([1])).toBe("1 star")
    expect(formatRatings([4, 5])).toBe("4–5 stars")
    expect(formatRatings([5, 1, 3])).toBe("1, 3, 5 stars")
  })

  it("names a chip's remove control after the chip", () => {
    expect(removeFilterLabel("Rating: 5 stars")).toBe(
      "Remove filter: Rating: 5 stars"
    )
  })
})
