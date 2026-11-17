import { describe, expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { stockPhrasesIn } from "@/lib/domain/reply-style"
import { deterministicVerification } from "@/lib/domain/verification"

describe("rating-only draft templates", () => {
  it.each([
    [5, "en", "Good to know you enjoyed your visit"],
    [3, "en", "anything we could have done better"],
    [1, "en", "We are sorry your visit was not what it should have been"],
    [4, "fr-FR", "votre visite vous ait plu"],
    [2, "de", "Es tut uns leid"],
  ])(
    "selects a sparse template for %i stars in %s",
    (rating, language, text) => {
      expect(ratingOnlyReply(rating, language).reply).toContain(text)
    }
  )

  it.each([5, 3, 1, null])(
    "uses no stock phrase and passes the rule checks for %s stars",
    (rating) => {
      const { reply } = ratingOnlyReply(rating, "en", "Sarah")
      expect(stockPhrasesIn(reply)).toEqual([])
      expect(
        deterministicVerification({
          body: reply,
          reviewText: null,
          locationName: "The Old Crown",
          otherLocationNames: ["The Railway"],
          rating,
          expectedLanguage: "en",
          ratingOnlyTemplate: true,
        })
      ).toEqual([])
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
