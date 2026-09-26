import { describe, expect, it } from "vitest"

import { localPostInputSchema } from "@/lib/contracts/location-posts"

describe("Local Posts validation", () => {
  it("accepts standard, event, and offer payloads", () => {
    expect(localPostInputSchema.parse({
      topicType: "STANDARD",
      summary: "A summer update",
      media: [],
    }).topicType).toBe("STANDARD")
    expect(localPostInputSchema.parse({
      topicType: "EVENT",
      summary: "Live music",
      event: { title: "Friday music", schedule: {} },
      media: [],
    }).topicType).toBe("EVENT")
    expect(localPostInputSchema.parse({
      topicType: "OFFER",
      summary: "Lunch offer",
      event: { title: "Lunch", schedule: {} },
      offer: { couponCode: "LUNCH" },
      media: [],
    }).topicType).toBe("OFFER")
  })

  it("rejects incomplete offers and product post types", () => {
    expect(() => localPostInputSchema.parse({
      topicType: "OFFER",
      summary: "Missing details",
      media: [],
    })).toThrow(/Event details|required/)
    expect(() => localPostInputSchema.parse({
      topicType: "PRODUCT",
      summary: "Unsupported",
      media: [],
    })).toThrow()
  })
})

describe("Local Posts recurrence validation", () => {
  const schedule = {
    startDate: { year: 2026, month: 10, day: 2 },
    endDate: { year: 2026, month: 10, day: 2 },
  }

  it("accepts a weekly repeating event with an end", () => {
    const parsed = localPostInputSchema.parse({
      topicType: "EVENT",
      summary: "Quiz night",
      event: {
        title: "Quiz",
        schedule,
        recurrenceInfo: {
          weeklyPattern: { daysOfWeek: ["FRIDAY"] },
          seriesEndTime: "2026-12-31T23:59:59Z",
        },
      },
    })
    expect(parsed.event?.recurrenceInfo).toBeDefined()
  })

  it("rejects a repeat with no pattern, two patterns, or no start date", () => {
    const post = (event: Record<string, unknown>) => ({
      topicType: "EVENT",
      summary: "Quiz night",
      event: { title: "Quiz", ...event },
    })
    expect(() =>
      localPostInputSchema.parse(post({ schedule, recurrenceInfo: {} }))
    ).toThrow(/how often/)
    expect(() =>
      localPostInputSchema.parse(
        post({
          schedule,
          recurrenceInfo: { dailyPattern: {}, weeklyPattern: {} },
        })
      )
    ).toThrow(/how often/)
    expect(() =>
      localPostInputSchema.parse(
        post({ recurrenceInfo: { dailyPattern: {} } })
      )
    ).toThrow(/start date/)
    expect(() =>
      localPostInputSchema.parse(
        post({
          schedule,
          recurrenceInfo: {
            monthlyPattern: { dayOfMonth: 2, dayOfWeekOccurrence: "FIRST" },
          },
        })
      )
    ).toThrow(/not both/)
  })

  it("does not let a standard update repeat", () => {
    expect(() =>
      localPostInputSchema.parse({
        topicType: "STANDARD",
        summary: "News",
        event: { schedule, recurrenceInfo: { dailyPattern: {} } },
      })
    ).toThrow(/Only event and offer/)
  })
})
