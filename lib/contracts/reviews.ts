// Reviews contract: the ONE declaration of the reviews vocabulary, the wire
// codec and the request/response schemas shared by `app/api/reviews/**`,
// `app/api/drafts/**` and `lib/api/*`.
//
// Client-safe by construction: no `server-only`, nothing from `lib/server`.
// Only vocabulary/type imports from `lib/domain` (no Node-only modules).

import { z } from "zod"

import type { VerificationReason as DomainVerificationReason } from "@/lib/domain/verification"
import {
  REVIEW_WORKFLOW_STATES,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Sort vocabulary. The record is the single source: the wire enum, the URL
 * parser, the `<Select>` items, the chip label and the server query all
 * derive from it, so adding a sort is one line here (plus the SQL ordering
 * in `lib/server/reviews-query.ts`, which is a `Record<ReviewSort, …>` and
 * therefore fails to typecheck until it is filled in).
 */
export const REVIEW_SORT_LABELS = {
  updated_desc: "Most recent",
  updated_asc: "Oldest first",
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
} as const satisfies Record<string, string>

export type ReviewSort = keyof typeof REVIEW_SORT_LABELS
export const REVIEW_SORTS = Object.keys(REVIEW_SORT_LABELS) as [
  ReviewSort,
  ...ReviewSort[],
]
export const DEFAULT_REVIEW_SORT = "updated_desc" satisfies ReviewSort
export const reviewSortSchema = z.enum(REVIEW_SORTS)

/** Sorts whose cursor must carry the boundary row's rating. */
export function isRatingSort(sort: string | null | undefined): boolean {
  return sort === "rating_desc" || sort === "rating_asc"
}

export { REVIEW_WORKFLOW_STATES, type ReviewWorkflowState }
export const reviewWorkflowStateSchema = z.enum(REVIEW_WORKFLOW_STATES)

export const REVIEW_REPLY_STATES = ["replied", "unreplied"] as const
export type ReviewReplyState = (typeof REVIEW_REPLY_STATES)[number]
export const reviewReplyStateSchema = z.enum(REVIEW_REPLY_STATES)

/** `draft.verification_status` filter vocabulary (`pending` = no result yet). */
export const REVIEW_VERIFICATION_STATUSES = [
  "pass",
  "warn",
  "fail",
  "pending",
] as const
export type ReviewVerificationStatus =
  (typeof REVIEW_VERIFICATION_STATUSES)[number]
export const reviewVerificationStatusSchema = z.enum(
  REVIEW_VERIFICATION_STATUSES
)

/**
 * `review_reply.publish_status` CHECK constraint vocabulary (mirrors
 * `ReplyPublishStatus` in lib/server/publishing/types.ts, which cannot be
 * imported here).
 */
export const REVIEW_PUBLISH_STATUSES = [
  "not_published",
  "awaiting_approval",
  "accepted",
  "published",
  "rejected",
  "failed",
  "deleted",
] as const
export type ReviewPublishStatus = (typeof REVIEW_PUBLISH_STATUSES)[number]
export const reviewPublishStatusSchema = z.enum(REVIEW_PUBLISH_STATUSES)

/** `sync_checkpoint.status` vocabulary. */
export const REVIEW_SYNC_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type ReviewSyncStatus = (typeof REVIEW_SYNC_STATUSES)[number]
export const reviewSyncStatusSchema = z.enum(REVIEW_SYNC_STATUSES)

export const VERIFICATION_VERDICTS = ["pass", "warn", "fail"] as const
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number]

function includes<const T extends readonly string[]>(
  values: T
): (value: string) => value is T[number] {
  return (value): value is T[number] =>
    (values as readonly string[]).includes(value)
}
export const isReviewSort = includes(REVIEW_SORTS)
export const isReviewWorkflowState = includes(REVIEW_WORKFLOW_STATES)
export const isReviewReplyState = includes(REVIEW_REPLY_STATES)
export const isReviewVerificationStatus = includes(REVIEW_VERIFICATION_STATUSES)
export const isReviewPublishStatus = includes(REVIEW_PUBLISH_STATUSES)
export const isReviewSyncStatus = includes(REVIEW_SYNC_STATUSES)

// ---------------------------------------------------------------------------
// Capabilities / verification
// ---------------------------------------------------------------------------

// The rule itself lives in lib/server/capabilities.ts; this is the shape it
// projects onto every list row and detail response.
export const reviewCapabilitiesSchema = z.object({
  canPublish: z.boolean(),
  canEdit: z.boolean(),
  canRequestApproval: z.boolean(),
})
export type ReviewCapabilities = z.infer<typeof reviewCapabilitiesSchema>

export const verificationReasonSchema = z.object({
  code: z.string(),
  severity: z.enum(["warn", "fail"]),
  message: z.string(),
}) satisfies z.ZodType<DomainVerificationReason>
export type VerificationReason = DomainVerificationReason

export const verificationSchema = z.object({
  id: z.string(),
  verdict: z.enum(VERIFICATION_VERDICTS),
  reasons: z.array(verificationReasonSchema),
})
export type Verification = z.infer<typeof verificationSchema>

