import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const assignmentSchema = z.object({
  userId: z.uuid(),
  assignments: z
    .array(
      z.object({
        locationId: z.uuid(),
        canPublish: z.boolean().default(false),
      })
    )
    .max(500),
})

export async function PUT(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = assignmentSchema.parse(await request.json())
    const assignments = await withTenant(
      session.organisationId,
      async (sql) => {
        const [member] = await sql<{ role: string }[]>`
          select role from member where user_id = ${input.userId} limit 1
        `
        if (!member) {
          throw new ApiError(404, "member_not_found", "Member not found.")
        }
        if (
          input.assignments.some((assignment) => assignment.canPublish) &&
          member.role === "viewer"
        ) {
          throw new ApiError(
            409,
            "viewer_cannot_publish",
            "Viewers cannot receive publish permission."
          )
        }
        const uniqueIds = [
          ...new Set(input.assignments.map(({ locationId }) => locationId)),
        ]
        if (uniqueIds.length !== input.assignments.length) {
          throw new ApiError(
            400,
            "duplicate_location",
            "Each location may be assigned once."
          )
        }
        if (uniqueIds.length) {
          const locations = await sql<{ id: string }[]>`
            select id::text as id from location where id in ${sql(uniqueIds)}
          `
          if (locations.length !== uniqueIds.length) {
            throw new ApiError(
              404,
              "location_not_found",
              "One or more locations were not found."
            )
          }
        }
        await sql`delete from location_member where user_id = ${input.userId}`
        for (const assignment of input.assignments) {
          await sql`
            insert into location_member (
              organisation_id,
              location_id,
              user_id,
              can_publish
            )
            values (
              ${session.organisationId},
              ${assignment.locationId},
              ${input.userId},
              ${assignment.canPublish}
            )
          `
        }
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "member.location_permissions_changed",
          subjectType: "member",
          subjectId: input.userId,
          requestId: rid.id,
          metadata: {
            assignments: input.assignments,
            clientRequestId: rid.clientId,
          },
        })
        return input.assignments
      }
    )
    return NextResponse.json({ assignments })
  } catch (error) {
    return apiError(error)
  }
}
