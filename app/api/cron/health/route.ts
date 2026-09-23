import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { withAdvisoryLock } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"
import {
  deliverPending,
  evaluateOrganisation,
} from "@/lib/server/notifications/evaluate"
import { evaluatePlatform } from "@/lib/server/notifications/platform"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/** Leave room inside maxDuration for the platform pass and the response. */
const BUDGET_MS = 45_000

/**
 * The health tick (every 15 minutes): evaluate every organisation into
 * incidents, send what is due, then check the platform itself.
 *
 * Runs under the `naba:health` lease, which also stamps its heartbeat, so
 * one evaluation runs at a time and a stopped tick shows as stale. One
 * organisation's failure is logged and skipped rather than ending the run.
 * Organisations the budget does not reach this time are reached on a later
 * run: each run starts at a random point in the tenant order, which needs no
 * stored cursor and is fair over runs.
 */
async function runHealthTick(requestId: string) {
  const result = await withAdvisoryLock("naba:health", async () => {
    const deadline = Date.now() + BUDGET_MS
    // Cross-tenant enumeration, as every fleet tick does; each organisation
    // is then evaluated inside its own tenant transaction.
    const organisations = await getDatabase()<{ id: string }[]>`
      select organisation_id::text as id
      from organisation_job_route
      order by organisation_id
    `
    const start = organisations.length
      ? Math.floor(Math.random() * organisations.length)
      : 0
    const ordered = [
      ...organisations.slice(start),
      ...organisations.slice(0, start),
    ]
    const totals = {
      organisations: 0,
      opened: 0,
      resolved: 0,
      deliveriesQueued: 0,
      sent: 0,
      suppressed: 0,
      failed: 0,
      errors: 0,
    }
    for (const organisation of ordered) {
      if (Date.now() >= deadline) break
      try {
        const evaluation = await evaluateOrganisation(organisation.id)
        const delivery = await deliverPending(organisation.id)
        totals.organisations += 1
        totals.opened += evaluation.opened
        totals.resolved += evaluation.resolved
        totals.deliveriesQueued += evaluation.deliveriesQueued
        totals.sent += delivery.sent
        totals.suppressed += delivery.suppressed
        totals.failed += delivery.failed
      } catch (error) {
        totals.errors += 1
        log.error("notifications.organisation_failed", {
          requestId,
          organisationId: organisation.id,
          error,
        })
      }
    }
    const platform = await evaluatePlatform()
    log.info("notifications.tick", { requestId, ...totals, platform })
    return { ...totals, platform }
  })
  if ("skipped" in result) return { skipped: true }
  return { skipped: false, ...result }
}

function assertEnabled() {
  if (!getServerEnv().NOTIFICATIONS_ENABLED) {
    throw new ApiError(503, "notifications_paused", "Notifications are paused.")
  }
}

export const POST = route({
  auth: "cron",
  handler: ({ requestId }) => {
    assertEnabled()
    return runHealthTick(requestId)
  },
})

// Vercel Cron entry point.
export const GET = route({
  auth: "cron",
  handler: ({ requestId }) => {
    assertEnabled()
    return runHealthTick(requestId)
  },
})
