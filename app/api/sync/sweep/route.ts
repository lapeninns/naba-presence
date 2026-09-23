import type { z } from "zod"

import { sweepSchema } from "@/lib/contracts/sync"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { withAdvisoryLock } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"
import {
  linkedLocations,
  syncLinkedLocation,
  type SyncOutcome,
} from "@/lib/server/reviews"
import { isCronRequest, route } from "@/lib/server/route"
import { cronPageInput } from "@/lib/server/cron-query"
import { getSession, requireRole, type Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

type SweepFailure = {
  organisationId: string
  externalLocationId: string | null
  errorCode: string
}

// Session-or-cron hybrid: an owner/admin session sweeps its own organisation,
// the cron token (no session) walks every organisation. Declared `public` so
// the wrapper enforces neither mode; authentication, role gating, the kill
// switch and body parsing run here in the original order (401, 403, 503, 400).
async function authenticate(request: Request) {
  const session = await getSession()
  if (!session && !isCronRequest(request)) {
    throw new ApiError(
      401,
      "authentication_required",
      "Authentication required."
    )
  }
  if (session) requireRole(session, ["owner", "admin"])
  return session
}

export const POST = route({
  auth: "public",
  handler: async ({ request, requestId }) => {
    const session = await authenticate(request)
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = sweepSchema.parse(await request.json().catch(() => ({})))
    return session
      ? runSweepPage({ session, input, requestId })
      : enqueueFleetSweep(requestId)
  },
})

// Vercel Cron entry point. Cron-only — an owner/admin session sweeping its
// own organisation keeps using POST. The kill switch is checked before
// parsing, preserving the POST order of 401, 503, then 400. The query is
// still validated so a malformed cron path fails loudly, but a fleet sweep
// no longer pages: it queues every organisation at once.
export const GET = route({
  auth: "cron",
  handler: async ({ query, requestId }) => {
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    sweepSchema.parse(cronPageInput(query))
    return enqueueFleetSweep(requestId)
  },
})

/**
 * A sweep that finished less than this long ago is not queued again, so a
 * retried or doubled cron fire cannot sweep the fleet twice in a day.
 */
const SWEEP_MIN_INTERVAL = "20 hours"

/**
 * The fleet sweep, as a queue.
 *
 * This used to walk organisations inline, one page per cron fire with
 * `maxOrganisations=1`, and nothing followed the cursor: only the first
 * organisation in the tenant order was ever swept. Now one statement arms a
 * `sweep` checkpoint for every linked location in every organisation, and the
 * job runner claims them every minute with its own per-organisation fairness,
 * leases and time budget. A location with more history than one claim's five
 * pages parks with its cursor and resumes on the next day's enqueue.
 *
 * Under the `naba:sweep` lease, which also stamps the tick's heartbeat.
 */
async function enqueueFleetSweep(requestId: string) {
  const result = await withAdvisoryLock("naba:sweep", async () => {
    const [row] = await getDatabase()<
      { organisationCount: number; queued: number }[]
    >`
      select organisation_count as "organisationCount", queued
      from enqueue_sweep_checkpoints(${SWEEP_MIN_INTERVAL}::interval)
    `
    log.info("sweep.enqueued", {
      requestId,
      organisations: row?.organisationCount ?? 0,
      queued: row?.queued ?? 0,
    })
    return row
  })
  if ("skipped" in result) {
    return {
      skipped: true,
      processed: 0,
      queued: 0,
      nextCursor: null,
      failures: [] as SweepFailure[],
    }
  }
  return {
    skipped: false,
    processed: result?.organisationCount ?? 0,
    queued: result?.queued ?? 0,
    // Nothing to page: every organisation was queued in one statement.
    nextCursor: null,
    failures: [] as SweepFailure[],
  }
}

/**
 * The session sweep's wall-clock budget, inside `maxDuration`: without it a
 * location with deep history ran until the platform killed the request,
 * losing the page it was on.
 */
const SESSION_SWEEP_BUDGET_MS = 45_000

// An owner/admin sweeping their own organisation, inline. (`session: null`
// is still accepted so the shape matches the reconcile walk, but the cron
// paths above enqueue instead.)
async function runSweepPage({
  session,
  input,
  requestId,
}: {
  session: Session | null
  input: z.infer<typeof sweepSchema>
  requestId: string
}) {
  // Cross-tenant enumeration: the cron walks every organisation that has a
  // job route, so this one read deliberately runs outside withTenant.
  const organisationIds = session
    ? [session.organisationId]
    : (
        await getDatabase()<{ id: string }[]>`
            select organisation_id::text as id
            from organisation_job_route
            ${
              input.organisationCursor
                ? getDatabase()`where organisation_id > ${input.organisationCursor}`
                : getDatabase()``
            }
            order by organisation_id
            limit ${input.maxOrganisations}
          `
      ).map((organisation) => organisation.id)
  const deadline = Date.now() + SESSION_SWEEP_BUDGET_MS
  const failures: SweepFailure[] = []
  const organisations: Array<{
    organisationId: string
    locations: Array<{ externalLocationId: string } & SyncOutcome>
  }> = []

  for (const organisationId of organisationIds) {
    let locations: Awaited<ReturnType<typeof linkedLocations>>
    try {
      locations = await withTenant(organisationId, (sql) =>
        linkedLocations(sql, input.externalLocationIds)
      )
    } catch (error) {
      failures.push({
        organisationId,
        externalLocationId: null,
        errorCode: "location_discovery_failed",
      })
      // The only trace of this one: nothing else records why discovery
      // failed, and the route wrapper never sees an exception the handler
      // swallows.
      log.error("sweep.location_discovery_failed", {
        organisationId,
        error,
      })
      continue
    }
    const results: Array<{ externalLocationId: string } & SyncOutcome> = []
    for (const location of locations) {
      try {
        const outcome = await syncLinkedLocation({
          organisationId,
          externalLocationId: location.externalLocationId,
          type: "sweep",
          maxPages: input.maxPagesPerLocation,
          requestId,
          deadline,
        })
        results.push({
          externalLocationId: location.externalLocationId,
          ...outcome,
        })
        if (outcome.status === "failed") {
          failures.push({
            organisationId,
            externalLocationId: location.externalLocationId,
            errorCode: outcome.errorCode ?? "sweep_failed",
          })
        }
      } catch (error) {
        failures.push({
          organisationId,
          externalLocationId: location.externalLocationId,
          errorCode: "sweep_failed",
        })
        log.error("sweep.location_failed", {
          organisationId,
          externalLocationId: location.externalLocationId,
          error,
        })
      }
    }
    organisations.push({ organisationId, locations: results })
  }

  const nextCursor =
    !session && organisationIds.length === input.maxOrganisations
      ? (organisationIds.at(-1) ?? null)
      : null
  return {
    processed: organisationIds.length,
    nextCursor,
    failures,
    ...(session ? { locations: organisations[0]?.locations ?? [] } : {}),
  }
}
