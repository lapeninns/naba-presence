import { describe, expect, it } from "vitest"

import {
  foodMenusFormSchema,
  countFoodMenus,
} from "@/lib/locations/forms/food-menus"
import { hoursFormSchema, emptyHours } from "@/lib/locations/forms/hours"
import { localPostFormSchema } from "@/lib/locations/forms/local-post"
import { profileFormSchema } from "@/lib/locations/forms/profile"

describe("profileFormSchema", () => {
  it("accepts trimmed strings and an empty website", () => {
    const parsed = profileFormSchema.parse({
      name: "  Riverside  ",
      description: "A calm riverside stay",
      phone: "+44 20 7946 0000",
      website: "",
    })
    expect(parsed.name).toBe("Riverside")
    expect(parsed.website).toBe("")
  })
  it("rejects a non-URL website and an over-long name", () => {
    expect(
      profileFormSchema.safeParse({
        name: "x",
        description: "",
        phone: "",
        website: "not-a-url",
      }).success
    ).toBe(false)
    expect(
      profileFormSchema.safeParse({
        name: "x".repeat(256),
        description: "",
        phone: "",
        website: "",
      }).success
    ).toBe(false)
  })
})

describe("hoursFormSchema (re-export of the contract's hoursInputSchema)", () => {
  it("accepts a valid 7-day week with a special day", () => {
    const hours = emptyHours()
    hours.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00" }],
    }
    hours.special = [
      {
        effectiveDate: "2026-12-25",
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
    ]
    expect(hoursFormSchema.safeParse(hours).success).toBe(true)
  })
  it("rejects an open day with no periods and a bad time", () => {
    const open = emptyHours()
    open.regular[0] = { dayOfWeek: 0, isClosed: false, periods: [] }
    expect(hoursFormSchema.safeParse(open).success).toBe(false)
    const badTime = emptyHours()
    badTime.regular[0] = {
      dayOfWeek: 0,
      isClosed: false,
      periods: [{ opensAt: "25:00", closesAt: "17:00" }],
    }
    expect(hoursFormSchema.safeParse(badTime).success).toBe(false)
  })
  it("rejects a week that is not exactly seven days", () => {
    const six = emptyHours()
    six.regular = six.regular.slice(0, 6)
    expect(hoursFormSchema.safeParse(six).success).toBe(false)
  })
})

describe("foodMenusFormSchema + countFoodMenus", () => {
  it("accepts up to 100 menu objects", () => {
    expect(foodMenusFormSchema.safeParse([{ sections: [] }]).success).toBe(true)
    expect(foodMenusFormSchema.safeParse(new Array(101).fill({})).success).toBe(
      false
    )
  })
  it("counts sections, items and options", () => {
    const counts = countFoodMenus([
      { sections: [{ items: [{ options: [{}, {}] }, { options: [] }] }] },
    ])
    expect(counts).toEqual({ menus: 1, sections: 1, items: 2, options: 2 })
  })
})

describe("localPostFormSchema (mirror of posts.ts localPostInputSchema)", () => {
  it("requires event details for EVENT posts", () => {
    expect(
      localPostFormSchema.safeParse({
        topicType: "EVENT",
        summary: "x",
        media: [],
      }).success
    ).toBe(false)
    expect(
      localPostFormSchema.safeParse({
        topicType: "EVENT",
        summary: "x",
        media: [],
        event: { title: "Gig" },
      }).success
    ).toBe(true)
  })
  it("defaults languageCode and accepts STANDARD with just a summary", () => {
    const parsed = localPostFormSchema.parse({
      topicType: "STANDARD",
      summary: "Open late tonight",
      media: [],
    })
    expect(parsed.languageCode).toBe("en-GB")
  })
})
