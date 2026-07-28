import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const requestType = z.enum([
  "access",
  "rectification",
  "erasure",
  "restriction",
])
const status = z.enum(["pending", "in_progress", "completed", "rejected"])
const createSchema = z.object({
  requestType,
  subjectReference: z.string().trim().min(3).max(240),
  reason: z.string().trim().max(2000).optional(),
})
const updateSchema = z.object({
  id: z.uuid(),
  status,
  resolutionNote: z.string().trim().min(3).max(2000),
})

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const requests = await withTenant(
      session.organisationId,
      (sql) => sql`
        select
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          reason,
          requested_by::text as "requestedBy",
          resolved_by::text as "resolvedBy",
          resolution_note as "resolutionNote",
          resolved_at as "resolvedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from privacy_request
        order by created_at desc
        limit 500
      `
    )
    return NextResponse.json({ requests })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = createSchema.parse(await request.json())
    const privacyRequest = await withTenant(
      session.organisationId,
      async (sql) => {
        const [row] = await sql`
          insert into privacy_request (
            organisation_id,
            request_type,
            subject_reference,
            reason,
            requested_by
          )
          values (
            ${session.organisationId},
            ${input.requestType},
            ${input.subjectReference},
            ${input.reason ?? null},
            ${session.userId}
          )
          returning
            id::text as id,
            request_type as "requestType",
            status,
            subject_reference as "subjectReference",
            created_at as "createdAt"
        `
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "privacy.request.created",
          subjectType: "privacy_request",
          subjectId: String(row.id),
          requestId: requestId(request),
          metadata: {
            requestType: input.requestType,
            subjectReference: input.subjectReference,
          },
        })
        return row
      }
    )
    return NextResponse.json({ request: privacyRequest }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner"])
    const input = updateSchema.parse(await request.json())
    const privacyRequest = await withTenant(
      session.organisationId,
      async (sql) => {
        const [row] = await sql`
          update privacy_request
          set
            status = ${input.status},
            resolution_note = ${input.resolutionNote},
            resolved_by = case
              when ${input.status} in ('completed', 'rejected')
                then ${session.userId}
              else null
            end,
            resolved_at = case
              when ${input.status} in ('completed', 'rejected') then now()
              else null
            end
          where id = ${input.id}
          returning
            id::text as id,
            request_type as "requestType",
            status,
            subject_reference as "subjectReference",
            resolution_note as "resolutionNote",
            resolved_at as "resolvedAt"
        `
        if (!row) {
          throw new ApiError(
            404,
            "privacy_request_not_found",
            "Privacy request not found."
          )
        }
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "privacy.request.status_changed",
          subjectType: "privacy_request",
          subjectId: input.id,
          requestId: requestId(request),
          metadata: {
            status: input.status,
            resolutionNote: input.resolutionNote,
          },
        })
        return row
      }
    )
    return NextResponse.json({ request: privacyRequest })
  } catch (error) {
    return apiError(error)
  }
}
