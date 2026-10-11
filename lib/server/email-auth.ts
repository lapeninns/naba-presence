import "server-only"

import { writeAudit } from "@/lib/server/audit"
import { encryptSecret, sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  createPendingTicket,
  isMfaEnabled,
  setMfaTicketCookie,
} from "@/lib/server/mfa"
import type { ProviderFactor } from "@/lib/server/password-auth"
import {
  type AuthenticatedIdentity,
  provisionAuthenticatedMember,
  provisionAuthenticatedOwner,
} from "@/lib/server/provisioning"
import { clearSession, setSessionCookie } from "@/lib/server/session"
import { AAL1_ASSURANCE, type SessionAssurance } from "@/lib/server/session-store"
import { ApiError } from "@/lib/server/http"

type InvitationForAcceptance = {
  id: string
  organisationId: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
}

export async function resolveInvitation(
  inviteToken: string
): Promise<InvitationForAcceptance> {
  return resolveInvitationByHash(sha256(inviteToken))
}

/**
 * The same lookup by the token's hash: a pending MFA sign-in keeps only the
 * hash of the invitation it will accept (lib/server/mfa.ts).
 */
export async function resolveInvitationByHash(
  inviteTokenHash: string
): Promise<InvitationForAcceptance> {
  const [invitation] = await getDatabase()<InvitationForAcceptance[]>`
    select
      id::text as id,
      organisation_id::text as "organisationId",
      role,
      can_publish as "canPublish"
    from resolve_invitation_for_acceptance(${inviteTokenHash})
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

export type EmailAuthenticationResult =
  | { mfaRequired: true }
  | { mfaRequired: false; organisationId: string; userId: string }

export async function completeEmailAuthentication(input: {
  identity: AuthenticatedIdentity
  inviteToken?: string
  /** Instead of `inviteToken`, when only its hash was kept (MFA ticket). */
  inviteTokenHash?: string | null
  requestId: string
  clientRequestId?: string | null
  /**
   * Set by the reset flow. Audits the credential change under its own action
   * (a reset-driven takeover is otherwise byte-identical to a daily login)
   * and evicts every other session the user holds, so a cookie stolen before
   * the reset does not outlive it.
   */
  passwordReset?: boolean
  /** How the person authenticated (password, email_link, password_reset). */
  authMethod: string
  /**
   * What the provider said at this sign-in: the user's access token and
   * verified TOTP factors. With MFA on and a factor present, no session is
   * minted: a pending ticket is opened instead and the caller answers
   * `mfaRequired` (lib/server/mfa.ts). Absent (registration, which has no
   * token), the factor count is left as it was.
   */
  provider?: { accessToken: string | null; factors: ProviderFactor[] }
  /**
   * Set by the reset flow when the person has factors: the new password is
   * not set yet; it is held (encrypted) in the ticket and set by the verify
   * route with the aal2 token. Ignored when no ticket is opened.
   */
  newPassword?: string
  /** Set only by the MFA verify route, once the code checked out. */
  assurance?: SessionAssurance
}): Promise<EmailAuthenticationResult> {
  const inviteTokenHash =
    input.inviteTokenHash ??
    (input.inviteToken ? sha256(input.inviteToken) : null)

  if (
    !input.assurance &&
    isMfaEnabled() &&
    input.provider &&
    input.provider.factors.length > 0
  ) {
    if (!input.provider.accessToken) {
      // A factor with no token to challenge it with: refuse rather than
      // fall through to a single-factor session.
      throw new ApiError(
        401,
        "mfa_required",
        "Sign in with your password to finish two-step verification."
      )
    }
    // An invalid invitation fails now, not after the code.
    if (inviteTokenHash) await resolveInvitationByHash(inviteTokenHash)
    // Whoever this browser was signed in as, a new sign-in has started in
    // it: end that session (as a completed sign-in would replace its
    // cookie), so the code screen is reachable and the ticket is not
    // dropped in favour of someone else's session.
    await clearSession()
    const ticket = await createPendingTicket({
      purpose: "sign_in",
      authProvider: input.identity.provider,
      authSubject: input.identity.subject,
      factors: input.provider.factors,
      completion: {
        identity: input.identity,
        inviteTokenHash,
        passwordReset: input.passwordReset === true,
        authMethod: input.authMethod,
        newPasswordCiphertext: input.newPassword
          ? encryptSecret(input.newPassword).toString("base64")
          : null,
      },
      providerToken: input.provider.accessToken,
    })
    await setMfaTicketCookie(ticket)
    return { mfaRequired: true }
  }

  const assurance: SessionAssurance = input.assurance ?? {
    ...AAL1_ASSURANCE,
    authMethod: input.authMethod,
  }
  const provisioned = inviteTokenHash
    ? await provisionAuthenticatedMember(
        input.identity,
        await resolveInvitationByHash(inviteTokenHash),
        input.requestId,
        { assurance }
      )
    : await provisionAuthenticatedOwner(input.identity, { assurance })

  await withTenant(provisioned.organisationId, async (sql) => {
    if (input.provider) {
      // Last known factor count: a UI hint (enroll, add a backup), never the
      // decision whether a code is needed. Own row only (app_user_self_update).
      await sql`select set_config('app.user_id', ${provisioned.userId}, true)`
      await sql`
        update app_user
        set mfa_factor_count = ${Math.min(input.provider.factors.length, 10)}
        where id = ${provisioned.userId}
          and mfa_factor_count is distinct from ${Math.min(
            input.provider.factors.length,
            10
          )}
      `
    }
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
        aal: assurance.aal,
        authMethod: assurance.authMethod,
        mfaFactorId: assurance.factorId,
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
    mfaRequired: false,
    organisationId: provisioned.organisationId,
    userId: provisioned.userId,
  }
}
