import { describe, expect, it } from "vitest"

import {
  bannedPhraseChecks,
  contentChecks,
  replyRepetitionChecks,
} from "@/lib/domain/content-checks"

const reason = (code: string, severity: "warn" | "fail" = "fail") =>
  expect.objectContaining({ code, severity })

function check(body: string, kind: "post" | "description" = "post") {
  return contentChecks({ kind, body })
}

describe("post and description content checks", () => {
  it("fails an empty post", () => {
    expect(check(" \n\t ", "post")).toContainEqual(reason("content_empty"))
  })

  it("allows clearing an existing description", () => {
    expect(check("", "description")).toEqual([])
    expect(check(" \n\t ", "description")).toEqual([])
  })

  it.each([
    ["post", 1500],
    ["description", 750],
  ] as const)("uses Google's %s character limit", (kind, limit) => {
    expect(check("a".repeat(limit), kind)).not.toContainEqual(
      reason("content_too_long")
    )
    expect(check("a".repeat(limit + 1), kind)).toContainEqual(
      reason("content_too_long")
    )
    expect(check("🙂".repeat(limit), kind)).not.toContainEqual(
      reason("content_too_long")
    )
    expect(check("🙂".repeat(limit + 1), kind)).toContainEqual(
      reason("content_too_long")
    )
  })

  it.each([
    "+44 20 7946 0958",
    "555-1234",
    "020 7946 0958",
    "07700 900123",
    "(01223) 123456",
  ])("fails a phone number in content: %s", (number) => {
    expect(check("Call " + number + " to book.")).toContainEqual(
      reason("content_phone")
    )
  })

  it.each([
    "https://example.com/book",
    "http://example.com",
    "www.example.com",
    "example.com/book",
    "example.app",
    "example.co",
    "example.dev",
  ])("fails a body URL: %s", (url) => {
    expect(check("Book at " + url + " today.")).toContainEqual(
      reason("content_url")
    )
  })

  it.each([
    "The 3 Horseshoes welcomes you.",
    "Open 24/7 for our guests.",
    "Sunday lunch is £12.50.",
    "Serving since 1897.",
    "We open from 12:00 to 23:00.",
    "Join us on 2026-12-25.",
    "Join us on 2026-10-30 12:00.",
  ])(
    "does not mistake ordinary hospitality text for contact data: %s",
    (body) => {
      const codes = check(body).map((entry) => entry.code)
      expect(codes).not.toContain("content_phone")
      expect(codes).not.toContain("content_url")
    }
  )

  it.each([
    ["WELCOME EVERYONE", true],
    ["WELCOME", false],
    ["Welcome EVERYONE", false],
    ["ÉTÉ À LA TERRASSE", true],
  ])("checks all-caps text with a ten-letter floor: %s", (body, warns) => {
    const reasons = check(body)
    if (warns) expect(reasons).toContainEqual(reason("content_caps", "warn"))
    else expect(reasons).not.toContainEqual(reason("content_caps", "warn"))
  })

  it.each([
    ["Join us!!!", true],
    ["Ready?!?", true],
    ["Join us!!", false],
    ["A calm evening. A warm welcome.", false],
    ["A varied menu... and a warm welcome.", false],
  ])("checks excessive punctuation: %s", (body, warns) => {
    if (warns)
      expect(check(body)).toContainEqual(reason("content_punctuation", "warn"))
    else
      expect(check(body)).not.toContainEqual(
        reason("content_punctuation", "warn")
      )
  })

  it.each([
    ["2026-10-29", true],
    ["2026-10-30", false],
    ["2026-10-31", false],
    [null, false],
  ])(
    "compares an offer end date to the supplied current date: %s",
    (offerEndDate, expired) => {
      const reasons = contentChecks({
        kind: "post",
        body: "Sunday lunch for two.",
        offerEndDate,
        today: "2026-10-30",
      })
      if (expired) expect(reasons).toContainEqual(reason("offer_expired"))
      else expect(reasons).not.toContainEqual(reason("offer_expired"))
    }
  )

  it("applies the organisation's banned phrases to both content kinds", () => {
    for (const kind of ["post", "description"] as const) {
      expect(
        contentChecks({
          kind,
          body: "We are the best in town.",
          bannedPhrases: ["best in town"],
        })
      ).toContainEqual(reason("banned_phrase"))
    }
  })
})

describe("organisation banned phrases", () => {
  it.each([
    ["The BEST IN TOWN.", "best in town"],
    ["The best-in-town welcome.", "best in town"],
    ["The best\n in\t town.", "best in town"],
    ["The ＢＥＳＴ in town.", "best in town"],
  ])(
    "matches phrases after case, spacing and punctuation normalization: %s",
    (body, phrase) => {
      expect(bannedPhraseChecks(body, [phrase])).toContainEqual(
        reason("banned_phrase")
      )
    }
  )

  it.each([
    ["A classical pub.", ["ass"]],
    ["A carefree welcome.", ["free"]],
    ["The best pub in town.", ["best in town"]],
    ["A calm welcome.", ["", "   "]],
    ["A calm welcome.", []],
    ["Everything is excellent.", [".*"]],
  ])("avoids fragments and regex interpretation: %s", (body, phrases) => {
    expect(bannedPhraseChecks(body, phrases)).toEqual([])
  })
})

describe("published reply repetition", () => {
  const body =
    "Thank you for your lovely feedback. We are pleased you enjoyed dinner and hope to welcome you back soon."
  const repeats = (
    recentPublishedReplies: string[],
    ratingOnlyTemplate = false
  ) =>
    replyRepetitionChecks({ body, recentPublishedReplies, ratingOnlyTemplate })

  it("has no findings without published replies", () => {
    expect(repeats([])).toEqual([])
  })

  it("fails exact and normalized duplicates", () => {
    expect(repeats([body])).toContainEqual(reason("reply_duplicate"))
    expect(repeats([body.toUpperCase().replaceAll(" ", "  ")])).toContainEqual(
      reason("reply_duplicate")
    )
  })

  it("fails a near duplicate with a small wording change", () => {
    expect(repeats([body.replace("lovely", "kind")])).toContainEqual(
      reason("reply_duplicate")
    )
  })

  it("warns on the same opening sentence with a distinct remainder", () => {
    const reasons = repeats([
      "Thank you for your lovely feedback. Our chefs source seasonal produce from local farms and will be delighted to hear that their efforts made your anniversary celebration memorable.",
    ])
    expect(reasons).toContainEqual(reason("reply_repeated_opening", "warn"))
    expect(reasons).not.toContainEqual(reason("reply_duplicate"))
  })

  it("does not repeat the opening warning when the whole reply fails", () => {
    expect(repeats([body]).map((entry) => entry.code)).not.toContain(
      "reply_repeated_opening"
    )
  })

  it("does not warn merely because replies share a few words", () => {
    expect(
      repeats([
        "We appreciate you visiting. Your comments about the garden have been shared with the manager.",
      ])
    ).toEqual([])
  })

  it("compares only the thirty most recent replies (newest first)", () => {
    const recent = Array.from(
      { length: 30 },
      (_, index) => "A distinct published response number " + index + "."
    )
    expect(repeats([...recent, body])).toEqual([])
    expect(repeats([body, ...recent])).toContainEqual(reason("reply_duplicate"))
  })

  it("exempts explicitly identified rating-only template replies", () => {
    expect(repeats([body], true)).toEqual([])
    expect(repeats([body], false)).toContainEqual(reason("reply_duplicate"))
  })
})
