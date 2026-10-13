import { describe, expect, it } from "vitest"

import { adjacentReviewId } from "@/lib/inbox/queue-nav"

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

})
