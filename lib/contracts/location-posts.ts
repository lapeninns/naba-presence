/**
 * Wire contract for `/api/locations/[id]/posts/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The route parses
 * requests with the request schemas; `lib/api/location-posts.ts` parses
 * responses with the response schemas; `lib/server/posts.ts` types its rows
 * against the response types so the SQL aliases and the wire shape cannot
 * drift apart.
 */
import { z } from "zod"

import { decodeCursor, encodeCursor } from "@/lib/contracts/cursor"
import {
  editorReadSourceSchema,
  editorRefreshQuerySchema,
} from "@/lib/contracts/editor-freshness"
import { httpUrl } from "@/lib/contracts/http-url"
import { operationSummaryField } from "@/lib/contracts/mutation-operations"
// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const LOCAL_POST_TOPIC_TYPES = ["STANDARD", "EVENT", "OFFER"] as const
export type LocalPostTopicType = (typeof LOCAL_POST_TOPIC_TYPES)[number]

export const LOCAL_POST_ACTION_TYPES = [
  "BOOK",
  "ORDER",
  "SHOP",
  "LEARN_MORE",
  "SIGN_UP",
  "CALL",
] as const
export type LocalPostActionType = (typeof LOCAL_POST_ACTION_TYPES)[number]

export const LOCAL_POST_STATUSES = [
  "draft",
  "awaiting_approval",
  "publishing",
  "published",
  "failed",
  "ambiguous",
] as const
export type LocalPostStatus = (typeof LOCAL_POST_STATUSES)[number]

/** Google's `DayOfWeek`, Monday first. */
export const DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

export const DAY_OF_WEEK_OCCURRENCES = [
  "FIRST",
  "SECOND",
  "THIRD",
  "FOURTH",
  "LAST",
] as const
export type DayOfWeekOccurrence = (typeof DAY_OF_WEEK_OCCURRENCES)[number]

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const callToActionSchema = z
  .object({
    actionType: z.enum(LOCAL_POST_ACTION_TYPES),
    url: httpUrl().optional(),
  })
  .optional()

/**
 * Google's `LocalPostEvent.recurrenceInfo`: how an event or offer post
 * repeats. Exactly one pattern; a monthly pattern names either a day of the
 * month or which weekday occurrence (the weekday is the start date's).
 */
export const recurrenceInfoSchema = z
  .object({
    seriesEndTime: z.iso.datetime({ offset: true }).optional(),
    dailyPattern: z.object({}).optional(),
    weeklyPattern: z
      .object({ daysOfWeek: z.array(z.enum(DAYS_OF_WEEK)).max(7).optional() })
      .optional(),
    monthlyPattern: z
      .object({
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        dayOfWeekOccurrence: z.enum(DAY_OF_WEEK_OCCURRENCES).optional(),
      })
      .refine(
        (value) =>
          (value.dayOfMonth === undefined) !==
          (value.dayOfWeekOccurrence === undefined),
        "A monthly repeat needs a day of the month or a weekday, not both."
      )
      .optional(),
  })
  .refine(
    (value) =>
      [value.dailyPattern, value.weeklyPattern, value.monthlyPattern].filter(
        Boolean
      ).length === 1,
    "Choose how often the post repeats."
  )
export type RecurrenceInfo = z.infer<typeof recurrenceInfoSchema>

/** POST `/posts` and PATCH `/posts/[postId]` body. */
export const localPostInputSchema = z
  .object({
    contentWarningAcknowledgement: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    topicType: z.enum(LOCAL_POST_TOPIC_TYPES),
    languageCode: z.string().trim().min(2).max(16).default("en-GB"),
    summary: z.string().trim().max(1500).default(""),
    callToAction: callToActionSchema,
    event: z.record(z.string(), z.unknown()).optional(),
    offer: z
      .object({
        couponCode: z.string().trim().max(100).optional(),
        redeemOnlineUrl: httpUrl().optional(),
        termsConditions: z.string().trim().max(5000).optional(),
      })
      .optional(),
    media: z
      .array(z.object({ sourceUrl: httpUrl() }))
      .max(10)
      .default([]),
  })
  .superRefine((value, context) => {
    if (
      (value.topicType === "EVENT" || value.topicType === "OFFER") &&
      !value.event
    ) {
      context.addIssue({
        code: "custom",
        path: ["event"],
        message: "Event details are required for event and offer posts.",
      })
    }
    if (value.event?.recurrenceInfo !== undefined) {
      if (value.topicType === "STANDARD") {
        context.addIssue({
          code: "custom",
          path: ["event", "recurrenceInfo"],
          message: "Only event and offer posts can repeat.",
        })
      }
      const recurrence = recurrenceInfoSchema.safeParse(
        value.event.recurrenceInfo
      )
      for (const issue of recurrence.error?.issues ?? []) {
        context.addIssue({
          code: "custom",
          path: ["event", "recurrenceInfo", ...issue.path.map(String)],
          message: issue.message,
        })
      }
      const schedule = value.event.schedule
      const startDate =
        schedule && typeof schedule === "object"
          ? (schedule as Record<string, unknown>).startDate
          : undefined
      if (!startDate) {
        context.addIssue({
          code: "custom",
          path: ["event", "schedule"],
          message: "A repeating post needs a start date.",
        })
      }
    }
    if (value.topicType === "OFFER" && !value.offer) {
      context.addIssue({
        code: "custom",
        path: ["offer"],
        message: "Offer details are required for offer posts.",
      })
    }
  })

