import {
  memberRemoveSchema,
  memberUpdateSchema,
  type MemberRemovedResponse,
  type MemberRole,
} from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { assertRoleChangeAllowed } from "@/lib/server/member-roles"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const members = await tenant(
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
    return { members }
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  handler: () => {
    throw new ApiError(
      410,
      "use_invitations",
      "Create an invitation instead of adding a user directly."
    )
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: memberUpdateSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    assertRoleChangeAllowed(session.role, input.role)
    const member = await tenant(async (sql) => {
      const [current] = await sql<
        { role: MemberRole; canPublish: boolean }[]
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
        requestId,
        metadata: {
          before: current,
          after: { role: input.role, canPublish: input.canPublish },
          clientRequestId,
        },
      })
      return row
    })
    return { member }
  },
})

export const DELETE = route({
  roles: ["owner", "admin"],
  body: memberRemoveSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if (input.userId === session.userId) {
      throw new ApiError(
        409,
        "cannot_remove_self",
        "Transfer access before removing your own membership."
      )
    }
    await tenant(async (sql) => {
      const [current] = await sql<{ role: MemberRole }[]>`
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
        requestId,
        metadata: {
          previousRole: current.role,
          clientRequestId,
        },
      })
    })
    return { removed: true } satisfies MemberRemovedResponse
  },
})
