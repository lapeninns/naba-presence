import { z } from "zod"

import { apiFetch } from "./client"

export const verificationReasonSchema = z.object({
  code: z.string(),
  severity: z.enum(["warn", "fail"]),
  message: z.string(),
})
export type VerificationReason = z.infer<typeof verificationReasonSchema>

export const verificationSchema = z.object({
  id: z.string(),
  verdict: z.enum(["pass", "warn", "fail"]),
  reasons: z.array(verificationReasonSchema),
})
export type Verification = z.infer<typeof verificationSchema>

// The detail route exposes the latest verification of the review's latest
// draft (verdict + reasons) so the composer can show reasons on load without
// forcing a re-verify. No `id` — this is a read-only projection.
export const latestVerificationSchema = z.object({
  verdict: z.enum(["pass", "warn", "fail"]),
  reasons: z.array(verificationReasonSchema),
})
export type LatestVerification = z.infer<typeof latestVerificationSchema>

const capabilitiesSchema = z.object({
  canPublish: z.boolean(),
  canEdit: z.boolean(),
  canRequestApproval: z.boolean(),
})
export type ReviewCapabilities = z.infer<typeof capabilitiesSchema>

export const reviewRowSchema = z.object({
  id: z.string(),
  location: z.object({ id: z.string(), name: z.string() }),
  reviewer: z.object({
    displayName: z.string().nullable(),
    isAnonymous: z.boolean(),
    profilePhotoUrl: z.string().nullable(),
  }),
  rating: z.number().nullable(),
  text: z.string().nullable(),
  detectedLanguageCode: z.string().nullable(),
  languageConfidence: z.number().nullable(),
  createTime: z.string(),
  updateTime: z.string(),
  hasMedia: z.boolean(),
  workflowStatus: z.string(),
  draftId: z.string().nullable(),
  draftBody: z.string().nullable(),
  verificationStatus: z.string().nullable(),
  replyStatus: z.string().nullable(),
  googleReplyState: z.string().nullable(),
  googlePolicyViolation: z.string().nullable(),
  replyBody: z.string().nullable(),
  syncStatus: z.string().nullable(),
  capabilities: capabilitiesSchema,
})
export type ReviewRow = z.infer<typeof reviewRowSchema>

export const reviewsPageSchema = z.object({
  items: z.array(reviewRowSchema),
  nextCursor: z.string().nullable(),
})
export type ReviewsPage = z.infer<typeof reviewsPageSchema>

export const reviewDetailSchema = z.object({
  review: z.object({
    id: z.string(),
    reviewerDisplayName: z.string().nullable(),
    reviewerIsAnonymous: z.boolean(),
    reviewerProfilePhotoUrl: z.string().nullable(),
    rating: z.number().nullable(),
    text: z.string().nullable(),
    detectedLanguageCode: z.string().nullable(),
    languageConfidence: z.number().nullable(),
    createTime: z.string(),
    updateTime: z.string(),
    hasMedia: z.boolean(),
    workflowStatus: z.string(),
    locationId: z.string(),
    locationName: z.string(),
    timezone: z.string(),
    verified: z.boolean().nullable(),
    media: z.array(
      z.object({
        id: z.string(),
        thumbnailUrl: z.string().nullable(),
        thumbnailLabel: z.string().nullable(),
        videoUrl: z.string().nullable(),
      })
    ),
    drafts: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        body: z.string(),
        bodyBytes: z.number(),
        evidenceHash: z.string().nullable(),
        modelName: z.string().nullable(),
        verificationStatus: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    reply: z
      .object({
        id: z.string(),
        body: z.string().nullable(),
        publishStatus: z.string().nullable(),
        googleReplyState: z.string().nullable(),
        googlePolicyViolation: z.string().nullable(),
        googleReplyUpdatedAt: z.string().nullable(),
      })
      .nullable(),
    timeline: z.array(
      z.object({
        action: z.string(),
        createdAt: z.string(),
        actorName: z.string().nullable(),
        metadataSummary: z.string().nullable(),
      })
    ),
    capabilities: capabilitiesSchema,
    latestVerification: latestVerificationSchema.nullable(),
  }),
})
export type ReviewDetail = z.infer<typeof reviewDetailSchema>

export type ReviewsFilters = {
  locationId?: string
  ratings?: number[]
  statuses?: string[]
  replyState?: "replied" | "unreplied"
  verification?: string[]
  publishStatus?: string[]
  syncStatus?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  sort?: "updated_desc" | "updated_asc" | "rating_desc" | "rating_asc"
}

// Serialise camelCase filters to the backend's snake_case wire vocabulary.
function toWireParams(filters: ReviewsFilters, cursor: string | null) {
  const params = new URLSearchParams()
  const csv = (key: string, values?: (string | number)[]) => {
    if (values && values.length > 0) params.set(key, values.join(","))
  }
  if (filters.locationId) params.set("location_id", filters.locationId)
  csv("rating", filters.ratings)
  csv("status", filters.statuses)
  if (filters.replyState) params.set("reply_state", filters.replyState)
  csv("verification", filters.verification)
  csv("publish_status", filters.publishStatus)
  csv("sync_status", filters.syncStatus)
  if (filters.dateFrom) params.set("date_from", filters.dateFrom)
  if (filters.dateTo) params.set("date_to", filters.dateTo)
  if (filters.search) params.set("search", filters.search)
  if (filters.sort) params.set("sort", filters.sort)
  if (cursor) params.set("cursor", cursor)
  return params
}

export function fetchReviews(filters: ReviewsFilters, cursor: string | null) {
  const query = toWireParams(filters, cursor).toString()
  return apiFetch(query ? `/api/reviews?${query}` : "/api/reviews", {
    schema: reviewsPageSchema,
  })
}

export function fetchReviewDetail(id: string) {
  return apiFetch(`/api/reviews/${id}`, { schema: reviewDetailSchema })
}
