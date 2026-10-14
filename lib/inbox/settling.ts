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

/**
 * The back-off: every 5 s for the first half minute (a publish normally
 * settles inline, so this is where it lands), every 15 s to two minutes, then
 * once a minute, and nothing after ten. The minute cron settles a straggler
 * server-side regardless; the next focus, mount or write shows it.
 */
const SETTLING_SCHEDULE: readonly { untilMs: number; everyMs: number }[] = [
  { untilMs: 30_000, everyMs: SETTLING_POLL_MS },
  { untilMs: 2 * 60_000, everyMs: 15_000 },
  { untilMs: 10 * 60_000, everyMs: 60_000 },
]
export const SETTLING_POLL_CAP_MS = SETTLING_SCHEDULE.at(-1)!.untilMs

export function isSettling(workflowStatus: string | null | undefined): boolean {
  return (SETTLING_WORKFLOW_STATUSES as readonly string[]).includes(
    workflowStatus ?? ""
  )
}

/** The interval after `elapsedMs` of settling, or false once past the cap. */
export function settlingBackoff(elapsedMs: number): number | false {
  return (
    SETTLING_SCHEDULE.find((step) => elapsedMs < step.untilMs)?.everyMs ?? false
  )
}

// When each polling query first saw something settling, under the clock's
// current epoch. Keyed by the query object, so a dropped query takes its
// entry with it.
const settlingSince = new WeakMap<object, { epoch: number; since: number }>()
let epoch = 0

/**
 * Start every settling poll's clock again: a review write (or a batch) can
 * start a new publish in a list whose poll already gave up on an older one.
 */
export function restartSettlingClock() {
  epoch += 1
}

/**
 * `refetchInterval` for a query holding rows: poll while at least one is in
 * flight, backing off (`settlingBackoff`) from when this query first saw it,
 * and stop at the cap. A publish that never settles still turns `failed`
 * through the minute cron; the operator sees it on the next focus or write.
 * Without `query` there is no clock, so the poll is the fixed 5 s.
 */
export function settlingInterval(
  statuses: readonly (string | null | undefined)[],
  query?: object,
  now: number = Date.now()
): number | false {
  if (!statuses.some(isSettling)) {
    if (query) settlingSince.delete(query)
    return false
  }
  if (!query) return SETTLING_POLL_MS
  let entry = settlingSince.get(query)
  if (!entry || entry.epoch !== epoch) {
    entry = { epoch, since: now }
    settlingSince.set(query, entry)
  }
  return settlingBackoff(now - entry.since)
}
