import { describe, expect, it } from "vitest"

import {
  containsLink,
  descriptionProblems,
  similarity,
  words,
} from "@/lib/listings/completeness-text"

// 321 characters of natural prose; no 4+ letter word used more than twice.
const GOOD =
  "The Bell at Langham is a family-run village pub on the edge of the Norfolk coast, serving seasonal British cooking, local ales and a proper Sunday roast. Dogs are welcome in the bar, the walled garden catches the afternoon sun, and open fires make winter evenings cosy. Book ahead for weekend lunches and summer evenings."

describe("words", () => {
  it("lowercases, strips accents and splits on anything but letters and digits", () => {
    expect(words("Café, CRÈME brûlée!")).toEqual(["cafe", "creme", "brulee"])
    expect(words("Open 7 days — 12pm-11pm")).toEqual([
      "open",
      "7",
      "days",
      "12pm",
      "11pm",
    ])
  })

  it("is empty for empty or punctuation-only text", () => {
    expect(words("")).toEqual([])
    expect(words(" ... !! ")).toEqual([])
  })
})

describe("containsLink", () => {
  it.each([
    "Visit https://thebell.co.uk for more",
    "http://example.com",
    "See www.thebell.co.uk",
    "Book at thebell.com today",
    "Find us at example.co.uk",
  ])("finds a link in %j", (text) => {
    expect(containsLink(text)).toBe(true)
  })

  it.each([
    GOOD,
    "Mains from £12.50, open daily.",
    "Dogs welcome. Children welcome.",
    "",
  ])("finds no link in %j", (text) => {
    expect(containsLink(text)).toBe(false)
  })
})

describe("descriptionProblems", () => {
  it("is empty for a good description", () => {
    expect(descriptionProblems(GOOD)).toEqual([])
  })

  it("flags a short description once", () => {
    expect(descriptionProblems("Lovely village pub.")).toHaveLength(1)
  })

  it("respects a custom minimum length", () => {
    expect(
      descriptionProblems("Lovely village pub.", { minChars: 10 })
    ).toEqual([])
    expect(descriptionProblems(GOOD, { minChars: 400 })).toHaveLength(1)
  })

  it("flags a description written mostly in capitals", () => {
    expect(descriptionProblems(GOOD.toUpperCase())).toHaveLength(1)
  })

  it("does not flag capitals in very short text (fewer than 20 letters)", () => {
    expect(descriptionProblems("THE BELL INN", { minChars: 0 })).toEqual([])
  })

  it("respects a custom uppercase share", () => {
    expect(
      descriptionProblems(GOOD.toUpperCase(), { maxUppercaseShare: 1 })
    ).toEqual([])
  })

  it("flags a 4+ letter word used more than four times, case-insensitively", () => {
    const four = `${GOOD} Beer here, BEER there, beer everywhere, more beer.`
    const five = `${four} Beer.`
    expect(descriptionProblems(four)).toEqual([])
    expect(descriptionProblems(five)).toHaveLength(1)
  })

  it("respects a custom repeat limit", () => {
    const four = `${GOOD} Beer here, beer there, beer everywhere, more beer.`
    expect(descriptionProblems(four, { maxWordRepeats: 3 })).toHaveLength(1)
  })

  it("ignores short words and stop words when counting repeats", () => {
    const ales = `${GOOD} Ale, ale, ale, ale, ale and ale.`
    expect(descriptionProblems(ales)).toEqual([])
    const withs = `${GOOD} Come with friends, with family, with dogs, with children, with walkers and with cyclists.`
    expect(descriptionProblems(withs)).toEqual([])
  })

  it("flags a link", () => {
    expect(
      descriptionProblems(`${GOOD} More at www.thebell.co.uk`)
    ).toHaveLength(1)
  })

  it("reports each problem separately", () => {
    expect(descriptionProblems("Lovely pub, see thebell.com")).toHaveLength(2)
  })
})

describe("similarity", () => {
  it("is 1 for identical text", () => {
    expect(similarity(GOOD, GOOD)).toBe(1)
  })

  it("is 1 for text identical after normalising case, accents and punctuation", () => {
    expect(
      similarity("The Bell, Langham — Café!", "the bell langham cafe")
    ).toBe(1)
  })

  it("is 0 when either side is empty", () => {
    expect(similarity("", GOOD)).toBe(0)
    expect(similarity(GOOD, "")).toBe(0)
    expect(similarity("", "")).toBe(0)
    expect(similarity("!!!", GOOD)).toBe(0)
  })

  it("is the Dice coefficient over character bigrams", () => {
    // night: ni ig gh ht; nacht: na ac ch ht → 2·1 / 8
    expect(similarity("night", "nacht")).toBeCloseTo(0.25, 5)
  })

  it("is symmetric", () => {
    const other = GOOD.replace("Langham", "Blakeney")
    expect(similarity(GOOD, other)).toBeCloseTo(similarity(other, GOOD), 10)
  })

  it("is high for a near-duplicate and low for unrelated text", () => {
    const near = GOOD.replace("Langham", "Blakeney")
    expect(similarity(GOOD, near)).toBeGreaterThanOrEqual(0.9)
    expect(similarity(GOOD, near)).toBeLessThan(1)
    const unrelated =
      "A lively market-town inn with twelve bedrooms, a sports bar showing live football, quiz nights every Tuesday and a function room for parties of up to eighty guests."
    expect(similarity(GOOD, unrelated)).toBeLessThan(0.9)
  })
})
