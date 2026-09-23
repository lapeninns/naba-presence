import type { z } from "zod"

import { reconcileSchema } from "@/lib/contracts/sync"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { withAdvisoryLock } from "@/lib/server/leases"
import {
  linkedLocations,
  syncLinkedLocation,
  type SyncOutcome,
} from "@/lib/server/reviews"
import { isCronRequest, route } from "@/lib/server/route"
import { cronPageInput } from "@/lib/server/cron-query"
import { followCronCursor } from "@/lib/server/cron-cursor"
import { getSession, requireRole, type Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

type ReconcileFailure = {
  organisationId: string
  externalLocationId: string | null
  errorCode: string
}

type ReconcileInput = {
  session: Session | null
  input: z.infer<typeof reconcileSchema>
  requestId: string
  clientRequestId: string | null
}

// Session-or-cron hybrid: an owner/admin session reconciles its own
// organisation, the cron token (no session) walks every organisation.
// Declared `public` so the wrapper enforces neither mode; authentication,
// role gating, the kill switch and body parsing run in the handler in the
// original order (401, 403, 503, 400), all of it before the advisory lock so
// an unauthenticated request never contends for the fleet lock.
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

async function reconcile({
  session,
  input,
  requestId,
  clientRequestId,
}: ReconcileInput) {
  const correlationId = requestId
  const configuredBudget = Number(process.env.RECONCILE_BUDGET_MS ?? 45_000)
  const deadline =
    Date.now() +
    (Number.isFinite(configuredBudget) && configuredBudget >= 0
      ? configuredBudget
      : 45_000)
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
  const failures: ReconcileFailure[] = []
  const organisations = []
  let processed = 0
  let budgetExhausted = false
  // Seeded from the incoming cursor, not null: breaking inside the FIRST
  // organisation of a tick must leave the cursor where it was, or the next
  // tick restarts at the head of the tenant order and starves every
  // organisation after it -- the exact starvation the inner deadline exists
  // to prevent.
  let lastProcessedOrganisationId: string | null =
    input.organisationCursor ?? null
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
            clientRequestId,
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
    const results: Array<{ externalLocationId: string } & SyncOutcome> = []
    let locationBudgetExhausted = false
    for (const location of linked) {
      // The walk has to yield between locations, not only between tenants:
      // one organisation's locations can outlast the caller's abort on their
      // own, and every tenant ordered after it is then never reached. The
      // first location of the tick still runs, so a tick always progresses.
      if ((processed > 0 || results.length > 0) && Date.now() >= deadline) {
        locationBudgetExhausted = true
        break
      }
      try {
        const sync = await syncLinkedLocation({
          organisationId,
          externalLocationId: location.externalLocationId,
          type: "reconcile",
          maxPages: 20,
          requestId,
          deadline,
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
          action: results.some((location) => location.status === "failed")
            ? "sync.reconcile.failed"
            : "sync.reconcile.completed",
          subjectType: "organisation",
          subjectId: organisationId,
          requestId: `${correlationId}:${organisationId}:finished`,
          metadata: {
            locations: results,
            clientRequestId,
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
    if (locationBudgetExhausted) {
      // The cursor deliberately does not advance past a half-walked
      // organisation: the next tick re-enters it and finishes its remaining
      // locations rather than skipping them until something else fails.
      budgetExhausted = true
      break
    }
    lastProcessedOrganisationId = organisationId
  }
  const nextCursor =
    !session &&
    (budgetExhausted || organisationIds.length === input.maxOrganisations)
      ? lastProcessedOrganisationId
      : null
  return {
    processed,
    nextCursor,
    failures,
    ...(session ? { locations: organisations[0]?.locations ?? [] } : {}),
  }
}

type ReconcilePageInput = {
  session: Session | null
  input: z.infer<typeof reconcileSchema>
  requestId: string
  clientRequestId: string | null
}

// One page of the tenant walk. A lock miss must not read as a finished walk:
// the caller advances off `nextCursor`, so a bare `{ skipped: true }` is
// indistinguishable from "every organisation is done" and the tick would be
// logged as a success.
async function runReconcilePage({
  session,
  input,
  requestId,
  clientRequestId,
}: ReconcilePageInput) {
  const result = await withAdvisoryLock("naba:reconcile", () =>
    reconcile({ session, input, requestId, clientRequestId })
  )
  if ("skipped" in result) {
    return {
      processed: 0,
      nextCursor: null,
      failures: [] as ReconcileFailure[],
      skipped: true,
      ...(session ? { locations: [] } : {}),
    }
  }
  return result
}

export const POST = route({
  auth: "public",
  handler: async ({ request, requestId, clientRequestId }) => {
    const session = await authenticate(request)
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = reconcileSchema.parse(await request.json().catch(() => ({})))
    return runReconcilePage({ session, input, requestId, clientRequestId })
  },
})

// Vercel Cron entry point: the same single page the scheduler POSTed every
// 15 minutes, with the schema fields as query params
// (`?maxOrganisations=100`). Cron-only — an owner/admin session reconciling
// its own organisation keeps using POST. The kill switch is checked before
// parsing, preserving the POST order of 401, 503, then 400.
export const GET = route({
  auth: "cron",
  handler: async ({ query, requestId, clientRequestId }) => {
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    return followCronCursor("reconcile", cronPageInput(query), (input) =>
      runReconcilePage({
        session: null,
        input: reconcileSchema.parse(input),
        requestId,
        clientRequestId,
      })
    )
  },
})
