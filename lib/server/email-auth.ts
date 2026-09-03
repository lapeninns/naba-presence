import "server-only"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  type AuthenticatedIdentity,
  provisionAuthenticatedMember,
  provisionAuthenticatedOwner,
} from "@/lib/server/provisioning"
import { setSessionCookie } from "@/lib/server/session"
import { ApiError } from "@/lib/server/http"

type InvitationForAcceptance = {
  id: string
  organisationId: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
}

async function resolveInvitation(
  inviteToken: string
): Promise<InvitationForAcceptance> {
  const [invitation] = await getDatabase()<InvitationForAcceptance[]>`
    select
      id::text as id,
      organisation_id::text as "organisationId",
      role,
      can_publish as "canPublish"
    from resolve_invitation_for_acceptance(${sha256(inviteToken)})
  `
  if (!invitation) {
    throw new ApiError(
      410,
      "invitation_expired",
      "This invitation is invalid or expired."
    )
  }
  return invitation
}

export async function completeEmailAuthentication(input: {
  identity: AuthenticatedIdentity
  inviteToken?: string
  requestId: string
  clientRequestId?: string | null
  /**
   * Set by the reset flow. Audits the credential change under its own action
   * (a reset-driven takeover is otherwise byte-identical to a daily login)
   * and evicts every other session the user holds, so a cookie stolen before
   * the reset does not outlive it.
   */
  passwordReset?: boolean
}) {
  const provisioned = input.inviteToken
    ? await provisionAuthenticatedMember(
        input.identity,
        await resolveInvitation(input.inviteToken),
        input.requestId
      )
    : await provisionAuthenticatedOwner(input.identity)

  await withTenant(provisioned.organisationId, async (sql) => {
    await writeAudit(sql, {
      organisationId: provisioned.organisationId,
      actorUserId: provisioned.userId,
      action: "user.signed_in",
      subjectType: "user",
      subjectId: provisioned.userId,
      requestId: input.requestId,
      metadata: {
        provider: input.identity.provider,
        emailChangeHeld: provisioned.emailChangeHeld,
        clientRequestId: input.clientRequestId ?? null,
      },
    })
    if (input.passwordReset) {
      // revoke_user_sessions is SECURITY DEFINER: a user's sessions span
      // every organisation they belong to, and app_session's RLS is scoped to
      // one. The session minted a moment ago is excluded by its token hash,
      // so the person completing the reset stays signed in.
      const [revoked] = await sql<{ revokedSessions: number }[]>`
        select revoke_user_sessions(
          ${provisioned.userId},
          ${sha256(provisioned.token)}
        ) as "revokedSessions"
      `
      await writeAudit(sql, {
        organisationId: provisioned.organisationId,
        actorUserId: provisioned.userId,
        action: "user.password_reset",
        subjectType: "user",
        subjectId: provisioned.userId,
        requestId: input.requestId,
        metadata: {
          revokedSessions: revoked?.revokedSessions ?? 0,
          clientRequestId: input.clientRequestId ?? null,
        },
      })
    }
  })
  await setSessionCookie(provisioned.token)
  return {
    organisationId: provisioned.organisationId,
    userId: provisioned.userId,
  }
}
