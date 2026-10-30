import { describe, expect, it } from "vitest"

import { decodeReviewsQuery, encodeReviewsQuery } from "@/lib/contracts/reviews"
import { FILTER_NAMES } from "@/lib/inbox/filter-labels"
import {
  hasActiveFilters,
  parseInboxState,
  serializeInboxState,
  toReviewsFilters,
} from "@/lib/inbox/url-state"
import { reviewNotificationPath } from "@/lib/notifications/links"
import { renderIncidentEmail } from "@/lib/server/notifications/messages"

const LOCATION = "0b9e5c1e-7d1f-4c3a-9d2e-2f6b1a0c9e11"
const APP = "https://app.example.test"

describe("the inbox Topic filter (S3)", () => {
  it("round-trips a topic through the address and counts it as a filter", () => {
    const state = parseInboxState(new URLSearchParams("topic=sunday_roast"))
    expect(state.topic).toBe("sunday_roast")
    expect(hasActiveFilters(state)).toBe(true)
    expect(serializeInboxState(state).get("topic")).toBe("sunday_roast")
    expect(toReviewsFilters(state).topic).toBe("sunday_roast")
  })

  it("ignores a topic outside the fixed list", () => {
    const state = parseInboxState(new URLSearchParams("topic=weather"))
    expect(state.topic).toBeUndefined()
    expect(hasActiveFilters(state)).toBe(false)
    expect(serializeInboxState(state).has("topic")).toBe(false)
  })

  it("sends the topic on the wire and decodes it on the server", () => {
    const params = encodeReviewsQuery({ topic: "parking" })
    expect(params.get("topic")).toBe("parking")
    expect(decodeReviewsQuery(params).topic).toBe("parking")
    expect(decodeReviewsQuery(new URLSearchParams()).topic).toBeUndefined()
  })

  it("refuses an unknown topic on the wire rather than ignoring it", () => {
    expect(() =>
      decodeReviewsQuery(new URLSearchParams("topic=weather"))
    ).toThrow()
  })

  it("names the filter once for the sheet and the chip", () => {
    expect(FILTER_NAMES.topic).toBe("Topic")
  })
})

describe("topic alert and edited low-rating notifications (S3)", () => {
  it("opens a topic alert on that venue's reviews about the topic", () => {
    expect(
      reviewNotificationPath("review_topic_negative", {
        locationId: LOCATION,
        topic: "service",
      })
    ).toBe(`/inbox?queue=all&locationId=${LOCATION}&topic=service`)
  })

  it("links nowhere for a malformed topic alert summary", () => {
    expect(
      reviewNotificationPath("review_topic_negative", {
        locationId: "not-a-uuid",
        topic: "service",
      })
    ).toBeNull()
    expect(
      reviewNotificationPath("review_topic_negative", {
        locationId: LOCATION,
        topic: "x&y=1",
      })
    ).toBeNull()
  })

  it("emails the topic alert with the venue, the topic and an inbox link", () => {
    const { subject, text } = renderIncidentEmail(
      "review_topic_negative",
      {
        title: "Service at The Railway",
        locationId: LOCATION,
        topic: "service",
        recentNegative: 3,
        recentMentions: 5,
      },
      APP
    )
    expect(subject).toBe("Topic turning negative: Service at The Railway")
    expect(text).toContain(
      `${APP}/inbox?queue=all&locationId=${LOCATION}&topic=service`
    )
    expect(text).toContain("3 of the 5 mentions")
  })

  it("says a review was changed, not new, when it was edited down", () => {
    const { subject, text } = renderIncidentEmail(
      "low_rating_review",
      { rating: 2, title: "The Railway", edited: true, previousRating: 5 },
      APP
    )
    expect(subject).toBe("A review for The Railway was changed to 2 stars")
    expect(text).toContain(
      "changed their Google review of The Railway from 5 to 2 stars"
    )
    expect(text).not.toContain("new")
    const fresh = renderIncidentEmail(
      "low_rating_review",
      { rating: 2, title: "The Railway" },
      APP
    )
    expect(fresh.subject).toBe("New 2-star review for The Railway")
  })
})
