import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import {
  invitationCreateSchema,
  type InvitationCreatedResponse,
  type InvitationsResponse,
} from "@/lib/contracts/invitations"
import { type MemberRole } from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import {
  decryptSecret,
  encryptSecret,
  randomToken,
  sha256,
} from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
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
 * together they must hold at least one listing: accepted with none, the
 * invitee would have no location_member rows, which means every client.
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
      "would_widen_to_all_clients",
      "Those clients have no listings yet, so the invitation would give every client. Add their listings first, or invite for all clients."
    )
  }
  return clientIds
}

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const items = await tenant(async (sql) => {
      const rows = await sql<
        Array<{
          id: string
          email: string
          role: MemberRole
          canPublish: boolean
          clients: { id: string; name: string }[] | null
          tokenCiphertext: Buffer
          expiresAt: Date
          acceptedAt: Date | null
          createdAt: Date
        }>
      >`
        select
          id::text as id,
          email,
          role,
          can_publish as "canPublish",
          case when i.client_ids is null then null else (
            select coalesce(
              json_agg(json_build_object('id', c.id::text, 'name', c.name) order by lower(c.name)),
              '[]'::json
            )
            from client c
            where c.id = any(i.client_ids)
          ) end as clients,
          token_ciphertext as "tokenCiphertext",
          expires_at as "expiresAt",
          accepted_at as "acceptedAt",
          created_at as "createdAt"
        from invitation i
        where accepted_at is null
        order by created_at desc
      `
      const baseUrl = getServerEnv().NEXTAUTH_URL ?? "http://localhost:3000"
      return rows.map(({ tokenCiphertext, ...row }) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        inviteUrl: new URL(
          `/invite/${decryptSecret(tokenCiphertext)}`,
          baseUrl
        ).toString(),
      }))
    })
    return { items } satisfies InvitationsResponse
  },
})

export const POST = route({
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
        const clientIds = input.clientIds
          ? await validateClientScope(sql, input.role, input.clientIds)
          : null
        const [row] = await sql<
          Array<{
            id: string
            email: string
            role: MemberRole
            canPublish: boolean
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
            clientRequestId,
          },
        })
        return {
          ...row,
          clients: clientIds
            ? await sql<{ id: string; name: string }[]>`
                select id::text as id, name from client
                where id in ${sql(clientIds)}
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
