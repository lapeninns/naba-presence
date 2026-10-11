import { ApiError } from "@/lib/server/http"
import { withAdvisoryLock } from "@/lib/server/leases"
import { runRetentionCycle } from "@/lib/server/retention/cycle"
import { retainPage } from "@/lib/server/retention/purge"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Two shapes on one route:
 *
 * - no `cursor` parameter: the scheduled dispatcher (vercel.json fires it
 *   every five minutes). It resumes or opens the day's retention cycle and
 *   works through it for one time budget (lib/server/retention/cycle.ts).
 * - `cursor` present (empty for the head of the fleet): one hand-run page of
 *   up to `batch_size` organisations, as before the dispatcher. A page never
 *   moves the cycle and is recorded as a manual run, so it cannot make a dead
 *   dispatcher look alive.
 *
 * `batch_size` (1-100, default 25 for a page, 100 for the dispatcher) is the
 * page size in both.
 */
type RetentionQuery =
  | { mode: "cycle"; batchSize: number }
  | { mode: "page"; cursor: string | null; batchSize: number }

function retentionQuery(searchParams: URLSearchParams): RetentionQuery {
  const requested = searchParams.get("batch_size")
  const size = (fallback: number) =>
    Math.min(100, Math.max(1, Number(requested ?? fallback) || fallback))
  if (!searchParams.has("cursor")) {
    return { mode: "cycle", batchSize: size(100) }
  }
  const cursor = searchParams.get("cursor") || null
  if (cursor !== null && !UUID.test(cursor)) {
    throw new ApiError(400, "invalid_request", "cursor must be an organisation id.")
  }
  return { mode: "page", cursor, batchSize: size(25) }
}

function runRetentionTick({
  requestId,
  clientRequestId,
  query,
}: {
  requestId: string
  clientRequestId: string | null
  query: RetentionQuery
}) {
  if (query.mode === "page") {
    return withAdvisoryLock(
      "naba:retention",
      () =>
        retainPage({
          requestId,
          clientRequestId,
          cursor: query.cursor,
          batchSize: query.batchSize,
        }),
      { trigger: "manual" }
    )
  }
  // The cycle reports its own completion to the tick ledger
  // (recordTickCycleCompleted) from inside this lease; each fire that runs
  // moves the tick's heartbeat whether or not the cycle finished.
  return withAdvisoryLock("naba:retention", () =>
    runRetentionCycle({
      requestId,
      clientRequestId,
      pageSize: query.batchSize,
    })
  )
}

export const POST = route({
  auth: "cron",
  query: retentionQuery,
  handler: ({ requestId, clientRequestId, query }) =>
    runRetentionTick({ requestId, clientRequestId, query }),
})

// Vercel Cron entry point: identical to POST. The route takes its input from
// the query string with an empty body, so the cron fires it unchanged.
export const GET = route({
  auth: "cron",
  query: retentionQuery,
  handler: ({ requestId, clientRequestId, query }) =>
    runRetentionTick({ requestId, clientRequestId, query }),
})
