import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import {
  invitationCreateSchema,
  type InvitationCreatedResponse,
} from "@/lib/contracts/invitations"
import { type LocationScope, type MemberRole } from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { encryptSecret, randomToken, sha256 } from "@/lib/server/crypto"
import { assertNewMemberSeat } from "@/lib/server/entitlement-policy"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  attemptInvitationDelivery,
  enqueueInvitationDelivery,
  invitationEmailEnabled,
  latestDelivery,
} from "@/lib/server/invitations/delivery"
import { loadInvitations } from "@/lib/server/invitations/list"
import { assertRoleChangeAllowed } from "@/lib/server/member-roles"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  )
}

/**
 * Checks a scoped invitation before it is stored, and returns the client ids
 * de-duplicated. The scope only means something for members and viewers,
 * every id must be a client of this organisation (RLS scopes the lookup), and
 * together they must hold at least one listing: an `assigned` scope with
 * nothing in it would join the invitee seeing nothing, so it is refused here
 * as acceptance refuses it (invitation_scope_empty), never widened.
 */
async function validateClientScope(
  sql: TransactionSql,
  role: MemberRole,
  requested: string[]
) {
  if (role === "owner" || role === "admin") {
    throw new ApiError(
      409,
      "role_sees_all_clients",
      "Owners and admins always see every client. Invite them without choosing clients."
    )
  }
  const clientIds = [...new Set(requested.map((id) => id.toLowerCase()))]
  const found = await sql<{ id: string; listings: number }[]>`
    select c.id::text as id, count(l.id)::int as listings
    from client c
    left join location l on l.client_id = c.id
    where c.id in ${sql(clientIds)}
    group by c.id
  `
  if (found.length !== clientIds.length) {
    throw new ApiError(
      404,
      "client_not_found",
      "One or more of those clients was not found."
    )
  }
  if (found.every((client) => client.listings === 0)) {
    throw new ApiError(
      409,
      "invitation_scope_empty",
      "Those clients have no listings yet, so the invitation would give access to nothing. Add their listings first, or invite for all clients."
    )
  }
  return clientIds
}

/**
 * Checks a business invitation's listings before it is stored, and returns
 * them de-duplicated. Same rules as a client scope: members and viewers only,
 * and every id must be a listing of this organisation (RLS scopes the
 * lookup). Business workspaces grant a location at a time, so an agency
 * workspace is pointed at clients instead, as the Client access dialog is.
 */
async function validateLocationScope(
  sql: TransactionSql,
  role: MemberRole,
  workspaceMode: "business" | "agency" | undefined,
  requested: string[]
) {
  if (role === "owner" || role === "admin") {
    throw new ApiError(
      409,
      "role_sees_all_clients",
      "Owners and admins always see every location. Invite them without choosing locations."
    )
  }
  if (workspaceMode === "agency") {
    throw new ApiError(
      409,
      "wrong_workspace_mode",
      "Access is granted a client at a time in an agency workspace."
    )
  }
  const locationIds = [...new Set(requested.map((id) => id.toLowerCase()))]
  const found = await sql<{ id: string }[]>`
    select id::text as id from location where id in ${sql(locationIds)}
  `
  if (found.length !== locationIds.length) {
    throw new ApiError(
      404,
      "location_not_found",
      "One or more of those locations was not found."
    )
  }
  return locationIds
}

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ session, tenant }) =>
    tenant((sql) => loadInvitations(sql, session.organisationId)),
})

