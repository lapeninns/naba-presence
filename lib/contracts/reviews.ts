// Reviews contract: the ONE declaration of the reviews vocabulary, the wire
// codec and the request/response schemas shared by `app/api/reviews/**`,
// `app/api/drafts/**` and `lib/api/*`.
//
// Client-safe by construction: no `server-only`, nothing from `lib/server`.
// Only vocabulary/type imports from `lib/domain` (no Node-only modules).

import { z } from "zod"

import { fromBase64Url, toBase64Url } from "@/lib/contracts/cursor"
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

/**
 * Inbox queues. A queue is not a list of workflow states — "awaiting my
 * approval" also depends on who requested the approval and who may publish —
 * so membership is decided server-side by lib/server/review-queues.ts and the
 * browser only ever names the queue.
 */
export const REVIEW_QUEUES = [
  "needs_reply",
  // The aggregate the Inbox's five queue controls present as "Approval": every
  // reply parked at `awaiting_approval`, whoever it is waiting on. It is a
  // presentation union, not a new record state — `awaiting_my_approval` and
  // `awaiting_others` partition it and keep their own, narrower scopes, so
  // every existing deep link still means exactly what it always meant.
  "approval",
  "awaiting_my_approval",
  "awaiting_others",
  "publishing",
  "failed",
  "done",
  "all",
] as const
export type ReviewQueue = (typeof REVIEW_QUEUES)[number]
export const reviewQueueSchema = z.enum(REVIEW_QUEUES)
export const DEFAULT_REVIEW_QUEUE = "needs_reply" satisfies ReviewQueue

export const REVIEW_QUEUE_LABELS: Record<ReviewQueue, string> = {
  needs_reply: "Needs reply",
  approval: "Approval",
  awaiting_my_approval: "Awaiting my approval",
  awaiting_others: "Awaiting others",
  publishing: "Publishing",
  failed: "Failed",
  done: "Done",
  all: "All reviews",
}

export { REVIEW_WORKFLOW_STATES, type ReviewWorkflowState }
export const reviewWorkflowStateSchema = z.enum(REVIEW_WORKFLOW_STATES)

export const REVIEW_REPLY_STATES = ["replied", "unreplied"] as const
export type ReviewReplyState = (typeof REVIEW_REPLY_STATES)[number]
export const reviewReplyStateSchema = z.enum(REVIEW_REPLY_STATES)

/**
 * `verification_result.verdict`. `pending` is the fourth member: a draft whose
 * semantic pass was attempted and could not be reached is saved but NOT
 * verified, and saying so is the only honest answer — a `pass` there would
 * assert a check that never ran. It matches the `pending` that
 * `draft.verification_status` has always had.
 */
export const VERIFICATION_VERDICTS = [
  "pass",
  "warn",
  "fail",
  "pending",
] as const
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

/**
 * Who a parked reply is waiting on, worked out on the server by the same
 * `awaiting_my_approval` rule as the Inbox queue (lib/server/review-queues.ts):
 * `"me"` when this person may decide it, `"others"` when it waits on someone
 * else (under two-person approval, the person who asked can never decide).
 */
export const REVIEW_APPROVAL_SCOPES = ["me", "others"] as const
export type ReviewApprovalScope = (typeof REVIEW_APPROVAL_SCOPES)[number]

/**
 * The detail's capabilities: the row's three flags plus the approval policy
 * as it applies to this person and this review (plan D1). The extra fields
 * are optional so an older server or a stubbed response still parses, and
 * the client then falls back to its old reading.
 */
export const reviewDetailCapabilitiesSchema = reviewCapabilitiesSchema.extend({
  /**
   * The organisation's two-person rule. With it on, a publisher's "publish"
   * is parked until a second person approves it, so the action is "Submit
   * for approval" rather than "Publish reply".
   */
  requireTwoPersonApproval: z.boolean().optional(),
  /** While the review is `awaiting_approval`; null otherwise. */
  approvalScope: z.enum(REVIEW_APPROVAL_SCOPES).nullable().optional(),
  /**
   * Whether this person may approve the parked reply. Under two-person
   * approval the draft's author may reject it (scope "me") but not approve
   * it. False when nothing is parked; absent from an older server, where the
   * client falls back to the scope.
   */
  canApprove: z.boolean().optional(),
})
export type ReviewDetailCapabilities = z.infer<
  typeof reviewDetailCapabilitiesSchema
>

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
export const REVIEW_WRITTEN = ["with_text", "rating_only"] as const
export const reviewWrittenSchema = z.enum(REVIEW_WRITTEN)
export type ReviewWritten = z.infer<typeof reviewWrittenSchema>
export function isReviewWritten(value: unknown): value is ReviewWritten {
  return (REVIEW_WRITTEN as readonly unknown[]).includes(value)
}

