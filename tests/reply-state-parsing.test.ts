import { describe, expect, it } from "vitest"

import { parseReplyModeration } from "@/lib/domain/reply-state"

import fixtures from "./fixtures/google/review-reply-states.json"

describe("Google reply moderation parsing", () => {
  it("parses review-level pending state", () => {
    expect(parseReplyModeration(fixtures.pending)).toEqual({
      state: "PENDING",
      policyViolation: null,
      comment: "Thanks for visiting.",
      updateTime: "2026-08-02T09:00:00Z",
    })
  })

  it("parses review-level approved state", () => {
    expect(parseReplyModeration(fixtures.approved)).toEqual({
      state: "APPROVED",
      policyViolation: null,
      comment: "Thanks for visiting.",
      updateTime: "2026-08-02T09:00:00Z",
    })
  })

  it("parses review-level rejection and policy violation", () => {
    expect(parseReplyModeration(fixtures.rejected)).toEqual({
      state: "REJECTED",
      policyViolation: "OFF_TOPIC",
      comment: "Thanks for visiting.",
      updateTime: "2026-08-02T09:00:00Z",
    })
  })

  it("supports the legacy nested moderation shape", () => {
    expect(parseReplyModeration(fixtures.legacyNestedState)).toEqual({
      state: "REJECTED",
      policyViolation: "\"SPAM\"",
      comment: "x",
      updateTime: "2026-08-02T09:00:00Z",
    })
  })

  it("returns null fields when no provider reply exists", () => {
    expect(parseReplyModeration(fixtures.noReply)).toEqual({
      state: null,
      policyViolation: null,
      comment: null,
      updateTime: null,
    })
  })

  it.each([
    "REVIEW_REPLY_STATE_UNSPECIFIED",
    "SOMETHING_NEW",
  ])("safely ignores unknown state %s", (reviewReplyState) => {
    expect(
      parseReplyModeration({
        reviewReplyState,
        reviewReply: { comment: "Still safe to read." },
      })
    ).toEqual({
      state: null,
      policyViolation: null,
      comment: "Still safe to read.",
      updateTime: null,
    })
  })
})
