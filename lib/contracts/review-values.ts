// The reviews vocabulary and wire encoder that client code needs at runtime,
// kept free of zod so the inbox's first load does not pay for the schemas in
// `lib/contracts/reviews.ts`. That file imports everything here and
// re-exports it under the same names, so server code and every other
// importer are unchanged; the zod enums are built from these tuples there.
//
// Type-only imports are fine (they are erased); a runtime import of `zod`
// or of a module that imports it would defeat the file.

import type { ReviewsFilters } from "@/lib/contracts/reviews"
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

export const REVIEW_REPLY_STATES = ["replied", "unreplied"] as const
export type ReviewReplyState = (typeof REVIEW_REPLY_STATES)[number]

/**
 * Whether the reviewer wrote anything. `rating_only` is the stars-and-
 * nothing-else review — the bulk of most venues' backlog, and the set the
 * template batch works through.
 */
export const REVIEW_WRITTEN = ["with_text", "rating_only"] as const
export type ReviewWritten = (typeof REVIEW_WRITTEN)[number]
export function isReviewWritten(value: unknown): value is ReviewWritten {
  return (REVIEW_WRITTEN as readonly unknown[]).includes(value)
}

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
// Wire codec: query encoder
// ---------------------------------------------------------------------------

// Wire param names (snake_case). Declared once so encode and decode cannot
// drift; tests/integration/routes and tests/e2e depend on these names.
export const WIRE = {
  locationId: "location_id",
  clientId: "client_id",
  queue: "queue",
  assignee: "assignee",
  ratings: "rating",
  written: "written",
  // S3: one review topic (lib/domain/review-topics.ts).
  topic: "topic",
  statuses: "status",
  replyState: "reply_state",
  dateFrom: "date_from",
  dateTo: "date_to",
  search: "search",
  sort: "sort",
  pageSize: "page_size",
  cursor: "cursor",
} as const

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
  set(WIRE.topic, filters.topic)
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