export const reviewsQuerySchema = z.object({
  /**
   * Kept alongside `locationIds` because Home's attention list and every
   * bookmark in the wild link with a single `location_id`. `decodeReviewsQuery`
   * folds it into `locationIds`, so the server only ever reads the array.
   */
  locationId: z.uuid().optional(),
  locationIds: z.array(z.uuid()).max(200).optional(),
  clientId: z.uuid().optional(),
  queue: reviewQueueSchema.optional(),
  /** "me" and "unassigned" are resolved server-side against the session. */
  assignee: z
    .union([z.literal("me"), z.literal("unassigned"), z.uuid()])
    .optional(),
  ratings: z.array(z.number().int().min(1).max(5)).optional(),
  /**
   * Whether the reviewer wrote anything. `rating_only` is the stars-and-
   * nothing-else review — the bulk of most venues' backlog, and the set the
   * template batch works through.
   */
  written: reviewWrittenSchema.optional(),
  statuses: z.array(reviewWorkflowStateSchema).optional(),
  replyState: z
    .array(reviewReplyStateSchema)
    .optional()
    .transform((values) => (values?.length === 1 ? values[0] : undefined)),
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
    | "locationIds"
    | "clientId"
    | "queue"
    | "assignee"
    | "ratings"
    | "written"
    | "statuses"
    | "replyState"
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
  clientId: "client_id",
  queue: "queue",
  assignee: "assignee",
  ratings: "rating",
  written: "written",
  statuses: "status",
  replyState: "reply_state",
  dateFrom: "date_from",
  dateTo: "date_to",
  search: "search",
  sort: "sort",
  pageSize: "page_size",
  cursor: "cursor",
} as const

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
  // One param carries both shapes: a single id stays `location_id=<uuid>`,
  // several become a comma list, so old links keep working unchanged.
  set(WIRE.locationId, csv(filters.locationIds) ?? filters.locationId ?? null)
  set(WIRE.clientId, filters.clientId)
  set(WIRE.queue, filters.queue)
  set(WIRE.assignee, filters.assignee)
  set(WIRE.ratings, csv(filters.ratings))
  set(WIRE.written, filters.written)
  set(WIRE.statuses, csv(filters.statuses))
  set(WIRE.replyState, filters.replyState)
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
  const locationIds = commaStrings(params.get(WIRE.locationId))
  return reviewsQuerySchema.parse({
    locationIds: locationIds?.length ? locationIds : undefined,
    clientId: params.get(WIRE.clientId) ?? undefined,
    queue: params.get(WIRE.queue) ?? undefined,
    assignee: params.get(WIRE.assignee) ?? undefined,
    ratings: commaNumbers(params.get(WIRE.ratings)),
    written: params.get(WIRE.written) ?? undefined,
    statuses: commaStrings(params.get(WIRE.statuses)),
    replyState: commaStrings(params.get(WIRE.replyState)),
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
  // The client rides on every row: in an agency inbox a location name alone
  // does not say whose business a review belongs to, and replying in the wrong
  // voice is the mistake the rail and this line exist to prevent.
  location: z.object({
    id: z.string(),
    name: z.string(),
    clientId: z.string().nullable(),
    clientName: z.string().nullable(),
  }),
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
  // While the reply awaits approval, the draft an approval would publish (the
  // parked one; see `pendingDraft` on the detail). Null otherwise. Optional so
  // older servers and stubs still parse.
  pendingDraftId: z.string().nullable().optional(),
  // While the reply awaits approval, the two-person part of "may this person
  // approve it": false for the person who asked and for the parked draft's
  // author when the organisation requires two people. It says nothing about
  // publish rights, so combine it with `capabilities.canPublish` (the detail's
  // `canApprove` folds that in). Null when nothing is parked; absent from
  // older servers, where the client assumes yes.
  canApprove: z.boolean().nullable().optional(),
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
        /** The newest publish attempt's provider error code, if any. */
        lastErrorCode: z.string().nullable().optional(),
      })
      .nullable(),
    /**
     * While the review is `awaiting_approval`: the draft an approval would
     * publish (the parked one), which need not be the newest in `drafts`.
     * Approve names this id and the pane shows this text. Null otherwise;
     * optional so an older server still parses.
     */
    pendingDraft: z
      .object({ id: z.string(), body: z.string() })
      .nullable()
      .optional(),
    timeline: z.array(
      z.object({
        action: z.string(),
        createdAt: z.string(),
        actorName: z.string().nullable(),
        metadataSummary: z.string().nullable(),
      })
    ),
    capabilities: reviewDetailCapabilitiesSchema,
    latestVerification: latestVerificationSchema.nullable(),
    /**
     * The approver's rejection, while the reply it returned to draft is still
     * a draft: the note the reject dialog asks for, and who wrote it. Null
     * once the reply is resubmitted, approved or published. Optional so an
     * older server (or a stubbed response) still parses.
     */
    lastRejection: z
      .object({
        note: z.string().nullable(),
        decidedByName: z.string().nullable(),
        decidedAt: z.string(),
      })
      .nullable()
      .optional(),
    /**
     * Google's `reviewReplyUrl`: where the review can be answered on Google
     * itself. Read from the stored payload, so it is null once retention has
     * cleared that. Optional so an older server still parses.
     */
    googleReplyUrl: z.string().nullable().optional(),
  }),
})
export type ReviewDetail = z.infer<typeof reviewDetailSchema>

