import { NextResponse } from "next/server"
import { z } from "zod"

import { secretEqual } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError } from "@/lib/server/http"
import { syncDueKeywords } from "@/lib/server/keywords"
import { withAdvisoryLock } from "@/lib/server/leases"
import { getSession, requireRole } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  externalLocationId: z.uuid().optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
  maxLocations: z.number().int().min(1).max(25).default(10),
})

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const cronToken = request.headers
      .get("authorization")
      ?.replace(/^Bearer /, "")
    if (!session && !secretEqual(cronToken, getServerEnv().CRON_SECRET)) {
      throw new ApiError(401, "authentication_required", "Authentication required.")
    }
    if (session) requireRole(session, ["owner", "admin"])
    if (!getServerEnv().GBP_KEYWORDS_ENABLED) {
      throw new ApiError(
        503,
        "keywords_paused",
        "Google search-keyword ingestion is paused."
      )
    }
    const input = inputSchema.parse(await request.json().catch(() => ({})))
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
    return NextResponse.json({
      organisations: skipped ? [] : result,
      skipped,
      nextCursor:
        !session && organisationIds.length === input.maxOrganisations
          ? organisationIds.at(-1)
          : null,
    })
  } catch (error) {
    return apiError(error)
  }
}
