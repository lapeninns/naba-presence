import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  auth: "public",
  params: z.object({ token: z.string() }),
  handler: async ({ params }) => {
    // Cross-tenant by design: the invitee has no session yet, so the token
    // is resolved via lookup_invitation() outside withTenant.
    const [invitation] = await getDatabase()<
      {
        organisationName: string
        email: string
        expiresAt: Date
        acceptedAt: Date | null
      }[]
    >`
      select
        organisation_name as "organisationName",
        email,
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from lookup_invitation(${sha256(params.token)})
    `
    if (!invitation) {
      throw new ApiError(
        404,
        "invitation_not_found",
        "Invitation not found."
      )
    }
    const accepted = invitation.acceptedAt !== null
    return {
      organisationName: invitation.organisationName,
      email: invitation.email,
      accepted,
      expired: !accepted && invitation.expiresAt.getTime() <= Date.now(),
    }
  },
})

export const DELETE = route({
  roles: ["owner", "admin"],
  params: z.object({ token: z.uuid() }),
  handler: async ({ session, params, requestId, tenant }) => {
    const invitationId = params.token
    await tenant(async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        delete from invitation
        where id = ${invitationId}
          and accepted_at is null
        returning id::text as id
      `
      if (!row) {
        throw new ApiError(404, "invitation_not_found", "Invitation not found.")
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.invitation_revoked",
        subjectType: "invitation",
        subjectId: invitationId,
        requestId,
      })
    })
    return { revoked: true }
  },
})
