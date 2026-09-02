import { keywordsSyncSchema } from "@/lib/contracts/sync"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { syncDueKeywords } from "@/lib/server/keywords"
import { withAdvisoryLock } from "@/lib/server/leases"
import { isCronRequest, route } from "@/lib/server/route"
import { getSession, requireRole } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

// Session-or-cron hybrid: an owner/admin session syncs its own organisation,
// the cron token (no session) walks every organisation. Declared `public` so
// the wrapper enforces neither mode; authentication, role gating and body
// parsing run here in the original order (401, 403, 400).
async function authenticate(request: Request) {
  const session = await getSession()
  if (!session && !isCronRequest(request)) {
    throw new ApiError(401, "authentication_required", "Authentication required.")
  }
  if (session) requireRole(session, ["owner", "admin"])
  return session
}

export const POST = route({
  auth: "public",
  handler: async ({ request }) => {
    const session = await authenticate(request)
    const input = keywordsSyncSchema.parse(await request.json().catch(() => ({})))
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
    const result = await withAdvisoryLock("naba:keywords", async () => {
      const organisations = []
      for (const organisationId of organisationIds) {
        organisations.push({
          organisationId,
          outcomes: await syncDueKeywords(organisationId, {
            externalLocationId: input.externalLocationId,
            maxLocations: input.maxLocations,
          }),
        })
      }
      return organisations
    })
    const skipped = !Array.isArray(result)
    return {
      organisations: skipped ? [] : result,
      skipped,
      nextCursor:
        !session && organisationIds.length === input.maxOrganisations
          ? organisationIds.at(-1)
          : null,
    }
  },
})
