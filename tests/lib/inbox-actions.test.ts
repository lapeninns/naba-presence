import { describe, expect, it } from "vitest"

import {
  describeDeleteToast,
  describeOutcomeToast,
  evaluateApproval,
  evaluateDelete,
  evaluatePublish,
} from "@/lib/inbox/actions"

describe("evaluatePublish", () => {
  it("is enabled for a verified, clean, publishable review", () => {
    expect(
      evaluatePublish({
        status: "verified",
        canPublish: true,
        hasVerifiedDraft: true,
        isDirty: false,
      })
    ).toEqual({ enabled: true })
  })
  it("blocks with a permission reason when the user cannot publish", () => {
    expect(
      evaluatePublish({
        status: "verified",
        canPublish: false,
        hasVerifiedDraft: true,
        isDirty: false,
      }).reason
    ).toMatch(/permission to publish/)
  })
  it("blocks a dirty composer with a save-first reason", () => {
    expect(
      evaluatePublish({
        status: "verified",
        canPublish: true,
        hasVerifiedDraft: true,
        isDirty: true,
      }).reason
    ).toMatch(/Save your draft/)
  })
  it("blocks when no verified draft exists", () => {
    expect(
      evaluatePublish({
        status: "new",
        canPublish: true,
        hasVerifiedDraft: false,
        isDirty: false,
      }).enabled
    ).toBe(false)
  })
})

describe("evaluateApproval", () => {
  it("is enabled only when awaiting approval and the user can publish", () => {
    expect(
      evaluateApproval({ status: "awaiting_approval", canPublish: true })
    ).toEqual({ enabled: true })
    expect(
      evaluateApproval({ status: "verified", canPublish: true }).enabled
    ).toBe(false)
    expect(
      evaluateApproval({ status: "awaiting_approval", canPublish: false })
        .enabled
    ).toBe(false)
  })
})

describe("evaluateDelete", () => {
  it("requires a published reply and publish rights", () => {
    expect(
      evaluateDelete({ hasPublishedReply: true, canPublish: true })
    ).toEqual({ enabled: true })
    expect(
      evaluateDelete({ hasPublishedReply: false, canPublish: true }).enabled
    ).toBe(false)
  })
})

describe("describeOutcomeToast", () => {
  // A resolved (never-thrown) mutation status must map to honest copy — a
  // `rejected` or otherwise non-published outcome can never render as
  // "published" (D7, no optimistic publish; fix-round-1 CRITICAL #1).
  it("shows success copy for an actually-published outcome", () => {
    expect(describeOutcomeToast("published")).toEqual({
      kind: "google",
      title: "Confirmed on Google",
      description: "Your reply is on Google.",
      type: "success",
    })
  })
  // D5: a Google write is an outcome, never an Undo. A published reply links
  // to the review on Google through the toast primitive's typed Google kind,
  // which draws the link as a real anchor (and only for a safe https href).
  it("offers View on Google, not Undo, for a published reply with a link", () => {
    const toast = describeOutcomeToast("published", {
      googleReplyUrl: "https://search.google.com/local/reviews?r=1",
    })
    expect(toast).toEqual({
      kind: "google",
      title: "Confirmed on Google",
      description: "Your reply is on Google.",
      type: "success",
      link: { href: "https://search.google.com/local/reviews?r=1" },
    })
    expect(toast).not.toHaveProperty("undo")
    expect(toast).not.toHaveProperty("actionProps")
  })
  it("offers no link without one, and never on another outcome", () => {
    expect(describeOutcomeToast("published")).not.toHaveProperty("link")
    expect(
      describeOutcomeToast("published", { googleReplyUrl: null })
    ).not.toHaveProperty("link")
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
      expect(toast).not.toHaveProperty("link")
      expect(toast).not.toHaveProperty("undo")
      expect(toast).not.toHaveProperty("actionProps")
    }
  })
  it("types every outcome: Google writes are google, workflow-only ones local", () => {
    const kinds = Object.fromEntries(
      [
        "published",
        "awaiting_approval",
        "rejected",
        "deleted",
        "pending",
        "returned_to_draft",
        "cancelled",
      ].map((status) => [status, describeOutcomeToast(status).kind])
    )
    expect(kinds).toEqual({
      published: "google",
      awaiting_approval: "google",
      rejected: "google",
      deleted: "google",
      pending: "google",
      returned_to_draft: "local",
      cancelled: "local",
    })
  })
  it("does not say On Google while Google is still checking the reply", () => {
    const toast = describeOutcomeToast("published", {
      googleReplyState: "PENDING",
    })
    expect(toast).toEqual({
      kind: "google",
      title: "Sent, waiting for Google to confirm",
      description:
        "Google is checking it. It is not public until Google approves it.",
      type: "info",
    })
    expect(JSON.stringify(toast)).not.toMatch(/live/i)
    expect(
      describeOutcomeToast("published", { googleReplyState: "APPROVED" }).title
    ).toBe("Confirmed on Google")
  })
  it("shows the awaiting-approval copy, not success", () => {
    expect(describeOutcomeToast("awaiting_approval")).toEqual({
      kind: "google",
      title: "Awaiting approval",
      description:
        "It goes to Google once someone with publishing rights approves it.",
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
      kind: "local",
      title: "Sent back",
      description: "Its author can revise it and submit it again.",
      type: "success",
    })
  })
  it("never claims 'published' for an unrecognised resolved status", () => {
    const toast = describeOutcomeToast("pending")
    expect(toast.title).not.toMatch(/published/i)
    expect(toast.type).not.toBe("success")
  })
  it("calls a resolved pending reply sent, never submitted or published", () => {
    expect(describeOutcomeToast("pending")).toEqual({
      kind: "google",
      title: "Sent, waiting for Google to confirm",
      description: "This review updates when Google confirms it.",
      type: "info",
    })
  })
  it("says a settled failed publish did not reach Google", () => {
    expect(describeOutcomeToast("failed")).toMatchObject({
      kind: "google",
      title: "It didn’t go through. Nothing changed on Google.",
      type: "error",
    })
  })
  it("says neither sent nor failed when Google's answer was lost", () => {
    const toast = describeOutcomeToast("ambiguous")
    expect(toast).toMatchObject({
      kind: "google",
      title: "We can’t tell whether Google applied it",
      type: "warning",
    })
    expect(String(toast.description)).toMatch(/Check Google/)
    expect(String(toast.title)).not.toMatch(/published|submitted|sent/i)
  })
  it("says an ambiguous delete may have left the reply on Google", () => {
    expect(describeDeleteToast("ambiguous")).toMatchObject({
      kind: "google",
      title: "We can’t tell whether Google applied it",
      type: "warning",
    })
    expect(String(describeDeleteToast("ambiguous").description)).toMatch(
      /may still be on Google/
    )
    expect(describeDeleteToast("deleted")).toEqual(
      describeOutcomeToast("deleted")
    )
  })
  it("never claims 'published' for an unknown status", () => {
    const toast = describeOutcomeToast("something_new")
    expect(toast.title).not.toMatch(/published/i)
    expect(toast.type).not.toBe("success")
  })
})
