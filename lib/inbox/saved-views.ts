import type { InboxState } from "@/lib/inbox/url-state"

/**
 * The filter combinations an agency reaches for repeatedly.
 *
 * URL presets, not stored records: a view is a link, so it can be bookmarked,
 * shared with a colleague and read without a round trip. Persisted per-user
 * views can land later behind the same `?view=` key without changing anything
 * that reads these.
 */
export type SavedView = {
  slug: string
  label: string
  description: string
  state: Partial<InboxState>
}

export const SAVED_VIEWS: SavedView[] = [
  {
    slug: "unhappy-unanswered",
    label: "1–2 stars, unanswered",
    description: "The reviews that cost a client business if they sit.",
    state: {
      queue: "needs_reply",
      ratings: [1, 2],
      replyState: "unreplied",
      sort: "updated_asc",
    },
  },
  {
    slug: "oldest-first",
    label: "Oldest waiting",
    description: "Work the backlog from the bottom.",
    state: { queue: "needs_reply", sort: "updated_asc" },
  },
  {
    slug: "assigned-to-me",
    label: "Assigned to me",
    description: "Reviews a colleague handed to you.",
    state: { queue: "all", assignee: "me" },
  },
  {
    slug: "failed-publishes",
    label: "Failed to publish",
    description: "Replies Google rejected, waiting on a retry.",
    state: { queue: "failed" },
  },
]

const BY_SLUG = new Map(SAVED_VIEWS.map((view) => [view.slug, view]))

export function savedView(slug: string | undefined): SavedView | undefined {
  return slug ? BY_SLUG.get(slug) : undefined
}

/**
 * Expands `?view=<slug>` into its filters, letting explicit params win.
 *
 * That precedence matters: an operator who opens a view and then narrows it by
 * rating has a URL carrying both, and the narrowing is the more recent
 * intention.
 */
export function applySavedView(state: InboxState, params: URLSearchParams): InboxState {
  const view = savedView(state.view)
  if (!view) return state
  const explicit = new Set(params.keys())
  const merged: InboxState = { ...state }
  for (const [key, value] of Object.entries(view.state)) {
    const wireKey = key === "locationIds" ? "locationId" : key
    if (explicit.has(wireKey)) continue
    // The queue has its own param and its own default, so an explicit
    // `?queue=` must not be overwritten by the view's.
    if (key === "queue" && explicit.has("queue")) continue
    Object.assign(merged, { [key]: value })
  }
  return merged
}

/** Whether the current state still matches the view it names. */
export function matchesSavedView(state: InboxState): boolean {
  const view = savedView(state.view)
  if (!view) return false
  return Object.entries(view.state).every(([key, value]) => {
    const current = (state as Record<string, unknown>)[key]
    return Array.isArray(value)
      ? JSON.stringify(current) === JSON.stringify(value)
      : current === value
  })
}
