import { describe, expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"
import {
  isCourtesyOnly,
  semanticReasons,
  type SemanticVerdict,
} from "@/lib/domain/semantic-verification"
import {
  deterministicVerification,
  verificationVerdict,
} from "@/lib/domain/verification"

import {
  BAD_REPLIES,
  NOT_BLOCKED,
  REVIEW_CASES,
  SIBLING_VENUES,
  VENUE,
} from "./fixtures/reply-quality/corpus"

const rules = (
  body: string,
  rating: number | null,
  reviewText: string | null
) =>
  deterministicVerification({
    body,
    reviewText,
    locationName: VENUE.name,
    otherLocationNames: SIBLING_VENUES,
    rating,
    expectedLanguage: "en",
  })

const cleanVerdict: SemanticVerdict = {
  issues: [],
  addressesGuestDirectly: true,
  relevance: "specific",
  unsafeEscalation: false,
  toneMismatch: false,
}

describe("the two replies that were blocked by checks", () => {
  // Both came from the AI verification pass, which was asked for "claims
  // not supported by the review" and failed the reply on every item.
  it("1: a courtesy is not an unsupported claim", () => {
    const reply =
      "Hi Sam, thank you for your rating. We really appreciate your support. We hope to welcome you back soon."
    const reasons = semanticReasons(
      {
        ...cleanVerdict,
        issues: [
          {
            quote:
              "We really appreciate your support. We hope to welcome you back soon.",
            kind: "invented_detail",
            explanation: "Not stated in the review.",
          },
        ],
      },
      { body: reply, reviewText: null }
    )
    expect(reasons).toEqual([])
    // Nothing blocks it. It is still poor writing, said as a note.
    const ruleReasons = rules(reply, 5, null)
    expect(verificationVerdict(ruleReasons)).toBe("warn")
    expect(ruleReasons.map((reason) => reason.code)).toEqual(["stock_phrase"])
  })

  it("1: the rating-only template no longer contains those lines", () => {
    for (const rating of [5, 4, 3, 2, 1, null]) {
      const { reply } = ratingOnlyReply(rating, "en", "Sam")
      expect(reply).not.toMatch(/appreciate your support|welcome you back/iu)
      expect(rules(reply, rating, null)).toEqual([])
    }
  })

  it("2: a finding the verifier wrote in its own words is dropped", () => {
    const reply =
      "Thanks, Linda. Good to know Fridays here keep working for you. See you next week."
    const reasons = semanticReasons(
      {
        ...cleanVerdict,
        issues: [
          {
            quote:
              "The reviewer continues to enjoy multiple visits and will return again soon.",
            kind: "invented_detail",
            explanation: "Paraphrase, not in the reply.",
          },
        ],
      },
      { body: reply, reviewText: "We come here most Fridays." }
    )
    expect(reasons).toEqual([])
  })

  it("2: a reply that really is a third-person summary fails, with what to do", () => {
    const reasons = rules(
      "The reviewer continues to enjoy multiple visits and will return again soon.",
      5,
      "We come here most Fridays."
    )
    expect(reasons).toContainEqual({
      code: "third_person_summary",
      severity: "fail",
      message:
        "The reply talks about the guest instead of to them (for example “the reviewer”). Rewrite it to address them as “you”.",
    })
  })
})

describe("replies a manager could publish pass the rule checks", () => {
  it.each(REVIEW_CASES.map((review) => [review.id, review] as const))(
    "%s",
    (_id, review) => {
      expect(rules(review.goodReply, review.rating, review.reviewText)).toEqual(
        []
      )
    }
  )

  it("passes all of them: no over-blocking across the corpus", () => {
    const passed = REVIEW_CASES.filter(
      (review) =>
        verificationVerdict(
          rules(review.goodReply, review.rating, review.reviewText)
        ) === "pass"
    )
    expect(passed).toHaveLength(REVIEW_CASES.length)
  })
})

describe("replies that must not pass are caught", () => {
  it.each(BAD_REPLIES.map((bad) => [bad.id, bad] as const))(
    "%s",
    (_id, bad) => {
      const reasons = rules(bad.reply, bad.rating, bad.reviewText)
      expect(reasons).toContainEqual(
        expect.objectContaining({ code: bad.code, severity: bad.severity })
      )
      expect(verificationVerdict(reasons)).toBe(bad.severity)
    }
  )

  it("says what to do in every failure message", () => {
    for (const bad of BAD_REPLIES) {
      for (const reason of rules(bad.reply, bad.rating, bad.reviewText)) {
        expect(reason.message.length).toBeGreaterThan(30)
        expect(reason.message).toMatch(/[.!]$/u)
      }
    }
  })
})

describe("harmless sentences an earlier rule blocked", () => {
  it.each(NOT_BLOCKED.map((entry) => [entry.id, entry] as const))(
    "%s",
    (_id, entry) => {
      expect(
        rules(entry.reply, entry.rating, "Lovely evening.").filter(
          (reason) => reason.severity === "fail"
        )
      ).toEqual([])
    }
  )
})

describe("semantic findings", () => {
  const body =
    "Thanks, Tom. Glad the lamb shank went down well, and we have refunded your starter. Your wife Jane was a pleasure to serve."

  it("keeps findings quoted from the reply, with what to do", () => {
    const reasons = semanticReasons(
      {
        ...cleanVerdict,
        issues: [
          {
            quote: "Glad the lamb shank went down well",
            kind: "invented_detail",
            explanation: "No lamb in the review.",
          },
          {
            quote: "we have refunded your starter",
            kind: "unsupported_commitment",
            explanation: "No refund in evidence.",
          },
          {
            quote: "Your wife Jane",
            kind: "private_information",
            explanation: "Names a third party.",
          },
        ],
      },
      { body, reviewText: "Great food!" }
    )
    expect(reasons.map((reason) => [reason.code, reason.severity])).toEqual([
      ["unsupported_claim", "fail"],
      ["unsupported_commitment", "fail"],
      ["private_information", "fail"],
    ])
    expect(reasons[0].message).toBe(
      "“Glad the lamb shank went down well”: The review does not say this. Remove it or keep to what the guest wrote."
    )
  })

  it("matches a quote despite case, quotes and spacing, and drops duplicates", () => {
    const reasons = semanticReasons(
      {
        ...cleanVerdict,
        issues: [
          {
            quote: "glad the  LAMB shank went down well",
            kind: "invented_detail",
            explanation: "",
          },
          {
            quote: "Glad the lamb shank went down well",
            kind: "invented_detail",
            explanation: "",
          },
        ],
      },
      { body, reviewText: "Great food!" }
    )
    expect(reasons).toHaveLength(1)
  })

  it("maps the other judgements, and calls a reply generic only when there was something to answer", () => {
    const verdict: SemanticVerdict = {
      issues: [],
      addressesGuestDirectly: false,
      relevance: "generic",
      unsafeEscalation: true,
      toneMismatch: true,
    }
    expect(
      semanticReasons(verdict, {
        body: "Thanks.",
        reviewText:
          "The pie was superb and Ellie looked after our table of ten all night.",
      }).map((reason) => [reason.code, reason.severity])
    ).toEqual([
      ["third_person_summary", "fail"],
      ["unsafe_escalation", "fail"],
      ["generic_reply", "warn"],
      ["tone_mismatch", "warn"],
    ])
    expect(
      semanticReasons(
        { ...cleanVerdict, relevance: "generic" },
        { body: "Thanks.", reviewText: "Great food!" }
      )
    ).toEqual([])
    expect(
      semanticReasons(
        { ...cleanVerdict, relevance: "off_topic" },
        { body: "Thanks.", reviewText: "Great food!" }
      )
    ).toEqual([
      expect.objectContaining({ code: "off_topic", severity: "fail" }),
    ])
  })

  it.each([
    "We really appreciate your support.",
    "We hope to welcome you back soon.",
    "We really appreciate your support. We hope to welcome you back soon.",
    "Thank you for the review",
    "Thanks, Sam.",
    "We're sorry your visit was not what it should have been.",
    "Please get in touch with us directly.",
    "I'll pass this on to the kitchen.",
    "See you again soon",
    "You're always welcome back",
  ])("treats %j as a courtesy", (quote) => {
    expect(isCourtesyOnly(quote)).toBe(true)
  })

  it.each([
    "Glad the lamb shank went down well",
    "we have refunded your starter",
    "Thanks for joining us on your birthday",
    "We have retrained the team",
    "Sorry that Dave was rude to you",
    "We hope to see you at our quiz night on Thursday",
    "We hope to see you at our quiz night",
  ])("does not treat %j as a courtesy", (quote) => {
    expect(isCourtesyOnly(quote)).toBe(false)
  })
})