export type LocalPostInput = z.infer<typeof localPostInputSchema>
/** The body as sent (defaults still optional). */
export type LocalPostInputValues = z.input<typeof localPostInputSchema>

/**
 * POST `/posts/[postId]/publish` body (optional). `expectedRevision` is the
 * `contentRevision` the person saved or had on screen when they consented;
 * a post that has changed since is refused (409 `post_changed_since_saved`).
 */
export const postPublishBodySchema = z.object({
  contentWarningAcknowledgement: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expectedRevision: z.number().int().positive().optional(),
})

/**
 * POST `/posts/[postId]/approval` body.
 *
 * `expectedRevision` is the `contentRevision` of the post the approver read.
 * The server requires it to approve (400 `expected_revision_required`) and
 * answers 409 `approval_post_changed` when the post has moved on, so an
 * approval always names the exact content it covers. It is optional in the
 * schema only so that a viewer or non-publisher is refused for who they are
 * (403) before what they sent is looked at.
 */
// INTEGRATION(S4): Approval dialog/API client must expose refreshed content
// warning reasons and forward explicit acknowledgement after policy drift.
export const postApprovalDecisionSchema = z.object({
  contentWarningAcknowledgement: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  decision: z.enum(["approve", "reject"]),
  expectedRevision: z.number().int().positive().optional(),
})
export type PostApprovalDecision = z.infer<typeof postApprovalDecisionSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * One `gbp_local_post` row as GET `/posts` lists it (timestamps as ISO
 * strings).
 *
 * There is deliberately no `scheduledTime`: the column it came from was
 * written, echoed and sent to Google, but nothing ever published a post when
 * its time arrived — no job kind, no scheduler tick — so the field promised a
 * behaviour the system does not have. `gbp_local_post.scheduled_publish_time`
 * stays in the schema (dropping it buys nothing) but is no longer read or
 * written. Scheduling needs a due-posts claim before the field comes back.
 */
export const postRowSchema = z.object({
  id: z.string(),
  topicType: z.enum(LOCAL_POST_TOPIC_TYPES),
  languageCode: z.string(),
  summary: z.string(),
  callToAction: z.unknown(),
  event: z.unknown(),
  offer: z.unknown(),
  media: z.unknown(),
  status: z.enum(LOCAL_POST_STATUSES),
  /**
   * Bumped whenever content sent to Google changes; an approval names the
   * revision it covers. Optional so an older server still parses.
   */
  contentRevision: z.number().int().positive().optional(),
  googlePostName: z.string().nullable(),
  googleState: z.string().nullable(),
  googleSearchUrl: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  providerCreatedAt: z.string().nullable().optional(),
  providerUpdatedAt: z.string().nullable().optional(),
  localEditedAt: z.string().nullable().optional(),
})
export type PostRow = z.infer<typeof postRowSchema>

/**
 * The list's status views. `published` holds posts on their way to Google as
 * well; `attention` is anything Google refused or never confirmed.
 */
export const POST_LIST_FILTERS = [
  "all",
  "draft",
  "awaiting",
  "published",
  "attention",
] as const
export type PostListFilter = (typeof POST_LIST_FILTERS)[number]

export const DEFAULT_POSTS_PAGE_SIZE = 20
export const MAX_POSTS_PAGE_SIZE = 50

/**
 * GET `/posts` query. `post` reads one post only (the ambiguous-post check);
 * otherwise the list pages by keyset `cursor` within one `filter`.
 */
