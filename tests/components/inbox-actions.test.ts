import { describe, expect, it, vi } from "vitest"

import {
  describeOutcomeToast,
  evaluateApproval,
  evaluateDelete,
  evaluatePublish,
} from "@/lib/inbox/actions"

describe("evaluatePublish", () => {
  it("is enabled for a verified, clean, publishable review", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: true, hasVerifiedDraft: true, isDirty: false })
    ).toEqual({ enabled: true })
  })
  it("blocks with a permission reason when the user cannot publish", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: false, hasVerifiedDraft: true, isDirty: false }).reason
    ).toMatch(/permission to publish/)
  })
  it("blocks a dirty composer with a save-first reason", () => {
    expect(
      evaluatePublish({ status: "verified", canPublish: true, hasVerifiedDraft: true, isDirty: true }).reason
    ).toMatch(/Save your draft/)
  })
  it("blocks when no verified draft exists", () => {
    expect(
      evaluatePublish({ status: "new", canPublish: true, hasVerifiedDraft: false, isDirty: false }).enabled
    ).toBe(false)
  })
})

describe("evaluateApproval", () => {
  it("is enabled only when awaiting approval and the user can publish", () => {
    expect(evaluateApproval({ status: "awaiting_approval", canPublish: true })).toEqual({ enabled: true })
    expect(evaluateApproval({ status: "verified", canPublish: true }).enabled).toBe(false)
    expect(evaluateApproval({ status: "awaiting_approval", canPublish: false }).enabled).toBe(false)
  })
})

describe("evaluateDelete", () => {
  it("requires a published reply and publish rights", () => {
    expect(evaluateDelete({ hasPublishedReply: true, canPublish: true })).toEqual({ enabled: true })
    expect(evaluateDelete({ hasPublishedReply: false, canPublish: true }).enabled).toBe(false)
  })
})

describe("describeOutcomeToast", () => {
  // A resolved (never-thrown) mutation status must map to honest copy — a
  // `rejected` or otherwise non-published outcome can never render as
  // "published" (D7, no optimistic publish; fix-round-1 CRITICAL #1).
  it("shows success copy for an actually-published outcome", () => {
    expect(describeOutcomeToast("published")).toEqual({
      title: "Reply published",
      description: "Live on Google.",
      type: "success",
    })
  })
  // D5: a Google write is an outcome, never an Undo. A published reply may
  // link to the review on Google, in a new tab that is told nothing.
  it("offers View on Google, not Undo, for a published reply with a link", () => {
    const toast = describeOutcomeToast("published", {
      googleReplyUrl: "https://search.google.com/local/reviews?r=1",
    })
    expect(toast.title).toBe("Reply published")
    expect(toast.actionProps?.children).toBe("View on Google")
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    toast.actionProps?.onClick()
    expect(open).toHaveBeenCalledWith(
      "https://search.google.com/local/reviews?r=1",
      "_blank",
      "noopener,noreferrer"
    )
    open.mockRestore()
  })
  it("offers no action without an https link, and never on another outcome", () => {
    expect(describeOutcomeToast("published").actionProps).toBeUndefined()
    expect(
      describeOutcomeToast("published", { googleReplyUrl: null }).actionProps
    ).toBeUndefined()
    expect(
      describeOutcomeToast("published", {
        googleReplyUrl: "javascript:alert(1)",
      }).actionProps
    ).toBeUndefined()
    for (const status of [
      "awaiting_approval",
      "rejected",
      "returned_to_draft",
      "deleted",
      "cancelled",
      "pending",
    ]) {
      const toast = describeOutcomeToast(status, {
        googleReplyUrl: "https://search.google.com/local/reviews?r=1",
      })
      expect(toast.actionProps).toBeUndefined()
    }
  })
  it("shows the awaiting-approval copy, not success", () => {
    expect(describeOutcomeToast("awaiting_approval")).toEqual({
      title: "Submitted for approval",
      description: "It goes live on Google once a manager approves it.",
      type: "info",
    })
  })
  it("shows a distinct non-success copy when Google declines the reply", () => {
    const toast = describeOutcomeToast("rejected")
    expect(toast.type).not.toBe("success")
    expect(toast.title).not.toMatch(/published/i)
  })
  it("shows success copy when a reject decision returns the reply to draft", () => {
    expect(describeOutcomeToast("returned_to_draft")).toEqual({
      title: "Reply sent back for edits",
      description: "Its author can revise it and submit it again.",
      type: "success",
    })
  })
  it("never claims 'published' for an unrecognised resolved status", () => {
    const toast = describeOutcomeToast("pending")
    expect(toast.title).not.toMatch(/published/i)
    expect(toast.type).not.toBe("success")
  })
})
