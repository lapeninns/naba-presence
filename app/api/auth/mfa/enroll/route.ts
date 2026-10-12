import { mfaEnrollSchema, type MfaEnrollResponse } from "@/lib/contracts/auth"
import { clientIpFromRequest, takeAbuseBudget } from "@/lib/server/abuse-limits"
import { randomToken } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"
import {
  createPendingTicket,
  MFA_MAX_FACTORS,
  requireMfaEnabled,
  setMfaTicketCookie,
} from "@/lib/server/mfa"
import {
  challengeAndVerifyFactor,
  enrollTotp,
  signInWithPassword,
} from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Starts enrolling an authenticator app for the signed-in person: the first
 * factor, or a backup when one exists (at most two). Allowed at any
 * assurance level, so a person who must enroll can.
 *
 * The password is asked again: the app keeps no provider token for a
 * session, and adding a factor is a credential change. Adding the backup
 * also needs a current code from the first factor, because the provider
 * allows enrolling another factor only at aal2. The answer carries the
 * secret for the authenticator app; the factor counts once POST
 * /api/auth/mfa/verify checks a code from it.
 *
 * Entitlement-exempt, like step-up: a read-only owner with no factor is sent
 * here before the stepped-up routes that stay available (billing first).
 */
export const POST = route({
  entitlement: "exempt",
  body: mfaEnrollSchema,
  handler: async ({ session, body, request, tenant }) => {
    requireMfaEnabled()
    if (session.supportActor) {
      throw new ApiError(
        403,
        "support_session_forbidden",
        "A support session cannot change two-step verification."
      )
    }
    await takeAbuseBudget("mfa_enroll", {
      ip: clientIpFromRequest(request),
      user: session.userId,
    })
    const [identity] = await tenant(
      (sql) =>
        sql<{ authProvider: string | null; authSubject: string | null }[]>`
        select
          auth_provider as "authProvider",
          auth_subject as "authSubject"
        from app_user
        where id = ${session.userId}
      `
    )
    if (!identity?.authProvider || !identity.authSubject) {
      throw new ApiError(
        409,
        "mfa_password_account_required",
        "Two-step verification needs an email and password sign-in."
      )
    }
    const signedIn = await signInWithPassword(session.email, body.password)
    // The password must belong to this person's own provider identity, not
    // merely to an account with the same address.
    if (
      signedIn.identity.provider !== identity.authProvider ||
      signedIn.identity.subject !== identity.authSubject
    ) {
      throw new ApiError(
        401,
        "invalid_credentials",
        "The email or password is incorrect."
      )
    }
    if (signedIn.factors.length >= MFA_MAX_FACTORS) {
      throw new ApiError(
        409,
        "mfa_factor_limit",
        "You already have an authenticator app and a backup."
      )
    }
    let accessToken = signedIn.accessToken
    const existing = signedIn.factors[0]
    if (existing) {
      if (!body.code) {
        throw new ApiError(
          400,
          "mfa_code_required",
          "Enter a code from your current authenticator app.",
          {
            fieldErrors: {
              code: "Enter a code from your current authenticator app.",
            },
          }
        )
      }
      accessToken = (
        await challengeAndVerifyFactor({
          accessToken,
          factorId: existing.id,
          code: body.code,
        })
      ).accessToken
    }
    const factorNumber = signedIn.factors.length + 1
    const enrollment = await enrollTotp(
      accessToken,
      // Unique per person (the provider refuses a repeated name), and says
      // which one it is in the authenticator app's own list.
      `${factorNumber === 1 ? "Authenticator" : "Backup"} ${randomToken(3)}`
    )
    const ticket = await createPendingTicket({
      purpose: "enroll",
      authProvider: identity.authProvider,
      authSubject: identity.authSubject,
      userId: session.userId,
      sessionId: session.sessionId,
      factorId: enrollment.factorId,
      providerToken: accessToken,
    })
    await setMfaTicketCookie(ticket)
    return { ...enrollment, factorNumber } satisfies MfaEnrollResponse
  },
})
