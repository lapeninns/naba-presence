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
export type PrivacyRequestCreateInput = z.infer<typeof privacyRequestCreateSchema>

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
export const privacyExportBodySchema = z.object({
  subject: z.string().trim().min(3).max(240),
})
export type PrivacyExportInput = z.infer<typeof privacyExportBodySchema>

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
export type PrivacyRequestsResponse = z.infer<typeof privacyRequestsResponseSchema>

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
