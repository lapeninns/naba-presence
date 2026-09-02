import { NextResponse } from "next/server"

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
          token_ciphertext as "tokenCiphertext",
          expires_at as "expiresAt",
          accepted_at as "acceptedAt",
          created_at as "createdAt"
        from invitation
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
            clientRequestId,
          },
        })
        return {
          ...row,
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
