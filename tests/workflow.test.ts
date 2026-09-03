import { describe, expect, it } from "vitest"

import {
  deleteWorkflowTarget,
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

  it("maps delete branches to their valid workflow targets", () => {
    expect(deleteWorkflowTarget("remote")).toBe("new")
    expect(deleteWorkflowTarget("local_cancel")).toBe("drafted")
  })

  // A local cancel out of `publish_requested` settles `failed`, not `drafted`:
  // there is no publish_requested -> drafted edge here or in
  // enforce_review_workflow_transition, and widening the rule would make the
  // drafts route's own publish_requested gate a permanent no-op. Every target
  // this function can return must be reachable from the state it was given.
  it("settles a withdrawn publish intent as failed, never drafted", () => {
    expect(deleteWorkflowTarget("local_cancel", "publish_requested")).toBe(
      "failed"
    )
    expect(deleteWorkflowTarget("local_cancel", "awaiting_approval")).toBe(
      "drafted"
    )
    // A local cancel is reachable from any state the review can be in, so
    // every answer it gives must be a legal transition from that state.
    for (const from of REVIEW_WORKFLOW_STATES) {
      expect(
        isAllowedReviewTransition(
          from,
          deleteWorkflowTarget("local_cancel", from)
        ),
        `local_cancel from ${from}`
      ).toBe(true)
    }
    // A remote delete needs a reply that reached Google, so only the settled
    // states can reach it.
    for (const from of ["published", "rejected", "failed"] as const) {
      expect(deleteWorkflowTarget("remote", from)).toBe("new")
      expect(isAllowedReviewTransition(from, "new"), from).toBe(true)
    }
  })
})
