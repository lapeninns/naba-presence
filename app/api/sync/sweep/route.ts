import { sweepSchema } from "@/lib/contracts/sync"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  linkedLocations,
  syncLinkedLocation,
  type SyncOutcome,
} from "@/lib/server/reviews"
import { isCronRequest, route } from "@/lib/server/route"
import { getSession, requireRole } from "@/lib/server/session"

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
  handler: async ({ request }) => {
    const session = await authenticate(request)
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = sweepSchema.parse(await request.json().catch(() => ({})))
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
      } catch {
        failures.push({
          organisationId,
          externalLocationId: null,
          errorCode: "location_discovery_failed",
        })
        continue
      }
      const results: Array<
        { externalLocationId: string } & SyncOutcome
      > = []
      for (const location of locations) {
        try {
          const outcome = await syncLinkedLocation({
            organisationId,
            externalLocationId: location.externalLocationId,
            type: "sweep",
            maxPages: input.maxPagesPerLocation,
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
        } catch {
          failures.push({
            organisationId,
            externalLocationId: location.externalLocationId,
            errorCode: "sweep_failed",
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
  },
})
