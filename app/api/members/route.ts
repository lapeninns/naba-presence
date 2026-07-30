import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { assertRoleChangeAllowed } from "@/lib/server/member-roles"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const roleSchema = z.enum(["owner", "admin", "member", "viewer"])
const updateSchema = z.object({
  userId: z.uuid(),
  role: roleSchema,
  canPublish: z.boolean(),
})
const deleteSchema = z.object({ userId: z.uuid() })

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const members = await withTenant(
      session.organisationId,
      (sql) => sql`
        select
          u.id::text as "userId",
          u.email,
          u.display_name as "displayName",
          m.role,
          m.can_publish as "canPublish",
          m.created_at as "createdAt",
          coalesce(
            json_agg(
              json_build_object(
                'locationId', lm.location_id::text,
                'canPublish', lm.can_publish
              )
            ) filter (where lm.location_id is not null),
            '[]'::json
          ) as locations
        from member m
        join app_user u on u.id = m.user_id
        left join location_member lm
          on lm.organisation_id = m.organisation_id
         and lm.user_id = m.user_id
        group by u.id, m.role, m.can_publish, m.created_at
        order by
          case m.role
            when 'owner' then 1
            when 'admin' then 2
            when 'member' then 3
            else 4
          end,
          lower(u.display_name)
      `
    )
    return NextResponse.json({ members })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST() {
  try {
    requireRole(await requireSession(), ["owner", "admin"])
    throw new ApiError(
      410,
      "use_invitations",
      "Create an invitation instead of adding a user directly."
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = updateSchema.parse(await request.json())
    assertRoleChangeAllowed(session.role, input.role)
    const member = await withTenant(session.organisationId, async (sql) => {
      const [current] = await sql<
        { role: z.infer<typeof roleSchema>; canPublish: boolean }[]
      >`
        select role, can_publish as "canPublish"
        from member
        where user_id = ${input.userId}
        limit 1
      `
      if (!current) {
        throw new ApiError(404, "member_not_found", "Member not found.")
      }
      if (session.role !== "owner" && current.role === "owner") {
        throw new ApiError(
          403,
          "owner_role_required",
          "Only an owner can change an owner."
        )
      }
      if (
        current.role === "owner" &&
        input.role !== "owner" &&
        (await sql`select 1 from member where role = 'owner'`).count <= 1
      ) {
        throw new ApiError(
          409,
          "last_owner",
          "The organisation must retain at least one owner."
        )
      }
      const [row] = await sql`
        update member
        set role = ${input.role}, can_publish = ${input.canPublish}
        where user_id = ${input.userId}
        returning
          user_id::text as "userId",
          role,
          can_publish as "canPublish",
          created_at as "createdAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.role_changed",
        subjectType: "member",
        subjectId: input.userId,
        requestId: rid.id,
        metadata: {
          before: current,
          after: { role: input.role, canPublish: input.canPublish },
          clientRequestId: rid.clientId,
        },
      })
      return row
    })
    return NextResponse.json({ member })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = deleteSchema.parse(await request.json())
    if (input.userId === session.userId) {
      throw new ApiError(
        409,
        "cannot_remove_self",
        "Transfer access before removing your own membership."
      )
    }
    await withTenant(session.organisationId, async (sql) => {
      const [current] = await sql<{ role: z.infer<typeof roleSchema> }[]>`
        select role from member where user_id = ${input.userId} limit 1
      `
      if (!current) {
        throw new ApiError(404, "member_not_found", "Member not found.")
      }
      if (session.role !== "owner" && current.role === "owner") {
        throw new ApiError(
          403,
          "owner_role_required",
          "Only an owner can remove an owner."
        )
      }
      if (
        current.role === "owner" &&
        (await sql`select 1 from member where role = 'owner'`).count <= 1
      ) {
        throw new ApiError(
          409,
          "last_owner",
          "The organisation must retain at least one owner."
        )
      }
      await sql`delete from member where user_id = ${input.userId}`
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.removed",
        subjectType: "member",
        subjectId: input.userId,
        requestId: rid.id,
        metadata: {
          previousRole: current.role,
          clientRequestId: rid.clientId,
        },
      })
    })
    return NextResponse.json({ removed: true })
  } catch (error) {
    return apiError(error)
  }
}
