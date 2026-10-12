/**
 * Bulk review work on the bulk engine (plan P09-R8). Client-safe and pure.
 *
 * Two families: approving parked replies exactly as the approver saw them,
 * and replying to rating-only reviews from the standard template. Each
 * child is one review at that review's location. Unlike listing changes,
 * a review batch is not previewed and then approved by someone else: the
 * person who starts it is the one deciding (the approver for approvals,
 * the author for template replies), and each review keeps its own
 * approval rules (lib/server/review-approval.ts, lib/server/publishing).
 * Assigning and "no reply needed" stay synchronous.
 */
import { z } from "zod"

/** The inbox's existing per-batch limit. */
export const BULK_MAX_REVIEWS = 100

export const BULK_REVIEW_OPERATIONS = [
  "review_approval",
  "review_template_reply",
] as const
export type BulkReviewOperation = (typeof BULK_REVIEW_OPERATIONS)[number]

export function isBulkReviewOperation(
  operation: string
): operation is BulkReviewOperation {
  return (BULK_REVIEW_OPERATIONS as readonly string[]).includes(operation)
}

/**
 * One approval, bound to the draft on screen and the review's update time
 * when it was shown. The decision is recorded when the batch starts; the
 * child publishes that draft, and only while the decision still stands.
 */
export const bulkReviewApprovalInputSchema = z.strictObject({
  operation: z.literal("review_approval"),
  reviewId: z.uuid(),
  draftId: z.uuid(),
  reviewUpdateTime: z.iso.datetime({ offset: true }),
})
export type BulkReviewApprovalInput = z.infer<
  typeof bulkReviewApprovalInputSchema
>

/**
 * One template reply: a rating-only review as it was when the batch
 * started. The child drafts the rating template, checks it like any other
 * draft and publishes it, or submits it for approval when its author may
 * not publish there.
 */
export const bulkReviewTemplateInputSchema = z.strictObject({
  operation: z.literal("review_template_reply"),
  reviewId: z.uuid(),
  reviewUpdateTime: z.iso.datetime({ offset: true }),
})
export type BulkReviewTemplateInput = z.infer<
  typeof bulkReviewTemplateInputSchema
>

export type BulkReviewInput = BulkReviewApprovalInput | BulkReviewTemplateInput

/**
 * Why a selected review is left out of a template batch, as the server
 * decides it when the batch starts (the inbox's `templateSkipReason` is the
 * same rule, shown before anyone presses the button).
 */
export const TEMPLATE_SKIP_CODES = {
  has_text: "template_review_has_text",
  low_rating: "template_low_rating",
  has_draft: "template_has_draft",
  has_reply: "template_has_reply",
  busy: "template_review_busy",
  restricted: "review_restricted",
} as const

export type TemplateEligibility = {
  text: string | null
  rating: number | null
  workflowStatus: string
  hasDraft: boolean
  hasReply: boolean
  restricted: boolean
}

/** The skip code for a review a template batch must leave alone, or null. */
export function templateSkipCode(
  review: TemplateEligibility,
  options: { includeLowRatings: boolean }
): string | null {
  if (review.text?.trim()) return TEMPLATE_SKIP_CODES.has_text
  if (review.restricted) return TEMPLATE_SKIP_CODES.restricted
  if (review.hasReply) return TEMPLATE_SKIP_CODES.has_reply
  if (review.hasDraft) return TEMPLATE_SKIP_CODES.has_draft
  // Only an untouched review starts a template draft; every later state has
  // a draft, an approval, a publish or a failure someone should see.
  if (review.workflowStatus !== "new") return TEMPLATE_SKIP_CODES.busy
  if (
    !options.includeLowRatings &&
    review.rating !== null &&
    review.rating <= 2
  )
    return TEMPLATE_SKIP_CODES.low_rating
  return null
}
