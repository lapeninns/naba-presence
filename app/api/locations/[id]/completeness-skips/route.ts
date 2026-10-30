import type { TransactionSql } from "postgres"
import { z } from "zod"

import {
  completenessCheckIdSchema,
  completenessSkipInputSchema,
  type CompletenessSkipRecord,
  type CompletenessSkipsResponse,
} from "@/lib/listings/completeness-contract"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { readCompletenessSkipRows } from "@/lib/server/listing-completeness"
import { requireLocationAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.uuid() })

const NOT_FOUND = {
  code: "location_not_found",
  message: "The requested location was not found.",
}

/**
 * The listing exists in this organisation and the session may see it.
 * Owners and admins get a full grant without a lookup, so the row itself is
 * read here: a listing of another organisation is a 404, and a skip can
 * never point at one.
 */
async function requireListing(
  sql: TransactionSql,
  session: Session,
  id: string
) {
  const [listing] = await sql<{ id: string }[]>`
    select id::text as id from location
    where id = ${id} and organisation_id = ${session.organisationId}
  `
  if (!listing) throw new ApiError(404, NOT_FOUND.code, NOT_FOUND.message)
  await requireLocationAccess(sql, session, id, NOT_FOUND)
}

/**
 * The completeness checks skipped for one listing, with the reason given.
 * Anyone who can see the listing may read them.
 */
export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params, tenant }) =>
    ({
      skips: await tenant(async (sql) => {
        await requireListing(sql, session, params.id)
        const rows = await readCompletenessSkipRows(sql, [params.id])
        return rows.map((row): CompletenessSkipRecord => ({
          checkId: row.checkId,
          reason: row.reason,
          skippedAt: row.skippedAt,
          skippedBy: row.skippedBy,
        }))
      }),
    }) satisfies CompletenessSkipsResponse,
})

/**
 * Stops one check counting for this listing, with a reason. Skipping it
 * again replaces the reason. Owner or admin only, audited.
 */
export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: completenessSkipInputSchema,
  handler: async ({ session, params, body, requestId, tenant }) => {
    const skip = await tenant(async (sql) => {
      await requireListing(sql, session, params.id)
      // One writer per listing and check at a time: two people replacing the
      // same skip at once queue here instead of racing the unique key.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${params.id}:completeness_skip:${body.checkId}`}, 0))`
      const [previous] = await sql<{ reason: string }[]>`
        delete from listing_completeness_skip
        where location_id = ${params.id} and check_id = ${body.checkId}
        returning reason
      `
      const [row] = await sql<{ id: string; skippedAt: Date }[]>`
        insert into listing_completeness_skip (
          organisation_id, location_id, check_id, reason, created_by
        ) values (
          ${session.organisationId}, ${params.id}, ${body.checkId},
          ${body.reason}, ${session.userId}
        )
        returning id::text as id, created_at as "skippedAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "listing_completeness.check_skipped",
        subjectType: "listing_completeness_skip",
        subjectId: row.id,
        requestId,
        metadata: {
          locationId: params.id,
          checkId: body.checkId,
          reason: body.reason,
          previousReason: previous?.reason ?? null,
        },
      })
      return {
        checkId: body.checkId,
        reason: body.reason,
        skippedAt: row.skippedAt.toISOString(),
        skippedBy: session.displayName,
      } satisfies CompletenessSkipRecord
    })
    return { skip }
  },
})

/**
 * Counts the check again. Removing a skip that isn't there is a no-op, not
 * an error. Owner or admin only, audited.
 */
export const DELETE = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  query: z.object({ checkId: completenessCheckIdSchema }),
  handler: async ({ session, params, query, requestId, tenant }) => {
    const removed = await tenant(async (sql) => {
      await requireListing(sql, session, params.id)
      const [row] = await sql<{ id: string; reason: string }[]>`
        delete from listing_completeness_skip
        where location_id = ${params.id} and check_id = ${query.checkId}
        returning id::text as id, reason
      `
      if (!row) return false
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "listing_completeness.skip_removed",
        subjectType: "listing_completeness_skip",
        subjectId: row.id,
        requestId,
        metadata: {
          locationId: params.id,
          checkId: query.checkId,
          reason: row.reason,
        },
      })
      return true
    })
    return { removed }
  },
})
