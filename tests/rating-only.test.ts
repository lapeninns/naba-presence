import { describe, expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"

describe("rating-only draft templates", () => {
  it.each([
    [5, "en", "hope to welcome"],
    [3, "en", "appreciate your feedback"],
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
})
