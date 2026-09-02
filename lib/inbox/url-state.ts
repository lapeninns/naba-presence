import type { ReviewsFilters } from "@/lib/api/reviews"

export type Queue =
  | "all"
  | "needs_reply"
  | "awaiting_approval"
  | "escalated"
  | "published"

export const QUEUES: readonly Queue[] = [
  "all",
  "needs_reply",
  "awaiting_approval",
  "escalated",
  "published",
]

// Operators open Reviews to work the backlog. An empty URL therefore lands
// on Needs reply; All is an explicit `?queue=all`. Matches the Home work-
// queue deep link (`/inbox?queue=needs_reply`) so `/inbox` and that href
// are the same view.
export const DEFAULT_QUEUE: Queue = "needs_reply"

// Two-pane + auto-select. Tailwind `lg` (1024px) — `xl` (1280) left typical
// laptop-plus-sidebar widths on the single-pane phone layout.
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"

// Reproduces the legacy queue->statuses mapping. "needs_reply" is the states
// that still require a human toward a reply (excluding the states that own
// their own tab: awaiting_approval, escalated, published). `publish_requested`
// is a transient pipeline state (a publish is in flight) and belongs to no
// actionable tab — it appears only under the All queue, by design. This is a
// defensible baseline the owner may refine; the per-tab count in queue-tabs
// derives from exactly this map so the count and the list always agree.
export const QUEUE_STATUS_MAP: Record<Queue, readonly string[] | null> = {
  all: null,
  needs_reply: ["new", "drafted", "verified", "failed", "rejected"],
  awaiting_approval: ["awaiting_approval"],
  escalated: ["escalated"],
  published: ["published"],
}

export function queueToStatuses(queue: Queue): string[] | undefined {
  const statuses = QUEUE_STATUS_MAP[queue]
  return statuses ? [...statuses] : undefined
}

const SORTS = [
  "updated_desc",
  "updated_asc",
  "rating_desc",
  "rating_asc",
] as const
type Sort = (typeof SORTS)[number]

export type InboxState = {
  queue: Queue
  locationId?: string
  ratings: number[]
  search: string
  sort: Sort
  replyState?: "replied" | "unreplied"
  verification: string[]
  publishStatus: string[]
  syncStatus: string[]
  dateFrom?: string
  dateTo?: string
  selected?: string
}

function csv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : []
}

export function parseInboxState(params: URLSearchParams): InboxState {
  const rawQueue = params.get("queue")
  const queue = (QUEUES as readonly string[]).includes(rawQueue ?? "")
    ? (rawQueue as Queue)
    : DEFAULT_QUEUE
  const rawSort = params.get("sort")
  const sort = (SORTS as readonly string[]).includes(rawSort ?? "")
    ? (rawSort as Sort)
    : "updated_desc"
  const rawReply = params.get("replyState")
  return {
    queue,
    locationId: params.get("locationId") ?? undefined,
    ratings: csv(params.get("rating"))
      .map(Number)
      .filter((n) => Number.isInteger(n)),
    search: params.get("search") ?? "",
    sort,
    replyState:
      rawReply === "replied" || rawReply === "unreplied" ? rawReply : undefined,
    verification: csv(params.get("verification")),
    publishStatus: csv(params.get("publishStatus")),
    syncStatus: csv(params.get("syncStatus")),
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    selected: params.get("selected") ?? undefined,
  }
}

export function serializeInboxState(state: InboxState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.queue !== DEFAULT_QUEUE) params.set("queue", state.queue)
  if (state.locationId) params.set("locationId", state.locationId)
  if (state.ratings.length) params.set("rating", state.ratings.join(","))
  if (state.search) params.set("search", state.search)
  if (state.sort !== "updated_desc") params.set("sort", state.sort)
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
  return params
}

// Everything except queue/selected counts as an "active filter" for the
// three-way empty-state distinction (D10). Non-default sort is included so
// chips and "Clear all" can reset it.
export function hasActiveFilters(state: InboxState): boolean {
  return Boolean(
    state.locationId ||
      state.ratings.length ||
      state.search ||
      state.replyState ||
      state.verification.length ||
      state.publishStatus.length ||
      state.syncStatus.length ||
      state.dateFrom ||
      state.dateTo ||
      (state.sort && state.sort !== "updated_desc")
  )
}

export function toReviewsFilters(state: InboxState): ReviewsFilters {
  return {
    locationId: state.locationId,
    ratings: state.ratings.length ? state.ratings : undefined,
    statuses: queueToStatuses(state.queue),
    replyState: state.replyState,
    verification: state.verification.length ? state.verification : undefined,
    publishStatus: state.publishStatus.length ? state.publishStatus : undefined,
    syncStatus: state.syncStatus.length ? state.syncStatus : undefined,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    search: state.search || undefined,
    sort: state.sort,
  }
}

// Which pane the mobile (<lg) layout shows: the detail when a review is
// selected, otherwise the list (spec §6). Desktop always shows both panes.
export function mobilePaneFor(selected: string | undefined): "list" | "detail" {
  return selected ? "detail" : "list"
}

// Spec §6 auto-selection: pick the first row ONLY when the URL carries no
// selection, nothing is dirty, and we are on desktop (where a detail pane is
// always visible). Returns the id to select via router.replace, or null.
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
