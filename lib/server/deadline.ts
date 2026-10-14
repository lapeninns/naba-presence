/**
 * Request deadlines: one wall-clock budget for everything a request does.
 *
 * Per-call timeouts (OPENAI_TIMEOUT_MS, GOOGLE_TIMEOUT_MS) bound one provider
 * call each, but a request that makes several of them in a row can still run
 * past its route's `maxDuration`, and then the platform kills the function
 * between two steps (an AI credit settled with no draft stored, a backfill
 * with no completion audit). A deadline is the instant by which the request
 * must have finished its provider work: the wrapper derives it from the
 * route's `maxDuration` (`ctx.deadline`, lib/server/route.ts) and the
 * handler passes it down as a plain `deadline: number` (epoch ms), so any
 * service can take one without importing the wrapper.
 *
 * Services use it two ways: size each provider call to what is left
 * (`timeoutWithin`), and stop before starting a step that cannot finish
 * (`hasTimeFor`), reporting the work they did not reach rather than being
 * killed half-way through it.
 */

/**
 * Taken off `maxDuration` so the response (and any commit the handler makes
 * after its last provider call) still gets out before the platform kills
 * the function.
 */
export const DEADLINE_MARGIN_MS = 5_000

/**
 * The deadline for a request that started at `startedAt` (epoch ms) on a
 * route whose `maxDuration` is `maxDurationSeconds`.
 */
export function requestDeadline(
  startedAt: number,
  maxDurationSeconds: number
): number {
  return startedAt + maxDurationSeconds * 1_000 - DEADLINE_MARGIN_MS
}

/** Milliseconds left before `deadline`; 0 once it has passed. */
export function remainingMs(deadline: number, now = Date.now()): number {
  return Math.max(0, deadline - now)
}

/** True when at least `ms` remain before `deadline`. */
export function hasTimeFor(deadline: number, ms: number, now = Date.now()) {
  return remainingMs(deadline, now) >= ms
}

/**
 * A provider call's timeout: its own cap, shortened to what is left before
 * `deadline` after keeping `reserveMs` back for the steps that must follow
 * it. 0 means there is no time left to start the call.
 */
export function timeoutWithin(
  deadline: number | undefined,
  capMs: number,
  reserveMs = 0,
  now = Date.now()
): number {
  if (deadline === undefined) return capMs
  return Math.max(0, Math.min(capMs, remainingMs(deadline, now) - reserveMs))
}
