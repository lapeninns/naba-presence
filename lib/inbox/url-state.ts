import { ageRange, isReviewAge, type ReviewAge } from "@/lib/inbox/review-age"
import {
  DEFAULT_REVIEW_QUEUE,
  DEFAULT_REVIEW_SORT,
  isReviewReplyState,
  isReviewSort,
  isReviewWritten,
  REVIEW_QUEUES,
  type ReviewQueue,
  type ReviewReplyState,
  type ReviewSort,
  type ReviewWritten,
  type ReviewsFilters,
} from "@/lib/contracts/reviews"

export { DEFAULT_REVIEW_QUEUE as DEFAULT_QUEUE, REVIEW_QUEUES as QUEUES }
export type Queue = ReviewQueue

// Two-pane + auto-select from Tailwind `md` (768px), where a tablet has room
// for a 280px queue beside the reply thread. Below it the list and the review
// take turns.
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)"

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
  /** Written review or stars only; see `ReviewsQuery.written`. */
  written?: ReviewWritten
  search: string
  sort: ReviewSort
  replyState?: ReviewReplyState
  dateFrom?: string
  dateTo?: string
  /**
   * A relative-age preset. Expanded into `dateFrom` / `dateTo` by
   * `toReviewsFilters`; see lib/inbox/review-age.ts for how it and an explicit
   * range resolve when both are present.
   */
  age?: ReviewAge
  selected?: string
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
    written: isReviewWritten(params.get("written"))
      ? (params.get("written") as ReviewWritten)
      : undefined,
    search: params.get("search") ?? "",
    sort,
    replyState: isReviewReplyState(rawReply) ? rawReply : undefined,
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    age: isReviewAge(params.get("age"))
      ? (params.get("age") as ReviewAge)
      : undefined,
    selected: params.get("selected") ?? undefined,
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
  if (state.written) params.set("written", state.written)
  if (state.search) params.set("search", state.search)
  if (state.sort !== DEFAULT_REVIEW_SORT) params.set("sort", state.sort)
  if (state.replyState) params.set("replyState", state.replyState)
  if (state.dateFrom) params.set("dateFrom", state.dateFrom)
  if (state.dateTo) params.set("dateTo", state.dateTo)
  if (state.age) params.set("age", state.age)
  if (state.selected) params.set("selected", state.selected)
  return params
}

/**
 * The Inbox moved to another client scope (the top-bar switcher, the
 * Filters sheet's Client field, or the chip that removes it).
 *
 * The queue and every filter that is not about one client stay. Venues are
 * narrowed to the ones that belong to the new client, because a venue of
 * another client would leave an empty list that explains nothing; the open
 * review stays only if it belongs to the new client (or the scope widened to
 * every client). `locationClientIds` maps a venue to its client, and
 * `selectedClientId` is the open review's client when the list has it.
 */
export function scopeInboxState(
  state: InboxState,
  clientId: string | undefined,
  context: {
    locationClientIds: ReadonlyMap<string, string | null>
    selectedClientId?: string | null
  }
): InboxState {
  if (!clientId) return { ...state, clientId: undefined }
  return {
    ...state,
    clientId,
    locationIds: state.locationIds.filter(
      (id) => context.locationClientIds.get(id) === clientId
    ),
    selected:
      state.selected && context.selectedClientId === clientId
        ? state.selected
        : undefined,
  }
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
    state.written ||
    state.search ||
    state.replyState ||
    state.dateFrom ||
    state.dateTo ||
    state.age ||
    (state.sort && state.sort !== DEFAULT_REVIEW_SORT)
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The "To" date picks a whole day, but it is stored as that day's midnight,
 * and the list used to stop there — so "To: 3 July" left out everything that
 * happened on 3 July. A day-only bound becomes the start of the next day,
 * which the query treats as exclusive. A precise instant (a hand-edited link)
 * is left as it is.
 */
function endOfDayBound(dateTo: string | undefined): string | undefined {
  if (!dateTo || !/T00:00:00(\.000)?Z$/.test(dateTo)) return dateTo
  const start = Date.parse(dateTo)
  return Number.isNaN(start) ? dateTo : new Date(start + DAY_MS).toISOString()
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length ? values : undefined
}

/**
 * URL state → the contract's filter set.
 *
 * `now` is injected so the age window is testable and so the caller controls
 * how often it moves; it defaults to the wall clock, quantised to the hour
 * inside `ageRange`.
 */
export function toReviewsFilters(
  state: InboxState,
  options: { now?: number } = {}
): ReviewsFilters {
  // Custom dates are the more specific claim and win outright, so a preset is
  // only expanded when neither bound is set. See lib/inbox/review-age.ts.
  const explicitRange = Boolean(state.dateFrom || state.dateTo)
  const range =
    state.age && !explicitRange
      ? ageRange(state.age, options.now ?? Date.now())
      : { dateFrom: state.dateFrom, dateTo: endOfDayBound(state.dateTo) }
  return {
    queue: state.queue,
    clientId: state.clientId,
    locationIds: nonEmpty(state.locationIds),
    assignee: state.assignee as ReviewsFilters["assignee"],
    ratings: nonEmpty(state.ratings),
    written: state.written,
    replyState: state.replyState,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    search: state.search || undefined,
    sort: state.sort,
  }
}

// --- The Approval aggregate -------------------------------------------------

/**
 * The five queue controls the Inbox shows. `approval` is the presentation
 * union of the two `awaiting_approval` queues; `all` is reached by clearing
 * filters, not by a control.
 */
export const VISIBLE_QUEUES = [
  "needs_reply",
  "approval",
  "publishing",
  "failed",
  "done",
] as const satisfies readonly Queue[]
export type VisibleQueue = (typeof VISIBLE_QUEUES)[number]

/** The queues the Approval control stands in for. */
const APPROVAL_QUEUES: readonly Queue[] = [
  "approval",
  "awaiting_my_approval",
  "awaiting_others",
]

/**
 * Which of the five controls is lit for a given state.
 *
 * A legacy `?queue=awaiting_my_approval` link keeps its own, narrower server
 * scope — it is still exactly that queue — and simply presents as Approval with
 * "Waiting on: Me" preselected. Nothing about ownership or record state is
 * merged; only the control that is highlighted.
 */
export function visibleQueue(queue: Queue): VisibleQueue | undefined {
  if (APPROVAL_QUEUES.includes(queue)) return "approval"
  return (VISIBLE_QUEUES as readonly Queue[]).includes(queue)
    ? (queue as VisibleQueue)
    : undefined
}

export type ApprovalOwner = "anyone" | "me" | "others"

/** Who the currently selected approval scope is waiting on. */
export function approvalOwner(queue: Queue): ApprovalOwner {
  if (queue === "awaiting_my_approval") return "me"
  if (queue === "awaiting_others") return "others"
  return "anyone"
}

/**
 * "Waiting on" → the queue that expresses it.
 *
 * Deliberately a queue rather than a second URL parameter: the two narrow
 * queues already carry the exact ownership rule (including the organisation's
 * two-person approval setting, which only the server can evaluate), so routing
 * the control through them keeps one definition of ownership and leaves every
 * existing link meaning what it always meant.
 */
export function queueForApprovalOwner(owner: ApprovalOwner): Queue {
  if (owner === "me") return "awaiting_my_approval"
  if (owner === "others") return "awaiting_others"
  return "approval"
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
