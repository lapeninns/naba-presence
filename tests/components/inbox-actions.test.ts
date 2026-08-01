import { describe, expect, it } from "vitest"

import { evaluateApproval, evaluateDelete, evaluatePublish } from "@/lib/inbox/actions"

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