// The detail route exposes the latest verification of the review's latest
// draft (verdict + reasons) so the composer can show reasons on load without
// forcing a re-verify. No `id` — this is a read-only projection.
export const latestVerificationSchema = verificationSchema.omit({ id: true })
export type LatestVerification = z.infer<typeof latestVerificationSchema>

// ---------------------------------------------------------------------------
// GET /api/reviews — filters, wire codec, cursor codec
// ---------------------------------------------------------------------------

export const reviewsCursorSchema = z.object({
  updateTime: z.iso.datetime(),
  id: z.uuid(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
})
export type ReviewsCursor = z.infer<typeof reviewsCursorSchema>

/**
 * Decoded (server-side) query. `replyState` arrives as a comma list on the
 * wire; exactly one value filters, anything else means "no reply filter".
 */
export const reviewsQuerySchema = z.object({
  locationId: z.uuid().optional(),
  ratings: z.array(z.number().int().min(1).max(5)).optional(),
  statuses: z.array(reviewWorkflowStateSchema).optional(),
  replyState: z
    .array(reviewReplyStateSchema)
    .optional()
    .transform((values) => (values?.length === 1 ? values[0] : undefined)),
  verification: z.array(reviewVerificationStatusSchema).optional(),
  publishStatus: z.array(reviewPublishStatusSchema).optional(),
  syncStatus: z.array(reviewSyncStatusSchema).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  search: z.string().trim().max(200).optional(),
  sort: reviewSortSchema.default(DEFAULT_REVIEW_SORT),
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: reviewsCursorSchema.optional(),
})
type ReviewsQueryOutput = z.output<typeof reviewsQuerySchema>
// The transform above makes `replyState` a required-but-maybe-undefined key;
// callers build queries by hand (tests, server code), so keep it optional.
export type ReviewsQuery = Omit<ReviewsQueryOutput, "replyState"> & {
  replyState?: ReviewsQueryOutput["replyState"]
}

/** The inbox filter set the client builds and `encodeReviewsQuery` serialises. */
export type ReviewsFilters = Partial<
  Pick<
    ReviewsQuery,
    | "locationId"
    | "ratings"
    | "statuses"
    | "replyState"
    | "verification"
    | "publishStatus"
    | "syncStatus"
    | "dateFrom"
    | "dateTo"
    | "search"
    | "sort"
  >
>

// Wire param names (snake_case). Declared once so encode and decode cannot
// drift; tests/integration/routes and tests/e2e depend on these names.
const WIRE = {
  locationId: "location_id",
  ratings: "rating",
  statuses: "status",
  replyState: "reply_state",
  verification: "verification",
  publishStatus: "publish_status",
  syncStatus: "sync_status",
  dateFrom: "date_from",
  dateTo: "date_to",
  search: "search",
  sort: "sort",
  pageSize: "page_size",
  cursor: "cursor",
} as const

// base64url(JSON) without Node's Buffer so the module stays client-safe. The
// output is byte-identical to `Buffer.from(json).toString("base64url")`.
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  )
}

export function encodeReviewsCursor(cursor: ReviewsCursor): string {
  return toBase64Url(
    JSON.stringify({
      updateTime: cursor.updateTime,
      id: cursor.id,
      rating: cursor.rating,
    })
  )
}

/** Opaque → JSON value; `undefined` when absent or not decodable. */
export function decodeReviewsCursor(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(fromBase64Url(value))
  } catch {
    return undefined
  }
}

/** Thrown by `decodeReviewsQuery`; the route maps it to 400 `invalid_cursor`. */
export class InvalidReviewsCursorError extends Error {
  constructor() {
    super("Rating cursors must include a rating.")
    this.name = "InvalidReviewsCursorError"
  }
}

function csv(values: readonly (string | number)[] | undefined): string | null {
  return values && values.length > 0 ? values.join(",") : null
}

export function encodeReviewsQuery(
  filters: ReviewsFilters & { cursor?: string | null; pageSize?: number }
): URLSearchParams {
  const params = new URLSearchParams()
  const set = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value))
    }
  }
  set(WIRE.locationId, filters.locationId)
  set(WIRE.ratings, csv(filters.ratings))
  set(WIRE.statuses, csv(filters.statuses))
  set(WIRE.replyState, filters.replyState)
  set(WIRE.verification, csv(filters.verification))
  set(WIRE.publishStatus, csv(filters.publishStatus))
  set(WIRE.syncStatus, csv(filters.syncStatus))
  set(WIRE.dateFrom, filters.dateFrom)
  set(WIRE.dateTo, filters.dateTo)
  set(WIRE.search, filters.search)
  set(WIRE.sort, filters.sort)
  set(WIRE.pageSize, filters.pageSize)
  set(WIRE.cursor, filters.cursor)
  return params
}

function commaNumbers(value: string | null): number[] | undefined {
  return value
    ? value
        .split(",")
        .map(Number)
        .filter((number) => Number.isInteger(number))
    : undefined
}

function commaStrings(value: string | null): string[] | undefined {
  return value?.split(",").filter(Boolean)
}

