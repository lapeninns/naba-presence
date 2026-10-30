import { describe, expect, it } from "vitest"

import {
  checkReviewLinkCaption,
  DEFAULT_REVIEW_LINK_CAPTION,
  normaliseReviewLinkCaption,
  REVIEW_LINK_CAPTION_MAX,
  reviewLinkCaptionProblem,
} from "@/lib/domain/review-link-caption"

const ruleIds = (text: string) =>
  checkReviewLinkCaption(text).problems.map((problem) => problem.ruleId)

describe("review link caption constants", () => {
  it("caps captions at 60 characters (two printed lines)", () => {
    expect(REVIEW_LINK_CAPTION_MAX).toBe(60)
  })

  it("has a neutral default caption that passes its own checks", () => {
    expect(DEFAULT_REVIEW_LINK_CAPTION).toBe("Leave us a review on Google")
    expect(checkReviewLinkCaption(DEFAULT_REVIEW_LINK_CAPTION)).toEqual({
      ok: true,
      problems: [],
    })
  })
})

describe("normaliseReviewLinkCaption", () => {
  it.each([
    ["Leave us a review", "Leave us a review"],
    ["  Leave us a review  ", "Leave us a review"],
    ["Leave   us\n a\treview", "Leave us a review"],
    ["\n\tLeave us\r\n\r\na review\t\n", "Leave us a review"],
    ["", null],
    ["   ", null],
    ["\n\t \r\n", null],
    [null, null],
    [undefined, null],
  ])("normalises %j to %j", (text, expected) => {
    expect(normaliseReviewLinkCaption(text)).toBe(expected)
  })
})

describe("checkReviewLinkCaption: acceptable captions", () => {
  it.each([
    "Leave us a review on Google",
    "Scan to review us on Google",
    "Reviews help other guests find us",
    "Tell other guests about your visit",
    "Honest reviews of every kind are welcome",
    "Thanks for visiting The Old Crown",
    "Try our new starters",
    "We operate a separate kitchen for accurate allergen care",
  ])("accepts %j", (text) => {
    expect(checkReviewLinkCaption(text)).toEqual({ ok: true, problems: [] })
    expect(reviewLinkCaptionProblem(text)).toBeNull()
  })

  it("accepts a caption of exactly the maximum length", () => {
    const text = "a".repeat(REVIEW_LINK_CAPTION_MAX)
    expect(checkReviewLinkCaption(text).ok).toBe(true)
  })

  it("measures length after collapsing whitespace", () => {
    const text = `  ${"Leave us a review on Google".split(" ").join(" ".repeat(12))}  `
    expect(text.length).toBeGreaterThan(REVIEW_LINK_CAPTION_MAX)
    expect(checkReviewLinkCaption(text).ok).toBe(true)
  })
})

