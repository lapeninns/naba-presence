/**
 * Wire contract for `/api/privacy/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * bodies with the request schemas and shape replies with the response ones.
 *
 * The browser-side wrappers live in `lib/api/privacy.ts`, used by the Data
 * and privacy settings area (plan P04-7); the routes stay owner/admin-gated
 * as they always were.
 */
import { z } from "zod"

import {
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestType,
} from "@/lib/settings/forms/privacy-request"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export { PRIVACY_REQUEST_TYPES }
export type { PrivacyRequestType }
export const privacyRequestTypeSchema = z.enum(PRIVACY_REQUEST_TYPES)

export const PRIVACY_REQUEST_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "rejected",
] as const
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number]
export const privacyRequestStatusSchema = z.enum(PRIVACY_REQUEST_STATUSES)

const resolutionNoteSchema = z.string().trim().min(3).max(2000)

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/privacy/requests` body. */
export const privacyRequestCreateSchema = z.object({
  requestType: privacyRequestTypeSchema,
  subjectReference: z.string().trim().min(3).max(240),
  reason: z.string().trim().max(2000).optional(),
})
export type PrivacyRequestCreateInput = z.infer<
  typeof privacyRequestCreateSchema
>

/** PATCH `/api/privacy/requests` body, status-change branch. */
export const privacyRequestStatusUpdateSchema = z.object({
  id: z.uuid(),
  status: privacyRequestStatusSchema,
  resolutionNote: resolutionNoteSchema,
})

/**
 * PATCH `/api/privacy/requests` body, fulfil branch. An erasure that matches
 * any review needs `confirmation`: the token from
 * GET `/api/privacy/requests/[id]/preview` for the match set the owner saw.
 */
export const privacyRequestFulfilSchema = z.object({
  id: z.uuid(),
  action: z.literal("fulfil"),
  resolutionNote: resolutionNoteSchema,
  confirmation: z.string().min(1).max(128).optional(),
})

/** PATCH `/api/privacy/requests` body. */
export const privacyRequestUpdateSchema = z.union([
  privacyRequestFulfilSchema,
  privacyRequestStatusUpdateSchema,
])
export type UpdatePrivacyInput = z.infer<typeof privacyRequestUpdateSchema>

/**
 * POST `/api/privacy/export` body. The subject travels in the body (never
 * the URL) so it never lands in browser history, proxy logs or referrers.
 */
export const PRIVACY_EXPORT_PAGE_SIZE_DEFAULT = 500
export const PRIVACY_EXPORT_PAGE_SIZE_MAX = 1000

export const privacyExportBodySchema = z.object({
  subject: z.string().trim().min(3).max(240),
  /** `nextCursor` from the previous page; absent for the first page. */
  cursor: z.string().min(1).max(1024).optional(),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(PRIVACY_EXPORT_PAGE_SIZE_MAX)
    .default(PRIVACY_EXPORT_PAGE_SIZE_DEFAULT),
})
export type PrivacyExportInput = z.input<typeof privacyExportBodySchema>

/**
 * Decoded export cursor payload: the keyset position (`create_time desc, id
 * desc`, both immutable) of the last review on the previous page, the index
 * of the page it opens, and when the export's first page was served. The
 * route seals it with an HMAC bound to the organisation and subject
 * (`sealCursor`), so it cannot be edited or replayed against another subject
 * and carries nothing about the subject itself. The cursor lives only in the
 * client's hands; nothing about an export in progress is stored server-side.
 */
export const privacyExportCursorSchema = z.object({
  v: z.literal(2),
  page: z.number().int().min(2),
  startedAt: z.iso.datetime({ offset: true }),
  createTime: z.iso.datetime({ offset: true }),
  id: z.uuid(),
})
export type PrivacyExportCursor = z.infer<typeof privacyExportCursorSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Background withdrawal state of an erasure (plan P04-5). `nextAttemptAt`
 * null on an open request means no automatic retry is coming; with replies
 * still pending that is `withdrawalStalled`, and a person has to act.
 */
const withdrawalRetryFields = {
  withdrawalAttempts: z.number().int().min(0).optional(),
  nextAttemptAt: z.string().nullable().optional(),
  lastErrorCode: z.string().nullable().optional(),
}

export const privacyRequestSchema = z.object({
  id: z.string(),
  requestType: privacyRequestTypeSchema,
  status: z.string(),
  subjectReference: z.string(),
  reason: z.string().nullable(),
  requestedBy: z.string(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  dueAt: z.string().optional(),
  overdue: z.boolean().optional(),
  withdrawalStalled: z.boolean().optional(),
  ...withdrawalRetryFields,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>

/** GET `/api/privacy/requests` response. */
export const privacyRequestsResponseSchema = z.object({
  requests: z.array(privacyRequestSchema),
})
export type PrivacyRequestsResponse = z.infer<
  typeof privacyRequestsResponseSchema
>

/** POST `/api/privacy/requests` response (201). */
export const privacyRequestCreatedResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: privacyRequestTypeSchema,
    status: z.string(),
    subjectReference: z.string(),
    createdAt: z.string(),
  }),
})
export type PrivacyRequestCreatedResponse = z.infer<
  typeof privacyRequestCreatedResponseSchema
>

const privacyRequestResolutionSchema = z.object({
  id: z.string(),
  requestType: privacyRequestTypeSchema,
  status: z.string(),
  subjectReference: z.string(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  ...withdrawalRetryFields,
})

/** PATCH `/api/privacy/requests` response. */
export const privacyRequestResolutionResponseSchema = z.object({
  request: privacyRequestResolutionSchema,
})
export type PrivacyRequestResolutionResponse = z.infer<
  typeof privacyRequestResolutionResponseSchema
>

/**
 * PATCH `/api/privacy/requests` 409 when an erasure's local scrub committed
 * but some replies are still live at Google. The request stays
 * `in_progress` and the job tick retries the withdrawal on its own.
 */
export const privacyReplyWithdrawFailedResponseSchema = z.object({
  error: z.literal("privacy_reply_withdraw_failed"),
  message: z.string(),
  pending: z.array(z.object({ reviewId: z.string(), code: z.string() })),
  request: privacyRequestResolutionSchema,
})
export type PrivacyReplyWithdrawFailedResponse = z.infer<
  typeof privacyReplyWithdrawFailedResponseSchema
>

/**
 * What fulfilling a request would touch (GET
 * `/api/privacy/requests/[id]/preview`). `matchedByNameOnly` and `reviewers`
 * show when a display name matches more than one person; `confirmation`
 * goes back on the erasure's fulfil.
 */
export const privacyErasurePreviewSchema = z.object({
  reviews: z.number().int().min(0),
  reviewers: z.number().int().min(0),
  matchedByNameOnly: z.number().int().min(0),
  locations: z.number().int().min(0),
  repliesToWithdraw: z.number().int().min(0),
  heldReviews: z.number().int().min(0),
  confirmation: z.string(),
})
export type PrivacyErasurePreview = z.infer<typeof privacyErasurePreviewSchema>

export const privacyErasurePreviewResponseSchema = z.object({
  preview: privacyErasurePreviewSchema,
})
export type PrivacyErasurePreviewResponse = z.infer<
  typeof privacyErasurePreviewResponseSchema
>

/**
 * PATCH `/api/privacy/requests` 409 when an erasure's fulfil carries no
 * confirmation, or one for a different match set than the reviews it
 * matches now. Nothing was erased; `preview` is the current match set.
 */
export const privacyErasureUnconfirmedResponseSchema = z.object({
  error: z.literal("privacy_erasure_unconfirmed"),
  message: z.string(),
  preview: privacyErasurePreviewSchema,
})
export type PrivacyErasureUnconfirmedResponse = z.infer<
  typeof privacyErasureUnconfirmedResponseSchema
>

/**
 * POST `/api/privacy/export` response: one page of the subject's reviews.
 * `totalMatched` counts the whole match set on every page. `nextCursor` is
 * null on the last page; the export is complete only when `complete` is true
 * there. A last page with `addedDuringExport` above 0 found matching reviews
 * first stored after page 1 was served that sort ahead of it, which earlier
 * pages may not have carried: restart from page 1 for a complete set.
 * `truncated` mirrors `nextCursor !== null` for clients written before pages
 * existed.
 */
export const privacyExportResponseSchema = z.object({
  generatedAt: z.string(),
  organisationId: z.string(),
  subjectReference: z.string(),
  note: z.string(),
  page: z.number().int().min(1),
  pageSize: z.number().int(),
  totalMatched: z.number().int(),
  returned: z.number().int(),
  truncated: z.boolean(),
  complete: z.boolean(),
  addedDuringExport: z.number().int(),
  nextCursor: z.string().nullable(),
  reviews: z.array(z.record(z.string(), z.unknown())),
})
export type PrivacyExportResponse = z.infer<typeof privacyExportResponseSchema>

// ---------------------------------------------------------------------------
// Retention status
// ---------------------------------------------------------------------------

/**
 * This organisation's place in one retention cycle (retention_cycle_org).
 * Null on a cycle that has not reached the organisation (or never will: one
 * enumerated before the organisation existed).
 */
export const retentionCycleOrganisationSchema = z.object({
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number().int().min(0),
  lastErrorCode: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type RetentionCycleOrganisation = z.infer<
  typeof retentionCycleOrganisationSchema
>

export const retentionCycleSummarySchema = z.object({
  cycleDate: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  organisation: retentionCycleOrganisationSchema.nullable(),
})
export type RetentionCycleSummary = z.infer<typeof retentionCycleSummarySchema>

/**
 * GET `/api/privacy/retention-status` response. Only this organisation's
 * standing is reported: the cycle's fleet-wide counts never leave the
 * operator surfaces.
 */
export const retentionStatusResponseSchema = z.object({
  /** The most recent cycle that finished, or null before the first one. */
  lastCompletedCycle: retentionCycleSummarySchema.nullable(),
  /** The cycle being worked through now, if one is open. */
  currentCycle: retentionCycleSummarySchema.nullable(),
  /** Reviews under an unreleased legal hold. */
  heldReviews: z.number().int().min(0),
  /**
   * Disconnected locations past their seven-day purge kept because a review
   * of theirs is held.
   */
  heldLocations: z.number().int().min(0),
  rawContentRetentionDays: z.number().int(),
  /** False while RETENTION_DELETES_ENABLED is off: redaction still runs. */
  deletesEnabled: z.boolean(),
})
export type RetentionStatusResponse = z.infer<
  typeof retentionStatusResponseSchema
>
