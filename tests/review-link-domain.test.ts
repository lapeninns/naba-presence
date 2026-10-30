import { describe, expect, it } from "vitest"

import {
  fillReviewLinkSeries,
  generateReviewLinkCode,
  isAcceptableReviewTarget,
  isLikelyBot,
  isReviewLinkCode,
  localDateKey,
  parseReviewLinkPeriod,
  parseReviewLinkSource,
  REVIEW_LINK_CODE_ALPHABET,
  REVIEW_LINK_CODE_LENGTH,
  REVIEW_LINK_CODE_PATTERN,
  REVIEW_LINK_PATH,
  REVIEW_LINK_PERIODS,
  REVIEW_LINK_SOURCES,
  reviewLinkPath,
  reviewLinkTotals,
  reviewLinkUrl,
  reviewLinkWindow,
  reviewUriFromObservedPayload,
} from "@/lib/domain/review-link"

/** A byte source that streams `sequence` in order, then 0, 1, 2, ... */
function streamingBytes(sequence: number[]) {
  let position = 0
  const requests: number[] = []
  const next = () => {
    const value =
      position < sequence.length
        ? sequence[position]
        : (position - sequence.length) % 248
    position += 1
    return value
  }
  const source = (length: number) => {
    requests.push(length)
    return Uint8Array.from({ length }, next)
  }
  return { source, requests }
}

