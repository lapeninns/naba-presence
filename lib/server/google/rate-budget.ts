import "server-only"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * The fleet-wide Google budget (0049). Every instance takes a slot from the
 * same Postgres counter before calling Google, so cron workers, webhook
 * handling and interactive requests together stay under Business Profile's
 * per-API limit and its per-profile edit limit. The process-local pacer in
 * transport.ts still smooths bursts within one instance; this is what makes
 * the limit hold across all of them.
 *
 * It fails open. A budget that cannot be read within BUDGET_TIMEOUT_MS
 * (a saturated pool, a database blip) lets the request go on local pacing
 * alone and logs it, because a request that waits forever for a counter is
 * worse than one Google might answer 429 -- which the transport then turns
 * into a fleet-wide block.
 */

/**
 * Per-API buckets use 10-second windows holding a sixth of the per-minute
 * figure; per-profile edit buckets use one-minute windows holding half of
 * it, so a person saving a few fields in a row is not made to wait while the
 * rolling minute still stays under Google's limit. In both, any rolling
 * minute spans at most (60 / window + 1) windows.
 */
export const BUDGET_WINDOW_SECONDS = 10
const EDIT_WINDOW_SECONDS = 60
const WINDOWS_PER_MINUTE = 60 / BUDGET_WINDOW_SECONDS
const BUDGET_TIMEOUT_MS = 2_000
/** Retry-After Google did not state: back off this long. */
const DEFAULT_THROTTLE_MS = 30_000

/**
 * Slots per window for a per-minute limit. Any rolling minute spans at most
 * WINDOWS_PER_MINUTE + 1 windows, so this keeps the true rolling rate at or
 * under (windows + 1) / windows of the configured figure -- which is why the
 * configured defaults sit below Google's hard limits.
 */
export function windowCapacity(perMinute: number): number {
  return Math.max(1, Math.floor(perMinute / WINDOWS_PER_MINUTE))
}

/** Worst case requests in any rolling minute for a per-minute setting. */
export function worstRollingMinute(perMinute: number): number {
  return windowCapacity(perMinute) * (WINDOWS_PER_MINUTE + 1)
}

export function editWindowCapacity(perMinute: number): number {
  return Math.max(1, Math.floor(perMinute / 2))
}

/** Worst case edits to one profile in any rolling minute. */
export function worstRollingMinuteOfEdits(perMinute: number): number {
  return editWindowCapacity(perMinute) * 2
}

type Budget = {
  bucket: string
  perMinute: number
  capacity: number
  windowSeconds: number
}

/**
 * The budgets one request draws from: its API's, and for a write to a
 * location through the Business Information API, that profile's edit
 * budget. Google's "10 edits per minute per Business Profile" is a Business
 * Information limit; review replies, posts and media go through other
 * surfaces and are bounded by their API's budget only. Quota is per API
 * service, which is the host. The OAuth and OpenID endpoints are not
 * Business Profile quota and draw nothing.
 */
export function budgetsFor(url: string, mode: "safe" | "mutation"): Budget[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  const host = parsed.hostname
  if (!/^(mybusiness|businessprofileperformance)[a-z]*\.googleapis\.com$/.test(host)) {
    return []
  }
  const env = getServerEnv()
  const perMinute = env.GOOGLE_API_REQUESTS_PER_MINUTE
  const budgets: Budget[] = [
    {
      bucket: host,
      perMinute,
      capacity: windowCapacity(perMinute),
      windowSeconds: BUDGET_WINDOW_SECONDS,
    },
  ]
  if (mode === "mutation" && host === "mybusinessbusinessinformation.googleapis.com") {
    const location = /\/locations\/([^/:]+)/.exec(parsed.pathname)
    if (location) {
      const edits = env.GOOGLE_LOCATION_EDITS_PER_MINUTE
      budgets.push({
        bucket: `edit:locations/${location[1]}`,
        perMinute: edits,
        capacity: editWindowCapacity(edits),
        windowSeconds: EDIT_WINDOW_SECONDS,
      })
    }
  }
  return budgets
}

export function rateDeferredError(waitMs: number) {
  return new ApiError(
    429,
    "google_rate_limited",
    `Google request budget is exhausted; try again in ${Math.ceil(waitMs / 1000)}s.`
  )
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("budget_timeout")), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Wait for a slot in every budget the request draws from, or throw the
 * retryable `google_rate_limited` if one will not open before `deadline`:
 * scheduled work is deferred by its own back-off rather than sleeping out
 * someone else's budget.
 */
export async function acquireGoogleBudget(
  url: string,
  mode: "safe" | "mutation",
  deadline: number
): Promise<void> {
  if (!getServerEnv().GOOGLE_RATE_BUDGET_ENABLED) return
  for (const { bucket, capacity, windowSeconds } of budgetsFor(url, mode)) {
    for (;;) {
      let waitMs: number
      try {
        const [row] = await withTimeout(
          getDatabase()<{ waitMs: number }[]>`
            select take_google_rate_budget(
              ${bucket},
              ${capacity},
              ${windowSeconds}
            ) as "waitMs"
          `,
          BUDGET_TIMEOUT_MS
        )
        waitMs = row?.waitMs ?? 0
      } catch (error) {
        log.warn("google.rate_budget_unavailable", { bucket, error })
        break
      }
      if (waitMs <= 0) break
      if (Date.now() + waitMs >= deadline) {
        log.warn("google.rate_budget_deferred", { bucket, waitMs })
        throw rateDeferredError(waitMs)
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

/** Google answered 429: every instance holds off this API until Retry-After. */
export async function recordGoogleThrottle(
  url: string,
  mode: "safe" | "mutation",
  retryAfterMs: number | null
) {
  if (!getServerEnv().GOOGLE_RATE_BUDGET_ENABLED) return
  const budgets = budgetsFor(url, mode)
  if (budgets.length === 0) return
  try {
    await withTimeout(
      getDatabase()`
        select record_google_throttle(
          ${budgets[0].bucket},
          ${Math.min(Math.max(retryAfterMs ?? DEFAULT_THROTTLE_MS, 1_000), 300_000)}
        )
      `,
      BUDGET_TIMEOUT_MS
    )
  } catch (error) {
    log.warn("google.rate_throttle_record_failed", { error })
  }
}
