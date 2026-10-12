import { beforeEach, describe, expect, it, vi } from "vitest"

import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import { bulkReviewActionSchema } from "@/lib/contracts/reviews"
import {
  bulkChangeListSchema,
  bulkChangeParts,
  bulkOperationInputSchema,
  bulkResourceKey,
} from "@/lib/domain/bulk-merge"
import {
  isBulkReviewOperation,
  TEMPLATE_SKIP_CODES,
  templateSkipCode,
} from "@/lib/domain/bulk-reviews"
import { summariseBulkOutcome } from "@/lib/inbox/bulk-outcome"
import type { DispatchContext } from "@/lib/server/bulk-families/types"
import { ApiError } from "@/lib/server/http"

// P09-R8: bulk review work on the bulk engine. The input schemas, the
// template eligibility rule, the listing routes refusing review changes,
// the inbox's queued summary, and how a review child maps the reply
// pipeline's answers (the integration suite runs the real pipeline).

const publish = vi.fn()
const createDraft = vi.fn()
const tenantRows: unknown[][] = []
vi.mock("@/lib/server/publishing", () => ({
  executePublish: (...args: unknown[]) => publish(...args),
}))
vi.mock("@/lib/server/review-drafts", () => ({
  createReviewDraft: (...args: unknown[]) => createDraft(...args),
}))
vi.mock("@/lib/server/db", () => ({
  withTenant: async (_org: string, work: (sql: unknown) => Promise<unknown>) =>
    work(() => Promise.resolve(tenantRows.shift() ?? [])),
}))

const REVIEW = "11111111-1111-4111-8111-111111111111"
const DRAFT = "22222222-2222-4222-8222-222222222222"
const LOCATION = "33333333-3333-4333-8333-333333333333"
const USER = "44444444-4444-4444-8444-444444444444"
const SHOWN = "2026-10-01T10:00:00.000Z"

describe("bulk review inputs", () => {
  it("parses both families and keys each by its review", () => {
    const approval = bulkOperationInputSchema.parse({
      operation: "review_approval",
      reviewId: REVIEW,
      draftId: DRAFT,
      reviewUpdateTime: SHOWN,
    })
    const template = bulkOperationInputSchema.parse({
      operation: "review_template_reply",
      reviewId: REVIEW,
      reviewUpdateTime: SHOWN,
    })
    expect(bulkChangeParts(approval)).toEqual([`review:${REVIEW}`])
    expect(bulkResourceKey(template.operation)).toBe("reviews")
    expect(isBulkReviewOperation("review_approval")).toBe(true)
    expect(isBulkReviewOperation("photos")).toBe(false)
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "review_approval",
        reviewId: REVIEW,
        reviewUpdateTime: SHOWN,
      }).success
    ).toBe(false)
  })

  it("never lets a listing change list carry review work", () => {
    const change = {
      operation: "review_template_reply",
      reviewId: REVIEW,
      reviewUpdateTime: SHOWN,
    }
    expect(bulkChangeListSchema.safeParse([change]).success).toBe(false)
    expect(
      bulkPreviewRequestSchema.safeParse({
        locationIds: [LOCATION],
        input: change,
      }).success
    ).toBe(false)
  })

  it("accepts a template batch of distinct reviews only", () => {
    expect(
      bulkReviewActionSchema.parse({
        action: "template_reply",
        reviewIds: [REVIEW],
      })
    ).toEqual({
      action: "template_reply",
      reviewIds: [REVIEW],
      includeLowRatings: false,
    })
    expect(
      bulkReviewActionSchema.safeParse({
        action: "template_reply",
        reviewIds: [REVIEW, REVIEW],
      }).success
    ).toBe(false)
  })
})

describe("template eligibility", () => {
  const untouched = {
    text: null,
    rating: 5,
    workflowStatus: "new",
    hasDraft: false,
    hasReply: false,
    restricted: false,
  }
  it("takes an untouched rating-only review and leaves the rest with a reason", () => {
    const options = { includeLowRatings: false }
    expect(templateSkipCode(untouched, options)).toBeNull()
    expect(templateSkipCode({ ...untouched, text: "Great" }, options)).toBe(
      TEMPLATE_SKIP_CODES.has_text
    )
    expect(templateSkipCode({ ...untouched, text: "  " }, options)).toBeNull()
    expect(templateSkipCode({ ...untouched, restricted: true }, options)).toBe(
      TEMPLATE_SKIP_CODES.restricted
    )
    expect(templateSkipCode({ ...untouched, hasReply: true }, options)).toBe(
      TEMPLATE_SKIP_CODES.has_reply
    )
    expect(templateSkipCode({ ...untouched, hasDraft: true }, options)).toBe(
      TEMPLATE_SKIP_CODES.has_draft
    )
    expect(
      templateSkipCode({ ...untouched, workflowStatus: "failed" }, options)
    ).toBe(TEMPLATE_SKIP_CODES.busy)
    expect(templateSkipCode({ ...untouched, rating: 2 }, options)).toBe(
      TEMPLATE_SKIP_CODES.low_rating
    )
    expect(
      templateSkipCode({ ...untouched, rating: 1 }, { includeLowRatings: true })
    ).toBeNull()
  })
})