export const reviewCountsQuerySchema = z.object({
  locationId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  /** `client` adds the per-client `groups` array to the response. */
  groupBy: z.literal("client").optional(),
})

export const reviewCountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  /**
   * What the inbox rail actually renders. Computed from the SAME predicates
   * the list query uses (lib/server/review-queues.ts), so a badge can never
   * promise rows the queue does not contain.
   */
  byQueue: z.record(reviewQueueSchema, z.number()),
  /**
   * Replies parked for approval that this person could approve: the
   * `awaiting_my_approval` queue without, under two-person approval, the
   * ones whose parked draft they wrote (the route would refuse them). What
   * the Inbox badge and title count; absent from a server that predates it.
   */
  approvableByMe: z.number().optional(),
  /** Per-client breakdown, present only when the caller asks to group. */
  groups: z
    .array(
      z.object({
        clientId: z.string().nullable(),
        clientName: z.string(),
        byQueue: z.record(reviewQueueSchema, z.number()),
      })
    )
    .optional(),
})
export type ReviewCounts = z.infer<typeof reviewCountsSchema>

// ---------------------------------------------------------------------------
// Bulk triage
// ---------------------------------------------------------------------------

export const BULK_REVIEW_ACTIONS = [
  "approve",
  "assign",
  "mark_reviewed",
  "mark_unreviewed",
  "template_reply",
] as const
export type BulkReviewAction = (typeof BULK_REVIEW_ACTIONS)[number]

/**
 * One approval as the operator saw it: the draft on screen and the review's
 * update time when it was shown. The server refuses the row (409) when either
 * moved, so a bulk approve can never publish text nobody in the batch read,
 * or answer a review that was edited after the reply was written.
 */
export const bulkApprovalItemSchema = z.object({
  reviewId: z.uuid(),
  draftId: z.uuid(),
  reviewUpdateTime: z.iso.datetime({ offset: true }),
})
export type BulkApprovalItem = z.infer<typeof bulkApprovalItemSchema>

const bulkReviewIdsSchema = z.array(z.uuid()).min(1).max(100)

export const bulkReviewActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    approvals: z
      .array(bulkApprovalItemSchema)
      .min(1)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.reviewId)).size === items.length,
        { message: "Each review can be approved once per batch" }
      ),
  }),
  z.object({
    action: z.literal("assign"),
    reviewIds: bulkReviewIdsSchema,
    /** null clears the assignee. */
    assigneeId: z.uuid({ error: "Choose who to assign these to" }).nullable(),
  }),
  z.object({
    action: z.literal("mark_reviewed"),
    reviewIds: bulkReviewIdsSchema,
  }),
  /**
   * Puts reviews marked "no reply needed" back in Needs reply: the Undo
   * behind that action's toast. Clears the same two columns and nothing else.
   * Each review comes with the mark the press made (`triagedAt`, from its
   * `mark_reviewed` row), and a row is cleared only while that exact mark is
   * still on it, so an Undo replayed after a later mark, by anyone, cannot
   * clear a decision it did not make.
   */
  z.object({
    action: z.literal("mark_unreviewed"),
    marks: z
      .array(
        z.object({
          reviewId: z.uuid(),
          triagedAt: z.iso.datetime({ offset: true }),
        })
      )
      .min(1)
      .max(100),
  }),
  /**
   * Rating-only reviews answered from the standard template, on the bulk
   * engine (organisations with bulk changes on): each review is drafted,
   * checked and published (or submitted for approval) by the job runner,
   * and the batch's progress survives the tab closing.
   */
  z.object({
    action: z.literal("template_reply"),
    reviewIds: bulkReviewIdsSchema.refine(
      (ids) => new Set(ids).size === ids.length,
      { message: "Select each review once" }
    ),
    includeLowRatings: z.boolean().default(false),
  }),
])
export type BulkReviewActionInput = z.infer<typeof bulkReviewActionSchema>