export const postsListQuerySchema = z.object({
  filter: z.enum(POST_LIST_FILTERS).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_POSTS_PAGE_SIZE)
    .optional(),
  cursor: z.string().max(1024).optional(),
  post: z.uuid().optional(),
  /** Reconcile with Google now, past the editor's staleness budget. */
  refresh: editorRefreshQuerySchema.shape.refresh,
})
export type PostsListQuery = z.infer<typeof postsListQuerySchema>

/**
 * The position after a page's last post: the list's sort time (newest first,
 * posts without one last) and the id that breaks ties. Bound to its location
 * and filter; the server refuses it anywhere else (400 `invalid_cursor`).
 */
export const postsCursorSchema = z
  .object({
    version: z.literal(1),
    locationId: z.uuid(),
    filter: z.enum(POST_LIST_FILTERS),
    at: z.iso.datetime().nullable(),
    id: z.uuid(),
  })
  .strict()
export type PostsCursor = z.infer<typeof postsCursorSchema>

export function encodePostsCursor(cursor: PostsCursor): string {
  return encodeCursor(cursor)
}

export function decodePostsCursor(
  value: string | null | undefined
): PostsCursor | null {
  return decodeCursor(value, postsCursorSchema)
}

/** How many of the location's posts each view holds, and how many are live. */
export const postCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  awaiting: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
})
export type PostCounts = z.infer<typeof postCountsSchema>

/** GET `/posts`: one page of one view. */
export const postsListResponseSchema = z.object({
  posts: z.array(postRowSchema),
  /** Counts over every post of the location, not just this page. */
  counts: postCountsSchema,
  filter: z.enum(POST_LIST_FILTERS),
  /** Where the next page starts; `null` on the last page. */
  nextCursor: z.string().nullable(),
  /**
   * The listing's IANA timezone: a repeat's last day ends at midnight
   * there, not in UTC. Optional so an older server still parses.
   */
  timezone: z.string().optional(),
  writesEnabled: z.boolean(),
  reconciliationError: z.string().nullable(),
  /**
   * First page: when the posts were last reconciled with Google (null when
   * never, or on a later page), and whether this response read Google
   * (`live`) or served the rows of a reconciliation within the editor's
   * staleness budget (`stored`). Optional so an older server still parses.
   */
  observedAt: z.string().nullable().optional(),
  source: editorReadSourceSchema.nullable().optional(),
})
export type PostsListResponse = z.infer<typeof postsListResponseSchema>

/** POST `/posts` (201). */
export const postCreateResponseSchema = z.object({
  post: z.object({
    id: z.string(),
    /** The saved content's revision, for a publish bound to it. */
    contentRevision: z.number().int().positive().optional(),
  }),
})
export type PostCreateResponse = z.infer<typeof postCreateResponseSchema>

/**
 * Outcome of `requestOrPublishLocalPost`: returned by POST `/publish`
 * (202 when awaiting approval, else 200), by POST `/approval` on approve, and
 * by PATCH `/posts/[postId]` when the edited post was already live.
 *
 * `rejected` is a write that landed: Google accepted the post and returned it
 * in state REJECTED, so it exists (and has a name) but nobody can see it.
 * Reporting it as `published` told the operator the opposite of the truth.
 */
export const postPublishOutcomeSchema = z.union([
  z.object({ status: z.literal("awaiting_approval") }),
  z.object({
    status: z.enum(["published", "rejected"]),
    postId: z.string(),
    googlePostName: z.string().nullable(),
    ...operationSummaryField,
  }),
])
export type PostPublishOutcome = z.infer<typeof postPublishOutcomeSchema>

/** PATCH `/posts/[postId]`: a draft edit returns `{ post }`, a live edit republishes. */
export const postUpdateResponseSchema = z.union([
  z.object({
    post: z.object({
      id: z.string(),
      status: z.string(),
      contentRevision: z.number().int().positive().optional(),
    }),
  }),
  postPublishOutcomeSchema,
])
export type PostUpdateResponse = z.infer<typeof postUpdateResponseSchema>

/** POST `/posts/[postId]/approval`: reject sends the post back to draft. */
export const postApprovalOutcomeSchema = z.union([
  z.object({ status: z.literal("draft") }),
  postPublishOutcomeSchema,
])
export type PostApprovalOutcome = z.infer<typeof postApprovalOutcomeSchema>

/** DELETE `/posts/[postId]`. */
export const postDeleteOutcomeSchema = z.object({
  status: z.literal("deleted"),
})
export type PostDeleteOutcome = z.infer<typeof postDeleteOutcomeSchema>
