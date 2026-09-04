/**
 * Statuses that a background job, not the operator, moves on.
 *
 * `publish_requested` is the one the reply action leaves behind: the route
 * returns 200 with a pending outcome, the publish worker sends it to Google,
 * and the minute cron settles anything retryable or ambiguous through
 * `recoverAttempt`. Nothing about that reaches the browser on its own.
 *
 * So the review pane sat on "Publishing — Your reply is on its way to Google"
 * and the toast said "Its status will update shortly", while neither
 * `useReviews` nor `useReviewDetail` had a `refetchInterval`. With a 30 second
 * staleTime the row only moved on a window focus or a navigation: the operator
 * watched their own reply appear stuck on the screen where they had just
 * clicked. Polling is what makes that sentence true.
 */
export const SETTLING_WORKFLOW_STATUSES = ["publish_requested"] as const

/** How often to ask, while something is still settling. */
export const SETTLING_POLL_MS = 5_000

export function isSettling(workflowStatus: string | null | undefined): boolean {
  return (SETTLING_WORKFLOW_STATUSES as readonly string[]).includes(
    workflowStatus ?? ""
  )
}

/**
 * `refetchInterval` for a query holding rows: poll only while at least one is
 * in flight, then stop. Deliberately unbounded while that holds, matching
 * `useBackfill` — a publish that never settles is a bug the operator needs to
 * see change to `failed`, which only happens if we keep asking.
 */
export function settlingInterval(
  statuses: readonly (string | null | undefined)[]
): number | false {
  return statuses.some(isSettling) ? SETTLING_POLL_MS : false
}