export const POST = route({
  mfa: "step_up",
  roles: ["owner", "admin"],
  body: invitationCreateSchema,
  handler: async ({
    request,
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    assertRoleChangeAllowed(session.role, input.role)
    const token = randomToken()
    let invitation: InvitationCreatedResponse["invitation"]
    // Set when the organisation emails its invitations: the row written in
    // the same transaction as the invitation (and counted against the abuse
    // limit there), sent once it commits unless the limit suppressed it.
    let queued: { id: string; queued: boolean } | null = null
    try {
      invitation = await tenant(async (sql) => {
        // Invitations are for people who are not in the organisation yet.
        // Accepting one used to upsert over an existing membership, so
        // re-inviting the sole owner as a viewer stripped the last owner
        // from inside the sign-in transaction, where neither the
        // owner_role_required nor the last_owner guard could reach it.
        // Role changes belong to PATCH /api/members, which carries both.
        const [existing] = await sql<{ userId: string }[]>`
          select m.user_id::text as "userId"
          from member m
          join app_user u on u.id = m.user_id
          where lower(u.email) = ${input.email}
          limit 1
        `
        if (existing) {
          throw new ApiError(
            409,
            "already_a_member",
            "That person is already in this organisation. Change their role from the team list instead."
          )
        }
        // The plan's member limit (R2B-04): open invitations hold a seat, so
        // this fails here rather than when the person accepts.
        await assertNewMemberSeat(sql, session.organisationId, {
          pendingInvitations: true,
        })
        const clientIds = input.clientIds
          ? await validateClientScope(sql, input.role, input.clientIds)
          : null
        const locationIds = input.locationIds
          ? await validateLocationScope(
              sql,
              input.role,
              session.workspaceMode,
              input.locationIds
            )
          : null
        // Written with the ids it describes, in the same row: the 0082 CHECK
        // refuses a scope that disagrees with them.
        const locationScope: LocationScope =
          clientIds || locationIds ? "assigned" : "all"
        const [row] = await sql<
          Array<{
            id: string
            email: string
            role: MemberRole
            canPublish: boolean
            locationScope: LocationScope
            expiresAt: Date
            createdAt: Date
          }>
        >`
          insert into invitation (
            organisation_id,
            email,
            role,
            can_publish,
            client_ids,
            location_ids,
            location_scope,
            token_hash,
            token_ciphertext,
            invited_by,
            expires_at
          )
          values (
            ${session.organisationId},
            ${input.email},
            ${input.role},
            ${input.canPublish},
            ${clientIds ? sql.array(clientIds) : null}::uuid[],
            ${locationIds ? sql.array(locationIds) : null}::uuid[],
            ${locationScope},
            ${sha256(token)},
            ${encryptSecret(token)},
            ${session.userId},
            now() + interval '7 days'
          )
          returning
            id::text as id,
            email,
            role,
            can_publish as "canPublish",
            location_scope as "locationScope",
            expires_at as "expiresAt",
            created_at as "createdAt"
        `
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "member.invited",
          subjectType: "invitation",
          subjectId: row.id,
          requestId,
          metadata: {
            email: input.email,
            role: input.role,
            canPublish: input.canPublish,
            clientIds,
            locationIds,
            locationScope,
            clientRequestId,
          },
        })
        if (await invitationEmailEnabled(sql, session.organisationId)) {
          queued = await enqueueInvitationDelivery(sql, {
            organisationId: session.organisationId,
            invitationId: row.id,
            email: input.email,
            requestedBy: session.userId,
            kind: "initial",
          })
        }
        return {
          ...row,
          clients: clientIds
            ? await sql<{ id: string; name: string }[]>`
                select id::text as id, name from client
                where id in ${sql(clientIds)}
                order by lower(name)
              `.then((rows) => rows.map(({ id, name }) => ({ id, name })))
            : null,
          locations: locationIds
            ? await sql<{ id: string; name: string }[]>`
                select id::text as id, name from location
                where id in ${sql(locationIds)}
                order by lower(name)
              `.then((rows) => rows.map(({ id, name }) => ({ id, name })))
            : null,
          expiresAt: row.expiresAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          409,
          "invitation_pending",
          "A pending invitation already exists for that email."
        )
      }
      throw error
    }
    // Read through a const: TypeScript does not see the assignment inside
    // the transaction callback.
    const delivery = queued as { id: string; queued: boolean } | null
    if (delivery) {
      // Inline, so the inviter sees Sent (or why not) straight away. The
      // invitation is committed either way; a send this request does not
      // settle is the job tick's.
      if (delivery.queued) {
        await attemptInvitationDelivery({
          organisationId: session.organisationId,
          deliveryId: delivery.id,
          requestId,
        })
      }
      const invitationId = invitation.id
      invitation = {
        ...invitation,
        delivery: await tenant((sql) => latestDelivery(sql, invitationId)),
      }
    }
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    return NextResponse.json(
      {
        invitation,
        inviteUrl: new URL(`/invite/${token}`, baseUrl).toString(),
      } satisfies InvitationCreatedResponse,
      { status: 201 }
    )
  },
})
