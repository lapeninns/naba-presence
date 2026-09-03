import type { z } from "zod"

import { performanceSyncSchema } from "@/lib/contracts/sync"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { withAdvisoryLock } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"
import {
  syncDuePerformance,
  type PerformanceSyncOutcome,
} from "@/lib/server/performance"
import { isCronRequest, route } from "@/lib/server/route"
import { cronPageInput } from "@/lib/server/cron-query"
import { getSession, requireRole, type Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

type OrganisationFailure = { organisationId: string; errorCode: string }
type OrganisationResult = {
  organisationId: string
  outcomes: PerformanceSyncOutcome[]
}

// Session-or-cron hybrid: an owner/admin session syncs its own organisation,
// the cron token (no session) walks every organisation. Declared `public` so
// the wrapper enforces neither mode; authentication, role gating and body
// parsing run here in the original order (401, 403, 400).
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

function budgetMs() {
  const configured = Number(process.env.PERFORMANCE_BUDGET_MS ?? 45_000)
  return Number.isFinite(configured) && configured >= 0 ? configured : 45_000
}

export const POST = route({
  auth: "public",
  handler: async ({ request, requestId }) => {
    const session = await authenticate(request)
    const input = performanceSyncSchema.parse(
      await request.json().catch(() => ({}))
    )
    return runPerformancePage({ session, input, requestId })
  },
})

// Vercel Cron entry point: the same single page the scheduler POSTed every
// 6 hours, with the schema fields as query params
// (`?maxOrganisations=100&maxLocations=25`). Cron-only — an owner/admin
// session refreshing its own organisation keeps using POST.
export const GET = route({
  auth: "cron",
  handler: async ({ query, requestId }) =>
    runPerformancePage({
      session: null,
      input: performanceSyncSchema.parse(cronPageInput(query)),
      requestId,
    }),
})

// One page of the tenant walk, shared by the session POST (own organisation)
// and the cron GET (whole fleet). `session: null` selects the isolating cron
// branch: one organisation's failure is recorded, never thrown.
async function runPerformancePage({
  session,
  input,
  requestId,
}: {
  session: Session | null
  input: z.infer<typeof performanceSyncSchema>
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
            where organisation_id::text > ${input.organisationCursor ?? ""}
            order by organisation_id
            limit ${input.maxOrganisations}
          `
      ).map((row) => row.id)
  const deadline = Date.now() + budgetMs()
  const result = await withAdvisoryLock("naba:performance", async () => {
    const organisations: OrganisationResult[] = []
    const failures: OrganisationFailure[] = []
    let processed = 0
    let budgetExhausted = false
    let lastProcessedOrganisationId: string | null = null
    for (const organisationId of organisationIds) {
      // The scheduler's 55s client abort closes the socket but does not
      // stop this handler, so the budget is what bounds the response, keeps
      // the fleet lock from being held for the whole walk, and gets a
      // cursor back to the caller — without one, a fleet larger than
      // maxOrganisations never gets past its first page.
      if (processed > 0 && Date.now() >= deadline) {
        budgetExhausted = true
        break
      }
      try {
        organisations.push({
          organisationId,
          outcomes: await syncDuePerformance(organisationId, {
            requestId,
            externalLocationId: input.externalLocationId,
            maxLocations: input.maxLocations,
          }),
        })
      } catch (error) {
        // A session syncs one organisation and owns the error: the kill
        // switch's 503 and everything else must reach the caller. The cron
        // walk isolates instead, so one organisation cannot discard the
        // organisations after it.
        if (session) throw error
        const errorCode =
          error instanceof ApiError ? error.code : "internal_error"
        failures.push({ organisationId, errorCode })
        log.error("performance.organisation_failed", {
          requestId,
          organisationId,
          error,
        })
      }
      processed += 1
      lastProcessedOrganisationId = organisationId
    }
    return {
      organisations,
      failures,
      budgetExhausted,
      lastProcessedOrganisationId,
      skippedOrganisations: organisationIds.length - processed,
    }
  })
  if ("skipped" in result) {
    // The cron branch reports the skip; a manual refresh must not, or the
    // button clears itself and the user reads unchanged numbers as fresh.
    if (session) {
      throw new ApiError(
        409,
        "sync_in_progress",
        "A Google refresh is already running. Please try again in a moment."
      )
    }
    return {
      organisations: [],
      skipped: true,
      failures: [],
      truncated: false,
      skippedOrganisations: organisationIds.length,
      nextCursor: null,
    }
  }
  return {
    organisations: result.organisations,
    skipped: false,
    failures: result.failures,
    truncated: result.budgetExhausted,
    skippedOrganisations: result.skippedOrganisations,
    nextCursor:
      !session &&
      (result.budgetExhausted ||
        organisationIds.length === input.maxOrganisations)
        ? result.lastProcessedOrganisationId
        : null,
  }
}