/**
 * Per-row outcomes, never a single verdict. A bulk approve over twenty
 * reviews where three are no longer pending must apply the other seventeen
 * and say which three it skipped — failing the batch would punish the
 * operator for someone else's concurrent edit.
 *
 * - `ok`: the action took effect (for approve: Google accepted the reply).
 * - `skipped`: the row was not eligible; nothing changed.
 * - `failed`: the row could not be processed; nothing is known to have
 *   changed for it.
 * - `approved_not_published`: the approval is recorded but the reply is not
 *   live on Google (a refusal, a reply Google answered with REJECTED, a review
 *   that moved, or a rate limit, which `publish_retry_scheduled` marks as
 *   queued for an automatic resend). It is not "skipped".
 * - `uncertain`: the approval is recorded and Google may or may not have the
 *   reply (unconfirmed write, a diverged live reply, a publish still in
 *   flight). Its state must be checked before anyone retries.
 * - `queued`: the row joined a bulk batch (`operationId`) and the job runner
 *   will send it; its outcome is followed on the batch, not here. For an
 *   approval the decision is already recorded.
 */
export const BULK_REVIEW_ROW_STATUSES = [
  "ok",
  "skipped",
  "failed",
  "approved_not_published",
  "uncertain",
  "queued",
] as const
export type BulkReviewRowStatus = (typeof BULK_REVIEW_ROW_STATUSES)[number]

export const bulkReviewResultSchema = z.object({
  /** The bulk batch the queued rows run in (`GET /api/listings/bulk/{id}`). */
  operationId: z.uuid().optional(),
  results: z.array(
    z.object({
      reviewId: z.string(),
      status: z.enum(BULK_REVIEW_ROW_STATUSES),
      code: z.string().optional(),
      /** `mark_reviewed`, `ok`: the mark made, for the Undo to name. */
      triagedAt: z.iso.datetime({ offset: true }).optional(),
    })
  ),
})
export type BulkReviewResult = z.infer<typeof bulkReviewResultSchema>

// ---------------------------------------------------------------------------
// Drafts, verify, publish, reply delete, approval
// ---------------------------------------------------------------------------

/**
 * The review as it stands after a write (publish, approval, reply delete,
 * draft save, verify): `row` in the list's shape, `detail` in the detail
 * route's. The client patches its caches from these instead of refetching
 * every loaded list page. Optional and additive: a server that could not read
 * them back leaves them out, and an older client ignores them.
 */
const reviewWriteSnapshot = {
  row: reviewRowSchema.optional(),
  detail: reviewDetailSchema.optional(),
}
export type ReviewWriteSnapshot = {
  row?: ReviewRow
  detail?: ReviewDetail
}

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
  ...reviewWriteSnapshot,
})
export type DraftResult = z.infer<typeof draftResultSchema>

export const verifyResultSchema = z.object({
  verification: verificationSchema,
  ...reviewWriteSnapshot,
})
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
  ...reviewWriteSnapshot,
})
export type PublishResult = z.infer<typeof publishResultSchema>

export const deleteReplyResultSchema = z.object({
  status: z.string(),
  // executeReplyDelete returns attemptId: string | null (a "cancelled" outcome
  // can omit it), so this is nullable.
  publishAttemptId: z.string().nullable(),
  ...reviewWriteSnapshot,
})
export type DeleteReplyResult = z.infer<typeof deleteReplyResultSchema>

// `draftId` is the draft the approver actually read. The server resolves the
// parked draft itself (review_reply.pending_draft_id) and never trusts this
// value to choose what to publish — it only compares, and answers 409
// `approval_draft_changed` when the two disagree, so an approver whose pane
// went stale is told rather than credited with approving text they never saw.
// Optional so a client that cannot yet send it keeps working; the server-side
// binding protects that case on its own.
export const approvalInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  draftId: z.uuid().optional(),
  /**
   * The review's update time as the approver saw it. When present, a review
   * that has since changed is refused with 409 `review_changed` instead of
   * being approved against text the approver never read. Bulk approve always
   * sends it.
   */
  expectedReviewUpdateTime: z.iso.datetime({ offset: true }).optional(),
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
  ...reviewWriteSnapshot,
})
export type ApprovalResult = z.infer<typeof approvalResultSchema>
