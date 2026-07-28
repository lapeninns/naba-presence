import { describe, expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"

describe("rating-only draft templates", () => {
  it.each([
    [5, "en", "hope to welcome"],
    [3, "en", "next visit even better"],
    [1, "en", "fell short"],
    [4, "fr-FR", "accueillir"],
    [2, "de", "Erwartungen"],
  ])(
    "selects a sparse template for %i stars in %s",
    (rating, language, text) => {
      expect(ratingOnlyReply(rating, language).reply).toContain(text)
    }
  )

  it("falls back safely when the requested language is unsupported", () => {
    expect(ratingOnlyReply(5, "cy")).toMatchObject({ language: "en" })
  })

  it("personalizes a rating-only reply when a reviewer name is available", () => {
    expect(ratingOnlyReply(5, "en", "Sarah").reply).toMatch(
      /^Hi Sarah, thank you/
    )
  })

  it("does not include an unreasonably long reviewer name", () => {
    expect(ratingOnlyReply(5, "en", "A".repeat(81)).reply).not.toContain(
      "A".repeat(81)
    )
  })
})
