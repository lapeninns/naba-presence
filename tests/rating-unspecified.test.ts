import { describe, expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { ratingValue } from "@/lib/server/reviews"

describe("unspecified review ratings", () => {
  it("maps STAR_RATING_UNSPECIFIED to null", () => {
    expect(ratingValue("STAR_RATING_UNSPECIFIED")).toBeNull()
  })

  it("maps unknown provider ratings to null", () => {
    expect(ratingValue("SEVEN")).toBeNull()
  })

  it("maps known provider ratings normally", () => {
    expect(ratingValue("FIVE")).toBe(5)
  })

  it("routes a null rating to the neutral template", () => {
    expect(ratingOnlyReply(null as never, "en").reply).toContain(
      "next visit even better"
    )
  })
})
