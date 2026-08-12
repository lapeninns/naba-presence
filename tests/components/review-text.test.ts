import { describe, expect, it } from "vitest"

import { parseReviewText } from "@/lib/inbox/review-text"

describe("parseReviewText", () => {
  it("returns null for a rating-only review", () => {
    expect(parseReviewText(null, "en")).toBeNull()
    expect(parseReviewText("   ", "en")).toBeNull()
  })

  it("passes an untranslated review through under its detected language", () => {
    expect(parseReviewText("Lovely stay.", "en")).toEqual({
      body: "Lovely stay.",
      bodyLang: "en",
      original: null,
      originalLang: null,
    })
  })

  it("splits Google's two-language blob and tags each half", () => {
    const parsed = parseReviewText(
      "(Translated by Google) The food is excellent. I recommend Nepalese specialties. (Original) Si mangia benissimo. Vi consiglio specialità nepalesi",
      "it"
    )
    expect(parsed).toEqual({
      body: "The food is excellent. I recommend Nepalese specialties.",
      bodyLang: "en",
      original: "Si mangia benissimo. Vi consiglio specialità nepalesi",
      originalLang: "it",
    })
  })

  it("keeps a multi-line original intact", () => {
    const parsed = parseReviewText(
      "(Translated by Google) Line one.\nLine two. (Original) Zeile eins.\nZeile zwei.",
      "de"
    )
    expect(parsed?.original).toBe("Zeile eins.\nZeile zwei.")
  })

  // "(Original)" is a plausible thing for a reviewer to type; only the leading
  // "(Translated by Google)" marker makes it a translation.
  it("does not treat a stray '(Original)' as a translation marker", () => {
    const parsed = parseReviewText("Great, better than the (Original) branch.", "en")
    expect(parsed?.original).toBeNull()
    expect(parsed?.body).toBe("Great, better than the (Original) branch.")
  })

  // Observed live: a Polish review comes back with detectedLanguageCode "en"
  // (the language of the translation, not the source). Nothing translated
  // INTO English has an English original, so the code is known-wrong here and
  // must not become a label or a `lang` attribute.
  it("drops a detected code that just echoes the translation target", () => {
    const parsed = parseReviewText(
      "(Translated by Google) The food is delicious. (Original) Jedzenie pyszne.",
      "en"
    )
    expect(parsed?.original).toBe("Jedzenie pyszne.")
    expect(parsed?.originalLang).toBeNull()
  })

  it("drops a regional variant of the target too", () => {
    const parsed = parseReviewText(
      "(Translated by Google) Lovely. (Original) Piekne.",
      "en-GB"
    )
    expect(parsed?.originalLang).toBeNull()
  })

  it("falls back to the raw string when one side of the marker is empty", () => {
    const parsed = parseReviewText("(Translated by Google) Nice. (Original)", "it")
    expect(parsed?.original).toBeNull()
    expect(parsed?.bodyLang).toBe("it")
  })
})