describe("inbox summary of a queued batch", () => {
  it("says the replies are queued and counts what was left out", () => {
    expect(
      summariseBulkOutcome({
        operationId: REVIEW,
        results: [
          { reviewId: "a", status: "queued" },
          { reviewId: "b", status: "queued" },
        ],
      })
    ).toMatchObject({ title: "2 replies queued", tone: "success", allOk: true })
    expect(
      summariseBulkOutcome({
        operationId: REVIEW,
        results: [
          { reviewId: "a", status: "queued" },
          { reviewId: "b", status: "skipped", code: "review_changed" },
        ],
      })
    ).toMatchObject({
      title: "1 reply queued, 1 skipped",
      tone: "warning",
      allOk: false,
    })
  })
})

describe("review families", () => {
  beforeEach(() => {
    publish.mockReset()
    createDraft.mockReset()
    tenantRows.length = 0
  })

  const context = (input: Record<string, unknown>) =>
    ({
      organisationId: "org",
      operationId: "op",
      childId: "child",
      locationId: LOCATION,
      input,
      session: { userId: USER },
      requestId: "req",
      stillOpen: () => true,
    }) as unknown as DispatchContext<never>
  const approval = {
    operation: "review_approval",
    reviewId: REVIEW,
    draftId: DRAFT,
    reviewUpdateTime: "2026-10-01T10:00:00Z",
  }
  const standing = {
    workflowStatus: "awaiting_approval",
    locationId: LOCATION,
    decision: "approved",
    decisionDraftId: DRAFT,
    decidedBy: USER,
  }

  it("publishes a standing approval with the normalised review time", async () => {
    const { reviewApprovalFamily } =
      await import("@/lib/server/bulk-families/reviews")
    tenantRows.push([standing])
    publish.mockResolvedValue({
      status: "published",
      attemptId: "attempt",
      googleReplyState: "PENDING",
    })
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toMatchObject({
      kind: "succeeded",
      confirmation: "confirmed",
      publishAttemptId: "attempt",
    })
    expect(publish.mock.calls[0][0]).toMatchObject({
      reviewId: REVIEW,
      draftId: DRAFT,
      expectedReviewUpdateTime: SHOWN,
      session: { userId: USER },
    })
  })

  it("does not publish an approval that was withdrawn or replaced", async () => {
    const { reviewApprovalFamily } =
      await import("@/lib/server/bulk-families/reviews")
    for (const moved of [
      { decision: "rejected" },
      { decisionDraftId: "55555555-5555-4555-8555-555555555555" },
      { decidedBy: "66666666-6666-4666-8666-666666666666" },
      { workflowStatus: "drafted" },
    ]) {
      tenantRows.push([{ ...standing, ...moved }])
      await expect(
        reviewApprovalFamily.dispatch(context(approval))
      ).resolves.toEqual({ kind: "conflict", code: "approval_withdrawn" })
    }
    expect(publish).not.toHaveBeenCalled()
  })

  it("waits on the publish attempt when Google's answer is unknown or rate limited", async () => {
    const { reviewApprovalFamily } =
      await import("@/lib/server/bulk-families/reviews")
    tenantRows.push([standing])
    publish.mockResolvedValueOnce({ status: "ambiguous", attemptId: "a1" })
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toMatchObject({
      kind: "ambiguous",
      code: "response_ambiguous",
      publishAttemptId: "a1",
    })
    tenantRows.push([standing])
    publish.mockResolvedValueOnce({
      status: "failed",
      attemptId: "a2",
      retryScheduledAt: "2026-10-01T10:05:00Z",
    })
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toMatchObject({
      kind: "ambiguous",
      code: "publish_retry_scheduled",
      publishAttemptId: "a2",
    })
    // A retry not yet due names the attempt it waits on.
    tenantRows.push([standing], [{ id: "a3", status: "retryable" }])
    publish.mockRejectedValueOnce(
      new ApiError(429, "publish_retry_not_ready", "later")
    )
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toMatchObject({
      kind: "ambiguous",
      code: "publish_retry_scheduled",
      publishAttemptId: "a3",
    })
  })

  it("defers while publishing is paused and settles refusals per review", async () => {
    const { reviewApprovalFamily } =
      await import("@/lib/server/bulk-families/reviews")
    tenantRows.push([standing])
    publish.mockRejectedValueOnce(
      new ApiError(503, "publishing_paused", "paused")
    )
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toEqual({ kind: "deferred", code: "publishing_paused" })
    tenantRows.push([standing])
    publish.mockRejectedValueOnce(new ApiError(409, "review_changed", "moved"))
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toEqual({ kind: "conflict", code: "review_changed" })
    tenantRows.push([standing])
    publish.mockResolvedValueOnce({
      status: "rejected",
      attemptId: "a4",
      googleReplyState: "REJECTED",
    })
    await expect(
      reviewApprovalFamily.dispatch(context(approval))
    ).resolves.toMatchObject({ kind: "failed", code: "google_reply_rejected" })
  })

  it("drafts a template once, by the child's own draft id, and resumes from it", async () => {
    const { reviewTemplateReplyFamily, bulkReviewDraftId } =
      await import("@/lib/server/bulk-families/reviews")
    const template = {
      operation: "review_template_reply",
      reviewId: REVIEW,
      reviewUpdateTime: SHOWN,
    }
    const fresh = {
      locationId: LOCATION,
      updateTime: new Date(SHOWN),
      ours: null,
      otherDraft: false,
      hasReply: false,
      workflowStatus: "new",
      text: null,
    }
    tenantRows.push([fresh])
    createDraft.mockResolvedValue({ verification: { verdict: "pass" } })
    publish.mockResolvedValue({
      status: "awaiting_approval",
      attemptId: "reply",
    })
    await expect(
      reviewTemplateReplyFamily.dispatch(context(template))
    ).resolves.toMatchObject({
      kind: "succeeded",
      code: "submitted_for_approval",
    })
    expect(createDraft.mock.calls[0][0]).toMatchObject({
      reviewId: REVIEW,
      draftId: bulkReviewDraftId("child"),
      templateOnly: true,
    })
    expect(bulkReviewDraftId("child")).toBe(bulkReviewDraftId("child"))
    expect(bulkReviewDraftId("child")).not.toBe(bulkReviewDraftId("other"))

    // Re-run: the draft exists, so nothing is drafted again, and the
    // eligibility of an untouched review no longer applies.
    tenantRows.push([
      { ...fresh, ours: "pass", workflowStatus: "awaiting_approval" },
    ])
    await reviewTemplateReplyFamily.dispatch(context(template))
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(2)

    // A review that gained text, or moved, since the batch started.
    tenantRows.push([{ ...fresh, text: "Now with words" }])
    await expect(
      reviewTemplateReplyFamily.dispatch(context(template))
    ).resolves.toEqual({ kind: "conflict", code: "template_review_has_text" })
    tenantRows.push([
      { ...fresh, updateTime: new Date("2026-10-02T00:00:00Z") },
    ])
    await expect(
      reviewTemplateReplyFamily.dispatch(context(template))
    ).resolves.toEqual({ kind: "conflict", code: "review_changed" })
    // A draft that fails its checks is never sent.
    tenantRows.push([{ ...fresh, ours: "fail" }])
    await expect(
      reviewTemplateReplyFamily.dispatch(context(template))
    ).resolves.toMatchObject({ kind: "failed", code: "verification_failed" })
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it("settles a waiting child from its publish attempt", async () => {
    const { reviewApprovalFamily } =
      await import("@/lib/server/bulk-families/reviews")
    const settle = async (row: Record<string, unknown> | null) =>
      reviewApprovalFamily.reconcileAttempt!(
        (() => Promise.resolve(row ? [row] : [])) as never,
        { organisationId: "org", childId: "child", publishAttemptId: "a" }
      )
    await expect(
      settle({ status: "succeeded", errorCode: null, replyStatus: "published" })
    ).resolves.toEqual({ kind: "succeeded", confirmation: "confirmed" })
    await expect(
      settle({ status: "succeeded", errorCode: null, replyStatus: "rejected" })
    ).resolves.toEqual({ kind: "failed", code: "google_reply_rejected" })
    await expect(
      settle({
        status: "failed",
        errorCode: "recovery_exhausted",
        replyStatus: "accepted",
      })
    ).resolves.toEqual({
      kind: "failed",
      code: "publish_failed:recovery_exhausted",
    })
    await expect(
      settle({ status: "ambiguous", errorCode: null, replyStatus: "accepted" })
    ).resolves.toBeNull()
  })
})
