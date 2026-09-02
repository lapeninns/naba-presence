import { describe, expect, it } from "vitest"

import {
  deterministicVerification,
  verificationVerdict,
} from "@/lib/domain/verification"

const base = {
  reviewText: "The stay was pleasant.",
  locationName: "London Mayfair",
  otherLocationNames: ["Birmingham NEC", "Leeds City"],
  rating: 4,
}

function verify(body: string, overrides = {}) {
  return deterministicVerification({ ...base, ...overrides, body })
}

describe("deterministic reply verification", () => {
  it("passes a grounded, concise response", () => {
    const reasons = verify(
      "Thank you for sharing your feedback about your stay."
    )
    expect(reasons).toEqual([])
    expect(verificationVerdict(reasons)).toBe("pass")
  })

  it.each([
    ["email", "Please email guest@example.com.", "personal_contact_data"],
    ["phone", "Please call +44 20 7946 0958.", "personal_contact_data"],
    [
      "promotion",
      "Use promo code SORRY for a discount.",
      "forbidden_promotion",
    ],
    [
      "unsupported refund",
      "We guarantee a full refund.",
      "unsupported_commitment",
    ],
    ["unsafe language", "That was a shit experience.", "unsafe_language"],
    ["wrong location", "The Birmingham NEC team thanks you.", "wrong_location"],
    [
      "asks to delete review",
      "Please delete your review and we will make it right.",
      "asks_rating_change",
    ],
    [
      "asks for five stars",
      "Please leave us a 5-star review next time.",
      "asks_rating_change",
    ],
  ])("fails %s", (_name, body, code) => {
    const reasons = verify(body)
    expect(reasons).toContainEqual(
      expect.objectContaining({ code, severity: "fail" })
    )
    expect(verificationVerdict(reasons)).toBe("fail")
  })

  // `unique (organisation_id, name)` keeps sibling locations distinct but
  // lets one name contain another, and the generation prompt invites the
  // reply to name its own location. A raw substring test made every correct
  // reply for the longer name fail verification, permanently.
  it("does not flag a sibling whose name is part of this location's own", () => {
    const reasons = verify(
      "We are glad you enjoyed your stay at Lapen Inn Riverside.",
      {
        locationName: "Lapen Inn Riverside",
        otherLocationNames: ["Lapen Inn", "Leeds City"],
      }
    )
    expect(reasons.map((reason) => reason.code)).not.toContain("wrong_location")
    expect(verificationVerdict(reasons)).toBe("pass")
  })

  it("still flags a different location whose name overlaps this one", () => {
    const reasons = verify("The team at Lapen Inn Riverside thanks you.", {
      locationName: "Lapen Inn",
      otherLocationNames: ["Lapen Inn Riverside"],
    })
    expect(reasons).toContainEqual(
      expect.objectContaining({ code: "wrong_location", severity: "fail" })
    )
  })

  it("does not flag a location name buried inside a longer word", () => {
    const reasons = verify("Our leedsville pastry team thanks you.", {
      otherLocationNames: ["Leeds"],
    })
    expect(reasons.map((reason) => reason.code)).not.toContain("wrong_location")
  })

  it("fails replies above Google's UTF-8 byte limit", () => {
    const reasons = verify("🙂".repeat(1025))
    expect(reasons).toContainEqual(
      expect.objectContaining({ code: "reply_too_long", severity: "fail" })
    )
  })

  it("warns when a complaint is not acknowledged", () => {
    const reasons = verify("Thank you for the feedback.", {
      rating: 1,
      reviewText: "The room was cold.",
    })
    expect(reasons).toContainEqual(
      expect.objectContaining({
        code: "complaint_not_acknowledged",
        severity: "warn",
      })
    )
    expect(verificationVerdict(reasons)).toBe("warn")
  })

  it("does not classify a refund as invented when it is review evidence", () => {
    const reasons = verify("We are sorry the promised refund was delayed.", {
      reviewText: "My promised refund has not arrived.",
    })
    expect(reasons.map((reason) => reason.code)).not.toContain(
      "unsupported_commitment"
    )
  })

  it("warns on a likely language mismatch", () => {
    const reasons = verify("Thank you for your feedback.", {
      expectedLanguage: "ja",
    })
    expect(reasons).toContainEqual(
      expect.objectContaining({ code: "language_mismatch", severity: "warn" })
    )
  })

  it("warns when an English reply is supplied for a German review", () => {
    const reasons = verify("Thank you for your kind feedback.", {
      expectedLanguage: "de",
    })
    expect(reasons).toContainEqual(
      expect.objectContaining({ code: "language_mismatch", severity: "warn" })
    )
  })

  it("accepts an ASCII German reply for a German review", () => {
    const reasons = verify(
      "Vielen Dank fuer Ihre freundliche Rueckmeldung.",
      {
        expectedLanguage: "de",
      }
    )
    expect(reasons.map((reason) => reason.code)).not.toContain(
      "language_mismatch"
    )
  })

  const allowedPromotionPhrases = [
    "Our menu is fully gluten-free and nut-free.",
    "Feel free to reach out to our front desk anytime.",
    "The whole property is smoke-free.",
    "Breakfast is free of charge for members.",
  ]

  for (const body of allowedPromotionPhrases) {
    it(`does not flag: ${body}`, () => {
      expect(verify(body)).not.toContainEqual(
        expect.objectContaining({ code: "forbidden_promotion" })
      )
    })
  }

  const forbiddenPromotions = [
    "Next time your dessert is free!",
    "We'd love to offer you a discount on your next stay.",
    "Use promo code SAVE10.",
    "We'll send you a voucher.",
    "Here's a coupon for 20% off.",
  ]

  for (const body of forbiddenPromotions) {
    it(`flags: ${body}`, () => {
      expect(verify(body)).toContainEqual(
        expect.objectContaining({
          code: "forbidden_promotion",
          severity: "fail",
        })
      )
    })
  }
})
