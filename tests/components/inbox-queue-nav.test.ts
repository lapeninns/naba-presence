import { describe, expect, it } from "vitest"

import { adjacentReviewId, pageForIndex } from "@/lib/inbox/queue-nav"

describe("inbox queue nav", () => {
  const reviews = [{ id: "a" }, { id: "b" }, { id: "c" }]

  it("returns the neighbouring id, or null at either end", () => {
    expect(adjacentReviewId(reviews, "b", "next")).toBe("c")
    expect(adjacentReviewId(reviews, "b", "prev")).toBe("a")
    expect(adjacentReviewId(reviews, "c", "next")).toBeNull()
    expect(adjacentReviewId(reviews, "a", "prev")).toBeNull()
  })

  it("returns null when nothing is selected or the id is not in the list", () => {
    expect(adjacentReviewId(reviews, undefined, "next")).toBeNull()
    expect(adjacentReviewId(reviews, "missing", "next")).toBeNull()
    expect(adjacentReviewId([], "a", "next")).toBeNull()
  })

  it("maps a list index onto a page", () => {
    expect(pageForIndex(0, 7)).toBe(0)
    expect(pageForIndex(6, 7)).toBe(0)
    expect(pageForIndex(7, 7)).toBe(1)
    expect(pageForIndex(-1, 7)).toBe(0)
  })
})
