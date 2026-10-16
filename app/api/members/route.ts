import type { TransactionSql } from "postgres"

import {
  memberRemoveSchema,
  memberUpdateSchema,
  type LocationScope,
  type MemberRemovedResponse,
  type MemberRole,
} from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { assertRoleChangeAllowed } from "@/lib/server/member-roles"
import { loadMembers } from "@/lib/server/members"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Throws 409 `last_owner` unless the organisation still has an owner other
 * than the one this transaction is about to demote or remove.
 *
 * `for update` over the whole owner set, not a bare count: two admins acting
 * on two different owners at once both read "2 owners" and both committed,
 * leaving the organisation with none — and only an existing owner can grant
 * `owner` back, so there is no recovery. Locking the set makes the second
 * transaction wait, re-read after the first commits, and see one owner left.
 * `member_last_owner_guard` (0031) backstops any writer that skips this.
 */
async function assertAnotherOwnerRemains(sql: TransactionSql) {
  const owners = await sql`
    select 1 from member where role = 'owner' for update
  `
  if (owners.count <= 1) {
    throw new ApiError(
      409,
      "last_owner",
      "The organisation must retain at least one owner."
    )
  }
}

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => tenant((sql) => loadMembers(sql)),
})

export const POST = route({
  mfa: "step_up",
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
  mfa: "step_up",
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
        {
          role: MemberRole
          canPublish: boolean
          locationScope: LocationScope
        }[]
      >`
        select
          role,
          can_publish as "canPublish",
          location_scope as "locationScope"
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
      if (current.role === "owner" && input.role !== "owner") {
        await assertAnotherOwnerRemains(sql)
      }
      // The scope moves with the role (supabase 0082) so the change grants
      // exactly what it granted before the scope existed:
      //   to owner/admin               -> 'all'; their rows stay, latent, so
      //                                   a later demotion restores them.
      //   member/viewer -> either      -> unchanged.
      //   owner/admin -> member/viewer -> 'assigned' when they hold rows (the
      //                                   latent rows become active, as they
      //                                   always have, restored as they were
      //                                   at promotion: extendClientHolders
      //                                   skips 'all' holders, so listings
      //                                   filed meanwhile are not among
      //                                   them), otherwise 'all'.
      // Decided inside the UPDATE, against the row it locks, so a concurrent
      // client-access save cannot leave a scope computed from a stale read.
      const [row] = await sql<
        {
          userId: string
          role: MemberRole
          canPublish: boolean
          locationScope: LocationScope
          createdAt: Date
        }[]
      >`
        update member
        set
          role = ${input.role},
          can_publish = ${input.canPublish},
          location_scope = case
            when ${input.role} in ('owner', 'admin') then 'all'
            when member.role in ('member', 'viewer') then member.location_scope
            when exists (
              select 1 from location_member lm
              where lm.organisation_id = member.organisation_id
                and lm.user_id = member.user_id
            ) then 'assigned'
            else 'all'
          end
        where user_id = ${input.userId}
        returning
          user_id::text as "userId",
          role,
          can_publish as "canPublish",
          location_scope as "locationScope",
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
          after: {
            role: input.role,
            canPublish: input.canPublish,
            locationScope: row.locationScope,
          },
          clientRequestId,
        },
      })
      return row
    })
    return { member }
  },
})

export const DELETE = route({
  mfa: "step_up",
  entitlement: "exempt",
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
      if (current.role === "owner") {
        await assertAnotherOwnerRemains(sql)
      }
      // The member_prune_location_grants trigger (0031) removes this user's
      // location_member rows with the membership; without it a later
      // re-invitation inherits the old per-location publish grants.
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
