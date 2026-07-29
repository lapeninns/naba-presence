import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const roleSchema = z.enum(["owner", "admin", "member", "viewer"])
const createSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  role: roleSchema,
  canPublish: z.boolean().default(false),
})
const updateSchema = z.object({
  userId: z.uuid(),
  role: roleSchema,
  canPublish: z.boolean(),
})
const deleteSchema = z.object({ userId: z.uuid() })

function assertRoleChangeAllowed(
  actorRole: "owner" | "admin" | "member" | "viewer",
  targetRole: z.infer<typeof roleSchema>
) {
  if (actorRole !== "owner" && targetRole === "owner") {
    throw new ApiError(
      403,
      "owner_role_required",
      "Only an owner can grant or change the owner role."
    )
  }
}

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

export async function POST(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = createSchema.parse(await request.json())
    assertRoleChangeAllowed(session.role, input.role)
    const member = await withTenant(session.organisationId, async (sql) => {
      const [user] = await sql<{ id: string }[]>`
        select attach_member_user(
          ${input.email},
          ${input.displayName}
        )::text as id
      `
      const [existing] = await sql<{ role: z.infer<typeof roleSchema> }[]>`
        select role
        from member
        where user_id = ${user.id}
        limit 1
      `
      if (existing) {
        throw new ApiError(
          409,
          "member_exists",
          "That user is already a member of this organisation."
        )
      }
      const [row] = await sql`
        insert into member (
          organisation_id,
          user_id,
          role,
          can_publish
        )
        values (
          ${session.organisationId},
          ${user.id},
          ${input.role},
          ${input.canPublish}
        )
        returning
          user_id::text as "userId",
          role,
          can_publish as "canPublish",
          created_at as "createdAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.added",
        subjectType: "member",
        subjectId: user.id,
        requestId: requestId(request),
        metadata: { role: input.role, canPublish: input.canPublish },
      })
      const [profileRow] = await sql`
        select email, display_name as "displayName"
        from app_user
        where id = ${user.id}
      `
      return { ...row, ...profileRow }
    })
    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
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
        requestId: requestId(request),
        metadata: {
          before: current,
          after: { role: input.role, canPublish: input.canPublish },
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
        requestId: requestId(request),
        metadata: { previousRole: current.role },
      })
    })
    return NextResponse.json({ removed: true })
  } catch (error) {
    return apiError(error)
  }
}
