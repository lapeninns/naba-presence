import { NextResponse } from "next/server"
import { z } from "zod"

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

const roleSchema = z.enum(["owner", "admin", "member", "viewer"])
const invitationSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: roleSchema,
  canPublish: z.boolean().default(false),
})

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
          role: z.infer<typeof roleSchema>
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
        inviteUrl: new URL(
          `/invite/${decryptSecret(tokenCiphertext)}`,
          baseUrl
        ).toString(),
      }))
    })
    return { items }
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  body: invitationSchema,
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
    let invitation
    try {
      invitation = await tenant(async (sql) => {
        const [row] = await sql`
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
        return row
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
    const baseUrl =
      getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    return NextResponse.json(
      {
        invitation,
        inviteUrl: new URL(`/invite/${token}`, baseUrl).toString(),
      },
      { status: 201 }
    )
  },
})
