/**
 * Wire contract for durable bulk listing changes (`/api/listings/bulk/**`).
 * Client-safe.
 */
import { z } from "zod"

import {
  BULK_MAX_ITEMS,
  BULK_MAX_TARGETS,
  bulkChangeListSchema,
  bulkOperationInputSchema,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { isBulkReviewOperation } from "@/lib/domain/bulk-reviews"

const BULK_OPERATIONS = [
  "regular_hours",
  "special_hours",
  "more_hours",
  "attributes",
  "place_action",
  "business_info",
  "categories",
  "lodging",
  "food_menus",
  "post_draft",
  "photos",
  "review_approval",
  "review_template_reply",
] as const

export const bulkPreviewRequestSchema = z
  .strictObject({
    /** Frozen when the preview is generated; a later filter change cannot alter it. */
    locationIds: z
      .array(z.uuid())
      .min(1)
      .max(BULK_MAX_TARGETS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each listing once."
      ),
    /**
     * The ordered change list. Each listing gets one child per change, run
     * in this order at that listing; at most 500 children in all.
     */
    items: bulkChangeListSchema.optional(),
    /** A single change: the same as `items: [input]`. */
    input: bulkOperationInputSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.items === undefined) === (value.input === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Give the changes as `items` (or one change as `input`).",
      })
      return
    }
    if (value.input && isBulkReviewOperation(value.input.operation))
      context.addIssue({
        code: "custom",
        path: ["input"],
        message:
          "Review replies are sent from the inbox, not as a listing change.",
      })
    const changes = value.items?.length ?? 1
    if (value.locationIds.length * changes > BULK_MAX_ITEMS)
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: `A batch holds at most ${BULK_MAX_ITEMS} listing changes in total; select fewer listings or changes.`,
      })
  })
export type BulkPreviewRequest = z.infer<typeof bulkPreviewRequestSchema>
/** The request's ordered change list. */
export const bulkRequestItems = (
  body: BulkPreviewRequest
): BulkOperationInput[] => body.items ?? (body.input ? [body.input] : [])
export const bulkApprovalSchema = z.strictObject({
  expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Required when any selected listing is skipped. */
  acknowledgeSkipped: z.boolean().default(false),
})

export const BULK_OPERATION_STATUSES = [
  "previewed",
  "approved",
  "running",
  "completed",
  "completed_with_failures",
  "cancelled",
  "expired",
] as const
export const BULK_CHILD_STATUSES = [
  "previewed",
  "skipped",
  "queued",
  "running",
  "succeeded",
  "failed",
  "conflict",
  "ambiguous",
  "cancelled",
  // Its dispatch window (24 hours after approval) closed before it was sent.
  "expired",
] as const

export const bulkChildSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  eligibility: z.enum(["eligible", "skipped"]),
  skipReason: z.string().nullable(),
  status: z.enum(BULK_CHILD_STATUSES),
  confirmationState: z.enum(["unrecorded", "confirmed", "unresolved"]),
  resultCode: z.string().nullable(),
  currentValue: z.unknown(),
  proposedValue: z.unknown(),
  updateMask: z.array(z.string()),
  attempts: z.number().int(),
  finishedAt: z.iso.datetime().nullable(),
  /** The change this child carries: its position in the batch's list and its family. */
  seq: z.number().int().min(0),
  itemKey: z.string(),
  operation: z.enum(BULK_OPERATIONS),
  input: bulkOperationInputSchema,
  /** Earlier changes at the same listing this one waits for. */
  dependsOn: z.array(z.uuid()),
  /** The receipt of this listing's write (`GET /api/mutations/{id}`), once one was sent. */
  mutationOperationId: z.uuid().nullable(),
  /** A review child's review (P09-R8), while it exists. */
  reviewId: z.uuid().nullable().optional(),
  /** A review child's reply publish attempt, once its publish started. */
  publishAttemptId: z.uuid().nullable().optional(),
})
export type BulkChild = z.infer<typeof bulkChildSchema>

export const bulkOperationSchema = z.object({
  id: z.uuid(),
  /** The batch's family, or `mixed` when its changes span families. */
  operation: z.enum([...BULK_OPERATIONS, "mixed"]),
  /** The ordered change list. */
  items: z.array(bulkOperationInputSchema).min(1),
  status: z.enum(BULK_OPERATION_STATUSES),
  previewHash: z.string(),
  requestedBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  requiresSecondApprover: z.boolean(),
  canApprove: z.boolean(),
  /** The deadline that applies now: the dispatch deadline once approved, else the preview's. */
  approvalExpiresAt: z.iso.datetime(),
  /** Approve before this (15 minutes after the preview read Google). */
  previewExpiresAt: z.iso.datetime(),
  /** Set at approval: no listing is sent after this (24 hours later). */
  dispatchExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /**
   * The server's clock when it answered, so the page counts the approval
   * window down by the server's time, not the browser's.
   */
  serverTime: z.iso.datetime().optional(),
  counts: z.record(z.string(), z.number()),
  children: z.array(bulkChildSchema),
})
export type BulkOperationView = z.infer<typeof bulkOperationSchema>
export const bulkOperationResponseSchema = z.object({
  operation: bulkOperationSchema,
})
export const bulkOperationListSchema = z.object({
  operations: z.array(
    bulkOperationSchema
      .omit({ children: true, items: true, serverTime: true })
      .extend({
        targetCount: z.number().int(),
        itemCount: z.number().int(),
      })
  ),
})
