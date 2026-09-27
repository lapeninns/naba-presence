import { describe, expect, it } from "vitest"

import { postContentTimestamp } from "@/lib/locations/post-display"
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

describe("post content timestamps", () => {
  const row = { googlePostName: "accounts/a/locations/l/localPosts/p", localEditedAt: "2026-09-27T12:00:00Z", status: "published" as const, googleState: "LIVE", lastErrorCode: null, updatedAt: "2026-09-27T12:00:00Z", providerUpdatedAt: "2026-08-02T09:00:00Z", providerCreatedAt: "2026-08-01T09:00:00Z" }
  it("uses provider content time rather than reconciliation time", () => {
    expect(postContentTimestamp(row)).toBe("2026-08-02T09:00:00Z")
    expect(postContentTimestamp({ ...row, updatedAt: "2026-09-28T12:00:00Z" })).toBe("2026-08-02T09:00:00Z")
  })
  it("falls back to provider creation when update time is missing or malformed", () => {
    expect(postContentTimestamp({ ...row, providerUpdatedAt: null })).toBe("2026-08-01T09:00:00Z")
    expect(postContentTimestamp({ ...row, providerUpdatedAt: "not-a-date" })).toBe("2026-08-01T09:00:00Z")
  })
  it("does not invent a published date when neither provider time is valid", () => {
    expect(postContentTimestamp({ ...row, providerUpdatedAt: undefined, providerCreatedAt: null })).toBeNull()
  })
  it("uses local edits for drafts but provider content dates for rejected Google posts", () => {
    expect(postContentTimestamp({ ...row, status: "draft" })).toBe(row.updatedAt)
    expect(postContentTimestamp({ ...row, status: "failed", googleState: "REJECTED", lastErrorCode: "google_post_rejected" })).toBe(row.providerUpdatedAt)
  })
})

it("uses the authoring audit time for a reconciled draft and reports unavailable for an unaudited provider draft", () => {
  const row = { status: "draft" as const, googleState: "REJECTED", googlePostName: "accounts/a/locations/l/localPosts/p", lastErrorCode: null, updatedAt: "2026-09-27T12:00:00Z", localEditedAt: "2026-09-26T09:00:00Z" }
  expect(postContentTimestamp(row)).toBe("2026-09-26T09:00:00Z")
  expect(postContentTimestamp({ ...row, localEditedAt: null })).toBeNull()
  expect(postContentTimestamp({ ...row, localEditedAt: undefined })).toBeNull()
})

it("uses provider dates for an imported rejection with no authoring audit, but preserves failed local edits", () => {
  const row = { status: "failed" as const, googleState: "REJECTED", googlePostName: "accounts/a/locations/l/localPosts/p", lastErrorCode: null, updatedAt: "2026-09-27T12:00:00Z", localEditedAt: null, providerUpdatedAt: "2026-08-02T09:00:00Z", providerCreatedAt: null }
  expect(postContentTimestamp(row)).toBe("2026-08-02T09:00:00Z")
  expect(postContentTimestamp({ ...row, lastErrorCode: "google_timeout", localEditedAt: "2026-09-26T09:00:00Z" })).toBe("2026-09-26T09:00:00Z")
})
