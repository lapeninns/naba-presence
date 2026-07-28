import { describe, expect, it } from "vitest"

import {
  isAllowedReviewTransition,
  REVIEW_WORKFLOW_STATES,
} from "@/lib/domain/workflow"

describe("review workflow", () => {
  it.each([
    ["new", "drafted"],
    ["drafted", "verified"],
    ["verified", "awaiting_approval"],
    ["verified", "publish_requested"],
    ["awaiting_approval", "publish_requested"],
    ["publish_requested", "published"],
    ["publish_requested", "rejected"],
    ["publish_requested", "failed"],
    ["published", "drafted"],
    ["failed", "publish_requested"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(isAllowedReviewTransition(from, to)).toBe(true)
  })

  it.each([
    ["new", "verified"],
    ["new", "failed"],
    ["drafted", "published"],
    ["verified", "published"],
    ["published", "awaiting_approval"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(isAllowedReviewTransition(from, to)).toBe(false)
  })

  it("recognises a no-op transition for every state", () => {
    for (const state of REVIEW_WORKFLOW_STATES) {
      expect(isAllowedReviewTransition(state, state)).toBe(true)
    }
  })
})
