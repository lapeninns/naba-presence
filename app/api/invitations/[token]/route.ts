import {
  invitationLookupParamsSchema,
  invitationRevokeParamsSchema,
  type InvitationAcceptedResponse,
  type InvitationLookup,
  type InvitationRevokedResponse,
} from "@/lib/contracts/invitations"
import type { MemberRole } from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { resolveInvitation } from "@/lib/server/email-auth"
import { ApiError } from "@/lib/server/http"
import { acceptInvitationForSessionUser } from "@/lib/server/provisioning"
import { route } from "@/lib/server/route"
import { assuranceOf, setSessionCookie } from "@/lib/server/session"

export const runtime = "nodejs"

export const GET = route({
  auth: "public",
  params: invitationLookupParamsSchema,
  limits: () => ({ scope: "invitation_lookup" }),
  handler: async ({ params }) => {
    // Cross-tenant by design: the invitee has no session yet, so the token
    // is resolved via lookup_invitation() outside withTenant.
    const [invitation] = await getDatabase()<
      {
        organisationName: string
        email: string
        role: MemberRole
        expiresAt: Date
        acceptedAt: Date | null
      }[]
    >`
      select
        organisation_name as "organisationName",
        email,
        role,
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from lookup_invitation(${sha256(params.token)})
    `
    if (!invitation) {
      throw new ApiError(404, "invitation_not_found", "Invitation not found.")
    }
    // A finished invitation answers with its state only, never its details:
    // the role and expiry (D8), like the organisation and address, are for
    // someone who can still accept. Expiry is checked first, so an old link
    // that was also accepted still reads as expired. Same codes and statuses
    // as registration (lib/server/registration.ts).
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        410,
        "invitation_expired",
        "This invitation is invalid or expired."
      )
    }
    if (invitation.acceptedAt !== null) {
      throw new ApiError(
        409,
        "invitation_already_used",
        "This invitation has already been accepted."
      )
    }
    // Field by field, never a spread of the row: this answer is public to
    // anyone holding the token (D8), so nothing else may leak into it.
    return {
      organisationName: invitation.organisationName,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
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
  entitlement: "exempt",
  params: invitationLookupParamsSchema,
  limits: ({ session }) => ({
    scope: "invitation_accept",
    user: session.userId,
  }),
  handler: async ({ session, params, requestId }) => {
    const accepted = await acceptInvitationForSessionUser(
      session,
      await resolveInvitation(params.token),
      requestId,
      // The same person, already signed in: the new session keeps the
      // assurance this one has (aal2 stays aal2, aal1 stays aal1).
      { assurance: assuranceOf(session) }
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
  entitlement: "exempt",
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
