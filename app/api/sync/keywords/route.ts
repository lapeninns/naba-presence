import type { z } from "zod"

import { keywordsSyncSchema } from "@/lib/contracts/sync"
import { takeAbuseBudget } from "@/lib/server/abuse-limits"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { syncDueKeywords, type KeywordSyncOutcome } from "@/lib/server/keywords"
import { withFleetLease } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"
import { isCronRequest, route } from "@/lib/server/route"
import { cronPageInput } from "@/lib/server/cron-query"
import { enqueueRecurring } from "@/lib/server/recurring-sync"
import { getSession, requireRole, type Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

type OrganisationFailure = { organisationId: string; errorCode: string }
type OrganisationResult = {
  organisationId: string
  outcomes: KeywordSyncOutcome[]
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
  const configured = Number(process.env.KEYWORDS_BUDGET_MS ?? 45_000)
  return Number.isFinite(configured) && configured >= 0 ? configured : 45_000
}

export const POST = route({
  maxDuration,
  auth: "public",
  origin: "same",
  handler: async ({ request, requestId }) => {
    const session = await authenticate(request)
    // A person's sync is counted (W3-07): it pages Google inline against the
    // budget every tenant shares. The cron is not.
    if (session) {
      await takeAbuseBudget("sync_manual", {
        user: session.userId,
        organisation: session.organisationId,
      })
    }
    const input = keywordsSyncSchema.parse(
      await request.json().catch(() => ({}))
    )
    return runKeywordsPage({ session, input, requestId })
  },
})

// Vercel Cron entry point: the same single page the scheduler POSTed daily,
// with the schema fields as query params
// (`?maxOrganisations=100&maxLocations=10`). Cron-only — an owner/admin
// session refreshing its own organisation keeps using POST.
// Vercel Cron entry point. Enqueues rather than walks (0048): every linked
// location in every organisation gets its `keywords` checkpoint, and the job
// runner claims the due ones every minute. The query is still validated so a
// malformed cron path fails loudly. The ingestion kill switch is enforced at
// the runner's claim; enqueueing while paused is harmless.
export const GET = route({
  maxDuration,
  auth: "cron",
  handler: async ({ query, requestId }) => {
    keywordsSyncSchema.parse(cronPageInput(query))
    return enqueueRecurring("keywords", requestId)
  },
})

// One page of the tenant walk, shared by the session POST (own organisation)
// and the cron GET (whole fleet). `session: null` selects the isolating cron
// branch: one organisation's failure is recorded, never thrown.
async function runKeywordsPage({
  session,
  input,
  requestId,
}: {
  session: Session | null
  input: z.infer<typeof keywordsSyncSchema>
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
  const result = await withFleetLease("naba:keywords", async () => {
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
        // The same deadline inside the organisation: up to maxLocations
        // paced Google reads (keywords restate several months each) would
        // otherwise run on past the budget while holding the fleet lease.
        const synced = await syncDueKeywords(organisationId, {
          requestId,
          externalLocationId: input.externalLocationId,
          maxLocations: input.maxLocations,
          deadline,
        })
        organisations.push({ organisationId, outcomes: synced.outcomes })
        if (synced.truncated) budgetExhausted = true
      } catch (error) {
        // A session syncs one organisation and owns the error: the kill
        // switch's 503 and everything else must reach the caller. The cron
        // walk isolates instead, so one organisation cannot discard the
        // organisations after it.
        if (session) throw error
        const errorCode =
          error instanceof ApiError ? error.code : "internal_error"
        failures.push({ organisationId, errorCode })
        log.error("keywords.organisation_failed", {
          requestId,
          organisationId,
          error,
        })
      }
      processed += 1
      lastProcessedOrganisationId = organisationId
      // Stopped inside this organisation. Its unclaimed locations stay due
      // and keep their place at the head of the next claim; the cursor moves
      // past it so the organisations after it are not starved.
      if (budgetExhausted) break
    }
    return {
      organisations,
      failures,
      budgetExhausted,
      lastProcessedOrganisationId,
      skippedOrganisations: organisationIds.length - processed,
    }
    // A session refresh takes the fleet lease too; recorded as manual so it
    // cannot stand in for the cron's heartbeat.
  }, { trigger: session ? "manual" : "cron" })
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
