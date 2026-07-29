import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { secretEqual } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { linkedLocations, syncLinkedLocation } from "@/lib/server/reviews"
import { getSession, requireRole } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  externalLocationIds: z.array(z.uuid()).max(50).optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
})

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = await getSession()
    const cronToken = request.headers
      .get("authorization")
      ?.replace(/^Bearer /, "")
    if (!session && !secretEqual(cronToken, getServerEnv().CRON_SECRET)) {
      throw new ApiError(
        401,
        "authentication_required",
        "Authentication required."
      )
    }
    if (session) requireRole(session, ["owner", "admin"])
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = inputSchema.parse(await request.json().catch(() => ({})))
    const correlationId = rid.id
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
    const organisations = []
    for (const organisationId of organisationIds) {
      const locations = await withTenant(organisationId, async (sql) => {
        const linked = await linkedLocations(
          sql,
          session ? input.externalLocationIds : undefined
        )
        await writeAudit(sql, {
          organisationId,
          actorUserId: session?.userId ?? null,
          action: "sync.reconcile.started",
          subjectType: "organisation",
          subjectId: organisationId,
          requestId: `${correlationId}:${organisationId}:started`,
          metadata: {
            externalLocationIds: linked.map(
              (location) => location.externalLocationId
            ),
            clientRequestId: rid.clientId,
          },
        })
        const results = []
        for (const location of linked) {
          const sync = await syncLinkedLocation(sql, organisationId, location, {
            type: "reconcile",
            maxPages: 2,
          })
          results.push({
            externalLocationId: location.externalLocationId,
            ...sync,
          })
        }
        await writeAudit(sql, {
          organisationId,
          actorUserId: session?.userId ?? null,
          action: results.some((location) => "error" in location)
            ? "sync.reconcile.failed"
            : "sync.reconcile.completed",
          subjectType: "organisation",
          subjectId: organisationId,
          requestId: `${correlationId}:${organisationId}:finished`,
          metadata: {
            locations: results,
            clientRequestId: rid.clientId,
          },
        })
        return results
      })
      organisations.push({ organisationId, locations })
    }
    return NextResponse.json({
      organisations,
      nextOrganisationCursor:
        !session && organisationIds.length === input.maxOrganisations
          ? organisationIds.at(-1)
          : null,
      ...(session ? { locations: organisations[0]?.locations ?? [] } : {}),
    })
  } catch (error) {
    return apiError(error)
  }
}
