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
}) {
  const provisioned = input.inviteToken
    ? await provisionAuthenticatedMember(
        input.identity,
        await resolveInvitation(input.inviteToken)
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
  })
  await setSessionCookie(provisioned.token)
  return {
    organisationId: provisioned.organisationId,
    userId: provisioned.userId,
  }
}
