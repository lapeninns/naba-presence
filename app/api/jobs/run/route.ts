import { runDueJobs } from "@/lib/server/jobs"
import { withAdvisoryLock } from "@/lib/server/leases"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

// One drain of due webhook, checkpoint and publish-recovery work, bounded by
// the tick budget so the fleet lock is never held past the function limit.
function runJobsTick(requestId: string) {
  return withAdvisoryLock("naba:jobs", () =>
    runDueJobs({ budgetMs: 45_000, requestId })
  )
}

export const POST = route({
  auth: "cron",
  // The tick's request id correlates every audit row it writes - the
  // dead-lettered webhooks and the exhausted recoveries - with this run.
  handler: ({ requestId }) => runJobsTick(requestId),
})

// Vercel Cron entry point: Vercel fires HTTP GET with no body, so this runs
// the same single tick the scheduler used to POST every 60 seconds. The
// cron bearer arrives as the `Authorization` header automatically when
// `CRON_SECRET` is set on the Vercel project.
export const GET = route({
  auth: "cron",
  handler: ({ requestId }) => runJobsTick(requestId),
})
