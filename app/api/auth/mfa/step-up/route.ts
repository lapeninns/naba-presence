import { mfaStepUpSchema, type MfaStepUpResponse } from "@/lib/contracts/auth"
import { clientIpFromRequest, takeAbuseBudget } from "@/lib/server/abuse-limits"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import {
  parseProviderAssurance,
  requireMfaEnabled,
  verifiedAssurance,
} from "@/lib/server/mfa"
import {
  challengeAndVerifyFactor,
  signInWithPassword,
} from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"
import { createSession, setSessionCookie } from "@/lib/server/session"

export const runtime = "nodejs"

/**
 * Renews the signed-in person's two-step proof (P02-S9) so they can take a
 * sensitive action (a route declared step-up): the password and a current
 * code are checked by the provider, and the session is replaced by an aal2
 * one whose proof counts for the next 15 minutes. A fresh token, as for any
 * privilege change; the old session row is deleted.
 *
 * The password is asked again because the app holds no provider token for a
 * session (the same reason enrollment asks for it). Counted against the same
 * code-guessing budgets as the sign-in verify, per user, IP and account.
 *
 * Entitlement-exempt: the read-only routes that stay available (billing,
 * privacy requests, legal holds, disconnecting Google, removing members)
 * need a fresh proof, so a read-only owner must still be able to get one.
 */
export const POST = route({
  entitlement: "exempt",
  body: mfaStepUpSchema,
  handler: async ({
    session,
    body,
    request,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    requireMfaEnabled()
    if (session.supportActor) {
      throw new ApiError(
        403,
        "support_session_forbidden",
        "A support session cannot verify as the customer."
      )
    }
    await takeAbuseBudget("mfa_verify", {
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
    const account = `${identity.authProvider}:${identity.authSubject}`
    await takeAbuseBudget("mfa_verify_account", { account })
    await takeAbuseBudget("mfa_verify_account_daily", { account })

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
    const factor =
      body.factor === "backup" ? signedIn.factors[1] : signedIn.factors[0]
    if (!factor) {
      throw signedIn.factors.length === 0
        ? new ApiError(
            403,
            "mfa_enrollment_required",
            "Set up two-step verification before you do this.",
            { details: { enrollPath: "/settings/security" } }
          )
        : new ApiError(
            400,
            "mfa_factor_unknown",
            "You have no backup authenticator app.",
            { fieldErrors: { factor: "You have no backup authenticator app." } }
          )
    }
    const verified = await challengeAndVerifyFactor({
      accessToken: signedIn.accessToken,
      factorId: factor.id,
      code: body.code,
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "mfa_code_invalid") {
        throw new ApiError(400, error.code, error.message, {
          fieldErrors: { code: error.message },
        })
      }
      throw error
    })
    // Fail closed: a verification the provider did not raise to aal2 is not
    // one, whatever it answered.
    if (parseProviderAssurance(verified.accessToken).aal !== "aal2") {
      throw new ApiError(
        503,
        "mfa_assurance_unconfirmed",
        "Two-step verification is temporarily unavailable."
      )
    }

    const assurance = verifiedAssurance({
      factorId: factor.id,
      authMethod: session.authMethod ?? "mfa_step_up",
    })
    const token = await tenant(async (sql) => {
      await sql`select set_config('app.user_id', ${session.userId}, true)`
      await sql`
        update app_user
        set mfa_factor_count = ${Math.min(Math.max(verified.factors.length, 1), 10)}
        where id = ${session.userId}
      `
      const token = await createSession(
        sql,
        session.userId,
        session.organisationId,
        { assurance }
      )
      await sql`delete from app_session where id = ${session.sessionId}`
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "user.mfa_step_up",
        subjectType: "user",
        subjectId: session.userId,
        requestId,
        metadata: { factorId: factor.id, clientRequestId },
      })
      return token
    })
    await setSessionCookie(token)
    return {
      verified: true,
      proofExpiresAt: (assurance.proofExpiresAt as Date).toISOString(),
    } satisfies MfaStepUpResponse
  },
})