function consecutiveDates(start: string, count: number) {
  const first = Date.parse(`${start}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10)
  )
}

describe("review link code constants", () => {
  it("uses a 31-character alphabet without look-alike characters", () => {
    expect(REVIEW_LINK_CODE_ALPHABET).toBe("23456789abcdefghjkmnpqrstuvwxyz")
    expect(REVIEW_LINK_CODE_ALPHABET).toHaveLength(31)
    expect(new Set(REVIEW_LINK_CODE_ALPHABET).size).toBe(31)
    for (const lookAlike of ["0", "1", "i", "l", "o"]) {
      expect(REVIEW_LINK_CODE_ALPHABET).not.toContain(lookAlike)
    }
  })

  it("uses ten-character codes", () => {
    expect(REVIEW_LINK_CODE_LENGTH).toBe(10)
  })

  it.each([
    ["abcdefghjk", true],
    ["23456789za", true],
    ["abcdefghj", false],
    ["abcdefghjkm", false],
    ["ABCDEFGHJK", false],
    ["abcdefghj0", false],
    ["abcdefghjl", false],
    [" abcdefghjk", false],
    ["abcdefghjk\n", false],
  ])("pattern matches %j: %s", (value, expected) => {
    expect(REVIEW_LINK_CODE_PATTERN.test(value)).toBe(expected)
  })
})

describe("generateReviewLinkCode", () => {
  it("produces valid, practically unique codes with the default source", () => {
    const codes = Array.from({ length: 1000 }, () => generateReviewLinkCode())
    for (const code of codes) {
      expect(code).toHaveLength(REVIEW_LINK_CODE_LENGTH)
      expect(code).toMatch(REVIEW_LINK_CODE_PATTERN)
      expect(isReviewLinkCode(code)).toBe(true)
    }
    expect(new Set(codes).size).toBeGreaterThanOrEqual(999)
  })

  it("maps accepted bytes onto the alphabet in order", () => {
    const { source } = streamingBytes([])
    expect(generateReviewLinkCode(source)).toBe("23456789ab")
  })

  it("maps bytes modulo the alphabet size", () => {
    const { source } = streamingBytes([31, 62, 247, 30, 32, 0, 1, 2, 3, 4])
    expect(generateReviewLinkCode(source)).toBe("22zz323456")
  })

  it("discards bytes at or above 248 and asks for more", () => {
    const { source } = streamingBytes([255, 248])
    expect(generateReviewLinkCode(source)).toBe("23456789ab")
  })

  it("keeps requesting bytes until ten characters are accepted", () => {
    const { source, requests } = streamingBytes(Array(40).fill(250))
    const code = generateReviewLinkCode(source)
    expect(code).toBe("23456789ab")
    expect(requests.reduce((sum, length) => sum + length, 0)).toBeGreaterThan(
      40
    )
  })
})

describe("isReviewLinkCode", () => {
  it.each([
    ["abcdefghjk", true],
    ["zzzzzzzzzz", true],
    ["ABCDEFGHJK", false],
    ["abcdefghj", false],
    ["abcdefghjkm", false],
    ["0", false],
    ["l", false],
    ["abcdefghj0", false],
    ["abcdefghjo", false],
    ["abc/../x", false],
    ["", false],
    [null, false],
    [undefined, false],
    [1234567890, false],
    [{ code: "abcdefghjk" }, false],
    [["abcdefghjk"], false],
  ])("%j -> %s", (value, expected) => {
    expect(isReviewLinkCode(value)).toBe(expected)
  })
})

describe("review link sources", () => {
  it("lists link and qr", () => {
    expect(REVIEW_LINK_SOURCES).toEqual(["link", "qr"])
  })

  it.each([
    ["qr", "qr"],
    ["QR", "link"],
    ["Qr", "link"],
    [" qr", "link"],
    ["link", "link"],
    ["email", "link"],
    ["", "link"],
    [null, "link"],
    [undefined, "link"],
  ])("parses %j as %s", (value, expected) => {
    expect(parseReviewLinkSource(value)).toBe(expected)
  })
})

describe("review link paths and URLs", () => {
  it("uses the /r/ prefix", () => {
    expect(REVIEW_LINK_PATH).toBe("/r/")
  })

  it.each([
    [undefined, "/r/abcdefghjk"],
    ["link", "/r/abcdefghjk"],
    ["qr", "/r/abcdefghjk?s=qr"],
  ] as const)("builds the path for source %s", (source, expected) => {
    expect(reviewLinkPath("abcdefghjk", source)).toBe(expected)
  })

  it.each([
    [
      "https://app.example.test",
      undefined,
      "https://app.example.test/r/abcdefghjk",
    ],
    [
      "https://app.example.test/",
      "link",
      "https://app.example.test/r/abcdefghjk",
    ],
    [
      "https://app.example.test/some/page",
      undefined,
      "https://app.example.test/r/abcdefghjk",
    ],
    [
      "https://app.example.test/some/page?x=1#frag",
      "qr",
      "https://app.example.test/r/abcdefghjk?s=qr",
    ],
    [
      "http://localhost:3000/dashboard",
      "qr",
      "http://localhost:3000/r/abcdefghjk?s=qr",
    ],
  ] as const)(
    "builds an absolute URL on the origin of %s (%s)",
    (baseUrl, source, expected) => {
      expect(reviewLinkUrl("abcdefghjk", baseUrl, source)).toBe(expected)
    }
  )
})

describe("isLikelyBot", () => {
  it.each([null, undefined, ""])(
    "treats a missing user agent (%j) as a bot",
    (ua) => {
      expect(isLikelyBot(ua)).toBe(true)
    }
  )

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
    "SomeCrawler/1.0",
    "Baiduspider/2.0",
    "Mozilla/5.0 (compatible; Yahoo! Slurp)",
    "Mozilla/5.0 LinkPreview/1.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Embedly/0.2)",
    "WhatsApp/2.23.20.0 A",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (Windows NT 10.0) Skype/8.0",
    "curl/8.4.0",
    "Wget/1.21.4",
    "python-requests/2.31.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
    "Twitterbot/1.0",
    "MOZILLA/5.0 (COMPATIBLE; GOOGLEBOT/2.1)",
  ])("detects %s", (ua) => {
    expect(isLikelyBot(ua)).toBe(true)
  })

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:127.0) Gecko/20100101 Firefox/127.0",
  ])("lets a real browser through: %s", (ua) => {
    expect(isLikelyBot(ua)).toBe(false)
  })
})

describe("isAcceptableReviewTarget", () => {
  const prefix = "https://g.page/r/"

  it.each([
    ["https://g.page/r/abc/review", true],
    ["https://search.google.com/local/writereview?placeid=abc", true],
    [`${prefix}${"a".repeat(2048 - prefix.length)}`, true],
    [`${prefix}${"a".repeat(2049 - prefix.length)}`, false],
    ["http://g.page/r/abc/review", false],
    ["javascript:alert(1)", false],
    ["/r/abc/review", false],
    ["g.page/r/abc/review", false],
    ["https://user:pw@g.page/x", false],
    ["https://user@g.page/x", false],
    ["https://", false],
    ["", false],
    [null, false],
    [undefined, false],
    [42, false],
    [{ href: "https://g.page/r/abc/review" }, false],
  ])("%j -> %s", (uri, expected) => {
    expect(isAcceptableReviewTarget(uri)).toBe(expected)
  })
})

describe("reviewUriFromObservedPayload", () => {
  it("returns Google's own review URI, trimmed", () => {
    expect(
      reviewUriFromObservedPayload({
        observedAt: "2026-10-30T09:00:00Z",
        location: {
          metadata: { newReviewUri: " https://g.page/r/abc/review " },
        },
      })
    ).toBe("https://g.page/r/abc/review")
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "https://g.page/r/abc/review"],
    ["a number", 7],
    ["no location", { observedAt: "2026-10-30T09:00:00Z" }],
    ["a null location", { location: null }],
    ["no metadata", { location: {} }],
    ["a null metadata", { location: { metadata: null } }],
    ["no newReviewUri", { location: { metadata: {} } }],
    ["an empty URI", { location: { metadata: { newReviewUri: "" } } }],
    ["a blank URI", { location: { metadata: { newReviewUri: "   " } } }],
    [
      "an http URI",
      {
        location: { metadata: { newReviewUri: "http://g.page/r/abc/review" } },
      },
    ],
    [
      "a javascript URI",
      { location: { metadata: { newReviewUri: "javascript:alert(1)" } } },
    ],
    [
      "a URI with credentials",
      { location: { metadata: { newReviewUri: "https://user:pw@g.page/x" } } },
    ],
    ["a non-string URI", { location: { metadata: { newReviewUri: 12 } } }],
  ])("returns null for %s", (_label, payload) => {
    expect(reviewUriFromObservedPayload(payload)).toBeNull()
  })
})

describe("review link periods", () => {
  it("offers 30 and 90 days", () => {
    expect(REVIEW_LINK_PERIODS).toEqual([30, 90])
  })

  it.each([
    [90, 90],
    ["90", 90],
    [30, 30],
    ["30", 30],
    [7, 30],
    ["365", 30],
    ["ninety", 30],
    [" 90x", 30],
    [null, 30],
    [undefined, 30],
    [{}, 30],
  ])("parses %j as %i", (value, expected) => {
    expect(parseReviewLinkPeriod(value)).toBe(expected)
  })
})

describe("localDateKey", () => {
  it.each([
    ["2026-10-30T23:30:00Z", "Europe/London", "2026-10-30"],
    ["2026-07-01T23:30:00Z", "Europe/London", "2026-07-02"],
    ["2026-07-01T23:30:00Z", "UTC", "2026-07-01"],
    ["2026-07-01T22:59:59Z", "Europe/London", "2026-07-01"],
    ["2026-12-31T23:30:00Z", "UTC", "2026-12-31"],
    ["2026-12-31T23:30:00Z", "Europe/Paris", "2027-01-01"],
    ["2026-01-01T03:00:00Z", "America/New_York", "2025-12-31"],
  ])("%s in %s is %s", (instant, timeZone, expected) => {
    expect(localDateKey(new Date(instant), timeZone)).toBe(expected)
  })
})

describe("reviewLinkWindow", () => {
  it.each([
    ["2026-10-30T12:00:00Z", "Europe/London", 30, "2026-10-01", "2026-10-30"],
    ["2026-04-10T12:00:00Z", "Europe/London", 30, "2026-03-12", "2026-04-10"],
    ["2027-01-05T12:00:00Z", "Europe/London", 30, "2026-12-07", "2027-01-05"],
    ["2026-10-30T12:00:00Z", "Europe/London", 90, "2026-08-02", "2026-10-30"],
    ["2026-03-01T12:00:00Z", "UTC", 30, "2026-01-31", "2026-03-01"],
    ["2026-07-01T23:30:00Z", "Europe/London", 7, "2026-06-26", "2026-07-02"],
    ["2026-07-01T23:30:00Z", "UTC", 1, "2026-07-01", "2026-07-01"],
  ])(
    "now=%s tz=%s days=%i spans %s..%s",
    (now, timeZone, days, startDate, endDate) => {
      const window = reviewLinkWindow(new Date(now), timeZone, days)
      expect(window.startDate).toBe(startDate)
      expect(window.endDate).toBe(endDate)
      expect(window.dates).toEqual(consecutiveDates(startDate, days))
    }
  )

  it("has no duplicate or skipped dates across the October clock change", () => {
    const { dates } = reviewLinkWindow(
      new Date("2026-10-30T12:00:00Z"),
      "Europe/London",
      30
    )
    expect(dates).toHaveLength(30)
    expect(new Set(dates).size).toBe(30)
    expect(dates).toContain("2026-10-24")
    expect(dates).toContain("2026-10-25")
    expect(dates).toContain("2026-10-26")
    expect(dates.at(-1)).toBe("2026-10-30")
  })

  it("lists dates in ascending order ending today", () => {
    const now = new Date("2026-10-30T23:30:00Z")
    const { dates, endDate } = reviewLinkWindow(now, "Europe/London", 90)
    expect(endDate).toBe(localDateKey(now, "Europe/London"))
    expect(dates.at(-1)).toBe(endDate)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe("fillReviewLinkSeries", () => {
  const dates = ["2026-10-28", "2026-10-29", "2026-10-30"]

  it("returns zeroes for every date when there are no rows", () => {
    expect(fillReviewLinkSeries(dates, [])).toEqual([
      { date: "2026-10-28", clicks: 0, qrClicks: 0, newReviews: 0 },
      { date: "2026-10-29", clicks: 0, qrClicks: 0, newReviews: 0 },
      { date: "2026-10-30", clicks: 0, qrClicks: 0, newReviews: 0 },
    ])
  })

  it("places rows on their dates, ignores unknown dates and sums duplicates", () => {
    const series = fillReviewLinkSeries(dates, [
      { date: "2026-10-30", clicks: 4, qrClicks: 1 },
      { date: "2026-10-28", newReviews: 2 },
      { date: "2026-10-30", newReviews: 3 },
      { date: "2026-10-30", clicks: 1 },
      { date: "2026-10-27", clicks: 99, qrClicks: 99, newReviews: 99 },
      { date: "2026-10-31", clicks: 99 },
    ])
    expect(series).toEqual([
      { date: "2026-10-28", clicks: 0, qrClicks: 0, newReviews: 2 },
      { date: "2026-10-29", clicks: 0, qrClicks: 0, newReviews: 0 },
      { date: "2026-10-30", clicks: 5, qrClicks: 1, newReviews: 3 },
    ])
  })

  it("follows the order of the dates, not of the rows", () => {
    const series = fillReviewLinkSeries(dates, [
      { date: "2026-10-30", clicks: 3 },
      { date: "2026-10-29", clicks: 2 },
      { date: "2026-10-28", clicks: 1 },
    ])
    expect(series.map((day) => [day.date, day.clicks])).toEqual([
      ["2026-10-28", 1],
      ["2026-10-29", 2],
      ["2026-10-30", 3],
    ])
  })

  it("returns an empty series for no dates", () => {
    expect(
      fillReviewLinkSeries([], [{ date: "2026-10-30", clicks: 1 }])
    ).toEqual([])
  })
})

describe("reviewLinkTotals", () => {
  it("sums each measure", () => {
    expect(
      reviewLinkTotals([
        { date: "2026-10-28", clicks: 3, qrClicks: 1, newReviews: 0 },
        { date: "2026-10-29", clicks: 0, qrClicks: 0, newReviews: 2 },
        { date: "2026-10-30", clicks: 5, qrClicks: 4, newReviews: 1 },
      ])
    ).toEqual({ clicks: 8, qrClicks: 5, newReviews: 3 })
  })

  it("is zero for an empty series", () => {
    expect(reviewLinkTotals([])).toEqual({
      clicks: 0,
      qrClicks: 0,
      newReviews: 0,
    })
  })
})

describe("review link targets: review regressions", () => {
  it.each([
    ["https://search.google.com/local/writereview?placeid=abc", true],
    ["https://g.page/r/CabcXYZ/review", true],
    ["https://www.google.com/maps/place/x", true],
    ["https://evil.example/review", false],
    ["https://google.com.evil.example/x", false],
    ["https://notgoogle.com/x", false],
  ])("accepts only Google's review hosts: %s", (uri, expected) => {
    expect(isAcceptableReviewTarget(uri)).toBe(expected)
  })

  it("returns the re-serialised URL, so control characters never reach a header", () => {
    const target = reviewUriFromObservedPayload({
      location: {
        metadata: {
          newReviewUri: "https://search.google.com/x\r\nSet-Cookie: a=b",
        },
      },
    })
    expect(target).not.toBeNull()
    expect(target).not.toMatch(/[\r\n]/)
  })

  it("counts a Cubot phone as a guest, not a bot", () => {
    expect(
      isLikelyBot(
        "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
      )
    ).toBe(false)
  })
})