describe("checkReviewLinkCaption: problems", () => {
  it.each([
    ["CAPTION.length", "a".repeat(REVIEW_LINK_CAPTION_MAX + 1)],
    ["CAPTION.conditional", "If you enjoyed your meal, leave us a review"],
    ["CAPTION.conditional", "Review us if you're happy"],
    ["CAPTION.conditional", "If you had a great time, tell Google"],
    ["CAPTION.conditional", "Happy with your visit? Review us on Google"],
    ["CAPTION.conditional", "IF YOU ENJOYED YOUR MEAL review us"],
    ["CAPTION.rating", "Rate us on Google"],
    ["CAPTION.rating", "Please rate your visit"],
    ["CAPTION.rating", "How was your visit?"],
    ["CAPTION.rating", "How did we do?"],
    ["CAPTION.rating", "Tell us how we did"],
    ["CAPTION.rating", "Score us out of 10"],
    ["CAPTION.rating", "Leave feedback on Google"],
    ["CAPTION.rating", "Take our survey"],
    ["CAPTION.rating", "On a scale of 1 to 10, how likely are you to return"],
    ["CAPTION.rating", "RATE US"],
    ["CAPTION.discourage-negative", "Problem? Contact us first"],
    ["CAPTION.discourage-negative", "Not happy? Talk to us before posting"],
    [
      "CAPTION.discourage-negative",
      "Speak to the manager instead of leaving a bad review",
    ],
    ["CAPTION.incentive", "Review us for a free drink"],
    ["CAPTION.incentive", "Review us and get a free pint"],
    ["CAPTION.incentive", "Review us for 10% off your next visit"],
    ["CAPTION.incentive", "Review us for £5 off"],
    ["CAPTION.incentive", "Show your review for a discount"],
    ["CAPTION.incentive", "Review us and get a voucher"],
    ["CAPTION.incentive", "Review us to win a meal for two"],
    ["CAPTION.incentive", "Every review enters our prize draw"],
    ["CAPTION.incentive", "Earn loyalty points for reviewing us"],
    ["CAPTION.incentive", "Get a FREE DRINK when you review"],
    ["CAPTION.stars", "Leave us 5 stars on Google"],
    ["CAPTION.stars", "Leave us a five-star review"],
    ["CAPTION.stars", "Leave us a positive review"],
    ["CAPTION.stars", "We'd love a glowing review"],
  ])("flags %s in %j", (ruleId, text) => {
    const result = checkReviewLinkCaption(text)
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.ruleId)).toContain(ruleId)
  })

  it("reports a non-empty message and the exact triggering substring", () => {
    const texts = [
      "a".repeat(REVIEW_LINK_CAPTION_MAX + 1),
      "If you enjoyed your meal, rate us 5 stars for a free drink",
      "Not happy?   Talk to us\nbefore posting",
      "How was your visit? Take our survey for a voucher",
    ]
    for (const text of texts) {
      const normalised = normaliseReviewLinkCaption(text) ?? ""
      const { problems } = checkReviewLinkCaption(text)
      expect(problems.length).toBeGreaterThan(0)
      for (const problem of problems) {
        expect(problem.message.trim().length).toBeGreaterThan(0)
        expect(problem.match.length).toBeGreaterThan(0)
        expect(normalised).toContain(problem.match)
      }
    }
  })

  it.each([
    ["Get a FREE DRINK when you review", "CAPTION.incentive", "free drink"],
    ["Leave us 5 stars on Google", "CAPTION.stars", "5 star"],
    ["Please Rate Us today", "CAPTION.rating", "rate"],
  ])(
    "matches %j case-insensitively, keeping the original text",
    (text, ruleId, term) => {
      const problem = checkReviewLinkCaption(text).problems.find(
        (candidate) => candidate.ruleId === ruleId
      )
      expect(problem).toBeDefined()
      expect(problem?.match.toLowerCase()).toContain(term)
      expect(text).toContain(problem?.match)
    }
  )

  it("checks the normalised text, so phrases split by newlines still match", () => {
    expect(ruleIds("Not happy?\nTalk to us\tbefore posting")).toContain(
      "CAPTION.discourage-negative"
    )
    expect(ruleIds("Leave us\n5   stars")).toContain("CAPTION.stars")
  })

  it("reports several rules at once, each at most once", () => {
    const ids = ruleIds(
      "If you enjoyed your meal, rate us 5 stars for a free drink. 5 stars please, free drink!"
    )
    expect(ids).toEqual(
      expect.arrayContaining([
        "CAPTION.conditional",
        "CAPTION.rating",
        "CAPTION.stars",
        "CAPTION.incentive",
      ])
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("reviewLinkCaptionProblem", () => {
  it.each([
    "Leave us 5 stars on Google",
    "If you enjoyed your meal, rate us for a free drink",
    "a".repeat(REVIEW_LINK_CAPTION_MAX + 1),
  ])("returns the first problem's message for %j", (text) => {
    const { problems } = checkReviewLinkCaption(text)
    expect(reviewLinkCaptionProblem(text)).toBe(problems[0].message)
  })

  it("returns null for an acceptable caption", () => {
    expect(reviewLinkCaptionProblem("Scan to review us on Google")).toBeNull()
  })
})

describe("checkReviewLinkCaption: review regressions", () => {
  it.each([
    ["CAPTION.conditional", "Had a great time? Leave us a review"],
    ["CAPTION.conditional", "Had a good night? Tell Google"],
    ["CAPTION.conditional", "Loved it? Review us on Google"],
    ["CAPTION.conditional", "Loved it? Tell Google!"],
    ["CAPTION.conditional", "Enjoyed it? Leave us a review"],
    ["CAPTION.conditional", "Enjoyed yourself?"],
    ["CAPTION.conditional", "Did you enjoy your meal? Leave a review"],
    ["CAPTION.conditional", "Love us? Review us on Google"],
    ["CAPTION.conditional", "Like us? Tell Google"],
    ["CAPTION.conditional", "Happy guest? Leave us a review"],
    ["CAPTION.conditional", "Happy? Leave us a review"],
    ["CAPTION.conditional", "Loved your Sunday roast?"],
    ["CAPTION.conditional", "Had fun?"],
    ["CAPTION.conditional", "Spread the word if you had fun"],
    ["CAPTION.discourage-negative", "Not happy? Talk to us"],
    ["CAPTION.discourage-negative", "Please talk to us before you review"],
    ["CAPTION.incentive", "Your next pint is on us"],
    ["CAPTION.incentive", "Review us for a complimentary dessert"],
    ["CAPTION.incentive", "Review us and we'll buy you a pint"],
    ["CAPTION.incentive", "Half-price pint when you review"],
    ["CAPTION.incentive", "Two for one with every review"],
    ["CAPTION.stars", "Leave us 5 ⭐ on Google"],
    ["CAPTION.stars", "Leave us a 5* review"],
    ["CAPTION.stars", "Give us 5/5 on Google"],
    ["CAPTION.stars", "We’d love a 5★"],
    ["CAPTION.stars", "Leave us a star rating"],
    ["CAPTION.incentive", "f\u200Bree pint for a review"],
    ["CAPTION.stars", "Leave us ５ stars"],
  ])("flags %s in %j", (ruleId, text) => {
    expect(
      checkReviewLinkCaption(text).problems.map((problem) => problem.ruleId)
    ).toContain(ruleId)
  })

  it.each([
    "Before you leave, leave us a review on Google",
    "Review us before you leave",
    "You’re a star! Review us on Google",
    "Our Sunday roast is a star",
    "Star of the Show quiz night",
    "Welcome to the Seven Stars",
    "Prize-winning pies since 1890",
    "Points of interest nearby",
    "Thanks for being part of our story",
    "Leave a review: every one helps",
    "Great food, great people",
    "Corporate rates available",
    "Would you leave us a review?",
  ])("accepts %j", (text) => {
    expect(checkReviewLinkCaption(text)).toEqual({ ok: true, problems: [] })
  })

  it("strips control and zero-width characters when normalising", () => {
    expect(normaliseReviewLinkCaption("Leave\u0001 us\u200B a review")).toBe(
      "Leave us a review"
    )
  })
})
