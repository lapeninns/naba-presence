import "server-only"

/**
 * How long a listing editor serves the Google state it last observed before
 * reading Google again (W3-2, AR-4). The photos cache's budget (media.ts).
 * Publishing never relies on it: every publish reads Google live under its
 * write session and checks the reviewed snapshot against that read.
 */
export const EDITOR_FRESHNESS_MS = 5 * 60 * 1000

/**
 * True when an editor must read Google: there is no observation, it is older
 * than the budget (or unparseable), or the caller asked for a refresh.
 */
export function shouldReadLive(input: {
  observedAt: Date | string | null | undefined
  refresh?: boolean
  maxAgeMs?: number
  now?: number
}): boolean {
  if (input.refresh) return true
  if (!input.observedAt) return true
  const age = (input.now ?? Date.now()) - new Date(input.observedAt).getTime()
  return (
    !Number.isFinite(age) ||
    Math.abs(age) > (input.maxAgeMs ?? EDITOR_FRESHNESS_MS)
  )
}
