import { runDueJobs } from "@/lib/server/jobs"
import { withAdvisoryLock } from "@/lib/server/leases"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  auth: "cron",
  // The tick's request id correlates every audit row it writes - the
  // dead-lettered webhooks and the exhausted recoveries - with this run.
  handler: ({ requestId }) =>
    withAdvisoryLock("naba:jobs", () =>
      runDueJobs({ budgetMs: 45_000, requestId })
    ),
})
