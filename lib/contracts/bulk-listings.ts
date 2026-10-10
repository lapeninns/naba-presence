/**
 * Wire contract for durable bulk listing changes (`/api/listings/bulk/**`).
 * Client-safe.
 */
import { z } from "zod"

import {
  BULK_MAX_TARGETS,
  bulkOperationInputSchema,
} from "@/lib/domain/bulk-merge"

export const bulkPreviewRequestSchema = z.strictObject({
  /** Frozen when the preview is generated; a later filter change cannot alter it. */
  locationIds: z
    .array(z.uuid())
    .min(1)
    .max(BULK_MAX_TARGETS)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Select each listing once."
    ),
  input: bulkOperationInputSchema,
})
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
})
export type BulkChild = z.infer<typeof bulkChildSchema>

export const bulkOperationSchema = z.object({
  id: z.uuid(),
  operation: z.enum([
    "regular_hours",
    "special_hours",
    "more_hours",
    "attributes",
    "place_action",
  ]),
  input: bulkOperationInputSchema,
  status: z.enum(BULK_OPERATION_STATUSES),
  previewHash: z.string(),
  requestedBy: z.uuid(),
  approvedBy: z.uuid().nullable(),
  requiresSecondApprover: z.boolean(),
  canApprove: z.boolean(),
  approvalExpiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
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
      .omit({ children: true, input: true })
      .extend({ targetCount: z.number().int() })
  ),
})
