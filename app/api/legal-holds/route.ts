import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const createSchema = z.object({
  reviewId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
})
const releaseSchema = z.object({ reviewId: z.uuid() })

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const holds = await tenant(
      (sql) => sql`
        select
          h.id::text as id,
          h.review_id::text as "reviewId",
          h.reason,
          h.approved_by::text as "approvedBy",
          h.released_by::text as "releasedBy",
          h.released_at as "releasedAt",
          h.created_at as "createdAt"
        from legal_hold h
        order by h.created_at desc
      `
    )
    return { holds }
  },
})

export const POST = route({
  roles: ["owner"],
  body: createSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const hold = await tenant(async (sql) => {
      const [review] = await sql<{ id: string }[]>`
        select id::text as id from review where id = ${input.reviewId} limit 1
      `
      if (!review) {
        throw new ApiError(404, "review_not_found", "Review not found.")
      }
      const [row] = await sql`
        insert into legal_hold (
          organisation_id,
          review_id,
          reason,
          approved_by
        )
        values (
          ${session.organisationId},
          ${input.reviewId},
          ${input.reason},
          ${session.userId}
        )
        on conflict (organisation_id, review_id) do update
        set
          reason = excluded.reason,
          approved_by = excluded.approved_by,
          released_by = null,
          released_at = null
        returning
          id::text as id,
          review_id::text as "reviewId",
          reason,
          approved_by::text as "approvedBy",
          created_at as "createdAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "legal_hold.applied",
        subjectType: "review",
        subjectId: input.reviewId,
        requestId,
        metadata: {
          reason: input.reason,
          clientRequestId,
        },
      })
      return row
    })
    return NextResponse.json({ hold }, { status: 201 })
  },
})

export const DELETE = route({
  roles: ["owner"],
  body: releaseSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const released = await tenant(async (sql) => {
      const [row] = await sql`
        update legal_hold
        set released_by = ${session.userId}, released_at = now()
        where review_id = ${input.reviewId}
          and released_at is null
        returning id
      `
      if (!row) {
        throw new ApiError(
          404,
          "legal_hold_not_found",
          "Active legal hold not found."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "legal_hold.released",
        subjectType: "review",
        subjectId: input.reviewId,
        requestId,
        metadata: { clientRequestId },
      })
      return true
    })
    return { released }
  },
})
