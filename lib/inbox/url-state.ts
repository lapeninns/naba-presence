import {
  DEFAULT_REVIEW_QUEUE,
  DEFAULT_REVIEW_SORT,
  isReviewPublishStatus,
  isReviewReplyState,
  isReviewSort,
  isReviewSyncStatus,
  isReviewVerificationStatus,
  REVIEW_QUEUES,
  type ReviewQueue,
  type ReviewReplyState,
  type ReviewSort,
  type ReviewsFilters,
} from "@/lib/contracts/reviews"

export { DEFAULT_REVIEW_QUEUE as DEFAULT_QUEUE, REVIEW_QUEUES as QUEUES }
export type Queue = ReviewQueue

// Two-pane + auto-select. Tailwind `lg` (1024px) — `xl` (1280) left typical
// laptop-plus-sidebar widths on the single-pane phone layout.
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"

/**
 * The inbox's whole state, in the URL.
 *
 * Queue membership is NOT expanded to workflow statuses here any more. A queue
 * like "awaiting my approval" depends on who requested the approval and who
 * may publish — facts the browser does not have — so the queue name goes to
 * the server and `lib/server/review-queues.ts` decides. That also makes the
 * rail's counts and its rows answer to one definition.
 */
export type InboxState = {
  queue: Queue
  clientId?: string
  locationIds: string[]
  assignee?: string
  ratings: number[]
  search: string
  sort: ReviewSort
  replyState?: ReviewReplyState
  verification: string[]
  publishStatus: string[]
  syncStatus: string[]
  dateFrom?: string
  dateTo?: string
  selected?: string
  /** A saved view's slug; expanded during parse. */
  view?: string
}

function csv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : []
}

export function parseInboxState(params: URLSearchParams): InboxState {
  const rawQueue = params.get("queue")
  const queue = (REVIEW_QUEUES as readonly string[]).includes(rawQueue ?? "")
    ? (rawQueue as Queue)
    : DEFAULT_REVIEW_QUEUE
  const rawSort = params.get("sort") ?? ""
  const sort = isReviewSort(rawSort) ? rawSort : DEFAULT_REVIEW_SORT
  const rawReply = params.get("replyState") ?? ""
  return {
    queue,
    clientId: params.get("clientId") ?? undefined,
    // One param, two shapes: a single id (every existing deep link, including
    // Home's attention list) or a comma list from the multi-select.
    locationIds: csv(params.get("locationId")),
    assignee: params.get("assignee") ?? undefined,
    ratings: csv(params.get("rating"))
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    search: params.get("search") ?? "",
    sort,
    replyState: isReviewReplyState(rawReply) ? rawReply : undefined,
    // Narrowed here so the chips never render a value the list ignores.
    verification: csv(params.get("verification")).filter(
      isReviewVerificationStatus
    ),
    publishStatus: csv(params.get("publishStatus")).filter(
      isReviewPublishStatus
    ),
    syncStatus: csv(params.get("syncStatus")).filter(isReviewSyncStatus),
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    selected: params.get("selected") ?? undefined,
    view: params.get("view") ?? undefined,
  }
}

export function serializeInboxState(state: InboxState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.queue !== DEFAULT_REVIEW_QUEUE) params.set("queue", state.queue)
  if (state.clientId) params.set("clientId", state.clientId)
  if (state.locationIds.length)
    params.set("locationId", state.locationIds.join(","))
  if (state.assignee) params.set("assignee", state.assignee)
  if (state.ratings.length) params.set("rating", state.ratings.join(","))
  if (state.search) params.set("search", state.search)
  if (state.sort !== DEFAULT_REVIEW_SORT) params.set("sort", state.sort)
  if (state.replyState) params.set("replyState", state.replyState)
  if (state.verification.length)
    params.set("verification", state.verification.join(","))
  if (state.publishStatus.length)
    params.set("publishStatus", state.publishStatus.join(","))
  if (state.syncStatus.length)
    params.set("syncStatus", state.syncStatus.join(","))
  if (state.dateFrom) params.set("dateFrom", state.dateFrom)
  if (state.dateTo) params.set("dateTo", state.dateTo)
  if (state.selected) params.set("selected", state.selected)
  if (state.view) params.set("view", state.view)
  return params
}

/**
 * Everything except queue and selection counts as an "active filter" for the
 * three-way empty-state distinction. Non-default sort is included so chips and
 * "Clear all" can reset it.
 */
export function hasActiveFilters(state: InboxState): boolean {
  return Boolean(
    state.clientId ||
      state.locationIds.length ||
      state.assignee ||
      state.ratings.length ||
      state.search ||
      state.replyState ||
      state.verification.length ||
      state.publishStatus.length ||
      state.syncStatus.length ||
      state.dateFrom ||
      state.dateTo ||
      (state.sort && state.sort !== DEFAULT_REVIEW_SORT)
  )
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length ? values : undefined
}

/** URL state → the contract's filter set. */
export function toReviewsFilters(state: InboxState): ReviewsFilters {
  return {
    queue: state.queue,
    clientId: state.clientId,
    locationIds: nonEmpty(state.locationIds),
    assignee: state.assignee as ReviewsFilters["assignee"],
    ratings: nonEmpty(state.ratings),
    replyState: state.replyState,
    verification: nonEmpty(
      state.verification.filter(isReviewVerificationStatus)
    ),
    publishStatus: nonEmpty(state.publishStatus.filter(isReviewPublishStatus)),
    syncStatus: nonEmpty(state.syncStatus.filter(isReviewSyncStatus)),
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    search: state.search || undefined,
    sort: state.sort,
  }
}

/** Which pane the mobile (<lg) layout shows. Desktop always shows both. */
export function mobilePaneFor(selected: string | undefined): "list" | "detail" {
  return selected ? "detail" : "list"
}

/**
 * Auto-selection: pick the first row ONLY when the URL carries no selection,
 * nothing is dirty, and we are on desktop (where a detail pane is always
 * visible).
 */
export function autoSelectId(input: {
  selected: string | undefined
  reviews: { id: string }[]
  isDirty: boolean
  isDesktop: boolean
}): string | null {
  if (input.selected) return null
  if (input.isDirty) return null
  if (!input.isDesktop) return null
  return input.reviews[0]?.id ?? null
}
