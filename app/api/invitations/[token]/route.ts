import {
  invitationLookupParamsSchema,
  invitationRevokeParamsSchema,
  type InvitationAcceptedResponse,
  type InvitationLookup,
  type InvitationRevokedResponse,
} from "@/lib/contracts/invitations"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { resolveInvitation } from "@/lib/server/email-auth"
import { ApiError } from "@/lib/server/http"
import { acceptInvitationForSessionUser } from "@/lib/server/provisioning"
import { route } from "@/lib/server/route"
import { setSessionCookie } from "@/lib/server/session"

export const runtime = "nodejs"

export const GET = route({
  auth: "public",
  params: invitationLookupParamsSchema,
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
      throw new ApiError(404, "invitation_not_found", "Invitation not found.")
    }
    const accepted = invitation.acceptedAt !== null
    return {
      organisationName: invitation.organisationName,
      email: invitation.email,
      accepted,
      expired: !accepted && invitation.expiresAt.getTime() <= Date.now(),
    } satisfies InvitationLookup
  },
})

/**
 * Accept with the session the visitor already has. The invite page offers
 * this when the signed-in email matches the invited one, instead of making
 * them sign out and back in. The new session opens in the invitation's
 * organisation; the old one is retired afterwards in its own tenant, in the
 * same order `/api/session/switch` uses so a failure there leaves the caller
 * signed in.
 */
export const POST = route({
  params: invitationLookupParamsSchema,
  handler: async ({ session, params, requestId }) => {
    const accepted = await acceptInvitationForSessionUser(
      session,
      await resolveInvitation(params.token),
      requestId
    )
    await withTenant(session.organisationId, async (sql) => {
      await sql`delete from app_session where id = ${session.sessionId}`
    })
    await setSessionCookie(accepted.token)
    return {
      accepted: true,
      organisationId: accepted.organisationId,
    } satisfies InvitationAcceptedResponse
  },
})

export const DELETE = route({
  roles: ["owner", "admin"],
  params: invitationRevokeParamsSchema,
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
    return { revoked: true } satisfies InvitationRevokedResponse
  },
})
