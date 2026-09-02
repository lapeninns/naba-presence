import { runDueJobs } from "@/lib/server/jobs"
import { withAdvisoryLock } from "@/lib/server/leases"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  auth: "cron",
  handler: () =>
    withAdvisoryLock("naba:jobs", () => runDueJobs({ budgetMs: 45_000 })),
})