/**
 * Inverse of `encodeReviewsQuery`. Throws `InvalidReviewsCursorError` when a
 * rating sort carries a cursor without a rating; any other malformed input
 * surfaces as a ZodError from `reviewsQuerySchema`.
 */
export function decodeReviewsQuery(params: URLSearchParams): ReviewsQuery {
  const sort = params.get(WIRE.sort)
  const rawCursor = params.get(WIRE.cursor)
  const cursor = decodeReviewsCursor(rawCursor)
  if (
    rawCursor &&
    isRatingSort(sort) &&
    (typeof cursor !== "object" ||
      cursor === null ||
      !Object.hasOwn(cursor, "rating") ||
      (typeof (cursor as { rating?: unknown }).rating !== "number" &&
        (cursor as { rating?: unknown }).rating !== null))
  ) {
    throw new InvalidReviewsCursorError()
  }
  const pageSize = params.get(WIRE.pageSize)
  return reviewsQuerySchema.parse({
    locationId: params.get(WIRE.locationId) ?? undefined,
    ratings: commaNumbers(params.get(WIRE.ratings)),
    statuses: commaStrings(params.get(WIRE.statuses)),
    replyState: commaStrings(params.get(WIRE.replyState)),
    verification: commaStrings(params.get(WIRE.verification)),
    publishStatus: commaStrings(params.get(WIRE.publishStatus)),
    syncStatus: commaStrings(params.get(WIRE.syncStatus)),
    dateFrom: params.get(WIRE.dateFrom) ?? undefined,
    dateTo: params.get(WIRE.dateTo) ?? undefined,
    search: params.get(WIRE.search) ?? undefined,
    sort: sort ?? undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    cursor,
  })
}

// ---------------------------------------------------------------------------
// Responses: list, detail, counts
// ---------------------------------------------------------------------------

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
  capabilities: reviewCapabilitiesSchema,
})
export type ReviewRow = z.infer<typeof reviewRowSchema>

export const reviewsPageSchema = z.object({
  items: z.array(reviewRowSchema),
  nextCursor: z.string().nullable(),
})
export type ReviewsPage = z.infer<typeof reviewsPageSchema>

export const reviewIdParamsSchema = z.object({ id: z.uuid() })

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
    capabilities: reviewCapabilitiesSchema,
    latestVerification: latestVerificationSchema.nullable(),
  }),
})
export type ReviewDetail = z.infer<typeof reviewDetailSchema>

export const reviewCountsQuerySchema = z.object({
  locationId: z.uuid().optional(),
})

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
})
export type ReviewCounts = z.infer<typeof reviewCountsSchema>

// ---------------------------------------------------------------------------
// Drafts, verify, publish, reply delete, approval
// ---------------------------------------------------------------------------

export const DRAFT_TONES = [
  "warm_professional",
  "concise",
  "empathetic",
] as const
export type DraftTone = (typeof DRAFT_TONES)[number]

// One endpoint is Generate / Regenerate / Save.
// Omit `body` → the server generates (AI) or templates (rating-only) — only
// when the operator clicks Generate. Include `body` → human edit / save.
export const draftInputSchema = z.object({
  tone: z.enum(DRAFT_TONES).default("warm_professional"),
  languageOverride: z.string().trim().min(2).max(12).nullable().default(null),
  businessContext: z.string().trim().max(2000).nullable().default(null),
  body: z.string().trim().min(1).max(4096).optional(),
})
export type DraftInput = z.input<typeof draftInputSchema>

export const draftResultSchema = z.object({
  draftId: z.string(),
  body: z.string(),
  bodyBytes: z.number(),
  evidenceHash: z.string().nullable(),
  verification: verificationSchema,
})
export type DraftResult = z.infer<typeof draftResultSchema>

export const verifyResultSchema = z.object({ verification: verificationSchema })
export type VerifyResult = z.infer<typeof verifyResultSchema>

export const publishInputSchema = z.object({
  draftId: z.uuid(),
  expectedReviewUpdateTime: z.string().min(1),
})
export type PublishInput = z.infer<typeof publishInputSchema>

export const publishResultSchema = z.object({
  reviewReplyId: z.string(),
  publishAttemptId: z.string(),
  status: z.string(),
  googleReplyState: z.string().nullable(),
  idempotent: z.boolean().optional(),
})
export type PublishResult = z.infer<typeof publishResultSchema>

export const deleteReplyResultSchema = z.object({
  status: z.string(),
  // executeReplyDelete returns attemptId: string | null (a "cancelled" outcome
  // can omit it), so this is nullable.
  publishAttemptId: z.string().nullable(),
})
export type DeleteReplyResult = z.infer<typeof deleteReplyResultSchema>

export const approvalInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
})
export type ApprovalInput = z.infer<typeof approvalInputSchema>

// The reject and approve responses differ in shape; validate the union of the
// fields either can carry (status is always present).
export const approvalResultSchema = z.object({
  status: z.string(),
  googleReplyState: z.string().nullable().optional(),
  publishAttemptId: z.string().optional(),
  reviewReplyId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type ApprovalResult = z.infer<typeof approvalResultSchema>
