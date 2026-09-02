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

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const callToActionSchema = z
  .object({
    actionType: z.enum(LOCAL_POST_ACTION_TYPES),
    url: z.url().optional(),
  })
  .optional()

/** POST `/posts` and PATCH `/posts/[postId]` body. */
export const localPostInputSchema = z
  .object({
    topicType: z.enum(LOCAL_POST_TOPIC_TYPES),
    languageCode: z.string().trim().min(2).max(16).default("en-GB"),
    summary: z.string().trim().max(1500).default(""),
    callToAction: callToActionSchema,
    event: z.record(z.string(), z.unknown()).optional(),
    offer: z
      .object({
        couponCode: z.string().trim().max(100).optional(),
        redeemOnlineUrl: z.url().optional(),
        termsConditions: z.string().trim().max(5000).optional(),
      })
      .optional(),
    media: z
      .array(z.object({ sourceUrl: z.url() }))
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

/** POST `/posts/[postId]/approval` body. */
export const postApprovalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
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
  googlePostName: z.string().nullable(),
  googleState: z.string().nullable(),
  googleSearchUrl: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PostRow = z.infer<typeof postRowSchema>

/** GET `/posts`. */
export const postsListResponseSchema = z.object({
  posts: z.array(postRowSchema),
  writesEnabled: z.boolean(),
  reconciliationError: z.string().nullable(),
})
export type PostsListResponse = z.infer<typeof postsListResponseSchema>

/** POST `/posts` (201). */
export const postCreateResponseSchema = z.object({
  post: z.object({ id: z.string() }),
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
  }),
])
export type PostPublishOutcome = z.infer<typeof postPublishOutcomeSchema>

/** PATCH `/posts/[postId]`: a draft edit returns `{ post }`, a live edit republishes. */
export const postUpdateResponseSchema = z.union([
  z.object({ post: z.object({ id: z.string(), status: z.string() }) }),
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
