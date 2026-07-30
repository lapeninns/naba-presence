import { describe, expect, it } from "vitest"

import { parsePubSubNotification } from "@/lib/domain/pubsub-payload"

import newReview from "./fixtures/pubsub/new-review.json"
import unknownShape from "./fixtures/pubsub/unknown-shape.json"
import updatedReview from "./fixtures/pubsub/updated-review.json"

function decoded(fixture: { message: { data: string } }) {
  return JSON.parse(
    Buffer.from(fixture.message.data, "base64").toString("utf8")
  )
}

describe("parsePubSubNotification", () => {
  it.each([
    [newReview, "NEW_REVIEW"],
    [updatedReview, "UPDATED_REVIEW"],
  ])("parses a documented %s notification", (fixture, type) => {
    expect(parsePubSubNotification(decoded(fixture))).toEqual({
      type,
      locationName: "locations/2002",
      reviewName: "accounts/1001/locations/2002/reviews/r-777",
    })
  })

  it("returns a safe fallback for an unknown payload", () => {
    expect(parsePubSubNotification(decoded(unknownShape))).toEqual({
      type: "review_update",
      locationName: null,
      reviewName: null,
    })
  })

  it("keeps parsing the legacy notification keys", () => {
    expect(
      parsePubSubNotification({
        notificationType: "LEGACY_REVIEW_UPDATE",
        locationName: "accounts/77/locations/88",
        reviewName: "accounts/77/locations/88/reviews/99",
      })
    ).toEqual({
      type: "LEGACY_REVIEW_UPDATE",
      locationName: "locations/88",
      reviewName: "accounts/77/locations/88/reviews/99",
    })
  })
})
