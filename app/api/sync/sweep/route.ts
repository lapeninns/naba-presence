import type { z } from "zod"

import { sweepSchema } from "@/lib/contracts/sync"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
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
    return runSweepPage({ session, input, requestId })
  },
})

// Vercel Cron entry point: the same single page the scheduler POSTed daily,
// with the schema fields as query params
// (`?maxOrganisations=1&maxPagesPerLocation=5`). Cron-only — an owner/admin
// session sweeping its own organisation keeps using POST. The kill switch is
// checked before parsing, preserving the POST order of 401, 503, then 400.
export const GET = route({
  auth: "cron",
  handler: async ({ query, requestId }) => {
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    return runSweepPage({
      session: null,
      input: sweepSchema.parse(cronPageInput(query)),
      requestId,
    })
  },
})

// One page of the tenant walk, shared by the session POST (own organisation)
// and the cron GET (whole fleet).
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
