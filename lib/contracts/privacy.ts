/**
 * Wire contract for `/api/privacy/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * bodies with the request schemas and shape replies with the response ones.
 *
 * The routes are now the only consumer. The browser-side wrapper this file
 * used to name went with the compliance console; data-subject requests are
 * served over the API, owner/admin-gated as they always were.
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

/** PATCH `/api/privacy/requests` body, fulfil branch. */
export const privacyRequestFulfilSchema = z.object({
  id: z.uuid(),
  action: z.literal("fulfil"),
  resolutionNote: resolutionNoteSchema,
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

/** PATCH `/api/privacy/requests` response. */
export const privacyRequestResolutionResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    requestType: privacyRequestTypeSchema,
    status: z.string(),
    subjectReference: z.string(),
    resolutionNote: z.string().nullable(),
    resolvedAt: z.string().nullable(),
  }),
})
export type PrivacyRequestResolutionResponse = z.infer<
  typeof privacyRequestResolutionResponseSchema
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
