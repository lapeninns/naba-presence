import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

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

export const PUT = route({
  roles: ["owner", "admin"],
  body: assignmentSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const assignments = await tenant(async (sql) => {
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
        requestId,
        metadata: {
          assignments: input.assignments,
          clientRequestId,
        },
      })
      return input.assignments
    })
    return { assignments }
  },
})
