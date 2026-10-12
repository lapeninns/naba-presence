import { describe, expect, it, vi } from "vitest"

import { bulkReviewActionSchema } from "@/lib/contracts/reviews"
import { summariseBulkOutcome } from "@/lib/inbox/bulk-outcome"
import { ApiError } from "@/lib/server/http"
import { rowFromApproval, rowFromError } from "@/lib/server/review-bulk-outcome"

const ctx = {
  requestId: "req-1",
  session: { organisationId: "org-1", userId: "user-1" },
}

describe("bulk review row outcomes", () => {
  it("skips a row refused before anything committed", () => {
    expect(
      rowFromError(
        "r1",
        new ApiError(409, "approval_draft_changed", "changed"),
        "before_commit",
        ctx
      )
    ).toEqual({ reviewId: "r1", status: "skipped", code: "approval_draft_changed" })
  })

  it("fails a row on a server fault before commit", () => {
    expect(
      rowFromError("r1", new ApiError(503, "db_unavailable", "x"), "before_commit", ctx)
    ).toEqual({ reviewId: "r1", status: "failed", code: "db_unavailable" })
  })

  // The decision row and its audit already say "approved". Reporting the row
  // as skipped would tell the operator nothing happened.
  it("reports a refused publish after approval as approved_not_published", () => {
    for (const error of [
      new ApiError(429, "RESOURCE_EXHAUSTED", "slow down"),
      new ApiError(409, "review_changed", "moved"),
      new ApiError(503, "google_unavailable", "down"),
    ]) {
      expect(rowFromError("r1", error, "after_approval", ctx)).toEqual({
        reviewId: "r1",
        status: "approved_not_published",
        code: error.code,
      })
    }
  })

  // Google may hold a reply (ours, a different one, or one still landing).
  it("reports a publish Google may hold as uncertain", () => {
    for (const code of ["google_mutation_ambiguous", "reply_diverged", "publish_in_progress"]) {
      expect(
        rowFromError("r1", new ApiError(409, code, "maybe"), "after_approval", ctx)
      ).toEqual({ reviewId: "r1", status: "uncertain", code })
    }
  })

  // The decision is spent, so "try again" would only earn approval_not_pending.
  it("says a publish parked for automatic retry will be resent", () => {
    for (const error of [
      new ApiError(429, "google_rate_limited", "slow down", {
        details: { retryScheduledAt: "2026-10-10T10:00:00.000Z" },
      }),
      new ApiError(409, "google_token_unavailable", "blocked", {
        details: { retryScheduledAt: "2026-10-10T10:15:00.000Z" },
      }),
      new ApiError(429, "publish_retry_not_ready", "later"),
    ]) {
      expect(rowFromError("r1", error, "after_approval", ctx)).toEqual({
        reviewId: "r1",
        status: "approved_not_published",
        code: "publish_retry_scheduled",
      })
    }
  })

  it("counts only a reply Google took as ok", () => {
    expect(rowFromApproval("r1", { status: "published" })).toEqual({ reviewId: "r1", status: "ok" })
    expect(rowFromApproval("r1", { status: "pending" })).toEqual({ reviewId: "r1", status: "ok" })
    expect(rowFromApproval("r1", { status: "rejected" })).toEqual({
      reviewId: "r1",
      status: "approved_not_published",
      code: "google_reply_rejected",
    })
    expect(rowFromApproval("r1", { status: "awaiting_approval" })).toEqual({
      reviewId: "r1",
      status: "approved_not_published",
      code: "publish_not_sent",
    })
  })

  it("turns an unexpected error into this row's outcome instead of throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(rowFromError("r1", new TypeError("boom"), "before_commit", ctx)).toEqual({
        reviewId: "r1",
        status: "failed",
        code: "bulk_row_failed",
      })
      // After the approval committed the publish may already have reached
      // Google, so the honest answer is "unknown", not "failed".
      expect(rowFromError("r1", new TypeError("boom"), "after_approval", ctx)).toEqual({
        reviewId: "r1",
        status: "uncertain",
        code: "publish_outcome_unknown",
      })
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("bulk review contract", () => {
  const item = {
    reviewId: "6f1c1d1e-8a0b-4c2d-9e3f-0a1b2c3d4e5f",
    draftId: "7f1c1d1e-8a0b-4c2d-9e3f-0a1b2c3d4e5f",
    reviewUpdateTime: "2026-09-01T10:00:00.000Z",
  }

  it("requires approvals to name the draft and review version shown", () => {
    expect(bulkReviewActionSchema.safeParse({ action: "approve", approvals: [item] }).success).toBe(true)
    expect(
      bulkReviewActionSchema.safeParse({
        action: "approve",
        approvals: [{ reviewId: item.reviewId, draftId: item.draftId }],
      }).success
    ).toBe(false)
    expect(
      bulkReviewActionSchema.safeParse({
        action: "approve",
        approvals: [{ reviewId: item.reviewId, reviewUpdateTime: item.reviewUpdateTime }],
      }).success
    ).toBe(false)
    // The old id-only shape cannot approve anything.
    expect(
      bulkReviewActionSchema.safeParse({ action: "approve", reviewIds: [item.reviewId] }).success
    ).toBe(false)
  })

  it("refuses the same review twice in one approve batch", () => {
    expect(
      bulkReviewActionSchema.safeParse({ action: "approve", approvals: [item, item] }).success
    ).toBe(false)
  })

  it("still requires an explicit assignee (or null) to assign", () => {
    expect(
      bulkReviewActionSchema.safeParse({ action: "assign", reviewIds: [item.reviewId] }).success
    ).toBe(false)
    expect(
      bulkReviewActionSchema.safeParse({
        action: "assign",
        reviewIds: [item.reviewId],
        assigneeId: null,
      }).success
    ).toBe(true)
  })
})

describe("bulk outcome summary", () => {
  it("clears the selection only when every row took effect", () => {
    expect(
      summariseBulkOutcome({ results: [{ reviewId: "a", status: "ok" }] })
    ).toMatchObject({ title: "1 review updated", tone: "success", allOk: true })
  })

  it("names every kind of outcome in a mixed batch", () => {
    const summary = summariseBulkOutcome({
      results: [
        { reviewId: "a", status: "ok" },
        { reviewId: "b", status: "approved_not_published", code: "RESOURCE_EXHAUSTED" },
        { reviewId: "c", status: "uncertain", code: "google_mutation_ambiguous" },
        { reviewId: "d", status: "skipped", code: "approval_draft_changed" },
        { reviewId: "e", status: "failed", code: "bulk_row_failed" },
      ],
    })
    expect(summary).toMatchObject({
      title:
        "1 updated, 1 approved but not published, 1 may have reached Google, 1 skipped, 1 failed",
      tone: "error",
      allOk: false,
    })
    expect(summary.description).toMatch(/Check those replies on Google/)
  })

  it("warns, not errors, when rows were only skipped or held back", () => {
    expect(
      summariseBulkOutcome({
        results: [
          { reviewId: "a", status: "skipped" },
          { reviewId: "b", status: "approved_not_published" },
        ],
      }).tone
    ).toBe("warning")
  })
})
