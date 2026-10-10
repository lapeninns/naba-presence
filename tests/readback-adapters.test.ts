import { describe, expect, it } from "vitest"

import {
  containsExpected,
  normalizeText,
  normalizeUri,
} from "@/lib/domain/readback/compare"
import {
  localPostMatches,
  localPostMismatches,
} from "@/lib/domain/readback/posts"

describe("shared comparison", () => {
  it("normalises text and links the way Google echoes them", () => {
    expect(normalizeText("  Village pub \r\nwith rooms  ")).toBe(
      "Village pub\nwith rooms"
    )
    expect(normalizeUri("HTTPS://Old-Crown.Example:443/")).toBe(
      "https://old-crown.example"
    )
    expect(normalizeUri("https://x.example/menu/")).toBe(
      "https://x.example/menu"
    )
  })

  it("ignores fields Google adds but never treats false as unset", () => {
    expect(
      containsExpected(
        { petsAllowed: true, petsAllowedException: "UNSPECIFIED" },
        { petsAllowed: true }
      )
    ).toBe(true)
    expect(containsExpected({}, { petsAllowed: false })).toBe(false)
    expect(
      containsExpected({ petsAllowed: false }, { petsAllowed: false })
    ).toBe(true)
    expect(containsExpected(undefined, {})).toBe(true)
  })

  it("compares a TimeOfDay with Google's omitted zero parts", () => {
    expect(
      containsExpected(
        { hours: 15 },
        { hours: 15, minutes: 0, seconds: 0, nanos: 0 }
      )
    ).toBe(true)
    expect(containsExpected({ hours: 16 }, { hours: 15, minutes: 0 })).toBe(
      false
    )
  })
})

describe("local post readback", () => {
  const intended = {
    topicType: "EVENT",
    languageCode: "en-GB",
    summary: "Quiz night\r\n",
    callToAction: { actionType: "LEARN_MORE", url: "https://x.example/quiz/" },
    event: {
      title: "Quiz",
      schedule: {
        startDate: { year: 2026, month: 11, day: 5 },
        endDate: { year: 2026, month: 11, day: 5 },
        startTime: { hours: 19, minutes: 0 },
        endTime: { hours: 22, minutes: 30 },
      },
    },
  }

  it("is equal after normalisation, ignoring output-only fields", () => {
    const live = {
      name: "accounts/1/locations/2/localPosts/3",
      state: "LIVE",
      searchUrl: "https://posts.example/3",
      topicType: "EVENT",
      languageCode: "en-gb",
      summary: "Quiz night",
      callToAction: { actionType: "LEARN_MORE", url: "https://x.example/quiz" },
      event: {
        title: "Quiz ",
        schedule: {
          startDate: { year: 2026, month: 11, day: 5 },
          endDate: { year: 2026, month: 11, day: 5 },
          startTime: { hours: 19 },
          endTime: { hours: 22, minutes: 30 },
        },
      },
    }
    expect(localPostMismatches(live, intended)).toEqual([])
  })

  it("reports an event schedule mismatch", () => {
    const live = {
      ...intended,
      event: {
        ...intended.event,
        schedule: { ...intended.event.schedule, startTime: { hours: 20 } },
      },
    }
    expect(localPostMismatches(live, intended)).toEqual(["event"])
  })

  it("reports offer field mismatches and an offer Google kept", () => {
    const offer = {
      topicType: "OFFER",
      languageCode: "en-GB",
      summary: "Two for one",
      offer: {
        couponCode: "TWO4ONE",
        redeemOnlineUrl: "https://x.example/redeem",
        termsConditions: "Weekdays only",
      },
    }
    expect(
      localPostMismatches(
        { ...offer, offer: { ...offer.offer, couponCode: "OTHER" } },
        offer
      )
    ).toEqual(["offer"])
    expect(
      localPostMatches(
        { ...offer },
        { topicType: "OFFER", languageCode: "en-GB", summary: "Two for one" }
      )
    ).toBe(false)
  })

  it("reports summary, topic and call-to-action differences", () => {
    expect(
      localPostMismatches(
        {
          ...intended,
          topicType: "STANDARD",
          summary: "Quiz night tonight",
          callToAction: { actionType: "CALL" },
        },
        intended
      )
    ).toEqual(["topicType", "summary", "callToAction"])
  })
})

describe("local post identification in Google's list", () => {
  const intended = {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Late opening",
    callToAction: { actionType: "LEARN_MORE", url: "https://x.example/menu" },
  }

  it("adopts a listing that omits the call to action", () => {
    const listed = {
      name: "p",
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Late opening",
    }
    expect(localPostMatches(listed, intended, "identify")).toBe(true)
    // An update readback is strict about the same omission.
    expect(localPostMatches(listed, intended)).toBe(false)
  })

  it("never adopts a listing that contradicts the intent", () => {
    expect(
      localPostMatches(
        { ...intended, callToAction: { actionType: "CALL" } },
        intended,
        "identify"
      )
    ).toBe(false)
    expect(
      localPostMatches(
        { ...intended, summary: "Early closing" },
        intended,
        "identify"
      )
    ).toBe(false)
  })
})
