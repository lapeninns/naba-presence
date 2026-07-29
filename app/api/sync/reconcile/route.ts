import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { secretEqual } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { withAdvisoryLock } from "@/lib/server/leases"
import {
  linkedLocations,
  syncLinkedLocation,
  type SyncOutcome,
} from "@/lib/server/reviews"
import { getSession, requireRole } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  externalLocationIds: z.array(z.uuid()).max(50).optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
})

type ReconcileFailure = {
  organisationId: string
  externalLocationId: string | null
  errorCode: string
}

async function reconcile(request: Request) {
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
    const configuredBudget = Number(
      process.env.RECONCILE_BUDGET_MS ?? 45_000
    )
    const deadline =
      Date.now() +
      (Number.isFinite(configuredBudget) && configuredBudget >= 0
        ? configuredBudget
        : 45_000)
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
    const failures: ReconcileFailure[] = []
    const organisations = []
    let processed = 0
    let budgetExhausted = false
    let lastProcessedOrganisationId: string | null = null
    for (const organisationId of organisationIds) {
      if (processed > 0 && Date.now() >= deadline) {
        budgetExhausted = true
        break
      }
      let linked: Awaited<ReturnType<typeof linkedLocations>>
      try {
        linked = await withTenant(organisationId, async (sql) => {
          const locations = await linkedLocations(
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
              externalLocationIds: locations.map(
                (location) => location.externalLocationId
              ),
              clientRequestId: rid.clientId,
            },
          })
          return locations
        })
      } catch (error) {
        const errorCode =
          error instanceof ApiError ? error.code : "internal_error"
        failures.push({
          organisationId,
          externalLocationId: null,
          errorCode,
        })
        log.error("reconcile.organisation_failed", {
          organisationId,
          error,
        })
        processed += 1
        lastProcessedOrganisationId = organisationId
        continue
      }
      const results: Array<
        { externalLocationId: string } & SyncOutcome
      > = []
      for (const location of linked) {
        try {
          const sync = await syncLinkedLocation({
            organisationId,
            externalLocationId: location.externalLocationId,
            type: "reconcile",
            maxPages: 20,
          })
          results.push({
            externalLocationId: location.externalLocationId,
            ...sync,
          })
          if (sync.status === "failed") {
            failures.push({
              organisationId,
              externalLocationId: location.externalLocationId,
              errorCode: sync.errorCode ?? "sync_failed",
            })
          }
        } catch (error) {
          const errorCode =
            error instanceof ApiError ? error.code : "internal_error"
          failures.push({
            organisationId,
            externalLocationId: location.externalLocationId,
            errorCode,
          })
          log.error("reconcile.location_failed", {
            organisationId,
            externalLocationId: location.externalLocationId,
            error,
          })
        }
      }
      try {
        await withTenant(organisationId, async (sql) => {
          await writeAudit(sql, {
            organisationId,
            actorUserId: session?.userId ?? null,
            action: results.some(
              (location) => location.status === "failed"
            )
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
        })
      } catch (error) {
        failures.push({
          organisationId,
          externalLocationId: null,
          errorCode: "audit_failed",
        })
        log.error("reconcile.audit_failed", {
          organisationId,
          error,
        })
      }
      organisations.push({ organisationId, locations: results })
      processed += 1
      lastProcessedOrganisationId = organisationId
    }
    const nextCursor =
      !session &&
      (budgetExhausted ||
        organisationIds.length === input.maxOrganisations)
        ? lastProcessedOrganisationId
        : null
    return NextResponse.json({
      processed,
      nextCursor,
      failures,
      ...(session ? { locations: organisations[0]?.locations ?? [] } : {}),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const result = await withAdvisoryLock("naba:reconcile", () =>
      reconcile(request)
    )
    return result instanceof NextResponse
      ? result
      : NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
